/**
 * How far it is from one point to the next, for a route stop's "KM from Previous Stop" (Rishi, 5 Nov).
 *
 * Road distance is what a truck actually drives, so that is what is asked of a routing service — OSRM, at
 * `OSRM_BASE_URL`, which defaults to the public demo server. Nothing on a farm should stop working because a
 * public map server is slow or offline, so a failed or slow call falls back to the straight line between the two
 * points and says which of the two it gave. The caller shows that, and the number stays editable either way.
 *
 * Kept as plain functions so the maths and the response parsing can be tested without a network.
 */

export interface Point {
  latitude: number;
  longitude: number;
}

export type DistanceSource = 'ROAD' | 'STRAIGHT_LINE';

export interface DistanceResult {
  km: number;
  source: DistanceSource;
}

const EARTH_RADIUS_KM = 6371.0088;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in km: the straight line, before any road bends it. */
export function straightLineKm(from: Point, to: Point): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A km figure rounded to the one decimal `distance_from_previous_km` stores, so what is shown is what is saved. */
export const roundKm = (km: number): number => Math.round(km * 10) / 10;

export const DEFAULT_OSRM_BASE_URL = 'https://router.project-osrm.org';

/** OSRM takes its coordinates longitude first. */
export function osrmUrl(baseUrl: string, from: Point, to: Point): string {
  const coordinates = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
  return `${baseUrl.replace(/\/+$/, '')}/route/v1/driving/${coordinates}?overview=false&alternatives=false`;
}

/** The driving distance in km from an OSRM response, or null if it did not route the two points. */
export function osrmDistanceKm(body: unknown): number | null {
  const payload = body as { code?: string; routes?: Array<{ distance?: number }> } | null;
  if (!payload || payload.code !== 'Ok') return null;
  const metres = payload.routes?.[0]?.distance;
  if (typeof metres !== 'number' || !Number.isFinite(metres) || metres < 0) return null;
  return metres / 1000;
}

/**
 * A stored coordinate as a number, or null when the column holds nothing.
 *
 * Not `Number(raw)`: `Number(null)` and `Number('')` are both 0, which is a perfectly valid longitude. A zone
 * with a latitude and no longitude was read as a point on the Greenwich meridian and measured 3,228 km away.
 */
export function coordinate(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function isPoint(value: unknown): value is Point {
  const p = value as Point | null;
  return (
    !!p &&
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  );
}
