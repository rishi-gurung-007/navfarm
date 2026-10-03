import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FeedPlanningPanel, FEED_PLANNING_LAYOUT } from '../src/components/console/inventory/feed-planning-panel';
import InventorySetupPage from '../src/app/(app)/settings/inventory-setup/page';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), put: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({
  getStoredUser: () => ({ companies: [{ company_id: 'co-1', company_name: 'Colcom' }] }),
  getActiveCompanyId: () => 'co-1',
  setActiveCompanyId: jest.fn(),
}));
jest.mock('../src/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string, vars?: Record<string, any>) => key === 'fpTableLabel'
    ? 'Silo Feed Setup by farm and silo'
    : vars ? `${key}:${JSON.stringify(vars)}` : key }),
}));

const get = api.get as jest.Mock;
const put = api.put as jest.Mock;
const FARMS = [
  { farmId: 'f-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Colcom', settings: { feed_lead_time_days: 1 }, silos: [
    { locationId: 's-1', code: 'VIL100/SILO-001', name: 'Feed Silo 1', linkedSheds: [{ locationId: 'sh-1', code: 'VIL100/SHED-001', name: 'Dry Sow House' }], feedType: 'BULK', feedItemCode: 'FEED-1', feedItemName: 'Dry Sow Mash', capacityKg: 10000, lowLevelKg: 2000, highLevelKg: 9000, status: 'ACTIVE' },
    { locationId: 's-2', code: 'VIL100/SILO-002', name: 'Feed Silo 2', linkedSheds: [], feedType: 'BAGGED', feedItemCode: null, feedItemName: null, capacityKg: 20000, lowLevelKg: null, highLevelKg: null, status: 'INACTIVE' },
  ] },
  { farmId: 'f-gra', code: 'GRA100', name: 'Grasmere', companyId: 'co-1', companyName: 'Colcom', settings: {}, silos: [] },
];
const toggle = (code: string) => screen.getByRole('button', { name: new RegExp(`fpSiloHeading.*${code}`) });
const expand = (code: string) => fireEvent.click(toggle(code));

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({ data: FARMS });
  put.mockResolvedValue({ data: {} });
});

describe('Silo Feed Setup — silos grouped by farm', () => {
  it('renders farms as collapsed parents with no unsupported farm-setting inputs', async () => {
    render(<FeedPlanningPanel />);
    const table = await screen.findByRole('table', { name: 'Silo Feed Setup by farm and silo' });
    expect(get).toHaveBeenCalledWith('/feed-forecast/farm-settings');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(1);
    expect(toggle('VIL100').getAttribute('aria-expanded')).toBe('false');
    for (const key of ['fpLeadTime', 'fpBulkMultiple', 'fpBagSize', 'fpTruckTarget', 'fpProductionDay']) {
      expect(screen.queryByLabelText(new RegExp(key))).toBeNull();
    }
    expect(screen.queryByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' })).toBeNull();
  });

  it('nests the silo table immediately below its expandable farm row', async () => {
    render(<FeedPlanningPanel />);
    const farms = await screen.findByRole('table', { name: 'Silo Feed Setup by farm and silo' });
    expand('VIL100');
    expect(toggle('VIL100').getAttribute('aria-expanded')).toBe('true');
    const silos = screen.getByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' });
    expect(screen.getByText('VIL100 — Villa Franca').closest('tr')?.nextElementSibling?.contains(silos)).toBe(true);
    expect(farms.contains(silos)).toBe(true);
    expect(within(silos).getAllByRole('row')).toHaveLength(3);
    fireEvent.click(toggle('VIL100'));
    expect(screen.queryByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' })).toBeNull();
  });

  // Task 4 (3 Oct ruling): reorder days left this screen for Location Master
  // (spec R6) — only the two levels are edited here now.
  it('shows every Silo Feed Setup fact explicitly while only levels are editable', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'Silo Feed Setup by farm and silo' });
    expand('VIL100');
    const silos = screen.getByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' });
    expect(within(silos).getAllByRole('columnheader')).toHaveLength(11);
    for (const key of ['fpSiloColCode', 'fpSiloColName', 'fpSiloColSheds', 'fpSiloColFeedType', 'fpSiloColFeedItemCode', 'fpSiloColFeedItemName', 'fpSiloColCapacity', 'fpSiloLowCol', 'fpSiloHighCol', 'fpSiloColStatus']) {
      expect(within(silos).getByText(key)).toBeTruthy();
    }
    expect(within(silos).queryByText('fpSiloReorderCol')).toBeNull();
    expect(screen.getByText('VIL100/SILO-001')).toBeTruthy();
    expect(screen.getByText('Feed Silo 1')).toBeTruthy();
    expect(screen.getByText('VIL100/SHED-001 — Dry Sow House')).toBeTruthy();
    expect((screen.getByLabelText('fpSiloFeedType:{"silo":"VIL100/SILO-001"}') as HTMLSelectElement).value).toBe('BULK');
    expect(screen.getByText('FEED-1')).toBeTruthy();
    expect(screen.getByText('Dry Sow Mash')).toBeTruthy();
    expect(screen.getByText('ACTIVE')).toBeTruthy();
    expect(screen.getByText('10,000')).toBeTruthy();
    expect(within(silos).getAllByRole('spinbutton')).toHaveLength(4);
    expect(screen.queryByLabelText('fpSiloReorder:{"silo":"VIL100/SILO-001"}')).toBeNull();
    const low = screen.getByLabelText('fpSiloLow:{"silo":"VIL100/SILO-001"}') as HTMLInputElement;
    expect(low.value).toBe('2000');
    expect((screen.getByLabelText('fpSiloHigh:{"silo":"VIL100/SILO-001"}') as HTMLInputElement).value).toBe('9000');
    fireEvent.change(low, { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'fpSiloSave:{"silo":"VIL100/SILO-001"}' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-forecast/farm-settings/f-vil/silos/s-1', {
      low_level_kg: 2500, high_level_kg: 9000, feedType: 'BULK',
    }));
  });

  it('edits Feed Type as a BULK / BAGGED select and saves it', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'Silo Feed Setup by farm and silo' });
    expand('VIL100');
    const select = screen.getByLabelText('fpSiloFeedType:{"silo":"VIL100/SILO-001"}') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['BULK', 'BAGGED']);
    expect((screen.getByLabelText('fpSiloFeedType:{"silo":"VIL100/SILO-002"}') as HTMLSelectElement).value).toBe('BAGGED');
    fireEvent.change(select, { target: { value: 'BAGGED' } });
    fireEvent.click(screen.getByRole('button', { name: 'fpSiloSave:{"silo":"VIL100/SILO-001"}' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-forecast/farm-settings/f-vil/silos/s-1', {
      low_level_kg: 2000, high_level_kg: 9000, feedType: 'BAGGED',
    }));
  });

  it('shows Silo Feed Setup as the visible tab and opens the matching panel', async () => {
    get.mockImplementation((url: string) => Promise.resolve({ data: url.startsWith('/inventory-setup') ? {
      company_id: 'co-1', setup_id: 'setup-1', numbering_config: {}, general_config: {},
      series_by_master: {}, available_masters: [], updated_at: null,
    } : FARMS }));
    render(<InventorySetupPage />);
    const tab = await screen.findByRole('button', { name: 'Silo Feed Setup' });
    expect(screen.queryByRole('button', { name: 'Feed Planning' })).toBeNull();
    fireEvent.click(tab);
    expect(await screen.findByRole('table', { name: 'Silo Feed Setup by farm and silo' })).toBeTruthy();
  });

  it('shows a no-silo child state and retries a failed load', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'Silo Feed Setup by farm and silo' });
    expand('GRA100');
    expect(screen.getByText('fpNoSilos:{"farm":"GRA100"}')).toBeTruthy();
  });

  it('keeps the silo row inside the 1024px content budget', () => {
    const { cellPaddingPx, siloPx, siloTotalPx } = FEED_PLANNING_LAYOUT;
    expect(siloTotalPx).toBe(siloPx.reduce((a, b) => a + b, 0) + 11 * cellPaddingPx);
    expect(siloTotalPx).toBeLessThanOrEqual(1024);
  });
});
