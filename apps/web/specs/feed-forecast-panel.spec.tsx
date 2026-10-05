import React from 'react';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import FeedForecastPanel from '../src/components/console/inventory/feed-forecast-panel';
import { api } from '../src/services/api-client';
import { getActiveWorkspaceScope } from '../src/hooks/useAuth';
import { getForecastWindow } from '../src/components/console/inventory/feed-forecast-window';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
// A stable `t`: the effects must not depend on its identity (the tRef pattern).
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
let mockCanSaveRun = true;
jest.mock('../src/hooks/useAuth', () => ({
  getActiveWorkspaceScope: jest.fn(),
  getStoredUser: jest.fn(() => ({ userType: 'STANDARD_USER' })),
  hasPermission: jest.fn(() => mockCanSaveRun),
}));
// The farm list and choice belong to the shared hook (use-feed-farm.spec.tsx); here it is a fixed answer.
let mockFarm: any;
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({ useFeedFarm: () => mockFarm }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const mockScope = getActiveWorkspaceScope as jest.Mock;

const FARMS = [
  { farmId: 'farm-vil100', code: 'VIL100', name: 'VILLA FRANCA FARM', companyId: 'co-1', companyName: 'Triple C' },
  { farmId: 'farm-oth', code: 'OTH100', name: 'OTHER FARM', companyId: 'co-1', companyName: 'Triple C' },
];
const adminFarm = (over: Record<string, unknown> = {}) => ({
  farmId: 'farm-vil100', setFarmId: jest.fn(), farms: FARMS, loaded: true, failed: false, isFixed: false, fixedFarm: null, ...over,
});

const forecastResponse = {
  success: true,
  data: {
    planningDate: '2026-09-25', today: '2026-09-25', timeZone: 'Africa/Harare', view: 'CUSTOM',
    from: '2026-09-25', to: '2026-10-02', forecastFrom: '2026-09-25', horizonTo: '2026-11-09', period: null,
    farm: { id: 'farm-vil100', code: 'VIL100', name: 'VILLA FRANCA FARM' },
    rows: [
      {
        key: 'b10|item-1|VIL100/STORE-001|2026-09-25', farmId: 'farm-vil100', batchId: 'b10', batchGroupId: 'b10', batchNo: 'BATCH-000010', shedId: null, shedCode: '', stageCode: 'WEANER',
        itemId: 'item-1', itemNo: 'FEED-WG', itemName: 'Weaner Grower Mash (18% CP)', sourceType: 'STORE', sourceCode: 'VIL100/STORE-001', sourceName: 'Main store',
        sourceLocationId: 'store-1', currentItemId: null, currentItemNo: null, currentItemName: null, feedType: 'BAGGED',
        date: '2026-09-25', dateTo: '2026-09-25', days: 1, currentInventoryKg: 35525.6, openingSystemBalanceKg: 35525.6, confirmedReceiptsKg: 0,
        heads: 58, feedRateKg: 2.19, perDayIntakeKg: 127, intakeKg: 127, dailyUseKg: 127, projectedClosingBalanceKg: 35398.6,
        recommendedQtyKg: 0, firstShortageDate: null, deliveryDate: null, daysOfStock: 108, sharedBatchCount: 3, indicative: false, runDownDate: null,
      },
      {
        key: 'b20|item-2|VIL100/SILO-002|2026-09-25', farmId: 'farm-vil100', batchId: 'b20', batchGroupId: 'b20', batchNo: 'BATCH-000020', shedId: 'shed-1', shedCode: 'SHED-1', stageCode: 'DRY_SOW',
        itemId: 'item-2', itemNo: 'FEED-DS', itemName: 'Dry Sow Gestation Mash (14% CP)', sourceType: 'SILO', sourceCode: 'VIL100/SILO-002', sourceName: 'Dry sow silo',
        sourceLocationId: 'silo-2', currentItemId: 'item-2', currentItemNo: 'FEED-DS', currentItemName: 'Dry Sow Gestation Mash (14% CP)', feedType: 'BULK',
        date: '2026-09-25', dateTo: '2026-09-25', days: 1, currentInventoryKg: 200, openingSystemBalanceKg: 200, confirmedReceiptsKg: 0,
        heads: 40, feedRateKg: 2.5, perDayIntakeKg: 100, intakeKg: 100, dailyUseKg: 100, projectedClosingBalanceKg: 100,
        recommendedQtyKg: 0, firstShortageDate: '2026-09-26', deliveryDate: '2026-09-26', daysOfStock: 2, sharedBatchCount: 1, indicative: true, runDownDate: '2026-09-26',
      },
    ],
    sourceBalances: [
      { date: '2026-09-25', sourceType: 'STORE', sourceCode: 'VIL100/STORE-001', sourceName: 'Main store', locationId: 'store-1', itemId: 'item-1', itemNo: 'FEED-WG', itemName: 'Weaner Grower Mash (18% CP)', currentItemId: null, currentItemNo: null, currentItemName: null, openingSystemBalanceKg: 35525.6, confirmedReceiptKg: 0, dailyUseKg: 127, projectedClosingBalanceKg: 35398.6, recommendedQtyKg: 0, firstShortageDate: null, deliveryDate: null, runDownDate: null },
      { date: '2026-09-25', sourceType: 'SILO', sourceCode: 'VIL100/SILO-002', sourceName: 'Dry sow silo', locationId: 'silo-2', itemId: 'item-2', itemNo: 'FEED-DS', itemName: 'Dry Sow Gestation Mash (14% CP)', currentItemId: 'item-2', currentItemNo: 'FEED-DS', currentItemName: 'Dry Sow Gestation Mash (14% CP)', openingSystemBalanceKg: 200, confirmedReceiptKg: 0, dailyUseKg: 100, projectedClosingBalanceKg: 100, recommendedQtyKg: 0, firstShortageDate: '2026-09-26', deliveryDate: '2026-09-26', runDownDate: '2026-09-26' },
    ],
    flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'BATCH-000010' }, { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000010' }],
  },
};

function routedGet(over?: { feedForecast?: () => Promise<any>; periods?: () => Promise<any>; runs?: () => Promise<any> }) {
  return (url: string) => {
    if (url.startsWith('/feed-forecast/periods')) return over?.periods ? over.periods() : Promise.resolve({ success: true, data: [] });
    if (url.startsWith('/feed-forecast/runs')) return over?.runs ? over.runs() : Promise.resolve({ success: true, data: [] });
    return over?.feedForecast ? over.feedForecast() : Promise.resolve(forecastResponse);
  };
}
const forecastCalls = () => get.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/feed-forecast?'));

describe('FeedForecastPanel — admin', () => {
  beforeEach(() => {
    get.mockReset().mockImplementation(routedGet());
    post.mockReset();
    mockScope.mockReset().mockReturnValue('COMPANY');
    mockCanSaveRun = true;
    mockFarm = adminFarm();
  });

  it("renders the fourteen static row-70 columns plus one dated projected-closing column", async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table', { name: 'ffGridLabel' });
    // Both fixture rows fall on 25/09/26, so there is one date column.
    expect(within(table).getAllByRole('columnheader')).toHaveLength(14 + 1);
  });

  it("shares the window on screen with the Feed Requisition tab's Draft from forecast (Feed Forecast row 8)", async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    await waitFor(() => expect(getForecastWindow('farm-vil100')).toEqual({ farmId: 'farm-vil100', from: '2026-09-25', to: '2026-10-02' }));
    expect(getForecastWindow('farm-oth')).toBeNull();
  });

  it('never fetches the farm list itself: the shared hook owns it (A3)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(get.mock.calls.some(([url]) => String(url).startsWith('/location'))).toBe(false);
  });

  it('removes the non-workbook Stages tab and keeps the forecast grid visible', async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(within(table).queryByText('ffOverdue')).toBeNull();
    expect(screen.queryByRole('tab', { name: /ffTabStages/ })).toBeNull();
    expect(screen.queryByRole('table', { name: 'ffStagesTitle' })).toBeNull();
    expect(table).toBeTruthy();
  });

  it('offers All plus cascading Shed, Silo, Batch, Feed Item and Bulk/Bagged result filters without refetching', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    const shed = screen.getByLabelText('ffFilterShed') as HTMLSelectElement;
    const silo = screen.getByLabelText('ffFilterSilo') as HTMLSelectElement;
    const batch = screen.getByLabelText('ffFilterBatch') as HTMLSelectElement;
    const item = screen.getByLabelText('ffFilterFeedItem') as HTMLSelectElement;
    const feedType = screen.getByLabelText('ffFilterFeedType') as HTMLSelectElement;

    for (const select of [shed, silo, batch, item, feedType]) expect(within(select).getByText('ffFilterAll')).toBeTruthy();
    expect(within(shed).getByText('SHED-1')).toBeTruthy();
    expect(within(silo).getByText('VIL100/SILO-002 — Dry sow silo')).toBeTruthy();
    expect(within(batch).getByText('BATCH-000020')).toBeTruthy();
    expect(within(item).getByText('FEED-DS — Dry Sow Gestation Mash (14% CP)')).toBeTruthy();
    expect(within(feedType).getByText('ffFeedTypeBulk')).toBeTruthy();
    expect(within(feedType).getByText('ffFeedTypeBagged')).toBeTruthy();

    fireEvent.change(shed, { target: { value: 'shed-1' } });
    const filteredTable = screen.getByRole('table', { name: 'ffGridLabel' });
    expect(within(filteredTable).queryByText('BATCH-000010')).toBeNull();
    expect(within(filteredTable).getByText('BATCH-000020')).toBeTruthy();
    expect(forecastCalls()).toHaveLength(1);
  });

  it('resets a child filter to All when an upstream selection makes it invalid', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    const silo = screen.getByLabelText('ffFilterSilo') as HTMLSelectElement;
    fireEvent.change(silo, { target: { value: 'store-1' } });
    expect(silo.value).toBe('store-1');

    fireEvent.change(screen.getByLabelText('ffFilterShed'), { target: { value: 'shed-1' } });
    expect((screen.getByLabelText('ffFilterSilo') as HTMLSelectElement).value).toBe('');
  });

  it('shows the farm chosen in the shared hook and hands a new choice back to it (A4)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    const select = screen.getByLabelText('ffFarm') as HTMLSelectElement;
    expect(select.value).toBe('farm-vil100');
    fireEvent.change(select, { target: { value: 'farm-oth' } });
    expect(mockFarm.setFarmId).toHaveBeenCalledWith('farm-oth');
  });

  it('waits for the API farm-local dates before showing the initial window', () => {
    get.mockImplementation(() => new Promise(() => undefined));
    render(<FeedForecastPanel />);
    expect((screen.getByLabelText('ffPlanningDate') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('ffDateFrom') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('ffDateTo') as HTMLInputElement).value).toBe('');
  });

  it('keeps the filters on one row and the date pair together (review, 27 Sep)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    const from = screen.getByLabelText('ffDateFrom');
    const to = screen.getByLabelText('ffDateTo');
    // Date From and Date To share a container, so a wrap can never leave "Date To" alone.
    expect(from.closest('div')!.parentElement).toBe(to.closest('div')!.parentElement);
    const row = screen.getByLabelText('ffPlanningDate').closest('[class*="flex-wrap"]')!;
    expect(row.className).toContain('lg:flex-nowrap');
  });

  it('fetches once on mount and once more after a date changes, without looping', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(forecastCalls()).toHaveLength(1);
    const input = screen.getByLabelText('ffDateFrom') as HTMLInputElement;
    const next = new Date(`${input.value}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    fireEvent.change(input, { target: { value: next.toISOString().slice(0, 10) } });
    await waitFor(() => expect(forecastCalls()).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(forecastCalls()).toHaveLength(2);
  });

  it('first asks for the Custom view with no dates, so the API plans from the farm\'s today (D16)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(forecastCalls()[0][0]).toBe('/feed-forecast?farmId=farm-vil100&view=CUSTOM');
  });

  it('sends a picked planning date as the as-of date', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffPlanningDate'), { target: { value: '2026-09-22' } });
    await waitFor(() => expect(forecastCalls().some(([url]) => url.includes('planningDate=2026-09-22'))).toBe(true));
  });

  it('does not persist a run on load or filter changes; Save Run posts the exact displayed filters', async () => {
    post.mockResolvedValue({ success: true, data: { runId: 'run-1', runCode: 'FFR-farm-vil100-000001', version: 1 } });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('ffDateFrom'), { target: { value: '2026-09-26' } });
    await waitFor(() => expect(forecastCalls()).toHaveLength(2));
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'ffSaveRun' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-forecast/runs', {
      farmId: 'farm-vil100', planningDate: '2026-09-25', view: 'CUSTOM',
      from: '2026-09-26', to: '2026-10-02',
    }));
    expect(await screen.findByText('ffRunSaved:{"code":"FFR-farm-vil100-000001","version":1}')).toBeTruthy();
  });

  it('keeps run history visible but hides Save Run without create authority', async () => {
    mockCanSaveRun = false;
    render(<FeedForecastPanel />);

    await screen.findByRole('table');
    expect(screen.getByText('ffRunHistory:{"count":0}')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ffSaveRun' })).toBeNull();
  });

  it('does not crash when the response has rows but no flags array', async () => {
    get.mockImplementation(routedGet({ feedForecast: () => Promise.resolve({ success: true, data: { ...forecastResponse.data, flags: undefined } }) }));
    render(<FeedForecastPanel />);
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('shows the API error and hides the table', async () => {
    get.mockImplementation(routedGet({ feedForecast: () => Promise.reject({ message: 'Farm not found.' }) }));
    render(<FeedForecastPanel />);
    await screen.findByText('Farm not found.');
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows an empty state, not an error box, when the user has no farms (A11)', async () => {
    mockFarm = adminFarm({ farmId: null, farms: [] });
    render(<FeedForecastPanel />);
    expect(screen.getByText('ffNoFarms')).toBeTruthy();
    expect(forecastCalls()).toHaveLength(0);
  });

  it('shows an error with a retry when the farm list could not be read, not the empty state (Plan S follow-up)', async () => {
    const retry = jest.fn();
    mockFarm = adminFarm({ farmId: null, farms: [], failed: true, retry });
    render(<FeedForecastPanel />);
    expect(screen.getByText('ffFarmsLoadFailed')).toBeTruthy();
    expect(screen.queryByText('ffNoFarms')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ffRetry' }));
    expect(retry).toHaveBeenCalled();
    expect(forecastCalls()).toHaveLength(0);
  });

  it('collects the notes in one collapsed panel', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.getByText('ffNotesTitle:{"count":2}')).toBeTruthy();
    expect(document.querySelector('details')!.open).toBe(false);
  });

  it('says nothing is forecast before the planning date when the range ends before it (Q7)', async () => {
    get.mockImplementation(routedGet({ feedForecast: () => Promise.resolve({ success: true, data: { ...forecastResponse.data, from: '2026-09-10', to: '2026-09-20', forecastFrom: null, rows: [], stages: [], flags: [] } }) }));
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.getByText(/ffNoteRangeBeforePlanning/)).toBeTruthy();
  });

  it('notes that rows start at the planning date when the range only partly precedes it', async () => {
    get.mockImplementation(routedGet({ feedForecast: () => Promise.resolve({ success: true, data: { ...forecastResponse.data, from: '2026-09-20', to: '2026-09-30', forecastFrom: '2026-09-25' } }) }));
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.getByText(/ffNoteRangeStartsAtPlanning/)).toBeTruthy();
  });

  it("the Reporting Period view lists the farm's periods", async () => {
    get.mockImplementation(routedGet({
      periods: () => Promise.resolve({ success: true, data: [{ periodId: 'p9', periodCode: '2026-09', startDate: '2026-08-30', endDate: '2026-09-26', stockTakeDate: '2026-09-26', productionStartDate: '2026-09-27' }] }),
    }));
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === '/feed-forecast/periods?farmId=farm-vil100')).toBe(true));
    const select = screen.getByLabelText('ffReportingPeriod') as HTMLSelectElement;
    expect(within(select).getByText('ffPeriodOption:{"code":"2026-09","from":"30/08/26","to":"26/09/26"}')).toBeTruthy();
  });

  it('offers to generate the business year when there are no periods, then reloads (Q9)', async () => {
    post.mockResolvedValue({ success: true, data: { created: ['2026-07'], skipped: [] } });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    fireEvent.click(await screen.findByRole('button', { name: /ffGenerateDraftPeriods/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/reporting-period/generate', { business_year_start: 2026 }));
    expect(screen.getByRole('button', { name: /ffGenerateDraftPeriods/ })).toBeTruthy();
  });

  it('disables Generate Periods in the tenant-wide workspace and says why', async () => {
    mockScope.mockReturnValue('TENANT');
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    expect(((await screen.findByRole('button', { name: /ffGenerateDraftPeriods/ })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('ffGenerateNeedsCompany')).toBeTruthy();
  });

  it('shows a refused generate beside the button without hiding the grid', async () => {
    post.mockRejectedValue({ message: 'Forbidden.' });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    fireEvent.click(await screen.findByRole('button', { name: /ffGenerateDraftPeriods/ }));
    await screen.findByText('Forbidden.');
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('shows an error, not "No periods", when the periods read fails', async () => {
    get.mockImplementation(routedGet({ periods: () => Promise.reject(new Error('network')) }));
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    await screen.findByText('ffPeriodsLoadFailed');
    expect(screen.queryByText('ffNoPeriods')).toBeNull();
  });
});

describe('FeedForecastPanel — farm user (D13)', () => {
  beforeEach(() => {
    get.mockReset().mockImplementation(routedGet());
    mockScope.mockReset().mockReturnValue('OPERATIONAL');
  });

  it('shows the farm, not a choice', async () => {
    mockFarm = adminFarm({ isFixed: true, farms: [], fixedFarm: { location_code: 'VIL100', location_name: 'VILLA FRANCA FARM' } });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.queryByRole('combobox', { name: 'ffFarm' })).toBeNull();
    expect(screen.getByText('VIL100 — VILLA FRANCA FARM')).toBeTruthy();
  });

  it("falls back to the response farm's code and name", async () => {
    mockFarm = adminFarm({ isFixed: true, farms: [], fixedFarm: null });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.getByText('VIL100 — VILLA FRANCA FARM')).toBeTruthy();
  });
});
