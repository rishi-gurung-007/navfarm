type Row = Record<string, any>;

/**
 * Which stages the animal-wise data-entry strip shows, and the head count on each circle.
 *
 * A batch keeps a scheduler for every stage it has had, so the strip used to show a stage long after its last animal
 * left: BATCH-000001 kept QUARANTINE (marked "—") after its six boars moved to their own batch on 10 Nov 2026, which
 * read as a stage created on its own. But data entry follows who was in the batch on the posting date (decisions.md,
 * 21 Oct), so on a date when those boars were still there QUARANTINE has entries due and must stay.
 *
 * So a stage shows when it has animals on the posting date or now. Its circle shows the head count now; a stage that is
 * empty now but had animals on the posting date shows that day's count, and says so.
 */
export interface StripStage {
  stage: Row;
  /** The number on the circle. */
  head: number;
  /** True when `head` is the posting date's count because the stage is empty now. */
  onDateOnly: boolean;
}

export function dataEntryStrip(progress: Row[]): StripStage[] {
  return progress
    .map((p) => {
      const onDate = Number(p.animal_count ?? 0);
      const now = Number(p.current_animal_count ?? p.animal_count ?? 0);
      return { stage: p, head: now > 0 ? now : onDate, onDateOnly: now === 0 && onDate > 0 };
    })
    .filter((s) => s.head > 0);
}
