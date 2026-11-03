'use client';

import { useCallback, useEffect, useState } from 'react';
import { HeartPulse, History } from 'lucide-react';
import { api } from '@/services/api-client';
import { EntryModal, Field, inputStyle } from './breeding-form-parts';
import { todayIso, type Issue, type Row } from './breeding-rules';
import { assessDraftIssues, consequenceOf, needsAttention, STATUS_COLOUR, STATUS_LABEL, type ConditionStatus, type ScaleOption } from './boar-condition-rules';

const unwrap = <T,>(res: any): T => (Array.isArray(res) ? res : (res?.data ?? res)) as T;
const S = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  raised: { backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
  primary: { color: 'var(--text-primary)' },
  accent: { color: 'var(--accent)' },
};
const feedText = (v: number | null | undefined) => (v == null ? '—' : `${v} kg`);

/**
 * Boar body condition (SOP 21; plan 2026-11-02-ai-station-semen-collection, Phase 6): every boar with his latest score, his feed
 * level and whether his next assessment is due, and the form that scores him. The scale, the schedule and whether the feed level may
 * be changed are the line's setup; nothing here is a fixed figure. The feed level is recorded and shown: the feed forecast does not
 * read it.
 */
export function BoarConditionPanel({ version = 0 }: { version?: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [lines, setLines] = useState<Row[]>([]);
  const [breedId, setBreedId] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assessing, setAssessing] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row | null>(null);

  useEffect(() => {
    api
      .get('/piggery/boar-selection/lines')
      .then((r) => setLines(unwrap<Row[]>(r) ?? []))
      .catch(() => setLines([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(unwrap<Row[]>(await api.get(`/piggery/boar-condition${breedId ? `?breed_id=${breedId}` : ''}`)) ?? []);
    } catch (e: any) {
      setRows([]);
      setError(e.message || 'Could not load the boars.');
    } finally {
      setLoading(false);
    }
  }, [breedId]);
  useEffect(() => {
    load();
  }, [load, version]);

  const shown = onlyAttention ? rows.filter((r) => needsAttention(r.status)) : rows;
  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold" style={S.sub}>
          Breeding line
          <select className="nf-input block mt-1 text-sm min-w-[12rem]" value={breedId} onChange={(e) => setBreedId(e.target.value)} aria-label="Breeding line">
            <option value="">All lines</option>
            {lines.map((l) => (
              <option key={l.breed_id} value={l.breed_id}>
                {l.breed_code} ({l.boars})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs flex items-center gap-2 pb-2 cursor-pointer" style={S.sub}>
          <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
          Only boars that need scoring
        </label>
        <div className="ml-auto flex flex-wrap gap-3 text-xs pb-2" style={S.sub}>
          {(['OVERDUE', 'DUE', 'NEVER', 'DUE_SOON'] as ConditionStatus[]).map((s) => (
            <span key={s}>
              <span className="font-bold" style={{ color: STATUS_COLOUR[s] }}>{count(s)}</span> {STATUS_LABEL[s].toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      {notice && (
        <p className="text-xs rounded-lg border p-2" style={{ ...S.raised, ...S.sub }}>
          {notice}
        </p>
      )}
      {error && (
        <p className="text-xs rounded-lg border p-2" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <div className="rounded-lg border overflow-x-auto" style={S.surface}>
        <table className="w-full text-xs">
          <thead>
            <tr style={S.raised} className="text-left">
              {['Boar', 'Line', 'Last assessed', 'Score', 'Feed level', 'Next assessment', 'Flags', ''].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap" style={S.sub}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center" style={S.muted}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && !shown.length && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center" style={S.muted}>
                  {rows.length ? 'No boar needs scoring.' : 'No live boars.'}
                </td>
              </tr>
            )}
            {!loading &&
              shown.map((r) => {
                const l = r.latest;
                return (
                  <tr key={r.boar_id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="font-mono font-bold" style={S.accent}>{r.boar}</span>
                      {r.rfid_tag && <span className="block" style={S.muted}>Tag: {r.rfid_tag}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={S.sub}>{r.breed_code ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap" style={S.sub}>{l?.assessed_on ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap" style={S.primary}>
                      {l ? (
                        <>
                          <span className="font-bold">{l.score}</span>
                          {l.score_name && <span className="block" style={S.muted}>{l.score_name}</span>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={S.primary}>
                      {feedText(r.feed_kg_per_day)}
                      {l?.override_reason && <span className="block" style={S.muted} title={l.override_reason}>changed from the scale</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="font-semibold" style={{ color: STATUS_COLOUR[r.status as ConditionStatus] }}>
                        {STATUS_LABEL[r.status as ConditionStatus] ?? r.status}
                      </span>
                      {r.due && <span className="block" style={S.muted}>{r.due}</span>}
                    </td>
                    <td className="px-3 py-2" style={S.sub}>
                      {l?.health_flag && <span className="block font-semibold" style={{ color: 'var(--warning)' }}>Health assessment</span>}
                      {l?.medication_review && <span className="block font-semibold" style={{ color: 'var(--warning)' }}>Medication review</span>}
                      {l?.required_action && <span className="block" style={S.muted}>{l.required_action}</span>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap space-x-3">
                      <button type="button" className="text-xs font-semibold cursor-pointer hover:underline" style={S.accent} onClick={() => setAssessing(r)}>
                        Score
                      </button>
                      <button type="button" className="text-xs cursor-pointer hover:underline" style={S.sub} onClick={() => setHistory(r)}>
                        History
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {assessing && (
        <AssessDialog
          boar={assessing}
          onClose={() => setAssessing(null)}
          onSaved={(text) => {
            setAssessing(null);
            setNotice(text);
            load();
          }}
        />
      )}
      {history && <HistoryDialog boar={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function AssessDialog({ boar, onClose, onSaved }: { boar: Row; onClose: () => void; onSaved: (text: string) => void }) {
  const [info, setInfo] = useState<Row | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const [feed, setFeed] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get(`/piggery/boar-condition/boars/${boar.boar_id}/scale`)
      .then((r) => setInfo(unwrap<Row>(r)))
      .catch((e) => setError(e.message || 'Could not load the scale.'));
  }, [boar.boar_id]);

  const scale: ScaleOption[] = info?.scale ?? [];
  const chosen = scale.find((s) => s.score === score);
  const found = info ? assessDraftIssues({ score, date, today: todayIso(), feed, reason }, scale, { allow_feed_override: !!info.allow_feed_override, override_reason_required: !!info.override_reason_required }) : [{ field: 'score', text: 'Loading the scale…' }];
  const issues: Issue[] = found.map((i) => ({ level: 'error', field: i.field, text: i.text }));
  const currentFeed: number | null = info?.latest?.feed_kg_per_day ?? null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (issues.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = unwrap<Row>(
        await api.post('/piggery/boar-condition', {
          boar_animal_id: boar.boar_id,
          score,
          assessed_on: date,
          ...(feed.trim() ? { feed_kg_per_day: Number(feed) } : {}),
          ...(reason.trim() ? { override_reason: reason.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      );
      onSaved(
        [
          `${boar.boar} scored ${res.score}${res.score_name ? ` (${res.score_name})` : ''}.`,
          res.feed_kg_per_day != null ? `Feed level ${res.feed_kg_per_day} kg a day.` : null,
          res.required_action,
          res.health_flag ? 'Health assessment flagged.' : null,
          res.next_due ? `Next assessment ${res.next_due}.` : null,
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch (err: any) {
      setError(err.message || 'Could not record the score.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <EntryModal title={`Score ${boar.boar}`} icon={<HeartPulse className="w-5 h-5" style={S.accent} />} onClose={onClose} onSubmit={submit} submitting={busy} submitLabel="Save score" savingLabel="Saving…" issues={issues}>
      {info && !scale.length ? (
        <p className="text-sm" style={S.sub}>No body condition scale is set up for this boar's line or for the company. Add one under Body Condition Scale first.</p>
      ) : (
        <>
          <Field label="Score" issues={issues} name="score" required hint={currentFeed != null ? `Current feed level: ${currentFeed} kg a day.` : undefined}>
            <div className="space-y-2" role="radiogroup" aria-label="Score">
              {scale.map((s) => (
                <label key={s.score} className="flex gap-3 rounded-lg border p-2 cursor-pointer" style={{ ...S.raised, ...(score === s.score ? { borderColor: 'var(--accent)' } : {}) }}>
                  <input type="radio" name="score" checked={score === s.score} onChange={() => setScore(s.score)} />
                  <span className="text-xs">
                    <span className="font-bold text-sm" style={S.primary}>{s.score}{s.score_name ? ` — ${s.score_name}` : ''}</span>
                    {s.indicators && <span className="block" style={S.sub}>{s.indicators}</span>}
                    <span className="block" style={S.muted}>{s.feed_kg_per_day != null ? `${s.feed_kg_per_day} kg a day` : 'Feed level unchanged'}{s.required_action ? ` · ${s.required_action}` : ''}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          {chosen && (
            <div className="rounded-lg border p-3 text-xs space-y-1" style={S.raised}>
              {consequenceOf(chosen, currentFeed).map((t) => (
                <p key={t} style={S.primary}>{t}</p>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assessed on" issues={issues} name="date" required>
              <input type="date" className="nf-input w-full text-sm" style={inputStyle(issues, 'date')} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {info?.allow_feed_override && (
              <Field label="Feed level other than the scale's (kg a day)" issues={issues} name="feed" hint="Leave blank to use the scale's.">
                <input type="number" min="0" step="0.01" className="nf-input w-full text-sm" style={inputStyle(issues, 'feed')} value={feed} onChange={(e) => setFeed(e.target.value)} />
              </Field>
            )}
          </div>
          {info?.allow_feed_override && feed.trim() && (
            <Field label="Why the feed level is changed" issues={issues} name="reason" required={!!info.override_reason_required}>
              <input type="text" maxLength={200} className="nf-input w-full text-sm" style={inputStyle(issues, 'reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          <Field label="Notes" issues={issues} name="notes">
            <input type="text" maxLength={500} className="nf-input w-full text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </>
      )}
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </EntryModal>
  );
}

function HistoryDialog({ boar, onClose }: { boar: Row; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    api
      .get(`/piggery/boar-condition/boars/${boar.boar_id}/history`)
      .then((r) => setRows(unwrap<Row[]>(r) ?? []))
      .catch(() => setRows([]));
  }, [boar.boar_id]);
  return (
    <EntryModal title={`Body condition — ${boar.boar}`} icon={<History className="w-5 h-5" style={S.accent} />} onClose={onClose} onSubmit={(e) => { e.preventDefault(); onClose(); }} submitting={false} submitLabel="Close" savingLabel="" issues={[]}>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left" style={S.sub}>
            {['Date', 'Score', 'Feed before → set', 'Action', 'Notes'].map((h) => (
              <th key={h} className="py-1 pr-3 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows === null && <tr><td colSpan={5} style={S.muted}>Loading…</td></tr>}
          {rows?.length === 0 && <tr><td colSpan={5} style={S.muted}>He has not been scored yet.</td></tr>}
          {rows?.map((h) => (
            <tr key={h.record_id} className="border-t" style={{ borderColor: 'var(--border)' }}>
              <td className="py-1 pr-3 whitespace-nowrap" style={S.primary}>{h.assessed_on}</td>
              <td className="py-1 pr-3 whitespace-nowrap" style={S.primary}>{h.score}{h.score_name ? ` — ${h.score_name}` : ''}</td>
              <td className="py-1 pr-3 whitespace-nowrap" style={S.sub}>{h.previous_feed_kg_per_day != null ? `${h.previous_feed_kg_per_day} → ` : ''}{feedText(h.feed_kg_per_day)}{h.override_reason ? ` (${h.override_reason})` : ''}</td>
              <td className="py-1 pr-3" style={S.sub}>{[h.health_flag && 'Health assessment', h.medication_review && 'Medication review', h.required_action].filter(Boolean).join(' · ') || '—'}</td>
              <td className="py-1" style={S.muted}>{h.notes ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </EntryModal>
  );
}
