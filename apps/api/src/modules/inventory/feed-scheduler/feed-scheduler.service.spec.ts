import * as schema from '../../../core/database/schema';
import { FeedSchedulerService } from './feed-scheduler.service';

// Triple C starting configuration (decisions 1 Oct), passed in as settings, never built in.
const settings = {
  productionWeekday: 0, bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, safetyStockKg: 0,
  reminderWeekday: 5, reminderTime: '18:00',
  submissionWeekday: 6, submissionTime: '12:00',
  sources: { companySetting: 'COMPANY' },
};
const farm = { farmId: 'farm-1', companyId: 'co-1', code: 'GRS', name: 'Grace', companyName: 'Triple C' };
// Africa/Harare is UTC+2 all year.
const at = (iso: string) => Date.parse(iso);
const WED_0900 = at('2026-09-23T07:00:00Z');
const FRI_1800 = at('2026-09-25T16:00:00Z');
const SAT_1200 = at('2026-09-26T10:00:00Z');
const THU_1000 = at('2026-09-24T08:00:00Z');

/** The values bound into a drizzle condition (eq(col, value) ...), so the fake can tell which row an update is for. */
function boundValues(cond: any, out: unknown[] = []): unknown[] {
  for (const chunk of cond?.queryChunks ?? []) {
    if (chunk && typeof chunk === 'object' && Array.isArray(chunk.queryChunks)) boundValues(chunk, out);
    else if (chunk && typeof chunk === 'object' && 'value' in chunk && !Array.isArray(chunk.value)) out.push(chunk.value);
  }
  return out;
}

function harness(opts: { settings?: Partial<typeof settings> } = {}) {
  const logs: any[] = [];
  const updates: any[] = [];
  const db: any = {
    insert: jest.fn((table: unknown) => ({
      values: jest.fn(async (v: any) => {
        if (table !== schema.feedScheduleLog) return;
        if (v.run_key && logs.some((l) => l.run_key === v.run_key)) throw Object.assign(new Error('Failed query'), { cause: { code: 'ER_DUP_ENTRY' } });
        logs.push({ ...v });
      }),
    })),
    update: jest.fn((table: unknown) => ({
      set: jest.fn((v: any) => ({
        where: jest.fn(async (cond: any) => {
          updates.push(v);
          if (table !== schema.feedScheduleLog) return;
          const bound = boundValues(cond);
          const row = logs.find((l) => bound.includes(l.run_id));
          if (row) Object.assign(row, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)));
        }),
      })),
    })),
    select: jest.fn(() => {
      let table: unknown;
      let cond: any;
      const self: any = {
        from: (t: unknown) => { table = t; return self; }, where: (c: any) => { cond = c; return self; }, orderBy: () => self, limit: () => self,
        then: (ok: any, err: any) => {
          const rows = logs.filter((l) => { const bound = boundValues(cond); return bound.length > 0 && bound.every((b) => Object.values(l).includes(b)); });
          return Promise.resolve(rows).then(ok, err);
        },
      };
      return self;
    }),
  };
  const cls: any = { get: (k: string) => (k === 'tenantDb' ? db : undefined), set: jest.fn(), run: (fn: () => unknown) => fn() };
  const forecast: any = {
    listFarms: jest.fn(async () => [farm]),
    farmToday: jest.fn(async () => ({ today: '2026-09-23', timeZone: 'Africa/Harare' })),
  };
  const feedSettings: any = { resolveForFeedPlanning: jest.fn(async () => ({ ...settings, ...opts.settings })) };
  const evaluation = (extra: any = {}) => ({ raise: [], renotify: [], escalate: [], resolve: [], ...extra });
  const alerts: any = {
    evaluateFarm: jest.fn(async () => evaluation()),
    evaluateStockTakeDue: jest.fn(async () => ({ raised: 0, resolved: 0 })),
  };
  const service = new FeedSchedulerService(cls, {} as any, {} as any, forecast, feedSettings, alerts);
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  return { service, logs, updates, forecast, alerts, feedSettings, evaluation };
}

describe('FeedSchedulerService.runDue — what is due at the company wall clock', () => {
  it('uses the company time zone: 16:00Z on Friday is 18:00 in Harare, 15:55Z is not yet', async () => {
    const early = harness();
    expect((await early.service.runDue('t1', at('2026-09-25T15:55:00Z'))).some((r) => r.job === 'REQ_REMINDER')).toBe(false);
    expect((await early.service.runDue('t1', at('2026-09-25T16:00:00Z'))).some((r) => r.job === 'REQ_REMINDER')).toBe(true);
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
    expect(results.map((r) => r.job).sort()).toEqual(['DIET_CHANGE', 'ESCALATION', 'STOCK_TAKE_DUE']);
    expect(results.find((r) => r.job === 'DIET_CHANGE')!.summary?.evaluated).toEqual(expect.objectContaining({ raised: 1, escalated: 1 }));
  });

  it('runs the stock take due check daily (Master Setup row 45) through the alert service, for the farm', async () => {
    const h = harness();
    h.alerts.evaluateStockTakeDue.mockResolvedValue({ raised: 2, resolved: 1 });
    const results = await h.service.runDue('t1', THU_1000);
    expect(results.find((r) => r.job === 'STOCK_TAKE_DUE')!.summary?.stockTake).toEqual({ raised: 2, resolved: 1 });
    expect(h.alerts.evaluateStockTakeDue).toHaveBeenCalledWith({ farmId: 'farm-1', companyId: 'co-1', tenantId: 't1' }, THU_1000);
  });

  it('days and times are configuration: a tenant with the cutoff on Thursday 15:30 gets it then, and not on Saturday', async () => {
    const h = harness({ settings: { submissionWeekday: 4, submissionTime: '15:30' } });
    expect((await h.service.runDue('t1', at('2026-09-24T13:30:00Z'))).some((r) => r.job === 'REQ_CUTOFF')).toBe(true);
    expect((await h.service.runDue('t1', SAT_1200)).some((r) => r.job === 'REQ_CUTOFF')).toBe(false);
  });

  it('does not schedule the weekly jobs of a tenant that configured nothing', async () => {
    const h = harness({ settings: { tentativePlanWeekday: null as any, tentativePlanTime: null as any, reminderWeekday: null as any, reminderTime: null as any, submissionWeekday: null as any, submissionTime: null as any } });
    const results = await h.service.runDue('t1', WED_0900);
    expect(results.map((r) => r.job).sort()).toEqual(['DIET_CHANGE', 'ESCALATION', 'STOCK_TAKE_DUE']);
  });
});

describe('FeedSchedulerService — idempotent', () => {
  it('a second tick in the same period does not run the job again (one event per document and period)', async () => {
    const h = harness();
    const first = await h.service.runDue('t1', WED_0900);
    const second = await h.service.runDue('t1', WED_0900 + 5 * 60_000);
    expect(first.find((r) => r.job === 'DIET_CHANGE')!.status).toBe('DONE');
    expect(second.find((r) => r.job === 'DIET_CHANGE')!.status).toBe('ALREADY_RAN');
    expect(h.logs.filter((l) => l.job_code === 'DIET_CHANGE' && l.trigger_type === 'SCHEDULED')).toHaveLength(1);
    expect(h.logs.find((l) => l.trigger_type === 'SCHEDULED' && l.job_code === 'DIET_CHANGE')).toEqual(expect.objectContaining({ run_key: 'DIET_CHANGE|farm-1|2026-09-23', trigger_type: 'SCHEDULED', period_key: '2026-09-23' }));
  });

  it('one job failing is logged FAILED and does not stop the others', async () => {
    const h = harness();
    h.alerts.evaluateFarm.mockRejectedValueOnce(new Error('forecast down'));
    const results = await h.service.runDue('t1', THU_1000);
    expect(results.map((r) => `${r.job}:${r.status}`).sort()).toEqual(['DIET_CHANGE:FAILED', 'ESCALATION:DONE', 'STOCK_TAKE_DUE:DONE']);
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

describe('FeedSchedulerService.tick — off by default', () => {
  const saved = process.env.FEED_SCHEDULER_ENABLED;
  afterEach(() => { if (saved === undefined) delete process.env.FEED_SCHEDULER_ENABLED; else process.env.FEED_SCHEDULER_ENABLED = saved; });
  const build = () => {
    const masterDb: any = { select: jest.fn(() => ({ from: () => ({ where: async () => [{ tenant_id: 't1', tenant_code: 'T1' }] }) })) };
    const connections: any = { getTenantConnection: jest.fn(async () => { throw new Error('not on NAVFARM_DB_ALLOWLIST'); }) };
    const cls: any = { get: () => undefined, set: jest.fn(), run: (fn: () => unknown) => fn() };
    const service = new FeedSchedulerService(cls, masterDb, connections, {} as any, {} as any, {} as any);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    return { service, masterDb, connections, warn };
  };

  it.each([undefined, '', 'false', 'TRUE', '1'])('does nothing when FEED_SCHEDULER_ENABLED is %p', async (value) => {
    if (value === undefined) delete process.env.FEED_SCHEDULER_ENABLED; else process.env.FEED_SCHEDULER_ENABLED = value;
    const { service, masterDb } = build();
    await service.tick();
    expect(masterDb.select).not.toHaveBeenCalled();
  });

  it('is read when the tick runs, not when the module loads: setting it later turns the scheduler on', async () => {
    const { service, masterDb } = build();
    delete process.env.FEED_SCHEDULER_ENABLED;
    await service.tick();
    process.env.FEED_SCHEDULER_ENABLED = 'true';
    await service.tick();
    expect(masterDb.select).toHaveBeenCalledTimes(1);
  });

  it('warns once per process about a tenant it cannot use (off the allowlist, not migrated), not every five minutes', async () => {
    process.env.FEED_SCHEDULER_ENABLED = 'true';
    const { service, connections, warn } = build();
    await service.tick();
    await service.tick();
    await service.tick();
    expect(connections.getTenantConnection).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('T1'));
  });
});

describe('FeedSchedulerService — DIET_CHANGE and ESCALATION wait for saved settings', () => {
  it('skips them silently, with no log row and no evaluation, for a company with no Feed Planning Settings', async () => {
    const h = harness({ settings: { sources: { companySetting: 'SYSTEM' } } });
    expect(await h.service.runDue('t1', THU_1000)).toEqual([]);
    expect(h.logs).toEqual([]);
    expect(h.alerts.evaluateFarm).not.toHaveBeenCalled();
  });
});

describe('FeedSchedulerService — a failure or a crash never blocks the period', () => {
  it('releases the run key on FAILED, so the next tick retries and the job can finish', async () => {
    const h = harness();
    h.alerts.evaluateFarm.mockRejectedValueOnce(new Error('forecast down'));
    const first = await h.service.runDue('t1', THU_1000);
    expect(first.find((r) => r.job === 'DIET_CHANGE')!.status).toBe('FAILED');
    expect(h.logs.find((l) => l.job_code === 'DIET_CHANGE')).toEqual(expect.objectContaining({ status: 'FAILED', run_key: null }));
    const second = await h.service.runDue('t1', THU_1000 + 5 * 60_000);
    expect(second.find((r) => r.job === 'DIET_CHANGE')!.status).toBe('DONE');
    const third = await h.service.runDue('t1', THU_1000 + 10 * 60_000);
    expect(third.find((r) => r.job === 'DIET_CHANGE')!.status).toBe('ALREADY_RAN');
  });

  it('reclaims a RUNNING row older than 30 minutes, but not a fresh one', async () => {
    const h = harness();
    // A crashed process left DIET_CHANGE RUNNING at 10:00 local.
    h.logs.push({ run_id: 'old', run_key: 'DIET_CHANGE|farm-1|2026-09-24', status: 'RUNNING', started_at: '2026-09-24 08:00:00', job_code: 'DIET_CHANGE' });
    const fresh = await h.service.runDue('t1', at('2026-09-24T08:20:00Z'));
    expect(fresh.find((r) => r.job === 'DIET_CHANGE')!.status).toBe('ALREADY_RAN');
    const later = await h.service.runDue('t1', at('2026-09-24T08:31:00Z'));
    expect(later.find((r) => r.job === 'DIET_CHANGE')!.status).toBe('DONE');
    expect(h.logs.find((l) => l.run_id === 'old')).toEqual(expect.objectContaining({ status: 'FAILED', run_key: null }));
  });
});

describe('FeedSchedulerService — back-off', () => {
  it('stops retrying a job after 3 failed runs in one period, warns once, and tries again next period', async () => {
    const h = harness();
    const warn = (h.service as any).logger.warn as jest.Mock;
    h.alerts.evaluateFarm.mockRejectedValue(new Error('forecast down'));
    const diet = async (ms: number) => (await h.service.runDue('t1', ms)).find((r) => r.job === 'DIET_CHANGE')!.status;
    expect([await diet(THU_1000), await diet(THU_1000 + 300_000), await diet(THU_1000 + 600_000)]).toEqual(['FAILED', 'FAILED', 'FAILED']);
    expect(await diet(THU_1000 + 900_000)).toBe('BACKED_OFF');
    expect(await diet(THU_1000 + 1_200_000)).toBe('BACKED_OFF');
    expect(h.alerts.evaluateFarm.mock.calls.length).toBe(6); // 3 DIET_CHANGE + 3 ESCALATION (a different job and period) failures, no 4th DIET_CHANGE
    expect(warn.mock.calls.filter(([m]) => String(m).includes('DIET_CHANGE failed 3 times'))).toHaveLength(1);
    h.alerts.evaluateFarm.mockResolvedValue(h.evaluation());
    expect(await diet(THU_1000 + 24 * 3_600_000)).toBe('DONE');
  });
});
