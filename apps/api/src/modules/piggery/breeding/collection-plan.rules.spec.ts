import { isoWeekOf, nextCollectionDate, PlanSetup, planResult, weekdayOf } from './collection-plan.rules';

const lLine: PlanSetup = {
  collection_mode: 'SCHEDULED', collection_weekdays: ['SUN', 'WED'], boars_per_collection_day: 2,
  reference_required: false, reference_label: null, destination_rule: 'ANY', destination_farm_ids: null,
};
const zLine: PlanSetup = {
  collection_mode: 'ON_REQUEST', collection_weekdays: null, boars_per_collection_day: null,
  reference_required: true, reference_label: 'Breeding Web reference', destination_rule: 'ONE', destination_farm_ids: ['multiplier'],
};
const input = (over: object = {}) => ({ date: '2026-11-04', today: '2026-11-02', boarIds: ['a', 'b'], alreadyPlanned: 0, ...over });

describe('weekdayOf and isoWeekOf', () => {
  it('names the weekday of a calendar date', () => {
    expect(weekdayOf('2026-11-02')).toBe('MON');
    expect(weekdayOf('2026-11-04')).toBe('WED');
    expect(weekdayOf('2026-11-08')).toBe('SUN');
  });

  it('numbers the ISO week, including the weeks that straddle a new year', () => {
    expect(isoWeekOf('2026-11-02')).toEqual({ week: 45, year: 2026 });
    expect(isoWeekOf('2026-11-08')).toEqual({ week: 45, year: 2026 });
    expect(isoWeekOf('2026-01-01')).toEqual({ week: 1, year: 2026 });
    expect(isoWeekOf('2025-12-29')).toEqual({ week: 1, year: 2026 });
    expect(isoWeekOf('2027-01-03')).toEqual({ week: 53, year: 2026 });
  });
});

describe('nextCollectionDate', () => {
  it('is the first scheduled weekday on or after the date', () => {
    expect(nextCollectionDate(['SUN', 'WED'], '2026-11-02')).toBe('2026-11-04');
    expect(nextCollectionDate(['SUN', 'WED'], '2026-11-04')).toBe('2026-11-04');
    expect(nextCollectionDate(['SUN', 'WED'], '2026-11-05')).toBe('2026-11-08');
  });
  it('is nothing for a line with no weekdays', () => {
    expect(nextCollectionDate(null, '2026-11-02')).toBeNull();
    expect(nextCollectionDate([], '2026-11-02')).toBeNull();
  });
});

describe('planResult: a scheduled line (the L-Line sheet: Sunday and Wednesday, 2 boars a day)', () => {
  it('accepts two boars on a Wednesday', () => {
    expect(planResult(lLine, input(), 'L-Line')).toEqual({ errors: [], warnings: [] });
  });

  it('refuses a day the line is not tapped on, naming the days', () => {
    expect(planResult(lLine, input({ date: '2026-11-03' }), 'L-Line').errors).toEqual(['L-Line is tapped on Sunday and Wednesday; 2026-11-03 is a Tuesday.']);
  });

  it('refuses a third boar for the same day', () => {
    const r = planResult(lLine, input({ boarIds: ['c'], alreadyPlanned: 2 }), 'L-Line');
    expect(r.errors).toEqual(['L-Line taps at most 2 boars a day; 2 are already planned for 2026-11-04, so 1 more would make 3.']);
    expect(planResult(lLine, input({ boarIds: ['a', 'b', 'c'] }), 'L-Line').errors).toEqual(['L-Line taps at most 2 boars a day; 3 were chosen.']);
  });

  it('only warns when fewer boars than the line taps are planned', () => {
    const r = planResult(lLine, input({ boarIds: ['a'] }), 'L-Line');
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(['L-Line taps 2 boars a day; 1 is planned for 2026-11-04 so far.']);
  });

  it('counts the boars already planned for the day towards a limit that is then met', () => {
    expect(planResult(lLine, input({ boarIds: ['b'], alreadyPlanned: 1 }), 'L-Line')).toEqual({ errors: [], warnings: [] });
  });
});

describe('planResult: a line collected on request (the Z-Line sheet)', () => {
  const z = (over: object = {}) => input({ date: '2026-11-03', boarIds: ['a'], reference: 'BW-1', destinationFarmId: 'multiplier', ...over });

  it('accepts any day, with its reference and its destination', () => {
    expect(planResult(zLine, z(), 'Z-Line')).toEqual({ errors: [], warnings: [] });
  });

  it('refuses a plan without its reference, naming the reference the line asks for', () => {
    expect(planResult(zLine, z({ reference: '' }), 'Z-Line').errors).toEqual(['A Breeding Web reference is required for Z-Line.']);
    expect(planResult(zLine, z({ reference: '   ' }), 'Z-Line').errors).toHaveLength(1);
    expect(planResult(zLine, z({ reference: undefined }), 'Z-Line').errors).toHaveLength(1);
  });

  it('wants the destination farm, and only one the line allows', () => {
    expect(planResult(zLine, z({ destinationFarmId: null }), 'Z-Line').errors).toEqual(['Choose the destination farm for Z-Line.']);
    expect(planResult(zLine, z({ destinationFarmId: 'elsewhere' }), 'Z-Line').errors).toEqual(["Z-Line's semen may only go to its destination farm."]);
  });

  it('names "reference" when the line gave its reference no label', () => {
    expect(planResult({ ...zLine, reference_label: null }, z({ reference: '' }), 'Z-Line').errors).toEqual(['A reference is required for Z-Line.']);
  });
});

describe('planResult: what every plan must be', () => {
  it('needs boars, not the same boar twice, and a day not already past', () => {
    expect(planResult(null, input({ boarIds: [] }), 'X').errors).toEqual(['Choose at least one boar.']);
    expect(planResult(null, input({ boarIds: ['a', 'a'] }), 'X').errors).toEqual(['A boar is chosen twice.']);
    expect(planResult(null, input({ date: '2026-11-01' }), 'X').errors).toEqual(['The collection date cannot be in the past.']);
  });

  it('checks nothing else when the line has no setup and the company has no default: no rule is made up', () => {
    expect(planResult(null, input({ date: '2026-11-03', boarIds: ['a', 'b', 'c', 'd'] }), 'X')).toEqual({ errors: [], warnings: [] });
  });

  it('allows today', () => {
    expect(planResult(null, input({ date: '2026-11-02' }), 'X').errors).toEqual([]);
  });
});
