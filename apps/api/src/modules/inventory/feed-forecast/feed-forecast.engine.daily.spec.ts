import { FeedRow } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';

/**
 * Plan R, spec D16–D18: one row per batch, item and date. The first fixture is
 * the workbook's Worked Example (GRS H3, WG-2026-38, 1,000 pigs; R1 days 25–27
 * at 2.0 kg = 23–25 Sep, R2 days 28–31 at 2.5 kg = 26–29 Sep; SILO1 R1 1,500 kg,
 * SILO2 R2 1,000 kg).
 */
const workedExample: ForecastInput = {
  planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 0,
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000 },
  ],
  store: null,
  items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  itemCodes: { r1: 'FEED-R1', r2: 'FEED-R2' },
  batches: [{
    batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
    segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-08-30', end: null, projected: false }],
  }],
  feedRows: [
    { lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 27, kgPerHeadPerDay: 2.0, wastagePct: 0 },
    { lifecycleId: 'row-r2', breedId: 'l', stageId: 'wean', itemId: 'r2', itemName: 'Weaner Diet R2', fromDay: 28, toDay: 31, kgPerHeadPerDay: 2.5, wastagePct: 0 },
  ],
};

describe('buildFeedForecast — daily rows on the Worked Example', () => {
  const { daily } = buildFeedForecast(workedExample);

  it('gives R1 its three days and R2 its four as separate rows, never blended', () => {
    expect(daily.map((d) => `${d.date} ${d.itemNo}`)).toEqual([
      '2026-09-23 FEED-R1', '2026-09-24 FEED-R1', '2026-09-25 FEED-R1',
      '2026-09-26 FEED-R2', '2026-09-27 FEED-R2', '2026-09-28 FEED-R2', '2026-09-29 FEED-R2',
    ]);
  });

  it('projects Current Inventory per date: SILO1 opens 1,500 then is empty; SILO2 opens 1,000 on the change day', () => {
    expect(daily.map((d) => d.currentInventoryKg)).toEqual([1500, 0, 0, 1000, 0, 0, 0]);
    expect(daily[0]).toMatchObject({
      batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', stageCode: 'WEANER', itemName: 'Weaner Diet R1', sourceCode: 'GRS/SILO-001',
      heads: 1000, feedRateKg: 2, perDayIntakeKg: 2000, demandKg: 2000, daysOfStock: 0, sharedBatchCount: 1,
      runDownDate: '2026-09-23', refillDate: '2026-09-21', requiredOn: '2026-09-21', overdue: true,
    });
    expect(daily[3]).toMatchObject({ sourceCode: 'GRS/SILO-002', perDayIntakeKg: 2500, daysOfStock: 0, runDownDate: '2026-09-26' });
  });

  it('flags R1 rows indicative (their silo stops being eaten on 26 Sep) and R2 rows not (Q13)', () => {
    expect(daily.map((d) => d.indicative)).toEqual([true, true, true, false, false, false, false]);
  });
});

const row = (over: Partial<FeedRow> = {}): FeedRow => ({
  lifecycleId: 'a', breedId: 'l', stageId: 'grower', itemId: 'r1', itemName: 'Grower Diet',
  fromDay: 1, toDay: 200, kgPerHeadPerDay: 1, wastagePct: 0, ...over,
});

describe('buildFeedForecast — D17 intake without wastage, D18 days of stock with it (Q5)', () => {
  it('shows 100 kg intake but divides the silo by the 110 kg it loses a day', () => {
    const input: ForecastInput = {
      planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-23', refillBufferDays: 2, leadTimeDays: 2,
      sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
      silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 525 }],
      store: null, items: { r1: 'Grower Diet' },
      batches: [{ batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] }],
      feedRows: [row({ wastagePct: 10 })],
    };
    expect(buildFeedForecast(input).daily[0]).toMatchObject({ perDayIntakeKg: 100, wastagePct: 10, demandKg: 110, daysOfStock: 4, itemNo: '' });
  });
});

describe('buildFeedForecast — shared silo, one batch changes diet (Review Focus 1)', () => {
  // Shed H1 has SILO-001 (R1, 1,000 kg) and SILO-002 (R2, 500 kg). GR-01 eats R1 all week; GR-02 eats R1 until
  // 25 Sep and R2 from 26 Sep (its own breed's rows: R1 days 1–25, R2 from day 26, stage entered 1 Sep).
  const input: ForecastInput = {
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 2,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1', 's2'] }],
    silos: [
      { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1000 },
      { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 500 },
    ],
    store: null,
    items: { r1: 'Grower R1', r2: 'Grower R2' },
    batches: [
      { batchId: 'b1', batchNo: 'GR-01', breedId: 'l', shedId: 'h1', heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] },
      { batchId: 'b2', batchNo: 'GR-02', breedId: 'l2', shedId: 'h1', heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] },
    ],
    feedRows: [
      row(),
      row({ lifecycleId: 'b-r1', breedId: 'l2', toDay: 25 }),
      row({ lifecycleId: 'b-r2', breedId: 'l2', itemId: 'r2', itemName: 'Grower R2', fromDay: 26, toDay: 200 }),
    ],
  };
  const { daily } = buildFeedForecast(input);
  const at = (batchNo: string, date: string, itemId: string) => daily.find((d) => d.batchNo === batchNo && d.date === date && d.itemId === itemId)!;

  it('divides the shared silo by both batches while both eat from it, and says it is shared', () => {
    // SILO-001 feeds 200 kg/day to 25 Sep: opens 1,000 on 23 Sep → 5 days.
    expect(at('GR-01', '2026-09-23', 'r1')).toMatchObject({ currentInventoryKg: 1000, daysOfStock: 5, sharedBatchCount: 2, indicative: true });
    expect(at('GR-02', '2026-09-23', 'r1')).toMatchObject({ currentInventoryKg: 1000, daysOfStock: 5, sharedBatchCount: 2, indicative: true });
  });

  it('after the change the silo feeds one batch: 400 kg at 100 kg/day is 4 days, not indicative any more', () => {
    expect(at('GR-01', '2026-09-26', 'r1')).toMatchObject({ currentInventoryKg: 400, daysOfStock: 4, sharedBatchCount: 1, indicative: false });
  });

  it('gives GR-02 an R1 row up to 25 Sep and a separate R2 row from 26 Sep', () => {
    expect(daily.filter((d) => d.batchNo === 'GR-02').map((d) => `${d.date} ${d.itemId}`)).toEqual([
      '2026-09-23 r1', '2026-09-24 r1', '2026-09-25 r1',
      '2026-09-26 r2', '2026-09-27 r2', '2026-09-28 r2', '2026-09-29 r2',
    ]);
    expect(at('GR-02', '2026-09-26', 'r2')).toMatchObject({ sourceCode: 'GRS/SILO-002', currentInventoryKg: 500, daysOfStock: 5, sharedBatchCount: 1 });
  });
});

describe('buildFeedForecast — rows start at the planning date (Q7)', () => {
  const base: ForecastInput = {
    planningDate: '2026-09-23', from: '2026-09-20', to: '2026-09-25', refillBufferDays: 2, leadTimeDays: 2,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 5000 }],
    store: null, items: { r1: 'Grower Diet' },
    batches: [{ batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
      segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] }],
    feedRows: [row()],
  };

  it('does not forecast 20–22 Sep when the planning date is the 23rd', () => {
    expect(buildFeedForecast(base).daily.map((d) => d.date)).toEqual(['2026-09-23', '2026-09-24', '2026-09-25']);
  });

  it('has no rows at all when the range ends before the planning date', () => {
    expect(buildFeedForecast({ ...base, from: '2026-09-10', to: '2026-09-15' }).daily).toEqual([]);
  });
});

describe('buildFeedForecast — Current Inventory takes the day\'s posted movements, not its feeding (Ruling M7, Q6)', () => {
  // 100 pigs at 1 kg = 100 kg/day from a 525 kg silo. The service passes posted receipts and non-feeding outflows
  // (goods issue, negative adjustment) dated inside the walk as signed `incoming`; the day's feeding is the forecast's.
  const input: ForecastInput = {
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-26', refillBufferDays: 2, leadTimeDays: 2,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 525 }],
    store: null, items: { r1: 'Grower Diet' },
    incoming: [
      { locationId: 's1', itemId: 'r1', date: '2026-09-24', kg: 1000 }, // a receipt posted on the 24th
      { locationId: 's1', itemId: 'r1', date: '2026-09-25', kg: -200 }, // a goods issue posted on the 25th
    ],
    batches: [{ batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
      segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] }],
    feedRows: [row()],
  };

  it('adds the receipt and takes off the goods issue on their own day, and the feeding the day after', () => {
    // 525; 425 + 1,000 = 1,425; 1,325 − 200 = 1,125; 1,025.
    const { daily } = buildFeedForecast(input);
    expect(daily.map((d) => d.currentInventoryKg)).toEqual([525, 1425, 1125, 1025]);
    expect(daily.map((d) => d.daysOfStock)).toEqual([5, 14, 11, 10]);
  });
});
