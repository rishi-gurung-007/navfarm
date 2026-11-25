'use client';

import { useState, type ElementType, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  ChevronRight,
  CircleAlert,
  CircleCheck,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Dialog } from '@/components/ui/dialog';
import { HoverHint } from '@/components/ui/hover-hint';
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
  /**
   * The API's Var, Var % (points for a percent metric) and colour. Absent (undefined) when the API sent no budget
   * cell, and the card works them out from actual and budget; null means the API judged there is none.
   */
  var?: number | null;
  var_pct?: number | null;
  status?: Status;
  /** Why the budget reads N/A, or is only partial, for the hover; absent when there is nothing to say. */
  budgetHint?: string;
}

export const NO_FIGURE: Figure = { actual: null, budget: null };

type T = (key: TranslationKeys, vars?: Record<string, string>) => string;

/** Where one figure's Month and YTD actuals and budgets open (25 Nov); null or absent leaves it unlinked. */
export interface FigureLinks {
  month?: string | null;
  ytd?: string | null;
  monthBudget?: string | null;
  ytdBudget?: string | null;
}

type AlertHref = (a: { metric_key: string; farm_id?: string }) => string | null;

const FOCUS_RING =
  'rounded-sm focus-visible:outline-2 focus-visible:outline-(--accent)';

/**
 * A link stretched over the figure block holding it (which is `relative isolate`): the whole block opens the records.
 * It covers the figures, so it carries the hover the covered figure had. It reaches 2px above and below, half the 4px
 * between stacked lines, so one line's area never covers its neighbour's.
 */
function StretchedLink({
  href,
  name,
  title,
  t,
}: {
  href?: string | null;
  name: string;
  title?: string;
  t: T;
}) {
  return href ? (
    <Link
      href={href}
      aria-label={t('gmdOpenRecords', { name })}
      title={title}
      className={`absolute -inset-x-1 -inset-y-0.5 rounded-md hover:bg-(--accent)/5 ${FOCUS_RING}`}
    />
  ) : null;
}

/** A measure's or chart's name, as a link when there is a page to open. */
function NameLink({
  href,
  name,
  children,
  t,
}: {
  href?: string | null;
  name: string;
  children: ReactNode;
  t: T;
}) {
  return href ? (
    <Link
      href={href}
      aria-label={t('gmdOpenRecords', { name })}
      className={`hover:text-(--accent) hover:underline ${FOCUS_RING}`}
    >
      {children}
    </Link>
  ) : (
    <>{children}</>
  );
}

/** The theme's own status colours (Rishi, 2 Nov: the GM Dashboard keeps the current theme). */
/**
 * The dashboard's three status colours (Rishi, 17 Nov), kept apart from the app's --success / --warning / --danger.
 * Amber, green and red are deepened from his yellow sample (#ecb24d) to one muted shade level, so they read as a set.
 */
export const AMBER_COLOR = '#d39a2c';
export const GREEN_COLOR = '#2f9e5f';
export const RED_COLOR = '#c8402f';

const STATUS_COLOR: Record<Exclude<Status, null>, string> = {
  GREEN: GREEN_COLOR,
  AMBER: AMBER_COLOR,
  RED: RED_COLOR,
};

export const fmt = (value: number | null | undefined, unit = '') =>
  value == null
    ? NA
    : `${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`;

/**
 * A figure for a card or a matrix cell: thousands and millions shortened (102.9K, 1.54M) so a narrow card never clips
 * it. The whole number stays in the element's title.
 */
export function fmtShort(value: number): string {
  const a = Math.abs(value);
  if (a >= 1_000_000)
    return `${(value / 1_000_000).toLocaleString('en-GB', { maximumFractionDigits: 2 })}M`;
  if (a >= 100_000)
    return `${(value / 1_000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}K`;
  if (a >= 1_000)
    return value.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  return value.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

const signed = (value: number, unit = '') =>
  `${value > 0 ? '+' : ''}${unit === '%' || unit === 'pp' ? fmt(value, unit) : `${fmtShort(value)}${unit ? ` ${unit}` : ''}`}`;

/** A percent metric to one decimal, as the cards read (32.0%); any other figure shortened by fmtShort. */
const fig = (value: number | null | undefined, unit: string) =>
  value == null
    ? NA
    : unit === '%'
      ? `${value.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
      : fmtShort(value);

/** Actual − budget and its share of the budget, and whether it is good news. */
export function variance(f: Figure, lowerIsBetter: boolean) {
  if (f.actual == null || f.budget == null) return null;
  const diff = Number((f.actual - f.budget).toFixed(2));
  const pct =
    f.budget !== 0
      ? Number(((diff / Math.abs(f.budget)) * 100).toFixed(1))
      : null;
  return {
    diff,
    pct,
    up: diff >= 0,
    good: lowerIsBetter ? diff <= 0 : diff >= 0,
    warn: false,
  };
}

/** The Var a card shows: the API's own figures and colour when it sent them, else worked out here. */
export function figureVariance(f: Figure, lowerIsBetter: boolean) {
  if (f.var === undefined) return variance(f, lowerIsBetter);
  if (f.var == null) return null;
  return {
    diff: f.var,
    pct: f.var_pct ?? null,
    up: f.var >= 0,
    good:
      f.status != null
        ? f.status === 'GREEN'
        : lowerIsBetter
          ? f.var <= 0
          : f.var >= 0,
    warn: f.status === 'AMBER',
  };
}

export function StatusDot({
  status,
  size = 'md',
  hasValue = false,
}: {
  status: Status;
  size?: 'sm' | 'md';
  /** A figure with no target to judge it by: a light solid dot, so it reads apart from "no data" (the dashed ring). */
  hasValue?: boolean;
}) {
  const dim = size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5';
  return (
    <span
      data-status={status ?? 'NONE'}
      aria-hidden
      className={`inline-block shrink-0 rounded-full ${dim}`}
      style={
        status
          ? { backgroundColor: STATUS_COLOR[status] }
          : hasValue
            ? { backgroundColor: 'var(--text-muted)', opacity: 0.35 }
            : { border: '1.5px dashed var(--text-muted)' }
      }
    />
  );
}

const toneOf = (v: NonNullable<ReturnType<typeof variance>>) =>
  v.warn ? AMBER_COLOR : v.good ? GREEN_COLOR : RED_COLOR;

function TrendArrow({ v, t }: { v: ReturnType<typeof variance>; t: T }) {
  if (!v) return null;
  const Icon = v.up ? ArrowUp : ArrowDown;
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-white"
      style={{ backgroundColor: toneOf(v) }}
      aria-label={
        v.warn
          ? t('gmdWithinToleranceOfBudget')
          : v.good
            ? t('gmdOnOrBetterThanBudget')
            : t('gmdWorseThanBudget')
      }
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  );
}

function VarianceText({
  v,
  unit,
}: {
  v: ReturnType<typeof variance>;
  unit: string;
}) {
  if (!v) return <span className="text-(--text-secondary)">{NA}</span>;
  return (
    <span className="font-semibold" style={{ color: toneOf(v) }}>
      {signed(v.diff, unit === '%' ? 'pp' : '')}
      {v.pct != null && unit !== '%' && (
        <span className="block text-[11px]">{signed(v.pct, '%')}</span>
      )}
    </span>
  );
}

/**
 * A budget figure; N/A or partial, it carries the hover that says why. With `href` it opens the budget lines, above
 * the block's stretched link; the hover then wraps the link, so focusing the link still shows it.
 */
function BudgetValue({
  figure,
  unit,
  href,
  name,
  t,
}: {
  figure: Figure;
  unit: string;
  href?: string | null;
  name: string;
  t: T;
}) {
  const text = fig(figure.budget, unit);
  const value = href ? (
    <Link
      href={href}
      aria-label={t('gmdOpenBudget', { name })}
      className={`relative z-10 cursor-pointer hover:text-(--accent) ${FOCUS_RING}`}
    >
      {text}
    </Link>
  ) : (
    text
  );
  // The hint is raised over the block's records link, or a mouse could not reach it.
  return figure.budgetHint ? (
    <HoverHint
      hint={figure.budgetHint}
      focusable={!href}
      className="relative z-10"
    >
      {value}
    </HoverHint>
  ) : (
    <>{value}</>
  );
}

/** One side of a KPI card: Month or YTD, its actual, arrow, budget and variance. */
function FigureBlock({
  label,
  figure,
  unit,
  lowerIsBetter,
  name,
  href,
  budgetHref,
  t,
}: {
  label: string;
  figure: Figure;
  unit: string;
  lowerIsBetter: boolean;
  /** What the links are called for assistive tech: the card and Month or YTD. */
  name: string;
  href?: string | null;
  budgetHref?: string | null;
  t: T;
}) {
  const v = figureVariance(figure, lowerIsBetter);
  const full = figure.actual == null ? undefined : fmt(figure.actual, unit);
  return (
    <div className="min-w-0 flex-1">
      <div className="relative isolate -mx-1 flex items-start justify-between gap-1 rounded-md px-1">
        <StretchedLink href={href} name={name} title={full} t={t} />
        <div className="min-w-0">
          <p className="text-xs text-(--text-secondary)">{label}</p>
          <p
            className="truncate font-mono text-xl font-semibold tabular-nums"
            title={full}
          >
            {fig(figure.actual, unit)}
          </p>
        </div>
        <TrendArrow v={v} t={t} />
      </div>
      <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
        <div>
          <p className="text-(--text-secondary)">{t('gmdBudget')}</p>
          <p className="font-mono tabular-nums">
            <BudgetValue
              figure={figure}
              unit={unit}
              href={budgetHref}
              name={name}
              t={t}
            />
          </p>
        </div>
        <div>
          <p className="text-(--text-secondary)">{t('gmdVar')}</p>
          <p className="font-mono tabular-nums">
            <VarianceText v={v} unit={unit} />
          </p>
        </div>
      </div>
    </div>
  );
}

/** A secondary KPI under the main one (COS $/kg CDM, Gross Margin %, Staff Overheads): Month and YTD on one line each. */
export interface SubKpi {
  label: string;
  unit: string;
  month: Figure;
  ytd: Figure;
  lowerIsBetter: boolean;
  links?: FigureLinks;
}

function SubLine({
  label,
  figure,
  unit,
  lowerIsBetter,
  name,
  href,
  budgetHref,
  t,
}: {
  label: string;
  figure: Figure;
  unit: string;
  lowerIsBetter: boolean;
  name: string;
  href?: string | null;
  budgetHref?: string | null;
  t: T;
}) {
  const v = figureVariance(figure, lowerIsBetter);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="relative isolate -mx-1 flex items-center gap-2 rounded-md px-1">
        <StretchedLink href={href} name={name} t={t} />
        <span className="w-9 text-(--text-secondary)">{label}</span>
        <span className="font-mono font-semibold tabular-nums">
          {fig(figure.actual, unit)}
        </span>
      </span>
      <span className="text-(--text-secondary)">
        {t('gmdBudget')}{' '}
        <BudgetValue
          figure={figure}
          unit={unit}
          href={budgetHref}
          name={name}
          t={t}
        />
      </span>
      <span className="ml-auto">
        <VarianceText v={v} unit={unit} />
      </span>
    </div>
  );
}

export function KpiCard({
  icon: Icon,
  title,
  unit,
  month,
  ytd,
  lowerIsBetter = false,
  sub,
  links,
  t,
}: {
  icon: ElementType;
  title: string;
  unit: string;
  month: Figure;
  ytd: Figure;
  lowerIsBetter?: boolean;
  sub?: SubKpi;
  links?: FigureLinks;
  t: T;
}) {
  const empty = month.actual == null && ytd.actual == null;
  return (
    <section
      className="flex flex-col rounded-md border border-(--border) bg-(--surface)"
      aria-label={title}
      data-kpi={title}
    >
      <header className="flex items-center gap-2 rounded-t-md border-b border-(--border) bg-(--surface-raised) px-3 py-2.5">
        <Icon className="h-5 w-5 shrink-0 text-(--accent)" />
        <h3 className="min-w-0 truncate text-xs font-bold uppercase tracking-wide">
          {title}
          {unit && unit !== '%' && (
            <span className="font-medium normal-case text-(--text-secondary)">
              {' '}
              ({unit})
            </span>
          )}
        </h3>
      </header>
      <div className="flex flex-1 flex-col gap-3 p-3">
        {empty && (
          <span className="self-start rounded-(--radius-pill) border border-(--border) px-2 py-0.5 text-[10px] text-(--text-secondary)">
            {t('gmdNoDataYet')}
          </span>
        )}
        <div className="flex gap-3">
          <FigureBlock
            label={t('gmdMonth')}
            figure={month}
            unit={unit}
            lowerIsBetter={lowerIsBetter}
            name={`${title} (${t('gmdMonth')})`}
            href={links?.month}
            budgetHref={links?.monthBudget}
            t={t}
          />
          <div className="w-px bg-(--border)" />
          <FigureBlock
            label={t('gmdYtd')}
            figure={ytd}
            unit={unit}
            lowerIsBetter={lowerIsBetter}
            name={`${title} (${t('gmdYtd')})`}
            href={links?.ytd}
            budgetHref={links?.ytdBudget}
            t={t}
          />
        </div>
        {sub && (
          <div className="mt-auto space-y-1 border-t border-dashed border-(--border) pt-2">
            <p className="text-xs font-medium">
              {sub.label}
              {sub.unit && sub.unit !== '%' ? ` (${sub.unit})` : ''}
            </p>
            <SubLine
              label={t('gmdMonth')}
              figure={sub.month}
              unit={sub.unit}
              lowerIsBetter={sub.lowerIsBetter}
              name={`${sub.label} (${t('gmdMonth')})`}
              href={sub.links?.month}
              budgetHref={sub.links?.monthBudget}
              t={t}
            />
            <SubLine
              label={t('gmdYtd')}
              figure={sub.ytd}
              unit={sub.unit}
              lowerIsBetter={sub.lowerIsBetter}
              name={`${sub.label} (${t('gmdYtd')})`}
              href={sub.links?.ytd}
              budgetHref={sub.links?.ytdBudget}
              t={t}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/** A status matrix: one row per metric, one dot per farm; the value and target show on hover. */
export function Matrix({
  icon: Icon,
  title,
  rows,
  farms,
  t,
  note,
  budgeted = false,
  reportingFarmIds,
  rowHref,
  onFarm,
}: {
  icon: ElementType;
  title: string;
  rows: MetricRow[];
  farms: Farm[];
  t: T;
  note?: ReactNode;
  /** The rows' figures are budgets (Slaughter & Financial), so the hover says Budget, not Target. */
  budgeted?: boolean;
  /** The farms with records in the period: any other column is dimmed and shows a dash, not an empty circle. */
  reportingFarmIds?: string[];
  rowHref?: (key: string) => string | null;
  /** Makes each farm heading and dot a button that selects that farm. */
  onFarm?: (farmId: string) => void;
}) {
  const silent = (farmId: string) =>
    !!reportingFarmIds && !reportingFarmIds.includes(farmId);
  const [targetKey, noTargetKey] = budgeted
    ? (['gmdBudget', 'gmdNoBudget'] as const)
    : (['gmdTarget', 'gmdNoTarget'] as const);
  return (
    <section
      className="flex min-w-0 flex-col rounded-md border border-(--border) bg-(--surface)"
      aria-label={title}
    >
      <header className="flex items-center gap-2 border-b border-(--border) px-4 py-3">
        <Icon className="h-5 w-5 shrink-0 text-(--accent)" />
        <h3 className="text-sm font-semibold">{title}</h3>
        {note && (
          <span className="ml-auto text-[10px] text-(--text-secondary)">
            {note}
          </span>
        )}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-(--surface-raised) text-(--text-secondary)">
              <th className="sticky left-0 z-10 min-w-[5.5rem] bg-(--surface-raised) px-2 py-2 text-left font-medium">
                {t('gmdMetric')}
              </th>
              {farms.map((f) => (
                <th
                  key={f.farm_id}
                  className={`w-[3.25rem] min-w-[3.25rem] px-0.5 py-2 text-center align-bottom text-[9px] font-semibold uppercase leading-[1.15] tracking-tight ${silent(f.farm_id) ? 'opacity-50' : ''}`}
                >
                  {/* The name wraps in its narrow column; the card on hover gives it whole. The card wraps the
                  button, so focusing the button shows it too. */}
                  <HoverHint
                    hint={
                      silent(f.farm_id)
                        ? `${f.farm_name} — ${t('gmdNoRecordsThisPeriod')}`
                        : f.farm_name
                    }
                    plain
                    focusable={false}
                    className="block break-words"
                  >
                    {onFarm ? (
                      <button
                        type="button"
                        onClick={() => onFarm(f.farm_id)}
                        aria-label={t('gmdShowFarm', { name: f.farm_name })}
                        className={`block w-full break-words uppercase hover:text-(--accent) ${FOCUS_RING}`}
                      >
                        {f.farm_name}
                      </button>
                    ) : (
                      f.farm_name
                    )}
                  </HoverHint>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className="group h-12 border-t border-(--border) hover:bg-(--surface-raised)"
              >
                <td className="sticky left-0 z-10 bg-(--surface) px-2 py-2 group-hover:bg-(--surface-raised)">
                  <NameLink
                    href={rowHref?.(row.key)}
                    name={row.label}
                    t={t}
                  >
                    {row.label}
                  </NameLink>
                </td>
                {farms.map((f) => {
                  const c = row.cells[f.farm_id];
                  if (silent(f.farm_id)) {
                    const quiet = `${f.farm_name} — ${t('gmdNoRecordsThisPeriod')}`;
                    return (
                      <td
                        key={f.farm_id}
                        className="px-1 py-2 text-center text-(--text-muted)"
                        title={quiet}
                        aria-label={quiet}
                      >
                        –
                      </td>
                    );
                  }
                  const tip = `${f.farm_name} — ${row.label}: ${fmt(c?.value, row.unit)} · ${
                    c?.target != null
                      ? `${t(targetKey)} ${fmt(c.target, row.unit)}`
                      : t(noTargetKey)
                  }`;
                  const dot = (
                    <>
                      <StatusDot
                        status={c?.status ?? null}
                        hasValue={c?.value != null}
                      />
                      {c?.value != null && (
                        <span className="text-[10px] leading-none tabular-nums text-(--text-secondary)">
                          {fig(c.value, row.unit)}
                        </span>
                      )}
                    </>
                  );
                  const dotLayout = 'inline-flex flex-col items-center gap-0.5';
                  return (
                    <td
                      key={f.farm_id}
                      className="px-1 py-2 text-center"
                      title={tip}
                      aria-label={tip}
                    >
                      {onFarm ? (
                        <button
                          type="button"
                          onClick={() => onFarm(f.farm_id)}
                          aria-label={t('gmdShowFarm', { name: f.farm_name })}
                          className={`${dotLayout} hover:bg-(--accent)/10 ${FOCUS_RING}`}
                        >
                          {dot}
                        </button>
                      ) : (
                        <span className={dotLayout}>{dot}</span>
                      )}
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
export function ProgressChart({
  icon: Icon,
  title,
  points,
  t,
  href,
}: {
  icon: ElementType;
  title: string;
  points: ProgressPoint[];
  t: T;
  /** The title links here; the plot keeps its tooltip. */
  href?: string | null;
}) {
  const empty = points.every((p) => p.actual == null && p.budget == null);
  return (
    <section
      className="flex min-w-0 flex-col rounded-md border border-(--border) bg-(--surface)"
      aria-label={title}
    >
      <header className="flex items-center gap-2 border-b border-(--border) px-4 py-3">
        <Icon className="h-5 w-5 shrink-0 text-(--accent)" />
        <h3 className="text-sm font-semibold">
          <NameLink href={href} name={title} t={t}>
            {title}
          </NameLink>
        </h3>
      </header>
      <div className="relative h-64 px-2 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={points}
            margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              stroke="var(--border)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={tick}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              interval={0}
            />
            <YAxis
              tick={tick}
              tickLine={false}
              axisLine={false}
              width={48}
              domain={empty ? [0, 1] : ['auto', 'auto']}
              tickFormatter={(v: number) =>
                empty ? '' : v.toLocaleString('en-GB', { notation: 'compact' })
              }
            />
            {!empty && <Tooltip contentStyle={tooltipStyle} />}
            <Bar
              dataKey="actual"
              name={t('gmdActual')}
              fill="var(--accent)"
              radius={[2, 2, 0, 0]}
            />
            <Line
              dataKey="budget"
              name={t('gmdBudget')}
              stroke="var(--text-primary)"
              strokeDasharray="6 4"
              dot={false}
              strokeWidth={2}
            />
          </ComposedChart>
        </ResponsiveContainer>
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-(--text-secondary)">
            {t('gmdNoDataYet')}
          </p>
        )}
      </div>
      <footer className="flex items-center justify-center gap-5 pb-3 text-xs text-(--text-secondary)">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-xs bg-(--accent)" />
          {t('gmdActual')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-(--text-primary)" />
          {t('gmdBudget')}
        </span>
      </footer>
    </section>
  );
}

export interface Alert {
  farm_id: string;
  farm_name: string;
  metric_key: string;
  metric: string;
  unit: string;
  value: number;
  target: number | null;
  status: 'RED' | 'AMBER';
}

const ALERTS_SHOWN = 6;

const ALERT_LAYOUT = 'flex items-center gap-2.5 px-4 py-2 text-xs';

/** One alert's list item; with a page to open, the whole row is the link. */
function AlertItem({
  href,
  name,
  title,
  children,
  t,
}: {
  href?: string | null;
  name: string;
  title: string;
  children: ReactNode;
  t: T;
}) {
  return href ? (
    <li>
      <Link
        href={href}
        aria-label={t('gmdOpenRecords', { name })}
        title={title}
        // The outline sits inside the row, where the list cannot clip it.
        className={`${ALERT_LAYOUT} hover:bg-(--surface-raised) focus-visible:-outline-offset-2! ${FOCUS_RING}`}
      >
        {children}
      </Link>
    </li>
  ) : (
    <li className={ALERT_LAYOUT} title={title}>
      {children}
    </li>
  );
}

function AlertRow({ a, t, href }: { a: Alert; t: T; href?: string | null }) {
  const above = a.target != null && a.value > a.target;
  return (
    <AlertItem
      href={href}
      name={`${a.metric} ${above ? t('gmdAboveTarget') : t('gmdBelowTarget')}, ${a.farm_name}`}
      title={`${fmt(a.value, a.unit)} ${t('gmdVsTarget')} ${fmt(a.target, a.unit)}`}
      t={t}
    >
      <CircleAlert
        className="h-4.5 w-4.5 shrink-0"
        style={{ color: STATUS_COLOR[a.status] }}
      />
      <span className="min-w-0 flex-1">
        {a.metric} {above ? t('gmdAboveTarget') : t('gmdBelowTarget')},{' '}
        {a.farm_name}
      </span>
      <span className="shrink-0 font-mono tabular-nums text-(--text-secondary)">
        {fmt(a.value, a.unit)}
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-(--text-secondary)" />
    </AlertItem>
  );
}

export function AlertsPanel({
  alerts,
  t,
  alertHref,
}: {
  alerts: Alert[];
  t: T;
  alertHref?: AlertHref;
}) {
  const [open, setOpen] = useState(false);
  const shown = alerts.slice(0, ALERTS_SHOWN);
  return (
    <section
      className="flex min-w-0 flex-1 flex-col rounded-md border border-(--border) bg-(--surface)"
      aria-label={t('gmdAlerts')}
    >
      <header className="flex items-center gap-2 border-b border-(--border) px-4 py-3">
        <Bell className="h-5 w-5 text-(--accent)" />
        <h3 className="text-sm font-semibold">{t('gmdAlerts')}</h3>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-(--danger) px-1.5 text-[11px] font-bold text-white">
          {alerts.length}
        </span>
        {alerts.length > ALERTS_SHOWN && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="nf-press ml-auto text-xs font-semibold text-(--accent)"
          >
            {t('gmdViewAll')}
          </button>
        )}
      </header>
      {shown.length ? (
        <ul className="divide-y divide-(--border)">
          {shown.map((a, i) => (
            <AlertRow
              key={`${a.farm_id}-${a.metric}-${i}`}
              a={a}
              t={t}
              href={alertHref?.(a)}
            />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-xs text-(--text-secondary)">
          {t('gmdNoAlerts')}
        </p>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('gmdAlerts')}
        presentation="compact"
        maxWidth="md"
      >
        <ul className="divide-y divide-(--border) -mx-5 sm:-mx-6">
          {alerts.map((a, i) => (
            <AlertRow
              key={`${a.farm_id}-${a.metric}-${i}`}
              a={a}
              t={t}
              href={alertHref?.(a)}
            />
          ))}
        </ul>
      </Dialog>
    </section>
  );
}

/**
 * Kg Meat Sold / Sow / Year: the main figure with its arrow, budget and variance; with `ytd`, the year to date beneath
 * (all farms shows the month first; one farm shows the year to date only, as the mockup does).
 */
export function KgMeatCard({
  icon: Icon,
  title,
  main,
  ytd,
  links,
  t,
}: {
  icon: ElementType;
  title: string;
  main: Figure;
  ytd?: Figure;
  /** `month` and `monthBudget` are the main figure's, whatever window the page gives it. */
  links?: FigureLinks;
  t: T;
}) {
  const v = figureVariance(main, false);
  const mainName = ytd ? `${title} (${t('gmdMonth')})` : title;
  const ytdName = `${title} (${t('gmdYtd')})`;
  return (
    <section
      className="rounded-md border border-(--border) bg-(--surface-raised) p-4"
      aria-label={title}
    >
      <div className="flex items-center gap-3">
        <Icon className="h-8 w-8 shrink-0 text-(--accent)" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="relative isolate -mx-1 flex items-center gap-2 rounded-md px-1">
              <StretchedLink href={links?.month} name={mainName} t={t} />
              <span
                className="font-mono text-2xl font-bold tabular-nums"
                data-testid="gmd-kg-value"
              >
                {fmt(main.actual)}
              </span>
              <TrendArrow v={v} t={t} />
            </span>
            <span className="text-xs text-(--text-secondary)">
              {t('gmdBudget')}{' '}
              <BudgetValue
                figure={main}
                unit=""
                href={links?.monthBudget}
                name={mainName}
                t={t}
              />
            </span>
            <span className="text-xs text-(--text-secondary)">
              {t('gmdVar')} <VarianceText v={v} unit="" />
            </span>
          </div>
          {ytd && (
            <p className="mt-1 text-xs text-(--text-secondary)">
              <span className="relative isolate -mx-1 rounded-md px-1">
                <StretchedLink href={links?.ytd} name={ytdName} t={t} />
                {t('gmdYtd')}{' '}
                <span
                  className="font-mono tabular-nums text-(--text-primary)"
                  data-testid="gmd-kg-ytd"
                >
                  {fmt(ytd.actual)}
                </span>
              </span>
              {' · '}
              {t('gmdBudget')}{' '}
              <BudgetValue
                figure={ytd}
                unit=""
                href={links?.ytdBudget}
                name={ytdName}
                t={t}
              />
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ── One farm (Rishi, 2 Nov: the Farm view of the mockup) ────────────────────────────────────────────────────

export const FARM_COLUMNS = [
  'this_week',
  'avg_4w',
  'this_month',
  'prev_month',
  'three_month',
] as const;
export type FarmColumn = (typeof FARM_COLUMNS)[number];

const COLUMN_LABEL: Record<FarmColumn, TranslationKeys> = {
  this_week: 'gmdThisWeek',
  avg_4w: 'gmdWeeklyAvg4w',
  this_month: 'gmdThisMonthAvg',
  prev_month: 'gmdPrevMonthAvg',
  three_month: 'gmdThreeMonthAvg',
};

export interface FarmRow {
  key: string;
  label: string;
  unit: string;
  lower_is_better: boolean;
  target: number | null;
  status: Status;
  /** The dot's colour when it is not the This Week status (a Month budget colour); defaults to `status`. */
  dotStatus?: Status;
  values: Record<FarmColumn, number | null>;
  trend: Array<number | null>;
}

/** The last six weeks as small bars, tallest for the highest week; an empty week is a stub. */
export function TrendBars({
  values,
  label,
}: {
  values: Array<number | null>;
  label: string;
}) {
  const present = values.filter((v): v is number => v != null);
  const max = Math.max(...present.map(Math.abs), 0);
  return (
    <span
      className="inline-flex h-4 items-end gap-0.5"
      role="img"
      aria-label={label}
      title={label}
      data-testid="trend"
    >
      {values.map((v, i) => (
        <span
          key={i}
          className="w-1 rounded-t-xs"
          style={{
            height:
              v == null || !max
                ? '2px'
                : `${Math.max(15, (Math.abs(v) / max) * 100)}%`,
            backgroundColor:
              v == null ? 'var(--border)' : 'var(--text-secondary)',
          }}
        />
      ))}
    </span>
  );
}

const unitSuffix = (unit: string) => (unit ? ` (${unit})` : '');

/** A one-farm matrix: each metric over This Week (coloured against its target), the averages, and a trend. */
export function FarmMatrix({
  icon: Icon,
  title,
  rows,
  t,
  note,
  budgeted = false,
  rowHref,
}: {
  icon: ElementType;
  title: string;
  rows: FarmRow[];
  t: T;
  note?: ReactNode;
  /** The rows' figures are budgets (Slaughter & Financial), so the hover says Budget, not Target. */
  budgeted?: boolean;
  rowHref?: (key: string) => string | null;
}) {
  const [targetKey, noTargetKey] = budgeted
    ? (['gmdBudget', 'gmdNoBudget'] as const)
    : (['gmdTarget', 'gmdNoTarget'] as const);
  return (
    <section
      className="flex min-w-0 flex-col rounded-md border border-(--border) bg-(--surface)"
      aria-label={title}
    >
      <header className="flex items-center gap-2 border-b border-(--border) px-4 py-3">
        <Icon className="h-5 w-5 shrink-0 text-(--accent)" />
        <h3 className="text-sm font-semibold">{title}</h3>
        {note && (
          <span className="ml-auto text-[10px] text-(--text-secondary)">
            {note}
          </span>
        )}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-(--surface-raised) text-[10px] text-(--text-secondary)">
              <th className="px-2 py-1.5 text-left font-medium">
                {t('gmdMetric')}
              </th>
              {FARM_COLUMNS.map((c) => (
                <th
                  key={c}
                  className="px-1 py-1.5 text-right font-medium leading-tight"
                >
                  {t(COLUMN_LABEL[c])}
                </th>
              ))}
              <th className="px-1.5 py-1.5 text-center font-medium">
                {t('gmdTrend')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tip =
                row.target != null
                  ? `${t(targetKey)} ${fmt(row.target, row.unit)}`
                  : t(noTargetKey);
              return (
                <tr key={row.key} className="border-t border-(--border)">
                  <td className="px-2 py-1.5 leading-tight">
                    <NameLink
                      href={rowHref?.(row.key)}
                      name={row.label}
                      t={t}
                    >
                      {row.label}
                    </NameLink>
                    {row.unit === '%' ? ' (%)' : unitSuffix(row.unit)}
                  </td>
                  {FARM_COLUMNS.map((c) => (
                    <td
                      key={c}
                      className={`px-1 py-1.5 text-right tabular-nums ${c === 'this_week' ? 'font-semibold' : ''}`}
                      style={
                        c === 'this_week' && row.status
                          ? { color: STATUS_COLOR[row.status] }
                          : undefined
                      }
                      title={c === 'this_week' ? tip : undefined}
                    >
                      {fmt(row.values[c])}
                    </td>
                  ))}
                  <td className="px-1.5 py-1.5">
                    <span
                      className="flex items-center justify-center gap-1.5"
                      title={tip}
                    >
                      <StatusDot
                        status={
                          row.dotStatus !== undefined
                            ? row.dotStatus
                            : row.status
                        }
                        size="sm"
                      />
                      <TrendBars
                        values={row.trend}
                        label={`${row.label}: ${row.trend.map((v) => fmt(v)).join(', ')}`}
                      />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export interface FarmAlert {
  metric_key: string;
  metric: string;
  unit: string;
  value: number;
  target: number | null;
  status: 'RED' | 'AMBER' | 'GREEN';
  above: boolean;
}

function FarmAlertRow({
  a,
  t,
  href,
}: {
  a: FarmAlert;
  t: T;
  href?: string | null;
}) {
  const Icon = a.status === 'GREEN' ? CircleCheck : CircleAlert;
  const text =
    a.status === 'GREEN'
      ? t('gmdOnTarget')
      : a.above
        ? t('gmdAboveTarget')
        : t('gmdBelowTarget');
  return (
    <AlertItem
      href={href}
      name={`${a.metric} ${text} (${t('gmdThisWeek')})`}
      title={`${fmt(a.value, a.unit)} ${t('gmdVsTarget')} ${fmt(a.target, a.unit)}`}
      t={t}
    >
      <Icon className="h-4.5 w-4.5 shrink-0" style={{ color: STATUS_COLOR[a.status] }} />
      <span className="min-w-0 flex-1">
        {a.metric} {text} ({t('gmdThisWeek')})
      </span>
      <span className="shrink-0 font-mono tabular-nums text-(--text-secondary)">
        {fmt(a.value, a.unit)}
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-(--text-secondary)" />
    </AlertItem>
  );
}

/** This Week's alerts for one farm: misses first, then the metrics on target. */
export function FarmAlertsPanel({
  alerts,
  t,
  alertHref,
}: {
  alerts: FarmAlert[];
  t: T;
  alertHref?: AlertHref;
}) {
  const [open, setOpen] = useState(false);
  const shown = alerts.slice(0, ALERTS_SHOWN);
  const misses = alerts.filter((a) => a.status !== 'GREEN').length;
  return (
    <section
      className="flex min-w-0 flex-1 flex-col rounded-md border border-(--border) bg-(--surface)"
      aria-label={t('gmdAlerts')}
    >
      <header className="flex items-center gap-2 border-b border-(--border) px-4 py-3">
        <Bell className="h-5 w-5 text-(--accent)" />
        <h3 className="text-sm font-semibold">{t('gmdAlerts')}</h3>
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-(--danger) px-1.5 text-[11px] font-bold text-white">
          {misses}
        </span>
        {alerts.length > ALERTS_SHOWN && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="nf-press ml-auto text-xs font-semibold text-(--accent)"
          >
            {t('gmdViewAll')}
          </button>
        )}
      </header>
      {shown.length ? (
        <ul className="divide-y divide-(--border)">
          {shown.map((a, i) => (
            <FarmAlertRow
              key={`${a.metric}-${i}`}
              a={a}
              t={t}
              href={alertHref?.(a)}
            />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-xs text-(--text-secondary)">
          {t('gmdNoAlerts')}
        </p>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('gmdAlerts')}
        presentation="compact"
        maxWidth="md"
      >
        <ul className="divide-y divide-(--border) -mx-5 sm:-mx-6">
          {alerts.map((a, i) => (
            <FarmAlertRow
              key={`${a.metric}-${i}`}
              a={a}
              t={t}
              href={alertHref?.(a)}
            />
          ))}
        </ul>
      </Dialog>
    </section>
  );
}
