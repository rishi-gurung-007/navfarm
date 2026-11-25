/** Why doses are destroyed (Phase 3, 24 Nov 2026): the AI Station report's "Destroyed" by reason. */
export const DISPOSAL_REASONS = ['QC_FAILED', 'EXPIRED', 'DAMAGED', 'OTHER'] as const;
export type DisposalReason = (typeof DISPOSAL_REASONS)[number];

export const DISPOSAL_REASON_LABEL: Record<DisposalReason, string> = {
  QC_FAILED: 'Failed QC',
  EXPIRED: 'Expired',
  DAMAGED: 'Damaged or spoiled',
  OTHER: 'Other',
};

const TOLERANCE = 1e-9;

/** Why a destruction cannot be recorded as entered, or null. */
export function disposalProblem(input: {
  lotNo: string;
  doses: number;
  available: number;
  where: string;
  date: string;
  collectionDate: string;
  today: string;
  reasonType: string;
  remarks?: string | null;
}): string | null {
  if (!(input.doses > 0)) return 'Enter how many doses were destroyed.';
  if (!(DISPOSAL_REASONS as readonly string[]).includes(input.reasonType)) return `Reason must be one of ${DISPOSAL_REASONS.join(', ')}.`;
  if (input.reasonType === 'OTHER' && !input.remarks?.trim()) return 'Say what happened in Remarks when the reason is Other.';
  if (input.date > input.today) return `A destruction cannot be dated in the future (${input.date}).`;
  if (input.date < input.collectionDate) return `Lot ${input.lotNo} was collected on ${input.collectionDate}; doses cannot be destroyed before that.`;
  if (input.doses > input.available + TOLERANCE) {
    return `Lot ${input.lotNo} has ${round(input.available)} dose${input.available === 1 ? '' : 's'} at ${input.where}; ${input.doses} cannot be destroyed.`;
  }
  return null;
}

/**
 * The store doses are destroyed from: the one named, or the only store holding the lot. Several stores holding it and none named: the
 * user must choose (doses are destroyed where they physically are).
 */
export function disposalStore(
  named: string | null | undefined,
  stock: { warehouse_id: string; label: string; qty: number }[],
): { warehouseId: string } | { error: string } {
  const holding = stock.filter((s) => s.qty > TOLERANCE);
  if (named) return { warehouseId: named };
  if (holding.length === 1) return { warehouseId: holding[0].warehouse_id };
  if (!holding.length) return { error: 'No store holds any of this lot.' };
  return { error: `Choose the store the doses were destroyed at: ${holding.map((s) => `${s.label} (${round(s.qty)})`).join(', ')}.` };
}

const round = (n: number) => Math.round(n * 100) / 100;
