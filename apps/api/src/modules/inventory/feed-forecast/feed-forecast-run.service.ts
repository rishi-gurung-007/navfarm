import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { randomUUID } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import { farmScope } from '../../../common/farm-scope';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import * as schema from '../../../core/database/schema';
import { FeedSettingsService } from '../feed-settings/feed-settings.service';
import { toFarmFeedSettings } from '../feed-settings/feed-settings.rules';
import type { FeedForecastResponse } from './feed-forecast.service';
import type { ForecastView } from './feed-forecast.view';
import { buildConfigSnapshot, buildOutputSnapshot, buildRunLineSnapshots, technicalRunCode } from './feed-forecast-run.rules';

export interface CreateFeedForecastRunInput {
  tenantId: string;
  companyId: string;
  farmId: string;
  planningDate: string;
  view: ForecastView;
  from: string;
  to: string;
  periodId: string | null;
  sourceCutoffAt: string;
}

type Actor = { userId?: string; userType?: string } | undefined;

@Injectable()
export class FeedForecastRunService {
  constructor(private readonly cls: ClsService, private readonly feedSettings: FeedSettingsService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private assertRequestedScope(companyId: string, farmId: string): void {
    const scope = farmScope(this.cls);
    if (scope.companyId && scope.companyId !== companyId) throw new ForbiddenException('Not authorized for this company.');
    if (scope.farmId && scope.farmId !== farmId) throw new ForbiddenException('Not authorized for this farm.');
  }

  private async loadFarm(farmId: string, companyId: string, tenantId: string, lock = false) {
    const scope = farmScope(this.cls);
    this.assertRequestedScope(companyId, farmId);
    const query = this.db.select({
      location_id: schema.locationMaster.location_id,
      company_id: schema.locationMaster.company_id,
      lob_id: schema.locationMaster.lob_id,
    }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.location_id, farmId),
      eq(schema.locationMaster.company_id, companyId),
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.location_type, 'FARM'),
      isNull(schema.locationMaster.parent_location_id),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
      ...(scope.restricted && scope.lobId ? [eq(schema.locationMaster.lob_id, scope.lobId)] : []),
    )).limit(1);
    const rows = lock ? await query.for('update') : await query;
    const [farm] = rows;
    if (!farm) throw new NotFoundException('Farm not found.');
    return farm;
  }

  async createRun(
    input: CreateFeedForecastRunInput,
    output: Pick<FeedForecastResponse, 'farm' | 'planningDate' | 'from' | 'to' | 'daily' | 'sourceSnapshot'>,
    actor?: Actor,
  ) {
    if (!actor?.userId) throw new UnauthorizedException('An authenticated creator is required to save a forecast run.');
    const creatorId = actor.userId;
    this.assertRequestedScope(input.companyId, input.farmId);
    if (output.farm.id !== input.farmId || output.planningDate !== input.planningDate || output.from !== input.from || output.to !== input.to) {
      throw new BadRequestException('The forecast output does not match the run filters.');
    }

    return withTenantTransaction(this.cls, async () => {
      // The stable farm row owns its version stream. This lock must precede
      // the version read, including when there is no earlier run row to lock.
      await this.loadFarm(input.farmId, input.companyId, input.tenantId, true);
      if (!output.sourceSnapshot) throw new BadRequestException('The forecast source snapshot is required.');
      // Task 8: the logistics values come from feed_planning_setting (farm
      // override over company over defaults), not from location_master.
      const resolved = await this.feedSettings.resolve(input.companyId, input.farmId);
      const logistics = toFarmFeedSettings(resolved);
      const configSnapshot = buildConfigSnapshot({
        ...resolved,
        requisitionDraftSettings: {
          bulkMultipleKg: logistics.bulkMultipleKg,
          bagSizeKg: logistics.bagSizeKg,
          truckTargetKg: logistics.truckTargetKg,
          productionWeekday: logistics.productionWeekday,
        },
      });
      const [latest] = await this.db.select({ version: schema.feedForecastRun.version })
        .from(schema.feedForecastRun)
        .where(and(
          eq(schema.feedForecastRun.tenant_id, input.tenantId),
          eq(schema.feedForecastRun.company_id, input.companyId),
          eq(schema.feedForecastRun.farm_id, input.farmId),
        ))
        .orderBy(desc(schema.feedForecastRun.version))
        .limit(1)
        .for('update');
      const version = (latest?.version ?? 0) + 1;
      const runId = randomUUID();
      const runCode = technicalRunCode(input.farmId, version);
      const lines = buildRunLineSnapshots(output);
      const outputSnapshot = buildOutputSnapshot(lines);

      await this.db.insert(schema.feedForecastRun).values({
        run_id: runId, run_code: runCode, tenant_id: input.tenantId, company_id: input.companyId, farm_id: input.farmId,
        version, planning_date: input.planningDate, view: input.view, from_date: input.from, to_date: input.to,
        period_id: input.periodId, source_cutoff_at: input.sourceCutoffAt, source_snapshot: output.sourceSnapshot,
        output_snapshot: outputSnapshot,
        config_snapshot: configSnapshot, created_by: creatorId,
      });
      if (lines.length) {
        await this.db.insert(schema.feedForecastRunLine).values(lines.map((line) => ({
          run_line_id: randomUUID(), run_id: runId, forecast_date: line.forecastDate, batch_id: line.batchId,
          shed_id: line.shedId, destination_location_id: line.destinationLocationId,
          required_item_id: line.requiredItemId, current_item_id: line.currentItemId,
          head_count: line.headCount, feed_rate_kg: String(line.feedRateKg), opening_stock_kg: String(line.openingStockKg),
          confirmed_receipt_kg: String(line.confirmedReceiptKg), daily_demand_kg: String(line.dailyDemandKg),
          projected_closing_kg: String(line.projectedClosingKg), shortage_date: line.shortageDate,
          recommended_qty_kg: String(line.recommendedQtyKg),
          // Task 4 (3 Oct ruling): required-on is superseded (engine.ts); the
          // column stays until the branch merge drops it and is never written.
          provenance_snapshot: line.provenanceSnapshot as Record<string, unknown>,
        })));
      }
      return { runId, runCode, version };
    });
  }

  async findAll(farmId: string, companyId: string, tenantId: string) {
    await this.loadFarm(farmId, companyId, tenantId);
    return this.db.select().from(schema.feedForecastRun).where(and(
      eq(schema.feedForecastRun.tenant_id, tenantId),
      eq(schema.feedForecastRun.company_id, companyId),
      eq(schema.feedForecastRun.farm_id, farmId),
    )).orderBy(desc(schema.feedForecastRun.version));
  }

  async findOne(runId: string, tenantId: string) {
    const [run] = await this.db.select().from(schema.feedForecastRun).where(and(
      eq(schema.feedForecastRun.run_id, runId),
      eq(schema.feedForecastRun.tenant_id, tenantId),
    )).limit(1);
    if (!run) throw new NotFoundException('Feed forecast run not found.');
    try {
      await this.loadFarm(run.farm_id, run.company_id, tenantId);
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) throw new NotFoundException('Feed forecast run not found.');
      throw error;
    }
    const lines = await this.db.select().from(schema.feedForecastRunLine)
      .where(eq(schema.feedForecastRunLine.run_id, runId))
      .orderBy(schema.feedForecastRunLine.forecast_date, schema.feedForecastRunLine.run_line_id);
    return { ...run, lines };
  }
}
