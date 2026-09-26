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
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 2,
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
  it('runs down on the first day the closing balance is at or below the silo low level', () => {
    // 525 → closes 425, 325, 225, 125 (26 Sep) — the first close at or below 200.
    const { sources, rows } = buildFeedForecast(oneSilo({}, { lowLevelKg: 200 }));
    expect(sources[0]).toMatchObject({
      runDownDate: '2026-09-26', refillDate: '2026-09-24', requiredOn: '2026-09-22', overdue: true, thresholdKg: 200, daysLeft: 5,
    });
    expect(rows[0]).toMatchObject({ runDownDate: '2026-09-26', refillDate: '2026-09-24', requiredOn: '2026-09-22', overdue: true });
  });

  it('with no low level, an exact multiple runs down on the day it empties — 500 kg at 100 kg/day on day 5 (Q1)', () => {
    const { sources } = buildFeedForecast(oneSilo({}, { balanceKg: 500 }));
    expect(sources[0]).toMatchObject({ runDownDate: '2026-09-27', daysLeft: 5, thresholdKg: 0 });
  });

  it("keeps D1's 525 kg sample on day 6", () => {
    expect(buildFeedForecast(oneSilo()).sources[0].runDownDate).toBe('2026-09-28');
  });
});

describe('buildFeedForecast — confirmed incoming (D19, Q2)', () => {
  it('adds a delivery on its date and counts it as incoming for the requisition window', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-25', kg: 300 }] }, { lowLevelKg: 200 });
    // Closes 425, 325, 525 (+300), 425, 325, 225, 125 (29 Sep).
    const { sources } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ runDownDate: '2026-09-29', incomingKg: 300, balanceKg: 525 });
    // Deficit below 200 kg at the end of 29 Sep: 700 demand + 200 level − 525 opening − 300 incoming.
    expect(sources[0].shortfallKg).toBe(75);
  });

  it('a delivery after the run-down does not hide it, and the shortfall is the deficit before it arrives', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-28', kg: 1000 }] }, { balanceKg: 100 });
    const { sources } = buildFeedForecast(input);
    expect(sources[0].runDownDate).toBe('2026-09-23');
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
    expect(sources[0]).toMatchObject({ balanceKg: 325, daysLeft: 3, runDownDate: '2026-09-28' });
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
    const input = oneSilo({ to: '2026-09-25', horizonTo: '2026-10-10' }, { balanceKg: 1000 });
    const { sources, rows } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ runDownDate: '2026-10-02', walkDemandKg: 300, shortfallKg: 0 });
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
    const input = oneSilo({ leadTimeDays: 0 }, { balanceKg: 1500 });
    input.batches[0].heads = 2000; // 2,000 kg/day for 7 days = 14,000 kg against 1,500 kg
    expect(buildFeedForecast(input).sources[0].shortfallKg).toBe(12500);
  });
});
