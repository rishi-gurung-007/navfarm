import { BadRequestException, ConflictException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { ReportingPeriodService } from './reporting-period.service';

describe('ReportingPeriodService', () => {
  const selectQueue: unknown[][] = [];
  const chain = (rows: unknown[]) => {
    const self: any = {
      from: () => self, where: () => self, orderBy: () => self, offset: () => self, limit: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    };
    return self;
  };
  const values = jest.fn(async () => undefined);
  const db = { select: jest.fn(() => chain(selectQueue.shift() ?? [])), insert: jest.fn(() => ({ values })) };
  const service = new ReportingPeriodService(transactionCls(db), { log: jest.fn() } as any);
  const september = { company_id: 'co-1', period_code: '2026-09', start_date: '2026-08-30', end_date: '2026-09-26' };

  beforeEach(() => {
    selectQueue.length = 0;
    values.mockClear();
    db.select.mockClear();
    db.insert.mockClear();
  });

  it('refuses an End Date that is not a Saturday before reading anything', async () => {
    await expect(service.create({ ...september, end_date: '2026-09-25' }, 'tenant-1', { userId: 'u' })).rejects.toThrow(BadRequestException);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('refuses a period that overlaps an active one of the same company', async () => {
    selectQueue.push([{ period_id: 'p8', period_code: '2026-08', start_date: '2026-07-26', end_date: '2026-08-30', is_active: true }]);
    await expect(service.create(september, 'tenant-1', { userId: 'u' })).rejects.toThrow(
      new ConflictException('2026-09 (2026-08-30 to 2026-09-26) overlaps 2026-08 (2026-07-26 to 2026-08-30).'),
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('refuses a code already used, even by an inactive period', async () => {
    selectQueue.push([{ period_id: 'old', period_code: '2026-09', start_date: '2025-08-31', end_date: '2025-09-27', is_active: false }]);
    await expect(service.create(september, 'tenant-1', { userId: 'u' })).rejects.toThrow(
      new ConflictException('Reporting period 2026-09 already exists for this company.'),
    );
  });

  it('derives Stock Take (= End), Production Start (End + 1) and the business year', async () => {
    selectQueue.push([], [{ period_id: 'new', ...september }]);
    await service.create(september, 'tenant-1', { userId: 'u' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      company_id: 'co-1', period_code: '2026-09', start_date: '2026-08-30', end_date: '2026-09-26',
      stock_take_date: '2026-09-26', production_start_date: '2026-09-27', business_year: '2026-27',
    }));
  });

  it('generates a year and skips the codes that exist (Q9)', async () => {
    selectQueue.push([{ period_id: 'p9', period_code: '2026-09', start_date: '2026-08-30', end_date: '2026-09-26', is_active: true }]);
    const out = await service.generate({ company_id: 'co-1', business_year_start: 2026 }, 'tenant-1', { userId: 'u' });
    expect(out.created).toHaveLength(11);
    expect(out.skipped).toEqual([{ period_code: '2026-09', reason: 'already exists' }]);
    const rows = (values.mock.calls[0] as unknown[])[0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ company_id: 'co-1', period_code: '2026-07', start_date: '2026-06-28', end_date: '2026-07-25' });
  });

  it('generate skips a period that would overlap one the admin edited by hand', async () => {
    selectQueue.push([{ period_id: 'p-custom', period_code: 'SEP-26', start_date: '2026-08-23', end_date: '2026-09-26', is_active: true }]);
    const out = await service.generate({ company_id: 'co-1', business_year_start: 2026 }, 'tenant-1', { userId: 'u' });
    expect(out.skipped).toEqual(expect.arrayContaining([
      { period_code: '2026-08', reason: 'overlaps SEP-26' },
      { period_code: '2026-09', reason: 'overlaps SEP-26' },
    ]));
  });
});
