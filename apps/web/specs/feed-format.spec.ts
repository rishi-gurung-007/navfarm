import { addDaysIso, DEFAULT_WINDOW_DAYS, defaultWindowEnd } from '../src/components/console/inventory/feed-format';

describe('defaultWindowEnd', () => {
  it('is 7 days inclusive, like the API default: 23 to 29 Sep (Engine §5 row 67)', () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(7);
    expect(defaultWindowEnd('2026-09-23')).toBe('2026-09-29');
    expect(defaultWindowEnd('2026-09-23')).toBe(addDaysIso('2026-09-23', 6));
  });
});
