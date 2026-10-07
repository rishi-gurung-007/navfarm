"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  ArrowLeft, 
  ExternalLink, 
  Copy, 
  Check, 
  Layers, 
  Calendar, 
  Building2, 
  Clock, 
  Hash, 
  Package, 
  DollarSign, 
  ArrowDownLeft, 
  ArrowUpRight, 
  FileText,
  ShieldCheck,
  Loader2,
  Database
} from "lucide-react";
import { api } from "@/services/api-client";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

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

export const BC_ENTRY_TYPES: Record<string, string> = {
  PURCHASE: "Purchase",
  CONSUMPTION: "Consumption",
  OUTPUT: "Output",
  TRANSFER_SHIPMENT: "Transfer_Shipment",
  TRANSFER_RECEIPT: "Transfer_Receipt",
  SALES: "Sales",
  VARIANCE_POSITIVE: "Variance_Positive",
  VARIANCE_NEGATIVE: "Variance_Negative",
  BATCH_CONSUMPTION: "Consumption",
  BATCH_INPUT: "Consumption",
  BATCH_OUTPUT: "Output",
  BIO_OUTPUT: "Output",
  REVERSAL: "Reversal",
  OVERHEAD: "Overhead",
  DESCRIPTIVE: "Descriptive",
};

export const formatBcEntryType = (type?: string) => {
  if (!type) return "—";
  const upper = type.toUpperCase();
  if (BC_ENTRY_TYPES[upper]) return BC_ENTRY_TYPES[upper];
  return upper.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export const formatBcEntryTypeLabel = (entryType?: string) => {
  if (!entryType) return "—";
  const upper = entryType.toUpperCase();
  if (upper === "POSITIVE") return "Positive (+)";
  if (upper === "NEGATIVE") return "Negative (-)";
  if (upper === "TRANSFER") return "Transfer";
  if (upper === "OVERHEAD") return "Overhead";
  if (upper === "DESCRIPTIVE") return "Descriptive";
  return upper.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export const BC_DOCUMENT_TYPES: Record<string, string> = {
  GOODS_RECEIPT: "GRN",
  STOCK_TRANSFER: "Transfer Order",
  STOCK_ADJUSTMENT: "Stock Adjustment",
  BATCH: "Batch",
  DAILY_ENTRY: "Daily Operations Entry",
};

export const formatBcDocumentType = (type?: string) => {
  if (!type) return "—";
  return BC_DOCUMENT_TYPES[type.toUpperCase()] || type.replace(/_/g, " ");
};

export const getSourceDocumentRoute = (documentType?: string) => {
  if (!documentType) return null;
  const upper = documentType.toUpperCase();
  if (upper === "GOODS_RECEIPT") return "/inventory/goods-receipt";
  if (upper === "STOCK_TRANSFER") return "/inventory/transfers";
  if (upper === "STOCK_ADJUSTMENT") return "/inventory/stock-adjustment";
  if (upper === "BATCH" || upper === "DAILY_ENTRY") return "/batches";
  return null;
};

interface InventoryLedgerDetailProps {
  ledgerId: string;
  initialData?: Row | null;
  onClose?: () => void;
  onOpenFullPage?: () => void;
  isStandalone?: boolean;
}

export default function InventoryLedgerDetail({
  ledgerId,
  initialData,
  onClose,
  onOpenFullPage,
  isStandalone = false,
}: InventoryLedgerDetailProps) {
  const router = useRouter();
  const [data, setData] = useState<Row | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData || !initialData.applications);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { formatMoney } = useCompanyCurrency();

  useEffect(() => {
    let cancelled = false;
    if (!ledgerId) return;

    setLoading(true);
    setError("");
    api.get(`/inventory-ledger/${ledgerId}`)
      .then((res) => {
        if (!cancelled) {
          setData(unwrap<Row>(res));
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err?.message || "Failed to load Inventory Ledger Entry details.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ledgerId]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const entry = data || initialData;

  if (loading && !entry) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center" style={S.sub}>
        <Loader2 className="mb-3 h-7 w-7 animate-spin" style={S.accent} />
        <p className="text-sm font-medium">Loading Inventory Ledger Entry…</p>
      </div>
    );
  }

  if (error && !entry) {
    return (
      <div className="p-6">
        <InlineAlert>{error}</InlineAlert>
        {onClose && (
          <Button variant="outline" size="sm" onClick={onClose} className="mt-4">
            Close
          </Button>
        )}
      </div>
    );
  }

  if (!entry) return null;

  const isPositive = entry.entry_type === "POSITIVE";
  const qtyNum = Number(entry.quantity || 0);
  const remNum = Number(entry.remaining_quantity ?? (isPositive ? qtyNum : 0));
  const rateNum = Number(entry.rate || 0);
  const amountNum = Number(entry.amount || 0);
  const consumedQty = isPositive ? Math.max(0, qtyNum - remNum) : 0;
  const consumedPct = isPositive && qtyNum > 0 ? Math.min(100, Math.round((consumedQty / qtyNum) * 100)) : 0;

  const locationCodeDisplay =
    entry.warehouse?.location_code ||
    entry.warehouse?.warehouse_code ||
    entry.warehouse_code ||
    entry.warehouse?.warehouse_name ||
    entry.warehouse_name ||
    (entry.warehouse_id ? `LOC-${entry.warehouse_id.slice(0, 6)}` : "—");

  const locationNameDisplay =
    entry.warehouse?.location_name ||
    entry.warehouse?.warehouse_name ||
    entry.warehouse_name;

  const applications: Row[] = entry.applications || [];

  return (
    <div className="flex flex-col gap-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {isStandalone && onClose && (
              <button
                type="button"
                onClick={onClose}
                className="mr-1 inline-flex items-center gap-1 text-xs font-medium hover:underline"
                style={S.sub}
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Inventory Ledger Entries
              </button>
            )}
            <h1 className="font-mono text-xl font-bold tracking-tight" style={S.primary}>
              {entry.document_no || "Inventory Ledger Entry"}
            </h1>
            <div className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-0.5" style={S.raised}>
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>Transaction Type:</span>
              <span className="font-mono text-xs font-bold" style={S.primary}>
                {formatBcEntryType(entry.transaction_type)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-0.5" style={S.raised}>
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>Entry Type:</span>
              <StatusBadge
                status={entry.entry_type}
                label={formatBcEntryTypeLabel(entry.entry_type)}
              />
            </div>
            {entry.document_type && (
              <Badge variant="neutral" className="text-xs">
                {formatBcDocumentType(entry.document_type)}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs" style={S.sub}>
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" style={S.muted} />
              Posting Date: <strong style={S.primary}>{entry.posting_date}</strong>
            </span>
            {entry.external_reference_no && (
              <span className="flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" style={S.muted} />
                External Document No.: <strong style={S.primary}>{entry.external_reference_no}</strong>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {getSourceDocumentRoute(entry.document_type) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const route = getSourceDocumentRoute(entry.document_type);
                if (route) router.push(route);
              }}
              className="flex items-center gap-1.5 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" /> View {formatBcDocumentType(entry.document_type)}
            </Button>
          )}
          {!isStandalone && onOpenFullPage && (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenFullPage}
              className="flex items-center gap-1.5 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Full Page
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
              Close
            </Button>
          )}
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {/* Hero Metric Cards (Business Central Key Metrics) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Quantity */}
        <div className="rounded-[var(--radius-md)] border p-3.5 flex flex-col justify-between" style={S.surface}>
          <div className="flex items-center justify-between text-xs font-medium" style={S.muted}>
            <span>Quantity</span>
            {isPositive ? (
              <ArrowDownLeft className="h-4 w-4 text-[var(--success)]" />
            ) : (
              <ArrowUpRight className="h-4 w-4 text-[var(--danger)]" />
            )}
          </div>
          <div className="mt-2">
            <p className="font-mono text-xl font-bold" style={{ color: isPositive ? "var(--success)" : "var(--danger)" }}>
              {isPositive ? `+${qtyNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : qtyNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
            </p>
            <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider" style={S.sub}>
              {entry.uom || "Units"}
            </p>
          </div>
        </div>

        {/* Unit Cost */}
        <div className="rounded-[var(--radius-md)] border p-3.5 flex flex-col justify-between" style={S.surface}>
          <div className="flex items-center justify-between text-xs font-medium" style={S.muted}>
            <span>Unit Cost</span>
            <DollarSign className="h-4 w-4" style={S.accent} />
          </div>
          <div className="mt-2">
            <p className="font-mono text-xl font-bold" style={S.primary}>
              {formatMoney(rateNum)}
            </p>
            <p className="mt-0.5 text-xs" style={S.sub}>
              per {entry.uom || "unit"}
            </p>
          </div>
        </div>

        {/* Cost Amount (Actual) */}
        <div className="rounded-[var(--radius-md)] border p-3.5 flex flex-col justify-between" style={S.surface}>
          <div className="flex items-center justify-between text-xs font-medium" style={S.muted}>
            <span>Cost Amount (Actual)</span>
            <Database className="h-4 w-4" style={S.muted} />
          </div>
          <div className="mt-2">
            <p className="font-mono text-xl font-bold" style={S.primary}>
              {formatMoney(amountNum)}
            </p>
            <p className="mt-0.5 text-xs" style={S.sub}>
              Total cost valuation
            </p>
          </div>
        </div>

        {/* Remaining Quantity */}
        <div className="rounded-[var(--radius-md)] border p-3.5 flex flex-col justify-between" style={S.surface}>
          <div className="flex items-center justify-between text-xs font-medium" style={S.muted}>
            <span>Remaining Quantity</span>
            <Layers className="h-4 w-4" style={S.muted} />
          </div>
          <div className="mt-2">
            {isPositive ? (
              <>
                <p className="font-mono text-lg font-bold" style={remNum > 0 ? S.primary : S.muted}>
                  {remNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {entry.uom}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-raised)]">
                    <div 
                      className="h-full rounded-full transition-all"
                      style={{ 
                        width: `${100 - consumedPct}%`, 
                        backgroundColor: remNum > 0 ? "var(--success)" : "var(--text-muted)" 
                      }} 
                    />
                  </div>
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{100 - consumedPct}% unapplied</span>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold" style={S.primary}>
                  Applied Issue
                </p>
                <p className="mt-0.5 text-xs" style={S.sub}>
                  Fully costed via FIFO
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Field Details Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Item & General Section */}
        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4" style={S.surface}>
          <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: "var(--border)" }}>
            <Package className="h-4 w-4" style={S.accent} />
            <h3 className="text-sm font-semibold" style={S.primary}>Item & General Information</h3>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Item No.</p>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono font-bold" style={S.primary}>
                <span>{entry.item_code}</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(entry.item_code, "item_code")}
                  className="rounded p-0.5 hover:bg-[var(--surface-raised)]"
                  title="Copy Item No."
                >
                  {copiedKey === "item_code" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" style={S.muted} />}
                </button>
              </div>
            </div>

            <div>
              <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Unit of Measure Code</p>
              <p className="mt-0.5 font-semibold font-mono" style={S.primary}>{entry.uom || "—"}</p>
            </div>

            <div className="col-span-2">
              <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Description</p>
              <p className="mt-0.5 text-sm font-medium" style={S.primary}>{entry.item_description || "—"}</p>
            </div>

            <div className="col-span-2">
              <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Location Code</p>
              <div className="mt-0.5 flex items-center gap-2" style={S.primary}>
                <Building2 className="h-4 w-4 shrink-0" style={S.muted} />
                <div>
                  <span className="font-mono font-semibold">{locationCodeDisplay}</span>
                  {locationNameDisplay && locationNameDisplay !== locationCodeDisplay && (
                    <span className="ml-2 font-normal" style={S.sub}>({locationNameDisplay})</span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Transaction Type</p>
              <p className="mt-0.5 font-mono font-bold" style={S.primary}>
                {formatBcEntryType(entry.transaction_type)}
              </p>
            </div>

            <div>
              <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Entry Type</p>
              <div className="mt-0.5">
                <StatusBadge
                  status={entry.entry_type}
                  label={formatBcEntryTypeLabel(entry.entry_type)}
                />
              </div>
            </div>

            {entry.alternate_quantity && (
              <>
                <div>
                  <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Alternate Quantity</p>
                  <p className="mt-0.5 font-mono" style={S.primary}>{entry.alternate_quantity}</p>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Qty. per Unit of Measure</p>
                  <p className="mt-0.5 font-mono" style={S.primary}>{entry.uom_conversion_factor || "1.000000"}</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Item Tracking (Lot / Serial / Expiration) */}
        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4" style={S.surface}>
          <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: "var(--border)" }}>
            <ShieldCheck className="h-4 w-4 text-[var(--success)]" />
            <h3 className="text-sm font-semibold" style={S.primary}>Item Tracking (Traceability)</h3>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Lot No.</p>
              {entry.lot_no ? (
                <div className="mt-0.5 flex items-center gap-1.5 font-mono font-bold" style={S.primary}>
                  <Badge variant="accent" className="font-mono text-xs">{entry.lot_no}</Badge>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(entry.lot_no, "lot_no")}
                    className="rounded p-0.5 hover:bg-[var(--surface-raised)]"
                    title="Copy Lot No."
                  >
                    {copiedKey === "lot_no" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" style={S.muted} />}
                  </button>
                </div>
              ) : (
                <p className="mt-0.5" style={S.muted}>Not Lot Tracked</p>
              )}
            </div>

            <div>
              <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Serial No.</p>
              {entry.serial_no ? (
                <div className="mt-0.5 flex items-center gap-1.5 font-mono font-bold" style={S.primary}>
                  <Badge variant="accent" className="font-mono text-xs">{entry.serial_no}</Badge>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(entry.serial_no, "serial_no")}
                    className="rounded p-0.5 hover:bg-[var(--surface-raised)]"
                    title="Copy Serial No."
                  >
                    {copiedKey === "serial_no" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" style={S.muted} />}
                  </button>
                </div>
              ) : (
                <p className="mt-0.5" style={S.muted}>Not Serial Tracked</p>
              )}
            </div>

            <div>
              <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Expiration Date</p>
              <p className="mt-0.5 font-mono" style={entry.expiry_date ? S.primary : S.muted}>
                {entry.expiry_date || "—"}
              </p>
            </div>

            <div>
              <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>Production Batch No.</p>
              {entry.batch_no ? (
                <p className="mt-0.5 font-mono font-semibold" style={S.primary}>{entry.batch_no}</p>
              ) : (
                <p className="mt-0.5" style={S.muted}>—</p>
              )}
            </div>

            <div className="col-span-2">
              <p className="font-semibold uppercase tracking-wider text-[11px]" style={S.muted}>External Document No.</p>
              <p className="mt-0.5 font-mono" style={entry.external_reference_no ? S.primary : S.muted}>
                {entry.external_reference_no || "No external document reference"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Item Application Entries (Business Central Table 339) */}
      <div className="rounded-[var(--radius-md)] border overflow-hidden" style={S.surface}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4" style={S.accent} />
            <h3 className="text-sm font-semibold" style={S.primary}>
              {isPositive 
                ? "Item Application Entries (Downstream Consumptions & Issues)" 
                : "Item Application Entries (Upstream Source Layers Applied)"}
            </h3>
          </div>
          <span className="text-xs font-mono" style={S.muted}>
            {applications.length} {applications.length === 1 ? "application entry" : "application entries"}
          </span>
        </div>

        {applications.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center" style={S.sub}>
            <Layers className="mb-2 h-6 w-6" style={S.muted} />
            <p className="text-sm font-medium">
              {isPositive
                ? "This Inventory Ledger Entry is currently intact with zero drawdowns."
                : "No Item Application Entries recorded for this movement."}
            </p>
            <p className="mt-1 text-xs" style={S.muted}>
              {isPositive
                ? "When Transfer Orders or Batches apply against this entry, they will be listed here."
                : "Standard costing or direct ledger adjustment."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <TableHeader>
                <tr className="border-b" style={{ borderColor: "var(--border)" }}>
                  <TableHead className="py-2.5 px-3">Application ID</TableHead>
                  <TableHead className="py-2.5 px-3">Posting Date</TableHead>
                  <TableHead className="py-2.5 px-3">
                    {isPositive ? "Outbound Document No." : "Inbound Document No."}
                  </TableHead>
                  <TableHead className="py-2.5 px-3">Entry Type</TableHead>
                  <TableHead className="py-2.5 px-3">Tracking</TableHead>
                  <TableHead className="py-2.5 px-3 text-right">Applied Unit Cost</TableHead>
                  <TableHead className="py-2.5 px-3 text-right">Applied Quantity</TableHead>
                  <TableHead className="py-2.5 px-3 text-right">Cost Amount</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {applications.map((app) => {
                  const appliedUnitCost = Number(app.unit_cost ?? app.rate ?? (Number(app.applied_cost_amount || 0) / Number(app.applied_qty || 1)));
                  return (
                    <TableRow key={app.application_id} style={{ borderColor: "var(--border)" }}>
                      <TableCell className="py-2.5 px-3 font-mono text-[11px]" style={S.sub}>
                        <div className="flex items-center gap-1">
                          <span>{app.application_id ? (app.application_id.length > 20 ? `${app.application_id.slice(0, 12)}…` : app.application_id) : "—"}</span>
                          {app.application_id && (
                            <button
                              type="button"
                              onClick={() => copyToClipboard(app.application_id, app.application_id)}
                              className="rounded p-0.5 hover:bg-[var(--surface-raised)]"
                              title="Copy Application ID"
                            >
                              {copiedKey === app.application_id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" style={S.muted} />}
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 px-3 font-mono" style={S.primary}>
                        {app.application_date || "—"}
                      </TableCell>
                      <TableCell className="py-2.5 px-3 font-mono font-medium" style={S.primary}>
                        {isPositive ? app.document_no || "Outbound Doc" : app.document_no || "Inbound Layer"}
                      </TableCell>
                      <TableCell className="py-2.5 px-3" style={S.sub}>
                        {formatBcEntryType(app.transaction_type || app.document_type)}
                      </TableCell>
                      <TableCell className="py-2.5 px-3 font-mono text-[11px]" style={S.sub}>
                        {app.lot_no ? (
                          <Badge variant="accent" className="font-mono text-[10px]">Lot: {app.lot_no}</Badge>
                        ) : app.serial_no ? (
                          <Badge variant="accent" className="font-mono text-[10px]">SN: {app.serial_no}</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="py-2.5 px-3 font-mono text-right font-medium" style={S.primary}>
                        {formatMoney(appliedUnitCost)}
                      </TableCell>
                      <TableCell className="py-2.5 px-3 font-mono text-right font-semibold" style={{ color: isPositive ? "var(--danger)" : "var(--success)" }}>
                        {isPositive ? `-${Number(app.applied_qty).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : `+${Number(app.applied_qty).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`} {entry.uom}
                      </TableCell>
                      <TableCell className="py-2.5 px-3 font-mono text-right font-medium" style={S.primary}>
                        {formatMoney(Number(app.applied_cost_amount))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
          </div>
        )}
      </div>

      {/* System & Integration Audit Trail */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border p-3 text-[11px]" style={S.surface}>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1 font-mono" style={S.muted}>
            <Hash className="h-3 w-3" /> Entry No.: <span style={S.sub}>{entry.ledger_id}</span>
            <button
              type="button"
              onClick={() => copyToClipboard(entry.ledger_id, "ledger_id")}
              className="ml-1 rounded p-0.5 hover:bg-[var(--surface-raised)]"
              title="Copy Entry No."
            >
              {copiedKey === "ledger_id" ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            </button>
          </span>
          {entry.created_at && (
            <span className="flex items-center gap-1 font-mono" style={S.muted}>
              <Clock className="h-3 w-3" /> System Created: <span style={S.sub}>{new Date(entry.created_at).toLocaleString()}</span>
            </span>
          )}
        </div>

        <span className="text-[11px] font-semibold" style={S.muted}>
          D365BC Linked Entry (Immutable)
        </span>
      </div>
    </div>
  );
}
