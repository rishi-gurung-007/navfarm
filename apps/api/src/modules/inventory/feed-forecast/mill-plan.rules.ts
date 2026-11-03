/**
 * Mill Planning (spec 2026-11-03) — pure rule. Folds one week of every
 * selected farm's forecast, the approved requisitions the mill has not yet
 * produced and the mill's capacity into the page the mill manager plans
 * production from. No I/O: MillPlanService gathers the inputs.
 *
 * What the mill must make on a day (Rishi, 3 Nov) = approved requisitions not
 * yet produced + the forecast's net need still to come. The net need is the
 * engine's recommended quantity per source, which already subtracts stock and
 * feed requisitioned, transferred or planned incoming, so nothing is counted
 * twice. The mill produces daily: net need sits on its delivery date.
 */
import type { DailyForecastRow, DietChange, SourceBalancePoint } from './feed-forecast.engine';
import type { DietCapacity, MillCapacitySetup, MillDemandLine } from './mill-capacity.rules';

const roundKg = (value: number) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;

export interface MillPlanFarmInput {
  farm: { id: string; code: string; name: string };
  /** The week's dates only. */
  daily: DailyForecastRow[];
  sourceBalances: Array<SourceBalancePoint & { sourceName: string | null; feedType: 'BULK' | 'BAGGED' }>;
  dietChanges: DietChange[];
}

export interface MillPlanInput {
  /** Exactly 7, ascending. */
  dates: string[];
  farms: MillPlanFarmInput[];
  failedFarms: Array<{ farmId: string; code: string; name: string; error: string }>;
  /** Feed Types filter; null = all. */
  itemIds: string[] | null;
  items: Map<string, { itemCode: string; itemName: string; feedForm: 'BULK' | 'BAGGED' | null }>;
  /** The farms in the plan; `approved` may cover more (the whole mill company). */
  planFarmIds: string[];
  /** approvedDemand(...).lines for every farm of the mill's company. */
  approved: MillDemandLine[];
  producedKg: Array<{ productionDate: string; itemId: string; quantityKg: number }>;
  mill: (MillCapacitySetup & { millName: string }) | null;
  /** allocateOnDates result for the production totals. */
  capacityByDate: Map<string, Map<string, DietCapacity>>;
  /** silo location_id -> silo_capacity_kg (null when unset). */
  siloCapacityKg: Map<string, number | null>;
  /** capacityWarningPct, 0–100. */
  warningPct: number;
}

/** A silo of a selected farm: its stock on the first day the forecast covers, against its capacity. */
export interface MillPlanSiloCard {
  farmId: string;
  farmCode: string;
  farmName: string;
  sourceCode: string;
  sourceName: string | null;
  items: string[];
  stockKg: number;
  capacityKg: number | null;
  fillPct: number | null;
  runOutDate: string | null;
}

export type DayStatus = 'OK' | 'WARN' | 'OVER' | 'NO_CAPACITY';

export interface MillPlanShed {
  key: string;
  shedCode: string;
  batchNo: string;
  heads: number;
  items: Array<{ itemId: string; itemName: string }>;
  changeDate: string | null;
  kg: number[];
}

export interface MillPlanSilo {
  sourceCode: string;
  sourceName: string | null;
  sourceType: 'SILO' | 'STORE';
  itemId: string;
  itemName: string;
  /** Opening balance on the first day the forecast covers. */
  openingKg: number;
  /** null on a day the forecast does not cover (before the planning date). */
  closingKg: Array<number | null>;
  runOutDate: string | null;
}

export interface MillPlan {
  dates: string[];
  mill: { millId: string; millCode: string; millName: string; dailyKg: number | null } | null;
  capacity: Array<{ date: string; productionKg: number; capacityKg: number | null; usedPct: number | null; status: DayStatus }>;
  cards: { totalKg: number; farms: number; sheds: number; silos: number; feedTypes: number; dietChanges: number; daysNearOrOver: number; silosRunningOut: number };
  production: Array<{
    itemId: string; itemCode: string; itemName: string; feedForm: 'BULK' | 'BAGGED' | null;
    days: Array<{ date: string; approvedKg: number; forecastKg: number; totalKg: number; capacity: DietCapacity | null }>;
    totalKg: number;
  }>;
  dietChanges: Array<{ farmId: string; farmName: string; shedCode: string; batchNo: string; changeDate: string; fromItemName: string; toItemName: string; heads: number }>;
  farms: Array<{ farmId: string; code: string; name: string; totals: number[]; sheds: MillPlanShed[]; silos: MillPlanSilo[] }>;
  siloCards: MillPlanSiloCard[];
  failedFarms: MillPlanInput['failedFarms'];
}

export function buildMillPlan(input: MillPlanInput): MillPlan {
  const { dates } = input;
  const dateIndex = new Map(dates.map((date, i) => [date, i]));
  const selected = (itemId: string) => !input.itemIds || input.itemIds.includes(itemId);
  const first = dates[0];
  const last = dates[dates.length - 1];

  // Production per item and date: approved-not-produced and forecast net need.
  const approved = new Map<string, number[]>();
  const forecast = new Map<string, number[]>();
  const names = new Map<string, string>();
  const add = (map: Map<string, number[]>, itemId: string, i: number, kg: number) => {
    const days = map.get(itemId) ?? dates.map(() => 0);
    days[i] = roundKg(days[i] + kg);
    map.set(itemId, days);
  };

  // Mill output is not tied to a farm's order: what the mill made of a feed on a day is credited to every
  // farm's approved order of that feed and day, and the plan's farms keep their share of what is still unmade.
  const inPlan = new Set(input.planFarmIds);
  const companyApproved = new Map<string, number>();
  const planApproved = new Map<string, number>();
  for (const line of input.approved) {
    if (!dateIndex.has(line.productionDate) || !selected(line.itemId)) continue;
    const key = `${line.productionDate}|${line.itemId}`;
    const kg = line.millApprovedKg ?? line.requestedKg;
    companyApproved.set(key, (companyApproved.get(key) ?? 0) + kg);
    if (inPlan.has(line.farmId)) planApproved.set(key, (planApproved.get(key) ?? 0) + kg);
  }
  const producedByKey = new Map<string, number>();
  for (const out of input.producedKg) {
    const key = `${out.productionDate}|${out.itemId}`;
    producedByKey.set(key, (producedByKey.get(key) ?? 0) + out.quantityKg);
  }
  for (const [key, kg] of planApproved) {
    const [date, itemId] = key.split('|');
    const total = companyApproved.get(key) ?? kg;
    const unmade = Math.max(0, total - (producedByKey.get(key) ?? 0));
    add(approved, itemId, dateIndex.get(date)!, total > 0 ? (kg * unmade) / total : 0);
  }

  const farms: MillPlan['farms'] = [];
  const siloCards: MillPlanSiloCard[] = [];
  const dietChanges: MillPlan['dietChanges'] = [];
  for (const f of input.farms) {
    // Net need: once per source and item, on its delivery date (an overdue one on the first day).
    const counted = new Set<string>();
    for (const point of f.sourceBalances) {
      const key = `${point.sourceCode}|${point.itemId}`;
      if (counted.has(key) || !selected(point.itemId)) continue;
      if (!point.deliveryDate || !(point.recommendedQtyKg > 0) || point.deliveryDate > last) continue;
      counted.add(key);
      names.set(point.itemId, point.itemName);
      add(forecast, point.itemId, dateIndex.get(point.deliveryDate < first ? first : point.deliveryDate) ?? 0, point.recommendedQtyKg);
    }

    const sheds = new Map<string, MillPlanShed>();
    for (const r of f.daily) {
      const i = dateIndex.get(r.date);
      if (i === undefined || !selected(r.itemId)) continue;
      const key = `${r.shedCode}|${r.batchNo}`;
      const shed = sheds.get(key) ?? { key, shedCode: r.shedCode, batchNo: r.batchNo, heads: 0, items: [], changeDate: null, kg: dates.map(() => 0) };
      shed.kg[i] = roundKg(shed.kg[i] + r.demandKg);
      if (i === 0 || !shed.heads) shed.heads = Math.max(shed.heads, r.heads);
      if (!shed.items.some((it) => it.itemId === r.itemId)) shed.items.push({ itemId: r.itemId, itemName: r.itemName });
      names.set(r.itemId, r.itemName);
      sheds.set(key, shed);
    }

    for (const change of f.dietChanges) {
      if (!dateIndex.has(change.changeDate)) continue;
      if (!selected(change.fromItemId) && !selected(change.toItemId)) continue;
      const heads = f.daily.find((r) => r.batchId === change.batchId && r.date === change.changeDate)?.heads ?? 0;
      dietChanges.push({
        farmId: f.farm.id, farmName: f.farm.name, shedCode: change.shedCode, batchNo: change.batchNo, changeDate: change.changeDate,
        fromItemName: change.fromItemName, toItemName: change.toItemName, heads,
      });
      const shed = sheds.get(`${change.shedCode}|${change.batchNo}`);
      if (shed && !shed.changeDate) shed.changeDate = change.changeDate;
    }

    // One row per source and feed: a store (or a silo also holding the next diet) can carry several feeds.
    const silos = new Map<string, MillPlanSilo>();
    for (const point of f.sourceBalances) {
      const i = dateIndex.get(point.date);
      if (i === undefined || !selected(point.itemId)) continue;
      const siloKey = `${point.sourceCode}|${point.itemId}`;
      const silo = silos.get(siloKey) ?? {
        sourceCode: point.sourceCode, sourceName: point.sourceName, sourceType: point.sourceType, itemId: point.itemId, itemName: point.itemName,
        openingKg: 0, closingKg: dates.map((): number | null => null), runOutDate: null,
      };
      if (silo.closingKg.slice(0, i).every((kg) => kg === null)) silo.openingKg = point.openingSystemBalanceKg;
      silo.closingKg[i] = roundKg((silo.closingKg[i] ?? 0) + point.projectedClosingBalanceKg);
      silos.set(siloKey, silo);
    }
    for (const silo of silos.values()) {
      const at = silo.closingKg.findIndex((kg) => kg !== null && kg <= 0);
      silo.runOutDate = at < 0 ? null : dates[at];
    }

    // Cards: every silo whatever the Feed Types filter — a silo's fill is physical, not per feed. Its stock is the
    // sum of its feeds' openings on the first day the forecast covers (today, or Week of if later).
    const bySilo = new Map<string, typeof f.sourceBalances>();
    for (const point of f.sourceBalances) {
      if (point.sourceType !== 'SILO' || !dateIndex.has(point.date)) continue;
      bySilo.set(point.sourceCode, [...(bySilo.get(point.sourceCode) ?? []), point]);
    }
    for (const [sourceCode, points] of bySilo) {
      const covered = [...new Set(points.map((p) => p.date))].sort();
      const onDay = (date: string) => points.filter((p) => p.date === date);
      const stockKg = roundKg(onDay(covered[0]).reduce((sum, p) => sum + p.openingSystemBalanceKg, 0));
      const capacityKg = input.siloCapacityKg.get(points[0].locationId) ?? null;
      siloCards.push({
        farmId: f.farm.id, farmCode: f.farm.code, farmName: f.farm.name, sourceCode, sourceName: points[0].sourceName,
        items: [...new Set(points.map((p) => p.itemName))],
        stockKg, capacityKg,
        fillPct: capacityKg && capacityKg > 0 ? Math.round((stockKg / capacityKg) * 100) : null,
        runOutDate: covered.find((date) => onDay(date).reduce((sum, p) => sum + p.projectedClosingBalanceKg, 0) <= 0) ?? null,
      });
    }

    const shedList = [...sheds.values()].sort((a, b) => a.shedCode.localeCompare(b.shedCode) || a.batchNo.localeCompare(b.batchNo));
    const totals = dates.map((_, i) => roundKg(shedList.reduce((sum, s) => sum + s.kg[i], 0)));
    farms.push({ farmId: f.farm.id, code: f.farm.code, name: f.farm.name, totals, sheds: shedList, silos: [...silos.values()] });
  }

  const itemIds = [...new Set([...approved.keys(), ...forecast.keys()])];
  const production: MillPlan['production'] = itemIds.map((itemId) => {
    const meta = input.items.get(itemId);
    const days = dates.map((date, i) => {
      const approvedKg = approved.get(itemId)?.[i] ?? 0;
      const forecastKg = forecast.get(itemId)?.[i] ?? 0;
      return { date, approvedKg, forecastKg, totalKg: roundKg(approvedKg + forecastKg), capacity: input.capacityByDate.get(date)?.get(itemId) ?? null };
    });
    return {
      itemId, itemCode: meta?.itemCode ?? '', itemName: meta?.itemName ?? names.get(itemId) ?? itemId, feedForm: meta?.feedForm ?? null,
      days, totalKg: roundKg(days.reduce((sum, d) => sum + d.totalKg, 0)),
    };
  }).filter((p) => p.totalKg > 0).sort((a, b) => a.itemCode.localeCompare(b.itemCode) || a.itemName.localeCompare(b.itemName));

  const dailyKg = input.mill?.dailyKg ?? null;
  const capacity = dates.map((date, i) => {
    const productionKg = roundKg(production.reduce((sum, p) => sum + p.days[i].totalKg, 0));
    if (!dailyKg || dailyKg <= 0) return { date, productionKg, capacityKg: null, usedPct: null, status: 'NO_CAPACITY' as DayStatus };
    const usedPct = Math.round((productionKg / dailyKg) * 1000) / 10;
    // Compared unrounded: 89.99 % shows as 90.0 but is not yet a warning.
    const status: DayStatus = productionKg > dailyKg ? 'OVER' : productionKg * 100 >= dailyKg * input.warningPct ? 'WARN' : 'OK';
    return { date, productionKg, capacityKg: dailyKg, usedPct, status };
  });

  dietChanges.sort((a, b) => a.changeDate.localeCompare(b.changeDate) || a.farmName.localeCompare(b.farmName) || a.shedCode.localeCompare(b.shedCode));
  const allSilos = farms.flatMap((f) => f.silos);
  return {
    dates,
    mill: input.mill ? { millId: input.mill.millId, millCode: input.mill.millCode, millName: input.mill.millName, dailyKg } : null,
    capacity,
    cards: {
      totalKg: roundKg(farms.reduce((sum, f) => sum + f.totals.reduce((s, kg) => s + kg, 0), 0)),
      farms: farms.length,
      sheds: farms.reduce((sum, f) => sum + f.sheds.length, 0),
      silos: allSilos.length,
      feedTypes: new Set(farms.flatMap((f) => f.sheds.flatMap((s) => s.items.map((it) => it.itemId)))).size,
      dietChanges: dietChanges.length,
      daysNearOrOver: capacity.filter((d) => d.status === 'WARN' || d.status === 'OVER').length,
      silosRunningOut: allSilos.filter((s) => s.runOutDate).length,
    },
    production,
    dietChanges,
    farms,
    siloCards,
    failedFarms: input.failedFarms,
  };
}
