'use client';

import { DateInput } from '@/components/ui/date-input';
import { formatDate } from '@/utils/date-short';
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
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import {
  Alert,
  AlertsPanel,
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
  NO_FIGURE,
  ProgressChart,
  ProgressPoint,
} from './gm-dashboard-widgets';

type Period = {
  period_id: string;
  period_code: string;
  business_year: string;
  start_date: string;
  end_date: string;
};

export interface GmDashboardData {
  period: (Period & { ytd_from: string; to: string }) | null;
  periods: Period[];
  farms: Farm[];
  kg_sold_per_sow_year: {
    month: Record<string, number | null>;
    ytd: Record<string, number | null>;
  };
  breeding: MetricRow[];
  weaner_grower: MetricRow[];
  alerts: Alert[];
  /** With one farm chosen: its figures over This Week, the averages and a six-week trend. */
  farm_view: {
    farm: Farm;
    sows: number;
    kg_sold_per_sow_year_ytd: number | null;
    breeding: FarmRow[];
    weaner_grower: FarmRow[];
    alerts: FarmAlert[];
  } | null;
}

const ALL = '';

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

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
    label: 'COS $/tonne',
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
  const [data, setData] = useState<GmDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allAlerts, setAllAlerts] = useState(false);

  const load = async (period: string, farm: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const companyId = getActiveCompanyId();
      if (companyId) params.set('companyId', companyId);
      if (period) params.set('periodId', period);
      if (farm) params.set('farmId', farm);
      const res = await api.get(
        `/piggery/analytics/gm-dashboard?${params.toString()}`,
      );
      const payload: GmDashboardData = res?.data ?? res;
      setData(payload);
      if (!period && payload.period) setPeriodId(payload.period.period_id);
    } catch (err: any) {
      setError(err?.message || t('gmdLoadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load('', ALL);
  }, []);

  const choosePeriod = (value: string) => {
    setPeriodId(value);
    void load(value, farmId);
  };
  const chooseFarm = (value: string) => {
    setFarmId(value);
    void load(periodId, value);
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
  const kgMonth: Figure = {
    actual: data?.kg_sold_per_sow_year.month[kgKey] ?? null,
    budget: null,
  };
  const kgYtd: Figure = {
    actual: data?.kg_sold_per_sow_year.ytd[kgKey] ?? null,
    budget: null,
  };

  // Kg Meat Sold / Sow / Year closes the Breeding & Farrowing matrix, as in the mockup; it has no lifecycle target.
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
          {
            value: data?.kg_sold_per_sow_year.month[f.farm_id] ?? null,
            target: null,
            status: null,
          },
        ]),
      ),
    },
  ];
  const financial: MetricRow[] = FINANCIAL_ROWS.map((r) => ({
    ...r,
    cells: Object.fromEntries(
      farms.map((f) => [
        f.farm_id,
        { value: null, target: null, status: null },
      ]),
    ),
  }));
  const farmView = farmId ? (data?.farm_view ?? null) : null;
  const farmFinancial: FarmRow[] = FINANCIAL_ROWS.map((r) => ({
    ...r,
    target: null,
    status: null,
    trend: Array(6).fill(null),
    values: {
      this_week: null,
      avg_4w: null,
      this_month: null,
      prev_month: null,
      three_month: null,
    },
  }));
  // The business year's periods, for the YTD charts' axis; no actuals or budgets yet.
  const yearPoints: ProgressPoint[] = (data?.periods ?? [])
    .filter((p) => period && p.business_year === period.business_year)
    .map((p) => ({
      label: monthOf(p.period_code),
      actual: null,
      budget: null,
    }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-(--border) bg-(--surface) p-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {farmView ? farmView.farm.farm_name : t('gmdTitle')}
          </h2>
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
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('gmdPeriod')}>
            <SearchableSelect
              ariaLabel={t('gmdPeriod')}
              value={periodId}
              onChange={choosePeriod}
              options={[...(data?.periods ?? [])].reverse()}
              valueKey="period_id"
              getLabel={(r) =>
                `${r.period_code} · ${shortDate(String(r.start_date))} – ${shortDate(String(r.end_date))} (${r.business_year})`
              }
              getSelectedLabel={(r) => `${r.period_code} (${r.business_year})`}
              placeholder={t('gmdSelectPeriod')}
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
        <ErrorState
          message={error}
          onRetry={() => void load(periodId, farmId)}
        />
      ) : loading && !data ? (
        <GmDashboardSkeleton />
      ) : !period ? (
        <EmptyState
          title={t('gmdNoPeriods')}
          description={t('gmdNoPeriodsHint')}
        />
      ) : (
        <>
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
            data-testid="gmd-kpis"
          >
            <KpiCard
              icon={PiggyBank}
              title={t('gmdPigsToSlaughter')}
              unit={t('gmdHead')}
              month={NO_FIGURE}
              ytd={NO_FIGURE}
              t={t}
            />
            <KpiCard
              icon={Weight}
              title={t('gmdAvgCdm')}
              unit="kg"
              month={NO_FIGURE}
              ytd={NO_FIGURE}
              t={t}
            />
            <KpiCard
              icon={Coins}
              title={t('gmdCostOfSales')}
              unit={money}
              month={NO_FIGURE}
              ytd={NO_FIGURE}
              lowerIsBetter
              t={t}
              sub={{
                label: t('gmdCosPerTonne'),
                unit: money,
                month: NO_FIGURE,
                ytd: NO_FIGURE,
                lowerIsBetter: true,
              }}
            />
            <KpiCard
              icon={BarChart3}
              title={t('gmdGrossMargin')}
              unit={money}
              month={NO_FIGURE}
              ytd={NO_FIGURE}
              t={t}
              sub={{
                label: t('gmdGrossMarginPct'),
                unit: '%',
                month: NO_FIGURE,
                ytd: NO_FIGURE,
                lowerIsBetter: false,
              }}
            />
            <KpiCard
              icon={CalendarDays}
              title={t('gmdOtherOverheads')}
              unit={money}
              month={NO_FIGURE}
              ytd={NO_FIGURE}
              lowerIsBetter
              t={t}
              sub={{
                label: t('gmdStaffOverheads'),
                unit: money,
                month: NO_FIGURE,
                ytd: NO_FIGURE,
                lowerIsBetter: true,
              }}
            />
          </div>

          {farmView ? (
            <div
              className="grid gap-3 xl:grid-cols-3"
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
                note={t('gmdNoDataYet')}
              />
            </div>
          ) : (
            <div
              className="grid gap-3 xl:grid-cols-3"
              data-testid="gmd-matrices"
            >
              <Matrix
                icon={PiggyBank}
                title={t('gmdBreedingMatrix')}
                rows={breeding}
                farms={farms}
                t={t}
                note={period.period_code}
              />
              <Matrix
                icon={Rat}
                title={t('gmdWeanerGrowerMatrix')}
                rows={data!.weaner_grower}
                farms={farms}
                t={t}
                note={period.period_code}
              />
              <Matrix
                icon={Ham}
                title={t('gmdFinancialMatrix')}
                rows={financial}
                farms={farms}
                t={t}
                note={t('gmdNoDataYet')}
              />
            </div>
          )}

          <div className="grid gap-3 xl:grid-cols-3" data-testid="gmd-bottom">
            <ProgressChart
              icon={PiggyBank}
              title={t('gmdPigsToSlaughterProgress')}
              points={yearPoints}
              t={t}
            />
            <ProgressChart
              icon={DollarSign}
              title={t('gmdPbtProgress')}
              points={yearPoints}
              t={t}
            />
            <div className="flex min-w-0 flex-col gap-3">
              {farmView ? (
                <>
                  <KgMeatCard
                    icon={Coins}
                    title={t('gmdKgSoldPerSowYearYtd')}
                    main={{
                      actual: farmView.kg_sold_per_sow_year_ytd,
                      budget: null,
                    }}
                    t={t}
                  />
                  <FarmAlertsPanel
                    alerts={farmView.alerts}
                    showAll={allAlerts}
                    onToggle={() => setAllAlerts((v) => !v)}
                    t={t}
                  />
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
                  <AlertsPanel
                    alerts={data!.alerts}
                    showAll={allAlerts}
                    onToggle={() => setAllAlerts((v) => !v)}
                    t={t}
                  />
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-80" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-72" />
        ))}
      </div>
    </div>
  );
}
