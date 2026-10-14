import { linesOf, siblingKey, validateFeedLines, type FeedLine } from './lifecycle-feed-lines';

const line = (from: number, to: number, over: Partial<FeedLine> = {}): FeedLine => ({
  period_from: from, period_to: to, feed_item_id: `item-${from}`, feed_qty_per_head_per_day_kg: 2.5, ...over,
});

describe('lifecycle Feed Consumption lines (Rishi, 13 Oct)', () => {
  it('accepts lines that follow one another and returns them sorted by From', () => {
    expect(validateFeedLines([line(9, 20), line(1, 8), line(21, 30)]).map((l) => [l.period_from, l.period_to]))
      .toEqual([[1, 8], [9, 20], [21, 30]]);
  });

  it('accepts a single line', () => {
    expect(validateFeedLines([line(1, 28)])).toHaveLength(1);
  });

  it('refuses no lines at all', () => {
    expect(() => validateFeedLines([])).toThrow(/at least one feed line/);
  });

  it('accepts different feeds on the same days: A 1-9 with B 1-9, and A 1-9 with B 1-15 (Rishi, 14 Oct)', () => {
    const a = (from: number, to: number) => line(from, to, { feed_item_id: 'A' });
    const b = (from: number, to: number) => line(from, to, { feed_item_id: 'B' });
    expect(validateFeedLines([a(1, 9), b(1, 9)])).toHaveLength(2);
    expect(validateFeedLines([b(1, 15), a(1, 9)]).map((l) => [l.feed_item_id, l.period_from, l.period_to]))
      .toEqual([['A', 1, 9], ['B', 1, 15]]);
    expect(validateFeedLines([a(1, 20), b(5, 12), line(21, 30, { feed_item_id: 'C' })])).toHaveLength(3);
  });

  it('refuses the same feed twice on a day, naming both lines', () => {
    expect(() => validateFeedLines([line(1, 8, { feed_item_id: 'A' }), line(8, 20, { feed_item_id: 'A' })]))
      .toThrow(/1-8 and 8-20 give the same feed on the same days/);
  });

  it('lets the same feed carry on in a later line that does not share a day', () => {
    expect(validateFeedLines([line(1, 8, { feed_item_id: 'A' }), line(9, 20, { feed_item_id: 'A' })])).toHaveLength(2);
  });

  it('refuses a gap, naming the days without feed', () => {
    expect(() => validateFeedLines([line(1, 8), line(12, 20)])).toThrow(/days 9-11 have no feed/);
  });

  it('sees no gap where a longer line covers the days another leaves (A 1-20, B 1-8, C 15-30)', () => {
    const f = (item: string, from: number, to: number) => line(from, to, { feed_item_id: item });
    expect(validateFeedLines([f('A', 1, 20), f('B', 1, 8), f('C', 15, 30)])).toHaveLength(3);
    expect(() => validateFeedLines([f('A', 1, 20), f('B', 1, 8), f('C', 25, 30)])).toThrow(/days 21-24 have no feed/);
  });

  it('refuses From after To', () => {
    expect(() => validateFeedLines([line(10, 5)])).toThrow(/From \(10\) cannot be after To \(5\)/);
  });

  it('refuses a line without a feed or a daily quantity, or with wastage out of 0-100', () => {
    expect(() => validateFeedLines([line(1, 8, { feed_item_id: '' })])).toThrow(/choose the feed/);
    expect(() => validateFeedLines([line(1, 8, { feed_qty_per_head_per_day_kg: 0 })])).toThrow(/daily feed per head/);
    expect(() => validateFeedLines([line(1, 8, { feed_wastage_pct: 120 })])).toThrow(/wastage/);
  });

  it('reads string numbers from the form as numbers', () => {
    const [l] = validateFeedLines([{ period_from: '1' as any, period_to: '8' as any, feed_item_id: 'x', feed_qty_per_head_per_day_kg: '2.25' as any, feed_wastage_pct: '' as any }]);
    expect(l).toMatchObject({ period_from: 1, period_to: 8, feed_qty_per_head_per_day_kg: 2.25, feed_wastage_pct: null });
  });

  it('turns a stage\'s rows into its lines, sorted, skipping a row without feed', () => {
    const rows = [
      { lifecycle_id: 'b', period_from: 9, period_to: 20, feed_item_id: 'f2', feed_form: 'BULK', feed_qty_per_head_per_day_kg: '3.0000', feed_wastage_pct: null },
      { period_from: 1, period_to: 8, feed_item_id: 'f1', feed_form: null, feed_qty_per_head_per_day_kg: '2.5000', feed_wastage_pct: '1.50' },
      { lifecycle_id: 'c', period_from: 21, period_to: 25, feed_item_id: null },
    ];
    expect(linesOf(rows)).toEqual([
      { period_from: 1, period_to: 8, feed_item_id: 'f1', feed_form: null, feed_qty_per_head_per_day_kg: 2.5, feed_qty_uom: 'KG', feed_wastage_pct: 1.5 },
      { period_from: 9, period_to: 20, feed_item_id: 'f2', feed_form: 'BULK', feed_qty_per_head_per_day_kg: 3, feed_qty_uom: 'KG', feed_wastage_pct: null },
    ]);
  });

  it('a line reads back its amount and UOM as entered (0195), not the kg equivalent', () => {
    const [l] = linesOf([{ period_from: 1, period_to: 8, feed_item_id: 'f1', feed_qty_per_head_per_day_kg: '0.8000', feed_qty_per_head_per_day: '800.0000', feed_qty_uom: 'GRAM' }]);
    expect(l).toMatchObject({ feed_qty_per_head_per_day_kg: 800, feed_qty_uom: 'GRAM' });
  });

  it('a blank UOM is KG', () => {
    expect(validateFeedLines([line(1, 8)])[0].feed_qty_uom).toBe('KG');
    expect(validateFeedLines([line(1, 8, { feed_qty_uom: 'gram' })])[0].feed_qty_uom).toBe('GRAM');
  });

  it('treats rows as one stage only when breed, stage, farm, season and category all match', () => {
    const base = { breed_id: 'b', stage_id: 's', farm_id: null, season_type: 'ALL', category: 'SOW' };
    expect(siblingKey(base)).toBe(siblingKey({ ...base, period_from: 9 }));
    expect(siblingKey(base)).not.toBe(siblingKey({ ...base, farm_id: 'farm-1' }));
    expect(siblingKey(base)).not.toBe(siblingKey({ ...base, season_type: 'SUMMER' }));
  });
});
