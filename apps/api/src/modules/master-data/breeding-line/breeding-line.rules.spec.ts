import { bandIssues, definedOnly, editedSetupValues, newSetupValues, collectionRuleResult, effectiveSetup, lineSetupIssues, LineSetupValues, overlappingBands } from './breeding-line.rules';

const base: LineSetupValues = {
  collection_mode: 'SCHEDULED',
  collection_weekdays: ['SUN', 'WED'],
  pooling_allowed: true,
  destination_rule: 'ANY',
  restrict_to_destination: 'NONE',
};

describe('lineSetupIssues', () => {
  it('accepts a plain scheduled line', () => {
    expect(lineSetupIssues(base)).toEqual([]);
  });

  it('wants weekdays for a scheduled line and none for a line collected on request', () => {
    expect(lineSetupIssues({ ...base, collection_weekdays: [] })).toEqual(['A scheduled line needs at least one collection weekday.']);
    expect(lineSetupIssues({ ...base, collection_mode: 'ON_REQUEST', collection_weekdays: null })).toEqual([]);
    expect(lineSetupIssues({ ...base, collection_mode: 'ON_REQUEST', collection_weekdays: ['SUN'] })).toHaveLength(1);
  });

  it('refuses a duplicate weekday', () => {
    expect(lineSetupIssues({ ...base, collection_weekdays: ['SUN', 'SUN'] })).toContain('A weekday is listed twice.');
  });

  it('keeps the boar limits consistent, and a line that is never pooled to one boar', () => {
    expect(lineSetupIssues({ ...base, min_boars_per_lot: 3, max_boars_per_lot: 2 })).toContain('Minimum boars per lot cannot be more than the maximum.');
    expect(lineSetupIssues({ ...base, pooling_allowed: false, max_boars_per_lot: 2 })).toContain('Pooling is off, so a lot has one boar; the maximum cannot be more than 1.');
    expect(lineSetupIssues({ ...base, pooling_allowed: false, min_boars_per_lot: 2 })).toContain('Pooling is off, so a lot has one boar; the minimum cannot be more than 1.');
    expect(lineSetupIssues({ ...base, pooling_allowed: false, max_boars_per_lot: 1 })).toEqual([]);
  });

  it('ties a colorant quantity to a stock item and an item to a name', () => {
    expect(lineSetupIssues({ ...base, colorant_qty_per_lot: 5 })).toContain('A colorant quantity is issued from stock, so it needs a colorant item.');
    expect(lineSetupIssues({ ...base, colorant_item_id: 'i1' })).toContain('Name the colorant (for example its colour) as well as its item.');
    expect(lineSetupIssues({ ...base, colorant_name: 'Green', colorant_item_id: 'i1', colorant_qty_per_lot: 5 })).toEqual([]);
    expect(lineSetupIssues({ ...base, colorant_name: 'Green' })).toEqual([]);
  });

  it('checks a label template against the known tokens', () => {
    expect(lineSetupIssues({ ...base, label_template: 'POOLL-{WEEK}' })).toEqual([]);
    expect(lineSetupIssues({ ...base, label_template: '{BOAR_TAG}-{WEEK}' })).toEqual([]);
    expect(lineSetupIssues({ ...base, label_template: 'POOLL-{WEAK}' })[0]).toContain('{WEAK}');
    expect(lineSetupIssues({ ...base, label_template: 'POOLL-{WEEK' })).toContain('The label template has an unmatched brace.');
  });

  it('matches the destination rule to the farms listed', () => {
    expect(lineSetupIssues({ ...base, destination_rule: 'LIST', destination_farm_ids: [] })).toContain('Choose the farms this line may go to.');
    expect(lineSetupIssues({ ...base, destination_rule: 'LIST', destination_farm_ids: ['f1', 'f2'] })).toEqual([]);
    expect(lineSetupIssues({ ...base, destination_rule: 'ONE', destination_farm_ids: ['f1', 'f2'] })).toContain('Choose exactly one destination farm.');
    expect(lineSetupIssues({ ...base, destination_rule: 'ANY', destination_farm_ids: ['f1'] })).toHaveLength(1);
    expect(lineSetupIssues({ ...base, destination_rule: 'LIST', destination_farm_ids: ['f1', 'f1'] })).toContain('A destination farm is listed twice.');
  });

  it('only restricts use to a destination that exists', () => {
    expect(lineSetupIssues({ ...base, restrict_to_destination: 'BLOCK' })).toContain('Restricting use to the destination needs a destination farm (a list or one).');
    expect(lineSetupIssues({ ...base, restrict_to_destination: 'BLOCK', destination_rule: 'ONE', destination_farm_ids: ['f1'] })).toEqual([]);
  });

  it('bounds the rest days and the motility percentage', () => {
    expect(lineSetupIssues({ ...base, min_rest_days: -1 })).toContain('Rest days cannot be negative.');
    expect(lineSetupIssues({ ...base, min_motility_pct: 101 })).toContain('Minimum motility is a percentage, 0 to 100.');
    expect(lineSetupIssues({ ...base, min_rest_days: 0, min_motility_pct: 0 })).toEqual([]);
  });
});

describe('lineSetupIssues: the selection table', () => {
  it('accepts weights, a tie rule and a column layout', () => {
    expect(lineSetupIssues({ ...base, grading_genetic_weight: 1, grading_dose_weight: 0, grading_morphology_weight: 1, rank_tie_break: 'GENETIC_RANK', selection_columns: [{ key: 'boar', label: 'A', visible: true }, { key: 'tsi', label: '', visible: false }] })).toEqual([]);
  });

  it('refuses a negative weight, an unknown tie rule, and a bad column layout', () => {
    expect(lineSetupIssues({ ...base, grading_dose_weight: -1 })).toContain('The dose rank weight cannot be negative.');
    expect(lineSetupIssues({ ...base, rank_tie_break: 'RANDOM' })).toHaveLength(1);
    expect(lineSetupIssues({ ...base, selection_columns: [{ key: 'colour', label: '', visible: true }] })[0]).toContain('Unknown selection table column(s): colour');
    expect(lineSetupIssues({ ...base, selection_columns: [{ key: 'boar', label: '', visible: true }, { key: 'boar', label: '', visible: true }] })).toContain('A selection table column is listed twice.');
    expect(lineSetupIssues({ ...base, selection_columns: [{ key: 'boar', label: '', visible: false }] })).toContain('The selection table needs at least one visible column.');
  });
});

describe('effectiveSetup', () => {
  const tempo = { setup_id: 't', breed_id: 'b-tempo', is_active: true };
  const def = { setup_id: 'd', breed_id: null, is_active: true };

  it('reads the line\'s own row, else the company default, else nothing', () => {
    expect(effectiveSetup([def, tempo], 'b-tempo')).toBe(tempo);
    expect(effectiveSetup([def, tempo], 'b-other')).toBe(def);
    expect(effectiveSetup([tempo], 'b-other')).toBeNull();
    expect(effectiveSetup([], 'b-tempo')).toBeNull();
    expect(effectiveSetup([def], null)).toBe(def);
  });

  it('does not read a row that is switched off', () => {
    expect(effectiveSetup([def, { ...tempo, is_active: false }], 'b-tempo')).toBe(def);
  });
});

describe('collectionRuleResult', () => {
  const rules = {
    setup_id: 's',
    breed_id: 'b',
    pooling_allowed: true,
    min_boars_per_lot: null,
    max_boars_per_lot: null,
    min_rest_days: null,
    min_motility_pct: null,
    rule_enforcement: 'WARN',
  };

  it('checks nothing when there is no rule row', () => {
    expect(collectionRuleResult({ rules: null, boarCount: 9, restDays: [{ boar: 'A', days: 0 }], motilityPct: 1 })).toEqual({ errors: [], warnings: [] });
  });

  it('stops a pooled lot on a line that is never pooled', () => {
    const r = collectionRuleResult({ rules: { ...rules, pooling_allowed: false }, boarCount: 2, restDays: [], motilityPct: null });
    expect(r.errors).toEqual(['This line is never pooled: collect one boar per lot.']);
    expect(collectionRuleResult({ rules: { ...rules, pooling_allowed: false }, boarCount: 1, restDays: [], motilityPct: null }).errors).toEqual([]);
  });

  it('stops a lot with too many or too few boars, whatever the enforcement', () => {
    const r = { ...rules, min_boars_per_lot: 2, max_boars_per_lot: 2 };
    expect(collectionRuleResult({ rules: r, boarCount: 3, restDays: [], motilityPct: null }).errors).toEqual(['This line allows at most 2 boars in a lot; 3 were chosen.']);
    expect(collectionRuleResult({ rules: r, boarCount: 1, restDays: [], motilityPct: null }).errors).toEqual(['This line needs at least 2 boars in a lot; 1 was chosen.']);
    expect(collectionRuleResult({ rules: r, boarCount: 2, restDays: [], motilityPct: null })).toEqual({ errors: [], warnings: [] });
  });

  it('warns on a rest rule or a motility floor when the line warns, and stops when it blocks', () => {
    const input = { boarCount: 1, restDays: [{ boar: 'LA0499', days: 2 }, { boar: 'LA0752', days: null }, { boar: 'LA1342', days: 4 }], motilityPct: 65 };
    const warn = collectionRuleResult({ rules: { ...rules, min_rest_days: 3, min_motility_pct: 70 }, ...input });
    expect(warn.errors).toEqual([]);
    expect(warn.warnings).toEqual(['LA0499 was collected 2 days ago; this line rests a boar 3 days or more.', "Motility 65% is under the line's minimum of 70%."]);
    const block = collectionRuleResult({ rules: { ...rules, min_rest_days: 3, min_motility_pct: 70, rule_enforcement: 'BLOCK' }, ...input });
    expect(block.warnings).toEqual([]);
    expect(block.errors).toHaveLength(2);
  });

  it('judges each boar\'s own motility against the line floor, and skips one that was not measured', () => {
    const input = { boarCount: 2, restDays: [], motilityPct: null, boarMotilities: [{ boar: 'A', pct: 62 }, { boar: 'B', pct: null }, { boar: 'C', pct: 75 }] };
    expect(collectionRuleResult({ rules: { ...rules, min_motility_pct: 70 }, ...input }).warnings).toEqual(["A's motility 62% is under the line's minimum of 70%."]);
    expect(collectionRuleResult({ rules: { ...rules, min_motility_pct: 70, rule_enforcement: 'BLOCK' }, ...input }).errors).toHaveLength(1);
  });

  it('does not judge a motility that was not measured, nor a rest rule that is not set', () => {
    expect(collectionRuleResult({ rules: { ...rules, min_motility_pct: 70 }, boarCount: 1, restDays: [{ boar: 'A', days: 0 }], motilityPct: null })).toEqual({ errors: [], warnings: [] });
  });
});

describe('genetic level bands', () => {
  it('wants a bound, and from not above to', () => {
    expect(bandIssues({ level_name: 'X', tsi_from: null, tsi_to: null })).toHaveLength(1);
    expect(bandIssues({ level_name: 'X', tsi_from: 10, tsi_to: 5 })).toEqual(['TSI from cannot be more than TSI to.']);
    expect(bandIssues({ level_name: 'X', tsi_from: 5, tsi_to: 5 })).toEqual([]);
    expect(bandIssues({ level_name: 'X', tsi_from: null, tsi_to: 95.99 })).toEqual([]);
  });

  it('finds the bands a new one overlaps, ends inclusive and open ends unbounded', () => {
    const others = [
      { level_name: 'Average', tsi_from: 105, tsi_to: null },
      { level_name: 'Below average', tsi_from: 99, tsi_to: 104.99 },
      { level_name: 'Very low', tsi_from: null, tsi_to: 95.99 },
    ];
    expect(overlappingBands({ level_name: 'N', tsi_from: 96, tsi_to: 98.99 }, others)).toEqual([]);
    expect(overlappingBands({ level_name: 'N', tsi_from: 104, tsi_to: 106 }, others).map((o) => o.level_name)).toEqual(['Average', 'Below average']);
    expect(overlappingBands({ level_name: 'N', tsi_from: 95.99, tsi_to: 96 }, others).map((o) => o.level_name)).toEqual(['Very low']);
    expect(overlappingBands({ level_name: 'N', tsi_from: null, tsi_to: 200 }, others)).toHaveLength(3);
  });
});

// A validated DTO in the bundled API carries every declared field as an own property that is `undefined` when the request omitted it.
describe('setup values as the bundled API builds them', () => {
  const omitted = { restrict_to_destination: undefined, pooling_allowed: undefined, collection_mode: undefined, min_rest_days: undefined };

  it('drops undefined values', () => {
    expect(definedOnly({ a: 1, b: undefined, c: null, d: false })).toEqual({ a: 1, c: null, d: false });
  });

  it('lets an omitted field keep its default: a setup naming destination ANY and no restriction is valid (it was refused)', () => {
    const values = newSetupValues({ ...omitted, destination_rule: 'ANY', collection_mode: 'SCHEDULED', collection_weekdays: ['SUN', 'WED'] } as any);
    expect(values).toMatchObject({ destination_rule: 'ANY', restrict_to_destination: 'NONE', pooling_allowed: true });
    expect(lineSetupIssues(values)).toEqual([]);
  });

  it('still refuses a restriction with no destination', () => {
    expect(lineSetupIssues(newSetupValues({ ...omitted, restrict_to_destination: 'BLOCK', collection_mode: 'ON_REQUEST' } as any))).toContain('Restricting use to the destination needs a destination farm (a list or one).');
  });

  it('keeps what an edit leaves out, so the whole row is validated, not a mostly-undefined one', () => {
    const before = { collection_mode: 'ON_REQUEST', pooling_allowed: false, max_boars_per_lot: 1, destination_rule: 'ANY', restrict_to_destination: 'NONE' } as any;
    const after = editedSetupValues(before, { ...omitted, min_boars_per_lot: 2 } as any);
    expect(after).toMatchObject({ pooling_allowed: false, max_boars_per_lot: 1, min_boars_per_lot: 2 });
    // pooling is off, so a minimum of 2 boars is wrong: only visible because the stored row was kept
    expect(lineSetupIssues(after)).toContain('Pooling is off, so a lot has one boar; the minimum cannot be more than 1.');
  });
});
