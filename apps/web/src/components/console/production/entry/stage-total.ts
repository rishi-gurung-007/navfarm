/**
 * Per-batch (`TOTAL_BATCH`) and per-head lines in an Animal Wise stage's data entry.
 *
 * A per-batch line is a standard for the whole stage. In one animal's own row the box holds that
 * animal's share (the API already divides the standard by the animals in the stage), but in the
 * "All animals" view the box holds the stage total, and saving splits it among the animals. A
 * per-head line holds a per-animal value in both views.
 */
type Row = Record<string, any>;

export const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export const isTotalBatch = (line: Row) => line.qty_basis === 'TOTAL_BATCH';

/** A line as the "All animals" view shows it: a per-batch line's expected and entered quantity become the stage total. */
export const asStageTotalLine = (line: Row, animals: number): Row =>
  isTotalBatch(line) && animals > 1
    ? {
        ...line,
        expected_qty: line.expected_qty != null ? round4(Number(line.expected_qty) * animals) : line.expected_qty,
        already_entered_qty:
          line.already_entered_qty != null && line.already_entered_qty !== ''
            ? round4(Number(line.already_entered_qty) * animals)
            : line.already_entered_qty,
      }
    : line;

/** `total` split into `parts` shares that add up to it exactly (the last share takes the rounding). */
export const splitTotal = (total: number, parts: number): number[] => {
  if (parts <= 1) return [total];
  const share = Math.floor((total / parts) * 1e4) / 1e4;
  return Array.from({ length: parts }, (_, i) => (i < parts - 1 ? share : round4(total - share * (parts - 1))));
};
