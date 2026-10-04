import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { StockTransferService } from './stock-transfer.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { UomService } from '../../master-data/uom/uom.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { FeedAlertService } from '../feed-alert/feed-alert.service';
import * as schema from '../../../core/database/schema';

/**
 * Phase 1 access foundation, Task 7: stock transfers are visible to the farm
 * holding either the source or destination warehouse (common/farm-scope.ts
 * locationOnFarm, joined with OR — see stock-transfer.service.ts's findOne
 * and findAll). Changing one (update, remove, post) is the source farm's call
 * only: loadForMutation puts the farm predicate on from_warehouse_id alone.
 * The source must be on the active farm; the destination may sit on another
 * farm but must remain in the caller's company and LOB.
 * Modelled on breeding.service.spec.ts / batch-daily-data.service.spec.ts's
 * table-keyed db mock — it answers by table, not by call order, and captures
 * the last `.where()` condition so a test can render the SQL and check the
 * farm join made it in.
 */
describe('StockTransferService', () => {
  let service: StockTransferService;
  let cls: ReturnType<typeof transactionCls>;

  const rows = new Map<unknown, unknown[]>();
  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDb = { select: mockDbSelect, insert: mockDbInsert, update: mockDbUpdate };

  let capturedWhere: unknown;

  const mockGetStockBalance = jest.fn();
  const mockResolveConversionFactor = jest.fn();
  // Item rules (one item, different item, D9) now live in SiloFeedService —
  // its own spec (silo-feed.service.spec.ts) proves those rules; here it is
  // a collaborator whose call StockTransferService is responsible for
  // making, with the right arguments, before its own capacity check runs.
  const mockAssertCanReceive = jest.fn();

  /** Awaitable at any point, so .where(), .limit() and .offset() all resolve. */
  const chain = (result: unknown[]) => {
    const self: any = {
      from: () => self,
      innerJoin: () => self,
      where: (cond: unknown) => { capturedWhere ??= cond; return self; },
      orderBy: () => self,
      limit: () => self,
      offset: () => self,
      for: () => self,
      then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
    };
    return self;
  };

  const renderedWhere = () => new MySqlDialect().sqlToQuery(capturedWhere as any).sql;

  // from/to must differ — create()'s own guard rejects an equal pair before
  // the farm check ever runs.
  const validTransferDto = {
    company_id: 'co-1',
    from_warehouse_id: 'wh-1',
    to_warehouse_id: 'wh-2',
    posting_date: '2026-01-01',
    lines: [{ item_id: 'item-1', quantity: 5, uom: 'KG' }],
  };

  beforeEach(async () => {
    rows.clear();
    capturedWhere = undefined;
    rows.set(schema.stockTransfer, []);
    rows.set(schema.stockTransferLine, []);
    rows.set(schema.locationMaster, []);
    // Task 10 event tables: the direct-transfer wrapper reads and writes them.
    rows.set(schema.transferShipment, []);
    rows.set(schema.transferShipmentLine, []);
    rows.set(schema.transferReceipt, []);
    rows.set(schema.transferReceiptLine, []);

    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockGetStockBalance.mockReset().mockResolvedValue([]);
    // KG in, KG out — a test that cares about the conversion overrides it.
    mockResolveConversionFactor.mockReset().mockResolvedValue(1);
    // Accepts by default; a test that cares about a refusal overrides it.
    mockAssertCanReceive.mockReset().mockResolvedValue(undefined);
    mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? []) }));
    mockDbInsert.mockImplementation((table: unknown) => ({
      values: jest.fn(async (v: any) => {
        // Event rows written by the direct-transfer path must be readable
        // inside the same call: the receipt binds to the shipment it follows,
        // and the POSTED claim recounts coverage from the event tables. The
        // `qty` alias mirrors what the cumulative joins project (qty:
        // quantity). Other inserts are ignored.
        const bucket = rows.get(table);
        if (bucket && v && typeof v === 'object' && ('shipment_id' in v || 'receipt_id' in v)) {
          bucket.push({ ...v, qty: v.quantity });
        }
      }),
    }));
    // MySqlRawQueryResult is an array ([ResultSetHeader, ...]); the DRAFT →
    // POSTED claim destructures it and reads affectedRows.
    mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

    cls = transactionCls(mockDb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockTransferService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: InventoryLedgerService, useValue: { writeTransferEntries: jest.fn().mockResolvedValue({ shipment: { ledger_id: 'led-sh' }, receipt: { ledger_id: 'led-rc' } }), transferShipmentRemainingValue: jest.fn().mockResolvedValue(0), writeTransferShipment: jest.fn().mockResolvedValue({ ledger_id: 'led-sh' }), writeTransferReceipt: jest.fn().mockResolvedValue({ ledger_id: 'led-rc' }), transferShipmentRate: jest.fn().mockResolvedValue(2.5), getStockBalance: mockGetStockBalance } },
        { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}) } },
        { provide: UomService, useValue: { resolveConversionFactor: mockResolveConversionFactor } },
        { provide: SiloFeedService, useValue: { assertCanReceive: mockAssertCanReceive } },
      ],
    }).compile();

    service = module.get<StockTransferService>(StockTransferService);
  });

  // Ruling M6: a posted transfer re-checks the silo levels of the farms at
  // both ends, once, after its transaction has committed — and nothing that
  // goes wrong in that re-check fails the posting.
  describe('feed alert hook', () => {
    let committed: boolean;
    let feedAlerts: FeedAlertService;

    beforeEach(async () => {
      committed = false;
      (mockDb as any).transaction = async (work: (tx: unknown) => Promise<unknown>) => {
        const result = await work(mockDb);
        committed = true;
        return result;
      };
      rows.set(schema.locationMaster, [
        { location_id: 'wh-1', location_type: 'STORE', farm_id: 'farm-a', company_id: 'co-1' },
        { location_id: 'wh-2', location_type: 'SILO', farm_id: 'farm-b', company_id: 'co-1' },
      ]);
      feedAlerts = new FeedAlertService(cls, {} as any, {} as any, {} as any);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StockTransferService,
          { provide: ClsService, useValue: cls },
          { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
          { provide: InventoryLedgerService, useValue: { writeTransferEntries: jest.fn().mockResolvedValue({ shipment: { ledger_id: 'led-sh' }, receipt: { ledger_id: 'led-rc' } }), transferShipmentRemainingValue: jest.fn().mockResolvedValue(0), writeTransferShipment: jest.fn().mockResolvedValue({ ledger_id: 'led-sh' }), writeTransferReceipt: jest.fn().mockResolvedValue({ ledger_id: 'led-rc' }), transferShipmentRate: jest.fn().mockResolvedValue(2.5), getStockBalance: mockGetStockBalance } },
          { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}) } },
          { provide: UomService, useValue: { resolveConversionFactor: mockResolveConversionFactor } },
          { provide: SiloFeedService, useValue: { assertCanReceive: mockAssertCanReceive } },
          { provide: FeedAlertService, useValue: feedAlerts },
        ],
      }).compile();
      service = module.get<StockTransferService>(StockTransferService);
      const draft = {
        transfer_id: 'tr-1', transfer_no: 'TR-1', company_id: 'co-1', status: 'DRAFT', posting_date: '2026-09-26',
        from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2',
        lines: [{ line_id: 'ln-1', item_id: 'item-1', quantity: '100', uom: 'KG' }],
      };
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(draft);
      jest.spyOn(service as any, 'assertWarehouses').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'assertSiloDestination').mockResolvedValue(undefined);
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...draft, status: 'POSTED' } as any);
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });
    });

    it('re-checks each end\'s farm once, after the transaction has committed', async () => {
      const seen: unknown[] = [];
      const evaluate = jest.spyOn(feedAlerts, 'evaluateFarm').mockImplementation(async () => {
        seen.push({ committed, inTx: cls.get('tenantPostingTransaction') });
        return { raise: [], renotify: [], escalate: [], resolve: [] };
      });

      const result = await service.post('tr-1', 'tenant-1', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
      expect(evaluate.mock.calls).toEqual([
        ['farm-a', 'co-1', 'tenant-1', { levelsOnly: true }],
        ['farm-b', 'co-1', 'tenant-1', { levelsOnly: true }],
      ]);
      expect(seen).toEqual([{ committed: true, inTx: undefined }, { committed: true, inTx: undefined }]);
    });

    it('still posts when the re-check throws', async () => {
      jest.spyOn(feedAlerts, 'evaluateFarm').mockRejectedValue(new Error('alert_rule is locked'));
      const warn = jest.spyOn((feedAlerts as any).logger, 'warn').mockImplementation(() => undefined);

      const result = await service.post('tr-1', 'tenant-1', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('alert_rule is locked'));
    });
  });

  describe('farm scope', () => {
    const grasmere = { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };

    it('lists only transfers touching a warehouse on the active farm', async () => {
      useFarmScope(cls, grasmere);
      await service.findAll({} as any, 'tenant-1');
      expect(renderedWhere()).toContain('location_master lf');
    });

    it('puts the active-farm condition on transfer detail reads', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.stockTransfer, [{ transfer_id: 'tr-1' }]);
      await service.findOne('tr-1');
      expect(renderedWhere()).toContain('location_master lf');
    });

    it('bounds transfers by company when an operational admin selects no farm', async () => {
      useFarmScope(cls, { ...grasmere, farmId: null });
      await service.findAll({} as any, 'tenant-1');
      expect(renderedWhere()).toContain('`stock_transfer`.`company_id` = ?');
    });

    it('refuses transferring from a source warehouse on another farm', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.locationMaster, [{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig' }]);
      await expect(service.create({ ...validTransferDto, from_warehouse_id: 'store-k' } as any, 'tenant-1'))
        .rejects.toThrow('Source warehouse is not on your active farm.');
    });

    it('refuses a destination warehouse outside the active company even for a farm transfer', async () => {
      useFarmScope(cls, grasmere);
      mockDbSelect
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-1', parent: 'farm-g', farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig' }]) })
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-2', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-2', lob_id: 'lob-pig' }]) });

      await expect(service.create(validTransferDto as any, 'tenant-1'))
        .rejects.toThrow('Destination warehouse is not on your active farm.');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('revalidates a draft destination before posting', async () => {
      useFarmScope(cls, grasmere);
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue({
        transfer_id: 'tr-1', company_id: 'co-1', status: 'DRAFT',
        from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2',
        lines: [{ line_id: 'ln-1', item_id: 'item-1', quantity: '1', uom: 'KG' }],
      } as any);
      mockDbSelect
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-1', parent: 'farm-g', farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig' }]) })
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-2', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-2', lob_id: 'lob-pig' }]) });

      await expect(service.post('tr-1', 'tenant-1'))
        .rejects.toThrow('Destination warehouse is not on your active farm.');
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('refuses updating a draft to a destination outside the active company', async () => {
      useFarmScope(cls, grasmere);
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue({
        transfer_id: 'tr-1', company_id: 'co-1', status: 'DRAFT',
        from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2', lines: [],
      } as any);
      // M6 (fix round 1) moved assertNotShipped ahead of assertWarehouses, so
      // update()'s FIRST select is now the shipment-events read, not the
      // source-warehouse read — this harmless empty queue entry is it ("no
      // shipment"); the two real location overrides shift down by one.
      mockDbSelect
        .mockReturnValueOnce({ from: () => chain([]) })
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-1', parent: 'farm-g', farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig' }]) })
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-other', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-2', lob_id: 'lob-pig' }]) });

      await expect(service.update('tr-1', { to_warehouse_id: 'wh-other' } as any, 'tenant-1'))
        .rejects.toThrow('Destination warehouse is not on your active farm.');
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  // C1 (recovery review): update/remove/post authorized by reaching the row
  // through findOne's either-side OR, so a destination-farm manager could
  // rewrite and post the source farm's draft. The mutation load must put the
  // farm predicate on from_warehouse_id and never on to_warehouse_id.
  describe('mutations authorize from the source side only', () => {
    const grasmere = { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };
    let forCalls: unknown[];

    beforeEach(() => {
      forCalls = [];
      // Only the stock_transfer load is inspected; it answers nothing, so every
      // path stops at its not-found before any write.
      mockDbSelect.mockImplementation(() => ({
        from: (table: unknown) => {
          const c = chain(rows.get(table) ?? []);
          c.for = (mode: unknown) => { forCalls.push(mode); return c; };
          return c;
        },
      }));
    });

    const expectSourceSidePredicate = () => {
      const sqlText = renderedWhere();
      expect(sqlText).toMatch(/from_warehouse_id` IN \(SELECT lf\.location_id FROM location_master lf WHERE lf\.location_id = \? OR lf\.farm_id = \?\)/);
      expect(sqlText).not.toContain('to_warehouse_id');
      expect(forCalls).toContain('update');
    };

    it('post loads the transfer by its source warehouse, locked', async () => {
      useFarmScope(cls, grasmere);
      await expect(service.post('tr-1', 'tenant-1')).rejects.toThrow("Stock Transfer with ID 'tr-1' not found.");
      expectSourceSidePredicate();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('update loads the transfer by its source warehouse, locked', async () => {
      useFarmScope(cls, grasmere);
      await expect(service.update('tr-1', { remarks: 'x' } as any, 'tenant-1')).rejects.toThrow("Stock Transfer with ID 'tr-1' not found.");
      expectSourceSidePredicate();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('remove loads the transfer by its source warehouse, locked', async () => {
      useFarmScope(cls, grasmere);
      await expect(service.remove('tr-1', 'tenant-1')).rejects.toThrow("Stock Transfer with ID 'tr-1' not found.");
      expectSourceSidePredicate();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('post checks the source warehouse against the active farm, not only the company', async () => {
      // The draft is reachable (say, by an admin without a farm selected
      // earlier) but its source now sits on Kintyre. post() used to check the
      // source with farmId: null and let a Grasmere user drain it.
      useFarmScope(cls, grasmere);
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue({
        transfer_id: 'tr-1', company_id: 'co-1', status: 'DRAFT',
        from_warehouse_id: 'store-k', to_warehouse_id: 'wh-1',
        lines: [{ line_id: 'ln-1', item_id: 'item-1', quantity: '1', uom: 'KG' }],
      } as any);
      mockDbSelect.mockReturnValueOnce({
        from: () => chain([{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig' }]),
      });

      await expect(service.post('tr-1', 'tenant-1')).rejects.toThrow('Source warehouse is not on your active farm.');
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('update re-validates an unchanged source warehouse', async () => {
      // Only lines change in the body; the source must still be the editor's.
      useFarmScope(cls, grasmere);
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue({
        transfer_id: 'tr-1', company_id: 'co-1', status: 'DRAFT',
        from_warehouse_id: 'store-k', to_warehouse_id: 'wh-1', lines: [],
      } as any);
      // M6 (fix round 1): assertNotShipped's select (no shipment) runs before
      // assertWarehouses's source-warehouse select.
      mockDbSelect
        .mockReturnValueOnce({ from: () => chain([]) })
        .mockReturnValueOnce({
          from: () => chain([{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig' }]),
        });

      await expect(service.update('tr-1', { lines: [{ item_id: 'item-1', quantity: 999, uom: 'KG' }] } as any, 'tenant-1'))
        .rejects.toThrow('Source warehouse is not on your active farm.');
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  /**
   * Fix round 1, M6: update() must check for a shipment (assertNotShipped)
   * before it validates the warehouses (assertWarehouses) — the cheap,
   * event-based refusal first, the two location reads only once that is clear.
   * Before this fix the order was reversed.
   */
  describe('fix round 1, M6 — update() checks shipped stock before the warehouses', () => {
    it('reports "stock has already shipped", not a warehouse error, even when the new destination would also fail validation', async () => {
      useFarmScope(cls, { farmId: null, companyId: 'co-1', restricted: false, lobId: null });
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue({
        transfer_id: 'tr-1', transfer_no: 'TR-000001', company_id: 'co-1', status: 'IN_TRANSIT',
        from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2', lines: [],
      } as any);
      rows.set(schema.transferShipment, [{ shipment_no: 'SH-2026-0001' }]);
      // The destination the caller wants to move to does not exist — if
      // assertWarehouses ran first, THIS is the error that would surface.
      rows.set(schema.locationMaster, []);

      await expect(service.update('tr-1', { to_warehouse_id: 'wh-bad' } as any, 'tenant-1'))
        .rejects.toThrow('Stock Transfer TR-000001 cannot be edited — stock has already shipped on SH-2026-0001.');
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  /**
   * M1 (fix round 1): the ordinary paths the new guards must not have broken
   * — a DRAFT with no shipment or receipt event still cancels and still edits,
   * exactly as before Task 4b's status-follows-events and no-edit-once-shipped
   * guards were added.
   */
  describe('fix round 1, M1 — the ordinary paths still work', () => {
    const openScope = { farmId: null, companyId: 'co-1', restricted: false, lobId: null };

    it('remove() still cancels a DRAFT with no events (CANCELLED written)', async () => {
      useFarmScope(cls, openScope);
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue({
        transfer_id: 'tr-1', transfer_no: 'TR-000001', company_id: 'co-1', status: 'DRAFT',
        from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2', lines: [],
      } as any);
      // No shipment: assertNotShipped passes silently (default empty rows.get(schema.transferShipment)).
      const setSpy = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) });
      mockDbUpdate.mockReturnValue({ set: setSpy });

      const result = await service.remove('tr-1', 'tenant-1', { userId: 'u-1' } as any);

      expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'CANCELLED' }));
      expect(result).toEqual({ success: true, message: "Stock Transfer 'TR-000001' has been cancelled." });
    });

    it('update() still edits a DRAFT with no events', async () => {
      useFarmScope(cls, openScope);
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue({
        transfer_id: 'tr-1', transfer_no: 'TR-000001', company_id: 'co-1', status: 'DRAFT',
        from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2', lines: [],
      } as any);
      mockDbSelect
        .mockReturnValueOnce({ from: () => chain([]) }) // assertNotShipped: no shipment
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-1', parent: null, farm_id: null, company_id: 'co-1', lob_id: null }]) })
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-2', parent: null, farm_id: null, company_id: 'co-1', lob_id: null }]) });
      rows.set(schema.stockTransfer, [{
        transfer_id: 'tr-1', transfer_no: 'TR-000001', tenant_id: 'tenant-1', status: 'DRAFT', deleted_at: null,
        from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2',
      }]);
      rows.set(schema.stockTransferLine, []);
      const setSpy = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) });
      mockDbUpdate.mockReturnValue({ set: setSpy });

      await service.update('tr-1', { remarks: 'moved to dock 2' } as any, 'tenant-1', { userId: 'u-1' } as any);

      expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ remarks: 'moved to dock 2' }));
    });
  });

  /**
   * Fix round 2, Important (coordinator, 4 Oct): round 1's position (line_no)
   * inference was unsound. insertLines always assigns line_no = idx + 1 with
   * no item cross-check, so a reorder swaps two lines' links, a removal from
   * the front/middle hands the survivor a stranger's FK, and a
   * front-insertion misattributes two links while silently dropping a third
   * — a silent WRONG FK, worse than round 1's silent NULL (a NULL fails
   * loudly downstream; a wrong FK posts shipped/received quantities onto the
   * wrong requisition line and nothing ever complains). There is no sound
   * inference here — only the caller knows which incoming line is which — so
   * update() now refuses: if the transfer carries ANY requisition_line_id
   * today, every replacement line must supply its own, or the request is
   * rejected with a message naming the problem. An ordinary hand-made
   * transfer (no links anywhere) is unaffected.
   */
  describe('fix round 2, Important — update() refuses a line-replace that would misattribute or drop a requisition link', () => {
    const openScope = { farmId: null, companyId: 'co-1', restricted: false, lobId: null };
    const REFUSAL = "Stock Transfer TR-000001 came from a requisition release; every replacement line must supply its requisition_line_id.";

    function primeMutation(existingLines: any[]) {
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue({
        transfer_id: 'tr-1', transfer_no: 'TR-000001', company_id: 'co-1', status: 'DRAFT',
        from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2', lines: [],
      } as any);
      jest.spyOn(service as any, 'assertWarehouses').mockResolvedValue(undefined);
      rows.set(schema.transferShipment, []); // assertNotShipped: no shipment
      rows.set(schema.stockTransfer, [{
        transfer_id: 'tr-1', transfer_no: 'TR-000001', tenant_id: 'tenant-1', status: 'DRAFT', deleted_at: null,
        from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2',
      }]);
      rows.set(schema.stockTransferLine, existingLines);
    }

    let insertedLines: any;
    beforeEach(() => {
      insertedLines = undefined;
      (mockDb as any).delete = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
      mockDbInsert.mockImplementation((table: unknown) => ({
        values: jest.fn(async (v: any) => { if (table === schema.stockTransferLine) insertedLines = v; }),
      }));
    });

    // The two lines a Store release would have created, in order: A then B.
    const TWO_LINKED_LINES = [
      { line_id: 'ln-A', transfer_id: 'tr-1', line_no: 1, item_id: 'item-A', quantity: '10.0000', uom: 'KG', requisition_line_id: 'rl-A' },
      { line_id: 'ln-B', transfer_id: 'tr-1', line_no: 2, item_id: 'item-B', quantity: '5.0000', uom: 'KG', requisition_line_id: 'rl-B' },
    ];
    const ONE_LINKED_LINE = [
      { line_id: 'ln-A', transfer_id: 'tr-1', line_no: 1, item_id: 'item-A', quantity: '10.0000', uom: 'KG', requisition_line_id: 'rl-A' },
    ];

    // Case 1: Reordered [A,B] -> [B,A], neither line supplies its id.
    // Round 1 would have handed B the id that belongs to A and vice versa
    // (both wrong) — now refused.
    it('refuses a reorder with no supplied ids (round 1 would have swapped A and B\'s links)', async () => {
      useFarmScope(cls, openScope);
      primeMutation(TWO_LINKED_LINES);

      await expect(service.update('tr-1', {
        lines: [{ item_id: 'item-B', quantity: 5, uom: 'KG' }, { item_id: 'item-A', quantity: 10, uom: 'KG' }],
      } as any, 'tenant-1', { userId: 'u-1' } as any)).rejects.toThrow(REFUSAL);
      expect(insertedLines).toBeUndefined();
    });

    // Case 2: Removed from the front — only B survives, with no supplied id.
    // Round 1 would have handed the survivor (B, now at position 1) A's old
    // link — a stranger's FK, not "no link".
    it('refuses a removal from the front with no supplied id (round 1 would have handed the survivor a stranger\'s link)', async () => {
      useFarmScope(cls, openScope);
      primeMutation(TWO_LINKED_LINES);

      await expect(service.update('tr-1', {
        lines: [{ item_id: 'item-B', quantity: 5, uom: 'KG' }],
      } as any, 'tenant-1', { userId: 'u-1' } as any)).rejects.toThrow(REFUSAL);
      expect(insertedLines).toBeUndefined();
    });

    // Case 3: Front insertion [C, A] — a brand-new line C prepended ahead of
    // the existing A, neither supplying an id. Round 1 would have misattributed
    // both (C inheriting A's link, A getting nothing) — now refused.
    it('refuses a front-insertion with no supplied ids (round 1 would have misattributed both lines)', async () => {
      useFarmScope(cls, openScope);
      primeMutation(ONE_LINKED_LINE);

      await expect(service.update('tr-1', {
        lines: [{ item_id: 'item-C', quantity: 2, uom: 'KG' }, { item_id: 'item-A', quantity: 10, uom: 'KG' }],
      } as any, 'tenant-1', { userId: 'u-1' } as any)).rejects.toThrow(REFUSAL);
      expect(insertedLines).toBeUndefined();
    });

    // Case 4: Added-at-end — growing the line count is fine on its own; the
    // rule is "does every line carry an id", not "does the count match".
    // Every line, old and new, supplies its own id.
    it('accepts a line added at the end when every line (old and new) supplies its own id', async () => {
      useFarmScope(cls, openScope);
      primeMutation(ONE_LINKED_LINE);

      await service.update('tr-1', {
        lines: [
          { item_id: 'item-A', quantity: 10, uom: 'KG', requisition_line_id: 'rl-A' },
          { item_id: 'item-C', quantity: 2, uom: 'KG', requisition_line_id: 'rl-C' },
        ],
      } as any, 'tenant-1', { userId: 'u-1' } as any);

      expect(insertedLines).toHaveLength(2);
      expect(insertedLines[0]).toMatchObject({ requisition_line_id: 'rl-A' });
      expect(insertedLines[1]).toMatchObject({ requisition_line_id: 'rl-C' });
    });

    // Case 5: caller-supplied — the straightforward case the mechanism exists
    // for: every existing line's id is echoed back exactly, unreordered.
    it('accepts a straight replace when the caller echoes every existing id back', async () => {
      useFarmScope(cls, openScope);
      primeMutation(TWO_LINKED_LINES);

      await service.update('tr-1', {
        lines: [
          { item_id: 'item-A', quantity: 10, uom: 'KG', requisition_line_id: 'rl-A' },
          { item_id: 'item-B', quantity: 5, uom: 'KG', requisition_line_id: 'rl-B' },
        ],
      } as any, 'tenant-1', { userId: 'u-1' } as any);

      expect(insertedLines).toHaveLength(2);
      expect(insertedLines[0]).toMatchObject({ requisition_line_id: 'rl-A' });
      expect(insertedLines[1]).toMatchObject({ requisition_line_id: 'rl-B' });
    });

    // Regression guard: an ordinary hand-made transfer (no requisition links
    // anywhere) must keep working exactly as before this fix round — no id
    // required from anyone, reorder/remove/insert all unaffected.
    it('leaves an ordinary transfer with no requisition links unaffected — no id required, reorder included', async () => {
      useFarmScope(cls, openScope);
      primeMutation([
        { line_id: 'ln-X', transfer_id: 'tr-1', line_no: 1, item_id: 'item-X', quantity: '1.0000', uom: 'KG', requisition_line_id: null },
        { line_id: 'ln-Y', transfer_id: 'tr-1', line_no: 2, item_id: 'item-Y', quantity: '2.0000', uom: 'KG', requisition_line_id: null },
      ]);

      // Reordered, and neither line supplies an id — would be refused on a
      // release-linked transfer, but this one carries no links at all.
      await service.update('tr-1', {
        lines: [{ item_id: 'item-Y', quantity: 2, uom: 'KG' }, { item_id: 'item-X', quantity: 1, uom: 'KG' }],
      } as any, 'tenant-1', { userId: 'u-1' } as any);

      expect(insertedLines).toHaveLength(2);
      expect(insertedLines[0].requisition_line_id).toBeFalsy();
      expect(insertedLines[1].requisition_line_id).toBeFalsy();
    });
  });

  /**
   * Client rules of 2026-09-24: feed reaches a silo only through a stock
   * transfer (farm STORE -> SILO) and leaves it only through a daily feed
   * entry, so posting the transfer is the one moment a silo can be overfilled
   * or handed a second feed to hold. Both guards apply to a SILO destination
   * only — a STORE takes anything, in any quantity.
   */
  describe('silo destination guards', () => {
    const draft = (lines: unknown[]) => ({
      transfer_id: 'tr-1', transfer_no: 'TR-000001', company_id: 'co-1', status: 'DRAFT',
      from_warehouse_id: 'store-1', to_warehouse_id: 'silo-1', posting_date: '2026-09-24',
      lines,
    });

    /** A 5,000 KG silo as location_master holds it — silo_capacity_kg is canonical kilograms. */
    const siloRow = {
      location_id: 'silo-1', location_code: 'GRA/SILO-01', location_name: 'Feed Silo 01',
      location_type: 'SILO', silo_capacity_kg: '5000.00',
    };

    beforeEach(() => {
      rows.set(schema.locationMaster, [siloRow]);
      // post() finishes on findOne(); the accepted cases need a row to read back.
      rows.set(schema.stockTransfer, [{ transfer_id: 'tr-1', transfer_no: 'TR-000001' }]);
      mockDbUpdate.mockReturnValue({
        set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }),
      });
    });

    it('refuses a transfer that would push the silo past its capacity', async () => {
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(
        draft([{ line_id: 'ln-1', item_id: 'item-feed', quantity: '2000', uom: 'KG' }]) as any,
      );
      mockGetStockBalance.mockResolvedValue([
        { item_id: 'item-feed', item_code: 'FEED-GROWER', uom: 'KG', on_hand_qty: 4000 },
      ]);

      await expect(service.post('tr-1', 'tenant-1')).rejects.toThrow(/would overfill it/);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('allows a transfer that exactly fills the silo', async () => {
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(
        draft([{ line_id: 'ln-1', item_id: 'item-feed', quantity: '1000', uom: 'KG' }]) as any,
      );
      mockGetStockBalance.mockResolvedValue([
        { item_id: 'item-feed', item_code: 'FEED-GROWER', uom: 'KG', on_hand_qty: 4000 },
      ]);

      await expect(service.post('tr-1', 'tenant-1')).resolves.toBeDefined();
      expect(mockDbUpdate).toHaveBeenCalled();
    });

    // Capacity is kilograms; a line in TON is 1000x what the raw number says.
    it('converts the line quantity to KG before comparing it with the capacity', async () => {
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(
        draft([{ line_id: 'ln-1', item_id: 'item-feed', quantity: '6', uom: 'TON' }]) as any,
      );
      mockResolveConversionFactor.mockResolvedValue(1000);

      await expect(service.post('tr-1', 'tenant-1')).rejects.toThrow(/would overfill it/);
      expect(mockResolveConversionFactor).toHaveBeenCalledWith('TON', 'KG', 'item-feed', 'co-1', 'tenant-1');
    });

    it('refuses rather than assuming KG when the line UOM has no conversion to KG', async () => {
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(
        draft([{ line_id: 'ln-1', item_id: 'item-feed', quantity: '10', uom: 'BAG' }]) as any,
      );
      mockResolveConversionFactor.mockRejectedValue(new Error('No UOM conversion rule found'));

      await expect(service.post('tr-1', 'tenant-1')).rejects.toThrow(/no conversion from 'BAG' to KG/);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('refuses a transfer of a different item into a silo that already holds one', async () => {
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(
        draft([{ line_id: 'ln-1', item_id: 'item-starter', quantity: '10', uom: 'KG' }]) as any,
      );
      mockAssertCanReceive.mockRejectedValue(new Error(
        "Cannot post this Stock Transfer — silo 'Feed Silo 01' already holds 'FEED-GROWER'. A silo holds one feed item at a time; empty it before moving a different item in.",
      ));

      await expect(service.post('tr-1', 'tenant-1')).rejects.toThrow(/holds one feed item at a time/);
      expect(mockDbUpdate).not.toHaveBeenCalled();
      // The item rules ran before the capacity balances were even fetched.
      expect(mockAssertCanReceive).toHaveBeenCalledWith({
        siloId: 'silo-1', siloName: 'Feed Silo 01', companyId: 'co-1', tenantId: 'tenant-1',
        itemIds: ['item-starter'], documentLabel: 'Stock Transfer',
      });
    });

    it('refuses a single transfer carrying two different items into one silo', async () => {
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(
        draft([
          { line_id: 'ln-1', item_id: 'item-grower', quantity: '10', uom: 'KG' },
          { line_id: 'ln-2', item_id: 'item-starter', quantity: '10', uom: 'KG' },
        ]) as any,
      );
      mockAssertCanReceive.mockRejectedValue(new Error(
        "Cannot post this Stock Transfer — silo 'Feed Silo 01' holds one feed item at a time and this transfer carries 2 different items.",
      ));

      await expect(service.post('tr-1', 'tenant-1')).rejects.toThrow(/holds one feed item at a time/);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('tops up a silo with more of the item it already holds', async () => {
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(
        draft([{ line_id: 'ln-1', item_id: 'item-grower', quantity: '500', uom: 'KG' }]) as any,
      );
      mockGetStockBalance.mockResolvedValue([
        { item_id: 'item-grower', item_code: 'FEED-GROWER', uom: 'KG', on_hand_qty: 100 },
      ]);

      await expect(service.post('tr-1', 'tenant-1')).resolves.toBeDefined();
      expect(mockDbUpdate).toHaveBeenCalled();
    });

    it('leaves a STORE destination unguarded — neither rule is about stores', async () => {
      rows.set(schema.locationMaster, [{ ...siloRow, location_id: 'store-2', location_type: 'STORE', silo_capacity_kg: null }]);
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue({
        ...draft([
          { line_id: 'ln-1', item_id: 'item-grower', quantity: '99999', uom: 'KG' },
          { line_id: 'ln-2', item_id: 'item-starter', quantity: '99999', uom: 'KG' },
        ]),
        to_warehouse_id: 'store-2',
      } as any);

      await expect(service.post('tr-1', 'tenant-1')).resolves.toBeDefined();
      expect(mockGetStockBalance).not.toHaveBeenCalled();
    });
  });
});
