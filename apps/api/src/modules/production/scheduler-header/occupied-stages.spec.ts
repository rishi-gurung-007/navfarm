import { stagesNeedingScheduler } from './occupied-stages';

describe('stagesNeedingScheduler', () => {
  it('opens a scheduler for a stage the animals hold and the batch has none for', () => {
    expect(
      stagesNeedingScheduler(
        [
          { stage_id: 'lact-co', stage_code: 'LACTATION' },
          { stage_id: 'gest', stage_code: 'GESTATION' },
        ],
        [{ scheduler_id: 's1', stage_code: 'GESTATION', scheduler_status: 'ACTIVE' }],
      ),
    ).toEqual({ create: ['lact-co'], reopen: [] });
  });

  it('matches stages by code, so a scheduler on the twin stage row counts', () => {
    expect(
      stagesNeedingScheduler(
        [{ stage_id: 'lact-company', stage_code: 'LACTATION' }],
        [{ scheduler_id: 's1', stage_code: 'LACTATION', scheduler_status: 'DRAFT' }],
      ),
    ).toEqual({ create: [], reopen: [] });
  });

  it('reopens the completed scheduler of a stage animals have come back to', () => {
    expect(
      stagesNeedingScheduler(
        [{ stage_id: 'lact', stage_code: 'LACTATION' }],
        [{ scheduler_id: 's9', stage_code: 'LACTATION', scheduler_status: 'COMPLETED' }],
      ),
    ).toEqual({ create: [], reopen: ['s9'] });
  });

  it('asks once per stage however many animals hold it', () => {
    expect(
      stagesNeedingScheduler(
        [
          { stage_id: 'a', stage_code: 'DRY_SOW' },
          { stage_id: 'b', stage_code: 'DRY_SOW' },
        ],
        [],
      ),
    ).toEqual({ create: ['a'], reopen: [] });
  });

  it('leaves an empty batch alone', () => {
    expect(stagesNeedingScheduler([], [])).toEqual({ create: [], reopen: [] });
  });
});
