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
  const mockWriteNegativeEntry = jest.fn().mockResolvedValue({ ledger_id: 'led-1', rate: '12.50', lot_no: 'LOT-1' });

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

    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockGetStockBalance.mockReset().mockResolvedValue([]);
    // KG in, KG out — a test that cares about the conversion overrides it.
    mockResolveConversionFactor.mockReset().mockResolvedValue(1);
    // Accepts by default; a test that cares about a refusal overrides it.
    mockAssertCanReceive.mockReset().mockResolvedValue(undefined);
    mockWriteNegativeEntry.mockReset().mockResolvedValue({ ledger_id: 'led-1', rate: '12.50', lot_no: 'LOT-1' });
    mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? []) }));
    mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
    mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

    cls = transactionCls(mockDb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockTransferService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        {
          provide: InventoryLedgerService,
          useValue: {
            writeTransferEntries: jest.fn().mockResolvedValue({ shipment: {}, receipt: {} }),
            getStockBalance: mockGetStockBalance,
            writeNegativeEntry: mockWriteNegativeEntry,
            writePositiveEntry: jest.fn().mockResolvedValue({ ledger_id: 'led-2' }),
          },
        },
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
          { provide: InventoryLedgerService, useValue: { writeTransferEntries: jest.fn().mockResolvedValue({ shipment: {}, receipt: {} }), getStockBalance: mockGetStockBalance } },
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

    it('lists only transfers touching a location on the active farm', async () => {
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

    it('refuses transferring from a source location on another farm', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.locationMaster, [{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig' }]);
      await expect(service.create({ ...validTransferDto, from_warehouse_id: 'store-k' } as any, 'tenant-1'))
        .rejects.toThrow('Source location is not on your active farm.');
    });

    it('refuses a destination location outside the active company even for a farm transfer', async () => {
      useFarmScope(cls, grasmere);
      mockDbSelect
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-1', parent: 'farm-g', farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig' }]) })
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-2', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-2', lob_id: 'lob-pig' }]) });

      await expect(service.create(validTransferDto as any, 'tenant-1'))
        .rejects.toThrow('Destination location is not on your active farm.');
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
        .rejects.toThrow('Destination location is not on your active farm.');
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('refuses updating a draft to a destination outside the active company', async () => {
      useFarmScope(cls, grasmere);
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue({
        transfer_id: 'tr-1', company_id: 'co-1', status: 'DRAFT',
        from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2', lines: [],
      } as any);
      mockDbSelect
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-1', parent: 'farm-g', farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig' }]) })
        .mockReturnValueOnce({ from: () => chain([{ location_id: 'wh-other', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-2', lob_id: 'lob-pig' }]) });

      await expect(service.update('tr-1', { to_warehouse_id: 'wh-other' } as any, 'tenant-1'))
        .rejects.toThrow('Destination location is not on your active farm.');
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

    it('post loads the transfer by its source location, locked', async () => {
      useFarmScope(cls, grasmere);
      await expect(service.post('tr-1', 'tenant-1')).rejects.toThrow("Transfer Order with ID 'tr-1' not found.");
      expectSourceSidePredicate();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('update loads the transfer by its source location, locked', async () => {
      useFarmScope(cls, grasmere);
      await expect(service.update('tr-1', { remarks: 'x' } as any, 'tenant-1')).rejects.toThrow("Transfer Order with ID 'tr-1' not found.");
      expectSourceSidePredicate();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('remove loads the transfer by its source location, locked', async () => {
      useFarmScope(cls, grasmere);
      await expect(service.remove('tr-1', 'tenant-1')).rejects.toThrow("Transfer Order with ID 'tr-1' not found.");
      expectSourceSidePredicate();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('post checks the source location against the active farm, not only the company', async () => {
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

      await expect(service.post('tr-1', 'tenant-1')).rejects.toThrow('Source location is not on your active farm.');
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('update re-validates an unchanged source location', async () => {
      // Only lines change in the body; the source must still be the editor's.
      useFarmScope(cls, grasmere);
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue({
        transfer_id: 'tr-1', company_id: 'co-1', status: 'DRAFT',
        from_warehouse_id: 'store-k', to_warehouse_id: 'wh-1', lines: [],
      } as any);
      mockDbSelect.mockReturnValueOnce({
        from: () => chain([{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig' }]),
      });

      await expect(service.update('tr-1', { lines: [{ item_id: 'item-1', quantity: 999, uom: 'KG' }] } as any, 'tenant-1'))
        .rejects.toThrow('Source location is not on your active farm.');
      expect(mockDbUpdate).not.toHaveBeenCalled();
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
        "Cannot post this Transfer Order — silo 'Feed Silo 01' already holds 'FEED-GROWER'. A silo holds one feed item at a time; empty it before moving a different item in.",
      ));

      await expect(service.post('tr-1', 'tenant-1')).rejects.toThrow(/holds one feed item at a time/);
      expect(mockDbUpdate).not.toHaveBeenCalled();
      // The item rules ran before the capacity balances were even fetched.
      expect(mockAssertCanReceive).toHaveBeenCalledWith({
        siloId: 'silo-1', siloName: 'Feed Silo 01', companyId: 'co-1', tenantId: 'tenant-1',
        itemIds: ['item-starter'], documentLabel: 'Transfer Order',
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
        "Cannot post this Transfer Order — silo 'Feed Silo 01' holds one feed item at a time and this transfer carries 2 different items.",
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

  describe('two-step transfer (ship and receive)', () => {
    const getTransferDraft = () => ({
      transfer_id: 'tr-1',
      transfer_no: 'TR-000001',
      company_id: 'co-1',
      from_warehouse_id: 'wh-1',
      to_warehouse_id: 'wh-2',
      status: 'DRAFT',
      posting_date: '2026-10-03',
      lines: [{ line_id: 'ln-1', line_no: 1, item_id: 'item-1', quantity: '50', uom: 'KG' }],
    });

    it('refuses shipment if available stock is less than requested quantity', async () => {
      const draft = getTransferDraft();
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(draft as any);
      jest.spyOn(service as any, 'assertWarehouses').mockResolvedValue(undefined);
      mockGetStockBalance.mockResolvedValue([
        { item_id: 'item-1', uom: 'KG', on_hand_qty: 20 },
      ]);

      await expect(service.ship('tr-1', 'tenant-1')).rejects.toThrow(/source location has 20 KG available, but 50 KG was requested/);
    });

    it('ships transfer successfully and transitions status to IN_TRANSIT', async () => {
      const draft = getTransferDraft();
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(draft as any);
      jest.spyOn(service as any, 'assertWarehouses').mockResolvedValue(undefined);
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...draft, status: 'IN_TRANSIT' } as any);
      mockGetStockBalance.mockResolvedValue([
        { item_id: 'item-1', uom: 'KG', on_hand_qty: 100 },
      ]);
      mockDbUpdate.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
        }),
      });

      const result = await service.ship('tr-1', 'tenant-1');
      expect(result.status).toBe('IN_TRANSIT');
    });

    it('ships transfer with ShipStockTransferDto including partial quantities and logistics info', async () => {
      const draft = getTransferDraft();
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(draft as any);
      jest.spyOn(service as any, 'assertWarehouses').mockResolvedValue(undefined);
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...draft, status: 'IN_TRANSIT' } as any);
      mockGetStockBalance.mockResolvedValue([
        { item_id: 'item-1', lot_no: 'LOT-99', uom: 'KG', on_hand_qty: 100 },
      ]);
      mockDbUpdate.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
        }),
      });

      const result = await service.ship(
        'tr-1',
        {
          vehicle_no: 'TRK-9901',
          driver_name: 'John Moyo',
          waybill_ref: 'WB-2026-001',
          lines: [{ item_id: 'item-1', quantity: 30, lot_no: 'LOT-99' }],
        },
        'tenant-1',
      );
      expect(result.status).toBe('IN_TRANSIT');
    });

    it('refuses to receive a transfer that is not in IN_TRANSIT status', async () => {
      const draft = getTransferDraft();
      jest.spyOn(service as any, 'loadForReceive').mockResolvedValue({ ...draft, status: 'DRAFT' } as any);

      await expect(service.receive('tr-1', {}, 'tenant-1')).rejects.toThrow(/is DRAFT, expected 'IN_TRANSIT'/);
    });

    it('refuses receipt when received quantity exceeds shipped quantity', async () => {
      const draft = getTransferDraft();
      jest.spyOn(service as any, 'loadForReceive').mockResolvedValue({ ...draft, status: 'IN_TRANSIT' } as any);
      jest.spyOn(service as any, 'assertSiloDestination').mockResolvedValue(undefined);
      mockDbUpdate.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
        }),
      });

      await expect(
        service.receive('tr-1', { lines: [{ line_id: 'ln-1', received_quantity: 60 }] }, 'tenant-1'),
      ).rejects.toThrow(/Received quantity \(60\) cannot exceed shipped quantity \(50\)/);
    });

    it('receives transfer successfully and transitions status to RECEIVED', async () => {
      const draft = getTransferDraft();
      jest.spyOn(service as any, 'loadForReceive').mockResolvedValue({ ...draft, status: 'IN_TRANSIT' } as any);
      jest.spyOn(service as any, 'assertSiloDestination').mockResolvedValue(undefined);
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...draft, status: 'RECEIVED' } as any);
      mockDbUpdate.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
        }),
      });

      const result = await service.receive('tr-1', { lines: [{ line_id: 'ln-1', received_quantity: 50 }] }, 'tenant-1');
      expect(result.status).toBe('RECEIVED');
    });

    it('receives transfer with DOA quantity, auto-adjusts transit mortality, and marks order as RECEIVED', async () => {
      const draft = getTransferDraft();
      jest.spyOn(service as any, 'loadForReceive').mockResolvedValue({ ...draft, status: 'IN_TRANSIT' } as any);
      jest.spyOn(service as any, 'assertSiloDestination').mockResolvedValue(undefined);
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...draft, status: 'RECEIVED' } as any);
      mockDbUpdate.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
        }),
      });

      const result = await service.receive(
        'tr-1',
        {
          lines: [
            {
              line_id: 'ln-1',
              received_quantity: 46,
              doa_quantity: 4,
              doa_remarks: '4 pigs dead on arrival during transport',
            },
          ],
        },
        'tenant-1',
      );
      expect(result.status).toBe('RECEIVED');
      expect(mockWriteNegativeEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 4,
          transactionType: 'VARIANCE_NEGATIVE',
          documentType: 'STOCK_ADJUSTMENT',
        }),
      );
    });

    it('correctly calculates remaining 400 qty when 600 of 1000 is shipped (partial shipment)', async () => {
      const order1000 = {
        ...getTransferDraft(),
        lines: [
          {
            line_id: 'ln-1000',
            line_no: 1,
            item_id: 'item-1',
            quantity: 1000,
            uom: 'KG',
          },
        ],
      };

      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(order1000 as any);
      jest.spyOn(service as any, 'assertWarehouses').mockResolvedValue(undefined);
      mockGetStockBalance.mockResolvedValue([
        { item_id: 'item-1', lot_no: 'LOT-1', uom: 'KG', on_hand_qty: 1200 },
      ]);
      mockDbUpdate.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
        }),
      });

      // When shipping 600 of 1000
      jest.spyOn(service as any, 'getLedgerHistory').mockResolvedValue([]);
      jest.spyOn(service, 'findOne').mockImplementation(async () => {
        // Mock ledger entries after shipping 600
        const mockLedger = [
          {
            document_line_id: 'ln-1000',
            item_id: 'item-1',
            transaction_type: 'TRANSFER_SHIPMENT',
            quantity: -600,
          },
        ];
        const enriched = (service as any).enrichLinesWithQuantities(order1000.lines, mockLedger);
        return { ...order1000, status: 'IN_TRANSIT', lines: enriched } as any;
      });

      const result = await service.ship(
        'tr-1',
        { lines: [{ line_id: 'ln-1000', quantity: 600 }] },
        'tenant-1',
      );

      expect(result.lines[0].quantity).toBe(1000); // Ordered quantity preserved
      expect(result.lines[0].qty_shipped).toBe(600); // 600 shipped
      expect(result.lines[0].qty_to_ship).toBe(400); // 400 remaining to ship
      expect(result.lines[0].qty_in_transit).toBe(600); // 600 currently in transit
    });

    it('correctly isolates good received quantity and DOA quantity on receiver end', () => {
      const lines = [
        { line_id: 'ln-feed', item_id: 'item-feed', quantity: '100', remarks: '' },
      ];
      const mockLedger = [
        {
          document_line_id: 'ln-feed',
          item_id: 'item-feed',
          transaction_type: 'TRANSFER_SHIPMENT',
          quantity: -75,
        },
        {
          document_line_id: 'ln-feed',
          item_id: 'item-feed',
          transaction_type: 'TRANSFER_RECEIPT',
          quantity: 70,
          external_reference_no: 'DOA:5',
        },
        {
          document_line_id: 'ln-feed',
          item_id: 'item-feed',
          transaction_type: 'TRANSFER_RECEIPT',
          quantity: 5,
          external_reference_no: 'DOA_IN_TRANSIT',
        },
      ];

      const enriched = (service as any).enrichLinesWithQuantities(lines, mockLedger, 'RECEIVED');
      expect(enriched[0].qty_shipped).toBe(75);
      expect(enriched[0].qty_received).toBe(70); // Good quantity received
      expect(enriched[0].qty_doa).toBe(5); // DOA in-transit loss
      expect(enriched[0].doa_quantity).toBe(5);
      expect(enriched[0].qty_in_transit).toBe(0); // 75 shipped - (70 good + 5 doa) = 0
      expect(enriched[0].qty_to_receive).toBe(0);
    });

    it('refuses to close order when stock is still in transit', async () => {
      const order = getTransferDraft();
      jest.spyOn(service as any, 'loadForClose').mockResolvedValue(order as any);
      jest.spyOn(service as any, 'getLedgerHistory').mockResolvedValue([
        { document_line_id: 'ln-1', item_id: 'item-1', transaction_type: 'TRANSFER_SHIPMENT', quantity: -50 },
      ]);

      await expect(service.close('tr-1', 'tenant-1')).rejects.toThrow(/units are still In Transit/);
    });

    it('successfully short-closes order when in-transit is zero and remaining balance exists', async () => {
      const order = getTransferDraft();
      jest.spyOn(service as any, 'loadForClose').mockResolvedValue(order as any);
      jest.spyOn(service as any, 'getLedgerHistory').mockResolvedValue([]);
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...order, status: 'RECEIVED' } as any);
      mockDbUpdate.mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
        }),
      });

      const closed = await service.close('tr-1', 'tenant-1');
      expect(closed.status).toBe('RECEIVED');
    });
  });
});

