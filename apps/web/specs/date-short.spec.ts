import { formatDateShort, formatStampShort } from '../src/utils/date-short';

describe('date-short (D16, review A9)', () => {
  it('formats a calendar day as DD/MM/YY and dashes what is unusable', () => {
    expect(formatDateShort('2026-09-26')).toBe('26/09/26');
    expect(formatDateShort(null)).toBe('—');
    expect(formatDateShort('soon')).toBe('—');
  });
  it('formats a UTC stamp in the viewer\'s zone, DD/MM/YY HH:mm', () => {
    const d = new Date(Date.UTC(2026, 8, 26, 13, 17, 28));
    const p = (n: number) => String(n).padStart(2, '0');
    expect(formatStampShort('2026-09-26 13:17:28', true))
      .toBe(`${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear() % 100)} ${p(d.getHours())}:${p(d.getMinutes())}`);
    expect(formatStampShort('2026-09-26 13:17:28')).toBe('26/09/26 13:17');
    expect(formatStampShort(undefined)).toBe('—');
  });
});
