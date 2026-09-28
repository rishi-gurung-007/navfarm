import { batchForKind, breedingBatchPlans } from './breeding-batch-split';

/**
 * D37 (Rishi 28 Sep: "you choose"): registered gilts stay on the gilt-grower
 * batch and registered sows go on the sow (gestation) batch, so each batch's
 * head count equals its animals. The split is pure — the chapter applies it.
 */
describe('breeding-batch-split (D37)', () => {
  it('sends gilts to the gilt batch and sows and boars to the sow batch', () => {
    expect(batchForKind('GILT')).toBe('GILT');
    expect(batchForKind('SOW')).toBe('SOW');
    expect(batchForKind('BOAR')).toBe('SOW'); // sires stand with the sow herd
  });

  it('splits the herd into a gilt plan at the gilt stage and a sow plan at the sow stage', () => {
    expect(
      breedingBatchPlans({
        giltStage: 'GILT_GROWER',
        sowStage: 'GESTATION',
        herd: [
          { kind: 'SOW', count: 12 },
          { kind: 'GILT', count: 6 },
          { kind: 'BOAR', count: 2 },
        ],
      }),
    ).toEqual([
      { token: 'GILT', stageCode: 'GILT_GROWER', animals: [{ kind: 'GILT', count: 6 }] },
      { token: 'SOW', stageCode: 'GESTATION', animals: [{ kind: 'SOW', count: 12 }, { kind: 'BOAR', count: 2 }] },
    ]);
  });

  it('each plan opens with exactly the animals it takes — a batch head count equals its animals', () => {
    const plans = breedingBatchPlans({
      giltStage: 'GILT_GROWER',
      sowStage: 'GESTATION',
      herd: [
        { kind: 'SOW', count: 12 },
        { kind: 'GILT', count: 6 },
        { kind: 'BOAR', count: 2 },
      ],
    });
    const heads = plans.map((p) => ({ token: p.token, heads: p.animals.reduce((n, a) => n + a.count, 0) }));
    expect(heads).toEqual([
      { token: 'GILT', heads: 6 },
      { token: 'SOW', heads: 14 },
    ]);
  });

  it('yields no plan for a kind the farm carries none of, and skips a stage the breed has no row for', () => {
    expect(breedingBatchPlans({ giltStage: 'GILT_GROWER', sowStage: 'GESTATION', herd: [{ kind: 'GILT', count: 6 }] })).toHaveLength(1);
    expect(breedingBatchPlans({ giltStage: null, sowStage: 'GESTATION', herd: [{ kind: 'GILT', count: 6 }, { kind: 'SOW', count: 12 }] })).toEqual([
      { token: 'SOW', stageCode: 'GESTATION', animals: [{ kind: 'SOW', count: 12 }] },
    ]);
  });
});
