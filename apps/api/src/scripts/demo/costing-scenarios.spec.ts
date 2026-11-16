import { COSTING_SCENARIOS } from './costing-scenarios';

describe('costing scenarios', () => {
  const own = (n: string) => /^(16|18|19|20|21|22)-/.test(n);

  it('each runs the masters and exactly one scenario chapter, never another scenario\'s', () => {
    for (const s of COSTING_SCENARIOS) {
      expect(s.chapters.filter(own)).toHaveLength(1);
      expect(s.chapters.slice(0, 3)).toEqual(['identity', '01-stores-and-items', '01b-costing-prices']);
    }
  });

  it('names the chapter each flag is for', () => {
    const chapterOf = Object.fromEntries(COSTING_SCENARIOS.map((s) => [s.key, s.chapters.find(own)]));
    expect(chapterOf).toEqual({
      'costing-test': '16-costing-test', 'costing-two': '18-costing-two-animals', 'costing-fv': '19-costing-fair-value',
      'costing-freq': '20-costing-frequencies', 'costing-conv': '21-costing-conversion', 'project-full': '22-project-full',
    });
  });

  it('gives item terms to the scenarios that use the catalog\'s own sow, gilt and boar, and to no other', () => {
    expect(COSTING_SCENARIOS.filter((s) => s.chapters.includes('02b-bio-costing-items')).map((s) => s.key)).toEqual(['costing-test', 'costing-two']);
  });

  it('has a checker for every scenario, with a distinct flag', () => {
    expect(new Set(COSTING_SCENARIOS.map((s) => s.flag)).size).toBe(COSTING_SCENARIOS.length);
    for (const s of COSTING_SCENARIOS) expect(s.verify).toMatch(/^verify-(costing-[a-z]+|project-full)\.ts$/);
  });
});
