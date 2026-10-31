import { byUrgency } from './feed-consolidation.service';

const line = (over: Partial<Parameters<typeof byUrgency>[0]>) => ({
  first_shortage_date: null, days_remaining: null, priority: null, proposed_delivery_date: null, req_no: 'REQ-1', ...over,
});

describe('consolidate sheet order — the farm that runs out first is at the top', () => {
  it('puts the earliest shortage first, and a line with no shortage last', () => {
    const rows = [
      line({ req_no: 'none' }),
      line({ req_no: 'late', first_shortage_date: '2026-11-05' }),
      line({ req_no: 'soon', first_shortage_date: '2026-10-30' }),
    ].sort(byUrgency);
    expect(rows.map((r) => r.req_no)).toEqual(['soon', 'late', 'none']);
  });

  it('breaks a shortage-date tie on days remaining, then priority, then delivery date', () => {
    const rows = [
      line({ req_no: 'info', first_shortage_date: '2026-10-30', days_remaining: 2, priority: 'INFO' }),
      line({ req_no: 'urgent', first_shortage_date: '2026-10-30', days_remaining: 2, priority: 'CRITICAL_FIRST_PRIORITY' }),
      line({ req_no: 'fewer-days', first_shortage_date: '2026-10-30', days_remaining: 1.5, priority: 'INFO' }),
      line({ req_no: 'info-later', first_shortage_date: '2026-10-30', days_remaining: 2, priority: 'INFO', proposed_delivery_date: '2026-11-02' }),
    ].sort(byUrgency);
    expect(rows.map((r) => r.req_no)).toEqual(['fewer-days', 'urgent', 'info-later', 'info']);
  });

  it("takes the farm's Priority No. (1 first, none last) after days remaining and before the level (Rishi, 30 Oct)", () => {
    const rows = [
      line({ req_no: 'no-number', first_shortage_date: '2026-10-30', days_remaining: 2, priority: 'CRITICAL_FIRST_PRIORITY' }),
      line({ req_no: 'second', first_shortage_date: '2026-10-30', days_remaining: 2, priority_no: 2, priority: 'CRITICAL_FIRST_PRIORITY' }),
      line({ req_no: 'first', first_shortage_date: '2026-10-30', days_remaining: 2, priority_no: 1, priority: 'INFO' }),
      line({ req_no: 'sooner', first_shortage_date: '2026-10-29', priority_no: 9 }),
    ].sort(byUrgency);
    expect(rows.map((r) => r.req_no)).toEqual(['sooner', 'first', 'second', 'no-number']);
  });
});

describe('sheetForecastDays — every delivery day is a column (Rishi, 30 Oct)', () => {
  const { sheetForecastDays } = jest.requireActual('./feed-consolidation.service') as typeof import('./feed-consolidation.service');
  it('shows 14 days, or runs on to the latest delivery, but never past the 45-day horizon', () => {
    expect(sheetForecastDays('2026-10-30', ['2026-10-26', '2026-11-07'])).toBe(14);
    expect(sheetForecastDays('2026-10-30', ['2026-11-13', null])).toBe(15);
    expect(sheetForecastDays('2026-10-30', ['2027-03-01'])).toBe(46);
    expect(sheetForecastDays('2026-10-30', [])).toBe(14);
  });
});
