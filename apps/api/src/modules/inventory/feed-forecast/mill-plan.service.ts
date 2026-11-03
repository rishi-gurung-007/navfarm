import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { resolveItemFeedForm } from '../../../common/feed-form';
import { FeedSettingsService } from '../feed-settings/feed-settings.service';
import { isCalendarDay } from '../../master-data/reporting-period/reporting-period.rules';
import { addDays } from './feed-forecast.engine';
import { FeedForecastService } from './feed-forecast.service';
import { MillCapacityService } from './mill-capacity.service';
import { buildMillPlan, MillPlan, MillPlanFarmInput, MillPlanInput } from './mill-plan.rules';
import type { QueryMillPlanDto } from './dto/feed-forecast.dto';

const list = (value?: string) => (value ? value.split(',').map((id) => id.trim()).filter(Boolean) : null);

/**
 * Mill Planning (spec 2026-11-03): gathers what buildMillPlan folds — each
 * selected farm's one-week forecast, the approved requisitions and the mill
 * output posted against them, and the mill's capacity — and hands it over.
 * Farms run one after another, never all at once: the engine is heavy and the
 * dev machine has 8 GB. A farm whose forecast fails is reported, not fatal.
 */
@Injectable()
export class MillPlanService {
  constructor(
    private readonly cls: ClsService,
    private readonly forecast: FeedForecastService,
    private readonly millCapacity: MillCapacityService,
    private readonly feedSettings: FeedSettingsService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  async generate(tenantId: string, userType: string | undefined, query: QueryMillPlanDto): Promise<MillPlan & { mills: Array<{ millId: string; millCode: string; millName: string; companyId: string }> }> {
    if (!isCalendarDay(query.weekOf ?? '')) throw new BadRequestException('weekOf must be a calendar date (YYYY-MM-DD).');
    const dates = Array.from({ length: 7 }, (_, i) => addDays(query.weekOf, i));
    const from = dates[0];
    const to = dates[6];

    const scoped = await this.forecast.listFarms(tenantId, userType);
    const wanted = list(query.farmIds);
    if (wanted?.some((id) => !scoped.some((farm) => farm.farmId === id))) throw new ForbiddenException('Not authorized for this farm.');
    const companyIds = [...new Set(scoped.map((farm) => farm.companyId).filter(Boolean))];
    const mills = await this.millCapacity.mills(tenantId, companyIds);
    const mill = query.millId ? mills.find((row) => row.millId === query.millId) : mills[0];
    if (query.millId && !mill) throw new BadRequestException('Mill not found.');
    // A mill belongs to a company, and so do its farms: a chosen farm of another company is refused, not dropped.
    if (mill && wanted?.some((id) => scoped.find((farm) => farm.farmId === id)?.companyId !== mill.companyId)) {
      throw new BadRequestException(`Choose farms of ${mill.millCode}'s company only.`);
    }
    const farms = scoped.filter((farm) => (!wanted || wanted.includes(farm.farmId)) && (!mill || farm.companyId === mill.companyId));

    const inputs: MillPlanFarmInput[] = [];
    const failedFarms: MillPlanInput['failedFarms'] = [];
    for (const farm of farms) {
      try {
        const report = await this.forecast.getForecast({ farmId: farm.farmId, view: 'CUSTOM', from, to }, tenantId, userType, true);
        inputs.push({
          farm: { id: farm.farmId, code: farm.code, name: farm.name },
          daily: report.daily.filter((row) => row.date >= from && row.date <= to),
          sourceBalances: report.sourceBalances,
          dietChanges: report.dietChanges,
        });
      } catch (error) {
        failedFarms.push({ farmId: farm.farmId, code: farm.code, name: farm.name, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const companyId = mill?.companyId ?? farms[0]?.companyId;
    const [demand, producedKg, settings] = await Promise.all([
      // The whole company's approved orders: the mill's output is credited across all of them (mill-plan.rules).
      companyId ? this.millCapacity.approvedDemand(tenantId, { companyIds: [companyId] }, from, to) : Promise.resolve({ lines: [], diets: new Map() }),
      mill ? this.producedKg(tenantId, mill.companyId, mill.millId, from, to) : Promise.resolve([]),
      companyId && farms[0] ? this.feedSettings.resolveForFeedPlanning(companyId, farms[0].farmId) : Promise.resolve(null),
    ]);

    // Code, name and Feed Form from the item master (the item's own Feed Form wins, Rishi 12 Oct) — not from a
    // farm's silo, which may hold the feed in the other form; the forecast's names cover an item the master lacks.
    const items: MillPlanInput['items'] = new Map();
    for (const farm of inputs) {
      for (const point of farm.sourceBalances) if (!items.has(point.itemId)) items.set(point.itemId, { itemCode: point.itemNo, itemName: point.itemName, feedForm: null });
      for (const row of farm.daily) if (!items.has(row.itemId)) items.set(row.itemId, { itemCode: row.itemNo, itemName: row.itemName, feedForm: null });
    }
    for (const diet of demand.diets.values()) items.set(diet.itemId, { itemCode: diet.itemCode, itemName: diet.itemName, feedForm: null });
    for (const line of demand.lines) if (!items.has(line.itemId)) items.set(line.itemId, { itemCode: '', itemName: line.itemId, feedForm: null });
    for (const row of await this.itemRows(tenantId, [...items.keys()])) {
      items.set(row.item_id, { itemCode: row.item_code, itemName: row.item_name, feedForm: resolveItemFeedForm(row) });
    }

    const input: MillPlanInput = {
      dates, farms: inputs, failedFarms, itemIds: list(query.itemIds), items,
      planFarmIds: farms.map((farm) => farm.farmId), approved: demand.lines,
      siloCapacityKg: await this.siloCapacities(tenantId, [...new Set(inputs.flatMap((farm) => farm.sourceBalances.filter((p) => p.sourceType === 'SILO').map((p) => p.locationId)))]), producedKg, mill: mill ?? null, capacityByDate: new Map(),
      warningPct: Number(settings?.capacityWarningPct ?? 90),
    };
    // Two passes: the per-feed capacity is allocated against the totals the first pass works out.
    const draft = buildMillPlan(input);
    if (mill) {
      const demandsByDate = new Map(dates.map((date, i) => [date, draft.production.map((p) => ({ itemId: p.itemId, demandKg: p.days[i].totalKg }))]));
      input.capacityByDate = await this.millCapacity.allocateOnDates(tenantId, [mill.companyId], demandsByDate);
    }
    return {
      ...buildMillPlan(input),
      mills: mills.map((row) => ({ millId: row.millId, millCode: row.millCode, millName: row.millName, companyId: row.companyId })),
    };
  }

  /** silo location_id -> silo_capacity_kg, for the silos the forecasts used. */
  protected async siloCapacities(tenantId: string, locationIds: string[]): Promise<Map<string, number | null>> {
    if (!locationIds.length) return new Map();
    const L = schema.locationMaster;
    const rows = await this.db.select({ id: L.location_id, capacity: L.silo_capacity_kg })
      .from(L).where(and(eq(L.tenant_id, tenantId), inArray(L.location_id, locationIds)));
    return new Map(rows.map((row) => [row.id, row.capacity === null || row.capacity === undefined ? null : Number(row.capacity)]));
  }

  protected async itemRows(tenantId: string, itemIds: string[]) {
    if (!itemIds.length) return [];
    const I = schema.itemMaster;
    return this.db.select({ item_id: I.item_id, item_code: I.item_code, item_name: I.item_name, item_type: I.item_type, feed_form: I.feed_form })
      .from(I).where(and(eq(I.tenant_id, tenantId), inArray(I.item_id, itemIds)));
  }

  /** The chosen mill's output posted for the week, per production date and item. */
  protected async producedKg(tenantId: string, companyId: string, millId: string, from: string, to: string) {
    const O = schema.millProductionOutput;
    const rows = await this.db.select({ production_date: O.production_date, item_id: O.item_id, quantity_kg: O.quantity_kg })
      .from(O)
      .where(and(eq(O.tenant_id, tenantId), eq(O.company_id, companyId), eq(O.mill_location_id, millId), eq(O.status, 'POSTED'), gte(O.production_date, from), lte(O.production_date, to)));
    return rows.map((row) => ({ productionDate: String(row.production_date).slice(0, 10), itemId: row.item_id, quantityKg: Number(row.quantity_kg) || 0 }));
  }
}
