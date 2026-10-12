import { FeedRow } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';

/**
 * Client ruling (Rishi, 12 Oct): in the Feed Forecast every quantity is 0 or
 * positive — negative stock is physically impossible. Confirmed Receipts are
 * the positive ledger inflows only; a negative movement (adjustment, transfer
 * out) is a separate, non-negative "other outflow" that reduces the balance;
 * a ledger balance below zero is shown as 0 and flagged in the notes.
 * 100 pigs at 1 kg = 100 kg/day from one silo.
 */
const row = (over: Partial<FeedRow> = {}): FeedRow => ({
  lifecycleId: 'a', breedId: 'l', stageId: 'grower', itemId: 'r1', itemName: 'Grower Diet',
  fromDay: 1, toDay: 200, kgPerHeadPerDay: 1, wastagePct: 0, ...over,
});

function oneSilo(over: Partial<ForecastInput> = {}, balanceKg = 10000): ForecastInput {
  return {
    planningDate: '2026-10-10', from: '2026-10-10', to: '2026-10-14',
    sheds: [{ shedId: 'h1', shedCode: 'MUL100/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'MUL100/SILO-003', itemId: 'r1', balanceKg }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [{
      batchId: 'b1', realBatchId: 'b1' as any, batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
      segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }],
    }],
    feedRows: [row()],
    ...over,
  };
}

/** Every number the engine reports that is a quantity of stock, rate or count — none may be below zero. */
function expectNoNegativeQuantities(result: ReturnType<typeof buildFeedForecast>) {
  const check = (label: string, value: unknown) => {
    if (typeof value === 'number') expect({ label, value: value < 0 ? value : 0 }).toEqual({ label, value: 0 });
  };
  for (const d of result.daily) for (const [k, v] of Object.entries(d)) check(`daily.${k}`, v);
  for (const d of result.sourceBalances) for (const [k, v] of Object.entries(d)) check(`sourceBalances.${k}`, v);
  for (const d of result.sources) for (const [k, v] of Object.entries(d)) check(`sources.${k}`, v);
  for (const d of result.rows) for (const [k, v] of Object.entries(d)) check(`rows.${k}`, v);
}

describe('buildFeedForecast — no negative quantities (Rishi, 12 Oct)', () => {
  it('a negative stock adjustment is not a negative receipt: receipts 0, other outflow 5,900, balance reduced', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-10-11', kg: -5900, kind: 'CONFIRMED_LEDGER', referenceNo: 'ADJ-1' }] });
    const result = buildFeedForecast(input);
    const day = result.daily.find((d) => d.date === '2026-10-11')!;
    expect(day).toMatchObject({ confirmedReceiptKg: 0, otherOutflowKg: 5900, openingStockKg: 9900, demandKg: 100 });
    // 10,000 − 100 (10 Oct) = 9,900 carried; − 5,900 = 4,000 on hand; − 100 fed = 3,900.
    expect(day.currentInventoryKg).toBe(4000);
    expect(day.projectedClosingKg).toBe(3900);
    const point = result.sourceBalances.find((p) => p.date === '2026-10-11')!;
    expect(point).toMatchObject({ confirmedReceiptKg: 0, otherOutflowKg: 5900, openingSystemBalanceKg: 9900, projectedClosingBalanceKg: 3900 });
    expectNoNegativeQuantities(result);
  });

  it('a receipt and an adjustment on one day are reported separately, not netted', () => {
    const input = oneSilo({
      incoming: [
        { locationId: 's1', itemId: 'r1', date: '2026-10-11', kg: 2000, kind: 'CONFIRMED_LEDGER' },
        { locationId: 's1', itemId: 'r1', date: '2026-10-11', kg: -500, kind: 'CONFIRMED_LEDGER' },
      ],
    });
    const result = buildFeedForecast(input);
    const day = result.daily.find((d) => d.date === '2026-10-11')!;
    expect(day).toMatchObject({ confirmedReceiptKg: 2000, otherOutflowKg: 500, currentInventoryKg: 11400, projectedClosingKg: 11300 });
  });

  it('an outflow larger than the stock empties the silo; nothing goes below zero', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-10-11', kg: -50000, kind: 'CONFIRMED_LEDGER' }] });
    const result = buildFeedForecast(input);
    const day = result.daily.find((d) => d.date === '2026-10-11')!;
    expect(day).toMatchObject({ otherOutflowKg: 50000, currentInventoryKg: 0, projectedClosingKg: 0, confirmedReceiptKg: 0 });
    expectNoNegativeQuantities(result);
    // Source level: the days after stay at zero.
    expect(result.sourceBalances.filter((p) => p.date > '2026-10-11').every((p) => p.openingSystemBalanceKg === 0 && p.projectedClosingBalanceKg === 0)).toBe(true);
  });

  it('a transfer out still to leave (open transfer, negative) is an other outflow, not a negative Open Transfer', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-10-12', kg: -1000, kind: 'OPEN_TRANSFER', referenceNo: 'TO-9' }] });
    const result = buildFeedForecast(input);
    const day = result.daily.find((d) => d.date === '2026-10-12')!;
    expect(day).toMatchObject({ openTransferMovementKg: 0, otherOutflowKg: 1000 });
    expectNoNegativeQuantities(result);
  });

  it('reports incomingKg as inflows only (a negative movement is not negative incoming)', () => {
    const input = oneSilo({
      incoming: [
        { locationId: 's1', itemId: 'r1', date: '2026-10-12', kg: 3000, kind: 'CONFIRMED_LEDGER' },
        { locationId: 's1', itemId: 'r1', date: '2026-10-13', kg: -9000, kind: 'CONFIRMED_LEDGER' },
      ],
    });
    const source = buildFeedForecast(input).sources[0];
    expect(source.incomingKg).toBe(3000);
    expect(source.incomingKg).toBeGreaterThanOrEqual(0);
    // The shortfall still counts the outflow: 10,000 + 3,000 − 9,000 = 4,000 against 500 of demand.
    expect(source.shortfallKg).toBe(0);
  });

  it('a ledger balance below zero shows 0 with a note, and the deficit comes off the first receipt', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-10-11', kg: 40000, kind: 'CONFIRMED_LEDGER' }] }, -471.74);
    const result = buildFeedForecast(input);
    const first = result.daily.find((d) => d.date === '2026-10-10')!;
    expect(first).toMatchObject({ openingStockKg: 0, currentInventoryKg: 0, otherOutflowKg: 0 });
    expect(result.sourceBalances.find((p) => p.date === '2026-10-10')).toMatchObject({ openingSystemBalanceKg: 0 });
    expect(result.daily.find((d) => d.date === '2026-10-11')).toMatchObject({
      confirmedReceiptKg: 40000, otherOutflowKg: 471.74, usedBeforeReceivedKg: 471.74, currentInventoryKg: 39528.26,
    });
    expect(result.sources[0].balanceKg).toBe(0);
    expect(result.flags).toContainEqual({
      kind: 'NEGATIVE_SYSTEM_BALANCE', sourceCode: 'MUL100/SILO-003', itemName: 'Grower Diet', balanceKg: -471.74, date: '2026-10-10',
    });
    expectNoNegativeQuantities(result);
  });

  it('a deficit larger than the first inflow is carried forward and recovered day by day', () => {
    const input = oneSilo({
      incoming: [
        { locationId: 's1', itemId: 'r1', date: '2026-10-11', kg: 300, kind: 'CONFIRMED_LEDGER' },
        { locationId: 's1', itemId: 'r1', date: '2026-10-13', kg: 1000, kind: 'CONFIRMED_LEDGER' },
      ],
    }, -500);
    const result = buildFeedForecast(input);
    const by = (date: string) => result.daily.find((d) => d.date === date)!;
    expect(by('2026-10-11')).toMatchObject({ usedBeforeReceivedKg: 300, otherOutflowKg: 300, currentInventoryKg: 0, projectedClosingKg: 0 });
    expect(by('2026-10-12')).toMatchObject({ usedBeforeReceivedKg: 0, currentInventoryKg: 0 });
    expect(by('2026-10-13')).toMatchObject({ usedBeforeReceivedKg: 200, otherOutflowKg: 200, currentInventoryKg: 800, projectedClosingKg: 700 });
    expectNoNegativeQuantities(result);
  });

  it('an unrecovered deficit still counts toward the shortfall', () => {
    // 100 kg/day for 5 days (10–14 Oct) against a 500 kg deficit and nothing arriving: needs 500 + 500.
    const source = buildFeedForecast(oneSilo({}, -500)).sources[0];
    expect(source.shortfallKg).toBe(1000);
  });

  it('raises no negative-balance note for a balance of zero or more', () => {
    expect(buildFeedForecast(oneSilo({}, 0)).flags.some((f) => f.kind === 'NEGATIVE_SYSTEM_BALANCE')).toBe(false);
    expect(buildFeedForecast(oneSilo({}, 100)).flags.some((f) => f.kind === 'NEGATIVE_SYSTEM_BALANCE')).toBe(false);
  });

  it('a store balance below zero is clamped and noted too', () => {
    const input = oneSilo({
      sheds: [{ shedId: 'h1', shedCode: 'MUL100/SHED-001', siloIds: [] }],
      silos: [],
      store: { storeId: 'st', storeCode: 'MUL100/STORE-001', balances: { r1: -4200 } },
    });
    const result = buildFeedForecast(input);
    expect(result.sources[0]).toMatchObject({ sourceType: 'STORE', balanceKg: 0 });
    expect(result.flags).toContainEqual(expect.objectContaining({ kind: 'NEGATIVE_SYSTEM_BALANCE', sourceCode: 'MUL100/STORE-001', balanceKg: -4200 }));
    expectNoNegativeQuantities(result);
  });
});
