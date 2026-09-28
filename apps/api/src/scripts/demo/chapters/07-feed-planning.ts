/**
 * Chapter `07-feed-planning` — Plan S, B1. Makes a fresh demo show the feed
 * features working, through the application's own services (Ruling 1):
 *
 *   - the July–June reporting year containing today, for the demo company
 *     (the Feed Forecast's Reporting Period view needs one);
 *   - two VIL100 silo low levels (S10, pickDemoLevels): one run-down inside
 *     the horizon, one FEED_BELOW_L1 at once;
 *   - a feed-alert evaluation of every demo farm, so the Alerts page opens
 *     with the demo's alerts already raised.
 *
 * Resume-safe: generate skips existing periods; the levels are recomputed
 * from the stock at run time; evaluation is idempotent.
 *
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=07-feed-planning
 */
import { inArray } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { FeedForecastService } from '../../../modules/inventory/feed-forecast/feed-forecast.service';
import { FeedAlertService } from '../../../modules/inventory/feed-alert/feed-alert.service';
import { LocationService } from '../../../modules/master-data/location/location.service';
import { ReportingPeriodService } from '../../../modules/master-data/reporting-period/reporting-period.service';
import { businessYearOf } from '../../../modules/master-data/reporting-period/reporting-period.rules';
import type { DemoChapter, DemoContext } from '../chapter';
import { pickDemoLevels } from '../feed-planning';

export const feedPlanningChapter: DemoChapter = {
  name: '07-feed-planning',

  async run(ctx: DemoContext): Promise<void> {
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('07-feed-planning: tenantDb is not set — run through the harness.');

    // 1. The reporting year containing today.
    const startYear = Number(businessYearOf(new Date().toISOString().slice(0, 10)).slice(0, 4));
    const generated = await ctx.app.get(ReportingPeriodService).generate({ company_id: ctx.companyId, business_year_start: startYear }, ctx.tenantId, ctx.actor);
    ctx.log(`07 reporting year ${startYear}: ${generated.created.length} period(s) created, ${generated.skipped.length} already there`);

    // 2. VIL100's two silo levels.
    const vil = ctx.demoFarms.find((f) => f.code === 'VIL100');
    if (!vil) {
      ctx.log('07 VIL100 is not part of this run — silo levels left at their defaults');
    } else {
      const report = await ctx.app.get(FeedForecastService).computeForFarm(vil.farmId, ctx.companyId, ctx.tenantId);
      const siloIds = [...new Set(report.sources.filter((s) => s.sourceType === 'SILO').map((s) => s.locationId))];
      const highs = siloIds.length
        ? await db
            .select({ id: schema.locationMaster.location_id, high: schema.locationMaster.high_level_kg })
            .from(schema.locationMaster)
            .where(inArray(schema.locationMaster.location_id, siloIds))
        : [];
      const highOf = new Map(highs.map((h) => [h.id, h.high == null ? null : Number(h.high)] as const));
      const changes = pickDemoLevels(report.sources, highOf);
      for (const change of changes) {
        await ctx.app.get(LocationService).update(change.siloId, { low_level_kg: change.lowKg }, ctx.tenantId, ctx.actor);
        ctx.log(`07 ${change.siloCode} low level set to ${change.lowKg} kg (${change.why === 'RUNS_DOWN' ? 'runs down in about 10 days' : 'below it now'})`);
      }
      if (changes.length < 2) ctx.log(`07 only ${changes.length} VIL100 silo(s) had stock and use to set a level on`);
    }

    // 3. Raise the demo's feed alerts now, so the Alerts page opens with them.
    const alerts = ctx.app.get(FeedAlertService);
    for (const farm of ctx.demoFarms) await alerts.evaluateFarmSafely(farm.farmId, ctx.companyId, ctx.tenantId);
    ctx.log(`07 feed alerts evaluated on ${ctx.demoFarms.length} farm(s)`);
  },
};
