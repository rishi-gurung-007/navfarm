import { pivotForecastRows, type DietChange, type ReportRow } from '../src/components/console/inventory/feed-forecast-grid';

function row(over: Partial<ReportRow>): ReportRow {
  return {
    key: '', farmId: 'F', batchId: 'B1', batchGroupId: 'B1', batchNo: 'BATCH-1', plainBatchNo: 'BATCH-1',
    shedId: 'SH1', shedCode: 'SHED-1', stageCode: 'GESTATION', itemId: 'DRY', itemNo: 'DRY', itemName: 'Dry Gilt',
    sourceType: 'SILO', feedType: 'BULK', sourceCode: 'S1', sourceName: null, sourceLocationId: 'S1',
    currentItemId: null, currentItemNo: null, currentItemName: null,
    date: '2026-11-01', dateTo: '2026-11-01', days: 1, currentInventoryKg: 0, openingSystemBalanceKg: 0,
    confirmedReceiptsKg: 0, heads: 3, feedRateKg: 2, perDayIntakeKg: 6, intakeKg: 6, dailyUseKg: 6,
    projectedClosingBalanceKg: 0, recommendedQtyKg: 0, firstShortageDate: null, deliveryDate: null,
    daysOfStock: null, sharedBatchCount: 1, indicative: false, runDownDate: null,
    ...over,
  };
}

// The API orders by house, then batch, then date, one row per day.
const rows: ReportRow[] = [
  row({ date: '2026-11-01', dateTo: '2026-11-01' }),
  row({ date: '2026-11-03', dateTo: '2026-11-03', stageCode: 'FARROWING', itemId: 'LAC', itemName: 'Lactating Gilt', sourceCode: 'S3', sourceLocationId: 'S3' }),
  row({ date: '2026-11-03', dateTo: '2026-11-03', stageCode: 'FARROWING', itemId: 'LZ', itemName: 'Lactate Z Line', sourceCode: 'S2', sourceLocationId: 'S2' }),
  row({ batchId: 'B2', batchGroupId: 'B2', batchNo: 'BATCH-2', plainBatchNo: 'BATCH-2', date: '2026-11-01', dateTo: '2026-11-01' }),
  row({ batchId: 'B2', batchGroupId: 'B2', batchNo: 'BATCH-2', plainBatchNo: 'BATCH-2', date: '2026-11-02', dateTo: '2026-11-02' }),
];

const dietChanges: DietChange[] = [
  { batchId: 'B1', fromItemId: 'DRY', fromItemName: 'Dry Gilt', toItemId: 'LZ', toItemName: 'Lactate Z Line', changeDate: '2026-11-03', nextSourceType: 'SILO', nextSourceCode: 'S2' },
  { batchId: 'B1', fromItemId: 'DRY', fromItemName: 'Dry Gilt', toItemId: 'LAC', toItemName: 'Lactating Gilt', changeDate: '2026-11-03', nextSourceType: 'SILO', nextSourceCode: 'S3' },
];

describe('feed forecast grid keeps a batch together', () => {
  it('puts every stage, feed and silo line of a batch next to each other, in date order', () => {
    const { pivoted } = pivotForecastRows(rows, [], 'CUSTOM', '2026-11-01', dietChanges);
    expect(pivoted.map((line) => [line.plainBatchNo, line.itemName])).toEqual([
      ['BATCH-1', 'Dry Gilt'],
      ['BATCH-1', 'Lactate Z Line'],
      ['BATCH-1', 'Lactating Gilt'],
      ['BATCH-2', 'Dry Gilt'],
    ]);
    expect(pivoted.map((line) => line.batchStart)).toEqual([true, false, false, true]);
    expect(pivoted.map((line) => line.batchIndex)).toEqual([0, 0, 0, 1]);
  });

  it('marks the line whose feed a diet change starts, and no other', () => {
    const { pivoted } = pivotForecastRows(rows, [], 'CUSTOM', '2026-11-01', dietChanges);
    expect(pivoted.map((line) => line.dietChange?.toItemName ?? null)).toEqual([
      null, 'Lactate Z Line', 'Lactating Gilt', null,
    ]);
  });

  it('shows no diet change for a saved run that has none', () => {
    const { pivoted } = pivotForecastRows(rows, [], 'CUSTOM', '2026-11-01');
    expect(pivoted.every((line) => line.dietChange === null)).toBe(true);
  });
});
