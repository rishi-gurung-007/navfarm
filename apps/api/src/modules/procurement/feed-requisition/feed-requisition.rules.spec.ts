import { resolveItemFeedForm } from '../../../common/feed-form';
import { buildFeedForecast, type ForecastInput, type ForecastSource } from '../../inventory/feed-forecast/feed-forecast.engine';
import {
  DEFAULT_FEED_SETTINGS, DestinationInfo, approvalProblems, bagCountFor, buildLineBreakdown, deliveryDateNeedsRemarks, lineChangeProblems, deviationNeedsRemarks, feedTypeOf, planDraftUpsert,
  productionCycle, recommendLines, requiredItemForManualLine, requisitionPriority, roundOrderKg, runKeyFor, serverToday,
  feedListStatusFilter, isOffBulkMultiple, projectedSiloStockKg, quantityProblems, keepHigherPriority, priorityChangeProblem, priorityEscalations,
} from './feed-requisition.rules';

const S = DEFAULT_FEED_SETTINGS;

// The engine Worked Example fixture (feed-forecast.engine.sources.spec.ts), with the Master Setup 1,000 KG
// Below Feed Level on both silos (3 Oct rulings 2/3) and no leadTimeDays — Task 3 removed the field.
const workedExampleWithLevels: ForecastInput = {
  planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29',
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500, lowLevelKg: 1000 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000, lowLevelKg: 1000 },
  ],
  store: null,
  items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  batches: [{
    batchId: 'b', realBatchId: 'b' as any, batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
    segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-08-30', end: null, projected: false }],
  }],
  feedRows: [
    { lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 27, kgPerHeadPerDay: 2.0, wastagePct: 0 },
    { lifecycleId: 'row-r2', breedId: 'l', stageId: 'wean', itemId: 'r2', itemName: 'Weaner Diet R2', fromDay: 28, toDay: 31, kgPerHeadPerDay: 2.5, wastagePct: 0 },
  ],
};

// Task 2's sources for the Worked Example (23–29 Sep, SILO1 R1 1,500 kg, SILO2 R2 1,000 kg).
const r1: ForecastSource = {
  sourceType: 'SILO', sourceCode: 'GRS/SILO-001', locationId: 's1', itemId: 'r1', itemName: 'Weaner Diet R1',
  balanceKg: 1500, planningDayDemandKg: 2000, currentDietDaysRemaining: 3, firstDemandDate: '2026-09-23', firstDayDemandKg: 2000, walkDemandKg: 6000,
  daysLeft: 0, runDownDate: '2026-09-23', shortageDate: '2026-09-23', isNextDiet: false, noSiloHoldsItem: false, lifecycleIds: ['row-r1'],
  thresholdKg: 0, incomingKg: 0, shortfallKg: 4500, safetyStockKg: 0, deliveryDayOpeningKg: 1500,
};
const r2: ForecastSource = {
  sourceType: 'SILO', sourceCode: 'GRS/SILO-002', locationId: 's2', itemId: 'r2', itemName: 'Weaner Diet R2',
  balanceKg: 1000, planningDayDemandKg: 0, currentDietDaysRemaining: null, firstDemandDate: '2026-09-26', firstDayDemandKg: 2500, walkDemandKg: 10000,
  daysLeft: null, runDownDate: '2026-09-26', shortageDate: '2026-09-26', isNextDiet: true, noSiloHoldsItem: false, lifecycleIds: ['row-r2'],
  thresholdKg: 0, incomingKg: 0, shortfallKg: 9000, safetyStockKg: 0, deliveryDayOpeningKg: 1000,
};
const silo = (id: string, extra: Partial<DestinationInfo> = {}): [string, DestinationInfo] =>
  [id, { locationId: id, locationType: 'SILO', feedInBags: null, lowLevelKg: null, capacityKg: null, ...extra }];

describe('roundOrderKg and bagCountFor', () => {
  it('rounds bulk up to 3,000 kg multiples — Worked Example H8/H9', () => {
    expect(roundOrderKg(4500, 'BULK', S)).toBe(6000);
    expect(roundOrderKg(9000, 'BULK', S)).toBe(9000);
    expect(roundOrderKg(0, 'BULK', S)).toBe(0);
  });
  it('rounds bagged up to whole 50 kg bags and counts them', () => {
    expect(roundOrderKg(1234, 'BAGGED', S)).toBe(1250);
    expect(bagCountFor(1250, 'BAGGED', S)).toBe(25);
    expect(bagCountFor(6000, 'BULK', S)).toBeNull();
  });
  it('does not round a whole multiple up by float noise', () => {
    expect(roundOrderKg(0.1 * 3 * 10000, 'BULK', S)).toBe(3000);
  });
});

describe('feedTypeOf (Q10)', () => {
  it('reads feed_in_bags, and falls back to BULK for a silo and BAGGED for a store', () => {
    expect(feedTypeOf({ locationType: 'SILO', feedInBags: true })).toBe('BAGGED');
    expect(feedTypeOf({ locationType: 'STORE', feedInBags: false })).toBe('BULK');
    expect(feedTypeOf({ locationType: 'SILO', feedInBags: null })).toBe('BULK');
    expect(feedTypeOf({ locationType: 'STORE', feedInBags: null })).toBe('BAGGED');
  });
});

describe('deviationNeedsRemarks — checkpoint 18', () => {
  it('requires remarks above 20 %: 6,000 → 9,000 kg', () => expect(deviationNeedsRemarks(6000, 9000)).toBe(true));
  it('does not at exactly 20 %', () => {
    expect(deviationNeedsRemarks(6000, 7200)).toBe(false);
    expect(deviationNeedsRemarks(6000, 4800)).toBe(false);
  });
  it('never for a manual line with no recommendation', () => expect(deviationNeedsRemarks(null, 50000)).toBe(false));
  it('always when the recommendation was 0 kg and something is requested', () => {
    expect(deviationNeedsRemarks(0, 3000)).toBe(true);
    expect(deviationNeedsRemarks(0, 0)).toBe(false);
  });
});

describe('productionCycle — Saturday deadline for Sunday production (checkpoint 22, Q4)', () => {
  it('Wednesday 23 Sep 2026 → produce Sunday 27, submit by Saturday 26', () => {
    expect(productionCycle('2026-09-23', 0)).toEqual({ productionDate: '2026-09-27', submissionDeadline: '2026-09-26' });
  });
  it('on the Saturday itself the deadline is today', () => {
    expect(productionCycle('2026-09-26', 0)).toEqual({ productionDate: '2026-09-27', submissionDeadline: '2026-09-26' });
  });
  it('on the Sunday the next cycle is a week away', () => {
    expect(productionCycle('2026-09-27', 0)).toEqual({ productionDate: '2026-10-04', submissionDeadline: '2026-10-03' });
  });
  it('honours another production weekday (Wednesday = 3)', () => {
    expect(productionCycle('2026-09-23', 3)).toEqual({ productionDate: '2026-09-30', submissionDeadline: '2026-09-29' });
  });
});

describe('recommendLines — Worked Example', () => {
  const lines = recommendLines({
    planningDate: '2026-09-23', to: '2026-09-29', sources: [r1, r2],
    destinations: new Map([silo('s1'), silo('s2')]), settings: S,
  });

  it('drafts R1 6,000 kg to SILO1 and R2 9,000 kg to SILO2 as the next diet', () => {
    expect(lines).toEqual([
      expect.objectContaining({
        key: 's1|r1', destinationLocationId: 's1', itemId: 'r1', feedType: 'BULK', isNextDiet: false, daysBeforeDietChange: null,
        lifecycleRefId: 'row-r1', systemBalanceKg: 1500, dailyRequirementKg: 2000, daysRemaining: 0,
        firstShortageDate: '2026-09-23', unroundedNeedKg: 4500, recommendedQtyKg: 6000, bagCount: null,
        proposedDeliveryDate: '2026-09-23', belowLowLevel: false, needsSiloChangeover: false,
      }),
      expect.objectContaining({
        key: 's2|r2', destinationLocationId: 's2', itemId: 'r2', isNextDiet: true, daysBeforeDietChange: 3,
        dailyRequirementKg: 2500, daysRemaining: null, unroundedNeedKg: 9000, recommendedQtyKg: 9000,
        // Req. row 29: delivered on the first shortage date, 26 Sep.
        recommendedDeliveryDate: '2026-09-26', proposedDeliveryDate: '2026-09-26',
      }),
    ]);
  });

  it('drafts nothing for a source whose stock covers the window', () => {
    const covered = { ...r1, balanceKg: 6000, shortfallKg: 0, runDownDate: null };
    expect(recommendLines({ planningDate: '2026-09-23', to: '2026-09-29', sources: [covered], destinations: new Map([silo('s1')]), settings: S })).toEqual([]);
  });

  it('can retain a zero-shortage source as read-only evidence for a manual line', () => {
    const covered = { ...r1, balanceKg: 6000, shortfallKg: 0, runDownDate: null };
    expect(recommendLines({
      planningDate: '2026-09-23', to: '2026-09-29', sources: [covered],
      destinations: new Map([silo('s1')]), settings: S, includeZeroNeed: true,
    })).toEqual([expect.objectContaining({
      key: 's1|r1', systemBalanceKg: 6000, dailyRequirementKg: 2000,
      unroundedNeedKg: 0, recommendedQtyKg: 0, bagCount: null,
    })]);
  });

  it('marks a silo at or below its low level (priority input) and a store fallback as needing a changeover', () => {
    const [line] = recommendLines({ planningDate: '2026-09-23', to: '2026-09-29', sources: [r1], destinations: new Map([silo('s1', { lowLevelKg: 1500 })]), settings: S });
    expect(line.belowLowLevel).toBe(true);
    const [store] = recommendLines({
      planningDate: '2026-09-23', to: '2026-09-29',
      sources: [{ ...r2, sourceType: 'STORE', sourceCode: 'GRS/STORE-001', locationId: 'st', noSiloHoldsItem: true }],
      destinations: new Map([['st', { locationId: 'st', locationType: 'STORE', feedInBags: null, lowLevelKg: null, capacityKg: null }]]), settings: S,
    });
    expect(store).toMatchObject({ feedType: 'BAGGED', needsSiloChangeover: true, recommendedQtyKg: 9000, bagCount: 180 });
  });
});

describe('recommendLines — Plan R (D19, Q3, Q4)', () => {
  const draft = (source: ForecastSource) =>
    recommendLines({ planningDate: '2026-09-23', to: '2026-09-29', sources: [source], destinations: new Map([silo('s1')]), settings: S });

  it('drafts the engine\'s shortfall (low level and incoming counted), not requirement − opening', () => {
    const [line] = draft({ ...r1, shortfallKg: 7000 });
    expect(line).toMatchObject({ unroundedNeedKg: 7000, recommendedQtyKg: 9000 });
  });

  it('dates the line on the first projected shortage (Req. row 29), or the planning date once that has passed', () => {
    const [withShortage] = draft({ ...r1, shortageDate: '2026-09-25' });
    expect(withShortage).toMatchObject({ recommendedDeliveryDate: '2026-09-25', proposedDeliveryDate: '2026-09-25' });
    const [pastShortage] = draft({ ...r1, shortageDate: '2026-09-20' });
    expect(pastShortage).toMatchObject({ recommendedDeliveryDate: '2026-09-23', proposedDeliveryDate: '2026-09-23' }); // already past → planning date
  });

  // 9d D1: the draft's forecast now looks for the shortage over the standard horizon (planning + 45), as
  // Save Run does, so a shortage can be found past `to`. The order window stays `to`: such a line is dated
  // `to`, as it was when the search stopped at `to` — and its First Shortage Date is the real one.
  it('dates the line `to` when the first shortage falls past the window (9d D1)', () => {
    const [line] = draft({ ...r1, shortfallKg: 500, shortageDate: '2026-10-05' });
    expect(line).toMatchObject({ recommendedDeliveryDate: '2026-09-29', proposedDeliveryDate: '2026-09-29', firstShortageDate: '2026-10-05' });
  });

  it('dates the line `to` when nothing in the window is short', () => {
    const [line] = draft({ ...r1, shortageDate: null });
    expect(line).toMatchObject({ recommendedDeliveryDate: '2026-09-29', proposedDeliveryDate: '2026-09-29' });
  });

  // Engine Step 8 supersedes the old "lands exactly on its level still orders one compartment" minimum: with no
  // shortfall there is nothing to order, whatever the run-down date says (Task 5 drops the runsDownInWindow branch).
  it('nothing short in the window drafts nothing, even with a run-down date set', () => {
    expect(draft({ ...r1, shortfallKg: 0, runDownDate: '2026-10-05' })).toEqual([]);
  });

  // Ruling I4: System Balance and the low-level test read the ledger as it stands now — FEED_BELOW_L1's figure —
  // not the forecast's start-of-day opening, which leaves out feed already posted today.
  it('snapshots the current ledger balance and tests the low level against it, not the start-of-day opening', () => {
    const lines = recommendLines({
      planningDate: '2026-09-23', to: '2026-09-29', sources: [{ ...r1, balanceKg: 1516 }],
      destinations: new Map([silo('s1', { lowLevelKg: 1500 })]), settings: S,
      currentBalanceKg: new Map([['s1|r1', 1500]]),
    });
    expect(lines[0]).toMatchObject({ systemBalanceKg: 1500, belowLowLevel: true, unroundedNeedKg: 4500, recommendedQtyKg: 6000 });
  });

  it('a silo with nothing of the item on the ledger now snapshots 0 kg', () => {
    const [line] = recommendLines({
      planningDate: '2026-09-23', to: '2026-09-29', sources: [r1], destinations: new Map([silo('s1', { lowLevelKg: 500 })]), settings: S,
      currentBalanceKg: new Map(),
    });
    expect(line).toMatchObject({ systemBalanceKg: 0, belowLowLevel: true });
  });
});

describe('recommendLines — workbook delivery date and capacity (Req. row 29, Engine Step 8)', () => {
  const base = { planningDate: '2026-09-23', to: '2026-09-29', settings: { ...DEFAULT_FEED_SETTINGS } };
  const dest = (capacityKg: number | null) => new Map([
    ['s1', { locationId: 's1', locationType: 'SILO' as const, feedInBags: false, lowLevelKg: 1000, capacityKg }],
    ['s2', { locationId: 's2', locationType: 'SILO' as const, feedInBags: false, lowLevelKg: 1000, capacityKg }],
  ]);

  it('delivers on the first shortage date', () => {
    const lines = recommendLines({ ...base, sources: buildFeedForecast(workedExampleWithLevels).sources, destinations: dest(12000) });
    expect(lines.map((l) => [l.itemId, l.recommendedQtyKg, l.recommendedDeliveryDate, l.proposedDeliveryDate, l.exceedsSiloCapacity]))
      .toEqual([['r1', 6000, '2026-09-23', '2026-09-23', false], ['r2', 9000, '2026-09-26', '2026-09-26', false]]);
  });

  it('warns but keeps the quantity when the order would overfill the silo', () => {
    const lines = recommendLines({ ...base, sources: buildFeedForecast(workedExampleWithLevels).sources, destinations: dest(9500) });
    const r2 = lines.find((l) => l.itemId === 'r2')!;
    expect([r2.recommendedQtyKg, r2.exceedsSiloCapacity]).toEqual([9000, true]); // 9,000 + 1,000 opening > 9,500
  });

  it('drafts nothing for a next-diet silo that never runs short in the window', () => {
    const input = { ...workedExampleWithLevels, silos: workedExampleWithLevels.silos.map((s) => (s.siloId === 's2' ? { ...s, balanceKg: 11000 } : s)) };
    const lines = recommendLines({ ...base, sources: buildFeedForecast(input).sources, destinations: dest(12000) });
    expect(lines.map((l) => l.itemId)).toEqual(['r1']);
  });
});

describe('deliveryDateNeedsRemarks', () => {
  it('requires remarks only when the date moved from the drafted one', () => {
    expect(deliveryDateNeedsRemarks({ recommendedDeliveryDate: '2026-09-23', proposedDeliveryDate: '2026-09-23' })).toBe(false);
    expect(deliveryDateNeedsRemarks({ recommendedDeliveryDate: '2026-09-23', proposedDeliveryDate: '2026-09-24' })).toBe(true);
    expect(deliveryDateNeedsRemarks({ recommendedDeliveryDate: null, proposedDeliveryDate: '2026-09-24' })).toBe(false); // manual line
  });
});

describe('requisitionPriority — Requisition §1 row 34', () => {
  it('CRITICAL_FIRST_PRIORITY when any silo is at or below its low level', () => {
    expect(requisitionPriority('2026-09-23', [{ belowLowLevel: true, firstShortageDate: '2026-10-10' }])).toBe('CRITICAL_FIRST_PRIORITY');
  });
  it('CRITICAL under 3 days to shortage, WARNING under 7, INFO otherwise', () => {
    expect(requisitionPriority('2026-09-23', [{ belowLowLevel: false, firstShortageDate: '2026-09-23' }])).toBe('CRITICAL');
    expect(requisitionPriority('2026-09-23', [{ belowLowLevel: false, firstShortageDate: '2026-09-26' }])).toBe('WARNING');
    expect(requisitionPriority('2026-09-23', [{ belowLowLevel: false, firstShortageDate: '2026-09-30' }])).toBe('INFO');
    expect(requisitionPriority('2026-09-23', [])).toBe('INFO');
  });
});

describe('planDraftUpsert — rerun without duplicate drafts (Engine Step 9, Review Focus 1)', () => {
  const [lineR1, lineR2] = recommendLines({
    planningDate: '2026-09-23', to: '2026-09-29', sources: [r1, r2],
    destinations: new Map([silo('s1'), silo('s2')]), settings: S,
  });

  it('inserts every line on the first run', () => {
    expect(planDraftUpsert([], new Set(), [lineR1, lineR2])).toEqual({ insert: [lineR1, lineR2], update: [], remove: [], keep: [] });
  });

  it('refreshes an untouched line, quantity included', () => {
    const plan = planDraftUpsert([{ lineId: 'L1', key: 's1|r1', quantityKg: 6000, recommendedQtyKg: 6000 }], new Set(), [lineR1]);
    expect(plan.update).toEqual([{ lineId: 'L1', line: lineR1, keepQuantity: false, priorQuantityKg: 6000, keepDeliveryDate: false, priorProposedDeliveryDate: null }]);
  });

  it('keeps a quantity the farm edited', () => {
    const plan = planDraftUpsert([{ lineId: 'L1', key: 's1|r1', quantityKg: 7000, recommendedQtyKg: 6000 }], new Set(), [lineR1]);
    expect(plan.update[0]).toMatchObject({ keepQuantity: true, priorQuantityKg: 7000 });
  });

  it('keeps a quantity flagged quantity_edited even when the farm typed the recommendation back (M9)', () => {
    const plan = planDraftUpsert([{ lineId: 'L1', key: 's1|r1', quantityKg: 6000, recommendedQtyKg: 6000, quantityEdited: true }], new Set(), [lineR1]);
    expect(plan.update[0]).toMatchObject({ keepQuantity: true, priorQuantityKg: 6000 });
    expect(planDraftUpsert([{ lineId: 'L9', key: 's9|r9', quantityKg: 3000, recommendedQtyKg: 3000, quantityEdited: true }], new Set(), []).keep).toEqual(['L9']);
  });

  it('removes a line no longer needed, unless the farm edited it', () => {
    expect(planDraftUpsert([{ lineId: 'L9', key: 's9|r9', quantityKg: 3000, recommendedQtyKg: 3000 }], new Set(), []).remove).toEqual(['L9']);
    expect(planDraftUpsert([{ lineId: 'L9', key: 's9|r9', quantityKg: 4000, recommendedQtyKg: 3000 }], new Set(), []).keep).toEqual(['L9']);
  });

  it('keeps a delivery date the farm moved off the drafted one, and refreshes the recommendation beside it (Req. row 29)', () => {
    const moved = { lineId: 'L1', key: 's1|r1', quantityKg: 6000, recommendedQtyKg: 6000, recommendedDeliveryDate: '2026-09-22', proposedDeliveryDate: '2026-09-25' };
    expect(planDraftUpsert([moved], new Set(), [lineR1]).update[0]).toMatchObject({ keepDeliveryDate: true, priorProposedDeliveryDate: '2026-09-25' });
    // untouched (proposed still equals the old recommendation), or a line with no recommended date (legacy/manual): refreshed
    expect(planDraftUpsert([{ ...moved, proposedDeliveryDate: '2026-09-22' }], new Set(), [lineR1]).update[0]).toMatchObject({ keepDeliveryDate: false });
    expect(planDraftUpsert([{ ...moved, recommendedDeliveryDate: null }], new Set(), [lineR1]).update[0]).toMatchObject({ keepDeliveryDate: false });
  });

  it('skips lines already on another requisition of the cycle', () => {
    expect(planDraftUpsert([], new Set(['s2|r2']), [lineR1, lineR2]).insert).toEqual([lineR1]);
  });
});

describe('runKeyFor and serverToday', () => {
  it('names the farm and the moment', () => {
    expect(runKeyFor('GRS', new Date(2026, 8, 23, 9, 5, 7))).toBe('RUN-GRS-20260923-090507');
  });
  it('reads the server calendar day, not the UTC one', () => {
    expect(serverToday(new Date(2026, 8, 23, 0, 30))).toBe('2026-09-23');
  });
});

describe('approvalProblems — checkpoints 18 and 22', () => {
  // recommendedDeliveryDate: null keeps these pre-existing cases clear of the new Req. row 29 check below.
  const r1Line = { lineSeq: 1, itemName: 'Weaner Diet R1', quantityKg: 9000, recommendedQtyKg: 6000, recommendedDeliveryDate: null, proposedDeliveryDate: '2026-09-23' };

  it('names the line that deviates more than 20 % when there are no remarks — 6,000 → 9,000 kg', () => {
    expect(approvalProblems({ lines: [r1Line], remarks: '  ', today: '2026-09-23', submissionDeadline: '2026-09-26' }))
      .toEqual(['Line 1 (Weaner Diet R1): 9,000 kg is more than 20% off the recommended 6,000 kg. Add remarks to explain.']);
  });
  it('accepts it with remarks', () => {
    expect(approvalProblems({ lines: [r1Line], remarks: 'Extra pigs arriving', today: '2026-09-23', submissionDeadline: '2026-09-26' })).toEqual([]);
  });
  it('accepts exactly 20 % and a manual line without remarks', () => {
    expect(approvalProblems({
      lines: [{ ...r1Line, quantityKg: 7200 }, { lineSeq: 2, itemName: 'X', quantityKg: 50000, recommendedQtyKg: null, recommendedDeliveryDate: null, proposedDeliveryDate: '2026-09-23' }],
      remarks: null, today: '2026-09-23', submissionDeadline: '2026-09-26',
    })).toEqual([]);
  });
  it('requires remarks when a delivery date was moved off the drafted one (Req. row 29)', () => {
    expect(approvalProblems({
      lines: [{ ...r1Line, quantityKg: 6000, recommendedDeliveryDate: '2026-09-23', proposedDeliveryDate: '2026-09-24' }],
      remarks: null, today: '2026-09-23', submissionDeadline: '2026-09-26',
    })).toEqual(["Line 1 (Weaner Diet R1): the delivery date differs from the forecast's. Remarks are required (Requisition row 29)."]);
  });
  it('never for a manual line, which has no recommended delivery date to differ from', () => {
    expect(approvalProblems({
      lines: [{ lineSeq: 1, itemName: 'X', quantityKg: 50000, recommendedQtyKg: null, recommendedDeliveryDate: null, proposedDeliveryDate: '2026-09-30' }],
      remarks: null, today: '2026-09-23', submissionDeadline: '2026-09-26',
    })).toEqual([]);
  });
  it('accepts approval on the deadline day itself without remarks', () => {
    expect(approvalProblems({ lines: [{ ...r1Line, quantityKg: 6000 }], remarks: null, today: '2026-09-26', submissionDeadline: '2026-09-26' })).toEqual([]);
  });
  it('needs remarks after the deadline (Q5)', () => {
    expect(approvalProblems({ lines: [{ ...r1Line, quantityKg: 6000 }], remarks: null, today: '2026-09-27', submissionDeadline: '2026-09-26' }))
      .toEqual(['The submission deadline (26/09/26) has passed. Add remarks to explain.']);
  });
  it('lists both the deviation and the late approval when neither has remarks', () => {
    expect(approvalProblems({ lines: [r1Line], remarks: undefined, today: '2026-09-27', submissionDeadline: '2026-09-26' })).toHaveLength(2);
  });
  it('requires remarks on an item exception line, even with no deviation or date change (Requisition row 36)', () => {
    expect(approvalProblems({
      lines: [{ ...r1Line, quantityKg: 6000, itemException: true }],
      remarks: null, today: '2026-09-23', submissionDeadline: '2026-09-26',
    })).toEqual(['Line 1 (Weaner Diet R1): feed item differs from the lifecycle requirement (exception). Remarks are required (Requisition row 36).']);
  });
  it('accepts an item exception line with remarks', () => {
    expect(approvalProblems({
      lines: [{ ...r1Line, quantityKg: 6000, itemException: true }],
      remarks: 'Vet instruction', today: '2026-09-23', submissionDeadline: '2026-09-26',
    })).toEqual([]);
  });
  it('never for a line with no exception', () => {
    expect(approvalProblems({ lines: [{ ...r1Line, quantityKg: 6000, itemException: false }], remarks: null, today: '2026-09-23', submissionDeadline: '2026-09-26' })).toEqual([]);
  });
  it('refuses a requisition with no lines', () => {
    expect(approvalProblems({ lines: [], remarks: 'x', today: '2026-09-23', submissionDeadline: null })).toEqual(['A requisition needs at least one line to be approved.']);
  });
});

describe('lineChangeProblems — Req. row 13 and cp. 4', () => {
  const silo = (heldItemId: string | null, heldBalanceKg: number) => ({ locationType: 'SILO' as const, heldItemId, heldBalanceKg });
  it('accepts the lifecycle item into a silo holding it', () => {
    expect(lineChangeProblems({ requiredItemId: 'r1', itemId: 'r1', exceptionReason: null, destination: silo('r1', 1500) })).toEqual([]);
  });
  it('needs an exception reason for an item the lifecycle does not require', () => {
    expect(lineChangeProblems({ requiredItemId: 'r1', itemId: 'r2', exceptionReason: null, destination: silo('r2', 0) }))
      .toEqual(['Feed item differs from the lifecycle requirement: record an exception reason (Requisition row 13).']);
    expect(lineChangeProblems({ requiredItemId: 'r1', itemId: 'r2', exceptionReason: 'Vet instruction', destination: silo('r2', 0) })).toEqual([]);
  });
  it('refuses a silo that still holds another item', () => {
    expect(lineChangeProblems({ requiredItemId: 'r2', itemId: 'r2', exceptionReason: null, destination: silo('r1', 1500) }))
      .toEqual(['Silo holds another feed with stock: choose a silo holding this item or an empty one (checkpoint 4).']);
  });
  it('accepts an empty silo whose last item was another, a store, and a blank reason is no reason', () => {
    expect(lineChangeProblems({ requiredItemId: 'r2', itemId: 'r2', exceptionReason: null, destination: silo('r1', 0) })).toEqual([]);
    expect(lineChangeProblems({ requiredItemId: 'r2', itemId: 'r2', exceptionReason: null, destination: { locationType: 'STORE', heldItemId: 'r1', heldBalanceKg: 500 } })).toEqual([]);
    expect(lineChangeProblems({ requiredItemId: 'r1', itemId: 'r2', exceptionReason: '  ', destination: silo(null, 0) })).toHaveLength(1);
  });
  it('a line with no lifecycle requirement (manual) needs no exception', () => {
    expect(lineChangeProblems({ requiredItemId: null, itemId: 'r2', exceptionReason: null, destination: silo(null, 0) })).toEqual([]);
  });
});

describe('requiredItemForManualLine — §6a: a manual line is checked against the lifecycle-required item', () => {
  const sources = [{ locationId: 'silo-1', itemId: 'r1' }, { locationId: 'silo-1', itemId: 'r2' }, { locationId: 'silo-2', itemId: 'r3' }];
  it('is the item itself when the forecast demands it there (current or next diet)', () => {
    expect(requiredItemForManualLine(sources, 'silo-1', 'r2')).toBe('r2');
  });
  it('is a demanded item when the line names another', () => {
    expect(requiredItemForManualLine(sources, 'silo-1', 'r9')).toBe('r1');
  });
  it('is null where nothing is demanded, so there is nothing to differ from', () => {
    expect(requiredItemForManualLine(sources, 'store-1', 'r9')).toBeNull();
  });
});

/**
 * B1 (Rishi, 3 Oct): the order line is per silo and item; beneath it, which
 * batches in which houses it feeds — Engine Step 9 "draft lines per farm,
 * batch, house, destination silo, item and required date".
 */
describe('buildLineBreakdown — per batch and house under each silo/item line (B1)', () => {
  const row = (over: Record<string, unknown>) => ({
    date: '2026-09-23', batchId: 'b1', realBatchId: 'b1', stageId: null, groupStageId: null, batchNo: 'B-001', shedId: 'h3', shedCode: 'GRS/SHED-003', itemId: 'r1',
    destinationLocationId: 's1', heads: 1000, feedRateKg: 0.5, demandKg: 500, lifecycleId: 'lc-r1', sourceType: 'SILO', ...over,
  });
  it('sums demand over the window per (batch, house), taking heads, rate and lifecycle row from the first day with demand', () => {
    const daily = [
      row({}),
      row({ date: '2026-09-24', heads: 990, demandKg: 495 }),
      row({ batchId: 'b2', realBatchId: 'b2', batchNo: 'B-002', shedId: 'h4', shedCode: 'GRS/SHED-004', heads: 400, demandKg: 200 }),
      row({ date: '2026-09-24', batchId: 'b2', realBatchId: 'b2', batchNo: 'B-002', shedId: 'h4', shedCode: 'GRS/SHED-004', heads: 400, demandKg: 200 }),
      row({ itemId: 'r2', destinationLocationId: 's2', demandKg: 300, lifecycleId: 'lc-r2', feedRateKg: 0.3 }),
    ];
    const out = buildLineBreakdown(daily as any, '2026-09-23', '2026-09-29');
    expect(out.get('s1|r1')).toEqual([
      { batchId: 'b1', stageId: null, batchNo: 'B-001', shedId: 'h3', shedCode: 'GRS/SHED-003', heads: 1000, feedRateKg: 0.5, lifecycleRefId: 'lc-r1', demandKg: 995, firstDemandDate: '2026-09-23' },
      { batchId: 'b2', stageId: null, batchNo: 'B-002', shedId: 'h4', shedCode: 'GRS/SHED-004', heads: 400, feedRateKg: 0.5, lifecycleRefId: 'lc-r1', demandKg: 400, firstDemandDate: '2026-09-23' },
    ]);
    expect(out.get('s2|r2')).toEqual([
      { batchId: 'b1', stageId: null, batchNo: 'B-001', shedId: 'h3', shedCode: 'GRS/SHED-003', heads: 1000, feedRateKg: 0.3, lifecycleRefId: 'lc-r2', demandKg: 300, firstDemandDate: '2026-09-23' },
    ]);
  });
  it('leaves out rows with no destination, outside the window, or with no demand', () => {
    const daily = [
      row({ destinationLocationId: null, sourceType: 'NONE' }),
      row({ date: '2026-09-22' }),
      row({ date: '2026-09-30' }),
      row({ batchId: 'b9', realBatchId: 'b9', demandKg: 0 }),
      row({ date: '2026-09-25', heads: 980, demandKg: 490 }),
    ];
    expect(buildLineBreakdown(daily as any, '2026-09-23', '2026-09-29').get('s1|r1')).toEqual([
      { batchId: 'b1', stageId: null, batchNo: 'B-001', shedId: 'h3', shedCode: 'GRS/SHED-003', heads: 980, feedRateKg: 0.5, lifecycleRefId: 'lc-r1', demandKg: 490, firstDemandDate: '2026-09-25' },
    ]);
  });
  it('a batch with no house keeps a null shed', () => {
    const out = buildLineBreakdown([row({ shedId: undefined, shedCode: '' })] as any, '2026-09-23', '2026-09-29');
    expect(out.get('s1|r1')?.[0]).toMatchObject({ shedId: null, demandKg: 500 });
  });

  /**
   * D1 (3 Oct, Task 9b): auto-draft 500'd on 7 of 9 demo farms because an
   * ANIMAL_WISE/REGISTERED batch's engine id is `<batch_id>:<stageId>` — a
   * 73-char composite, never a batch_header PK — and it flowed straight into
   * requisition_line_batch.batch_id. This fixture carries exactly that shape
   * (two stage groups of the SAME physical batch feeding the SAME shed) to
   * prove: (1) the persisted batchId is always the real batch_header PK, and
   * (2) the two stages produce two rows, not one silently merged/deduped.
   */
  it('an animal-wise composite batch id (two stages, one shed) persists the real batch id with two distinct rows', () => {
    const daily = [
      row({ batchId: 'b1:stage-weaner', realBatchId: 'b1', stageId: 'stage-weaner', groupStageId: 'stage-weaner', batchNo: 'B-001 · WEANER', heads: 60, demandKg: 48 }),
      row({ batchId: 'b1:stage-grower', realBatchId: 'b1', stageId: 'stage-grower', groupStageId: 'stage-grower', batchNo: 'B-001 · GROWER', heads: 40, feedRateKg: 0.8, demandKg: 32 }),
    ];
    const out = buildLineBreakdown(daily as any, '2026-09-23', '2026-09-29')!.get('s1|r1')!;
    expect(out).toHaveLength(2);
    // Neither row ever carries the composite — both batchId values are the genuine PK ('b1').
    expect(out.every((r) => r.batchId === 'b1')).toBe(true);
    expect(out.map((r) => r.stageId).sort()).toEqual(['stage-grower', 'stage-weaner']);
    expect(out.find((r) => r.stageId === 'stage-weaner')).toMatchObject({ heads: 60, demandKg: 48 });
    expect(out.find((r) => r.stageId === 'stage-grower')).toMatchObject({ heads: 40, feedRateKg: 0.8, demandKg: 32 });
  });

  /**
   * Task 9b fix round 1, finding 1: the persisted stage_id must be the stage
   * GROUP's identity (the stage in the engine's composite key), not the stage
   * of the group's first day with demand. A REGISTERED/ANIMAL_WISE group that
   * starts in FLUSH (eating a flushing ration) and is projected into INSEM
   * inside the window first eats the INSEM diet in INSEM — so "first-demand
   * stage" stamped it INSEM, the same as the group that is already in INSEM,
   * and two rows came out as (b, INSEM, h1): ER_DUP_ENTRY on
   * uq_requisition_line_batch (line_id, batch_id, stage_id, shed_id).
   */
  it('a group projected into another group\'s stage keeps its own identity stage, so (batch, stage, shed) stays unique', () => {
    const daily = [
      // Group A: origin FLUSH. Day 1 eats the flushing ration (another line); day 2 it is in INSEM and eats r1.
      row({ batchId: 'b:FLUSH', realBatchId: 'b', stageId: 'FLUSH', groupStageId: 'FLUSH', itemId: 'flushRation', heads: 10, demandKg: 20 }),
      row({ date: '2026-09-24', batchId: 'b:FLUSH', realBatchId: 'b', stageId: 'INSEM', groupStageId: 'FLUSH', heads: 10, demandKg: 20 }),
      // Group B: origin INSEM, eats r1 throughout.
      row({ batchId: 'b:INSEM', realBatchId: 'b', stageId: 'INSEM', groupStageId: 'INSEM', heads: 12, demandKg: 24 }),
    ];
    const out = buildLineBreakdown(daily as any, '2026-09-23', '2026-09-29').get('s1|r1')!;
    const keys = out.map((r) => `${r.batchId}|${r.stageId}|${r.shedId}`);
    expect(new Set(keys).size).toBe(out.length);
    expect(out.map((r) => [r.batchId, r.stageId, r.shedId, r.heads]).sort()).toEqual([
      ['b', 'FLUSH', 'h3', 10],
      ['b', 'INSEM', 'h3', 12],
    ]);
  });
});

describe('Rishi, 30 Oct — quantityProblems: whole compartments or bags, and no silo past its capacity', () => {
  const line = { label: 'Line 10000', itemName: 'Grower 2', quantityKg: 6000, feedType: 'BULK' as const, destinationLocationId: 'silo-1', destinationCode: 'MGH6-G2', capacityKg: 10000, deliveryDate: '2026-11-07' };
  const args = { bulkMultipleKg: 3000, bagSizeKg: 50, stockOn: () => 2000 };

  it('accepts a whole number of compartments that fits', () => {
    expect(quantityProblems({ ...args, lines: [line] })).toEqual([]);
  });
  it('refuses a bulk quantity off the multiple, and approvalProblems no longer lets remarks answer it', () => {
    expect(quantityProblems({ ...args, lines: [{ ...line, quantityKg: 4500 }] }))
      .toEqual(['Line 10000 (Grower 2): 4,500 kg is not a multiple of the 3,000 kg bulk order multiple.']);
    expect(approvalProblems({ remarks: null, today: '2026-09-23', submissionDeadline: '2026-09-26', lines: [{ lineSeq: 1, itemName: 'Grower 2', quantityKg: 4500, recommendedQtyKg: null, recommendedDeliveryDate: null, proposedDeliveryDate: '2026-09-23', feedType: 'BULK' }] })).toEqual([]);
  });
  it('holds a bagged line to whole bags, and checks no capacity for a store', () => {
    expect(quantityProblems({ ...args, lines: [{ ...line, feedType: 'BAGGED' as const, quantityKg: 1025, capacityKg: null }] }))
      .toEqual(['Line 10000 (Grower 2): 1,025 kg is not a whole number of 50 kg bags.']);
  });
  it('refuses a delivery that would fill the silo past its capacity on the delivery date, and says what fits', () => {
    expect(quantityProblems({ ...args, lines: [{ ...line, quantityKg: 9000 }] }))
      .toEqual(['Line 10000 (Grower 2): 9,000 kg into MGH6-G2, which is projected to hold 2,000 kg on 07/11/26, comes to 11,000 kg — more than its 10,000 kg capacity. At most 6,000 kg fits.']);
  });
  it('counts the other lines into the same silo that arrive by then', () => {
    const second = { ...line, label: 'Line 20000', itemName: 'Grower 3', quantityKg: 3000, deliveryDate: '2026-11-08' };
    expect(quantityProblems({ ...args, lines: [line, second] })).toHaveLength(1);
    expect(quantityProblems({ ...args, lines: [line, second] })[0]).toContain('Line 20000');
  });
  it('tolerates floating-point noise on a multiple', () => {
    expect(isOffBulkMultiple(6000.0000000004, 3000)).toBe(false);
    expect(isOffBulkMultiple(4500, 3000)).toBe(true);
    expect(isOffBulkMultiple(4500, 0)).toBe(false);
  });
});

describe('projectedSiloStockKg — what a silo holds on a morning', () => {
  const p = (date: string, itemId: string, opening: number, closing: number) => ({ date, locationId: 'silo-1', itemId, openingSystemBalanceKg: opening, projectedClosingBalanceKg: closing });
  const points = [p('2026-11-01', 'a', 3000, 2800), p('2026-11-02', 'a', 2800, 2600), p('2026-11-02', 'b', 500, 400), { ...p('2026-11-02', 'a', 9999, 9999), locationId: 'silo-2' }];
  it('sums every item the silo holds that morning', () => {
    expect(projectedSiloStockKg(points, 'silo-1', '2026-11-02', 0)).toBe(3300);
  });
  it('carries the last closing past the forecast, and uses the stock on hand before it or without one', () => {
    expect(projectedSiloStockKg(points, 'silo-1', '2026-11-20', 0)).toBe(3000);
    expect(projectedSiloStockKg(points, 'silo-1', '2026-10-30', 1234)).toBe(1234);
    expect(projectedSiloStockKg(points, 'silo-9', '2026-11-02', 700)).toBe(700);
  });
});

describe('A1 (10 Oct) — Requisition row 34: the farm may escalate priority, never lower it', () => {
  it('accepts the same or a higher priority', () => {
    expect(priorityChangeProblem('WARNING', 'CRITICAL')).toBeNull();
    expect(priorityChangeProblem('INFO', 'CRITICAL_FIRST_PRIORITY')).toBeNull();
    expect(priorityChangeProblem('CRITICAL', 'CRITICAL')).toBeNull();
    expect(priorityChangeProblem(null, 'INFO')).toBeNull();
  });
  it('refuses a lower priority', () => {
    expect(priorityChangeProblem('CRITICAL', 'WARNING')).toBe('Priority can only be escalated (Requisition row 34): Critical cannot be lowered to Warning.');
  });
});

describe('priorityEscalations lists what priorityChangeProblem accepts', () => {
  it('the saved level and every higher one, highest first; none for an unknown level', () => {
    expect(priorityEscalations('WARNING')).toEqual(['CRITICAL_FIRST_PRIORITY', 'CRITICAL', 'WARNING']);
    expect(priorityEscalations('CRITICAL_FIRST_PRIORITY')).toEqual(['CRITICAL_FIRST_PRIORITY']);
    expect(priorityEscalations(null)).toEqual([]);
  });
});

describe('A1 (10 Oct) — the list status filter reads the column each status lives in', () => {
  it('filters approval statuses on requisition.status', () => {
    expect(feedListStatusFilter('APPROVED')).toEqual({ column: 'status', value: 'APPROVED' });
    expect(feedListStatusFilter('IN_CONSOLIDATION')).toEqual({ column: 'status', value: 'IN_CONSOLIDATION' });
  });
  it('filters RELEASED on document_status and fulfilment states on fulfilment_status', () => {
    expect(feedListStatusFilter('RELEASED')).toEqual({ column: 'document_status', value: 'RELEASED' });
    expect(feedListStatusFilter('SHIPPED')).toEqual({ column: 'fulfilment_status', value: 'SHIPPED' });
    expect(feedListStatusFilter('RECEIVED')).toEqual({ column: 'fulfilment_status', value: 'RECEIVED' });
    expect(feedListStatusFilter('PARTIALLY_RECEIVED')).toEqual({ column: 'fulfilment_status', value: 'PARTIALLY_RECEIVED' });
  });
});

describe('auto-draft rerun keeps an escalated priority', () => {
  it('an escalated CRITICAL survives a rerun that computes INFO', () => {
    expect(keepHigherPriority('CRITICAL', 'INFO')).toBe('CRITICAL');
  });
  it('a higher recomputed priority still wins; null or unknown takes the computed one', () => {
    expect(keepHigherPriority('INFO', 'CRITICAL')).toBe('CRITICAL');
    expect(keepHigherPriority(null, 'WARNING')).toBe('WARNING');
  });
});

describe('feedTypeOf with the item feed form (12 Oct)', () => {
  const silo = { locationType: 'SILO', feedInBags: null } as any;
  it('lets the item decide, then falls back to the destination', () => {
    expect(feedTypeOf(silo)).toBe('BULK');
    expect(feedTypeOf(silo, 'BAGGED')).toBe('BAGGED');
    expect(feedTypeOf({ locationType: 'STORE', feedInBags: null } as any, 'BULK')).toBe('BULK');
    expect(feedTypeOf({ locationType: 'STORE', feedInBags: null } as any, null)).toBe('BAGGED');
  });
  it('a BAGGED item rounds to the bag size and carries a bag count', () => {
    const S = { ...DEFAULT_FEED_SETTINGS, bulkMultipleKg: 3000, bagSizeKg: 50 } as any;
    const form = resolveItemFeedForm({ item_type: 'FEED', feed_form: 'BAGGED' })!;
    const type = feedTypeOf(silo, form);
    expect(roundOrderKg(1210, type, S)).toBe(1250);
    expect(bagCountFor(1250, type, S)).toBe(25);
    expect(roundOrderKg(1210, feedTypeOf(silo, resolveItemFeedForm({ item_type: 'FEED', feed_form: 'BULK' })), S)).toBe(3000);
  });
});

describe('runLineEvidence — a requisition from a saved calculation keeps its forecast figures (Rishi, 30 Oct)', () => {
  const { runLineEvidence } = jest.requireActual('./feed-requisition.rules') as typeof import('./feed-requisition.rules');
  it('reads the first day: one balance, every batch on the silo summed, days to one decimal, the earliest shortage', () => {
    const e = runLineEvidence([
      { forecast_date: '2026-10-30', opening_stock_kg: '2000.0000', daily_demand_kg: '150', shortage_date: null, provenance_snapshot: { batchNo: 'B1' } },
      { forecast_date: '2026-10-30', opening_stock_kg: '2000.0000', daily_demand_kg: '150', shortage_date: null, provenance_snapshot: { lifecycleId: 'lc-weaner' } },
      { forecast_date: '2026-10-31', opening_stock_kg: '1700.0000', daily_demand_kg: '150', shortage_date: '2026-11-05' },
      { forecast_date: '2026-11-01', opening_stock_kg: '1400.0000', daily_demand_kg: '150', shortage_date: '2026-11-04' },
    ], '2026-10-30');
    expect(e).toEqual({ lifecycleRefId: 'lc-weaner', systemBalanceKg: 2000, dailyRequirementKg: 300, daysRemaining: 6.7, firstShortageDate: '2026-11-04', isNextDiet: false, daysBeforeDietChange: null });
  });
  it('marks a feed that starts after the planning date as the next diet, counted in days', () => {
    const e = runLineEvidence([
      { forecast_date: '2026-11-11', opening_stock_kg: '-5', daily_demand_kg: '9', shortage_date: '2026-11-11' },
    ], '2026-10-30');
    expect(e).toMatchObject({ systemBalanceKg: 0, dailyRequirementKg: 9, daysRemaining: 0, isNextDiet: true, daysBeforeDietChange: 12 });
  });
});
