import { transactionCls } from '../../../test-utils/transaction-cls';
import { CurrencyService } from './currency.service';

function databaseWithRows(rows: unknown[]) {
  const select = jest.fn(() => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => rows,
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  });
  return { db: { select }, select };
}

function databaseWithAnswers(...answers: unknown[][]) {
  const queue = [...answers];
  const inserted: Record<string, unknown>[] = [];
  const select = jest.fn(() => {
    const rows = queue.shift() ?? [];
    const chain: any = { from: () => chain, where: () => chain, limit: async () => rows };
    return chain;
  });
  return {
    db: {
      select,
      insert: jest.fn(() => ({ values: async (value: Record<string, unknown>) => { inserted.push(value); } })),
    },
    inserted,
    select,
  };
}

describe('CurrencyService.currentRate', () => {
  it('prefers company-scoped data, then newest rate date and created-at tie-break', async () => {
    const { db } = databaseWithRows([
      { rate_id: 'legacy-newer', company_id: null, rate: '99', rate_date: '2026-10-01', created_at: '2026-10-01 12:00:00' },
      { rate_id: 'company-old', company_id: 'co-1', rate: '20', rate_date: '2026-09-30', created_at: '2026-09-30 08:00:00' },
      { rate_id: 'company-new-a', company_id: 'co-1', rate: '21', rate_date: '2026-10-01', created_at: '2026-10-01 08:00:00' },
      { rate_id: 'company-new-b', company_id: 'co-1', rate: '22', rate_date: '2026-10-01', created_at: '2026-10-01 09:00:00' },
    ]);
    await expect(new CurrencyService(transactionCls(db)).currentRate('co-1', 'base', 'local')).resolves.toEqual({
      status: 'RESOLVED', rateId: 'company-new-b', rate: 22,
      rateDate: '2026-10-01', createdAt: '2026-10-01 09:00:00', scope: 'COMPANY',
    });
  });

  it('uses the newest legacy row when no company row exists', async () => {
    const { db } = databaseWithRows([
      { rate_id: 'old', company_id: null, rate: '10', rate_date: '2026-09-01', created_at: '2026-09-02 00:00:00' },
      { rate_id: 'new', company_id: null, rate: '12', rate_date: '2026-09-03', created_at: '2026-09-03 00:00:00' },
    ]);
    await expect(new CurrencyService(transactionCls(db)).currentRate('co-1', 'base', 'local')).resolves.toEqual(expect.objectContaining({ rateId: 'new', rate: 12, scope: 'LEGACY' }));
  });

  it('returns identity rate 1 without querying when currencies are equal', async () => {
    const { db, select } = databaseWithRows([]);
    await expect(new CurrencyService(transactionCls(db)).currentRate('co-1', 'same', 'same')).resolves.toEqual({
      status: 'RESOLVED', rateId: null, rate: 1, rateDate: null, createdAt: null, scope: 'IDENTITY',
    });
    expect(select).not.toHaveBeenCalled();
  });

  it('returns a typed missing-rate result instead of inventing zero or one', async () => {
    const { db } = databaseWithRows([]);
    await expect(new CurrencyService(transactionCls(db)).currentRate('co-1', 'base', 'local')).resolves.toEqual({
      status: 'MISSING_RATE', companyId: 'co-1', fromCurrencyId: 'base', toCurrencyId: 'local',
    });
  });

  it('preserves an explicit source currency without reading a company default', async () => {
    const { db, inserted, select } = databaseWithAnswers([{ rate_id: 'new-rate' }]);
    await new CurrencyService(transactionCls(db)).createRate({
      from_currency_id: 'explicit-base', to_currency_id: 'local', rate: 2,
    }, 'co-1');
    expect(inserted[0]).toEqual(expect.objectContaining({ from_currency_id: 'explicit-base', to_currency_id: 'local' }));
    expect(select).toHaveBeenCalledTimes(1); // created-row read only
  });

  it('defaults an omitted source to the active company base instead of USD', async () => {
    const { db, inserted } = databaseWithAnswers([{ base_currency_id: 'company-base' }], [{ rate_id: 'new-rate' }]);
    await new CurrencyService(transactionCls(db)).createRate({ to_currency_id: 'local', rate: 2 }, 'co-1');
    expect(inserted[0]).toEqual(expect.objectContaining({ from_currency_id: 'company-base', to_currency_id: 'local' }));
  });
});
