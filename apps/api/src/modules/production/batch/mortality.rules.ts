import { BadRequestException } from '@nestjs/common';

/** A reason named Other or Unknown tells nothing by itself, so the death must say what happened (TDD row 10: "Notes mandatory if Reason = OTHER / UNKNOWN"). */
const NEEDS_NOTES = /^\s*(other|unknown)\b/i;

/**
 * TDD row 10: the weight at death is mandatory for a breeding asset (one with a costing start date), because it drives the write-off. A head-count death in a
 * batch-wise lot names no animal and has none.
 */
export function assertDeathWeight(animal: { animal_code: string; costing_start_date?: string | Date | null }, weightKg: unknown): void {
  if (!animal.costing_start_date) return;
  if (!(Number(weightKg) > 0)) {
    throw new BadRequestException(`${animal.animal_code} is a costed breeding asset: record her weight at death (kg); the write-off needs it.`);
  }
}

export function assertDeathNotes(reasonName: string | null | undefined, notes: ReadonlyArray<string | null | undefined>): void {
  if (!reasonName || !NEEDS_NOTES.test(reasonName)) return;
  if (!notes.some((n) => (n ?? '').trim().length > 0)) {
    throw new BadRequestException(`The reason '${reasonName}' needs a note saying what happened.`);
  }
}
