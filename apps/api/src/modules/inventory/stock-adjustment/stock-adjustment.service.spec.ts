import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { StockAdjustmentService } from './stock-adjustment.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { FeedAlertService } from '../feed-alert/feed-alert.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import * as schema from '../../../core/database/schema';

/**
 * Phase 1 access foundation, Task 7: stock adjustments belong to the farm
 * holding their warehouse (common/farm-scope.ts locationOnFarm). Modelled on
 * breeding.service.spec.ts / batch-daily-data.service.spec.ts's table-keyed
 * db mock — it answers by table, not by call order, and captures the last
 * `.where()` condition so a test can render the SQL and check the farm join
 * made it in.
 */
describe('StockAdjustmentService', () => {
  let service: StockAdjustmentService;
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

  const validAdjustmentDto = {
    company_id: 'co-1',
    warehouse_id: 'wh-1',
    posting_date: '2026-01-01',
    lines: [{ item_id: 'item-1', quantity: -5, uom: 'KG' }],
  };

  beforeEach(async () => {
    rows.clear();
    capturedWhere = undefined;
    rows.set(schema.stockAdjustment, []);
    rows.set(schema.stockAdjustmentLine, []);
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
        StockAdjustmentService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: InventoryLedgerService, useValue: { writePositiveEntry: jest.fn().mockResolvedValue({ entry_no: 1 }), writeNegativeEntry: jest.fn().mockResolvedValue({ entry_no: 2 }) } },
        { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}) } },
        { provide: NumberSeriesService, useValue: { generateNextNumberById: jest.fn().mockResolvedValue({ next_number: 'LOT-TEST-001' }) } },
      ],
    }).compile();

    service = module.get<StockAdjustmentService>(StockAdjustmentService);
  });

  // Ruling M6: a posted adjustment re-checks its warehouse's farm once, after
  // its transaction has committed — and a failing re-check never fails it.
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
      rows.set(schema.locationMaster, [{ location_id: 'wh-1', location_type: 'SILO', farm_id: 'farm-a', company_id: 'co-1' }]);
      feedAlerts = new FeedAlertService(cls, {} as any, {} as any, {} as any);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StockAdjustmentService,
          { provide: ClsService, useValue: cls },
          { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
          { provide: InventoryLedgerService, useValue: { writePositiveEntry: jest.fn().mockResolvedValue({ entry_no: 1 }), writeNegativeEntry: jest.fn().mockResolvedValue({ entry_no: 2 }) } },
          { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}) } },
          { provide: FeedAlertService, useValue: feedAlerts },
          { provide: NumberSeriesService, useValue: { generateNextNumberById: jest.fn().mockResolvedValue({ next_number: 'TEST-001' }) } },
        ],
      }).compile();
      service = module.get<StockAdjustmentService>(StockAdjustmentService);
      const draft = {
        adjustment_id: 'adj-1', adjustment_no: 'ADJ-1', company_id: 'co-1', warehouse_id: 'wh-1', status: 'DRAFT', posting_date: '2026-09-26',
        lines: [{ line_id: 'ln-1', item_id: 'item-1', quantity: '-50', uom: 'KG' }],
      };
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(draft as any).mockResolvedValueOnce({ ...draft, status: 'POSTED' } as any);
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });
    });

    it('re-checks the warehouse\'s farm once, after the transaction has committed', async () => {
      const seen: unknown[] = [];
      const evaluate = jest.spyOn(feedAlerts, 'evaluateFarm').mockImplementation(async () => {
        seen.push({ committed, inTx: cls.get('tenantPostingTransaction') });
        return { raise: [], renotify: [], escalate: [], resolve: [] };
      });

      const result = await service.post('adj-1', 'tenant-1', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
      expect(evaluate.mock.calls).toEqual([['farm-a', 'co-1', 'tenant-1', { levelsOnly: true }]]);
      expect(seen).toEqual([{ committed: true, inTx: undefined }]);
    });

    it('still posts when the re-check throws', async () => {
      jest.spyOn(feedAlerts, 'evaluateFarm').mockRejectedValue(new Error('alert_rule is locked'));
      const warn = jest.spyOn((feedAlerts as any).logger, 'warn').mockImplementation(() => undefined);

      const result = await service.post('adj-1', 'tenant-1', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('alert_rule is locked'));
    });
  });

  describe('farm scope', () => {
    const grasmere = { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };

    it('lists only adjustments in warehouses on the active farm', async () => {
      useFarmScope(cls, grasmere);
      await service.findAll({} as any, 'tenant-1');
      expect(renderedWhere()).toContain('location_master lf');
    });

    it('puts the active-farm condition on adjustment detail reads', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.stockAdjustment, [{ adjustment_id: 'adj-1' }]);
      await service.findOne('adj-1');
      expect(renderedWhere()).toContain('location_master lf');
    });

    it('bounds adjustments by company when an operational admin selects no farm', async () => {
      useFarmScope(cls, { ...grasmere, farmId: null });
      await service.findAll({} as any, 'tenant-1');
      expect(renderedWhere()).toContain('`stock_adjustment`.`company_id` = ?');
    });

    it('refuses adjusting a warehouse on another farm', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.locationMaster, [{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig' }]);
      await expect(service.create({ ...validAdjustmentDto, warehouse_id: 'store-k' } as any, 'tenant-1'))
        .rejects.toThrow('Warehouse is not on your active farm.');
    });
  });
});
