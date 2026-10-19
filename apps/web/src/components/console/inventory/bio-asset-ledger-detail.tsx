'use client';

/**
 * One Bio Asset Ledger entry, laid out as the Inventory Ledger entry is (Rishi, 14 Oct): document header, the four
 * key figures, item and tracking panels, and — for a GRN's entry — the animals registered from it, as a receipt lists
 * the issues applied to it. A registration shows the GRN entry it was taken from.
 */
import { NA } from "@/utils/na";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Layers, Calendar, Package, DollarSign, ArrowDownLeft, ArrowUpRight, ShieldCheck, Loader2, Database } from 'lucide-react';
import { api } from '@/services/api-client';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { useCompanyCurrency } from '@/hooks/useCompanyCurrency';
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: 'var(--surface)', borderColor: 'var(--border)' },
  primary: { color: 'var(--text-primary)' },
  sub: { color: 'var(--text-secondary)' },
  muted: { color: 'var(--text-muted)' },
  accent: { color: 'var(--accent)' },
};

export const BIO_TRANSACTION_LABEL: Record<string, string> = {
  PURCHASE: 'Purchase',
  ANIMAL_REGISTRATION: 'Animal Registration',
  MORTALITY: 'Mortality',
};

export const BIO_DOCUMENT_LABEL: Record<string, string> = {
  GOODS_RECEIPT: 'GRN',
  ANIMAL_REGISTRATION: 'Animal Registration',
  MORTALITY: 'Mortality',
};

const qtyText = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : (res?.data ?? res)) as T;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>{label}</p>
      <div className="mt-0.5 font-medium" style={S.primary}>{children}</div>
    </div>
  );
}

export default function BioAssetLedgerDetail({ entryId, initialData, onClose }: { entryId: string; initialData?: Row | null; onClose?: () => void }) {
  const router = useRouter();
  const { formatMoney } = useCompanyCurrency();
  const [entry, setEntry] = useState<Row | null>(initialData ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/bio-asset-ledger/entries/${entryId}`)
      .then((res) => { if (!cancelled) setEntry(unwrap<Row>(res)); })
      .catch((err: any) => { if (!cancelled) setError(err?.message || 'The entry could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entryId]);

  if (!entry) {
    return <div className="py-12 text-center" style={S.sub}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} />Loading entry…</div>;
  }

  const qty = Number(entry.quantity || 0);
  const isPositive = qty > 0;
  const isGrn = entry.entry_type === 'PURCHASE';
  const remaining = Number(entry.remaining_quantity ?? 0);
  const registeredPct = isGrn && qty > 0 ? Math.round(((qty - remaining) / qty) * 100) : 0;
  const applications: Row[] = entry.applications || [];

  return (
    <div className="flex flex-col gap-4 py-1">
      {/* Document header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-xl font-bold" style={S.primary}>{entry.document_no}</h2>
            <Badge variant="neutral" className="text-[11px]">
              <span style={S.muted}>TRANSACTION TYPE:&nbsp;</span><strong>{BIO_TRANSACTION_LABEL[entry.transaction_type] ?? entry.transaction_type}</strong>
            </Badge>
            <span className="inline-flex items-center gap-1 text-[11px]" style={S.muted}>
              ENTRY TYPE: <StatusBadge status={isPositive ? 'POSITIVE' : 'NEGATIVE'} label={isPositive ? 'Positive (+)' : 'Negative (-)'} />
            </span>
            <Badge variant="neutral" className="text-[11px]">{BIO_DOCUMENT_LABEL[entry.document_type] ?? entry.document_type}</Badge>
          </div>
          <span className="flex items-center gap-1 text-xs" style={S.sub}>
            <Calendar className="h-3.5 w-3.5" style={S.muted} /> Posting Date: <strong style={S.primary}>{entry.posting_date}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(isGrn || entry.source_grn_no) && (
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs" onClick={() => router.push('/inventory/goods-receipt')}>
              <ExternalLink className="h-3.5 w-3.5" /> View GRN
            </Button>
          )}
          {entry.animal_id && (
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs" onClick={() => router.push(`/master-data/animal?recordId=${encodeURIComponent(entry.animal_id)}`)}>
              <ExternalLink className="h-3.5 w-3.5" /> View Animal
            </Button>
          )}
          {onClose && <Button variant="ghost" size="sm" className="text-xs" onClick={onClose}>Close</Button>}
        </div>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError('')} />

      {/* Key figures */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col justify-between rounded-[var(--radius-md)] border p-3.5" style={S.surface}>
          <div className="flex items-center justify-between text-xs font-medium" style={S.muted}>
            <span>Quantity</span>
            {isPositive ? <ArrowDownLeft className="h-4 w-4 text-[var(--success)]" /> : <ArrowUpRight className="h-4 w-4 text-[var(--danger)]" />}
          </div>
          <div className="mt-2">
            <p className="font-mono text-xl font-bold" style={{ color: isPositive ? 'var(--success)' : 'var(--danger)' }}>{isPositive ? `+${qtyText(qty)}` : qtyText(qty)}</p>
            <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider" style={S.sub}>{entry.uom || 'HEAD'}</p>
          </div>
        </div>
        <div className="flex flex-col justify-between rounded-[var(--radius-md)] border p-3.5" style={S.surface}>
          <div className="flex items-center justify-between text-xs font-medium" style={S.muted}><span>Unit Cost</span><DollarSign className="h-4 w-4" style={S.accent} /></div>
          <div className="mt-2">
            <p className="font-mono text-xl font-bold" style={S.primary}>{formatMoney(Number(entry.rate || 0))}</p>
            <p className="mt-0.5 text-xs" style={S.sub}>per {entry.uom || 'HEAD'}</p>
          </div>
        </div>
        <div className="flex flex-col justify-between rounded-[var(--radius-md)] border p-3.5" style={S.surface}>
          <div className="flex items-center justify-between text-xs font-medium" style={S.muted}><span>Cost Amount (Actual)</span><Database className="h-4 w-4" style={S.muted} /></div>
          <div className="mt-2">
            <p className="font-mono text-xl font-bold" style={S.primary}>{formatMoney(Number(entry.amount || 0))}</p>
            <p className="mt-0.5 text-xs" style={S.sub}>Total cost valuation</p>
          </div>
        </div>
        <div className="flex flex-col justify-between rounded-[var(--radius-md)] border p-3.5" style={S.surface}>
          <div className="flex items-center justify-between text-xs font-medium" style={S.muted}><span>Remaining Quantity</span><Layers className="h-4 w-4" style={S.muted} /></div>
          <div className="mt-2">
            {isGrn ? (
              <>
                <p className="font-mono text-lg font-bold" style={remaining > 0 ? S.primary : S.muted}>{qtyText(remaining)} {entry.uom}</p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-raised)]">
                    <div className="h-full rounded-full transition-all" style={{ width: `${100 - registeredPct}%`, backgroundColor: remaining > 0 ? 'var(--success)' : 'var(--text-muted)' }} />
                  </div>
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">{100 - registeredPct}% not registered</span>
                </div>
              </>
            ) : entry.transaction_type === 'ANIMAL_REGISTRATION' ? (
              <>
                <p className="text-sm font-semibold" style={S.primary}>{entry.source_grn_no ? `From ${entry.source_grn_no}` : 'Registered'}</p>
                <p className="mt-0.5 text-xs" style={S.sub}>{entry.source_grn_no ? 'Taken from that GRN entry' : 'No source GRN'}</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold" style={S.primary}>Animal died</p>
                <p className="mt-0.5 text-xs" style={S.sub}>Leaves the herd</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Item & general / tracking */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4" style={S.surface}>
          <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: 'var(--border)' }}>
            <Package className="h-4 w-4" style={S.accent} />
            <h3 className="text-sm font-semibold" style={S.primary}>Item & General Information</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Item No."><span className="font-mono font-bold">{entry.item_code}</span></Field>
            <Field label="Unit of Measure Code">{entry.uom || NA}</Field>
            <div className="col-span-2"><Field label="Description">{entry.item_description}</Field></div>
            <div className="col-span-2">
              <Field label="Location Code">
                {entry.warehouse_code ? <><span className="font-mono">{entry.warehouse_code}</span>{entry.warehouse_name ? <span style={S.sub}> ({entry.warehouse_name})</span> : null}</> : NA}
              </Field>
            </div>
            <Field label="Transaction Type">{BIO_TRANSACTION_LABEL[entry.transaction_type] ?? entry.transaction_type}</Field>
            <Field label="Entry Type"><StatusBadge status={isPositive ? 'POSITIVE' : 'NEGATIVE'} label={isPositive ? 'Positive (+)' : 'Negative (-)'} /></Field>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4" style={S.surface}>
          <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: 'var(--border)' }}>
            <ShieldCheck className="h-4 w-4" style={S.accent} />
            <h3 className="text-sm font-semibold" style={S.primary}>Animal Tracking (Traceability)</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Field label="Animal">
              {entry.animal_id
                ? <a className="text-(--accent) hover:underline" href={`/master-data/animal?recordId=${encodeURIComponent(entry.animal_id)}`}>{entry.animal_code || entry.document_no}</a>
                : NA}
            </Field>
            <Field label="Source GRN">{entry.source_grn_no ? <span className="font-mono">{entry.source_grn_no}{entry.source_entry_no ? ` (entry ${entry.source_entry_no})` : ''}</span> : isGrn ? <span className="font-mono">{entry.document_no}</span> : NA}</Field>
            <Field label="Lot No.">{entry.lot_no || 'Not Lot Tracked'}</Field>
            <Field label="Production Batch No.">{entry.batch_no || NA}</Field>
            <Field label="Status">{entry.status || NA}</Field>
            <Field label="Created At">{entry.created_at ? String(entry.created_at).replace('T', ' ').slice(0, 19) : NA}</Field>
          </div>
        </div>
      </div>

      {/* Animals registered from a GRN — its applications */}
      {isGrn && (
        <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <span className="flex items-center gap-2 text-sm font-semibold" style={S.primary}><Layers className="h-4 w-4" style={S.accent} /> Animals Registered from this GRN</span>
            <span className="font-mono text-xs" style={S.muted}>{loading ? '…' : `${applications.length} ${applications.length === 1 ? 'animal' : 'animals'}`}</span>
          </div>
          {applications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={S.sub}>No animal has been registered from this GRN yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <TableHeader>
                  <tr className="border-b border-(--row-border)">
                    <TableHead>Entry No.</TableHead>
                    <TableHead>Posting Date</TableHead>
                    <TableHead>Animal</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Unit Cost</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {applications.map((a) => (
                    <TableRow key={a.entry_id}>
                      <TableCell className="font-mono font-semibold" style={S.primary}>{a.entry_no}</TableCell>
                      <TableCell style={S.primary}>{a.posting_date}</TableCell>
                      <TableCell>
                        <a className="font-mono text-xs text-(--accent) hover:underline" href={`/master-data/animal?recordId=${encodeURIComponent(a.animal_id)}`}>{a.animal_code || a.document_no}</a>
                      </TableCell>
                      <TableCell className="font-mono text-xs" style={S.sub}>{a.warehouse_code || NA}</TableCell>
                      <TableCell className="text-right font-mono text-xs" style={{ color: 'var(--danger)' }}>-{qtyText(Number(a.quantity || 1))}</TableCell>
                      <TableCell className="text-right font-mono text-xs" style={S.sub}>{formatMoney(Number(a.rate || 0))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
