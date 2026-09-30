import { breedingSiloLinks, pickDemoLevels, stageEntryDaysAgo } from './feed-planning';

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

describe('breedingSiloLinks — the breeding batch reaches its sow diets from silos (D31)', () => {
  const shed = (shedId: string, role: string | null, siloIds: string[]) => ({ shedId, code: shedId, name: shedId, role, siloIds, penIds: [] }) as any;
  const farm = {
    sheds: [
      shed('SHED-001', 'GILT', ['SILO-001']),
      shed('SHED-002', 'DRY_SOW', ['SILO-002']),
      shed('SHED-003', 'FARROWING', ['SILO-003']),
      shed('SHED-004', 'WEANER', ['SILO-004']),
      shed('SHED-007', 'BOAR', ['SILO-007']),
    ],
  };

  it('links the dry sow and farrowing silos to a gilt house the breeding batch stands in', () => {
    expect(breedingSiloLinks(farm, 'SHED-001')).toEqual(['SILO-002', 'SILO-003']);
  });

  it('adds nothing a shed already draws from, and nothing to a shed that is not a gilt house (D9: one feed per silo in a shed)', () => {
    const linked = { sheds: farm.sheds.map((s) => (s.shedId === 'SHED-001' ? { ...s, siloIds: ['SILO-001', 'SILO-002'] } : s)) };
    expect(breedingSiloLinks(linked, 'SHED-001')).toEqual(['SILO-003']);
    expect(breedingSiloLinks(farm, 'SHED-002')).toEqual([]);
    expect(breedingSiloLinks(farm, 'SHED-007')).toEqual([]);
  });

  it('skips a role the farm has no silo for', () => {
    const noFarrowingSilo = { sheds: farm.sheds.map((s) => (s.role === 'FARROWING' ? { ...s, siloIds: [] } : s)) };
    expect(breedingSiloLinks(noFarrowingSilo, 'SHED-001')).toEqual(['SILO-002']);
  });
});
