"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { 
  Loader2, 
  Inbox, 
  Eye, 
  RotateCcw,
  Search
} from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLanguage } from "@/hooks/useLanguage";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import InventoryLedgerDetail, { formatBcEntryType } from "./inventory-ledger-detail";

const PAGE_SIZE = 25;

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

const inputCls = "nf-input-sm";

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

export default function InventoryLedgerPanel() {
  const { t } = useLanguage();
  const router = useRouter();
  const { formatMoney } = useCompanyCurrency();

  const [rows, setRows] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [warehouses, setWarehouses] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [entryType, setEntryType] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [documentNo, setDocumentNo] = useState("");
  const [sortBy, setSortBy] = useState<"created_at" | "posting_date">("created_at");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  // Detail Modal state
  const [viewingEntry, setViewingEntry] = useState<Row | null>(null);

  const companyId = getActiveCompanyId();

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (itemId) params.set("itemId", itemId);
      if (warehouseId) params.set("warehouseId", warehouseId);
      if (entryType) params.set("entryType", entryType);
      if (transactionType) params.set("transactionType", transactionType);
      if (documentNo) params.set("documentNo", documentNo);
      if (sortBy) params.set("sortBy", sortBy);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      params.set("limit", "250");
      const res = await api.get(`/inventory-ledger?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t("ilpFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [itemId, warehouseId, entryType, transactionType, documentNo, sortBy, dateFrom, dateTo]);

  useEffect(() => { 
    setPage(1); 
  }, [itemId, warehouseId, entryType, transactionType, documentNo, sortBy, dateFrom, dateTo, pageSize]);

  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    api.get(`/item?${params.toString()}`).then((r) => setItems(unwrap<Row[]>(r) || [])).catch((err) => { void err; });
    api.get(`/warehouse?${params.toString()}`).then((r) => setWarehouses(unwrap<Row[]>(r) || [])).catch((err) => { void err; });
  }, []);

  const warehouseMap = new Map<string, Row>();
  warehouses.forEach((w) => warehouseMap.set(w.warehouse_id, w));

  const getLocationCode = (id?: string) => {
    if (!id) return "—";
    const wh = warehouseMap.get(id);
    if (!wh) return "—";
    return wh.location_code || wh.warehouse_code || wh.warehouse_name;
  };

  const hasActiveFilters = Boolean(
    itemId || warehouseId || entryType || transactionType || documentNo || dateFrom || dateTo
  );

  const resetFilters = () => {
    setItemId("");
    setWarehouseId("");
    setEntryType("");
    setTransactionType("");
    setDocumentNo("");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Title & Stats */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>{t("ilpTitle")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>
            {t("ilpSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="neutral" className="text-xs font-mono">
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </Badge>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-[var(--surface-raised)] transition"
              style={S.sub}
            >
              <RotateCcw className="h-3 w-3" /> Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Filter Controls Bar (Business Central standard dimensions & filters) */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border p-2.5" style={S.surface}>
        {/* Document No / Batch search */}
        <div className="relative">
          <input
            type="text"
            value={documentNo}
            onChange={(e) => setDocumentNo(e.target.value)}
            placeholder="Search Document No., Item, Batch, Ext. Doc No…"
            className={`${inputCls} w-60 pl-7`}
            style={S.input}
          />
          <Search className="absolute left-2 top-2 h-3.5 w-3.5" style={S.muted} />
        </div>

        {/* Location Code Filter */}
        <select 
          value={warehouseId} 
          onChange={(e) => setWarehouseId(e.target.value)} 
          className={`${inputCls} nf-select max-w-[190px]`} 
          style={S.input}
        >
          <option value="">All Locations (Location Code)</option>
          {warehouses.map((wh) => (
            <option key={wh.warehouse_id} value={wh.warehouse_id}>
              {wh.warehouse_code} — {wh.warehouse_name}
            </option>
          ))}
        </select>

        {/* Item Filter */}
        <select 
          value={itemId} 
          onChange={(e) => setItemId(e.target.value)} 
          className={`${inputCls} nf-select max-w-[200px]`} 
          style={S.input}
        >
          <option value="">{t("ilpAllItemsOptions", { count: items.length })}</option>
          {items.map((it, idx) => (
            <option key={it.item_id} value={it.item_id}>
              {idx + 1}. {it.item_code} — {it.item_name}
            </option>
          ))}
        </select>

        {/* Direction / Movement Filter */}
        <select
          value={entryType}
          onChange={(e) => setEntryType(e.target.value)}
          className={`${inputCls} nf-select`}
          style={S.input}
        >
          <option value="">All Movements</option>
          <option value="POSITIVE">Positive (+)</option>
          <option value="NEGATIVE">Negative (-)</option>
        </select>

        {/* Entry Type Filter (Business Central standard Entry Types) */}
        <select 
          value={transactionType} 
          onChange={(e) => setTransactionType(e.target.value)} 
          className={`${inputCls} nf-select`} 
          style={S.input}
        >
          <option value="">{t("ilpAllTransactionTypes")}</option>
          <option value="PURCHASE">Purchase</option>
          <option value="CONSUMPTION">Consumption</option>
          <option value="OUTPUT">Output</option>
          <option value="TRANSFER_SHIPMENT">Transfer (Shipment)</option>
          <option value="TRANSFER_RECEIPT">Transfer (Receipt)</option>
          <option value="SALES">Sale</option>
          <option value="VARIANCE_POSITIVE">Positive Adjmt.</option>
          <option value="VARIANCE_NEGATIVE">Negative Adjmt.</option>
          <option value="REVERSAL">Reversal</option>
        </select>

        {/* Sort By */}
        <select 
          value={sortBy} 
          onChange={(e) => setSortBy(e.target.value as "created_at" | "posting_date")} 
          className={`${inputCls} nf-select`} 
          style={S.input}
        >
          <option value="created_at">Recently Posted First</option>
          <option value="posting_date">Posting Date</option>
        </select>

        {/* Date Range */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium" style={S.muted}>{t("ilpFrom")}</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} style={S.input} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium" style={S.muted}>{t("ilpTo")}</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} style={S.input} />
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {/* Main Item Ledger Entries Table */}
      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm min-w-[1250px]">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="whitespace-nowrap w-28 min-w-[105px]">{t("ilpPostingDate")}</TableHead>
                <TableHead className="whitespace-nowrap w-36 min-w-[130px]">{t("ilpDocument")}</TableHead>
                <TableHead className="whitespace-nowrap min-w-[210px]">{t("ilpItem")}</TableHead>
                <TableHead className="whitespace-nowrap min-w-[150px]">{t("ilpLocation")}</TableHead>
                <TableHead className="whitespace-nowrap w-32">{t("ilpType")}</TableHead>
                <TableHead className="whitespace-nowrap w-28">Movement</TableHead>
                <TableHead className="whitespace-nowrap text-right w-28">{t("ilpQty")}</TableHead>
                <TableHead className="whitespace-nowrap text-right w-28">{t("ilpRemaining")}</TableHead>
                <TableHead className="whitespace-nowrap text-right w-24">{t("ilpRate")}</TableHead>
                <TableHead className="whitespace-nowrap text-right w-28">{t("ilpAmount")}</TableHead>
                <TableHead className="whitespace-nowrap w-32">Item Tracking</TableHead>
                <TableHead className="whitespace-nowrap w-28">{t("ilpBatchNo")}</TableHead>
                <TableHead className="whitespace-nowrap text-center w-16">Action</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr>
                  <TableCell colSpan={13} className="py-12 text-center" style={S.sub}>
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> 
                    {t("ilpLoading")}
                  </TableCell>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <TableCell colSpan={13} className="py-12 text-center" style={S.sub}>
                    <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> 
                    {hasActiveFilters ? "No item ledger entries match the selected filters." : t("ilpNoLedgerEntries")}
                  </TableCell>
                </tr>
              ) : (
                pagedRows.map((row) => {
                  const isPos = row.entry_type === "POSITIVE";
                  const qty = Number(row.quantity || 0);
                  const rem = row.remaining_quantity !== null && row.remaining_quantity !== undefined 
                    ? Number(row.remaining_quantity) 
                    : null;
                  const rate = Number(row.rate || 0);
                  const amt = Number(row.amount || 0);

                  return (
                    <TableRow 
                      key={row.ledger_id}
                      onClick={() => setViewingEntry(row)}
                      className="cursor-pointer hover:bg-[var(--surface-raised)] transition"
                    >
                      {/* Posting Date */}
                      <TableCell className="whitespace-nowrap font-medium" style={S.primary}>
                        {row.posting_date}
                      </TableCell>

                      {/* Document No. & External Document No. */}
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-semibold" style={S.primary}>
                            {row.document_no}
                          </span>
                          {row.external_reference_no && (
                            <span className="font-mono text-[10px]" style={S.muted}>
                              Ext: {row.external_reference_no}
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Item No. & Description */}
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-col max-w-[260px]">
                          <span className="font-mono text-xs font-semibold" style={S.primary}>
                            {row.item_code}
                          </span>
                          <span className="truncate text-xs" style={S.sub} title={row.item_description}>
                            {row.item_description}
                          </span>
                        </div>
                      </TableCell>

                      {/* Location Code */}
                      <TableCell className="whitespace-nowrap" style={S.sub}>
                        <span className="truncate max-w-[170px] block font-mono text-xs" title={getLocationCode(row.warehouse_id)}>
                          {getLocationCode(row.warehouse_id)}
                        </span>
                      </TableCell>

                      {/* Entry Type (Business Central format) */}
                      <TableCell className="whitespace-nowrap">
                        <Badge variant="neutral" className="text-[11px] font-semibold">
                          {formatBcEntryType(row.transaction_type)}
                        </Badge>
                      </TableCell>

                      {/* Movement (Positive / Negative) */}
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge
                          status={row.entry_type}
                          label={isPos ? "Positive (+)" : "Negative (-)"}
                        />
                      </TableCell>

                      {/* Quantity with UOM */}
                      <TableCell 
                        className="whitespace-nowrap text-right font-mono font-semibold"
                        style={{ color: isPos ? "var(--success)" : "var(--danger)" }}
                      >
                        {isPos ? `+${qty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : qty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">{row.uom}</span>
                      </TableCell>

                      {/* Remaining Quantity */}
                      <TableCell className="whitespace-nowrap text-right font-mono text-xs" style={S.sub}>
                        {isPos ? (
                          rem !== null ? (
                            <span className={rem === 0 ? "text-[var(--text-muted)] line-through" : ""}>
                              {rem.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                              <span className="ml-0.5 text-[10px] text-[var(--text-muted)]">{row.uom}</span>
                            </span>
                          ) : "—"
                        ) : (
                          <span style={S.muted}>—</span>
                        )}
                      </TableCell>

                      {/* Unit Cost */}
                      <TableCell className="whitespace-nowrap text-right font-mono text-xs" style={S.sub}>
                        {formatMoney(rate)}
                      </TableCell>

                      {/* Cost Amount (Actual) */}
                      <TableCell className="whitespace-nowrap text-right font-mono text-xs font-semibold" style={S.primary}>
                        {formatMoney(amt)}
                      </TableCell>

                      {/* Item Tracking (Lot No. / Serial No.) */}
                      <TableCell className="whitespace-nowrap text-xs">
                        {row.lot_no ? (
                          <Badge variant="accent" className="font-mono text-[10px]">
                            Lot: {row.lot_no}
                          </Badge>
                        ) : row.serial_no ? (
                          <Badge variant="accent" className="font-mono text-[10px]">
                            SN: {row.serial_no}
                          </Badge>
                        ) : (
                          <span style={S.muted}>—</span>
                        )}
                      </TableCell>

                      {/* Production Batch No. */}
                      <TableCell className="whitespace-nowrap font-mono text-xs" style={row.batch_no ? S.primary : S.muted}>
                        {row.batch_no || "—"}
                      </TableCell>

                      {/* Action */}
                      <TableCell className="whitespace-nowrap text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingEntry(row);
                          }}
                          className="inline-flex items-center justify-center rounded p-1 hover:bg-[var(--surface-raised)] transition"
                          style={S.sub}
                          title="View Item Ledger Entry"
                        >
                          <Eye className="h-4 w-4" style={S.accent} />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && rows.length > 0 && (
          <div className="border-t px-3 py-1.5 flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
            <span className="text-xs" style={S.muted}>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} of {rows.length} entries
            </span>
            <Pagination 
              page={page} 
              pageSize={pageSize} 
              total={rows.length} 
              onPageChange={setPage} 
              onPageSizeChange={setPageSize} 
            />
          </div>
        )}
      </div>

      {/* Item Ledger Entry Detail Dialog Modal */}
      <Dialog
        open={Boolean(viewingEntry)}
        onClose={() => setViewingEntry(null)}
        title={viewingEntry ? `Item Ledger Entry — ${viewingEntry.document_no}` : ""}
        maxWidth="xl"
      >
        {viewingEntry && (
          <div className="py-1">
            <InventoryLedgerDetail
              ledgerId={viewingEntry.ledger_id}
              initialData={viewingEntry}
              onClose={() => setViewingEntry(null)}
              onOpenFullPage={() => {
                const id = viewingEntry.ledger_id;
                setViewingEntry(null);
                router.push(`/inventory/ledger/${id}`);
              }}
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}
