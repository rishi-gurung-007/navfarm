import { pickDemoLevels, stageEntryDaysAgo } from './feed-planning';

describe('stageEntryDaysAgo — no "Due, not posted" in a fresh demo (B1)', () => {
  it('keeps each animal inside its stage on the day the demo is built', () => {
    expect([null, 116, 28, 14, 7, 3, 2, 1].map(stageEntryDaysAgo)).toEqual([5, 5, 5, 5, 5, 1, 0, 0]);
    for (const days of [1, 2, 3, 7, 14, 28, 116]) expect(days - 1).toBeGreaterThanOrEqual(stageEntryDaysAgo(days));
  });
});

describe('pickDemoLevels — one run-down inside the horizon, one alert now (B1, S10)', () => {
  const source = (locationId: string, balanceKg: number, planningDayDemandKg: number, sourceType: 'SILO' | 'STORE' = 'SILO') =>
    ({ sourceType, sourceCode: `VIL100/${locationId}`, locationId, balanceKg, planningDayDemandKg });

  it('puts the busiest silo ~10 days above its low level and the next just under it', () => {
    const changes = pickDemoLevels(
      [source('SILO-004', 7500, 16.32), source('SILO-004', 7500, 12), source('SILO-002', 10000, 100), source('SILO-006', 9000, 0), source('STORE-001', 40000, 400, 'STORE')],
      new Map([['SILO-002', 18000], ['SILO-004', 13500]]),
    );
    expect(changes).toEqual([
      { siloId: 'SILO-002', siloCode: 'VIL100/SILO-002', lowKg: 9000, why: 'RUNS_DOWN' },
      { siloId: 'SILO-004', siloCode: 'VIL100/SILO-004', lowKg: 7501, why: 'BELOW_NOW' },
    ]);
  });

  it('never proposes a low level at or above the silo\'s high level, nor a non-positive one', () => {
    expect(pickDemoLevels([source('A', 50, 10), source('B', 1000, 5)], new Map([['B', 1000]]))).toEqual([]);
  });
});
