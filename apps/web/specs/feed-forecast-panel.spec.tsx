import React from 'react';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import FeedForecastPanel from '../src/components/console/inventory/feed-forecast-panel';
import { api } from '../src/services/api-client';
import { getStoredUser, getActiveFarmId, getActiveWorkspaceScope } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
// A stable `t` (defined once, inside the factory, not re-created per call) —
// fix round 1: the fetch effect used to depend on `t`, and a mock that handed
// back a fresh function identity on every render sent it into a render loop
// (~10k api.get calls). The effect no longer depends on `t` (see the
// component's tRef), but the mock stays stable too so a regression there
// would be caught here rather than only in the running app.
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock('../src/hooks/useAuth', () => ({ getStoredUser: jest.fn(), getActiveFarmId: jest.fn(), getActiveWorkspaceScope: jest.fn() }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const mockGetStoredUser = getStoredUser as jest.Mock;
const mockGetActiveFarmId = getActiveFarmId as jest.Mock;
const mockGetActiveWorkspaceScope = getActiveWorkspaceScope as jest.Mock;

/** api.get is called for both /location (farm picker) and /feed-forecast; tests that
 * care about fetch-loop / call-count regressions count the forecast calls only. */
function forecastCallCount(): number {
  return get.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/feed-forecast?')).length;
}

const standardUser = {
  userId: 'user-1',
  userType: 'STANDARD_USER',
  farmId: 'farm-vil100',
  farm: { location_id: 'farm-vil100', location_code: 'VIL100', location_name: 'VILLA FRANCA FARM' },
};

const tenantAdminUser = {
  userId: 'user-2',
  userType: 'TENANT_ADMIN',
};

const farmList = {
  success: true,
  data: [
    { location_id: 'farm-vil100', location_code: 'VIL100', location_name: 'VILLA FRANCA FARM' },
    { location_id: 'farm-other', location_code: 'OTH100', location_name: 'OTHER FARM' },
  ],
};

const forecastResponse = {
  success: true,
  message: 'Feed forecast retrieved successfully.',
  data: {
    planningDate: '2026-09-25',
    today: '2026-09-25',
    timeZone: 'Africa/Harare',
    view: 'CUSTOM',
    from: '2026-09-25',
    to: '2026-10-02',
    forecastFrom: '2026-09-25',
    horizonTo: '2026-11-09',
    period: null,
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
      {
        batchId: 'b20', batchNo: 'BATCH-000020', shedCode: 'SHED-1', currentStageCode: 'DRY_SOW', currentFrom: '2026-09-01', currentTo: null,
        nextStageCode: null, nextFrom: null, nextTo: null, stageChangeDate: null, stageChangeOverdue: false,
      },
    ],
    flags: [
      { kind: 'HEADS_ASSUMED_FLAT', batchNo: 'BATCH-000010' },
      { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000010' },
    ],
  },
};

function routedGet(overrides?: { location?: any; feedForecast?: () => Promise<any>; periods?: any }) {
  return (url: string) => {
    if (url.startsWith('/location')) return Promise.resolve(overrides?.location ?? farmList);
    if (url.startsWith('/feed-forecast/periods')) return Promise.resolve(overrides?.periods ?? { success: true, data: [] });
    return overrides?.feedForecast ? overrides.feedForecast() : Promise.resolve(forecastResponse);
  };
}

describe('FeedForecastPanel — tenant admin', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(routedGet());
    post.mockReset();
    mockGetStoredUser.mockReset().mockReturnValue(tenantAdminUser);
    mockGetActiveFarmId.mockReset().mockReturnValue('farm-vil100');
    mockGetActiveWorkspaceScope.mockReset().mockReturnValue('COMPANY');
  });

  it('renders the field specification\'s 14 columns in order', async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table', { name: 'ffGridLabel' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'ffColBatchNo', 'ffColItemName', 'ffColItemNo', 'ffColShedNo', 'ffColPlanningDate', 'ffColSource',
      'ffColCurrentInventoryKg', 'ffColCurrentPigs', 'ffColPerDayIntakeKg', 'ffColDaysOfStock',
      'ffColRunDown', 'ffColDateToRefill', 'ffColRequiredOn', 'ffColFeedOutKg',
    ]);
  });

  it('shows Overdue, Indicative, the shared-silo count, "beyond" the horizon, the wastage note and the stage block', async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(within(table).getByText('ffOverdue')).toBeTruthy();
    expect(within(table).getByText('ffIndicative')).toBeTruthy();
    expect(within(table).getByText('ffSharedBy:{"count":3}')).toBeTruthy();
    expect(within(table).getByText('ffBeyondHorizon:{"date":"09/11/26"}')).toBeTruthy();
    expect(screen.getByText('ffWastageUsed:{"pcts":"2.5%"}')).toBeTruthy();
    // The stage block: a <section aria-label> is a region (the notes below are a list too, so not getByRole('list')).
    expect(screen.getByRole('table', { name: 'ffStagesTitle' })).toBeTruthy();
  });

  it('shows a farm select defaulting to the active farm for a non-STANDARD_USER', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    const select = screen.getByRole('combobox', { name: 'ffPrimaryLocation' }) as HTMLSelectElement;
    expect(select).toBeTruthy();
    await waitFor(() => expect(select.value).toBe('farm-vil100'));
  });

  it('fetches the forecast once on mount and once more after a date changes, without looping (fix round 1)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(forecastCallCount()).toBe(1);

    // A date that is never the default: Date From starts at today, so a fixed
    // literal turned this test red on the day it named.
    const input = screen.getByLabelText('ffDateFrom') as HTMLInputElement;
    const next = new Date(`${input.value}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    fireEvent.change(input, { target: { value: next.toISOString().slice(0, 10) } });

    await waitFor(() => expect(forecastCallCount()).toBe(2));
    // Give any runaway effect a moment to misbehave before asserting it didn't.
    await new Promise((r) => setTimeout(r, 20));
    expect(forecastCallCount()).toBe(2);
  });

  it('does not crash when the response has rows but no flags array', async () => {
    get.mockImplementation(
      routedGet({
        feedForecast: () => Promise.resolve({ success: true, data: { ...forecastResponse.data, flags: undefined } }),
      }),
    );
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(table).toBeTruthy();
  });

  it('shows the API error message and hides the table (not "No forecast rows for this range")', async () => {
    get.mockImplementation(
      routedGet({ feedForecast: () => Promise.reject({ message: 'Farm not found.' }) }),
    );
    render(<FeedForecastPanel />);
    await screen.findByText('Farm not found.');
    expect(screen.queryByRole('table', { name: 'ffGridLabel' })).toBeNull();
    expect(screen.queryByText('ffNoRows')).toBeNull();
  });

  it('clears the error when the farm select is reset to "Select a farm…"', async () => {
    get.mockImplementation(
      routedGet({ feedForecast: () => Promise.reject({ message: 'Farm not found.' }) }),
    );
    render(<FeedForecastPanel />);
    await screen.findByText('Farm not found.');

    const select = screen.getByRole('combobox', { name: 'ffPrimaryLocation' });
    fireEvent.change(select, { target: { value: '' } });

    await waitFor(() => expect(screen.queryByText('Farm not found.')).toBeNull());
  });

  it('falls back to no farm selection when the pinned farm is not in the farm list', async () => {
    mockGetActiveFarmId.mockReturnValue('farm-not-in-list');
    get.mockImplementation(routedGet());
    render(<FeedForecastPanel />);
    const select = await screen.findByRole('combobox', { name: 'ffPrimaryLocation' }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(''));
  });

  it('falls back to no farm selection (and the pick-a-farm prompt) when the /location call itself fails', async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith('/location')) return Promise.reject(new Error('network error'));
      return Promise.resolve(forecastResponse);
    });
    render(<FeedForecastPanel />);
    const select = await screen.findByRole('combobox', { name: 'ffPrimaryLocation' }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(''));
    expect(await screen.findByText('ffPickFarmPrompt')).toBeTruthy();
  });

  it('groups consecutive NO_FEED_ROW day flags into one range sentence, dedupes an identical repeated flag, and lists BATCH_SHED_UNKNOWN', async () => {
    get.mockImplementation(
      routedGet({
        feedForecast: () => Promise.resolve({
          success: true,
          data: {
            ...forecastResponse.data,
            flags: [
              { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 30, date: '2026-09-27' },
              { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 31, date: '2026-09-28' },
              // Exact duplicate of the day-31 flag above — must not inflate the range or add a second sentence.
              { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 31, date: '2026-09-28' },
              { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 32, date: '2026-09-29' },
              { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-1' },
            ],
          },
        }),
      }),
    );
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });

    expect(screen.getByText(/ffFlagNoFeedRowRange/)).toBeTruthy();
    expect(screen.queryByText(/ffFlagNoFeedRowSingle/)).toBeNull();
    expect(screen.getAllByText(/ffFlagNoFeedRow/).length).toBe(1);
    expect(screen.getByText(/ffFlagBatchShedUnknown/)).toBeTruthy();
  });

  it('says nothing is forecast before the planning date when the range ends before it (Q7)', async () => {
    get.mockImplementation(
      routedGet({
        feedForecast: () => Promise.resolve({
          success: true,
          data: { ...forecastResponse.data, from: '2026-09-10', to: '2026-09-20', forecastFrom: null, rows: [], stages: [], flags: [] },
        }),
      }),
    );
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(screen.getByText(/ffNoteRangeBeforePlanning/)).toBeTruthy();
    expect(screen.getByText(/ffNoRows/)).toBeTruthy();
  });

  it('first asks for the Custom view with no dates, so the API plans from the farm\'s today (D16)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(get.mock.calls.find(([url]) => url.startsWith('/feed-forecast?'))![0]).toBe('/feed-forecast?farmId=farm-vil100&view=CUSTOM');
  });

  it('sends a picked planning date as the as-of date', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    const input = screen.getByLabelText('ffPlanningDate') as HTMLInputElement;
    const earlier = new Date(`${input.value}T00:00:00Z`);
    earlier.setUTCDate(earlier.getUTCDate() - 3);
    const picked = earlier.toISOString().slice(0, 10);
    fireEvent.change(input, { target: { value: picked } });
    await waitFor(() => expect(get.mock.calls.some(([url]) => url.includes(`planningDate=${picked}`))).toBe(true));
  });

  it('the Reporting Period view lists the farm\'s periods and asks for the one covering the planning date', async () => {
    get.mockImplementation(routedGet({
      periods: { success: true, data: [{ periodId: 'p9', periodCode: '2026-09', startDate: '2026-08-30', endDate: '2026-09-26', stockTakeDate: '2026-09-26', productionStartDate: '2026-09-27' }] },
    }));
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === '/feed-forecast/periods?farmId=farm-vil100')).toBe(true));
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === '/feed-forecast?farmId=farm-vil100&view=PERIOD')).toBe(true));
    const select = screen.getByLabelText('ffReportingPeriod') as HTMLSelectElement;
    expect(within(select).getByText('ffPeriodOption:{"code":"2026-09","from":"30/08/26","to":"26/09/26"}')).toBeTruthy();
    expect(screen.queryByText(/ffGeneratePeriods/)).toBeNull();
  });

  it('offers to generate the business year when the company has no periods, then reloads (Q9)', async () => {
    post.mockResolvedValue({ success: true, data: { created: ['2026-07'], skipped: [] } });
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    const button = await screen.findByRole('button', { name: /ffGeneratePeriods/ });
    const periodCalls = () => get.mock.calls.filter(([url]) => url.startsWith('/feed-forecast/periods')).length;
    const before = periodCalls();
    fireEvent.click(button);
    // The response's planning date (25 Sep 2026) falls in the 2026–27 business year.
    await waitFor(() => expect(post).toHaveBeenCalledWith('/reporting-period/generate', { business_year_start: 2026 }));
    await waitFor(() => expect(periodCalls()).toBeGreaterThan(before));
  });

  // Final review, Important 2 + ruling: a TENANT_ADMIN in the tenant-wide
  // workspace (no active company — api-client only sends x-active-company-id
  // outside TENANT scope) generating periods writes NULL-company template
  // rows. No new endpoint; the button is disabled with a message instead.
  it('disables Generate Periods and explains why in the tenant-wide workspace (final review ruling)', async () => {
    mockGetActiveWorkspaceScope.mockReturnValue('TENANT');
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    const button = await screen.findByRole('button', { name: /ffGeneratePeriods/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('ffGenerateNeedsCompany')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('leaves Generate Periods enabled with no extra message in a company workspace', async () => {
    mockGetActiveWorkspaceScope.mockReturnValue('COMPANY');
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    const button = await screen.findByRole('button', { name: /ffGeneratePeriods/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByText('ffGenerateNeedsCompany')).toBeNull();
  });

  // Final review, minor 5: a refused generate (e.g. 403) must not hide the
  // grid — the panel used to route it through the same `error` state that
  // hides the table.
  it('shows a refused generate beside the button without hiding the grid', async () => {
    post.mockRejectedValue({ message: 'Forbidden.' });
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    const button = await screen.findByRole('button', { name: /ffGeneratePeriods/ });
    fireEvent.click(button);
    await screen.findByText('Forbidden.');
    expect(screen.getByRole('table', { name: 'ffGridLabel' })).toBeTruthy();
  });

  // Final review, minor 5: a failed /feed-forecast/periods read must show an
  // error, not silently render "No periods" + the generate button as if the
  // company genuinely had none.
  it('shows an error, not "No periods", when the periods read itself fails', async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith('/location')) return Promise.resolve(farmList);
      if (url.startsWith('/feed-forecast/periods')) return Promise.reject(new Error('network error'));
      return Promise.resolve(forecastResponse);
    });
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    await screen.findByText('ffPeriodsLoadFailed');
    expect(screen.queryByText('ffNoPeriods')).toBeNull();
    expect(screen.queryByRole('button', { name: /ffGeneratePeriods/ })).toBeNull();
  });

  // Final review, Important + minor 1: when part of the range lies before
  // the planning date (forecastFrom > from, e.g. the PERIOD view straddling
  // it), the note must say rows start at the planning date — not the
  // "nothing is forecast" wording reserved for forecastFrom === null.
  it('notes that rows start at the planning date when the range only partly precedes it', async () => {
    get.mockImplementation(
      routedGet({
        feedForecast: () => Promise.resolve({
          success: true,
          data: { ...forecastResponse.data, from: '2026-09-20', to: '2026-09-30', forecastFrom: '2026-09-25' },
        }),
      }),
    );
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(screen.getByText(/ffNoteRangeStartsAtPlanning/)).toBeTruthy();
    expect(screen.queryByText(/ffNoteRangeBeforePlanning/)).toBeNull();
  });
});

describe('FeedForecastPanel — STANDARD_USER', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(routedGet());
    mockGetStoredUser.mockReset().mockReturnValue(standardUser);
    mockGetActiveFarmId.mockReset().mockReturnValue('farm-vil100');
    mockGetActiveWorkspaceScope.mockReset().mockReturnValue('OPERATIONAL');
  });

  it('shows no farm select for a STANDARD_USER', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(screen.queryByRole('combobox', { name: 'ffPrimaryLocation' })).toBeNull();
  });

  it("falls back to the response farm's code/name when the stored user has no farm", async () => {
    mockGetStoredUser.mockReturnValue({ ...standardUser, farm: undefined });
    render(<FeedForecastPanel />);
    await screen.findByRole('table', { name: 'ffGridLabel' });
    expect(screen.getByText('VIL100 — VILLA FRANCA FARM')).toBeTruthy();
  });
});
