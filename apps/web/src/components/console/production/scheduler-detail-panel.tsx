"use client";

import { useEffect, useState } from "react";
import { Plus, Loader2, Trash2, Pencil } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useLanguage } from "@/hooks/useLanguage";
import { findConflictingSchedulerLine } from "./scheduler-line-overlap";

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

const inputCls = "nf-input";

const LINE_TYPES = ["CONSUMPTION", "OUTPUT", "DESCRIPTIVE", "OVERHEAD", "RESOURCE", "TRANSFER"];
const OCCURRENCES = ["DAILY", "WEEKLY", "MONTHLY", "ONCE", "CUSTOM"];
const QTY_BASES = ["PER_HEAD", "TOTAL_BATCH", "PER_PEN", "FIXED"];
const OUTPUT_BASES = ["PER_SOW", "PER_PEN", "PER_BATCH"];
const ALERT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"];
const KPI_METRICS = [
  "BODY_WEIGHT", "FCR", "ADG", "BCS_SCORE", "MORTALITY_COUNT", "TEMPERATURE",
  "HEAD_COUNT", "LITTER_SIZE", "WEANING_WEIGHT", "PIGLETS_BORN", "SEMEN_MOTILITY",
  "EGG_COUNT", "MILK_LITRES", "CUSTOM",
];
const CAPTURE_PERS = ["AVERAGE", "TOTAL", "PER_HEAD"];

const KPI_UOM_MAP: Record<string, string> = {
  BODY_WEIGHT: "KG",
  ADG: "GRAM",
  FCR: "RATIO",
  MORTALITY_COUNT: "HEAD",
  HEAD_COUNT: "HEAD",
  BCS_SCORE: "SCORE",
  TEMPERATURE: "CELSIUS",
  LITTER_SIZE: "HEAD",
  WEANING_WEIGHT: "KG",
  PIGLETS_BORN: "HEAD",
  SEMEN_MOTILITY: "PCT",
  EGG_COUNT: "HEAD",
  MILK_LITRES: "LITRE",
};

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const emptyLine = () => ({
  line_type: "CONSUMPTION", activity_name: "", occurrence: "DAILY", start_day: 1, end_day: "",
  day_of_week: "", custom_days: "", is_mandatory: false, item_id: "", item_description: "",
  standard_qty: "", qty_basis: "PER_HEAD", output_basis: "PER_BATCH", kpi_metric: "BODY_WEIGHT", kpi_uom: "KG",
  std_value: "", capture_per: "AVERAGE", lower_alert_limit: "", upper_alert_limit: "",
  alert_severity: "WARNING", overhead_category: "", resource_id: "",
  allow_qty_edit: true, lot_required: false, creates_inventory: false, output_lot_auto: true,
});

interface SchedulerDetailPanelProps {
  schedulerId: string;
  onChanged?: () => void;
  /** Pre-fetched, LOB/NOB-scoped pickers — pass these from a host that already
   * loads them (e.g. batch-panel.tsx) to avoid a duplicate fetch. Falls back to
   * fetching its own, scoped by the loaded scheduler's nob_id/lob_id, when omitted
   * (e.g. the standalone Schedulers list page, which has no such batch context). */
  items?: Row[];
  resources?: Row[];
}

export default function SchedulerDetailPanel({ schedulerId, onChanged, items: itemsProp, resources: resourcesProp }: SchedulerDetailPanelProps) {
  const { t } = useLanguage();
  const [header, setHeader] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);

  const [items, setItems] = useState<Row[]>(itemsProp || []);
  const [resources, setResources] = useState<Row[]>(resourcesProp || []);
  const [activities, setActivities] = useState<Row[]>([]);

  const [addingLine, setAddingLine] = useState(false);
  const [lineForm, setLineForm] = useState<Row>(emptyLine());
  const [lineError, setLineError] = useState("");
  const [savingLine, setSavingLine] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);

  const load = () => {
    if (!schedulerId) return;
    setLoading(true);
    setError("");
    api.get(`/scheduler-header/${schedulerId}`)
      .then((r) => setHeader(unwrap<Row>(r)))
      .catch((err: any) => setError(err?.message || "Could not load the scheduler."))
      .finally(() => setLoading(false));
  };

  useEffect(load, [schedulerId]);

  useEffect(() => {
    if (itemsProp || resourcesProp || !header) return;
    const params = new URLSearchParams();
    if (header.company_id) params.set("companyId", header.company_id);
    if (header.nob_id) params.set("nobId", header.nob_id);
    if (header.lob_id) params.set("lobId", header.lob_id);
    params.set("limit", "500");
    const qs = params.toString();
    if (!itemsProp) api.get(`/item?${qs}`).then((r) => setItems(unwrap<Row[]>(r) || [])).catch(() => setItems([]));
    if (!resourcesProp) api.get(`/resource?${qs}`).then((r) => setResources(unwrap<Row[]>(r) || [])).catch(() => setResources([]));
    api.get(`/activity?isActive=true&limit=500`).then((r) => setActivities(unwrap<Row[]>(r) || [])).catch(() => setActivities([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header?.scheduler_id]);

  const itemLabel = (id: string) => items.find((i) => i.item_id === id)?.item_name || id;
  const resourceLabel = (id: string) => resources.find((r) => r.resource_id === id)?.resource_name || id;

  const runStatusChange = async (status: string) => {
    if (!header) return;
    setActing(true);
    setError("");
    try {
      await api.put(`/scheduler-header/${header.scheduler_id}/status`, { scheduler_status: status });
      load();
      onChanged?.();
    } catch (err: any) {
      setError(err?.message || "Could not update the scheduler status.");
    } finally {
      setActing(false);
    }
  };

  const openAddLine = () => {
    setEditingLineId(null);
    setLineForm(emptyLine());
    setLineError("");
    setAddingLine(true);
  };

  const openEditLine = (line: Row) => {
    setEditingLineId(line.line_id);
    setLineForm({
      ...emptyLine(),
      ...line,
      custom_days: (line.custom_days || []).map((d: Row) => d.day_number).join(", "),
      end_day: line.end_day ?? "",
      day_of_week: line.day_of_week ?? "",
      std_value: line.std_value ?? "",
      allow_qty_edit: line.allow_qty_edit !== false,
      output_lot_auto: line.output_lot_auto !== false,
    });
    setLineError("");
    setAddingLine(true);
  };

  const handleSelectActivity = (actName: string) => {
    const act = activities.find(
      (a) => a.activity_name === actName && a.line_type === lineForm.line_type,
    );
    setLineForm((f: Row) => {
      const updated: Row = { ...f, activity_name: actName };
      if (act) {
        if (act.default_occurrence) updated.occurrence = act.default_occurrence;
        if (act.default_qty_basis) updated.qty_basis = act.default_qty_basis;
        if (act.default_output_basis) updated.output_basis = act.default_output_basis;
        if (act.default_kpi_metric) updated.kpi_metric = act.default_kpi_metric;
        if (act.default_capture_per) updated.capture_per = act.default_capture_per;
        if (act.default_overhead_category) updated.overhead_category = act.default_overhead_category;
        if (act.default_gl_account) updated.gl_account = act.default_gl_account;
        if (act.default_is_mandatory !== undefined) updated.is_mandatory = !!act.default_is_mandatory;
        if (act.default_lot_required !== undefined) updated.lot_required = !!act.default_lot_required;
        if (act.default_item_id && !f.item_id) {
          updated.item_id = act.default_item_id;
          const matchedItem = items.find((it) => it.item_id === act.default_item_id);
          if (matchedItem) updated.item_description = matchedItem.item_name;
        }
        if (act.default_resource_id && !f.resource_id) {
          updated.resource_id = act.default_resource_id;
          const matchedRes = resources.find((r) => r.resource_id === act.default_resource_id);
          if (matchedRes) updated.resource_name = matchedRes.resource_name;
        }
      }
      return updated;
    });
  };

  const saveLine = async () => {
    if (!header) return;

    // Check for conflicting lines (same item/resource/metric with overlapping time period)
    const otherLines = (header.lines || []).filter((l: Row) => l.line_id !== editingLineId);
    const conflict = findConflictingSchedulerLine(lineForm, otherLines, { items, resources });
    if (conflict) {
      setLineError(conflict.message);
      return;
    }

    setSavingLine(true);
    setLineError("");
    try {
      const customDays = String(lineForm.custom_days || "")
        .split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n));
      const payload: Row = {
        line_type: lineForm.line_type,
        activity_name: lineForm.activity_name,
        occurrence: lineForm.occurrence,
        start_day: Number(lineForm.start_day) || 1,
        end_day: lineForm.end_day === "" ? null : Number(lineForm.end_day),
        day_of_week: lineForm.day_of_week === "" ? null : Number(lineForm.day_of_week),
        custom_days: lineForm.occurrence === "CUSTOM" ? customDays : undefined,
        is_mandatory: !!lineForm.is_mandatory,
      };
      if (["CONSUMPTION", "OUTPUT", "TRANSFER"].includes(lineForm.line_type)) {
        payload.item_id = lineForm.item_id || null;
        payload.item_description = lineForm.item_description || null;
        payload.standard_qty = lineForm.standard_qty === "" ? null : Number(lineForm.standard_qty);
        payload.allow_qty_edit = !!lineForm.allow_qty_edit;
      }
      if (lineForm.line_type === "CONSUMPTION") {
        payload.qty_basis = lineForm.qty_basis || null;
        payload.lot_required = !!lineForm.lot_required;
      }
      if (lineForm.line_type === "OUTPUT") {
        payload.output_basis = lineForm.output_basis || null;
        payload.creates_inventory = !!lineForm.creates_inventory;
        payload.output_lot_auto = !!lineForm.output_lot_auto;
      }
      if (lineForm.line_type === "DESCRIPTIVE") {
        payload.kpi_metric = lineForm.kpi_metric || null;
        payload.kpi_uom = lineForm.kpi_uom || null;
        payload.std_value = lineForm.std_value === "" ? null : Number(lineForm.std_value);
        payload.capture_per = lineForm.capture_per || null;
        payload.lower_alert_limit = lineForm.lower_alert_limit === "" ? null : Number(lineForm.lower_alert_limit);
        payload.upper_alert_limit = lineForm.upper_alert_limit === "" ? null : Number(lineForm.upper_alert_limit);
        payload.alert_severity = lineForm.alert_severity || "WARNING";
      }
      if (lineForm.line_type === "OVERHEAD") {
        payload.overhead_category = lineForm.overhead_category || null;
      }
      if (lineForm.line_type === "RESOURCE") {
        payload.resource_id = lineForm.resource_id || null;
      }

      if (editingLineId) {
        await api.put(`/scheduler-header/${header.scheduler_id}/lines/${editingLineId}`, payload);
      } else {
        await api.post(`/scheduler-header/${header.scheduler_id}/lines`, payload);
      }
      setAddingLine(false);
      load();
      onChanged?.();
    } catch (err: any) {
      setLineError(err?.message || "Could not save this line.");
    } finally {
      setSavingLine(false);
    }
  };

  const deactivateLine = async (line: Row) => {
    if (!header) return;
    if (!window.confirm(t("scConfirmDeactivateLine"))) return;
    try {
      await api.delete(`/scheduler-header/${header.scheduler_id}/lines/${line.line_id}`);
      load();
      onChanged?.();
    } catch (err: any) {
      setError(err?.message || "Could not deactivate this line.");
    }
  };

  if (loading && !header) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" style={S.muted} /></div>;
  }
  if (error && !header) return <InlineAlert>{error}</InlineAlert>;
  if (!header) return null;

  const lineType = lineForm.line_type;

  return (
    <div className="flex flex-col gap-4 text-xs">
      {error && <InlineAlert>{error}</InlineAlert>}

      <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-md)] border p-3.5 shadow-2xs sm:grid-cols-4" style={S.raised}>
        <div><p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("scLabelStatus")}</p><StatusBadge status={header.scheduler_status} className="mt-1" /></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("scLabelBatch")}</p><p className="font-semibold mt-0.5" style={S.primary}>{header.batch_no || "—"}</p></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("scLabelStage")}</p><p className="font-semibold mt-0.5" style={S.primary}>{header.stage_name || "—"}</p></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("scLabelBreed")}</p><p className="font-semibold mt-0.5" style={S.primary}>{header.breed_name || "—"}</p></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("scLabelEffectiveFrom")}</p><p className="font-semibold mt-0.5" style={S.primary}>{header.effective_from || "—"}</p></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("scLabelEffectiveTo")}</p><p className="font-semibold mt-0.5" style={S.primary}>{header.effective_to || "—"}</p></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("scLabelAnimalCount")}</p><p className="font-semibold mt-0.5" style={S.primary}>{header.animal_count ?? "—"}</p></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("scLabelDataEntryLevel")}</p><p className="font-semibold mt-0.5" style={S.primary}>{header.data_entry_level || "—"}</p></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("scLabelLocation")}</p><p className="font-semibold mt-0.5" style={S.primary}>{header.location_name || "—"}</p></div>
        <div><p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("scLabelAutoGenerated")}</p><p className="font-semibold mt-0.5" style={S.primary}>{header.auto_generated ? t("yes") : t("no")}</p></div>
        {header.actual_end_date && (
          <div><p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("scLabelActualEndDate")}</p><p className="font-semibold mt-0.5" style={S.primary}>{header.actual_end_date}</p></div>
        )}
      </div>

      {header.silo_stock && header.silo_stock.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("scSiloStockTitle")}</p>
          <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
            <table className="w-full border-collapse text-left text-xs">
              <TableHeader><tr className="border-b border-[var(--row-border)]">
                <TableHead className="h-auto px-3 py-2">{t("scColItem")}</TableHead>
                <TableHead className="h-auto px-3 py-2">{t("scColOnHandQty")}</TableHead>
              </tr></TableHeader>
              <TableBody>
                {header.silo_stock.map((s: Row) => (
                  <TableRow key={s.item_id}>
                    <TableCell className="px-3 py-2 font-medium" style={S.primary}>{s.item_description || s.item_code}</TableCell>
                    <TableCell className="px-3 py-2" style={S.primary}>{s.on_hand_qty} {s.uom}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {header.scheduler_status === "DRAFT" && (
          <Button size="sm" onClick={() => runStatusChange("ACTIVE")} disabled={acting} className="nf-btn-primary">{t("scActivate")}</Button>
        )}
        {header.scheduler_status === "ACTIVE" && (
          <>
            <Button size="sm" variant="outline" onClick={() => runStatusChange("SUSPENDED")} disabled={acting}>{t("scSuspend")}</Button>
            <Button size="sm" variant="outline" onClick={() => runStatusChange("COMPLETED")} disabled={acting}>{t("scComplete")}</Button>
          </>
        )}
        {header.scheduler_status === "SUSPENDED" && (
          <Button size="sm" onClick={() => runStatusChange("ACTIVE")} disabled={acting} className="nf-btn-primary">{t("scResume")}</Button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("scLinesTitle")}</p>
        <Button size="sm" variant="outline" onClick={openAddLine} className="gap-1.5"><Plus className="h-3.5 w-3.5" />{t("scAddLine")}</Button>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
        <table className="w-full border-collapse text-left text-xs">
          <TableHeader><tr className="border-b border-[var(--row-border)]">
            <TableHead className="h-auto px-3 py-2">{t("scColLineType")}</TableHead>
            <TableHead className="h-auto px-3 py-2">{t("scColActivity")}</TableHead>
            <TableHead className="h-auto px-3 py-2">{t("scColOccurrence")}</TableHead>
            <TableHead className="h-auto px-3 py-2">{t("scColItem")}</TableHead>
            <TableHead className="h-auto px-3 py-2">{t("scColQty")}</TableHead>
            <TableHead className="h-auto px-3 py-2">UOM</TableHead>
            <TableHead className="h-auto px-3 py-2">{t("scColSource")}</TableHead>
            <TableHead className="h-auto px-3 py-2"></TableHead>
          </tr></TableHeader>
          <TableBody>
            {(header.lines || []).length === 0 ? (
              <tr><TableCell colSpan={8} className="py-6 text-center" style={S.sub}>{t("scNoLines")}</TableCell></tr>
            ) : (header.lines || []).map((line: Row) => (
              <TableRow key={line.line_id} style={line.is_active === false ? { opacity: 0.5 } : undefined}>
                <TableCell className="px-3 py-2" style={S.sub}>{line.line_type}</TableCell>
                <TableCell className="px-3 py-2 font-medium" style={S.primary}>{line.activity_name}{line.is_mandatory && <span className="ml-1 text-[10px]" style={S.muted}>*</span>}</TableCell>
                <TableCell className="px-3 py-2" style={S.sub}>{line.occurrence}{line.occurrence === "WEEKLY" && line.day_of_week ? ` (${line.day_of_week})` : ""}</TableCell>
                <TableCell className="px-3 py-2" style={S.sub}>
                  {line.item_id ? (
                    <span>
                      {line.item_description || itemLabel(line.item_id)}
                      {line.withdrawal_days ? (
                        <span className="ml-1.5 rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-semibold text-amber-600">
                          {line.withdrawal_days}d w/d
                        </span>
                      ) : null}
                    </span>
                  ) : (line.resource_id ? (line.resource_name || resourceLabel(line.resource_id)) : (line.kpi_metric || "—"))}
                </TableCell>
                <TableCell className="px-3 py-2 font-semibold" style={S.primary}>
                  {line.standard_qty ?? line.std_value ?? "—"} {line.qty_basis ? `(${line.qty_basis})` : (line.output_basis ? `(${line.output_basis})` : "")}
                </TableCell>
                <TableCell className="px-3 py-2 font-mono" style={S.sub}>{line.uom || line.kpi_uom || "—"}</TableCell>
                <TableCell className="px-3 py-2" style={S.sub}>{line.source}</TableCell>
                <TableCell className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEditLine(line)} className="rounded p-1 hover:opacity-70" aria-label={t("scEditLine")}><Pencil className="h-3.5 w-3.5" style={S.sub} /></button>
                    {line.is_active !== false && (
                      <button onClick={() => deactivateLine(line)} className="rounded p-1 hover:opacity-70" aria-label={t("scDeactivateLine")}><Trash2 className="h-3.5 w-3.5" style={{ color: "var(--danger)" }} /></button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>

      {addingLine && (
        <div className="rounded-[var(--radius-md)] border p-3.5" style={S.raised}>
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{editingLineId ? t("scEditLineTitle") : t("scAddLineTitle")}</p>
          {lineError && <div className="mb-2"><InlineAlert>{lineError}</InlineAlert></div>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <select value={lineForm.line_type} onChange={(e) => setLineForm((f: Row) => ({ ...f, line_type: e.target.value }))} className={`${inputCls} nf-select`} style={S.input} disabled={!!editingLineId && lineForm.source === "AUTO"}>
              {LINE_TYPES.map((lt) => <option key={lt} value={lt}>{lt}</option>)}
            </select>
            <select value={lineForm.activity_name} onChange={(e) => handleSelectActivity(e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
              <option value="">— Activity catalog —</option>
              {activities.filter((a) => a.line_type === lineForm.line_type).map((a) => (
                <option key={a.activity_id} value={a.activity_name}>{a.activity_name} ({a.activity_code})</option>
              ))}
              {lineForm.activity_name && !activities.some((a) => a.activity_name === lineForm.activity_name && a.line_type === lineForm.line_type) && (
                <option key="__EXISTING__" value={lineForm.activity_name}>{lineForm.activity_name}</option>
              )}
            </select>
            <select value={lineForm.occurrence} onChange={(e) => setLineForm((f: Row) => ({ ...f, occurrence: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
              {OCCURRENCES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input type="number" min={1} placeholder={t("scPlaceholderStartDay")} value={lineForm.start_day} onChange={(e) => setLineForm((f: Row) => ({ ...f, start_day: e.target.value }))} className={inputCls} style={S.input} />
            <input type="number" min={1} placeholder={t("scPlaceholderEndDay")} value={lineForm.end_day} onChange={(e) => setLineForm((f: Row) => ({ ...f, end_day: e.target.value }))} className={inputCls} style={S.input} />
            {lineForm.occurrence === "WEEKLY" && (
              <input type="number" min={1} max={7} placeholder={t("scPlaceholderDayOfWeek")} value={lineForm.day_of_week} onChange={(e) => setLineForm((f: Row) => ({ ...f, day_of_week: e.target.value }))} className={inputCls} style={S.input} />
            )}
            {lineForm.occurrence === "CUSTOM" && (
              <input placeholder={t("scPlaceholderCustomDays")} value={lineForm.custom_days} onChange={(e) => setLineForm((f: Row) => ({ ...f, custom_days: e.target.value }))} className={inputCls} style={S.input} />
            )}
            <label className="flex items-center gap-1.5 text-xs" style={S.sub}>
              <input type="checkbox" checked={!!lineForm.is_mandatory} onChange={(e) => setLineForm((f: Row) => ({ ...f, is_mandatory: e.target.checked }))} />
              {t("scIsMandatory")}
            </label>

            {["CONSUMPTION", "OUTPUT", "TRANSFER"].includes(lineType) && (
              <>
                <select
                  value={lineForm.item_id}
                  onChange={(e) => {
                    const sel = items.find((i) => i.item_id === e.target.value);
                    setLineForm((f: Row) => ({
                      ...f,
                      item_id: e.target.value,
                      item_description: sel?.item_name || f.item_description,
                    }));
                  }}
                  className={`${inputCls} nf-select`}
                  style={S.input}
                >
                  <option value="">{t("scPlaceholderSelectItem")}</option>
                  {items.map((i) => <option key={i.item_id} value={i.item_id}>{i.item_name} {i.uom_primary ? `(${i.uom_primary})` : ""}</option>)}
                </select>
                <input placeholder={t("scPlaceholderItemDescription")} value={lineForm.item_description} onChange={(e) => setLineForm((f: Row) => ({ ...f, item_description: e.target.value }))} className={inputCls} style={S.input} />
                <input type="number" step="any" placeholder={t("scPlaceholderStandardQty")} value={lineForm.standard_qty} onChange={(e) => setLineForm((f: Row) => ({ ...f, standard_qty: e.target.value }))} className={inputCls} style={S.input} />
                <label className="flex items-center gap-1.5 text-xs" style={S.sub}>
                  <input type="checkbox" checked={!!lineForm.allow_qty_edit} onChange={(e) => setLineForm((f: Row) => ({ ...f, allow_qty_edit: e.target.checked }))} />
                  Allow Qty Edit at Entry
                </label>
              </>
            )}
            {lineType === "CONSUMPTION" && (
              <>
                <select value={lineForm.qty_basis} onChange={(e) => setLineForm((f: Row) => ({ ...f, qty_basis: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                  <option value="">{t("scPlaceholderQtyBasis")}</option>
                  {QTY_BASES.map((q) => <option key={q} value={q}>{q}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-xs" style={S.sub}>
                  <input type="checkbox" checked={!!lineForm.lot_required} onChange={(e) => setLineForm((f: Row) => ({ ...f, lot_required: e.target.checked }))} />
                  {t("scLotRequired")}
                </label>
                {(() => {
                  const it = items.find((i) => i.item_id === lineForm.item_id);
                  return it?.withdrawal_days ? (
                    <div className="col-span-2 text-[11px] font-medium text-amber-600 flex items-center gap-1">
                      <span>⚠️ Medicine/Vaccine Withdrawal Period:</span>
                      <span className="font-bold">{it.withdrawal_days} days</span>
                    </div>
                  ) : null;
                })()}
              </>
            )}
            {lineType === "OUTPUT" && (
              <>
                <select value={lineForm.output_basis} onChange={(e) => setLineForm((f: Row) => ({ ...f, output_basis: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                  <option value="">{t("scPlaceholderOutputBasis")}</option>
                  {OUTPUT_BASES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-xs" style={S.sub}>
                  <input type="checkbox" checked={!!lineForm.creates_inventory} onChange={(e) => setLineForm((f: Row) => ({ ...f, creates_inventory: e.target.checked }))} />
                  {t("scCreatesInventory")}
                </label>
                <label className="flex items-center gap-1.5 text-xs" style={S.sub}>
                  <input type="checkbox" checked={!!lineForm.output_lot_auto} onChange={(e) => setLineForm((f: Row) => ({ ...f, output_lot_auto: e.target.checked }))} />
                  Auto Create Lot
                </label>
              </>
            )}
            {lineType === "DESCRIPTIVE" && (
              <>
                <select
                  value={lineForm.kpi_metric}
                  onChange={(e) => {
                    const metric = e.target.value;
                    setLineForm((f: Row) => ({
                      ...f,
                      kpi_metric: metric,
                      kpi_uom: KPI_UOM_MAP[metric] || (metric === "CUSTOM" ? f.kpi_uom : ""),
                    }));
                  }}
                  className={`${inputCls} nf-select`}
                  style={S.input}
                >
                  <option value="">— Select KPI Metric —</option>
                  {KPI_METRICS.map((m) => (
                    <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
                  ))}
                </select>
                <input
                  placeholder={t("scPlaceholderKpiUom")}
                  value={lineForm.kpi_uom}
                  disabled={lineForm.kpi_metric !== "CUSTOM"}
                  onChange={(e) => setLineForm((f: Row) => ({ ...f, kpi_uom: e.target.value }))}
                  className={inputCls}
                  style={S.input}
                />
                <input
                  type="number"
                  step="any"
                  placeholder="Standard Target Value"
                  value={lineForm.std_value}
                  onChange={(e) => setLineForm((f: Row) => ({ ...f, std_value: e.target.value }))}
                  className={inputCls}
                  style={S.input}
                />
                <select
                  value={lineForm.capture_per || "AVERAGE"}
                  onChange={(e) => setLineForm((f: Row) => ({ ...f, capture_per: e.target.value }))}
                  className={`${inputCls} nf-select`}
                  style={S.input}
                >
                  {CAPTURE_PERS.map((cp) => (
                    <option key={cp} value={cp}>{cp.replace(/_/g, " ")}</option>
                  ))}
                </select>
                <input type="number" step="any" placeholder={t("scPlaceholderLowerLimit")} value={lineForm.lower_alert_limit} onChange={(e) => setLineForm((f: Row) => ({ ...f, lower_alert_limit: e.target.value }))} className={inputCls} style={S.input} />
                <input type="number" step="any" placeholder={t("scPlaceholderUpperLimit")} value={lineForm.upper_alert_limit} onChange={(e) => setLineForm((f: Row) => ({ ...f, upper_alert_limit: e.target.value }))} className={inputCls} style={S.input} />
                <select value={lineForm.alert_severity} onChange={(e) => setLineForm((f: Row) => ({ ...f, alert_severity: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                  {ALERT_SEVERITIES.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </>
            )}
            {lineType === "OVERHEAD" && (
              <input placeholder={t("scPlaceholderOverheadCategory")} value={lineForm.overhead_category} onChange={(e) => setLineForm((f: Row) => ({ ...f, overhead_category: e.target.value }))} className={inputCls} style={S.input} />
            )}
            {lineType === "RESOURCE" && (
              <select value={lineForm.resource_id} onChange={(e) => setLineForm((f: Row) => ({ ...f, resource_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("scPlaceholderSelectResource")}</option>
                {resources.map((r) => <option key={r.resource_id} value={r.resource_id}>{r.resource_name}</option>)}
              </select>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={saveLine} disabled={savingLine || !lineForm.activity_name} className="nf-btn-primary">{savingLine ? t("scSaving") : t("scSaveLine")}</Button>
            <Button size="sm" variant="outline" onClick={() => setAddingLine(false)} disabled={savingLine}>{t("cancel")}</Button>
          </div>
        </div>
      )}

      {header.notes && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("scLabelNotes")}</p>
          <p style={S.sub}>{header.notes}</p>
        </div>
      )}
    </div>
  );
}
