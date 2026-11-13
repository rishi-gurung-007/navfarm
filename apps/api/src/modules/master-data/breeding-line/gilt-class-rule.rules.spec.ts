import { giltItemIssues, pickGiltRule, type GiltItemFacts, type GiltRuleRow } from './gilt-class-rule.rules';

const item = (over: Partial<GiltItemFacts> = {}): GiltItemFacts => ({
  item_code: 'GP-LOC-F', is_active: true, is_biological_asset: true, bio_gender: 'F', bio_costing_method: 'FAIR_VALUE', ...over,
});
const rule = (over: Partial<GiltRuleRow> = {}): GiltRuleRow => ({
  rule_id: 'r1', company_id: null, dam_breed_id: 'Z', sire_breed_id: 'L', gilt_item_id: 'GP', is_active: true, ...over,
});

describe('giltItemIssues', () => {
  it('accepts an active female biological item with costing terms', () => {
    expect(giltItemIssues(item())).toEqual([]);
  });
  it('accepts an item with no gender set (the sex is the gilt\'s own)', () => {
    expect(giltItemIssues(item({ bio_gender: null }))).toEqual([]);
  });
  it('refuses a missing, switched-off, non-biological, male or unterminated item', () => {
    expect(giltItemIssues(null)).toHaveLength(1);
    expect(giltItemIssues(item({ is_active: false }))[0]).toMatch(/switched off/);
    expect(giltItemIssues(item({ is_biological_asset: false, bio_costing_method: null }))[0]).toMatch(/not a biological asset/);
    expect(giltItemIssues(item({ bio_gender: 'M' }))[0]).toMatch(/males/);
    expect(giltItemIssues(item({ bio_costing_method: null }))[0]).toMatch(/no costing method/);
  });
});

describe('pickGiltRule', () => {
  it('finds the rule for the dam line and the sire line, and no other', () => {
    expect(pickGiltRule([rule()], 'Z', 'L', 'c1')?.gilt_item_id).toBe('GP');
    expect(pickGiltRule([rule()], 'L', 'Z', 'c1')).toBeNull();
    expect(pickGiltRule([rule()], 'Z', 'Tempo', 'c1')).toBeNull();
  });
  it('reads the pair in order: Z dam with L sire is not L dam with Z sire', () => {
    const rules = [rule({ rule_id: 'a', dam_breed_id: 'Z', sire_breed_id: 'L', gilt_item_id: 'GP' }), rule({ rule_id: 'b', dam_breed_id: 'L', sire_breed_id: 'Z', gilt_item_id: 'OTHER' })];
    expect(pickGiltRule(rules, 'L', 'Z', null)?.gilt_item_id).toBe('OTHER');
  });
  it('prefers the company\'s own rule to a tenant-wide one, and ignores another company\'s and inactive rules', () => {
    const rules = [
      rule({ rule_id: 'wide', company_id: null, gilt_item_id: 'WIDE' }),
      rule({ rule_id: 'own', company_id: 'c1', gilt_item_id: 'OWN' }),
      rule({ rule_id: 'other', company_id: 'c2', gilt_item_id: 'OTHER' }),
    ];
    expect(pickGiltRule(rules, 'Z', 'L', 'c1')?.gilt_item_id).toBe('OWN');
    expect(pickGiltRule(rules, 'Z', 'L', 'c3')?.gilt_item_id).toBe('WIDE');
    expect(pickGiltRule([rule({ is_active: false })], 'Z', 'L', null)).toBeNull();
  });
  it('gives nothing when a parent is unknown (no sire recorded)', () => {
    expect(pickGiltRule([rule()], 'Z', null, null)).toBeNull();
    expect(pickGiltRule([rule()], undefined, 'L', null)).toBeNull();
  });
});
