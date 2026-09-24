"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Search, Loader2, Inbox, Eye, CheckCircle2, ArrowRight } from "lucide-react";
import { api } from "@/services/api-client";
import { useLanguage } from "@/hooks/useLanguage";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";

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

const inputCls = "nf-input";

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const emptyLine = () => ({ item_id: "", quantity: "", uom: "" });

export default function StockTransferPanel() {
  const { t } = useLanguage();
  const STATUS_LABEL: Record<string, string> = {
    DRAFT: t("stpStatusDraft"),
    POSTED: t("stpStatusPosted"),
    CANCELLED: t("stpStatusCancelled"),
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [warehouses, setWarehouses] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [uoms, setUoms] = useState<Row[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [header, setHeader] = useState<Row>({ from_warehouse_id: "", to_warehouse_id: "", posting_date: "", remarks: "" });
  const [lines, setLines] = useState<Row[]>([emptyLine()]);

  const [viewing, setViewing] = useState<Row | null>(null);
  const [posting, setPosting] = useState(false);

  const companyId = getActiveCompanyId();

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "200");
      const res = await api.get(`/stock-transfer?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t("stpFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  useEffect(() => { setPage(1); }, [search, statusFilter, pageSize]);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    const qs = params.toString();
    api.get(`/warehouse?${qs}`).then((r) => setWarehouses(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/item?${qs}`).then((r) => setItems(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/uom?${qs}`).then((r) => setUoms(unwrap<Row[]>(r) || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setHeader({ from_warehouse_id: "", to_warehouse_id: "", posting_date: new Date().toISOString().slice(0, 10), remarks: "" });
    setLines([emptyLine()]);
    setFormError("");
    setModalOpen(true);
  };

  const setLineField = (idx: number, key: string, value: any) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const handleSave = async () => {
    setSaving(true);
    setFormError("");
    try {
      if (!header.from_warehouse_id) throw new Error(t("stpSourceWarehouseRequired"));
      if (!header.to_warehouse_id) throw new Error(t("stpDestinationWarehouseRequired"));
      if (header.from_warehouse_id === header.to_warehouse_id) throw new Error(t("stpSourceDestMustDiffer"));
      if (!header.posting_date) throw new Error(t("stpPostingDateRequired"));
      const cleanLines = lines
        .filter((l) => l.item_id && l.quantity && l.uom)
        .map((l) => ({ item_id: l.item_id, quantity: Number(l.quantity), uom: l.uom }));
      if (cleanLines.length === 0) throw new Error(t("stpAddAtLeastOneLine"));

      await api.post("/stock-transfer", {
        company_id: companyId,
        from_warehouse_id: header.from_warehouse_id,
        to_warehouse_id: header.to_warehouse_id,
        posting_date: header.posting_date,
        remarks: header.remarks || undefined,
        lines: cleanLines,
      });
      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || t("stpFailedToSave"));
    } finally {
      setSaving(false);
    }
  };

  const openView = async (row: Row) => {
    try {
      const res = await api.get(`/stock-transfer/${row.transfer_id}`);
      setViewing(unwrap<Row>(res));
    } catch (err: any) {
      setError(err?.message || t("stpFailedToLoadDetails"));
    }
  };

  const handlePost = async () => {
    if (!viewing) return;
    setPosting(true);
    try {
      const res = await api.post(`/stock-transfer/${viewing.transfer_id}/post`, {});
      setViewing(unwrap<Row>(res));
      load();
    } catch (err: any) {
      setError(err?.message || t("stpFailedToPost"));
    } finally {
      setPosting(false);
    }
  };

  const warehouseLabel = (id: string) => warehouses.find((w) => w.warehouse_id === id)?.warehouse_name || "—";
  const itemLabel = (id: string) => {
    const it = items.find((i) => i.item_id === id);
    return it ? `${it.item_code} — ${it.item_name}` : "—";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>{t("stpTitle")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>{t("stpSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="nf-input-sm px-2" style={S.input}>
            <option value="">{t("stpAllStatuses")}</option>
            <option value="DRAFT">{t("stpStatusDraft")}</option>
            <option value="POSTED">{t("stpStatusPosted")}</option>
            <option value="CANCELLED">{t("stpStatusCancelled")}</option>
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("stpSearchPlaceholder")} className="nf-input-sm pl-8 pr-3" style={S.input} />
          </div>
          <Button size="sm" onClick={openCreate} >
            <Plus className="h-3.5 w-3.5" /> {t("stpNewTransfer")}
          </Button>
        </div>
      </div>

      {error && (
        <InlineAlert>{error}</InlineAlert>
      )}

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="whitespace-nowrap">{t("stpColTransferNo")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("stpColPostingDate")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("stpColRoute")}</TableHead>
                <TableHead className="text-right">{t("stpColStatus")}</TableHead>
                <TableHead className="text-right">{t("stpColActions")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr><TableCell colSpan={5} className="py-10 text-center" style={S.sub}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("stpLoading")}</TableCell></tr>
              ) : rows.length === 0 ? (
                <tr><TableCell colSpan={5} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("stpNoTransfersYet")}</TableCell></tr>
              ) : (
                pagedRows.map((row) => (
                  <TableRow key={row.transfer_id}>
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{row.transfer_no}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{row.posting_date}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>
                      <span className="inline-flex items-center gap-1.5">{warehouseLabel(row.from_warehouse_id)} <ArrowRight className="h-3 w-3" style={S.muted} /> {warehouseLabel(row.to_warehouse_id)}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={row.status} label={STATUS_LABEL[row.status] || row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <button onClick={() => openView(row)} title={t("stpView")} className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)" style={S.sub}>
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
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

      {/* Create modal */}
      <Dialog
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={t("stpNewStockTransfer")}
        maxWidth="xl"
        footer={
          <Button size="sm" onClick={handleSave} disabled={saving} className="nf-btn-primary">
            {saving ? t("stpSaving") : t("stpSaveDraft")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <InlineAlert>{formError}</InlineAlert>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("stpFromWarehouse")} <span className="text-(--danger)">*</span></label>
              <select value={header.from_warehouse_id} onChange={(e) => setHeader((h) => ({ ...h, from_warehouse_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("stpSelectEllipsis")}</option>
                {warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_code} — {w.warehouse_name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("stpToWarehouse")} <span className="text-(--danger)">*</span></label>
              <select value={header.to_warehouse_id} onChange={(e) => setHeader((h) => ({ ...h, to_warehouse_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("stpSelectEllipsis")}</option>
                {warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_code} — {w.warehouse_name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("stpPostingDate")} <span className="text-(--danger)">*</span></label>
              <input type="date" value={header.posting_date} onChange={(e) => setHeader((h) => ({ ...h, posting_date: e.target.value }))} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("stpRemarks")}</label>
              <input value={header.remarks} onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))} className={inputCls} style={S.input} />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("stpLines")}</p>
            <button onClick={addLine} type="button" className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold" style={S.surface}>
              <Plus className="h-3 w-3" /> {t("stpAddLine")}
            </button>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
            <table className="w-full border-collapse text-left text-xs">
              <TableHeader>
                <tr className="border-b border-(--row-border)">
                  <TableHead className="h-auto px-3 py-2">{t("stpColItem")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("stpColQty")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("stpColUom")}</TableHead>
                  <TableHead className="h-auto px-3 py-2"></TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {lines.map((line, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="px-2 py-1.5">
                      <select value={line.item_id} onChange={(e) => setLineField(idx, "item_id", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                        <option value="">{t("stpSelectItemOptions", { count: items.length })}</option>
                        {items.map((it, i) => (
                          <option key={it.item_id} value={it.item_id}>
                            {i + 1}. {it.item_code} — {it.item_name}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 w-24"><input type="number" value={line.quantity} onChange={(e) => setLineField(idx, "quantity", e.target.value)} className={inputCls} style={S.input} /></TableCell>
                    <TableCell className="px-2 py-1.5 w-28">
                      <select value={line.uom} onChange={(e) => setLineField(idx, "uom", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                        <option value="">{t("stpSelectEllipsis")}</option>
                        {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
                      </select>
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <button onClick={() => removeLine(idx)} type="button" className="rounded-[var(--radius-xs)] p-1 transition hover:bg-(--danger-muted)" style={{ color: "var(--danger)" }}><Trash2 className="h-3.5 w-3.5" /></button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </div>
      </Dialog>

      {/* View / Post modal */}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? t("stpTransferTitle", { transferNo: viewing.transfer_no }) : ""}
        maxWidth="xl"
        footer={
          viewing?.status === "DRAFT" ? (
            <Button size="sm" onClick={handlePost} disabled={posting} className="flex items-center gap-1.5 nf-btn-primary">
              <CheckCircle2 className="h-4 w-4" /> {posting ? t("stpPosting") : t("stpPost")}
            </Button>
          ) : undefined
        }
      >
        {viewing && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("stpStatus")}</p><StatusBadge status={viewing.status} label={STATUS_LABEL[viewing.status] || viewing.status} className="mt-1" /></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("stpPostingDate")}</p><p style={S.primary}>{viewing.posting_date}</p></div>
              <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("stpRoute")}</p><p style={S.primary}>{warehouseLabel(viewing.from_warehouse_id)} → {warehouseLabel(viewing.to_warehouse_id)}</p></div>
              {viewing.posted_at && <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("stpPostedAt")}</p><p style={S.primary}>{viewing.posted_at}</p></div>}
            </div>

            <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
              <table className="w-full border-collapse text-left text-xs">
                <TableHeader>
                  <tr className="border-b border-(--row-border)">
                    <TableHead className="h-auto px-3 py-2">{t("stpColItem")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("stpColQty")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("stpColUom")}</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {(viewing.lines || []).map((l: Row) => (
                    <TableRow key={l.line_id}>
                      <TableCell className="px-3 py-2" style={S.primary}>{itemLabel(l.item_id)}</TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>{l.quantity}</TableCell>
                      <TableCell className="px-3 py-2" style={S.primary}>{l.uom}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
