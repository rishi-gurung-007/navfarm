/**
 * TDD spec for the pure feed-forecast engine (Task 6). The worked example
 * numbers below come from the workbook and were hand-checked by Rishi
 * (D1 corrected: 525 kg / 100 kg/day = 5, not the docx's wrong 500 -> 6);
 * see docs/superpowers/specs/2026-09-25-feed-forecast-design.md, D1-D3.
 */
import { FeedRow } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';

const workedExample: ForecastInput = {
  planningDate: '2026-09-23',
  from: '2026-09-23',
  to: '2026-09-29',
  refillBufferDays: 2,
  leadTimeDays: 0,
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000 },
  ],
  store: null,
  items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  batches: [
    {
      batchId: 'b',
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
      daysLeft: 0,
      runDownDate: '2026-09-23',
      refillDate: '2026-09-21',
      requiredOn: '2026-09-21',
      overdue: true,
    });
    expect(r2).toMatchObject({
      sourceCode: 'GRS/SILO-002',
      rangeDemandKg: 10000,
      perDayIntakeKg: 2500,
      daysLeft: null,
      runDownDate: '2026-09-26',
      refillDate: '2026-09-24',
      requiredOn: '2026-09-24',
      overdue: false,
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
    refillBufferDays: 2,
    leadTimeDays: 0,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 525 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b',
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('525 kg at 100 kg/day gives daysLeft 5 and run-down 5 days out', () => {
    const { rows } = buildFeedForecast(input);
    const r = rows.find((row) => row.itemId === 'r1')!;
    expect(r.daysLeft).toBe(5);
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
    refillBufferDays: 2,
    leadTimeDays: 0,
    sheds: [
      { shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] },
      { shedId: 'h2', shedCode: 'GRS/SHED-002', siloIds: ['s1'] },
    ],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 450 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b1',
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
      {
        batchId: 'b2',
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
      expect(r.daysLeft).toBe(2);
      expect(r.runDownDate).toBe('2026-09-25');
    }
  });
});

describe('buildFeedForecast — wastage', () => {
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
    refillBufferDays: 2,
    leadTimeDays: 0,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 5000 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b',
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('10% wastage on 100 heads x 1 kg gives 110 kg/day', () => {
    const { rows } = buildFeedForecast(input);
    expect(rows[0].perDayIntakeKg).toBe(110);
  });
});

describe('buildFeedForecast — missing feed row', () => {
  const feedRows: FeedRow[] = [
    {
      lifecycleId: 'a',
      breedId: 'l',
      stageId: 'grower',
      itemId: 'r1',
      itemName: 'Grower Diet',
      fromDay: 1,
      toDay: 31,
      kgPerHeadPerDay: 1.0,
      wastagePct: 0,
    },
  ];
  // Batch starts far enough back that day 32 (no covering row) falls inside the range.
  const input: ForecastInput = {
    planningDate: '2026-09-23',
    from: '2026-09-23',
    to: '2026-09-23',
    refillBufferDays: 2,
    leadTimeDays: 0,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 5000 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b',
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        // start chosen so 2026-09-23 is stage-day 32 (start = 2026-08-23).
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-08-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('flags NO_FEED_ROW and adds no demand for that day', () => {
    const { rows, flags } = buildFeedForecast(input);
    expect(rows).toHaveLength(0);
    expect(flags).toContainEqual({
      kind: 'NO_FEED_ROW',
      batchNo: 'GR-2026-01',
      stageCode: 'GROWER',
      day: 32,
      date: '2026-09-23',
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
    refillBufferDays: 2,
    leadTimeDays: 0,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1000 }],
    store: { storeId: 'st1', storeCode: 'GRS/STORE-001', balances: { r2: 300 } },
    items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
    batches: [
      {
        batchId: 'b',
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
    refillBufferDays: 2,
    leadTimeDays: 0,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 100000 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b',
        batchNo: 'GR-2026-01',
        breedId: 'l',
        shedId: 'h1',
        heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-23', end: null, projected: false }],
      },
    ],
    feedRows,
  };

  it('never runs down: runDownDate null, overdue false', () => {
    const { rows } = buildFeedForecast(input);
    const r = rows[0];
    expect(r.runDownDate).toBeNull();
    expect(r.refillDate).toBeNull();
    expect(r.requiredOn).toBeNull();
    expect(r.overdue).toBe(false);
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
    refillBufferDays: 2,
    leadTimeDays: 0,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 5000 }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [
      {
        batchId: 'b',
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
