import React from 'react';
import { render, screen, within } from '@testing-library/react';
import {
  FeedForecastGrid, FeedForecastStages, GRID_COLUMNS, STAGE_COLUMNS, ReportRow, StageBlock, fmtKg, groupRows, wastageNote,
} from '../src/components/console/inventory/feed-forecast-grid';
import { addDaysIso, formatDateShort } from '../src/components/console/inventory/feed-format';

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  key: 'b|r1|GRS/SILO-001|2026-09-23', batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', stageCode: 'WEANER',
  itemId: 'r1', itemNo: 'FEED-R1', itemName: 'Weaner Diet R1', sourceType: 'SILO', sourceCode: 'GRS/SILO-001',
  date: '2026-09-23', dateTo: '2026-09-23', days: 1, currentInventoryKg: 1500, heads: 1000, perDayIntakeKg: 2000, wastagePct: 0,
  intakeKg: 2000, demandKg: 2000, daysOfStock: 0, sharedBatchCount: 1, indicative: false,
  runDownDate: '2026-09-23', refillDate: '2026-09-21', requiredOn: '2026-09-19', overdue: true, ...over,
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
  it("keeps the field specification's 14 columns in order", () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([...GRID_COLUMNS]);
    expect(GRID_COLUMNS).toHaveLength(14);
  });

  it('holds the header row and the Batch No and Item columns (sticky), and aligns numbers right with two decimals', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0].getAttribute('data-sticky-col')).toBe('true');
    expect(headers[1].getAttribute('data-sticky-col')).toBe('last');
    expect(headers[2].hasAttribute('data-sticky-col')).toBe(false);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[0].getAttribute('data-sticky-col')).toBe('true');
    expect(cells[6].textContent).toBe('1,500.00');
    expect(cells[6].className).toContain('text-right');
    expect(fmtKg(16.3)).toBe('16.30');
  });

  it('shows the Item No, DD/MM/YY dates and an Overdue badge', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('FEED-R1')).toBeTruthy();
    expect(within(table).getAllByText('23/09/26').length).toBe(2);
    expect(within(table).getByText('21/09/26')).toBeTruthy();
    expect(within(table).getByText('ffOverdue')).toBeTruthy();
  });

  it('puts "shared by N" as a badge in the Source cell, worded for a store as well as a silo (A7)', () => {
    render(<FeedForecastGrid rows={[row({ sourceType: 'STORE', sourceCode: 'VIL100/STORE-001', sharedBatchCount: 3, indicative: true, daysOfStock: 93 })]} loading={false} horizonTo={null} t={t} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(within(cells[5]).getByText('ffSharedBy:{"count":3}')).toBeTruthy();
    expect(screen.queryByText(/ffSharedSilo/)).toBeNull();
    expect(within(cells[9]).getByText('93')).toBeTruthy();
    expect(within(cells[9]).getByText('ffIndicative')).toBeTruthy();
  });

  it("shows a grouped line's dates and says the stock lasts past the horizon when nothing runs down", () => {
    render(<FeedForecastGrid rows={[row({ days: 3, dateTo: '2026-09-25', runDownDate: null, refillDate: null, requiredOn: null, overdue: false })]} loading={false} horizonTo="2026-11-07" t={t} />);
    expect(screen.getByText('23/09/26 – 25/09/26')).toBeTruthy();
    expect(screen.getByText('ffBeyondHorizon:{"date":"07/11/26"}')).toBeTruthy();
    // D29: Date to Refill and Required On say nothing is due, not a bare dash.
    expect(screen.getAllByText('ffNotDueBy:{"date":"07/11/26"}')).toHaveLength(2);
    expect(screen.queryByText('ffOverdue')).toBeNull();
  });

  it('marks where each batch + item group starts and shades every second group', () => {
    const rows = [row(), row({ key: 'k2', date: '2026-09-24' }), row({ key: 'k3', itemId: 'r2', itemName: 'Weaner Diet R2' })];
    expect(groupRows(rows).map((g) => [g.start, g.alt])).toEqual([[true, false], [false, false], [true, true]]);
    render(<FeedForecastGrid rows={rows} loading={false} horizonTo={null} t={t} />);
    const body = screen.getAllByRole('row').slice(1);
    expect(body.map((r) => r.getAttribute('data-group-start'))).toEqual(['true', null, 'true']);
    expect(body[2].getAttribute('data-group-alt')).toBe('true');
  });

  it('shows an empty state and a loading state', () => {
    const { rerender } = render(<FeedForecastGrid rows={[]} loading={false} horizonTo={null} t={t} />);
    expect(screen.getByText(/ffNoRows/)).toBeTruthy();
    rerender(<FeedForecastGrid rows={[]} loading horizonTo={null} t={t} />);
    expect(screen.getByText(/ffLoading/)).toBeTruthy();
  });

  it('titles Days of Stock and Run-Down with what each counts to', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo={null} t={t} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers.find((h) => h.textContent === 'ffColDaysOfStock')!.getAttribute('title')).toBe('ffDaysOfStockHint');
    expect(headers.find((h) => h.textContent === 'ffColRunDown')!.getAttribute('title')).toBe('ffRunDownHint');
  });
});

describe('wastageNote (D17)', () => {
  it('names each allowance used, or says there is none', () => {
    expect(wastageNote([row({ wastagePct: 5 }), row({ wastagePct: 2.5 }), row({ wastagePct: 5 })], t)).toBe('ffWastageUsed:{"pcts":"2.5%, 5%"}');
    expect(wastageNote([row()], t)).toBe('ffWastageNone');
  });
});

describe('FeedForecastStages — a table, not stacked cards (review C, A6)', () => {
  const block: StageBlock = {
    batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', currentStageCode: 'WEANER', currentFrom: '2026-08-01', currentTo: '2026-09-11',
    nextStageCode: 'GROWER', nextFrom: '2026-09-12', nextTo: '2026-11-06', stageChangeDate: '2026-09-12', stageChangeOverdue: true,
  };

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
    const shared = { ...block, batchNo: 'BATCH-000010', nextStageCode: null, nextFrom: null, nextTo: null, stageChangeDate: null, stageChangeOverdue: false };
    const { rerender } = render(<FeedForecastStages stages={[{ ...shared, currentStageCode: 'GESTATION' }, { ...shared, currentStageCode: 'LACTATION' }]} t={t} />);
    expect(screen.getAllByText('BATCH-000010')).toHaveLength(2);
    rerender(<FeedForecastStages stages={[]} t={t} />);
    expect(screen.getByText('ffNoStages')).toBeTruthy();
  });
});
