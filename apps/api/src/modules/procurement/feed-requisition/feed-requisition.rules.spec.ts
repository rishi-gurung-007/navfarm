import type { ForecastSource } from '../../inventory/feed-forecast/feed-forecast.engine';
import {
  DEFAULT_FEED_SETTINGS, DestinationInfo, approvalProblems, bagCountFor, deviationNeedsRemarks, feedTypeOf, planDraftUpsert, productionCycle,
  recommendLines, requisitionPriority, roundOrderKg, runKeyFor, serverToday,
} from './feed-requisition.rules';

const S = DEFAULT_FEED_SETTINGS;

// Task 2's sources for the Worked Example (23–29 Sep, SILO1 R1 1,500 kg, SILO2 R2 1,000 kg).
const r1: ForecastSource = {
  sourceType: 'SILO', sourceCode: 'GRS/SILO-001', locationId: 's1', itemId: 'r1', itemName: 'Weaner Diet R1',
  balanceKg: 1500, planningDayDemandKg: 2000, firstDemandDate: '2026-09-23', firstDayDemandKg: 2000, walkDemandKg: 6000,
  daysLeft: 0, runDownDate: '2026-09-23', shortageDate: '2026-09-23', isNextDiet: false, noSiloHoldsItem: false, lifecycleIds: ['row-r1'],
  thresholdKg: 0, incomingKg: 0, shortfallKg: 4500, refillDate: '2026-09-21', requiredOn: '2026-09-21', overdue: true,
};
const r2: ForecastSource = {
  sourceType: 'SILO', sourceCode: 'GRS/SILO-002', locationId: 's2', itemId: 'r2', itemName: 'Weaner Diet R2',
  balanceKg: 1000, planningDayDemandKg: 0, firstDemandDate: '2026-09-26', firstDayDemandKg: 2500, walkDemandKg: 10000,
  daysLeft: null, runDownDate: '2026-09-26', shortageDate: '2026-09-26', isNextDiet: true, noSiloHoldsItem: false, lifecycleIds: ['row-r2'],
  thresholdKg: 0, incomingKg: 0, shortfallKg: 9000, refillDate: '2026-09-24', requiredOn: '2026-09-24', overdue: false,
};
const silo = (id: string, extra: Partial<DestinationInfo> = {}): [string, DestinationInfo] =>
  [id, { locationId: id, locationType: 'SILO', feedInBags: null, lowLevelKg: null, ...extra }];

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
        proposedDeliveryDate: '2026-09-24', // Q4: Required On (run-down 26 Sep − 2 buffer − 0 lead)
      }),
    ]);
  });

  it('drafts nothing for a source whose stock covers the window', () => {
    const covered = { ...r1, balanceKg: 6000, shortfallKg: 0, runDownDate: null, refillDate: null, requiredOn: null, overdue: false };
    expect(recommendLines({ planningDate: '2026-09-23', to: '2026-09-29', sources: [covered], destinations: new Map([silo('s1')]), settings: S })).toEqual([]);
  });

  it('marks a silo at or below its low level (priority input) and a store fallback as needing a changeover', () => {
    const [line] = recommendLines({ planningDate: '2026-09-23', to: '2026-09-29', sources: [r1], destinations: new Map([silo('s1', { lowLevelKg: 1500 })]), settings: S });
    expect(line.belowLowLevel).toBe(true);
    const [store] = recommendLines({
      planningDate: '2026-09-23', to: '2026-09-29',
      sources: [{ ...r2, sourceType: 'STORE', sourceCode: 'GRS/STORE-001', locationId: 'st', noSiloHoldsItem: true }],
      destinations: new Map([['st', { locationId: 'st', locationType: 'STORE', feedInBags: null, lowLevelKg: null }]]), settings: S,
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

  it('dates the line Required On, or the planning date when Required On has passed', () => {
    expect(draft({ ...r1, requiredOn: '2026-09-25', overdue: false })[0].proposedDeliveryDate).toBe('2026-09-25');
    expect(draft(r1)[0].proposedDeliveryDate).toBe('2026-09-23'); // Required On 21 Sep is already past
  });

  it('a run-down inside the window always drafts a line — landing exactly on the level orders one compartment (Review Focus 2)', () => {
    const [line] = draft({ ...r1, shortfallKg: 0, runDownDate: '2026-09-29', shortageDate: null, refillDate: '2026-09-27', requiredOn: '2026-09-25', overdue: false });
    expect(line).toMatchObject({ unroundedNeedKg: 0, recommendedQtyKg: 3000, firstShortageDate: null, proposedDeliveryDate: '2026-09-25' });
  });

  it('a run-down found only past the window drafts nothing', () => {
    expect(draft({ ...r1, shortfallKg: 0, runDownDate: '2026-10-05', refillDate: '2026-10-03', requiredOn: '2026-10-01', overdue: false })).toEqual([]);
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
    expect(plan.update).toEqual([{ lineId: 'L1', line: lineR1, keepQuantity: false, priorQuantityKg: 6000 }]);
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
  const r1Line = { lineSeq: 1, itemName: 'Weaner Diet R1', quantityKg: 9000, recommendedQtyKg: 6000 };

  it('names the line that deviates more than 20 % when there are no remarks — 6,000 → 9,000 kg', () => {
    expect(approvalProblems({ lines: [r1Line], remarks: '  ', today: '2026-09-23', submissionDeadline: '2026-09-26' }))
      .toEqual(['Line 1 (Weaner Diet R1): 9,000 kg is more than 20% off the recommended 6,000 kg. Add remarks to explain.']);
  });
  it('accepts it with remarks', () => {
    expect(approvalProblems({ lines: [r1Line], remarks: 'Extra pigs arriving', today: '2026-09-23', submissionDeadline: '2026-09-26' })).toEqual([]);
  });
  it('accepts exactly 20 % and a manual line without remarks', () => {
    expect(approvalProblems({ lines: [{ ...r1Line, quantityKg: 7200 }, { lineSeq: 2, itemName: 'X', quantityKg: 50000, recommendedQtyKg: null }], remarks: null, today: '2026-09-23', submissionDeadline: '2026-09-26' })).toEqual([]);
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
  it('refuses a requisition with no lines', () => {
    expect(approvalProblems({ lines: [], remarks: 'x', today: '2026-09-23', submissionDeadline: null })).toEqual(['A requisition needs at least one line to be approved.']);
  });
});
