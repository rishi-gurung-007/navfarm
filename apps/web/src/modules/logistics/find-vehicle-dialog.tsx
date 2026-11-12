'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/services/api-client';
import { useLanguage } from '@/hooks/useLanguage';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { errorText, unwrap, type Row } from './trip-shared';

type Excluded = { reasons: string[] } & Row;
type FindVehicleResult = {
  eligible: Row[];
  excluded: Excluded[];
  drivers: { eligible: Row[]; excluded: Excluded[] };
};

const capacityOf = (v: Row): string | null => {
  if (v.vehicle_type === 'LIVESTOCK' && v.capacity_head) return `${v.capacity_head} head`;
  if (v.vehicle_type === 'BAGGED_FEED' && v.capacity_bags) return `${v.capacity_bags} bags`;
  if (v.vehicle_type === 'BULK_FEED' && v.capacity_kg) return `${Number(v.capacity_kg).toLocaleString('en-US')} kg`;
  return null;
};
const typeText = (v: Row) => String(v.vehicle_type ?? '').toLowerCase().replace(/_/g, ' ');

/**
 * Find Vehicle (Logistics Phase 2): the trucks and drivers that can take the trip, to pick one of each, and the ones
 * that cannot, each with the server's reasons in its own words. A refusal from assign (capacity over the limit, a
 * clash found since the list was read) is shown here and the dialog stays open.
 */
export function FindVehicleDialog({
  open,
  tripId,
  tripNo,
  onClose,
  onAssigned,
}: {
  open: boolean;
  tripId: string;
  tripNo: string;
  onClose: () => void;
  onAssigned: (trip: Row) => void;
}) {
  const { t } = useLanguage();
  const [result, setResult] = useState<FindVehicleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setResult(null);
    setError('');
    setVehicleId('');
    setDriverId('');
    setLoading(true);
    api
      .get(`/logistics/trip/${tripId}/find-vehicle`)
      .then((res) => live && setResult(unwrap<FindVehicleResult>(res)))
      .catch((err) => live && setError(errorText(err)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open, tripId]);

  const assign = async () => {
    if (!vehicleId || !driverId) {
      setError(t('trpChooseVehicleDriver'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const trip = unwrap<Row>(await api.put(`/logistics/trip/${tripId}/assign`, { vehicle_id: vehicleId, driver_id: driverId }));
      onAssigned(trip);
      onClose();
    } catch (err) {
      // Shown verbatim; the planner picks another truck or driver without reopening.
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const vehicles = result?.eligible ?? [];
  const drivers = result?.drivers?.eligible ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${t('trpFindVehicle')} — ${tripNo}`}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('trpClose')}
          </Button>
          <Button type="button" onClick={() => void assign()} disabled={saving || loading}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t('trpAssign')}
          </Button>
        </>
      }
    >
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-[var(--radius-sm)] border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)', backgroundColor: 'var(--danger-muted)' }}
        >
          {error}
        </div>
      )}
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('trpLoading')}
        </p>
      ) : (
        result && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section>
              <h3 className="nf-text-label mb-2 text-[var(--text-secondary)]">{t('trpEligibleTrucks')}</h3>
              {vehicles.length ? (
                <ul className="flex flex-col gap-1.5">
                  {vehicles.map((v) => (
                    <li key={v.vehicle_id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2 text-sm">
                        <input
                          type="radio"
                          name="trip-vehicle"
                          value={v.vehicle_id}
                          checked={vehicleId === v.vehicle_id}
                          onChange={() => setVehicleId(v.vehicle_id)}
                        />
                        <span className="font-medium text-[var(--text-primary)]">{v.registration_no}</span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {[typeText(v), capacityOf(v)].filter(Boolean).join(' · ')}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">{t('trpNoneEligible')}</p>
              )}

              <h3 className="nf-text-label mb-2 mt-4 text-[var(--text-secondary)]">{t('trpExcludedTrucks')}</h3>
              <ExcludedList rows={result.excluded} nameOf={(r) => r.vehicle?.registration_no} empty={t('trpNoneEligible')} />
            </section>

            <section>
              <h3 className="nf-text-label mb-2 text-[var(--text-secondary)]">{t('trpEligibleDrivers')}</h3>
              {drivers.length ? (
                <ul className="flex flex-col gap-1.5">
                  {drivers.map((d) => (
                    <li key={d.driver_id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2 text-sm">
                        <input
                          type="radio"
                          name="trip-driver"
                          value={d.driver_id}
                          checked={driverId === d.driver_id}
                          onChange={() => setDriverId(d.driver_id)}
                        />
                        <span className="font-medium text-[var(--text-primary)]">{d.driver_name}</span>
                        {d.licence_class && <span className="text-xs text-[var(--text-muted)]">{d.licence_class}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">{t('trpNoneEligible')}</p>
              )}

              <h3 className="nf-text-label mb-2 mt-4 text-[var(--text-secondary)]">{t('trpExcludedDrivers')}</h3>
              <ExcludedList rows={result.drivers?.excluded ?? []} nameOf={(r) => r.driver?.driver_name} empty={t('trpNoneEligible')} />
            </section>
          </div>
        )
      )}
    </Dialog>
  );
}

function ExcludedList({ rows, nameOf, empty }: { rows: Excluded[]; nameOf: (r: Excluded) => string; empty: string }) {
  if (!rows.length) return <p className="text-sm text-[var(--text-muted)]">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <li
          key={`${nameOf(r)}-${i}`}
          className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-3 py-2 text-sm"
        >
          <span className="font-medium text-[var(--text-secondary)]">{nameOf(r)}</span>
          <ul className="mt-1 list-disc pl-5 text-xs text-[var(--text-muted)]">
            {r.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export default FindVehicleDialog;
