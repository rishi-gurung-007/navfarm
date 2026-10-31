/**
 * Rishi, 30 Oct: the quantity rules a feed requisition line meets, checked in
 * the form before the API refuses the same (quantityProblems in
 * feed-requisition.rules.ts):
 *  - a BULK line orders whole compartments of the Bulk Order Multiple, a
 *    BAGGED line whole bags;
 *  - a silo's projected stock on the Proposed Delivery Date plus what the
 *    requisition delivers to it by then may not pass the silo's capacity.
 */

export type FeedForm = 'BULK' | 'BAGGED';

export interface QuantityLine {
  quantityKg: number;
  feedType: FeedForm | null | undefined;
  destinationId: string;
  deliveryDate: string;
  /** null for a store or a silo with no capacity set. */
  capacityKg?: number | null;
  /** The silo's projected stock on a morning, or null when it is not known here. */
  stockOn?: (date: string) => number | null;
}

export type QuantityProblem =
  | { kind: 'MULTIPLE'; line: number; multipleKg: number; bagged: boolean }
  | { kind: 'CAPACITY'; line: number; capacityKg: number; stockKg: number; totalKg: number; fitsKg: number };

/** The step a line orders in, or 0 when there is none to keep to. */
export function orderStepKg(feedType: FeedForm | null | undefined, s: { bulkMultipleKg?: number; bagSizeKg?: number }): number {
  if (feedType === 'BULK') return s.bulkMultipleKg ?? 0;
  if (feedType === 'BAGGED') return s.bagSizeKg ?? 0;
  return 0;
}

/** Same 1e-6 tolerance the API uses (isOffBulkMultiple). */
export function isOffMultiple(quantityKg: number, stepKg: number): boolean {
  if (!(stepKg > 0)) return false;
  const units = Math.round((quantityKg / stepKg) * 1e6) / 1e6;
  return Math.abs(units - Math.round(units)) > 1e-6;
}

/** The largest whole number of steps that fits in `freeKg`; `freeKg` itself when there is no step. */
export function fitInSteps(freeKg: number, stepKg: number): number {
  if (freeKg <= 0) return 0;
  return stepKg > 0 ? Math.floor(freeKg / stepKg + 1e-9) * stepKg : freeKg;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function quantityProblems(lines: QuantityLine[], s: { bulkMultipleKg?: number; bagSizeKg?: number }): QuantityProblem[] {
  const problems: QuantityProblem[] = [];
  lines.forEach((l, index) => {
    const step = orderStepKg(l.feedType, s);
    if (l.quantityKg > 0 && isOffMultiple(l.quantityKg, step)) {
      problems.push({ kind: 'MULTIPLE', line: index, multipleKg: step, bagged: l.feedType === 'BAGGED' });
    }
    if (l.capacityKg == null || !l.deliveryDate) return;
    const stockKg = l.stockOn?.(l.deliveryDate);
    if (stockKg == null) return;
    const delivered = lines
      .filter((o) => o.destinationId === l.destinationId && o.deliveryDate && o.deliveryDate <= l.deliveryDate)
      .reduce((sum, o) => sum + (o.quantityKg > 0 ? o.quantityKg : 0), 0);
    if (delivered + stockKg > l.capacityKg + 1e-6) {
      problems.push({
        kind: 'CAPACITY',
        line: index,
        capacityKg: l.capacityKg,
        stockKg,
        totalKg: round3(delivered + stockKg),
        fitsKg: fitInSteps(round3(l.capacityKg - stockKg - (delivered - l.quantityKg)), step),
      });
    }
  });
  return problems;
}
