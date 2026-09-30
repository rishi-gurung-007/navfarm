import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedForecastRunService } from './feed-forecast-run.service';

type Entry = { op: string; table?: unknown; lock?: string; values?: any; inTx: boolean };

function setup(queues: Map<unknown, unknown[][]>, scope: FarmScope = { farmId: null, companyId: 'company-1', lobId: null, restricted: false }) {
  const log: Entry[] = [];
  const db: any = {
    select: jest.fn(() => {
      const entry: Entry = { op: 'select', inTx: cls?.get('tenantPostingTransaction') === true };
      log.push(entry);
      const chain: any = {
        from: (table: unknown) => { entry.table = table; return chain; },
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        for: (lock: string) => { entry.lock = lock; return chain; },
        then: (ok: any, fail: any) => Promise.resolve(queues.get(entry.table!)?.shift() ?? []).then(ok, fail),
      };
      return chain;
    }),
    insert: jest.fn((table: unknown) => ({
      values: jest.fn(async (values: unknown) => log.push({ op: 'insert', table, values, inTx: cls.get('tenantPostingTransaction') === true })),
    })),
  };
  const cls = transactionCls(db);
  const get = cls.get.bind(cls);
  cls.get = ((key?: string) => key === FARM_SCOPE_KEY ? scope : get(key as any)) as typeof cls.get;
  const settings = { resolve: jest.fn(async () => ({ companyId: 'company-1', farmId: 'farm-1', maxForecastDays: 45, sources: { companySetting: 'COMPANY' } })) };
  return { service: new FeedForecastRunService(cls, settings as any), log, settings, cls };
}

const input = {
  tenantId: 'tenant-1', companyId: 'company-1', farmId: 'farm-1', planningDate: '2026-10-01',
  view: 'CUSTOM' as const, from: '2026-10-01', to: '2026-10-07', periodId: null,
  sourceCutoffAt: '2026-10-01 08:00:00',
};
const output = {
  farm: { id: 'farm-1', code: 'FARM-1', name: 'Farm 1' }, planningDate: '2026-10-01', from: '2026-10-01', to: '2026-10-07',
  daily: [{
    date: '2026-10-01', batchId: 'batch-1', shedId: 'shed-1', destinationLocationId: 'silo-1', itemId: 'item-1',
    currentItemId: 'item-1', heads: 40, feedRateKg: 2.5, openingStockKg: 500, confirmedReceiptKg: 0,
    demandKg: 100, projectedClosingKg: 400, runDownDate: '2026-10-05', recommendedQtyKg: 700,
    requiredOn: '2026-10-03', provenance: { sourceType: 'SILO', lifecycleId: 'life-1' },
  }],
};

describe('FeedForecastRunService', () => {
  it('declares immutable run headers/lines with farm-version and company-code uniqueness', () => {
    const header = getTableConfig(schema.feedForecastRun);
    const line = getTableConfig(schema.feedForecastRunLine);
    expect(header.name).toBe('feed_forecast_run');
    expect(line.name).toBe('feed_forecast_run_line');
    expect(header.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      'uq_feed_forecast_run_farm_version', 'uq_feed_forecast_run_company_code',
    ]));
  });

  it('locks the exact farm before allocating a version and writes header and lines in one transaction', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[{ location_id: 'farm-1', company_id: 'company-1', lob_id: 'lob-piggery' }]]],
      [schema.feedForecastRun, [[{ version: 4 }]]],
    ]);
    const { service, log } = setup(queues);

    await expect(service.createRun(input, output as any, { userId: 'user-1', userType: 'FARM_MANAGER' }))
      .resolves.toEqual({ runId: expect.any(String), runCode: 'FFR-farm-1-000005', version: 5 });

    const farmLock = log.findIndex((entry) => entry.table === schema.locationMaster && entry.lock === 'update');
    const versionRead = log.findIndex((entry) => entry.table === schema.feedForecastRun && entry.op === 'select');
    expect(farmLock).toBeGreaterThanOrEqual(0);
    expect(farmLock).toBeLessThan(versionRead);
    expect(log.filter((entry) => entry.op === 'insert').every((entry) => entry.inTx)).toBe(true);
    expect(log.find((entry) => entry.op === 'insert' && entry.table === schema.feedForecastRun)?.values).toMatchObject({
      tenant_id: 'tenant-1', company_id: 'company-1', farm_id: 'farm-1', version: 5,
      planning_date: '2026-10-01', view: 'CUSTOM', from_date: '2026-10-01', to_date: '2026-10-07',
      period_id: null, source_cutoff_at: '2026-10-01 08:00:00', created_by: 'user-1',
      config_snapshot: expect.objectContaining({ hash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    });
    expect(log.find((entry) => entry.op === 'insert' && entry.table === schema.feedForecastRunLine)?.values)
      .toEqual([expect.objectContaining({ forecast_date: '2026-10-01', batch_id: 'batch-1', shed_id: 'shed-1', destination_location_id: 'silo-1' })]);
  });

  it('starts an independent farm version stream at one', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.locationMaster, [[{ location_id: 'farm-2', company_id: 'company-1', lob_id: 'lob-piggery' }]]],
      [schema.feedForecastRun, [[]]],
    ]);
    const { service } = setup(queues, { farmId: null, companyId: 'company-1', lobId: null, restricted: false });
    await expect(service.createRun({ ...input, farmId: 'farm-2' }, { ...output, farm: { ...output.farm, id: 'farm-2' } } as any, { userId: 'user-1' }))
      .resolves.toMatchObject({ runCode: 'FFR-farm-2-000001', version: 1 });
  });

  it('allocates distinct sequential versions when two saves overlap for the same farm', async () => {
    let latestVersion = 0;
    let transactionLock = Promise.resolve();
    const persistedVersions: number[] = [];
    const db: any = {
      transaction: jest.fn(async (work: (tx: any) => Promise<unknown>) => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const previous = transactionLock;
        transactionLock = transactionLock.then(() => held);
        await previous;
        try {
          const tx: any = {
            select: jest.fn(() => {
              let table: unknown;
              const chain: any = {
                from: (selected: unknown) => { table = selected; return chain; },
                where: () => chain,
                orderBy: () => chain,
                limit: () => chain,
                for: async () => table === schema.locationMaster
                  ? [{ location_id: 'farm-1', company_id: 'company-1', lob_id: 'lob-piggery' }]
                  : latestVersion > 0 ? [{ version: latestVersion }] : [],
              };
              return chain;
            }),
            insert: jest.fn((table: unknown) => ({
              values: jest.fn(async (values: any) => {
                if (table === schema.feedForecastRun) {
                  latestVersion = values.version;
                  persistedVersions.push(values.version);
                }
              }),
            })),
          };
          return await work(tx);
        } finally {
          release();
        }
      }),
    };
    const cls = transactionCls(db);
    const get = cls.get.bind(cls);
    cls.get = ((key?: string) => key === FARM_SCOPE_KEY
      ? { farmId: null, companyId: 'company-1', lobId: null, restricted: false }
      : get(key as any)) as typeof cls.get;
    const settings = { resolve: jest.fn(async () => ({ companyId: 'company-1', farmId: 'farm-1', maxForecastDays: 45 })) };
    const service = new FeedForecastRunService(cls, settings as any);

    const [first, second] = await Promise.all([
      service.createRun(input, output as any, { userId: 'user-1' }),
      service.createRun(input, output as any, { userId: 'user-2' }),
    ]);

    expect([first.version, second.version]).toEqual([1, 2]);
    expect(new Set([first.runCode, second.runCode]).size).toBe(2);
    expect(persistedVersions).toEqual([1, 2]);
  });

  it('refuses create outside a fixed farm before writing', async () => {
    const { service, log } = setup(new Map(), { farmId: 'farm-1', companyId: 'company-1', lobId: 'lob-piggery', restricted: true });
    await expect(service.createRun({ ...input, farmId: 'farm-2' }, output as any, { userId: 'worker' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(log.some((entry) => entry.op === 'insert')).toBe(false);
  });

  it('refuses list outside a fixed farm before reading run history', async () => {
    const { service, log } = setup(new Map(), { farmId: 'farm-1', companyId: 'company-1', lobId: 'lob-piggery', restricted: true });
    await expect(service.findAll('farm-2', 'company-1', 'tenant-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(log.some((entry) => entry.table === schema.feedForecastRun)).toBe(false);
  });

  it('enforces tenant/company/LOB/farm scope on detail', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.feedForecastRun, [[{ run_id: 'run-1', tenant_id: 'tenant-1', company_id: 'company-2', farm_id: 'farm-2' }]]],
    ]);
    const { service } = setup(queues, { farmId: 'farm-1', companyId: 'company-1', lobId: 'lob-piggery', restricted: true });
    await expect(service.findOne('run-1', 'tenant-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
