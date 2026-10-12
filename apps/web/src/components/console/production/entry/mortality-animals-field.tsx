"use client";

import React from "react";
import { useLanguage } from "@/hooks/useLanguage";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ReasonSelect } from "@/components/ui/reason-select";
import { useReasons, type ReasonRow } from "@/hooks/useReasons";
import {
  OTHER_REASON,
  filterMortalityCandidates,
  mortalityPicksComplete,
  tooManyDeaths,
  type MortalityCandidate,
  type MortalityPick,
} from "./mortality-animals";

/** What GET /batch/:id/daily-data/mortality-candidates answers for one line. */
export interface MortalityInfo {
  animals: MortalityCandidate[];
  already_posted: number;
  /** The choice saved with a draft of this line and date. */
  draft_animals: Array<{ animal_id: string | null; dead_weight_kg: number; reason_id: string | null; reason_text: string | null }>;
}

/** A saved draft's choice as picks, so it is shown again rather than asked for twice. */
export function draftPicks(info: MortalityInfo | undefined): MortalityPick[] {
  return (info?.draft_animals ?? []).map((d) => ({
    animal_id: d.animal_id ?? "",
    dead_weight_kg: String(d.dead_weight_kg),
    reason_id: d.reason_id ?? (d.reason_text ? OTHER_REASON : ""),
    reason_text: d.reason_text ?? "",
  }));
}

/**
 * Loads, for every whole-batch mortality line, the registered animals still alive at its stage. A line that comes
 * back with no animals is count-only: it asks for a weight and reason per death but names no animal. Animal-wise batches name their animal per entry and skip it.
 */
export function useMortalityCandidates(batchId: string | undefined, date: string, lineIds: string[], enabled: boolean, refreshKey?: unknown) {
  const [info, setInfo] = React.useState<Record<string, MortalityInfo>>({});
  const wanted = lineIds.join(",");
  React.useEffect(() => {
    if (!enabled || !batchId || !wanted) {
      setInfo({});
      return;
    }
    let cancelled = false;
    Promise.all(
      wanted.split(",").map((lineId) =>
        api
          .get(`/batch/${batchId}/daily-data/mortality-candidates?lineId=${lineId}&date=${date}`)
          .then((res: unknown) => {
            const data = ((res as { data?: unknown })?.data ?? res) as Partial<MortalityInfo>;
            return [lineId, { animals: data.animals ?? [], already_posted: Number(data.already_posted ?? 0), draft_animals: data.draft_animals ?? [] }] as const;
          })
          .catch(() => [lineId, { animals: [], already_posted: 0, draft_animals: [] }] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setInfo(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [batchId, date, wanted, enabled, refreshKey]);
  return info;
}

/**
 * The picker for one mortality line: a button showing how many of the required deaths are filled in, opening a dialog
 * where each death gets its dead weight and reason. With registered animals the animals are searched and ticked first;
 * a count-only batch (no animals) shows one row per death. A reason is picked from the Reason Master (mortality
 * reasons) or, through "Other", typed. More deaths than registered animals alive cannot be posted.
 */
export function MortalityAnimalsField({
  animals,
  required,
  picks,
  onChange,
  disabled,
}: {
  animals: MortalityCandidate[];
  required: number;
  picks: MortalityPick[];
  onChange: (next: MortalityPick[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const { reasons, loading } = useReasons("MORTALITY");
  const reasonOptions = React.useMemo<ReasonRow[]>(
    () => [
      ...reasons,
      { reason_id: OTHER_REASON, reason_code: "OTHER", reason_name: t("deMortOther"), category: "MORTALITY" },
    ],
    [reasons, t],
  );

  if (required <= 0) return null;
  const countOnly = animals.length === 0;
  if (tooManyDeaths(required, animals.length)) {
    return (
      <p className="mt-1 text-xs font-medium text-red-600" data-testid="mortality-too-many">
        {t("deMortTooMany", { required: String(required), alive: String(animals.length) })}
      </p>
    );
  }

  const complete = mortalityPicksComplete(picks, required);
  const filled = countOnly ? picks.filter((p) => mortalityPicksComplete([p], 1)).length : picks.length;
  const pickOf = (id: string) => picks.find((p) => p.animal_id === id);
  const toggle = (id: string) => {
    if (pickOf(id)) onChange(picks.filter((p) => p.animal_id !== id));
    else if (picks.length < required) onChange([...picks, { animal_id: id, dead_weight_kg: "", reason_id: "", reason_text: "" }]);
  };
  const patch = (index: number, change: Partial<MortalityPick>) =>
    onChange(picks.map((p, i) => (i === index ? { ...p, ...change } : p)));
  const visible = filterMortalityCandidates(animals, search);
  const labelOf = (p: MortalityPick, i: number) =>
    countOnly ? t("deMortDeadN", { n: String(i + 1) }) : animals.find((a) => a.animal_id === p.animal_id)?.animal_code ?? p.animal_id;

  return (
    <div className="mt-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid="mortality-animals-button"
        className={`h-8 w-full justify-between text-xs ${complete ? "text-emerald-600" : "text-amber-600"}`}
      >
        {t(countOnly ? "deMortCountButton" : "deMortButton", { chosen: String(filled), required: String(required) })}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("deMortTitle")}
        description={t(countOnly ? "deMortCountHelp" : "deMortHelp", { required: String(required) })}
        presentation="modal"
        footer={
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            {t("deMortDone")}
          </Button>
        }
      >
        {!countOnly && (<>
        <p className="mb-3 text-sm font-medium" data-testid="mortality-progress">
          {t("deMortChosen", { chosen: String(picks.length), required: String(required) })}
        </p>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("deMortSearch")}
          aria-label={t("deMortSearch")}
          className="mb-3 h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
        />
        {animals.length === 0 && <p className="text-sm text-[var(--text-muted)]">{t("deMortNone")}</p>}
        <ul className="space-y-1">
          {visible.map((a) => {
            const checked = Boolean(pickOf(a.animal_id));
            return (
              <li key={a.animal_id}>
                <label className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-sm hover:bg-[var(--surface-raised)]">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && picks.length >= required}
                    onChange={() => toggle(a.animal_id)}
                  />
                  <span className="font-medium">{a.animal_code}</span>
                  {a.rfid_tag && <span className="text-xs text-[var(--text-muted)]">{a.rfid_tag}</span>}
                </label>
              </li>
            );
          })}
        </ul>
        </>)}
        {picks.length > 0 && (
          <div className={countOnly ? "space-y-3" : "mt-4 space-y-3 border-t border-[var(--border)] pt-3"}>
            {picks.map((p, i) => (
              <div key={countOnly ? i : p.animal_id} className="grid gap-2 sm:grid-cols-[8rem_9rem_1fr] sm:items-start" data-testid={`mortality-detail-${countOnly ? i + 1 : p.animal_id}`}>
                <span className="pt-2 text-sm font-semibold">{labelOf(p, i)}</span>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  inputMode="decimal"
                  value={p.dead_weight_kg}
                  onChange={(e) => patch(i, { dead_weight_kg: e.target.value })}
                  placeholder={t("deMortWeight")}
                  aria-label={`${labelOf(p, i)} - ${t("deMortWeight")}`}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                />
                <div className="space-y-1">
                  <ReasonSelect
                    ariaLabel={`${labelOf(p, i)} - ${t("deMortReason")}`}
                    value={p.reason_id}
                    valueFormat="id"
                    reasons={reasonOptions}
                    loading={loading}
                    placeholder={t("deMortReason")}
                    onChange={(val) => patch(i, { reason_id: val, reason_text: val === OTHER_REASON ? p.reason_text : "" })}
                  />
                  {p.reason_id === OTHER_REASON && (
                    <input
                      type="text"
                      maxLength={200}
                      value={p.reason_text}
                      onChange={(e) => patch(i, { reason_text: e.target.value })}
                      placeholder={t("deMortOtherText")}
                      aria-label={`${labelOf(p, i)} - ${t("deMortOtherText")}`}
                      className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  );
}

export default MortalityAnimalsField;
