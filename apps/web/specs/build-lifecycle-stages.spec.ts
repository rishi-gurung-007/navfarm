import { buildLifecycleStages } from '../src/components/console/piggery/build-lifecycle-stages';

const STAGE_MASTER = [
  { stage_id: 'q', stage_code: 'QUARANTINE', stage_name: 'Quarantine', stage_sequence: 1, stage_category: 'PRE_PRODUCTIVE', typical_duration_days: 30 },
  { stage_id: 'f', stage_code: 'FLUSH_SERVICE', stage_name: 'Flush and Service / AI', stage_sequence: 3, stage_category: 'PRE_PRODUCTIVE', typical_duration_days: 10 },
  { stage_id: 'g', stage_code: 'DRY_SOW_GESTATION', stage_name: 'Dry Sow / Gestation', stage_sequence: 4, stage_category: 'PRODUCTIVE', typical_duration_days: 114 },
  { stage_id: 'fa', stage_code: 'FARROWING', stage_name: 'Farrowing', stage_sequence: 5, stage_category: 'OUTPUT', typical_duration_days: 3 },
];

describe('buildLifecycleStages', () => {
  it('marks the stages the batch actually passed through as completed', () => {
    const { stages } = buildLifecycleStages({
      stageMaster: STAGE_MASTER,
      stageLog: [{ from_stage_code: 'FLUSH_SERVICE', to_stage_code: 'DRY_SOW_GESTATION', transferred_at: '2026-07-11 08:00:00' }],
      batchStartDate: '2026-07-01',
      currentStageCode: 'DRY_SOW_GESTATION',
    });
    const byCode = Object.fromEntries(stages.map((s) => [s.code, s.status]));

    expect(byCode.FLUSH_SERVICE).toBe('COMPLETED');
    expect(byCode.DRY_SOW_GESTATION).toBe('CURRENT');
    expect(byCode.FARROWING).toBe('UPCOMING');
  });

  it('does not claim a stage was completed when the batch never entered it', () => {
    // The old hardcoded stepper showed Quarantine and Gilt Grower as Done for
    // every batch. This batch started at FLUSH_SERVICE and never saw quarantine.
    const { stages } = buildLifecycleStages({
      stageMaster: STAGE_MASTER,
      stageLog: [{ from_stage_code: 'FLUSH_SERVICE', to_stage_code: 'DRY_SOW_GESTATION', transferred_at: '2026-07-11 08:00:00' }],
      batchStartDate: '2026-07-01',
      currentStageCode: 'DRY_SOW_GESTATION',
    });
    const quarantine = stages.find((s) => s.code === 'QUARANTINE');

    expect(quarantine?.status).toBe('UPCOMING');
  });

  it('reports real day ranges measured from the batch start date', () => {
    const { stages } = buildLifecycleStages({
      stageMaster: STAGE_MASTER,
      stageLog: [{ from_stage_code: 'FLUSH_SERVICE', to_stage_code: 'DRY_SOW_GESTATION', transferred_at: '2026-07-11 08:00:00' }],
      batchStartDate: '2026-07-01',
      currentStageCode: 'DRY_SOW_GESTATION',
    });

    // Day 1 is the start date; the move happened on 2026-07-11, which is day 11.
    expect(stages.find((s) => s.code === 'FLUSH_SERVICE')?.daysRange).toBe('Day 1 – 10');
    expect(stages.find((s) => s.code === 'DRY_SOW_GESTATION')?.daysRange).toContain('Day 11');
    expect(stages.find((s) => s.code === 'FLUSH_SERVICE')?.dateRange).toContain('01/07/26');
  });

  it('returns the id of the current stage so the stepper can position itself', () => {
    const { stages, currentStageId } = buildLifecycleStages({
      stageMaster: STAGE_MASTER,
      stageLog: [],
      batchStartDate: '2026-07-01',
      currentStageCode: 'FLUSH_SERVICE',
    });
    const current = stages.find((s) => s.id === currentStageId);

    expect(current?.code).toBe('FLUSH_SERVICE');
    expect(current?.status).toBe('CURRENT');
  });

  it('falls back to an empty list rather than inventing stages', () => {
    const { stages } = buildLifecycleStages({
      stageMaster: [],
      stageLog: [],
      batchStartDate: '2026-07-01',
      currentStageCode: null,
    });

    expect(stages).toEqual([]);
  });
});

import { stageWindows } from '../src/components/console/piggery/build-lifecycle-stages';

describe('stageWindows', () => {
  it('returns one window per stage the batch occupied', () => {
    const windows = stageWindows({
      stageLog: [{ from_stage_code: 'FLUSH_SERVICE', to_stage_code: 'DRY_SOW_GESTATION', transferred_at: '2026-07-11 08:00:00' }],
      batchStartDate: '2026-07-01',
      currentStageCode: 'DRY_SOW_GESTATION',
      today: '2026-09-01',
    });

    expect(windows).toEqual([
      { code: 'FLUSH_SERVICE', from: '2026-07-01', to: '2026-07-10' },
      { code: 'DRY_SOW_GESTATION', from: '2026-07-11', to: '2026-09-01' },
    ]);
  });

  it('returns a single window for a batch that never moved', () => {
    const windows = stageWindows({
      stageLog: [],
      batchStartDate: '2026-07-15',
      currentStageCode: 'CB_GROWER',
      today: '2026-09-01',
    });

    expect(windows).toHaveLength(1);
    expect(windows[0].code).toBe('CB_GROWER');
  });
});

describe('buildLifecycleStages — full lifecycle', () => {
  const FULL = [
    { stage_id: 'q',  stage_code: 'QUARANTINE',        stage_name: 'Quarantine',        stage_sequence: 1,  next_stage_id: 'gg' },
    { stage_id: 'gg', stage_code: 'GILT_GROWER',       stage_name: 'Gilt Grower Phase', stage_sequence: 2,  next_stage_id: 'f' },
    { stage_id: 'f',  stage_code: 'FLUSH_SERVICE',     stage_name: 'Flush and Service', stage_sequence: 3,  next_stage_id: 'g' },
    { stage_id: 'g',  stage_code: 'DRY_SOW_GESTATION', stage_name: 'Dry Sow',           stage_sequence: 4,  next_stage_id: 'fa' },
    { stage_id: 'fa', stage_code: 'FARROWING',         stage_name: 'Farrowing',         stage_sequence: 5,  next_stage_id: 'l' },
    { stage_id: 'l',  stage_code: 'LACTATION',         stage_name: 'Lactation',         stage_sequence: 6,  next_stage_id: 'w' },
    { stage_id: 'w',  stage_code: 'WEANING',           stage_name: 'Weaning',           stage_sequence: 7,  next_stage_id: 'f' },
    { stage_id: 'b',  stage_code: 'BOAR_AI',           stage_name: 'Boar AI Station',   stage_sequence: 8,  next_stage_id: 'b' },
    { stage_id: 'cb', stage_code: 'CB_GROWER',         stage_name: 'CB Grower Phase',   stage_sequence: 9,  next_stage_id: 'sl' },
    { stage_id: 'sl', stage_code: 'SLAUGHTER',         stage_name: 'Slaughter',         stage_sequence: 10, next_stage_id: 'd' },
    { stage_id: 'd',  stage_code: 'DISPOSED',          stage_name: 'Disposed',          stage_sequence: 11 },
  ];

  it('shows the whole configured lifecycle, in sequence order', () => {
    const { stages } = buildLifecycleStages({
      stageMaster: FULL,
      stageLog: [{ from_stage_code: 'FLUSH_SERVICE', to_stage_code: 'DRY_SOW_GESTATION', transferred_at: '2026-07-11 08:00:00' }],
      batchStartDate: '2026-07-01',
      currentStageCode: 'DRY_SOW_GESTATION',
    });

    expect(stages).toHaveLength(FULL.length);
    expect(stages.map((s) => s.code)).toEqual(FULL.map((s) => s.stage_code));
  });

  it('leaves stages the batch has not reached as upcoming, not done', () => {
    const { stages } = buildLifecycleStages({
      stageMaster: FULL,
      stageLog: [{ from_stage_code: 'FLUSH_SERVICE', to_stage_code: 'DRY_SOW_GESTATION', transferred_at: '2026-07-11 08:00:00' }],
      batchStartDate: '2026-07-01',
      currentStageCode: 'DRY_SOW_GESTATION',
    });
    const byCode = Object.fromEntries(stages.map((s) => [s.code, s.status]));

    expect(byCode.SLAUGHTER).toBe('UPCOMING');
    expect(byCode.QUARANTINE).toBe('UPCOMING');
    expect(byCode.FLUSH_SERVICE).toBe('COMPLETED');
  });
});
