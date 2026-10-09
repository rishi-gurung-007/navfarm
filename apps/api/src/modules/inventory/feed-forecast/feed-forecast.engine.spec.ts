/**
 * TDD spec for the pure feed-forecast engine (Task 6). The worked example
 * numbers below come from the workbook and were hand-checked by Rishi
 * (D1 corrected: 525 kg / 100 kg/day = 5, not the docx's wrong 500 -> 6);
 * see docs/superpowers/specs/2026-09-25-feed-forecast-design.md, D1-D3.
 */
import { FeedRow } from '../../production/lifecycle/feed-row-days';
import { asBatchPk, buildFeedForecast, dayShort, ForecastInput, parseUtcTimestamp, todayInZone, todayLocal, utcTimestamp } from './feed-forecast.engine';

const workedExample: ForecastInput = {
  planningDate: '2026-09-23',
  from: '2026-09-23',
  to: '2026-09-29',
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000 },
  ],
  store: null,
  items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  batches: [
    {
      batchId: 'b', realBatchId: 'b' as any,
      batchNo: 'WG-2026-38',
      breedId: 'l',
      shedId: 'h3',
      heads: 1000,
      segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-08-30', end: null, projected: false }],
    },
  ],
  feedRows: [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'wean',
      itemId: 'r1',
      itemName: 'Weaner Diet R1',
      fromDay: 25,
      toDay: 27,
      kgPerHeadPerDay: 2.0,
      wastagePct: 0,
    },
    {
      lifecycleId: 'b',
      breedId: 'l',
      stageId: 'wean',
      itemId: 'r2',
      itemName: 'Weaner Diet R2',
      fromDay: 28,
      toDay: 31,
      kgPerHeadPerDay: 2.5,
      wastagePct: 0,
    },
  ],
};

describe('buildFeedForecast — workbook worked example', () => {
  it('reproduces the workbook worked example', () => {
    const { rows } = buildFeedForecast(workedExample);
    const r1 = rows.find((r) => r.itemId === 'r1')!;
    const r2 = rows.find((r) => r.itemId === 'r2')!;
    expect(r1).toMatchObject({
      sourceCode: 'GRS/SILO-001',
      rangeDemandKg: 6000,
      perDayIntakeKg: 2000,
      daysLeft: 0.8, // 1,500 ÷ 2,000 = 0.75 → 0.8
      runDownDate: '2026-09-23',
    });
    expect(r2).toMatchObject({
      sourceCode: 'GRS/SILO-002',
      rangeDemandKg: 10000,
      perDayIntakeKg: 2500,
      daysLeft: null,
      runDownDate: '2026-09-26',
    });
  });

  it('flags HEADS_ASSUMED_FLAT for every batch', () => {
    const { flags } = buildFeedForecast(workedExample);
    expect(flags).toContainEqual({ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'WG-2026-38' });
  });
});

describe('buildFeedForecast — D1 days-left sample', () => {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 60,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-29',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 525 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('525 kg at 100 kg/day gives daysLeft 5.3 and run-down 5 days out', () => {
    const { rows } = buildFeedForecast(input);
    const r = rows.find((row) => row.itemId === 'r1')!;
    expect(r.daysLeft).toBe(5.3); // 525 ÷ 100 = 5.25 → 5.3, one decimal
    expect(r.runDownDate).toBe('2026-09-28');
  });
});

describe('buildFeedForecast — shared silo across two sheds', () => {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 60,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-29',
    sheds: [
      { shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] },
      { shedId: 'h2', shedCode: 'GRS/SHED-002', siloIds: ['s1'] },
    ],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 450 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b1', realBatchId: 'b1' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
      {
        batchId: 'b2', realBatchId: 'b2' as any,
        batchNo: 'GR-2026-02',
        breedId: 'l',
        shedId: 'h2',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('both rows share daysLeft and run-down date from the combined silo demand', () => {
    const { rows } = buildFeedForecast(input);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.daysLeft).toBe(2.3); // 450 ÷ 200 = 2.25 → 2.3
      expect(r.runDownDate).toBe('2026-09-25');
    }
  });
});

describe('buildFeedForecast — D34: wastage dropped, demand is heads × rate', () => {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 60,
      kgPerHeadPerDay: 1.0,
      wastagePct: 10,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-23',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 5000 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  // D34 (Rishi, 28 Sep): neither client document has wastage. The feed row's
  // wastagePct stays on the master but the forecast ignores it.
  it('a 10% wastage on the feed row still gives 100 heads x 1 kg = 100 kg/day', () => {
    const { rows } = buildFeedForecast(input);
    expect(rows[0].perDayIntakeKg).toBe(100);
    expect(rows[0].daysLeft).toBe(50); // 5,000 kg ÷ 100 kg/day
    expect(rows[0].rangeDemandKg).toBe(100);
  });
});

describe('buildFeedForecast — missing feed row inside a multi-day range', () => {
  // Two rows leave a one-day hole at stage-day 31: row1 covers 1-30, row2 resumes at 32-60.
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 30,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
    {
      lifecycleId: 'b',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 32,
      toDay: 60,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
  ];
  // start chosen so 2026-09-23/24/25 land on stage-days 31/32/33: the hole is the first day of the range,
  // the next two days are covered again — proving the gap adds nothing while the surrounding days still do.
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-25',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 5000 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-08-24', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('flags NO_FEED_ROW for the gap day and still sums demand from the covered days', () => {
    const { rows, flags } = buildFeedForecast(input);
    expect(flags).toContainEqual({
      kind: 'NO_FEED_ROW',
      batchNo: 'GR-2026-01',
      stageCode: 'GROWER',
      day: 31,
      date: '2026-09-23',
    });
    const r = rows.find((row) => row.itemId === 'r1')!;
    // Only 09-24 and 09-25 contribute (100 kg/day each) — the gap day (09-23) adds nothing.
    expect(r.rangeDemandKg).toBe(200);
    expect(r.perDayIntakeKg).toBe(100);
  });

  it('flags a future lifecycle stage with no feed row inside the displayed horizon', () => {
    const futureGap: ForecastInput = {
      ...input,
      to: '2026-09-23',
      horizonTo: '2026-09-30',
      batches: [{
        ...input.batches[0],
        segments: [
          { stageId: 'grower', stageCode: 'GROWER', start: '2026-08-24', end: '2026-09-25', projected: false },
          { stageId: 'finisher', stageCode: 'FINISHER', start: '2026-09-26', end: '2026-09-30', projected: true },
        ],
      }],
    };

    const { flags } = buildFeedForecast(futureGap);
    expect(flags).toContainEqual({
      kind: 'NO_FEED_ROW',
      batchNo: 'GR-2026-01',
      stageCode: 'FINISHER',
      day: 1,
      date: '2026-09-26',
    });
  });
});

describe('buildFeedForecast — no silo holds the item', () => {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'wean',
      itemId: 'r2',
      itemName: 'Weaner Diet R2',
      fromDay: 1,
      toDay: 60,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-23',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1000 }],
    store: { storeId: 'st1', storeCode: 'GRS/STORE-001', balances: { r2: 300 } },
    items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'WG-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('falls back to STORE and flags NO_SILO_HOLDS_ITEM', () => {
    const { rows, flags } = buildFeedForecast(input);
    const r = rows.find((row) => row.itemId === 'r2')!;
    expect(r.sourceType).toBe('STORE');
    expect(r.sourceCode).toBe('GRS/STORE-001');
    expect(flags).toContainEqual({
      kind: 'NO_SILO_HOLDS_ITEM',
      shedCode: 'GRS/SHED-001',
      itemName: 'Weaner Diet R2',
    });
  });
});

describe('buildFeedForecast — supply lasts the whole range', () => {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 60,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-29',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 100000 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('never runs down: runDownDate null', () => {
    const { rows } = buildFeedForecast(input);
    const r = rows[0];
    expect(r.runDownDate).toBeNull();
  });
});

describe('buildFeedForecast — projected stage change', () => {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 60,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-23',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 5000 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: true }],
      },
    ],
    feedRows,
  };

  it('flags STAGE_CHANGE_PROJECTED for a projected segment', () => {
    const { flags } = buildFeedForecast(input);
    expect(flags).toContainEqual({
      kind: 'STAGE_CHANGE_PROJECTED',
      batchNo: 'GR-2026-01',
      stageCode: 'GROWER',
      date: '2026-09-23',
    });
  });
});

/** Builds a one-shed, one-batch, one-item ForecastInput so the fix-round-1 tests below don't repeat boilerplate. */
function singleBatchInput(opts: {
  heads: number;
  kgPerHeadPerDay: number;
  wastagePct: number;
  balanceKg: number;
  planningDate: string;
  from: string;
  to: string;
}): ForecastInput {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 9999,
      kgPerHeadPerDay: opts.kgPerHeadPerDay,
      wastagePct: opts.wastagePct,
    },
  ];
  return {
    planningDate: opts.planningDate,
    from: opts.from,
    to: opts.to,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: opts.balanceKg }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: opts.heads,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-01-01', end: null, projected: false }],
      },
    ],
    feedRows,
  };
}

describe('buildFeedForecast — fix round 1: integer-gram balance walk at exact multiples', () => {
  it('40 heads x 1.03 kg/day (41.2 kg/day) against 123.6 kg is exactly 3 days of stock', () => {
    const input = singleBatchInput({
      heads: 40,
      kgPerHeadPerDay: 1.03,
      wastagePct: 0,
      balanceKg: 123.6,
      planningDate: '2026-09-23',
      from: '2026-09-23',
      to: '2026-09-29',
    });
    const { rows } = buildFeedForecast(input);
    expect(rows[0].daysLeft).toBe(3);
    expect(rows[0].runDownDate).toBe('2026-09-26'); // Sep23: 123.6→82.4, Sep24: 82.4→41.2, Sep25: 41.2→0. Sep26: open=0, demand>0 → runDownDate
  });

  it('the 2.5% wastage on the row changes nothing: 50 heads x 0.35 = 17.5 kg/day against 71.75 kg is exactly 4 days', () => {
    const input = singleBatchInput({
      heads: 50,
      kgPerHeadPerDay: 0.35,
      wastagePct: 2.5,
      balanceKg: 71.75,
      planningDate: '2026-09-23',
      from: '2026-09-23',
      to: '2026-09-29',
    });
    const { rows } = buildFeedForecast(input);
    expect(rows[0].daysLeft).toBe(4.1); // 71.75 ÷ 17.5 = 4.1
    expect(rows[0].runDownDate).toBe('2026-09-27'); // D19/Q1: closes at 0 kg at the end of the 5th day
  });

  it('balance exactly equal to one day of demand is 1 day of stock, not 0', () => {
    const input = singleBatchInput({
      heads: 100,
      kgPerHeadPerDay: 1,
      wastagePct: 0,
      balanceKg: 100,
      planningDate: '2026-09-23',
      from: '2026-09-23',
      to: '2026-09-29',
    });
    const { rows } = buildFeedForecast(input);
    expect(rows[0].daysLeft).toBe(1);
    expect(rows[0].runDownDate).toBe('2026-09-24'); // Sep23: open=100, demand=100, 100>100=false. Sep24: open=0, demand=100, 100>0 → runDownDate
  });
});

describe('buildFeedForecast — fix round 1: projection anchored to planningDate, not from', () => {
  it('walks from planningDate through to, even when planningDate is before `from`', () => {
    const input = singleBatchInput({
      heads: 100,
      kgPerHeadPerDay: 1,
      wastagePct: 0,
      balanceKg: 525,
      planningDate: '2026-09-23',
      from: '2026-09-26',
      to: '2026-09-29',
    });
    const { rows } = buildFeedForecast(input);
    const r = rows.find((row) => row.itemId === 'r1')!;
    expect(r.daysLeft).toBe(5.3); // 525 ÷ 100 = 5.25 → 5.3, one decimal
    expect(r.runDownDate).toBe('2026-09-28');
  });

  it('does not subtract days before planningDate from the balance when `from` precedes planningDate', () => {
    // If the walk wrongly started at `from` (09-20), 250 kg at 100 kg/day would run out on 09-22, before
    // planningDate. Anchored correctly at planningDate (09-23), it runs out on 09-25 instead.
    const input = singleBatchInput({
      heads: 100,
      kgPerHeadPerDay: 1,
      wastagePct: 0,
      balanceKg: 250,
      planningDate: '2026-09-23',
      from: '2026-09-20',
      to: '2026-09-25',
    });
    const { rows } = buildFeedForecast(input);
    const r = rows.find((row) => row.itemId === 'r1')!;
    expect(r.daysLeft).toBe(2.5); // 250 ÷ 100
    expect(r.runDownDate).toBe('2026-09-25');
  });

  it('runDownDate is null when `to` is before planningDate — nothing to walk', () => {
    const input = singleBatchInput({
      heads: 100,
      kgPerHeadPerDay: 1,
      wastagePct: 0,
      balanceKg: 10,
      planningDate: '2026-09-23',
      from: '2026-09-10',
      to: '2026-09-15',
    });
    const { rows } = buildFeedForecast(input);
    const r = rows.find((row) => row.itemId === 'r1')!;
    expect(r.runDownDate).toBeNull();
  });
});

describe('buildFeedForecast — D6: shed with no silo falls back to STORE with no flag', () => {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 60,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-23',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: [] }],
    silos: [],
    store: { storeId: 'st1', storeCode: 'GRS/STORE-001', balances: { r1: 400 } },
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('sources from STORE without a NO_SILO_HOLDS_ITEM flag', () => {
    const { rows, flags } = buildFeedForecast(input);
    const r = rows.find((row) => row.itemId === 'r1')!;
    expect(r.sourceType).toBe('STORE');
    expect(r.sourceCode).toBe('GRS/STORE-001');
    expect(flags.some((f) => f.kind === 'NO_SILO_HOLDS_ITEM')).toBe(false);
  });
});

describe('buildFeedForecast — NONE source: no silo holds it and there is no store', () => {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 60,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-25',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: [] }],
    silos: [],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('sourceType NONE, zero balance, and still reports a run-down (left as-is)', () => {
    const { rows } = buildFeedForecast(input);
    const r = rows.find((row) => row.itemId === 'r1')!;
    expect(r.sourceType).toBe('NONE');
    expect(r.sourceCode).toBeNull();
    expect(r.currentInventoryKg).toBe(0);
    expect(r.daysLeft).toBe(0);
    expect(r.runDownDate).toBe('2026-09-23'); // planning date itself — zero balance can't cover any demand
  });
});

describe('buildFeedForecast — OVERLAPPING_FEED_ROWS', () => {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 10,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
    {
      lifecycleId: 'b',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 5,
      toDay: 15,
      kgPerHeadPerDay: 2.0,
      wastagePct: 0,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-23',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 5000 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        // start chosen so 2026-09-23 is stage-day 7, inside both overlapping rows' ranges.
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-17', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('flags OVERLAPPING_FEED_ROWS and adds no demand for that day', () => {
    const { rows, flags } = buildFeedForecast(input);
    expect(flags).toContainEqual({
      kind: 'OVERLAPPING_FEED_ROWS',
      batchNo: 'GR-2026-01',
      stageCode: 'GROWER',
      day: 7,
      date: '2026-09-23',
    });
    expect(rows).toHaveLength(0);
  });
});

describe('buildFeedForecast — two sheds falling back to one STORE, combined demand', () => {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 60,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-29',
    sheds: [
      { shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: [] },
      { shedId: 'h2', shedCode: 'GRS/SHED-002', siloIds: [] },
    ],
    silos: [],
    store: { storeId: 'st1', storeCode: 'GRS/STORE-001', balances: { r1: 450 } },
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b1', realBatchId: 'b1' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
      {
        batchId: 'b2', realBatchId: 'b2' as any,
        batchNo: 'GR-2026-02',
        breedId: 'l',
        shedId: 'h2',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('both rows share daysLeft and run-down date from the combined STORE demand', () => {
    const { rows } = buildFeedForecast(input);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.sourceType).toBe('STORE');
      expect(r.daysLeft).toBe(2.3); // 450 ÷ 200 = 2.25 → 2.3
      expect(r.runDownDate).toBe('2026-09-25');
    }
  });
});

describe('buildFeedForecast — demand changing across a stage boundary inside the horizon', () => {
  // 5 days at 1.0 kg/head/day, then 5 days at 2.0 kg/head/day, 100 heads throughout.
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 5,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
    {
      lifecycleId: 'b',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 6,
      toDay: 10,
      kgPerHeadPerDay: 2.0,
      wastagePct: 0,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-21',
    from: '2026-09-21',
    to: '2026-09-27',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 100000 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        // start chosen so 09-21 is stage-day 1: the 7-day range (09-21..09-27) spans days 1-7,
        // crossing the day5/day6 boundary between the two feed rows.
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-21', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('sums the actual per-day demand either side of the boundary, not just a flag', () => {
    const { rows } = buildFeedForecast(input);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    // Days 1-5 (09-21..09-25) at 100 kg/day = 500 kg; days 6-7 (09-26..09-27) at 200 kg/day = 400 kg.
    expect(r.rangeDemandKg).toBe(900);
    expect(r.perDayIntakeKg).toBe(100); // first demand day (09-21) is still on the 1.0 kg/head rate
  });
});

describe('buildFeedForecast — a diet row that starts later in the horizon', () => {
  // The applicable feed row only begins on stage-day 4; the range's first 3 days have no covering row for r1,
  // but a second row (a different item) covers them, so this isolates "starts later" from "missing row".
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r0',
      itemName: 'Starter Diet',
      fromDay: 1,
      toDay: 3,
      kgPerHeadPerDay: 0.5,
      wastagePct: 0,
    },
    {
      lifecycleId: 'b',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 4,
      toDay: 60,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
  ];
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-27',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1', 's0'] }],
    silos: [
      { siloId: 's0', siloCode: 'GRS/SILO-000', itemId: 'r0', balanceKg: 5000 },
      { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 5000 },
    ],
    store: null,
    items: { r0: 'Starter Diet', r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b', realBatchId: 'b' as any,
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        // start chosen so the range (09-23..09-27) covers stage-days 1-5: r0 for days 1-3, r1 starts day 4.
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('the later-starting row only counts demand from its first covered day', () => {
    const { rows } = buildFeedForecast(input);
    const r1 = rows.find((row) => row.itemId === 'r1')!;
    // Days 4-5 (09-26, 09-27) at 100 kg/day = 200 kg; perDayIntakeKg is the first day it has demand.
    expect(r1.rangeDemandKg).toBe(200);
    expect(r1.perDayIntakeKg).toBe(100);
    expect(r1.sourceCode).toBe('GRS/SILO-001');
  });
});

describe('calendar and timestamp helpers (one convention for Plan B)', () => {
  it('todayLocal reads the server calendar day, not the UTC one', () => {
    expect(todayLocal(new Date(2026, 8, 23, 0, 30).getTime())).toBe('2026-09-23');
  });
  it('writes UTC YYYY-MM-DD HH:MM:SS and reads back exactly what it wrote', () => {
    const ms = Date.UTC(2026, 8, 26, 2, 52, 4);
    expect(utcTimestamp(ms)).toBe('2026-09-26 02:52:04');
    expect(parseUtcTimestamp(utcTimestamp(ms))).toBe(ms);
  });
});

describe('todayInZone — D16 planning date in the farm time zone', () => {
  it('is already the 26th in Harare at 22:30 UTC on the 25th', () => {
    expect(todayInZone('Africa/Harare', Date.UTC(2026, 8, 25, 22, 30))).toBe('2026-09-26');
  });
  it('is still the 25th in Harare at 21:59 UTC', () => {
    expect(todayInZone('Africa/Harare', Date.UTC(2026, 8, 25, 21, 59))).toBe('2026-09-25');
  });
  it('falls back to the server day for an unknown or missing zone', () => {
    const ms = Date.UTC(2026, 8, 25, 12, 0);
    expect(todayInZone('Not/AZone', ms)).toBe(todayLocal(ms));
    expect(todayInZone(null, ms)).toBe(todayLocal(ms));
  });
});

describe('dayShort — the field specification\'s DD/MM/YY for API messages (review A9)', () => {
  it('formats a calendar day and a timestamp\'s day', () => {
    expect(dayShort('2026-09-26')).toBe('26/09/26');
    expect(dayShort('2026-11-07 10:00:00')).toBe('07/11/26');
  });
  it('dashes a missing day and leaves anything else alone', () => {
    expect(dayShort(null)).toBe('—');
    expect(dayShort('')).toBe('—');
    expect(dayShort('soon')).toBe('soon');
  });
});

/**
 * Task 9b fix round 1, finding 1: a daily row carries its stage GROUP's
 * identity (the batch's starting segment stage — the stage in the composite
 * key buildInputBatches gives an ANIMAL_WISE/REGISTERED group) separately from
 * the stage the group is in on that day. Writers persist the identity stage,
 * so (batch, stage) stays one-to-one with the engine's grouping key even after
 * a group is projected into a stage another group of the same batch is in.
 */
describe('buildFeedForecast — group identity stage survives a projected stage change', () => {
  const row = (over: Partial<FeedRow>): FeedRow => ({
    lifecycleId: 'x', breedId: 'l', stageId: 'flush', itemId: 'fr', itemName: 'Flushing', fromDay: 1, toDay: 30, kgPerHeadPerDay: 2, wastagePct: 0, ...over,
  });
  const input: ForecastInput = {
    planningDate: '2026-09-21',
    from: '2026-09-21',
    to: '2026-09-24',
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1', 's2'] }],
    silos: [
      { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'fr', balanceKg: 100000 },
      { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'ins', balanceKg: 100000 },
    ],
    store: null,
    items: { fr: 'Flushing', ins: 'Insemination' },
    batches: [{
      batchId: 'b:flush', realBatchId: 'b' as any, batchNo: 'B · FLUSH', breedId: 'l', shedId: 'h1', heads: 10,
      segments: [
        { stageId: 'flush', stageCode: 'FLUSH', start: '2026-09-20', end: '2026-09-22', projected: false },
        { stageId: 'insem', stageCode: 'INSEM', start: '2026-09-23', end: null, projected: true },
      ],
    }],
    feedRows: [row({ lifecycleId: 'a' }), row({ lifecycleId: 'b', stageId: 'insem', itemId: 'ins', itemName: 'Insemination' })],
  };

  it('stamps every day with the starting segment stage as groupStageId, while stageId follows the day', () => {
    const { daily } = buildFeedForecast(input);
    expect(daily.map((d) => [d.date, d.stageId, d.groupStageId, d.realBatchId])).toEqual([
      ['2026-09-21', 'flush', 'flush', 'b'],
      ['2026-09-22', 'flush', 'flush', 'b'],
      ['2026-09-23', 'insem', 'flush', 'b'],
      ['2026-09-24', 'insem', 'flush', 'b'],
    ]);
  });
});

describe('asBatchPk — the only way to mint a persistable batch id (9b fix round 1)', () => {
  it('accepts a batch_header id and refuses the engine\'s composite stage-group key', () => {
    const real = 'a1b2c3d4-0000-4000-8000-000000000001';
    expect(asBatchPk(real)).toBe(real);
    expect(() => asBatchPk(`${real}:a1b2c3d4-0000-4000-8000-0000000000ff`)).toThrow('Not a batch_header id');
  });
});
