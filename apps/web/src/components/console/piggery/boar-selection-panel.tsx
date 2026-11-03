'use client';

import { useCallback, useEffect, useState } from 'react';
import { Upload, Trophy, CalendarDays } from 'lucide-react';
import { api } from '@/services/api-client';
import { Button } from '@/components/ui/button';
import { EntryModal, Field, inputStyle } from './breeding-form-parts';
import { todayIso, type Issue, type Row } from './breeding-rules';
import { cellText, parseTsiPaste } from './boar-selection-rules';
import { CollectionPlans, PlanDialog } from './collection-plans';

const unwrap = <T,>(res: any): T => (Array.isArray(res) ? res : (res?.data ?? res)) as T;
const S = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  raised: { backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
  primary: { color: 'var(--text-primary)' },
  accent: { color: 'var(--accent)' },
};

/**
 * The AI technician's view when choosing boars to collect (plan 2026-11-02-ai-station-semen-collection, Phase 3): pick a breeding
 * line, then see that line's boars with the columns, ranks and overall grading its setup configures. Nothing here is fixed: the
 * columns, the genetic levels and the grading come from the line's setup, and the figures from each boar's own collections.
 */
export function BoarSelectionPanel({
  version = 0,
  onCollect,
}: {
  /** Changes when a collection was recorded, so the table and the plans are read again. */
  version?: number;
  /** Start recording a collection of these boars against a plan. */
  onCollect?: (plan: Row, boarIds: string[], batchId: string | null) => void;
}) {
  const [lines, setLines] = useState<Row[]>([]);
  const [breedId, setBreedId] = useState('');
  const [asOf, setAsOf] = useState(todayIso());
  const [data, setData] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tsiBoar, setTsiBoar] = useState<Row | null>(null);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [planning, setPlanning] = useState(false);
  const [plans, setPlans] = useState<Row[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/piggery/boar-selection/lines')
      .then((res) => {
        const found = unwrap<Row[]>(res) ?? [];
        setLines(found);
        setBreedId((current) => current || found[0]?.breed_id || '');
      })
      .catch((e) => setError(e.message || 'Could not load the breeding lines.'));
  }, []);

  const load = useCallback(async () => {
    if (!breedId) return setData(null);
    setLoading(true);
    setError(null);
    try {
      setData(unwrap<Row>(await api.get(`/piggery/boar-selection?breed_id=${breedId}&as_of=${asOf}`)));
    } catch (e: any) {
      setData(null);
      setError(e.message || 'Could not load the boars.');
    } finally {
      setLoading(false);
    }
  }, [breedId, asOf]);
  const loadPlans = useCallback(async () => {
    if (!breedId) return setPlans([]);
    try {
      setPlans(unwrap<Row[]>(await api.get(`/piggery/collection-plans?breed_id=${breedId}`)) ?? []);
    } catch {
      setPlans([]);
    }
  }, [breedId]);
  useEffect(() => {
    load();
    loadPlans();
    setSelected(new Set());
  }, [load, loadPlans, version]);

  const columns: { key: string; label: string }[] = data?.columns ?? [];
  const rows: Row[] = data?.rows ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold" style={S.sub}>
          Breeding line
          <select
            className="nf-input block mt-1 text-sm min-w-[12rem]"
            value={breedId}
            onChange={(e) => setBreedId(e.target.value)}
            aria-label="Breeding line"
          >
            {!lines.length && <option value="">No breeding line has live boars</option>}
            {lines.map((l) => (
              <option key={l.breed_id} value={l.breed_id}>
                {l.breed_code} ({l.boars} {l.boars === 1 ? 'boar' : 'boars'})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold" style={S.sub}>
          As of
          <input type="date" className="nf-input block mt-1 text-sm" value={asOf} max={todayIso()} onChange={(e) => setAsOf(e.target.value || todayIso())} />
        </label>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setPlanning(true)} disabled={!selected.size}>
            <CalendarDays className="w-4 h-4 mr-1" /> Plan collection{selected.size ? ` (${selected.size})` : ''}
          </Button>
          <Button variant="secondary" onClick={() => setImporting(true)} disabled={!lines.length}>
            <Upload className="w-4 h-4 mr-1" /> Import TSI
          </Button>
        </div>
      </div>

      {data && !data.setup_id && (
        <p className="text-xs rounded-lg border p-2" style={{ ...S.raised, ...S.sub }}>
          This line has no setup, and there is no company default, so no overall grading is shown. Set the rank weights in Breeding Line Setup.
        </p>
      )}
      {data && data.setup_id && !data.grading?.used && (
        <p className="text-xs rounded-lg border p-2" style={{ ...S.raised, ...S.sub }}>
          No rank weights are set for this line, so no overall grading is shown. Set them in Breeding Line Setup.
        </p>
      )}
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
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Choose every boar"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.boar_id)) : new Set())}
                />
              </th>
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-2 font-semibold whitespace-nowrap" style={S.sub}>
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td className="px-3 py-6 text-center" style={S.muted} colSpan={columns.length + 2}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && !rows.length && (
              <tr>
                <td className="px-3 py-6 text-center" style={S.muted} colSpan={Math.max(columns.length, 1) + 2}>
                  {breedId ? 'No live boars in this line.' : 'Choose a breeding line.'}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => (
                <tr key={r.boar_id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Choose ${r.boar}`}
                      checked={selected.has(r.boar_id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(r.boar_id);
                        else next.delete(r.boar_id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.key === 'boar' ? 'font-mono font-bold' : ''}`} style={c.key === 'boar' ? S.accent : S.primary}>
                      {cellText(c.key, r[c.key], r)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="text-xs font-semibold cursor-pointer hover:underline" style={S.accent} onClick={() => setTsiBoar(r)}>
                      Record TSI
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] flex items-center gap-1" style={S.muted}>
        <Trophy className="w-3 h-3" /> Ranks are among the boars shown that have a collection on record; a dash means there is no figure yet.
      </p>

      <CollectionPlans
        plans={plans}
        referenceLabel={data?.plan_rules?.reference_label ?? null}
        poolingAllowed={data?.plan_rules?.pooling_allowed ?? true}
        onCollect={(plan, boarIds, batchId) => onCollect?.(plan, boarIds, batchId)}
        onChanged={() => {
          load();
          loadPlans();
        }}
      />

      {planning && data && (
        <PlanDialog
          breedId={breedId}
          lineName={data.breed.breed_code}
          boars={rows.filter((r) => selected.has(r.boar_id))}
          rules={data.plan_rules}
          onClose={() => setPlanning(false)}
          onSaved={(warnings) => {
            setPlanning(false);
            setSelected(new Set());
            setNotice(['Collection planned.', ...warnings].join(' '));
            load();
            loadPlans();
          }}
        />
      )}

      {tsiBoar && (
        <TsiDialog
          boar={tsiBoar}
          onClose={() => setTsiBoar(null)}
          onSaved={() => {
            setTsiBoar(null);
            load();
          }}
        />
      )}
      {importing && (
        <TsiImportDialog
          onClose={() => setImporting(false)}
          onSaved={() => {
            setImporting(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function TsiDialog({ boar, onClose, onSaved }: { boar: Row; onClose: () => void; onSaved: () => void }) {
  const [tsi, setTsi] = useState(boar.tsi != null ? String(boar.tsi) : '');
  const [date, setDate] = useState(todayIso());
  const [rank, setRank] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issues: Issue[] = [];
  const n = Number(tsi);
  if (!tsi || Number.isNaN(n) || n <= 0) issues.push({ level: 'error', field: 'tsi', text: 'Enter a TSI above 0.' });
  if (rank && (!Number.isInteger(Number(rank)) || Number(rank) < 1)) issues.push({ level: 'error', field: 'rank', text: 'The genetic rank is a whole number, 1 or more.' });
  if (date > todayIso()) issues.push({ level: 'error', field: 'date', text: 'The date cannot be in the future.' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (issues.some((i) => i.level === 'error')) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/piggery/boar-selection/tsi', {
        boar_animal_id: boar.boar_id,
        tsi: n,
        effective_date: date,
        ...(rank ? { published_rank: Number(rank) } : {}),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Could not record the TSI.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <EntryModal title={`Record TSI — ${boar.boar}`} icon={<Trophy className="w-5 h-5" style={S.accent} />} onClose={onClose} onSubmit={submit} submitting={busy} submitLabel="Save TSI" savingLabel="Saving…" issues={issues}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="TSI" issues={issues} name="tsi" required>
          <input type="number" step="0.01" className="nf-input w-full text-sm" style={inputStyle(issues, 'tsi')} value={tsi} onChange={(e) => setTsi(e.target.value)} autoFocus />
        </Field>
        <Field label="As of" issues={issues} name="date" required>
          <input type="date" className="nf-input w-full text-sm" style={inputStyle(issues, 'date')} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Genetic rank published with it" issues={issues} name="rank" hint="Optional. The herd-wide rank, used as given. Leave it out and the rank is worked out from TSI.">
          <input type="number" step="1" min="1" className="nf-input w-full text-sm" style={inputStyle(issues, 'rank')} value={rank} onChange={(e) => setRank(e.target.value)} />
        </Field>
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </EntryModal>
  );
}

function TsiImportDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseTsiPaste(text);
  const issues: Issue[] = [
    ...(text.trim() && !parsed.rows.length ? [{ level: 'error' as const, field: 'list', text: 'No boar could be read from the list.' }] : []),
    ...(!text.trim() ? [{ level: 'error' as const, field: 'list', text: 'Paste the boars: one per line, animal code then TSI.' }] : []),
    ...parsed.errors.map((e) => ({ level: 'error' as const, field: 'list', text: e })),
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (issues.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/piggery/boar-selection/tsi/import', { effective_date: date, rows: parsed.rows });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Could not import the TSI.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <EntryModal title="Import TSI" icon={<Upload className="w-5 h-5" style={S.accent} />} onClose={onClose} onSubmit={submit} submitting={busy} submitLabel={`Import ${parsed.rows.length || ''} boars`.trim()} savingLabel="Importing…" issues={issues}>
      <Field label="As of" issues={issues} name="date" required>
        <input type="date" className="nf-input w-full text-sm" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Boars" issues={issues} name="list" required hint="One per line: animal code, TSI, and optionally the genetic rank published with it. A spreadsheet's copied cells work. Nothing is imported unless every boar is found.">
        <textarea
          className="nf-input w-full text-sm font-mono"
          rows={10}
          style={inputStyle(issues, 'list')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Animal code, TSI, genetic rank'}
        />
      </Field>
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </EntryModal>
  );
}
