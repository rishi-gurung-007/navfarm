/**
 * Reporting Period Master rules — pure (spec D20). A period runs from the day
 * after the previous period's end to its month-end Saturday (workbook Master
 * Setup row 10, Silo Balance and Stock Take row 37 "Stock Take Date — Auto =
 * Period End Date", row 49 "Sunday after month-end Saturday"); the business
 * year runs July to June (checkpoint 40). generateBusinessYear is our rule for
 * a first draft of the client's calendar (open question Q9) — every row it
 * makes can be edited. Calendar arithmetic is the forecast engine's (L12).
 */
import { addDays } from '../../inventory/feed-forecast/feed-forecast.engine';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z0-9-]{1,20}$/;

/** YYYY-MM-DD and a real day (Date.UTC would roll 2026-02-31 over to 3 March). */
export function isCalendarDay(iso: string): boolean {
  if (!ISO_DAY.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function lastSaturdayOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)); // day 0 of the next month = the last day of this one
  const lastIso = `${year}-${String(month).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`;
  return addDays(lastIso, -((last.getUTCDay() + 1) % 7)); // Saturday → 0 days back, Sunday → 1, Friday → 6
}

/** "2026-27" for any date from July 2026 to June 2027 (checkpoint 40). */
export function businessYearOf(date: string): string {
  const year = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 7 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export interface PeriodDraft {
  period_code: string;
  business_year: string;
  start_date: string;
  end_date: string;
  stock_take_date: string;
  production_start_date: string;
}

/** Our first draft of a July–June year (Q9): code YYYY-MM (the workbook's example "2026-09"), end = month-end Saturday. */
export function generateBusinessYear(startYear: number): PeriodDraft[] {
  const periods: PeriodDraft[] = [];
  let previousEnd = lastSaturdayOfMonth(startYear, 6);
  for (let i = 0; i < 12; i++) {
    const month = ((6 + i) % 12) + 1; // 7, 8, … 12, 1, … 6
    const year = month >= 7 ? startYear : startYear + 1;
    const end = lastSaturdayOfMonth(year, month);
    periods.push({
      period_code: `${year}-${String(month).padStart(2, '0')}`,
      business_year: businessYearOf(end),
      start_date: addDays(previousEnd, 1),
      end_date: end,
      stock_take_date: end,
      production_start_date: addDays(end, 1),
    });
    previousEnd = end;
  }
  return periods;
}

export function periodProblems(p: { period_code: string; start_date: string; end_date: string; stock_take_date: string }): string[] {
  const problems: string[] = [];
  if (!CODE.test(p.period_code)) problems.push('Period Code may use letters, digits and hyphens only, up to 20.');
  const days: Array<[string, string]> = [['Start Date', p.start_date], ['End Date', p.end_date], ['Stock Take Date', p.stock_take_date]];
  const bad = days.filter(([, value]) => !isCalendarDay(value));
  for (const [label] of bad) problems.push(`${label} must be a calendar date (YYYY-MM-DD).`);
  if (bad.length) return problems;
  if (p.end_date < p.start_date) problems.push('End Date must be on or after Start Date.');
  // Q10: D20 "End Date (month-end Saturday)".
  if (weekdayOf(p.end_date) !== 6) problems.push('End Date must be a Saturday (the month-end stock-take Saturday).');
  if (p.stock_take_date < p.start_date || p.stock_take_date > p.end_date) problems.push('Stock Take Date must fall within the period.');
  return problems;
}

export function periodsOverlap(a: { start_date: string; end_date: string }, b: { start_date: string; end_date: string }): boolean {
  return a.start_date <= b.end_date && b.start_date <= a.end_date;
}
