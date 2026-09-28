"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Plus,
  Edit2,
  CheckCircle2,
  Clock,
  ArrowRight,
  Layers,
} from "lucide-react";
import PiggeryLifecycleStepper, { PiggeryStage } from "./piggery-lifecycle-stepper";
import { buildLifecycleStages, StageMasterRow } from "./build-lifecycle-stages";
import { resolvePiggeryStageId } from "./resolve-piggery-stage";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";

import { api } from "@/services/api-client";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";

interface BatchLifecycleMeta {
  id: string;
  code: string;
  name: string;
  breed: string;
  type: string;
  startDate: string;
  currentStageId: number;
  currentStageCode?: string;
}

export default function PiggeryBatchStagesPanel() {
  const { t } = useLanguage();
  const [batches, setBatches] = useState<BatchLifecycleMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");

  const currentBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) || batches[0],
    [batches, selectedBatchId]
  );

  const [stages, setStages] = useState<PiggeryStage[]>([]);
  const [stageMaster, setStageMaster] = useState<any[]>([]);
  const [currentStageId, setCurrentStageId] = useState<number>(1);

  // Edit Stage Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<PiggeryStage | null>(null);
  const [editDays, setEditDays] = useState("");

  // Add Stage Modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageCode, setNewStageCode] = useState("");
  const [newStageDays, setNewStageDays] = useState("14");

  const [toastMsg, setToastMsg] = useState("");

  // Fetch live batches from DB
  useEffect(() => {
    const companyId = getActiveCompanyId();
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.get(`/stage?companyId=${companyId}&limit=200`)
      .then((r: any) => setStageMaster(Array.isArray(r) ? r : (r?.data?.data ?? r?.data ?? [])))
      .catch(() => setStageMaster([]));
    api.get(`/batch?companyId=${companyId}&status=ACTIVE&limit=50`)
      .then((res) => {
        const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        const mapped: BatchLifecycleMeta[] = list.map((b: any) => {
          const matchedStage = resolvePiggeryStageId(b.current_stage_code);
          return {
            id: b.batch_id,
            code: b.batch_no,
            name: b.remarks || b.batch_no,
            breed: b.breed_name || b.breed_code || "—",
            type: b.lob_name || "Piggery Batch",
            startDate: b.start_date || "",
            currentStageId: matchedStage.id,
            currentStageCode: b.current_stage_code,
          };
        });
        setBatches(mapped);
        if (mapped.length > 0) {
          setSelectedBatchId(mapped[0].id);
          setCurrentStageId(mapped[0].currentStageId);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  // Build the selected batch's real lifecycle matching its Data Entry stages:
  // loads scheduled stages from `/batch/:id/data-entry` alongside batch stage_log,
  // showing only the relevant stages for this batch in correct sequence order.
  useEffect(() => {
    if (!currentBatch) return;
    let cancelled = false;

    (async () => {
      const [details, schedRes] = await Promise.all([
        api.get(`/batch/${currentBatch.id}`).catch(() => null),
        api.get(
          `/batch/${currentBatch.id}/data-entry?date=${currentBatch.startDate || new Date().toISOString().slice(0, 10)}`
        ).catch(() => null),
      ]);
      if (cancelled) return;
      const batch = details?.data ?? details;
      if (!batch || stageMaster.length === 0) {
        setStages([]);
        return;
      }

      const schedData = schedRes?.data ?? schedRes;
      const progress: any[] = Array.isArray(schedData?.progress) ? schedData.progress : [];
      const schedStages: any[] = Array.isArray(schedData?.stages) ? schedData.stages : [];

      // Collect stage codes and IDs belonging to this batch (identical to data entry)
      const scheduledCodes = new Set<string>();
      const scheduledIds = new Set<string>();
      for (const p of progress) {
        if (p.stage_code) scheduledCodes.add(String(p.stage_code).toUpperCase());
        if (p.stage_id) scheduledIds.add(String(p.stage_id));
      }
      for (const s of schedStages) {
        if (s.stage_code) scheduledCodes.add(String(s.stage_code).toUpperCase());
        if (s.stage_id) scheduledIds.add(String(s.stage_id));
      }
      if (batch.current_stage_code) {
        scheduledCodes.add(String(batch.current_stage_code).toUpperCase());
      }
      if (batch.stage_id) {
        scheduledIds.add(String(batch.stage_id));
      }
      const stageLog: any[] = Array.isArray(batch.stage_log) ? batch.stage_log : [];
      for (const log of stageLog) {
        if (log.from_stage_code) scheduledCodes.add(String(log.from_stage_code).toUpperCase());
        if (log.to_stage_code) scheduledCodes.add(String(log.to_stage_code).toUpperCase());
      }

      let batchStageMaster: StageMasterRow[] = [];
      const seenCodes = new Set<string>();

      // Sort stageMaster preferring company-scoped over tenant-scoped
      const sortedMaster = [...stageMaster].sort((a, b) => {
        if (a.company_id && !b.company_id) return -1;
        if (!a.company_id && b.company_id) return 1;
        return (a.stage_sequence ?? 0) - (b.stage_sequence ?? 0);
      });

      if (scheduledCodes.size > 0 || scheduledIds.size > 0) {
        for (const sm of sortedMaster) {
          const codeUpper = (sm.stage_code || "").toUpperCase();
          if (
            (scheduledCodes.has(codeUpper) || scheduledIds.has(sm.stage_id)) &&
            !seenCodes.has(codeUpper)
          ) {
            seenCodes.add(codeUpper);
            batchStageMaster.push({
              stage_id: sm.stage_id,
              stage_code: sm.stage_code,
              stage_name: sm.stage_name,
              stage_sequence: sm.stage_sequence ?? 0,
              stage_category: sm.stage_category || "PRE_PRODUCTIVE",
              typical_duration_days: sm.typical_duration_days ?? 0,
              next_stage_id: sm.next_stage_id,
            });
          }
        }

        // Include any progress item from data-entry not in stageMaster
        for (const p of progress) {
          const pCode = (p.stage_code || "").toUpperCase();
          if (pCode && !seenCodes.has(pCode)) {
            seenCodes.add(pCode);
            batchStageMaster.push({
              stage_id: p.stage_id,
              stage_code: p.stage_code,
              stage_name: p.stage_name || p.stage_code,
              stage_sequence: p.stage_sequence ?? batchStageMaster.length + 1,
              stage_category: "PRE_PRODUCTIVE",
              typical_duration_days: 0,
            });
          }
        }
      } else {
        // Fallback for batches without schedulers: deduplicated stageMaster
        for (const sm of sortedMaster) {
          const codeUpper = (sm.stage_code || "").toUpperCase();
          if (!seenCodes.has(codeUpper)) {
            seenCodes.add(codeUpper);
            batchStageMaster.push(sm);
          }
        }
      }

      batchStageMaster.sort((a, b) => a.stage_sequence - b.stage_sequence);

      const built = buildLifecycleStages({
        stageMaster: batchStageMaster,
        stageLog,
        batchStartDate: String(batch.start_date || currentBatch.startDate || "").slice(0, 10),
        currentStageCode: batch.current_stage_code ?? currentBatch.currentStageCode ?? null,
      });
      setStages(built.stages);
      setCurrentStageId(built.currentStageId);
    })();

    return () => { cancelled = true; };
  }, [currentBatch, stageMaster]);

  const handleAdvanceStage = async () => {
    if (!currentBatch) return;
    const nextId = currentStageId + 1;
    if (nextId > stages.length) {
      setToastMsg(`✓ ${t("pbsFinalStageReachedMsg", { code: currentBatch.code })}`);
      setTimeout(() => setToastMsg(""), 3500);
      return;
    }

    const nextStage = stages.find((s) => s.id === nextId);
    if (!nextStage) return;

    try {
      await api.post(`/batch/${currentBatch.id}/transfer-stage`, {
        to_stage_code: nextStage.code,
        remarks: `Advanced from stage ${stages.find((s) => s.id === currentStageId)?.name || currentStageId} to ${nextStage.name}`,
      });
      setBatches((prev) =>
        prev.map((b) =>
          b.id === currentBatch.id
            ? { ...b, currentStageCode: nextStage.code, currentStageId: nextId }
            : b,
        ),
      );
    } catch {}

    const updated = stages.map((s) => ({
      ...s,
      status:
        s.id < nextId
          ? ("COMPLETED" as const)
          : s.id === nextId
          ? ("CURRENT" as const)
          : ("UPCOMING" as const),
    }));

    setStages(updated);
    setCurrentStageId(nextId);
    setToastMsg(`✓ ${t("pbsBatchTransitionedMsg", { stageId: nextId, stageName: nextStage.name })}`);
    setTimeout(() => setToastMsg(""), 4000);
  };

  const handleSaveEditStage = () => {
    if (!editingStage || !editDays) return;
    const days = parseInt(editDays, 10) || editingStage.standardDays;
    const updated = stages.map((s) => (s.id === editingStage.id ? { ...s, standardDays: days } : s));
    setStages(updated);
    setEditModalOpen(false);
    setEditingStage(null);
    setToastMsg(`✓ ${t("pbsUpdatedDurationMsg", { name: editingStage.name, days })}`);
    setTimeout(() => setToastMsg(""), 3500);
  };

  const handleAddCustomStage = () => {
    if (!newStageName || !newStageCode) return;
    const days = parseInt(newStageDays, 10) || 14;
    const newStage: PiggeryStage = {
      id: stages.length + 1,
      code: newStageCode,
      name: newStageName,
      type: "Custom Stage",
      standardDays: days,
      daysRange: `${days} Days`,
      status: "UPCOMING",
    };

    const updated = [...stages, newStage];
    setStages(updated);
    setAddModalOpen(false);
    setNewStageName("");
    setNewStageCode("");
    setToastMsg(`✓ ${t("pbsAddedCustomStageMsg", { name: newStageName, days })}`);
    setTimeout(() => setToastMsg(""), 3500);
  };

  const currentStageName =
    stages.find((s) => s.status === "CURRENT")?.name ||
    stages.find((s) => s.id === currentStageId)?.name ||
    currentBatch?.currentStageCode ||
    t("pbsActiveStage");
  const totalStandardDays = stages.reduce((sum, s) => sum + s.standardDays, 0);

  if (loading) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <p className="text-sm font-medium text-[var(--text-muted)]">{t("pbsLoadingBatchLifecycles")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text-primary)]">
      {/* ── Top Header Strip with Batch Selector ── */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {t("pbsProductionBatchLabel")}
            </span>
            <div className="w-80">
              <SearchableSelect
                ariaLabel={t("pbsProductionBatchLabel")}
                value={selectedBatchId}
                onChange={(val) => {
                  setSelectedBatchId(val);
                  const selected = batches.find((b) => b.id === val);
                  if (selected) setCurrentStageId(selected.currentStageId);
                }}
                options={batches.map((b) => ({
                  value: b.id,
                  label: `${b.code} — ${b.name} (${b.breed})`,
                }))}
                searchPlaceholder="Search batches…"
              />
            </div>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
              style={{
                backgroundColor: "var(--success-muted)",
                color: "var(--success)",
                borderColor: "rgba(47, 125, 91, 0.2)",
              }}
            >
              {t("pbsActiveLifecycle")}
            </span>
          </div>

          <p className="text-xs text-[var(--text-muted)] mt-1.5">
            {t("pbsBreedLabel")}: <strong className="text-[var(--text-primary)]">{currentBatch?.breed || "—"}</strong> ·
            {t("pbsTypeLabel")}: <strong className="text-[var(--text-primary)]">{currentBatch?.type || "—"}</strong> ·
            {t("pbsStartDateLabel")}: <strong className="text-[var(--text-primary)]">{currentBatch?.startDate || "—"}</strong> ·
            {t("pbsCurrentStageLabel")}: <strong className="text-[var(--accent)]">{currentStageName}</strong>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleAdvanceStage}
            className="text-xs h-8 gap-1.5 font-medium"
          >
            <ArrowRight className="w-3.5 h-3.5" /> {t("pbsAdvanceStage")}
          </Button>

          <Button
            size="sm"
            onClick={() => setAddModalOpen(true)}
            className="nf-btn-primary text-xs h-8 gap-1.5 font-semibold"
          >
            <Plus className="w-3.5 h-3.5" /> {t("pbsAddStage")}
          </Button>
        </div>
      </div>

      {toastMsg && (
        <div className="p-3 text-xs font-semibold rounded-[var(--radius-sm)] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ── Visual Lifecycle Stepper ── */}
      {stages.length > 0 && (
        <PiggeryLifecycleStepper
          stages={stages}
          currentStageId={currentStageId}
        />
      )}

      {/* ── Stage Sequence Table ── */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-2xs">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-raised)] flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--accent)]" /> {t("pbsStageSequenceTitle")}
          </h3>
          <span className="text-xs text-[var(--text-muted)] font-mono">
            {t("pbsTotalStagesMsg", { count: stages.length, days: totalStandardDays })}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)]/50 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                <th className="px-4 py-2.5 font-bold">{t("pbsSeqHeader")}</th>
                <th className="px-4 py-2.5 font-bold">{t("pbsStageCodeHeader")}</th>
                <th className="px-4 py-2.5 font-bold">{t("pbsStageNameHeader")}</th>
                <th className="px-4 py-2.5 font-bold">{t("pbsStageTypeHeader")}</th>
                <th className="px-4 py-2.5 font-bold text-right">{t("pbsStandardDaysHeader")}</th>
                <th className="px-4 py-2.5 font-bold text-right">{t("pbsDayFromHeader")}</th>
                <th className="px-4 py-2.5 font-bold text-right">{t("pbsDayToHeader")}</th>
                <th className="px-4 py-2.5 font-bold">{t("pbsStatusHeader")}</th>
                <th className="px-4 py-2.5 font-bold text-right">{t("pbsActionsHeader")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {stages.map((stage, index) => {
                const dayFrom = index === 0 ? 1 : stages.slice(0, index).reduce((sum, s) => sum + s.standardDays, 1);
                const dayTo = stage.standardDays > 0 ? dayFrom + stage.standardDays - 1 : dayFrom;

                return (
                  <tr key={stage.id} className="hover:bg-[var(--surface-raised)]/80 transition-colors">
                    <td className="px-4 py-3 font-semibold text-[var(--text-muted)]">{stage.id}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-[var(--text-primary)]">{stage.code}</td>
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{stage.name}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{stage.type}</td>
                    <td className="px-4 py-3 text-right font-bold font-mono">{stage.standardDays}</td>
                    <td className="px-4 py-3 text-right text-[var(--text-secondary)] font-mono">{dayFrom}</td>
                    <td className="px-4 py-3 text-right text-[var(--text-secondary)] font-mono">{dayTo}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          stage.status === "COMPLETED"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                            : stage.status === "CURRENT"
                            ? "bg-[var(--accent)] text-white shadow-2xs font-bold"
                            : "bg-slate-500/10 text-[var(--text-muted)]"
                        }`}
                      >
                        {stage.status === "COMPLETED" && <CheckCircle2 className="w-3 h-3" />}
                        {stage.status === "CURRENT" && <Clock className="w-3 h-3 animate-spin" />}
                        {stage.status === "COMPLETED" ? t("pbsStatusCompleted") : stage.status === "CURRENT" ? t("pbsStatusInProgress") : t("pbsStatusUpcoming")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingStage(stage);
                          setEditDays(String(stage.standardDays));
                          setEditModalOpen(true);
                        }}
                        className="h-6 text-[10px] px-2 text-[var(--text-muted)] hover:text-[var(--accent)]"
                      >
                        <Edit2 className="w-3 h-3 mr-1" /> {t("pbsEdit")}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="p-3.5 bg-[var(--surface-raised)] border-t border-[var(--border)]">
          <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            {t("pbsFooterNote", { startDate: currentBatch?.startDate || "—" })}
          </p>
        </div>
      </div>

      {/* ── MODAL: EDIT STAGE DURATION ── */}
      {editModalOpen && editingStage && (
        <Dialog
          open={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          title={t("pbsEditTimelineTitle", { name: editingStage.name })}
          maxWidth="sm"
          footer={
            <Button size="sm" onClick={handleSaveEditStage} className="nf-btn-primary">
              {t("pbsSaveDuration")}
            </Button>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            <div>
              <label className="font-semibold block mb-1">{t("pbsStandardDurationDaysLabel")}</label>
              <input
                type="number"
                value={editDays}
                onChange={(e) => setEditDays(e.target.value)}
                className="nf-input w-full font-mono text-sm font-bold"
              />
            </div>
          </div>
        </Dialog>
      )}

      {/* ── MODAL: ADD CUSTOM STAGE ── */}
      {addModalOpen && (
        <Dialog
          open={addModalOpen}
          onClose={() => setAddModalOpen(false)}
          title={t("pbsAddCustomStageTitle")}
          maxWidth="sm"
          footer={
            <Button size="sm" onClick={handleAddCustomStage} className="nf-btn-primary">
              {t("pbsInsertStage")}
            </Button>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            <div>
              <label className="font-semibold block mb-1">{t("pbsStageCodeRequiredLabel")}</label>
              <input
                type="text"
                value={newStageCode}
                onChange={(e) => setNewStageCode(e.target.value)}
                placeholder={t("pbsStageCodePlaceholder")}
                className="nf-input w-full font-mono font-bold"
              />
            </div>

            <div>
              <label className="font-semibold block mb-1">{t("pbsStageNameRequiredLabel")}</label>
              <input
                type="text"
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                placeholder={t("pbsStageNamePlaceholder")}
                className="nf-input w-full"
              />
            </div>

            <div>
              <label className="font-semibold block mb-1">{t("pbsStandardDurationDaysLabel")}</label>
              <input
                type="number"
                value={newStageDays}
                onChange={(e) => setNewStageDays(e.target.value)}
                className="nf-input w-full font-mono"
              />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
