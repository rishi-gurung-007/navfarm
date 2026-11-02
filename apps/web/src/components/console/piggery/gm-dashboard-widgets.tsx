'use client';

import type { ElementType, ReactNode } from 'react';
import { ArrowDown, ArrowUp, Bell, ChevronRight, CircleAlert } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { NA } from '@/utils/na';
import type { TranslationKeys } from '@/utils/translations';

/**
 * The GM Dashboard's building blocks, laid out as Rishi's mockup (2 Nov). The financial ones (KPI cards, the
 * Slaughter & Financial matrix, the YTD progress charts) are phase 2: they take actuals and budgets when the API has
 * them and say "No data yet" until then.
 */

export type Status = 'GREEN' | 'AMBER' | 'RED' | null;

export interface Cell {
  value: number | null;
  target: number | null;
  status: Status;
}

export interface MetricRow {
  key: string;
  label: string;
  unit: string;
  lower_is_better: boolean;
  cells: Record<string, Cell>;
}

export type Farm = { farm_id: string; farm_code: string; farm_name: string };

/** An actual against its budget; either may be missing. */
export interface Figure {
  actual: number | null;
  budget: number | null;
}

export const NO_FIGURE: Figure = { actual: null, budget: null };

type T = (key: TranslationKeys) => string;

/** The theme's own status colours (Rishi, 2 Nov: the GM Dashboard keeps the current theme). */
const STATUS_COLOR: Record<Exclude<Status, null>, string> = {
  GREEN: 'var(--success)',
  AMBER: 'var(--warning)',
  RED: 'var(--danger)',
};

export const fmt = (value: number | null | undefined, unit = '') =>
  value == null ? NA : `${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`;

const signed = (value: number, unit = '') => `${value > 0 ? '+' : ''}${fmt(value, unit)}`;

/** Actual − budget and its share of the budget, and whether it is good news. */
export function variance(f: Figure, lowerIsBetter: boolean) {
  if (f.actual == null || f.budget == null) return null;
  const diff = Number((f.actual - f.budget).toFixed(2));
  const pct = f.budget !== 0 ? Number(((diff / Math.abs(f.budget)) * 100).toFixed(1)) : null;
  return { diff, pct, up: diff >= 0, good: lowerIsBetter ? diff <= 0 : diff >= 0 };
}

export function StatusDot({ status, size = 'md' }: { status: Status; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5';
  return (
    <span
      data-status={status ?? 'NONE'}
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${dim}`}
      style={status ? { backgroundColor: STATUS_COLOR[status] } : { border: '1.5px dashed var(--text-muted)' }}
    />
  );
}

function TrendArrow({ v }: { v: ReturnType<typeof variance> }) {
  if (!v) return null;
  const Icon = v.up ? ArrowUp : ArrowDown;
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-white"
      style={{ backgroundColor: v.good ? 'var(--success)' : 'var(--danger)' }}
      aria-label={v.good ? 'on or better than budget' : 'worse than budget'}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  );
}

function VarianceText({ v, unit }: { v: ReturnType<typeof variance>; unit: string }) {
  if (!v) return <span className="text-(--text-secondary)">{NA}</span>;
  return (
    <span className="font-semibold" style={{ color: v.good ? 'var(--success)' : 'var(--danger)' }}>
      {signed(v.diff, unit === '%' ? 'pp' : '')}
      {v.pct != null && unit !== '%' && <span className="block text-[11px]">{signed(v.pct, '%')}</span>}
    </span>
  );
}

/** One side of a KPI card: Month or YTD, its actual, arrow, budget and variance. */
function FigureBlock({ label, figure, unit, lowerIsBetter, t }: { label: string; figure: Figure; unit: string; lowerIsBetter: boolean; t: T }) {
  const v = variance(figure, lowerIsBetter);
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="text-xs text-(--text-secondary)">{label}</p>
          <p className="truncate font-mono text-xl font-semibold tabular-nums">{fmt(figure.actual, unit === '%' ? '%' : '')}</p>
        </div>
        <TrendArrow v={v} />
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
        <div>
          <p className="text-(--text-secondary)">{t('gmdBudget')}</p>
          <p className="font-mono tabular-nums">{fmt(figure.budget, unit === '%' ? '%' : '')}</p>
        </div>
        <div>
          <p className="text-(--text-secondary)">{t('gmdVar')}</p>
          <p className="font-mono tabular-nums"><VarianceText v={v} unit={unit} /></p>
        </div>
      </div>
    </div>
  );
}

/** A secondary KPI under the main one (COS $/tonne, Gross Margin %, Staff Overheads): Month and YTD on one line each. */
export interface SubKpi {
  label: string;
  unit: string;
  month: Figure;
  ytd: Figure;
  lowerIsBetter: boolean;
}

function SubLine({ label, figure, unit, lowerIsBetter, t }: { label: string; figure: Figure; unit: string; lowerIsBetter: boolean; t: T }) {
  const v = variance(figure, lowerIsBetter);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-9 text-(--text-secondary)">{label}</span>
      <span className="font-mono font-semibold tabular-nums">{fmt(figure.actual, unit === '%' ? '%' : '')}</span>
      <span className="text-(--text-secondary)">{t('gmdBudget')} {fmt(figure.budget, unit === '%' ? '%' : '')}</span>
      <span className="ml-auto"><VarianceText v={v} unit={unit} /></span>
    </div>
  );
}

export function KpiCard({
  icon: Icon, title, unit, month, ytd, lowerIsBetter = false, sub, t,
}: {
  icon: ElementType;
  title: string;
  unit: string;
  month: Figure;
  ytd: Figure;
  lowerIsBetter?: boolean;
  sub?: SubKpi;
  t: T;
}) {
  const empty = month.actual == null && ytd.actual == null;
  return (
    <section className="flex flex-col rounded-md border border-(--border) bg-(--surface)" aria-label={title} data-kpi={title}>
      <header className="flex items-center gap-2 rounded-t-md border-b border-(--border) bg-(--surface-raised) px-3 py-2.5">
        <Icon className="h-5 w-5 shrink-0 text-(--accent)" />
        <h3 className="min-w-0 truncate text-xs font-bold uppercase tracking-wide">
          {title}
          {unit && unit !== '%' && <span className="font-medium normal-case text-(--text-secondary)"> ({unit})</span>}
        </h3>
      </header>
      <div className="flex flex-1 flex-col gap-3 p-3">
        {empty && (
          <span className="self-start rounded-(--radius-pill) border border-(--border) px-2 py-0.5 text-[10px] text-(--text-secondary)">
            {t('gmdNoDataYet')}
          </span>
        )}
        <div className="flex gap-3">
          <FigureBlock label={t('gmdMonth')} figure={month} unit={unit} lowerIsBetter={lowerIsBetter} t={t} />
          <div className="w-px bg-(--border)" />
          <FigureBlock label={t('gmdYtd')} figure={ytd} unit={unit} lowerIsBetter={lowerIsBetter} t={t} />
        </div>
        {sub && (
          <div className="mt-auto space-y-1 border-t border-dashed border-(--border) pt-2">
            <p className="text-xs font-medium">{sub.label}{sub.unit && sub.unit !== '%' ? ` (${sub.unit})` : ''}</p>
            <SubLine label={t('gmdMonth')} figure={sub.month} unit={sub.unit} lowerIsBetter={sub.lowerIsBetter} t={t} />
            <SubLine label={t('gmdYtd')} figure={sub.ytd} unit={sub.unit} lowerIsBetter={sub.lowerIsBetter} t={t} />
          </div>
        )}
      </div>
    </section>
  );
}

/** A status matrix: one row per metric, one dot per farm; the value and target show on hover. */
export function Matrix({
  icon: Icon, title, rows, farms, t, note,
}: {
  icon: ElementType;
  title: string;
  rows: MetricRow[];
  farms: Farm[];
  t: T;
  note?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-md border border-(--border) bg-(--surface)" aria-label={title}>
      <header className="flex items-center gap-2 border-b border-(--border) px-4 py-3">
        <Icon className="h-5 w-5 shrink-0 text-(--accent)" />
        <h3 className="text-sm font-semibold">{title}</h3>
        {note && <span className="ml-auto text-[10px] text-(--text-secondary)">{note}</span>}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-(--surface-raised) text-(--text-secondary)">
              <th className="px-3 py-2 text-left font-medium">{t('gmdMetric')}</th>
              {farms.map((f) => (
                <th key={f.farm_id} className="px-2 py-2 text-center font-medium" title={f.farm_name}>{f.farm_name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-(--border)">
                <td className="px-3 py-2">{row.label}</td>
                {farms.map((f) => {
                  const c = row.cells[f.farm_id];
                  const tip = `${f.farm_name} — ${row.label}: ${fmt(c?.value, row.unit)} · ${
                    c?.target != null ? `${t('gmdTarget')} ${fmt(c.target, row.unit)}` : t('gmdNoTarget')}`;
                  return (
                    <td key={f.farm_id} className="px-2 py-2 text-center" title={tip} aria-label={tip}>
                      <span className="inline-flex justify-center"><StatusDot status={c?.status ?? null} /></span>
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

export interface ProgressPoint {
  label: string;
  actual: number | null;
  budget: number | null;
}

const tick = { fontSize: 11, fill: 'var(--text-secondary)' };
const tooltipStyle = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface-raised)',
  color: 'var(--text-primary)',
  fontSize: 12,
};

/** Cumulative actual (bars) against cumulative budget (dashed line) per period of the business year. */
export function ProgressChart({ icon: Icon, title, points, t }: { icon: ElementType; title: string; points: ProgressPoint[]; t: T }) {
  const empty = points.every((p) => p.actual == null && p.budget == null);
  return (
    <section className="flex min-w-0 flex-col rounded-md border border-(--border) bg-(--surface)" aria-label={title}>
      <header className="flex items-center gap-2 border-b border-(--border) px-4 py-3">
        <Icon className="h-5 w-5 shrink-0 text-(--accent)" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </header>
      <div className="relative h-64 px-2 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval={0} />
            <YAxis tick={tick} tickLine={false} axisLine={false} width={48} domain={empty ? [0, 1] : ['auto', 'auto']}
              tickFormatter={(v: number) => (empty ? '' : v.toLocaleString('en-GB', { notation: 'compact' }))} />
            {!empty && <Tooltip contentStyle={tooltipStyle} />}
            <Bar dataKey="actual" name={t('gmdActual')} fill="var(--accent)" radius={[2, 2, 0, 0]} />
            <Line dataKey="budget" name={t('gmdBudget')} stroke="var(--text-primary)" strokeDasharray="6 4" dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-(--text-secondary)">{t('gmdNoDataYet')}</p>
        )}
      </div>
      <footer className="flex items-center justify-center gap-5 pb-3 text-xs text-(--text-secondary)">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-xs bg-(--accent)" />{t('gmdActual')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-(--text-primary)" />{t('gmdBudget')}</span>
      </footer>
    </section>
  );
}

export interface Alert {
  farm_id: string;
  farm_name: string;
  metric: string;
  unit: string;
  value: number;
  target: number | null;
  status: 'RED' | 'AMBER';
}

const ALERTS_SHOWN = 6;

export function AlertsPanel({ alerts, showAll, onToggle, t }: { alerts: Alert[]; showAll: boolean; onToggle: () => void; t: T }) {
  const shown = showAll ? alerts : alerts.slice(0, ALERTS_SHOWN);
  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-md border border-(--border) bg-(--surface)" aria-label={t('gmdAlerts')}>
      <header className="flex items-center gap-2 border-b border-(--border) px-4 py-3">
        <Bell className="h-5 w-5 text-(--accent)" />
        <h3 className="text-sm font-semibold">{t('gmdAlerts')}</h3>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-(--danger) px-1.5 text-[11px] font-bold text-white">
          {alerts.length}
        </span>
        {alerts.length > ALERTS_SHOWN && (
          <button type="button" onClick={onToggle} className="nf-press ml-auto text-xs font-semibold text-(--accent)">
            {showAll ? t('gmdShowFewer') : t('gmdViewAll')}
          </button>
        )}
      </header>
      {shown.length ? (
        <ul className="divide-y divide-(--border)">
          {shown.map((a, i) => {
            const above = a.target != null && a.value > a.target;
            return (
              <li key={`${a.farm_id}-${a.metric}-${i}`} className="flex items-center gap-2.5 px-4 py-2 text-xs"
                title={`${fmt(a.value, a.unit)} ${t('gmdVsTarget')} ${fmt(a.target, a.unit)}`}>
                <CircleAlert className="h-4.5 w-4.5 shrink-0" style={{ color: STATUS_COLOR[a.status] }} />
                <span className="min-w-0 flex-1">
                  {a.metric} {above ? t('gmdAboveTarget') : t('gmdBelowTarget')} — {a.farm_name}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-(--text-secondary)">{fmt(a.value, a.unit)}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-(--text-secondary)" />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-3 text-xs text-(--text-secondary)">{t('gmdNoAlerts')}</p>
      )}
    </section>
  );
}

/** Kg Meat Sold / Sow / Year: the month's figure with its arrow, budget and variance; YTD beneath. */
export function KgMeatCard({ icon: Icon, month, ytd, t }: { icon: ElementType; month: Figure; ytd: Figure; t: T }) {
  const v = variance(month, false);
  return (
    <section className="rounded-md border border-(--border) bg-(--surface-raised) p-4" aria-label={t('gmdKgSoldPerSowYear')}>
      <div className="flex items-center gap-3">
        <Icon className="h-8 w-8 shrink-0 text-(--accent)" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{t('gmdKgSoldPerSowYear')}</h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-mono text-2xl font-bold tabular-nums" data-testid="gmd-kg-month">{fmt(month.actual)}</span>
            <TrendArrow v={v} />
            <span className="text-xs text-(--text-secondary)">{t('gmdBudget')} {fmt(month.budget)}</span>
            <span className="text-xs text-(--text-secondary)">{t('gmdVar')} <VarianceText v={v} unit="" /></span>
          </div>
          <p className="mt-1 text-xs text-(--text-secondary)">
            {t('gmdYtd')} <span className="font-mono tabular-nums text-(--text-primary)" data-testid="gmd-kg-ytd">{fmt(ytd.actual)}</span>
            {' · '}{t('gmdBudget')} {fmt(ytd.budget)}
          </p>
        </div>
      </div>
    </section>
  );
}
