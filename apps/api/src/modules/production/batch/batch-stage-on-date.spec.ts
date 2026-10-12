import { stageOnDate, stagesOnDate, type StageMove } from './batch-stage-on-date';

describe('stage an animal stood in on a past day', () => {
  const B = 'batch-1';
  const move = (over: Partial<StageMove>): StageMove => ({
    animal_id: 'a-1', movement_type: 'STAGE_CHANGE', event_date: '2026-10-05', to_batch_id: B, from_stage_id: 'GEST', to_stage_id: 'FARROW', ...over,
  });

  it('uses the current stage when the animal never changed stage', () => {
    expect(stageOnDate({ animal_id: 'a-1', current_stage_id: 'GEST' }, [], B, '2026-10-01')).toBe('GEST');
  });

  it('a day before a stage change belongs to the stage it left, the change day and after to the new one', () => {
    const a = { animal_id: 'a-1', current_stage_id: 'FARROW' };
    expect(stageOnDate(a, [move({})], B, '2026-10-04')).toBe('GEST');
    expect(stageOnDate(a, [move({})], B, '2026-10-05')).toBe('FARROW');
    expect(stageOnDate(a, [move({})], B, '2026-10-09')).toBe('FARROW');
  });

  it('follows several changes in order', () => {
    const a = { animal_id: 'a-1', current_stage_id: 'LACT' };
    const moves = [move({ event_date: '2026-10-05' }), move({ event_date: '2026-10-08', from_stage_id: 'FARROW', to_stage_id: 'LACT' })];
    expect(stageOnDate(a, moves, B, '2026-10-06')).toBe('FARROW');
    expect(stageOnDate(a, moves, B, '2026-10-08')).toBe('LACT');
  });

  it('does not count an animal on days before it joined the batch', () => {
    const a = { animal_id: 'a-1', current_stage_id: 'GEST' };
    const arrived = move({ movement_type: 'TRANSFER', event_date: '2026-10-06', from_stage_id: null, to_stage_id: 'GEST' });
    expect(stageOnDate(a, [arrived], B, '2026-10-05')).toBeNull();
    expect(stageOnDate(a, [arrived], B, '2026-10-06')).toBe('GEST');
  });

  it('ignores another animal\'s moves and a move recorded against another batch', () => {
    const a = { animal_id: 'a-1', current_stage_id: 'GEST' };
    expect(stageOnDate(a, [move({ animal_id: 'a-2' }), move({ to_batch_id: 'other' })], B, '2026-10-01')).toBe('GEST');
  });

  it('collects the stages that held animals that day', () => {
    const animals = [{ animal_id: 'a-1', current_stage_id: 'FARROW' }, { animal_id: 'a-2', current_stage_id: 'FARROW' }];
    // a-1 moved on the 5th; a-2 has always been in FARROW.
    expect([...stagesOnDate(animals, [move({})], B, '2026-10-04')].sort()).toEqual(['FARROW', 'GEST']);
    expect([...stagesOnDate(animals, [move({})], B, '2026-10-05')]).toEqual(['FARROW']);
  });
});
