import { bufferErrors, bufferFor, giltsAsked, MIN_GILT_TEATS, resizeBuffer } from './gilt-selection-rules';

describe('gilt selection screen rules', () => {
  const litters = [{ farrow_id: 'f1', available: 6, farrowing_date: '2026-10-05' }, { farrow_id: 'f2', available: 2, farrowing_date: '2026-10-07' }];

  it('asks for whole numbers, capped at what the litter has left, and ignores blanks and zeros', () => {
    expect(giltsAsked(litters, { f1: '3', f2: '5' })).toEqual([{ farrow_id: 'f1', gilts_selected: 3 }, { farrow_id: 'f2', gilts_selected: 2 }]);
    expect(giltsAsked(litters, { f1: '', f2: '0' })).toEqual([]);
    expect(giltsAsked(litters, { f1: '2.9', f2: '-1' })).toEqual([{ farrow_id: 'f1', gilts_selected: 2 }]);
  });

  it('opens one empty row per gilt, birth date from the litter', () => {
    const rows = bufferFor(litters, [{ farrow_id: 'f1', gilts_selected: 2 }, { farrow_id: 'f2', gilts_selected: 1 }]);
    expect(rows.map((r) => [r.farrow_id, r.dob, r.rfid_tag])).toEqual([['f1', '2026-10-05', ''], ['f1', '2026-10-05', ''], ['f2', '2026-10-07', '']]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  it('flags a missing tag, a repeated tag, a missing teat count, and a count under the minimum', () => {
    const base = { farrow_id: 'f1', dob: '' };
    const errors = bufferErrors([
      { ...base, key: 'a', rfid_tag: '', no_of_teats: '16' },
      { ...base, key: 'b', rfid_tag: 'X1', no_of_teats: '' },
      { ...base, key: 'c', rfid_tag: 'x1', no_of_teats: '16' },
      { ...base, key: 'd', rfid_tag: 'X2', no_of_teats: String(MIN_GILT_TEATS - 1) },
      { ...base, key: 'e', rfid_tag: 'X3', no_of_teats: String(MIN_GILT_TEATS) },
    ]);
    expect(errors).toEqual({ a: 'RFID', b: 'TEATS', c: 'DUPLICATE', d: 'MIN_TEATS' });
  });

  it('resizes the buffer for a litter, keeping what was typed', () => {
    const three = resizeBuffer([], 3, 'f1', '2026-10-05');
    three[0].rfid_tag = 'A';
    expect(three.map((r) => [r.key, r.dob])).toEqual([['f1:0', '2026-10-05'], ['f1:1', '2026-10-05'], ['f1:2', '2026-10-05']]);
    const two = resizeBuffer(three, 2, 'f1', '2026-10-05');
    expect(two).toHaveLength(2);
    expect(two[0].rfid_tag).toBe('A');
    expect(resizeBuffer(two, 0, 'f1', '')).toEqual([]);
    expect(resizeBuffer(two, 4, 'f1', '2026-10-05')[3].key).toBe('f1:3');
  });
});
