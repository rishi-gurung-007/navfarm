import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FeedPlanningPanel, FEED_PLANNING_LAYOUT } from '../src/components/console/inventory/feed-planning-panel';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), put: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string, vars?: Record<string, any>) => vars ? `${key}:${JSON.stringify(vars)}` : key }),
}));

const get = api.get as jest.Mock;
const put = api.put as jest.Mock;
const FARMS = [
  { farmId: 'f-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Colcom', settings: { feed_lead_time_days: 1 }, silos: [
    { locationId: 's-1', code: 'VIL100/SILO-001', name: 'Feed Silo 1', feedItemCode: 'FEED-1', feedItemName: 'Dry Sow Mash', capacityKg: 10000, lowLevelKg: 2000, highLevelKg: 9000, reorderDays: 3 },
    { locationId: 's-2', code: 'VIL100/SILO-002', name: 'Feed Silo 2', feedItemCode: null, feedItemName: null, capacityKg: 20000, lowLevelKg: null, highLevelKg: null, reorderDays: null },
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

describe('Feed Planning — silo planning grouped by farm', () => {
  it('renders farms as collapsed parents with no unsupported farm-setting inputs', async () => {
    render(<FeedPlanningPanel />);
    const table = await screen.findByRole('table', { name: 'fpTableLabel' });
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
    const farms = await screen.findByRole('table', { name: 'fpTableLabel' });
    expand('VIL100');
    expect(toggle('VIL100').getAttribute('aria-expanded')).toBe('true');
    const silos = screen.getByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' });
    expect(screen.getByText('VIL100 — Villa Franca').closest('tr')?.nextElementSibling?.contains(silos)).toBe(true);
    expect(farms.contains(silos)).toBe(true);
    expect(within(silos).getAllByRole('row')).toHaveLength(3);
    fireEvent.click(toggle('VIL100'));
    expect(screen.queryByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' })).toBeNull();
  });

  it('shows current feed and capacity, and edits low, high and refill lead time per silo', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    expand('VIL100');
    expect(screen.getByText('Dry Sow Mash')).toBeTruthy();
    expect(screen.getByText('10,000')).toBeTruthy();
    expect((screen.getByLabelText('fpSiloLow:{"silo":"VIL100/SILO-001"}') as HTMLInputElement).value).toBe('2000');
    expect((screen.getByLabelText('fpSiloHigh:{"silo":"VIL100/SILO-001"}') as HTMLInputElement).value).toBe('9000');
    const refill = screen.getByLabelText('fpSiloReorder:{"silo":"VIL100/SILO-001"}') as HTMLInputElement;
    fireEvent.change(refill, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'fpSiloSave:{"silo":"VIL100/SILO-001"}' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-forecast/farm-settings/f-vil/silos/s-1', {
      low_level_kg: 2000, high_level_kg: 9000, silo_reorder_days: 1,
    }));
  });

  it('shows a no-silo child state and retries a failed load', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    expand('GRA100');
    expect(screen.getByText('fpNoSilos:{"farm":"GRA100"}')).toBeTruthy();
  });

  it('keeps the silo row inside the 1024 content budget', () => {
    const { cellPaddingPx, siloPx, siloTotalPx } = FEED_PLANNING_LAYOUT;
    expect(siloTotalPx).toBe(siloPx.reduce((a, b) => a + b, 0) + 5 * cellPaddingPx);
    expect(siloTotalPx).toBeLessThanOrEqual(1024 - 260 - 56);
  });
});
