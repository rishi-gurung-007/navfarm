import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
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
  it('resolves company values and only the approved farm lead-time/submission overrides', async () => {
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
      }],
      [{ location_id: 'farm-1', company_id: 'co-1', feed_lead_time_days: 3 }],
    );
    const result = await new FeedSettingsService(transactionCls(db)).resolve('co-1', 'farm-1');

    expect(result).toEqual(expect.objectContaining({
      companyId: 'co-1', farmId: 'farm-1', timezoneId: 'Africa/Harare',
      defaultForecastDays: 7, maxForecastDays: 45,
      productionWeekday: 0, productionShift: 'AM',
      submissionWeekday: 5, submissionTime: '16:00',
      reminderWeekday: 5, reminderTime: '18:00',
      physicalCountWeekday: 0, physicalCountTime: '08:00',
      leadTimeDays: 3,
      capacityWarningPct: 90, capacityCriticalPct: 100,
      financeVariancePct: 5, financeVarianceAmount: null,
    }));
    expect(result.sources).toEqual({ leadTime: 'FARM', submissionSchedule: 'FARM', companySetting: 'COMPANY' });
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
      [{ location_id: 'farm-1', company_id: 'co-2', feed_lead_time_days: 2 }],
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

  it('does not let a farm-bound caller overwrite company-owned settings', async () => {
    const cls = transactionCls(databaseWithAnswers([]));
    useFarmScope(cls, { farmId: 'farm-assigned', restricted: true, companyId: 'co-1', lobId: 'pig' });
    await expect(new FeedSettingsService(cls).saveCompany('co-1', {}, 'tenant-1')).rejects.toThrow(ForbiddenException);
  });
});
