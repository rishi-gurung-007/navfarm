"use client";

import { useEffect, useState } from "react";
import { 
  Copy, 
  Check, 
  Eye, 
  Loader2, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Inbox
} from "lucide-react";
import { api } from "@/services/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatBcDocumentType, formatBcEntryType } from "./inventory-ledger-detail";

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
};

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

interface ItemLedgerHistoryCardProps {
  itemId: string;
  companyId?: string | null;
  onClose?: () => void;
  onViewLedgerEntry?: (entry: Row) => void;
}

export default function ItemLedgerHistoryCard({
  itemId,
  companyId,
  onClose,
  onViewLedgerEntry,
}: ItemLedgerHistoryCardProps) {
  const { formatMoney } = useCompanyCurrency();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<Row | null>(null);
  const [activeTab, setActiveTab] = useState<"inbound" | "outbound">("inbound");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  useEffect(() => {
    let cancelled = false;
    if (!itemId || !companyId) return;

    setLoading(true);
    setError("");

    api.get(`/inventory-ledger/item-history/${itemId}?companyId=${companyId}`)
      .then((res) => {
        if (!cancelled) {
          setData(unwrap<Row>(res));
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err?.message || "Failed to load inventory ledger history.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [itemId, companyId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center" style={S.sub}>
        <Loader2 className="mb-3 h-7 w-7 animate-spin" style={S.accent} />
        <p className="text-sm font-medium">Loading item stock & ledger history…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <InlineAlert>{error || "No data available."}</InlineAlert>
        {onClose && (
          <Button variant="outline" size="sm" onClick={onClose} className="mt-4">
            Close
          </Button>
        )}
      </div>
    );
  }

  const { item, summary, inbound_entries = [], outbound_entries = [] } = data;

  return (
    <div className="flex flex-col gap-5">
      {/* Top Item Summary Card */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-[var(--radius-md)] border p-4" style={S.surface}>
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>Item Code & Name</span>
          <p className="mt-0.5 font-mono text-sm font-bold truncate" style={S.primary} title={item.item_name}>
            {item.item_code}
          </p>
          <p className="text-xs truncate" style={S.sub} title={item.item_name}>
            {item.item_name}
          </p>
        </div>

        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>Costing Method / UOM</span>
          <div className="mt-1 flex items-center gap-1.5">
            <Badge variant="accent" className="font-mono text-xs">
              {item.valuation_method || "FIFO"}
            </Badge>
            <span className="text-xs font-mono font-medium" style={S.sub}>
              {item.uom_primary}
            </span>
          </div>
        </div>

        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>Current On-Hand Stock</span>
          <p className="mt-0.5 font-mono text-lg font-bold text-[var(--success)]">
            {Number(summary.total_on_hand || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {item.uom_primary}
          </p>
          <span className="text-[10px]" style={S.muted}>
            Active FIFO Layers
          </span>
        </div>

        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>Total Stock Valuation</span>
          <p className="mt-0.5 font-mono text-lg font-bold" style={S.primary}>
            {formatMoney(Number(summary.total_valuation || 0))}
          </p>
          <span className="text-[10px]" style={S.muted}>
            Layer Cost Sum
          </span>
        </div>
      </div>

      {/* Tabs Header */}
      <div className="flex border-b text-xs font-semibold" style={{ borderColor: "var(--border)" }}>
        <button
          type="button"
          onClick={() => setActiveTab("inbound")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition ${
            activeTab === "inbound"
              ? "border-[var(--accent)] text-[var(--accent)] font-bold"
              : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <ArrowDownLeft className="h-4 w-4 text-[var(--success)]" />
          Purchases & Inbound Layers ({inbound_entries.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("outbound")}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 transition ${
            activeTab === "outbound"
              ? "border-[var(--accent)] text-[var(--accent)] font-bold"
              : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <ArrowUpRight className="h-4 w-4 text-[var(--danger)]" />
          Consumptions & Outbound Movements ({outbound_entries.length})
        </button>
      </div>

      {/* Tab 1: Inbound Purchases & FIFO Layers */}
      {activeTab === "inbound" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={S.sub}>
            Showing all inbound receipts and positive transfer layers. Each layer maintains an independent remaining balance until drawn down via FIFO.
          </p>

          {inbound_entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center rounded-[var(--radius-md)] border" style={S.surface}>
              <Inbox className="mb-2 h-6 w-6" style={S.muted} />
              <p className="text-xs font-medium" style={S.sub}>No purchase or inbound receipts recorded for this item.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader>
                    <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                      <TableHead className="py-2.5 px-3">Entry No.</TableHead>
                      <TableHead className="py-2.5 px-3">Posting Date</TableHead>
                      <TableHead className="py-2.5 px-3">Document No.</TableHead>
                      <TableHead className="py-2.5 px-3">Location</TableHead>
                      <TableHead className="py-2.5 px-3 text-center">Tracking</TableHead>
                      <TableHead className="py-2.5 px-3 text-right">Received Qty</TableHead>
                      <TableHead className="py-2.5 px-3 text-right">Remaining Qty</TableHead>
                      <TableHead className="py-2.5 px-3 text-right">Unit Cost</TableHead>
                      <TableHead className="py-2.5 px-3 text-right">Current Valuation</TableHead>
                      <TableHead className="py-2.5 px-3 text-center">Status</TableHead>
                      <TableHead className="py-2.5 px-3 text-center">Action</TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {inbound_entries.map((layer: Row) => {
                      const qty = Number(layer.quantity || 0);
                      const rem = Number(layer.remaining_quantity ?? qty);
                      const rate = Number(layer.rate || 0);
                      const currentVal = rem * rate;
                      const consumedPct = qty > 0 ? Math.min(100, Math.round(((qty - rem) / qty) * 100)) : 0;
                      const isFullyConsumed = rem <= 0.0001;

                      return (
                        <TableRow key={layer.ledger_id} style={{ borderColor: "var(--border)" }}>
                          <TableCell className="py-2.5 px-3 font-mono font-semibold" style={S.primary}>
                            #{layer.entry_no}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 font-mono" style={S.primary}>
                            {layer.posting_date}
                          </TableCell>
                          <TableCell className="py-2.5 px-3">
                            <div className="flex flex-col">
                              <span className="font-mono font-bold" style={S.primary}>{layer.document_no}</span>
                              <span className="text-[10px]" style={S.muted}>{formatBcDocumentType(layer.document_type)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 px-3 font-mono" style={S.sub}>
                            {layer.warehouse_code || layer.warehouse_name || "—"}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 text-xs text-center" style={S.sub}>
                            {layer.lot_no || layer.serial_no ? (
                              <Badge
                                variant="success"
                                className="text-[10px] font-semibold cursor-default"
                                title={
                                  layer.serial_no
                                    ? `Serial No(s): ${layer.serial_no}`
                                    : `Lot: ${layer.lot_no}`
                                }
                              >
                                Yes
                              </Badge>
                            ) : (
                              <span style={S.muted}>No</span>
                            )}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 font-mono text-right font-semibold" style={S.primary}>
                            +{qty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {layer.uom}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 font-mono text-right">
                            <span className={isFullyConsumed ? "text-[var(--text-muted)] line-through" : "font-bold text-[var(--success)]"}>
                              {rem.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {layer.uom}
                            </span>
                            <div className="mt-0.5 flex items-center justify-end gap-1">
                              <div className="h-1 w-14 overflow-hidden rounded-full bg-[var(--surface-raised)]">
                                <div 
                                  className="h-full rounded-full transition-all"
                                  style={{ 
                                    width: `${100 - consumedPct}%`, 
                                    backgroundColor: rem > 0 ? "var(--success)" : "var(--text-muted)" 
                                  }} 
                                />
                              </div>
                              <span className="text-[9px] text-[var(--text-muted)]">{100 - consumedPct}%</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 px-3 font-mono text-right" style={S.primary}>
                            {formatMoney(rate)}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 font-mono text-right font-semibold" style={rem > 0 ? S.primary : S.muted}>
                            {formatMoney(currentVal)}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 text-center">
                            {isFullyConsumed ? (
                              <Badge variant="neutral" className="text-[10px]">Consumed</Badge>
                            ) : (
                              <Badge variant="accent" className="text-[10px]">Active Layer</Badge>
                            )}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 text-center">
                            {onViewLedgerEntry && (
                              <button
                                type="button"
                                onClick={() => onViewLedgerEntry(layer)}
                                className="inline-flex items-center justify-center rounded p-1 hover:bg-[var(--surface-raised)] transition"
                                title="View Ledger Entry Details & Drawdowns"
                                style={S.sub}
                              >
                                <Eye className="h-3.5 w-3.5" style={S.accent} />
                              </button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Outbound Consumptions & Linked Application IDs */}
      {activeTab === "outbound" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={S.sub}>
            Showing all stock consumptions, issues, and transfers out. Each consumption links back to the exact purchase layer(s) and records the Application ID and applied unit cost.
          </p>

          {outbound_entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center rounded-[var(--radius-md)] border" style={S.surface}>
              <Inbox className="mb-2 h-6 w-6" style={S.muted} />
              <p className="text-xs font-medium" style={S.sub}>No consumptions or issues recorded for this item.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader>
                    <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                      <TableHead className="py-2.5 px-3">Entry No.</TableHead>
                      <TableHead className="py-2.5 px-3">Posting Date</TableHead>
                      <TableHead className="py-2.5 px-3">Document No.</TableHead>
                      <TableHead className="py-2.5 px-3">Transaction Type</TableHead>
                      <TableHead className="py-2.5 px-3">Location</TableHead>
                      <TableHead className="py-2.5 px-3 text-right">Consumed Qty</TableHead>
                      <TableHead className="py-2.5 px-3 text-right">Applied Unit Cost</TableHead>
                      <TableHead className="py-2.5 px-3 text-right">Total Cost</TableHead>
                      <TableHead className="py-2.5 px-3">Consumed From Entry No. (Qty × Unit Cost = Cost)</TableHead>
                      <TableHead className="py-2.5 px-3 text-center">Action</TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {outbound_entries.map((out: Row) => {
                      const qty = Math.abs(Number(out.quantity || 0));
                      const amt = Math.abs(Number(out.amount || 0));
                      const rate = Number(out.rate || (qty > 0 ? amt / qty : 0));
                      const apps: Row[] = out.applications || [];

                      return (
                        <TableRow key={out.ledger_id} style={{ borderColor: "var(--border)" }}>
                          <TableCell className="py-2.5 px-3 font-mono font-semibold" style={S.primary}>
                            #{out.entry_no}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 font-mono" style={S.primary}>
                            {out.posting_date}
                          </TableCell>
                          <TableCell className="py-2.5 px-3">
                            <div className="flex flex-col">
                              <span className="font-mono font-bold" style={S.primary}>{out.document_no}</span>
                              <span className="text-[10px]" style={S.muted}>
                                {out.batch_no ? `Batch: ${out.batch_no}` : formatBcDocumentType(out.document_type)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 px-3" style={S.sub}>
                            {formatBcEntryType(out.transaction_type)}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 font-mono" style={S.sub}>
                            {out.warehouse_code || out.warehouse_name || "—"}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 font-mono text-right font-semibold text-[var(--danger)]">
                            -{qty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {out.uom}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 font-mono text-right" style={S.primary}>
                            {formatMoney(rate)}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 font-mono text-right font-medium" style={S.primary}>
                            {formatMoney(amt)}
                          </TableCell>
                          <TableCell className="py-2.5 px-3">
                            {apps.length === 0 ? (
                              <span className="text-[11px]" style={S.muted}>— Direct cost adjustment —</span>
                            ) : (
                              <div className="flex flex-col gap-1.5">
                                {apps.map((app) => (
                                  <div key={app.application_id} className="flex flex-wrap items-center gap-1.5 rounded p-1 border" style={S.raised}>
                                    <span className="font-mono text-[11px] font-bold text-[var(--accent)]" title={`Application ${app.application_id}`}>
                                      Entry #{app.inbound_entry_no}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(app.application_id, app.application_id)}
                                      className="rounded p-0.5 hover:bg-[var(--surface)]"
                                      title="Copy Application ID"
                                    >
                                      {copiedKey === app.application_id ? <Check className="h-2.5 w-2.5 text-green-500" /> : <Copy className="h-2.5 w-2.5" style={S.muted} />}
                                    </button>
                                    <span className="text-[10px]" style={S.muted}>from</span>
                                    <span className="font-mono text-[10px] font-bold" style={S.primary}>
                                      {app.inbound_document_no || "GRN"}
                                    </span>
                                    <span className="font-mono text-[10px] font-medium" style={S.sub}>
                                      ({Number(app.applied_qty).toLocaleString()} × {formatMoney(Number(app.unit_cost ?? app.inbound_rate ?? 0))} = {formatMoney(Number(app.applied_cost_amount || 0))})
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="py-2.5 px-3 text-center">
                            {onViewLedgerEntry && (
                              <button
                                type="button"
                                onClick={() => onViewLedgerEntry(out)}
                                className="inline-flex items-center justify-center rounded p-1 hover:bg-[var(--surface-raised)] transition"
                                title="View Ledger Entry Details"
                                style={S.sub}
                              >
                                <Eye className="h-3.5 w-3.5" style={S.accent} />
                              </button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
