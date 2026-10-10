import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  FeedForecastGrid,
  fmtKg,
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
      'ffColBatch', 'ffColStage', 'ffColHouse', 'ffColSiloCode', 'ffColSiloName', 'ffColRequiredFeedItem', 'ffColCurrentSiloItem',
      'ffColHeadCount', 'ffColFeedRate', 'ffColOpeningSystemBalance', 'ffColConfirmedReceipts',
      'ffColOpenTransfers', 'ffColPlannedFeedAdded', 'ffColPlannedFeedReference', 'ffColDailyUse',
      '23/09/26', 'ffColFirstShortage', 'ffColRecommendedQty', 'ffColDeliveryDate',
    ]);
    expect(GRID_COLUMNS).not.toContain('ffColStages');
  });

  it('shows identifiers only in No/Code columns and names only in entity/name columns', () => {
    render(<FeedForecastGrid rows={[row()]} sourceBalances={[point()]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    const cells = within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent);

    expect(cells.slice(0, 7)).toEqual([
      'WG-2026-38',
      'WEANER',
      'GRS/SHED-003',
      'GRS/SILO-001',
      'Weaner silo',
      'Weaner Diet R1',
      'Weaner Diet R1',
    ]);
    expect(cells).not.toContain('FEED-R1 — Weaner Diet R1');
  });

  it('shows a stage group\'s batch number alone and its stage in the Stage column (Rishi, 10 Oct)', () => {
    const grouped = row({
      batchGroupId: 'batch-1:st-ges', batchNo: 'BATCH-000001 · GESTATION', plainBatchNo: 'BATCH-000001',
      stageCode: 'GESTATION', stageName: 'Gestation', stageProjected: false,
    });
    const projected = row({
      key: 'projected', batchGroupId: 'batch-1:st-flush', batchNo: 'BATCH-000001 · LACTATION (Projected)', plainBatchNo: 'BATCH-000001',
      stageCode: 'LACTATION', stageName: null, stageProjected: true,
    });
    render(<FeedForecastGrid rows={[grouped, projected]} loading={false} t={t} />);
    const bodyRows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    const lead = bodyRows.map((r) => within(r).getAllByRole('cell').slice(0, 2).map((c) => c.textContent));
    expect(lead).toEqual([['BATCH-000001', 'Gestation'], ['BATCH-000001', 'ffStageProjected:{"stage":"LACTATION"}']]);
    expect(screen.queryByText(/ · /)).toBeNull();
  });

  it('uses human descriptions instead of blank or dash placeholders', () => {
    render(<FeedForecastGrid rows={[row({ sourceCode: null, sourceName: null, currentItemName: null, firstShortageDate: null, runDownDate: null, deliveryDate: null })]} loading={false} t={t} />);
    const cells = within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent);

    expect(cells).toEqual(expect.arrayContaining([
      'ffNoSource',
      'ffNoSourceName',
      'ffNoCurrentSiloItem',
      'ffNoShortageProjected',
      'ffNoDeliveryRequired',
    ]));
    expect(cells).not.toContain('—');
    expect(cells).not.toContain('-');
  });

  it('shows source balance points only while the calculation line has applicable demand', () => {
    const future = row({ itemId: 'r2', itemNo: 'FEED-R2', itemName: 'Grower R2', currentItemId: 'r2', currentItemNo: 'FEED-R2', currentItemName: 'Grower R2', date: '2026-09-26', dateTo: '2026-09-26' });
    const source = [
      point({ itemId: 'r2', itemNo: 'FEED-R2', itemName: 'Grower R2', currentItemId: 'r2', currentItemNo: 'FEED-R2', currentItemName: 'Grower R2', date: '2026-09-23', dailyUseKg: 0, projectedClosingBalanceKg: 1000 }),
      point({ itemId: 'r2', itemNo: 'FEED-R2', itemName: 'Grower R2', currentItemId: 'r2', currentItemNo: 'FEED-R2', currentItemName: 'Grower R2', date: '2026-09-24', dailyUseKg: 0, projectedClosingBalanceKg: 1000 }),
      point({ itemId: 'r2', itemNo: 'FEED-R2', itemName: 'Grower R2', currentItemId: 'r2', currentItemNo: 'FEED-R2', currentItemName: 'Grower R2', date: '2026-09-25', dailyUseKg: 0, projectedClosingBalanceKg: 1000 }),
      point({ itemId: 'r2', itemNo: 'FEED-R2', itemName: 'Grower R2', currentItemId: 'r2', currentItemNo: 'FEED-R2', currentItemName: 'Grower R2', date: '2026-09-26', dailyUseKg: 2500, projectedClosingBalanceKg: 0, runDownDate: '2026-09-26' }),
    ];

    const { pivoted, columns } = pivotForecastRows([future], source, 'DAILY', '2026-09-23');

    expect(columns.map((column) => column.key)).toEqual(['2026-09-26']);
    expect(columns.map((column) => pivoted[0].closingBySlot[column.key])).toEqual([0]);
  });

  it('does not leak a shared source balance or shortage dates into a different stage line', () => {
    const rows = [
      row({ date: '2026-09-23', dateTo: '2026-09-24', stageCode: 'WEANER', firstShortageDate: '2026-09-26', deliveryDate: '2026-09-24' }),
      row({ key: 'grower', date: '2026-09-25', dateTo: '2026-09-26', stageCode: 'GROWER', firstShortageDate: '2026-09-26', deliveryDate: '2026-09-24' }),
    ];
    const balances = [
      point({ date: '2026-09-23', projectedClosingBalanceKg: 600, firstShortageDate: '2026-09-26', deliveryDate: '2026-09-24' }),
      point({ date: '2026-09-24', projectedClosingBalanceKg: 400, firstShortageDate: '2026-09-26', deliveryDate: '2026-09-24' }),
      point({ date: '2026-09-25', projectedClosingBalanceKg: 200, firstShortageDate: '2026-09-26', deliveryDate: '2026-09-24' }),
      point({ date: '2026-09-26', projectedClosingBalanceKg: 0, firstShortageDate: '2026-09-26', deliveryDate: '2026-09-24' }),
    ];

    const { pivoted, columns } = pivotForecastRows(rows, balances, 'DAILY', '2026-09-23');
    const weaner = pivoted.find((entry) => entry.stageCode === 'WEANER')!;
    const grower = pivoted.find((entry) => entry.stageCode === 'GROWER')!;

    expect(columns.map((column) => column.key)).toEqual(['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
    expect(weaner.closingBySlot).toEqual({ '2026-09-23': 600, '2026-09-24': 400 });
    expect(weaner.firstShortageDate).toBeNull();
    expect(weaner.deliveryDate).toBeNull();
    expect(grower.closingBySlot).toEqual({ '2026-09-25': 200, '2026-09-26': 0 });
    expect(grower.firstShortageDate).toBe('2026-09-26');
    expect(grower.deliveryDate).toBe('2026-09-24');
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
      'WG-2026-38', 'WEANER', 'GRS/SHED-003', 'GRS/SILO-001', 'Weaner silo', 'Weaner Diet R1', 'Weaner Diet R1',
      '1,000', '2.00', '1,500.00', '0.00', '0.00', '0.00', 'ffNoPlannedFeed', '2,000.00', '0.00', '23/09/26', '4,500.00', '23/09/26',
    ]);
  });

  it('shows planned feed separately with the requisition reference on its delivery date', () => {
    render(<FeedForecastGrid rows={[row({
      plannedIncomingKg: 3000,
      incomingReferences: [{ kind: 'PLANNED_REQUISITION', referenceNo: 'REQ-GRA100-2026-00001', overdue: false }],
    })]} sourceBalances={[point()]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    expect(screen.getByText('3,000.00')).toBeTruthy();
    expect(screen.getByText('REQ-GRA100-2026-00001')).toBeTruthy();
  });

  it('shows planned incoming on the dated closing cell and explains the stock movement when clicked', async () => {
    render(<FeedForecastGrid
      rows={[row()]}
      sourceBalances={[point({
        openingSystemBalanceKg: 1500,
        plannedIncomingKg: 3000,
        dailyUseKg: 2000,
        projectedClosingBalanceKg: 2500,
        incomingReferences: [{ kind: 'PLANNED_REQUISITION', referenceNo: 'REQ-VIL100-2026-00005' }],
      })]}
      view="DAILY"
      from="2026-09-23"
      loading={false}
      t={t}
    />);

    expect(screen.getByText('+3,000.00 KG ffPlannedShort')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ffBalanceExplainAria:{"date":"23/09/26"}' }));
    expect(await screen.findByText('ffBalanceExplainBody')).toBeTruthy();
    expect(await screen.findByText('ffBalanceOpening:{"kg":"1,500.00"}')).toBeTruthy();
    expect(await screen.findByText('ffPlannedIncomingReference:{"references":"REQ-VIL100-2026-00005"}')).toBeTruthy();
  });

  it('uses human text for a non-finite quantity instead of NaN', () => {
    expect(fmtKg(Number.NaN)).toBe('Not available');
  });

  it('shows empty and loading states', () => {
    const { rerender } = render(<FeedForecastGrid rows={[]} sourceBalances={[]} loading={false} t={t} />);
    expect(screen.getByText('ffNoRows')).toBeTruthy();
    rerender(<FeedForecastGrid rows={[]} sourceBalances={[]} loading t={t} />);
    expect(screen.getByText('ffLoading')).toBeTruthy();
  });
});
