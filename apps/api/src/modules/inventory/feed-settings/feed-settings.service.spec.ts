import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
import { FeedSettingsService } from './feed-settings.service';

function databaseWithAnswers(...answers: unknown[][]) {
  const queue = [...answers];
  const select = jest.fn(() => {
    const rows = queue.shift() ?? [];
    const chain: any = {
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: async () => rows,
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  });
  return { select, transaction: async (work: (tx: any) => unknown) => work({ select }) };
}

describe('FeedSettingsService.resolve', () => {
  it('resolves company values with the farm\'s submission and logistics overrides', async () => {
    const db = databaseWithAnswers(
      [{ company_id: 'co-1', default_timezone_id: 'Africa/Harare' }],
      [{
        setting_id: 'company-setting', farm_id: null,
        default_forecast_days: 7, max_forecast_days: 45,
        production_weekday: 0, production_shift: 'AM',
        submission_weekday: 6, submission_time: '12:00',
        reminder_weekday: 5, reminder_time: '18:00',
        physical_count_weekday: 0, physical_count_time: '08:00',
        truck_target_kg: '30000.00', bulk_multiple_kg: '3000.00',
        capacity_warning_pct: '90.00', bag_tolerance_pct: '1.00',
        finance_variance_pct: '5.00', finance_variance_amount: null,
      }, {
        setting_id: 'farm-setting', farm_id: 'farm-1',
        submission_weekday: 5, submission_time: '16:00',
        production_weekday: 4, reminder_time: '10:00',
        bulk_multiple_kg: '6000.00', safety_stock_kg: null,
      }],
      [{ location_id: 'farm-1', company_id: 'co-1', lob_id: 'lob-pig' }],
    );
    const result = await new FeedSettingsService(transactionCls(db)).resolve('co-1', 'farm-1');

    expect(result).toEqual(expect.objectContaining({
      companyId: 'co-1', farmId: 'farm-1', timezoneId: 'Africa/Harare',
      defaultForecastDays: 7, maxForecastDays: 45,
      productionWeekday: 4, productionShift: 'AM',
      submissionWeekday: 5, submissionTime: '16:00',
      reminderWeekday: 5, reminderTime: '18:00',
      physicalCountWeekday: 0, physicalCountTime: '08:00',
      bulkMultipleKg: 6000, safetyStockKg: 0, bagSizeKg: 50, truckTargetKg: 30000,
      capacityWarningPct: 90, capacityCriticalPct: 100,
      financeVariancePct: 5, financeVarianceAmount: null,
    }));
    expect(result).not.toHaveProperty('leadTimeDays'); // 3 Oct ruling 6: no lead time for internal feed (Req. row 29)
    expect(result.sources).toEqual({ logistics: 'FARM', submissionSchedule: 'FARM', companySetting: 'COMPANY' });
  });

  it('returns typed documented fallbacks and nullable schedules when no settings row exists', async () => {
    const db = databaseWithAnswers([{ company_id: 'co-1', default_timezone_id: 'UTC' }], []);
    await expect(new FeedSettingsService(transactionCls(db)).resolve('co-1')).resolves.toEqual(expect.objectContaining({
      timezoneId: 'UTC', defaultForecastDays: 7, maxForecastDays: 45,
      submissionWeekday: null, submissionTime: null,
      financeVarianceAmount: null,
    }));
  });

  it('rejects an unknown company, a farm from another company and invalid persisted settings', async () => {
    await expect(new FeedSettingsService(transactionCls(databaseWithAnswers([]))).resolve('missing')).rejects.toThrow(NotFoundException);
    await expect(new FeedSettingsService(transactionCls(databaseWithAnswers(
      [{ company_id: 'co-1', default_timezone_id: 'UTC' }], [],
      [{ location_id: 'farm-1', company_id: 'co-2', lob_id: 'lob-pig', feed_lead_time_days: 2 }],
    ))).resolve('co-1', 'farm-1')).rejects.toThrow(NotFoundException);
    await expect(new FeedSettingsService(transactionCls(databaseWithAnswers(
      [{ company_id: 'co-1', default_timezone_id: 'UTC' }],
      [{ setting_id: 'bad', farm_id: null, default_forecast_days: 8, max_forecast_days: 7 }],
    ))).resolve('co-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects a farm-bound caller resolving another farm', async () => {
    const cls = transactionCls(databaseWithAnswers([{ company_id: 'co-1', default_timezone_id: 'UTC' }]));
    useFarmScope(cls, { farmId: 'farm-assigned', restricted: true, companyId: 'co-1', lobId: 'pig' });
    await expect(new FeedSettingsService(cls).resolve('co-1', 'farm-other')).rejects.toThrow(ForbiddenException);
  });

  it('rejects an operational administrator reading a farm from another LOB', async () => {
    const cls = transactionCls(databaseWithAnswers(
      [{ company_id: 'co-1', default_timezone_id: 'UTC' }],
      [],
      [{ location_id: 'farm-other-lob', company_id: 'co-1', lob_id: 'lob-dairy', feed_lead_time_days: 2 }],
    ));
    useFarmScope(cls, { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    await expect(new FeedSettingsService(cls).resolve('co-1', 'farm-other-lob')).rejects.toThrow(ForbiddenException);
  });

  it('does not let a farm-bound caller overwrite company-owned settings', async () => {
    const cls = transactionCls(databaseWithAnswers([]));
    useFarmScope(cls, { farmId: 'farm-assigned', restricted: true, companyId: 'co-1', lobId: 'pig' });
    await expect(new FeedSettingsService(cls).saveCompany('co-1', {}, 'tenant-1')).rejects.toThrow(ForbiddenException);
  });

  it('does not let a LOB-bound operational administrator overwrite company-owned settings', async () => {
    const cls = transactionCls(databaseWithAnswers([]));
    useFarmScope(cls, { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    await expect(new FeedSettingsService(cls).saveCompany('co-1', {}, 'tenant-1')).rejects.toThrow(ForbiddenException);
  });
});

describe('FeedSettingsService company-row persistence', () => {
  function databaseWithAtomicStore() {
    let stored: Record<string, unknown> | null = null;
    const upsert = jest.fn(async (config: { set: Record<string, unknown> }) => {
      stored = stored ? { ...stored, ...config.set } : pendingValues;
    });
    let pendingValues: Record<string, unknown> = {};
    const rowsFor = (table: unknown) => table === schema.companyMaster
      ? [{ company_id: 'co-1', default_timezone_id: 'UTC' }]
      : table === schema.locationMaster
        ? [{ location_id: 'farm-1', company_id: 'co-1', lob_id: null }]
        : table === schema.feedPlanningSetting && stored ? [stored] : [];
    const select = jest.fn(() => {
      let table: unknown;
      const chain: any = {
        from: (value: unknown) => { table = value; return chain; },
        where: () => chain,
        limit: async () => rowsFor(table),
        then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(rowsFor(table)).then(resolve, reject),
      };
      return chain;
    });
    const db: any = {
      select,
      insert: jest.fn(() => ({
        values: (values: Record<string, unknown>) => {
          pendingValues = values;
          return { onDuplicateKeyUpdate: upsert };
        },
      })),
    };
    return { db, upsert, rows: () => stored ? [stored] : [] };
  }

  it('declares a non-null active scope key so MySQL can enforce one active company/farm row', () => {
    const config = getTableConfig(schema.feedPlanningSetting);
    const activeScope = config.columns.find((column) => column.name === 'active_scope_key');
    const unique = config.indexes.find((index) => index.config.name === 'uq_feed_planning_setting_active_scope');

    expect(activeScope?.generated).toEqual(expect.objectContaining({ type: 'always', mode: 'stored' }));
    expect(unique?.config.columns.map((column: any) => column.name)).toEqual(['company_id', 'active_scope_key']);
  });

  it('uses one idempotent database upsert instead of a check-then-insert branch', async () => {
    const { db, upsert, rows } = databaseWithAtomicStore();
    const service = new FeedSettingsService(transactionCls(db));

    await service.saveCompany('co-1', { submissionTime: '12:00' }, 'tenant-1', 'user-1');
    await service.saveCompany('co-1', { submissionTime: '13:00' }, 'tenant-1', 'user-1');

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toEqual(expect.objectContaining({ company_id: 'co-1', farm_id: null, submission_time: '13:00' }));
  });

  it('stores safety stock and bag size on the company row (TDD Engine Step 8)', async () => {
    const { db, rows } = databaseWithAtomicStore();
    await new FeedSettingsService(transactionCls(db)).saveCompany('co-1', { safetyStockKg: 250, bagSizeKg: 25 }, 'tenant-1', 'user-1');
    expect(rows()[0]).toEqual(expect.objectContaining({ farm_id: null, safety_stock_kg: '250', bag_size_kg: '25' }));
  });

  it('saves a farm override holding only the values the farm sets; the rest inherit', async () => {
    const { db, rows } = databaseWithAtomicStore();
    const result = await new FeedSettingsService(transactionCls(db)).saveFarm('co-1', 'farm-1', { bulkMultipleKg: 6000 }, 'tenant-1', 'user-1');
    expect(rows()[0]).toEqual(expect.objectContaining({
      company_id: 'co-1', farm_id: 'farm-1', bulk_multiple_kg: '6000',
      safety_stock_kg: null, bag_size_kg: null, truck_target_kg: null, production_weekday: null,
    }));
    expect(result).toEqual(expect.objectContaining({ farmId: 'farm-1', bulkMultipleKg: 6000, safetyStockKg: 0 }));
  });

  it('does not let a farm-bound caller change a farm override', async () => {
    const cls = transactionCls(databaseWithAtomicStore().db);
    useFarmScope(cls, { farmId: 'farm-1', restricted: true, companyId: 'co-1', lobId: 'pig' });
    await expect(new FeedSettingsService(cls).saveFarm('co-1', 'farm-1', {}, 'tenant-1')).rejects.toThrow(ForbiddenException);
  });
});
