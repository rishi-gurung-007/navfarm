'use client';

import { DateInput } from '@/components/ui/date-input';
import { formatDate } from '@/utils/date-short';
import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, FlaskConical, Loader2 } from 'lucide-react';
import { api } from '@/services/api-client';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { EntryModal, Field, inputStyle } from './breeding-form-parts';
import { collectorLabel, type Issue, type Row } from './breeding-rules';
import { planDraftIssues } from './boar-selection-rules';

const unwrap = <T,>(res: any): T => (Array.isArray(res) ? res : (res?.data ?? res)) as T;
const S = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  raised: { backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
  primary: { color: 'var(--text-primary)' },
  accent: { color: 'var(--accent)' },
};
const STATUS_STYLE: Record<string, { color: string }> = {
  PLANNED: { color: 'var(--accent)' },
  COLLECTED: { color: 'var(--success)' },
  SKIPPED: { color: 'var(--text-muted)' },
  CANCELLED: { color: 'var(--text-muted)' },
};

/** The dialog that plans a collection for the boars ticked in the selection table, against the line's own rules. */
export function PlanDialog({
  breedId,
  lineName,
  boars,
  rules,
  onClose,
  onSaved,
}: {
  breedId: string;
  lineName: string;
  /** The boars ticked: { boar_id, boar } as the table rows hold them. */
  boars: Row[];
  /** The line's plan rules from the selection response (weekdays, boars a day, reference, destination farms). */
  rules: Row | null;
  onClose: () => void;
  onSaved: (warnings: string[]) => void;
}) {
  const [date, setDate] = useState<string>(rules?.next_collection_date ?? new Date().toISOString().slice(0, 10));
  const [collectors, setCollectors] = useState<Row[]>([]);
  const [collectorOf, setCollectorOf] = useState<Record<string, string>>({});
  const [requestedBy, setRequestedBy] = useState('');
  const [reference, setReference] = useState('');
  const [farms, setFarms] = useState<Row[]>(rules?.destination_farms ?? []);
  const [destination, setDestination] = useState<string>(rules?.destination_farms?.length === 1 ? rules.destination_farms[0].location_id : '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/piggery/breeding/semen-collectors')
      .then((r) => setCollectors(unwrap<Row[]>(r) ?? []))
      .catch(() => setCollectors([]));
    // A line that may send its semen anywhere is not restricted to a list: every farm is offered.
    if (!farms.length) {
      api
        .get('/location?locationType=FARM&rootOnly=true&isActive=true&limit=200')
        .then((r) => setFarms(unwrap<Row[]>(r) ?? []))
        .catch(() => setFarms([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const found = planDraftIssues({ date, boarCount: boars.length, reference, destination }, rules);
  const issues: Issue[] = found.map((i) => ({ level: 'error', field: i.field, text: i.text }));
  const days = (rules?.collection_weekdays ?? []) as string[];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (issues.length) return;
    setBusy(true);
    setError(null);
    try {
      const res: any = await api.post('/piggery/collection-plans', {
        breed_id: breedId,
        collection_date: date,
        boars: boars.map((b) => ({ boar_animal_id: b.boar_id, ...(collectorOf[b.boar_id] ? { collector_id: collectorOf[b.boar_id] } : {}) })),
        ...(requestedBy.trim() ? { requested_by: requestedBy.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(destination ? { destination_farm_id: destination } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onSaved(unwrap<Row>(res)?.warnings ?? []);
    } catch (err: any) {
      setError(err.message || 'Could not plan the collection.');
    } finally {
      setBusy(false);
    }
  };

  const referenceLabel = rules?.reference_label?.trim() || 'Reference';
  return (
    <EntryModal title={`Plan a collection — ${lineName}`} icon={<CalendarDays className="w-5 h-5" style={S.accent} />} onClose={onClose} onSubmit={submit} submitting={busy} submitLabel="Save plan" savingLabel="Saving…" issues={issues}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Collection date" issues={issues} name="date" required hint={rules?.collection_mode === 'SCHEDULED' && days.length ? `This line is tapped on ${days.join(', ')}.` : rules?.collection_mode === 'ON_REQUEST' ? 'This line is collected on request.' : undefined}>
          <DateInput className="nf-input w-full text-sm" style={inputStyle(issues, 'date')} value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Requested by" issues={issues} name="requested_by" hint="Who asked for it (for example the Multiplier Unit).">
          <input type="text" maxLength={100} className="nf-input w-full text-sm" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
        </Field>
        {(rules?.reference_required || reference) && (
          <Field label={referenceLabel} issues={issues} name="reference" required={!!rules?.reference_required}>
            <input type="text" maxLength={100} className="nf-input w-full text-sm" style={inputStyle(issues, 'reference')} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}
        <Field label="Destination farm" issues={issues} name="destination" required={!!rules?.destination_rule && rules.destination_rule !== 'ANY'}>
          <select className="nf-input w-full text-sm" style={inputStyle(issues, 'destination')} value={destination} onChange={(e) => setDestination(e.target.value)}>
            <option value="">{rules?.destination_rule && rules.destination_rule !== 'ANY' ? 'Choose the farm' : 'Not set'}</option>
            {farms.map((f) => (
              <option key={f.location_id} value={f.location_id}>
                {f.location_code} — {f.location_name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!rules?.reference_required && !reference && (
        <button type="button" className="text-xs font-semibold cursor-pointer hover:underline" style={S.accent} onClick={() => setReference(' ')}>
          Add an outside reference
        </button>
      )}

      <div className="rounded-lg border p-3 space-y-2" style={S.raised}>
        <p className="text-xs font-semibold" style={S.sub}>
          Boars ({boars.length}){rules?.boars_per_collection_day ? ` — this line taps ${rules.boars_per_collection_day} a day` : ''}
        </p>
        {boars.map((b) => (
          <div key={b.boar_id} className="flex items-center justify-between gap-3">
            <span className="text-sm font-mono font-bold" style={S.accent}>
              {b.boar}
            </span>
            <select className="nf-input text-sm min-w-[12rem]" aria-label={`Collector for ${b.boar}`} value={collectorOf[b.boar_id] ?? ''} onChange={(e) => setCollectorOf({ ...collectorOf, [b.boar_id]: e.target.value })}>
              <option value="">Collector not set</option>
              {collectors.map((c) => (
                <option key={c.collector_id} value={c.collector_id}>
                  {collectorLabel(c)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <Field label="Notes" issues={issues} name="notes">
        <input type="text" maxLength={500} className="nf-input w-full text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </EntryModal>
  );
}

/** A reason is asked for before a plan is cancelled or a boar is skipped. */
function ReasonDialog({ title, onClose, onConfirm }: { title: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const issues: Issue[] = reason.trim() ? [] : [{ level: 'error', field: 'reason', text: 'Say why.' }];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (issues.length) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err: any) {
      setError(err.message || 'Could not save.');
      setBusy(false);
    }
  };
  return (
    <EntryModal title={title} icon={<CalendarDays className="w-5 h-5" style={S.accent} />} onClose={onClose} onSubmit={submit} submitting={busy} submitLabel="Confirm" savingLabel="Saving…" issues={issues}>
      <Field label="Reason" issues={issues} name="reason" required>
        <input type="text" maxLength={200} className="nf-input w-full text-sm" style={inputStyle(issues, 'reason')} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </EntryModal>
  );
}

const PLAN_BADGE: Record<string, { status: string; label: string }> = {
  PLANNED: { status: 'PENDING', label: 'Planned' },
  COLLECTED: { status: 'COMPLETED', label: 'Collected' },
  CANCELLED: { status: 'CANCELLED', label: 'Cancelled' },
};
const BOAR_LABEL: Record<string, string> = { PLANNED: 'Planned', COLLECTED: 'Collected', SKIPPED: 'Skipped' };

/** The planned collections as a table, with what to do next on each: record the collection, cancel the plan, or skip a boar. */
export function CollectionPlans({
  plans,
  rulesFor,
  onCollect,
  onChanged,
}: {
  plans: Row[];
  /** What the plan's own line asks for: the name of its reference, and whether its lots are pooled. */
  rulesFor: (plan: Row) => { referenceLabel: string | null; poolingAllowed: boolean };
  /** Start recording a collection of these boars against the plan. */
  onCollect: (plan: Row, boarIds: string[], batchId: string | null) => void;
  onChanged: () => void;
}) {
  const [reasonFor, setReasonFor] = useState<{ title: string; run: (reason: string) => Promise<void> } | null>(null);
  const head = 'whitespace-nowrap px-3 py-2.5 font-semibold';
  const cell = 'px-3 py-3 align-top';

  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border" style={S.surface}>
      <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider" style={{ ...S.muted, backgroundColor: 'var(--surface-raised)' }}>
          <tr>
            <th className={head}>Plan</th>
            <th className={head}>Line</th>
            <th className={head}>Collection day</th>
            <th className={head}>Status</th>
            <th className={head}>Boars</th>
            <th className={`${head} text-right`}>Collected</th>
            <th className={`${head} text-right`}>Target doses</th>
            <th className={head}>Requested by / for</th>
            <th className={`${head} text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {plans.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-10 text-center text-sm" style={S.sub}>
                <CalendarDays className="mx-auto mb-2 h-6 w-6" style={S.muted} />
                No planned collections. Plan one from Boar Selection or from the farms' Requests.
              </td>
            </tr>
          ) : plans.map((p) => {
            const { referenceLabel, poolingAllowed } = rulesFor(p);
            const open = p.status === 'PLANNED';
            const lines: Row[] = p.lines ?? [];
            const pending = lines.filter((l) => l.status === 'PLANNED');
            const collected = lines.filter((l) => l.status === 'COLLECTED').length;
            // A line that is never pooled is collected one boar at a time; a pooled one in one lot, from boars that share a batch.
            const firstBatch = pending[0]?.batch_id ?? null;
            const toCollect = (poolingAllowed ? pending.filter((l) => l.batch_id === firstBatch) : pending.slice(0, 1)).map((l) => l.boar_id);
            const badge = PLAN_BADGE[p.status] ?? { status: p.status, label: p.status };
            const details = [
              p.requested_by && `By ${p.requested_by}`,
              p.destination_farm_code && `For ${p.destination_farm_code}${p.destination_farm_name ? ` · ${p.destination_farm_name}` : ''}`,
              p.reference && `${referenceLabel ?? 'Reference'}: ${p.reference}`,
            ].filter(Boolean) as string[];
            return (
              <tr key={p.plan_id} className="border-t transition-colors hover:bg-[var(--surface-raised)]" style={{ borderColor: 'var(--border)', ...S.primary }}>
                <td className={`${cell} whitespace-nowrap font-mono font-bold`} style={S.accent}>{p.plan_no}</td>
                <td className={`${cell} whitespace-nowrap`}>{p.breed_code ?? '—'}</td>
                <td className={`${cell} whitespace-nowrap`}>
                  {formatDate(p.collection_date)}
                  <div className="text-[11px]" style={S.muted}>{p.weekday} · week {p.week_no}</div>
                </td>
                <td className={`${cell} whitespace-nowrap`}>
                  <StatusBadge status={badge.status} label={badge.label} />
                  {p.cancel_reason && <div className="mt-1 max-w-[12rem] truncate text-[11px]" style={S.muted} title={p.cancel_reason}>{p.cancel_reason}</div>}
                </td>
                <td className={cell}>
                  <div className="flex flex-col gap-1">
                    {lines.map((l) => (
                      <div key={l.boar_id} className="flex min-w-[15rem] items-center gap-2 whitespace-nowrap text-xs" title={l.skip_reason ?? undefined}>
                        <span className="font-mono font-semibold">{l.boar_code}</span>
                        {l.collector_code && <span style={S.muted}>{l.collector_code}</span>}
                        <span className="text-[10px] font-semibold uppercase" style={STATUS_STYLE[l.status] ?? S.muted}>{BOAR_LABEL[l.status] ?? l.status}</span>
                        {open && l.status === 'PLANNED' && (
                          <button type="button" className="cursor-pointer text-[11px] hover:underline" style={S.accent}
                            onClick={() => setReasonFor({ title: `Skip ${l.boar_code}`, run: async (reason) => { await api.post(`/piggery/collection-plans/${p.plan_id}/boars/${l.boar_id}/skip`, { reason }); setReasonFor(null); onChanged(); } })}>
                            Skip
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </td>
                <td className={`${cell} whitespace-nowrap text-right font-mono`}>{collected} / {lines.length}</td>
                <td className={`${cell} whitespace-nowrap text-right font-mono`}>{p.target_doses != null ? Number(p.target_doses) : '—'}</td>
                <td className={`${cell} min-w-[16rem] text-xs`} style={details.length ? S.sub : S.muted}>
                  {details.length ? details.map((d) => <div key={d}>{d}</div>) : '—'}
                </td>
                <td className={`${cell} whitespace-nowrap text-right`}>
                  {open ? (
                    <div className="flex justify-end gap-2">
                      {pending.length > 0 && (
                        <Button size="sm" variant="outline" onClick={() => onCollect(p, toCollect, firstBatch)}>
                          <FlaskConical className="mr-1 h-3.5 w-3.5" /> Record
                        </Button>
                      )}
                      {!lines.some((l) => l.status === 'COLLECTED') && (
                        <Button size="sm" variant="ghost"
                          onClick={() => setReasonFor({ title: `Cancel ${p.plan_no}`, run: async (reason) => { await api.post(`/piggery/collection-plans/${p.plan_id}/cancel`, { reason }); setReasonFor(null); onChanged(); } })}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span style={S.muted}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {reasonFor && <ReasonDialog title={reasonFor.title} onClose={() => setReasonFor(null)} onConfirm={reasonFor.run} />}
    </div>
  );
}

/**
 * AI Station › Planned Collections: every collection plan in one table, by line and status. Plans are made from Boar Selection (the boars
 * ticked there) or from the farms' Requests; here they are followed through: record, skip a boar, cancel.
 */
export function CollectionPlansPanel({
  version,
  onCollect,
  onChanged,
}: {
  /** Changes when a collection was recorded elsewhere, so the plans are read again. */
  version?: number;
  onCollect: (plan: Row, boarIds: string[], batchId: string | null) => void;
  onChanged?: () => void;
}) {
  const [lines, setLines] = useState<Row[]>([]);
  const [rules, setRules] = useState<Record<string, Row>>({});
  const [plans, setPlans] = useState<Row[] | null>(null);
  const [breedId, setBreedId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/piggery/boar-selection/lines')
      .then(async (res) => {
        const ls = unwrap<Row[]>(res) ?? [];
        setLines(ls);
        // Each line's own plan rules: the name of its reference, and whether its lots are pooled.
        const today = new Date().toISOString().slice(0, 10);
        const loaded = await Promise.all(
          ls.map(async (l) => [l.breed_id, unwrap<Row>(await api.get(`/piggery/boar-selection?breed_id=${l.breed_id}&as_of=${today}`).catch(() => null))?.plan_rules ?? {}] as const),
        );
        setRules(Object.fromEntries(loaded));
      })
      .catch((e) => setError(e?.message || 'Could not load the breeding lines.'));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPlans(unwrap<Row[]>(await api.get(`/piggery/collection-plans${breedId ? `?breed_id=${breedId}` : ''}`)) ?? []);
    } catch (e: any) {
      setPlans([]);
      setError(e?.message || 'Could not load the planned collections.');
    }
  }, [breedId]);
  useEffect(() => { void load(); }, [load, version]);

  const shown = (plans ?? []).filter((p) => !status || p.status === status);
  const count = (s: string) => (plans ?? []).filter((p) => p.status === s).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="nf-input-sm h-9" value={breedId} onChange={(e) => setBreedId(e.target.value)} aria-label="Breeding line">
          <option value="">All lines</option>
          {lines.map((l) => <option key={l.breed_id} value={l.breed_id}>{l.breed_code || l.breed_name}</option>)}
        </select>
        <div className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border p-1" style={S.surface} role="tablist" aria-label="Status">
          {[['', `All (${plans?.length ?? 0})`], ['PLANNED', `Planned (${count('PLANNED')})`], ['COLLECTED', `Collected (${count('COLLECTED')})`], ['CANCELLED', `Cancelled (${count('CANCELLED')})`]].map(([v, label]) => (
            <button key={v || 'all'} type="button" role="tab" aria-selected={status === v} onClick={() => setStatus(v)}
              className="h-8 cursor-pointer rounded-[var(--radius-sm)] px-3 text-xs font-semibold"
              style={status === v ? { backgroundColor: 'var(--accent)', color: '#fff' } : S.sub}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="rounded border p-3 text-sm" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</p>}
      {plans === null ? (
        <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" style={S.muted} /></div>
      ) : (
        <CollectionPlans
          plans={shown}
          rulesFor={(p) => ({ referenceLabel: rules[p.breed_id]?.reference_label ?? null, poolingAllowed: rules[p.breed_id]?.pooling_allowed ?? true })}
          onCollect={onCollect}
          onChanged={() => {
            void load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
