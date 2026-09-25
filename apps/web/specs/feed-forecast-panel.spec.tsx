import React from 'react';
import { render, screen, within } from '@testing-library/react';
import FeedForecastPanel from '../src/components/console/inventory/feed-forecast-panel';
import { api } from '../src/services/api-client';
import { getStoredUser, getActiveFarmId } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key) }) }));
jest.mock('../src/hooks/useAuth', () => ({ getStoredUser: jest.fn(), getActiveFarmId: jest.fn() }));

const get = api.get as jest.Mock;
const mockGetStoredUser = getStoredUser as jest.Mock;
const mockGetActiveFarmId = getActiveFarmId as jest.Mock;

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

describe('FeedForecastPanel — tenant admin', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue(forecastResponse);
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
    expect(screen.getByRole('combobox', { name: 'ffPrimaryLocation' })).toBeTruthy();
  });
});

describe('FeedForecastPanel — STANDARD_USER', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue(forecastResponse);
    mockGetStoredUser.mockReset().mockReturnValue(standardUser);
    mockGetActiveFarmId.mockReset().mockReturnValue('farm-vil100');
  });

  it('shows no farm select for a STANDARD_USER', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.queryByRole('combobox', { name: 'ffPrimaryLocation' })).toBeNull();
  });
});
