/** Where each GM Dashboard figure opens, and the filters it carries there (read back by useDrillParams). */

export type Span = 'month' | 'ytd';

export interface DrillFarm {
  farm_id: string;
  farm_name: string;
}

export interface DrillContext {
  period: { period_code: string; start_date: string; ytd_from: string; to: string };
  custom: boolean;
  /** Whether the dashboard has sales figures for this farm (null = all farms) and span. */
  hasSales: (span: Span, farmId: string | null) => boolean;
}

type Target = [path: string, extras: Record<string, string>];

const SOLD: Target = ['/inventory/bio-asset-ledger', { salesOnly: 'true' }];
const KILL_SHEETS: Target = ['/batches/kill-sheets', { status: 'IMPORTED' }];
const FARROWING: Target = ['/reports/farrowing', {}];
const journal = (accounts: string): Target => [
  '/finance/journal',
  { status: 'POSTED', accounts },
];

/** A key with no entry (the stage 2 measures) has no link. */
const TARGETS = new Map<string, Target>([
  ['pigs_to_slaughter', SOLD],
  ['cost_of_sales', SOLD],
  ['gross_margin', SOLD],
  ['gross_margin_pct', SOLD],
  ['avg_cdm', KILL_SHEETS],
  ['cos_per_tonne', KILL_SHEETS],
  ['kg_sold_per_sow_year', KILL_SHEETS],
  ['other_overheads', journal('4600')],
  ['staff_overheads', journal('4610')],
  ['total_born_per_litter', FARROWING],
  ['born_alive_per_litter', FARROWING],
  ['pre_wean_mortality_pct', FARROWING],
  ['weaned_per_sow', FARROWING],
  ['avg_wean_weight_kg', FARROWING],
  ['litter_mass_kg', FARROWING],
]);

/** The budget metrics' labels, as the API names them (budget-metrics.ts). */
const BUDGET_LABELS = new Map<string, string>([
  ['pigs_to_slaughter', 'Pigs to Slaughter'],
  ['avg_cdm', 'Avg CDM'],
  ['cost_of_sales', 'Cost of Sales'],
  ['cos_per_tonne', 'COS per tonne'],
  ['gross_margin', 'Gross Margin'],
  ['gross_margin_pct', 'Gross Margin %'],
  ['other_overheads', 'Other Overheads'],
  ['staff_overheads', 'Staff Overheads'],
  ['kg_sold_per_sow_year', 'Kg Meat Sold / Sow / Year'],
]);

const withQuery = (path: string, params: Record<string, string>) => {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
};

const dates = ({ period }: DrillContext, span: Span) => ({
  from: span === 'ytd' ? period.ytd_from : period.start_date,
  to: period.to,
});

export function drillHref(
  key: string,
  span: Span,
  ctx: DrillContext,
  farm: DrillFarm | null,
): string | null {
  let target = TARGETS.get(key);
  if (!target) return null;
  // Without sales the ledger has nothing to show for the pigs: the kill sheets do.
  if (key === 'pigs_to_slaughter' && !ctx.hasSales(span, farm?.farm_id ?? null))
    target = KILL_SHEETS;
  const [path, extras] = target;
  return withQuery(path, {
    ...extras,
    ...(farm ? { farmId: farm.farm_id } : {}),
    ...dates(ctx, span),
  });
}

export function budgetHref(
  key: string,
  span: Span,
  ctx: DrillContext,
  farm: DrillFarm | null,
): string | null {
  const label = BUDGET_LABELS.get(key);
  if (!label || ctx.custom) return null;
  return withQuery('/master-data/budget', {
    // A YTD budget sums several periods' lines, so it is not narrowed to one.
    ...(span === 'month' ? { 'filter[period_code]': ctx.period.period_code } : {}),
    ...(farm ? { 'filter[farm_name]': farm.farm_name } : {}),
    'filter[metric_label]': label,
  });
}

/** Profit and loss has no farm filter, so it opens only from All Farms. */
export function profitLossHref(
  ctx: DrillContext,
  farm: DrillFarm | null,
): string | null {
  return farm ? null : withQuery('/finance/profit-loss', dates(ctx, 'ytd'));
}
