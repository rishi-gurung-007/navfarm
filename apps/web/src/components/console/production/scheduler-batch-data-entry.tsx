"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleSlash,
  Clock,
  Lock,
  Save,
} from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";

/**
 * The day's data entry, driven by the batch's scheduler.
 *
 * The worker is shown what the schedule says is due and nothing else — which
 * feed, how much of it, which checks — with the quantity already worked out for
 * the number of animals standing in the stage. Adding an activity the schedule
 * does not call for is not something this screen offers.
 *
 * Whether a line may be touched is decided by the API and arrives per line as
 * `editable` and `locked_reason`. It is deliberately not re-derived here: the
 * same rule already runs server-side on save, and a second copy in the browser
 * is a copy that drifts from the one that actually protects the data.
 *
 * The layout answers one question at a time, because it is used standing up in
 * a shed on a phone: which day, which stage, then the handful of numbers due.
 * Targets are finger-sized, the save bar never scrolls away, and every line
 * says plainly whether it is saved, changed, or locked.
 */

interface StageStatus {
  stage_id: string | null;
  stage_name: string | null;
  animal_count: number | null;
  due: number;
  mandatory: number;
  mandatoryEntered: number;
  entered: number;
  complete: boolean;
  scheduled: boolean;
}

interface FormLine {
  line_id: string;
  line_type: string;
  activity_name: string;
  is_mandatory: boolean;
  item_name: string | null;
  uom: string | null;
  standard_qty: number | null;
  qty_basis: string | null;
  suggested_value: number | null;
  allow_qty_edit: boolean;
  lot_required: boolean;
  kpi_metric: string | null;
  lower_alert_limit: number | null;
  upper_alert_limit: number | null;
  entry: {
    entered_value: number | null;
    entered_text: string | null;
    lot_no: string | null;
    remarks: string | null;
    alert_triggered: boolean;
    alert_note: string | null;
  } | null;
  editable: boolean;
  locked_reason: string | null;
}

interface EntryForm {
  batch: { batch_id: string; batch_no: string; animal_tracking: string; start_date: string };
  date: string;
  today: string;
  hasScheduler: boolean;
  mayEditAnyDay: boolean;
  backlog: string[];
  selected_stage_id: string | null;
  stages: StageStatus[];
  lines: FormLine[];
  complete: boolean;
}

interface BatchOption {
  batch_id: string;
  batch_no: string;
  animal_tracking?: string;
}

/** What the worker has typed, before it is saved. */
interface Draft {
  value: string;
  lot: string;
  remarks: string;
}

const draftOf = (line: FormLine): Draft => ({
  // A saved answer wins over the schedule's suggestion, including a saved zero:
  // "no deaths today" is an answer, and ?? rather than || is what keeps it one.
  value: String(line.entry?.entered_value ?? line.suggested_value ?? ""),
  lot: line.entry?.lot_no ?? "",
  remarks: line.entry?.remarks ?? "",
});

/** Has this line been changed away from what is stored? */
const isDirty = (line: FormLine, draft: Draft | undefined): boolean => {
  if (!draft || draft.value === "") return false;
  const value = Number(draft.value);
  if (Number.isNaN(value)) return false;
  if (!line.entry) return true;
  return line.entry.entered_value !== value
    || (line.entry.lot_no ?? "") !== draft.lot
    || (line.entry.remarks ?? "") !== draft.remarks;
};

export default function SchedulerBatchDataEntry() {
  const { t } = useLanguage();

  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [batchId, setBatchId] = useState("");
  const [date, setDate] = useState("");
  const [stageId, setStageId] = useState<string | null>(null);

  const [form, setForm] = useState<EntryForm | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  /* ── The batch list ──────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/batch?limit=200&status=ACTIVE");
        if (cancelled) return;
        const rows: BatchOption[] = res?.data ?? [];
        setBatches(rows);
        if (rows.length) setBatchId((current) => current || rows[0].batch_id);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── Land on the oldest day still owed, not on today ─────────────────── */
  // A worker opening the screen with three days behind should be put in front
  // of the oldest of them, which is the only one they are allowed to enter.
  //
  // No date is sent: which day it is on the farm is the server's to answer.
  // The browser's date is the device's, and a phone in one country running a
  // farm in another is the ordinary case here, not the edge one.
  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/batch/${batchId}/daily-data/pending-days`);
        if (cancelled) return;
        setStageId(null);
        setDate(res?.oldest ?? "");
      } catch {
        if (!cancelled) setDate("");
      }
    })();
    return () => { cancelled = true; };
  }, [batchId]);

  /* ── The form for this batch, day and stage ──────────────────────────── */
  const loadForm = useCallback(async () => {
    if (!batchId) return;
    setError("");
    try {
      const query = [date ? `date=${date}` : "", stageId ? `stageId=${stageId}` : ""].filter(Boolean).join("&");
      const [formRes, datesRes] = await Promise.all([
        api.get(`/batch/${batchId}/daily-data/form?${query}`),
        api.get(`/batch/${batchId}/daily-data/entry-dates`),
      ]);
      const next: EntryForm = formRes.data;
      setForm(next);
      setHistory(datesRes?.data ?? []);
      setDrafts(Object.fromEntries(next.lines.map((line) => [line.line_id, draftOf(line)])));
      // Adopt whatever day the server settled on, so the rail and the header
      // agree with the lines that were actually returned.
      setDate(next.date);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [batchId, date, stageId]);

  useEffect(() => { void loadForm(); }, [loadForm]);

  const setDraft = (lineId: string, patch: Partial<Draft>) => {
    setSaved("");
    setDrafts((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  };

  const unsavedCount = useMemo(
    () => (form?.lines ?? []).filter((line) => line.editable && isDirty(line, drafts[line.line_id])).length,
    [form, drafts],
  );

  /* ── Saving ──────────────────────────────────────────────────────────── */
  const saveDay = async () => {
    if (!form) return;
    setSaving(true);
    setError("");
    setSaved("");
    try {
      // One POST per line, in order. The server posts each against inventory or
      // the ledger as its line type requires, so they are not interchangeable
      // and a partial failure must stop rather than carry on.
      for (const line of form.lines) {
        if (!line.editable) continue;
        const draft = drafts[line.line_id];
        if (!isDirty(line, draft)) continue;

        await api.post(`/batch/${form.batch.batch_id}/daily-data`, {
          line_id: line.line_id,
          entry_date: form.date,
          entered_value: Number(draft.value),
          lot_no: draft.lot || undefined,
          remarks: draft.remarks || undefined,
        });
      }
      setSaved(t("deSaved"));
      await loadForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (!batches.length) {
    return <EmptyState icon={CalendarDays} title={t("deNoBatches")} description={t("deNoBatchesBody")} />;
  }

  const workingDay = form?.backlog[0] ?? form?.today ?? "";
  const isWorkingDay = !!form && form.date === workingDay;
  const currentStage = form?.stages.find((s) => s.stage_id === form.selected_stage_id) ?? null;
  const recorded = (form?.lines ?? []).filter((l) => l.entry).length;

  /* The history rail, shared between the desktop column and the mobile strip. */
  const historyButtons = (
    <>
      <button
        type="button"
        onClick={() => { setStageId(null); setDate(workingDay); }}
        className={[
          "shrink-0 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left text-sm font-semibold transition lg:w-full",
          isWorkingDay
            ? "border-[var(--accent)] bg-[var(--accent)]/10 text-(--text-primary)"
            : "border-[var(--border)] text-(--text-secondary) hover:border-[var(--accent)]",
        ].join(" ")}
      >
        {t("deDataEntry")}
      </button>
      {history.filter((day) => day !== workingDay).map((day) => (
        <button
          key={day}
          type="button"
          onClick={() => { setStageId(null); setDate(day); }}
          className={[
            "shrink-0 rounded-[var(--radius-sm)] border px-3 py-2 text-left text-[13px] transition lg:w-full",
            form?.date === day
              ? "border-[var(--accent)] bg-[var(--accent)]/8 text-(--text-primary)"
              : "border-transparent text-(--text-secondary) hover:border-[var(--border)]",
          ].join(" ")}
        >
          {day}
        </button>
      ))}
    </>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-4">
        {/* ── Which batch, and which day ─────────────────────────────── */}
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[180px] flex-1">
              <span className="mb-1 block text-xs font-medium text-(--text-secondary)">{t("deSelectBatch")}</span>
              <select
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                className="h-12 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-(--text-primary)"
              >
                {batches.map((b) => (
                  <option key={b.batch_id} value={b.batch_id}>{b.batch_no}</option>
                ))}
              </select>
            </label>
            <div className="min-w-[170px]">
              <span className="mb-1 block text-xs font-medium text-(--text-secondary)">{t("deWorkingDay")}</span>
              <div className="flex h-12 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] px-3 text-sm font-semibold text-(--text-primary)">
                <CalendarDays size={15} className="text-(--accent)" />
                {form?.date ?? date}
                {form && form.date === form.today && (
                  <span className="text-xs font-normal text-(--text-secondary)">· {t("deToday")}</span>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* ── The backlog stands in front of today ───────────────────── */}
        {form && form.backlog.length > 0 && (
          <div className="flex flex-wrap items-start gap-3 rounded-[var(--radius-md)] border border-amber-500/40 bg-amber-500/10 p-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="min-w-[200px] flex-1">
              <p className="text-sm font-semibold text-(--text-primary)">{t("deBacklogTitle")}</p>
              <p className="mt-0.5 text-[13px] text-(--text-secondary)">
                {t("deBacklogBody", { count: String(form.backlog.length), oldest: form.backlog[0] })}
              </p>
            </div>
            {form.date !== form.backlog[0] && (
              <Button size="sm" variant="outline" onClick={() => { setStageId(null); setDate(form.backlog[0]); }}>
                {t("deGoToOldest", { oldest: form.backlog[0] })}
              </Button>
            )}
          </div>
        )}

        {/* ── Previous days, as a strip on small screens ─────────────── */}
        <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">{historyButtons}</div>

        {/* ── The stages, with the day's tick and who is standing in them ── */}
        {form && form.stages.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {form.stages.map((stage) => {
              const active = stage.stage_id === form.selected_stage_id;
              const Icon = !stage.scheduled ? CircleSlash : stage.complete ? CheckCircle2 : Clock;
              const tone = !stage.scheduled
                ? "text-(--text-muted)"
                : stage.complete ? "text-emerald-600" : "text-amber-600";
              return (
                <button
                  key={stage.stage_id ?? "none"}
                  type="button"
                  onClick={() => stage.scheduled && setStageId(stage.stage_id)}
                  disabled={!stage.scheduled}
                  className={[
                    "min-w-[150px] shrink-0 rounded-[var(--radius-md)] border p-3 text-left transition",
                    active
                      ? "border-[var(--accent)] bg-[var(--accent)]/8 ring-1 ring-[var(--accent)]"
                      : "border-[var(--border)] bg-[var(--surface)]",
                    stage.scheduled ? "cursor-pointer hover:border-[var(--accent)]" : "cursor-not-allowed opacity-60",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon size={16} className={`shrink-0 ${tone}`} />
                    <span className="truncate text-sm font-semibold text-(--text-primary)">
                      {stage.stage_name ?? "—"}
                    </span>
                  </div>
                  {/* The head count sits under the stage name: it is what the
                      worker counts against when they weigh out the feed. */}
                  <p className="mt-1 text-lg font-semibold leading-none text-(--text-primary)">
                    {stage.animal_count ?? "—"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-(--text-muted)">
                    {!stage.scheduled
                      ? t("deNoSchedule")
                      : stage.complete
                        ? t("deStageDone")
                        : t("deStagePending", { done: String(stage.mandatoryEntered), total: String(stage.mandatory) })}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* ── The activities due ─────────────────────────────────────── */}
        {form && !form.hasScheduler && (
          <Card><EmptyState icon={CalendarDays} title={t("deNoScheduler")} description={t("deNoSchedulerBody")} /></Card>
        )}

        {form?.hasScheduler && form.lines.length === 0 && (
          <Card><EmptyState icon={CheckCircle2} title={t("deNothingDue")} /></Card>
        )}

        {form && form.lines.length > 0 && (
          <div className="space-y-2">
            {/* Where the worker stands, in one line. */}
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
              <p className="text-sm font-semibold text-(--text-primary)">
                {currentStage?.stage_name ?? form.batch.batch_no}
              </p>
              <p className="text-xs text-(--text-secondary)">
                {t("deRecorded", { done: String(recorded), total: String(form.lines.length) })}
              </p>
            </div>

            {form.lines.map((line) => {
              const draft = drafts[line.line_id] ?? { value: "", lot: "", remarks: "" };
              const dirty = line.editable && isDirty(line, draft);
              return (
                <Card key={line.line_id} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-semibold text-(--text-primary)">
                      {line.activity_name}
                      {line.is_mandatory && <span className="ml-1 text-(--danger)" title={t("deMandatory")}>*</span>}
                    </p>
                    <div className="flex items-center gap-2 text-xs">
                      {line.item_name && <span className="text-(--text-secondary)">{line.item_name}</span>}
                      {dirty ? (
                        <span className="text-amber-600">{t("deChanged")}</span>
                      ) : line.entry ? (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <Check size={13} /> {t("deRecordedOne")}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="min-w-[150px] flex-1">
                      <span className="mb-1 block text-xs text-(--text-secondary)">
                        {t("deValue")}
                        {line.suggested_value != null && line.qty_basis === "PER_HEAD" && (
                          <span className="ml-1 text-(--text-muted)">
                            · {t("deSuggested", { value: String(line.suggested_value) })}
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          value={draft.value}
                          disabled={!line.editable || !line.allow_qty_edit}
                          onChange={(e) => setDraft(line.line_id, { value: e.target.value })}
                          className="h-12 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 text-lg font-semibold text-(--text-primary) disabled:opacity-60"
                        />
                        {line.uom && <span className="shrink-0 text-sm text-(--text-secondary)">{line.uom}</span>}
                      </div>
                    </label>

                    {line.lot_required && (
                      <label className="min-w-[130px]">
                        <span className="mb-1 block text-xs text-(--text-secondary)">{t("deLot")}</span>
                        <input
                          value={draft.lot}
                          disabled={!line.editable}
                          onChange={(e) => setDraft(line.line_id, { lot: e.target.value })}
                          className="h-12 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-(--text-primary) disabled:opacity-60"
                        />
                      </label>
                    )}

                    <label className="min-w-[170px] flex-1">
                      <span className="mb-1 block text-xs text-(--text-secondary)">{t("deRemarks")}</span>
                      <input
                        value={draft.remarks}
                        disabled={!line.editable}
                        onChange={(e) => setDraft(line.line_id, { remarks: e.target.value })}
                        className="h-12 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-(--text-primary) disabled:opacity-60"
                      />
                    </label>
                  </div>

                  {/* The reason sits on the line it applies to, where the
                      finger that just failed to type is already looking. */}
                  {!line.editable && line.locked_reason && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-(--text-secondary)">
                      <Lock size={13} className="mt-px shrink-0" /> {line.locked_reason}
                    </p>
                  )}

                  {line.entry?.alert_triggered && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
                      <AlertTriangle size={13} /> {line.entry.alert_note}
                    </p>
                  )}
                </Card>
              );
            })}

            {/* The save bar does not scroll away — on a phone the list is
                longer than the screen and the button was below the fold. */}
            <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-[var(--surface)] px-1 py-3">
              <Button
                onClick={saveDay}
                disabled={saving || unsavedCount === 0}
                className="h-12 gap-2 px-5"
              >
                <Save size={16} />
                {saving ? t("deSaving") : t("deSaveDay")}
              </Button>
              {unsavedCount > 0 && !saving && (
                <span className="text-[13px] text-amber-600">{t("deUnsaved", { count: String(unsavedCount) })}</span>
              )}
              {saved && <span className="text-[13px] text-emerald-600">{saved}</span>}
              {error && <span className="text-[13px] text-(--danger)">{error}</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── The day being worked on, and the days already recorded ─────── */}
      <aside className="hidden space-y-1 lg:sticky lg:top-4 lg:block lg:self-start">
        {history.length > 0 && (
          <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-(--text-muted)">
            {t("deHistory")}
          </p>
        )}
        {historyButtons}
      </aside>
    </div>
  );
}
