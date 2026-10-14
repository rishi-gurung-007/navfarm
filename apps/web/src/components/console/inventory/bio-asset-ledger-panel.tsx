"use client";

/**
 * Bio Asset Ledger (Rishi, 14 Oct). Biological assets are not stock: a GRN of one posts nothing to the Inventory
 * Ledger. It is a + entry here instead, with what remains to register; each animal registered from it is taken from
 * that entry (+1, "from GR-…"), and a death is the only -. The page reads like the Inventory Ledger Entries page: the
 * same filters, columns, badges, exports and entry view.
 */
import { useEffect, useState } from "react";
import { Loader2, Inbox, Eye, RotateCcw, Search, Download, FileSpreadsheet } from "lucide-react";
import { api } from "@/services/api-client";
import { apiDownload } from "@/lib/api-client";
import { showToast, Toast } from "@/components/ui/toast";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLanguage } from "@/hooks/useLanguage";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import BioAssetLedgerDetail, { BIO_DOCUMENT_LABEL, BIO_TRANSACTION_LABEL } from "./bio-asset-ledger-detail";

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

const TRANSACTION_LABEL = BIO_TRANSACTION_LABEL;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const qtyText = (qty: number) => qty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default function BioAssetLedgerPanel() {
  const { t } = useLanguage();
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
  const [viewingEntry, setViewingEntry] = useState<Row | null>(null);

  const companyId = getActiveCompanyId();

  const filterParams = () => {
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
    return params;
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = filterParams();
      params.set("limit", "250");
      const res = await api.get(`/bio-asset-ledger/entries?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || "The Bio Asset Ledger could not be loaded.");
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
    // Only biological assets can have an entry here.
    api.get(`/item?${params.toString()}`).then((r) => setItems((unwrap<Row[]>(r) || []).filter((i) => i.is_biological_asset))).catch((err) => { void err; });
    api.get(`/warehouse?${params.toString()}`).then((r) => setWarehouses(unwrap<Row[]>(r) || [])).catch((err) => { void err; });
  }, []);

  // The export is the whole filtered ledger from the server, not the 250 rows the screen loads.
  const [exporting, setExporting] = useState<"" | "xlsx" | "csv">("");
  const exportLedger = async (format: "xlsx" | "csv") => {
    setExporting(format);
    try {
      const params = filterParams();
      params.set("format", format);
      const file = await apiDownload(`/bio-asset-ledger/export?${params.toString()}`, `bio-asset-ledger-entries.${format}`);
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      const count = Number(file.headers.get("x-export-row-count") ?? 0);
      if (file.headers.get("x-export-truncated") === "true") {
        showToast.warn(`Exported the first ${count.toLocaleString()} entries. Narrow the filters to export the rest.`);
      } else {
        showToast.success(`Exported ${count.toLocaleString()} ${count === 1 ? "entry" : "entries"} to ${format === "xlsx" ? "Excel" : "CSV"}.`);
      }
    } catch (err: any) {
      showToast.error(err?.message || "The export could not be created. Please try again.");
    } finally {
      setExporting("");
    }
  };

  const hasActiveFilters = Boolean(itemId || warehouseId || entryType || transactionType || documentNo || dateFrom || dateTo);

  const resetFilters = () => {
    setItemId("");
    setWarehouseId("");
    setEntryType("");
    setTransactionType("");
    setDocumentNo("");
    setDateFrom("");
    setDateTo("");
  };

  const exportButton = (format: "xlsx" | "csv") => (
    <button
      type="button"
      onClick={() => exportLedger(format)}
      disabled={!!exporting}
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition hover:bg-[var(--surface-raised)] disabled:cursor-not-allowed disabled:opacity-60"
      style={{ ...S.surface, ...S.primary }}
      title={`Download every entry matching the filters as ${format === "xlsx" ? "an Excel" : "a CSV"} file`}
    >
      {exporting === format ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : format === "xlsx" ? <FileSpreadsheet className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
      {format === "xlsx" ? " Export Excel" : " Export CSV"}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Stats & export — the page title already names the ledger. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="neutral" className="text-xs font-mono">
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </Badge>
          {exportButton("xlsx")}
          {exportButton("csv")}
          {hasActiveFilters && (
            <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-[var(--surface-raised)] transition" style={S.sub}>
              <RotateCcw className="h-3 w-3" /> Reset Filters
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border p-2.5" style={S.surface}>
        <div className="relative">
          <input
            type="text"
            value={documentNo}
            onChange={(e) => setDocumentNo(e.target.value)}
            placeholder="Search Document No., Item, Animal, Batch, GRN…"
            className={`${inputCls} w-60 pl-7`}
            style={S.input}
          />
          <Search className="absolute left-2 top-2 h-3.5 w-3.5" style={S.muted} />
        </div>

        <div className="min-w-[12rem] max-w-[190px]">
          <SearchableSelect
            ariaLabel="Location Code"
            value={warehouseId}
            onChange={setWarehouseId}
            options={[
              { value: "", code: "ALL", name: "All Locations", label: "All Locations (Location Code)" },
              ...warehouses.map((wh) => ({ value: wh.warehouse_id, code: wh.warehouse_code, name: wh.warehouse_name, label: `${wh.warehouse_code} — ${wh.warehouse_name}` })),
            ]}
            columnHeaders={["Code", "Location Name"]}
            columns={[{ key: "code", label: "Code" }, { key: "name", label: "Location Name" }]}
            placeholder="All Locations"
            triggerClassName="nf-input-sm w-full h-9"
          />
        </div>

        <div className="min-w-[13rem] max-w-[200px]">
          <SearchableSelect
            ariaLabel="Item"
            value={itemId}
            onChange={setItemId}
            options={[
              { value: "", code: "ALL", name: t("ilpAllItemsOptions", { count: items.length }), label: t("ilpAllItemsOptions", { count: items.length }) },
              ...items.map((it) => ({ value: it.item_id, code: it.item_code, name: it.item_name, label: `${it.item_code} — ${it.item_name}` })),
            ]}
            columnHeaders={["Code", "Item Name"]}
            columns={[{ key: "code", label: "Code" }, { key: "name", label: "Item Name" }]}
            placeholder={t("ilpAllItemsOptions", { count: items.length })}
            triggerClassName="nf-input-sm w-full h-9"
          />
        </div>

        <div className="min-w-[9rem]">
          <SearchableSelect
            ariaLabel="Entry Type"
            value={entryType}
            onChange={setEntryType}
            options={[
              { value: "", label: "All Entry Types" },
              { value: "POSITIVE", label: "Positive (+)" },
              { value: "NEGATIVE", label: "Negative (-)" },
            ]}
            columnHeaders={false}
            triggerClassName="nf-input-sm min-w-[9rem] h-9"
          />
        </div>

        <div className="min-w-[11rem]">
          <SearchableSelect
            ariaLabel="Transaction Type"
            value={transactionType}
            onChange={setTransactionType}
            options={[
              { value: "", label: t("ilpAllTransactionTypes") },
              { value: "PURCHASE", label: "Purchase" },
              { value: "ANIMAL_REGISTRATION", label: "Animal Registration" },
              { value: "MORTALITY", label: "Mortality" },
            ]}
            columnHeaders={false}
            triggerClassName="nf-input-sm min-w-[11rem] h-9"
          />
        </div>

        <div className="min-w-[10rem]">
          <SearchableSelect
            ariaLabel="Sort By"
            value={sortBy}
            onChange={(val) => setSortBy(val as "created_at" | "posting_date")}
            options={[
              { value: "created_at", label: "Recently Posted First" },
              { value: "posting_date", label: "Posting Date" },
            ]}
            columnHeaders={false}
            triggerClassName="nf-input-sm min-w-[10rem] h-9"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium" style={S.muted}>{t("ilpFrom")}</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} style={S.input} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium" style={S.muted}>{t("ilpTo")}</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} style={S.input} />
        </div>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError("")} />

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm min-w-[1250px]">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="whitespace-nowrap w-20">Entry No.</TableHead>
                <TableHead className="whitespace-nowrap w-28 min-w-[105px]">{t("ilpPostingDate")}</TableHead>
                <TableHead className="whitespace-nowrap w-36 min-w-[130px]">{t("ilpDocument")}</TableHead>
                <TableHead className="whitespace-nowrap">Item No.</TableHead>
                <TableHead className="whitespace-nowrap min-w-[210px]">Item Description</TableHead>
                <TableHead className="whitespace-nowrap min-w-[150px]">{t("ilpLocation")}</TableHead>
                <TableHead className="whitespace-nowrap min-w-[135px]">Transaction Type</TableHead>
                <TableHead className="whitespace-nowrap min-w-[110px]">Entry Type</TableHead>
                <TableHead className="whitespace-nowrap text-right w-28">{t("ilpQty")}</TableHead>
                <TableHead className="whitespace-nowrap text-right w-28">{t("ilpRemaining")}</TableHead>
                <TableHead className="whitespace-nowrap text-right w-24">{t("ilpRate")}</TableHead>
                <TableHead className="whitespace-nowrap text-right w-28">{t("ilpAmount")}</TableHead>
                <TableHead className="whitespace-nowrap w-28">Animal</TableHead>
                <TableHead className="whitespace-nowrap w-28">{t("ilpBatchNo")}</TableHead>
                <TableHead className="whitespace-nowrap text-center w-16">Action</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr>
                  <TableCell colSpan={15} className="py-12 text-center" style={S.sub}>
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} />
                    Loading Bio Asset Ledger entries…
                  </TableCell>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <TableCell colSpan={15} className="py-12 text-center" style={S.sub}>
                    <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} />
                    {hasActiveFilters ? "No Bio Asset Ledger entries match the selected filters." : "No animal has been registered yet."}
                  </TableCell>
                </tr>
              ) : (
                pagedRows.map((row) => {
                  const qty = Number(row.quantity || 0);
                  const isPos = qty > 0;
                  return (
                    <TableRow key={row.entry_id} onClick={() => setViewingEntry(row)} className="cursor-pointer hover:bg-[var(--surface-raised)] transition">
                      <TableCell className="whitespace-nowrap font-mono font-semibold" style={S.primary}>{row.entry_no}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium" style={S.primary}>{row.posting_date}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-semibold" style={S.primary}>{row.document_no}</span>
                          <span className="text-[10px] uppercase" style={S.muted}>
                            {BIO_DOCUMENT_LABEL[row.document_type] ?? row.document_type}
                            {row.source_grn_no ? ` • from ${row.source_grn_no}` : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs font-semibold" style={S.primary}>{row.item_code}</TableCell>
                      <TableCell className="max-w-[260px] truncate text-xs" style={S.sub} title={row.item_description}>{row.item_description}</TableCell>
                      <TableCell className="whitespace-nowrap" style={S.sub}>
                        <span className="truncate max-w-[170px] block font-mono text-xs" title={row.warehouse_name || ""}>{row.warehouse_code || "—"}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant="neutral" className="text-[11px] font-semibold">{TRANSACTION_LABEL[row.transaction_type] ?? row.transaction_type}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={isPos ? "POSITIVE" : "NEGATIVE"} label={isPos ? "Positive (+)" : "Negative (-)"} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono font-semibold" style={{ color: isPos ? "var(--success)" : "var(--danger)" }}>
                        {isPos ? `+${qtyText(qty)}` : qtyText(qty)}
                        <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">{row.uom}</span>
                      </TableCell>
                      {/* Remaining: a GRN's animals not registered yet. */}
                      <TableCell className="whitespace-nowrap text-right font-mono text-xs" style={S.sub}>
                        {row.transaction_type === "PURCHASE" ? (
                          <span className={Number(row.remaining_quantity) === 0 ? "text-[var(--text-muted)] line-through" : ""}>
                            {qtyText(Number(row.remaining_quantity ?? 0))}
                            <span className="ml-0.5 text-[10px] text-[var(--text-muted)]">{row.uom}</span>
                          </span>
                        ) : <span style={S.muted}>—</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-xs" style={S.sub}>{formatMoney(Number(row.rate || 0))}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-xs font-semibold" style={S.primary}>{formatMoney(Number(row.amount || 0))}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs" style={row.animal_code ? S.primary : S.muted}>{row.animal_code || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs" style={row.batch_no ? S.primary : S.muted}>{row.batch_no || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-center">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setViewingEntry(row); }}
                          className="inline-flex items-center justify-center rounded p-1 hover:bg-[var(--surface-raised)] transition"
                          style={S.sub}
                          title="View Bio Asset Ledger Entry"
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

        {!loading && rows.length > 0 && (
          <div className="border-t px-3 py-1.5 flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
            <span className="text-xs" style={S.muted}>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} of {rows.length} entries
            </span>
            <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(viewingEntry)}
        onClose={() => setViewingEntry(null)}
        title={viewingEntry ? `Bio Asset Ledger Entry — ${viewingEntry.document_no}` : ""}
        maxWidth="xl"
      >
        {viewingEntry && <BioAssetLedgerDetail entryId={viewingEntry.entry_id} initialData={viewingEntry} onClose={() => setViewingEntry(null)} />}
      </Dialog>
    </div>
  );
}

