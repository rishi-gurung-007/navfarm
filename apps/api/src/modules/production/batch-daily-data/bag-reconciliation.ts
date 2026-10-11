/**
 * Workbook checkpoint 28 (Bag reconciliation, POST Day): "Compare daily empty
 * bags times configured bag size with posted consumption and alert through
 * NAVFarm master." Example: "WARNING: 98 empty bags imply 4,900 KG versus
 * 5,000 KG posted use; review tolerance." It is a warning, never a refusal.
 *
 * Returns the warning text when the bags imply a quantity that differs from
 * the posted consumption by more than the tolerance (percent of the posted
 * quantity; an unset tolerance is zero, so any difference is flagged), else null.
 */
export function bagReconciliationWarning(args: {
  emptyBags: number;
  bagSizeKg: number;
  consumedKg: number;
  tolerancePct: number | null;
}): string | null {
  const implied = args.emptyBags * args.bagSizeKg;
  const difference = Math.abs(implied - args.consumedKg);
  const allowed = (args.consumedKg * (args.tolerancePct ?? 0)) / 100;
  if (difference <= allowed + 1e-9) return null;
  const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${args.emptyBags} empty bags imply ${kg(implied)} KG versus ${kg(args.consumedKg)} KG posted use; review tolerance${args.tolerancePct != null ? ` (${args.tolerancePct}%)` : ''}.`;
}
