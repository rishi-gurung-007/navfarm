/**
 * A litter's piglet lot, or a head-count batch in the Weaner / Grower / Finisher stage, is a current biological asset (BBP-2 S.NO.6): it accumulates cost, is valued
 * at fair value from the configured week, and leaves by sale, harvest or output at its carrying value. It is never matured or amortised.
 */
export function isCurrentBioLot(batch: {
  is_litter_lot?: boolean | null;
  tracking_mode?: string | null;
  current_stage_code?: string | null;
}): boolean {
  if (batch.tracking_mode === 'ANIMAL_WISE') return false;
  return !!batch.is_litter_lot || ['WEANER', 'GROWER', 'FINISHER'].includes(String(batch.current_stage_code ?? '').toUpperCase());
}
