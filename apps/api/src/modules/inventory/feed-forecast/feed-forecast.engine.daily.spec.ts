import { FeedRow } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';

/**
 * Plan R, spec D16–D18: one row per batch, item and date. The first fixture is
 * the workbook's Worked Example (GRS H3, WG-2026-38, 1,000 pigs; R1 days 25–27
 * at 2.0 kg = 23–25 Sep, R2 days 28–31 at 2.5 kg = 26–29 Sep; SILO1 R1 1,500 kg,
 * SILO2 R2 1,000 kg).
 */
const workedExample: ForecastInput = {
  planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', leadTimeDays: 0,
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

describe('buildFeedForecast — D34: wastage dropped, demand is heads × rate', () => {
  it('shows 100 kg intake and 100 kg demand — the row carries 10% wastage and it is ignored (D34)', () => {
    const input: ForecastInput = {
      planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-23', leadTimeDays: 2,
      sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
      silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 525 }],
      store: null, items: { r1: 'Grower Diet' },
      batches: [{ batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] }],
      feedRows: [row({ wastagePct: 10 })],
    };
    expect(buildFeedForecast(input).daily[0]).toMatchObject({ perDayIntakeKg: 100, demandKg: 100, daysOfStock: 5, itemNo: '' });
  });
});

describe('buildFeedForecast — D36: rows inside a stage-change window are indicative', () => {
  // FLUSH from 1 Sep: earliest change 4 Sep (changeWindowStart), planned (latest) 6 Sep — the
  // segment ends 5 Sep. Rows on 4–5 Sep sit inside the window and are indicative; 3 Sep is not.
  const input: ForecastInput = {
    planningDate: '2026-09-03', from: '2026-09-03', to: '2026-09-05', leadTimeDays: 2,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 100000 }],
    store: null, items: { r1: 'Flush Diet' },
    batches: [{ batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
      segments: [{
        stageId: 'flush', stageCode: 'FLUSH', start: '2026-09-01', end: '2026-09-05', projected: false,
        changeWindowStart: '2026-09-04',
      }] }],
    feedRows: [row({ stageId: 'flush' })],
  };

  it('marks 4–5 Sep indicative and leaves 3 Sep alone', () => {
    expect(buildFeedForecast(input).daily.map((d) => [d.date, d.indicative])).toEqual([
      ['2026-09-03', false],
      ['2026-09-04', true],
      ['2026-09-05', true],
    ]);
  });

  it('a posted move is a fact: without the window nothing is indicative', () => {
    const posted: ForecastInput = {
      ...input,
      batches: [{ ...input.batches[0], segments: [{ stageId: 'flush', stageCode: 'FLUSH', start: '2026-09-01', end: '2026-09-05', projected: false }] }],
    };
    expect(buildFeedForecast(posted).daily.every((d) => !d.indicative)).toBe(true);
  });
});

describe('buildFeedForecast — shared silo, one batch changes diet (Review Focus 1)', () => {
  // Shed H1 has SILO-001 (R1, 1,000 kg) and SILO-002 (R2, 500 kg). GR-01 eats R1 all week; GR-02 eats R1 until
  // 25 Sep and R2 from 26 Sep (its own breed's rows: R1 days 1–25, R2 from day 26, stage entered 1 Sep).
  const input: ForecastInput = {
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', leadTimeDays: 2,
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

  it('divides the shared silo by each row\'s own intake: 1,000 kg at 100 kg/day is 10 days on both rows (D35)', () => {
    // D35 (supersedes D18): the specification's division is Current Inventory ÷
    // Per Day Intake of that row's batch, not the silo's combined 200 kg/day.
    expect(at('GR-01', '2026-09-23', 'r1')).toMatchObject({ currentInventoryKg: 1000, daysOfStock: 10, sharedBatchCount: 2, indicative: true });
    expect(at('GR-02', '2026-09-23', 'r1')).toMatchObject({ currentInventoryKg: 1000, daysOfStock: 10, sharedBatchCount: 2, indicative: true });
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

  it('a rate difference between the sharing batches leaves each row its own division (D35, ANIMAL_WISE-style heads)', () => {
    // Same silo, two batches of different size: GR-BIG eats 200 kg/day, GR-SMALL 50 kg/day.
    // Each row divides the shared balance by its OWN intake (D35), not the container's 250.
    const sized: ForecastInput = {
      ...input,
      batches: [
        { batchId: 'big', batchNo: 'GR-BIG', breedId: 'l', shedId: 'h1', heads: 200,
          segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] },
        { batchId: 'small', batchNo: 'GR-SMALL', breedId: 'l', shedId: 'h1', heads: 50,
          segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] },
      ],
      feedRows: [row()],
    };
    const d = buildFeedForecast(sized).daily;
    expect(d.find((x) => x.batchNo === 'GR-BIG')!.daysOfStock).toBe(5); // 1,000 ÷ 200
    expect(d.find((x) => x.batchNo === 'GR-SMALL')!.daysOfStock).toBe(20); // 1,000 ÷ 50
  });
});

describe('buildFeedForecast — rows start at the planning date (Q7)', () => {
  const base: ForecastInput = {
    planningDate: '2026-09-23', from: '2026-09-20', to: '2026-09-25', leadTimeDays: 2,
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
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-26', leadTimeDays: 2,
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

describe('buildFeedForecast — daily rows with no source, and the sort tie-break (fix round 1)', () => {
  // No silo and no store: two sheds eat R1 from nowhere. The NONE "container" is not a real one, so it has no days
  // of stock and no sharing across sheds.
  const input: ForecastInput = {
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-23', leadTimeDays: 2,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: [] }, { shedId: 'h2', shedCode: 'GRS/SHED-002', siloIds: [] }],
    silos: [], store: null, items: { r1: 'Grower Diet' },
    batches: ['h1', 'h2'].map((shedId, i) => ({
      batchId: `b${i}`, batchNo: `GR-2026-0${i}`, breedId: 'l', shedId, heads: 100,
      segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }],
    })),
    feedRows: [row()],
  };

  it('gives a NONE-source row no days of stock and counts only its own batch', () => {
    const { daily } = buildFeedForecast(input);
    expect(daily.map((d) => [d.sourceType, d.daysOfStock, d.sharedBatchCount])).toEqual([['NONE', null, 1], ['NONE', null, 1]]);
  });

  it('breaks a shed/batch/date/item tie by stage code, then batch id', () => {
    const tied: ForecastInput = {
      ...input,
      sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: [] }],
      batches: [
        { batchId: 'z', batchNo: 'GR-X', breedId: 'l', shedId: 'h1', heads: 10, segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] },
        { batchId: 'y', batchNo: 'GR-X', breedId: 'l', shedId: 'h1', heads: 10, segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] },
        { batchId: 'a', batchNo: 'GR-X', breedId: 'l', shedId: 'h1', heads: 10, segments: [{ stageId: 'finisher', stageCode: 'FINISHER', start: '2026-09-01', end: null, projected: false }] },
      ],
      feedRows: [row(), row({ lifecycleId: 'f', stageId: 'finisher' })],
    };
    expect(buildFeedForecast(tied).daily.map((d) => `${d.stageCode} ${d.batchId}`)).toEqual(['FINISHER a', 'GROWER y', 'GROWER z']);
  });
});
