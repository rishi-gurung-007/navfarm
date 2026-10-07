import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { GoodsReceiptService } from './goods-receipt.service';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { FeedAlertService } from '../feed-alert/feed-alert.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { BadRequestException } from '@nestjs/common';
import * as schema from '../../../core/database/schema';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateGoodsReceiptDto } from './dto/goods-receipt.dto';

describe('GoodsReceiptService', () => {
  let service: GoodsReceiptService;

  const mockDbSelect = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbDelete = jest.fn();
  // Declared up front (not left to transaction-cls's own default) so tests
  // can assert on it directly — see the I4 "wraps ... in one transaction" spec.
  let mockDb: Record<string, jest.Mock>;
  const mockDbTransaction: jest.Mock = jest.fn((work: (tx: any) => Promise<any>) => work(mockDb));

  mockDb = {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
    delete: mockDbDelete,
    transaction: mockDbTransaction,
  };

  const draftReceipt = {
    receipt_id: 'gr-1',
    company_id: 'comp-1',
    warehouse_id: 'wh-1',
    status: 'DRAFT',
    lines: [{ line_id: 'line-1', item_id: 'item-1', quantity: '10', uom: 'KG' }],
  };

  const found = (row: any) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([row]) }) }) });

  // post() re-reads the warehouse before anything else, so a warehouse taken
  // out of service after the receipt was drafted cannot receive stock. Every
  // post test queues this first.
  const activeWarehouse = () => found({ is_active: true, deleted_at: null });
  // post() re-reads the warehouse a second time for the silo item check —
  // a STORE short-circuits assertSiloDestination immediately, matching every
  // existing post test's non-silo warehouse.
  const nonSiloWarehouse = () => found({ location_id: 'wh-1', location_type: 'STORE' });
  // The other branch of the same re-read: a SILO destination routes through
  // SiloFeedService instead of short-circuiting.
  const siloWarehouse = () => found({ location_id: 'wh-1', location_type: 'SILO', location_name: 'Feed Silo 01' });
  const mockAssertCanReceive = jest.fn();
  const mockWritePositiveEntry = jest.fn();

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
    mockAssertCanReceive.mockReset().mockResolvedValue(undefined);
    mockWritePositiveEntry.mockReset().mockResolvedValue({ entry_no: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoodsReceiptService,
        { provide: ClsService, useValue: transactionCls(mockDb) },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: InventoryLedgerService, useValue: { writePositiveEntry: mockWritePositiveEntry } },
        { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}) } },
        { provide: SiloFeedService, useValue: { assertCanReceive: mockAssertCanReceive } },
        { provide: NumberSeriesService, useValue: { generateNextNumberById: jest.fn().mockResolvedValue({ next_number: 'TEST-001' }) } },
      ],
    }).compile();

    service = module.get<GoodsReceiptService>(GoodsReceiptService);
  });

  describe('post', () => {
    it('rejects posting when the ANIMAL_SUPPLIER vendor has no health_cert_url on file', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-1' } as any);
      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(found({ supplier_id: 'sup-1', vendor_type: 'ANIMAL_SUPPLIER', health_cert_url: null, supplier_name: 'Animal Farm Co' }));

      await expect(service.post('gr-1', 'tenant-123')).rejects.toThrow(BadRequestException);
    });

    it('allows posting when the ANIMAL_SUPPLIER vendor has a health_cert_url on file', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-1' } as any) // initial load
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-1', status: 'POSTED' } as any); // final return

      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(found({ supplier_id: 'sup-1', vendor_type: 'ANIMAL_SUPPLIER', health_cert_url: 'https://certs.example.com/farm.pdf' }));
      mockDbSelect.mockReturnValueOnce(nonSiloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-1', 'tenant-123', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
    });

    it('allows posting for a non-ANIMAL_SUPPLIER vendor regardless of health_cert_url', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-2' } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-2', status: 'POSTED' } as any);

      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(found({ supplier_id: 'sup-2', vendor_type: 'FEED_SUPPLIER', health_cert_url: null }));
      mockDbSelect.mockReturnValueOnce(nonSiloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-2', 'tenant-123', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
    });

    it('allows posting when the receipt has no supplier_id at all', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null, status: 'POSTED' } as any);

      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(nonSiloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-3', 'tenant-123', { userId: 'user-1' });

      expect(mockDbSelect).toHaveBeenCalledTimes(2); // warehouse-active + silo-destination reads — no supplier lookup needed
      expect(result.status).toBe('POSTED');
    });

    // The other branch of assertSiloDestination: a SILO warehouse routes
    // through SiloFeedService with the receipt's own item ids, instead of
    // short-circuiting like every test above (all of which use a STORE).
    it('routes a SILO destination through SiloFeedService.assertCanReceive before posting', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null, status: 'POSTED' } as any);

      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(siloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-3', 'tenant-123', { userId: 'user-1' });

      expect(mockAssertCanReceive).toHaveBeenCalledWith(
        expect.objectContaining({
          siloId: 'wh-1',
          companyId: 'comp-1',
          itemIds: ['item-1'],
          documentLabel: 'GRN',
        }),
      );
      expect(result.status).toBe('POSTED');
    });

    it('aborts the post before the DRAFT -> POSTED claim when SiloFeedService refuses the item', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...draftReceipt, supplier_id: null } as any);

      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(siloWarehouse());
      mockAssertCanReceive.mockRejectedValue(new BadRequestException(
        "Cannot post this GRN — silo 'Feed Silo 01' already holds 'FEED-GROWER'. A silo holds one feed item at a time; empty it before moving a different item in.",
      ));

      await expect(service.post('gr-3', 'tenant-123', { userId: 'user-1' })).rejects.toThrow(/already holds 'FEED-GROWER'/);

      // Refused before the status transition and before any stock movement.
      expect(mockDbUpdate).not.toHaveBeenCalled();
      expect(mockWritePositiveEntry).not.toHaveBeenCalled();
    });
  });

  // Phase 1 access foundation, Task 7: goods receipts belong to the farm
  // holding their warehouse (common/farm-scope.ts locationOnFarm). Modelled
  // on breeding.service.spec.ts / batch-daily-data.service.spec.ts's
  // table-keyed db mock — it answers by table, not by call order, and
  // captures the last `.where()` condition so a test can render the SQL and
  // check the farm join made it in. Local to this describe because the outer
  // suite's mock answers by call order instead.
  // Ruling M6: a posting re-checks silo levels once, only after its
  // transaction has committed, and nothing that goes wrong in that re-check
  // can fail the posting it follows.
  describe('feed alert hook', () => {
    const postedReceipt = () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null, status: 'POSTED' } as any);
      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(nonSiloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });
    };

    const build = async (feedAlerts: unknown, cls: ClsService) => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GoodsReceiptService,
          { provide: ClsService, useValue: cls },
          { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
          { provide: InventoryLedgerService, useValue: { writePositiveEntry: mockWritePositiveEntry } },
          { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}) } },
          { provide: SiloFeedService, useValue: { assertCanReceive: mockAssertCanReceive } },
          { provide: NumberSeriesService, useValue: { generateNextNumberById: jest.fn().mockResolvedValue({ next_number: 'TEST-001' }) } },
          { provide: FeedAlertService, useValue: feedAlerts },
        ],
      }).compile();
      service = module.get<GoodsReceiptService>(GoodsReceiptService);
    };

    it('re-checks the receipt location once, after the transaction has committed', async () => {
      const cls = transactionCls(mockDb);
      let committed = false;
      mockDbTransaction.mockImplementationOnce(async (work: (tx: any) => Promise<any>) => {
        const result = await work(mockDb);
        committed = true;
        return result;
      });
      const seen: Array<{ committed: boolean; inTx: unknown }> = [];
      const feedAlerts = { evaluateLevelsSafely: jest.fn(async () => { seen.push({ committed, inTx: cls.get('tenantPostingTransaction') }); }) };
      await build(feedAlerts, cls);
      postedReceipt();

      const result = await service.post('gr-3', 'tenant-123', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
      expect(feedAlerts.evaluateLevelsSafely).toHaveBeenCalledTimes(1);
      expect(feedAlerts.evaluateLevelsSafely).toHaveBeenCalledWith(['wh-1'], 'tenant-123');
      expect(seen).toEqual([{ committed: true, inTx: undefined }]);
    });

    it('still posts when the re-check itself throws', async () => {
      const cls = transactionCls(mockDb);
      const alertRules = { ensureDefaultRules: jest.fn().mockRejectedValue(new Error('alert_rule is locked')) };
      const feedAlerts = new FeedAlertService(cls, {} as any, {} as any, alertRules as any);
      const warn = jest.spyOn((feedAlerts as any).logger, 'warn').mockImplementation(() => undefined);
      await build(feedAlerts, cls);
      postedReceipt();
      // The hook's own read of the receipt warehouse: a silo on farm-1, so it goes on to evaluate that farm.
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ location_id: 'wh-1', location_type: 'SILO', farm_id: 'farm-1', company_id: 'comp-1' }]),
        }),
      });

      const result = await service.post('gr-3', 'tenant-123', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
      expect(alertRules.ensureDefaultRules).toHaveBeenCalledWith('comp-1', 'tenant-123');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('alert_rule is locked'));
    });
  });

  describe('farm scope', () => {
    const grasmere = { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };

    let cls: ReturnType<typeof transactionCls>;
    const rows = new Map<unknown, unknown[]>();
    let capturedWhere: unknown;

    /** Awaitable at any point, so .where(), .limit() and .offset() all resolve. */
    const chain = (result: unknown[]) => {
      const self: any = {
        from: () => self,
        where: (cond: unknown) => { capturedWhere ??= cond; return self; },
        limit: () => self,
        offset: () => self,
        for: () => self,
        then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
      };
      return self;
    };

    const renderedWhere = () => new MySqlDialect().sqlToQuery(capturedWhere as any).sql;

    const validReceiptDto = {
      company_id: 'co-1',
      warehouse_id: 'wh-1',
      posting_date: '2026-01-01',
      lines: [{ item_id: 'item-1', quantity: 10, uom: 'KG' }],
    };

    beforeEach(async () => {
      rows.clear();
      capturedWhere = undefined;
      rows.set(schema.goodsReceipt, []);
      rows.set(schema.goodsReceiptLine, []);
      rows.set(schema.locationMaster, []);

      mockDbSelect.mockReset();
      mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? []) }));

      cls = transactionCls(mockDb);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GoodsReceiptService,
          { provide: ClsService, useValue: cls },
          { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
          { provide: InventoryLedgerService, useValue: { writePositiveEntry: jest.fn().mockResolvedValue({ entry_no: 1 }) } },
          { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}) } },
          { provide: SiloFeedService, useValue: { assertCanReceive: jest.fn().mockResolvedValue(undefined) } },
          { provide: NumberSeriesService, useValue: { generateNextNumberById: jest.fn().mockResolvedValue({ next_number: 'TEST-001' }) } },
        ],
      }).compile();

      service = module.get<GoodsReceiptService>(GoodsReceiptService);
    });

    it('lists only receipts into locations on the active farm', async () => {
      useFarmScope(cls, grasmere);
      await service.findAll({} as any, 'tenant-1');
      expect(renderedWhere()).toContain('location_master lf');
    });

    it('puts the active-farm condition on receipt detail reads', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.goodsReceipt, [{ receipt_id: 'grn-1' }]);
      await service.findOne('grn-1');
      expect(renderedWhere()).toContain('location_master lf');
    });

    it('bounds receipts by company when an operational admin selects no farm', async () => {
      useFarmScope(cls, { ...grasmere, farmId: null });
      await service.findAll({} as any, 'tenant-1');
      expect(renderedWhere()).toContain('`goods_receipt`.`company_id` = ?');
    });

    it('refuses a receipt into a location on another farm', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.locationMaster, [{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig' }]);
      await expect(service.create({ ...validReceiptDto, warehouse_id: 'store-k' } as any, 'tenant-1'))
        .rejects.toThrow('Location is not on your active farm.');
    });

    // Item 2: an inactive/soft-deleted warehouse must not accept new stock.
    // assertLocationOnActiveFarm only checks the warehouse is on the right
    // farm/company/LOB, so these rows are on-farm (pass that check) but
    // is_active: false — before the fix, create/update/post never looked at
    // is_active at all and would have proceeded.
    it('refuses to create a receipt into an inactive location', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.locationMaster, [
        { location_id: 'wh-1', parent: 'farm-g', farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig', is_active: false, deleted_at: null },
      ]);
      await expect(service.create({ ...validReceiptDto, warehouse_id: 'wh-1' } as any, 'tenant-1'))
        .rejects.toThrow('The selected location is inactive.');
    });

    it('refuses to move a draft receipt into an inactive location on update', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.goodsReceipt, [{ receipt_id: 'gr-1', status: 'DRAFT', company_id: 'co-1', warehouse_id: 'wh-1' }]);
      rows.set(schema.locationMaster, [
        { location_id: 'wh-2', parent: 'farm-g', farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig', is_active: false, deleted_at: null },
      ]);
      await expect(service.update('gr-1', { warehouse_id: 'wh-2' } as any, 'tenant-1'))
        .rejects.toThrow('The selected location is inactive.');
    });

    it('refuses to post a draft receipt whose location was deactivated after the draft was created', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.goodsReceipt, [{ receipt_id: 'gr-1', status: 'DRAFT', company_id: 'co-1', warehouse_id: 'wh-1' }]);
      rows.set(schema.locationMaster, [{ location_id: 'wh-1', is_active: false, deleted_at: null }]);
      await expect(service.post('gr-1', 'tenant-1')).rejects.toThrow('The selected location is inactive.');
    });
  });

  // C1: main.ts's global ValidationPipe runs whitelist + forbidNonWhitelisted,
  // so any property UpdateGoodsReceiptDto does not declare 400s the request
  // instead of being silently dropped. A unit test that calls service.update()
  // directly (as the tests above do) never goes through that pipe, so it
  // cannot see this — hence exercising the DTO itself the same way Nest does.
  describe('UpdateGoodsReceiptDto whitelist (regression for the edit-panel PUT 400)', () => {
    it('rejects a payload carrying company_id, the property the edit panel used to send', async () => {
      const instance = plainToInstance(UpdateGoodsReceiptDto, {
        company_id: 'co-1',
        warehouse_id: 'wh-1',
        posting_date: '2026-09-01',
        lines: [],
      });
      const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.some((e) => e.property === 'company_id')).toBe(true);
    });

    it('accepts the same payload once company_id is dropped, as the fixed edit panel now sends', async () => {
      // The warehouse and item ids must themselves satisfy the DTO's UUID
      // constraints, which the warehouse-integrity work tightened.
      const instance = plainToInstance(UpdateGoodsReceiptDto, {
        warehouse_id: '55555555-5555-4555-8555-555555555555',
        posting_date: '2026-09-01',
        supplier_id: undefined,
        external_reference_no: undefined,
        remarks: undefined,
        lines: [{ item_id: '11111111-1111-4111-8111-111111111111', quantity: 10, uom: 'KG' }],
      });
      const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors).toHaveLength(0);
    });
  });

  describe('serial number consolidation on receipt lines', () => {
    it('creates a single line with comma-separated serial numbers when receiving serial-tracked item', async () => {
      const insertedRows: any[] = [];
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockImplementation((val) => {
          if (Array.isArray(val)) {
            insertedRows.push(...val);
          } else {
            insertedRows.push(val);
          }
          return Promise.resolve([{ insertId: 1 }]);
        }),
      });

      // Item lookup returning serial-tracked item
      mockDbSelect.mockReturnValueOnce(found({
        item_id: 'item-ser-1',
        is_serial_tracked: true,
        is_lot_tracked: false,
      }));
      // Check existing serials returning none
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await (service as any).insertLines(
        'receipt-1',
        [
          {
            item_id: 'item-ser-1',
            quantity: 3,
            uom: 'PCS',
            serial_no: 'SN001, SN002, SN003',
          },
        ],
        'tenant-1',
        'comp-1',
      );

      // Verify that exactly 1 line was inserted with quantity 3 and comma-separated serials
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0].quantity).toBe('3');
      expect(insertedRows[0].serial_no).toBe('SN001, SN002, SN003');
    });
  });
});

