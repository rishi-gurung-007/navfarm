/**
 * D37 (controller's choice, Rishi 28 Sep: "you choose"): the demo's registered
 * breeding herd sits on its own batches — registered gilts on the gilt-grower
 * (gilt) batch and registered sows on the sow (gestation) batch — so each
 * batch's head count equals its animals. Before this the one REGISTERED batch
 * opened at GILT_GROWER with the whole herd's count while its animals spread
 * across six later stages, so the batch head count and the animals under it
 * disagreed and the forecast's REGISTERED split had to reconcile the two.
 *
 * Boars are sires, not part of either batch's herd: they stand on the sow
 * batch beside the sows they serve, exactly as before, but the gilt batch's
 * count never includes them.
 */

/** Which registered batch each animal kind goes to. Boars follow the sows. */
export function batchForKind(kind: 'SOW' | 'BOAR' | 'GILT'): 'GILT' | 'SOW' {
  return kind === 'GILT' ? 'GILT' : 'SOW';
}

/**
 * The two registered batches and the animals each takes: gilts on the gilt
 * batch at the farm's opening stage (GILT_GROWER when the breed carries it),
 * sows and boars on the sow batch at the sow stage (GESTATION when carried).
 * A kind with no animals yields no batch, so a farm with no boars creates no
 * batch for them.
 */
export interface BreedingBatchPlan {
  /** 'GILT' or 'SOW' — the token the batch ref is built from. */
  token: 'GILT' | 'SOW';
  stageCode: string;
  animals: Array<{ kind: 'SOW' | 'BOAR' | 'GILT'; count: number }>;
}

export function breedingBatchPlans(args: {
  /** The stages the farm's breed has active lifecycle rows for, in preference order. */
  giltStage: string | null;
  sowStage: string | null;
  herd: Array<{ kind: 'SOW' | 'BOAR' | 'GILT'; count: number }>;
}): BreedingBatchPlan[] {
  const plans: BreedingBatchPlan[] = [];
  for (const token of ['GILT', 'SOW'] as const) {
    const animals = args.herd.filter((h) => batchForKind(h.kind) === token && h.count > 0);
    if (!animals.length) continue;
    const stageCode = token === 'GILT' ? args.giltStage : args.sowStage;
    if (!stageCode) continue;
    plans.push({ token, stageCode, animals });
  }
  return plans;
}
