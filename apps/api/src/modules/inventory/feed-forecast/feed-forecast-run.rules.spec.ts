import {
  buildConfigSnapshot, buildOutputSnapshot, buildRunLineSnapshots, buildSourceSnapshot,
  FORECAST_RUN_OUTPUT_HASH_VERSION, technicalRunCode,
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
        date: '2026-10-01', batchId: 'batch-1', shedId: 'shed-1', destinationLocationId: 'silo-1',
        itemId: 'item-required', currentItemId: 'item-current', heads: 42, feedRateKg: 2.5,
        openingStockKg: 600, confirmedReceiptKg: 100, demandKg: 105, projectedClosingKg: 595,
        runDownDate: '2026-10-04', shortageDate: '2026-10-06', recommendedQtyKg: 900, provenance,
      }],
    };

    const [line] = buildRunLineSnapshots(output as any);
    provenance.source.lifecycleIds.push('later-change');
    output.daily[0].heads = 999;

    expect(line).toEqual({
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
      date: '2026-10-01', batchId: 'batch-1', destinationLocationId: 'silo-1', itemId: 'item-1',
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

  it('refuses to persist a dated row that is missing required audit fields', () => {
    expect(() => buildRunLineSnapshots({
      daily: [{
        date: '2026-10-01', batchId: 'batch-1', itemId: 'item-1', heads: 40,
        feedRateKg: 2.5, openingStockKg: 500, demandKg: 100,
        projectedClosingKg: 400,
      }],
    } as any)).toThrow('confirmedReceiptKg');
  });
});
