import { accountingCalendar, fiscalYears } from './accounting-period.rules';

// Rishi's example (1 Nov): Business Central's Accounting Periods, July 2026 to July 2027.
const rows = [
  ['2026-06-28', 'July', true], ['2026-07-26', 'August', false], ['2026-08-23', 'September', false],
  ['2026-09-27', 'October', false], ['2026-10-25', 'November', false], ['2027-06-27', 'July', true],
].map(([starting_date, name, nfy], i) => ({ accounting_period_id: `p${i}`, starting_date: starting_date as string, name: name as string, new_fiscal_year: nfy as boolean }));

describe('Accounting Period calendar', () => {
  it('ends each period the day before the next one starts', () => {
    const cal = accountingCalendar(rows);
    expect(cal.map((m) => [m.name, m.startDate, m.endDate])).toEqual([
      ['July', '2026-06-28', '2026-07-25'], ['August', '2026-07-26', '2026-08-22'], ['September', '2026-08-23', '2026-09-26'],
      ['October', '2026-09-27', '2026-10-24'], ['November', '2026-10-25', '2027-06-26'], ['July', '2027-06-27', null],
    ]);
  });

  it('opens a fiscal year at each New Fiscal Year row, whatever order the rows come in', () => {
    const cal = accountingCalendar([...rows].reverse());
    expect(cal.map((m) => m.fiscalYear)).toEqual(['2026-27', '2026-27', '2026-27', '2026-27', '2026-27', '2027-28']);
  });

  it('lists the years latest first and names the one holding today', () => {
    expect(fiscalYears(accountingCalendar(rows), '2026-11-01')).toEqual({ years: ['2027-28', '2026-27'], current: '2026-27' });
  });
});
