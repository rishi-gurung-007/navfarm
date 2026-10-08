import { hasSerial, parseSerials } from './serial-utils';

describe('serial utils', () => {
  it('splits on commas and new lines and trims', () => {
    expect(parseSerials(' SN1, SN2\nSN3 ,, ')).toEqual(['SN1', 'SN2', 'SN3']);
    expect(parseSerials(null)).toEqual([]);
    expect(parseSerials('')).toEqual([]);
  });

  it('matches whole serials only, never a substring', () => {
    expect(hasSerial('SN10, SN11', 'SN1')).toBe(false);
    expect(hasSerial('SN10, SN11', 'SN10')).toBe(true);
    expect(hasSerial('SN1', ' SN1 ')).toBe(true);
    expect(hasSerial(null, 'SN1')).toBe(false);
  });
});
