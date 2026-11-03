/**
 * The costing scenarios: each is the shared masters plus ONE chapter that buys and lives its own animals, so its checker can read the database back against its own
 * arithmetic. A scenario's chapter list is its masters and its chapter, nothing more: another scenario's chapter in the list would reuse the items this one gave its
 * own terms, and stop the run.
 *
 * Kept apart from `demo-chapters.ts` (which runs when it is loaded) so a spec can read it.
 */
const MASTERS = ['identity', '01-stores-and-items', '01b-costing-prices'] as const;
const WITH_ITEM_TERMS = [...MASTERS, '02b-bio-costing-items'] as const;

export interface CostingScenario {
  /** The rebuild preset and the chapters flag (`--costing-test`) */
  key: 'costing-test' | 'costing-two' | 'costing-fv' | 'costing-freq' | 'costing-conv' | 'project-full';
  flag: string;
  chapters: readonly string[];
  verify: string;
  proves: string;
}

export const COSTING_SCENARIOS: readonly CostingScenario[] = [
  {
    key: 'costing-test', flag: '--costing-test', chapters: [...WITH_ITEM_TERMS, '16-costing-test'], verify: 'verify-costing-test.ts',
    proves: 'The full life of a herd: eight animals, capitalise then expense, amortisation runs by batch, mating and litter cost, mortality, reversal',
  },
  {
    key: 'costing-two', flag: '--costing-two', chapters: [...WITH_ITEM_TERMS, '18-costing-two-animals'], verify: 'verify-costing-two.ts',
    proves: 'The smallest case, checkable by hand: a sow and a boar, feed and overhead capitalised before their start and expensed from it, six monthly runs',
  },
  {
    key: 'costing-fv', flag: '--costing-fv', chapters: [...MASTERS, '19-costing-fair-value'], verify: 'verify-costing-fv.ts',
    proves: 'Fair value: rates by date, a loss then a gain, the refusal with no rate, a reversed and re-run month',
  },
  {
    key: 'costing-freq', flag: '--costing-freq', chapters: [...MASTERS, '20-costing-frequencies'], verify: 'verify-costing-freq.ts',
    proves: 'Quarterly, monthly (actual days, auto-post) and yearly items driven by the scheduler through its own tick(), and the notices Finance is sent',
  },
  {
    key: 'costing-conv', flag: '--costing-conv', chapters: [...MASTERS, '21-costing-conversion'], verify: 'verify-costing-conv.ts',
    proves: 'A culled breeding animal becomes inventory only through a request Finance approves: gain and loss, inventory receipt, the refusals',
  },
  {
    key: 'project-full', flag: '--project-full', chapters: [...MASTERS, '02c-project-items', '22-project-full'], verify: 'verify-project-full.ts',
    proves: 'The whole project: the 12 items, a GRN of stock and 20 animals, a batch, feed and overhead, monthly runs, semen and AI, two parities for 14 sows, gilts and their fair value',
  },
];

export const scenarioByFlag = (flag: string) => COSTING_SCENARIOS.find((s) => s.flag === flag);
