/**
 * Formatting/unwrap helpers shared by the feed screens (Feed Forecast Plan A/B):
 * feed-forecast-panel.tsx and feed-requisition-panel.tsx. Moved here (fix
 * round 1) so a date-formatting bug, or the response-envelope shape, can
 * only be fixed in one place rather than drifting between the two copies.
 */

// One definition of the D16 date format for every screen (Plan S, review A9).
export { formatDateShort } from "@/utils/date-short";

/** Unwraps the shared api client's `{ data }` envelope, or passes a bare payload through unchanged. */
export function unwrap<T = any>(res: any): T {
  return (res?.data ?? res) as T;
}

/** Today, in the farm-local calendar day the API also works in ("YYYY-MM-DD"). */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Calendar-day arithmetic on "YYYY-MM-DD" at UTC midnight, the same way the API does it. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
