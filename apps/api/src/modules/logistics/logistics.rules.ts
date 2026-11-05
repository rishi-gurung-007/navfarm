/**
 * Logistics Phase 1 master rules (NAVFarm TDD: Logistics Module), kept apart from the queries so they can be tested on
 * plain values. Each returns the problems it finds, in plain words, or an empty list.
 */

export const VEHICLE_TYPES = ['LIVESTOCK', 'BULK_FEED', 'BAGGED_FEED'] as const;
export const OWNERSHIP_TYPES = ['OWN', 'HIRED', 'COLCOM_POOL'] as const;
export const VEHICLE_STATUSES = ['AVAILABLE', 'RESERVED', 'IN_USE', 'IN_MAINTENANCE', 'BLOCKED'] as const;
export const DOCUMENT_TYPES = ['INSURANCE', 'LICENCE', 'FITNESS', 'OTHER'] as const;
export const ZONE_TYPES = ['FARM', 'MILL', 'QUARANTINE', 'COLCOM', 'OTHER'] as const;
export const RATE_BASES = ['KM', 'TONNE', 'TONNE_KM', 'TRIP', 'HEAD'] as const;

type Values = Record<string, unknown>;

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function oneOf(problems: string[], label: string, value: unknown, allowed: readonly string[]) {
  if (!allowed.includes(String(value ?? ''))) problems.push(`${label} must be one of ${allowed.join(', ')}.`);
}
function required(problems: string[], label: string, value: unknown) {
  if (!text(value)) problems.push(`${label} is required.`);
}
function nonNegative(problems: string[], label: string, value: unknown) {
  const n = num(value);
  if (n !== null && (!Number.isFinite(n) || n < 0)) problems.push(`${label} cannot be negative.`);
}
function positive(problems: string[], label: string, value: unknown) {
  const n = num(value);
  if (n === null || !Number.isFinite(n) || n <= 0) problems.push(`${label} must be more than 0.`);
}
function percent(problems: string[], label: string, value: unknown) {
  const n = num(value);
  if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) problems.push(`${label} must be between 0 and 100.`);
}
function latLong(problems: string[], values: Values) {
  const lat = num(values.latitude);
  const lng = num(values.longitude);
  if (lat !== null && (lat < -90 || lat > 90)) problems.push('Latitude must be between -90 and 90.');
  if (lng !== null && (lng < -180 || lng > 180)) problems.push('Longitude must be between -180 and 180.');
}

/**
 * Which load capacity a truck is asked for, by what it carries (Rishi, 5 Nov). Tonnes is asked of every type and
 * stays optional — a truck's tonnage is not always on its papers — so the type's own measure is the one required.
 */
export const CAPACITY_BY_VEHICLE_TYPE: Record<string, { field: string; label: string }> = {
  LIVESTOCK: { field: 'capacity_head', label: 'Capacity Head' },
  BULK_FEED: { field: 'capacity_kg', label: 'Capacity KG' },
  BAGGED_FEED: { field: 'capacity_bags', label: 'Capacity Bags' },
};

export function vehicleProblems(v: Values): string[] {
  const p: string[] = [];
  required(p, 'Registration No.', v.registration_no);
  oneOf(p, 'Vehicle Type', v.vehicle_type, VEHICLE_TYPES);
  oneOf(p, 'Ownership', v.ownership, OWNERSHIP_TYPES);
  if (v.ownership === 'HIRED' && !text(v.carrier_supplier_id)) p.push('A hired vehicle needs its carrier.');
  for (const [k, l] of [['capacity_kg', 'Capacity KG'], ['capacity_head', 'Capacity Head'], ['capacity_bags', 'Capacity Bags'], ['capacity_tonnes', 'Capacity Tonnes'], ['compartments', 'Compartments'], ['odometer_km', 'Odometer']] as const)
    nonNegative(p, l, v[k]);
  const measure = CAPACITY_BY_VEHICLE_TYPE[String(v.vehicle_type ?? '')];
  if (measure && !((num(v[measure.field]) ?? 0) > 0))
    p.push(`${measure.label} is required for this vehicle type.`);
  return p;
}

export function vehicleDocumentProblems(v: Values): string[] {
  const p: string[] = [];
  required(p, 'Vehicle', v.vehicle_id);
  oneOf(p, 'Document Type', v.document_type, DOCUMENT_TYPES);
  if (!isDate(v.expiry_date)) p.push('Expiry Date is required.');
  if (isDate(v.issue_date) && isDate(v.expiry_date) && String(v.issue_date) > String(v.expiry_date))
    p.push('Expiry Date cannot be before Issue Date.');
  return p;
}

export function driverProblems(v: Values): string[] {
  const p: string[] = [];
  required(p, 'Driver Name', v.driver_name);
  required(p, 'Licence No.', v.licence_no);
  required(p, 'Licence Class', v.licence_class);
  if (!isDate(v.licence_expiry)) p.push('Licence Expiry is required.');
  return p;
}

export function zoneProblems(v: Values): string[] {
  const p: string[] = [];
  required(p, 'Zone Code', v.zone_code);
  required(p, 'Zone Name', v.zone_name);
  oneOf(p, 'Zone Type', v.zone_type, ZONE_TYPES);
  latLong(p, v);
  nonNegative(p, 'Arrival Radius', v.arrival_radius_m);
  return p;
}

export function routeProblems(v: Values): string[] {
  const p: string[] = [];
  required(p, 'Route Code', v.route_code);
  required(p, 'From Zone', v.from_zone_id);
  required(p, 'To Zone', v.to_zone_id);
  if (text(v.from_zone_id) && v.from_zone_id === v.to_zone_id) p.push('From Zone and To Zone must differ.');
  positive(p, 'Distance KM', v.distance_km);
  positive(p, 'Standard Speed', v.speed_kmh);
  for (const [k, l] of [['loading_minutes', 'Loading Minutes'], ['offloading_minutes', 'Offloading Minutes'], ['break_minutes', 'Break Minutes'], ['tolls', 'Tolls']] as const)
    nonNegative(p, l, v[k]);
  return p;
}

/** No Zone: the route code says which zone the route runs in, so a stop is its own name and point (Rishi, 5 Nov). */
export function routeStopProblems(v: Values): string[] {
  const p: string[] = [];
  required(p, 'Route', v.route_id);
  required(p, 'Stop Name', v.stop_name);
  positive(p, 'Stop No.', v.stop_seq);
  latLong(p, v);
  nonNegative(p, 'Distance from Previous Stop', v.distance_from_previous_km);
  nonNegative(p, 'Stop Minutes', v.stop_minutes);
  return p;
}

export function freightRateProblems(v: Values): string[] {
  const p: string[] = [];
  required(p, 'Carrier', v.carrier_supplier_id);
  oneOf(p, 'Rate Basis', v.rate_basis, RATE_BASES);
  if (num(v.rate) === null) p.push('Rate is required.');
  nonNegative(p, 'Rate', v.rate);
  nonNegative(p, 'Minimum Charge', v.minimum_charge);
  percent(p, 'Fuel Surcharge %', v.fuel_surcharge_pct);
  nonNegative(p, 'Waiting Rate', v.waiting_rate_per_hour);
  if (!isDate(v.valid_from)) p.push('Valid From is required.');
  if (isDate(v.valid_from) && isDate(v.valid_to) && String(v.valid_to) < String(v.valid_from))
    p.push('Valid To cannot be before Valid From.');
  return p;
}

/** Two rates' date ranges share a day; an open Valid To runs on for ever. */
export function datesOverlap(a: { valid_from: string; valid_to: string | null }, b: { valid_from: string; valid_to: string | null }): boolean {
  const aEnd = a.valid_to ?? '9999-12-31';
  const bEnd = b.valid_to ?? '9999-12-31';
  return a.valid_from <= bEnd && b.valid_from <= aEnd;
}

/**
 * A plan's scope is one named truck or every truck of a type, and at least one of the two must be given.
 *
 * Both may be present: choosing a vehicle fills its own type in for information (Rishi, 5 Nov). **Where both
 * are set, `vehicle_id` is the scope** and `vehicle_type` is only what that truck happens to be — a plan for
 * one tanker must never be read as a plan for every tanker. Whatever resolves plans to trucks in Phase 2 has to
 * check `vehicle_id` first.
 */
export function servicePlanProblems(v: Values): string[] {
  const p: string[] = [];
  required(p, 'Plan Name', v.plan_name);
  if (!text(v.vehicle_id) && !text(v.vehicle_type)) p.push('Choose a vehicle or a vehicle type.');
  if (text(v.vehicle_type)) oneOf(p, 'Vehicle Type', v.vehicle_type, VEHICLE_TYPES);
  if (!num(v.interval_km) && !num(v.interval_days)) p.push('Give a service interval in km, days or both.');
  for (const [k, l] of [['interval_km', 'Interval KM'], ['interval_days', 'Interval Days'], ['grace_km', 'Grace KM'], ['grace_days', 'Grace Days']] as const)
    nonNegative(p, l, v[k]);
  return p;
}

export function settingProblems(v: Values): string[] {
  const p: string[] = [];
  percent(p, 'Capacity Warning %', v.capacity_warning_pct);
  percent(p, 'Cost Variance %', v.cost_variance_pct);
  nonNegative(p, 'Service Grace Days', v.service_grace_days);
  nonNegative(p, 'POD Reminder Hours', v.pod_reminder_hours);
  return p;
}
