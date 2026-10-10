/**
 * Mill Capacity Available KG per diet — workbook "Feed Forecast Engine" r42
 * ("Mill output available for this diet based on priority and bin
 * assignment") and r43 (GREEN / AMBER 90–100% / RED), with the ordering rule
 * of "Feed Forecast" r11 ("Highest demand diets produced first. One diet per
 * loading bin.").
 *
 * The inputs are the masters the 2026-10-05 decision approved, not a second
 * copy of them: the MILL location holds the daily, hourly, bulk and bagged
 * capacity, and the BIN Diet Assignment for the production date holds which
 * diet each BIN produces and its Diet Priority.
 *
 * Allocation, per MILL and per feed form (bulk diets share the Bulk Daily
 * Allocation, bagged diets the Bagged Daily Allocation): diets are taken in
 * Diet Priority order (1 first); diets with the same priority are taken by
 * highest demand first. Each diet's Mill Capacity Available is what is left
 * of its pool when its turn comes; its own demand then consumes it.
 *
 * This is the one place the rule lives. Feed Plan, Mill Consolidation and the
 * Compare Report all call it.
 */

export type FeedForm = 'BULK' | 'BAGGED';
export type CapacityStatus = 'GREEN' | 'AMBER' | 'RED';
/** AVAILABLE: computed. NOT_SCHEDULED: no BIN Diet Assignment that day. NOT_CONFIGURED: its MILL has no capacity. */
export type CapacityState = 'AVAILABLE' | 'NOT_SCHEDULED' | 'NOT_CONFIGURED';

export interface MillCapacitySetup {
  millId: string;
  millCode: string;
  dailyKg: number | null;
  hourlyKg: number | null;
  bulkKg: number | null;
  baggedKg: number | null;
}

/** One active BIN Diet Assignment on the production date. */
export interface MillDietSchedule {
  itemId: string;
  millId: string;
  feedForm: FeedForm;
  priority: number;
  binId: string;
  binCode: string;
}

export interface DietDemand {
  itemId: string;
  demandKg: number;
}

export interface DietCapacity {
  itemId: string;
  state: CapacityState;
  demandKg: number;
  availableKg: number | null;
  status: CapacityStatus | null;
  priority: number | null;
  millId: string | null;
  millCode: string | null;
  binId: string | null;
  binCode: string | null;
  feedForm: FeedForm | null;
}

/** AMBER threshold of Engine r43: "AMBER if Actual is 90 to 100% of capacity". */
const AMBER_FROM = 0.9;

const roundKg = (value: number) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;
const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export function capacityStatus(demandKg: number, availableKg: number): CapacityStatus {
  const demand = positive(demandKg);
  const available = positive(availableKg);
  if (demand > available) return 'RED';
  if (available > 0 && demand >= available * AMBER_FROM) return 'AMBER';
  return 'GREEN';
}

function poolOf(mill: MillCapacitySetup, form: FeedForm): number | null {
  const value = form === 'BULK' ? mill.bulkKg : mill.baggedKg;
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
}

export function allocateMillCapacity(input: {
  mills: MillCapacitySetup[];
  schedules: MillDietSchedule[];
  demands: DietDemand[];
}): Map<string, DietCapacity> {
  const demandByItem = new Map<string, number>();
  for (const row of input.demands) demandByItem.set(row.itemId, roundKg((demandByItem.get(row.itemId) ?? 0) + positive(row.demandKg)));

  // A diet on several BINs that day is placed by its best (lowest) priority.
  const scheduleByItem = new Map<string, MillDietSchedule>();
  for (const row of input.schedules) {
    const current = scheduleByItem.get(row.itemId);
    if (!current || row.priority < current.priority || (row.priority === current.priority && row.binCode < current.binCode)) {
      scheduleByItem.set(row.itemId, row);
    }
  }

  const millById = new Map(input.mills.map((mill) => [mill.millId, mill]));
  const result = new Map<string, DietCapacity>();
  const pools = new Map<string, MillDietSchedule[]>();
  for (const row of scheduleByItem.values()) {
    const key = `${row.millId}|${row.feedForm}`;
    pools.set(key, [...(pools.get(key) ?? []), row]);
  }

  for (const rows of pools.values()) {
    const mill = millById.get(rows[0].millId);
    const pool = mill ? poolOf(mill, rows[0].feedForm) : null;
    const ordered = [...rows].sort((a, b) => a.priority - b.priority
      || (demandByItem.get(b.itemId) ?? 0) - (demandByItem.get(a.itemId) ?? 0)
      || a.binCode.localeCompare(b.binCode));
    let remaining = pool ?? 0;
    for (const row of ordered) {
      const demandKg = demandByItem.get(row.itemId) ?? 0;
      const base = {
        itemId: row.itemId, demandKg, priority: row.priority, millId: row.millId, millCode: mill?.millCode ?? null,
        binId: row.binId, binCode: row.binCode, feedForm: row.feedForm,
      };
      if (pool === null) {
        result.set(row.itemId, { ...base, state: 'NOT_CONFIGURED', availableKg: null, status: null });
        continue;
      }
      const availableKg = roundKg(Math.max(0, remaining));
      result.set(row.itemId, { ...base, state: 'AVAILABLE', availableKg, status: capacityStatus(demandKg, availableKg) });
      remaining = Math.max(0, remaining - demandKg);
    }
  }

  for (const [itemId, demandKg] of demandByItem) {
    if (result.has(itemId)) continue;
    result.set(itemId, {
      itemId, state: 'NOT_SCHEDULED', demandKg, availableKg: null, status: null,
      priority: null, millId: null, millCode: null, binId: null, binCode: null, feedForm: null,
    });
  }
  return result;
}

/** One approved feed requisition line, as the mill sees it on its production date. */
export interface MillDemandLine {
  productionDate: string;
  farmId: string;
  itemId: string;
  requestedKg: number;
  /** The consolidation line's Mill Approved Qty KG; null while the line is not consolidated. */
  millApprovedKg: number | null;
}

export interface DietInfo {
  itemId: string;
  itemCode: string;
  itemName: string;
  dietNo: number | null;
}

export interface CompareReportRow extends DietInfo {
  productionDate: string;
  farmCount: number;
  requestedKg: number;
  millApprovedKg: number | null;
  availableKg: number | null;
  state: CapacityState;
  status: CapacityStatus | null;
  priority: number | null;
  binCode: string | null;
  feedForm: FeedForm | null;
}

export interface CompareReport {
  mill: { millId: string; millCode: string; dailyKg: number | null; bulkKg: number | null; baggedKg: number | null };
  from: string;
  to: string;
  rows: CompareReportRow[];
  total: { requestedKg: number; millApprovedKg: number; capacityKg: number | null; status: CapacityStatus | null };
}

/**
 * Compare Report (Feed Forecast r11: "all farm demand vs mill capacity per
 * diet"). One row per production date and diet the selected MILL produces or
 * is asked for. Status compares all farms' approved requested KG with Mill
 * Capacity Available (Engine r43; Checkpoint 34 "If Total Farm Demand exceeds
 * Mill Capacity Available for any diet"). Diets scheduled only on another MILL
 * that day belong to that MILL's report.
 */
export function buildCompareReport(input: {
  mill: MillCapacitySetup;
  dates: string[];
  schedulesByDate: Map<string, MillDietSchedule[]>;
  demand: MillDemandLine[];
  diets: Map<string, DietInfo>;
}): CompareReport {
  const rows: CompareReportRow[] = [];
  for (const date of input.dates) {
    const schedules = input.schedulesByDate.get(date) ?? [];
    const own = schedules.filter((row) => row.millId === input.mill.millId);
    const elsewhere = new Set(schedules.filter((row) => row.millId !== input.mill.millId).map((row) => row.itemId));
    const ownItems = new Set(own.map((row) => row.itemId));
    const lines = input.demand.filter((line) => line.productionDate === date && (ownItems.has(line.itemId) || !elsewhere.has(line.itemId)));
    const allocation = allocateMillCapacity({
      mills: [input.mill],
      schedules: own,
      demands: lines.map((line) => ({ itemId: line.itemId, demandKg: line.requestedKg })),
    });
    for (const capacity of allocation.values()) {
      const dietLines = lines.filter((line) => line.itemId === capacity.itemId);
      const approved = dietLines.filter((line) => line.millApprovedKg !== null);
      const info = input.diets.get(capacity.itemId) ?? { itemId: capacity.itemId, itemCode: capacity.itemId, itemName: '', dietNo: null };
      rows.push({
        ...info,
        productionDate: date,
        farmCount: new Set(dietLines.map((line) => line.farmId)).size,
        requestedKg: capacity.demandKg,
        millApprovedKg: approved.length ? roundKg(approved.reduce((sum, line) => sum + positive(line.millApprovedKg), 0)) : null,
        availableKg: capacity.availableKg,
        state: capacity.state,
        status: capacity.status,
        priority: capacity.priority,
        binCode: capacity.binCode,
        feedForm: capacity.feedForm,
      });
    }
  }
  rows.sort((a, b) => a.productionDate.localeCompare(b.productionDate)
    || (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER)
    || b.requestedKg - a.requestedKg || a.itemCode.localeCompare(b.itemCode));
  const requestedKg = roundKg(rows.reduce((sum, row) => sum + row.requestedKg, 0));
  const millApprovedKg = roundKg(rows.reduce((sum, row) => sum + (row.millApprovedKg ?? 0), 0));
  const daily = input.mill.dailyKg === null || input.mill.dailyKg === undefined ? null : Number(input.mill.dailyKg);
  const capacityKg = daily === null ? null : roundKg(daily * input.dates.length);
  return {
    mill: { millId: input.mill.millId, millCode: input.mill.millCode, dailyKg: daily, bulkKg: input.mill.bulkKg, baggedKg: input.mill.baggedKg },
    from: input.dates[0],
    to: input.dates[input.dates.length - 1],
    rows,
    total: { requestedKg, millApprovedKg, capacityKg, status: capacityKg === null ? null : capacityStatus(requestedKg, capacityKg) },
  };
}

/**
 * Checkpoints and Validations row 48 (checkpoint 42): "If total farm demand
 * for any diet exceeds Mill Capacity Available: Mill Manager must adjust
 * quantities before Push to BC is allowed. Cannot push infeasible plan to BC."
 * Returns the diets, among `itemIds`, that are above capacity. A diet whose
 * capacity is not configured or not scheduled is not proven infeasible here.
 */
export function capacityBreaches(allocation: Map<string, DietCapacity>, itemIds: Iterable<string>): DietCapacity[] {
  const breaches: DietCapacity[] = [];
  for (const itemId of new Set(itemIds)) {
    const capacity = allocation.get(itemId);
    if (capacity?.state === 'AVAILABLE' && capacity.status === 'RED') breaches.push(capacity);
  }
  return breaches;
}

/** Monday–Sunday ISO week containing `date`, as YYYY-MM-DD strings. */
export function isoWeekDates(date: string): string[] {
  const start = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new Error('A date in YYYY-MM-DD format is required');
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10));
}
