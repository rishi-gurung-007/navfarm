'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { api } from '@/services/api-client';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { StatusBadge } from '@/components/ui/status-badge';
import { useCompanyCurrency } from '@/hooks/useCompanyCurrency';
import { formatDate } from '@/utils/date-short';
import type { Row } from './breeding-rules';

const unwrap = <T,>(res: any): T => (Array.isArray(res) ? res : (res?.data ?? res)) as T;
const S: Record<string, CSSProperties> = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  raised: { backgroundColor: 'var(--surface-raised)', borderColor: 'var(--border)' },
  primary: { color: 'var(--text-primary)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
};
const day = (v: unknown) => (v ? formatDate(String(v)) : '—');
const n = (v: unknown) => (v == null ? '—' : String(Math.round(Number(v) * 100) / 100));

type View = 'request' | 'farm' | 'lot';
const QC_STATE: Record<string, { status: string; label: string }> = {
  PASSED: { status: 'COMPLETED', label: 'QC passed' },
  PENDING: { status: 'PENDING', label: 'QC pending' },
  FAILED: { status: 'REJECTED', label: 'QC failed' },
  NONE: { status: 'DRAFT', label: 'No QC' },
};
const REQUEST_STATE: Record<string, { status: string; label: string }> = {
  OPEN: { status: 'APPROVED', label: 'Open' },
  IN_PROGRESS: { status: 'IN_PROGRESS', label: 'Shipped' },
  RECEIVED: { status: 'COMPLETED', label: 'Received' },
  CANCELLED: { status: 'CANCELLED', label: 'Cancelled' },
};

/** The table for each view: its columns (label, value, numeric) in the order they are shown and exported. */
function columns(view: View, money: (v: unknown) => string): Array<[string, (r: Row) => string | number, boolean?]> {
  const report: Array<[string, (r: Row) => string | number, boolean?]> = [
    ['Requested', (r) => n(r.requested), true],
    ['Received', (r) => n(r.received), true],
    ['Pending QC', (r) => n(r.pending_qc), true],
    ['Rejected', (r) => n(r.rejected), true],
    ['Used', (r) => n(r.used), true],
    ['Destroyed', (r) => n(r.destroyed), true],
    ['On hand', (r) => n(r.on_hand), true],
    ['Short', (r) => n(r.short), true],
  ];
  if (view === 'request') {
    return [['Request', (r) => r.req_no], ['Farm', (r) => r.farm_code ?? '—'], ['Line', (r) => r.breed_code ?? '—'], ['Needed by', (r) => day(r.required_date)], ['Lot', (r) => r.lot_no ?? '—'], ...report];
  }
  if (view === 'farm') return [['Farm', (r) => r.farm_code ?? '—'], ['Requests', (r) => r.requests, true], ...report];
  return [
    ['Lot', (r) => r.lot_no ?? '—'], ['Label', (r) => r.label ?? '—'], ['Collected on', (r) => day(r.collection_date)], ['Line', (r) => r.breed_code ?? '—'], ['Boar', (r) => r.boar_code ?? '—'],
    ['Collected', (r) => n(r.collected), true], ['Allocated', (r) => n(r.allocated), true], ['Used', (r) => n(r.used), true], ['Sold', (r) => n(r.sold), true],
    ['Destroyed', (r) => n(r.destroyed), true], ['On hand', (r) => n(r.on_hand), true], ['Cost / dose', (r) => money(r.cost_per_dose), true],
  ];
}

/** A CSV of what is on screen, so the report can be sent on. */
function downloadCsv(view: View, rows: Row[], money: (v: unknown) => string) {
  const cols = columns(view, money);
  const cell = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map(([h]) => cell(h)).join(','), ...rows.map((r) => cols.map(([, get]) => cell(get(r))).join(','))];
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-station-${view}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * AI Station › Dashboard (Phase 5): every figure under one set of filters. The tiles, the client's one-line report ("Requested 100,
 * Received 90, Used 70, Destroyed 20"), and the report by request, by farm or by lot, exported as CSV.
 */
export function AiStationDashboard() {
  const { formatMoney } = useCompanyCurrency();
  const money = useCallback((v: unknown) => (v == null ? '—' : formatMoney(Number(v))), [formatMoney]);
  const [data, setData] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('request');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [farms, setFarms] = useState<Row[]>([]);
  const [lines, setLines] = useState<Row[]>([]);
  const [boars, setBoars] = useState<Row[]>([]);
  const set = (key: string, value: string) => setFilters((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    api.get('/location?locationType=FARM&rootOnly=true&isActive=true&limit=200').then((r) => setFarms(unwrap<Row[]>(r) || [])).catch(() => setFarms([]));
    api.get('/piggery/boar-selection/lines').then((r) => setLines(unwrap<Row[]>(r) || [])).catch(() => setLines([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
      const d = unwrap<Row>(await api.get(`/piggery/ai-station/dashboard?${qs.toString()}`));
      setData(d);
      // The boars to filter by: every boar with a lot, taken from the first, unfiltered read.
      setBoars((known) => (known.length ? known : [...new Map((d.lots as Row[]).map((l) => [l.boar_id, { boar_id: l.boar_id, boar_code: l.boar_code }])).values()]));
    } catch (e: any) {
      setError(e?.message || 'Could not load the dashboard.');
    } finally {
      setLoading(false);
    }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);

  const rows: Row[] = useMemo(() => (!data ? [] : view === 'request' ? data.by_request : view === 'farm' ? data.by_farm : data.lots), [data, view]);
  const t = data?.tiles ?? {};
  const tiles: Array<[string, string, string]> = [
    ['Requested', n(t.requested), 'Doses the farms asked for'],
    ['Received', n(t.received), 'Landed at the farms, after their QC'],
    ['Used', n(t.used), 'Matings at the farms'],
    ['Destroyed', n(t.destroyed), 'Written off at the farms'],
    ['Pending QC', n(t.pending_qc), 'Held by a farm receipt QC'],
    ['Short', n(t.short), 'Not sent yet'],
    ['On hand', n(t.on_hand), `Doses in stock, ${t.lots ?? 0} lots`],
    ['QC', `${t.qc_pending_lots ?? 0} / ${t.qc_failed_lots ?? 0}`, `Lots pending / failed; ${t.farm_qc_pending ?? 0} farm checks open`],
    ['Cost per dose', t.avg_cost_per_dose != null ? money(t.avg_cost_per_dose) : '—', `${n(t.doses_collected)} doses collected`],
  ];
  const filterField = 'nf-input-sm h-9 w-full';
  const cols = columns(view, money);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] border p-3 md:grid-cols-5" style={S.raised}>
        <DateInput value={filters.from_date ?? ''} className="nf-input-sm h-9" onChange={(e) => set('from_date', e.target.value)} aria-label="From" placeholder="From" />
        <DateInput value={filters.to_date ?? ''} className="nf-input-sm h-9" onChange={(e) => set('to_date', e.target.value)} aria-label="To" placeholder="To" />
        <select className={filterField} value={filters.collection_farm_id ?? ''} onChange={(e) => set('collection_farm_id', e.target.value)} aria-label="AI Station farm">
          <option value="">Every AI Station farm</option>
          {farms.map((f) => <option key={f.location_id} value={f.location_id}>{`From ${f.location_code}`}</option>)}
        </select>
        <select className={filterField} value={filters.farm_id ?? ''} onChange={(e) => set('farm_id', e.target.value)} aria-label="Requesting farm">
          <option value="">Every requesting farm</option>
          {farms.map((f) => <option key={f.location_id} value={f.location_id}>{`For ${f.location_code}`}</option>)}
        </select>
        <select className={filterField} value={filters.breed_id ?? ''} onChange={(e) => set('breed_id', e.target.value)} aria-label="Breeding line">
          <option value="">Every line</option>
          {lines.map((l) => <option key={l.breed_id} value={l.breed_id}>{l.breed_code || l.breed_name}</option>)}
        </select>
        <select className={filterField} value={filters.boar_id ?? ''} onChange={(e) => set('boar_id', e.target.value)} aria-label="Boar">
          <option value="">Every boar</option>
          {boars.map((b) => <option key={b.boar_id} value={b.boar_id}>{b.boar_code}</option>)}
        </select>
        <input className={filterField} placeholder="Lot no." value={filters.lot_no ?? ''} onChange={(e) => set('lot_no', e.target.value.trim())} aria-label="Lot no." />
        <select className={filterField} value={filters.request_status ?? ''} onChange={(e) => set('request_status', e.target.value)} aria-label="Request status">
          <option value="">Every request status</option>
          {Object.entries(REQUEST_STATE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className={filterField} value={filters.qc_state ?? ''} onChange={(e) => set('qc_state', e.target.value)} aria-label="Lot QC">
          <option value="">Every lot QC</option>
          {Object.entries(QC_STATE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <Button variant="outline" size="sm" className="h-9" onClick={() => setFilters({})} disabled={!Object.values(filters).some(Boolean)}>Clear filters</Button>
      </div>

      {error && <p className="rounded border p-3 text-sm" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {tiles.map(([label, value, caption]) => (
          <div key={label} className="rounded-[var(--radius-md)] border p-3" style={S.surface}>
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>{label}</p>
            <p className="text-xl font-bold" style={S.primary}>{loading && !data ? '…' : value}</p>
            <p className="text-[11px]" style={S.muted}>{caption}</p>
          </div>
        ))}
      </div>

      {data && (
        <p className="rounded-[var(--radius-md)] border px-3 py-2 font-mono text-sm" style={{ ...S.raised, ...S.primary }}>
          {data.mini_report}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border p-1" style={S.surface} role="tablist" aria-label="Report by">
          {(['request', 'farm', 'lot'] as View[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className="h-8 cursor-pointer rounded-[var(--radius-sm)] px-3 text-xs font-semibold"
              style={view === v ? { backgroundColor: 'var(--accent)', color: '#fff' } : S.sub}>
              {v === 'request' ? 'By request' : v === 'farm' ? 'By farm' : 'By lot'}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => downloadCsv(view, rows, money)}>
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border" style={S.surface}>
        <table className="w-full min-w-[960px] border-collapse text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider" style={S.muted}>
            <tr>
              {cols.map(([h, , num]) => <th key={h} className={`whitespace-nowrap px-3 py-2.5 font-semibold ${num ? 'text-right' : ''}`}>{h}</th>)}
              {view !== 'farm' && <th className="whitespace-nowrap px-3 py-2.5 font-semibold">Status</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length + 1} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" style={S.muted} /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length + 1} className="py-10 text-center text-sm" style={S.sub}>Nothing matches these filters.</td></tr>
            ) : rows.map((r, i) => {
              const st = view === 'lot' ? QC_STATE[r.qc_state] : view === 'request' ? REQUEST_STATE[r.status] : null;
              return (
                <tr key={r.line_id ?? r.semen_batch_id ?? r.farm_id ?? i} className="border-t" style={{ borderColor: 'var(--border)', ...S.primary }}>
                  {cols.map(([h, get, num]) => <td key={h} className={`whitespace-nowrap px-3 py-2.5 ${num ? 'text-right font-mono' : ''}`}>{get(r)}</td>)}
                  {view !== 'farm' && <td className="whitespace-nowrap px-3 py-2.5">{st ? <StatusBadge status={st.status} label={st.label} /> : '—'}</td>}
                </tr>
              );
            })}
          </tbody>
          {view !== 'lot' && data && rows.length > 0 && (
            <tfoot>
              <tr className="border-t font-semibold" style={{ borderColor: 'var(--border)', ...S.primary }}>
                {cols.map(([h, , num], i) => (
                  <td key={h} className={`whitespace-nowrap px-3 py-2.5 ${num ? 'text-right font-mono' : ''}`}>
                    {i === 0 ? 'Total' : num && h !== 'Requests' ? n(data.totals[h === 'Pending QC' ? 'pending_qc' : h === 'On hand' ? 'on_hand' : h.toLowerCase()]) : ''}
                  </td>
                ))}
                {view !== 'farm' && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-[11px]" style={S.muted}>
        Received counts doses that landed at the farm after its receipt QC accepted them; Pending QC is what that QC still holds; Rejected went back
        to the AI Station. Used and Destroyed are matings and write-offs of the lot at the farm's store. The dates filter requests by needed-by
        date and lots by collection date.
      </p>
    </div>
  );
}
