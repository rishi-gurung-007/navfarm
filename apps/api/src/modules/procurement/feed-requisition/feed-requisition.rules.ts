/**
 * Feed requisition rules — pure, no database (Feed Forecast Plan B).
 *
 * Every number on a drafted feed requisition line comes from here, so the
 * workbook's own figures can be pinned in a unit test:
 * - Recommended quantity: Worked Example columns G–H, `MAX(0, requirement −
 *   opening)` then `CEILING(…, 3000)`; Engine Step 8 "Bulk rounding defaults
 *   to 3000 KG per compartment … Bagged rounds to 50 KG". Safety stock is 0
 *   and silo free capacity is not applied (Worked Example scope note; Q9).
 * - Bag count: Requisition §1 row 23, quantity ÷ bag size (default 50).
 * - Remarks: checkpoint 18, more than 20 % from the recommendation.
 * - Submission cycle: checkpoint 22 — produced on the farm's production
 *   weekday (default Sunday), due the day before (Q4).
 * - Priority: Requisition §1 row 34 — CRITICAL_FIRST_PRIORITY only for a
 *   silo at or below its single low level; otherwise from the shortage date
 *   ("Below 3 days = first priority. Below 7 days = warning", Engine §4 row
 *   55), which we map to CRITICAL and WARNING because the workbook reserves
 *   first priority for the low level ("not a second low threshold").
 *
 * Date arithmetic (ruling L12) is the engine's own `addDays`/`diffDays` —
 * re-exported here as `addDaysIso`/`diffDaysIso` rather than copied, so a
 * calendar bug can only exist in one place.
 */
import { addDays, diffDays, type ForecastSource } from '../../inventory/feed-forecast/feed-forecast.engine';
import { todayLocal } from '../../inventory/feed-forecast/feed-forecast.service';

export type FeedType = 'BULK' | 'BAGGED';
export type Priority = 'CRITICAL_FIRST_PRIORITY' | 'CRITICAL' | 'WARNING' | 'INFO';

export interface FarmFeedSettings {
  bulkMultipleKg: number;
  bagSizeKg: number;
  truckTargetKg: number;
  productionWeekday: number;
}

export const DEFAULT_FEED_SETTINGS: FarmFeedSettings = { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0 };

/** Checkpoint 18: "deviates more than 20 percent from Recommended Qty". */
export const DEVIATION_LIMIT = 0.2;

export interface DestinationInfo {
  locationId: string;
  locationType: 'SILO' | 'STORE';
  feedInBags: boolean | null;
  lowLevelKg: number | null;
}

export interface DraftLine {
  key: string;
  destinationLocationId: string;
  sourceType: 'SILO' | 'STORE';
  sourceCode: string;
  itemId: string;
  itemName: string;
  feedType: FeedType;
  isNextDiet: boolean;
  daysBeforeDietChange: number | null;
  lifecycleRefId: string | null;
  systemBalanceKg: number;
  dailyRequirementKg: number;
  daysRemaining: number | null;
  firstShortageDate: string | null;
  unroundedNeedKg: number;
  recommendedQtyKg: number;
  bagCount: number | null;
  proposedDeliveryDate: string;
  belowLowLevel: boolean;
  needsSiloChangeover: boolean;
}

export const addDaysIso = addDays;
export const diffDaysIso = diffDays;

/** Kilograms to three decimals — the precision the ledger stores quantities in. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** A requisition line is one destination and one item ("lines per silo and item", spec Plan B). */
export function lineKey(destinationLocationId: string, itemId: string): string {
  return `${destinationLocationId}|${itemId}`;
}

/** Requisition §1 row 15: Feed Type from Location Master. Nothing is recorded today, so a silo is bulk, a store bags (Q10). */
export function feedTypeOf(dest: Pick<DestinationInfo, 'locationType' | 'feedInBags'>): FeedType {
  if (dest.feedInBags === true) return 'BAGGED';
  if (dest.feedInBags === false) return 'BULK';
  return dest.locationType === 'STORE' ? 'BAGGED' : 'BULK';
}

export function roundOrderKg(needKg: number, feedType: FeedType, s: FarmFeedSettings): number {
  if (needKg <= 0) return 0;
  const multiple = feedType === 'BULK' ? s.bulkMultipleKg : s.bagSizeKg;
  // Rounded to 1e-6 before the ceiling so 3000.0000000004 kg does not become two compartments.
  return Math.ceil(Math.round((needKg / multiple) * 1e6) / 1e6) * multiple;
}

export function bagCountFor(kg: number, feedType: FeedType, s: FarmFeedSettings): number | null {
  if (feedType !== 'BAGGED') return null;
  return Math.ceil(Math.round((kg / s.bagSizeKg) * 1e6) / 1e6);
}

export function deviationNeedsRemarks(recommendedKg: number | null, requestedKg: number): boolean {
  if (recommendedKg === null) return false; // a manual line has nothing to deviate from
  if (recommendedKg <= 0) return requestedKg > 0;
  return Math.abs(requestedKg - recommendedKg) / recommendedKg > DEVIATION_LIMIT + 1e-9;
}

export function productionCycle(planningDate: string, productionWeekday: number): { productionDate: string; submissionDeadline: string } {
  const weekday = new Date(`${planningDate}T00:00:00Z`).getUTCDay();
  // Strictly after the planning date: a request made on production day itself is for the next cycle.
  const ahead = ((productionWeekday - weekday + 7) % 7) || 7;
  const productionDate = addDaysIso(planningDate, ahead);
  return { productionDate, submissionDeadline: addDaysIso(productionDate, -1) };
}

export function recommendLines(args: {
  planningDate: string;
  to: string;
  sources: ForecastSource[];
  destinations: Map<string, DestinationInfo>;
  settings: FarmFeedSettings;
}): DraftLine[] {
  const { planningDate, to, sources, destinations, settings } = args;
  const lines: DraftLine[] = [];
  for (const s of sources) {
    // Worked Example G8: MAX(0, requirement − opening). "Never offset next diet with stock of current diet" holds
    // because each source is one container and one item.
    const unroundedNeedKg = Math.max(0, round3(s.walkDemandKg - s.balanceKg));
    if (unroundedNeedKg <= 0) continue;
    const dest = destinations.get(s.locationId) ?? { locationId: s.locationId, locationType: s.sourceType, feedInBags: null, lowLevelKg: null };
    const feedType = feedTypeOf(dest);
    const recommendedQtyKg = roundOrderKg(unroundedNeedKg, feedType, settings);
    lines.push({
      key: lineKey(s.locationId, s.itemId),
      destinationLocationId: s.locationId,
      sourceType: s.sourceType,
      sourceCode: s.sourceCode,
      itemId: s.itemId,
      itemName: s.itemName,
      feedType,
      isNextDiet: s.isNextDiet,
      daysBeforeDietChange: s.isNextDiet && s.firstDemandDate ? diffDaysIso(planningDate, s.firstDemandDate) : null,
      lifecycleRefId: s.lifecycleIds[0] ?? null,
      systemBalanceKg: s.balanceKg,
      // Requisition §2 row 50 "Daily consumption for this silo": today's, or for a next diet its first day's.
      dailyRequirementKg: s.planningDayDemandKg > 0 ? s.planningDayDemandKg : s.firstDayDemandKg,
      daysRemaining: s.daysLeft,
      firstShortageDate: s.runDownDate,
      unroundedNeedKg,
      recommendedQtyKg,
      bagCount: bagCountFor(recommendedQtyKg, feedType, settings),
      // Requisition §1 row 29: "Derived from earliest projected shortage". A need inside the window implies a
      // shortage inside it, so `to` is only a guard.
      proposedDeliveryDate: s.runDownDate ?? to,
      belowLowLevel: dest.locationType === 'SILO' && dest.lowLevelKg !== null && s.balanceKg <= dest.lowLevelKg,
      needsSiloChangeover: s.noSiloHoldsItem,
    });
  }
  return lines;
}

export function requisitionPriority(planningDate: string, lines: Pick<DraftLine, 'belowLowLevel' | 'firstShortageDate'>[]): Priority {
  if (lines.some((l) => l.belowLowLevel)) return 'CRITICAL_FIRST_PRIORITY';
  const shortages = lines.map((l) => l.firstShortageDate).filter((d): d is string => !!d).sort();
  if (!shortages.length) return 'INFO';
  const days = diffDaysIso(planningDate, shortages[0]);
  if (days < 3) return 'CRITICAL';
  if (days < 7) return 'WARNING';
  return 'INFO';
}

export interface ExistingDraftLine {
  lineId: string;
  key: string;
  quantityKg: number;
  recommendedQtyKg: number | null;
  /** requisition_line.quantity_edited (Ruling M9): the farm changed this quantity by hand. */
  quantityEdited?: boolean;
}

export interface DraftUpsertPlan {
  insert: DraftLine[];
  update: { lineId: string; line: DraftLine; keepQuantity: boolean; priorQuantityKg: number }[];
  remove: string[];
  keep: string[];
}

/**
 * A line the farm changed. Ruling M9's flag is the record of it — a farm that
 * edits 6,000 kg to 9,000 and back to 6,000 has still made the quantity its
 * own — and a quantity that no longer matches the recommendation it was
 * drafted with (or a line drafted with none) counts as changed too, so a line
 * written before the flag existed is never overwritten either.
 */
function wasEdited(line: ExistingDraftLine): boolean {
  return line.quantityEdited === true || line.recommendedQtyKg === null || Math.abs(line.quantityKg - line.recommendedQtyKg) > 1e-6;
}

/**
 * Engine Step 9 on rerun: update the cycle's one AUTO_DRAFT in place. A farm's
 * own quantity is never overwritten (Requisition §1 row 24: Requested Qty is
 * "Farm Manager final … qty"), and a (destination, item) already on another
 * requisition of the cycle is not drafted twice (row 9).
 */
export function planDraftUpsert(existing: ExistingDraftLine[], covered: Set<string>, wanted: DraftLine[]): DraftUpsertPlan {
  const plan: DraftUpsertPlan = { insert: [], update: [], remove: [], keep: [] };
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const wantedKeys = new Set<string>();
  for (const line of wanted) {
    if (covered.has(line.key)) continue;
    wantedKeys.add(line.key);
    const prior = byKey.get(line.key);
    if (!prior) plan.insert.push(line);
    else plan.update.push({ lineId: prior.lineId, line, keepQuantity: wasEdited(prior), priorQuantityKg: prior.quantityKg });
  }
  for (const prior of existing) {
    if (wantedKeys.has(prior.key)) continue;
    (wasEdited(prior) ? plan.keep : plan.remove).push(prior.lineId);
  }
  return plan;
}

/** The server's calendar day — the forecast's planning-date rule itself (todayLocal), not a copy of it (L12). */
export function serverToday(now: Date = new Date()): string {
  return todayLocal(now.getTime());
}

/** Engine Step 9 "Preserve run ID". Format ours (the workbook's example RUN-GRS-20260923-001 uses a daily sequence). */
export function runKeyFor(farmCode: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `RUN-${farmCode}-${serverToday(now).replace(/-/g, '')}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
