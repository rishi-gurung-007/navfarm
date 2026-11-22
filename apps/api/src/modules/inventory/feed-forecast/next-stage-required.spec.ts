import { nextStageRequiredKg } from './next-stage-diet';
import type { FeedRow } from '../../production/lifecycle/feed-row-days';

const row = (over: Partial<FeedRow>): FeedRow => ({
  lifecycleId: 'l', breedId: 'b', stageId: 's', itemId: 'i1', itemName: null,
  fromDay: 1, toDay: 14, kgPerHeadPerDay: 1, wastagePct: 0, ...over,
});

describe('nextStageRequiredKg (kg/head/day x days x heads, whole next stage)', () => {
  it('one row: 2.2 kg x 14 days x 100 head', () => {
    expect(nextStageRequiredKg([row({ kgPerHeadPerDay: 2.2 })], 'i1', 100)).toBe(3080);
  });
  it('sums the rows of the item and ignores other items', () => {
    const rows = [
      row({ fromDay: 1, toDay: 7, kgPerHeadPerDay: 1 }),
      row({ fromDay: 8, toDay: 21, kgPerHeadPerDay: 2 }),
      row({ itemId: 'other', kgPerHeadPerDay: 9 }),
    ];
    expect(nextStageRequiredKg(rows, 'i1', 10)).toBe((7 * 1 + 14 * 2) * 10);
  });
  it('a farm row replaces the default rows', () => {
    const rows = [row({ kgPerHeadPerDay: 1 }), row({ farmId: 'f1', kgPerHeadPerDay: 3 })];
    expect(nextStageRequiredKg(rows, 'i1', 10, 'f1')).toBe(14 * 3 * 10);
    expect(nextStageRequiredKg(rows, 'i1', 10, 'f2')).toBe(14 * 1 * 10);
  });
});
