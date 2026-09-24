import { transactionCls } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { BatchDailyDataService } from './batch-daily-data.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { ApprovalService } from '../approval/approval.service';
import * as schema from '../../../core/database/schema';
import { activityStates } from './entry-history-state';

/**
 * The db mock answers by table rather than by call order. The previous version
 * chained mockReturnValueOnce, which meant any query added anywhere earlier in
 * postEntry silently handed the wrong rows to the query after it — the entry
 * window guard broke all of it by adding three.
 */
describe('BatchDailyDataService', () => {
  const dialect = new MySqlDialect();
  let service: BatchDailyDataService;
  let batchService: BatchService;

  const rows = new Map<unknown, unknown[]>();
  const capturedWheres: Array<{ table: unknown; condition: unknown }> = [];
  const mockDbSelect = jest.fn();
  const mockDbSelectDistinct = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDb = { select: mockDbSelect, selectDistinct: mockDbSelectDistinct, insert: mockDbInsert, update: mockDbUpdate };

  const approvalService = {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    approve: jest.fn(),
    approveUnscheduledHealth: jest.fn(),
    reject: jest.fn(),
  };

  /** Awaitable at any point, so .where(), .limit() and .orderBy() all resolve. */
  const chain = (result: unknown[], table: unknown) => {
    const self: any = {
      from: () => self,
      where: (condition: unknown) => { capturedWheres.push({ table, condition }); return self; },
      limit: () => self,
      for: () => self,
      orderBy: () => self,
      groupBy: () => self,
      innerJoin: () => self,
      leftJoin: () => self,
      then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
    };
    return self;
  };

  const header = { scheduler_id: 'sched-1', batch_id: 'batch-1', company_id: 'comp-1', lob_id: 'lob-1', effective_from: '2026-09-08', animal_count: '40' };
  const ENTRY_DATE = '2026-09-08';

  // The transaction CLS only resolves 'tenantDb'; farmScope() reads 'farmScope'
  // off the same ClsService, so tests that need a scope wrap .get() to answer it.
  let farmScopeValue: unknown;
  const useFarmScope = (scope: unknown) => { farmScopeValue = scope; };

  beforeEach(async () => {
    rows.clear();
    capturedWheres.length = 0;
    farmScopeValue = undefined;
    // The batch and its schedule exist; nothing has been entered yet; the user
    // holds no grants, i.e. is the on-ground worker.
    rows.set(schema.batchHeader, [{ batch_id: 'batch-1', tenant_id: 'tenant-123', start_date: ENTRY_DATE, animal_tracking: 'COUNT_ONLY' }]);
    rows.set(schema.schedulerHeader, [header]);
    rows.set(schema.batchDailyData, []);
    rows.set(schema.companyMaster, [{ tz: 'Africa/Harare' }]);
    rows.set(schema.userRoleAssignment, []);

    mockDbSelect.mockReset();
    mockDbSelectDistinct.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    Object.values(approvalService).forEach((fn) => fn.mockReset());
    approvalService.create.mockResolvedValue({ request_id: 'req-1', doc_no: 'HLT-UNS-2026-0001' });
    mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? [], table) }));
    mockDbSelectDistinct.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? [], table) }));
    mockDbInsert.mockReturnValue({ values: jest.fn().mockReturnValue({ onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}) }) });
    mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

    const cls = transactionCls(mockDb);
    const baseGet = cls.get.bind(cls);
    cls.get = ((key?: string) => (key === 'farmScope' ? farmScopeValue : baseGet(key as any))) as typeof cls.get;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchDailyDataService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: BatchService, useValue: { addTransaction: jest.fn() } },
        { provide: BatchTransferService, useValue: { create: jest.fn() } },
        { provide: GlPostingService, useValue: {} },
        { provide: ApprovalService, useValue: approvalService },
      ],
    }).compile();

    service = module.get<BatchDailyDataService>(BatchDailyDataService);
    batchService = module.get<BatchService>(BatchService);
  });

  const line = (over: Record<string, unknown> = {}) => {
    rows.set(schema.schedulerLine, [{
      line_id: 'line-1', scheduler_id: 'sched-1', is_active: true, lot_required: false,
      occurrence: 'DAILY', start_day: 1, end_day: null, day_of_week: null, is_mandatory: true,
      stage_id: 'stage-1', ...over,
    }]);
  };

  const renderedWhereFor = (table: unknown, occurrence = 0) => {
    const matches = capturedWheres.filter((entry) => entry.table === table);
    return dialect.sqlToQuery(matches[occurrence].condition as any);
  };

  it('puts farm, company and LOB conditions on the batch lookup used by entryForm', async () => {
    useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    await service.entryForm('batch-1', undefined, 'tenant-123', { userId: 'u' } as any);

    const { sql, params } = renderedWhereFor(schema.batchHeader);
    expect(sql).toContain('`batch_header`.`farm_id` = ?');
    expect(sql).toContain('`batch_header`.`lob_id` = ?');
    expect(sql).toContain('`batch_header`.`company_id` = ?');
    expect(params).toEqual(expect.arrayContaining(['farm-g', 'lob-1', 'comp-1']));
  });

  it('refuses postEntry before side effects when its scoped batch lock finds nothing', async () => {
    useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    rows.set(schema.batchHeader, []);

    await expect(
      service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 2 } as any, 'tenant-123'),
    ).rejects.toThrow(NotFoundException);

    const { sql } = renderedWhereFor(schema.batchHeader);
    expect(sql).toContain('`batch_header`.`farm_id` = ?');
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('bounds entryDates by company when an operational admin selects no farm', async () => {
    useFarmScope({ farmId: null, restricted: true, companyId: 'comp-1', lobId: 'lob-1' });

    await service.entryDates('batch-1', 'tenant-123');

    const { sql, params } = renderedWhereFor(schema.batchDailyData);
    expect(sql).toContain('`batch_daily_data`.`company_id` = ?');
    expect(params).toContain('comp-1');
  });

  it('bounds findForDate by company when an operational admin selects no farm', async () => {
    useFarmScope({ farmId: null, restricted: true, companyId: 'comp-1', lobId: 'lob-1' });

    await service.findForDate('batch-1', ENTRY_DATE, 'tenant-123');

    const { sql, params } = renderedWhereFor(schema.batchDailyData);
    expect(sql).toContain('`batch_daily_data`.`company_id` = ?');
    expect(params).toContain('comp-1');
  });

  it('reverses the prior consumption before posting a corrected daily quantity', async () => {
    line({ line_type: 'CONSUMPTION', item_id: 'item-feed', activity_name: 'Morning Feed' });
    jest.spyOn(service as any, 'companyToday').mockResolvedValue(ENTRY_DATE);
    rows.set(schema.batchDailyData, [{ posted: true, posting_reference: 'old-tx', entered_value: '4.6' }]);
    rows.set(schema.itemMaster, [{ item_id: 'item-feed', uom_primary: 'KG' }]);
    (batchService as any).reverseConsumption = jest.fn().mockResolvedValue({});
    (batchService.addTransaction as jest.Mock).mockResolvedValue({ posting_transaction_id: 'new-tx', transactions: [] });
    await service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 5 } as any, 'tenant-123');
    expect((batchService as any).reverseConsumption).toHaveBeenCalledWith('batch-1', 'old-tx', 'tenant-123', undefined);
  });

  it('rejects an entry against a deactivated line', async () => {
    line({ is_active: false });
    await expect(
      service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 2 } as any, 'tenant-123'),
    ).rejects.toThrow(ConflictException);
  });

  it('delegates a CONSUMPTION entry with its selected lot and the item\'s stock UOM', async () => {
    line({ line_type: 'CONSUMPTION', item_id: 'item-feed', activity_name: 'Morning Feed' });
    rows.set(schema.itemMaster, [{ item_id: 'item-feed', uom_primary: 'KG' }]);
    (batchService.addTransaction as jest.Mock).mockResolvedValue({
      posting_transaction_id: 'tx-1',
      transactions: [{ transaction_id: 'tx-1', transaction_date: ENTRY_DATE, item_id: 'item-feed', transaction_type: 'CONSUMPTION' }],
    });

    await service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 22.5, lot_no: 'selected-lot' } as any, 'tenant-123', { userId: 'user-1' });

    expect(batchService.addTransaction).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ transaction_type: 'CONSUMPTION', item_id: 'item-feed', quantity: 22.5, uom: 'KG', lot_no: 'selected-lot' }),
      'tenant-123',
      { userId: 'user-1' },
    );
  });

  describe('dayStatus', () => {
    // Item 6: a REGISTERED batch's animals move stage-by-stage, so
    // scheduler_header.animal_count (set once when the stage started) goes
    // stale the moment anything transfers. Without the fix dayStatus always
    // reported that stale header snapshot, same as a COUNT_ONLY batch.
    it("reports the live animal_register count per stage for a REGISTERED batch, not the scheduler's own snapshot", async () => {
      rows.set(schema.batchHeader, [{ batch_id: 'batch-1', tenant_id: 'tenant-123', start_date: ENTRY_DATE, animal_tracking: 'REGISTERED' }]);
      line(); // default: stage_id 'stage-1', scheduler animal_count '40'
      // The mock db doesn't run a real GROUP BY — set the already-grouped shape
      // liveStageAnimalCounts()'s select({stage_id, n}) reads back.
      rows.set(schema.animalRegister, [{ stage_id: 'stage-1', n: 12 }]);

      const result = await service.dayStatus('batch-1', ENTRY_DATE, 'tenant-123');

      expect(result.stages[0].animal_count).toBe(12); // live count, not the header's '40'
    });

    it('falls back to the scheduler snapshot for a COUNT_ONLY batch', async () => {
      line();

      const result = await service.dayStatus('batch-1', ENTRY_DATE, 'tenant-123');

      expect(result.stages[0].animal_count).toBe(40); // header.animal_count — no animal_register rows to re-derive from
    });

    // Item 3: MONTHLY/CUSTOM wiring — day-completeness.spec.ts covers the pure
    // rule; this covers that batch-daily-data.service actually loads
    // scheduler_line_custom_days and hands it to isLineDue.
    it('treats a CUSTOM-occurrence line as due only on its scheduler_line_custom_days entries', async () => {
      line({ occurrence: 'CUSTOM', start_day: 1, end_day: null });
      rows.set(schema.schedulerLineCustomDays, [{ line_id: 'line-1', day_number: 5 }]);

      const notDue = await service.dayStatus('batch-1', ENTRY_DATE, 'tenant-123'); // day 1 of the scheduler
      expect(notDue.stages).toEqual([]);

      const due = await service.dayStatus('batch-1', '2026-09-12', 'tenant-123'); // effective_from + 4 = day 5
      expect(due.stages[0].due).toBe(1);
    });
  });

  describe('TRANSFER lines', () => {
    // destination_batch_id is from the request body, so a worker holding only
    // BATCH_ENTRY create could move animals to any farm through this line.
    const transferEntry = { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 1, destination_batch_id: 'batch-other' } as any;

    beforeEach(() => {
      line({ line_type: 'TRANSFER', activity_name: 'Move to farrowing', auto_triggers_stage: true, standard_qty: '1' });
      rows.set(schema.animalRegister, [{ animal_id: 'a-1' }]);
      jest.spyOn(service as any, 'companyToday').mockResolvedValue(ENTRY_DATE);
    });

    it('sends a farm worker\'s TRANSFER through create()\'s approval gate, which decides the mode', async () => {
      useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
      const transfers = service['batchTransferService'] as unknown as { create: jest.Mock };
      // The gate now sits inside create(): the service hands the movement over
      // and create() decides between direct post and PENDING approval. From
      // here both paths look the same — a completed create() call.
      transfers.create.mockResolvedValue({ transfer_id: 'tr-draft', status: 'DRAFT' });

      await service.postEntry('batch-1', transferEntry, 'tenant-123', { userId: 'w-1', userType: 'STANDARD_USER' });

      expect(transfers.create).toHaveBeenCalledTimes(1);
      // postEntry still writes its own batch_daily_data row — only the animal
      // movement itself is deferred to create()'s gate.
      expect(mockDbInsert).toHaveBeenCalledTimes(1);
    });

    it('passes auto_triggers_stage as a service option, never in the transfer body', async () => {
      const transfers = service['batchTransferService'] as unknown as { create: jest.Mock };
      transfers.create.mockResolvedValue({ transfer_id: 'tr-1' });
      const admin = { userId: 'ca-1', userType: 'COMPANY_ADMIN' };

      await service.postEntry('batch-1', transferEntry, 'tenant-123', admin);

      const [body, tenantId, fromBatchId, actor, options] = transfers.create.mock.calls[0];
      expect(body).not.toHaveProperty('auto_triggers_stage');
      expect(body.to_batch_id).toBe('batch-other');
      expect([tenantId, fromBatchId, actor]).toEqual(['tenant-123', 'batch-1', admin]);
      expect(options).toEqual({ autoTriggersStage: true });
    });
  });

  it('flags a DESCRIPTIVE entry that breaches its alert limit without posting a transaction', async () => {
    line({ line_id: 'line-mort', line_type: 'DESCRIPTIVE', item_id: null, activity_name: 'Daily Mortality',
      lower_alert_limit: null, upper_alert_limit: '1', alert_severity: 'CRITICAL', std_value: null });

    await service.postEntry('batch-1', { line_id: 'line-mort', entry_date: ENTRY_DATE, entered_value: 3 } as any, 'tenant-123');

    expect(batchService.addTransaction).not.toHaveBeenCalled();
    // First insert is the notification_alert_log write; second is batch_daily_data.
    expect(mockDbInsert).toHaveBeenCalledTimes(2);
  });

  describe('the entry window', () => {
    it('lets a worker fill in a past day nothing was recorded for', async () => {
      line({ line_type: 'DESCRIPTIVE', item_id: null, activity_name: 'Head Count' });
      await expect(
        service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 40 } as any, 'tenant-123'),
      ).resolves.toBeDefined();
    });

    it('stops a worker changing a past day already recorded', async () => {
      line({ line_type: 'DESCRIPTIVE', item_id: null, activity_name: 'Head Count' });
      rows.set(schema.batchDailyData, [{ entry_id: 'e1', line_id: 'line-1', entry_date: ENTRY_DATE }]);
      await expect(
        service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 41 } as any, 'tenant-123'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a role holding edit on BATCH_ENTRY change the same past day', async () => {
      line({ line_type: 'DESCRIPTIVE', item_id: null, activity_name: 'Head Count' });
      rows.set(schema.batchDailyData, [{ entry_id: 'e1', line_id: 'line-1', entry_date: ENTRY_DATE }]);
      rows.set(schema.userRoleAssignment, [{
        moduleCode: 'PRODUCTION', resource: 'BATCH_ENTRY',
        canView: true, canCreate: true, canEdit: true, canDelete: false, canApprove: true, canExport: true, canPrint: true,
      }]);
      await expect(
        service.postEntry('batch-1', { line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: 41 } as any, 'tenant-123', { userId: 'u' }),
      ).resolves.toBeDefined();
    });

    it('refuses a day that has not happened yet', async () => {
      line({ line_type: 'DESCRIPTIVE', item_id: null, activity_name: 'Head Count' });
      await expect(
        service.postEntry('batch-1', { line_id: 'line-1', entry_date: '2099-01-01', entered_value: 1 } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('unscheduled health events', () => {
    // The schedule is what a worker may enter. Health is the one exception,
    // because a sick animal will not wait for a schedule to be redesigned.
    it('records the observation at once, as a request awaiting approval', async () => {
      rows.set(schema.itemMaster, [{ item_id: 'med-1', item_name: 'Oxytetracycline', uom: 'ML' }]);

      await service.recordUnscheduledHealth('batch-1', {
        entry_date: ENTRY_DATE, observation: 'Lame gilt, pen 4', item_id: 'med-1', quantity: 12,
      } as any, 'tenant-123', { userId: 'u' });

      expect(approvalService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          doc_type: 'UNSCHEDULED_HEALTH',
          batch_id: 'batch-1',
          requested_qty: '12',
          uom: 'ML',
          urgency: 'HIGH',
        }),
        'tenant-123',
        { userId: 'u' },
      );
      // The event itself is the request; nothing was written to the day's
      // entries, which only ever answer a scheduler line.
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    // The backlog gate deliberately does not apply here: it would stop someone
    // reporting a sick animal because a feed record from last Tuesday is
    // missing, which is exactly backwards.
    it('is not held back by a backlog', async () => {
      rows.set(schema.batchDailyData, []);
      await expect(service.recordUnscheduledHealth('batch-1', {
        entry_date: '2026-09-01', observation: 'Scouring piglets',
      } as any, 'tenant-123')).resolves.toBeDefined();
    });

    it('refuses an event dated in the future', async () => {
      await expect(service.recordUnscheduledHealth('batch-1', {
        entry_date: '2099-01-01', observation: 'Lame gilt',
      } as any, 'tenant-123')).rejects.toThrow(BadRequestException);
    });

    // Found by calling the running endpoint, not by reading the code:
    // findAll answers with a bare array, and spreading one into an object
    // produced `{"0": {...}}` — a shape every caller's .map() would choke on.
    it('lists this batch\'s events as an array', async () => {
      approvalService.findAll.mockResolvedValue([
        { request_id: 'req-1', batch_id: 'batch-1', doc_no: 'HLT-UNS-2026-0001' },
        { request_id: 'req-2', batch_id: 'batch-9', doc_no: 'HLT-UNS-2026-0002' },
      ]);

      const list = await service.listUnscheduledHealth('batch-1', 'tenant-123', 'PENDING');

      expect(Array.isArray(list)).toBe(true);
      expect(list.map((r: any) => r.doc_no)).toEqual(['HLT-UNS-2026-0001']);
    });

    it('refuses a medicine that is not in the Item Master', async () => {
      rows.set(schema.itemMaster, []);
      await expect(service.recordUnscheduledHealth('batch-1', {
        entry_date: ENTRY_DATE, observation: 'Lame gilt', item_id: 'nope',
      } as any, 'tenant-123')).rejects.toThrow(NotFoundException);
    });

    it('delegates health approval with the expected batch and current user', async () => {
      approvalService.approveUnscheduledHealth.mockResolvedValue({ status: 'APPROVED' });
      await expect(service.approveUnscheduledHealth('batch-1', 'req-1', 'tenant-123', { userId: 'u' }))
        .resolves.toEqual({ status: 'APPROVED' });
      expect(approvalService.approveUnscheduledHealth).toHaveBeenCalledWith('batch-1', 'req-1', 'tenant-123', { userId: 'u' });
      expect(batchService.addTransaction).not.toHaveBeenCalled();
    });

    it('propagates a failed health approval without approving separately', async () => {
      approvalService.approveUnscheduledHealth.mockRejectedValue(new Error('No stock on hand'));
      await expect(service.approveUnscheduledHealth('batch-1', 'req-1', 'tenant-123')).rejects.toThrow('No stock on hand');
      expect(approvalService.approve).not.toHaveBeenCalled();
    });

  });
  /* ──────────────────────────────────────────────────────────────────────
   * Phase 6: what the Daily Data Entry screen argues from.
   *
   * The form now carries the active entry as the contract's EntryView, the
   * parent Activity cards, and who a line may be recorded against; History
   * answers the rail beside it. All three are read-only — they decide what the
   * screen may offer, never what it writes.
   * ────────────────────────────────────────────────────────────────────── */
  describe('the Phase 6 entry form', () => {
    /** A scheduler of n daily lines, all due from the scheduler's own start. */
    const formLines = (specs: Array<Record<string, unknown>>) => {
      rows.set(schema.schedulerLine, specs.map((spec, i) => ({
        line_id: `line-${i + 1}`, scheduler_id: 'sched-1', is_active: true, lot_required: false,
        occurrence: 'DAILY', start_day: 1, end_day: null, day_of_week: null, is_mandatory: true,
        stage_id: 'stage-1', line_seq: i + 1, line_type: 'DESCRIPTIVE',
        activity_name: `Activity ${i + 1}`, kpi_metric: null, ...spec,
      })));
    };
    const onDay = (day: string) => jest.spyOn(service as any, 'companyToday').mockResolvedValue(day);
    const form = (date = ENTRY_DATE, user: unknown = { userId: 'u' }) =>
      service.entryForm('batch-1', date, 'tenant-123', user as any);

    it("hands each line its active entry in the contract's EntryView shape", async () => {
      onDay(ENTRY_DATE);
      formLines([{ line_type: 'CONSUMPTION', item_id: 'item-feed' }]);
      rows.set(schema.batchDailyData, [{
        entry_id: 'e-1', line_id: 'line-1', entry_date: ENTRY_DATE, status: 'DRAFT', version: 3,
        entered_value: '12.5', entered_text: null, lot_no: 'LOT-9', remarks: 'am feed',
        target_scope: 'SELECTED_ANIMALS', supersedes_entry_id: null, posted: false,
      }]);
      // Deliberately out of order: the screen shows a stable selection.
      rows.set(schema.batchDailyDataTarget, [
        { entry_id: 'e-1', animal_id: 'a-2' }, { entry_id: 'e-1', animal_id: 'a-1' },
      ]);

      const result = await form();

      expect(result.lines[0].entry).toEqual(expect.objectContaining({
        entry_id: 'e-1', status: 'DRAFT', version: 3, entered_value: 12.5, entered_text: null,
        lot_no: 'LOT-9', remarks: 'am feed', target_scope: 'SELECTED_ANIMALS',
        animal_ids: ['a-1', 'a-2'], supersedes_entry_id: null,
      }));
    });

    // A row written before Phase 6 has no target_scope and no version of its own;
    // it was posted against the whole batch, and must still read as one.
    it('reads a pre-Phase-6 row as a posted, version 1, whole-batch entry', async () => {
      onDay(ENTRY_DATE);
      formLines([{ line_type: 'CONSUMPTION', item_id: 'item-feed' }]);
      rows.set(schema.batchDailyData, [{
        entry_id: 'e-old', line_id: 'line-1', entry_date: ENTRY_DATE, entered_value: '4',
        posted: true, status: 'POSTED', version: 1, target_scope: null,
      }]);

      const result = await form();

      expect(result.lines[0].entry).toEqual(expect.objectContaining({
        status: 'POSTED', version: 1, target_scope: 'BATCH', animal_ids: [],
      }));
    });

    it('offers Correct only for the line types a correction can reverse today', async () => {
      onDay(ENTRY_DATE);
      formLines([
        { line_type: 'CONSUMPTION', item_id: 'item-feed' },
        { line_type: 'OUTPUT', item_id: 'item-pig' },
        { line_type: 'DESCRIPTIVE', kpi_metric: 'MORTALITY_COUNT' },
        { line_type: 'DESCRIPTIVE', kpi_metric: 'AVG_WEIGHT' },
      ]);
      rows.set(schema.batchDailyData, ['line-1', 'line-2', 'line-3', 'line-4'].map((line_id, i) => ({
        entry_id: `e-${i + 1}`, line_id, entry_date: ENTRY_DATE, status: 'POSTED', version: 1, posted: true,
      })));

      const result = await form();

      expect(result.lines.map((l) => l.correctable)).toEqual([true, false, false, true]);
    });

    it('never offers Correct for a line that is only a draft, or has nothing on it', async () => {
      onDay(ENTRY_DATE);
      formLines([{ line_type: 'CONSUMPTION', item_id: 'item-feed' }, { line_type: 'CONSUMPTION', item_id: 'item-feed' }]);
      rows.set(schema.batchDailyData, [{
        entry_id: 'e-1', line_id: 'line-1', entry_date: ENTRY_DATE, status: 'DRAFT', version: 1,
      }]);

      const result = await form();

      expect(result.lines.map((l) => l.correctable)).toEqual([false, false]);
    });

    // Correction obeys the same window as every other change: a worker owns
    // today, a supervisor owns any day.
    it('closes Correct on a past day for a worker and leaves it open for a supervisor', async () => {
      onDay('2026-09-10');
      formLines([{ line_type: 'CONSUMPTION', item_id: 'item-feed' }]);
      rows.set(schema.batchDailyData, [{
        entry_id: 'e-1', line_id: 'line-1', entry_date: ENTRY_DATE, status: 'POSTED', version: 1, posted: true,
      }]);

      expect((await form()).lines[0].correctable).toBe(false);

      rows.set(schema.userRoleAssignment, [{
        moduleCode: 'PRODUCTION', resource: 'BATCH_ENTRY',
        canView: true, canCreate: true, canEdit: true, canDelete: false, canApprove: true, canExport: true, canPrint: true,
      }]);
      expect((await form()).lines[0].correctable).toBe(true);
    });

    it('groups the day into Activity parent cards through the shared rule', async () => {
      onDay(ENTRY_DATE);
      formLines([
        { line_type: 'CONSUMPTION', item_id: 'item-feed', is_mandatory: true },
        { line_type: 'CONSUMPTION', item_id: 'item-feed', is_mandatory: true },
        { line_type: 'DESCRIPTIVE', is_mandatory: false },
      ]);
      rows.set(schema.batchDailyData, [
        { entry_id: 'e-1', line_id: 'line-1', entry_date: ENTRY_DATE, status: 'POSTED', version: 1 },
        { entry_id: 'e-3', line_id: 'line-3', entry_date: ENTRY_DATE, status: 'DRAFT', version: 1 },
      ]);

      const result = await form();

      expect(result.activities).toEqual(activityStates([
        { line_id: 'line-1', line_type: 'CONSUMPTION', line_seq: 1, is_mandatory: true, status: 'POSTED' },
        { line_id: 'line-2', line_type: 'CONSUMPTION', line_seq: 2, is_mandatory: true, status: null },
        { line_id: 'line-3', line_type: 'DESCRIPTIVE', line_seq: 3, is_mandatory: false, status: 'DRAFT' },
      ]));
      expect(result.activities[0]).toEqual({
        line_type: 'CONSUMPTION', state: 'IN_PROGRESS', required: 2, posted: 1, drafts: 0,
        line_ids: ['line-1', 'line-2'],
      });
    });

    it('tells a Count Only batch it has a batch to record against and no animals', async () => {
      onDay(ENTRY_DATE);
      formLines([{}]);

      const result = await form();

      expect(result.targeting).toEqual({ mode: 'COUNT_ONLY', default_scope: 'BATCH', stage_animals: [] });
    });

    it('offers a Registered batch the animals standing in the chosen stage, with their codes', async () => {
      onDay(ENTRY_DATE);
      rows.set(schema.batchHeader, [{ batch_id: 'batch-1', tenant_id: 'tenant-123', start_date: ENTRY_DATE, animal_tracking: 'REGISTERED' }]);
      formLines([{}]);
      // The mock runs no GROUP BY, so one fixture serves both reads: the grouped
      // shape liveStageAnimalCounts() selects and the animal rows targeting needs.
      rows.set(schema.animalRegister, [
        { stage_id: 'stage-1', n: 2, animal_id: 'a-1', animal_code: 'PIG-2026-0001', ear_tag: 'E-1' },
        { stage_id: 'stage-1', n: 2, animal_id: 'a-2', animal_code: 'PIG-2026-0002', ear_tag: null },
      ]);

      const result = await form();

      expect(result.targeting).toEqual({
        mode: 'REGISTERED',
        default_scope: 'STAGE_ANIMALS',
        stage_animals: [
          { animal_id: 'a-1', animal_code: 'PIG-2026-0001', ear_tag: 'E-1' },
          { animal_id: 'a-2', animal_code: 'PIG-2026-0002', ear_tag: null },
        ],
      });
    });

    it('still answers a batch with no scheduler, with nothing to do and nothing to target', async () => {
      onDay(ENTRY_DATE);
      rows.set(schema.schedulerHeader, []);

      const result = await form();

      expect(result.hasScheduler).toBe(false);
      expect(result.activities).toEqual([]);
      expect(result.targeting).toEqual({ mode: 'COUNT_ONLY', default_scope: 'BATCH', stage_animals: [] });
    });

    // Ruling 1: a corrected line keeps its old row for the audit trail. Reading
    // it back would show the day twice and count it twice.
    it('never reads a superseded row back as the day\'s entry', async () => {
      await service.findForDate('batch-1', ENTRY_DATE, 'tenant-123');

      const { sql, params } = renderedWhereFor(schema.batchDailyData);
      expect(sql).toContain('`batch_daily_data`.`status` <> ?');
      expect(params).toContain('SUPERSEDED');
    });

    it('leaves superseded dates out of the history list of dates', async () => {
      await service.entryDates('batch-1', 'tenant-123');

      const { sql, params } = renderedWhereFor(schema.batchDailyData);
      expect(sql).toContain('`batch_daily_data`.`status` <> ?');
      expect(params).toContain('SUPERSEDED');
    });
  });

  describe('history', () => {
    const dailyMandatory = () => rows.set(schema.schedulerLine, [{
      line_id: 'line-1', scheduler_id: 'sched-1', is_active: true, lot_required: false,
      occurrence: 'DAILY', start_day: 1, end_day: null, day_of_week: null, is_mandatory: true,
      stage_id: 'stage-1', line_seq: 1, line_type: 'DESCRIPTIVE', activity_name: 'Head Count',
    }]);

    it('answers newest first, with the state the rule module decides for each day', async () => {
      dailyMandatory();
      jest.spyOn(service as any, 'companyToday').mockResolvedValue('2026-09-10');
      rows.set(schema.batchDailyData, [
        { entry_id: 'e-1', line_id: 'line-1', entry_date: '2026-09-08', status: 'POSTED', version: 1 },
        { entry_id: 'e-2', line_id: 'line-1', entry_date: '2026-09-10', status: 'DRAFT', version: 1 },
      ]);

      const data = await service.history('batch-1', '2026-09-10', 30, 'tenant-123');

      expect(data.map((d) => d.date)).toEqual(['2026-09-10', '2026-09-09', '2026-09-08']);
      expect(data.map((d) => d.state)).toEqual(['IN_PROGRESS', 'MISSING', 'COMPLETE']);
      expect(data[0]).toEqual({ date: '2026-09-10', state: 'IN_PROGRESS', required: 1, posted: 0, drafts: 1 });
      expect(data[2]).toEqual({ date: '2026-09-08', state: 'COMPLETE', required: 1, posted: 1, drafts: 0 });
    });

    // Ruling 1 again, from the other side: a draft is not an answer, so it
    // cannot clear a day the farm still owes.
    it('leaves a past day Missing when all it has is a draft', async () => {
      dailyMandatory();
      jest.spyOn(service as any, 'companyToday').mockResolvedValue('2026-09-10');
      rows.set(schema.batchDailyData, [{ entry_id: 'e-1', line_id: 'line-1', entry_date: '2026-09-09', status: 'DRAFT', version: 1 }]);

      const data = await service.history('batch-1', '2026-09-09', 1, 'tenant-123');

      expect(data).toEqual([{ date: '2026-09-09', state: 'MISSING', required: 1, posted: 0, drafts: 1 }]);
    });

    it('never reaches past sixty days, and never before the batch started', async () => {
      dailyMandatory();
      jest.spyOn(service as any, 'companyToday').mockResolvedValue('2026-12-31');

      const bounded = await service.history('batch-1', '2026-12-31', 500, 'tenant-123');
      expect(bounded).toHaveLength(60);
      expect(bounded[59].date).toBe('2026-11-02');

      // The batch starts on 2026-09-08; thirty days back from the 10th is not.
      const clipped = await service.history('batch-1', '2026-09-10', 30, 'tenant-123');
      expect(clipped.map((d) => d.date)).toEqual(['2026-09-10', '2026-09-09', '2026-09-08']);
    });

    it('reads superseded rows as gone, not as an answer', async () => {
      dailyMandatory();
      jest.spyOn(service as any, 'companyToday').mockResolvedValue('2026-09-08');

      await service.history('batch-1', ENTRY_DATE, 1, 'tenant-123');

      const { sql, params } = renderedWhereFor(schema.batchDailyData);
      expect(sql).toContain('`batch_daily_data`.`status` <> ?');
      expect(params).toContain('SUPERSEDED');
    });

    it('loads its batch through the farm scope, so another farm\'s history is not found', async () => {
      useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
      rows.set(schema.batchHeader, []);

      await expect(service.history('batch-1', ENTRY_DATE, 30, 'tenant-123')).rejects.toThrow(NotFoundException);

      const { sql, params } = renderedWhereFor(schema.batchHeader);
      expect(sql).toContain('`batch_header`.`farm_id` = ?');
      expect(params).toEqual(expect.arrayContaining(['farm-g']));
    });

    it('has nothing to say about a batch with no scheduler', async () => {
      rows.set(schema.schedulerHeader, []);
      jest.spyOn(service as any, 'companyToday').mockResolvedValue('2026-09-10');

      expect(await service.history('batch-1', '2026-09-10', 30, 'tenant-123')).toEqual([]);
    });
  });
});
