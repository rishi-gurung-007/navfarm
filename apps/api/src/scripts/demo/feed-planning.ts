/**
 * Pure helpers for the demo's feed story (Plan S, B1): kept out of the chapter
 * files so they can be tested without booting the app.
 */
import type { ForecastSource } from '../../modules/inventory/feed-forecast/feed-forecast.engine';

/**
 * How many days before the build an animal the demo moves into a stage
 * entered it. Five, as before, but never so early that a short stage has
 * already run out: a stage lasting N days is left on day N at the latest, so
 * a 2-day INSEMINATION is entered today and a 3-day FARROWING yesterday.
 * Review A6 found a fresh demo's INSEMINATION "Due, not posted".
 */
export function stageEntryDaysAgo(durationDays: number | null): number {
  if (durationDays == null || durationDays <= 0) return 5;
  return Math.max(0, Math.min(5, durationDays - 2));
}

export interface DemoLevelChange {
  siloId: string;
  siloCode: string;
  lowKg: number;
  why: 'RUNS_DOWN' | 'BELOW_NOW';
}

/**
 * S10: the two VIL100 silo levels that make the feed features visible in a
 * fresh demo. The busiest feeding silo gets a low level ten days of today's
 * use below its stock (a run-down inside the 45-day horizon, with refill and
 * required-on dates ahead of today); the next gets one just above its stock
 * (FEED_BELOW_L1 at once). A proposal that would reach the silo's high level,
 * or fall to zero, is dropped rather than bent.
 */
export function pickDemoLevels(
  sources: Array<Pick<ForecastSource, 'sourceType' | 'sourceCode' | 'locationId' | 'balanceKg' | 'planningDayDemandKg'>>,
  highOf: Map<string, number | null>,
): DemoLevelChange[] {
  const bySilo = new Map<string, (typeof sources)[number]>();
  for (const s of sources) {
    if (s.sourceType !== 'SILO' || !s.locationId || s.planningDayDemandKg <= 0 || s.balanceKg <= 0) continue;
    const seen = bySilo.get(s.locationId);
    if (!seen || s.planningDayDemandKg > seen.planningDayDemandKg) bySilo.set(s.locationId, s);
  }
  const [busiest, next] = [...bySilo.values()].sort((a, b) => b.planningDayDemandKg - a.planningDayDemandKg);
  const fits = (siloId: string, lowKg: number) => {
    const high = highOf.get(siloId);
    return lowKg > 0 && (high == null || lowKg < high);
  };
  const out: DemoLevelChange[] = [];
  if (busiest) {
    const lowKg = Math.floor(busiest.balanceKg - 10 * busiest.planningDayDemandKg);
    if (fits(busiest.locationId, lowKg)) out.push({ siloId: busiest.locationId, siloCode: busiest.sourceCode, lowKg, why: 'RUNS_DOWN' });
  }
  if (next) {
    const lowKg = Math.ceil(next.balanceKg + 1);
    if (fits(next.locationId, lowKg)) out.push({ siloId: next.locationId, siloCode: next.sourceCode, lowKg, why: 'BELOW_NOW' });
  }
  return out;
}

/**
 * D31 (Rishi, 28 Sep): the silos to link to the shed the farm's registered
 * breeding batch stands in. That batch opens at the gilt stage in a gilt
 * house, whose silo holds grower mash, and its animals move on into flush,
 * gestation, farrowing and lactation — so without these links the forecast
 * fed every sow diet from the farm store. A silo may feed several sheds (D7);
 * the first dry sow and first farrowing silo, in code order, join the gilt
 * house, each holding a feed the gilt house's own silo does not (D9). Only a
 * gilt house takes them: a dry sow, farrowing or boar house already holds
 * one of those feeds, and a second silo of the same feed in one shed is what
 * D9 forbids.
 */
export function breedingSiloLinks(
  farm: { sheds: Array<{ shedId: string; role: string | null; siloIds: string[] }> },
  batchShedId: string,
): string[] {
  const batchShed = farm.sheds.find((s) => s.shedId === batchShedId);
  if (!batchShed || (batchShed.role !== 'GILT' && batchShed.role !== 'GILT_REARING')) return [];
  const out: string[] = [];
  for (const role of ['DRY_SOW', 'FARROWING']) {
    const siloId = farm.sheds.find((s) => s.role === role && s.siloIds.length > 0)?.siloIds[0];
    if (siloId && !batchShed.siloIds.includes(siloId) && !out.includes(siloId)) out.push(siloId);
  }
  return out;
}
