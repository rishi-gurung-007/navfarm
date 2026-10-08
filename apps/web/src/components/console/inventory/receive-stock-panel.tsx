"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Search,
  CheckCircle2,
  ArrowRight,
  PackageCheck,
  AlertTriangle,
  RotateCw,
  FileText,
  Printer,
  ExternalLink,
  History,
  Sparkles,
  Barcode,
} from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

const PAGE_SIZE = 25;
type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

interface ReceiveStockPanelProps {
  onOpenTransferOrder?: (transferId: string) => void;
}

export default function ReceiveStockPanel({ onOpenTransferOrder }: ReceiveStockPanelProps = {}) {
  const router = useRouter();
  const { formatMoney } = useCompanyCurrency();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [destinationFilter, setDestinationFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [warehouses, setWarehouses] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);

  // Dedicated GRN modal
  const [viewingReceipt, setViewingReceipt] = useState<Row | null>(null);

  const companyId = getActiveCompanyId();

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (search) params.set("search", search);
      params.set("limit", "200");

      const res = await api.get(`/stock-transfer/receipts?${params.toString()}`);
      const data = unwrap<Row[]>(res) || [];
      setRows(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load transfer receipts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [search]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    api.get(`/warehouse?${params.toString()}`).then((r) => setWarehouses(unwrap<Row[]>(r) || [])).catch(() => {
      // ignore
    });
    api.get(`/user?limit=500`).then((r) => setUsers(unwrap<Row[]>(r) || [])).catch(() => {
      // ignore
    });
  }, [companyId]);

  const warehouseLabel = (id: string | null) => {
    if (!id) return "—";
    const w = warehouses.find((wh) => wh.warehouse_id === id);
    if (!w) return id;
    return w.warehouse_code ? `${w.warehouse_code} (${w.warehouse_name})` : w.warehouse_name || id;
  };

  const warehouseCode = (id: string | null) => {
    if (!id) return "—";
    const w = warehouses.find((wh) => wh.warehouse_id === id);
    return w?.warehouse_code || id;
  };

  const getUserDisplayName = (idOrName?: string | null) => {
    if (!idOrName) return "System";
    const found = users.find((u) => u.user_id === idOrName || u.userId === idOrName);
    if (found) return found.full_name || found.fullName || found.email || idOrName;
    return idOrName;
  };

  // Metrics
  const totalReceiptsCount = rows.length;
  const totalGoodQty = useMemo(() => rows.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0), [rows]);
  const totalDoaQty = useMemo(() => rows.reduce((acc, r) => acc + (Number(r.doa_quantity) || 0), 0), [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (originFilter && r.from_warehouse_id !== originFilter) return false;
      if (destinationFilter && r.to_warehouse_id !== destinationFilter) return false;
      return true;
    });
  }, [rows, originFilter, destinationFilter]);

  const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3.5 rounded-[var(--radius-lg)] border p-4 shadow-xs" style={S.surface}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <PackageCheck className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-medium" style={S.sub}>Total Receipts Generated</p>
            <p className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {totalReceiptsCount}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-[var(--radius-lg)] border p-4 shadow-xs" style={S.surface}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-medium" style={S.sub}>Good Quantity Received</p>
            <p className="text-2xl font-bold tracking-tight" style={S.primary}>
              {totalGoodQty.toLocaleString()} Units
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-[var(--radius-lg)] border p-4 shadow-xs" style={S.surface}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-medium" style={S.sub}>DOA / Transit Loss Auto-Adjusted</p>
            <p className={`text-2xl font-bold tracking-tight ${totalDoaQty > 0 ? "text-amber-600 dark:text-amber-400" : ""}`} style={totalDoaQty === 0 ? S.primary : undefined}>
              {totalDoaQty.toLocaleString()} Units
            </p>
          </div>
        </div>
      </div>

      {/* Header and Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2" style={S.primary}>
            <History className="h-5 w-5 text-emerald-500" />
            Transfer Receipts (Receipt History)
          </h2>
          <p className="mt-0.5 text-xs" style={S.sub}>
            Clean chronological archive of all verified GRNs and ledger arrivals.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={originFilter}
            onChange={(e) => {
              setOriginFilter(e.target.value);
              setPage(1);
            }}
            className="nf-input-sm px-2 text-xs"
            style={S.input}
            title="Filter by Origin"
          >
            <option value="">All Origins</option>
            {warehouses.map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id}>
                From: {w.warehouse_code} — {w.warehouse_name}
              </option>
            ))}
          </select>

          <select
            value={destinationFilter}
            onChange={(e) => {
              setDestinationFilter(e.target.value);
              setPage(1);
            }}
            className="nf-input-sm px-2 text-xs"
            style={S.input}
            title="Filter by Destination"
          >
            <option value="">All Destinations</option>
            {warehouses.map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id}>
                To: {w.warehouse_code} — {w.warehouse_name}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search GRN #, order #, item…"
              className="nf-input-sm pl-8 pr-3 text-xs"
              style={S.input}
            />
          </div>

          <Button size="sm" variant="outline" onClick={loadData} title="Refresh">
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {error && <InlineAlert variant="danger">{error}</InlineAlert>}

      {/* Receipts History Table */}
      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs min-w-[1100px]">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="whitespace-nowrap px-3 py-2.5">Receipt / GRN #</TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2.5">Transfer Order Ref</TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2.5">Posting Date</TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2.5">Source &amp; Destination Locations</TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2.5">Item Code &amp; Description</TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2.5 text-right">Qty Received</TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2.5 text-right">DOA / Waste Qty</TableHead>
                <TableHead className="whitespace-nowrap px-3 py-2.5">Received By</TableHead>
                <TableHead className="text-right px-3 py-2.5">Actions</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center" style={S.sub}>
                    <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" style={S.accent} />
                    Loading receipt history records…
                  </TableCell>
                </TableRow>
              ) : pagedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-12 text-center" style={S.sub}>
                    <PackageCheck className="mx-auto mb-2 h-8 w-8 opacity-40 text-emerald-500" />
                    No transfer receipt records found.
                  </TableCell>
                </TableRow>
              ) : (
                pagedRows.map((row) => (
                  <TableRow key={row.ledger_id} className="hover:bg-(--surface-raised)/50 border-b border-(--row-border)">
                    {/* Receipt / GRN # */}
                    <TableCell className="whitespace-nowrap px-3 py-2.5 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {row.receipt_no}
                    </TableCell>

                    {/* Transfer Order Ref */}
                    <TableCell className="whitespace-nowrap px-3 py-2.5 font-mono">
                      {row.transfer_id && onOpenTransferOrder ? (
                        <button
                          type="button"
                          onClick={() => onOpenTransferOrder(row.transfer_id)}
                          className="font-bold underline text-(--accent) hover:opacity-80"
                          title="Open Transfer Order Document Card"
                        >
                          {row.transfer_no}
                        </button>
                      ) : (
                        <span className="font-semibold" style={S.primary}>{row.transfer_no}</span>
                      )}
                    </TableCell>

                    {/* Posting Date */}
                    <TableCell className="whitespace-nowrap px-3 py-2.5 font-mono text-xs" style={S.primary}>
                      {row.posting_date}
                    </TableCell>

                    {/* Source & Destination Warehouses */}
                    <TableCell className="whitespace-nowrap px-3 py-2.5 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <span style={S.muted}>{warehouseCode(row.from_warehouse_id)}</span>
                        <ArrowRight className="h-3 w-3" style={S.muted} />
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {warehouseCode(row.to_warehouse_id || row.warehouse_id)}
                        </span>
                      </span>
                    </TableCell>

                    {/* Item Code & Description */}
                    <TableCell className="px-3 py-2.5 text-xs max-w-[240px]">
                      <div className="flex flex-col">
                        <span className="font-bold font-mono" style={S.primary}>{row.item_code}</span>
                        <span className="truncate text-[11px]" style={S.sub}>{row.item_name}</span>
                        {(row.serial_no || row.lot_no) && (
                          <span className="font-mono text-[10px] text-(--accent) flex items-center gap-1 mt-0.5">
                            <Barcode className="h-2.5 w-2.5" />
                            {row.serial_no ? `SN: ${row.serial_no}` : `Lot: ${row.lot_no}`}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Good Qty Received */}
                    <TableCell className="whitespace-nowrap px-3 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      +{Number(row.quantity).toLocaleString()} {row.uom}
                    </TableCell>

                    {/* DOA / Waste Qty */}
                    <TableCell className="whitespace-nowrap px-3 py-2.5 text-right font-mono">
                      {Number(row.doa_quantity) > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400 border border-amber-500/30">
                          {Number(row.doa_quantity).toLocaleString()} {row.uom} (DOA)
                        </span>
                      ) : (
                        <span className="opacity-40">0</span>
                      )}
                    </TableCell>

                    {/* Received By */}
                    <TableCell className="whitespace-nowrap px-3 py-2.5 text-xs" style={S.sub}>
                      {row.created_by_name || getUserDisplayName(row.created_by)}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="whitespace-nowrap px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setViewingReceipt(row)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                          title="View Receipt Note (GRN)"
                        >
                          <FileText className="h-3.5 w-3.5" /> View Receipt Note (GRN)
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setViewingReceipt(row);
                            setTimeout(() => window.print(), 300);
                          }}
                          className="flex items-center gap-1 text-xs"
                          title="Print GRN"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </div>

        {!loading && filteredRows.length > 0 && (
          <div className="border-t px-2" style={{ borderColor: "var(--border)" }}>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={filteredRows.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* Dedicated GRN Modal                                  */}
      {/* ========================================================================= */}
      <Dialog
        open={!!viewingReceipt}
        onClose={() => setViewingReceipt(null)}
        title={viewingReceipt ? `GRN — ${viewingReceipt.receipt_no}` : ""}
        maxWidth="lg"
        footer={
          <div className="flex w-full items-center justify-between">
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrint}
              className="flex items-center gap-1.5 text-xs"
            >
              <Printer className="h-3.5 w-3.5" /> Print Receipt Note
            </Button>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  router.push(`/inventory/ledger?search=${viewingReceipt?.transfer_no || ""}`);
                }}
                className="flex items-center gap-1.5 text-xs text-(--accent)"
              >
                <ExternalLink className="h-3.5 w-3.5" /> View In Inventory Ledger
              </Button>
              <Button size="sm" onClick={() => setViewingReceipt(null)}>
                Close
              </Button>
            </div>
          </div>
        }
      >
        {viewingReceipt && (
          <div className="flex flex-col gap-4 text-xs">
            {/* GRN Banner */}
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                  <PackageCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                    Official GRN Verified
                  </p>
                  <p className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
                    Goods have arrived at destination store and inventory ledger is officially credited (+).
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-xs">
                RECEIVED &amp; POSTED
              </span>
            </div>

            {/* Document Header Metadata */}
            <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-md)] border p-3.5 sm:grid-cols-4" style={S.raised}>
              <div>
                <p className="font-semibold uppercase tracking-wider text-[10px]" style={S.muted}>Receipt Note #</p>
                <p className="mt-1 font-mono font-bold text-emerald-600 dark:text-emerald-400">{viewingReceipt.receipt_no}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wider text-[10px]" style={S.muted}>Transfer Order Ref</p>
                <p className="mt-1 font-mono font-bold" style={S.primary}>{viewingReceipt.transfer_no}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wider text-[10px]" style={S.muted}>Receipt / Posting Date</p>
                <p className="mt-1 font-medium font-mono" style={S.primary}>{viewingReceipt.posting_date}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wider text-[10px]" style={S.muted}>Received By</p>
                <p className="mt-1 font-medium" style={S.primary}>
                  {viewingReceipt.created_by_name || getUserDisplayName(viewingReceipt.created_by)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-[var(--radius-md)] border p-3.5" style={S.surface}>
              <div>
                <p className="font-semibold uppercase tracking-wider text-[10px]" style={S.muted}>Origin Location (Dispatched From)</p>
                <p className="mt-1 font-medium truncate" style={S.primary}>{warehouseLabel(viewingReceipt.from_warehouse_id)}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wider text-[10px]" style={S.muted}>Destination Location (Stock Credited +)</p>
                <p className="mt-1 font-semibold text-emerald-600 dark:text-emerald-400 truncate">
                  {warehouseLabel(viewingReceipt.to_warehouse_id || viewingReceipt.warehouse_id)}
                </p>
              </div>
            </div>

            {/* Received Item Details Table */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={S.sub}>
                Received Line Item &amp; Quantity Breakdown
              </p>
              <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader>
                    <tr className="border-b border-(--row-border)">
                      <TableHead className="px-3 py-2">Item Code &amp; Description</TableHead>
                      <TableHead className="px-3 py-2 text-right">Good Qty Received</TableHead>
                      <TableHead className="px-3 py-2 text-right">DOA / Waste Loss</TableHead>
                      <TableHead className="px-3 py-2">UOM</TableHead>
                      <TableHead className="px-3 py-2">Tracking / Serials</TableHead>
                      <TableHead className="px-3 py-2 text-right">Unit Rate</TableHead>
                      <TableHead className="px-3 py-2 text-right">Total Value</TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="border-b border-(--row-border)">
                      <TableCell className="px-3 py-2.5 font-medium" style={S.primary}>
                        <div className="flex flex-col">
                          <span className="font-bold font-mono">{viewingReceipt.item_code}</span>
                          <span className="text-[11px]" style={S.sub}>{viewingReceipt.item_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        +{Number(viewingReceipt.quantity).toLocaleString()}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right font-mono">
                        {Number(viewingReceipt.doa_quantity) > 0 ? (
                          <span className="font-bold text-amber-600 dark:text-amber-400">
                            {Number(viewingReceipt.doa_quantity).toLocaleString()} (DOA)
                          </span>
                        ) : (
                          <span className="opacity-40">0</span>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-2.5">{viewingReceipt.uom}</TableCell>
                      <TableCell className="px-3 py-2.5 font-mono text-[11px] max-w-[200px] truncate">
                        {viewingReceipt.serial_no ? `SN: ${viewingReceipt.serial_no}` : viewingReceipt.lot_no ? `Lot: ${viewingReceipt.lot_no}` : "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right font-mono">
                        {Number(viewingReceipt.rate) > 0 ? formatMoney(Number(viewingReceipt.rate)) : "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-right font-mono font-semibold" style={S.primary}>
                        {Number(viewingReceipt.rate) > 0
                          ? formatMoney(Number(viewingReceipt.rate) * Number(viewingReceipt.quantity))
                          : "—"}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </table>
              </div>
            </div>

            {/* DOA Loss Notice if DOA > 0 */}
            {Number(viewingReceipt.doa_quantity) > 0 && (
              <div className="rounded-[var(--radius-sm)] border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  In-Transit Loss Auto-Adjustment Notice (MRT-017)
                </p>
                <p className="mt-1 text-[11px]">
                  <strong>{viewingReceipt.doa_quantity} {viewingReceipt.uom}</strong> were flagged as Dead on Arrival (DOA) / transit waste.
                  An automated negative inventory adjustment has been recorded with reason code <em>MRT-017: Dead on Arrival (DOA) - Transfer</em> at destination to clear transit liability.
                </p>
              </div>
            )}

            {/* Inspection & Remarks */}
            {viewingReceipt.remarks && (
              <div className="rounded-[var(--radius-sm)] border p-3 text-xs" style={S.surface}>
                <p className="font-semibold uppercase tracking-wider text-[10px]" style={S.muted}>Inspection &amp; Condition Remarks</p>
                <p className="mt-1 whitespace-pre-wrap font-mono text-[11px]" style={S.primary}>{viewingReceipt.remarks}</p>
              </div>
            )}

            {/* Inventory Ledger Confirmation */}
            <div className="rounded-[var(--radius-md)] border border-emerald-500/30 bg-emerald-500/5 p-3.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-500" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                  Live Inventory Ledger Record Confirmation
                </span>
              </div>
              <p className="mt-1 text-[11px]" style={S.sub}>
                Entry No.: <span className="font-mono font-semibold" style={S.primary}>{viewingReceipt.entry_no}</span> | Transaction: <strong style={S.primary}>TRANSFER_RECEIPT</strong> (+{viewingReceipt.quantity} {viewingReceipt.uom}).
              </p>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
