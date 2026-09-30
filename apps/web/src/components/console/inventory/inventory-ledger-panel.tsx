"use client";

import { useEffect, useState } from "react";
import { Loader2, Inbox } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLanguage } from "@/hooks/useLanguage";

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

const ENTRY_STYLE: Record<string, any> = {
  POSITIVE: { color: "var(--success)" },
  NEGATIVE: { color: "var(--danger)" },
};

export default function InventoryLedgerPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [itemId, setItemId] = useState("");
  const [transactionType, setTransactionType] = useState("");
  const [documentNo, setDocumentNo] = useState("");
  const [sortBy, setSortBy] = useState<"created_at" | "posting_date">("created_at");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const companyId = getActiveCompanyId();

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (itemId) params.set("itemId", itemId);
      if (transactionType) params.set("transactionType", transactionType);
      if (documentNo) params.set("documentNo", documentNo);
      if (sortBy) params.set("sortBy", sortBy);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      params.set("limit", "200");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, transactionType, documentNo, sortBy, dateFrom, dateTo]);

  useEffect(() => { setPage(1); }, [itemId, transactionType, documentNo, sortBy, dateFrom, dateTo, pageSize]);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    api.get(`/item?${params.toString()}`).then((r) => setItems(unwrap<Row[]>(r) || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold" style={S.primary}>{t("ilpTitle")}</h2>
        <p className="mt-0.5 text-xs" style={S.sub}>{t("ilpSubtitle")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={documentNo}
          onChange={(e) => setDocumentNo(e.target.value)}
          placeholder="Filter document / batch..."
          className={`${inputCls} w-44`}
          style={S.input}
        />
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={`${inputCls} nf-select max-w-xs`} style={S.input}>
          <option value="">{t("ilpAllItemsOptions", { count: items.length })}</option>
          {items.map((it, idx) => (
            <option key={it.item_id} value={it.item_id}>
              {idx + 1}. {it.item_code} — {it.item_name}
            </option>
          ))}
        </select>
        <select value={transactionType} onChange={(e) => setTransactionType(e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
          <option value="">{t("ilpAllTransactionTypes")}</option>
          {["PURCHASE", "CONSUMPTION", "OUTPUT", "TRANSFER_SHIPMENT", "TRANSFER_RECEIPT", "SALES", "VARIANCE_POSITIVE", "VARIANCE_NEGATIVE"].map((tt) => (
            <option key={tt} value={tt}>{tt.replace(/_/g, " ")}</option>
          ))}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className={`${inputCls} nf-select`} style={S.input}>
          <option value="created_at">Recently Posted First</option>
          <option value="posting_date">Posting Date</option>
        </select>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium" style={S.muted}>{t("ilpFrom")}</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} style={S.input} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium" style={S.muted}>{t("ilpTo")}</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} style={S.input} />
        </div>
      </div>

      {error && (
        <InlineAlert>{error}</InlineAlert>
      )}

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm min-w-[950px]">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="whitespace-nowrap w-28 min-w-[110px]">{t("ilpPostingDate")}</TableHead>
                <TableHead className="whitespace-nowrap w-36 min-w-[130px]">{t("ilpDocument")}</TableHead>
                <TableHead className="whitespace-nowrap min-w-[200px]">{t("ilpItem")}</TableHead>
                <TableHead className="whitespace-nowrap w-36">{t("ilpType")}</TableHead>
                <TableHead className="whitespace-nowrap text-right w-24">{t("ilpQty")}</TableHead>
                <TableHead className="whitespace-nowrap text-right w-24">{t("ilpRemaining")}</TableHead>
                <TableHead className="whitespace-nowrap text-right w-20">{t("ilpRate")}</TableHead>
                <TableHead className="whitespace-nowrap text-right w-24">{t("ilpAmount")}</TableHead>
                <TableHead className="whitespace-nowrap w-28">{t("ilpLotNo")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr><TableCell colSpan={9} className="py-10 text-center" style={S.sub}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("ilpLoading")}</TableCell></tr>
              ) : rows.length === 0 ? (
                <tr><TableCell colSpan={9} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("ilpNoLedgerEntries")}</TableCell></tr>
              ) : (
                pagedRows.map((row) => (
                  <TableRow key={row.ledger_id}>
                    <TableCell className="whitespace-nowrap font-medium" style={S.primary}>{row.posting_date}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs" style={S.sub}>{row.document_no}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{row.item_code} — {row.item_description}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{row.transaction_type?.replace(/_/g, " ")}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold font-mono" style={ENTRY_STYLE[row.entry_type] || S.primary}>{row.quantity}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono" style={S.sub}>{row.remaining_quantity ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono" style={S.sub}>{row.rate ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono" style={S.primary}>{row.amount ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{row.lot_no || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </div>
        {!loading && rows.length > 0 && (
          <div className="border-t px-2" style={{ borderColor: "var(--border)" }}>
            <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </div>
    </div>
  );
}
