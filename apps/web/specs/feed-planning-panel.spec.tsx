import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { FeedPlanningPanel, FEED_PLANNING_DEFAULTS } from '../src/components/console/inventory/feed-planning-panel';
import { api } from '../src/services/api-client';

/**
 * D32 (Rishi, 28 Sep): the six per-farm feed settings left the Add/Edit
 * Location form — they describe how a farm's feed is ordered, not the farm —
 * and are edited here, on Settings → Inventory Setup → Feed Planning. One row
 * per farm, the client defaults shown as placeholders where a farm has set
 * nothing, and the production day as a weekday name rather than the 0-6 the
 * column stores.
 */
jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), put: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const get = api.get as jest.Mock;
const put = api.put as jest.Mock;

const FARMS = [
  {
    farmId: 'f-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Colcom',
    settings: {
      feed_refill_buffer_days: 3, feed_lead_time_days: null, feed_bulk_multiple_kg: 6000,
      feed_bag_size_kg: null, feed_truck_target_kg: null, feed_production_weekday: 3,
    },
  },
  {
    farmId: 'f-gra', code: 'GRA100', name: 'Grasmere', companyId: 'co-1', companyName: 'Colcom',
    settings: {
      feed_refill_buffer_days: null, feed_lead_time_days: null, feed_bulk_multiple_kg: null,
      feed_bag_size_kg: null, feed_truck_target_kg: null, feed_production_weekday: null,
    },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({ data: FARMS });
  put.mockResolvedValue({ data: { farmId: 'f-vil', settings: {} } });
});

describe('Feed Planning (D32)', () => {
  it('reads the farm settings once and lists one row per farm as CODE — Name', async () => {
    render(<FeedPlanningPanel />);
    const table = await screen.findByRole('table', { name: 'fpTableLabel' });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-forecast/farm-settings'));
    expect(get).toHaveBeenCalledTimes(1);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('VIL100 — Villa Franca')).toBeTruthy();
    expect(within(rows[1]).getByText('GRA100 — Grasmere')).toBeTruthy();
  });

  it('shows a set value and offers the client default as a placeholder where nothing is set', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    const buffer = screen.getByLabelText('fpBuffer:{"farm":"VIL100"}') as HTMLInputElement;
    expect(buffer.value).toBe('3');
    const bag = screen.getByLabelText('fpBagSize:{"farm":"VIL100"}') as HTMLInputElement;
    expect(bag.value).toBe('');
    expect(bag.placeholder).toBe(String(FEED_PLANNING_DEFAULTS.feed_bag_size_kg));
    expect((screen.getByLabelText('fpLeadTime:{"farm":"GRA100"}') as HTMLInputElement).placeholder)
      .toBe(String(FEED_PLANNING_DEFAULTS.feed_lead_time_days));
  });

  it('offers the production day as the seven weekdays, and falls back to the default day when unset', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    const day = screen.getByLabelText('fpProductionDay:{"farm":"VIL100"}') as HTMLSelectElement;
    expect([...day.options].map((o) => o.value)).toEqual(['', '0', '1', '2', '3', '4', '5', '6']);
    expect(day.value).toBe('3');
    expect((screen.getByLabelText('fpProductionDay:{"farm":"GRA100"}') as HTMLSelectElement).value).toBe('');
  });

  it('saves one row, sending only that farm\'s six values, with an unset cell as null', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    fireEvent.change(screen.getByLabelText('fpLeadTime:{"farm":"VIL100"}'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('fpProductionDay:{"farm":"VIL100"}'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'fpSave:{"farm":"VIL100"}' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-forecast/farm-settings/f-vil', {
      feed_refill_buffer_days: 3,
      feed_lead_time_days: 1,
      feed_bulk_multiple_kg: 6000,
      feed_bag_size_kg: null,
      feed_truck_target_kg: null,
      feed_production_weekday: 5,
    }));
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('keeps Save off until the row is edited, and shows the API refusal on the row', async () => {
    put.mockRejectedValue({ message: 'feed_production_weekday must be a whole number between 0 and 6, or empty.' });
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    const save = screen.getByRole('button', { name: 'fpSave:{"farm":"GRA100"}' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('fpBuffer:{"farm":"GRA100"}'), { target: { value: '4' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(await screen.findByText('feed_production_weekday must be a whole number between 0 and 6, or empty.')).toBeTruthy();
  });

  it('says so, with a retry, when the farm list cannot be read', async () => {
    get.mockRejectedValue(new Error('Forbidden'));
    render(<FeedPlanningPanel />);
    expect(await screen.findByText('fpLoadFailed')).toBeTruthy();
    get.mockResolvedValue({ data: FARMS });
    fireEvent.click(screen.getByRole('button', { name: 'fpRetry' }));
    expect(await screen.findByText('VIL100 — Villa Franca')).toBeTruthy();
  });
});
