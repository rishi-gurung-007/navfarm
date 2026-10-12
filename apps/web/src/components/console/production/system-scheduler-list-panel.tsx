"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import SchedulerDetailPanel from "@/components/console/production/scheduler-detail-panel";
import { confirmAction } from "@/components/ui/confirm-dialog";

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

const inputCls = "nf-input";
const DATA_ENTRY_LEVELS = ["SHED", "PEN", "FARM"];

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const emptyForm = () => ({ stage_id: "", breed_id: "", scheduler_name: "", data_entry_level: "SHED", notes: "" });

/**
 * The System Schedulers tab: a stage's standard activities with no batch.
 * Creating one only needs the stage, an optional breed and a name; the
 * activities are then added in the same line table and form a batch's
 * scheduler uses (SchedulerDetailPanel kind="system").
 */
export default function SystemSchedulerListPanel() {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [viewingId, setViewingId] = useState<string | null>(null);

  const [stages, setStages] = useState<Row[]>([]);
  const [breeds, setBreeds] = useState<Row[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<Row>(emptyForm());
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const viewingRow = rows.find((r) => r.system_scheduler_id === viewingId) || null;

  const load = () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ companyId });
    if (search) params.set("search", search);
    api.get(`/system-scheduler?${params.toString()}`)
      .then((r) => setRows(unwrap<Row[]>(r) || []))
      .catch((err: any) => setError(err?.message || "Could not load system schedulers."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [companyId]);
  useEffect(() => {
    const timeout = setTimeout(load, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!createOpen || !companyId) return;
    const qs = new URLSearchParams({ companyId, isActive: "true", limit: "200" }).toString();
    api.get(`/stage?${qs}`).then((r) => setStages(unwrap<Row[]>(r) || [])).catch(() => setStages([]));
    api.get(`/breed?${qs}`).then((r) => setBreeds(unwrap<Row[]>(r) || [])).catch(() => setBreeds([]));
  }, [createOpen, companyId]);

  // A stage can be listed twice (the tenant template row and the company's
  // copy); the system scheduler is matched on the stage's code, so one entry each.
  const stageOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...stages]
      .sort((a, b) => (a.stage_sequence ?? 0) - (b.stage_sequence ?? 0))
      .filter((s) => {
        const key = `${s.lob_id}:${s.stage_code}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((s) => ({ value: s.stage_id, label: s.stage_name }));
  }, [stages]);

  const selectedStage = stages.find((s) => s.stage_id === form.stage_id);
  const breedOptions = useMemo(
    () => breeds
      .filter((b) => !selectedStage || !b.lob_id || b.lob_id === selectedStage.lob_id)
      .map((b) => ({ value: b.breed_id, label: b.breed_name })),
    [breeds, selectedStage],
  );

  const openCreate = () => {
    setForm(emptyForm());
    setFormError("");
    setCreateOpen(true);
  };

  const create = async () => {
    if (!form.stage_id) return setFormError(t("sysSchErrStageRequired"));
    if (!form.scheduler_name.trim()) return setFormError(t("sysSchErrNameRequired"));
    setSaving(true);
    setFormError("");
    try {
      const created = unwrap<Row>(await api.post("/system-scheduler", {
        company_id: companyId,
        stage_id: form.stage_id,
        breed_id: form.breed_id || undefined,
        scheduler_name: form.scheduler_name.trim(),
        data_entry_level: form.data_entry_level,
        notes: form.notes || undefined,
      }));
      setCreateOpen(false);
      load();
      setViewingId(created.system_scheduler_id);
    } catch (err: any) {
      setFormError(err?.message || "Could not create the system scheduler.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: Row) => {
    if (!(await confirmAction({ title: t("cfDeleteSystemSchedulerTitle"), message: t("sysSchConfirmDelete"), tone: "danger" }))) return;
    try {
      await api.delete(`/system-scheduler/${row.system_scheduler_id}`);
      if (viewingId === row.system_scheduler_id) setViewingId(null);
      load();
    } catch (err: any) {
      setError(err?.message || "Could not delete the system scheduler.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("sysSchSearch")}
              className={`${inputCls} pl-8 w-56`}
              style={S.input}
            />
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin" style={S.muted} />}
        </div>
        <Button size="sm" onClick={openCreate} className="flex items-center gap-1.5 text-xs font-medium">
          <Plus className="h-3.5 w-3.5" />
          {t("sysSchCreate")}
        </Button>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {!loading && rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title={t("sysSchNoResults")} description={t("sysSchNoResultsHint")} />
      ) : loading && rows.length === 0 ? (
        <LoadingState label={t("schLoading")} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
          <table className="w-full border-collapse text-left text-xs">
            <TableHeader><tr className="border-b border-[var(--row-border)]">
              <TableHead className="h-auto px-3 py-2">{t("schColStage")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColBreed")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("sysSchColName")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("sysSchColActivities")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("scLabelDataEntryLevel")}</TableHead>
              <TableHead className="h-auto px-3 py-2">{t("schColStatus")}</TableHead>
              <TableHead className="h-auto px-3 py-2"></TableHead>
            </tr></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.system_scheduler_id} className="cursor-pointer" onClick={() => setViewingId(r.system_scheduler_id)}>
                  <TableCell className="px-3 py-2 font-medium" style={S.primary}>{r.stage_name || r.stage_code}</TableCell>
                  <TableCell className="px-3 py-2" style={S.sub}>{r.breed_name || t("sysSchAllBreeds")}</TableCell>
                  <TableCell className="px-3 py-2" style={S.primary}>{r.scheduler_name}</TableCell>
                  <TableCell className="px-3 py-2" style={S.sub}>{r.line_count ?? 0}</TableCell>
                  <TableCell className="px-3 py-2" style={S.sub}>{r.data_entry_level}</TableCell>
                  <TableCell className="px-3 py-2"><StatusBadge status={r.is_active ? "ACTIVE" : "INACTIVE"} label={r.is_active ? t("sysSchActive") : t("sysSchInactive")} /></TableCell>
                  <TableCell className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={(e) => { e.stopPropagation(); setViewingId(r.system_scheduler_id); }} className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
                        {t("schViewDetail")}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); remove(r); }} className="rounded p-1 hover:opacity-70" aria-label={t("sysSchDelete")}>
                        <Trash2 className="h-3.5 w-3.5" style={{ color: "var(--danger)" }} />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("sysSchCreateTitle")}
        presentation="compact"
        maxWidth="md"
        footer={<Button onClick={create} disabled={saving}>{saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t("sysSchCreateAction")}</Button>}
      >
        <div className="flex flex-col gap-4">
          {formError && <InlineAlert>{formError}</InlineAlert>}
          <Field label={t("sysSchFieldStage")} htmlFor="sys-sch-stage" required>
            <SearchableSelect
              ariaLabel={t("sysSchFieldStage")}
              value={form.stage_id}
              onChange={(val) => setForm((f) => ({ ...f, stage_id: val, breed_id: "" }))}
              options={stageOptions}
              placeholder={t("sysSchFieldStage")}
            />
          </Field>
          <Field label={t("sysSchFieldBreed")} htmlFor="sys-sch-breed" hint={t("sysSchFieldBreedHint")}>
            <SearchableSelect
              ariaLabel={t("sysSchFieldBreed")}
              value={form.breed_id}
              onChange={(val) => setForm((f) => ({ ...f, breed_id: val }))}
              options={breedOptions}
              placeholder={t("sysSchAllBreeds")}
              onClear={form.breed_id ? () => setForm((f) => ({ ...f, breed_id: "" })) : undefined}
            />
          </Field>
          <Field label={t("sysSchFieldName")} htmlFor="sys-sch-name" required>
            <input
              id="sys-sch-name"
              value={form.scheduler_name}
              onChange={(e) => setForm((f) => ({ ...f, scheduler_name: e.target.value }))}
              maxLength={150}
              className={`${inputCls} w-full`}
              style={S.input}
            />
          </Field>
          <Field label={t("scLabelDataEntryLevel")} htmlFor="sys-sch-level">
            <SearchableSelect
              ariaLabel={t("scLabelDataEntryLevel")}
              value={form.data_entry_level}
              onChange={(val) => setForm((f) => ({ ...f, data_entry_level: val || "SHED" }))}
              options={DATA_ENTRY_LEVELS}
            />
          </Field>
          <Field label={t("sysSchFieldNotes")} htmlFor="sys-sch-notes">
            <textarea
              id="sys-sch-notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className={`${inputCls} w-full`}
              style={S.input}
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={!!viewingId}
        onClose={() => setViewingId(null)}
        title={t("sysSchDetailTitle", { name: viewingRow?.scheduler_name || "" })}
        maxWidth="xl"
      >
        {viewingId && <SchedulerDetailPanel kind="system" schedulerId={viewingId} onChanged={load} />}
      </Dialog>
    </div>
  );
}
