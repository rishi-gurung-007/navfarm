"use client";

import { useState, useEffect } from "react";
import {
  ArrowRight, Loader2, AlertTriangle,
} from "lucide-react";

import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { useLanguage } from "@/hooks/useLanguage";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ReasonSelect } from "@/components/ui/reason-select";
import type { ReasonRow } from "@/hooks/useReasons";

export interface AnimalTransitionModalAnimal {
  animal_id?: string;
  animal_code?: string;
  animal_type?: string;
  breed_name?: string;
  stage_code?: string;
  stage_name?: string;
  current_stage_id?: string;
  entry_date?: string;
  created_at?: string;
  [key: string]: any;
}

export interface AnimalTransitionModalStage {
  stage_id: string;
  stage_code: string;
  stage_name: string;
  stage_category?: string;
  next_stage_id?: string | null;
  min_days_before_move?: number | null;
  [key: string]: any;
}

type Row = Record<string, any>;

const S = {

  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised:  { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub:     { color: "var(--text-secondary)" },
  muted:   { color: "var(--text-muted)" },
  accent:  { color: "var(--accent)" },
  danger:  { color: "var(--danger)", borderColor: "var(--danger)", backgroundColor: "var(--danger-muted)" },
  warning: { color: "var(--warning)", borderColor: "var(--warning)", backgroundColor: "var(--warning-muted)" },
  success: { color: "var(--success)", borderColor: "var(--success)", backgroundColor: "var(--success-muted)" },
};

interface AnimalStageTransitionModalProps {
  open: boolean;
  onClose: () => void;
  animal: AnimalTransitionModalAnimal | null;
  onSuccess: () => void;
  stages: AnimalTransitionModalStage[] | Row[];
  locations?: Row[];
  batches?: Row[];
  reasons?: ReasonRow[] | Row[];
}

export default function AnimalStageTransitionModal({
  open,
  onClose,
  animal,
  onSuccess,
  stages,
  reasons,
}: AnimalStageTransitionModalProps) {
  const [toStageId, setToStageId]       = useState("");
  const [transitionDate, setTransitionDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason]             = useState("");
  const [remarks, setRemarks]           = useState("");

  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState("");

  const { t } = useLanguage();

  // When animal opens, auto-suggest next stage if configured on current stage
  useEffect(() => {
    if (!animal || !open) return;
    setError("");
    setTransitionDate(new Date().toISOString().slice(0, 10));
    setReason("");
    setRemarks("");

    const currentStage = stages.find(
      (s) => s.stage_id === animal.current_stage_id || (animal.stage_code && s.stage_code === animal.stage_code),
    );
    if (currentStage?.next_stage_id) {
      setToStageId(String(currentStage.next_stage_id));
    } else {
      setToStageId("");
    }
  }, [animal, open, stages]);

  if (!animal) return null;

  const currentStage = stages.find(
    (s) => s.stage_id === animal.current_stage_id || (animal.stage_code && s.stage_code === animal.stage_code),
  );
  const entryDate = animal.entry_date ? new Date(String(animal.entry_date)) : new Date(String(animal.created_at || Date.now()));
  const daysInStage = Math.max(0, Math.floor((new Date(transitionDate).getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)));
  const minDays = Number(currentStage?.min_days_before_move) || 0;
  const isPrematureMove = minDays > 0 && daysInStage < minDays;

  const handleSubmit = async () => {
    if (!toStageId) {
      setError(t("astmSelectDestinationStageError"));
      return;
    }
    if (isPrematureMove && !reason.trim()) {
      setError(t("astmMinDurationOverrideError", { minDays, daysInStage }));
      return;
    }

    setSaving(true);
    setError("");
    try {
      await api.post(`/animal/${animal.animal_id}/transition-stage`, {
        to_stage_id: toStageId,
        transition_date: transitionDate,
        reason: reason || undefined,
        remarks: remarks || undefined,
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError((err as Error)?.message || t("astmFailedToRecordTransition"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("astmModalTitle", { animalCode: animal.animal_code || "" })}
      description={t("astmModalDescription")}
      maxWidth="md"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button onClick={handleSubmit} disabled={saving || !toStageId}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5" />}
            {t("astmConfirmTransition")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <InlineAlert variant="danger">{error}</InlineAlert>}

        {/* Current State Info */}
        <div className="rounded-[var(--radius-md)] border p-4 space-y-2" style={S.raised}>
          <div className="flex items-center justify-between text-xs">
            <span style={S.muted}>{t("astmAnimalLabel")}</span>
            <span className="font-mono font-bold" style={S.primary}>
              {animal.animal_code} ({animal.animal_type} · {animal.breed_name || t("astmDefaultBreedPig")})
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span style={S.muted}>{t("astmCurrentStageLabel")}</span>
            <span className="font-semibold" style={S.primary}>{animal.stage_name || currentStage?.stage_name || t("astmDefaultStageQuarantine")}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span style={S.muted}>{t("astmTimeInCurrentStageLabel")}</span>
            <span className="font-mono font-semibold" style={isPrematureMove ? S.warning : S.primary}>
              {t("astmDaysCount", { days: daysInStage })} {minDays > 0 ? t("astmMinRequiredSuffix", { minDays }) : ""}
            </span>
          </div>
        </div>

        {/* Premature Move Notice */}
        {isPrematureMove && (
          <div className="rounded-[var(--radius-md)] border p-3 flex items-start gap-2 text-xs" style={S.warning}>
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">{t("astmPrematureWarningTitle")}</p>
              <p className="mt-0.5">
                {t("astmPrematureWarningBody", { stageName: currentStage?.stage_name, minDays })}
              </p>
            </div>
          </div>
        )}

        {/* Transition Form Inputs */}
        <div className="space-y-3">
          <div>
            <label className="nf-label text-xs block mb-1">{t("astmDestinationStageLabel")}</label>
            <SearchableSelect
              ariaLabel={t("astmDestinationStageLabel")}
              value={toStageId}
              onChange={(val) => setToStageId(val)}
              options={stages.map((s) => ({
                value: s.stage_id,
                label: `${s.stage_name} (${s.stage_code}) — ${s.stage_category}`,
              }))}
              placeholder={t("astmSelectDestinationStagePlaceholder")}
              searchPlaceholder="Search stages…"
            />
          </div>

          <div className="rounded-[var(--radius-md)] border p-3 text-xs" style={S.surface}>
            Batch and location remain unchanged during a Stage transition. Use the Transfer workflow to move an animal.
          </div>

          <div>
            <label className="nf-label text-xs">{t("astmTransitionDateLabel")}</label>
            <input
              type="date"
              className="nf-input text-xs"
              value={transitionDate}
              onChange={(e) => setTransitionDate(e.target.value)}
            />
          </div>

          <div>
            <label className="nf-label text-xs block mb-1">
              {t("astmReasonLabel")} {isPrematureMove ? t("astmRequiredForOverride") : t("astmOptionalSuffix")}
            </label>
            <ReasonSelect
              ariaLabel={t("astmReasonLabel")}
              value={reason}
              onChange={(val) => setReason(val)}
              onClear={() => setReason("")}
              placeholder={t("astmReasonPlaceholder") || "Select reason from Reason Master…"}
              searchPlaceholder="Search reason code, description, category…"
              reasons={reasons as ReasonRow[]}
              stageCode={String(animal.stage_code || currentStage?.stage_code || "")}
            />
          </div>

          <div>
            <label className="nf-label text-xs">{t("astmRemarksLabel")}</label>
            <textarea
              className="nf-input text-xs"
              rows={2}
              placeholder={t("astmRemarksPlaceholder")}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
