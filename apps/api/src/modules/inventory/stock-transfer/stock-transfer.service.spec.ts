import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
 * and findAll). Only the source warehouse is checked on create/update: the
 * destination may sit on another farm, and farm-to-farm approval is Phase 7.
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
      where: (cond: unknown) => { capturedWhere = cond; return self; },
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
    company_id: 'comp-1',
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

    it('answers 404 for a transfer touching another farm', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.stockTransfer, []);
      await expect(service.findOne('tr-kintyre')).rejects.toThrow(NotFoundException);
    });

    it('refuses transferring from a source warehouse on another farm', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.locationMaster, [{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k' }]);
      await expect(service.create({ ...validTransferDto, from_warehouse_id: 'store-k' } as any, 'tenant-1'))
        .rejects.toThrow('Source warehouse is not on your active farm.');
    });
  });
});
