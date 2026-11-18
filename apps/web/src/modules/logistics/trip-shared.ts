/**
 * Logistics Phase 2 trips on the web: what the Trips screen, the Plan Trip panel and the Find Vehicle dialog share.
 * The API is apps/api/src/modules/logistics/logistics-trip.controller.ts; its refusals are plain words, shown verbatim.
 */
import type { TranslationKeys } from '@/utils/translations';

export type Row = Record<string, any>;

/** The trip a Transfer Order carries (GET /stock-transfer/:id → trip). */
export type TransferTrip = {
  trip_id: string;
  trip_no: string;
  status: string;
  vehicle_no: string | null;
  driver_name: string | null;
  estimated_arrival: string | null;
};

export type VehicleType = 'LIVESTOCK' | 'BULK_FEED' | 'BAGGED_FEED';

export const VEHICLE_TYPE_OPTIONS: Array<{ value: VehicleType; labelKey: TranslationKeys }> = [
  { value: 'BULK_FEED', labelKey: 'trpTypeBulkFeed' },
  { value: 'BAGGED_FEED', labelKey: 'trpTypeBaggedFeed' },
  { value: 'LIVESTOCK', labelKey: 'trpTypeLivestock' },
];

export function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : (res?.data ?? res)) as T;
}

export const errorText = (err: unknown, fallback = 'Something went wrong.'): string =>
  (err as { message?: string } | null)?.message || fallback;

/** A trip time is the farm's wall-clock, 'YYYY-MM-DD HH:mm:ss' or with a T; shown to the minute, never re-zoned. */
export function formatTripTime(value: unknown): string {
  if (!value) return '—';
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(value));
  return m ? `${m[1]} ${m[2]}` : String(value);
}

export function formatMoney(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPct(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)} %` : null;
}

/** The summary the TO shows, from a full trip row (plan, assign and cancel answer with one). */
export function toTransferTrip(trip: Row): TransferTrip {
  return {
    trip_id: trip.trip_id,
    trip_no: trip.trip_no,
    status: trip.status,
    vehicle_no: trip.vehicle_no ?? null,
    driver_name: trip.driver_name ?? null,
    estimated_arrival: trip.estimated_arrival ?? null,
  };
}

/** A trip still waiting for its truck: Find Vehicle is offered. */
export const ASSIGNABLE = ['DRAFT', 'PLANNED'];
/** A trip that can still be called off (trip.rules.ts canMove). */
export const CANCELLABLE = ['DRAFT', 'PLANNED', 'CONFIRMED'];
