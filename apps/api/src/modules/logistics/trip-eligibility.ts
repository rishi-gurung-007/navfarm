/**
 * Why a truck or driver cannot take a trip (NAVFarm TDD: Logistics Module). Pure: no database, no clock. Each function
 * returns every reason that applies, in plain words; an empty list means eligible.
 */
import { CAPACITY_BY_VEHICLE_TYPE, VEHICLE_TYPES } from './logistics.rules';
import { capacityCheck } from './trip.rules';

export type VehicleType = (typeof VEHICLE_TYPES)[number];

export type VehicleFacts = {
  registration_no: string;
  status: string;
  is_active: boolean;
  vehicle_type: string;
  capacity_kg: number | string | null;
  capacity_head: number | string | null;
  capacity_bags: number | string | null;
  documents: { document_type: string; expiry_date: string }[];
};

export type DriverFacts = {
  driver_name: string;
  is_active: boolean;
  licence_class: string | null;
  licence_expiry: string | null;
};

export type Interval = { trip_no: string; start: string; end: string };

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  IN_USE: 'In use',
  IN_MAINTENANCE: 'In maintenance',
  BLOCKED: 'Blocked',
};
const TYPE_LABEL: Record<string, string> = { LIVESTOCK: 'Livestock', BULK_FEED: 'Bulk feed', BAGGED_FEED: 'Bagged feed' };
const UNIT: Record<string, string> = { LIVESTOCK: 'head', BULK_FEED: 'KG', BAGGED_FEED: 'bags' };
const DOC_LABEL: Record<string, string> = { INSURANCE: 'Insurance', LICENCE: 'Licence', FITNESS: 'Fitness' };

const fmt = (x: number) => x.toLocaleString('en-US');
const day = (s: string) => String(s).slice(0, 10);

const startMs = (s: string) => Date.parse(s.length === 10 ? `${s}T00:00:00` : s);
const endMs = (s: string) => Date.parse(s.length === 10 ? `${s}T23:59:59.999` : s);

/**
 * `returnAt` is the exact time the truck is back (naive local date-time). Without it the return day counts to its
 * last millisecond, which makes a trip back at 10:00 clash with one leaving at 14:00 the same day — so callers that
 * know the time pass it; `returnDate` stays for the document and licence expiry checks.
 */
function busyReasons(departure: string, returnDate: string, busy: Interval[], returnAt?: string): string[] {
  const aStart = startMs(departure);
  const aEnd = returnAt ? Date.parse(returnAt) : endMs(returnDate);
  const out: string[] = [];
  for (const b of busy) {
    const bStart = Date.parse(b.start);
    const bEnd = Date.parse(b.end);
    if (aStart < bEnd && bStart < aEnd)
      out.push(`Already on trip ${b.trip_no} until ${String(b.end).slice(0, 16).replace('T', ' ')}.`);
  }
  return out;
}

export function vehicleExclusions(
  v: VehicleFacts,
  trip: { type: VehicleType; load: number; departure: string; returnDate: string; returnAt?: string; warnPct?: number },
  busy: Interval[],
): string[] {
  const out: string[] = [];
  if (!v.is_active) out.push('Vehicle is inactive.');
  if (v.status !== 'AVAILABLE') out.push(`Vehicle is ${STATUS_LABEL[v.status] ?? v.status}.`);

  const wrongType = v.vehicle_type !== trip.type;
  if (wrongType)
    out.push(
      `Vehicle is a ${TYPE_LABEL[v.vehicle_type] ?? v.vehicle_type} truck; this load needs a ${TYPE_LABEL[trip.type] ?? trip.type} truck.`,
    );

  const ret = day(trip.returnDate);
  for (const type of ['INSURANCE', 'LICENCE', 'FITNESS']) {
    const dates = v.documents.filter((d) => d.document_type === type).map((d) => day(d.expiry_date));
    if (!dates.length) {
      if (type === 'INSURANCE') out.push('No insurance on file.');
      continue;
    }
    const latest = dates.reduce((a, b) => (b > a ? b : a));
    if (latest < ret) out.push(`${DOC_LABEL[type]} expires ${latest}, before the return on ${ret}.`);
  }

  if (!wrongType) {
    const measure = CAPACITY_BY_VEHICLE_TYPE[trip.type];
    const capacity = Number((v as Record<string, unknown>)[measure.field] ?? 0);
    const check = capacityCheck(trip.load, capacity, trip.warnPct ?? 95);
    if (check.level === 'BLOCK') {
      const unit = UNIT[trip.type];
      out.push(
        !Number.isFinite(capacity) || capacity <= 0
          ? 'Vehicle has no capacity recorded.'
          : `Load ${fmt(trip.load)} ${unit} is over the ${fmt(capacity)} ${unit} capacity.`,
      );
    }
  }

  out.push(...busyReasons(trip.departure, trip.returnDate, busy, trip.returnAt));
  return out;
}

export function driverExclusions(
  d: DriverFacts,
  trip: { departure: string; returnDate: string; returnAt?: string; licenceClass?: string },
  busy: Interval[],
): string[] {
  const out: string[] = [];
  if (!d.is_active) out.push('Driver is inactive.');
  const ret = day(trip.returnDate);
  if (d.licence_expiry && day(d.licence_expiry) < ret)
    out.push(`Licence expires ${day(d.licence_expiry)}, before the return on ${ret}.`);
  const want = (trip.licenceClass ?? '').trim();
  if (want && want.toLowerCase() !== String(d.licence_class ?? '').trim().toLowerCase())
    out.push(`Licence class ${d.licence_class ?? 'none'} does not cover class ${trip.licenceClass}.`);
  out.push(...busyReasons(trip.departure, trip.returnDate, busy, trip.returnAt));
  return out;
}
