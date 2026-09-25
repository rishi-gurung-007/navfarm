import { isDue, midwayTopUpKg, topUpKg } from './daily-entry-plan';

describe('isDue', () => {
  const daily = { occurrence: 'DAILY', start_day: 28, end_day: 70 };
  const anchor = '2026-09-11';

  it('a daily line is due from start_day through end_day, inclusive', () => {
    expect(isDue(daily, 27, '2026-09-20', anchor)).toBe(false);
    expect(isDue(daily, 28, '2026-09-20', anchor)).toBe(true);
    expect(isDue(daily, 70, '2026-09-20', anchor)).toBe(true);
  });

  // Final review I1: a stage that switches diet mid-way has one line per diet,
  // and the first must stop on its own end_day.
  it('a daily line is not due after its end_day', () => {
    expect(isDue(daily, 71, '2026-09-20', anchor)).toBe(false);
  });

  it('a line with no end_day runs on', () => {
    expect(isDue({ ...daily, end_day: null }, 500, '2026-09-20', anchor)).toBe(true);
  });

  it('a ONCE line is due on its start day only, a WEEKLY line on the anchor weekday, a CUSTOM line never', () => {
    expect(isDue({ occurrence: 'ONCE', start_day: 5, end_day: null }, 5, '2026-09-20', anchor)).toBe(true);
    expect(isDue({ occurrence: 'ONCE', start_day: 5, end_day: null }, 6, '2026-09-20', anchor)).toBe(false);
    expect(isDue({ occurrence: 'WEEKLY', start_day: 1, end_day: null }, 8, '2026-09-18', anchor)).toBe(true);
    expect(isDue({ occurrence: 'WEEKLY', start_day: 1, end_day: null }, 8, '2026-09-19', anchor)).toBe(false);
    expect(isDue({ occurrence: 'CUSTOM', start_day: 1, end_day: null }, 3, '2026-09-20', anchor)).toBe(false);
  });
});

describe('topUpKg', () => {
  // VIL100's dry-sow silo: 120 sows x 2.5 kg x 14 days = 4,200 kg against the
  // 2,000 kg chapter 02 left there — the draw that killed the rebuild.
  it('brings a silo to 14-day demand x 1.5, net of what it already holds', () => {
    expect(topUpKg({ demandKg: 4200, onHandKg: 2000, capacityKg: 20000 })).toBe(4300);
  });

  it('receives nothing when the silo already holds demand x 1.5 — a re-run adds nothing', () => {
    expect(topUpKg({ demandKg: 380.16, onHandKg: 1700, capacityKg: 12000 })).toBe(300);
    expect(topUpKg({ demandKg: 380.16, onHandKg: 2000, capacityKg: 12000 })).toBe(0);
    expect(topUpKg({ demandKg: 4200, onHandKg: 6300, capacityKg: 20000 })).toBe(0);
  });

  it('never targets less than the 2,000 kg floor', () => {
    expect(topUpKg({ demandKg: 140, onHandKg: 500, capacityKg: 6000 })).toBe(1500);
  });

  it('is capped at the silo capacity, and uncapped for a store', () => {
    expect(topUpKg({ demandKg: 10000, onHandKg: 2000, capacityKg: 6000 })).toBe(4000);
    expect(topUpKg({ demandKg: 10000, onHandKg: 2000, capacityKg: null })).toBe(13000);
  });

  it('rounds up, never down, to 0.01 kg', () => {
    expect(topUpKg({ demandKg: 2000.003, onHandKg: 0, capacityKg: null })).toBe(3000.01);
  });
});

describe('midwayTopUpKg', () => {
  it('refills toward the remaining demand x 1.5, within the room left in the silo', () => {
    expect(midwayTopUpKg({ drawKg: 300, balanceKg: 100, remainingDemandKg: 3000, capacityKg: 6000 })).toBe(4400);
    expect(midwayTopUpKg({ drawKg: 300, balanceKg: 100, remainingDemandKg: 9000, capacityKg: 6000 })).toBe(5900);
  });

  it('always receives at least enough for the draw in hand', () => {
    expect(midwayTopUpKg({ drawKg: 300, balanceKg: 100, remainingDemandKg: 300, capacityKg: 250 })).toBe(200);
  });
});
