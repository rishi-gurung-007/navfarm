/**
 * Feed Forecast query per view (Plan R; field specification, Report Filters)
 * and the business year a date falls in — pure, so the panel's rules can be
 * tested without rendering it. A blank field is left out and the API applies
 * its default: in particular the planning date is then today in the farm's
 * time zone (spec D16), which the browser does not know.
 */
export const FORECAST_VIEWS = ["DAILY", "WEEKLY", "PERIOD", "CUSTOM"] as const;
export type ForecastView = (typeof FORECAST_VIEWS)[number];

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

/** The July–June business year (checkpoint 40) a date falls in, named by the calendar year it starts in. */
export function businessYearStartOf(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return m >= 7 ? y : y - 1;
}
