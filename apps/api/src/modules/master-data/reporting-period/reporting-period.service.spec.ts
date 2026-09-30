import { BadRequestException, ConflictException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { ReportingPeriodService } from './reporting-period.service';

describe('ReportingPeriodService', () => {
  const selectQueue: unknown[][] = [];
  const events: string[] = [];
  const lockedConditions: unknown[] = [];
  const chain = (rows: unknown[]) => {
    let condition: unknown;
    const self: any = {
      from: () => self,
      where: (next: unknown) => { condition = next; return self; },
      orderBy: () => self,
      offset: () => self,
      limit: async () => rows,
      for: (mode: string) => { events.push(`lock:${mode}`); lockedConditions.push(condition); return self; },
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    };
    return self;
  };
  const values = jest.fn(async () => undefined);
  const set = jest.fn(() => ({ where: jest.fn(async () => { events.push('update'); }) }));
  const db: any = {
    select: jest.fn(() => chain(selectQueue.shift() ?? [])),
    insert: jest.fn(() => ({ values })),
    update: jest.fn(() => ({ set })),
    transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      events.push('transaction');
      return work(db);
    }),
  };
  const service = new ReportingPeriodService(transactionCls(db), { log: jest.fn() } as any);
  const september = { company_id: 'co-1', period_code: '2026-09', start_date: '2026-08-30', end_date: '2026-09-26' };

  beforeEach(() => {
    selectQueue.length = 0;
    values.mockClear();
    db.select.mockClear();
    db.insert.mockClear();
    db.update.mockClear();
    db.transaction.mockClear();
    set.mockClear();
    events.length = 0;
    lockedConditions.length = 0;
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
    expect(rows[0]).toMatchObject({
      company_id: 'co-1', period_code: '2026-07', start_date: '2026-06-28', end_date: '2026-07-25',
      status: 'DRAFT', is_active: false,
    });
  });

  it('revalidates an edited draft before explicit activation', async () => {
    const invalid = {
      period_id: 'p9', tenant_id: 'tenant-1', company_id: 'co-1', period_code: '2026-09',
      start_date: '2026-08-30', end_date: '2026-09-25', stock_take_date: '2026-09-25',
      production_start_date: '2026-09-26', business_year: '2026-27', status: 'DRAFT', is_active: false,
    };
    selectQueue.push([invalid], [invalid]);

    await expect(service.activate('p9', 'tenant-1', { userId: 'u' })).rejects.toThrow(BadRequestException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('refuses explicit activation when the reviewed draft overlaps an active period', async () => {
    const draft = {
      period_id: 'p9', tenant_id: 'tenant-1', company_id: 'co-1', period_code: '2026-09',
      start_date: '2026-08-30', end_date: '2026-09-26', stock_take_date: '2026-09-26',
      production_start_date: '2026-09-27', business_year: '2026-27', status: 'DRAFT', is_active: false,
    };
    selectQueue.push([draft], [draft, {
      period_id: 'p8', tenant_id: 'tenant-1', company_id: 'co-1', period_code: 'AUG-26',
      start_date: '2026-08-01', end_date: '2026-09-05', stock_take_date: '2026-09-05',
      production_start_date: '2026-09-06', business_year: '2026-27', status: 'ACTIVE', is_active: true,
    }]);

    await expect(service.activate('p9', 'tenant-1', { userId: 'u' })).rejects.toThrow(ConflictException);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('activates a valid reviewed draft only through the explicit action', async () => {
    const draft = {
      period_id: 'p9', tenant_id: 'tenant-1', company_id: 'co-1', period_code: '2026-09',
      start_date: '2026-08-30', end_date: '2026-09-26', stock_take_date: '2026-09-26',
      production_start_date: '2026-09-27', business_year: '2026-27', status: 'DRAFT', is_active: false,
    };
    selectQueue.push([draft], [draft], [{ ...draft, status: 'ACTIVE', is_active: true }]);

    await service.activate('p9', 'tenant-1', { userId: 'u' });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE', is_active: true, updated_by: 'u' }));
  });

  it('locks the exact tenant/company calendar inside a transaction before validating and updating', async () => {
    const draft = {
      period_id: 'p9', tenant_id: 'tenant-1', company_id: 'co-1', period_code: '2026-09',
      start_date: '2026-08-30', end_date: '2026-09-26', stock_take_date: '2026-09-26',
      production_start_date: '2026-09-27', business_year: '2026-27', status: 'DRAFT', is_active: false,
    };
    selectQueue.push([draft], [draft], [{ ...draft, status: 'ACTIVE', is_active: true }]);

    await service.activate('p9', 'tenant-1', { userId: 'u' });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(expect.arrayContaining(['transaction', 'lock:update', 'update']));
    expect(events.indexOf('transaction')).toBeLessThan(events.indexOf('lock:update'));
    expect(events.indexOf('lock:update')).toBeLessThan(events.indexOf('update'));
    expect(lockedConditions).toHaveLength(1);
    const locked = new MySqlDialect().sqlToQuery(lockedConditions[0] as any);
    expect(locked.sql).toMatch(/`tenant_id` = .*`company_id` = .*`deleted_at` is null/);
    expect(locked.params).toEqual(['tenant-1', 'co-1']);
  });

  it('re-reads the target under the company lock and does not update when it disappeared', async () => {
    const draft = {
      period_id: 'p9', tenant_id: 'tenant-1', company_id: 'co-1', period_code: '2026-09',
      start_date: '2026-08-30', end_date: '2026-09-26', stock_take_date: '2026-09-26',
      production_start_date: '2026-09-27', business_year: '2026-27', status: 'DRAFT', is_active: false,
    };
    selectQueue.push([draft], []);

    await expect(service.activate('p9', 'tenant-1', { userId: 'u' }))
      .rejects.toThrow('Reporting period is not available in this workspace.');

    expect(events).toContain('lock:update');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('does not overwrite an edited draft when generation is repeated', async () => {
    selectQueue.push([{
      period_id: 'p9', period_code: '2026-09', start_date: '2026-08-23', end_date: '2026-09-26',
      stock_take_date: '2026-09-20', is_active: false, status: 'DRAFT',
    }]);

    const out = await service.generate({ company_id: 'co-1', business_year_start: 2026 }, 'tenant-1', { userId: 'u' });

    expect(out.created).not.toContain('2026-09');
    expect(out.skipped).toContainEqual({ period_code: '2026-09', reason: 'already exists' });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('does not duplicate an equivalent draft whose reviewer changed only its code', async () => {
    selectQueue.push([{
      period_id: 'p9', period_code: 'SEP-26', start_date: '2026-08-30', end_date: '2026-09-26',
      stock_take_date: '2026-09-26', production_start_date: '2026-09-27', is_active: false, status: 'DRAFT',
    }]);

    const out = await service.generate({ company_id: 'co-1', business_year_start: 2026 }, 'tenant-1', { userId: 'u' });

    expect(out.created).not.toContain('2026-09');
    expect(out.skipped).toContainEqual({ period_code: '2026-09', reason: 'equivalent draft exists as SEP-26' });
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
