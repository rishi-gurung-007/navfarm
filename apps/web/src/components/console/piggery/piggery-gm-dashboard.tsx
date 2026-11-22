'use client';

import { useEffect, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  Coins,
  DollarSign,
  Ham,
  PiggyBank,
  Rat,
  Weight,
} from 'lucide-react';
import { api } from '@/services/api-client';
import { getActiveCompanyId } from '@/hooks/useAuth';
import { useCompanyCurrency } from '@/hooks/useCompanyCurrency';
import { useLanguage } from '@/hooks/useLanguage';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { todayStored } from '@/utils/date-input';
import { PeriodRangeSelect } from './period-range-select';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import {
  Alert,
  AlertsPanel,
  Cell,
  Farm,
  FarmAlert,
  FarmAlertsPanel,
  FarmMatrix,
  FarmRow,
  Figure,
  KgMeatCard,
  KpiCard,
  Matrix,
  MetricRow,
  ProgressChart,
  ProgressPoint,
  Status,
} from './gm-dashboard-widgets';

type Period = {
  period_id: string;
  period_code: string;
  business_year: string;
  start_date: string;
  end_date: string;
};

/** Pigs sold, cost of sales and gross margin of a window, from the ledgers' sold disposals. */
interface SalesFigures {
  heads: number;
  cost_of_sales: number;
  revenue: number;
  gross_margin: number;
  gross_margin_pct: number | null;
}

/** One metric's budget for Month or YTD, with the actual, Var and colour (the API's BudgetCell). */
export interface BudgetCell {
  budget: number | null;
  tolerance_pct: number | null;
  /** The farm codes or period codes that have no budget line. */
  missing: string[];
  actual: number | null;
  var: number | null;
  var_pct: number | null;
  status: Status;
}

export interface GmBudget {
  /** By farm id or 'all', then by the metric's dashboard key. */
  month: Record<string, Record<string, BudgetCell>>;
  ytd: Record<string, Record<string, BudgetCell>>;
  /** Running totals over the business year, as the actual heads_by_period is. */
  by_period: Array<{
    period_code: string;
    pigs_to_slaughter: number | null;
    pbt: number | null;
  }>;
}

export interface GmSlaughterMetrics {
  total_animals: number;
  warm_mass_kg: number;
  cold_mass_kg: number;
  average_carcass_weight_kg: number | null;
  reported_product_value: number;
  grades: Array<{
    grade: string;
    count: number;
    percentage: number;
    warm_mass_kg: number;
    cold_mass_kg: number;
  }>;
  sexes: Array<{
    sex: string;
    count: number;
    percentage: number;
  }>;
  sick_codes: Array<{
    sick_code: string;
    count: number;
  }>;
  by_company: Array<{
    company_id: string;
    company_name: string;
    animals: number;
    warm_mass_kg: number;
    cold_mass_kg: number;
  }>;
  by_farm: Array<{
    farm_id: string;
    farm_name: string;
    animals: number;
    warm_mass_kg: number;
    cold_mass_kg: number;
  }>;
  trends: Array<{
    date: string;
    animals: number;
    warm_mass_kg: number;
    cold_mass_kg: number;
  }>;
  product_categories: Array<{
    category: string;
    quantity: number;
    warm_mass_kg: number;
    cold_mass_kg: number;
    average_mass_kg: number;
    reported_value: number;
  }>;
}

export interface GmDashboardData {
  period:
    | (Period & {
        ytd_from: string;
        to: string;
        /** Set when the dashboard stepped back from the current period, which has no records yet. */
        fallback_from?: string | null;
      })
    | null;
  periods: Period[];
  farms: Farm[];
  financial: {
    month: Record<string, SalesFigures | null>;
    ytd: Record<string, SalesFigures | null>;
    heads_by_period: Array<{ period_code: string; heads: number | null }>;
    /** The business year's running PBT, as heads_by_period is for pigs. */
    pbt_by_period?: Array<{ period_code: string; pbt: number | null }>;
  };
  kg_sold_per_sow_year: {
    month: Record<string, number | null>;
    ytd: Record<string, number | null>;
    /** Each farm's month figure with its target and colour. */
    cells?: Record<string, Cell>;
  };
  budget?: GmBudget;
  breeding: MetricRow[];
  weaner_grower: MetricRow[];
  /** The Slaughter & Financial rows with each farm's Month actual, budget and colour. */
  financial_rows?: MetricRow[];
  alerts: Alert[];
  /** The farms (of those shown) with a farrowing, weaning or sale in the period; the rest have nothing to show. */
  farms_reporting?: { reporting: number; total: number; farm_ids: string[] };
  /** With one farm chosen: its figures over This Week, the averages and a six-week trend. */
  farm_view: {
    farm: Farm;
    sows: number;
    kg_sold_per_sow_year_ytd: number | null;
    breeding: FarmRow[];
    weaner_grower: FarmRow[];
    alerts: FarmAlert[];
  } | null;
  slaughter?: GmSlaughterMetrics;
}

const ALL = '';

const shortDate = (iso: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('T')[0].split('-');
  const mName = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sept',
    'Oct',
    'Nov',
    'Dec',
  ][parseInt(m, 10) - 1];
  return mName && d && y ? `${parseInt(d, 10)} ${mName} ${y}` : iso;
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** A period code (YYYY-MM) as its month's short name, for the chart axes. */
const monthOf = (code: string) =>
  MONTHS[Number(code.split('-')[1]) - 1] ?? code;

/**
 * Phase 2 (Rishi, 2 Nov): the financial half has no data yet — no sales, kill sheet, cost-of-sales or overhead
 * accounts, or budgets. Its rows and figures are laid out now and stay empty until the API returns them.
 */
const FINANCIAL_ROWS: Array<
  Pick<MetricRow, 'key' | 'label' | 'unit' | 'lower_is_better'>
> = [
  {
    key: 'pigs_to_slaughter',
    label: 'Pigs to Slaughter',
    unit: '',
    lower_is_better: false,
  },
  { key: 'avg_cdm', label: 'Avg CDM', unit: 'kg', lower_is_better: false },
  {
    key: 'cost_of_sales',
    label: 'Cost of Sales',
    unit: '',
    lower_is_better: true,
  },
  {
    key: 'cos_per_tonne',
    label: 'COS $/kg CDM',
    unit: '',
    lower_is_better: true,
  },
  {
    key: 'gross_margin',
    label: 'Gross Margin',
    unit: '',
    lower_is_better: false,
  },
  {
    key: 'gross_margin_pct',
    label: 'Gross Margin %',
    unit: '%',
    lower_is_better: false,
  },
  {
    key: 'other_overheads',
    label: 'Other Overheads',
    unit: '',
    lower_is_better: true,
  },
  {
    key: 'staff_overheads',
    label: 'Staff Overheads',
    unit: '',
    lower_is_better: true,
  },
];

/**
 * GM Dashboard (Rishi, 2 Nov; docs/superpowers/specs/2026-11-02-gm-dashboard-phase-1-design.md), on the grid of his
 * mockup in the current theme: the five financial KPI cards; the Breeding & Farrowing, Weaner-Grower and Slaughter &
 * Financial matrices, one dot per farm coloured against the lifecycle targets; the Pigs to Slaughter and PBT
 * progress charts; Kg Meat Sold / Sow / Year and the Management Alerts. A Reporting Period (the one holding today
 * first) and a farm filter it.
 */
export default function PiggeryGmDashboard() {
  const { t } = useLanguage();
  const { currency } = useCompanyCurrency(getActiveCompanyId() ?? undefined);
  const [periodId, setPeriodId] = useState('');
  const [farmId, setFarmId] = useState(ALL);
  // Two ways to choose the window (19 Nov): a Reporting Period, or a custom
  // from/to range (no later than today) with no budget to compare against.
  const [periodMode, setPeriodMode] = useState<'reporting' | 'custom'>(
    'reporting',
  );
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<GmDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (
    period: string,
    farm: string,
    range?: { from: string; to: string },
  ) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const companyId = getActiveCompanyId();
      if (companyId) params.set('companyId', companyId);
      if (range) {
        params.set('fromDate', range.from);
        params.set('toDate', range.to);
      } else if (period) {
        params.set('periodId', period);
      }
      if (farm) params.set('farmId', farm);
      const res = await api.get(
        `/piggery/analytics/gm-dashboard?${params.toString()}`,
      );
      const payload: GmDashboardData = res?.data ?? res;
      setData(payload);
      if (!period && !range && payload.period)
        setPeriodId(payload.period.period_id);
    } catch (err: any) {
      setError(err?.message || t('gmdLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load('', ALL);
  }, []);

  /** Reloads for the chosen farm, keeping whichever window mode is active. */
  const reload = (farm: string) => {
    if (periodMode === 'custom' && customFrom && customTo) {
      void load('', farm, { from: customFrom, to: customTo });
    } else {
      void load(periodId, farm);
    }
  };
  const choosePeriod = (value: string) => {
    setPeriodId(value);
    void load(value, farmId);
  };
  const chooseFarm = (value: string) => {
    setFarmId(value);
    reload(value);
  };
  const choosePeriodMode = (mode: 'reporting' | 'custom') => {
    setPeriodMode(mode);
    if (mode === 'reporting') {
      void load(periodId, farmId);
    } else if (customFrom && customTo) {
      void load('', farmId, { from: customFrom, to: customTo });
    }
  };
  const chooseCustomRange = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    if (from && to) void load('', farmId, { from, to });
  };

  // The response lists only the chosen farm; the picker keeps every farm from the last All Farms load.
  const [allFarms, setAllFarms] = useState<Farm[]>([]);
  useEffect(() => {
    if (data && !farmId) setAllFarms(data.farms);
  }, [data, farmId]);
  const pickerFarms = [
    { farm_id: ALL, farm_name: t('gmdAllFarms') },
    ...allFarms,
  ];

  const period = data?.period ?? null;
  const farms = data?.farms ?? [];
  const money = currency?.iso_code ?? '';
  const kgKey = farmId || 'all';
  // A metric's actual with the API's budget, Var and colour for the chosen farm (or all farms) and Month or YTD.
  const farmName = (code: string) =>
    farms.find((f) => f.farm_code === code)?.farm_name ?? code;
  const withBudget = (
    actual: number | null,
    span: 'month' | 'ytd',
    metric: string,
  ): Figure => {
    const cell = data?.budget?.[span]?.[kgKey]?.[metric];
    if (!cell) return { actual, budget: null };
    // The overheads (and PBT) have no figure on the web side: their actual is the API's.
    const shown = actual ?? cell.actual ?? null;
    // A farm code is named; a period code stays as it is. A budget is absent when null, never by `missing`.
    const names = cell.missing.map(farmName).join(', ');
    return {
      actual: shown,
      budget: cell.budget,
      var: cell.var,
      var_pct: cell.var_pct,
      status: cell.status,
      budgetHint: !cell.missing.length
        ? undefined
        : cell.budget == null
          ? t('gmdNoBudgetFor', { names })
          : t('gmdBudgetPartial', { names }),
    };
  };
  const kgMonth = withBudget(
    data?.kg_sold_per_sow_year.month[kgKey] ?? null,
    'month',
    'kg_sold_per_sow_year',
  );
  const kgYtd = withBudget(
    data?.kg_sold_per_sow_year.ytd[kgKey] ?? null,
    'ytd',
    'kg_sold_per_sow_year',
  );

  // Pigs to Slaughter, Cost of Sales and Gross Margin are the ledgers' sold disposals; the overheads come from their GL accounts (the API's budget cell carries the actual); Avg CDM and COS per tonne have none yet.
  const salesMonth = data?.financial?.month[kgKey] ?? null;
  const salesYtd = data?.financial?.ytd[kgKey] ?? null;
  const salesFigure = (
    sales: SalesFigures | null,
    pick: (s: SalesFigures) => number | null,
    span: 'month' | 'ytd',
    metric: string,
  ): Figure => withBudget(sales ? pick(sales) : null, span, metric);
  const noSales = (span: 'month' | 'ytd', metric: string) =>
    withBudget(null, span, metric);

  // Kg Meat Sold / Sow / Year closes the Breeding & Farrowing matrix, as in the mockup; its target and colour come from the API (the sheet's red / yellow / green).
  const breeding: MetricRow[] = [
    ...(data?.breeding ?? []),
    {
      key: 'kg_sold_per_sow_year',
      label: t('gmdKgSoldPerSowYear'),
      unit: 'kg',
      lower_is_better: false,
      cells: Object.fromEntries(
        farms.map((f) => [
          f.farm_id,
          data?.kg_sold_per_sow_year.cells?.[f.farm_id] ?? {
            value: data?.kg_sold_per_sow_year.month[f.farm_id] ?? null,
            target: null,
            status: null,
          },
        ]),
      ),
    },
  ];
  const SALES_PICKS: Partial<
    Record<string, (s: SalesFigures) => number | null>
  > = {
    pigs_to_slaughter: (s) => s.heads,
    cost_of_sales: (s) => s.cost_of_sales,
    gross_margin: (s) => s.gross_margin,
    gross_margin_pct: (s) => s.gross_margin_pct,
  };
  const webFinancial: MetricRow[] = FINANCIAL_ROWS.map((r) => ({
    ...r,
    cells: Object.fromEntries(
      farms.map((f) => {
        const pick = SALES_PICKS[r.key];
        const sales = data?.financial?.month[f.farm_id] ?? null;
        return [
          f.farm_id,
          {
            value: pick && sales ? pick(sales) : null,
            target: null,
            status: null as null,
          },
        ];
      }),
    ),
  }));
  const financial = data?.financial_rows ?? webFinancial;
  const farmView = farmId ? (data?.farm_view ?? null) : null;
  // "N of M farms reporting": only worth saying when more than one farm is on show.
  const coverage =
    data?.farms_reporting && data.farms_reporting.total > 1
      ? data.farms_reporting
      : null;
  const reportingIds = data?.farms_reporting?.farm_ids;
  // The budget is Month-based, so its colour is the dot's alone and never paints the This Week figure.
  const farmFinancial: FarmRow[] = FINANCIAL_ROWS.map((r) => ({
    ...r,
    target:
      data?.financial_rows?.find((x) => x.key === r.key)?.cells[farmId]
        ?.target ?? null,
    status: null,
    dotStatus:
      data?.financial_rows?.find((x) => x.key === r.key)?.cells[farmId]
        ?.status ?? null,
    trend: Array(6).fill(null),
    values: {
      this_week: null,
      avg_4w: null,
      this_month:
        SALES_PICKS[r.key] && salesMonth
          ? SALES_PICKS[r.key]!(salesMonth)
          : data?.financial_rows?.find((x) => x.key === r.key)?.cells[farmId]
              ?.value ?? null,
      prev_month: null,
      three_month: null,
    },
  }));
  // The business year's periods, for the YTD charts' axis; the budget is already a running total.
  const yearPeriods = (data?.periods ?? []).filter(
    (p) => period && p.business_year === period.business_year,
  );
  const yearCodes = yearPeriods.map((p) => p.period_code);
  const byPeriod = (code: string) =>
    data?.budget?.by_period.find((b) => b.period_code === code);
  const yearPoints: ProgressPoint[] = yearPeriods.map((p) => ({
    label: monthOf(p.period_code),
    actual:
      data?.financial?.heads_by_period.find(
        (h) => h.period_code === p.period_code,
      )?.heads ?? null,
    budget: byPeriod(p.period_code)?.pigs_to_slaughter ?? null,
  }));
  // PBT: gross margin less the overheads, a running total like the pigs.
  const pbtPoints: ProgressPoint[] = yearPoints.map((p, i) => ({
    label: p.label,
    actual:
      data?.financial?.pbt_by_period?.find(
        (h) => h.period_code === yearCodes[i],
      )?.pbt ?? null,
    budget: byPeriod(yearCodes[i])?.pbt ?? null,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-(--border) bg-(--surface) p-3">
        <div className="min-w-0">
          {/* "GM Dashboard" is redundant with the page's own "Dashboard" heading (19 Nov):
            this title shows only when drilled into one farm, naming it. */}
          {farmView && (
            <h2 className="text-lg font-semibold">
              {farmView.farm.farm_name}
            </h2>
          )}
          <p className="text-xs text-(--text-secondary)">
            {farmView
              ? t('gmdSows', { n: farmView.sows.toLocaleString('en-GB') })
              : t('gmdFarmsCount', { n: allFarms.length })}{' '}
            | {t('gmdSubtitle')}
          </p>
          {period && (
            <p
              className="mt-1 text-xs text-(--text-secondary)"
              data-testid="gmd-dates"
            >
              {t('gmdMonth')}: {shortDate(period.start_date)} –{' '}
              {shortDate(period.to)} · {t('gmdYtd')}:{' '}
              {shortDate(period.ytd_from)} – {shortDate(period.to)}
            </p>
          )}
          {data && (period?.fallback_from || coverage) && (
            <p
              className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]"
              data-testid="gmd-coverage"
            >
              {period?.fallback_from && (
                <span className="rounded-(--radius-pill) border border-(--border) bg-(--surface-raised) px-2 py-0.5 text-(--text-secondary)">
                  {t('gmdShowingLatest', {
                    period: period.period_code,
                    current: period.fallback_from,
                  })}
                </span>
              )}
              {coverage && (
                <span
                  className="rounded-(--radius-pill) border border-(--border) px-2 py-0.5 font-medium"
                  style={{
                    color:
                      coverage.reporting === coverage.total
                        ? 'var(--success)'
                        : 'var(--warning)',
                  }}
                >
                  {t('gmdFarmsReporting', {
                    n: coverage.reporting,
                    total: coverage.total,
                  })}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('gmdPeriod')}>
            <PeriodRangeSelect
              ariaLabel={t('gmdPeriod')}
              options={[...(data?.periods ?? [])].reverse().map((r) => ({
                period_id: r.period_id,
                label: `${r.period_code} · ${shortDate(String(r.start_date))} – ${shortDate(String(r.end_date))} (${r.business_year})`,
                selectedLabel: `${r.period_code} (${r.business_year})`,
              }))}
              mode={periodMode}
              onModeChange={choosePeriodMode}
              periodId={periodId}
              onPeriodChange={choosePeriod}
              from={customFrom}
              to={customTo}
              onRangeChange={chooseCustomRange}
              maxDate={todayStored()}
              reportingLabel={t('gmdReportingPeriod')}
              customLabel={t('gmdCustomRange')}
              selectPeriodPlaceholder={t('gmdSelectPeriod')}
              chooseRangePlaceholder={t('gmdCustomRange')}
              searchPlaceholder={t('gmdSearchPeriod')}
              noMatchesLabel={t('gmdNoMatchingPeriods')}
              disabled={!data?.periods.length}
            />
          </Field>
          <Field label={t('rptFarm')}>
            <SearchableSelect
              ariaLabel={t('rptFarm')}
              value={farmId}
              onChange={chooseFarm}
              options={pickerFarms}
              valueKey="farm_id"
              getLabel={(r) => String(r.farm_name ?? '')}
              placeholder={t('gmdAllFarms')}
            />
          </Field>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => reload(farmId)} />
      ) : loading ? (
        <GmDashboardSkeleton />
      ) : !period ? (
        <EmptyState
          title={t('gmdNoPeriods')}
          description={t('gmdNoPeriodsHint')}
        />
      ) : (
        <>
          <div
            className="grid grid-cols-1 gap-3 *:min-w-0 sm:max-[1799px]:grid-cols-2 sm:max-xl:*:nth-5:col-span-2 xl:max-[1799px]:grid-cols-6 xl:max-[1799px]:*:col-span-2 xl:max-[1799px]:*:nth-[n+4]:col-span-3 min-[1800px]:grid-cols-5 min-[1800px]:*:col-span-1"
            data-testid="gmd-kpis"
          >
            <KpiCard
              icon={PiggyBank}
              title={t('gmdPigsToSlaughter')}
              unit={t('gmdHead')}
              month={salesFigure(
                salesMonth,
                (s) => s.heads,
                'month',
                'pigs_to_slaughter',
              )}
              ytd={salesFigure(
                salesYtd,
                (s) => s.heads,
                'ytd',
                'pigs_to_slaughter',
              )}
              t={t}
            />
            <KpiCard
              icon={Weight}
              title={t('gmdAvgCdm')}
              unit="kg"
              month={noSales('month', 'avg_cdm')}
              ytd={noSales('ytd', 'avg_cdm')}
              t={t}
            />
            <KpiCard
              icon={Coins}
              title={t('gmdCostOfSales')}
              unit={money}
              month={salesFigure(
                salesMonth,
                (s) => s.cost_of_sales,
                'month',
                'cost_of_sales',
              )}
              ytd={salesFigure(
                salesYtd,
                (s) => s.cost_of_sales,
                'ytd',
                'cost_of_sales',
              )}
              lowerIsBetter
              t={t}
              sub={{
                label: t('gmdCosPerTonne'),
                unit: money,
                month: noSales('month', 'cos_per_tonne'),
                ytd: noSales('ytd', 'cos_per_tonne'),
                lowerIsBetter: true,
              }}
            />
            <KpiCard
              icon={BarChart3}
              title={t('gmdGrossMargin')}
              unit={money}
              month={salesFigure(
                salesMonth,
                (s) => s.gross_margin,
                'month',
                'gross_margin',
              )}
              ytd={salesFigure(
                salesYtd,
                (s) => s.gross_margin,
                'ytd',
                'gross_margin',
              )}
              t={t}
              sub={{
                label: t('gmdGrossMarginPct'),
                unit: '%',
                month: salesFigure(
                  salesMonth,
                  (s) => s.gross_margin_pct,
                  'month',
                  'gross_margin_pct',
                ),
                ytd: salesFigure(
                  salesYtd,
                  (s) => s.gross_margin_pct,
                  'ytd',
                  'gross_margin_pct',
                ),
                lowerIsBetter: false,
              }}
            />
            <KpiCard
              icon={CalendarDays}
              title={t('gmdOtherOverheads')}
              unit={money}
              month={noSales('month', 'other_overheads')}
              ytd={noSales('ytd', 'other_overheads')}
              lowerIsBetter
              t={t}
              sub={{
                label: t('gmdStaffOverheads'),
                unit: money,
                month: noSales('month', 'staff_overheads'),
                ytd: noSales('ytd', 'staff_overheads'),
                lowerIsBetter: true,
              }}
            />
          </div>

          {farmView ? (
            <div
              className="flex flex-wrap gap-3 *:min-w-0 *:grow *:basis-[30rem]"
              data-testid="gmd-matrices"
            >
              <FarmMatrix
                icon={PiggyBank}
                title={t('gmdBreedingMatrix')}
                rows={farmView.breeding}
                t={t}
                note={period.period_code}
              />
              <FarmMatrix
                icon={Rat}
                title={t('gmdWeanerGrowerMatrix')}
                rows={farmView.weaner_grower}
                t={t}
                note={period.period_code}
              />
              <FarmMatrix
                icon={Ham}
                title={t('gmdFinancialMatrix')}
                rows={farmFinancial}
                t={t}
                budgeted
                note={salesMonth ? period.period_code : t('gmdNoDataYet')}
              />
            </div>
          ) : (
            <div
              className="flex flex-wrap gap-3 *:min-w-0 *:grow *:basis-[30rem]"
              data-testid="gmd-matrices"
            >
              <Matrix
                icon={PiggyBank}
                title={t('gmdBreedingMatrix')}
                rows={breeding}
                farms={farms}
                t={t}
                reportingFarmIds={reportingIds}
                note={period.period_code}
              />
              <Matrix
                icon={Rat}
                title={t('gmdWeanerGrowerMatrix')}
                rows={data!.weaner_grower}
                farms={farms}
                t={t}
                reportingFarmIds={reportingIds}
                note={period.period_code}
              />
              <Matrix
                icon={Ham}
                title={t('gmdFinancialMatrix')}
                rows={financial}
                farms={farms}
                t={t}
                reportingFarmIds={reportingIds}
                budgeted
                note={
                  data?.financial?.month.all
                    ? period.period_code
                    : t('gmdNoDataYet')
                }
              />
            </div>
          )}

          <div
            className="flex flex-wrap gap-3 *:min-w-0 *:grow *:basis-[24rem]"
            data-testid="gmd-bottom"
          >
            <ProgressChart
              icon={PiggyBank}
              title={t('gmdPigsToSlaughterProgress')}
              points={yearPoints}
              t={t}
            />
            <ProgressChart
              icon={DollarSign}
              title={t('gmdPbtProgress')}
              points={pbtPoints}
              t={t}
            />
            <div className="flex min-w-0 flex-col gap-3">
              {farmView ? (
                <>
                  <KgMeatCard
                    icon={Coins}
                    title={t('gmdKgSoldPerSowYearYtd')}
                    main={withBudget(
                      farmView.kg_sold_per_sow_year_ytd,
                      'ytd',
                      'kg_sold_per_sow_year',
                    )}
                    t={t}
                  />
                  <FarmAlertsPanel alerts={farmView.alerts} t={t} />
                </>
              ) : (
                <>
                  <KgMeatCard
                    icon={Coins}
                    title={t('gmdKgSoldPerSowYear')}
                    main={kgMonth}
                    ytd={kgYtd}
                    t={t}
                  />
                  <AlertsPanel alerts={data!.alerts} t={t} />
                </>
              )}
            </div>
          </div>

        </>
      )}
    </div>
  );
}

function GmDashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true">
      <div className="grid grid-cols-1 gap-3 *:min-w-0 sm:max-[1799px]:grid-cols-2 sm:max-xl:*:nth-5:col-span-2 xl:max-[1799px]:grid-cols-6 xl:max-[1799px]:*:col-span-2 xl:max-[1799px]:*:nth-[n+4]:col-span-3 min-[1800px]:grid-cols-5 min-[1800px]:*:col-span-1">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 *:min-w-0 *:grow *:basis-[24rem]">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-80" />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 *:min-w-0 *:grow *:basis-[24rem]">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-72" />
        ))}
      </div>
    </div>
  );
}
