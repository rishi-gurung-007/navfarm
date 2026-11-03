import { datesInText, formatDate, formatDateShort, formatDateTime, formatStampShort } from './date-short';

describe('the one date style, DD/MM/YY', () => {
  it('shows a stored date and a stored timestamp as written', () => {
    expect(formatDate('2026-11-03')).toBe('03/11/26');
    expect(formatDate('2026-11-03 13:17:28')).toBe('03/11/26');
    expect(formatDate('2026-11-03T13:17:28')).toBe('03/11/26');
    expect(formatDateShort('2026-11-03')).toBe('03/11/26');
  });

  it('reads a Date, or a timestamp with a zone, in the viewer\'s zone', () => {
    expect(formatDate(new Date(2026, 10, 3, 23, 30))).toBe('03/11/26');
    expect(formatDate(new Date(2026, 10, 3, 23, 30).toISOString())).toBe('03/11/26');
    expect(formatDateTime(new Date(2026, 10, 3, 13, 7))).toBe('03/11/26 13:07');
    expect(formatDateTime(new Date(2026, 10, 3, 13, 7).toISOString())).toBe('03/11/26 13:07');
  });

  it('shows a stored timestamp\'s clock as written', () => {
    expect(formatDateTime('2026-11-03 13:17:28')).toBe('03/11/26 13:17');
    expect(formatStampShort('2026-11-03 13:17:28')).toBe('03/11/26 13:17');
  });

  it('shows a dash for none or for nonsense', () => {
    for (const v of [null, undefined, '', 'not a date']) {
      expect(formatDate(v as any)).toBe('—');
      expect(formatDateTime(v as any)).toBe('—');
    }
  });

  it('rewrites the dates in a sentence the server wrote, and nothing else', () => {
    expect(datesInText('Already planned for 2026-11-04; last dose 2026-08-15.')).toBe('Already planned for 04/11/26; last dose 15/08/26.');
    expect(datesInText('PIG-2024-0015 and BATCH-000001 stay as they are')).toBe('PIG-2024-0015 and BATCH-000001 stay as they are');
  });
});
