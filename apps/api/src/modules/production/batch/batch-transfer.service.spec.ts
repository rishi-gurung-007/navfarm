import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { BatchTransferService, FARM_TO_FARM_TRANSFER_REFUSAL, WORKER_TRANSFER_REFUSAL } from './batch-transfer.service';
import { CreateBatchTransferDto } from './dto/batch.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';
import * as schema from '../../../core/database/schema';

const dialect = new MySqlDialect();

describe('BatchTransferService', () => {
  let service: BatchTransferService;

  const mockDbSelect = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDbInsert = jest.fn();
  const mockCreateForAuthorizedBatchStage = jest.fn();
  const mockAuditLog = jest.fn();

  const mockDb: any = {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
    transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(mockDb)),
  };

  // farmScope() reads its own key off the same ClsService that 'tenantDb'
  // comes from; tests that need a scope set it here.
  let farmScopeValue: unknown;
  const useFarmScope = (scope: unknown) => { farmScopeValue = scope; };

  // findAll/findOne build their farm condition with `and`/`or` rather than a
  // plain `eq`, so the only way to check it landed is to render the captured
  // `where` argument back to SQL text, same approach as farm-scope.spec.ts.
  let capturedWhere: unknown;
  const renderedWhere = () => dialect.sqlToQuery(capturedWhere as any).sql;

  // Awaitable at any point, like the stock-transfer spec's chain; records the
  // lock mode so a test can prove a read was FOR UPDATE.
  let forCalls: unknown[];
  const chain = (result: unknown[], onWhere?: (cond: unknown) => void) => {
    const self: any = {
      from: () => self,
      leftJoin: () => self,
      orderBy: () => self,
      limit: () => self,
      where: (cond: unknown) => { onWhere?.(cond); return self; },
      for: (mode: unknown) => { forCalls.push(mode); return self; },
      then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
    };
    return self;
  };

  // Updates answer by table: the batch_transfer claim reports one affected row.
  const updatesByTable = (claimRows = 1, animalClaimRows = 2) => {
    mockDbUpdate.mockImplementation((table: unknown) => ({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(
          table === schema.batchTransfer
            ? [{ affectedRows: claimRows }]
            : table === schema.animalRegister
              ? [{ affectedRows: animalClaimRows }]
              : {},
        ),
      }),
    }));
  };
  const updatedTables = () => mockDbUpdate.mock.calls.map((call) => call[0]);

  const operationalAdmin = { userId: 'oa-1', userType: 'OPERATIONAL_ADMIN' };
  const companyAdmin = { userId: 'ca-1', userType: 'COMPANY_ADMIN' };
  const worker = { userId: 'w-1', userType: 'STANDARD_USER' };
  const kintyreScope = { farmId: 'farm-k', restricted: true, companyId: 'comp-1', lobId: 'lob-1' };

  const batchRow = (over: Record<string, unknown>) => ({
    batch_id: 'batch-x', batch_no: 'PIG-BAT-X', tenant_id: 'tenant-123', company_id: 'comp-1', lob_id: 'lob-1',
    farm_id: 'farm-k', status: 'ACTIVE', stage_id: 'stage-1', ...over,
  });
  const kintyreSource = batchRow({ batch_id: 'batch-gest', farm_id: 'farm-k' });
  const grasmereDestination = batchRow({ batch_id: 'batch-farrow', farm_id: 'farm-g', stage_id: 'stage-farrowing' });
  const kintyreDestination = batchRow({ batch_id: 'batch-farrow', farm_id: 'farm-k', stage_id: 'stage-farrowing' });

  const draftTransfer = {
    transfer_id: 'tr-1',
    tenant_id: 'tenant-123',
    company_id: 'comp-1',
    from_batch_id: 'batch-gest',
    to_batch_id: 'batch-farrow',
    status: 'DRAFT',
    transfer_date: '2026-08-01',
    lines: [
      { animal_id: 'a-1', book_value: '28000.0000', to_location_id: 'loc-farrow-1' },
      { animal_id: 'a-2', book_value: '28000.0000', to_location_id: 'loc-farrow-1' },
    ],
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
    mockDbInsert.mockReset();
    mockAuditLog.mockReset().mockResolvedValue({});
    mockDb.transaction.mockClear();
    mockCreateForAuthorizedBatchStage.mockReset().mockResolvedValue({});
    farmScopeValue = undefined;
    capturedWhere = undefined;
    forCalls = [];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchTransferService,
        { provide: ClsService, useValue: {
          get: jest.fn((key?: string) => key === 'farmScope' ? farmScopeValue : key === 'tenantPostingTransaction' ? false : mockDb),
          run: jest.fn(async (work: () => Promise<unknown>) => work()),
          set: jest.fn(),
        } },
        { provide: AuditLogService, useValue: { log: mockAuditLog } },
        { provide: NumberSeriesService, useValue: { generateNext: jest.fn().mockResolvedValue('BTR-2026-0001') } },
        { provide: SchedulerHeaderService, useValue: {
          createForStage: jest.fn().mockResolvedValue({}),
          createForAuthorizedBatchStage: mockCreateForAuthorizedBatchStage,
        } },
      ],
    }).compile();

    service = module.get<BatchTransferService>(BatchTransferService);
  });

  describe('splitBatch', () => {
    const parent = {
      batch_id: 'batch-gest', batch_no: 'PIG-BAT-2026-0001', tenant_id: 'tenant-123', company_id: 'comp-1',
      nob_id: 'nob-1', lob_id: 'lob-1', breed_id: 'breed-1',
      costing_method: 'BIO_ASSET', current_stage_code: 'DRY_SOW_GESTATION', stage_id: 'stage-gest',
      shed_id: 'shed-1', location_id: 'pen-1', status: 'ACTIVE',
      opening_quantity: '11.0000', closing_quantity: '11.0000', uom: 'HEAD',
      start_date: '2026-03-06', operational_area_id: 'area-1',
      farm_id: 'farm-g', animal_tracking: 'INDIVIDUAL',
    };

    beforeEach(() => {
      // The child row read back for its scheduler; stage lookups queue ahead of it.
      mockDbSelect.mockImplementation(() => chain([{ ...parent, batch_id: 'child-row', parent_batch_id: 'batch-gest' }]));
    });

    it('keeps the child batch on the parent farm and tracking mode', async () => {
      // A farm-less child was invisible to every farm-scoped user, including the
      // one who split it, and scheduler generation for it failed after the move.
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      jest.spyOn(service, 'create').mockResolvedValue({ transfer_no: 'BTR-1' } as any);
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });

      await service.splitBatch('batch-gest', { animal_ids: ['a-1'], transfer_date: '2026-09-01' } as any, 'tenant-123', { userId: 'user-1' });

      const childHeader = inserted.find((v) => v.parent_batch_id);
      expect(childHeader.farm_id).toBe('farm-g');
      expect(childHeader.animal_tracking).toBe('INDIVIDUAL');
    });

    it('generates the child scheduler through the authorized-row path, inside one transaction', async () => {
      // The scoped createForStage() re-read the child under the caller's farm and
      // threw NotFound after the animals had already moved.
      useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      jest.spyOn(service, 'create').mockResolvedValue({ transfer_no: 'BTR-1' } as any);
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
      const schedulers = (service as any).schedulerHeaderService;

      await service.splitBatch('batch-gest', { animal_ids: ['a-1'], transfer_date: '2026-09-01' } as any, 'tenant-123', operationalAdmin);

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(schedulers.createForStage).not.toHaveBeenCalled();
      expect(mockCreateForAuthorizedBatchStage).toHaveBeenCalledWith(
        expect.objectContaining({ batch_id: 'child-row' }), 'stage-gest', 'tenant-123', operationalAdmin,
      );
    });

    it('writes the child batch inside the transaction, so a refused movement rolls it back', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      jest.spyOn(service, 'create').mockRejectedValue(new BadRequestException('not live'));
      let insideTransaction = false;
      const insertedInside: boolean[] = [];
      mockDb.transaction.mockImplementationOnce(async (work: (tx: unknown) => Promise<unknown>) => {
        insideTransaction = true;
        try { return await work(mockDb); } finally { insideTransaction = false; }
      });
      mockDbInsert.mockImplementation(() => ({
        values: jest.fn(() => { insertedInside.push(insideTransaction); return Promise.resolve({}); }),
      }));

      await expect(
        service.splitBatch('batch-gest', { animal_ids: ['a-1'], transfer_date: '2026-09-01' } as any, 'tenant-123'),
      ).rejects.toThrow('not live');
      // Child header and its bio-asset state: both inside the callback that threw.
      expect(insertedInside).toEqual([true, true]);
      expect(mockCreateForAuthorizedBatchStage).not.toHaveBeenCalled();
    });

    it('refuses a farm worker before creating anything', async () => {
      useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
      const load = jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);

      await expect(
        service.splitBatch('batch-gest', { animal_ids: ['a-1'], transfer_date: '2026-09-01' } as any, 'tenant-123', worker),
      ).rejects.toThrow(new ForbiddenException(WORKER_TRANSFER_REFUSAL));
      expect(load).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('creates a child batch that records the cohort it came out of', async () => {
      // The three sows that failed the scan stay behind as their own batch, so
      // they keep a stage, a schedule and a pen of their own — but the link back
      // to the cohort is what lets a report roll them together again.
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      jest.spyOn(service, 'create').mockResolvedValue({ transfer_no: 'BTR-1' } as any);
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });

      const result = await service.splitBatch(
        'batch-gest',
        { animal_ids: ['a-1', 'a-2'], transfer_date: '2026-09-01', reason: 'PREGNANCY_FAILED' } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      const childHeader = inserted.find((v) => v.parent_batch_id);
      expect(childHeader.parent_batch_id).toBe('batch-gest');
      expect(childHeader.current_stage_code).toBe('DRY_SOW_GESTATION');
      expect(childHeader.opening_quantity).toBe('2.0000');
      expect(childHeader.breed_id).toBe('breed-1');
      expect(result.child.batch_no).toBeDefined();
    });

    it('delegates the animal movement to a PARTIAL transfer rather than repeating it', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      const create = jest.spyOn(service, 'create').mockResolvedValue({ transfer_no: 'BTR-1' } as any);
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.splitBatch(
        'batch-gest',
        { animal_ids: ['a-1', 'a-2'], transfer_date: '2026-09-01' } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      const [dto, , fromBatchId] = create.mock.calls[0];
      expect(fromBatchId).toBe('batch-gest');
      expect(dto.transfer_type).toBe('PARTIAL');
      expect(dto.animal_ids).toEqual(['a-1', 'a-2']);
    });

    it('refuses an empty selection', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      await expect(
        service.splitBatch('batch-gest', { animal_ids: [], transfer_date: '2026-09-01' } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses an explicit child location outside the parent company, LOB, or farm before inserting the child', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      mockDbSelect.mockReturnValueOnce(chain([], (cond) => { capturedWhere = cond; }));

      await expect(service.splitBatch(
        'batch-gest',
        { animal_ids: ['a-1'], transfer_date: '2026-09-01', to_location_id: 'other-farm-pen' } as any,
        'tenant-123',
        operationalAdmin,
      )).rejects.toThrow(new ForbiddenException('Destination location is not on your active farm.'));

      const { sql: text, params } = dialect.sqlToQuery(capturedWhere as any);
      expect(text).toContain('`location_master`.`tenant_id` = ?');
      expect(text).toContain('`location_master`.`company_id` = ?');
      expect(text).toContain('`location_master`.`lob_id` = ?');
      expect(text).toContain('`location_master`.`is_active` = ?');
      expect(text).toContain('`location_master`.`deleted_at` is null');
      expect(params).toEqual(expect.arrayContaining(['tenant-123', 'comp-1', 'lob-1', 'farm-g']));
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('keeps split placement coherent and refuses a different same-farm location', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      mockDbSelect.mockReturnValueOnce(chain([{ location_id: 'other-pen' }]));

      await expect(service.splitBatch(
        'batch-gest',
        { animal_ids: ['a-1'], transfer_date: '2026-09-01', to_location_id: 'other-pen' } as any,
        'tenant-123',
        operationalAdmin,
      )).rejects.toThrow(/Transfer workflow/);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('resolves the held stage to a real stage id so the animals actually move to it', async () => {
      // post() sets each moved animal's current_stage_id from the destination
      // batch's stage_id. Leaving that null meant the group's animals silently
      // kept the parent's stage while the child batch claimed another one.
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      jest.spyOn(service, 'create').mockResolvedValue({} as any);
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ stage_id: 'stage-flush' }]) }),
        }),
      });
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });

      await service.splitBatch(
        'batch-gest',
        { animal_ids: ['a-1'], transfer_date: '2026-09-01', hold_stage_code: 'FLUSH_SERVICE' } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(inserted.find((v) => v.parent_batch_id).stage_id).toBe('stage-flush');
    });

    it('can hold the split group at a different stage from the parent', async () => {
      // Sows returned to service sit at FLUSH_SERVICE while the cohort gestates.
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(parent);
      jest.spyOn(service, 'create').mockResolvedValue({} as any);
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ stage_id: 'stage-flush' }]) }),
        }),
      });
      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn((v: any) => { inserted.push(v); return Promise.resolve({}); }) });

      await service.splitBatch(
        'batch-gest',
        { animal_ids: ['a-1'], transfer_date: '2026-09-01', hold_stage_code: 'FLUSH_SERVICE' } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(inserted.find((v) => v.parent_batch_id).current_stage_code).toBe('FLUSH_SERVICE');
    });
  });

  describe('mergeBatch', () => {
    const child = {
      batch_id: 'batch-hold', batch_no: 'PIG-BAT-2026-0003', tenant_id: 'tenant-123', company_id: 'comp-1',
      parent_batch_id: 'batch-gest', status: 'ACTIVE', closing_quantity: '2.0000',
    };

    it('moves the group back to its parent and closes the child', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(child);
      const create = jest.spyOn(service, 'create').mockResolvedValue({ transfer_no: 'BTR-2' } as any);
      jest.spyOn(service as any, 'liveAnimalIds').mockResolvedValue(['a-1', 'a-2']);
      const sets: any[] = [];
      mockDbUpdate.mockReturnValue({ set: jest.fn((v: any) => { sets.push(v); return { where: jest.fn().mockResolvedValue({}) }; }) });

      const result = await service.mergeBatch('batch-hold', { transfer_date: '2026-10-01' } as any, 'tenant-123', { userId: 'u' });

      const [dto, , fromBatchId] = create.mock.calls[0];
      expect(fromBatchId).toBe('batch-hold');
      expect(dto.to_batch_id).toBe('batch-gest');
      expect(dto.animal_ids).toEqual(['a-1', 'a-2']);
      expect(sets.some((v) => v.status === 'CLOSED')).toBe(true);
      expect(result.merged).toBe(2);
    });

    it('closes the child inside the same transaction as the movement', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(child);
      jest.spyOn(service, 'create').mockResolvedValue({ transfer_no: 'BTR-2' } as any);
      jest.spyOn(service as any, 'liveAnimalIds').mockResolvedValue(['a-1']);
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      await service.mergeBatch('batch-hold', { transfer_date: '2026-10-01' } as any, 'tenant-123', companyAdmin);

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    });

    it('refuses a farm worker', async () => {
      const load = jest.spyOn(service as any, 'loadBatch').mockResolvedValue(child);
      await expect(service.mergeBatch('batch-hold', { transfer_date: '2026-10-01' } as any, 'tenant-123', worker))
        .rejects.toThrow(new ForbiddenException(WORKER_TRANSFER_REFUSAL));
      expect(load).not.toHaveBeenCalled();
    });

    it('refuses to merge a batch that was never split out of anything', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue({ ...child, parent_batch_id: null });
      await expect(
        service.mergeBatch('batch-hold', { transfer_date: '2026-10-01' } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to merge a group with no live animals left', async () => {
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(child);
      jest.spyOn(service as any, 'liveAnimalIds').mockResolvedValue([]);
      await expect(
        service.mergeBatch('batch-hold', { transfer_date: '2026-10-01' } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('lists a transfer for either farm it touches', async () => {
      useFarmScope({ farmId: 'farm-g', restricted: false, companyId: 'co-1', lobId: null });

      // findAll's own select().from().leftJoin().where().orderBy() — the where
      // argument is what we're checking, so capture it and resolve empty.
      const chain: any = {
        from: () => chain,
        leftJoin: () => chain,
        where: (cond: unknown) => { capturedWhere = cond; return chain; },
        orderBy: () => Promise.resolve([]),
      };
      mockDbSelect.mockReturnValue(chain);

      await service.findAll({} as any, 'tenant-1');

      expect(renderedWhere()).toMatch(/from_batch_id` IN \(SELECT bf\.batch_id FROM batch_header bf.*\bor\b.*to_batch_id` IN \(SELECT bf\.batch_id FROM batch_header bf/s);
    });

    it('bounds transfers by company when an operational admin selects no farm', async () => {
      useFarmScope({ farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
      const chain: any = {
        from: () => chain,
        leftJoin: () => chain,
        where: (cond: unknown) => { capturedWhere = cond; return chain; },
        orderBy: () => Promise.resolve([]),
      };
      mockDbSelect.mockReturnValue(chain);

      await service.findAll({} as any, 'tenant-1');

      expect(renderedWhere()).toContain('`batch_transfer`.`company_id` = ?');
    });
  });

  describe('findOne', () => {
    it('bounds transfer detail reads by company when an operational admin selects no farm', async () => {
      useFarmScope({ farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
      const transferChain: any = {
        from: () => transferChain,
        where: (cond: unknown) => { capturedWhere = cond; return transferChain; },
        limit: () => Promise.resolve([draftTransfer]),
      };
      const linesChain: any = {
        from: () => linesChain,
        leftJoin: () => linesChain,
        where: () => linesChain,
        orderBy: () => Promise.resolve([]),
      };
      mockDbSelect.mockReturnValueOnce(transferChain).mockReturnValueOnce(linesChain);

      await service.findOne('tr-1', 'tenant-123');

      expect(renderedWhere()).toContain('`batch_transfer`.`company_id` = ?');
    });
  });

  describe('post', () => {
    const lockedBatches = { source: kintyreSource, destination: kintyreDestination };

    const stillLiveSelect = () => mockDbSelect.mockReturnValueOnce(chain([{ animal_id: 'a-1' }, { animal_id: 'a-2' }]));

    it('moves the transferred animals onto the destination batch stage', async () => {
      jest.spyOn(service as any, 'loadTransferForMutation').mockResolvedValue(draftTransfer);
      jest.spyOn(service as any, 'lockTransferBatches').mockResolvedValue(lockedBatches);
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...draftTransfer, status: 'POSTED' } as any);
      // Isolate the value/ledger side effects — this test is about the animals.
      jest.spyOn(service as any, 'shiftBioAssetState').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'shiftClosingQuantity').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'writeLedgerLegs').mockResolvedValue(undefined);
      stillLiveSelect();
      updatesByTable();

      await service.post('tr-1', 'tenant-123', { userId: 'user-1' });

      const animalCall = updatedTables().indexOf(schema.animalRegister);
      expect(animalCall).toBeGreaterThanOrEqual(0);
      const animalSet = (mockDbUpdate.mock.results[animalCall].value.set as jest.Mock).mock.calls[0][0];
      expect(animalSet.current_batch_id).toBe('batch-farrow');
      expect(animalSet.current_stage_id).toBe('stage-farrowing');
    });

    it('uses the pre-authorized destination scheduler path inside the posting transaction', async () => {
      jest.spyOn(service as any, 'loadTransferForMutation').mockResolvedValue(draftTransfer);
      jest.spyOn(service as any, 'lockTransferBatches').mockResolvedValue(lockedBatches);
      jest.spyOn(service, 'findOne').mockResolvedValue(draftTransfer as any);
      jest.spyOn(service as any, 'shiftBioAssetState').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'shiftClosingQuantity').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'writeLedgerLegs').mockResolvedValue(undefined);
      stillLiveSelect();
      updatesByTable();

      await service.post('tr-1', 'tenant-123', { userId: 'user-1' }, true);

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockCreateForAuthorizedBatchStage).toHaveBeenCalledWith(
        expect.objectContaining({ batch_id: 'batch-farrow', company_id: 'comp-1' }),
        'stage-farrowing',
        'tenant-123',
        { userId: 'user-1' },
      );
    });

    it('does not continue posting when destination scheduler generation fails', async () => {
      jest.spyOn(service as any, 'loadTransferForMutation').mockResolvedValue(draftTransfer);
      jest.spyOn(service as any, 'lockTransferBatches').mockResolvedValue(lockedBatches);
      const shiftState = jest.spyOn(service as any, 'shiftBioAssetState').mockResolvedValue(undefined);
      mockCreateForAuthorizedBatchStage.mockRejectedValue(new Error('scheduler failed'));
      stillLiveSelect();
      updatesByTable();

      await expect(service.post('tr-1', 'tenant-123', undefined, true)).rejects.toThrow('scheduler failed');

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(shiftState).not.toHaveBeenCalled();
    });

    // C1: post() used to authorize by reaching the row through findOne(), whose
    // farm condition is "from OR to", so a Grasmere worker could post a
    // Kintyre -> Grasmere draft and debit Kintyre's batch.
    it('loads the transfer it posts by its source batch farm only, locked', async () => {
      useFarmScope(kintyreScope);
      mockDbSelect.mockReturnValueOnce(chain([], (cond) => { capturedWhere = cond; }));

      await expect(service.post('tr-1', 'tenant-123', operationalAdmin)).rejects.toThrow(new NotFoundException('Transfer not found.'));

      expect(renderedWhere()).toMatch(/from_batch_id` IN \(SELECT bf\.batch_id FROM batch_header bf WHERE bf\.farm_id = \?\)/);
      expect(renderedWhere()).not.toContain('to_batch_id');
      expect(renderedWhere()).toContain('`batch_transfer`.`company_id` = ?');
      expect(forCalls).toEqual(['update']);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    // I2: two posts both read DRAFT from a snapshot and both moved value. The
    // second now waits on the row lock and reads what the first committed.
    it('refuses a transfer whose status changed while it waited for the lock, writing nothing', async () => {
      mockDbSelect
        .mockReturnValueOnce(chain([{ ...draftTransfer, lines: undefined, status: 'POSTED' }]))
        .mockReturnValueOnce(chain(draftTransfer.lines));
      updatesByTable();

      await expect(service.post('tr-1', 'tenant-123', companyAdmin))
        .rejects.toThrow(new BadRequestException('Only a DRAFT transfer can be posted (this one is POSTED).'));

      expect(forCalls[0]).toBe('update');
      expect(mockDbUpdate).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('stops before any movement when the conditional DRAFT -> POSTED claim loses', async () => {
      jest.spyOn(service as any, 'loadTransferForMutation').mockResolvedValue(draftTransfer);
      jest.spyOn(service as any, 'lockTransferBatches').mockResolvedValue(lockedBatches);
      const shiftState = jest.spyOn(service as any, 'shiftBioAssetState').mockResolvedValue(undefined);
      const ledger = jest.spyOn(service as any, 'writeLedgerLegs').mockResolvedValue(undefined);
      stillLiveSelect();
      updatesByTable(0);

      await expect(service.post('tr-1', 'tenant-123', companyAdmin)).rejects.toThrow(ConflictException);

      expect(updatedTables()).toEqual([schema.batchTransfer]);
      expect(shiftState).not.toHaveBeenCalled();
      expect(ledger).not.toHaveBeenCalled();
    });

    it('atomically refuses a second draft when its animal is no longer claimable from the source batch', async () => {
      const oneAnimalTransfer = { ...draftTransfer, lines: [draftTransfer.lines[0]] };
      jest.spyOn(service as any, 'loadTransferForMutation').mockResolvedValue(oneAnimalTransfer);
      jest.spyOn(service as any, 'lockTransferBatches').mockResolvedValue(lockedBatches);
      const shiftState = jest.spyOn(service as any, 'shiftBioAssetState').mockResolvedValue(undefined);
      const ledger = jest.spyOn(service as any, 'writeLedgerLegs').mockResolvedValue(undefined);
      mockDbSelect.mockReturnValueOnce(chain([{ animal_id: 'a-1' }]));
      let animalClaimWhere: unknown;
      mockDbUpdate.mockImplementation((table: unknown) => ({
        set: jest.fn().mockReturnValue({
          where: jest.fn((cond: unknown) => {
            if (table === schema.animalRegister) {
              animalClaimWhere = cond;
              return Promise.resolve([{ affectedRows: 0 }]);
            }
            return Promise.resolve([{ affectedRows: 1 }]);
          }),
        }),
      }));

      await expect(service.post('tr-1', 'tenant-123', companyAdmin))
        .rejects.toThrow(new ConflictException(
          'One or more animals were moved or became unavailable while this transfer was posting. Re-create the transfer.',
        ));

      const claim = dialect.sqlToQuery(animalClaimWhere as any);
      expect(claim.sql).toContain('`animal_register`.`current_batch_id` = ?');
      expect(claim.sql).toContain('`animal_register`.`tenant_id` = ?');
      expect(claim.params).toEqual(expect.arrayContaining(['batch-gest', 'tenant-123']));
      expect(shiftState).not.toHaveBeenCalled();
      expect(ledger).not.toHaveBeenCalled();
      expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('rejects the transaction instead of silently posting without an accounting item', async () => {
      jest.spyOn(service as any, 'loadTransferForMutation').mockResolvedValue(draftTransfer);
      jest.spyOn(service as any, 'lockTransferBatches').mockResolvedValue(lockedBatches);
      jest.spyOn(service as any, 'shiftBioAssetState').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'shiftClosingQuantity').mockResolvedValue(undefined);
      mockDbSelect
        .mockReturnValueOnce(chain([{ animal_id: 'a-1' }, { animal_id: 'a-2' }]))
        .mockReturnValueOnce(chain([]))
        .mockReturnValueOnce(chain([]));
      updatesByTable();

      await expect(service.post('tr-1', 'tenant-123', companyAdmin))
        .rejects.toThrow(new BadRequestException(
          'Transfer accounting item is missing from the source batch and animal. Configure it before posting.',
        ));

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalledWith(schema.bioAssetLedger);
      expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('rejects the transaction when both required accounting ledger legs are not inserted', async () => {
      const oneAnimalTransfer = { ...draftTransfer, lines: [draftTransfer.lines[0]] };
      jest.spyOn(service as any, 'loadTransferForMutation').mockResolvedValue(oneAnimalTransfer);
      jest.spyOn(service as any, 'lockTransferBatches').mockResolvedValue(lockedBatches);
      jest.spyOn(service as any, 'shiftBioAssetState').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'shiftClosingQuantity').mockResolvedValue(undefined);
      mockDbSelect
        .mockReturnValueOnce(chain([{ animal_id: 'a-1' }]))
        .mockReturnValueOnce(chain([{ item_id: 'bio-item-1' }]));
      updatesByTable(1, 1);
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
      });

      await expect(service.post('tr-1', 'tenant-123', companyAdmin))
        .rejects.toThrow(new ConflictException(
          'Transfer accounting ledger legs could not all be posted. No transfer was applied.',
        ));

      expect(mockDb.transaction).toHaveBeenCalled();
      expect(mockDbInsert).toHaveBeenCalledWith(schema.bioAssetLedger);
      expect(mockAuditLog).not.toHaveBeenCalled();
    });

    it('locks both batch rows, the source under the caller farm scope', async () => {
      useFarmScope(kintyreScope);
      const wheres: unknown[] = [];
      mockDbSelect
        .mockReturnValueOnce(chain([kintyreSource], (cond) => wheres.push(cond)))
        .mockReturnValueOnce(chain([kintyreDestination], (cond) => wheres.push(cond)));

      const locked = await (service as any).lockTransferBatches(
        { from_batch_id: 'batch-farrow-0', to_batch_id: 'batch-gest-9', company_id: 'comp-1' }, 'tenant-123',
      );

      // from < to, so the source is locked first.
      expect(forCalls).toEqual(['update', 'update']);
      expect(dialect.sqlToQuery(wheres[0] as any).sql).toContain('`batch_header`.`farm_id` = ?');
      expect(locked.destination.batch_id).toBe('batch-farrow');
    });

    it('refuses a farm worker before reading the transfer', async () => {
      useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
      await expect(service.post('tr-1', 'tenant-123', worker)).rejects.toThrow(new ForbiddenException(WORKER_TRANSFER_REFUSAL));
      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it('refuses an operational admin posting a farm-to-farm draft', async () => {
      useFarmScope(kintyreScope);
      jest.spyOn(service as any, 'loadTransferForMutation').mockResolvedValue(draftTransfer);
      jest.spyOn(service as any, 'lockTransferBatches').mockResolvedValue({ source: kintyreSource, destination: grasmereDestination });
      updatesByTable();

      await expect(service.post('tr-1', 'tenant-123', operationalAdmin))
        .rejects.toThrow(new ForbiddenException(FARM_TO_FARM_TRANSFER_REFUSAL));
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('refuses a company admin until destination Breed-profile matching is implemented', async () => {
      jest.spyOn(service as any, 'loadTransferForMutation').mockResolvedValue(draftTransfer);
      jest.spyOn(service as any, 'lockTransferBatches').mockResolvedValue({ source: kintyreSource, destination: grasmereDestination });
      updatesByTable();

      await expect(service.post('tr-1', 'tenant-123', companyAdmin))
        .rejects.toThrow(new ForbiddenException(FARM_TO_FARM_TRANSFER_REFUSAL));
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('loads the transfer it cancels by its source batch farm only, locked', async () => {
      useFarmScope(kintyreScope);
      mockDbSelect.mockReturnValueOnce(chain([], (cond) => { capturedWhere = cond; }));

      await expect(service.cancel('tr-1', 'tenant-123', operationalAdmin)).rejects.toThrow(new NotFoundException('Transfer not found.'));

      expect(renderedWhere()).toMatch(/from_batch_id` IN \(SELECT bf\.batch_id FROM batch_header bf WHERE bf\.farm_id = \?\)/);
      expect(renderedWhere()).not.toContain('to_batch_id');
      expect(forCalls).toEqual(['update']);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const dto = { company_id: 'comp-1', to_batch_id: 'batch-farrow', transfer_date: '2026-09-01', transfer_type: 'FULL_BATCH' } as any;

    /** Stands in for everything after authorization, so "allowed" means "got past every check". */
    const stopAtAnimalSelection = () =>
      jest.spyOn(service as any, 'listTransferableAnimalsFromAuthorizedBatch').mockRejectedValue(new Error('reached animal selection'));

    it('refuses a farm worker with the interim approval message, before reading any batch', async () => {
      useFarmScope({ farmId: 'farm-k', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
      await expect(service.create(dto, 'tenant-123', 'batch-gest', worker))
        .rejects.toThrow(new ForbiddenException(WORKER_TRANSFER_REFUSAL));
      expect(mockDbSelect).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses an operational admin moving animals to another farm', async () => {
      useFarmScope({ ...kintyreScope, farmId: null });
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(kintyreSource);
      mockDbSelect.mockReturnValueOnce(chain([grasmereDestination]));
      const selection = stopAtAnimalSelection();

      await expect(service.create(dto, 'tenant-123', 'batch-gest', operationalAdmin))
        .rejects.toThrow(new ForbiddenException(FARM_TO_FARM_TRANSFER_REFUSAL));
      expect(selection).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('lets an operational admin move animals within one farm', async () => {
      useFarmScope(kintyreScope);
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(kintyreSource);
      mockDbSelect.mockReturnValueOnce(chain([kintyreDestination]));
      stopAtAnimalSelection();

      await expect(service.create(dto, 'tenant-123', 'batch-gest', operationalAdmin)).rejects.toThrow('reached animal selection');
    });

    it('refuses a company admin creating a cross-farm draft until Breed-profile matching exists', async () => {
      useFarmScope({ farmId: null, restricted: false, companyId: 'comp-1', lobId: null });
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(kintyreSource);
      mockDbSelect.mockReturnValueOnce(chain([grasmereDestination]));
      const selection = stopAtAnimalSelection();

      await expect(service.create(dto, 'tenant-123', 'batch-gest', companyAdmin))
        .rejects.toThrow(new ForbiddenException(FARM_TO_FARM_TRANSFER_REFUSAL));
      expect(selection).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('answers a destination in another company exactly like a missing one', async () => {
      // The batch exists, in comp-2. A query that bounds the destination by the
      // source's company finds nothing; one that does not returns the row.
      useFarmScope({ farmId: null, restricted: false, companyId: 'comp-1', lobId: null });
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(kintyreSource);
      const otherCompanyBatch = batchRow({ batch_id: 'batch-other', company_id: 'comp-2', farm_id: 'farm-z' });
      mockDbSelect.mockImplementation(() => {
        let bounded = false;
        const query: any = chain([], (cond) => {
          const { sql: text, params } = dialect.sqlToQuery(cond as any);
          bounded = text.includes('`batch_header`.`company_id` = ?') && params.includes('comp-1');
        });
        query.then = (ok: any, err: any) => Promise.resolve(bounded ? [] : [otherCompanyBatch]).then(ok, err);
        return query;
      });

      await expect(service.create({ ...dto, to_batch_id: 'batch-other' }, 'tenant-123', 'batch-gest', companyAdmin))
        .rejects.toThrow(new NotFoundException('Destination batch not found.'));
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('passes auto_triggers_stage to post() only as a service option', async () => {
      useFarmScope({ farmId: null, restricted: false, companyId: 'comp-1', lobId: null });
      jest.spyOn(service as any, 'loadBatch').mockResolvedValue(kintyreSource);
      mockDbSelect.mockReturnValueOnce(chain([kintyreDestination]));
      jest.spyOn(service as any, 'listTransferableAnimalsFromAuthorizedBatch').mockResolvedValue([
        { animal_id: 'a-1', current_location_id: 'pen-1', book_value: '100' },
      ]);
      mockDbSelect.mockReturnValueOnce(chain([])); // source bio-asset state
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
      const post = jest.spyOn(service, 'post').mockResolvedValue({} as any);

      await service.create({ ...dto, auto_triggers_stage: true }, 'tenant-123', 'batch-gest', companyAdmin);
      expect(post).toHaveBeenLastCalledWith(expect.any(String), 'tenant-123', companyAdmin, undefined);

      mockDbSelect.mockReturnValueOnce(chain([kintyreDestination])).mockReturnValueOnce(chain([]));
      await service.create(dto, 'tenant-123', 'batch-gest', companyAdmin, { autoTriggersStage: true });
      expect(post).toHaveBeenLastCalledWith(expect.any(String), 'tenant-123', companyAdmin, true);
    });
  });

  describe('CreateBatchTransferDto', () => {
    // main.ts runs the global pipe with forbidNonWhitelisted. auto_triggers_stage
    // makes post() generate the destination's scheduler unscoped, so it must be
    // a 400 from the HTTP body rather than a documented "internal" field.
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    });
    const meta = { type: 'body' as const, metatype: CreateBatchTransferDto };
    const body = {
      company_id: '3f0e8c52-1b7a-4c1e-9d3a-2a6f0b9c1d11',
      to_batch_id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
      transfer_date: '2026-09-01',
    };

    it('rejects auto_triggers_stage', async () => {
      await expect(pipe.transform({ ...body, auto_triggers_stage: true }, meta)).rejects.toThrow();
    });

    it('still accepts a transfer without it', async () => {
      await expect(pipe.transform(body, meta)).resolves.toBeDefined();
    });
  });

  describe('listTransferableAnimals', () => {
    it('authorizes the requested batch before returning its animal details', async () => {
      const load = jest.spyOn(service as any, 'loadBatch').mockRejectedValue(new Error('out of scope'));

      await expect(service.listTransferableAnimals('other-farm-batch', 'tenant-123')).rejects.toThrow('out of scope');

      expect(load).toHaveBeenCalledWith('other-farm-batch', 'tenant-123', 'Source');
      expect(mockDbSelect).not.toHaveBeenCalled();
    });
  });
});
