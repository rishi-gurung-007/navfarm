'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Scale } from 'lucide-react';
import { api } from '@/services/api-client';
import { getActiveCompanyId } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { Field } from '@/components/ui/field';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { StatRow, StatCard } from '@/components/ui/stat-row';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/states';
import { NA } from '@/utils/na';

type Status = 'GREEN' | 'AMBER' | 'RED' | null;

interface Cell {
  value: number | null;
  target: number | null;
  status: Status;
}

interface MetricRow {
  key: string;
  label: string;
  unit: string;
  lower_is_better: boolean;
  cells: Record<string, Cell>;
}

type Period = {
  period_id: string;
  period_code: string;
  business_year: string;
  start_date: string;
  end_date: string;
};

type Farm = {
  farm_id: string;
  farm_code: string;
  farm_name: string;
};

interface Alert {
  farm_id: string;
  farm_name: string;
  metric: string;
  unit: string;
  value: number;
  target: number | null;
  status: 'RED' | 'AMBER';
}

export interface GmDashboardData {
  period: (Period & { ytd_from: string; to: string }) | null;
  periods: Period[];
  farms: Farm[];
  kg_sold_per_sow_year: { month: Record<string, number | null>; ytd: Record<string, number | null> };
  breeding: MetricRow[];
  weaner_grower: MetricRow[];
  alerts: Alert[];
}

const ALL = '';

/** The theme's own status colours (Rishi, 2 Nov: the GM Dashboard keeps the current theme). */
const STATUS_COLOR: Record<Exclude<Status, null>, string> = {
  GREEN: 'var(--success)',
  AMBER: 'var(--warning)',
  RED: 'var(--danger)',
};

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const show = (value: number | null | undefined, unit = '') =>
  value == null ? NA : `${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`;

/**
 * GM Dashboard (Rishi, 2 Nov; docs/superpowers/specs/2026-11-02-gm-dashboard-phase-1-design.md): a Reporting Period
 * (the one holding today first) and a farm; Kg Meat Sold / Sow / Year for the month and year to date; the Breeding &
 * Farrowing and Weaner-Grower matrices, one column per farm, coloured against the breed lifecycle targets; and the
 * alerts their red and amber cells raise.
 */
export default function PiggeryGmDashboard() {
  const { t } = useLanguage();
  const [periodId, setPeriodId] = useState('');
  const [farmId, setFarmId] = useState(ALL);
  const [data, setData] = useState<GmDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (period: string, farm: string) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const companyId = getActiveCompanyId();
      if (companyId) params.set('companyId', companyId);
      if (period) params.set('periodId', period);
      if (farm) params.set('farmId', farm);
      const res = await api.get(`/piggery/analytics/gm-dashboard?${params.toString()}`);
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
  const pickerFarms = [{ farm_id: ALL, farm_name: t('gmdAllFarms') }, ...allFarms];

  const kgKey = farmId || 'all';
  const period = data?.period ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-(--border) bg-(--surface) p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('gmdPeriod')}>
            <SearchableSelect
              ariaLabel={t('gmdPeriod')}
              value={periodId}
              onChange={choosePeriod}
              options={[...(data?.periods ?? [])].reverse()}
              valueKey="period_id"
              getLabel={(r) => `${r.period_code} · ${shortDate(String(r.start_date))} – ${shortDate(String(r.end_date))} (${r.business_year})`}
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
          {period && (
            <p className="pb-2 text-xs text-(--text-secondary)" data-testid="gmd-dates">
              {t('gmdMonth')}: {shortDate(period.start_date)} – {shortDate(period.to)} · {t('gmdYtd')}: {shortDate(period.ytd_from)} – {shortDate(period.to)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load(periodId, farmId)}
          aria-label={t('gmdRefresh')}
          title={t('gmdRefresh')}
          className="nf-press rounded-full border border-(--border) p-1.5 text-(--text-secondary) hover:bg-(--surface-raised)"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load(periodId, farmId)} />
      ) : loading && !data ? (
        <GmDashboardSkeleton />
      ) : !period ? (
        <EmptyState title={t('gmdNoPeriods')} description={t('gmdNoPeriodsHint')} />
      ) : (
        <>
          <StatRow columns={2}>
            <StatCard
              label={`${t('gmdKgSoldPerSowYear')} — ${t('gmdMonth')}`}
              value={show(data!.kg_sold_per_sow_year.month[kgKey])}
              unit="kg"
              icon={Scale}
              sub={period.period_code}
            />
            <StatCard
              label={`${t('gmdKgSoldPerSowYear')} — ${t('gmdYtd')}`}
              value={show(data!.kg_sold_per_sow_year.ytd[kgKey])}
              unit="kg"
              icon={Scale}
              sub={period.business_year}
            />
          </StatRow>

          <Matrix title={t('gmdBreedingMatrix')} rows={data!.breeding} farms={data!.farms} t={t} />
          <Matrix title={t('gmdWeanerGrowerMatrix')} rows={data!.weaner_grower} farms={data!.farms} t={t} />

          <section className="rounded-md border border-(--border) bg-(--surface)" aria-label={t('gmdAlerts')}>
            <h3 className="flex items-center gap-2 border-b border-(--border) px-4 py-3 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-(--warning)" />
              {t('gmdAlerts')}
              <span className="text-xs font-normal text-(--text-secondary)">({data!.alerts.length})</span>
            </h3>
            {data!.alerts.length ? (
              <ul className="divide-y divide-(--border)">
                {data!.alerts.map((a, i) => (
                  <li key={`${a.farm_id}-${a.metric}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <StatusDot status={a.status} />
                    <span className="font-medium">{a.farm_name}</span>
                    <span className="text-(--text-secondary)">—</span>
                    <span>{a.metric}</span>
                    <span className="ml-auto font-mono tabular-nums">
                      {show(a.value, a.unit)}
                      <span className="text-(--text-secondary)"> {t('gmdVsTarget')} {show(a.target, a.unit)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-(--text-secondary)">{t('gmdNoAlerts')}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  return (
    <span
      data-status={status ?? 'NONE'}
      aria-hidden
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={status ? { backgroundColor: STATUS_COLOR[status] } : { border: '1px solid var(--border-strong, var(--border))' }}
    />
  );
}

function Matrix({ title, rows, farms, t }: { title: string; rows: MetricRow[]; farms: Farm[]; t: (key: any) => string }) {
  return (
    <section className="rounded-md border border-(--border) bg-(--surface)">
      <h3 className="border-b border-(--border) px-4 py-3 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-(--text-secondary)">
              <th className="px-4 py-2 font-medium">{t('gmdMetric')}</th>
              {farms.map((f) => (
                <th key={f.farm_id} className="px-4 py-2 text-right font-medium" title={f.farm_name}>{f.farm_name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-(--border)">
                <td className="px-4 py-2 font-medium">
                  {row.label}
                  {row.unit && <span className="text-(--text-secondary)"> ({row.unit})</span>}
                </td>
                {farms.map((f) => {
                  const c = row.cells[f.farm_id];
                  return (
                    <td key={f.farm_id} className="px-4 py-2 text-right" title={c?.target != null ? `${t('gmdTarget')}: ${show(c.target)}` : t('gmdNoTarget')}>
                      <span className="inline-flex items-center justify-end gap-2 font-mono tabular-nums">
                        {show(c?.value)}
                        <StatusDot status={c?.status ?? null} />
                      </span>
                      <div className="text-[11px] text-(--text-secondary)">
                        {c?.target != null ? `${t('gmdTarget')} ${show(c.target)}` : t('gmdNoTarget')}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GmDashboardSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-busy="true">
      <div className="grid gap-3 sm:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-72" />
      <Skeleton className="h-56" />
      <Skeleton className="h-32" />
    </div>
  );
}
