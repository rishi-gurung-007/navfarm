/**
 * Feed Forecast query per view (Plan R; field specification, Report Filters)
 * and the business year a date falls in — pure, so the panel's rules can be
 * tested without rendering it. A blank field is left out and the API applies
 * its default: in particular the planning date is then today in the farm's
 * time zone (spec D16), which the browser does not know.
 */
import type { TranslationKeys } from "@/utils/translations";

export const FORECAST_VIEWS = ["DAILY", "WEEKLY", "PERIOD", "CUSTOM"] as const;
export type ForecastView = (typeof FORECAST_VIEWS)[number];
/** The words for each view, shared by the View selects and the run history. */
export const FORECAST_VIEW_LABEL: Record<ForecastView, TranslationKeys> = { DAILY: "ffViewDaily", WEEKLY: "ffViewWeekly", PERIOD: "ffViewPeriod", CUSTOM: "ffViewCustom" };

export interface ForecastQueryState {
  farmId: string;
  view: ForecastView;
  planningDate: string;
  from: string;
  to: string;
  periodId: string;
}

export function forecastQueryString(s: ForecastQueryState): string {
  const p = new URLSearchParams({ farmId: s.farmId, view: s.view });
  if (s.planningDate) p.set("planningDate", s.planningDate);
  if (s.view === "PERIOD") {
    // Field spec: the period's From/To "are pulled from the Reporting Period Master, not typed manually".
    if (s.periodId) p.set("periodId", s.periodId);
  } else {
    if (s.from) p.set("from", s.from);
    if (s.view === "CUSTOM" && s.to) p.set("to", s.to);
  }
  return p.toString();
}

/**
 * Calendar-day arithmetic on "YYYY-MM-DD" at UTC midnight — mirrors
 * feed-format.ts's addDaysIso; duplicated (not imported) because this file
 * stays free of any UI import so the query and the date rule can each be
 * tested in isolation.
 */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** The month's last Saturday, mirroring reporting-period.rules.ts lastSaturdayOfMonth (api cannot be imported from web). */
function lastSaturdayOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)); // day 0 of the next month = the last day of this one
  const lastIso = `${year}-${String(month).padStart(2, "0")}-${String(last.getUTCDate()).padStart(2, "0")}`;
  return addDaysIso(lastIso, -((last.getUTCDay() + 1) % 7)); // Saturday → 0 days back, Sunday → 1, Friday → 6
}

/**
 * The July–June business year (checkpoint 40) a date falls in, named by the
 * calendar year it starts in. Final review fix 7: the generator's July
 * period does not start on 1 July — it starts the day after June's month-end
 * Saturday (reporting-period.rules.ts generateBusinessYear), which lands on
 * 28, 29 or 30 June depending on the calendar. A planning date in that
 * window must map to the NEW business year the same way the generator would
 * date its first period, or Generate Periods would draft the wrong year.
 */
export function businessYearStartOf(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  if (m > 6) return y;
  if (m < 6) return y - 1;
  // June: the pivot is the day after June's own last Saturday.
  const pivot = addDaysIso(lastSaturdayOfMonth(y, 6), 1);
  return iso >= pivot ? y : y - 1;
}
