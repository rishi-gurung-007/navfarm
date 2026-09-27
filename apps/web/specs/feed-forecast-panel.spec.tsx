import React from 'react';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import FeedForecastPanel from '../src/components/console/inventory/feed-forecast-panel';
import { api } from '../src/services/api-client';
import { getActiveWorkspaceScope } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
// A stable `t`: the effects must not depend on its identity (the tRef pattern).
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock('../src/hooks/useAuth', () => ({ getActiveWorkspaceScope: jest.fn() }));
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
        key: 'b10|item-1|VIL100/STORE-001|2026-09-25', batchId: 'b10', batchNo: 'BATCH-000010', shedCode: '', stageCode: 'WEANER',
        itemId: 'item-1', itemNo: 'FEED-WG', itemName: 'Weaner Grower Mash (18% CP)', sourceType: 'STORE', sourceCode: 'VIL100/STORE-001',
        date: '2026-09-25', dateTo: '2026-09-25', days: 1, currentInventoryKg: 35525.6, heads: 58, perDayIntakeKg: 127, wastagePct: 2.5,
        intakeKg: 127, demandKg: 130.175, daysOfStock: 108, sharedBatchCount: 3, indicative: false,
        runDownDate: null, refillDate: null, requiredOn: null, overdue: false,
      },
      {
        key: 'b20|item-2|VIL100/SILO-002|2026-09-25', batchId: 'b20', batchNo: 'BATCH-000020', shedCode: 'SHED-1', stageCode: 'DRY_SOW',
        itemId: 'item-2', itemNo: 'FEED-DS', itemName: 'Dry Sow Gestation Mash (14% CP)', sourceType: 'SILO', sourceCode: 'VIL100/SILO-002',
        date: '2026-09-25', dateTo: '2026-09-25', days: 1, currentInventoryKg: 200, heads: 40, perDayIntakeKg: 100, wastagePct: 0,
        intakeKg: 100, demandKg: 100, daysOfStock: 2, sharedBatchCount: 1, indicative: true,
        runDownDate: '2026-09-26', refillDate: '2026-09-24', requiredOn: '2026-09-22', overdue: true,
      },
    ],
    stages: [
      { batchId: 'b20', batchNo: 'BATCH-000020', shedCode: 'SHED-1', currentStageCode: 'DRY_SOW', currentFrom: '2026-09-01', currentTo: '2026-09-07',
        nextStageCode: 'FLUSH', nextFrom: '2026-09-08', nextTo: '2026-09-21', stageChangeDate: '2026-09-08', stageChangeOverdue: true },
    ],
    flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'BATCH-000010' }, { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000010' }],
  },
};

function routedGet(over?: { feedForecast?: () => Promise<any>; periods?: () => Promise<any> }) {
  return (url: string) => {
    if (url.startsWith('/feed-forecast/periods')) return over?.periods ? over.periods() : Promise.resolve({ success: true, data: [] });
    return over?.feedForecast ? over.feedForecast() : Promise.resolve(forecastResponse);
  };
}
const forecastCalls = () => get.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/feed-forecast?'));

describe('FeedForecastPanel — admin', () => {
  beforeEach(() => {
    get.mockReset().mockImplementation(routedGet());
    post.mockReset();
    mockScope.mockReset().mockReturnValue('COMPANY');
    mockFarm = adminFarm();
  });

  it("renders the field specification's 14 columns in order", async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(14);
  });

  it('never fetches the farm list itself: the shared hook owns it (A3)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(get.mock.calls.some(([url]) => String(url).startsWith('/location'))).toBe(false);
  });

  it('shows Overdue, Indicative, "Shared by", "after" the horizon and the wastage line; Stages is a tab', async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(within(table).getByText('ffOverdue')).toBeTruthy();
    expect(within(table).getByText('ffIndicative')).toBeTruthy();
    expect(within(table).getByText('ffSharedBy:{"count":3}')).toBeTruthy();
    expect(within(table).getByText('ffBeyondHorizon:{"date":"09/11/26"}')).toBeTruthy();
    expect(screen.getByText('ffWastageUsed:{"pcts":"2.5%"}')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'ffTabStages:{"count":1}' }));
    expect(screen.getByRole('table', { name: 'ffStagesTitle' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'ffGridLabel' })).toBeNull();
  });

  it('shows the farm chosen in the shared hook and hands a new choice back to it (A4)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    const select = screen.getByLabelText('ffFarm') as HTMLSelectElement;
    expect(select.value).toBe('farm-vil100');
    fireEvent.change(select, { target: { value: 'farm-oth' } });
    expect(mockFarm.setFarmId).toHaveBeenCalledWith('farm-oth');
  });

  it('shows default dates before the first answer arrives (A11)', () => {
    get.mockImplementation(() => new Promise(() => undefined));
    render(<FeedForecastPanel />);
    const planning = (screen.getByLabelText('ffPlanningDate') as HTMLInputElement).value;
    expect(planning).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((screen.getByLabelText('ffDateFrom') as HTMLInputElement).value).toBe(planning);
    expect((screen.getByLabelText('ffDateTo') as HTMLInputElement).value).not.toBe('');
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
    fireEvent.click(await screen.findByRole('button', { name: /ffGeneratePeriods/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/reporting-period/generate', { business_year_start: 2026 }));
  });

  it('disables Generate Periods in the tenant-wide workspace and says why', async () => {
    mockScope.mockReturnValue('TENANT');
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    expect(((await screen.findByRole('button', { name: /ffGeneratePeriods/ })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('ffGenerateNeedsCompany')).toBeTruthy();
  });

  it('shows a refused generate beside the button without hiding the grid', async () => {
    post.mockRejectedValue({ message: 'Forbidden.' });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    fireEvent.click(await screen.findByRole('button', { name: /ffGeneratePeriods/ }));
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
