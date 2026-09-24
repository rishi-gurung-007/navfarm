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

const PARAM_TYPES = ["NUMERIC", "BOOLEAN", "GRADE"];

const emptyForm = () => ({
  lob_id: "",
  param_code: "",
  param_name: "",
  param_type: "NUMERIC",
  uom: "",
  min_value: "",
  max_value: "",
  pass_criteria: "",
  fail_criteria: "",
  grade_scale: "",
  is_mandatory: true,
});

export default function QcParameterPanel() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [nobs, setNobs] = useState<Row[]>([]);
  const [lobs, setLobs] = useState<Row[]>([]);
  const [uoms, setUoms] = useState<Row[]>([]);
  const [nobId, setNobId] = useState("");

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
      params.set("limit", "200");
      const res = await api.get(`/qc-parameter?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setError(err?.message || t("qcpFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => { setPage(1); }, [search, pageSize]);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    const qs = params.toString();
    api.get(`/setup/wizard/nobs?${qs}`).then((r) => setNobs(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/uom?${qs}`).then((r) => setUoms(unwrap<Row[]>(r) || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!nobId) { setLobs([]); return; }
    api.get(`/setup/wizard/lobs/${nobId}`).then((r) => setLobs(unwrap<Row[]>(r) || [])).catch(() => setLobs([]));
  }, [nobId]);

  const openCreate = () => {
    setNobId("");
    setForm(emptyForm());
    setFormError("");
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setFormError("");
    try {
      if (!form.lob_id) throw new Error(t("qcpLobRequired"));
      if (!form.param_code || !form.param_name) throw new Error(t("qcpCodeNameRequired"));
      let gradeScale: Record<string, string> | undefined;
      if (form.param_type === "GRADE" && form.grade_scale) {
        try {
          gradeScale = JSON.parse(form.grade_scale);
        } catch {
          throw new Error(t("qcpGradeScaleInvalidJson"));
        }
      }
      await api.post("/qc-parameter", {
        company_id: companyId,
        lob_id: form.lob_id,
        param_code: form.param_code,
        param_name: form.param_name,
        param_type: form.param_type,
        uom: form.uom || undefined,
        min_value: form.min_value !== "" ? Number(form.min_value) : undefined,
        max_value: form.max_value !== "" ? Number(form.max_value) : undefined,
        pass_criteria: form.pass_criteria || undefined,
        fail_criteria: form.fail_criteria || undefined,
        grade_scale: gradeScale,
        is_mandatory: form.is_mandatory,
      });
      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || t("qcpFailedToSave"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>{t("qcpTitle")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>{t("qcpDescription")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("qcpSearchPlaceholder")} className="nf-input-sm pl-8 pr-3" style={S.input} />
          </div>
          <Button size="sm" onClick={openCreate} >
            <Plus className="h-3.5 w-3.5" /> {t("qcpNewQcParameter")}
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
                <TableHead className="whitespace-nowrap">{t("qcpCode")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("qcpName")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("qcpType")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("qcpRangeScale")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("qcpMandatory")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr><TableCell colSpan={5} className="py-10 text-center" style={S.sub}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("qcpLoading")}</TableCell></tr>
              ) : rows.length === 0 ? (
                <tr><TableCell colSpan={5} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("qcpNoParametersYet")}</TableCell></tr>
              ) : (
                pagedRows.map((row) => (
                  <TableRow key={row.param_id}>
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{row.param_code}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{row.param_name}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{row.param_type}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>
                      {row.param_type === "NUMERIC"
                        ? `${row.min_value ?? "—"} – ${row.max_value ?? "—"} ${row.uom || ""}`
                        : row.param_type === "GRADE"
                        ? (row.grade_scale ? Object.keys(row.grade_scale).join(", ") : "—")
                        : t("qcpTrueFalse")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{row.is_mandatory ? t("qcpYes") : t("qcpNo")}</TableCell>
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
        title={t("qcpNewQcParameter")}
        footer={
          <Button onClick={handleSave} disabled={saving} >
            {saving ? t("qcpSaving") : t("qcpSave")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <InlineAlert>{formError}</InlineAlert>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("qcpNatureOfBusiness")} <span className="text-(--danger)">*</span></label>
              <select value={nobId} onChange={(e) => { setNobId(e.target.value); setForm((f) => ({ ...f, lob_id: "" })); }} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("qcpSelectEllipsis")}</option>
                {nobs.map((n) => <option key={n.nob_id} value={n.nob_id}>{n.nob_code} — {n.nob_name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("qcpLineOfBusiness")} <span className="text-(--danger)">*</span></label>
              <select value={form.lob_id} onChange={(e) => setForm((f: Row) => ({ ...f, lob_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input} disabled={!nobId}>
                <option value="">{nobId ? t("qcpSelectEllipsis") : t("qcpSelectNatureOfBusinessFirst")}</option>
                {lobs.map((l) => <option key={l.lob_id} value={l.lob_id}>{l.lob_code} — {l.lob_name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("qcpCode")} <span className="text-(--danger)">*</span></label>
              <input value={form.param_code} onChange={(e) => setForm((f: Row) => ({ ...f, param_code: e.target.value }))} placeholder="QC_BIRD_WEIGHT" className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("qcpName")} <span className="text-(--danger)">*</span></label>
              <input value={form.param_name} onChange={(e) => setForm((f: Row) => ({ ...f, param_name: e.target.value }))} placeholder={t("qcpNamePlaceholder")} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("qcpType")}</label>
              <select value={form.param_type} onChange={(e) => setForm((f: Row) => ({ ...f, param_type: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                {PARAM_TYPES.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("qcpMandatory")}</label>
              <select value={form.is_mandatory ? "yes" : "no"} onChange={(e) => setForm((f: Row) => ({ ...f, is_mandatory: e.target.value === "yes" }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="yes">{t("qcpMandatoryYesOption")}</option>
                <option value="no">{t("qcpMandatoryNoOption")}</option>
              </select>
            </div>

            {form.param_type === "NUMERIC" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("qcpMinValue")}</label>
                  <input type="number" value={form.min_value} onChange={(e) => setForm((f: Row) => ({ ...f, min_value: e.target.value }))} className={inputCls} style={S.input} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("qcpMaxValue")}</label>
                  <input type="number" value={form.max_value} onChange={(e) => setForm((f: Row) => ({ ...f, max_value: e.target.value }))} className={inputCls} style={S.input} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("qcpUom")}</label>
                  <select value={form.uom} onChange={(e) => setForm((f: Row) => ({ ...f, uom: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                    <option value="">{t("qcpSelectEllipsis")}</option>
                    {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
                  </select>
                </div>
              </>
            )}

            {form.param_type === "GRADE" && (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="nf-text-label" style={S.sub}>{t("qcpGradeScaleJson")}</label>
                <input value={form.grade_scale} onChange={(e) => setForm((f: Row) => ({ ...f, grade_scale: e.target.value }))} placeholder='{"A":"2.0-2.5kg","B":"1.8-2.0kg"}' className={inputCls} style={S.input} />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("qcpPassCriteria")}</label>
              <input value={form.pass_criteria} onChange={(e) => setForm((f: Row) => ({ ...f, pass_criteria: e.target.value }))} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("qcpFailCriteria")}</label>
              <input value={form.fail_criteria} onChange={(e) => setForm((f: Row) => ({ ...f, fail_criteria: e.target.value }))} className={inputCls} style={S.input} />
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
