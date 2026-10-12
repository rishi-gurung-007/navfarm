/**
 * The forecast window the Feed Forecast tab is showing, shared with the Feed
 * Requisition tab so "Draft from forecast" drafts for the dates the farm is
 * looking at (workbook, Feed Forecast row 8: the forecast "runs for a user
 * selected day, week, reporting period or custom From Date and To Date";
 * Engine Step 9 drafts from that run). Module state, not a prop: the tabs are
 * siblings that each own their farm selection (feed-forecast-tabs.tsx), and
 * the draft only needs the value at the moment of the click.
 */
export interface ForecastWindow {
  farmId: string;
  from: string;
  to: string;
}

let current: ForecastWindow | null = null;

export function setForecastWindow(window: ForecastWindow | null): void {
  current = window;
}

/** The shown window, only if it is for this farm — another farm's dates mean nothing here. */
export function getForecastWindow(farmId: string | null): ForecastWindow | null {
  return current && farmId && current.farmId === farmId ? current : null;
}

/** For tests. */
export function resetForecastWindow(): void {
  current = null;
}
