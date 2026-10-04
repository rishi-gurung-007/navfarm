import React from 'react';
import { render, screen, within } from '@testing-library/react';
import * as gridExports from '../src/components/console/inventory/feed-forecast-grid';
import {
  FeedForecastGrid, FeedForecastStages, GRID_COLUMNS, STAGE_COLUMNS, ReportRow, StageBlock, fmtKg, groupRows,
} from '../src/components/console/inventory/feed-forecast-grid';
import { addDaysIso, formatDateShort } from '../src/components/console/inventory/feed-format';

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  key: 'b|r1|GRS/SILO-001|2026-09-23', batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', stageCode: 'WEANER',
  itemId: 'r1', itemNo: 'FEED-R1', itemName: 'Weaner Diet R1', sourceType: 'SILO', sourceCode: 'GRS/SILO-001', sourceName: 'Weaner silo',
  date: '2026-09-23', dateTo: '2026-09-23', days: 1, currentInventoryKg: 1500, heads: 1000, perDayIntakeKg: 2000,
  intakeKg: 2000, daysOfStock: 0, sharedBatchCount: 1, indicative: false,
  runDownDate: '2026-09-23', ...over,
});

describe('feed-format date helpers (D16)', () => {
  it('formats DD/MM/YY and dashes anything unusable', () => {
    expect(formatDateShort('2026-09-23')).toBe('23/09/26');
    expect(formatDateShort(null)).toBe('—');
  });
  it('adds calendar days across a month end', () => {
    expect(addDaysIso('2026-09-28', 7)).toBe('2026-10-05');
  });
});

describe('FeedForecastGrid', () => {
  /**
   * D33 (Rishi, 28 Sep): exactly the field specification's twelve columns.
   * "Source" and "Feed incl. Wastage (Kg)" were ours, not the client's, and go
   * — and "Shared by N" went with Source, since it was a badge inside that cell.
   */
  it("shows exactly the static field specification columns plus dynamic date columns (D33)", () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent);
    // Static columns: Batch No, Item Name, Item No, Shed No, Current Inventory, Current Pigs, Per Day Intake,
    // then one or more dynamic date columns, then Days of Stock and First Shortage Date. Date to Refill, Required On
    // and Overdue left with the lead-time model (3 Oct ruling): the forecast no longer computes them.
    // Silo No and Silo Name follow Shed No (Engine §5 row 70: "farm, batch, house, silo, …"; Rishi 4 Oct).
    expect(headers.slice(0, 6)).toEqual(['ffColBatchNo', 'ffColItemName', 'ffColItemNo', 'ffColShedNo', 'ffColSiloNo', 'ffColSiloName']);
    expect(headers.slice(-2)).toEqual(['ffColDaysOfStock', 'ffColFirstShortage']);
    expect(headers).not.toContain('ffColDateToRefill');
    expect(headers).not.toContain('ffColRequiredOn');
    expect(headers).not.toContain('ffColRunDown');
    // The Planning Date column is gone — dates are now dynamic column headers (pivot table).
    expect(GRID_COLUMNS as readonly string[]).not.toContain('ffColPlanningDate');
  });

  // D33 (28 Sep) cut Source; Rishi 4 Oct restored it as silo code + silo name only. Wastage and Shared-by stay gone.
  it('carries no wastage column any more (D34); Source is back only as the silo number and name (Rishi 4 Oct)', () => {
    render(<FeedForecastGrid rows={[row({ sourceType: 'STORE', sourceCode: 'VIL100/STORE-001', sourceName: 'Main store', sharedBatchCount: 3 })]} loading={false} horizonTo="2026-11-07" t={t} />);
    expect(GRID_COLUMNS as readonly string[]).not.toContain('ffColSource');
    expect(GRID_COLUMNS as readonly string[]).not.toContain('ffColFeedOutKg');
    const table = screen.getByRole('table');
    expect(within(table).getByText('VIL100/STORE-001')).toBeTruthy();
    expect(within(table).getByText('Main store')).toBeTruthy();
    expect(within(table).queryByText(/ffSharedBy/)).toBeNull();
  });

  it('shows the silo code AND the silo name on each row, codes exactly as issued (Engine §5 row 70)', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const cells = within(screen.getByRole('table')).getAllByRole('row')[1].querySelectorAll('td');
    expect(cells[4].textContent).toBe('GRS/SILO-001');
    expect(cells[5].textContent).toBe('Weaner silo');
  });

  it('two silos feeding one batch and item are two rows, each with its own code, name and figures (no summing)', () => {
    const rows = [
      row({ key: 'a', sourceCode: 'GRS/SILO-001', sourceName: 'Weaner silo', currentInventoryKg: 1500, perDayIntakeKg: 700 }),
      row({ key: 'b', sourceCode: 'GRS/SILO-002', sourceName: 'Grower silo', currentInventoryKg: 400, perDayIntakeKg: 300 }),
    ];
    render(<FeedForecastGrid rows={rows} loading={false} horizonTo={null} t={t} />);
    const body = screen.getAllByRole('row').slice(1);
    expect(body).toHaveLength(2);
    const cell = (i: number) => within(body[i]).getAllByRole('cell').map((c) => c.textContent);
    expect(cell(0).slice(4, 9)).toEqual(['GRS/SILO-001', 'Weaner silo', '1,500', '1,000', '700']);
    expect(cell(1).slice(4, 9)).toEqual(['GRS/SILO-002', 'Grower silo', '400', '1,000', '300']);
  });

  it('leaves the silo cells empty when a row has no source', () => {
    render(<FeedForecastGrid rows={[row({ sourceType: 'NONE', sourceCode: null, sourceName: null })]} loading={false} horizonTo="2026-11-07" t={t} />);
    const cells = within(screen.getByRole('table')).getAllByRole('row')[1].querySelectorAll('td');
    expect([cells[4].textContent, cells[5].textContent]).toEqual(['', '']);
  });

  it('holds the header row and the Batch No and Item columns (sticky), and aligns numbers right', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0].getAttribute('data-sticky-col')).toBe('true');
    expect(headers[1].getAttribute('data-sticky-col')).toBe('last');
    expect(headers[2].hasAttribute('data-sticky-col')).toBe(false);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[0].getAttribute('data-sticky-col')).toBe('true');
    // Current Inventory is column 7 (0-indexed: Batch No, Item Name, Item No, Shed No, Silo No, Silo Name, Current Inventory).
    // The pivot table rounds inventory to the nearest whole number via fmtRound (not two decimals).
    expect(cells[6].textContent).toBe('1,500');
    expect(cells[6].className).toContain('text-right');
    expect(fmtKg(16.3)).toBe('16.30');
  });

  it('shows the Item No and DD/MM/YY dates: the date column header and the First Shortage Date', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('FEED-R1')).toBeTruthy();
    expect(within(table).getAllByText('23/09/26').length).toBe(2);
    expect(within(table).queryByText('ffOverdue')).toBeNull();
  });

  it('marks an indicative Days of Stock, in its new column position (D33)', () => {
    render(<FeedForecastGrid rows={[row({ indicative: true, daysOfStock: 93 })]} loading={false} horizonTo={null} t={t} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(within(cells[10]).getByText('93.0')).toBeTruthy();
    expect(within(cells[10]).getByText('ffIndicative')).toBeTruthy();
    expect(cells[10].textContent).toBe('ffIndicative93.0');
  });

  it('shows Days of Stock with one decimal (3 Oct ruling)', () => {
    const days = (daysOfStock: number | null) => {
      const { unmount } = render(<FeedForecastGrid rows={[row({ daysOfStock })]} loading={false} horizonTo={null} t={t} />);
      const text = within(screen.getAllByRole('row')[1]).getAllByRole('cell')[10].textContent;
      unmount();
      return text;
    };
    expect(days(2.5)).toBe('2.5');
    expect(days(0)).toBe('0.0');
    expect(days(6.04)).toBe('6.0');
  });

  it('puts the dates across as columns, one row per batch + item + shed, with no placeholder dashes in the grid body (2 Oct patch intent)', () => {
    const rows = [
      row({ date: '2026-09-23', dateTo: '2026-09-23', runDownDate: null, daysOfStock: null, itemNo: '', shedCode: '' }),
      row({ key: 'k2', date: '2026-09-24', dateTo: '2026-09-24', runDownDate: null, daysOfStock: null, itemNo: '', shedCode: '' }),
      // A second item has demand on the 24th only, so its 23rd slot has no entry.
      row({ key: 'k3', itemId: 'r2', itemName: 'Weaner Diet R2', date: '2026-09-24', dateTo: '2026-09-24', runDownDate: null, daysOfStock: null }),
    ];
    render(<FeedForecastGrid rows={rows} loading={false} horizonTo={null} t={t} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['23/09/26', '24/09/26']));
    const body = screen.getAllByRole('row').slice(1);
    expect(body).toHaveLength(2);
    const second = within(body[1]).getAllByRole('cell');
    expect(second[9].textContent).toBe(''); // no 23rd entry: blank, not a dash
    const texts = body.flatMap((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(texts).not.toContain('—');
  });

  it("shows a grouped line's single date column and a blank First Shortage Date when none is forecast", () => {
    // A single daily row: the pivot produces one date column header (23/09/26) and one data row.
    render(<FeedForecastGrid rows={[row({ runDownDate: null })]} loading={false} horizonTo="2026-11-07" t={t} />);
    expect(screen.getByText('23/09/26')).toBeTruthy(); // the date column header
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[cells.length - 1].textContent).toBe('');
    expect(screen.queryByText(/ffBeyondHorizon|ffNotDueBy/)).toBeNull();
  });

  it('produces one pivot row per batch+item group and shades every second row', () => {
    // Two daily rows for the same batch+item group (b|r1) become ONE pivot row.
    // A third row for a different item (r2) becomes a second pivot row — shaded.
    const rows = [row(), row({ key: 'k2', date: '2026-09-24' }), row({ key: 'k3', itemId: 'r2', itemName: 'Weaner Diet R2' })];
    render(<FeedForecastGrid rows={rows} loading={false} horizonTo={null} t={t} />);
    const body = screen.getAllByRole('row').slice(1); // exclude header
    // Pivot collapses the two b|r1 rows into one, plus one for r2 = 2 data rows total.
    expect(body).toHaveLength(2);
    expect(body[0].getAttribute('data-group-alt')).toBeNull();
    expect(body[1].getAttribute('data-group-alt')).toBe('true');
  });

  it('shows an empty state and a loading state', () => {
    const { rerender } = render(<FeedForecastGrid rows={[]} loading={false} horizonTo={null} t={t} />);
    expect(screen.getByText(/ffNoRows/)).toBeTruthy();
    rerender(<FeedForecastGrid rows={[]} loading horizonTo={null} t={t} />);
    expect(screen.getByText(/ffLoading/)).toBeTruthy();
  });

  it('titles Days of Stock and First Shortage Date with what each counts to', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo={null} t={t} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.find((h) => h.textContent === 'ffColDaysOfStock')!.getAttribute('title')).toBe('ffDaysOfStockHint');
    expect(headers.find((h) => h.textContent === 'ffColFirstShortage')!.getAttribute('title')).toBe('ffFirstShortageHint');
  });
});

describe('wastageNote (D34)', () => {
  it('is gone: the screen no longer states a wastage allowance', () => {
    expect((gridExports as Record<string, unknown>).wastageNote).toBeUndefined();
  });
});

describe('FeedForecastStages — a table, not stacked cards (review C, A6)', () => {
  const block: StageBlock = {
    batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', currentStageCode: 'WEANER', currentFrom: '2026-08-01', currentTo: '2026-09-11',
    nextStageCode: 'GROWER', nextFrom: '2026-09-12', nextTo: '2026-11-06', stageChangeEarliest: null, stageChangeDate: '2026-09-12', stageChangeOverdue: true,
  };

  it('shows an event-based stage change as the window earliest – latest (expected) (D36)', () => {
    render(<FeedForecastStages stages={[{ ...block, stageChangeEarliest: '2026-09-10' }]} t={t} />);
    const cell = within(screen.getAllByRole('row')[1]).getAllByRole('cell')[6];
    expect(cell.textContent).toBe('10/09/26 – 12/09/26 (ffChangeExpected)ffStageChangeNotPosted');
  });

  it('lists batch, current stage, from, to, next stage and change date, with a not-posted mark', () => {
    render(<FeedForecastStages stages={[block]} t={t} />);
    const table = screen.getByRole('table', { name: 'ffStagesTitle' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([...STAGE_COLUMNS]);
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['WG-2026-38', 'GRS/SHED-003', 'WEANER', '01/08/26', '11/09/26', 'GROWER', '12/09/26ffStageChangeNotPosted']);
  });

  it('shows a dash, never "( – —)", where a stage has no length or no successor (A6)', () => {
    render(<FeedForecastStages stages={[{ ...block, currentTo: null, nextStageCode: null, nextFrom: null, nextTo: null, stageChangeDate: null, stageChangeOverdue: false }]} t={t} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(4)).toEqual(['—', '—', '—']);
  });

  it('renders both rows of a batch with two concurrent stages, and an empty state', () => {
    const shared = { ...block, batchNo: 'BATCH-000010', nextStageCode: null, nextFrom: null, nextTo: null, stageChangeEarliest: null, stageChangeDate: null, stageChangeOverdue: false };
    const { rerender } = render(<FeedForecastStages stages={[{ ...shared, currentStageCode: 'GESTATION' }, { ...shared, currentStageCode: 'LACTATION' }]} t={t} />);
    expect(screen.getAllByText('BATCH-000010')).toHaveLength(2);
    rerender(<FeedForecastStages stages={[]} t={t} />);
    expect(screen.getByText('ffNoStages')).toBeTruthy();
  });
});
