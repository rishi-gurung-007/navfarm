import { isCompleteTyped, isoToTyped, maskTyped, monthGrid, parseTyped, shiftMonth, withinRange } from './date-input';

describe('the date field\'s rules', () => {
  it('shows a stored date as DD/MM/YY, and keeps four digits for a year outside 2000–2099', () => {
    expect(isoToTyped('2026-11-03')).toBe('03/11/26');
    expect(isoToTyped('1998-02-09')).toBe('09/02/1998');
    expect(isoToTyped('')).toBe('');
    expect(isoToTyped(undefined)).toBe('');
    expect(isoToTyped('03/11/26')).toBe('');
  });

  it('puts the slashes in as the digits are typed', () => {
    expect(maskTyped('0')).toBe('0');
    expect(maskTyped('031')).toBe('03/1');
    expect(maskTyped('0311')).toBe('03/11');
    expect(maskTyped('03112')).toBe('03/11/2');
    expect(maskTyped('031126')).toBe('03/11/26');
    expect(maskTyped('03/11/2026')).toBe('03/11/2026');
    expect(maskTyped('03-11-26abc')).toBe('03/11/26');
    expect(maskTyped('0311262099')).toBe('03/11/2620');
  });

  it('knows a whole date from a part of one', () => {
    expect(isCompleteTyped('03/11/26')).toBe(true);
    expect(isCompleteTyped('03/11/2026')).toBe(true);
    expect(isCompleteTyped('03/11/202')).toBe(false);
    expect(isCompleteTyped('03/11')).toBe(false);
  });

  it('reads DD/MM/YY (20YY) and DD/MM/YYYY into the stored date, and refuses what is not a date', () => {
    expect(parseTyped('03/11/26')).toBe('2026-11-03');
    expect(parseTyped('3/1/26')).toBe('2026-01-03');
    expect(parseTyped('03/11/1998')).toBe('1998-11-03');
    expect(parseTyped('29/02/28')).toBe('2028-02-29');
    expect(parseTyped('')).toBe('');
    expect(parseTyped('31/02/26')).toBeNull();
    expect(parseTyped('29/02/27')).toBeNull();
    expect(parseTyped('00/11/26')).toBeNull();
    expect(parseTyped('13/13/26')).toBeNull();
    expect(parseTyped('03/11')).toBeNull();
    expect(parseTyped('nonsense')).toBeNull();
  });

  it('keeps to the field\'s min and max', () => {
    expect(withinRange('2026-11-03', undefined, '2026-11-03')).toBe(true);
    expect(withinRange('2026-11-04', undefined, '2026-11-03')).toBe(false);
    expect(withinRange('2026-10-31', '2026-11-01', undefined)).toBe(false);
    expect(withinRange('2026-11-03')).toBe(true);
  });

  it('moves a month across a year end', () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 5, 0)).toEqual({ year: 2026, month: 5 });
  });

  it('lays a month out in weeks from Monday', () => {
    const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks[1][0]).toBe('2026-11-02');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
    expect(monthGrid(2028, 1).flat().filter(Boolean)).toHaveLength(29);
  });
});
