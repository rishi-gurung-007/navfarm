'use client';

import { useMemo, useState } from 'react';
import { ArrowDownUp, ChevronDown, Layers, Loader2 } from 'lucide-react';
import { Pagination } from '@/components/ui/pagination';
import { BIO_DOCUMENT_LABEL, BIO_EVENT_LABEL } from '../inventory/bio-asset-ledger-detail';
import { formatEntryType, formatTransactionType } from '../inventory/inventory-ledger-detail';

type Row = Record<string, any>;

interface Formatters {
  date: (value?: string | null) => string;
  money: (value?: number | string | null) => string;
  quantity: (value?: unknown) => string;
}

/** What a posting is called on screen: whatever is consumed reads Consumption; otherwise the event the API read from the row's codes; a manual entry, its document. */
export function postingLabel(entry: Row): string {
  if (entry.transaction_type === 'CONSUMPTION') return 'Consumption';
  if (entry.event) return BIO_EVENT_LABEL[entry.event] ?? entry.event;
  return `${BIO_DOCUMENT_LABEL[entry.document_type] ?? entry.document_type} · ${formatTransactionType(entry.transaction_type)}`;
}

const amountOf = (entry: Row): number => Number(entry.cost_amount ?? (entry.computed_cost || entry.amount) ?? 0) || 0;
const PAGE_SIZES = [10, 25, 50];

/**
 * An animal's Bio-Asset Ledger postings, as a card that folds away to a one-line summary, with the postings filtered by kind, ordered newest or oldest first,
 * and paged. Folded, it still says how many postings there are, what they add up to (her carrying value) and the date of the last.
 */
export function AnimalLedgerPostings({ entries, loading, format }: { entries: Row[]; loading: boolean; format: Formatters }) {
  const [open, setOpen] = useState(true);
  const [kind, setKind] = useState<string>('ALL');
  const [newestFirst, setNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(postingLabel(entry), (counts.get(postingLabel(entry)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const net = useMemo(() => entries.reduce((sum, entry) => sum + amountOf(entry), 0), [entries]);
  const last = useMemo(() => entries.reduce((latest, entry) => (String(entry.posting_date) > latest ? String(entry.posting_date) : latest), ''), [entries]);

  const shown = useMemo(() => {
    const filtered = kind === 'ALL' ? entries : entries.filter((entry) => postingLabel(entry) === kind);
    // Date, then entry number where the rows carry one, so postings of one day keep the order they were made in.
    const sorted = [...filtered].sort((a, b) => String(a.posting_date).localeCompare(String(b.posting_date)) || Number(a.entry_no ?? 0) - Number(b.entry_no ?? 0));
    return newestFirst ? sorted.reverse() : sorted;
  }, [entries, kind, newestFirst]);

  const pageRows = shown.slice((page - 1) * pageSize, page * pageSize);
  const pickKind = (next: string) => { setKind(next); setPage(1); };

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-2xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] px-4 py-3 text-left transition hover:bg-[var(--surface-raised)]/60"
      >
        <span className="flex items-center gap-2">
          <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${open ? '' : '-rotate-90'}`} />
          <Layers className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span className="font-bold text-[var(--text-primary)] uppercase tracking-wider text-[11px]">Bio-Asset Ledger Postings</span>
          <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-bold font-mono text-[var(--accent)]">{entries.length}</span>
        </span>
        {entries.length > 0 && (
          <span className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
            <span>Net <span className="font-mono font-bold text-[var(--text-primary)]">{format.money(net)}</span></span>
            {last && <span className="hidden sm:inline">Last posting <span className="font-mono text-[var(--text-secondary)]">{format.date(last)}</span></span>}
            <span className="text-[10px] uppercase tracking-wider">{open ? 'Hide' : 'Show'}</span>
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-[var(--border)] px-4 pb-3 pt-3">
          {loading ? (
            <div className="py-8 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--text-muted)]" />
              <p className="mt-2 text-xs text-[var(--text-muted)]">Loading ledger entries…</p>
            </div>
          ) : entries.length === 0 ? (
            <p className="py-4 text-center text-[var(--text-muted)]">
              No standalone bio-asset ledger entries posted yet. Valuation reflects registered acquisition cost.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter postings by kind">
                  {[['ALL', entries.length] as [string, number], ...kinds].map(([label, count]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => pickKind(label)}
                      aria-pressed={kind === label}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                        kind === label
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                          : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-raised)]'
                      }`}
                    >
                      {label === 'ALL' ? 'All' : label} <span className="font-mono opacity-70">{count}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => { setNewestFirst((v) => !v); setPage(1); }}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-raised)]"
                >
                  <ArrowDownUp className="h-3 w-3" /> {newestFirst ? 'Newest first' : 'Oldest first'}
                </button>
              </div>

              <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[10px] uppercase font-bold text-[var(--text-muted)] bg-[var(--surface-raised)]">
                      <th className="px-3 py-2">Posting Date</th>
                      <th className="px-3 py-2">Entry Type</th>
                      <th className="px-3 py-2 text-right">Unit Cost / Rate</th>
                      <th className="px-3 py-2 text-right">Quantity</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {pageRows.map((entry, index) => {
                      const amount = amountOf(entry);
                      return (
                        <tr key={entry.entry_id || entry.ledger_id || index} className="hover:bg-[var(--surface-raised)]/60">
                          <td className="px-3 py-2 font-mono text-[var(--text-primary)]">{format.date(entry.posting_date)}</td>
                          <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">
                            {/* The pair of types and the document are the hover text. */}
                            <span title={`${formatEntryType(entry.entry_type)} · ${formatTransactionType(entry.transaction_type)} · ${BIO_DOCUMENT_LABEL[entry.document_type] ?? entry.document_type}`}>
                              {postingLabel(entry)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[var(--text-secondary)]">{format.money(entry.cost_amount_each_unit ?? entry.unit_cost)}</td>
                          <td className="px-3 py-2 text-right font-mono text-[var(--text-secondary)]">{format.quantity(entry.quantity ?? 1)}</td>
                          <td className={`px-3 py-2 text-right font-mono font-bold ${amount < 0 ? 'text-[var(--danger,#dc2626)]' : 'text-[var(--text-primary)]'}`}>
                            {format.money(entry.cost_amount ?? (entry.computed_cost || entry.amount))}
                          </td>
                          <td className="px-3 py-2 font-mono text-[var(--text-muted)]">{entry.document_no || entry.posting_reference || entry.reference || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={page}
                pageSize={pageSize}
                total={shown.length}
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
                pageSizeOptions={PAGE_SIZES}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
