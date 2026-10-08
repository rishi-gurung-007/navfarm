"use client";

import { Badge } from "@/components/ui/badge";
import { InlineAlert } from "@/components/ui/alert";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

/** What GET /inventory/ledger/:id returns under `costing` for an issue (costing-explanation.ts in the API). */
export interface CostingExplanation {
  method: "FIFO" | "AVG" | "STANDARD";
  quantity: number;
  total_cost: number;
  unit_cost: number;
  draws: Array<{
    inbound_entry_no: number | null;
    document_no: string | null;
    posting_date: string | null;
    lot_no: string | null;
    receipt_rate: number;
    quantity: number;
    amount: number;
    unit_cost: number;
    formula_amount: number;
  }>;
  average: null | {
    receipts: Array<{ entry_no: number | null; document_no: string | null; posting_date: string | null; transaction_type: string | null; quantity: number; rate: number; amount: number }>;
    receipts_quantity: number;
    receipts_value: number;
    issued_quantity: number;
    issued_value: number;
    book_quantity: number;
    book_value: number;
    average_rate: number;
    fallback: boolean;
  };
  standard_cost: number | null;
  recomputed_cost: number;
  matches: boolean;
}

const S = {
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
  border: { borderColor: "var(--border)" },
};

const qty = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
/** A unit rate to four places: the average is rarely a round number and the formula should show what it multiplies by. */
const rate = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const METHOD_TITLE: Record<CostingExplanation["method"], string> = {
  FIFO: "FIFO — First In, First Out",
  AVG: "Average — moving average",
  STANDARD: "Standard cost",
};

const METHOD_RULE: Record<CostingExplanation["method"], string> = {
  FIFO: "Stock leaves the oldest receipt first, and each part is priced at the rate of the receipt it came from.",
  AVG: "Every unit is priced at the average of the stock held: book value ÷ book quantity, taken from every movement before this entry. Issuing stock does not change the average; a new receipt does.",
  STANDARD: "Every unit is priced at the item's standard cost, whatever the receipts cost.",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold" style={S.primary}>
        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]" style={{ backgroundColor: "var(--accent)", color: "var(--surface)" }}>{n}</span>
        {title}
      </p>
      {children}
    </div>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border px-3 py-2 font-mono text-xs font-semibold" style={{ ...S.border, backgroundColor: "var(--surface-raised)", ...S.primary }}>
      {children}
    </div>
  );
}

export function CostingCalculation({ costing, uom, formatMoney }: { costing: CostingExplanation; uom: string; formatMoney: (n: number) => string }) {
  const c = costing;
  const avg = c.average;
  const shownReceipts = avg ? avg.receipts.reduce((n, r) => n + r.quantity, 0) : 0;

  return (
    <div className="space-y-5 border-t px-4 py-4" style={S.border} data-testid="costing-calculation">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="accent">{METHOD_TITLE[c.method]}</Badge>
          <span className="text-xs" style={S.muted}>the item&apos;s costing method</span>
        </div>
        <p className="mt-2 text-xs" style={S.sub}>{METHOD_RULE[c.method]}</p>
      </div>

      {!c.matches && (
        <InlineAlert variant="warning">
          The cost posted ({formatMoney(c.total_cost)}) is not what the item&apos;s current method gives ({formatMoney(c.recomputed_cost)}) — the
          costing method may have been changed after this entry was posted. The amounts below are what was actually posted.
        </InlineAlert>
      )}

      {/* ── FIFO ── */}
      {c.method === "FIFO" && (
        <>
          <Step n={1} title="Take stock from the oldest receipts first, each at its own rate">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <TableHeader>
                  <tr className="border-b" style={S.border}>
                    <TableHead className="py-2 px-3">Receipt Entry No.</TableHead>
                    <TableHead className="py-2 px-3">Receipt Date</TableHead>
                    <TableHead className="py-2 px-3">Document</TableHead>
                    <TableHead className="py-2 px-3 text-right">Quantity Taken</TableHead>
                    <TableHead className="py-2 px-3 text-right">× Receipt Rate</TableHead>
                    <TableHead className="py-2 px-3 text-right">= Amount</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {c.draws.map((d, i) => (
                    <TableRow key={`${d.inbound_entry_no}-${i}`} style={S.border}>
                      <TableCell className="py-2 px-3 font-mono font-semibold" style={S.primary}>#{d.inbound_entry_no}{d.lot_no ? ` · ${d.lot_no}` : ""}</TableCell>
                      <TableCell className="py-2 px-3 font-mono" style={S.sub}>{d.posting_date || "—"}</TableCell>
                      <TableCell className="py-2 px-3 font-mono" style={S.sub}>{d.document_no || "—"}</TableCell>
                      <TableCell className="py-2 px-3 font-mono text-right" style={S.primary}>{qty(d.quantity)} {uom}</TableCell>
                      <TableCell className="py-2 px-3 font-mono text-right" style={S.primary}>{rate(d.unit_cost)}</TableCell>
                      <TableCell className="py-2 px-3 font-mono text-right font-semibold" style={S.primary}>{formatMoney(d.amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow style={{ ...S.border, backgroundColor: "var(--surface-raised)" }}>
                    <TableCell colSpan={3} className="py-2 px-3 text-right font-semibold" style={S.sub}>Total</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-right font-semibold" style={S.primary}>{qty(c.quantity)} {uom}</TableCell>
                    <TableCell className="py-2 px-3" />
                    <TableCell className="py-2 px-3 font-mono text-right font-semibold" style={S.primary}>{formatMoney(c.total_cost)}</TableCell>
                  </TableRow>
                </TableBody>
              </table>
            </div>
          </Step>
          <Step n={2} title="Cost of this entry = the sum of the parts">
            <Formula>
              {c.draws.map((d) => `${qty(d.quantity)} × ${rate(d.unit_cost)}`).join("  +  ")}  =  {formatMoney(c.total_cost)}
            </Formula>
            <p className="text-xs" style={S.muted}>
              Overall {formatMoney(c.total_cost)} ÷ {qty(c.quantity)} {uom} = {rate(c.unit_cost)} per {uom}.
            </p>
          </Step>
        </>
      )}

      {/* ── Average ── */}
      {c.method === "AVG" && avg && (
        <>
          <Step n={1} title={`Stock book before this entry (everything posted ahead of it at this location)`}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <TableHeader>
                  <tr className="border-b" style={S.border}>
                    <TableHead className="py-2 px-3">Entry No.</TableHead>
                    <TableHead className="py-2 px-3">Date</TableHead>
                    <TableHead className="py-2 px-3">Document</TableHead>
                    <TableHead className="py-2 px-3 text-right">Quantity In</TableHead>
                    <TableHead className="py-2 px-3 text-right">Rate</TableHead>
                    <TableHead className="py-2 px-3 text-right">Value</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {avg.receipts.map((r, i) => (
                    <TableRow key={`${r.entry_no}-${i}`} style={S.border}>
                      <TableCell className="py-2 px-3 font-mono font-semibold" style={S.primary}>#{r.entry_no}</TableCell>
                      <TableCell className="py-2 px-3 font-mono" style={S.sub}>{r.posting_date || "—"}</TableCell>
                      <TableCell className="py-2 px-3 font-mono" style={S.sub}>{r.document_no || "—"}{r.transaction_type === "REVERSAL" ? " (reversal)" : ""}</TableCell>
                      <TableCell className="py-2 px-3 font-mono text-right" style={S.primary}>{qty(r.quantity)} {uom}</TableCell>
                      <TableCell className="py-2 px-3 font-mono text-right" style={S.primary}>{rate(r.rate)}</TableCell>
                      <TableCell className="py-2 px-3 font-mono text-right" style={S.primary}>{formatMoney(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                  {Math.abs(shownReceipts - avg.receipts_quantity) > 0.0001 && (
                    <TableRow style={S.border}>
                      <TableCell colSpan={6} className="py-2 px-3 text-center text-[11px]" style={S.muted}>
                        …only the first {avg.receipts.length} receipts are listed; the totals below include all of them.
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow style={{ ...S.border, backgroundColor: "var(--surface-raised)" }}>
                    <TableCell colSpan={3} className="py-2 px-3 text-right font-semibold" style={S.sub}>Total received</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-right font-semibold" style={S.primary}>{qty(avg.receipts_quantity)} {uom}</TableCell>
                    <TableCell className="py-2 px-3" />
                    <TableCell className="py-2 px-3 font-mono text-right font-semibold" style={S.primary}>{formatMoney(avg.receipts_value)}</TableCell>
                  </TableRow>
                  <TableRow style={S.border}>
                    <TableCell colSpan={3} className="py-2 px-3 text-right" style={S.sub}>Less: issued before this entry</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-right" style={{ color: "var(--danger)" }}>− {qty(avg.issued_quantity)} {uom}</TableCell>
                    <TableCell className="py-2 px-3" />
                    <TableCell className="py-2 px-3 font-mono text-right" style={{ color: "var(--danger)" }}>− {formatMoney(avg.issued_value)}</TableCell>
                  </TableRow>
                  <TableRow style={{ ...S.border, backgroundColor: "var(--surface-raised)" }}>
                    <TableCell colSpan={3} className="py-2 px-3 text-right font-semibold" style={S.sub}>Book (what the stock stands at)</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-right font-semibold" style={S.primary}>{qty(avg.book_quantity)} {uom}</TableCell>
                    <TableCell className="py-2 px-3" />
                    <TableCell className="py-2 px-3 font-mono text-right font-semibold" style={S.primary}>{formatMoney(avg.book_value)}</TableCell>
                  </TableRow>
                </TableBody>
              </table>
            </div>
          </Step>

          {avg.fallback ? (
            <Step n={2} title="No quantity on the book to average over">
              <p className="text-xs" style={S.sub}>
                With nothing costed on the book there is no average to take, so each receipt used is priced at its own rate (as FIFO would).
              </p>
              <Formula>
                {c.draws.map((d) => `${qty(d.quantity)} × ${rate(d.receipt_rate)}`).join("  +  ")}  =  {formatMoney(c.total_cost)}
              </Formula>
            </Step>
          ) : (
            <>
              <Step n={2} title="Average rate = book value ÷ book quantity">
                <Formula>{formatMoney(avg.book_value)} ÷ {qty(avg.book_quantity)} {uom}  =  {rate(avg.average_rate)} per {uom}</Formula>
              </Step>
              <Step n={3} title="Cost of this entry = quantity issued × average rate">
                <Formula>{qty(c.quantity)} {uom} × {rate(avg.average_rate)}  =  {formatMoney(c.total_cost)}</Formula>
              </Step>
              <Step n={4} title="Charged against the receipts used (oldest first), all at the average rate">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <TableHeader>
                      <tr className="border-b" style={S.border}>
                        <TableHead className="py-2 px-3">Receipt Entry No.</TableHead>
                        <TableHead className="py-2 px-3">Receipt Rate</TableHead>
                        <TableHead className="py-2 px-3 text-right">Quantity</TableHead>
                        <TableHead className="py-2 px-3 text-right">× Average Rate</TableHead>
                        <TableHead className="py-2 px-3 text-right">= Amount</TableHead>
                      </tr>
                    </TableHeader>
                    <TableBody>
                      {c.draws.map((d, i) => (
                        <TableRow key={`${d.inbound_entry_no}-${i}`} style={S.border}>
                          <TableCell className="py-2 px-3 font-mono font-semibold" style={S.primary}>#{d.inbound_entry_no}{d.lot_no ? ` · ${d.lot_no}` : ""}</TableCell>
                          <TableCell className="py-2 px-3 font-mono" style={S.sub}>{rate(d.receipt_rate)}</TableCell>
                          <TableCell className="py-2 px-3 font-mono text-right" style={S.primary}>{qty(d.quantity)} {uom}</TableCell>
                          <TableCell className="py-2 px-3 font-mono text-right" style={S.primary}>{rate(d.unit_cost)}</TableCell>
                          <TableCell className="py-2 px-3 font-mono text-right font-semibold" style={S.primary}>{formatMoney(d.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
                <p className="text-xs" style={S.muted}>
                  The receipts are only used up in order for tracking; their own rates do not change the price. After this entry the book is {qty(avg.book_quantity - c.quantity)} {uom} worth {formatMoney(avg.book_value - c.total_cost)}.
                </p>
              </Step>
            </>
          )}
        </>
      )}

      {/* ── Standard ── */}
      {c.method === "STANDARD" && (
        <Step n={1} title="Cost of this entry = quantity issued × standard cost">
          <Formula>{qty(c.quantity)} {uom} × {rate(c.standard_cost ?? 0)}  =  {formatMoney(c.total_cost)}</Formula>
        </Step>
      )}
    </div>
  );
}
