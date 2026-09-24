import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { StockTransferService } from './stock-transfer.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { UomService } from '../../master-data/uom/uom.service';
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
    mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? []) }));
    mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
    mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

    cls = transactionCls(mockDb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockTransferService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: InventoryLedgerService, useValue: { writeTransferEntries: jest.fn().mockResolvedValue({ shipment: {}, receipt: {} }), getStockBalance: mockGetStockBalance } },
        { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}) } },
        { provide: UomService, useValue: { resolveConversionFactor: mockResolveConversionFactor } },
      ],
    }).compile();

    service = module.get<StockTransferService>(StockTransferService);
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
      mockDbSelect
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
      mockDbSelect.mockReturnValueOnce({
        from: () => chain([{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig' }]),
      });

      await expect(service.update('tr-1', { lines: [{ item_id: 'item-1', quantity: 999, uom: 'KG' }] } as any, 'tenant-1'))
        .rejects.toThrow('Source warehouse is not on your active farm.');
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
      mockGetStockBalance.mockResolvedValue([
        { item_id: 'item-grower', item_code: 'FEED-GROWER', uom: 'KG', on_hand_qty: 100 },
      ]);

      await expect(service.post('tr-1', 'tenant-1')).rejects.toThrow(/holds one feed item at a time/);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('refuses a single transfer carrying two different items into one silo', async () => {
      jest.spyOn(service as any, 'loadForMutation').mockResolvedValue(
        draft([
          { line_id: 'ln-1', item_id: 'item-grower', quantity: '10', uom: 'KG' },
          { line_id: 'ln-2', item_id: 'item-starter', quantity: '10', uom: 'KG' },
        ]) as any,
      );

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
