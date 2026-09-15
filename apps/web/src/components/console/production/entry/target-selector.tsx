"use client";

import React from "react";
import { useLanguage } from "@/hooks/useLanguage";
import type { TargetingInfo, TargetScope } from "./types";

/**
 * Who an entry is about (spec §4).
 *
 * A Count Only batch has no animal rows, so it says so and sends nothing —
 * there is no control to get wrong. A Registered batch defaults to the whole
 * stage: the radio starts there and only a deliberate switch to "Select
 * animals" exposes the list, because the common case is recording for the
 * stage, not curating a subset of it.
 */
export function TargetSelector({
  targeting,
  scope,
  animalIds,
  onChange,
  disabled,
}: {
  targeting: TargetingInfo;
  scope: TargetScope;
  animalIds: string[];
  onChange: (next: { scope: TargetScope; animalIds: string[] }) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();

  if (targeting.mode === "COUNT_ONLY") {
    return <p className="text-[11px] text-(--text-muted)">{t("deWWholeBatch")}</p>;
  }

  const animals = targeting.stage_animals;

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-[13px] text-(--text-primary)">
        <input
          type="radio"
          name={`target-${disabled ? "ro" : "rw"}`}
          checked={scope !== "SELECTED_ANIMALS"}
          disabled={disabled}
          onChange={() => onChange({ scope: "STAGE_ANIMALS", animalIds: [] })}
        />
        {t("deWWholeStage", { count: String(animals.length) })}
      </label>
      <label className="flex items-center gap-2 text-[13px] text-(--text-primary)">
        <input
          type="radio"
          checked={scope === "SELECTED_ANIMALS"}
          disabled={disabled}
          onChange={() => onChange({ scope: "SELECTED_ANIMALS", animalIds: animalIds.length ? animalIds : [] })}
        />
        {t("deWSelectAnimals")}
      </label>
      {scope === "SELECTED_ANIMALS" && (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
          {animals.length === 0 && <p className="text-[11px] text-(--text-muted)">{t("deWNoAnimalsInStage")}</p>}
          {animals.map((a) => (
            <label key={a.animal_id} className="flex items-center gap-2 text-[12px] text-(--text-primary)">
              <input
                type="checkbox"
                checked={animalIds.includes(a.animal_id)}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    scope: "SELECTED_ANIMALS",
                    animalIds: e.target.checked
                      ? [...animalIds, a.animal_id]
                      : animalIds.filter((id) => id !== a.animal_id),
                  })
                }
              />
              {a.animal_code}
              {a.ear_tag && <span className="text-(--text-muted)">· {a.ear_tag}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default TargetSelector;
