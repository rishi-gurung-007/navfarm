'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Truck } from 'lucide-react';
import { api } from '@/services/api-client';
import { useLanguage } from '@/hooks/useLanguage';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { showToast } from '@/components/ui/toast';
import { FindVehicleDialog } from './find-vehicle-dialog';
import {
  ASSIGNABLE,
  CANCELLABLE,
  VEHICLE_TYPE_OPTIONS,
  errorText,
  formatMoney,
  formatPct,
  formatTripTime,
  toTransferTrip,
  unwrap,
  type Row,
  type TransferTrip,
  type VehicleType,
} from './trip-shared';

/** The part of a Transfer Order the trip panel reads (GET /stock-transfer/:id). */
export type TripTransfer = {
  transfer_id: string;
  status: string;
  trip?: TransferTrip | null;
  to_warehouse_id?: string | null;
  company_id?: string | null;
} & Row;

// ── Company setting: does shipping need a trip? ────────────────────────────────────────────────────────────────────

const settingCache = new Map<string, Promise<boolean>>();

/** For tests: forget the setting read so far. */
export function resetTripSettingCache() {
  settingCache.clear();
}

/**
 * logistics_setting.trip_required_to_ship for the TO's company. A successful read is kept for the page's life; a
 * failed one (a passing network fault, or no Logistics Settings view) answers false for that call only and is not
 * kept, so the next mount asks again. The server still refuses an untripped shipment when the setting is on.
 */
export function tripRequiredToShip(companyId: string | null | undefined): Promise<boolean> {
  const key = companyId ?? '';
  const hit = settingCache.get(key);
  if (hit) return hit;
  const read = api.get('/logistics/setting').then((res) => {
    const rows = unwrap<Row[]>(res);
    const list = Array.isArray(rows) ? rows : [];
    const row = list.find((r) => companyId && r.company_id === companyId) ?? list[0];
    const v = row?.trip_required_to_ship;
    return v === true || v === 1 || v === '1' || v === 'true';
  });
  // Cached while in flight so concurrent mounts share one request; dropped again if it fails.
  settingCache.set(key, read);
  return read.catch(() => {
    if (settingCache.get(key) === read) settingCache.delete(key);
    return false;
  });
}

function useTripRequiredToShip(companyId: string | null | undefined): boolean {
  const [required, setRequired] = useState(false);
  useEffect(() => {
    let live = true;
    void tripRequiredToShip(companyId).then((v) => live && setRequired(v));
    return () => {
      live = false;
    };
  }, [companyId]);
  return required;
}

/**
 * Wraps the TO's free-text vehicle / driver / waybill fields: editable as before when the TO has no trip and the
 * company does not require one; read-only once a trip is attached (the trip names the truck); hidden when shipping
 * needs a trip and there is none, so the planner plans one instead. `display: contents` keeps the parent grid.
 */
export function TripFreeTextGate({ transfer, children }: { transfer: TripTransfer | null; children: ReactNode }) {
  const required = useTripRequiredToShip(transfer?.company_id);
  const hasTrip = Boolean(transfer?.trip);
  if (!hasTrip && required) return null;
  return (
    <fieldset disabled={hasTrip} className="contents m-0 min-w-0 border-0 p-0">
      {children}
    </fieldset>
  );
}

// ── The panel ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const looksLikeSilo = (location: Row | null): boolean =>
  !!location &&
  (String(location.location_type ?? '').toUpperCase() === 'SILO' ||
    /silo/i.test(`${location.location_name ?? ''} ${location.location_code ?? ''}`));

/**
 * The trip on a Transfer Order (Logistics Phase 2). With none: "No trip planned" and, on a DRAFT TO, Plan Trip. With
 * one: its number, status, truck, driver, ETA, estimate and capacity, and, on a DRAFT TO, Find Vehicle and Cancel
 * Trip. A TO past DRAFT shows its trip read-only; the server refuses those changes too.
 */
export function PlanTripPanel({
  transfer,
  onChanged,
}: {
  transfer: TripTransfer;
  onChanged?: (trip: TransferTrip | null) => void;
}) {
  const { t } = useLanguage();
  const propTrip = transfer.trip ?? null;
  const [trip, setTrip] = useState<TransferTrip | null>(propTrip);
  const [detail, setDetail] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const [routes, setRoutes] = useState<Row[]>([]);
  const [routeId, setRouteId] = useState('');
  const [departure, setDeparture] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('BAGGED_FEED');
  const [typeTouched, setTypeTouched] = useState(false);

  useEffect(() => setTrip(propTrip), [propTrip]);

  const tripId = trip?.trip_id ?? null;
  useEffect(() => {
    setDetail(null);
    if (!tripId) return;
    let live = true;
    api
      .get(`/logistics/trip/${tripId}`)
      .then((res) => live && setDetail(unwrap<Row>(res)))
      // Without the trip's own read (no Trips view grant), the TO's summary is shown alone.
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tripId]);

  const toWarehouseId = transfer.to_warehouse_id ?? null;
  useEffect(() => {
    if (!planning) return;
    let live = true;
    api
      .get('/logistics/route?isActive=true&limit=200')
      .then((res) => {
        const rows = unwrap<Row[]>(res);
        if (live) setRoutes(Array.isArray(rows) ? rows : []);
      })
      .catch(() => live && setRoutes([]));
    // The truck type is a plain guess from the destination; the planner changes it if it is wrong.
    if (toWarehouseId && !typeTouched)
      api
        .get(`/location/${toWarehouseId}`)
        .then((res) => {
          if (live && !typeTouched) setVehicleType(looksLikeSilo(unwrap<Row>(res)) ? 'BULK_FEED' : 'BAGGED_FEED');
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [planning, toWarehouseId, typeTouched]);

  const isDraftTo = transfer.status === 'DRAFT';
  const changed = (next: TransferTrip | null) => {
    setTrip(next);
    onChanged?.(next);
  };

  const plan = async () => {
    if (!routeId) return setError(t('trpChooseRoute'));
    if (!departure) return setError(t('trpChooseDeparture'));
    setBusy(true);
    setError('');
    try {
      const row = unwrap<Row>(
        await api.post('/logistics/trip/plan', {
          transfer_ids: [transfer.transfer_id],
          planned_departure: departure,
          route_id: routeId,
          vehicle_type: vehicleType,
        }),
      );
      setPlanning(false);
      setDetail(row);
      changed(toTransferTrip(row));
      showToast.success(t('trpPlanned', { no: row.trip_no }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!trip) return;
    const reason = cancelReason.trim();
    if (!reason) return setError(t('trpCancelReasonRequired'));
    setBusy(true);
    setError('');
    try {
      await api.post(`/logistics/trip/${trip.trip_id}/cancel`, { reason });
      setCancelOpen(false);
      setCancelReason('');
      showToast.success(t('trpCancelled', { no: trip.trip_no }));
      changed(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const shown = detail ?? trip;
  const estimate = formatMoney(detail?.estimated_cost);
  const capacity = formatPct(detail?.capacity_pct);

  return (
    <div
      className="mb-3.5 rounded-[var(--radius-sm)] border px-3 py-3"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
      data-plan-trip-panel
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="nf-text-label flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          <Truck className="h-4 w-4" style={{ color: 'var(--accent)' }} />
          {t('trpTrip')}
        </span>
        {isDraftTo && (
          <div className="flex flex-wrap items-center gap-2">
            {!trip && !planning && (
              <Button type="button" size="sm" onClick={() => setPlanning(true)}>
                {t('trpPlanTrip')}
              </Button>
            )}
            {trip && ASSIGNABLE.includes(trip.status) && (
              <Button type="button" size="sm" variant="outline" onClick={() => setFindOpen(true)}>
                {t('trpFindVehicle')}
              </Button>
            )}
            {trip && CANCELLABLE.includes(trip.status) && !cancelOpen && (
              <Button type="button" size="sm" variant="outline" onClick={() => setCancelOpen(true)}>
                {t('trpCancelTrip')}
              </Button>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {!trip && !planning && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('trpNoTripPlanned')}
        </p>
      )}

      {!trip && planning && isDraftTo && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label className="nf-text-label" style={{ color: 'var(--text-secondary)' }}>
              {t('trpRoute')}
            </label>
            <SearchableSelect
              ariaLabel={t('trpRoute')}
              value={routeId}
              onChange={setRouteId}
              options={routes}
              valueKey="route_id"
              getLabel={(r) =>
                [r.route_code, [r.from_zone_name, r.to_zone_name].filter(Boolean).join(' → ')].filter(Boolean).join(' · ')
              }
              placeholder={t('trpSelectRoute')}
              searchPlaceholder={t('trpSearchRoute')}
              noMatchesLabel={t('trpNoMatches')}
              triggerClassName="nf-input nf-select"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="nf-text-label" style={{ color: 'var(--text-secondary)' }} htmlFor="trip-planned-departure">
              {t('trpPlannedDeparture')}
            </label>
            <input
              id="trip-planned-departure"
              type="datetime-local"
              className="nf-input"
              value={departure}
              onChange={(e) => setDeparture(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="nf-text-label" style={{ color: 'var(--text-secondary)' }}>
              {t('trpTruckType')}
            </label>
            <SearchableSelect
              ariaLabel={t('trpTruckType')}
              value={vehicleType}
              onChange={(v) => {
                setTypeTouched(true);
                setVehicleType(v as VehicleType);
              }}
              options={VEHICLE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              valueKey="value"
              labelKey="label"
              columnHeaders={false}
              triggerClassName="nf-input nf-select"
            />
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t('trpTruckTypeHint')}
            </span>
          </div>
          <div className="flex items-center justify-end gap-2 sm:col-span-3">
            <Button type="button" size="sm" variant="outline" onClick={() => setPlanning(false)} disabled={busy}>
              {t('trpClose')}
            </Button>
            <Button type="button" size="sm" onClick={() => void plan()} disabled={busy}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {t('trpSave')}
            </Button>
          </div>
        </div>
      )}

      {trip && shown && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Field label={t('trpTripNo')}>
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{shown.trip_no}</span>
              <StatusBadge status={shown.status} />
            </span>
          </Field>
          <Field label={t('trpVehicle')}>{shown.vehicle_no || t('trpNotAssigned')}</Field>
          <Field label={t('trpDriver')}>{shown.driver_name || t('trpNotAssigned')}</Field>
          <Field label={t('trpEta')}>{formatTripTime(shown.estimated_arrival)}</Field>
          <Field label={t('trpEstimate')}>
            {estimate ? <span>{estimate}</span> : <span style={{ color: 'var(--text-muted)' }}>{t('trpNoEstimate')}</span>}
            {detail?.estimate_note && (
              <span className="mt-0.5 block text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {detail.estimate_note}
              </span>
            )}
          </Field>
          <Field label={t('trpCapacity')}>{capacity ?? '—'}</Field>
        </dl>
      )}

      {trip && cancelOpen && isDraftTo && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1">
            <label className="nf-text-label" style={{ color: 'var(--text-secondary)' }} htmlFor="trip-cancel-reason">
              {t('trpCancelReason')}
            </label>
            <input
              id="trip-cancel-reason"
              type="text"
              className="nf-input"
              value={cancelReason}
              maxLength={500}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setCancelOpen(false)} disabled={busy}>
              {t('trpKeepTrip')}
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={() => void cancel()} disabled={busy}>
              {t('trpConfirmCancel')}
            </Button>
          </div>
        </div>
      )}

      {trip && (
        <FindVehicleDialog
          open={findOpen}
          tripId={trip.trip_id}
          tripNo={trip.trip_no}
          onClose={() => setFindOpen(false)}
          onAssigned={(row) => {
            setDetail(row);
            changed(toTransferTrip(row));
            showToast.success(t('trpAssigned', { no: row.trip_no }));
          }}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {label}
      </dt>
      <dd className="m-0 truncate" style={{ color: 'var(--text-primary)' }}>
        {children}
      </dd>
    </div>
  );
}

export default PlanTripPanel;
