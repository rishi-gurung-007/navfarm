import { addDays } from '../../inventory/feed-forecast/feed-forecast.engine';

/** One row of the Accounting Period Master, as the calendar needs it. */
export interface AccountingPeriodRow {
  accounting_period_id: string;
  starting_date: string;
  name: string;
  new_fiscal_year: boolean;
}

/** A period with its dates resolved: it ends the day before the next one starts. */
export interface AccountingMonth {
  accountingPeriodId: string;
  name: string;
  startDate: string;
  /** null for the last row, whose end is not known until the next period is entered. */
  endDate: string | null;
  /** e.g. "2026-27": the year that starts at the nearest New Fiscal Year row on or before this one. */
  fiscalYear: string | null;
}

/** "2026-27" for a fiscal year starting in 2026. */
export function fiscalYearLabel(startDate: string): string {
  const year = Number(startDate.slice(0, 4));
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}

/**
 * The periods in date order, each ending the day before the next starts (Business Central's rule), each
 * labelled with the fiscal year a New Fiscal Year row opened. Periods before the first such row have none.
 */
export function accountingCalendar(rows: AccountingPeriodRow[]): AccountingMonth[] {
  const ordered = [...rows].sort((a, b) => a.starting_date.localeCompare(b.starting_date));
  let fiscalYear: string | null = null;
  return ordered.map((row, i) => {
    if (row.new_fiscal_year) fiscalYear = fiscalYearLabel(row.starting_date);
    const next = ordered[i + 1];
    return {
      accountingPeriodId: row.accounting_period_id,
      name: row.name,
      startDate: row.starting_date,
      endDate: next ? addDays(next.starting_date, -1) : null,
      fiscalYear,
    };
  });
}

/** The fiscal years the calendar holds, latest first, and the one holding `today` (null when none does). */
export function fiscalYears(months: AccountingMonth[], today: string): { years: string[]; current: string | null } {
  const years = [...new Set(months.map((m) => m.fiscalYear).filter((y): y is string => !!y))].sort().reverse();
  const holding = months.find((m) => m.startDate <= today && (m.endDate === null || today <= m.endDate));
  return { years, current: holding?.fiscalYear ?? null };
}
