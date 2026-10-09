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
}

export interface SiloStatusRow extends SiloFact {
  currentDietItemId: string | null;
  dailyRequirementKg: number;
  daysRemaining: number | null;
  firstShortageDate: string | null;
  projectedNeedKg: number;
  nextDietItemId: string | null;
  nextDietDate: string | null;
  siloAvailableForNextDiet: boolean | null;
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
  slotId: string;
  slotCode: string;
  slotName: string;
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
  const nextDietItemName = nextSources[0]?.itemName ?? null;

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
}): SiloStatusRow[] {
  const { silos, result, requisitionStatusBySilo, submissionDeadline } = args;
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

    const requisition = requisitionStatusBySilo.get(silo.siloId) ?? null;
    return {
      ...silo,
      currentDietItemId: current?.itemId ?? null,
      dailyRequirementKg: primary ? (primary.planningDayDemandKg > 0 ? primary.planningDayDemandKg : primary.firstDayDemandKg) : 0,
      daysRemaining: daysLeftValues.length ? Math.min(...daysLeftValues) : null,
      firstShortageDate: shortageDates[0] ?? null,
      projectedNeedKg,
      nextDietItemId: change?.toItemId ?? null,
      nextDietDate: change?.changeDate ?? null,
      siloAvailableForNextDiet: change ? change.nextSourceType === 'SILO' : null,
      projectedShortfallKg,
      recommendedOrderKg,
      requisitionId: typeof requisition === 'string' ? null : requisition?.requisitionId ?? null,
      requisitionStatus: typeof requisition === 'string' ? requisition : requisition?.status ?? null,
      submissionDeadline,
      alert,
    };
  });
}
