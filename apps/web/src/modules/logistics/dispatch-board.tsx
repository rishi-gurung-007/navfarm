'use client';

import { useCallback, useEffect, useState } from 'react';
import { Inbox, Loader2 } from 'lucide-react';
import { api } from '@/services/api-client';
import { useLanguage } from '@/hooks/useLanguage';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { StatusBadge } from '@/components/ui/status-badge';
import type { TranslationKeys } from '@/utils/translations';
import {
  errorText,
  formatMoney,
  formatTripTime,
  unwrap,
  type Row,
} from './trip-shared';

/** The columns of the board, left to right: the order a trip moves through them. */
const COLUMNS: Array<{
  key: 'PLANNED' | 'CONFIRMED' | 'IN_TRANSIT' | 'ARRIVED';
  labelKey: TranslationKeys;
}> = [
  { key: 'PLANNED', labelKey: 'dspPlanned' },
  { key: 'CONFIRMED', labelKey: 'dspConfirmed' },
  { key: 'IN_TRANSIT', labelKey: 'dspInTransit' },
  { key: 'ARRIVED', labelKey: 'dspArrived' },
];

const DAY_OPTIONS = [
  { value: '3', label: '3' },
  { value: '7', label: '7' },
  { value: '14', label: '14' },
  { value: '31', label: '31' },
];

/**
 * Logistics Dispatch Board (Phase 3): the trips still to run or running, in a column per status, and the Transfer
 * Orders that have no trip yet. Read-only — a trip is opened from Trips, a TO from Inventory. The API applies the
 * caller's farm scope, so the board shows only what the user may see.
 */
export function DispatchBoard() {
  const { t } = useLanguage();
  const [days, setDays] = useState('7');
  const [board, setBoard] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setBoard(
        unwrap<Row>(await api.get(`/logistics/trip/dispatch?days=${days}`)),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting: Row[] = board?.waiting ?? [];

  return (
    <div className="flex flex-col gap-4" data-testid="dispatch-board">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-40">
          <SearchableSelect
            ariaLabel={t('dspNextDays')}
            value={days}
            onChange={setDays}
            options={DAY_OPTIONS.map((o) => ({
              value: o.value,
              label: t('dspDays', { n: o.label }),
            }))}
            valueKey="value"
            labelKey="label"
            columnHeaders={false}
            placeholder={t('dspNextDays')}
            triggerClassName="nf-input nf-select"
          />
        </div>
        {loading && (
          <Loader2
            className="h-4 w-4 animate-spin text-[var(--text-secondary)]"
            aria-label={t('trpLoading')}
          />
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((c) => {
          const trips: Row[] = board?.columns?.[c.key] ?? [];
          return (
            <section
              key={c.key}
              aria-label={t(c.labelKey)}
              className="flex flex-col rounded-md border border-[var(--border)] bg-[var(--surface)]"
            >
              <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
                <h3 className="text-xs font-bold uppercase tracking-wide">
                  {t(c.labelKey)}
                </h3>
                <span className="text-xs text-[var(--text-secondary)]">
                  {trips.length}
                </span>
              </header>
              <div className="flex flex-col gap-2 p-2">
                {trips.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-[var(--text-muted)]">
                    {t('dspNoTrips')}
                  </p>
                ) : (
                  trips.map((trip) => (
                    <a
                      key={trip.trip_id}
                      href="/logistics/trips"
                      className="rounded-md border border-[var(--border)] p-2 text-xs hover:bg-[var(--surface-raised)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[var(--accent)]">
                          {trip.trip_no}
                        </span>
                        <StatusBadge status={trip.status} />
                      </div>
                      <div className="mt-1 text-[var(--text-secondary)]">
                        {trip.route_code ?? '—'} ·{' '}
                        {trip.vehicle_no ?? t('dspNoVehicle')} ·{' '}
                        {trip.driver_name ?? t('dspNoDriver')}
                      </div>
                      <div className="mt-1">
                        {formatTripTime(trip.planned_departure)}
                      </div>
                      <div className="mt-1 text-[var(--text-secondary)]">
                        {formatMoney(trip.estimated_cost) ?? t('trpNoEstimate')}
                      </div>
                    </a>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section
        aria-label={t('dspWaiting')}
        className="rounded-md border border-[var(--border)] bg-[var(--surface)]"
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
          <h3 className="text-xs font-bold uppercase tracking-wide">
            {t('dspWaiting')}
          </h3>
          <span className="text-xs text-[var(--text-secondary)]">
            {waiting.length}
          </span>
        </header>
        {waiting.length === 0 ? (
          <p className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--text-muted)]">
            <Inbox className="h-4 w-4" /> {t('dspNothingWaiting')}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {waiting.map((w) => (
              <li
                key={`${w.kind}-${w.id}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs"
              >
                <a
                  href={`/inventory/transfers?id=${encodeURIComponent(w.id)}`}
                  className="font-semibold text-[var(--accent)]"
                >
                  {w.document_no}
                </a>
                <span className="text-[var(--text-secondary)]">
                  {w.from_name ?? '—'} → {w.to_name ?? '—'}
                </span>
                <span>{String(w.posting_date ?? '').slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
