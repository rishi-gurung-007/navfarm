"use client";

import { useEffect, useState } from "react";
import { Plus, Search, Loader2, Inbox } from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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

const inputCls = "nf-input";

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const PARAMETER_TYPES = ["CONSUMPTION", "MORTALITY", "OUTPUT", "OVERHEAD", "OBSERVATION"];
const QTY_METHODS = ["PER_UNIT", "PER_BATCH", "MANUAL_AT_ENTRY"];

const emptyForm = () => ({
  parameter_code: "",
  parameter_name: "",
  parameter_type: "CONSUMPTION",
  item_id: "",
  resource_id: "",
  default_uom: "",
  qty_method: "PER_UNIT",
  default_qty_per_unit: "",
  default_qty_per_batch: "",
  description: "",
  is_mandatory: false,
});

export default function ParameterPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [items, setItems] = useState<Row[]>([]);
  const [resources, setResources] = useState<Row[]>([]);
  const [uoms, setUoms] = useState<Row[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState<Row>(emptyForm());

  const companyId = getActiveCompanyId();

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (search) params.set("search", search);
      if (typeFilter) params.set("parameterType", typeFilter);
      params.set("limit", "200");
      const res = await api.get(`/parameter?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t("paramFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter]);

  useEffect(() => { setPage(1); }, [search, typeFilter, pageSize]);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    const qs = params.toString();
    api.get(`/item?${qs}`).then((r) => setItems(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/resource?${qs}`).then((r) => setResources(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/uom?${qs}`).then((r) => setUoms(unwrap<Row[]>(r) || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setForm(emptyForm());
    setFormError("");
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setFormError("");
    try {
      if (!form.parameter_code || !form.parameter_name) throw new Error(t("paramCodeNameRequired"));
      if (!form.qty_method) throw new Error(t("paramQtyMethodRequired"));
      await api.post("/parameter", {
        company_id: companyId,
        parameter_code: form.parameter_code,
        parameter_name: form.parameter_name,
        parameter_type: form.parameter_type,
        item_id: form.item_id || undefined,
        resource_id: form.resource_id || undefined,
        default_uom: form.default_uom || undefined,
        qty_method: form.qty_method,
        default_qty_per_unit: form.default_qty_per_unit ? Number(form.default_qty_per_unit) : undefined,
        default_qty_per_batch: form.default_qty_per_batch ? Number(form.default_qty_per_batch) : undefined,
        description: form.description || undefined,
        is_mandatory: form.is_mandatory,
      });
      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || t("paramFailedToSave"));
    } finally {
      setSaving(false);
    }
  };

  const itemLabel = (id: string) => {
    const it = items.find((i) => i.item_id === id);
    return it ? it.item_code : "—";
  };
  const resourceLabel = (id: string) => {
    const r = resources.find((x) => x.resource_id === id);
    return r ? r.resource_code : "—";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>{t("paramTitle")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>{t("paramSubtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="nf-input-sm px-2" style={S.input}>
            <option value="">{t("paramAllTypes")}</option>
            {PARAMETER_TYPES.map((pt) => <option key={pt} value={pt}>{pt}</option>)}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("paramSearchPlaceholder")} className="nf-input-sm pl-8 pr-3" style={S.input} />
          </div>
          <Button size="sm" onClick={openCreate} >
            <Plus className="h-3.5 w-3.5" /> {t("paramNewParameter")}
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
              <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                <TableHead className="whitespace-nowrap">{t("paramColCode")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("paramColName")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("paramColType")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("paramColItemResource")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("paramColMethod")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("paramColDefaultQty")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr><TableCell colSpan={6} className="py-10 text-center" style={S.sub}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("paramLoading")}</TableCell></tr>
              ) : rows.length === 0 ? (
                <tr><TableCell colSpan={6} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("paramNoParametersYet")}</TableCell></tr>
              ) : (
                pagedRows.map((row) => (
                  <TableRow key={row.parameter_id}>
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{row.parameter_code}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{row.parameter_name}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{row.parameter_type}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{row.item_id ? itemLabel(row.item_id) : row.resource_id ? resourceLabel(row.resource_id) : "—"}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{row.qty_method}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>
                      {row.default_qty_per_unit ? `${row.default_qty_per_unit}/unit` : row.default_qty_per_batch ? `${row.default_qty_per_batch}/batch` : "—"} {row.default_uom || ""}
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

      <Dialog
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={t("paramNewParameterTitle")}
        footer={
          <Button onClick={handleSave} disabled={saving} >
            {saving ? t("paramSaving") : t("paramSave")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <InlineAlert>{formError}</InlineAlert>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("paramFieldCode")} <span style={{ color: "var(--danger)" }}>*</span></label>
              <input value={form.parameter_code} onChange={(e) => setForm((f: Row) => ({ ...f, parameter_code: e.target.value }))} placeholder="PARAM-CONS-FEED-STARTER" className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("paramFieldName")} <span style={{ color: "var(--danger)" }}>*</span></label>
              <input value={form.parameter_name} onChange={(e) => setForm((f: Row) => ({ ...f, parameter_name: e.target.value }))} placeholder={t("paramNamePlaceholder")} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("paramFieldType")}</label>
              <select value={form.parameter_type} onChange={(e) => setForm((f: Row) => ({ ...f, parameter_type: e.target.value, item_id: "", resource_id: "" }))} className={`${inputCls} nf-select`} style={S.input}>
                {PARAMETER_TYPES.map((pt) => <option key={pt} value={pt}>{pt}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("paramFieldQtyMethod")}</label>
              <select value={form.qty_method} onChange={(e) => setForm((f: Row) => ({ ...f, qty_method: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                {QTY_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {["CONSUMPTION", "OUTPUT"].includes(form.parameter_type) && (
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("paramFieldItem")}</label>
                <select value={form.item_id} onChange={(e) => setForm((f: Row) => ({ ...f, item_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                  <option value="">{t("paramSelectPlaceholder")}</option>
                  {items.map((it) => <option key={it.item_id} value={it.item_id}>{it.item_code} — {it.item_name}</option>)}
                </select>
              </div>
            )}
            {form.parameter_type === "OVERHEAD" && (
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("paramFieldResourceOptional")}</label>
                <select value={form.resource_id} onChange={(e) => setForm((f: Row) => ({ ...f, resource_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                  <option value="">{t("paramNone")}</option>
                  {resources.map((r) => <option key={r.resource_id} value={r.resource_id}>{r.resource_code}</option>)}
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("paramFieldDefaultUom")}</label>
              <select value={form.default_uom} onChange={(e) => setForm((f: Row) => ({ ...f, default_uom: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("paramSelectPlaceholder")}</option>
                {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
              </select>
            </div>

            {form.qty_method === "PER_UNIT" && (
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("paramFieldDefaultQtyUnitDay")}</label>
                <input type="number" value={form.default_qty_per_unit} onChange={(e) => setForm((f: Row) => ({ ...f, default_qty_per_unit: e.target.value }))} className={inputCls} style={S.input} />
              </div>
            )}
            {form.qty_method === "PER_BATCH" && (
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("paramFieldDefaultQtyBatch")}</label>
                <input type="number" value={form.default_qty_per_batch} onChange={(e) => setForm((f: Row) => ({ ...f, default_qty_per_batch: e.target.value }))} className={inputCls} style={S.input} />
              </div>
            )}

            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="nf-text-label" style={S.sub}>{t("paramFieldDescription")}</label>
              <input value={form.description} onChange={(e) => setForm((f: Row) => ({ ...f, description: e.target.value }))} className={inputCls} style={S.input} />
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
