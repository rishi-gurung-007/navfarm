/**
 * Which stages of an animal-wise batch need a scheduler opened. Each stage its live animals hold needs one open
 * scheduler, or those animals get no data entry: an animal that arrives by transfer keeps its own stage, and a
 * stage move inside the batch can take an animal to a stage the batch never had. Stages are matched by code,
 * because a stage exists as a tenant row and a company copy and animals and schedulers point at either.
 *
 * A stage whose scheduler was completed when its last animal left is reopened rather than duplicated — a batch has
 * one scheduler per stage.
 */
export interface OccupiedStage {
  stage_id: string;
  stage_code: string | null;
}

export interface StageScheduler {
  scheduler_id: string;
  stage_code: string | null;
  scheduler_status: string | null;
}

const OPEN = new Set(['ACTIVE', 'DRAFT']);

export function stagesNeedingScheduler(
  occupied: OccupiedStage[],
  schedulers: StageScheduler[],
): { create: string[]; reopen: string[] } {
  const create: string[] = [];
  const reopen: string[] = [];
  const seen = new Set<string>();
  for (const stage of occupied) {
    const code = stage.stage_code ?? stage.stage_id;
    if (seen.has(code)) continue;
    seen.add(code);
    const own = schedulers.filter((s) => (s.stage_code ?? '') === (stage.stage_code ?? '\u0000'));
    if (own.some((s) => OPEN.has(s.scheduler_status ?? ''))) continue;
    if (own.length) reopen.push(own[0].scheduler_id);
    else create.push(stage.stage_id);
  }
  return { create, reopen };
}
