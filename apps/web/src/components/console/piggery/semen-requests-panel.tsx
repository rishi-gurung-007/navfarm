'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Inbox, Loader2 } from 'lucide-react';
import { api } from '@/services/api-client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { DateInput } from '@/components/ui/date-input';
import { StatusBadge } from '@/components/ui/status-badge';
import { showToast } from '@/components/ui/toast';
import { getActiveCompanyId, getActiveFarmId, getStoredUser, hasPermission } from '@/hooks/useAuth';
import { Field, FieldGroup, ReadField } from '@/components/ui/field';
import { RequisitionDocumentShell } from '../requisitions/requisition-document-shell';
import { formatDate } from '@/utils/date-short';
import type { Row } from './breeding-rules';

const unwrap = <T,>(res: any): T => (Array.isArray(res) ? res : (res?.data ?? res)) as T;
const S: Record<string, CSSProperties> = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  primary: { color: 'var(--text-primary)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
  danger: { color: 'var(--danger)' },
};
const field = 'nf-input-sm h-9 w-full';
const day = (v: unknown) => (v ? formatDate(String(v)) : '—');
const todayStr = () => new Date().toISOString().slice(0, 10);
const place = (p?: Row | null) => (p ? p.code : '—');

/** Where a request stands, in one word. */
function stateOf(r: Row): { status: string; label: string } {
  if (r.document_status === 'CANCELLED') return { status: 'CANCELLED', label: 'Cancelled' };
  if (r.approval_status !== 'APPROVED') return { status: 'PENDING', label: r.approval_status === 'PENDING_APPROVAL' ? 'Awaiting approval' : 'Draft' };
  if (r.qty_received >= r.doses - 1e-9) return { status: 'COMPLETED', label: 'Received' };
  if (r.qty_shipped > 0) return { status: 'IN_PROGRESS', label: 'Shipped' };
  if (r.lot_no) return { status: 'APPROVED', label: 'Lot allocated' };
  if (r.released) return { status: 'APPROVED', label: 'Released' };
  return { status: 'APPROVED', label: 'Approved' };
}

function Labelled({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold" style={S.sub}>
      {label}
      {children}
      {hint && <span className="font-normal" style={S.muted}>{hint}</span>}
    </label>
  );
}

type DraftLine = { key: number; item_id: string; doses: string };
let lineKey = 0;
const newLine = (item_id = ''): DraftLine => ({ key: ++lineKey, item_id, doses: '' });
const farmOfStore = (l: Row): string | null => l.farm_id ?? l.parent_location_id ?? null;

/**
 * A farm asks the AI Station for doses: a Store requisition naming the breeding line, laid out like every other requisition document
 * (the header, then the lines) and submitted for approval. What the system knows is filled in: the number is given on save, the date is
 * today, the requester is you, the farm is yours (or the one you pick), its store is the destination, the AI Station's store is where the
 * line's last lots were collected, and each line takes the line's semen item.
 */
function NewRequestDialog({ lines: givenLines, onClose, onDone }: { lines?: Row[]; onClose: () => void; onDone: () => void }) {
  const user = getStoredUser();
  // Opened from the Requisition page the lines are not loaded yet: the form reads them itself.
  const [loadedLines, setLoadedLines] = useState<Row[]>([]);
  useEffect(() => {
    if (givenLines) return;
    api.get('/piggery/boar-selection/lines').then((r) => setLoadedLines(unwrap<Row[]>(r) || [])).catch(() => setLoadedLines([]));
  }, [givenLines]);
  // The lines with boars anywhere in the company (the sending farm's boars, not the asking farm's).
  const [sourceLines, setSourceLines] = useState<Row[]>([]);
  const breedLines = sourceLines.length ? sourceLines : (givenLines ?? loadedLines);

  const [locations, setLocations] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [setups, setSetups] = useState<Row[]>([]);
  const [lots, setLots] = useState<Row[]>([]);
  const [reqDate, setReqDate] = useState(todayStr());
  const [farmId, setFarmId] = useState<string>(getActiveFarmId() ?? '');
  const [breedId, setBreedId] = useState('');
  const [fromFarmId, setFromFarmId] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [need, setNeed] = useState(todayStr());
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState<DraftLine[]>([newLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The workspace already scopes these lists; naming the company again is refused in the tenant workspace.
    // Every farm and store of the company, not just the active farm's: the semen comes from another farm.
    api.get('/piggery/semen-requests/sources').then((r) => {
      const d = unwrap<{ farms: Row[]; stores: Row[]; lines: Row[] }>(r);
      setLocations([...(d?.farms ?? []), ...(d?.stores ?? [])]);
      setSourceLines(d?.lines ?? []);
    }).catch(() => setLocations([]));
    // The semen items: only items marked as semen (0266). Each line's setup names the one it uses.
    api.get('/item?isSemen=true&isActive=true&limit=500').then((r) => setItems(unwrap<Row[]>(r) || [])).catch(() => setItems([]));
    api.get('/breeding-line-setup?limit=200').then((r) => setSetups(unwrap<Row[]>(r) || [])).catch(() => setSetups([]));
    api.get('/piggery/breeding/semen-collection').then((r) => setLots(unwrap<Row[]>(r) || [])).catch(() => setLots([]));
  }, []);

  const farms = useMemo(() => locations.filter((l) => l.location_type === 'FARM' && l.is_active !== false), [locations]);
  const stores = useMemo(() => locations.filter((l) => l.location_type === 'STORE' && l.is_active !== false), [locations]);
  const farmStores = stores.filter((s) => !farmId || farmOfStore(s) === farmId);
  const farm = farms.find((f) => f.location_id === farmId);
  // The supplying farm's stores: where the semen ships from.
  const fromStores = stores.filter((s) => !fromFarmId || farmOfStore(s) === fromFarmId);
  const fromFarm = farms.find((f) => f.location_id === fromFarmId);

  useEffect(() => {
    if (!breedId && breedLines.length === 1) setBreedId(breedLines[0].breed_id);
  }, [breedLines, breedId]);
  // The farm's store is where the doses go: picked when the farm has one.
  useEffect(() => {
    if (!farmId) return;
    const own = stores.filter((s) => farmOfStore(s) === farmId);
    setToId((cur) => (own.some((s) => s.location_id === cur) ? cur : own.length === 1 ? own[0].location_id : ''));
  }, [farmId, stores]);
  // The supplying farm and its store: where this line's latest lot was collected.
  useEffect(() => {
    if (fromFarmId || !breedId) return;
    const last = lots.find((l) => (!l.breed_id || l.breed_id === breedId) && l.warehouse_id);
    const store = last && stores.find((s) => s.location_id === last.warehouse_id);
    if (!store) return;
    setFromFarmId(farmOfStore(store) ?? '');
    setFromId(store.location_id);
  }, [breedId, lots, stores, fromFarmId]);
  // A store of the supplying farm: kept when it belongs to it, else its only store.
  useEffect(() => {
    if (!fromFarmId) return;
    const own = stores.filter((s) => farmOfStore(s) === fromFarmId);
    setFromId((cur) => (own.some((s) => s.location_id === cur) ? cur : own.length === 1 ? own[0].location_id : ''));
  }, [fromFarmId, stores]);
  // The line's semen item (else the company default setup's, else the only semen item) goes on every line not filled yet.
  const lineItem = useMemo(() => {
    const own = setups.find((x) => x.breed_id === breedId && x.semen_item_id)?.semen_item_id;
    const fallback = setups.find((x) => !x.breed_id && x.semen_item_id)?.semen_item_id;
    const pick = own ?? fallback ?? (items.length === 1 ? items[0].item_id : '');
    return items.some((i) => i.item_id === pick) ? pick : '';
  }, [breedId, setups, items]);
  useEffect(() => {
    if (lineItem) setRows((all) => all.map((r) => (r.item_id ? r : { ...r, item_id: lineItem })));
  }, [lineItem]);

  const setRow = (key: number, patch: Partial<DraftLine>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const filled = rows.filter((r) => r.item_id && Number(r.doses) > 0);
  const total = filled.reduce((n, r) => n + Number(r.doses), 0);
  const ready = !!farmId && !!breedId && !!fromId && !!toId && fromId !== toId && filled.length > 0 && filled.length === rows.filter((r) => r.item_id || r.doses).length;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const company = getActiveCompanyId();
      const created = unwrap<Row>(await api.post('/requisition', {
        ...(company ? { company_id: company } : {}),
        doc_type: 'ITEM',
        purpose: 'STORE',
        requisition_date: reqDate,
        // The requisition belongs to the farm that asks.
        main_location_id: farmId,
        from_location_id: fromId,
        to_location_id: toId,
        breed_id: breedId,
        required_date: need,
        remarks: remarks.trim() || 'Semen request',
        lines: filled.map((r) => ({ item_id: r.item_id, quantity: Number(r.doses), uom: items.find((i) => i.item_id === r.item_id)?.uom_primary || 'DOSE' })),
      }));
      await api.post(`/requisition/${created.requisition_id}/submit`, {});
      showToast.success(`Semen requisition ${created.req_no} sent for approval.`);
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Could not raise the request.');
    } finally {
      setBusy(false);
    }
  };

  const HALF = 'sm:col-span-6 lg:col-span-4';
  const TH = 'h-9 whitespace-nowrap px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]';
  const TD = 'px-3 py-1.5 align-middle text-xs text-[var(--text-primary)]';
  const storeLabel = (s: Row) => `${s.location_code} · ${s.location_name}`;

  return (
    <Dialog open onClose={onClose} title="New semen requisition" maxWidth="xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs" style={S.muted}>{total ? `${total} doses` : ''}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={busy || !ready} onClick={save}>{busy ? 'Saving...' : 'Send for approval'}</Button>
          </div>
        </div>
      }>
      <RequisitionDocumentShell className="text-xs">
        <FieldGroup title="Header">
          <ReadField className={HALF} label="Requisition No." value={null} emptyText="Assigned on save" mono />
          <Field className={HALF} label="Requisition Date" htmlFor="srq-date">
            <DateInput id="srq-date" className="nf-input h-11" value={reqDate} onChange={(e) => setReqDate(e.target.value)} />
          </Field>
          <ReadField className={HALF} label="Type" value="Semen requisition" />
          <ReadField className={HALF} label="Requested By" value={user?.fullName ?? null} />
          <ReadField className={HALF} label="Requester User ID" value={user?.email ?? null} mono />
          <ReadField className={HALF} label="Status" value="Open (sent for approval on save)" />
          <Field className={HALF} label="Requesting Farm" htmlFor="srq-farm" required>
            <select id="srq-farm" className="nf-input h-11 w-full" value={farmId} onChange={(e) => setFarmId(e.target.value)}>
              <option value="">Select...</option>
              {farms.map((f) => <option key={f.location_id} value={f.location_id}>{f.location_code} · {f.location_name}</option>)}
            </select>
          </Field>
          <Field className={HALF} label="Breeding Line" htmlFor="srq-line" required>
            <select id="srq-line" className="nf-input h-11 w-full" value={breedId} onChange={(e) => setBreedId(e.target.value)}>
              <option value="">Select...</option>
              {breedLines.map((l) => <option key={l.breed_id} value={l.breed_id}>{l.breed_code || l.breed_name}</option>)}
            </select>
          </Field>
          <Field className={HALF} label="Needed By" htmlFor="srq-need" required>
            <DateInput id="srq-need" className="nf-input h-11" value={need} onChange={(e) => setNeed(e.target.value)} />
          </Field>
          <Field className={HALF} label="From Farm" htmlFor="srq-from-farm" required hint="The farm that collects and sends the semen.">
            <select id="srq-from-farm" className="nf-input h-11 w-full" value={fromFarmId} onChange={(e) => setFromFarmId(e.target.value)}>
              <option value="">Select...</option>
              {farms.filter((f) => f.location_id !== farmId).map((f) => <option key={f.location_id} value={f.location_id}>{f.location_code} · {f.location_name}</option>)}
            </select>
          </Field>
          <Field className={HALF} label="From (farm store)" htmlFor="srq-from" required hint={fromFarm ? `A store of ${fromFarm.location_code}.` : 'Pick the from farm first.'}>
            <select id="srq-from" className="nf-input h-11 w-full" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              <option value="">Select...</option>
              {fromStores.filter((s) => s.location_id !== toId).map((s) => <option key={s.location_id} value={s.location_id}>{storeLabel(s)}</option>)}
            </select>
          </Field>
          <Field className={HALF} label="To (farm store)" htmlFor="srq-to" required hint={farm ? `A store of ${farm.location_code}.` : 'Pick the farm first.'}>
            <select id="srq-to" className="nf-input h-11 w-full" value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Select...</option>
              {farmStores.filter((s) => s.location_id !== fromId).map((s) => <option key={s.location_id} value={s.location_id}>{storeLabel(s)}</option>)}
            </select>
          </Field>
          <Field className="sm:col-span-12" label="Remarks" htmlFor="srq-remarks">
            <input id="srq-remarks" className="nf-input h-11 w-full" value={remarks} maxLength={500} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </FieldGroup>

        {/* A semen requisition asks for one semen item: one line. */}
        <FieldGroup title="Line">
          <div className="sm:col-span-12 overflow-x-auto rounded-[var(--radius-md)] border" style={S.surface}>
            <table className="w-full min-w-[640px] border-collapse">
              <thead style={{ backgroundColor: 'var(--surface-raised)' }}>
                <tr>
                  <th className={TH}>Line</th>
                  <th className={TH}>Semen Item</th>
                  <th className={TH}>Description</th>
                  <th className={`${TH} text-right`}>Doses</th>
                  <th className={TH}>Unit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const it = items.find((x) => x.item_id === r.item_id);
                  return (
                    <tr key={r.key} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className={`${TD} font-mono`}>{(i + 1) * 10000}</td>
                      <td className={TD}>
                        <select className="nf-input-sm h-9 w-full min-w-[12rem]" value={r.item_id} aria-label={`Semen item, line ${i + 1}`} onChange={(e) => setRow(r.key, { item_id: e.target.value })}>
                          <option value="">{items.length ? 'Select...' : 'No item is marked as semen yet'}</option>
                          {items.map((x) => <option key={x.item_id} value={x.item_id}>{x.item_code}</option>)}
                        </select>
                      </td>
                      <td className={TD} style={S.sub}>{it?.item_name ?? '—'}</td>
                      <td className={`${TD} text-right`}>
                        <input className="nf-input-sm h-9 w-24 text-right font-mono" type="number" min={1} step="1" value={r.doses} aria-label={`Doses, line ${i + 1}`} onChange={(e) => setRow(r.key, { doses: e.target.value })} />
                      </td>
                      <td className={TD} style={S.sub}>{it?.uom_primary ?? 'DOSE'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </FieldGroup>
        <p className="text-[11px]" style={S.muted}>
          Once approved and released, the AI Station plans the collection and allocates a lot that passed QC; the farm receives it (and checks it) as any transfer.
        </p>
        {error && <p className="text-xs" role="alert" style={S.danger}>{error}</p>}
      </RequisitionDocumentShell>
    </Dialog>
  );
}

/** Plans a collection from the ticked requests of one line: the boars to collect and the day, the requests' doses as the target. */
function PlanFromRequestsDialog({ requests, onClose, onDone }: { requests: Row[]; onClose: () => void; onDone: () => void }) {
  const breedId = requests[0]?.breed_id;
  const target = requests.reduce((n, r) => n + r.doses, 0);
  const [table, setTable] = useState<Row | null>(null);
  const [date, setDate] = useState('');
  const [boars, setBoars] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .get(`/piggery/boar-selection?breed_id=${breedId}&as_of=${todayStr()}`)
      .then((r) => {
        const t = unwrap<Row>(r);
        setTable(t);
        setDate(t?.plan_rules?.next_collection_date ?? todayStr());
      })
      .catch((e) => setError(e?.message || "Could not load the line's boars."));
  }, [breedId]);
  const rows: Row[] = table?.rows ?? [];
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const plan = unwrap<Row>(await api.post('/piggery/collection-plans', {
        breed_id: breedId,
        collection_date: date,
        boars: boars.map((id) => ({ boar_animal_id: id })),
        requisition_line_ids: requests.map((r) => r.line_id),
        requested_by: [...new Set(requests.map((r) => place(r.farm)))].join(', ').slice(0, 100),
      }));
      showToast.success(`Collection ${plan.plan_no} planned for ${target} doses.`);
      onDone();
    } catch (e: any) {
      setError(e?.message || 'Could not plan the collection.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={`Plan collection · ${requests[0]?.breed_code ?? ''}`}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={busy || !date || !boars.length} onClick={save}>{busy ? 'Saving...' : 'Plan collection'}</Button>
        </div>
      }>
      <div className="space-y-3 text-sm">
        <p className="text-xs" style={S.sub}>
          {requests.length} request{requests.length === 1 ? '' : 's'}: {requests.map((r) => `${r.req_no} (${place(r.farm)}, ${r.doses})`).join(', ')}. Target <b>{target}</b> doses.
        </p>
        <Labelled label="Collection day" hint={table?.plan_rules?.collection_weekdays?.length ? `This line is collected on ${table.plan_rules.collection_weekdays.join(', ')}.` : undefined}>
          <DateInput value={date} className="nf-input-sm h-9" onChange={(e) => setDate(e.target.value)} />
        </Labelled>
        <div>
          <p className="mb-1 text-xs font-semibold" style={S.sub}>Boars to collect</p>
          {!table ? (
            <Loader2 className="h-4 w-4 animate-spin" style={S.muted} />
          ) : rows.length === 0 ? (
            <p className="text-xs" style={S.muted}>This line has no boars to collect.</p>
          ) : (
            <div className="max-h-60 overflow-y-auto rounded border" style={S.surface}>
              {rows.map((b) => (
                <label key={b.boar_id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-xs" style={{ borderColor: 'var(--border)', ...S.primary }}>
                  <input type="checkbox" checked={boars.includes(b.boar_id)}
                    onChange={(e) => setBoars((all) => (e.target.checked ? [...all, b.boar_id] : all.filter((x) => x !== b.boar_id)))} />
                  <span className="font-mono font-semibold">{b.boar_code ?? b.boar}</span>
                  {b.last_doses != null && <span style={S.muted}>last {Number(b.last_doses)} doses</span>}
                  {b.overall_rank != null && <span style={S.muted}>rank {b.overall_rank}</span>}
                </label>
              ))}
            </div>
          )}
        </div>
        {error && <p className="text-xs" role="alert" style={S.danger}>{error}</p>}
      </div>
    </Dialog>
  );
}

/** Allocates a lot that passed QC to the ticked requests: earliest needed first, each whole; says which could not be filled and why. */
function AllocateDialog({ requests, onClose, onDone }: { requests: Row[]; onClose: () => void; onDone: () => void }) {
  const breedId = requests[0]?.breed_id;
  const [lots, setLots] = useState<Row[] | null>(null);
  const [lotId, setLotId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Row | null>(null);
  useEffect(() => {
    api
      .get('/piggery/breeding/semen-collection')
      .then((r) => {
        const all = (unwrap<Row[]>(r) || []).filter(
          (l) => l.inventory_posted && l.lot_no && (!breedId || !l.breed_id || l.breed_id === breedId)
            && Number(l.doses_collected) - Number(l.doses_used_internal || 0) - Number(l.doses_sold || 0) - Number(l.doses_destroyed || 0) > 0,
        );
        setLots(all);
      })
      .catch(() => setLots([]));
  }, [breedId]);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = unwrap<Row>(await api.post('/piggery/semen-requests/allocate', { semen_batch_id: lotId, requisition_line_ids: requests.map((x) => x.line_id) }));
      setResult(r);
      if (r.allocated?.length) showToast.success(`${r.lot_no} allocated to ${r.allocated.map((a: Row) => a.req_no).join(', ')}.`);
    } catch (e: any) {
      setError(e?.message || 'Could not allocate the lot.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={result ? onDone : onClose} title="Allocate a lot"
      footer={
        <div className="flex w-full justify-end gap-2">
          {result ? (
            <Button size="sm" onClick={onDone}>Done</Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" disabled={busy || !lotId} onClick={save}>{busy ? 'Saving...' : 'Allocate'}</Button>
            </>
          )}
        </div>
      }>
      <div className="space-y-3 text-sm">
        <p className="text-xs" style={S.sub}>
          The lot goes on each request's transfer, earliest needed first, each request whole while the lot's free doses last. Each request must
          be released. The farm then ships and receives it from the requisition.
        </p>
        {!result && (
          <Labelled label="Lot (passed QC)">
            {lots === null ? (
              <Loader2 className="h-4 w-4 animate-spin" style={S.muted} />
            ) : (
              <select className={field} value={lotId} onChange={(e) => setLotId(e.target.value)}>
                <option value="">{lots.length ? 'Select...' : 'No lot of this line has doses in stock'}</option>
                {lots.map((l) => (
                  <option key={l.semen_batch_id} value={l.semen_batch_id}>
                    {`${l.lot_no} · ${day(l.collection_date)} · ${Number(l.doses_collected) - Number(l.doses_used_internal || 0) - Number(l.doses_sold || 0) - Number(l.doses_destroyed || 0)} doses`}
                  </option>
                ))}
              </select>
            )}
          </Labelled>
        )}
        {result && (
          <div className="space-y-2 text-xs">
            <p style={S.primary}>
              {result.allocated.length
                ? `${result.lot_no} allocated to ${result.allocated.map((a: Row) => `${a.req_no} (${a.doses})`).join(', ')}.`
                : `${result.lot_no} was not allocated to any request.`}{' '}
              {result.left} doses of it are still free.
            </p>
            {result.skipped.length > 0 && (
              <ul className="list-disc pl-5" style={S.sub}>
                {result.skipped.map((s: Row) => <li key={s.req_no}>{s.req_no}: {s.reason}</li>)}
              </ul>
            )}
          </div>
        )}
        {error && <p className="text-xs" role="alert" style={S.danger}>{error}</p>}
      </div>
    </Dialog>
  );
}

/**
 * AI Station › Planned Collections (Phase 4): the farms' semen requests (raised on the Requisition page), by line and needed-by date. Tick requests of one line to plan a collection
 * for them, or to allocate a lot that passed QC. Approval, release, shipping and receiving stay on the requisition.
 */
export { NewRequestDialog as NewSemenRequestDialog };

export function SemenRequestsPanel({ onChanged }: { onChanged?: () => void }) {
  const canEdit = hasPermission(getStoredUser(), 'PIGGERY', 'ANIMAL', 'can_edit');
  const [rows, setRows] = useState<Row[]>([]);
  const [lines, setLines] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'OPEN' | 'ALL'>('OPEN');
  const [breedId, setBreedId] = useState('');
  const [ticked, setTicked] = useState<string[]>([]);
  const [dialog, setDialog] = useState<'plan' | 'allocate' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ status, ...(breedId ? { breed_id: breedId } : {}) });
      setRows(unwrap<Row[]>(await api.get(`/piggery/semen-requests?${qs.toString()}`)) || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load the semen requests.');
    } finally {
      setLoading(false);
    }
  }, [status, breedId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    api.get('/piggery/boar-selection/lines').then((r) => setLines(unwrap<Row[]>(r) || [])).catch(() => setLines([]));
  }, []);

  const chosen = useMemo(() => rows.filter((r) => ticked.includes(r.line_id)), [rows, ticked]);
  const oneLine = chosen.length > 0 && chosen.every((r) => r.breed_id === chosen[0].breed_id);
  const plannable = oneLine && chosen.every((r) => r.approval_status === 'APPROVED' && !r.plan_no);
  const allocatable = oneLine && chosen.every((r) => r.released && !r.lot_no);
  const totals = useMemo(() => ({
    requested: rows.reduce((n, r) => n + r.doses, 0),
    planned: rows.filter((r) => r.plan_no).reduce((n, r) => n + r.doses, 0),
    allocated: rows.filter((r) => r.lot_no).reduce((n, r) => n + r.doses, 0),
  }), [rows]);
  const done = () => {
    setDialog(null);
    setTicked([]);
    void load();
    onChanged?.();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select className="nf-input-sm h-9" value={status} onChange={(e) => setStatus(e.target.value as 'OPEN' | 'ALL')} aria-label="Status">
            <option value="OPEN">Open requests</option>
            <option value="ALL">All requests</option>
          </select>
          <select className="nf-input-sm h-9" value={breedId} onChange={(e) => setBreedId(e.target.value)} aria-label="Breeding line">
            <option value="">All lines</option>
            {lines.map((l) => <option key={l.breed_id} value={l.breed_id}>{l.breed_code || l.breed_name}</option>)}
          </select>
          <span className="text-xs" style={S.muted}>
            Requested {totals.requested} · planned {totals.planned} · allocated {totals.allocated} doses
          </span>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!plannable} onClick={() => setDialog('plan')}
              title={plannable ? undefined : 'Tick approved, unplanned requests of one line'}>Plan collection</Button>
            <Button size="sm" variant="outline" disabled={!allocatable} onClick={() => setDialog('allocate')}
              title={allocatable ? undefined : 'Tick released requests of one line that have no lot yet'}>Allocate lot</Button>
          </div>
        )}
      </div>

      {error && <p className="rounded border p-3 text-sm" style={{ borderColor: 'var(--danger)', ...S.danger }}>{error}</p>}

      <div className="overflow-x-auto rounded-[var(--radius-md)] border" style={S.surface}>
        <table className="w-full min-w-[960px] border-collapse text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider" style={S.muted}>
            <tr>
              <th className="w-10 px-3 py-2.5" />
              {['Request', 'Farm', 'Line', 'Needed by', 'Doses', 'Status', 'Plan', 'Lot', 'Shipped / received'].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" style={S.muted} /></td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-10 text-center text-sm" style={S.sub}>
                  <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} />
                  {status === 'OPEN' ? 'No open semen requests.' : 'No semen requests yet.'}
                </td>
              </tr>
            ) : rows.map((r) => {
              const st = stateOf(r);
              return (
                <tr key={r.line_id} className="border-t" style={{ borderColor: 'var(--border)', ...S.primary }}>
                  <td className="px-3 py-2.5">
                    <input type="checkbox" aria-label={`Tick ${r.req_no}`} checked={ticked.includes(r.line_id)}
                      onChange={(e) => setTicked((all) => (e.target.checked ? [...all, r.line_id] : all.filter((x) => x !== r.line_id)))} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono font-semibold">{r.req_no}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{place(r.farm)}<div className="text-[11px]" style={S.muted}>to {place(r.to_store)}</div></td>
                  <td className="whitespace-nowrap px-3 py-2.5">{r.breed_code}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{day(r.required_date)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono">{r.doses}</td>
                  <td className="whitespace-nowrap px-3 py-2.5"><StatusBadge status={st.status} label={st.label} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{r.plan_no ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{r.lot_no ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs">{r.qty_shipped} / {r.qty_received}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog === 'plan' && <PlanFromRequestsDialog requests={chosen} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'allocate' && <AllocateDialog requests={chosen} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}
