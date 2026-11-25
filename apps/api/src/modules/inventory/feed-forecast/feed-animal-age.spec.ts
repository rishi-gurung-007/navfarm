import {
  animalAgesByGroup,
  lineageAges,
  stageAgeDays,
  type AgeStage,
} from './feed-animal-age';

describe('lineageAges: a count-only batch ages from its litters', () => {
  it('weights each litter by the head it sent', () => {
    const ages = lineageAges({
      batchIds: ['grow'],
      asOf: '2026-11-25',
      farrowings: [
        { batchId: 'l1', farrowingDate: '2026-09-26', piglets: 15 }, // 60 days
        { batchId: 'l2', farrowingDate: '2026-10-06', piglets: 12 }, // 50 days
      ],
      transfers: [
        { fromBatchId: 'l1', toBatchId: 'grow', heads: 30, date: '2026-10-18' },
        { fromBatchId: 'l2', toBatchId: 'grow', heads: 10, date: '2026-10-20' },
      ],
    });
    expect(ages.get('grow')).toBe(57.5);
  });

  it('follows more than one move, and averages a lot holding several litters by piglets born live', () => {
    const ages = lineageAges({
      batchIds: ['grower'],
      asOf: '2026-11-25',
      farrowings: [
        { batchId: 'lot', farrowingDate: '2026-09-26', piglets: 10 },
        { batchId: 'lot', farrowingDate: '2026-10-06', piglets: 10 },
      ],
      transfers: [
        { fromBatchId: 'lot', toBatchId: 'weaner', heads: 20, date: '2026-10-20' },
        { fromBatchId: 'weaner', toBatchId: 'grower', heads: 18, date: '2026-11-20' },
      ],
    });
    expect(ages.get('grower')).toBe(55);
  });

  it('leaves out a batch with no farrowing behind it, ignores later moves, and survives a loop', () => {
    const ages = lineageAges({
      batchIds: ['bought', 'later', 'a'],
      asOf: '2026-11-25',
      farrowings: [{ batchId: 'lot', farrowingDate: '2026-09-26', piglets: 10 }],
      transfers: [
        { fromBatchId: 'lot', toBatchId: 'later', heads: 10, date: '2026-11-26' },
        { fromBatchId: 'a', toBatchId: 'b', heads: 5, date: '2026-10-01' },
        { fromBatchId: 'b', toBatchId: 'a', heads: 5, date: '2026-10-02' },
      ],
    });
    expect([...ages.keys()]).toEqual([]);
  });
});

describe('animalAgesByGroup: an animal-wise stage group ages from its animals', () => {
  it('averages date of birth per batch and stage, falling back to age at entry, skipping animals with neither', () => {
    const ages = animalAgesByGroup('2026-11-25', [
      { batchId: 'b', stageId: 's', dob: '2026-08-17', entryDate: '2026-09-01', ageAtEntryWeeks: null }, // 100
      { batchId: 'b', stageId: 's', dob: null, entryDate: '2026-11-18', ageAtEntryWeeks: 20 }, // 147
      { batchId: 'b', stageId: 's', dob: null, entryDate: '2026-11-18', ageAtEntryWeeks: null },
      { batchId: 'b', stageId: 't', dob: null, entryDate: '2026-11-18', ageAtEntryWeeks: null },
    ]);
    expect([...ages]).toEqual([['b:s', 123.5]]);
  });
});

describe('stageAgeDays: with no birth record, age is estimated from the stages the pigs have passed through', () => {
  const stage = (stageId: string, stageCode: string, durationDays: number | null, nextStageId: string | null, lobId = 'pig'): AgeStage =>
    ({ stageId, stageCode, durationDays, nextStageId, lobId, companyId: 'c' });
  // As seeded: Lactation is the sow's stage and leads back to the sow cycle, not into Weaner.
  const stages = [
    stage('other-lac', 'LACTATION', 99, null, 'cattle'),
    stage('lac', 'LACTATION', 28, 'sow'),
    stage('sow', 'PRODUCTIVE_SOW', null, null),
    stage('wea', 'WEANER', 42, 'ds'),
    stage('ds', 'DOUBLE_STOCK', 28, 'gro'),
    stage('gro', 'GROWER', 56, null),
    stage('rear', 'REARING', 210, 'insem'),
    stage('insem', 'INSEMINATION', 2, null),
  ];

  it('adds the suckling days, each earlier growing stage and the days gone in this one', () => {
    expect(stageAgeDays('ds', 10, stages)).toBe(79); // 28 + 42 + 9
    expect(stageAgeDays('gro', 1, stages)).toBe(98); // 28 + 42 + 28
    expect(stageAgeDays('wea', 1, stages)).toBe(28);
  });

  it('gives nothing for a stage that does not lead back to Weaner, or a chain with a duration missing', () => {
    expect(stageAgeDays('insem', 1, stages)).toBeNull();
    expect(stageAgeDays('lac', 5, stages)).toBeNull();
    expect(stageAgeDays('ds', 10, stages.map((s) => (s.stageId === 'wea' ? { ...s, durationDays: null } : s)))).toBeNull();
    expect(stageAgeDays('ds', 10, stages.filter((s) => s.stageId !== 'lac'))).toBeNull();
  });
});
