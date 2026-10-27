import { sumAreasInUnit, atStoredAreaScale } from './location.service';

/**
 * TDD row 138: "the total of area of pens and sub locations should not exceed the area of
 * the farm location."
 *
 * The first implementation of this rule compared each child to the parent on its own,
 * which accepts the case the requirement exists to prevent. The first test below is that
 * case; it is the reason this file exists.
 */
describe('location area totals (TDD row 138)', () => {
  const pen = (code: string, size: string | number | null, unit: string | null = 'SQM', id?: string) =>
    ({ location_id: id, location_code: code, area_size: size, area_unit: unit });

  it('adds children together — three 400s do not fit in 1000, even though each one does', () => {
    const children = [pen('PEN-001', 400), pen('PEN-002', 400)];
    const { total } = sumAreasInUnit(children, 'SQM');
    const incoming = 400;

    // Each child on its own is comfortably inside the parent...
    expect(children.every((c) => Number(c.area_size) < 1000)).toBe(true);
    // ...and together they are not, which is what the rule is about.
    expect(total + incoming).toBe(1200);
    expect(total + incoming).toBeGreaterThan(1000);
  });

  it('leaves a location out of its own sibling total', () => {
    const children = [pen('PEN-001', 400, 'SQM', 'a'), pen('PEN-002', 400, 'SQM', 'b')];
    // Re-saving PEN-002 without changing its area must not count it twice and
    // reject a row that was already valid.
    const { total, counted } = sumAreasInUnit(children, 'SQM', 'b');
    expect(total).toBe(400);
    expect(counted).toEqual(['PEN-001']);
  });

  it('does not treat a missing area as zero, and does not count it', () => {
    const { total, counted } = sumAreasInUnit([pen('PEN-001', null), pen('PEN-002', 250)], 'SQM');
    expect(total).toBe(250);
    expect(counted).toEqual(['PEN-002']);
  });

  it('refuses to add across units, and says which it left out', () => {
    const rows = [pen('PEN-001', 400, 'SQM'), pen('PEN-002', 2, 'ACRE'), pen('PEN-003', 100, 'sqm')];
    const { total, counted, skipped } = sumAreasInUnit(rows, 'SQM');
    // 2 ACRE is ~8094 SQM. Adding it as "2" would report 502 and wave through a
    // hierarchy that is eight times over capacity, so it is skipped and named.
    expect(total).toBe(500);
    expect(counted).toEqual(['PEN-001', 'PEN-003']); // case-insensitive on the unit
    expect(skipped).toEqual(['PEN-002']);
  });

  it('ignores values that are not numbers rather than poisoning the total with NaN', () => {
    const { total, counted } = sumAreasInUnit([pen('PEN-001', 'not-a-number'), pen('PEN-002', 300)], 'SQM');
    expect(total).toBe(300);
    expect(counted).toEqual(['PEN-002']);
  });

  it('counts everything when no unit is given to compare against', () => {
    const { total, skipped } = sumAreasInUnit([pen('A', 10, null), pen('B', 20, 'SQM')], null);
    expect(total).toBe(30);
    expect(skipped).toEqual([]);
  });
});

/**
 * MULTIPLIER's GROWER - H5 is a 210.68 SQM house holding six pens that add up
 * to exactly 210.68. Loading its submitted template rejected the sixth pen:
 * the five already there summed to 174.75000000000003 in JS floats, and adding
 * the last 35.93 "exceeded" the house by 4e-14.
 */
describe('area totals compare at the precision the column stores', () => {
  const pen = (code: string, size: number) => ({ location_code: code, area_size: size, area_unit: 'SQM' });

  it('accepts the sixth pen of a house its six pens fill exactly', () => {
    const existing = [pen('MUGR5P1', 31.03), pen('MUGR5P2', 35.93), pen('MUGR5P3', 35.93), pen('MUGR5P4', 35.93), pen('MUGR5P5', 35.93)];
    const { total } = sumAreasInUnit(existing, 'SQM');
    const sixth = 35.93;
    const house = 210.68;

    // The raw float sum overshoots, which is what rejected the pen.
    expect(total + sixth).toBeGreaterThan(house);
    // area_size is decimal(18,4), so the comparison belongs at four places.
    expect(atStoredAreaScale(total + sixth)).toBe(house);
    expect(atStoredAreaScale(total + sixth) > atStoredAreaScale(house)).toBe(false);
  });

  it('still rejects an area that genuinely overflows', () => {
    expect(atStoredAreaScale(64.5) > atStoredAreaScale(64.2)).toBe(true);
  });
});
