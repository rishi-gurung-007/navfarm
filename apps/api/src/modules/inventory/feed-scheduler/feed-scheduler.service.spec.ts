import * as schema from '../../../core/database/schema';
import { FeedSchedulerService } from './feed-scheduler.service';

// Triple C starting configuration (decisions 1 Oct), passed in as settings, never built in.
const settings = {
  productionWeekday: 0, bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, safetyStockKg: 0,
  tentativePlanWeekday: 3, tentativePlanTime: '09:00',
  reminderWeekday: 5, reminderTime: '18:00',
  submissionWeekday: 6, submissionTime: '12:00',
};
const farm = { farmId: 'farm-1', companyId: 'co-1', code: 'GRS', name: 'Grace', companyName: 'Triple C' };
// Africa/Harare is UTC+2 all year.
const at = (iso: string) => Date.parse(iso);
const WED_0900 = at('2026-09-23T07:00:00Z');
const FRI_1800 = at('2026-09-25T16:00:00Z');
const SAT_1200 = at('2026-09-26T10:00:00Z');
const THU_1000 = at('2026-09-24T08:00:00Z');

function harness(opts: { settings?: Partial<typeof settings>; existingPlan?: any; planError?: Error } = {}) {
  const logs: any[] = [];
  const updates: any[] = [];
  const keys = new Set<string>();
  const db: any = {
    insert: jest.fn((table: unknown) => ({
      values: jest.fn(async (v: any) => {
        if (table !== schema.feedScheduleLog) return;
        if (v.run_key) {
          if (keys.has(v.run_key)) throw Object.assign(new Error('Failed query'), { cause: { code: 'ER_DUP_ENTRY' } });
          keys.add(v.run_key);
        }
        logs.push(v);
      }),
    })),
    update: jest.fn(() => ({ set: jest.fn((v: any) => ({ where: jest.fn(async () => { updates.push(v); }) })) })),
    select: jest.fn(() => {
      const self: any = { from: () => self, where: () => self, orderBy: () => self, limit: () => self, then: (ok: any, err: any) => Promise.resolve(opts.existingPlan ? [opts.existingPlan] : []).then(ok, err) };
      return self;
    }),
  };
  const cls: any = { get: (k: string) => (k === 'tenantDb' ? db : undefined), set: jest.fn(), run: (fn: () => unknown) => fn() };
  const forecast: any = {
    listFarms: jest.fn(async () => [farm]),
    farmToday: jest.fn(async () => ({ today: '2026-09-23', timeZone: 'Africa/Harare' })),
    generateFeedPlanVersion: jest.fn(async () => {
      if (opts.planError) throw opts.planError;
      return { planId: 'plan-1', planCode: 'FP-GRS-0927-V1', planWeek: '202639', planType: 'TENTATIVE', version: 1 };
    }),
  };
  const feedSettings: any = { resolveForFeedPlanning: jest.fn(async () => ({ ...settings, ...opts.settings })) };
  const evaluation = (extra: any = {}) => ({ raise: [], renotify: [], escalate: [], resolve: [], ...extra });
  const alerts: any = {
    evaluateFarm: jest.fn(async () => evaluation()),
    raisePlanAvailable: jest.fn(async () => ({ rules: 1, raised: 1 })),
  };
  const service = new FeedSchedulerService(cls, {} as any, {} as any, forecast, feedSettings, alerts);
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { service, logs, updates, forecast, alerts, feedSettings, evaluation };
}

describe('FeedSchedulerService.runDue — what is due at the company wall clock', () => {
  it('Wednesday 09:00 Harare: generates the tentative plan through the existing service, then raises PLAN_AVAILABLE (checkpoint 36)', async () => {
    const h = harness();
    const results = await h.service.runDue('t1', WED_0900);
    const tentative = results.find((r) => r.job === 'TENTATIVE_PLAN')!;
    expect(tentative.status).toBe('DONE');
    // 23 Sep 2026 is a Wednesday; production weekday 0 (Sunday) => production on 27 Sep.
    expect(h.forecast.generateFeedPlanVersion).toHaveBeenCalledWith('farm-1', '2026-09-27', 't1', { userId: 'FEED_SCHEDULER', userType: 'SYSTEM' });
    expect(h.alerts.raisePlanAvailable).toHaveBeenCalledWith('farm-1', 'co-1', 't1', expect.objectContaining({ status: 'GENERATED', planId: 'plan-1', productionDate: '2026-09-27' }), WED_0900);
    expect(tentative.summary?.plan).toEqual(expect.objectContaining({ status: 'GENERATED', planCode: 'FP-GRS-0927-V1' }));
  });

  it('uses the company time zone: 07:00Z on Wednesday is 09:00 in Harare, 06:55Z is not yet', async () => {
    const early = harness();
    expect((await early.service.runDue('t1', at('2026-09-23T06:55:00Z'))).some((r) => r.job === 'TENTATIVE_PLAN')).toBe(false);
    expect(early.forecast.generateFeedPlanVersion).not.toHaveBeenCalled();
  });

  it('Friday 18:00 runs the reminder job, Saturday 12:00 the cutoff job, each through the one alert evaluator', async () => {
    const h = harness();
    h.alerts.evaluateFarm.mockResolvedValue(h.evaluation({
      raise: [{ rule: { eventType: 'REQ_DEADLINE', notificationCode: 'REQ-REMINDER', priorityLevel: 'WARNING', recipientRoles: ['FARM_MANAGER'] } }],
    }));
    const fri = await h.service.runDue('t1', FRI_1800);
    const reminder = fri.find((r) => r.job === 'REQ_REMINDER')!;
    expect(reminder.status).toBe('DONE');
    expect(reminder.summary?.evaluated?.raisedBy).toEqual([{ eventType: 'REQ_DEADLINE', code: 'REQ-REMINDER', priority: 'WARNING', roles: ['FARM_MANAGER'] }]);
    expect(fri.some((r) => r.job === 'REQ_CUTOFF')).toBe(false);

    h.alerts.evaluateFarm.mockResolvedValue(h.evaluation({
      raise: [{ rule: { eventType: 'REQ_DEADLINE', notificationCode: 'REQ-OVERDUE', priorityLevel: 'CRITICAL', recipientRoles: ['FARM_MANAGER', 'HEAD_OF_FARM'] } }],
    }));
    const sat = await h.service.runDue('t1', SAT_1200);
    const cutoff = sat.find((r) => r.job === 'REQ_CUTOFF')!;
    expect(cutoff.summary?.evaluated?.raisedBy).toEqual([{ eventType: 'REQ_DEADLINE', code: 'REQ-OVERDUE', priority: 'CRITICAL', roles: ['FARM_MANAGER', 'HEAD_OF_FARM'] }]);
    expect(h.alerts.evaluateFarm).toHaveBeenCalledWith('farm-1', 'co-1', 't1');
  });

  it('runs the diet-change warning daily and escalation hourly, on any weekday', async () => {
    const h = harness();
    h.alerts.evaluateFarm.mockResolvedValue(h.evaluation({
      raise: [{ rule: { eventType: 'DIET_CHANGE', notificationCode: 'DIET-CHANGE', priorityLevel: 'WARNING', recipientRoles: ['FARM_MANAGER'] } }],
      escalate: [{ alertId: 'a1', role: 'HEAD_OF_FARM' }],
    }));
    const results = await h.service.runDue('t1', THU_1000);
    expect(results.map((r) => r.job).sort()).toEqual(['DIET_CHANGE', 'ESCALATION']);
    expect(results.find((r) => r.job === 'DIET_CHANGE')!.summary?.evaluated).toEqual(expect.objectContaining({ raised: 1, escalated: 1 }));
  });

  it('days and times are configuration: a tenant with the cutoff on Thursday 15:30 gets it then, and not on Saturday', async () => {
    const h = harness({ settings: { submissionWeekday: 4, submissionTime: '15:30' } });
    expect((await h.service.runDue('t1', at('2026-09-24T13:30:00Z'))).some((r) => r.job === 'REQ_CUTOFF')).toBe(true);
    expect((await h.service.runDue('t1', SAT_1200)).some((r) => r.job === 'REQ_CUTOFF')).toBe(false);
  });

  it('does not schedule the weekly jobs of a tenant that configured nothing', async () => {
    const h = harness({ settings: { tentativePlanWeekday: null as any, tentativePlanTime: null as any, reminderWeekday: null as any, reminderTime: null as any, submissionWeekday: null as any, submissionTime: null as any } });
    const results = await h.service.runDue('t1', WED_0900);
    expect(results.map((r) => r.job).sort()).toEqual(['DIET_CHANGE', 'ESCALATION']);
  });
});

describe('FeedSchedulerService — idempotent', () => {
  it('a second tick in the same period does not run the job again (one event per document and period)', async () => {
    const h = harness();
    const first = await h.service.runDue('t1', WED_0900);
    const second = await h.service.runDue('t1', WED_0900 + 5 * 60_000);
    expect(first.find((r) => r.job === 'TENTATIVE_PLAN')!.status).toBe('DONE');
    expect(second.find((r) => r.job === 'TENTATIVE_PLAN')!.status).toBe('ALREADY_RAN');
    expect(h.forecast.generateFeedPlanVersion).toHaveBeenCalledTimes(1);
    expect(h.alerts.raisePlanAvailable).toHaveBeenCalledTimes(1);
    expect(h.logs.filter((l) => l.job_code === 'TENTATIVE_PLAN')).toHaveLength(1);
    expect(h.logs.find((l) => l.job_code === 'TENTATIVE_PLAN')).toEqual(expect.objectContaining({ run_key: 'TENTATIVE_PLAN|farm-1|2026-09-23', trigger_type: 'SCHEDULED', period_key: '2026-09-23' }));
  });

  it('never makes a second Feed Plan for a week that has one, and still announces the existing plan once', async () => {
    const h = harness({ existingPlan: { plan_id: 'plan-0', plan_code: 'FP-GRS-0927-V1', plan_type: 'ACTUAL', version: 1, production_date: '2026-09-27' } });
    const [tentative] = (await h.service.runDue('t1', WED_0900)).filter((r) => r.job === 'TENTATIVE_PLAN');
    expect(h.forecast.generateFeedPlanVersion).not.toHaveBeenCalled();
    expect(tentative.summary?.plan).toEqual(expect.objectContaining({ status: 'EXISTS', planId: 'plan-0' }));
    expect(h.alerts.raisePlanAvailable).toHaveBeenCalledWith('farm-1', 'co-1', 't1', expect.objectContaining({ planId: 'plan-0' }), WED_0900);
  });

  it('a farm with no saved calculation is SKIPPED with the generator\'s reason, and no notice is raised', async () => {
    const { ConflictException } = await import('@nestjs/common');
    const h = harness({ planError: new ConflictException('Save a feed forecast calculation before generating a feed plan.') });
    const tentative = (await h.service.runDue('t1', WED_0900)).find((r) => r.job === 'TENTATIVE_PLAN')!;
    expect(tentative.status).toBe('DONE');
    expect(tentative.summary?.plan).toEqual(expect.objectContaining({ status: 'SKIPPED', reason: expect.stringContaining('Save a feed forecast calculation') }));
    expect(h.alerts.raisePlanAvailable).not.toHaveBeenCalled();
  });

  it('one job failing is logged FAILED and does not stop the others', async () => {
    const h = harness();
    h.alerts.evaluateFarm.mockRejectedValueOnce(new Error('forecast down'));
    const results = await h.service.runDue('t1', THU_1000);
    expect(results.map((r) => `${r.job}:${r.status}`).sort()).toEqual(['DIET_CHANGE:FAILED', 'ESCALATION:DONE']);
    expect(h.updates).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'FAILED', error_message: 'forecast down' })]));
  });
});

describe('FeedSchedulerService.runNow — admin test trigger', () => {
  it('runs the job whatever the day and time, as a MANUAL run with no run key, and may be repeated', async () => {
    const h = harness();
    const a = await h.service.runNow('REQ_CUTOFF', { farmId: 'farm-1' }, 't1', 'admin-1', THU_1000);
    const b = await h.service.runNow('REQ_CUTOFF', { farmId: 'farm-1' }, 't1', 'admin-1', THU_1000);
    expect([a[0].status, b[0].status]).toEqual(['DONE', 'DONE']);
    expect(h.alerts.evaluateFarm).toHaveBeenCalledTimes(2);
    expect(h.logs.map((l) => [l.trigger_type, l.run_key, l.triggered_by])).toEqual([['MANUAL', null, 'admin-1'], ['MANUAL', null, 'admin-1']]);
  });

  it('only the chosen company\'s farms, and a farm that does not exist is a 404', async () => {
    const h = harness();
    expect(await h.service.runNow('DIET_CHANGE', { companyId: 'co-other' }, 't1')).toEqual([]);
    await expect(h.service.runNow('DIET_CHANGE', { farmId: 'nope' }, 't1')).rejects.toThrow('Farm not found.');
  });
});
