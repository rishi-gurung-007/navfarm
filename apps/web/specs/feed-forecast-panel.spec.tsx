import React from 'react';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import FeedForecastPanel from '../src/components/console/inventory/feed-forecast-panel';
import { api } from '../src/services/api-client';
import { getStoredUser, getActiveFarmId } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
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
jest.mock('../src/hooks/useAuth', () => ({ getStoredUser: jest.fn(), getActiveFarmId: jest.fn() }));

const get = api.get as jest.Mock;
const mockGetStoredUser = getStoredUser as jest.Mock;
const mockGetActiveFarmId = getActiveFarmId as jest.Mock;

/** api.get is called for both /location (farm picker) and /feed-forecast; tests that
 * care about fetch-loop / call-count regressions count the forecast calls only. */
function forecastCallCount(): number {
  return get.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/feed-forecast')).length;
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
    from: '2026-09-25',
    to: '2026-10-02',
    farm: { id: 'farm-vil100', code: 'VIL100', name: 'VILLA FRANCA FARM' },
    rows: [
      {
        batchNo: 'BATCH-000010',
        itemId: 'item-1',
        itemName: 'Weaner Grower Mash (18% CP)',
        shedCode: '',
        planningDate: '2026-09-25',
        sourceType: 'STORE',
        sourceCode: 'VIL100/STORE-001',
        currentInventoryKg: 35525.6,
        heads: 58,
        perDayIntakeKg: 130.152,
        sourceDailyDemandKg: 325.992,
        daysLeft: 108,
        runDownDate: null,
        refillDate: null,
        requiredOn: null,
        overdue: false,
        rangeDemandKg: 1041.216,
      },
      {
        batchNo: 'BATCH-000020',
        itemId: 'item-2',
        itemName: 'Dry Sow Gestation Mash (14% CP)',
        shedCode: 'SHED-1',
        planningDate: '2026-09-25',
        sourceType: 'SILO',
        sourceCode: 'VIL100/SILO-002',
        currentInventoryKg: 200,
        heads: 40,
        perDayIntakeKg: 100,
        sourceDailyDemandKg: 100,
        daysLeft: 2,
        runDownDate: '2026-09-27',
        refillDate: '2026-09-25',
        requiredOn: '2026-09-20',
        overdue: true,
        rangeDemandKg: 800,
      },
    ],
    flags: [
      { kind: 'HEADS_ASSUMED_FLAT', batchNo: 'BATCH-000010' },
      { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000010' },
    ],
  },
};

function routedGet(overrides?: { location?: any; feedForecast?: () => Promise<any> }) {
  return (url: string) => {
    if (url.startsWith('/location')) return Promise.resolve(overrides?.location ?? farmList);
    return overrides?.feedForecast ? overrides.feedForecast() : Promise.resolve(forecastResponse);
  };
}

describe('FeedForecastPanel — tenant admin', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(routedGet());
    mockGetStoredUser.mockReset().mockReturnValue(tenantAdminUser);
    mockGetActiveFarmId.mockReset().mockReturnValue('farm-vil100');
  });

  it('renders all 13 report columns in order', async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'ffColBatchNo',
      'ffColItemName',
      'ffColShedNo',
      'ffColPlanningDate',
      'ffColSource',
      'ffColCurrentInventoryKg',
      'ffColCurrentPigs',
      'ffColPerDayIntakeKg',
      'ffColDaysLeft',
      'ffColRunDown',
      'ffColDateToRefill',
      'ffColRequiredOn',
      'ffColDemandInRangeKg',
    ]);
  });

  it('shows an Overdue badge for an overdue row and "Lasts the range" for a null run-down date', async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('ffOverdue')).toBeTruthy();
    expect(within(table).getByText('ffLastsRange')).toBeTruthy();
  });

  it('shows a farm select defaulting to the active farm for a non-STANDARD_USER', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    const select = screen.getByRole('combobox', { name: 'ffPrimaryLocation' }) as HTMLSelectElement;
    expect(select).toBeTruthy();
    await waitFor(() => expect(select.value).toBe('farm-vil100'));
  });

  it('fetches the forecast once on mount and once more after a date changes, without looping (fix round 1)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(forecastCallCount()).toBe(1);

    fireEvent.change(screen.getByLabelText('ffDateFrom'), { target: { value: '2026-09-26' } });

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
    const table = await screen.findByRole('table');
    expect(table).toBeTruthy();
  });

  it('shows the API error message and hides the table (not "No forecast rows for this range")', async () => {
    get.mockImplementation(
      routedGet({ feedForecast: () => Promise.reject({ message: 'Farm not found.' }) }),
    );
    render(<FeedForecastPanel />);
    await screen.findByText('Farm not found.');
    expect(screen.queryByRole('table')).toBeNull();
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
    await screen.findByRole('table');

    expect(screen.getByText(/ffFlagNoFeedRowRange/)).toBeTruthy();
    expect(screen.queryByText(/ffFlagNoFeedRowSingle/)).toBeNull();
    expect(screen.getAllByText(/ffFlagNoFeedRow/).length).toBe(1);
    expect(screen.getByText(/ffFlagBatchShedUnknown/)).toBeTruthy();
  });

  it('shows a note and "—" in the Run Down column when the range ends before the planning date', async () => {
    get.mockImplementation(
      routedGet({
        feedForecast: () => Promise.resolve({
          success: true,
          data: {
            ...forecastResponse.data,
            to: '2026-09-20', // before planningDate 2026-09-25
            rows: [{ ...forecastResponse.data.rows[0], runDownDate: null }],
            flags: [],
          },
        }),
      }),
    );
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table');

    expect(screen.getByText(/ffNoteRangeBeforePlanning/)).toBeTruthy();
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(table).queryByText('ffLastsRange')).toBeNull();
  });
});

describe('FeedForecastPanel — STANDARD_USER', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(routedGet());
    mockGetStoredUser.mockReset().mockReturnValue(standardUser);
    mockGetActiveFarmId.mockReset().mockReturnValue('farm-vil100');
  });

  it('shows no farm select for a STANDARD_USER', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.queryByRole('combobox', { name: 'ffPrimaryLocation' })).toBeNull();
  });

  it("falls back to the response farm's code/name when the stored user has no farm", async () => {
    mockGetStoredUser.mockReturnValue({ ...standardUser, farm: undefined });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.getByText('VIL100 — VILLA FRANCA FARM')).toBeTruthy();
  });
});
