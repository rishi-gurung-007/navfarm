import { BadRequestException } from '@nestjs/common';

export type TargetScope = 'BATCH' | 'STAGE_ANIMALS' | 'SELECTED_ANIMALS';

/**
 * Who a daily entry is about (spec §4). A Count Only batch has no animal rows, so it is
 * always the whole batch; a Registered batch is the stage's animals by default or a
 * selection of them, never "the batch", because its animals can stand in several stages.
 */
export function resolveTarget(input: {
  mode: 'COUNT_ONLY' | 'REGISTERED';
  requestedScope?: TargetScope;
  animalIds?: string[];
  stageAnimalIds: string[];
}): { scope: TargetScope; animalIds: string[] } {
  const requested = input.animalIds ?? [];
  if (input.mode === 'COUNT_ONLY') {
    if ((input.requestedScope && input.requestedScope !== 'BATCH') || requested.length) {
      throw new BadRequestException('A Count Only batch has no individual animals.');
    }
    return { scope: 'BATCH', animalIds: [] };
  }
  const scope = input.requestedScope ?? 'STAGE_ANIMALS';
  if (scope === 'BATCH' || (scope === 'STAGE_ANIMALS' && requested.length)) {
    throw new BadRequestException('Choose the whole stage or the animals in it.');
  }
  if (scope === 'STAGE_ANIMALS') return { scope, animalIds: [] };
  const unique = [...new Set(requested)].sort();
  if (!unique.length) throw new BadRequestException('Select at least one animal.');
  const inStage = new Set(input.stageAnimalIds);
  const stranger = unique.find((id) => !inStage.has(id));
  if (stranger) throw new BadRequestException(`Animal ${stranger} is not an active animal in this stage.`);
  return { scope, animalIds: unique };
}
