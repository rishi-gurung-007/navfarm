import { Injectable, ForbiddenException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, asc, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import {
  farmScope,
  FarmScope,
  batchScopeConditions,
} from '../../../common/farm-scope';
import { loadBatchDeaths, loadHeadMoves } from '../../production/batch-heads';
import { kpiLimits } from '../../production/lifecycle/kpi-limits';
import { MonthlyOpsService } from '../reports/monthly-ops.service';
import {
  targetsFromLifecycle,
  Target,
  Targets,
  TargetKey,
} from '../reports/farrowing-report.metrics';
import type { OpsMetrics } from '../reports/monthly-ops.metrics';
import {
  GmDashboardPeriod,
  GmFarmView,
  PiggeryGmDashboardData,
  QueryPiggeryGmDashboardDto,
} from './piggery-analytics.dto';
import {
  alertsFrom,
  BreedingFigures,
  breedingFigures,
  cell,
  DatedQty,
  farmAlerts,
  farmRow,
  farmWindows,
  HeadMoveRow,
  kgSoldPerSowYear,
  meanTarget,
  MetricRow,
  StageBatch,
  stageExit,
  StageExit,
  StageFigures,
  stageFigures,
  stageSegments,
} from './gm-dashboard.metrics';

type Farm = { farm_id: string; farm_code: string; farm_name: string };

/** The Breeding & Farrowing rows: the figure, its lifecycle target and whether lower is better. */
const BREEDING_ROWS: Array<{
  key: keyof BreedingFigures;
  label: string;
  unit: string;
  target: TargetKey;
  lower: boolean;
}> = [
  {
    key: 'farrowing_rate_pct',
    label: 'Farrowing Rate',
    unit: '%',
    target: 'farrowing_rate',
    lower: false,
  },
  {
    key: 'total_born_per_litter',
    label: 'Total Born / Litter',
    unit: '',
    target: 'total_born',
    lower: false,
  },
  {
    key: 'born_alive_per_litter',
    label: 'Born Alive / Litter',
    unit: '',
    target: 'born_alive',
    lower: false,
  },
  {
    key: 'pre_wean_mortality_pct',
    label: 'Pre-wean Mortality',
    unit: '%',
    target: 'pre_wean_mortality',
    lower: true,
  },
  {
    key: 'weaned_per_sow',
    label: 'Avg Weaned / Sow',
    unit: '',
    target: 'wean_per_sow',
    lower: false,
  },
  {
    key: 'avg_wean_weight_kg',
    label: 'Avg Wean Weight',
    unit: 'kg',
    target: 'weaning_weight',
    lower: false,
  },
  {
    key: 'litter_mass_kg',
    label: 'Total Litter Mass',
    unit: 'kg',
    target: 'total_litter_mass',
    lower: false,
  },
];

type StagePair = { weaner: StageFigures; grower: StageFigures };
type ExitPair = { weaner: StageExit[]; grower: StageExit[] };
const target = (exits: StageExit[], pick: (e: StageExit) => Target | null) =>
  meanTarget(exits.map(pick));

/** The Weaner-Grower rows: the figure from the stage spells, and its target from those spells' breeds. */
const STAGE_ROWS: Array<{
  key: string;
  label: string;
  unit: string;
  lower: boolean;
  pick: (s: StagePair) => number | null;
  target: ((e: ExitPair) => Target | null) | null;
}> = [
  {
    key: 'weight_70_day',
    label: 'Avg 70 Day Weight',
    unit: 'kg',
    lower: false,
    pick: (s) => s.weaner.exit_weight_kg,
    target: (e) => target(e.weaner, (x) => x.target_weight),
  },
  {
    key: 'gain_70_day',
    label: '70 Day Gain',
    unit: 'kg',
    lower: false,
    pick: (s) => s.weaner.gain_kg,
    target: null,
  },
  {
    key: 'fce_weaner',
    label: 'FCE Weaner',
    unit: '',
    lower: true,
    pick: (s) => s.weaner.fce,
    target: (e) => target(e.weaner, (x) => x.target_fcr),
  },
  {
    key: 'weaner_mortality',
    label: 'Weaner Mortality',
    unit: '%',
    lower: true,
    pick: (s) => s.weaner.mortality_pct,
    target: (e) => target(e.weaner, (x) => x.target_mortality),
  },
  {
    key: 'fce_grower',
    label: 'FCE Grower',
    unit: '',
    lower: true,
    pick: (s) => s.grower.fce,
    target: (e) => target(e.grower, (x) => x.target_fcr),
  },
  {
    key: 'grower_mortality',
    label: 'Grower Mortality',
    unit: '%',
    lower: true,
    pick: (s) => s.grower.mortality_pct,
    target: (e) => target(e.grower, (x) => x.target_mortality),
  },
];

const WEANER = 'WEANER';
const GROWER = 'GROWER';
const STAGE_METRICS = {
  weight: 'BODY_WEIGHT',
  fcr: 'FCR',
  mortality: 'MORTALITY_PCT',
} as const;

const day = (v: unknown) => String(v).slice(0, 10);
const daysIn = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  ) + 1;

/**
 * GM Dashboard (Rishi, 2 Nov; docs/superpowers/specs/2026-11-02-gm-dashboard-phase-1-design.md): for a Reporting
 * Period and the farms the user may see, Kg Meat Sold / Sow / Year (month and year to date), the Breeding &
 * Farrowing and Weaner-Grower matrices against the breed lifecycle targets, and the alerts their red and amber
 * cells raise.
 */
@Injectable()
export class PiggeryAnalyticsService {
  constructor(
    private readonly cls: ClsService,
    private readonly ops: MonthlyOpsService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  private resolveCompanyId(scope: FarmScope, queryCompanyId?: string): string {
    if (scope.companyId) {
      if (queryCompanyId && queryCompanyId !== scope.companyId) {
        throw new ForbiddenException(
          'Report company must match the workspace.',
        );
      }
      return scope.companyId;
    }
    return queryCompanyId || '';
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async getGmDashboard(
    tenantId: string,
    query: QueryPiggeryGmDashboardDto,
    userType?: string,
  ): Promise<PiggeryGmDashboardData> {
    const scope = farmScope(this.cls);
    const companyId = this.resolveCompanyId(scope, query.companyId);
    const P = schema.reportingPeriod;
    const periods: GmDashboardPeriod[] = await this.db
      .select({
        period_id: P.period_id,
        period_code: P.period_code,
        business_year: P.business_year,
        start_date: P.start_date,
        end_date: P.end_date,
      })
      .from(P)
      .where(
        and(
          eq(P.tenant_id, tenantId),
          companyId ? eq(P.company_id, companyId) : undefined,
        ),
      )
      .orderBy(asc(P.start_date));
    const today = this.today();
    const chosen = query.periodId
      ? periods.find((p) => p.period_id === query.periodId)
      : (periods.find((p) => p.start_date <= today && today <= p.end_date) ??
        periods[periods.length - 1]);

    const allFarms = (await this.ops.listFarms(tenantId, userType)).filter(
      (f) => !companyId || !f.company_id || f.company_id === companyId,
    );
    if (query.farmId && !allFarms.some((f) => f.farm_id === query.farmId)) {
      throw new ForbiddenException('This farm is outside your workspace.');
    }
    const farms: Farm[] = allFarms
      .filter((f) => !query.farmId || f.farm_id === query.farmId)
      .map(({ farm_id, farm_code, farm_name }) => ({
        farm_id,
        farm_code,
        farm_name,
      }));

    const empty: PiggeryGmDashboardData = {
      period: null,
      periods,
      farms,
      kg_sold_per_sow_year: { month: {}, ytd: {} },
      breeding: [],
      weaner_grower: [],
      alerts: [],
      farm_view: null,
    };
    if (!chosen) return empty;
    const ytdFrom =
      periods.find((p) => p.business_year === chosen.business_year)
        ?.start_date ?? chosen.start_date;
    const to = chosen.end_date > today ? today : chosen.end_date;
    const period = { ...chosen, ytd_from: ytdFrom, to };
    // A period still to come has no day to count yet.
    if (chosen.start_date > today) return { ...empty, period };

    const month = { name: 'month', startDate: chosen.start_date, endDate: to };
    const ytd = { name: 'ytd', startDate: ytdFrom, endDate: to };
    const stageIds = await this.stageIds(tenantId, companyId);

    const breedingByFarm = new Map<
      string,
      { figures: BreedingFigures; targets: Targets }
    >();
    const kgMonth: Record<string, number | null> = {};
    const kgYtd: Record<string, number | null> = {};
    const allMonth: OpsMetrics[] = [];
    const allYtd: OpsMetrics[] = [];
    const stageByFarm = new Map<
      string,
      { weaner: StageExit[]; grower: StageExit[] }
    >();

    for (const farm of farms) {
      const rows = await this.ops.farmMetrics(tenantId, farm.farm_id, [
        month,
        ytd,
      ]);
      const inMonth = rows
        .filter((r) => r.month === 'month')
        .map((r) => r.metrics);
      const inYtd = rows.filter((r) => r.month === 'ytd').map((r) => r.metrics);
      allMonth.push(...inMonth);
      allYtd.push(...inYtd);
      kgMonth[farm.farm_id] = kgSoldPerSowYear(
        inMonth,
        daysIn(month.startDate, month.endDate),
      );
      kgYtd[farm.farm_id] = kgSoldPerSowYear(
        inYtd,
        daysIn(ytd.startDate, ytd.endDate),
      );

      const breedIds = [...new Set(rows.map((r) => r.breed_id))];
      const lifecycle = await this.lifecycleRows(
        tenantId,
        companyId,
        farm.farm_id,
        month.startDate,
        month.endDate,
        breedIds,
      );
      const perBreed = breedIds.map((id) =>
        targetsFromLifecycle(
          lifecycle.filter((r) => r.breed_id === id),
          farm.farm_id,
        ),
      );
      const targets = {} as Targets;
      for (const row of BREEDING_ROWS)
        targets[row.target] = meanTarget(perBreed.map((t) => t[row.target]));
      breedingByFarm.set(farm.farm_id, {
        figures: breedingFigures(inMonth),
        targets,
      });

      stageByFarm.set(
        farm.farm_id,
        await this.stageExits(
          tenantId,
          companyId,
          farm.farm_id,
          month.startDate,
          month.endDate,
          stageIds,
          scope,
        ),
      );
    }
    kgMonth.all = kgSoldPerSowYear(
      allMonth,
      daysIn(month.startDate, month.endDate),
    );
    kgYtd.all = kgSoldPerSowYear(allYtd, daysIn(ytd.startDate, ytd.endDate));

    const breeding: MetricRow[] = BREEDING_ROWS.map((row) => ({
      key: row.key,
      label: row.label,
      unit: row.unit,
      lower_is_better: row.lower,
      cells: Object.fromEntries(
        farms.map((f) => {
          const b = breedingByFarm.get(f.farm_id)!;
          return [
            f.farm_id,
            cell(b.figures[row.key], b.targets[row.target], row.lower),
          ];
        }),
      ),
    }));

    const figures = new Map(
      farms.map((f) => {
        const s = stageByFarm.get(f.farm_id)!;
        return [
          f.farm_id,
          {
            weaner: stageFigures(s.weaner),
            grower: stageFigures(s.grower),
            exits: s,
          },
        ];
      }),
    );
    const weanerGrower: MetricRow[] = STAGE_ROWS.map((row) => ({
      key: row.key,
      label: row.label,
      unit: row.unit,
      lower_is_better: row.lower,
      cells: Object.fromEntries(
        farms.map((f) => {
          const s = figures.get(f.farm_id)!;
          return [
            f.farm_id,
            cell(
              row.pick(s),
              row.target ? row.target(s.exits) : null,
              row.lower,
            ),
          ];
        }),
      ),
    }));

    return {
      period,
      periods,
      farms,
      kg_sold_per_sow_year: { month: kgMonth, ytd: kgYtd },
      breeding,
      weaner_grower: weanerGrower,
      alerts: alertsFrom([...breeding, ...weanerGrower], farms),
      farm_view:
        query.farmId && farms.length === 1
          ? await this.farmView(
              tenantId,
              companyId,
              farms[0],
              period,
              periods,
              stageIds,
              scope,
              kgYtd[farms[0].farm_id] ?? null,
            )
          : null,
    };
  }

  /**
   * One farm, as the mockup's Farm view (Rishi, 2 Nov): each matrix row's figure for This Week, the 4-week average,
   * This Month, Prev. Month and 3 Months (farmWindows), its six-week trend, and This Week against the target; the
   * farm's sows on the period's last day; and This Week's red, amber and on-target rows as alerts.
   */
  private async farmView(
    tenantId: string,
    companyId: string,
    farm: Farm,
    period: GmDashboardPeriod & { to: string },
    periods: GmDashboardPeriod[],
    stageIds: Record<string, string[]>,
    scope: FarmScope,
    kgYtd: number | null,
  ): Promise<GmFarmView> {
    const at = periods.findIndex((p) => p.period_id === period.period_id);
    const previous = [periods[at - 1], periods[at - 2]].filter(
      (p): p is GmDashboardPeriod => !!p,
    );
    const windows = farmWindows(period.to, period, previous);
    const has = (key: string) => windows.some((w) => w.key === key);
    const from = windows.map((w) => w.startDate).sort()[0];

    const rows = await this.ops.farmMetrics(
      tenantId,
      farm.farm_id,
      windows.map((w) => ({ name: w.key, ...w })),
    );
    const opsOf = (key: string) =>
      rows.filter((r) => r.month === key).map((r) => r.metrics);
    const breedIds = [...new Set(rows.map((r) => r.breed_id))];
    const lifecycle = await this.lifecycleRows(
      tenantId,
      companyId,
      farm.farm_id,
      period.start_date,
      period.to,
      breedIds,
    );
    const perBreed = breedIds.map((id) =>
      targetsFromLifecycle(
        lifecycle.filter((r) => r.breed_id === id),
        farm.farm_id,
      ),
    );
    const figures = new Map(
      windows.map((w) => [w.key, breedingFigures(opsOf(w.key))]),
    );
    const breeding = BREEDING_ROWS.map((row) =>
      farmRow(
        { key: row.key, label: row.label, unit: row.unit, lower: row.lower },
        (k) => figures.get(k)?.[row.key] ?? null,
        meanTarget(perBreed.map((t) => t[row.target])),
        has,
      ),
    );

    const exits = await this.stageExits(
      tenantId,
      companyId,
      farm.farm_id,
      from,
      period.to,
      stageIds,
      scope,
    );
    const inWindow = (list: StageExit[], key: string) => {
      const w = windows.find((x) => x.key === key);
      return w
        ? list.filter(
            (e) => e.exit_date >= w.startDate && e.exit_date <= w.endDate,
          )
        : [];
    };
    const stage = new Map(
      windows.map((w) => [
        w.key,
        {
          weaner: stageFigures(inWindow(exits.weaner, w.key)),
          grower: stageFigures(inWindow(exits.grower, w.key)),
        },
      ]),
    );
    const weanerGrower = STAGE_ROWS.map((row) =>
      farmRow(
        { key: row.key, label: row.label, unit: row.unit, lower: row.lower },
        (k) => (stage.get(k) ? row.pick(stage.get(k)!) : null),
        row.target ? row.target(exits) : null,
        has,
      ),
    );

    const sows = opsOf('this_month').reduce(
      (a, m) => a + m.sows_on_last_day,
      0,
    );
    return {
      farm,
      sows,
      windows: windows
        .filter((w) => !w.key.startsWith('week_'))
        .map((w) => ({
          key: w.key,
          start_date: w.startDate,
          end_date: w.endDate,
        })),
      kg_sold_per_sow_year_ytd: kgYtd,
      breeding,
      weaner_grower: weanerGrower,
      alerts: farmAlerts([...breeding, ...weanerGrower]),
    };
  }

  /** The stage ids of WEANER and GROWER, the company's own row first, as stage masters are overridden. */
  private async stageIds(
    tenantId: string,
    companyId: string,
  ): Promise<Record<string, string[]>> {
    const S = schema.stageMaster;
    const rows = await this.db
      .select({ stage_id: S.stage_id, stage_code: S.stage_code })
      .from(S)
      .where(
        and(
          eq(S.tenant_id, tenantId),
          inArray(S.stage_code, [WEANER, GROWER]),
          companyId
            ? or(isNull(S.company_id), eq(S.company_id, companyId))
            : isNull(S.company_id),
        ),
      );
    const out: Record<string, string[]> = { [WEANER]: [], [GROWER]: [] };
    for (const r of rows) out[r.stage_code]?.push(r.stage_id);
    return out;
  }

  /** The breeds' active lifecycle rows in force during the dates, for the farm or company-wide (as R07 reads them). */
  private async lifecycleRows(
    tenantId: string,
    companyId: string,
    farmId: string,
    from: string,
    to: string,
    breedIds: string[],
    stageIds?: string[],
  ) {
    if (!breedIds.length) return [];
    const l = schema.breedLifecycleStages;
    const conditions: SQL[] = [
      eq(l.tenant_id, tenantId),
      inArray(l.breed_id, breedIds),
      eq(l.is_active, true),
      isNull(l.retired_at),
      or(isNull(l.farm_id), eq(l.farm_id, farmId)) as SQL,
      or(isNull(l.effective_from), sql`${l.effective_from} <= ${to}`) as SQL,
      or(isNull(l.effective_to), sql`${l.effective_to} >= ${from}`) as SQL,
      companyId ? eq(l.company_id, companyId) : isNull(l.company_id),
    ];
    if (stageIds)
      conditions.push(
        stageIds.length ? inArray(l.stage_id, stageIds) : sql`FALSE`,
      );
    return this.db
      .select({
        breed_id: l.breed_id,
        farm_id: l.farm_id,
        kpi_thresholds: l.kpi_thresholds,
      })
      .from(l)
      .where(and(...conditions));
  }

  /** One KPI's target from lifecycle rows, the farm's own row first. */
  private metricTarget(
    rows: Array<{ farm_id: string | null; kpi_thresholds: unknown }>,
    farmId: string,
    metric: string,
  ): Target | null {
    const ordered = [...rows].sort(
      (a, b) => Number(b.farm_id === farmId) - Number(a.farm_id === farmId),
    );
    for (const row of ordered) {
      let list = row.kpi_thresholds;
      if (typeof list === 'string') {
        try {
          list = JSON.parse(list);
        } catch {
          list = null;
        }
      }
      if (!Array.isArray(list)) continue;
      const found = list.find((t: any) => t?.metric === metric);
      if (!found) continue;
      const limits = kpiLimits(found);
      if (
        limits.average !== null ||
        limits.lower !== null ||
        limits.upper !== null
      )
        return limits;
    }
    return null;
  }

  /**
   * The weaner and grower spells of the farm's batches that ended in the period (the batch moved on, or closed), with
   * the records stageExit needs. Weight is the batch's posted BODY_WEIGHT (per-animal rows averaged per day); feed is
   * its unreversed CONSUMPTION kg; a weaner spell's entry weight is the weaning weight of the batch's litters, a
   * grower spell's the last weighing on or before it entered.
   */
  private async stageExits(
    tenantId: string,
    companyId: string,
    farmId: string,
    from: string,
    to: string,
    stageIds: Record<string, string[]>,
    scope: FarmScope,
  ): Promise<{ weaner: StageExit[]; grower: StageExit[] }> {
    const B = schema.batchHeader;
    const batches = await this.db
      .select({
        batch_id: B.batch_id,
        breed_id: B.breed_id,
        start_date: B.start_date,
        actual_end_date: B.actual_end_date,
        closed_at: B.closed_at,
        status: B.status,
        current_stage_code: B.current_stage_code,
        opening: B.opening_quantity,
      })
      .from(B)
      .where(
        and(
          eq(B.tenant_id, tenantId),
          eq(B.farm_id, farmId),
          isNull(B.deleted_at),
          ...batchScopeConditions(scope),
        ),
      );
    if (!batches.length) return { weaner: [], grower: [] };
    const ids = batches.map((b) => b.batch_id);

    const L = schema.batchStageLog;
    const logs = await this.db
      .select({
        batch_id: L.batch_id,
        from: L.from_stage_code,
        to: L.to_stage_code,
        at: L.transferred_at,
      })
      .from(L)
      .where(inArray(L.batch_id, ids));
    const stageBatches = new Map<string, StageBatch>(
      batches.map((b) => [
        b.batch_id,
        {
          batch_id: b.batch_id,
          start_date: day(b.start_date),
          end_date:
            b.status === 'CLOSED'
              ? day(b.actual_end_date ?? b.closed_at ?? to)
              : null,
          current_stage_code: b.current_stage_code,
          moves: logs
            .filter((l) => l.batch_id === b.batch_id)
            .map((l) => ({ from: l.from, to: l.to, date: day(l.at) })),
        },
      ]),
    );
    const ending = (stage: string) =>
      batches.flatMap((b) =>
        stageSegments(stageBatches.get(b.batch_id)!, stage)
          .filter(
            (s): s is { start: string; exit: string } =>
              !!s.exit && s.exit >= from && s.exit <= to,
          )
          .map((segment) => ({ batch: b, segment })),
      );
    const weanerSpells = ending(WEANER);
    const growerSpells = ending(GROWER);
    const used = [
      ...new Set(
        [...weanerSpells, ...growerSpells].map((s) => s.batch.batch_id),
      ),
    ];
    if (!used.length) return { weaner: [], grower: [] };

    const deaths = await loadBatchDeaths(this.db, used, to);
    const moves = new Map<string, HeadMoveRow[]>();
    for (const m of await loadHeadMoves(this.db, used, to)) {
      if (m.toBatchId && used.includes(m.toBatchId))
        moves.set(m.toBatchId, [
          ...(moves.get(m.toBatchId) ?? []),
          { date: m.date, heads: m.heads },
        ]);
      if (m.fromBatchId && used.includes(m.fromBatchId))
        moves.set(m.fromBatchId, [
          ...(moves.get(m.fromBatchId) ?? []),
          { date: m.date, heads: -m.heads },
        ]);
    }

    const T = schema.batchTransaction;
    const feedRows = await this.db
      .select({
        batch_id: T.batch_id,
        date: T.transaction_date,
        quantity: T.quantity,
      })
      .from(T)
      .where(
        and(
          inArray(T.batch_id, used),
          eq(T.transaction_type, 'CONSUMPTION'),
          isNull(T.reversed_at),
          sql`UPPER(${T.uom}) = 'KG'`,
          sql`${T.transaction_date} <= ${to}`,
        ),
      );
    const feed = new Map<string, DatedQty[]>();
    for (const r of feedRows)
      feed.set(r.batch_id, [
        ...(feed.get(r.batch_id) ?? []),
        { date: day(r.date), quantity: Number(r.quantity) || 0 },
      ]);

    const D = schema.batchDailyData;
    const SL = schema.schedulerLine;
    const weightRows = await this.db
      .select({
        batch_id: D.batch_id,
        date: D.entry_date,
        value: sql<string>`AVG(${D.entered_value})`,
      })
      .from(D)
      .innerJoin(SL, eq(SL.line_id, D.line_id))
      .where(
        and(
          inArray(D.batch_id, used),
          eq(D.posted, true),
          eq(SL.kpi_metric, 'BODY_WEIGHT'),
          sql`${D.entered_value} > 0`,
          sql`${D.entry_date} <= ${to}`,
        ),
      )
      .groupBy(D.batch_id, D.entry_date);
    const weights = new Map<string, DatedQty[]>();
    for (const r of weightRows)
      weights.set(r.batch_id, [
        ...(weights.get(r.batch_id) ?? []),
        { date: day(r.date), quantity: Number(r.value) },
      ]);

    const F = schema.farrowingRecord;
    const weanRows = await this.db
      .select({
        batch_id: F.piglet_batch_id,
        weight: sql<
          string | null
        >`SUM(${F.piglets_weaned} * ${F.avg_weaning_weight_kg}) / NULLIF(SUM(${F.piglets_weaned}), 0)`,
      })
      .from(F)
      .where(
        and(
          inArray(F.piglet_batch_id, used),
          sql`${F.avg_weaning_weight_kg} IS NOT NULL`,
          sql`${F.piglets_weaned} > 0`,
        ),
      )
      .groupBy(F.piglet_batch_id);
    const weanWeight = new Map(
      weanRows.map((r) => [
        r.batch_id as string,
        r.weight == null ? null : Number(r.weight),
      ]),
    );

    const breedIds = [
      ...new Set(
        batches.map((b) => b.breed_id).filter((id): id is string => !!id),
      ),
    ];
    const targetsFor = async (stage: string) => {
      const rows = await this.lifecycleRows(
        tenantId,
        companyId,
        farmId,
        from,
        to,
        breedIds,
        stageIds[stage],
      );
      return new Map(
        breedIds.map((id) => {
          const own = rows.filter((r) => r.breed_id === id);
          return [
            id,
            {
              weight: this.metricTarget(own, farmId, STAGE_METRICS.weight),
              fcr: this.metricTarget(own, farmId, STAGE_METRICS.fcr),
              mortality: this.metricTarget(
                own,
                farmId,
                STAGE_METRICS.mortality,
              ),
            },
          ];
        }),
      );
    };
    const weanerTargets = await targetsFor(WEANER);
    const growerTargets = await targetsFor(GROWER);
    const none = { weight: null, fcr: null, mortality: null };

    const exitOf = (
      spell: {
        batch: (typeof batches)[number];
        segment: { start: string; exit: string };
      },
      targets: Map<
        string,
        { weight: Target | null; fcr: Target | null; mortality: Target | null }
      >,
      entryWeight: number | null,
    ) =>
      stageExit({
        segment: spell.segment,
        opening: Number(spell.batch.opening) || 0,
        deaths: (deaths.get(spell.batch.batch_id) ?? []).map((d) => ({
          date: d.date,
          quantity: d.quantity,
        })),
        moves: moves.get(spell.batch.batch_id) ?? [],
        feed: feed.get(spell.batch.batch_id) ?? [],
        weights: weights.get(spell.batch.batch_id) ?? [],
        entryWeight,
        targets: targets.get(spell.batch.breed_id ?? '') ?? none,
      });
    const firstIn = (batchId: string, start: string, exit: string) =>
      (weights.get(batchId) ?? [])
        .filter((w) => w.date >= start && w.date <= exit)
        .sort((a, b) => a.date.localeCompare(b.date))[0]?.quantity ?? null;
    const lastBy = (batchId: string, upTo: string) =>
      (weights.get(batchId) ?? [])
        .filter((w) => w.date <= upTo)
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.quantity ?? null;

    return {
      weaner: weanerSpells.map((s) =>
        exitOf(
          s,
          weanerTargets,
          weanWeight.get(s.batch.batch_id) ??
            firstIn(s.batch.batch_id, s.segment.start, s.segment.exit),
        ),
      ),
      grower: growerSpells.map((s) =>
        exitOf(
          s,
          growerTargets,
          lastBy(s.batch.batch_id, s.segment.start) ??
            firstIn(s.batch.batch_id, s.segment.start, s.segment.exit),
        ),
      ),
    };
  }
}
