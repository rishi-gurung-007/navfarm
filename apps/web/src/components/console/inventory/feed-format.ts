/**
 * Formatting/unwrap helpers shared by the feed screens (Feed Forecast Plan A/B):
 * feed-forecast-panel.tsx and feed-requisition-panel.tsx. Moved here (fix
 * round 1) so a date-formatting bug, or the response-envelope shape, can
 * only be fixed in one place rather than drifting between the two copies.
 */

/** Unwraps the shared api client's `{ data }` envelope, or passes a bare payload through unchanged. */
export function unwrap<T = any>(res: any): T {
  return (res?.data ?? res) as T;
}

/** Today, in the farm-local calendar day the API also works in ("YYYY-MM-DD"). */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "YYYY-MM-DD" -> "dd-MMM-yyyy"; null/undefined/unparseable -> "—". */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
}
