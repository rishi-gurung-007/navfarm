'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Inbox, Loader2 } from 'lucide-react';
import { api } from '@/services/api-client';
import { useLanguage } from '@/hooks/useLanguage';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { showToast } from '@/components/ui/toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { TranslationKeys } from '@/utils/translations';
import { errorText, formatMoney, formatPct, formatTripTime, unwrap, type Row } from './trip-shared';

const STATUSES = ['DRAFT', 'PLANNED', 'CONFIRMED', 'IN_TRANSIT', 'ARRIVED', 'POD_RECEIVED', 'RETURNED', 'CLOSED', 'CANCELLED'];

/** The one manual step out of each status (trip.rules.ts canMove), and whether it takes an optional time. */
const NEXT: Record<string, { to: string; labelKey: TranslationKeys; timed: boolean }> = {
  PLANNED: { to: 'CONFIRMED', labelKey: 'trpMoveConfirm', timed: false },
  CONFIRMED: { to: 'IN_TRANSIT', labelKey: 'trpMoveDepart', timed: true },
  IN_TRANSIT: { to: 'ARRIVED', labelKey: 'trpMoveArrived', timed: true },
  ARRIVED: { to: 'POD_RECEIVED', labelKey: 'trpMovePod', timed: true },
  POD_RECEIVED: { to: 'RETURNED', labelKey: 'trpMoveReturned', timed: true },
  RETURNED: { to: 'CLOSED', labelKey: 'trpMoveClose', timed: false },
};

const byId = (rows: Row[], key: string, label: string): Record<string, string> =>
  Object.fromEntries(rows.map((r) => [r[key], r[label]]));

const listOf = (res: unknown): Row[] => {
  const rows = unwrap<Row[]>(res);
  return Array.isArray(rows) ? rows : [];
};

/**
 * Logistics trips (Phase 2): the list, and one trip with its manual status steps. No GPS and no map: the planner
 * records each step by hand, with the time it happened when that was not now. Refusals are the server's own words.
 */
export function TripsScreen() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [names, setNames] = useState<{ route: Record<string, string>; vehicle: Record<string, string>; driver: Record<string, string> }>({
    route: {},
    vehicle: {},
    driver: {},
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = status ? `?status=${encodeURIComponent(status)}&limit=200` : '?limit=200';
      setRows(listOf(await api.get(`/logistics/trip${qs}`)));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  // The list holds ids only; a master the user may not read leaves its column showing the id-less dash.
  useEffect(() => {
    let live = true;
    const read = (path: string) => api.get(path).then(listOf).catch(() => [] as Row[]);
    void Promise.all([read('/logistics/route?limit=200'), read('/logistics/vehicle?limit=200'), read('/logistics/driver?limit=200')]).then(
      ([routes, vehicles, drivers]) => {
        if (!live) return;
        setNames({
          route: byId(routes, 'route_id', 'route_code'),
          vehicle: byId(vehicles, 'vehicle_id', 'registration_no'),
          driver: byId(drivers, 'driver_id', 'driver_name'),
        });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  if (selectedId)
    return (
      <TripDetail
        tripId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void load();
        }}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <SearchableSelect
            ariaLabel={t('trpStatus')}
            value={status}
            onChange={setStatus}
            onClear={() => setStatus('')}
            options={[{ value: '', label: t('trpAllStatuses') }, ...STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))]}
            valueKey="value"
            labelKey="label"
            columnHeaders={false}
            placeholder={t('trpAllStatuses')}
            triggerClassName="nf-input nf-select"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('trpTripNo')}</TableHead>
            <TableHead>{t('trpStatus')}</TableHead>
            <TableHead>{t('trpRoute')}</TableHead>
            <TableHead>{t('trpVehicle')}</TableHead>
            <TableHead>{t('trpDriver')}</TableHead>
            <TableHead>{t('trpPlannedDeparture')}</TableHead>
            <TableHead className="text-right">{t('trpEstimateCol')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={7}>
                <span className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('trpLoading')}
                </span>
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7}>
                <span className="flex items-center gap-2 text-[var(--text-muted)]">
                  <Inbox className="h-4 w-4" /> {t('trpNoTrips')}
                </span>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.trip_id} className="cursor-pointer" onClick={() => setSelectedId(r.trip_id)}>
                <TableCell>
                  <button type="button" className="font-medium text-[var(--accent)]">
                    {r.trip_no}
                  </button>
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell>{names.route[r.route_id] ?? '—'}</TableCell>
                <TableCell>{(r.vehicle_id && names.vehicle[r.vehicle_id]) || '—'}</TableCell>
                <TableCell>{(r.driver_id && names.driver[r.driver_id]) || '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{formatTripTime(r.planned_departure)}</TableCell>
                <TableCell className="text-right">
                  {formatMoney(r.estimated_cost) ?? <span className="text-[var(--text-muted)]">{t('trpNoEstimate')}</span>}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function TripDetail({ tripId, onBack }: { tripId: string; onBack: () => void }) {
  const { t } = useLanguage();
  const [trip, setTrip] = useState<Row | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState('');
  const [hqRef, setHqRef] = useState('');
  const [askHq, setAskHq] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get(`/logistics/trip/${tripId}`)
      .then((res) => live && setTrip(unwrap<Row>(res)))
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [tripId]);

  const next = trip ? NEXT[trip.status] : undefined;

  const move = async () => {
    if (!trip || !next) return;
    setBusy(true);
    setError('');
    const body: Record<string, string> = { to: next.to };
    if (next.to === 'CONFIRMED' && hqRef.trim()) body.hq_approval_ref = hqRef.trim();
    if (next.timed && at) body.at = at;
    try {
      const updated = unwrap<Row>(await api.post(`/logistics/trip/${trip.trip_id}/move`, body));
      setTrip(updated);
      setAt('');
      setHqRef('');
      setAskHq(false);
      showToast.success(t('trpMoved', { no: updated.trip_no ?? trip.trip_no, status: String(updated.status ?? next.to).replace(/_/g, ' ') }));
    } catch (err) {
      const message = errorText(err);
      setError(message);
      // The server refuses CONFIRMED on a trip to Colcom without HQ's reference: ask for it.
      if (next.to === 'CONFIRMED' && /HQ approval/i.test(message)) setAskHq(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> {t('trpBackToList')}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      {!trip ? (
        !error && (
          <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('trpLoading')}
          </p>
        )
      ) : (
        <>
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="text-lg font-semibold text-[var(--text-primary)]">{trip.trip_no}</span>
              <StatusBadge status={trip.status} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
              <Field label={t('trpRoute')}>{trip.route_code || '—'}</Field>
              <Field label={t('trpVehicle')}>{trip.vehicle_no || t('trpNotAssigned')}</Field>
              <Field label={t('trpDriver')}>{trip.driver_name || t('trpNotAssigned')}</Field>
              <Field label={t('trpPlannedDeparture')}>{formatTripTime(trip.planned_departure)}</Field>
              <Field label={t('trpEta')}>{formatTripTime(trip.estimated_arrival)}</Field>
              <Field label={t('trpEstimate')}>
                {formatMoney(trip.estimated_cost) ?? t('trpNoEstimate')}
                {trip.estimate_note && <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">{trip.estimate_note}</span>}
              </Field>
              <Field label={t('trpCapacity')}>{formatPct(trip.capacity_pct) ?? '—'}</Field>
              {trip.hq_approval_ref && <Field label={t('trpHqApprovalRef')}>{trip.hq_approval_ref}</Field>}
              <Field label={t('trpTransferOrders')}>
                {[...new Set(((trip.lines as Row[] | undefined) ?? []).map((l) => l.transfer_no).filter(Boolean))].join(', ') || '—'}
              </Field>
            </dl>
            {trip.status === 'CANCELLED' && trip.cancel_reason && (
              <p className="mt-3 text-sm text-[var(--text-secondary)]">{t('trpCancelReasonShown', { reason: trip.cancel_reason })}</p>
            )}
          </div>

          {next && (
            <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-4 sm:flex-row sm:items-end">
              {next.timed && (
                <div className="flex flex-col gap-1">
                  <label className="nf-text-label text-[var(--text-secondary)]" htmlFor="trip-move-at">
                    {t('trpAt')}
                  </label>
                  <input id="trip-move-at" type="datetime-local" className="nf-input" value={at} onChange={(e) => setAt(e.target.value)} />
                  <span className="text-[11px] text-[var(--text-muted)]">{t('trpAtHint')}</span>
                </div>
              )}
              {next.to === 'CONFIRMED' && askHq && (
                <div className="flex flex-col gap-1">
                  <label className="nf-text-label text-[var(--text-secondary)]" htmlFor="trip-hq-ref">
                    {t('trpHqApprovalRef')}
                  </label>
                  <input
                    id="trip-hq-ref"
                    type="text"
                    className="nf-input"
                    maxLength={100}
                    value={hqRef}
                    onChange={(e) => setHqRef(e.target.value)}
                  />
                </div>
              )}
              <Button type="button" onClick={() => void move()} disabled={busy}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {t(next.labelKey)}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">{label}</dt>
      <dd className="m-0 text-[var(--text-primary)]">{children}</dd>
    </div>
  );
}

export default TripsScreen;
