"use client";

import { useEffect, useState } from "react";
import {
  CalendarClock,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
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

const LINE_TYPES = ["CONSUMPTION", "OUTPUT", "DESCRIPTIVE", "OVERHEAD", "RESOURCE", "TRANSFER"] as const;
const OCCURRENCES = ["DAILY", "WEEKLY", "MONTHLY", "ONCE", "CUSTOM"] as const;
const QTY_BASES = ["PER_HEAD", "TOTAL_BATCH", "PER_PEN", "FIXED"] as const;
const OUTPUT_BASES = ["PER_SOW", "PER_BATCH", "PER_PEN"] as const;
const DATA_ENTRY_LEVELS = ["SHED", "PEN", "FARM"] as const;
const ALERT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
const OVERHEAD_CATEGORIES = ["ELECTRICITY", "WATER", "FUEL", "REPAIR", "CLEANING", "CUSTOM"] as const;

const KPI_METRICS = [
  "BODY_WEIGHT",
  "FCR",
  "ADG",
  "BCS_SCORE",
  "MORTALITY_COUNT",
  "TEMPERATURE",
  "HEAD_COUNT",
  "LITTER_SIZE",
  "WEANING_WEIGHT",
  "PIGLETS_BORN",
  "SEMEN_MOTILITY",
  "EGG_COUNT",
  "MILK_LITRES",
  "CUSTOM",
] as const;

const CAPTURE_PERS = ["AVERAGE", "TOTAL", "PER_HEAD"] as const;

const KPI_UOM_MAP: Record<string, string> = {
  BODY_WEIGHT: "KG",
  FCR: "RATIO",
  ADG: "G_DAY",
  BCS_SCORE: "SCORE",
  MORTALITY_COUNT: "HEAD",
  TEMPERATURE: "CELSIUS",
  HEAD_COUNT: "HEAD",
  LITTER_SIZE: "HEAD",
  WEANING_WEIGHT: "KG",
  PIGLETS_BORN: "HEAD",
  SEMEN_MOTILITY: "PCT",
  EGG_COUNT: "NOS",
  MILK_LITRES: "LITRES",
  CUSTOM: "",
};

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const emptyLineForm = (seq = 1) => ({
  line_seq: seq,
  line_type: "CONSUMPTION",
  activity_name: "",
  occurrence: "DAILY",
  start_day: 1,
  end_day: "",
  day_of_week: "",
  custom_days: "",
  is_mandatory: false,
  // Consumption & Output
  item_id: "",
  item_description: "",
  standard_qty: "",
  qty_basis: "PER_HEAD",
  allow_qty_edit: true,
  lot_required: false,
  creates_inventory: true,
  output_lot_auto: true,
  output_basis: "PER_BATCH",
  // Descriptive
  kpi_metric: "",
  kpi_uom: "",
  std_value: "",
  lower_alert_limit: "",
  upper_alert_limit: "",
  alert_severity: "WARNING",
  capture_per: "AVERAGE",
  // Overhead & Resource
  overhead_category: "",
  gl_account: "",
  estimated_cost: "",
  resource_id: "",
  resource_name: "",
});

interface CreateSchedulerModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (schedulerId: string) => void;
  companyId?: string;
}

export default function CreateSchedulerModal({ open, onClose, onCreated, companyId }: CreateSchedulerModalProps) {
  const { t } = useLanguage();
  const [batches, setBatches] = useState<Row[]>([]);
  const [stages, setStages] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [resources, setResources] = useState<Row[]>([]);
  const [activities, setActivities] = useState<Row[]>([]);

  const [loadingBatches, setLoadingBatches] = useState(false);
  const [loadingStages, setLoadingStages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Header state
  const [batchId, setBatchId] = useState("");
  const [stageId, setStageId] = useState("");
  const [dataEntryLevel, setDataEntryLevel] = useState<string>("SHED");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");
  const [animalCount, setAnimalCount] = useState<string>("");
  const [status, setStatus] = useState("DRAFT");
  const [notes, setNotes] = useState("");

  // Staged Activities (Lines)
  const [lines, setLines] = useState<Row[]>([]);
  const [showLineModal, setShowLineModal] = useState(false);
  const [editingLineIndex, setEditingLineIndex] = useState<number | null>(null);
  const [lineForm, setLineForm] = useState<Row>(emptyLineForm());
  const [lineFormError, setLineFormError] = useState("");

  const selectedBatch = batches.find((b) => b.batch_id === batchId) || null;
  const selectedStage = stages.find((s) => s.stage_id === stageId) || null;

  // Load initial lookups
  useEffect(() => {
    if (!open) return;
    setError("");
    setBatchId("");
    setStageId("");
    setNotes("");
    setStatus("DRAFT");
    setDataEntryLevel("SHED");
    setLines([]);
    setShowLineModal(false);

    setLoadingBatches(true);
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "100");
    api.get(`/batch?${params.toString()}`)
      .then((res) => setBatches(unwrap<Row[]>(res) || []))
      .catch((err) => setError(err?.message || "Failed to load batches."))
      .finally(() => setLoadingBatches(false));

    // Items and resources for lines
    const itemParams = new URLSearchParams();
    if (companyId) itemParams.set("companyId", companyId);
    itemParams.set("limit", "500");
    api.get(`/item?${itemParams.toString()}`)
      .then((res) => setItems(unwrap<Row[]>(res) || []))
      .catch(() => setItems([]));

    api.get(`/resource?${itemParams.toString()}`)
      .then((res) => setResources(unwrap<Row[]>(res) || []))
      .catch(() => setResources([]));

    const actParams = new URLSearchParams();
    if (companyId) actParams.set("companyId", companyId);
    actParams.set("isActive", "true");
    actParams.set("limit", "500");
    api.get(`/activity?${actParams.toString()}`)
      .then((res) => setActivities(unwrap<Row[]>(res) || []))
      .catch(() => setActivities([]));
  }, [open, companyId]);

  // When batch changes, load stages filtered by batch's LOB
  useEffect(() => {
    if (!selectedBatch) {
      setStages([]);
      setStageId("");
      setEffectiveFrom("");
      setEffectiveTo("");
      setAnimalCount("");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    setEffectiveFrom(selectedBatch.start_date || today);
    setAnimalCount(String(selectedBatch.closing_quantity ?? selectedBatch.opening_quantity ?? ""));

    if (selectedBatch.lob_id) {
      setLoadingStages(true);
      api.get(`/stage?lobId=${selectedBatch.lob_id}&isActive=true`)
        .then((res) => {
          const stgList = unwrap<Row[]>(res) || [];
          setStages(stgList);
          if (selectedBatch.stage_id) {
            setStageId(selectedBatch.stage_id);
          } else if (stgList.length > 0) {
            setStageId(stgList[0].stage_id);
          }
        })
        .catch(() => setStages([]))
        .finally(() => setLoadingStages(false));
    }
  }, [batchId]);

  // When stage changes, auto-calculate expected end date
  useEffect(() => {
    if (!selectedStage || !effectiveFrom) return;
    if (selectedStage.typical_duration_days) {
      const d = new Date(effectiveFrom);
      d.setDate(d.getDate() + Number(selectedStage.typical_duration_days));
      setEffectiveTo(d.toISOString().slice(0, 10));
    }
  }, [stageId, effectiveFrom]);

  // Open line editor for adding a new activity
  const handleOpenAddLine = () => {
    setEditingLineIndex(null);
    setLineForm(emptyLineForm(lines.length + 1));
    setLineFormError("");
    setShowLineModal(true);
  };

  // Open line editor for editing an existing activity
  const handleOpenEditLine = (index: number) => {
    setEditingLineIndex(index);
    const lineToEdit = { ...lines[index] };
    setLineForm(lineToEdit);
    setLineFormError("");
    setShowLineModal(true);
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
          if (matchedItem) {
            updated.item_label = matchedItem.item_name;
            updated.uom = matchedItem.uom_primary || updated.uom;
          }
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

  // Delete line from local staged list
  const handleDeleteLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index).map((l, i) => ({ ...l, line_seq: i + 1 })));
  };

  // Commit line from modal into local staged list
  const handleSaveLineForm = () => {
    if (!lineForm.activity_name.trim()) {
      setLineFormError("Activity Name is required.");
      return;
    }
    if (lineForm.line_type === "CONSUMPTION" && !lineForm.item_id) {
      setLineFormError("Item is required for Consumption activity.");
      return;
    }
    if (lineForm.line_type === "OUTPUT" && !lineForm.item_id) {
      setLineFormError("Output Item is required.");
      return;
    }
    if (lineForm.line_type === "DESCRIPTIVE" && !lineForm.kpi_metric) {
      setLineFormError("KPI Metric is required for Descriptive activity.");
      return;
    }
    if (lineForm.line_type === "RESOURCE" && !lineForm.resource_id) {
      setLineFormError("Resource is required.");
      return;
    }
    if (lineForm.end_day !== "" && lineForm.end_day != null && Number(lineForm.start_day) > Number(lineForm.end_day)) {
      setLineFormError("Start Day cannot be greater than End Day.");
      return;
    }
    if (lineForm.occurrence === "WEEKLY" && !lineForm.day_of_week) {
      setLineFormError("Day of Week (1-7) is required for Weekly occurrence.");
      return;
    }
    if (lineForm.occurrence === "CUSTOM" && !lineForm.custom_days) {
      setLineFormError("At least one Custom Day number is required for Custom occurrence.");
      return;
    }

    const cleanedLine: Row = {
      ...lineForm,
      start_day: Number(lineForm.start_day) || 1,
      end_day: lineForm.end_day ? Number(lineForm.end_day) : null,
      day_of_week: lineForm.occurrence === "WEEKLY" && lineForm.day_of_week ? Number(lineForm.day_of_week) : null,
      custom_days: lineForm.occurrence === "CUSTOM" && lineForm.custom_days
        ? String(lineForm.custom_days).split(",").map((s: string) => Number(s.trim())).filter((n: number) => !Number.isNaN(n))
        : null,
      standard_qty: lineForm.standard_qty !== "" ? Number(lineForm.standard_qty) : null,
      std_value: lineForm.std_value !== "" ? Number(lineForm.std_value) : null,
      lower_alert_limit: lineForm.lower_alert_limit !== "" ? Number(lineForm.lower_alert_limit) : null,
      upper_alert_limit: lineForm.upper_alert_limit !== "" ? Number(lineForm.upper_alert_limit) : null,
      estimated_cost: lineForm.estimated_cost !== "" ? Number(lineForm.estimated_cost) : null,
    };

    // Prevent duplicate items, resources, or activities with overlapping time periods
    const otherLines = editingLineIndex !== null
      ? lines.filter((_, i) => i !== editingLineIndex)
      : lines;
    const conflict = findConflictingSchedulerLine(cleanedLine, otherLines, { items, resources });
    if (conflict) {
      setLineFormError(conflict.message);
      return;
    }

    if (editingLineIndex !== null) {
      setLines((prev) => {
        const next = [...prev];
        next[editingLineIndex] = cleanedLine;
        return next;
      });
    } else {
      setLines((prev) => [...prev, cleanedLine]);
    }
    setShowLineModal(false);
  };

  // Submit complete unified scheduler (Header + Lines)
  const handleSaveAll = async () => {
    if (!batchId) {
      setError("Please select a batch.");
      return;
    }
    if (!stageId) {
      setError("Please select a stage.");
      return;
    }

    // Validate lines pairwise for any overlapping duplicate items/periods
    for (let i = 0; i < lines.length; i++) {
      const conflict = findConflictingSchedulerLine(lines[i], lines.slice(0, i), { items, resources });
      if (conflict) {
        setError(conflict.message);
        return;
      }
    }

    setSaving(true);
    setError("");

    try {
      const payload: Record<string, any> = {
        batch_id: batchId,
        stage_id: stageId,
        data_entry_level: dataEntryLevel,
        effective_from: effectiveFrom || undefined,
        effective_to: effectiveTo || undefined,
        animal_count: animalCount !== "" ? Number(animalCount) : undefined,
        scheduler_status: status,
        notes: notes || undefined,
        lines: lines.length > 0 ? lines : undefined,
      };

      const res = await api.post("/scheduler-header", payload);
      const created = unwrap<Row>(res);
      onCreated(created?.scheduler_id || created?.data?.scheduler_id);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to create scheduler.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={() => !saving && onClose()} title="Create New Scheduler & Activities" maxWidth="xl">
        <div className="flex flex-col gap-5 text-xs max-h-[78vh] overflow-y-auto pr-1">
          {error && <InlineAlert>{error}</InlineAlert>}

          {/* Section 1: Header Configuration */}
          <div className="rounded-[var(--radius-sm)] border p-4" style={S.surface}>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={S.primary}>
              <CalendarClock className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
              1. Scheduler Header
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* Batch Selector */}
              <div>
                <label className="mb-1 block font-semibold" style={S.sub}>
                  {t("schColBatch")} <span className="text-red-500">*</span>
                </label>
                {loadingBatches ? (
                  <div className="flex items-center gap-2 py-1.5"><Loader2 className="h-4 w-4 animate-spin" style={S.muted} /><span style={S.muted}>Loading batches...</span></div>
                ) : (
                  <select
                    value={batchId}
                    onChange={(e) => setBatchId(e.target.value)}
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    <option value="">— Select a batch —</option>
                    {batches.map((b) => (
                      <option key={b.batch_id} value={b.batch_id}>
                        {b.batch_no} {b.stage_name ? `(${b.stage_name})` : ""} {b.breed_name ? `• ${b.breed_name}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Stage Selector (LOB-Filtered) */}
              <div>
                <label className="mb-1 block font-semibold" style={S.sub}>
                  {t("schColStage")} <span className="text-red-500">*</span>
                </label>
                {loadingStages ? (
                  <div className="flex items-center gap-2 py-1.5"><Loader2 className="h-4 w-4 animate-spin" style={S.muted} /><span style={S.muted}>Loading stages...</span></div>
                ) : (
                  <select
                    value={stageId}
                    onChange={(e) => setStageId(e.target.value)}
                    disabled={!batchId}
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    <option value="">— Select stage —</option>
                    {stages.map((s) => (
                      <option key={s.stage_id} value={s.stage_id}>
                        {s.stage_name} {s.typical_duration_days ? `(${s.typical_duration_days} days)` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Data Entry Level */}
              <div>
                <label className="mb-1 block font-semibold" style={S.sub}>
                  Data Entry Level
                </label>
                <select
                  value={dataEntryLevel}
                  onChange={(e) => setDataEntryLevel(e.target.value)}
                  className={`${inputCls} nf-select w-full`}
                  style={S.input}
                >
                  {DATA_ENTRY_LEVELS.map((lvl) => (
                    <option key={lvl} value={lvl}>{lvl}</option>
                  ))}
                </select>
              </div>

              {/* Effective From */}
              <div>
                <label className="mb-1 block font-semibold" style={S.sub}>
                  Effective From (Start Date) <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className={`${inputCls} w-full`}
                  style={S.input}
                />
              </div>

              {/* Effective To */}
              <div>
                <label className="mb-1 block font-semibold" style={S.sub}>
                  Effective To (Expected End Date)
                </label>
                <input
                  type="date"
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                  className={`${inputCls} w-full`}
                  style={S.input}
                />
              </div>

              {/* Animal Count */}
              <div>
                <label className="mb-1 block font-semibold" style={S.sub}>
                  Animal Count <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={animalCount}
                  onChange={(e) => setAnimalCount(e.target.value)}
                  placeholder="e.g. 20"
                  className={`${inputCls} w-full`}
                  style={S.input}
                />
              </div>

              {/* Initial Status */}
              <div>
                <label className="mb-1 block font-semibold" style={S.sub}>
                  Initial Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className={`${inputCls} nf-select w-full`}
                  style={S.input}
                >
                  <option value="DRAFT">DRAFT (Review & Finalize)</option>
                  <option value="ACTIVE">ACTIVE (Ready for Daily Entry)</option>
                </select>
              </div>

              {/* Notes */}
              <div className="sm:col-span-2">
                <label className="mb-1 block font-semibold" style={S.sub}>
                  Notes / Description
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional free-text remarks regarding this stage schedule..."
                  className={`${inputCls} w-full`}
                  style={S.input}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Staged Activities (Lines) in Same Place */}
          <div className="rounded-[var(--radius-sm)] border p-4" style={S.surface}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider" style={S.primary}>
                  2. Scheduled Activities (Lines) ({lines.length})
                </p>
                <p className="text-[10px] mt-0.5" style={S.sub}>
                  Define daily feed rations, vaccines, body weight targets, labour, and outputs.
                </p>
              </div>
              <Button size="sm" onClick={handleOpenAddLine} className="flex items-center gap-1.5 text-xs font-medium">
                <Plus className="h-3.5 w-3.5" />
                Add Activity
              </Button>
            </div>

            {lines.length === 0 ? (
              <div className="rounded-[var(--radius-sm)] border border-dashed py-6 text-center" style={{ borderColor: "var(--border)" }}>
                <p className="text-xs font-medium" style={S.sub}>No custom activities added yet.</p>
                <p className="text-[11px] mt-1" style={S.muted}>
                  Click <strong>Add Activity</strong> above to schedule a feed ration, vaccination, or KPI target.
                  (If left empty, standard lifecycle activities will be auto-generated).
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader>
                    <tr className="border-b border-[var(--row-border)]">
                      <TableHead className="h-auto px-3 py-2">Seq</TableHead>
                      <TableHead className="h-auto px-3 py-2">Type</TableHead>
                      <TableHead className="h-auto px-3 py-2">Activity Name</TableHead>
                      <TableHead className="h-auto px-3 py-2">Occurrence</TableHead>
                      <TableHead className="h-auto px-3 py-2">Item / Metric / Resource</TableHead>
                      <TableHead className="h-auto px-3 py-2">Std Qty / Target</TableHead>
                      <TableHead className="h-auto px-3 py-2">Mandatory</TableHead>
                      <TableHead className="h-auto px-3 py-2"></TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line, idx) => {
                      const itemObj = items.find((i) => i.item_id === line.item_id);
                      const resObj = resources.find((r) => r.resource_id === line.resource_id);
                      const targetDisplay = line.line_type === "DESCRIPTIVE"
                        ? (line.std_value != null ? `${line.std_value} ${line.kpi_uom || ""}` : "—")
                        : line.standard_qty != null
                        ? `${line.standard_qty} ${itemObj?.uom_primary || resObj?.uom || ""} ${line.qty_basis ? `(${line.qty_basis})` : ""}`
                        : "—";

                      return (
                        <TableRow key={idx}>
                          <TableCell className="px-3 py-2 font-mono text-[11px]" style={S.sub}>{line.line_seq || idx + 1}</TableCell>
                          <TableCell className="px-3 py-2">
                            <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "var(--surface-raised)", color: "var(--accent)" }}>
                              {line.line_type}
                            </span>
                          </TableCell>
                          <TableCell className="px-3 py-2 font-medium" style={S.primary}>{line.activity_name}</TableCell>
                          <TableCell className="px-3 py-2" style={S.sub}>
                            {line.occurrence} {line.day_of_week ? `(Day ${line.day_of_week})` : ""} {line.custom_days ? `[${line.custom_days}]` : ""}
                          </TableCell>
                          <TableCell className="px-3 py-2" style={S.sub}>
                            {line.line_type === "DESCRIPTIVE"
                              ? (line.kpi_metric ? line.kpi_metric.replace(/_/g, " ") : "—")
                              : line.line_type === "RESOURCE"
                              ? (resObj?.resource_name || line.resource_id || "—")
                              : (itemObj?.item_name || line.item_description || "—")}
                            {itemObj?.withdrawal_days ? (
                              <span className="ml-1 text-[10px] font-bold text-amber-600">({itemObj.withdrawal_days}d w/d)</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="px-3 py-2 font-medium" style={S.primary}>{targetDisplay}</TableCell>
                          <TableCell className="px-3 py-2" style={S.sub}>{line.is_mandatory ? "Yes" : "No"}</TableCell>
                          <TableCell className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => handleOpenEditLine(idx)} className="rounded p-1 hover:opacity-70" title="Edit">
                                <Pencil className="h-3.5 w-3.5" style={S.sub} />
                              </button>
                              <button onClick={() => handleDeleteLine(idx)} className="rounded p-1 hover:opacity-70" title="Delete">
                                <Trash2 className="h-3.5 w-3.5" style={{ color: "var(--danger)" }} />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
              </div>
            )}
          </div>

          {/* Dialog Action Buttons */}
          <div className="mt-2 flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <span className="text-[11px]" style={S.muted}>
              {lines.length} {lines.length === 1 ? "activity" : "activities"} configured
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
                {t("cancel")}
              </Button>
              <Button size="sm" onClick={handleSaveAll} disabled={saving || !batchId || !stageId} className="nf-btn-primary">
                {saving ? (
                  <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...</span>
                ) : (
                  `Create Scheduler & Activities (${lines.length})`
                )}
              </Button>
            </div>
          </div>
        </div>
      </Dialog>

      {/* Sub-Dialog: Add / Edit Activity */}
      <Dialog
        open={showLineModal}
        onClose={() => setShowLineModal(false)}
        title={editingLineIndex !== null ? "Edit Activity (Line)" : "Add Activity (Line)"}
        maxWidth="lg"
      >
        <div className="flex flex-col gap-4 text-xs">
          {lineFormError && <InlineAlert>{lineFormError}</InlineAlert>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Line Type */}
            <div>
              <label className="mb-1 block font-semibold" style={S.sub}>
                Line Type <span className="text-red-500">*</span>
              </label>
              <select
                value={lineForm.line_type}
                onChange={(e) => setLineForm((f: Row) => ({ ...f, line_type: e.target.value }))}
                className={`${inputCls} nf-select w-full`}
                style={S.input}
              >
                {LINE_TYPES.map((lt) => (
                  <option key={lt} value={lt}>{lt}</option>
                ))}
              </select>
            </div>

            {/* Activity Name */}
            <div>
              <label className="mb-1 block font-semibold" style={S.sub}>
                Activity Name <span className="text-red-500">*</span>
              </label>
              <select
                value={lineForm.activity_name}
                onChange={(e) => handleSelectActivity(e.target.value)}
                className={`${inputCls} nf-select w-full`}
                style={S.input}
              >
                <option value="">— Select activity from catalog —</option>
                {activities
                  .filter((a) => a.line_type === lineForm.line_type)
                  .map((a) => (
                    <option key={a.activity_id} value={a.activity_name}>
                      {a.activity_name} ({a.activity_code})
                    </option>
                  ))}
                {lineForm.activity_name &&
                  !activities.some(
                    (a) =>
                      a.activity_name === lineForm.activity_name &&
                      a.line_type === lineForm.line_type,
                  ) && (
                    <option key="__EXISTING__" value={lineForm.activity_name}>
                      {lineForm.activity_name}
                    </option>
                  )}
              </select>
            </div>

            {/* Occurrence */}
            <div>
              <label className="mb-1 block font-semibold" style={S.sub}>
                Occurrence <span className="text-red-500">*</span>
              </label>
              <select
                value={lineForm.occurrence}
                onChange={(e) => setLineForm((f: Row) => ({ ...f, occurrence: e.target.value }))}
                className={`${inputCls} nf-select w-full`}
                style={S.input}
              >
                {OCCURRENCES.map((oc) => (
                  <option key={oc} value={oc}>{oc}</option>
                ))}
              </select>
            </div>

            {/* Start Day & End Day */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-semibold" style={S.sub}>Start Day</label>
                <input
                  type="number"
                  min={1}
                  value={lineForm.start_day}
                  onChange={(e) => setLineForm((f: Row) => ({ ...f, start_day: e.target.value }))}
                  className={`${inputCls} w-full`}
                  style={S.input}
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold" style={S.sub}>End Day</label>
                <input
                  type="number"
                  min={1}
                  placeholder="Stage close"
                  value={lineForm.end_day}
                  onChange={(e) => setLineForm((f: Row) => ({ ...f, end_day: e.target.value }))}
                  className={`${inputCls} w-full`}
                  style={S.input}
                />
              </div>
            </div>

            {/* Conditional: Day of week for WEEKLY */}
            {lineForm.occurrence === "WEEKLY" && (
              <div>
                <label className="mb-1 block font-semibold" style={S.sub}>Day of Week (1=Mon..7=Sun)</label>
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={lineForm.day_of_week}
                  onChange={(e) => setLineForm((f: Row) => ({ ...f, day_of_week: e.target.value }))}
                  className={`${inputCls} w-full`}
                  style={S.input}
                />
              </div>
            )}

            {/* Conditional: Custom Days for CUSTOM */}
            {lineForm.occurrence === "CUSTOM" && (
              <div>
                <label className="mb-1 block font-semibold" style={S.sub}>Custom Days (comma-separated)</label>
                <input
                  value={lineForm.custom_days}
                  onChange={(e) => setLineForm((f: Row) => ({ ...f, custom_days: e.target.value }))}
                  placeholder="e.g. 7, 21, 35"
                  className={`${inputCls} w-full`}
                  style={S.input}
                />
              </div>
            )}

            {/* Mandatory Checkbox */}
            <div className="flex items-center gap-2 pt-4">
              <input
                type="checkbox"
                id="is_mandatory_cb"
                checked={!!lineForm.is_mandatory}
                onChange={(e) => setLineForm((f: Row) => ({ ...f, is_mandatory: e.target.checked }))}
              />
              <label htmlFor="is_mandatory_cb" className="font-semibold cursor-pointer" style={S.sub}>
                Mandatory data entry (required to complete daily post)
              </label>
            </div>
          </div>

          {/* Conditional Line Type Section */}
          <div className="rounded-[var(--radius-sm)] border p-3 bg-(--surface-raised)" style={{ borderColor: "var(--border)" }}>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider" style={S.primary}>
              {lineForm.line_type} Specific Configuration
            </p>

            {/* CONSUMPTION */}
            {lineForm.line_type === "CONSUMPTION" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Feed / Medicine Item <span className="text-red-500">*</span></label>
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
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    <option value="">— Select item —</option>
                    {items.map((it) => (
                      <option key={it.item_id} value={it.item_id}>
                        {it.item_name} {it.uom_primary ? `(${it.uom_primary})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Standard Qty per Occurrence</label>
                  <input
                    type="number"
                    step="any"
                    value={lineForm.standard_qty}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, standard_qty: e.target.value }))}
                    placeholder="e.g. 1.5"
                    className={`${inputCls} w-full`}
                    style={S.input}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Qty Basis</label>
                  <select
                    value={lineForm.qty_basis}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, qty_basis: e.target.value }))}
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    {QTY_BASES.map((qb) => (
                      <option key={qb} value={qb}>{qb}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  <label className="flex items-center gap-1.5 cursor-pointer" style={S.sub}>
                    <input
                      type="checkbox"
                      checked={!!lineForm.allow_qty_edit}
                      onChange={(e) => setLineForm((f: Row) => ({ ...f, allow_qty_edit: e.target.checked }))}
                    />
                    Allow quantity edit at data entry
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer" style={S.sub}>
                    <input
                      type="checkbox"
                      checked={!!lineForm.lot_required}
                      onChange={(e) => setLineForm((f: Row) => ({ ...f, lot_required: e.target.checked }))}
                    />
                    Lot number required (FIFO traceability)
                  </label>
                </div>

                {(() => {
                  const it = items.find((i) => i.item_id === lineForm.item_id);
                  return it?.withdrawal_days ? (
                    <div className="col-span-2 text-[11px] font-medium text-amber-600 flex items-center gap-1">
                      <span>⚠️ Medicine/Vaccine Withdrawal Period:</span>
                      <span className="font-bold">{it.withdrawal_days} days</span>
                    </div>
                  ) : null;
                })()}
              </div>
            )}

            {/* OUTPUT */}
            {lineForm.line_type === "OUTPUT" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Output Item <span className="text-red-500">*</span></label>
                  <select
                    value={lineForm.item_id}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, item_id: e.target.value }))}
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    <option value="">— Select output item —</option>
                    {items.map((it) => (
                      <option key={it.item_id} value={it.item_id}>
                        {it.item_name} {it.uom_primary ? `(${it.uom_primary})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Standard Output Qty</label>
                  <input
                    type="number"
                    step="any"
                    value={lineForm.standard_qty}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, standard_qty: e.target.value }))}
                    placeholder="e.g. 10"
                    className={`${inputCls} w-full`}
                    style={S.input}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Output Basis</label>
                  <select
                    value={lineForm.output_basis}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, output_basis: e.target.value }))}
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    {OUTPUT_BASES.map((ob) => (
                      <option key={ob} value={ob}>{ob}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  <label className="flex items-center gap-1.5 cursor-pointer" style={S.sub}>
                    <input
                      type="checkbox"
                      checked={!!lineForm.creates_inventory}
                      onChange={(e) => setLineForm((f: Row) => ({ ...f, creates_inventory: e.target.checked }))}
                    />
                    Creates inventory receipt
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer" style={S.sub}>
                    <input
                      type="checkbox"
                      checked={!!lineForm.output_lot_auto}
                      onChange={(e) => setLineForm((f: Row) => ({ ...f, output_lot_auto: e.target.checked }))}
                    />
                    Auto-generate lot number
                  </label>
                </div>
              </div>
            )}

            {/* DESCRIPTIVE */}
            {lineForm.line_type === "DESCRIPTIVE" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>KPI Metric <span className="text-red-500">*</span></label>
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
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    <option value="">— Select KPI Metric —</option>
                    {KPI_METRICS.map((m) => (
                      <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>KPI UOM</label>
                  <input
                    value={lineForm.kpi_uom}
                    disabled={lineForm.kpi_metric !== "CUSTOM"}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, kpi_uom: e.target.value }))}
                    placeholder="e.g. KG, SCORE, HEAD"
                    className={`${inputCls} w-full`}
                    style={S.input}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Standard Target Value</label>
                  <input
                    type="number"
                    step="any"
                    value={lineForm.std_value}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, std_value: e.target.value }))}
                    placeholder="e.g. 1.8"
                    className={`${inputCls} w-full`}
                    style={S.input}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Capture Per</label>
                  <select
                    value={lineForm.capture_per}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, capture_per: e.target.value }))}
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    {CAPTURE_PERS.map((cp) => (
                      <option key={cp} value={cp}>{cp.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Lower Alert Limit</label>
                  <input
                    type="number"
                    step="any"
                    value={lineForm.lower_alert_limit}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, lower_alert_limit: e.target.value }))}
                    className={`${inputCls} w-full`}
                    style={S.input}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Upper Alert Limit</label>
                  <input
                    type="number"
                    step="any"
                    value={lineForm.upper_alert_limit}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, upper_alert_limit: e.target.value }))}
                    className={`${inputCls} w-full`}
                    style={S.input}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Alert Severity</label>
                  <select
                    value={lineForm.alert_severity}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, alert_severity: e.target.value }))}
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    {ALERT_SEVERITIES.map((as) => (
                      <option key={as} value={as}>{as}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* OVERHEAD */}
            {lineForm.line_type === "OVERHEAD" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Overhead Category</label>
                  <select
                    value={lineForm.overhead_category}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, overhead_category: e.target.value }))}
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    <option value="">— Select category —</option>
                    {OVERHEAD_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>GL Account</label>
                  <input
                    value={lineForm.gl_account}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, gl_account: e.target.value }))}
                    placeholder="e.g. 7200"
                    className={`${inputCls} w-full`}
                    style={S.input}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Estimated Cost</label>
                  <input
                    type="number"
                    step="any"
                    value={lineForm.estimated_cost}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, estimated_cost: e.target.value }))}
                    placeholder="e.g. 150.00"
                    className={`${inputCls} w-full`}
                    style={S.input}
                  />
                </div>
              </div>
            )}

            {/* RESOURCE */}
            {lineForm.line_type === "RESOURCE" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Labour / Equipment Resource <span className="text-red-500">*</span></label>
                  <select
                    value={lineForm.resource_id}
                    onChange={(e) => {
                      const r = resources.find((res) => res.resource_id === e.target.value);
                      setLineForm((f: Row) => ({
                        ...f,
                        resource_id: e.target.value,
                        resource_name: r?.resource_name || f.resource_name,
                      }));
                    }}
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    <option value="">— Select resource —</option>
                    {resources.map((r) => (
                      <option key={r.resource_id} value={r.resource_id}>
                        {r.resource_name} {r.resource_type ? `(${r.resource_type})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Standard Qty (Hours / Units)</label>
                  <input
                    type="number"
                    step="any"
                    value={lineForm.standard_qty}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, standard_qty: e.target.value }))}
                    placeholder="e.g. 2"
                    className={`${inputCls} w-full`}
                    style={S.input}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Estimated Cost</label>
                  <input
                    type="number"
                    step="any"
                    value={lineForm.estimated_cost}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, estimated_cost: e.target.value }))}
                    placeholder="e.g. 50.00"
                    className={`${inputCls} w-full`}
                    style={S.input}
                  />
                </div>
              </div>
            )}

            {/* TRANSFER */}
            {lineForm.line_type === "TRANSFER" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Animal / Piglet Item <span className="text-red-500">*</span></label>
                  <select
                    value={lineForm.item_id}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, item_id: e.target.value }))}
                    className={`${inputCls} nf-select w-full`}
                    style={S.input}
                  >
                    <option value="">— Select animal item —</option>
                    {items.map((it) => (
                      <option key={it.item_id} value={it.item_id}>
                        {it.item_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold" style={S.sub}>Standard Head Count</label>
                  <input
                    type="number"
                    step="any"
                    value={lineForm.standard_qty}
                    onChange={(e) => setLineForm((f: Row) => ({ ...f, standard_qty: e.target.value }))}
                    placeholder="e.g. 150"
                    className={`${inputCls} w-full`}
                    style={S.input}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowLineModal(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveLineForm} className="nf-btn-primary">
              {editingLineIndex !== null ? "Update Activity" : "Add Activity to Schedule"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
