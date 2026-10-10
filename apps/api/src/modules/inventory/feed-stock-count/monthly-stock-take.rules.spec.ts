import {
  assertPeriodCanClose, assertPostableOnce, assertStockTakePeriod, buildMonthlyLines, periodCloseBlockers, reopenPatch, stockTakeNo,
} from './monthly-stock-take.rules';
import { approvalRoute, assertVarianceReason, varianceFact } from './feed-stock-count.rules';
import { assertPeriodWindowOpen, assertPostingPeriodOpen, closedPeriodFor } from '../../../common/period-close';

const period = { period_id: 'P-SEP', period_code: '2026-09', stock_take_date: '2026-09-26', period_status: 'OPEN' };
const currency = { baseCurrencyId: 'USD', localCurrencyId: null, rate: { status: 'RESOLVED' as const, rateId: null, rate: 1, rateDate: null, createdAt: null, scope: 'IDENTITY' as const } };

describe('Monthly stock take — creation', () => {
  it('numbers farm and mill takes per r30', () => {
    expect(stockTakeNo('FARM', 'F01', 2026, 7)).toBe('ST-F01-2026-00007');
    expect(stockTakeNo('FEED_MILL', 'IGNORED', 2026, 12)).toBe('ST-MILL-2026-00012');
  });

  it('creates a line for EVERY active silo and bin with its system balance at the date, 0 when none', () => {
    const bins = [
      { location_id: 'SILO-1', item_id: 'GROWER', is_active: true },
      { location_id: 'SILO-2', item_id: 'FINISHER', is_active: true },
      { location_id: 'BIN-1', item_id: 'STARTER', is_active: true },
      { location_id: 'SILO-OLD', item_id: 'GROWER', is_active: false },
      { location_id: 'SILO-EMPTY', item_id: null, is_active: true },
    ];
    const balances: Record<string, number> = { 'SILO-1|GROWER': 1200, 'BIN-1|STARTER': 40.5 };
    const { lines, skipped } = buildMonthlyLines(bins, (l, i) => balances[`${l}|${i}`] ?? 0);
    expect(lines).toEqual([
      { silo_id: 'SILO-1', item_id: 'GROWER', system_qty_kg: 1200, counted_qty_kg: null },
      { silo_id: 'SILO-2', item_id: 'FINISHER', system_qty_kg: 0, counted_qty_kg: null },
      { silo_id: 'BIN-1', item_id: 'STARTER', system_qty_kg: 40.5, counted_qty_kg: null },
    ]);
    expect(skipped).toEqual(['SILO-EMPTY']);
  });

  it('is refused when the period does not exist (r40) or is closed', () => {
    expect(() => assertStockTakePeriod(null)).toThrow(/does not exist/);
    expect(() => assertStockTakePeriod({ ...period, period_status: 'CLOSED' })).toThrow(/closed/);
    expect(assertStockTakePeriod(period)).toBe(period);
  });
});

describe('Monthly stock take — variance and reason (reuses the weekly count rules)', () => {
  it('computes variance KG and percent and requires a reason for any nonzero variance', () => {
    const fact = varianceFact(1000, 940, null, currency);
    expect(fact.varianceQty).toBe(-60);
    expect(fact.variancePctAbsolute).toBe(6);
    expect(() => assertVarianceReason(fact, null)).toThrow(/Reason/);
    expect(() => assertVarianceReason(fact, 'R-SPILL')).not.toThrow();
    expect(() => assertVarianceReason(varianceFact(1000, 1000, null, currency), null)).not.toThrow();
  });

  it('escalates to Finance at >= 5% with no monetary threshold (decisions 1 Oct)', () => {
    expect(approvalRoute([{ variancePctAbsolute: 5, varianceValueBase: null }], { percentageThreshold: 5, amountThreshold: null })).toBe('FINANCE');
    expect(approvalRoute([{ variancePctAbsolute: 4.99, varianceValueBase: null }], { percentageThreshold: 5, amountThreshold: null })).toBe('FARM_MANAGER');
  });
});

describe('Monthly stock take — posting happens exactly once', () => {
  it('posts an approved take and refuses a second posting or an unapproved one', () => {
    expect(() => assertPostableOnce({ status: 'APPROVED', stock_adjustment_id: null })).not.toThrow();
    expect(() => assertPostableOnce({ status: 'POSTED', stock_adjustment_id: 'ADJ-1' })).toThrow(/already been posted/);
    expect(() => assertPostableOnce({ status: 'APPROVED', stock_adjustment_id: 'ADJ-1' })).toThrow(/already been posted/);
    expect(() => assertPostableOnce({ status: 'PENDING_APPROVAL', stock_adjustment_id: null })).toThrow(/Only an approved/);
  });
});

describe('Period close (r31)', () => {
  const locations = [{ location_id: 'F01', code: 'F01' }, { location_id: 'F02', code: 'F02' }, { location_id: 'MILL', code: 'MILL' }];
  const posted = (farm_id: string, status = 'POSTED', count_type = 'MONTHLY', reporting_period_id: string | null = 'P-SEP') =>
    ({ farm_id, status, count_type, reporting_period_id });

  it('is refused while any farm or the mill lacks a POSTED monthly stock take', () => {
    const takes = [posted('F01'), posted('F02', 'APPROVED'), posted('MILL', 'POSTED', 'WEEKLY', null), posted('MILL', 'POSTED', 'MONTHLY', 'P-AUG')];
    expect(periodCloseBlockers('P-SEP', locations, takes).map((l) => l.code)).toEqual(['F02', 'MILL']);
    expect(() => assertPeriodCanClose(period, locations, takes)).toThrow(/cannot close: no posted monthly stock take for F02, MILL/);
  });

  it('is allowed when every location has one', () => {
    expect(() => assertPeriodCanClose(period, locations, [posted('F01'), posted('F02'), posted('MILL')])).not.toThrow();
  });
});

describe('Closed period blocks postings dated in it (r32) — one shared guard', () => {
  const periods = [
    { period_code: '2026-08', start_date: '2026-07-26', end_date: '2026-08-29', period_status: 'OPEN' },
    { period_code: '2026-09', start_date: '2026-08-30', end_date: '2026-09-26', period_status: 'CLOSED' },
  ];

  it('blocks dates inside a closed period, inclusive of both ends, and nothing else', () => {
    expect(closedPeriodFor(periods, '2026-08-30')?.period_code).toBe('2026-09');
    expect(() => assertPeriodWindowOpen(periods, '2026-09-26T10:00:00Z')).toThrow(/2026-09 .* is closed/);
    expect(() => assertPeriodWindowOpen(periods, '2026-08-29')).not.toThrow();
    expect(() => assertPeriodWindowOpen(periods, '2026-09-27')).not.toThrow();
  });

  it('the DB guard reads CLOSED periods covering the date and refuses', async () => {
    const where = jest.fn().mockResolvedValue([periods[1]]);
    const db = { select: jest.fn(() => ({ from: () => ({ where }) })) };
    await expect(assertPostingPeriodOpen(db, { tenantId: 'T', companyId: 'C', postingDate: '2026-09-10' })).rejects.toThrow(/closed/);
    where.mockResolvedValue([]);
    await expect(assertPostingPeriodOpen(db, { tenantId: 'T', companyId: 'C', postingDate: '2026-10-01' })).resolves.toBeUndefined();
  });
});

describe('Reopen', () => {
  const closed = { ...period, period_status: 'CLOSED' };
  it('requires an administrator and a reason', () => {
    expect(() => reopenPatch(closed, { userId: 'U', isAdmin: false }, 'recount', 'now')).toThrow(/Only an administrator/);
    expect(() => reopenPatch(closed, { userId: 'A', isAdmin: true }, '  ', 'now')).toThrow(/reason is required/);
    expect(() => reopenPatch(period, { userId: 'A', isAdmin: true }, 'x', 'now')).toThrow(/not closed/);
    expect(reopenPatch(closed, { userId: 'A', isAdmin: true }, ' Silo 2 recount ', '2026-10-02 09:00:00'))
      .toEqual({ period_status: 'OPEN', reopened_by: 'A', reopened_at: '2026-10-02 09:00:00', reopen_reason: 'Silo 2 recount' });
  });
});
