import { clampToPlanning, forecastQueryString } from './feed-forecast-query';

describe('feed forecast never asks for days before the planning date', () => {
  it('clampToPlanning raises an earlier date and leaves the rest alone', () => {
    expect(clampToPlanning('2026-10-01', '2026-10-10')).toBe('2026-10-10');
    expect(clampToPlanning('2026-10-10', '2026-10-10')).toBe('2026-10-10');
    expect(clampToPlanning('2026-10-20', '2026-10-10')).toBe('2026-10-20');
    expect(clampToPlanning('', '2026-10-10')).toBe('');
    expect(clampToPlanning('2026-10-01', '')).toBe('2026-10-01');
  });

  it('the request clamps From and To to the planning date', () => {
    const q = new URLSearchParams(
      forecastQueryString({
        farmId: 'f',
        view: 'CUSTOM',
        planningDate: '2026-10-10',
        from: '2026-10-01',
        to: '2026-10-05',
        periodId: '',
      }),
    );
    expect(q.get('from')).toBe('2026-10-10');
    expect(q.get('to')).toBe('2026-10-10');
  });
});
