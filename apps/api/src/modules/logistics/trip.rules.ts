/**
 * Logistics Phase 2 trip rules (NAVFarm TDD: Logistics Module), kept apart from the queries so they can be tested on
 * plain values. No database access and no clock: every function works only on what it is given.
 */

export const TRIP_STATUSES = [
  'DRAFT',
  'PLANNED',
  'CONFIRMED',
  'IN_TRANSIT',
  'ARRIVED',
  'POD_RECEIVED',
  'RETURNED',
  'CLOSED',
  'CANCELLED',
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export type RateRow = {
  id?: string;
  carrier_supplier_id: string;
  route_id: string | null;
  rate_basis: string;
  rate: number | string;
  minimum_charge: number | string | null;
  fuel_surcharge_pct: number | string | null;
  waiting_rate_per_hour?: number | string | null;
  valid_from: string;
  valid_to: string | null;
  approval_status: string;
};

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Null when the move is allowed, otherwise the reason in plain words. */
export function canMove(from: TripStatus, to: TripStatus): string | null {
  if (from === 'CLOSED') return 'This trip is closed and locked.';
  if (from === 'CANCELLED') return 'This trip is cancelled.';
  if (from === to) return `The trip is already ${from}.`;
  if (to === 'CANCELLED') {
    return ['DRAFT', 'PLANNED', 'CONFIRMED'].includes(from)
      ? null
      : 'A trip cannot be cancelled once it is in transit.';
  }
  const i = TRIP_STATUSES.indexOf(from);
  if (to === TRIP_STATUSES[i + 1]) return null;
  return `A trip cannot go from ${from} to ${to}.`;
}

export function capacityCheck(
  load: number,
  capacity: number,
  warnPct: number,
): { pct: number; level: 'OK' | 'WARN' | 'BLOCK'; message: string | null } {
  const cap = Number(capacity);
  if (!Number.isFinite(cap) || cap <= 0) return { pct: 0, level: 'BLOCK', message: 'Vehicle has no capacity recorded.' };
  const raw = (n(load) / cap) * 100;
  const pct = Math.round(raw * 10) / 10;
  if (raw > 100) return { pct, level: 'BLOCK', message: `Load is ${raw.toFixed(1)}% of capacity — over the limit.` };
  if (raw >= n(warnPct)) return { pct, level: 'WARN', message: `Load is ${raw.toFixed(1)}% of capacity.` };
  return { pct, level: 'OK', message: null };
}

export function estimateArrival(
  departure: Date,
  route: { distance_km: number | string; speed_kmh: number | string; loading_minutes: number | string; offloading_minutes: number | string; break_minutes: number | string },
): Date {
  const speed = n(route.speed_kmh);
  const driveMinutes = speed > 0 ? (n(route.distance_km) / speed) * 60 : 0;
  const total = n(route.loading_minutes) + driveMinutes + n(route.break_minutes) + n(route.offloading_minutes);
  return new Date(departure.getTime() + Math.round(total * 60000));
}

export function pickRate(rates: RateRow[], q: { carrierId: string; routeId: string | null; on: string }): RateRow | null {
  const fits = rates.filter(
    (r) =>
      r.approval_status === 'APPROVED' &&
      r.carrier_supplier_id === q.carrierId &&
      r.valid_from <= q.on &&
      (r.valid_to === null || r.valid_to === undefined || r.valid_to >= q.on) &&
      (r.route_id === null || r.route_id === undefined || r.route_id === q.routeId),
  );
  if (!fits.length) return null;
  const specific = (r: RateRow) => (r.route_id ? 1 : 0);
  return fits.reduce((best, r) => {
    if (specific(r) !== specific(best)) return specific(r) > specific(best) ? r : best;
    return r.valid_from > best.valid_from ? r : best;
  });
}

export function baseFreight(
  rate: RateRow,
  route: { distance_km: number | string; return_leg_charged: boolean | number; tolls?: number | string | null },
  load: { tonnes: number; head: number },
): number {
  const oneWay = n(route.distance_km);
  const km = route.return_leg_charged ? oneWay * 2 : oneWay;
  const r = n(rate.rate);
  let base: number;
  switch (rate.rate_basis) {
    case 'KM': base = r * km; break;
    case 'TONNE': base = r * n(load.tonnes); break;
    case 'TONNE_KM': base = r * n(load.tonnes) * km; break;
    case 'TRIP': base = r; break;
    case 'HEAD': base = r * n(load.head); break;
    default: base = 0;
  }
  base = Math.max(base, n(rate.minimum_charge));
  const total = base * (1 + n(rate.fuel_surcharge_pct) / 100) + n(route.tolls);
  return Math.round(total * 100) / 100;
}

/** Cents-exact split by weight (largest remainder); equal split when every weight is 0. */
export function shareByWeight(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const cents = Math.round(n(total) * 100);
  const w = weights.map((x) => Math.max(0, n(x)));
  const sum = w.reduce((a, b) => a + b, 0);
  const use = sum > 0 ? w : w.map(() => 1);
  const useSum = sum > 0 ? sum : use.length;
  const exact = use.map((x) => (cents * x) / useSum);
  const floors = exact.map((x) => Math.floor(x + 1e-9));
  let left = cents - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, rem: x - floors[i] })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) floors[order[k].i] += 1;
  return floors.map((c) => c / 100);
}
