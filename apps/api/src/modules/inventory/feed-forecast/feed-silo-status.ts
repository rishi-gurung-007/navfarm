import type { ForecastResult, ForecastSource } from './feed-forecast.engine';
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
  requisitionStatus: string | null;
  submissionDeadline: string | null;
  /** At/below Below Feed Level; at/above Above Threshold (Dashboard row 53). */
  alert: 'CRITICAL_FIRST_PRIORITY' | 'INFO' | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildSiloStatus(args: {
  silos: SiloFact[];
  result: Pick<ForecastResult, 'sources' | 'dietChanges'>;
  requisitionStatusBySilo: Map<string, string>;
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

    return {
      ...silo,
      currentDietItemId: current?.itemId ?? null,
      dailyRequirementKg: primary ? (primary.planningDayDemandKg > 0 ? primary.planningDayDemandKg : primary.firstDayDemandKg) : 0,
      daysRemaining: primary?.daysLeft ?? null,
      firstShortageDate: primary?.shortageDate ?? null,
      projectedNeedKg,
      nextDietItemId: change?.toItemId ?? null,
      nextDietDate: change?.changeDate ?? null,
      siloAvailableForNextDiet: change ? change.nextSourceType === 'SILO' : null,
      projectedShortfallKg,
      recommendedOrderKg,
      requisitionStatus: requisitionStatusBySilo.get(silo.siloId) ?? null,
      submissionDeadline,
      alert,
    };
  });
}
