import {
  buildConfigSnapshot, buildOutputSnapshot, buildRunLineSnapshots, buildSourceSnapshot,
  FORECAST_RUN_OUTPUT_HASH_VERSION, runCodeFor, runCodePrefix, technicalRunCode,
} from './feed-forecast-run.rules';

describe('feed forecast run snapshot rules', () => {
  it('hashes a detached effective-settings snapshot deterministically', () => {
    const settings = {
      companyId: 'company-1',
      farmId: 'farm-1',
      defaultForecastDays: 7,
      maxForecastDays: 45,
      productionShift: 'DAY',
      sources: { companySetting: 'COMPANY', leadTime: 'FARM' },
    };

    const first = buildConfigSnapshot(settings);
    const second = buildConfigSnapshot({ ...settings, sources: { leadTime: 'FARM', companySetting: 'COMPANY' } });
    settings.productionShift = 'NIGHT';

    expect(first).toEqual(second);
    expect(first.values.productionShift).toBe('DAY');
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.version).toBe(`sha256:${first.hash}`);
  });

  it('snapshots every dated line quantity and its source provenance without retaining live references', () => {
    const provenance = { flags: ['HEADS_ASSUMED_FLAT'], source: { lifecycleIds: ['life-1'] } };
    const output = {
      daily: [{
        date: '2026-10-01', batchId: 'batch-1:stage-1', realBatchId: 'batch-1', shedId: 'shed-1', destinationLocationId: 'silo-1',
        itemId: 'item-required', currentItemId: 'item-current', heads: 42, feedRateKg: 2.5,
        openingStockKg: 600, confirmedReceiptKg: 100, demandKg: 105, projectedClosingKg: 595,
        runDownDate: '2026-10-04', shortageDate: '2026-10-06', recommendedQtyKg: 900, provenance,
      }],
    };

    const [line] = buildRunLineSnapshots(output as any);
    provenance.source.lifecycleIds.push('later-change');
    output.daily[0].heads = 999;

    expect(line).toEqual({
      // D1 (3 Oct): batchId must be the genuine batch_header PK (realBatchId), never the
      // engine's display/grouping composite `<batchId>:<stageId>` — that composite is what
      // caused ER_DATA_TOO_LONG / an FK rejection when written to feed_forecast_run_line.
      forecastDate: '2026-10-01', batchId: 'batch-1', shedId: 'shed-1', destinationLocationId: 'silo-1',
      requiredItemId: 'item-required', currentItemId: 'item-current', headCount: 42, feedRateKg: 2.5,
      openingStockKg: 600, confirmedReceiptKg: 100, dailyDemandKg: 105, projectedClosingKg: 595,
      shortageDate: '2026-10-06', recommendedQtyKg: 900,
      provenanceSnapshot: { flags: ['HEADS_ASSUMED_FLAT'], source: { lifecycleIds: ['life-1'] }, runDownDate: '2026-10-04' },
    });
  });

  it('hashes and detaches the exact engine inputs used to create run evidence', () => {
    const input = { stock: [{ ledgerId: 'ledger-1', qty: 500 }], batches: [{ batchId: 'batch-1', heads: 40 }] };
    const first = buildSourceSnapshot(input);
    const changed = buildSourceSnapshot({ ...input, stock: [{ ledgerId: 'ledger-1', qty: 499 }] });
    input.stock[0].qty = 0;

    expect(first.values).toEqual({ batches: [{ batchId: 'batch-1', heads: 40 }], stock: [{ ledgerId: 'ledger-1', qty: 500 }] });
    expect(first.hash).not.toBe(changed.hash);
  });

  it('hashes the material run-line multiset with a stable version and no volatile row identity', () => {
    const lines = buildRunLineSnapshots({ daily: [{
      date: '2026-10-01', batchId: 'batch-1', realBatchId: 'batch-1', destinationLocationId: 'silo-1', itemId: 'item-1',
      heads: 40, feedRateKg: 2.5, openingStockKg: 500, confirmedReceiptKg: 0, demandKg: 100,
      projectedClosingKg: 400, shortageDate: null, recommendedQtyKg: 700,
    }] });

    const first = buildOutputSnapshot(lines);
    const reordered = buildOutputSnapshot([...lines].reverse());
    const changed = buildOutputSnapshot([{ ...lines[0], dailyDemandKg: 101 }]);

    expect(first).toEqual(reordered);
    expect(first).toEqual({
      version: FORECAST_RUN_OUTPUT_HASH_VERSION,
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      lineCount: 1,
    });
    expect(first.hash).not.toBe(changed.hash);
    expect(first).not.toHaveProperty('runLineId');
    expect(first).not.toHaveProperty('createdAt');
  });

  it('uses the documented technical run code fallback without inventing a client number series', () => {
    expect(technicalRunCode('farm-uuid', 12)).toBe('FFR-farm-uuid-000012');
  });

  // Engine §5 row 68: "RUN-GRS-20260923-001" — RUN-<FarmCode>-<YYYYMMDD>-<NNN per farm per day>.
  describe('runCodeFor (Engine §5 row 68)', () => {
    it('builds RUN-<FarmCode>-<YYYYMMDD>-<NNN>, starting at 001 for a farm and day with no run', () => {
      expect(runCodePrefix('GRS', '2026-09-23')).toBe('RUN-GRS-20260923-');
      expect(runCodeFor('GRS', '2026-09-23', [])).toBe('RUN-GRS-20260923-001');
    });

    it('continues the sequence within the same farm and day, three digits', () => {
      expect(runCodeFor('GRS', '2026-09-23', ['RUN-GRS-20260923-001', 'RUN-GRS-20260923-002'])).toBe('RUN-GRS-20260923-003');
      expect(runCodeFor('GRS', '2026-09-23', ['RUN-GRS-20260923-009'])).toBe('RUN-GRS-20260923-010');
    });

    it('ignores codes of another day, another farm, and legacy FFR- codes', () => {
      expect(runCodeFor('GRS', '2026-09-23', ['RUN-GRS-20260922-004', 'RUN-GR-20260923-005', 'RUN-GRSX-20260923-006', 'FFR-farm-1-000007'])).toBe('RUN-GRS-20260923-001');
    });
  });

  it('refuses to persist a dated row that is missing required audit fields', () => {
    expect(() => buildRunLineSnapshots({
      daily: [{
        date: '2026-10-01', batchId: 'batch-1', realBatchId: 'batch-1', itemId: 'item-1', heads: 40,
        feedRateKg: 2.5, openingStockKg: 500, demandKg: 100,
        projectedClosingKg: 400,
      }],
    } as any)).toThrow('confirmedReceiptKg');
  });

  it('refuses to persist a dated row missing the genuine batch id (D1, 3 Oct)', () => {
    // The engine's own `batchId` is a display/grouping key — a `<batch_id>:<stageId>` composite
    // for an ANIMAL_WISE/REGISTERED batch's stage group. A row that carries only that must be
    // refused rather than silently writing the composite to a batch_header FK column.
    expect(() => buildRunLineSnapshots({
      daily: [{
        date: '2026-10-01', batchId: 'batch-1:stage-1', itemId: 'item-1', heads: 40,
        feedRateKg: 2.5, openingStockKg: 500, confirmedReceiptKg: 0, demandKg: 100,
        projectedClosingKg: 400, recommendedQtyKg: 700,
      }],
    } as any)).toThrow('realBatchId');
  });
});
