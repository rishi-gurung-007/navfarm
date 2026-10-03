import { FeedRow } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';

/**
 * Plan R, spec D19: run-down to the silo's low level (or zero), confirmed
 * incoming, a forward planning date walked from today's stock, a run-down
 * horizon past the visible range, and the shortfall a requisition drafts.
 * One shed, one silo, one batch of 100 pigs at 1 kg/head/day = 100 kg/day.
 */
const row = (over: Partial<FeedRow> = {}): FeedRow => ({
  lifecycleId: 'a', breedId: 'l', stageId: 'grower', itemId: 'r1', itemName: 'Grower Diet',
  fromDay: 1, toDay: 200, kgPerHeadPerDay: 1, wastagePct: 0, ...over,
});

function oneSilo(over: Partial<ForecastInput> = {}, silo: Partial<ForecastInput['silos'][number]> = {}): ForecastInput {
  return {
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 525, ...silo }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [{
      batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
      segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }],
    }],
    feedRows: [row()],
    ...over,
  };
}

describe('buildFeedForecast — D19 run-down to the low level', () => {
  // Rishi ruling (2026-10-01): runDownDate is the first day demand > open (animals cannot be fed).
  // The silo's low level (thresholdKg) is an alert threshold only (3 Oct ruling 2): it affects neither runDownDate nor shortfallKg.

  it('runs down on the first day demand exceeds available stock — 525 kg closes to 25 on day 5, empties on day 6', () => {
    // 525 → 425, 325, 225, 125, 25. On Sep28 open=25, demand=100 → 100>25 → runDownDate.
    const { sources, rows } = buildFeedForecast(oneSilo({}, { lowLevelKg: 200 }));
    expect(sources[0]).toMatchObject({
      runDownDate: '2026-09-28', thresholdKg: 200, daysLeft: 5.3, // 525 ÷ 100 = 5.25 → 5.3
    });
    expect(rows[0]).toMatchObject({ runDownDate: '2026-09-28' });
  });

  it('with no low level, an exact multiple: 500 kg at 100 kg/day — demand exceeds zero stock on day 6', () => {
    // 500→400→300→200→100→0. Sep28: open=0, demand=100, 100>0 → runDownDate.
    const { sources } = buildFeedForecast(oneSilo({}, { balanceKg: 500 }));
    expect(sources[0]).toMatchObject({ runDownDate: '2026-09-28', daysLeft: 5, thresholdKg: 0 });
  });

  it("keeps D1's 525 kg sample: demand exceeds 25 kg remaining on day 6", () => {
    expect(buildFeedForecast(oneSilo()).sources[0].runDownDate).toBe('2026-09-28');
  });

  it('when the low level is high, shortageDate and runDownDate are both the day animals go hungry', () => {
    // 525 kg at 100/day with lowLevel=400: the threshold is breached early but animals keep eating until Sep28.
    // Under the ruling, runDownDate === shortageDate — both fire on the first day demand > open.
    const { sources, daily } = buildFeedForecast(oneSilo({}, { lowLevelKg: 400 }));

    expect(sources[0]).toMatchObject({ runDownDate: '2026-09-28', shortageDate: '2026-09-28' });
    expect(daily[0]).toMatchObject({ runDownDate: '2026-09-28', shortageDate: '2026-09-28' });
  });
});

describe('buildFeedForecast — confirmed incoming (D19, Q2)', () => {
  it('a delivery that keeps stock above zero throughout the window: runDownDate is null', () => {
    // 525→425→325→525(+300)→425→325→225→125. Demand never exceeds open in the Sep23-Sep29 window.
    // No animals go hungry → runDownDate null, and nothing is short either.
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-25', kg: 300 }] }, { lowLevelKg: 200 });
    const { sources } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ runDownDate: null, incomingKg: 300, balanceKg: 525 });
    // 700 demand − 525 opening − 300 incoming = −125 → 0; the 200 kg low level is not part of it (3 Oct ruling 2).
    expect(sources[0].shortfallKg).toBe(0);
  });

  it('a delivery after the run-down does not hide it; runDownDate is the first day demand > open', () => {
    // 100 kg at 100/day. Sep23: open=100, demand=100, 100>100=false. Sep24: open=0, demand=100, 100>0 → runDownDate.
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-28', kg: 1000 }] }, { balanceKg: 100 });
    const { sources } = buildFeedForecast(input);
    expect(sources[0].runDownDate).toBe('2026-09-24');
    // End of 27 Sep: 500 demanded against 100 held — 400 short before the truck; after it the silo is ahead.
    expect(sources[0].shortfallKg).toBe(400);
  });

  it('a transfer out never takes the opening below zero', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-23', kg: -300 }] }, { balanceKg: 100 });
    const { sources } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ balanceKg: 0, runDownDate: '2026-09-23', daysLeft: 0 });
  });

  it('a delivery on the planning date is part of its opening balance, not of incomingKg', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-23', kg: 100 }] });
    expect(buildFeedForecast(input).sources[0]).toMatchObject({ balanceKg: 625, incomingKg: 0 });
  });
});

describe('buildFeedForecast — forward planning date walks today\'s stock (Review Focus 5)', () => {
  it('consumes the days between the stock date and the planning date without reporting them', () => {
    const input = oneSilo({ stockDate: '2026-09-23', planningDate: '2026-09-25', from: '2026-09-25' });
    // 525 → 425 (23) → 325 (24) = the opening on 25 Sep; then 225, 125, 25, −75 on 28 Sep.
    const { sources, rows } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ balanceKg: 325, daysLeft: 3.3, runDownDate: '2026-09-28' });
    expect(rows[0].currentInventoryKg).toBe(325);
  });

  it('a silo that ran out before the planning date runs down on the planning date itself', () => {
    const input = oneSilo({ stockDate: '2026-09-23', planningDate: '2026-09-25', from: '2026-09-25' }, { balanceKg: 150 });
    expect(buildFeedForecast(input).sources[0]).toMatchObject({ balanceKg: 0, runDownDate: '2026-09-25' });
  });

  it('ignores a stock date after the planning date', () => {
    const input = oneSilo({ stockDate: '2026-09-27' });
    expect(buildFeedForecast(input).sources[0]).toMatchObject({ balanceKg: 525, runDownDate: '2026-09-28' });
  });
});

describe('buildFeedForecast — run-down horizon past the range (Q12)', () => {
  it('finds a run-down after `to` while walk demand, rows and shortfall stay on the range', () => {
    // 1000 kg at 100/day. Oct02 closes to 0, Oct03: open=0, demand=100 → runDownDate=Oct03.
    const input = oneSilo({ to: '2026-09-25', horizonTo: '2026-10-10' }, { balanceKg: 1000 });
    const { sources, rows } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ runDownDate: '2026-10-03', walkDemandKg: 300, shortfallKg: 0 });
    expect(rows[0].rangeDemandKg).toBe(300);
  });

  it('flags a projected stage change only when it falls inside from..to', () => {
    const batch = (start: string): ForecastInput['batches'][number] => ({
      batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
      segments: [
        { stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: '2026-10-04', projected: false },
        { stageId: 'finisher', stageCode: 'FINISHER', start, end: null, projected: true },
      ],
    });
    const outside = buildFeedForecast(oneSilo({ horizonTo: '2026-10-20', batches: [batch('2026-10-05')] }));
    expect(outside.flags.filter((f) => f.kind === 'STAGE_CHANGE_PROJECTED')).toEqual([]);
  });
});

describe('buildFeedForecast — the Worked Example is unchanged by D19 (Plan B numbers)', () => {
  it('shortfall equals requirement − opening when there is no low level and nothing incoming', () => {
    const input = oneSilo({}, { balanceKg: 1500 });
    input.batches[0].heads = 2000; // 2,000 kg/day for 7 days = 14,000 kg against 1,500 kg
    expect(buildFeedForecast(input).sources[0].shortfallKg).toBe(12500);
  });
});

describe('buildFeedForecast — D19 walk edge cases (Plan R review of Task 2)', () => {
  it('a transfer out below the low level but no batch eating: shortfall exists, runDownDate is null (no animals go hungry)', () => {
    // The batch leaves the shed after 24 Sep; on 25 Sep a 700 kg transfer out drops the silo to 100 kg (< 200 level).
    // After Sep24, demand=0 every day → demand never > open → runDownDate=null under the new ruling.
    // The low level no longer enters the shortfall: 200 demand(walk) − 1000 opening + 700 transferred out = −100 → 0.
    const input = oneSilo(
      {
        batches: [{
          batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
          segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: '2026-09-24', projected: false }],
        }],
        incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-25', kg: -700 }],
      },
      { balanceKg: 1000, lowLevelKg: 200 },
    );
    expect(buildFeedForecast(input).sources[0]).toMatchObject({
      runDownDate: null, shortfallKg: 0,
    });
  });

  it('flags a projected stage change that falls inside from..to', () => {
    const input = oneSilo({
      batches: [{
        batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
        segments: [
          { stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: '2026-09-26', projected: false },
          { stageId: 'finisher', stageCode: 'FINISHER', start: '2026-09-27', end: null, projected: true },
        ],
      }],
    });
    expect(buildFeedForecast(input).flags.filter((f) => f.kind === 'STAGE_CHANGE_PROJECTED')).toEqual([
      { kind: 'STAGE_CHANGE_PROJECTED', batchNo: 'GR-2026-01', stageCode: 'FINISHER', date: '2026-09-27' },
    ]);
  });

  it('a silo with 150 kg at 100/day: demand exceeds stock on the second planning day', () => {
    // Sep23: open=150, demand=100, 100>150=false. Sep24: open=50, demand=100, 100>50 → runDownDate=Sep24.
    // shortfallKg: 700 walk − 150 opening = 550 (the 200 kg low level is an alert threshold, not part of it).
    expect(buildFeedForecast(oneSilo({}, { balanceKg: 150, lowLevelKg: 200 })).sources[0]).toMatchObject({
      runDownDate: '2026-09-24', shortfallKg: 550,
    });
  });

  it('a delivery on the day it would run down counts that day', () => {
    // 250 → 150, 50; on 25 Sep 100 kg arrives: 150 → 50; empties on 26 Sep, not 25 Sep.
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-25', kg: 100 }] }, { balanceKg: 250 });
    const { sources, daily } = buildFeedForecast(input);
    expect(sources[0].runDownDate).toBe('2026-09-26');
    expect(daily.find((d) => d.date === '2026-09-25')!.currentInventoryKg).toBe(150);
  });

  it('a silo shared by two batches: combined demand 200/day from 1,000 kg; demand exceeds stock on Sep28', () => {
    // 1000→800→600→400→200→0. Sep28: open=0, demand=200 → 200>0 → runDownDate=Sep28.
    const input = oneSilo({}, { balanceKg: 1000, lowLevelKg: 300 });
    input.batches.push({ ...input.batches[0], batchId: 'b2', batchNo: 'GR-2026-02' });
    const { sources, rows, daily } = buildFeedForecast(input);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ runDownDate: '2026-09-28', thresholdKg: 300, planningDayDemandKg: 200 });
    expect(rows.map((r) => r.runDownDate)).toEqual(['2026-09-28', '2026-09-28']);
    // D35: each row divides the shared 1,000 kg by its OWN 100 kg/day intake, not the silo's combined 200.
    expect(daily.filter((d) => d.date === '2026-09-23').map((d) => [d.daysOfStock, d.sharedBatchCount])).toEqual([[10, 2], [10, 2]]);
  });

  it('a store runs down to zero — it has no low level', () => {
    const input = oneSilo({
      sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: [] }],
      silos: [],
      store: { storeId: 'st', storeCode: 'GRS/STORE-001', balances: { r1: 250 } },
    });
    expect(buildFeedForecast(input).sources[0]).toMatchObject({ sourceType: 'STORE', thresholdKg: 0, runDownDate: '2026-09-25' });
  });

  // Follow-up ruling: a negative opening is ledger truth (feed posted before the item's only receipt) — it is carried
  // into the day's arithmetic and only clamped after the day's inflow. nf_devco VIL100/STORE-001, ICAT-004-ITM-0002:
  // −4,200 fed 10–23 Sep, +40,000 received 24 Sep → Current Inventory on 24 Sep is 35,800, not 40,000.
  it('a store opening below zero is netted against that day\'s receipt, not reset to zero first', () => {
    const input = oneSilo({
      planningDate: '2026-09-24', from: '2026-09-24', to: '2026-09-30',
      sheds: [{ shedId: 'h1', shedCode: 'VIL100/SHED-001', siloIds: [] }],
      silos: [],
      store: { storeId: 'st', storeCode: 'VIL100/STORE-001', balances: { r1: -4200 } },
      incoming: [{ locationId: 'st', itemId: 'r1', date: '2026-09-24', kg: 40000 }],
    });
    const { sources, daily } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ sourceType: 'STORE', balanceKg: 35800 });
    expect(daily.find((d) => d.date === '2026-09-24')).toMatchObject({ currentInventoryKg: 35800 });
  });

  it('a silo that outlasts the horizon has no run-down', () => {
    const { sources, rows, daily } = buildFeedForecast(oneSilo({ horizonTo: '2026-10-10' }, { balanceKg: 10000, lowLevelKg: 200 }));
    const none = { runDownDate: null };
    expect(sources[0]).toMatchObject({ ...none, shortfallKg: 0 });
    expect(rows[0]).toMatchObject(none);
    expect(daily.every((d) => d.runDownDate === null)).toBe(true);
  });

  it('adds up several incoming rows on one date', () => {
    // 150→50; Sep24: 50+100+150=300→200→100→0. Sep27: open=0, demand=100 → runDownDate=Sep27.
    const input = oneSilo(
      {
        incoming: [
          { locationId: 's1', itemId: 'r1', date: '2026-09-24', kg: 100 },
          { locationId: 's1', itemId: 'r1', date: '2026-09-24', kg: 150 },
        ],
      },
      { balanceKg: 150 },
    );
    const { sources, daily } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ runDownDate: '2026-09-27', incomingKg: 250 });
    expect(daily.find((d) => d.date === '2026-09-24')!.currentInventoryKg).toBe(300);
  });
});

describe('buildFeedForecast — run-down needs demand or a transfer out that day (fix round 1)', () => {
  // SILO-001 holds R1 (1,000 kg); SILO-002 holds R2 and is empty. The batch changes onto R2 on 26 Sep (day 4).
  const nextDiet = (): ForecastInput => oneSilo({
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1', 's2'] }],
    silos: [
      { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1000 },
      { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 0 },
    ],
    items: { r1: 'Grower R1', r2: 'Grower R2' },
    feedRows: [row({ toDay: 25 }), row({ lifecycleId: 'b', itemId: 'r2', itemName: 'Grower R2', fromDay: 26 })],
  });

  it('an empty next-diet silo idle until its diet starts runs down on the diet day, not the planning date', () => {
    const r2 = buildFeedForecast(nextDiet()).sources.find((s) => s.itemId === 'r2')!;
    expect(r2).toMatchObject({
      isNextDiet: true, balanceKg: 0, runDownDate: '2026-09-26',
    });
  });

  it('a positive delivery on an idle day does not make an at-level silo run down that day', () => {
    const input = nextDiet();
    input.incoming = [{ locationId: 's2', itemId: 'r2', date: '2026-09-24', kg: 50 }];
    expect(buildFeedForecast(input).sources.find((s) => s.itemId === 'r2')!.runDownDate).toBe('2026-09-26');
  });

  it('never leaves a shortfall without a run-down and a shortage date', () => {
    const cases: ForecastInput[] = [
      nextDiet(),
      oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-25', kg: -500 }] }, { lowLevelKg: 100 }),
      oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-27', kg: 1000 }] }, { balanceKg: 200, lowLevelKg: 150 }),
      oneSilo({}, { balanceKg: 10000 }),
    ];
    for (const input of cases) {
      for (const s of buildFeedForecast(input).sources) {
        if (s.shortfallKg > 0) expect(s.runDownDate !== null && s.shortageDate !== null).toBe(true);
      }
    }
  });
});
