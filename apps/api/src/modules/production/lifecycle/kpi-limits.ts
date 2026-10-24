/**
 * A breed lifecycle KPIs & Alerts row's limits. The form records an Average Value and a Tolerance (%) around it: the
 * upper limit is the average plus the tolerance, the lower the average less it — only the upper for an Upper
 * tolerance, only the lower for a Lower, both when no side is given. Older rows stored the limits directly; those are
 * used when the row has no average and tolerance. Shared by the scheduler's data-entry alerts and the reports' targets,
 * so a figure the alerts accept is the figure the reports call on target.
 */
export interface KpiLimitsInput {
  average_value?: unknown;
  tolerance_pct?: unknown;
  tolerance_type?: unknown;
  lower_limit?: unknown;
  upper_limit?: unknown;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function kpiLimits(row: KpiLimitsInput): {
  average: number | null;
  lower: number | null;
  upper: number | null;
} {
  const average = num(row.average_value);
  const tol = num(row.tolerance_pct);
  const side =
    typeof row.tolerance_type === 'string'
      ? row.tolerance_type.toUpperCase()
      : '';
  let lower = num(row.lower_limit);
  let upper = num(row.upper_limit);
  if (average !== null && tol !== null) {
    if (side !== 'LOWER') upper = round4(average * (1 + tol / 100));
    if (side !== 'UPPER') lower = round4(average * (1 - tol / 100));
  }
  return { average, lower, upper };
}
