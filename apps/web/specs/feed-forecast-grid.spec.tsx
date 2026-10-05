import React from 'react';
import { render, screen, within } from '@testing-library/react';
import {
  FeedForecastGrid,
  GRID_COLUMNS,
  type ReportRow,
  type SourceBalancePoint,
  pivotForecastRows,
} from '../src/components/console/inventory/feed-forecast-grid';
import { addDaysIso, formatDateShort } from '../src/components/console/inventory/feed-format';

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  key: 'group|r1|silo-1|2026-09-23', farmId: 'farm-1', batchId: 'batch-1', batchGroupId: 'group-1',
  batchNo: 'WG-2026-38', shedId: 'shed-1', shedCode: 'GRS/SHED-003', stageCode: 'WEANER',
  itemId: 'r1', itemNo: 'FEED-R1', itemName: 'Weaner Diet R1', currentItemId: 'r1', currentItemNo: 'FEED-R1', currentItemName: 'Weaner Diet R1',
  sourceType: 'SILO', sourceCode: 'GRS/SILO-001', sourceName: 'Weaner silo', sourceLocationId: 'silo-1', feedType: 'BULK',
  date: '2026-09-23', dateTo: '2026-09-23', days: 1, currentInventoryKg: 1500, openingSystemBalanceKg: 1500,
  confirmedReceiptsKg: 0, heads: 1000, feedRateKg: 2, perDayIntakeKg: 2000, intakeKg: 2000, dailyUseKg: 2000,
  projectedClosingBalanceKg: 0, recommendedQtyKg: 4500, firstShortageDate: '2026-09-23', deliveryDate: '2026-09-23',
  daysOfStock: 0.8, sharedBatchCount: 1, indicative: false, runDownDate: '2026-09-23', ...over,
});

const point = (over: Partial<SourceBalancePoint> = {}): SourceBalancePoint => ({
  date: '2026-09-23', sourceType: 'SILO', sourceCode: 'GRS/SILO-001', sourceName: 'Weaner silo', locationId: 'silo-1',
  itemId: 'r1', itemNo: 'FEED-R1', itemName: 'Weaner Diet R1', currentItemId: 'r1', currentItemNo: 'FEED-R1', currentItemName: 'Weaner Diet R1',
  openingSystemBalanceKg: 1500, confirmedReceiptKg: 0, dailyUseKg: 2000, projectedClosingBalanceKg: 0,
  recommendedQtyKg: 4500, firstShortageDate: '2026-09-23', deliveryDate: '2026-09-23', runDownDate: '2026-09-23', ...over,
});

describe('feed-format date helpers', () => {
  it('formats DD/MM/YY and adds calendar days across a month end', () => {
    expect(formatDateShort('2026-09-23')).toBe('23/09/26');
    expect(addDaysIso('2026-09-28', 7)).toBe('2026-10-05');
  });
});

describe('FeedForecastGrid — Engine row 70', () => {
  it('shows the exact static row-70 fields around dated projected-closing columns', () => {
    render(<FeedForecastGrid rows={[row()]} sourceBalances={[point()]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((header) => header.textContent);

    expect(headers).toEqual([
      'ffColBatch', 'ffColHouse', 'ffColSiloCode', 'ffColSiloName', 'ffColRequiredFeedItem', 'ffColCurrentSiloItem',
      'ffColHeadCount', 'ffColFeedRate', 'ffColOpeningSystemBalance', 'ffColConfirmedReceipts', 'ffColDailyUse',
      '23/09/26', 'ffColFirstShortage', 'ffColRecommendedQty', 'ffColDeliveryDate',
    ]);
    expect(GRID_COLUMNS).not.toContain('ffColStages');
  });

  it('uses source balance points for no-demand dates before a future diet begins', () => {
    const future = row({ itemId: 'r2', itemNo: 'FEED-R2', itemName: 'Grower R2', currentItemId: 'r2', currentItemNo: 'FEED-R2', currentItemName: 'Grower R2', date: '2026-09-26', dateTo: '2026-09-26' });
    const source = [
      point({ itemId: 'r2', itemNo: 'FEED-R2', itemName: 'Grower R2', currentItemId: 'r2', currentItemNo: 'FEED-R2', currentItemName: 'Grower R2', date: '2026-09-23', dailyUseKg: 0, projectedClosingBalanceKg: 1000 }),
      point({ itemId: 'r2', itemNo: 'FEED-R2', itemName: 'Grower R2', currentItemId: 'r2', currentItemNo: 'FEED-R2', currentItemName: 'Grower R2', date: '2026-09-24', dailyUseKg: 0, projectedClosingBalanceKg: 1000 }),
      point({ itemId: 'r2', itemNo: 'FEED-R2', itemName: 'Grower R2', currentItemId: 'r2', currentItemNo: 'FEED-R2', currentItemName: 'Grower R2', date: '2026-09-25', dailyUseKg: 0, projectedClosingBalanceKg: 1000 }),
      point({ itemId: 'r2', itemNo: 'FEED-R2', itemName: 'Grower R2', currentItemId: 'r2', currentItemNo: 'FEED-R2', currentItemName: 'Grower R2', date: '2026-09-26', dailyUseKg: 2500, projectedClosingBalanceKg: 0, runDownDate: '2026-09-26' }),
    ];

    const { pivoted, columns } = pivotForecastRows([future], source, 'DAILY', '2026-09-23');

    expect(columns.map((column) => column.key)).toEqual(['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
    expect(columns.map((column) => pivoted[0].closingBySlot[column.key])).toEqual([1000, 1000, 1000, 0]);
  });

  it('uses the last source point in each seven-day bucket for WEEKLY closing balance', () => {
    const source = Array.from({ length: 10 }, (_, index) => point({
      date: addDaysIso('2026-09-23', index), projectedClosingBalanceKg: 900 - index * 100, runDownDate: '2026-10-02',
    }));
    const { pivoted, columns } = pivotForecastRows([row({ dateTo: '2026-10-02', runDownDate: '2026-10-02' })], source, 'WEEKLY', '2026-09-23');

    expect(columns.map((column) => column.key)).toEqual(['2026-09-23', '2026-09-30']);
    expect(columns.map((column) => pivoted[0].closingBySlot[column.key])).toEqual([300, 0]);
  });

  it('does not sum a shared silo closing balance across two batch rows', () => {
    const sharedRows = [row(), row({ key: 'second', batchId: 'batch-2', batchGroupId: 'group-2', batchNo: 'WG-2026-39' })];
    const { pivoted } = pivotForecastRows(sharedRows, [point({ projectedClosingBalanceKg: 800, runDownDate: null })], 'DAILY', '2026-09-23');

    expect(pivoted).toHaveLength(2);
    expect(pivoted.map((entry) => entry.closingBySlot['2026-09-23'])).toEqual([800, 800]);
  });

  it('renders daily records for the same batch, stage, item and source as one forecast row', () => {
    const dailyRows = [
      row(),
      row({
        key: 'group|r1|silo-1|2026-09-24',
        date: '2026-09-24',
        dateTo: '2026-09-24',
        openingSystemBalanceKg: 0,
        projectedClosingBalanceKg: 0,
      }),
    ];
    const balances = [
      point({ date: '2026-09-23', projectedClosingBalanceKg: 500 }),
      point({ date: '2026-09-24', projectedClosingBalanceKg: 0 }),
    ];

    const { pivoted, columns } = pivotForecastRows(dailyRows, balances, 'DAILY', '2026-09-23');

    expect(pivoted).toHaveLength(1);
    expect(columns.map((column) => column.key)).toEqual(['2026-09-23', '2026-09-24']);
    expect(columns.map((column) => pivoted[0].closingBySlot[column.key])).toEqual([500, 0]);
    expect(pivoted[0].date).toBe('2026-09-23');
    expect(pivoted[0].dateTo).toBe('2026-09-24');
  });

  it('renders required and current feed items, quantities and dates from the contract', () => {
    render(<FeedForecastGrid rows={[row()]} sourceBalances={[point()]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells).toEqual([
      'WG-2026-38', 'GRS/SHED-003', 'GRS/SILO-001', 'Weaner silo', 'FEED-R1 — Weaner Diet R1', 'FEED-R1 — Weaner Diet R1',
      '1,000', '2.00', '1,500.00', '0.00', '2,000.00', '0.00', '23/09/26', '4,500.00', '23/09/26',
    ]);
  });

  it('shows empty and loading states', () => {
    const { rerender } = render(<FeedForecastGrid rows={[]} sourceBalances={[]} loading={false} t={t} />);
    expect(screen.getByText('ffNoRows')).toBeTruthy();
    rerender(<FeedForecastGrid rows={[]} sourceBalances={[]} loading t={t} />);
    expect(screen.getByText('ffLoading')).toBeTruthy();
  });
});
