import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { GoodsIssueService } from './goods-issue.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import * as schema from '../../../core/database/schema';

/**
 * Phase 1 access foundation, Task 7: goods issues belong to the farm holding
 * their warehouse (common/farm-scope.ts locationOnFarm). Modelled on
 * breeding.service.spec.ts / batch-daily-data.service.spec.ts's table-keyed
 * db mock — it answers by table, not by call order, and captures the last
 * `.where()` condition so a test can render the SQL and check the farm join
 * made it in.
 */
describe('GoodsIssueService', () => {
  let service: GoodsIssueService;
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

  const validIssueDto = {
    company_id: 'co-1',
    warehouse_id: 'wh-1',
    posting_date: '2026-01-01',
    lines: [{ item_id: 'item-1', quantity: 5, uom: 'KG' }],
  };

  beforeEach(async () => {
    rows.clear();
    capturedWhere = undefined;
    rows.set(schema.goodsIssue, []);
    rows.set(schema.goodsIssueLine, []);
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
        GoodsIssueService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: InventoryLedgerService, useValue: { writeNegativeEntry: jest.fn().mockResolvedValue({ entry_no: 1 }) } },
        { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<GoodsIssueService>(GoodsIssueService);
  });

  describe('farm scope', () => {
    const grasmere = { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };

    it('lists only issues from warehouses on the active farm', async () => {
      useFarmScope(cls, grasmere);
      await service.findAll({} as any, 'tenant-1');
      expect(renderedWhere()).toContain('location_master lf');
    });

    it('puts the active-farm condition on issue detail reads', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.goodsIssue, [{ issue_id: 'gi-1' }]);
      await service.findOne('gi-1');
      expect(renderedWhere()).toContain('location_master lf');
    });

    it('bounds issues by company when an operational admin selects no farm', async () => {
      useFarmScope(cls, { ...grasmere, farmId: null });
      await service.findAll({} as any, 'tenant-1');
      expect(renderedWhere()).toContain('`goods_issue`.`company_id` = ?');
    });

    it('refuses issuing from a warehouse on another farm', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.locationMaster, [{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig' }]);
      await expect(service.create({ ...validIssueDto, warehouse_id: 'store-k' } as any, 'tenant-1'))
        .rejects.toThrow('Warehouse is not on your active farm.');
    });
  });
});
