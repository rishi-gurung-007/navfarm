/**
 * Feed requisition rules — pure, no database (Feed Forecast Plan B).
 *
 * Every number on a drafted feed requisition line comes from here, so the
 * workbook's own figures can be pinned in a unit test:
 * - Recommended quantity: the forecast's shortfall (Plan R, Q3) — the
 *   largest deficit below the silo's low level through the window after
 *   confirmed incoming — then `CEILING(…, 3000)`; with no low level and
 *   nothing incoming that is the Worked Example's `MAX(0, requirement −
 *   opening)` (columns G–H). Engine Step 8 "Bulk rounding defaults to 3000 KG
 *   per compartment … Bagged rounds to 50 KG". Silo free capacity is not
 *   applied (Q9 of Plan B).
 * - Delivery date (Requisition §1 row 29): the first projected shortage date,
 *   or the planning date once that has passed; `to` when nothing is short in
 *   the window. A farm that edits it away from the drafted date must give
 *   remarks (deliveryDateNeedsRemarks), the same checkpoint 18 treats a
 *   quantity deviation.
 * - Capacity warning (Engine Step 8): the order plus the day's opening
 *   compared against the silo's own `silo_capacity_kg` — always canonical KG,
 *   never converted here — flagged, never capped (checkpoint 17 is the truck
 *   target's rule, not this one's).
 * - System Balance and the low-level test (Ruling I4): the ledger as it stands
 *   now, the figure FEED_BELOW_L1 alerts on, handed in by the service as
 *   `currentBalanceKg`. The forecast's own `balanceKg` is the start of the
 *   planning day and so leaves out feed already posted today (VIL100/SILO-004
 *   read 2,700 against a ledger of 2,684) — a requisition that called a silo
 *   fine while the alert called it low would be the two disagreeing about one
 *   number.
 *
 * Plan R changes Plan B's drafts on purpose (Ruling I4): the need is the
 * shortfall to the low level with booked transfers counted, not requirement −
 * opening; the line is dated Required On, not the run-down; and because the
 * first shortage date is the first day demand cannot be met, distinct from
 * D19's earlier low-level run-down. None of
 * it moves the Worked Example: no low level and nothing incoming, so R1 still
 * drafts 6,000 kg and R2 9,000 kg.
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
import { addDays, dayShort, diffDays, todayLocal, type BatchPk, type DailyForecastRow, type ForecastSource } from '../../inventory/feed-forecast/feed-forecast.engine';

export type FeedType = 'BULK' | 'BAGGED';
export type Priority = 'CRITICAL_FIRST_PRIORITY' | 'CRITICAL' | 'WARNING' | 'INFO';

export interface FarmFeedSettings {
  bulkMultipleKg: number;
  bagSizeKg: number;
  truckTargetKg: number;
  productionWeekday: number;
  /** TDD Engine Step 8 / Dashboard row 60: added to every silo-item shortfall. */
  safetyStockKg: number;
}

export const DEFAULT_FEED_SETTINGS: FarmFeedSettings = { bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0, safetyStockKg: 0 };

/** Checkpoint 18: "deviates more than 20 percent from Recommended Qty". */
export const DEVIATION_LIMIT = 0.2;

export interface DestinationInfo {
  locationId: string;
  locationType: 'SILO' | 'STORE';
  feedInBags: boolean | null;
  lowLevelKg: number | null;
  /** silo_capacity_kg — always canonical KG (the service converts TON on write); null when not set. Engine Step 8. */
  capacityKg: number | null;
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
  /** Req. row 29: the first projected shortage date, clamped to the planning date; `to` when nothing is short. */
  recommendedDeliveryDate: string;
  proposedDeliveryDate: string;
  /** Engine Step 8: the order plus the day's opening would exceed the silo's capacity. A warning, never a cap. */
  exceedsSiloCapacity: boolean;
  /** What the capacity warning was computed from, kept so a rerun can re-test it against a quantity the farm kept. */
  capacityKg: number | null;
  deliveryDayOpeningKg: number;
  /** Requisition §1 row 42: NAV-style line numbering, 10000/20000/… in draft order. */
  lineNo: number;
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

/** Engine Step 8 free-capacity warning: a direct KG comparison — silo_capacity_kg is always canonical KG. */
export function exceedsCapacity(quantityKg: number, deliveryDayOpeningKg: number, capacityKg: number | null): boolean {
  return capacityKg !== null && quantityKg + deliveryDayOpeningKg > capacityKg + 1e-6;
}

export function recommendLines(args: {
  planningDate: string;
  to: string;
  sources: ForecastSource[];
  destinations: Map<string, DestinationInfo>;
  settings: FarmFeedSettings;
  /**
   * Ruling I4: each (destination, item)'s ledger balance now, keyed by `lineKey`
   * — an item missing from a given map has none on the ledger. Without a map
   * (pure callers, tests) the forecast's start-of-day balance stands in.
   */
  currentBalanceKg?: Map<string, number>;
}): DraftLine[] {
  const { planningDate, to, sources, destinations, settings, currentBalanceKg } = args;
  const lines: DraftLine[] = [];
  for (const s of sources) {
    // Q3 (Plan R): what an order must bring so the silo stays above its low level through `to`, incoming counted.
    // "Never offset next diet with stock of current diet" still holds because each source is one container and one item.
    const unroundedNeedKg = Math.max(0, round3(s.shortfallKg));
    if (unroundedNeedKg <= 0) continue; // Engine Step 8: no shortage, no order (supersedes the "lands on its level" minimum)
    const dest = destinations.get(s.locationId) ?? { locationId: s.locationId, locationType: s.sourceType, feedInBags: null, lowLevelKg: null, capacityKg: null };
    const feedType = feedTypeOf(dest);
    const recommendedQtyKg = roundOrderKg(unroundedNeedKg, feedType, settings);
    const key = lineKey(s.locationId, s.itemId);
    const systemBalanceKg = currentBalanceKg ? round3(currentBalanceKg.get(key) ?? 0) : s.balanceKg;
    // Req. row 29: derived from the earliest projected shortage; nothing short in the window → the window's end.
    // 9d D1: the shortage is looked for over the forecast's standard horizon, so it can fall past `to`; that is
    // "nothing short in the window" too — the order window stays `to`.
    const shortage = s.shortageDate && s.shortageDate <= to ? s.shortageDate : null;
    const recommendedDeliveryDate = shortage ? (shortage < planningDate ? planningDate : shortage) : to;
    // Engine Step 8 free-capacity warning: a direct KG comparison — silo_capacity_kg is always canonical KG.
    const capacityKg = dest.locationType === 'SILO' ? dest.capacityKg : null;
    const exceedsSiloCapacity = exceedsCapacity(recommendedQtyKg, s.deliveryDayOpeningKg, capacityKg);
    lines.push({
      key,
      destinationLocationId: s.locationId,
      sourceType: s.sourceType,
      sourceCode: s.sourceCode,
      itemId: s.itemId,
      itemName: s.itemName,
      feedType,
      isNextDiet: s.isNextDiet,
      daysBeforeDietChange: s.isNextDiet && s.firstDemandDate ? diffDaysIso(planningDate, s.firstDemandDate) : null,
      lifecycleRefId: s.lifecycleIds[0] ?? null,
      systemBalanceKg,
      // Requisition §2 row 50 "Daily consumption for this silo": today's, or for a next diet its first day's.
      dailyRequirementKg: s.planningDayDemandKg > 0 ? s.planningDayDemandKg : s.firstDayDemandKg,
      daysRemaining: s.daysLeft,
      firstShortageDate: s.shortageDate ?? null,
      unroundedNeedKg,
      recommendedQtyKg,
      bagCount: bagCountFor(recommendedQtyKg, feedType, settings),
      recommendedDeliveryDate,
      proposedDeliveryDate: recommendedDeliveryDate,
      exceedsSiloCapacity,
      capacityKg,
      deliveryDayOpeningKg: s.deliveryDayOpeningKg,
      lineNo: (lines.length + 1) * 10000,
      belowLowLevel: dest.locationType === 'SILO' && dest.lowLevelKg !== null && systemBalanceKg <= dest.lowLevelKg,
      needsSiloChangeover: s.noSiloHoldsItem,
    });
  }
  return lines;
}

/** Req. row 29: "Farm Manager can edit with reason" — remarks only when the farm moved the date off the forecast's. */
export function deliveryDateNeedsRemarks(line: { recommendedDeliveryDate: string | null; proposedDeliveryDate: string }): boolean {
  return line.recommendedDeliveryDate !== null && line.proposedDeliveryDate !== line.recommendedDeliveryDate;
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
  /** requisition_line.recommended_delivery_date / proposed_delivery_date: a proposed date that differs from the drafted one was moved by the farm (Req. row 29). */
  recommendedDeliveryDate?: string | null;
  proposedDeliveryDate?: string | null;
}

export interface DraftUpsertPlan {
  insert: DraftLine[];
  update: { lineId: string; line: DraftLine; keepQuantity: boolean; priorQuantityKg: number; keepDeliveryDate: boolean; priorProposedDeliveryDate: string | null }[];
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
/**
 * Req. row 29, "Farm Manager can edit with reason": a delivery date that no
 * longer matches the recommendation it was drafted with was moved by the farm,
 * and a rerun leaves it alone — the same rule wasEdited applies to a quantity.
 * A line drafted with no recommended date (written before the column existed,
 * or manual) has nothing to differ from.
 */
export function deliveryDateWasMoved(line: Pick<ExistingDraftLine, 'recommendedDeliveryDate' | 'proposedDeliveryDate'>): boolean {
  return !!line.recommendedDeliveryDate && !!line.proposedDeliveryDate && line.proposedDeliveryDate !== line.recommendedDeliveryDate;
}

export function wasEdited(line: Pick<ExistingDraftLine, 'quantityKg' | 'recommendedQtyKg' | 'quantityEdited'>): boolean {
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
    else plan.update.push({
      lineId: prior.lineId, line, keepQuantity: wasEdited(prior), priorQuantityKg: prior.quantityKg,
      keepDeliveryDate: deliveryDateWasMoved(prior), priorProposedDeliveryDate: prior.proposedDeliveryDate ?? null,
    });
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

export interface ApprovalLine {
  lineSeq: number;
  itemName: string;
  quantityKg: number;
  recommendedQtyKg: number | null;
  /** null on a manual line (nothing to differ from) — deliveryDateNeedsRemarks, Req. row 29. */
  recommendedDeliveryDate: string | null;
  proposedDeliveryDate: string;
  /**
   * Review finding (Important 4, Task 9): the header table (row 36) requires
   * Remarks on an item exception too, not only a 20% deviation or a moved
   * delivery date. True when the line's own exception reason (row 13,
   * description = "Exception: …") is on record — the per-line reason itself
   * is already enforced at PUT (lineChangeProblems); this is the separate
   * header-level rule the brief asks for.
   */
  itemException?: boolean;
}

const kg = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });

/**
 * What stops an approval (Requisition §4 step 4). Remarks answer both the 20 %
 * deviation (checkpoint 18) and a late approval (checkpoint 22, Q5); they are
 * one field on the header (row 36), so one set of remarks covers every line.
 * The deadline day itself is still on time — only a later day is the exception.
 */
export function approvalProblems(args: { lines: ApprovalLine[]; remarks: string | null | undefined; today: string; submissionDeadline: string | null }): string[] {
  if (!args.lines.length) return ['A requisition needs at least one line to be approved.'];
  if (args.remarks?.trim()) return [];
  const problems: string[] = [];
  for (const l of args.lines) {
    if (deviationNeedsRemarks(l.recommendedQtyKg, l.quantityKg)) {
      problems.push(`Line ${l.lineSeq} (${l.itemName}): ${kg(l.quantityKg)} kg is more than 20% off the recommended ${kg(l.recommendedQtyKg ?? 0)} kg. Add remarks to explain.`);
    }
    if (deliveryDateNeedsRemarks(l)) {
      problems.push(`Line ${l.lineSeq} (${l.itemName}): the delivery date differs from the forecast's. Remarks are required (Requisition row 29).`);
    }
    if (l.itemException) {
      problems.push(`Line ${l.lineSeq} (${l.itemName}): feed item differs from the lifecycle requirement (exception). Remarks are required (Requisition row 36).`);
    }
  }
  if (args.submissionDeadline && args.today > args.submissionDeadline) {
    problems.push(`The submission deadline (${dayShort(args.submissionDeadline)}) has passed. Add remarks to explain.`);
  }
  return problems;
}

/**
 * Requisition row 13 and checkpoint 4, when the farm changes a line's feed
 * item or destination silo. An item the line's lifecycle row does not require
 * is an exception and needs a reason; a silo still holding another feed with
 * stock cannot take this one (one feed per silo — choose a silo holding this
 * item or an empty one). A store holds many items, so only a silo is tested.
 * A line with no lifecycle requirement (a manual line) has nothing to differ from.
 */
export const ITEM_EXCEPTION_PROBLEM = 'Feed item differs from the lifecycle requirement: record an exception reason (Requisition row 13).';
export const SILO_HOLDS_OTHER_PROBLEM = 'Silo holds another feed with stock: choose a silo holding this item or an empty one (checkpoint 4).';

export function lineChangeProblems(line: {
  requiredItemId: string | null;
  itemId: string;
  exceptionReason: string | null;
  destination: { locationType: 'SILO' | 'STORE'; heldItemId: string | null; heldBalanceKg: number };
}): string[] {
  const problems: string[] = [];
  if (line.requiredItemId !== null && line.itemId !== line.requiredItemId && !line.exceptionReason?.trim()) {
    problems.push(ITEM_EXCEPTION_PROBLEM);
  }
  const d = line.destination;
  if (d.locationType === 'SILO' && d.heldItemId !== null && d.heldItemId !== line.itemId && d.heldBalanceKg > 1e-6) {
    problems.push(SILO_HOLDS_OTHER_PROBLEM);
  }
  return problems;
}

/**
 * The exception reason lives in the line's own `description` column (Task 9:
 * no new column), prefixed so it is never mistaken for an item name.
 */
export const EXCEPTION_PREFIX = 'Exception: ';
export function exceptionReasonOf(description: string | null | undefined): string | null {
  return description?.startsWith(EXCEPTION_PREFIX) ? description.slice(EXCEPTION_PREFIX.length) : null;
}

/** Requisition §1 row 17 "Breed Lifecycle Row Reference": e.g. `L-LINE WEANER days 25–27`. */
const CALC_UNIT_WORD: Record<string, string> = { DAY: 'days', WEEK: 'weeks', MONTH: 'months' };
export function lifecycleRefLabel(r: { breed_code?: string | null; stage_code?: string | null; period_from?: number | null; period_to?: number | null; calc_unit?: string | null }): string | null {
  if (!r.breed_code && !r.stage_code) return null;
  const unit = r.calc_unit ? (CALC_UNIT_WORD[r.calc_unit] ?? r.calc_unit.toLowerCase()) : 'days';
  const range = r.period_from != null && r.period_to != null ? ` ${unit} ${r.period_from}–${r.period_to}` : '';
  return `${[r.breed_code, r.stage_code].filter(Boolean).join(' ')}${range}`;
}

export interface LineBreakdownRow {
  /** The genuine batch_header PK — never the engine's composite aggregation key (D1, 3 Oct). */
  batchId: BatchPk;
  /**
   * The stage group's identity stage (DailyForecastRow.groupStageId) — NOT the
   * stage of the first day with demand, which a group projected into another
   * group's stage would share with it, duplicating (line, batch, stage, shed)
   * on uq_requisition_line_batch (Task 9b fix round 1).
   */
  stageId: string | null;
  batchNo: string;
  shedId: string | null;
  shedCode: string;
  heads: number;
  feedRateKg: number;
  lifecycleRefId: string | null;
  demandKg: number;
  firstDemandDate: string;
}

/**
 * B1 (Rishi, 3 Oct): which batches in which houses each silo/item order line
 * is for — Engine Step 9 "draft lines per farm, batch, house, destination
 * silo, item and required date"; MOM Feed and Logistic 21 Aug 2026 "Per
 * Batch, Per House, and Per Silo". Grouped from the forecast's daily rows by
 * lineKey(destination, item), then by (batch, house), demand summed over the
 * planning window. Heads, rate and lifecycle row are the first day with
 * demand's — the figures the order was raised on. A row with no destination
 * (nothing feeds it), outside the window, or with no demand adds nothing.
 */
export function buildLineBreakdown(daily: Pick<DailyForecastRow,
  'date' | 'batchId' | 'realBatchId' | 'groupStageId' | 'batchNo' | 'shedId' | 'shedCode' | 'itemId' | 'destinationLocationId' | 'heads' | 'feedRateKg' | 'demandKg' | 'lifecycleId'>[],
from: string, to: string): Map<string, LineBreakdownRow[]> {
  const byLine = new Map<string, Map<string, LineBreakdownRow>>();
  const ordered = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const d of ordered) {
    if (!d.destinationLocationId || d.date < from || d.date > to || !(d.demandKg > 0)) continue;
    const key = lineKey(d.destinationLocationId, d.itemId);
    const rows = byLine.get(key) ?? new Map<string, LineBreakdownRow>();
    byLine.set(key, rows);
    const shedId = d.shedId ?? null;
    // Grouped on the engine's own composite key (d.batchId): it already keeps an ANIMAL_WISE/REGISTERED
    // batch's stage groups apart (buildInputBatches), so two stages of the same batch in the same shed
    // produce two breakdown rows here. What gets PERSISTED below is `d.realBatchId`/`d.groupStageId` — the
    // genuine PK and the group's identity stage, one-to-one with this key — never the key itself (D1, 3 Oct).
    // Not the day's own stage: a group projected into another group's stage would then share its
    // (batch, stage, shed) and the insert would fail on uq_requisition_line_batch (9b fix round 1).
    const rowKey = `${d.batchId}|${shedId ?? ''}`;
    const prior = rows.get(rowKey);
    if (prior) {
      prior.demandKg = round3(prior.demandKg + d.demandKg);
      continue;
    }
    rows.set(rowKey, {
      batchId: d.realBatchId, stageId: d.groupStageId || null, batchNo: d.batchNo, shedId, shedCode: d.shedCode, heads: d.heads, feedRateKg: d.feedRateKg,
      lifecycleRefId: d.lifecycleId || null, demandKg: round3(d.demandKg), firstDemandDate: d.date,
    });
  }
  const out = new Map<string, LineBreakdownRow[]>();
  for (const [key, rows] of byLine) {
    out.set(key, [...rows.values()].sort((a, b) => a.batchNo.localeCompare(b.batchNo) || a.shedCode.localeCompare(b.shedCode)));
  }
  return out;
}
