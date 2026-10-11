import { type ForecastResult, type ForecastSource } from './feed-forecast.engine';
import { DEFAULT_FEED_SETTINGS, roundOrderKg } from '../../procurement/feed-requisition/feed-requisition.rules';
import type { FarmFeedSettings } from '../../procurement/feed-requisition/feed-requisition.rules';

/**
 * Silo dashboard (TDD Engine §4 Dashboard rows 47–64, Master Setup §1): the
 * workbook's per-silo fields, derived from the engine's own sources and diet
 * changes. Nothing here recomputes demand — the engine already has it.
 */
export interface SiloFact {
  siloId: string;
  siloCode: string;
  /** location_name (Engine §1 row 9 Silo Name) — shown beside the code. */
  siloName: string;
  houseCodes: string[];
  capacityKg: number | null;
  belowFeedLevelKg: number | null;
  aboveThresholdKg: number | null;
  feedInSiloItemId: string | null;
  feedInSiloItemName: string | null;
  feedType: 'BULK' | 'BAGGED';
  systemBalanceKg: number;
  lastApprovedCountKg: number | null;
  lastApprovedCountAt: string | null;
  lastFeedReceiptDate: string | null;
  /** The silo's feed also has balance rows in a unit other than KG; System Balance counts the KG rows only. */
  nonKgBalance: boolean;
  /** W2D: the linked House Shed(s) with their ids, so a screen can link them (Engine §1 row 10, Dashboard row 48). */
  houses?: Array<{ id: string; code: string; name: string }>;
}

export interface SiloStatusRow extends SiloFact {
  currentDietItemId: string | null;
  /** W2D A5 (Dashboard row 50): Item No. of the current diet, for the item link. Null when unknown — never the id. */
  currentDietItemCode: string | null;
  /** Item No. of Feed in Silo — the dashboard's current-diet fallback when nothing eats today. */
  feedInSiloItemCode: string | null;
  dailyRequirementKg: number;
  daysRemaining: number | null;
  firstShortageDate: string | null;
  projectedNeedKg: number;
  nextDietItemId: string | null;
  /** W2D A5 (Dashboard row 58). */
  nextDietItemCode: string | null;
  nextDietItemName: string | null;
  nextDietDate: string | null;
  /** Feed form (BULK/BAGGED) of the next diet item from its Breed Lifecycle row (Master Setup row 37); null when not configured. */
  nextDietFeedType: 'BULK' | 'BAGGED' | null;
  /**
   * Dashboard row 59 / checkpoint 9: an ACTIVE silo at the changing house whose Feed Type matches the next
   * diet's feed form. Without a configured feed form, the silo the engine will draw the next diet from.
   */
  siloAvailableForNextDiet: boolean | null;
  nextDietSiloId: string | null;
  nextDietSiloCode: string | null;
  projectedShortfallKg: number;
  recommendedOrderKg: number;
  requisitionId: string | null;
  requisitionStatus: string | null;
  submissionDeadline: string | null;
  /** At/below Below Feed Level; at/above Above Threshold (Dashboard row 53). */
  alert: 'CRITICAL_FIRST_PRIORITY' | 'INFO' | null;
}

export interface NextBinAssignment {
  binId: string;
  binCode: string;
  productionDate: string;
}

export interface SiloBalancePoint {
  date: string;
  itemId: string;
  itemName: string;
  openingKg: number;
  confirmedReceiptKg: number;
  demandKg: number;
  closingKg: number;
}

export interface SiloDemandPoint {
  date: string;
  currentDietKg: number;
  nextDietKg: number;
}

const sum3 = (values: number[]) => round3(values.reduce((sum, value) => sum + value, 0));

/** Shape one selected Silo from the already-computed Farm result. */
export function buildSelectedSiloDashboard(args: {
  status: SiloStatusRow;
  result: Pick<ForecastResult, 'sources' | 'daily'>;
  planningDate: string;
  nextBinAssignment: NextBinAssignment | null;
}): {
  silo: SiloStatusRow & {
    currentDietItemName: string | null;
    currentProjectedNeedKg: number;
    nextProjectedNeedKg: number;
    currentDietDaysRemaining: number | null;
    nextDietItemName: string | null;
    millLoadingBin: NextBinAssignment | null;
  };
  balanceSeries: SiloBalancePoint[];
  demandSeries: SiloDemandPoint[];
} {
  const { status, result, nextBinAssignment } = args;
  const sources = result.sources.filter((source) => source.sourceType === 'SILO' && source.locationId === status.siloId);
  const currentSources = sources.filter((source) => source.itemId === status.currentDietItemId);
  const nextSources = sources.filter((source) => source.itemId === status.nextDietItemId);
  const currentDietRemainingValues =
    currentSources
      .map(
        (source) =>
          source.currentDietDaysRemaining,
      )
      .filter(
        (value): value is number =>
          value !== null && Number.isFinite(value),
      );

  const currentDietDaysRemaining =
    currentDietRemainingValues.length > 0
      ? Math.min(
        ...currentDietRemainingValues,
      )
      : null;
  const currentDietItemName = currentSources[0]?.itemName
    ?? sources.find((source) => source.itemId === status.feedInSiloItemId)?.itemName
    ?? status.feedInSiloItemName;
  const nextDietItemName = nextSources[0]?.itemName ?? status.nextDietItemName ?? null;

  const byItemDate = new Map<string, SiloBalancePoint>();
  for (const row of result.daily) {
    if (row.sourceType !== 'SILO' || row.destinationLocationId !== status.siloId) continue;
    const key = `${row.itemId}|${row.date}`;
    const existing = byItemDate.get(key);
    if (existing) {
      existing.demandKg = round3(existing.demandKg + row.demandKg);
      continue;
    }
    byItemDate.set(key, {
      date: row.date,
      itemId: row.itemId,
      itemName: row.itemName,
      openingKg: row.currentInventoryKg,
      confirmedReceiptKg: row.confirmedReceiptKg ?? 0,
      demandKg: row.demandKg,
      closingKg: row.projectedClosingKg ?? Math.max(0, round3(row.currentInventoryKg - row.demandKg)),
    });
  }
  const balanceSeries = [...byItemDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.itemName.localeCompare(b.itemName) || a.itemId.localeCompare(b.itemId));
  const demandByDate = new Map<string, SiloDemandPoint>();
  for (const point of balanceSeries) {
    const demand = demandByDate.get(point.date) ?? { date: point.date, currentDietKg: 0, nextDietKg: 0 };
    if (point.itemId === status.currentDietItemId) demand.currentDietKg = round3(demand.currentDietKg + point.demandKg);
    if (point.itemId === status.nextDietItemId) demand.nextDietKg = round3(demand.nextDietKg + point.demandKg);
    demandByDate.set(point.date, demand);
  }

  return {
    silo: {
      ...status,
      currentDietItemName,
      currentProjectedNeedKg: sum3(currentSources.map((source) => source.walkDemandKg + source.safetyStockKg)),
      nextProjectedNeedKg: sum3(nextSources.map((source) => source.walkDemandKg + source.safetyStockKg)),
      currentDietDaysRemaining: currentDietDaysRemaining,
      nextDietItemName,
      millLoadingBin: nextBinAssignment,
    },
    balanceSeries,
    demandSeries: [...demandByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildSiloStatus(args: {
  silos: SiloFact[];
  result: Pick<ForecastResult, 'sources' | 'dietChanges'>;
  requisitionStatusBySilo: Map<string, string | { requisitionId: string; status: string }>;
  submissionDeadline: string | null;
  settings?: FarmFeedSettings;
  /** Item id -> Item No. (the engine input's itemCodes). */
  itemCodes?: Record<string, string>;
  /** Item id -> feed form of its Breed Lifecycle feed row (BULK/BAGGED). */
  itemFeedTypes?: Record<string, 'BULK' | 'BAGGED'>;
}): SiloStatusRow[] {
  const { silos, result, requisitionStatusBySilo, submissionDeadline } = args;
  const itemCodes = args.itemCodes ?? {};
  const itemFeedTypes = args.itemFeedTypes ?? {};
  const codeOf = (itemId: string | null | undefined) => (itemId && itemCodes[itemId]) || null;
  const settings = args.settings ?? DEFAULT_FEED_SETTINGS;
  return silos.map((silo) => {
    const sources: ForecastSource[] = result.sources.filter((s) => s.sourceType === 'SILO' && s.locationId === silo.siloId);
    const current = sources.find((s) => s.planningDayDemandKg > 0) ?? null;
    const primary = current ?? sources.find((s) => s.itemId === silo.feedInSiloItemId) ?? sources[0] ?? null;

    // One source per silo and item: need and shortfall add across them, each order rounded on its own.
    const projectedNeedKg = round3(sources.reduce((sum, s) => sum + s.walkDemandKg + s.safetyStockKg, 0));
    const projectedShortfallKg = round3(sources.reduce((sum, s) => sum + Math.max(0, s.shortfallKg), 0));
    const recommendedOrderKg = sources.reduce((sum, s) => sum + roundOrderKg(Math.max(0, round3(s.shortfallKg)), silo.feedType, settings), 0);
    // I2: the quantities above add across every source feeding this silo (current diet
    // AND next diet), so the date fields must look across all of them too — otherwise a
    // silo with a shortfall entirely on its next-diet source shows a positive Projected
    // Shortfall/Recommended Order beside a blank First Shortage Date and a comfortable
    // Days Remaining (both read from `primary` alone). dailyRequirementKg stays on
    // `primary`: "daily consumption for this silo" is the current diet's by definition.
    const shortageDates = sources.map((s) => s.shortageDate ?? null).filter((d): d is string => d !== null).sort();
    const daysLeftValues = sources.map((s) => s.daysLeft).filter((d): d is number => d !== null);

    // The change this silo is party to: its item is being left, or it is the silo the new diet will draw from.
    const itemIds = new Set([...sources.map((s) => s.itemId), ...(silo.feedInSiloItemId ? [silo.feedInSiloItemId] : [])]);
    const change = result.dietChanges
      .filter((c) => (itemIds.has(c.fromItemId) && silo.houseCodes.includes(c.shedCode)) || c.nextSourceCode === silo.siloCode)
      .sort((a, b) => a.changeDate.localeCompare(b.changeDate))[0] ?? null;

    const balance = silo.systemBalanceKg;
    const alert: SiloStatusRow['alert'] =
      silo.belowFeedLevelKg !== null && silo.belowFeedLevelKg > 0 && balance <= silo.belowFeedLevelKg ? 'CRITICAL_FIRST_PRIORITY'
        : silo.aboveThresholdKg !== null && silo.aboveThresholdKg > 0 && balance >= silo.aboveThresholdKg ? 'INFO'
          : null;

    // Checkpoint 9: the next diet's silo is found by Feed Type at the changing house (every silo here is ACTIVE —
    // the caller plans ACTIVE silos only), preferring the one the engine draws from.
    const nextDietFeedType = change ? itemFeedTypes[change.toItemId] ?? null : null;
    let nextDietSilo: SiloFact | null = null;
    if (change && nextDietFeedType) {
      const candidates = silos.filter((s) => s.houseCodes.includes(change.shedCode) && s.feedType === nextDietFeedType);
      nextDietSilo = candidates.find((s) => s.siloCode === change.nextSourceCode) ?? candidates[0] ?? null;
    } else if (change && change.nextSourceType === 'SILO') {
      nextDietSilo = silos.find((s) => s.siloCode === change.nextSourceCode) ?? null;
    }
    const siloAvailableForNextDiet = !change ? null
      : nextDietFeedType ? nextDietSilo !== null
        : change.nextSourceType === 'SILO';

    const requisition = requisitionStatusBySilo.get(silo.siloId) ?? null;
    return {
      ...silo,
      currentDietItemId: current?.itemId ?? null,
      currentDietItemCode: codeOf(current?.itemId),
      feedInSiloItemCode: codeOf(silo.feedInSiloItemId),
      dailyRequirementKg: primary ? (primary.planningDayDemandKg > 0 ? primary.planningDayDemandKg : primary.firstDayDemandKg) : 0,
      daysRemaining: daysLeftValues.length ? Math.min(...daysLeftValues) : null,
      firstShortageDate: shortageDates[0] ?? null,
      projectedNeedKg,
      nextDietItemId: change?.toItemId ?? null,
      nextDietItemCode: codeOf(change?.toItemId),
      nextDietItemName: change?.toItemName ?? null,
      nextDietDate: change?.changeDate ?? null,
      nextDietFeedType,
      siloAvailableForNextDiet,
      nextDietSiloId: nextDietSilo?.siloId ?? null,
      nextDietSiloCode: nextDietSilo?.siloCode ?? (change?.nextSourceType === 'SILO' && !nextDietFeedType ? change.nextSourceCode : null),
      projectedShortfallKg,
      recommendedOrderKg,
      requisitionId: typeof requisition === 'string' ? null : requisition?.requisitionId ?? null,
      requisitionStatus: typeof requisition === 'string' ? requisition : requisition?.status ?? null,
      submissionDeadline,
      alert,
    };
  });
}
