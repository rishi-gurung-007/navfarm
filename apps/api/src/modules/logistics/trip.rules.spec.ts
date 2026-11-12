import { TRIP_STATUSES, RateRow, baseFreight, canMove, capacityCheck, estimateArrival, pickRate, shareByWeight } from './trip.rules';

const rate = (o: Partial<RateRow> = {}): RateRow => ({
  id: 'r',
  carrier_supplier_id: 'c1',
  route_id: null,
  rate_basis: 'KM',
  rate: 2,
  minimum_charge: 0,
  fuel_surcharge_pct: 0,
  waiting_rate_per_hour: 0,
  valid_from: '2026-01-01',
  valid_to: null,
  approval_status: 'APPROVED',
  ...o,
});

describe('TRIP_STATUSES', () => {
  it('lists the nine statuses', () => {
    expect(TRIP_STATUSES).toHaveLength(9);
  });
});

describe('capacityCheck', () => {
  it('warns at exactly 100%', () => {
    expect(capacityCheck(30000, 30000, 95).level).toBe('WARN');
  });
  it('blocks over 100%', () => {
    const r = capacityCheck(30001, 30000, 95);
    expect(r.level).toBe('BLOCK');
    expect(r.message).toBe('Load is 100.0% of capacity — over the limit.');
  });
  it('warns at the warn percentage', () => {
    const r = capacityCheck(28500, 30000, 95);
    expect(r.level).toBe('WARN');
    expect(r.pct).toBe(95);
    expect(r.message).toBe('Load is 95.0% of capacity.');
  });
  it('is OK below it', () => {
    const r = capacityCheck(28499, 30000, 95);
    expect(r.level).toBe('OK');
    expect(r.message).toBeNull();
  });
  it('blocks a vehicle with no capacity', () => {
    expect(capacityCheck(10, 0, 95)).toEqual({ pct: 0, level: 'BLOCK', message: 'Vehicle has no capacity recorded.' });
    expect(capacityCheck(10, NaN, 95).level).toBe('BLOCK');
  });
});

describe('estimateArrival', () => {
  it('adds loading, driving, break and offloading', () => {
    const eta = estimateArrival(new Date('2026-11-12T06:00:00Z'), {
      distance_km: 120,
      speed_kmh: 60,
      loading_minutes: 30,
      offloading_minutes: 20,
      break_minutes: 15,
    });
    expect(eta.toISOString()).toBe('2026-11-12T09:05:00.000Z');
  });
});

describe('pickRate', () => {
  const q = { carrierId: 'c1', routeId: 'rt1', on: '2026-06-01' };
  it('ignores rates that are not approved', () => {
    for (const s of ['DRAFT', 'PENDING', 'REJECTED']) {
      expect(pickRate([rate({ approval_status: s })], q)).toBeNull();
    }
  });
  it('prefers route-specific over carrier-general', () => {
    const general = rate({ id: 'g', valid_from: '2026-05-01' });
    const specific = rate({ id: 's', route_id: 'rt1', valid_from: '2026-01-01' });
    expect(pickRate([general, specific], q)?.id).toBe('s');
  });
  it('takes the latest valid_from among equals', () => {
    const a = rate({ id: 'a', valid_from: '2026-01-01' });
    const b = rate({ id: 'b', valid_from: '2026-03-01' });
    expect(pickRate([a, b], q)?.id).toBe('b');
  });
  it('returns null when none covers the date', () => {
    expect(pickRate([rate({ valid_to: '2026-05-31' })], q)).toBeNull();
    expect(pickRate([rate({ valid_from: '2026-07-01' })], q)).toBeNull();
    expect(pickRate([rate({ carrier_supplier_id: 'other' })], q)).toBeNull();
    expect(pickRate([rate({ route_id: 'rt2' })], q)).toBeNull();
  });
});

describe('baseFreight', () => {
  const route = { distance_km: 100, return_leg_charged: false, tolls: 15 };
  const load = { tonnes: 10, head: 50 };
  it('applies minimum, surcharge and tolls', () => {
    expect(baseFreight(rate({ minimum_charge: 250, fuel_surcharge_pct: 10 }), route, load)).toBe(290);
  });
  it('doubles km for a charged return leg on KM', () => {
    expect(baseFreight(rate(), { ...route, return_leg_charged: true, tolls: 0 }, load)).toBe(400);
  });
  it('doubles km for TONNE_KM only otherwise', () => {
    const r = { ...route, return_leg_charged: true, tolls: 0 };
    expect(baseFreight(rate({ rate_basis: 'TONNE_KM', rate: 1 }), r, load)).toBe(2000);
    expect(baseFreight(rate({ rate_basis: 'TONNE', rate: 5 }), r, load)).toBe(50);
    expect(baseFreight(rate({ rate_basis: 'TRIP', rate: 300 }), r, load)).toBe(300);
    expect(baseFreight(rate({ rate_basis: 'HEAD', rate: 3 }), r, load)).toBe(150);
  });
  it('coerces string decimals', () => {
    expect(baseFreight(rate({ rate: '2.00' as unknown as number }), { ...route, tolls: '0' as unknown as number }, load)).toBe(200);
  });
});

describe('shareByWeight', () => {
  it('splits cents exactly', () => {
    expect(shareByWeight(100, [1, 1, 1])).toEqual([33.34, 33.33, 33.33]);
  });
  it('splits equally when all weights are zero', () => {
    expect(shareByWeight(100, [0, 0])).toEqual([50, 50]);
  });
  it('follows the weights and always sums to the total', () => {
    const out = shareByWeight(10, [1, 2, 3]);
    expect(Math.round(out.reduce((a, b) => a + b, 0) * 100)).toBe(1000);
  });
  it('returns an empty list for no weights', () => {
    expect(shareByWeight(100, [])).toEqual([]);
  });
});

describe('canMove', () => {
  it('allows the forward chain', () => {
    for (let i = 0; i < 7; i++) expect(canMove(TRIP_STATUSES[i], TRIP_STATUSES[i + 1])).toBeNull();
  });
  it('refuses skipping a step', () => {
    expect(canMove('DRAFT', 'CONFIRMED')).toEqual(expect.any(String));
  });
  it('refuses moving to the same status or backwards', () => {
    expect(canMove('DRAFT', 'DRAFT')).toEqual(expect.any(String));
    expect(canMove('PLANNED', 'DRAFT')).toEqual(expect.any(String));
  });
  it('allows cancelling before transit only', () => {
    for (const s of ['DRAFT', 'PLANNED', 'CONFIRMED'] as const) expect(canMove(s, 'CANCELLED')).toBeNull();
    expect(canMove('IN_TRANSIT', 'CANCELLED')).toEqual(expect.any(String));
    expect(canMove('ARRIVED', 'CANCELLED')).toEqual(expect.any(String));
  });
  it('locks closed and cancelled trips', () => {
    expect(canMove('CLOSED', 'CANCELLED')).toBe('This trip is closed and locked.');
    expect(canMove('CANCELLED', 'DRAFT')).toBe('This trip is cancelled.');
  });
});
