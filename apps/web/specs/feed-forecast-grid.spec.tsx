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
  sourceType: 'SILO', sourceCode: 'GRS/SILO-001', sourceName: 'Weaner silo', sourceCapacityKg: 8000, sourceLocationId: 'silo-1', feedType: 'BULK',
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
      'ffColBatch', 'ffColStage', 'ffColHouse', 'ffColSiloCode', 'ffColSiloName', 'ffColSiloCapacity', 'ffColRequiredFeedItem', 'ffColDietChangeDate', 'ffColCurrentSiloItem',
      'ffColHeadCount', 'ffColUom', 'ffColFeedRate', 'ffColOpeningSystemBalance', 'ffColConfirmedReceipts',
      'ffColOpenTransfers', 'ffColPlannedFeedAdded', 'ffColPlannedFeedReference', 'ffColDailyUse',
      '23/09/26', 'ffColFirstShortage', 'ffColRecommendedQty', 'ffColDeliveryDate',
    ]);
    expect(GRID_COLUMNS).not.toContain('ffColStages');
  });

  it('shows identifiers only in No/Code columns and names only in entity/name columns', () => {
    render(<FeedForecastGrid rows={[row()]} sourceBalances={[point()]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    const cells = within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent);

    expect(cells.slice(0, 9)).toEqual([
      'WG-2026-38',
      'WEANER',
      'GRS/SHED-003',
      'GRS/SILO-001',
      'Weaner silo',
      '8,000.00',
      'Weaner Diet R1',
      'N/A',
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
    // Rishi, 30 Oct: one batch's lines sit together and only the first shows its number.
    expect(lead).toEqual([['BATCH-000001', 'Gestation'], ['', 'ffStageProjected:{"stage":"LACTATION"}']]);
    expect(screen.queryByText(/ · /)).toBeNull();
  });

  it('shows N/A, not blank, on a date the line needs no feed, and says why on hover (Rishi, 30 Oct)', () => {
    // Line 1 is fed on the 23rd only; line 2 starts on the 24th. Each is N/A on the other's date.
    const first = row({ date: '2026-09-23', dateTo: '2026-09-23' });
    const second = row({ key: 'two', itemId: 'r2', itemName: 'Weaner Diet R2', sourceCode: 'GRS/SILO-002', sourceLocationId: 'silo-2', date: '2026-09-24', dateTo: '2026-09-24' });
    const balances = [
      point({ date: '2026-09-23' }),
      point({ date: '2026-09-24', itemId: 'r2', sourceCode: 'GRS/SILO-002', locationId: 'silo-2', projectedClosingBalanceKg: 300 }),
    ];
    render(<FeedForecastGrid rows={[first, second]} sourceBalances={balances} view="CUSTOM" from="2026-09-23" loading={false} t={t} />);
    const notRequired = document.querySelectorAll('td[data-not-required="true"]');
    expect(notRequired).toHaveLength(2);
    notRequired.forEach((cell) => {
      expect(cell.textContent).toBe('N/A');
      expect(cell.querySelector('button')).toBeNull();
    });
    // The reason shows on hover and on keyboard focus, outside the scrolling table.
    const na = notRequired[0].querySelector('[data-hint]') as HTMLElement;
    fireEvent.mouseEnter(na);
    expect(screen.getByRole('tooltip').textContent).toBe('ffFeedNotRequiredOnDate');
    fireEvent.mouseLeave(na);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(na);
    expect(na.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  });

  it('says why Silo Capacity and Diet Change Date read N/A (Rishi, 30 Oct)', () => {
    render(<FeedForecastGrid rows={[row({ sourceType: 'STORE', sourceCapacityKg: null })]} sourceBalances={[point()]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    const hints = [...document.querySelectorAll('[data-hint]')].map((el) => el.getAttribute('data-hint'));
    expect(hints).toEqual(expect.arrayContaining(['ffNaStoreNoCapacity', 'ffNaNoDietChange']));
  });

  it('shows the Diet Change Date on the line the new feed starts, with the change on hover, and N/A elsewhere (Rishi, 30 Oct)', () => {
    const before = row({ date: '2026-09-23', dateTo: '2026-09-23' });
    const after = row({ key: 'next', itemId: 'r2', itemName: 'Weaner Diet R2', date: '2026-09-24', dateTo: '2026-09-24' });
    render(<FeedForecastGrid rows={[before, after]} sourceBalances={[point()]} view="CUSTOM" from="2026-09-23" loading={false} t={t}
      dietChanges={[{ batchId: 'group-1', fromItemId: 'r1', fromItemName: 'Weaner Diet R1', toItemId: 'r2', toItemName: 'Weaner Diet R2', changeDate: '2026-09-24', nextSourceType: 'SILO', nextSourceCode: 'GRS/SILO-001' }]} />);
    const column = within(screen.getByRole('table')).getAllByRole('columnheader').findIndex((h) => h.textContent === 'ffColDietChangeDate');
    const [first, second] = within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[column]);
    expect(first.textContent).toBe('N/A');
    expect(second.textContent).toBe('24/09/26');
    expect(second.getAttribute('title')).toContain('Weaner Diet R1');
    expect(second.getAttribute('title')).toContain('Weaner Diet R2');
  });

  it('words a weekly column and its balance as a week, not a day (Rishi, 30 Oct)', () => {
    render(<FeedForecastGrid rows={[row()]} sourceBalances={[point()]} view="WEEKLY" from="2026-09-23" loading={false} t={t} />);
    const dated = within(screen.getByRole('table')).getAllByRole('columnheader').find((h) => h.textContent?.includes('–'))!;
    expect(dated.getAttribute('title')).toContain('ffProjectedClosingWeek');
    fireEvent.click(screen.getByRole('button', { name: /ffBalanceExplainAria/ }));
    expect(screen.getByText(/ffWeekUseShort/)).toBeTruthy();
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
      'WG-2026-38', 'WEANER', 'GRS/SHED-003', 'GRS/SILO-001', 'Weaner silo', '8,000.00', 'Weaner Diet R1', 'N/A', 'Weaner Diet R1',
      '1,000', 'KG', '2.00', '1,500.00', '0.00', '0.00', '0.00', 'ffNoPlannedFeed', '2,000.00', '0.00', '23/09/26', '4,500.00', '23/09/26',
    ]);
  });

  it('shows Silo Capacity only for a row fed from a silo', () => {
    render(<FeedForecastGrid rows={[row({ sourceType: 'STORE', sourceCode: 'GRS/STORE', sourceName: 'Farm store', sourceCapacityKg: null })]} sourceBalances={[point()]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells[5]).toBe('N/A');
  });

  it('shows planned feed separately with the requisition reference on its delivery date', () => {
    render(<FeedForecastGrid rows={[row({
      plannedIncomingKg: 3000,
      incomingReferences: [{ kind: 'PLANNED_REQUISITION', referenceNo: 'REQ-GRA100-2026-00001', overdue: false }],
    })]} sourceBalances={[point()]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    expect(screen.getByText('3,000.00')).toBeTruthy();
    expect(screen.getByText('REQ-GRA100-2026-00001')).toBeTruthy();
  });

  it('W5B: the balance dialog lists an open transfer once, not as both expected and open transfer', async () => {
    render(<FeedForecastGrid rows={[row()]} sourceBalances={[point({ openTransferKg: 800, openTransferMovementKg: 800 } as any)]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    fireEvent.click(screen.getByRole('button', { name: 'ffBalanceExplainAria:{"date":"23/09/26"}' }));
    expect(await screen.findByText('ffBalanceExplainBody')).toBeTruthy();
    expect(screen.queryAllByText(/^\+ 800\.00 KG ffExpectedTransferShort/)).toHaveLength(1);
    expect(screen.queryByText(/ffOpenTransferShort/)).toBeNull();
  });

  it('W5B (Silo r8, checkpoint 37): the balance dialog says System Balance for opening and closing', () => {
    const { translations } = require('../src/utils/translations');
    expect(translations.en.ffBalanceOpening).toMatch(/System Balance/);
    expect(translations.en.ffClosingBalanceShort).toMatch(/System Balance/);
    expect(translations.en.ffBalanceOpening).not.toMatch(/opening stock/i);
    expect(translations.en.ffClosingBalanceShort).not.toMatch(/closing stock/i);
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

    // 11 Oct: no second line in the cell; the balance is coloured and the
    // movement is itemised only in the dialog.
    expect(screen.queryByText('+3,000.00 KG ffPlannedShort')).toBeNull();
    const cell = screen.getByRole('button', { name: 'ffBalanceExplainAria:{"date":"23/09/26"}' });
    expect(cell.querySelector('[data-incoming="true"]')?.textContent).toBe('2,500.00');
    fireEvent.click(cell);
    expect(await screen.findByText('+ 3,000.00 KG ffPlannedShort')).toBeTruthy();
    expect(await screen.findByText('ffBalanceExplainBody')).toBeTruthy();
    expect(await screen.findByText('ffBalanceOpening:{"kg":"1,500.00"}')).toBeTruthy();
    expect(await screen.findByText('ffPlannedIncomingReference:{"references":"REQ-VIL100-2026-00005"}')).toBeTruthy();
  });

  // Rishi, 12 Oct: no negative quantity in the calculation. A negative adjustment or transfer out is a separate
  // non-negative outflow, explained in the dialog and not a grid column.
  it('the balance dialog explains other stock movements as a subtraction, and shows no negative receipt', async () => {
    render(<FeedForecastGrid
      rows={[row()]}
      sourceBalances={[point({ openingSystemBalanceKg: 9900, confirmedReceiptKg: 0, otherOutflowKg: 5900, dailyUseKg: 100, projectedClosingBalanceKg: 3900 })]}
      view="DAILY" from="2026-09-23" loading={false} t={t}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'ffBalanceExplainAria:{"date":"23/09/26"}' }));
    expect(await screen.findByText('− 5,900.00 KG ffOtherMovementsShort')).toBeTruthy();
    expect(screen.queryByText(/ffConfirmedReceiptShort/)).toBeNull();
    expect(screen.queryByText(/-5,900/)).toBeNull();
    expect(GRID_COLUMNS).not.toContain('ffColOtherOutflow');
  });

  it('the balance dialog shows feed used before it was received on its own line, apart from the adjustments line', async () => {
    render(<FeedForecastGrid
      rows={[row()]}
      sourceBalances={[point({ openingSystemBalanceKg: 0, confirmedReceiptKg: 40000, otherOutflowKg: 4300, usedBeforeReceivedKg: 4200, dailyUseKg: 100, projectedClosingBalanceKg: 35600 })]}
      view="DAILY" from="2026-09-23" loading={false} t={t}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'ffBalanceExplainAria:{"date":"23/09/26"}' }));
    expect(await screen.findByText('− 4,200.00 KG ffUsedBeforeReceivedShort')).toBeTruthy();
    expect(screen.getByText('− 100.00 KG ffOtherMovementsShort')).toBeTruthy();
  });

  it('only the used-before-received line appears when the whole outflow is that deficit', async () => {
    render(<FeedForecastGrid rows={[row()]} sourceBalances={[point({ openingSystemBalanceKg: 0, confirmedReceiptKg: 40000, otherOutflowKg: 4200, usedBeforeReceivedKg: 4200 })]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    fireEvent.click(screen.getByRole('button', { name: 'ffBalanceExplainAria:{"date":"23/09/26"}' }));
    expect(await screen.findByText('− 4,200.00 KG ffUsedBeforeReceivedShort')).toBeTruthy();
    expect(screen.queryByText(/ffOtherMovementsShort/)).toBeNull();
  });

  it('the balance dialog omits the other-movements line when there is none', async () => {
    render(<FeedForecastGrid rows={[row()]} sourceBalances={[point({ otherOutflowKg: 0 })]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    fireEvent.click(screen.getByRole('button', { name: 'ffBalanceExplainAria:{"date":"23/09/26"}' }));
    expect(await screen.findByText('ffBalanceExplainBody')).toBeTruthy();
    expect(screen.queryByText(/ffOtherMovementsShort/)).toBeNull();
  });

  it('adds other outflows across a weekly bucket and never shows a negative opening or receipt (older saved runs)', () => {
    const { pivoted } = pivotForecastRows(
      [row({ date: '2026-09-23', dateTo: '2026-09-25', days: 3 })],
      [
        point({ date: '2026-09-23', openingSystemBalanceKg: -471.74, confirmedReceiptKg: -5900, otherOutflowKg: 100 }),
        point({ date: '2026-09-24', openingSystemBalanceKg: 0, otherOutflowKg: 250 }),
      ],
      'WEEKLY', '2026-09-23',
    );
    const cell = Object.values(pivoted[0].balanceBySlot)[0];
    expect(cell).toMatchObject({ openingKg: 0, confirmedReceiptKg: 0, otherOutflowKg: 350 });
  });

  it('W2D W7: links batch, house, silo, required and current item, and the planned requisition reference', () => {
    render(<FeedForecastGrid rows={[row({
      currentItemId: 'r0', currentItemName: 'Weaner Diet R0',
      plannedIncomingKg: 3000,
      incomingReferences: [{ kind: 'PLANNED_REQUISITION', referenceId: 'req-9', referenceNo: 'FRQ-0009', expectedDate: '2026-09-23' }],
    })]} sourceBalances={[point()]} view="DAILY" from="2026-09-23" loading={false} t={t} />);
    const table = screen.getByRole('table');
    const href = (name: string) => within(table).getByRole('link', { name }).getAttribute('href');
    expect(href('WG-2026-38')).toBe('/batches/entry?batchId=batch-1');
    expect(href('GRS/SHED-003')).toBe('/master-data/location?recordId=shed-1');
    expect(href('GRS/SILO-001')).toBe('/master-data/location?recordId=silo-1');
    expect(href('Weaner Diet R1')).toBe('/master-data/item?recordId=r1');
    expect(href('Weaner Diet R0')).toBe('/master-data/item?recordId=r0');
    expect(href('FRQ-0009')).toBe('/inventory/feed-forecast?tab=feed-requisition&id=req-9');
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
