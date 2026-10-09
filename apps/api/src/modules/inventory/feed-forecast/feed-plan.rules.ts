export interface FeedPlanFact {
  farmId: string;
  farmCode: string;
  farmName: string;
  period: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  tentativeKg?: number;
  approvedRequisitionKg?: number;
  shippedKg?: number;
  receivedKg?: number;
  capacityKg?: number | null;
}

export interface FeedPlanRow {
  farm: { id: string; code: string; name: string };
  period: string;
  item: { id: string; code: string; name: string };
  tentativeKg: number;
  approvedRequisitionKg: number;
  shippedKg: number;
  receivedKg: number;
  remainingKg: number;
  varianceKg: number;
  capacityKg: number | null;
}

export interface FeedPlanWeek {
  from: string;
  to: string;
}

export interface FeedPlanHistoryAmount {
  actualKg: number;
  expectedKg: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error('A date in YYYY-MM-DD format is required');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('A valid date in YYYY-MM-DD format is required');
  }
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ISO year/week containing the production date, expressed as YYYYWW. */
export function isoProductionWeek(productionDate: string): string {
  const date = parseIsoDate(productionDate);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
  return `${isoYear}${String(week).padStart(2, '0')}`;
}

export function buildFeedPlanCode(farmCode: string, productionDate: string, version: number): string {
  if (!farmCode.trim()) throw new Error('Farm code is required');
  if (!Number.isInteger(version) || version < 1) throw new Error('Feed plan version must be a positive integer');
  return `PLAN-${farmCode.trim()}-${isoProductionWeek(productionDate)}-R${String(version).padStart(2, '0')}`;
}

/** The five fully closed Wednesday-Tuesday periods preceding the production cycle. */
export function completedFeedWeeks(productionDate: string): FeedPlanWeek[] {
  const production = parseIsoDate(productionDate);
  const daysSinceWednesday = (production.getUTCDay() - 3 + 7) % 7;
  const currentWednesday = new Date(production.getTime() - daysSinceWednesday * DAY_MS);
  return Array.from({ length: 5 }, (_, index) => {
    const weeksBefore = 5 - index;
    const from = new Date(currentWednesday.getTime() - weeksBefore * 7 * DAY_MS);
    const to = new Date(from.getTime() + 6 * DAY_MS);
    return { from: isoDate(from), to: isoDate(to) };
  });
}

export function productionFeedWeek(productionDate: string): FeedPlanWeek {
  const production = parseIsoDate(productionDate);
  const daysSinceWednesday = (production.getUTCDay() - 3 + 7) % 7;
  const from = new Date(production.getTime() - daysSinceWednesday * DAY_MS);
  return { from: isoDate(from), to: isoDate(new Date(from.getTime() + 6 * DAY_MS)) };
}

function roundKg(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

/**
 * Normalizes posted five-week usage against the lifecycle-expected usage, then
 * applies that observed factor to the target week's lifecycle projection.
 */
export function deriveTentativeFeedQuantity(input: {
  projectedTargetKg: number;
  history: FeedPlanHistoryAmount[];
}): { adjustmentFactor: number; tentativeKg: number } {
  if (input.history.length !== 5) throw new Error('Five completed feed weeks are required');
  const projectedTargetKg = Math.max(0, Number(input.projectedTargetKg) || 0);
  const totals = input.history.reduce((result, row) => ({
    actualKg: result.actualKg + Math.max(0, Number(row.actualKg) || 0),
    expectedKg: result.expectedKg + Math.max(0, Number(row.expectedKg) || 0),
  }), { actualKg: 0, expectedKg: 0 });
  const adjustmentFactor = totals.expectedKg > 0 ? totals.actualKg / totals.expectedKg : 1;
  return {
    adjustmentFactor: roundKg(adjustmentFactor),
    tentativeKg: roundKg(projectedTargetKg * adjustmentFactor),
  };
}

export function buildFeedPlanRows(facts: FeedPlanFact[]): FeedPlanRow[] {
  const rows = new Map<string, FeedPlanRow>();
  for (const fact of facts) {
    const key = `${fact.period}|${fact.itemId}`;
    const row = rows.get(key) ?? {
      farm: { id: fact.farmId, code: fact.farmCode, name: fact.farmName },
      period: fact.period,
      item: { id: fact.itemId, code: fact.itemCode, name: fact.itemName },
      tentativeKg: 0,
      approvedRequisitionKg: 0,
      shippedKg: 0,
      receivedKg: 0,
      remainingKg: 0,
      varianceKg: 0,
      capacityKg: null,
    };
    row.tentativeKg += Number(fact.tentativeKg ?? 0);
    row.approvedRequisitionKg += Number(fact.approvedRequisitionKg ?? 0);
    row.shippedKg += Number(fact.shippedKg ?? 0);
    row.receivedKg += Number(fact.receivedKg ?? 0);
    if (fact.capacityKg !== null && fact.capacityKg !== undefined) row.capacityKg = (row.capacityKg ?? 0) + Number(fact.capacityKg);
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => ({
    ...row,
    remainingKg: Math.max(0, row.approvedRequisitionKg - row.receivedKg),
    varianceKg: row.approvedRequisitionKg - row.tentativeKg,
  })).sort((a, b) => a.period.localeCompare(b.period) || a.item.code.localeCompare(b.item.code));
}
