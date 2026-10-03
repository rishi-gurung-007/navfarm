/**
 * Pure planning for align-feed-tdd.ts (no database access, unit-tested).
 *
 * Feed Planning Settings own the farm logistics values now (spec 2026-10-03
 * §3.2). A farm's legacy location_master values are carried across to its
 * feed_planning_setting override row ONLY where they differ from what the farm
 * would inherit anyway, so a farm that agrees with its company stays inheriting.
 */

export interface Logistics {
  bulkMultipleKg: number | null;
  bagSizeKg: number | null;
  truckTargetKg: number | null;
  productionWeekday: number | null;
}

export type LogisticsKey = keyof Logistics;
export const LOGISTICS_KEYS: LogisticsKey[] = ['bulkMultipleKg', 'bagSizeKg', 'truckTargetKg', 'productionWeekday'];

/** The client defaults: bulk multiple 3000, bag 50, truck target 30000, production day Sunday. */
export const FeedLogisticsDefaults = { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 } as const;

export interface FarmLegacyRow extends Logistics {
  farmId: string;
  companyId: string;
  code: string;
}

export interface FarmOverridePlan {
  farmId: string;
  code: string;
  action: 'insert' | 'update' | 'none';
  /** Only the values to write (differing from the company's effective value). */
  values: Partial<Record<LogisticsKey, number>>;
  /** Differing fields the farm's existing override row already sets; those win and are left alone. */
  keptExisting: LogisticsKey[];
}

/**
 * companies: company-level active row values by company id (null field = unset, so the default applies).
 * existing: the farm's active override row values by farm id (null field = inherits).
 */
export function planFarmOverrides(
  farms: FarmLegacyRow[],
  companies: Map<string, Logistics>,
  existing: Map<string, Logistics>,
): FarmOverridePlan[] {
  return farms.map((farm) => {
    const company = companies.get(farm.companyId);
    const current = existing.get(farm.farmId);
    const values: Partial<Record<LogisticsKey, number>> = {};
    const keptExisting: LogisticsKey[] = [];
    for (const key of LOGISTICS_KEYS) {
      const legacy = farm[key];
      if (legacy === null || legacy === undefined) continue;
      const effective = company?.[key] ?? FeedLogisticsDefaults[key];
      if (Number(legacy) === Number(effective)) continue;
      if (current && current[key] !== null && current[key] !== undefined) {
        keptExisting.push(key);
        continue;
      }
      values[key] = Number(legacy);
    }
    const action = Object.keys(values).length === 0 ? 'none' : current ? 'update' : 'insert';
    return { farmId: farm.farmId, code: farm.code, action, values, keptExisting };
  });
}

export interface RequisitionLineRow {
  requisitionId: string;
  lineId: string;
  lineSeq: number;
}

export interface LineRenumber {
  lineId: string;
  from: number;
  to: number;
}

/** Feed requisition lines are numbered in 10000-steps (feed-requisition.service.ts): 10000, 20000, ... in existing order. */
export function planLineRenumber(lines: RequisitionLineRow[]): LineRenumber[] {
  const byRequisition = new Map<string, RequisitionLineRow[]>();
  for (const line of lines) {
    const group = byRequisition.get(line.requisitionId) ?? [];
    group.push(line);
    byRequisition.set(line.requisitionId, group);
  }
  const changes: LineRenumber[] = [];
  for (const group of byRequisition.values()) {
    group.sort((a, b) => a.lineSeq - b.lineSeq || (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0));
    group.forEach((line, index) => {
      const to = (index + 1) * 10000;
      if (line.lineSeq !== to) changes.push({ lineId: line.lineId, from: line.lineSeq, to });
    });
  }
  return changes;
}
