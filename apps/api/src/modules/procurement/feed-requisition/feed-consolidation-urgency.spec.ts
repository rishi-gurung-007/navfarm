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
});
