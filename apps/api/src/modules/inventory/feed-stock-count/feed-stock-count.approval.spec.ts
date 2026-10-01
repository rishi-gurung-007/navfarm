import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { approvalRoute } from './feed-stock-count.rules';
import { FEED_STOCK_COUNT_APPROVAL_DOC_TYPE, FeedStockCountService } from './feed-stock-count.service';

type Log = { op: string; table: unknown; values?: any; set?: any; lock?: string };

type AdjustmentInput = {
  company_id: string;
  warehouse_id: string;
  posting_date: string;
  reason?: string;
  remarks?: string;
  lines: Array<{ item_id: string; quantity: number; uom: string; rate?: number; remarks?: string }>;
};

const farm = { location_id: 'farm-1', company_id: 'company-1', nob_id: 'nob-livestock', lob_id: 'lob-piggery' };
const scope: FarmScope = { farmId: 'farm-1', companyId: 'company-1', lobId: 'lob-piggery', restricted: true };

const GRANT = {
  moduleCode: 'INVENTORY', resource: 'STOCK_COUNT',
  canView: true, canCreate: true, canEdit: true, canDelete: false, canApprove: true, canExport: false, canPrint: false,
};
const FINANCE_GRANT = { ...GRANT, moduleCode: 'FINANCE', resource: 'STOCK_VARIANCE', canCreate: false, canEdit: false };

function setup(options: {
  count: any;
  lines?: any[];
  permissionRows?: any[];
  settings?: any;
} ) {
  const log: Log[] = [];
  const readers = new Map<unknown, () => unknown[]>();
  readers.set(schema.feedStockCount, () => [options.count]);
  readers.set(schema.locationMaster, () => [farm]);
  readers.set(schema.feedStockCountLine, () => options.lines ?? []);
  readers.set(schema.userRoleAssignment, () => options.permissionRows ?? [GRANT]);

  const db: any = {
    transaction: jest.fn(async (work: (tx: any) => Promise<unknown>) => {
      const before = JSON.parse(JSON.stringify(options.count));
      try {
        return await work(db);
      } catch (error) {
        Object.keys(options.count).forEach((key) => delete options.count[key]);
        Object.assign(options.count, before);
        throw error;
      }
    }),
    select: jest.fn(() => {
      const entry: Log = { op: 'select', table: undefined };
      log.push(entry);
      const chain: any = {
        from: (table: unknown) => { entry.table = table; return chain; },
        innerJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        for: (lock: string) => { entry.lock = lock; return chain; },
        then: (ok: any, fail: any) => Promise.resolve(readers.get(entry.table)?.() ?? []).then(ok, fail),
      };
      return chain;
    }),
    insert: jest.fn((table: unknown) => ({
      values: jest.fn(async (values: unknown) => { log.push({ op: 'insert', table, values }); }),
    })),
    update: jest.fn((table: unknown) => ({
      set: jest.fn((set: any) => ({
        where: jest.fn(async () => {
          log.push({ op: 'update', table, set });
          if (table === schema.feedStockCount) Object.assign(options.count, set);
        }),
      })),
    })),
  };

  const cls = transactionCls(db);
  const originalGet = cls.get.bind(cls);
  cls.get = ((key?: string) => (key === FARM_SCOPE_KEY ? scope : originalGet(key as any))) as typeof cls.get;

  const ledger = { getSiloStockEvidenceAsOf: jest.fn(async () => []) };
  const settings = {
    resolve: jest.fn(async () => ({
      timezoneId: 'Africa/Harare',
      physicalCountWeekday: 0,
      physicalCountTime: '08:00',
      financeVariancePct: options.settings?.financeVariancePct ?? 5,
      financeVarianceAmount: options.settings?.financeVarianceAmount ?? null,
    })),
  };
  const currency = { currentRate: jest.fn(async () => ({ status: 'RESOLVED', rateId: 'rate-1', rate: 1, rateDate: '2026-10-01', createdAt: '2026-10-01 08:00:00', scope: 'COMPANY' })) };
  const reasons = { findActiveForOperationalScope: jest.fn(async (id: string) => ({ reason_id: id })) };

  const handlers: Record<string, any> = {};
  const approvals = {
    registerDocumentHandler: jest.fn((docType: string, handler: any) => { handlers[docType] = handler; }),
    submitFarmDocument: jest.fn(async () => 'request-1'),
  };
  let adjustmentSeq = 0;
  const adjustments = {
    create: jest.fn(async (input: AdjustmentInput): Promise<{ adjustment_id: string }> => {
      adjustmentSeq += 1;
      void input;
      return { adjustment_id: `adj-${adjustmentSeq}` };
    }),
    post: jest.fn(async (adjustmentId: string, tenantId: string, actor?: { userId?: string }) => {
      void adjustmentId; void tenantId; void actor;
      return undefined;
    }),
  };
  const feedAlerts = { evaluateFarmSafely: jest.fn(async () => undefined) };

  const service = new FeedStockCountService(
    cls, ledger as any, settings as any, currency as any, reasons as any,
    approvals as any, adjustments as any, feedAlerts as any,
  );
  service.onModuleInit();

  return { service, handlers, approvals, adjustments, feedAlerts, ledger, settings, currency, reasons, log, db, count: options.count };
}

const pendingCount = (over: any = {}) => ({
  count_id: 'count-1', count_no: 'FSC-farm-1-1791185400',
  tenant_id: 'tenant-1', company_id: 'company-1', farm_id: 'farm-1',
  counted_at: '2026-10-05 07:30:00', schedule_source: 'SCHEDULED', status: 'PENDING_APPROVAL',
  approval_request_id: 'request-1', stock_adjustment_id: null,
  created_by: 'worker-1', submitted_by: 'worker-1',
  ...over,
});

const varianceLine = (over: any = {}) => ({
  count_line_id: 'line-1', count_id: 'count-1', silo_id: 'silo-1', item_id: 'item-1',
  system_qty_kg: '100', counted_qty_kg: '95', variance_qty_kg: '-5', variance_pct_absolute: '5',
  reason_id: 'reason-1', unit_cost_base: '4', variance_value_base: '-20',
  base_currency_id: 'base', local_currency_id: 'local', rate_id: 'rate-1',
  rate_snapshot: {
    status: 'RESOLVED', rateId: 'rate-1', rate: 1, rateDate: '2026-10-01',
    createdAt: '2026-10-01 08:00:00', scope: 'COMPANY',
  },
  monetary_status: 'RESOLVED', uom: 'KG',
  ...over,
});

describe('physical count approval routing (pure rule)', () => {
  const config = { percentageThreshold: 5, amountThreshold: null };

  it('routes a variance below the configured percentage to Farm Manager approval', () => {
    expect(approvalRoute([{ variancePctAbsolute: 4.9999, varianceValueBase: -19.99 }], config)).toBe('FARM_MANAGER');
  });

  it('routes an exactly-threshold variance to Finance approval', () => {
    expect(approvalRoute([{ variancePctAbsolute: 5, varianceValueBase: -20 }], config)).toBe('FINANCE');
  });

  it('routes an above-threshold variance to Finance approval', () => {
    expect(approvalRoute([{ variancePctAbsolute: 12.5, varianceValueBase: -50 }], config)).toBe('FINANCE');
  });

  it('routes a count with no variance to Farm Manager approval', () => {
    expect(approvalRoute([{ variancePctAbsolute: 0, varianceValueBase: 0 }], config)).toBe('FARM_MANAGER');
  });

  it('uses the most demanding line rather than the first one', () => {
    expect(approvalRoute([
      { variancePctAbsolute: 1, varianceValueBase: -4 },
      { variancePctAbsolute: 7, varianceValueBase: -28 },
      { variancePctAbsolute: 2, varianceValueBase: -8 },
    ], config)).toBe('FINANCE');
  });

  it('routes on the configured monetary threshold when every valuation is available', () => {
    expect(approvalRoute(
      [{ variancePctAbsolute: 1, varianceValueBase: -400 }],
      { percentageThreshold: 5, amountThreshold: 400 },
    )).toBe('FINANCE');
    expect(approvalRoute(
      [{ variancePctAbsolute: 1, varianceValueBase: -399.99 }],
      { percentageThreshold: 5, amountThreshold: 400 },
    )).toBe('FARM_MANAGER');
  });

  it('blocks a Finance-dependent decision when the amount threshold is configured but a valuation is missing', () => {
    expect(() => approvalRoute(
      [{ variancePctAbsolute: 1, varianceValueBase: null }],
      { percentageThreshold: 5, amountThreshold: 400 },
    )).toThrow(BadRequestException);
  });

  it('does not block on a missing valuation while the monetary threshold is unconfigured', () => {
    expect(approvalRoute([{ variancePctAbsolute: 1, varianceValueBase: null }], config)).toBe('FARM_MANAGER');
  });

  it('does not let a missing valuation hide behind an already-triggered percentage', () => {
    expect(approvalRoute([
      { variancePctAbsolute: 9, varianceValueBase: null },
    ], { percentageThreshold: 5, amountThreshold: 400 })).toBe('FINANCE');
  });

  it('ignores zero-variance lines when evaluating the monetary threshold', () => {
    expect(approvalRoute([
      { variancePctAbsolute: 0, varianceValueBase: null },
      { variancePctAbsolute: 1, varianceValueBase: -10 },
    ], { percentageThreshold: 5, amountThreshold: 400 })).toBe('FARM_MANAGER');
  });
});

describe('FeedStockCountService approval and posting', () => {
  it('registers one FEED_STOCK_VARIANCE handler with the approval engine', () => {
    const { approvals, handlers } = setup({ count: pendingCount() });
    expect(approvals.registerDocumentHandler).toHaveBeenCalledWith(
      FEED_STOCK_COUNT_APPROVAL_DOC_TYPE, expect.objectContaining({ decide: expect.any(Function), withdraw: expect.any(Function) }),
    );
    expect(Object.keys(handlers)).toEqual([FEED_STOCK_COUNT_APPROVAL_DOC_TYPE]);
  });

  it('raises one farm approval request on submit and stores it on the count', async () => {
    const { service, approvals, log } = setup({ count: pendingCount({ status: 'DRAFT', approval_request_id: null }), lines: [varianceLine()] });
    await expect(service.submit('count-1', 'tenant-1', { userId: 'worker-1', userType: 'STANDARD_USER' }))
      .resolves.toMatchObject({ status: 'PENDING_APPROVAL', approval_request_id: 'request-1' });
    expect(approvals.submitFarmDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentType: FEED_STOCK_COUNT_APPROVAL_DOC_TYPE,
      documentId: 'count-1',
      documentNo: 'FSC-farm-1-1791185400',
      farmId: 'farm-1',
      companyId: 'company-1',
    }), 'tenant-1', expect.objectContaining({ userId: 'worker-1' }));
    const update = log.find((entry) => entry.op === 'update' && entry.table === schema.feedStockCount)?.set;
    expect(update).toMatchObject({ status: 'PENDING_APPROVAL', approval_request_id: 'request-1' });
    expect(log.some((entry) => entry.table === schema.stockAdjustment || entry.table === schema.inventoryLedger)).toBe(false);
  });

  it('refuses to let a submitter decide their own count', async () => {
    const { handlers } = setup({ count: pendingCount({ created_by: 'worker-1', submitted_by: 'worker-1' }), lines: [varianceLine()] });
    await expect(handlers[FEED_STOCK_COUNT_APPROVAL_DOC_TYPE].decide(
      { document_id: 'count-1', requested_by: 'worker-1' }, 'APPROVED', null, 'tenant-1', { userId: 'worker-1' },
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a Farm Manager approve a below-threshold count', async () => {
    const { handlers, count } = setup({ count: pendingCount(), lines: [varianceLine({ variance_pct_absolute: '4.5' })] });
    await handlers[FEED_STOCK_COUNT_APPROVAL_DOC_TYPE].decide(
      { document_id: 'count-1', requested_by: 'worker-1' }, 'APPROVED', 'ok', 'tenant-1', { userId: 'manager-1', userType: 'FARM_MANAGER' },
    );
    expect(count).toMatchObject({ status: 'APPROVED', approved_by: 'manager-1' });
    expect(count.approved_at).toBeDefined();
  });

  it('refuses a Farm Manager approving a Finance-escalated count', async () => {
    const { handlers, count } = setup({ count: pendingCount(), lines: [varianceLine({ variance_pct_absolute: '5' })] });
    await expect(handlers[FEED_STOCK_COUNT_APPROVAL_DOC_TYPE].decide(
      { document_id: 'count-1', requested_by: 'worker-1' }, 'APPROVED', null, 'tenant-1', { userId: 'manager-1', userType: 'FARM_MANAGER' },
    )).rejects.toThrow(/Finance/i);
    expect(count.status).toBe('PENDING_APPROVAL');
  });

  it('lets Finance approve a threshold count', async () => {
    const { handlers, count } = setup({
      count: pendingCount(),
      lines: [varianceLine({ variance_pct_absolute: '5' })],
      permissionRows: [FINANCE_GRANT],
    });
    await handlers[FEED_STOCK_COUNT_APPROVAL_DOC_TYPE].decide(
      { document_id: 'count-1', requested_by: 'worker-1' }, 'APPROVED', null, 'tenant-1', { userId: 'finance-1', userType: 'STANDARD_USER' },
    );
    expect(count.status).toBe('APPROVED');
  });

  it('records a rejection as REJECTED and keeps the count correctable', async () => {
    const { handlers, count, service } = setup({
      count: pendingCount(),
      lines: [varianceLine({ variance_pct_absolute: '4.5', variance_qty_kg: '-4.5' })],
    });
    await handlers[FEED_STOCK_COUNT_APPROVAL_DOC_TYPE].decide(
      { document_id: 'count-1', requested_by: 'worker-1' }, 'REJECTED', 'recount the silo', 'tenant-1', { userId: 'manager-1' },
    );
    expect(count.status).toBe('REJECTED');
    await service.update('count-1', { lines: [{ countLineId: 'line-1', countedQtyKg: 96, reasonId: 'reason-1' }] } as any, 'tenant-1', { userId: 'worker-1' });
    await expect(service.submit('count-1', 'tenant-1', { userId: 'worker-1' })).resolves.toMatchObject({ status: 'PENDING_APPROVAL' });
  });

  it('refuses a rejection without a reason', async () => {
    const { handlers, count } = setup({
      count: pendingCount(),
      lines: [varianceLine({ variance_pct_absolute: '4.5', variance_qty_kg: '-4.5' })],
    });
    await expect(handlers[FEED_STOCK_COUNT_APPROVAL_DOC_TYPE].decide(
      { document_id: 'count-1', requested_by: 'worker-1' }, 'REJECTED', null, 'tenant-1', { userId: 'manager-1' },
    )).rejects.toThrow(/reason/i);
    expect(count.status).toBe('PENDING_APPROVAL');
  });

  it('hands a withdrawn count back to DRAFT with no open request', async () => {
    const { handlers, count } = setup({ count: pendingCount(), lines: [varianceLine()] });
    await handlers[FEED_STOCK_COUNT_APPROVAL_DOC_TYPE].withdraw(
      { document_id: 'count-1' }, 'tenant-1', { userId: 'worker-1' },
    );
    expect(count).toMatchObject({ status: 'DRAFT', approval_request_id: null });
  });

  it('refuses to post a count that has not completed its approval path', async () => {
    const { service, adjustments } = setup({ count: pendingCount({ status: 'PENDING_APPROVAL' }), lines: [varianceLine()] });
    await expect(service.postApprovedCount('count-1', 'tenant-1', { userId: 'manager-1' }))
      .rejects.toThrow(/approved/i);
    expect(adjustments.create).not.toHaveBeenCalled();
  });

  it('creates and posts one adjustment per silo and marks the count POSTED', async () => {
    const { service, adjustments, feedAlerts, count, log } = setup({
      count: pendingCount({ status: 'APPROVED' }),
      lines: [
        varianceLine({ count_line_id: 'line-1', silo_id: 'silo-1', variance_qty_kg: '-5', variance_pct_absolute: '5' }),
        varianceLine({ count_line_id: 'line-2', silo_id: 'silo-2', variance_qty_kg: '8', variance_pct_absolute: '8', reason_id: 'reason-1' }),
        varianceLine({ count_line_id: 'line-3', silo_id: 'silo-2', variance_qty_kg: '0', variance_pct_absolute: '0', reason_id: null }),
      ],
    });
    await expect(service.postApprovedCount('count-1', 'tenant-1', { userId: 'manager-1' }))
      .resolves.toMatchObject({ status: 'POSTED', stock_adjustment_ids: ['adj-1', 'adj-2'] });

    expect(adjustments.create).toHaveBeenCalledTimes(2);
    expect(adjustments.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      company_id: 'company-1', warehouse_id: 'silo-1', posting_date: '2026-10-05',
      lines: [expect.objectContaining({ item_id: 'item-1', quantity: -5, uom: 'KG' })],
    }), 'tenant-1', expect.objectContaining({ userId: 'manager-1' }));
    expect(adjustments.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      warehouse_id: 'silo-2',
      lines: [expect.objectContaining({ item_id: 'item-1', quantity: 8, rate: 4 })],
    }), 'tenant-1', expect.anything());
    expect(adjustments.post).toHaveBeenCalledTimes(2);
    expect(adjustments.create.mock.calls[0][0].remarks).toContain('FSC-farm-1-1791185400');
    expect(count).toMatchObject({ status: 'POSTED', stock_adjustment_id: 'adj-1', posted_by: 'manager-1' });
    expect(log.some((entry) => entry.op === 'insert')).toBe(false);
    expect(feedAlerts.evaluateFarmSafely).toHaveBeenCalledWith('farm-1', 'company-1', 'tenant-1');
  });

  it('posts a zero-variance count without inventing an adjustment document', async () => {
    const { service, adjustments, count } = setup({
      count: pendingCount({ status: 'APPROVED' }),
      lines: [varianceLine({ variance_qty_kg: '0', variance_pct_absolute: '0', reason_id: null })],
    });
    await expect(service.postApprovedCount('count-1', 'tenant-1', { userId: 'manager-1' }))
      .resolves.toMatchObject({ status: 'POSTED', stock_adjustment_ids: [] });
    expect(adjustments.create).not.toHaveBeenCalled();
    expect(count.stock_adjustment_id).toBeNull();
  });

  it('is idempotent when the count is posted twice', async () => {
    const { service, adjustments, count } = setup({
      count: pendingCount({ status: 'APPROVED' }), lines: [varianceLine()],
    });
    await service.postApprovedCount('count-1', 'tenant-1', { userId: 'manager-1' });
    await expect(service.postApprovedCount('count-1', 'tenant-1', { userId: 'manager-1' }))
      .resolves.toMatchObject({ status: 'POSTED', already_posted: true });
    expect(adjustments.create).toHaveBeenCalledTimes(1);
    expect(adjustments.post).toHaveBeenCalledTimes(1);
    expect(count.status).toBe('POSTED');
  });

  it('leaves the count approved but unposted with no partial evidence when posting fails', async () => {
    const { service, adjustments, feedAlerts, count } = setup({
      count: pendingCount({ status: 'APPROVED' }), lines: [varianceLine()],
    });
    adjustments.post.mockRejectedValueOnce(new Error('GL unavailable'));
    await expect(service.postApprovedCount('count-1', 'tenant-1', { userId: 'manager-1' })).rejects.toThrow('GL unavailable');
    expect(count.status).toBe('APPROVED');
    expect(count.stock_adjustment_id).toBeNull();
    expect(feedAlerts.evaluateFarmSafely).not.toHaveBeenCalled();
    await expect(service.postApprovedCount('count-1', 'tenant-1', { userId: 'manager-1' })).resolves.toMatchObject({ status: 'POSTED' });
  });

  it('blocks a positive variance whose item carries no cost evidence instead of posting at zero', async () => {
    const { service, adjustments } = setup({
      count: pendingCount({ status: 'APPROVED' }),
      lines: [varianceLine({ unit_cost_base: null, variance_value_base: null, monetary_status: 'MISSING_COST', variance_qty_kg: '8', variance_pct_absolute: '8' })],
    });
    await expect(service.postApprovedCount('count-1', 'tenant-1', { userId: 'manager-1' }))
      .rejects.toThrow(/cost/i);
    expect(adjustments.create).not.toHaveBeenCalled();
  });

  it('requires an authenticated actor and keeps the count inside the authorized farm', async () => {
    const { service, adjustments } = setup({ count: pendingCount({ status: 'APPROVED' }), lines: [varianceLine()] });
    await expect(service.postApprovedCount('count-1', 'tenant-1', undefined)).rejects.toThrow(/authenticated/i);
    await expect(service.postApprovedCount('count-1', 'tenant-1', { userId: 'worker-1' })).resolves.toBeDefined();
    expect(adjustments.create).toHaveBeenCalled();
  });
});
