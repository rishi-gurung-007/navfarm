import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { FeedForecastGrid, FeedForecastStages, GRID_COLUMNS, ReportRow, StageBlock, wastageNote } from '../src/components/console/inventory/feed-forecast-grid';
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
    expect(formatDateShort('nonsense')).toBe('—');
  });
  it('adds calendar days across a month end', () => {
    expect(addDaysIso('2026-09-28', 7)).toBe('2026-10-05');
  });
});

describe('FeedForecastGrid', () => {
  it("renders the field specification's columns in order", () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'ffColBatchNo', 'ffColItemName', 'ffColItemNo', 'ffColShedNo', 'ffColPlanningDate', 'ffColSource',
      'ffColCurrentInventoryKg', 'ffColCurrentPigs', 'ffColPerDayIntakeKg', 'ffColDaysOfStock',
      'ffColRunDown', 'ffColDateToRefill', 'ffColRequiredOn', 'ffColFeedOutKg',
    ]);
    expect(headers).toEqual([...GRID_COLUMNS]);
  });

  it('shows the Item No, DD/MM/YY dates and an Overdue badge', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('FEED-R1')).toBeTruthy();
    expect(within(table).getAllByText('23/09/26').length).toBe(2); // planning date and run-down
    expect(within(table).getByText('21/09/26')).toBeTruthy();
    expect(within(table).getByText('19/09/26')).toBeTruthy();
    expect(within(table).getByText('ffOverdue')).toBeTruthy();
  });

  it('marks an indicative days-of-stock and a shared silo (Q13, D18)', () => {
    render(<FeedForecastGrid rows={[row({ indicative: true, sharedBatchCount: 2, daysOfStock: 5 })]} loading={false} horizonTo={null} t={t} />);
    expect(screen.getByText('ffIndicative')).toBeTruthy();
    expect(screen.getByText('ffSharedSilo:{"count":2}')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it("shows a grouped line's dates and says the silo lasts beyond the horizon when nothing runs down", () => {
    render(
      <FeedForecastGrid
        rows={[row({ days: 3, dateTo: '2026-09-25', runDownDate: null, refillDate: null, requiredOn: null, overdue: false })]}
        loading={false}
        horizonTo="2026-11-07"
        t={t}
      />,
    );
    expect(screen.getByText('23/09/26 – 25/09/26')).toBeTruthy();
    expect(screen.getByText('ffBeyondHorizon:{"date":"07/11/26"}')).toBeTruthy();
    expect(screen.queryByText('ffOverdue')).toBeNull();
  });

  it('shows an empty state and a loading state', () => {
    const { rerender } = render(<FeedForecastGrid rows={[]} loading={false} horizonTo={null} t={t} />);
    expect(screen.getByText(/ffNoRows/)).toBeTruthy();
    rerender(<FeedForecastGrid rows={[]} loading horizonTo={null} t={t} />);
    expect(screen.getByText(/ffLoading/)).toBeTruthy();
  });
});

describe('wastageNote (D17)', () => {
  it('names each allowance used, or says there is none', () => {
    expect(wastageNote([row({ wastagePct: 5 }), row({ wastagePct: 2.5 }), row({ wastagePct: 5 })], t)).toBe('ffWastageUsed:{"pcts":"2.5%, 5%"}');
    expect(wastageNote([row()], t)).toBe('ffWastageNone');
  });
});

describe('FeedForecastStages (field spec supporting block)', () => {
  const block: StageBlock = {
    batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', currentStageCode: 'WEANER', currentFrom: '2026-08-01', currentTo: '2026-09-11',
    nextStageCode: 'GROWER', nextFrom: '2026-09-12', nextTo: '2026-11-06', stageChangeDate: '2026-09-12', stageChangeOverdue: true,
  };
  it('lists each batch with its current and next stage, the change date and a not-posted mark', () => {
    render(<FeedForecastStages stages={[block]} t={t} />);
    const list = screen.getByRole('list');
    expect(within(list).getByText('WG-2026-38 · GRS/SHED-003')).toBeTruthy();
    expect(within(list).getByText(/WEANER \(01\/08\/26 – 11\/09\/26\)/)).toBeTruthy();
    expect(within(list).getByText(/GROWER \(12\/09\/26 – 06\/11\/26\)/)).toBeTruthy();
    expect(within(list).getByText('ffStageChangeNotPosted')).toBeTruthy();
  });
  it('renders nothing without batches', () => {
    const { container } = render(<FeedForecastStages stages={[]} t={t} />);
    expect(container.innerHTML).toBe('');
  });

  // Final review fix 1 (Important): the API sorts stage blocks on
  // (batchId, currentStageCode) — a batch can appear twice, once per
  // concurrent stage (e.g. BATCH-000010's registered-breeding rows). A React
  // key of batchId alone collides and React drops/merges one block.
  it('renders both stage blocks for one batch with two concurrent stages', () => {
    const shared = { batchId: 'b', batchNo: 'BATCH-000010', shedCode: 'SHED-1', currentFrom: '2026-08-01', currentTo: '2026-09-11', nextStageCode: null, nextFrom: null, nextTo: null, stageChangeDate: null, stageChangeOverdue: false };
    render(<FeedForecastStages stages={[{ ...shared, currentStageCode: 'GESTATION' }, { ...shared, currentStageCode: 'LACTATION' }]} t={t} />);
    const list = screen.getByRole('list');
    expect(within(list).getAllByText('BATCH-000010 · SHED-1').length).toBe(2);
    expect(within(list).getByText(/GESTATION/)).toBeTruthy();
    expect(within(list).getByText(/LACTATION/)).toBeTruthy();
  });
});

// Final review fix 5 (minor 3): Days of Stock and Run-Down look
// contradictory side by side (a silo can show more Days of Stock than days
// to its Run-Down) unless the screen says what each counts to.
describe('column header hints (Days of Stock vs Run-Down)', () => {
  it('titles the two columns with what each counts to', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo={null} t={t} />);
    const headers = screen.getAllByRole('columnheader');
    const daysOfStock = headers.find((h) => h.textContent === 'ffColDaysOfStock')!;
    const runDown = headers.find((h) => h.textContent === 'ffColRunDown')!;
    expect(daysOfStock.getAttribute('title')).toBe('ffDaysOfStockHint');
    expect(runDown.getAttribute('title')).toBe('ffRunDownHint');
  });
});
