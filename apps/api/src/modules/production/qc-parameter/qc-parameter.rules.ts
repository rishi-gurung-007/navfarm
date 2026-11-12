/** QC Type on the client's QC Parameter Master. A NUMERIC result passes inside Min..Max; a BOOLEAN one passes when it is Yes. */
export const QC_PARAM_TYPES = ['NUMERIC', 'BOOLEAN'] as const;

type Num = number | string | null | undefined;

const toNumber = (v: Num): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

/**
 * Min ≤ Target ≤ Max, checked between whichever of the three are given. Returns the sentence to show, or null when the values agree.
 */
export function qcRangeError(min: Num, target: Num, max: Num): string | null {
  const lo = toNumber(min);
  const tg = toNumber(target);
  const hi = toNumber(max);
  if (lo !== null && hi !== null && lo > hi) return 'Min Value cannot be greater than Max Value.';
  if (lo !== null && tg !== null && tg < lo) return 'Target Value cannot be below Min Value.';
  if (hi !== null && tg !== null && tg > hi) return 'Target Value cannot be above Max Value.';
  return null;
}
