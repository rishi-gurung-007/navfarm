import { formatSeriesCode, formatSeriesStem, nextSequenceInStem, normalizeSegment, assertCodeFits, CodeTooLongError, formatDateSegment, describeSeriesPattern } from './code-format.util';

const NOW = new Date('2026-09-08T12:00:00Z');
const series = (over: Partial<any> = {}): any => ({
  prefix: 'ITM', date_format: null, separator: '-', seq_length: 3,
  current_seq: 0, reset_frequency: 'NEVER', updated_at: NOW, code_segments: null, ...over,
});

describe('code-format', () => {
  /**
   * The shapes every master's series produces today. A configured series must
   * keep issuing the code it already issued — these are read off the live demo
   * tenant, where CUS-001, SUP-003, RES-004 and ITM-002 are already allocated.
   */
  describe('unconfigured series are unchanged by segments existing', () => {
    it.each([
      ['CUSTOMER', 'CUS', 3, null, 1, 'CUS-001'],
      ['SUPPLIER', 'SUP', 3, null, 4, 'SUP-004'],
      ['RESOURCE', 'RES', 3, null, 5, 'RES-005'],
      ['ITEM', 'ITM', 3, null, 3, 'ITM-003'],
      ['BREED', 'BRD', 3, null, 1, 'BRD-001'],
      ['ITEM_LOT', 'LOT', 4, null, 1, 'LOT-0001'],
    ])('%s issues %s', (_name, prefix, seqLength, _unused, seq, expected) => {
      expect(formatSeriesCode(series({ prefix, seq_length: seqLength }), seq as number, NOW)).toBe(expected);
    });

    // Was date_format: 'YYYY', which stamped the year the record was typed. It
    // is a dob:YEAR segment now, so a late-entered animal carries the year it
    // was born instead of the year someone got round to entering it.
    it('ANIMAL_PIGGERY keeps its shape, with the year taken from the animal', () => {
      const s = series({ prefix: 'PIG', seq_length: 4, prefix_position: 'START', code_segments: ['dob:YEAR'] });
      expect(formatSeriesCode(s, 27, NOW, { dob: '2019-04-02' })).toBe('PIG-2019-0027');
    });

    it('passing a record changes nothing when no segments are configured', () => {
      const s = series({ prefix: 'BRD' });
      expect(formatSeriesCode(s, 1, NOW, { breed_name: 'Large White', breed_type: 'MEAT' })).toBe('BRD-001');
    });
  });

  describe('normalizeSegment', () => {
    it.each([
      ['Large White', 'LARGE_WHITE'],
      ['Crude Protein (%)', 'CRUDE_PROTEIN'],
      ['FARM-002', 'FARM-002'],
      ['FARM-001/SHED-003', 'FARM-001/SHED-003'],
      ['RAW MATERIAL', 'RAW_MATERIAL'],
      ['Grow-out', 'GROW-OUT'],
      ['  spaced   out  ', 'SPACED_OUT'],
      ['(leading) trailing.', 'LEADING_TRAILING'],
      ['Flush and Service / AI', 'FLUSH_AND_SERVICE/AI'],
      ['', ''],
    ])('%s -> %s', (input, expected) => expect(normalizeSegment(input)).toBe(expected));

    it('treats null and undefined as absent rather than "NULL"', () => {
      expect(normalizeSegment(null)).toBe('');
      expect(normalizeSegment(undefined)).toBe('');
    });
  });

  describe('a location series with a prefix', () => {
    const loc = series({ prefix: 'LOC', separator: '/', seq_separator: '-', code_segments: ['parent_location_id', 'location_type'] });

    it('names a root location by the prefix, not its type', () => {
      expect(formatSeriesCode(loc, 2, NOW, { location_type: 'LOC' })).toBe('LOC-002');
      expect(formatSeriesCode(loc, 2, NOW, { location_type: 'FARM' })).toBe('LOC-002');
    });

    it('leaves the prefix off a child, which is named by its parent', () => {
      expect(formatSeriesCode(loc, 1, NOW, { parent_location_id: 'LOC-001', location_type: 'SHED' })).toBe('LOC-001/SHED-001');
      expect(formatSeriesCode(loc, 1, NOW, { parent_location_id: 'LOC-001/SHED-001', location_type: 'PEN' })).toBe('LOC-001/SHED-001/PEN-001');
    });

    it('describes both shapes', () => {
      expect(describeSeriesPattern(loc)).toBe('LOC-000 · {parent_location}/{location_type}-000');
    });
  });

  describe('prefix and fields combine freely', () => {
    const item = { item_type: 'FEED', category_id: 'Starter', sub_category: 'Piglet' };
    it.each([
      [[], 'END', {}, 'ITM-001'],
      [['breed_name'], 'END', { breed_name: 'Large White' }, 'LARGE_WHITE-ITM-001'],
      [['breed_name'], 'START', { breed_name: 'Large White' }, 'ITM-LARGE_WHITE-001'],
      [['item_type', 'category_id', 'sub_category'], 'END', item, 'FEED-STARTER-PIGLET-ITM-001'],
      [['item_type', 'category_id', 'sub_category'], 'START', item, 'ITM-FEED-STARTER-PIGLET-001'],
    ])('%j with prefix at %s -> %s', (segments, position, record, expected) => {
      expect(formatSeriesCode(series({ code_segments: segments, prefix_position: position }), 1, NOW, record as any)).toBe(expected);
    });

    it('omits the prefix entirely when the series has none', () => {
      expect(formatSeriesCode(series({ prefix: null, code_segments: ['location_type'] }), 1, NOW, { location_type: 'SHED' })).toBe('SHED-001');
    });

    it('still carries the prefix when every configured segment is empty, so codes are never a bare number', () => {
      expect(formatSeriesCode(series({ code_segments: ['breed_name'] }), 1, NOW, {})).toBe('ITM-001');
    });

    it('a date segment contributes the year of the record, not of today', () => {
      expect(formatSeriesCode(series({ prefix: 'PIG', code_segments: ['date_of_birth:YEAR'], prefix_position: 'START' }), 1, NOW, { date_of_birth: '2019-04-02' })).toBe('PIG-2019-001');
    });

    it('a date segment can contribute the whole date', () => {
      expect(formatSeriesCode(series({ prefix: 'PIG', code_segments: ['date_of_birth:DATE'], prefix_position: 'START' }), 1, NOW, { date_of_birth: '2019-04-02' })).toBe('PIG-20190402-001');
    });

    it('omits an empty segment rather than leaving a stray separator', () => {
      expect(formatSeriesCode(series({ code_segments: ['item_type', 'category_id'] }), 1, NOW, { item_type: 'FEED' })).toBe('FEED-ITM-001');
    });
  });

  describe('formatDateSegment', () => {
    it.each([
      ['2019-04-02', 'YEAR', '2019'],
      ['2019-04-02', 'DATE', '20190402'],
      ['2019-04-02T11:30:00Z', 'YEAR', '2019'],
      ['', 'YEAR', ''],
    ])('%s as %s -> %s', (v, part, expected) => expect(formatDateSegment(v, part)).toBe(expected));

    // mysql2 hands back a Date for a DATE column, and String(date) is
    // "Fri Apr 18 2025 00:00:00 GMT+0530 (India Standard Time)" — which used to
    // fail the ISO match and land whole in the animal code.
    it('reads a Date object, not just an ISO string', () => {
      expect(formatDateSegment(new Date('2019-04-02T00:00:00Z'), 'YEAR')).toBe('2019');
      expect(formatDateSegment(new Date('2019-04-02T00:00:00Z'), 'DATE')).toBe('20190402');
    });

    it('contributes nothing when the date is absent or unreadable', () => {
      expect(formatDateSegment(null, 'YEAR')).toBe('');
      expect(formatDateSegment(new Date('nonsense'), 'YEAR')).toBe('');
    });
  });

  describe('per-combination numbering', () => {
    // The real Location shape: "/" joins the levels of the path, "-" precedes the
    // number, so FARM-001/SHED-001/PEN-001 reads as a path ending in a count.
    const loc = series({ prefix: null, separator: '/', seq_separator: '-', code_segments: ['parent_location_id', 'location_type'] });
    const existing = ['FARM-001', 'FARM-001/SHED-001', 'FARM-001/SHED-002', 'FARM-001/SHED-003', 'FARM-001/PEN-001'];
    const next = (record: any) => {
      const stem = formatSeriesStem(loc, NOW, record);
      return formatSeriesCode(loc, nextSequenceInStem(stem, '-', existing), NOW, record);
    };

    it('continues the run under the parent that has one', () => {
      expect(next({ parent_location_id: 'FARM-001', location_type: 'SHED' })).toBe('FARM-001/SHED-004');
    });

    it("starts a new parent's children at 1, not at the tenant-wide count", () => {
      expect(next({ parent_location_id: 'FARM-002', location_type: 'SHED' })).toBe('FARM-002/SHED-001');
    });

    it('counts each type separately under the same parent', () => {
      expect(next({ parent_location_id: 'FARM-001', location_type: 'PEN' })).toBe('FARM-001/PEN-002');
    });

    it('nests, keeping the whole ancestry readable', () => {
      expect(next({ parent_location_id: 'FARM-001/SHED-001', location_type: 'PEN' })).toBe('FARM-001/SHED-001/PEN-001');
    });

    it('gives a first-level location no path to carry', () => {
      expect(next({ location_type: 'FARM' })).toBe('FARM-002');
    });

    it('takes MAX rather than a count, so a deleted sibling cannot hand its number on', () => {
      expect(nextSequenceInStem('FARM-001/SHED', '-', ['FARM-001/SHED-001', 'FARM-001/SHED-009'])).toBe(10);
    });

    it('ignores codes that do not belong to the stem', () => {
      expect(nextSequenceInStem('FARM-001/SHED', '-', ['FARM-002/SHED-007'])).toBe(1);
    });
  });

  describe('length is rejected, never trimmed', () => {
    it('accepts a code that fits', () => expect(assertCodeFits('ITM-001', 50)).toBe('ITM-001'));

    it('throws with both lengths named', () => {
      expect(() => assertCodeFits('EXTREMELYLONGFEEDITEMNAME-001', 20)).toThrow(CodeTooLongError);
      expect(() => assertCodeFits('EXTREMELYLONGFEEDITEMNAME-001', 20)).toThrow(/29 characters.*holds 20/);
    });

    it('does not throw when the column width is unknown', () => {
      expect(assertCodeFits('ANYTHING-001', undefined)).toBe('ANYTHING-001');
    });
  });
});

describe('describeSeriesPattern', () => {
  const base = { prefix: null, separator: '-', seq_length: 3, code_segments: null, prefix_position: 'END', seq_separator: null };

  it('shows a plain prefix and the sequence as zeros', () => {
    expect(describeSeriesPattern({ ...base, prefix: 'SUP' })).toBe('SUP-000');
  });

  it('shows a date segment as the date it stands for, ahead of the START prefix position', () => {
    expect(describeSeriesPattern({ ...base, prefix: 'PIG', seq_length: 4, code_segments: ['dob:YEAR'], prefix_position: 'START' })).toBe('PIG-YYYY-0000');
  });

  it('shows referenced fields in braces and honours the sequence separator', () => {
    expect(describeSeriesPattern({ ...base, separator: '/', seq_separator: '-', code_segments: ['parent_location_id', 'location_type'] })).toBe('{parent_location}/{location_type}-000');
  });
});
