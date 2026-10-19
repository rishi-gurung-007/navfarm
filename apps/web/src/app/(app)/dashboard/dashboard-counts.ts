/**
 * Counting rules for the dashboard KPI cards. Pure functions so they can be
 * tested without rendering the page.
 */

type Row = Record<string, any>;

const rowsOf = (res: any): Row[] =>
  Array.isArray(res) ? res : (res?.data ?? []);

/**
 * Pages through a limit/offset list endpoint until a short page comes back, so
 * every row is counted. (The list APIs return a bare array with no total, so a
 * single `?limit=100` silently dropped everything past the first 100.)
 */
export async function fetchAllPages(
  fetchPage: (limit: number, offset: number) => Promise<any>,
  pageSize = 500,
  maxPages = 200,
): Promise<Row[]> {
  const all: Row[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = rowsOf(await fetchPage(pageSize, page * pageSize));
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

/** Head held by a batch: closing quantity (0 counts as 0), opening only when closing is not recorded. */
export function batchHead(b: Row): number {
  const closing = b.closing_quantity;
  const raw =
    closing === null || closing === undefined || closing === ''
      ? b.opening_quantity
      : closing;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export const isActiveBatch = (b: Row): boolean => b.status === 'ACTIVE';

export const activeBatches = (batches: Row[]): Row[] =>
  batches.filter(isActiveBatch);

/**
 * Live head: registered live animals, plus the head of ACTIVE batch-wise
 * batches. Animal-wise batches are already counted through their animals.
 */
export function biologicalCensus(batches: Row[], animals: Row[]): number {
  const batchWise = activeBatches(batches)
    .filter((b) => b.tracking_mode !== 'ANIMAL_WISE')
    .reduce((sum, b) => sum + batchHead(b), 0);
  return animals.length + batchWise;
}

/** Work-in-progress valuation of the ACTIVE batches. */
export function activeBatchValuation(batches: Row[]): number {
  return activeBatches(batches).reduce(
    (sum, b) => sum + (Number(b.wip_value) || 0),
    0,
  );
}
