"use client";

import React from "react";
import { useLanguage } from "@/hooks/useLanguage";
import { api } from "@/services/api-client";
import { ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LotSerialPicker } from "@/components/ui/lot-serial-picker";
import { TargetSelector } from "./target-selector";
import type { EntryFormResponse, EntryStatus, FormLine, TargetScope } from "./types";

/**
 * One scheduler line as a sub-card (spec §5).
 *
 * A sub-card is one line of the schedule for one day — not the parent card
 * (that is the Activity grouping above it). Its own state is what the API says
 * the row is: Not entered (no row), Draft, or Posted. The inputs start from
 * the row's values and only diverge from them when someone types.
 *
 * Save draft writes without side effects; Post is the write; Correct replaces
 * a posted entry. A 409 means someone else changed the row first — the
 * contract's message is shown and the form reloads, because the local copy is
 * no longer the truth about this line.
 */
export function SubCard({
  form,
  line,
  batchId,
  onChanged,
}: {
  form: EntryFormResponse;
  line: FormLine;
  batchId: string;
  onChanged: () => void;
}) {
  const { t } = useLanguage();

  const entry = line.entry;
  const [value, setValue] = React.useState<string>(
    entry?.entered_value != null ? String(entry.entered_value) : entry?.entered_text ?? "",
  );
  const [lot, setLot] = React.useState(entry?.lot_no ?? "");
  const [remarks, setRemarks] = React.useState(entry?.remarks ?? "");
  const [scope, setScope] = React.useState<TargetScope>(
    entry?.target_scope ?? (form.targeting.mode === "COUNT_ONLY" ? "BATCH" : "STAGE_ANIMALS"),
  );
  const [animalIds, setAnimalIds] = React.useState<string[]>(entry?.animal_ids ?? []);
  const [correcting, setCorrecting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    setValue(entry?.entered_value != null ? String(entry.entered_value) : entry?.entered_text ?? "");
    setLot(entry?.lot_no ?? "");
    setRemarks(entry?.remarks ?? "");
    setScope(entry?.target_scope ?? (form.targeting.mode === "COUNT_ONLY" ? "BATCH" : "STAGE_ANIMALS"));
    setAnimalIds(entry?.animal_ids ?? []);
    setCorrecting(false);
    setError("");
  }, [entry, form.targeting.mode]);

  const status: EntryStatus | null = entry?.status ?? null;
  /** Correction reopens a posted row; nothing else edits a posted one. */
  const editable = status === null || status === "DRAFT" || (status === "POSTED" && correcting);

  const body = React.useCallback(
    (version?: number) => ({
      line_id: line.line_id,
      entry_date: form.date,
      entered_value: value !== "" && !isNaN(Number(value)) ? Number(value) : undefined,
      entered_text: value !== "" && isNaN(Number(value)) ? value : undefined,
      lot_no: lot || undefined,
      remarks: remarks || undefined,
      target_scope: scope,
      animal_ids: scope === "SELECTED_ANIMALS" ? animalIds : undefined,
      ...(version != null ? { version } : {}),
    }),
    [animalIds, form.date, line.line_id, lot, remarks, scope, value],
  );

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      // A version conflict means this browser's copy is stale; refresh the
      // whole form so the next attempt starts from what is actually stored.
      if (e instanceof ApiError && e.status === 409) onChanged();
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () =>
    run(() => api.put(`/batch/${batchId}/daily-data/draft`, { ...body(entry?.version) }));

  const postOne = () =>
    run(() =>
      api.post(`/batch/${batchId}/daily-data/post`, {
        entry_date: form.date,
        line_ids: [line.line_id],
      }),
    );

  const correct = () =>
    run(() => api.post(`/batch/${batchId}/daily-data/correct`, { ...body(entry?.version) }));

  const stateChip = status === "POSTED"
    ? { label: t("deWPosted"), cls: "bg-emerald-600/10 text-emerald-700" }
    : status === "DRAFT"
      ? { label: t("deWDraft"), cls: "bg-amber-600/10 text-amber-700" }
      : { label: t("deWNotEntered"), cls: "bg-[var(--surface-raised)] text-(--text-muted)" };

  const canSave = editable && !busy;
  const showCorrect = status === "POSTED" && line.correctable && !correcting;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-(--text-primary)">
            {line.activity_name}
            {line.is_mandatory && <span className="ml-1 text-[11px] font-normal text-(--danger)">{t("deMandatory")}</span>}
          </p>
          {line.item_name && (
            <p className="text-[11px] text-(--text-muted)">
              {line.item_name}
              {line.standard_qty != null && ` · ${t("deSuggested", { value: String(line.standard_qty) })}${line.uom ? ` ${line.uom}` : ""}`}
            </p>
          )}
          {line.locked_reason && <p className="text-[11px] text-(--text-muted)">{line.locked_reason}</p>}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stateChip.cls}`}>{stateChip.label}</span>
      </div>

      {editable ? (
        <div className="mt-3 space-y-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            placeholder={t("deValue")}
            inputMode="decimal"
            aria-label={`${line.activity_name} — ${t("deValue")}`}
          />
          {line.lot_required && (
            <div className="w-full">
              <LotSerialPicker
                itemId={line.item_id || ""}
                warehouseId={(form.batch as any)?.warehouse_id}
                trackingType="LOT"
                value={lot}
                onChange={(val) => setLot(val)}
                disabled={busy}
                placeholder={t("deLot") || "Select lot…"}
                ariaLabel={`${line.activity_name} — ${t("deLot")}`}
              />
            </div>
          )}
          <Input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            disabled={busy}
            placeholder={t("deRemarks")}
            aria-label={`${line.activity_name} — ${t("deRemarks")}`}
          />
          {!line.editable ? null : (
            <TargetSelector
              targeting={form.targeting}
              scope={scope}
              animalIds={animalIds}
              onChange={(next) => {
                setScope(next.scope);
                setAnimalIds(next.animalIds);
              }}
              disabled={busy}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {status !== "POSTED" && (
              <>
                <Button size="sm" variant="outline" disabled={!canSave} onClick={saveDraft}>
                  {busy ? t("deSaving") : t("deWSaveDraft")}
                </Button>
                <Button size="sm" disabled={!canSave} onClick={postOne}>
                  {t("deWPost")}
                </Button>
              </>
            )}
            {status === "POSTED" && correcting && (
              <Button size="sm" disabled={busy} onClick={correct}>
                {busy ? t("deSaving") : t("deWCorrect")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {showCorrect && (
            <Button size="sm" variant="outline" onClick={() => setCorrecting(true)}>
              {t("deWCorrect")}
            </Button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-(--danger)">{error}</p>}
    </div>
  );
}

export default SubCard;
