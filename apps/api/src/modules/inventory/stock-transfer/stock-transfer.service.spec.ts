import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { StockTransferService } from './stock-transfer.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import * as schema from '../../../core/database/schema';

/**
 * Phase 1 access foundation, Task 7: stock transfers belong to the farm
 * holding either the source or destination warehouse (common/farm-scope.ts
 * locationOnFarm, joined with OR — see stock-transfer.service.ts's findOne
 * and findAll). The source must be on the active farm; the destination may sit
 * on another farm but must remain in the caller's company and LOB.
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
    mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? []) }));
    mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
    mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

    cls = transactionCls(mockDb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockTransferService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: InventoryLedgerService, useValue: { writeTransferEntries: jest.fn().mockResolvedValue({ shipment: {}, receipt: {} }) } },
        { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}) } },
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
      jest.spyOn(service, 'findOne').mockResolvedValue({
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
      jest.spyOn(service, 'findOne').mockResolvedValue({
        transfer_id: 'tr-1', company_id: 'co-1', status: 'DRAFT',
        from_warehouse_id: 'wh-1', to_warehouse_id: 'wh-2', lines: [],
      } as any);
      mockDbSelect.mockReturnValueOnce({
        from: () => chain([{ location_id: 'wh-other', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-2', lob_id: 'lob-pig' }]),
      });

      await expect(service.update('tr-1', { to_warehouse_id: 'wh-other' } as any, 'tenant-1'))
        .rejects.toThrow('Destination warehouse is not on your active farm.');
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });
});
