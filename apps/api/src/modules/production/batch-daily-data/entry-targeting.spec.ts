import { BadRequestException } from '@nestjs/common';
import { resolveTarget } from './entry-targeting';

const stage = ['a1', 'a2', 'a3'];

describe('resolveTarget', () => {
  it('gives a Count Only batch the whole batch', () => {
    expect(resolveTarget({ mode: 'COUNT_ONLY', stageAnimalIds: [] })).toEqual({ scope: 'BATCH', animalIds: [] });
  });

  it('refuses individual animals on a Count Only batch', () => {
    expect(() => resolveTarget({ mode: 'COUNT_ONLY', requestedScope: 'SELECTED_ANIMALS', animalIds: ['a1'], stageAnimalIds: [] }))
      .toThrow(new BadRequestException('A Count Only batch has no individual animals.'));
  });

  it('defaults a Registered batch to the whole stage', () => {
    expect(resolveTarget({ mode: 'REGISTERED', stageAnimalIds: stage })).toEqual({ scope: 'STAGE_ANIMALS', animalIds: [] });
  });

  it('refuses BATCH scope on a Registered batch', () => {
    expect(() => resolveTarget({ mode: 'REGISTERED', requestedScope: 'BATCH', stageAnimalIds: stage }))
      .toThrow('Choose the whole stage or the animals in it.');
  });

  it('keeps a valid selection', () => {
    expect(resolveTarget({ mode: 'REGISTERED', requestedScope: 'SELECTED_ANIMALS', animalIds: ['a2', 'a1', 'a2'], stageAnimalIds: stage }))
      .toEqual({ scope: 'SELECTED_ANIMALS', animalIds: ['a1', 'a2'] });
  });

  it('refuses an empty selection', () => {
    expect(() => resolveTarget({ mode: 'REGISTERED', requestedScope: 'SELECTED_ANIMALS', animalIds: [], stageAnimalIds: stage }))
      .toThrow('Select at least one animal.');
  });

  it('refuses an animal outside the stage', () => {
    expect(() => resolveTarget({ mode: 'REGISTERED', requestedScope: 'SELECTED_ANIMALS', animalIds: ['zz'], stageAnimalIds: stage }))
      .toThrow('Animal zz is not an active animal in this stage.');
  });

  it('refuses an animal list with stage scope', () => {
    expect(() => resolveTarget({ mode: 'REGISTERED', requestedScope: 'STAGE_ANIMALS', animalIds: ['a1'], stageAnimalIds: stage }))
      .toThrow('Choose the whole stage or the animals in it.');
  });
});
