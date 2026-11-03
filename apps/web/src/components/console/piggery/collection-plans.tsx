'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, FlaskConical } from 'lucide-react';
import { api } from '@/services/api-client';
import { Button } from '@/components/ui/button';
import { EntryModal, Field, inputStyle } from './breeding-form-parts';
import { type Issue, type Row } from './breeding-rules';
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
      .get('/semen-collector?isActive=true&limit=200')
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
          <input type="date" className="nf-input w-full text-sm" style={inputStyle(issues, 'date')} value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
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
                  {c.collector_code} — {c.collector_name}
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

/** The planned collections of a line, with what to do next on each. */
export function CollectionPlans({
  plans,
  referenceLabel,
  poolingAllowed,
  onCollect,
  onChanged,
}: {
  plans: Row[];
  referenceLabel: string | null;
  poolingAllowed: boolean;
  /** Start recording a collection of these boars against the plan. */
  onCollect: (plan: Row, boarIds: string[], batchId: string | null) => void;
  onChanged: () => void;
}) {
  const [reasonFor, setReasonFor] = useState<{ title: string; run: (reason: string) => Promise<void> } | null>(null);
  if (!plans.length) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-bold flex items-center gap-2" style={S.primary}>
        <CalendarDays className="w-4 h-4" style={S.accent} /> Planned collections
      </h4>
      {plans.map((p) => {
        const open = p.status === 'PLANNED';
        const pending: Row[] = p.lines.filter((l: Row) => l.status === 'PLANNED');
        // A line that is never pooled is collected one boar at a time; a pooled one in one lot, from boars that share a batch.
        const firstBatch = pending[0]?.batch_id ?? null;
        const toCollect = (poolingAllowed ? pending.filter((l) => l.batch_id === firstBatch) : pending.slice(0, 1)).map((l) => l.boar_id);
        return (
          <div key={p.plan_id} className="rounded-lg border p-3 space-y-2" style={S.surface}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold font-mono" style={S.accent}>{p.plan_no}</span>
                <span className="text-sm" style={S.primary}>{p.weekday} {String(p.collection_date).slice(0, 10)}</span>
                <span className="text-[11px] font-semibold uppercase" style={STATUS_STYLE[p.status] ?? S.muted}>{p.status}</span>
              </div>
              {open && (
                <div className="flex gap-2">
                  {pending.length > 0 && (
                    <Button variant="secondary" onClick={() => onCollect(p, toCollect, firstBatch)}>
                      <FlaskConical className="w-4 h-4 mr-1" /> Record collection
                    </Button>
                  )}
                  {!p.lines.some((l: Row) => l.status === 'COLLECTED') && (
                    <Button variant="secondary" onClick={() => setReasonFor({ title: `Cancel ${p.plan_no}`, run: async (reason) => { await api.post(`/piggery/collection-plans/${p.plan_id}/cancel`, { reason }); setReasonFor(null); onChanged(); } })}>
                      Cancel plan
                    </Button>
                  )}
                </div>
              )}
            </div>
            <p className="text-[11px]" style={S.muted}>
              {[p.requested_by && `Requested by ${p.requested_by}`, p.reference && `${referenceLabel ?? 'Reference'}: ${p.reference}`, p.destination_farm_code && `For ${p.destination_farm_code}${p.destination_farm_name ? ` — ${p.destination_farm_name}` : ''}`, p.cancel_reason && `Cancelled: ${p.cancel_reason}`].filter(Boolean).join(' · ') || 'No request details.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {p.lines.map((l: Row) => (
                <span key={l.boar_id} className="text-xs rounded-md border px-2 py-1 flex items-center gap-2" style={S.raised} title={l.skip_reason ?? undefined}>
                  <span className="font-mono font-bold" style={S.primary}>{l.boar_code}</span>
                  {l.collector_code && <span style={S.muted}>{l.collector_code}</span>}
                  <span className="text-[10px] font-semibold uppercase" style={STATUS_STYLE[l.status] ?? S.muted}>{l.status}</span>
                  {open && l.status === 'PLANNED' && (
                    <button type="button" className="text-[11px] cursor-pointer hover:underline" style={S.accent} onClick={() => setReasonFor({ title: `Skip ${l.boar_code}`, run: async (reason) => { await api.post(`/piggery/collection-plans/${p.plan_id}/boars/${l.boar_id}/skip`, { reason }); setReasonFor(null); onChanged(); } })}>
                      Skip
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      {reasonFor && <ReasonDialog title={reasonFor.title} onClose={() => setReasonFor(null)} onConfirm={reasonFor.run} />}
    </div>
  );
}
