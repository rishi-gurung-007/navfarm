import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { FeedPlanningPanel, FEED_PLANNING_DEFAULTS, FEED_PLANNING_LAYOUT } from '../src/components/console/inventory/feed-planning-panel';
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
      feed_lead_time_days: 1, feed_bulk_multiple_kg: 6000,
      feed_bag_size_kg: null, feed_truck_target_kg: null, feed_production_weekday: 3,
    },
    silos: [
      { locationId: 's-1', code: 'VIL100/SILO-001', name: 'Feed Silo 1', feedItemCode: 'ICAT-004-ITM-0002', feedItemName: 'Dry Sow Mash', capacityKg: 10000, lowLevelKg: 2000, highLevelKg: 9000, reorderDays: 3 },
      { locationId: 's-2', code: 'VIL100/SILO-002', name: 'Feed Silo 2', feedItemCode: null, feedItemName: null, capacityKg: 20000, lowLevelKg: null, highLevelKg: null, reorderDays: null },
    ],
  },
  {
    farmId: 'f-gra', code: 'GRA100', name: 'Grasmere', companyId: 'co-1', companyName: 'Colcom',
    settings: {
      feed_lead_time_days: null, feed_bulk_multiple_kg: null,
      feed_bag_size_kg: null, feed_truck_target_kg: null, feed_production_weekday: null,
    },
    silos: [],
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({ data: FARMS });
  put.mockResolvedValue({ data: { farmId: 'f-vil', settings: {} } });
});

describe('D38 — Refill Buffer is off Feed Planning', () => {
  it('offers the five farm settings and no refill buffer', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    expect(Object.keys(FEED_PLANNING_DEFAULTS)).toEqual([
      'feed_lead_time_days', 'feed_bulk_multiple_kg', 'feed_bag_size_kg', 'feed_truck_target_kg', 'feed_production_weekday',
    ]);
    expect(screen.queryByLabelText('fpBuffer:{"farm":"VIL100"}')).toBeNull();
    // 5 settings + the farm cell + the save cell
    expect(within(screen.getByRole('table', { name: 'fpTableLabel' })).getAllByRole('columnheader')).toHaveLength(7);
  });

  it('sends only the five, so a save cannot write a refill buffer', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    fireEvent.change(screen.getByLabelText('fpLeadTime:{"farm":"VIL100"}'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'fpSave:{"farm":"VIL100"}' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(Object.keys(put.mock.calls[0][1])).not.toContain('feed_refill_buffer_days');
    expect(Object.keys(put.mock.calls[0][1])).toHaveLength(5);
  });
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
    const lead = screen.getByLabelText('fpLeadTime:{"farm":"VIL100"}') as HTMLInputElement;
    expect(lead.value).toBe('1');
    const bag = screen.getByLabelText('fpBagSize:{"farm":"VIL100"}') as HTMLInputElement;
    expect(bag.value).toBe('');
    expect(bag.placeholder).toBe(String(FEED_PLANNING_DEFAULTS.feed_bag_size_kg));
    expect((screen.getByLabelText('fpBulkMultiple:{"farm":"GRA100"}') as HTMLInputElement).placeholder)
      .toBe(String(FEED_PLANNING_DEFAULTS.feed_bulk_multiple_kg));
  });

  it('offers the production day as the seven weekdays, and falls back to the default day when unset', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    const day = screen.getByLabelText('fpProductionDay:{"farm":"VIL100"}') as HTMLSelectElement;
    expect([...day.options].map((o) => o.value)).toEqual(['', '0', '1', '2', '3', '4', '5', '6']);
    expect(day.value).toBe('3');
    expect((screen.getByLabelText('fpProductionDay:{"farm":"GRA100"}') as HTMLSelectElement).value).toBe('');
  });

  it('saves one row, sending only that farm\'s five values, with an unset cell as null', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    fireEvent.change(screen.getByLabelText('fpLeadTime:{"farm":"VIL100"}'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('fpProductionDay:{"farm":"VIL100"}'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'fpSave:{"farm":"VIL100"}' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-forecast/farm-settings/f-vil', {
      feed_lead_time_days: 2,
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
    fireEvent.change(screen.getByLabelText('fpLeadTime:{"farm":"GRA100"}'), { target: { value: '4' } });
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

/**
 * The row has to fit without a sideways scroll at 1440 and at 1024 (controller,
 * 28 Sep: at 1440x900 it was 1159 px inside a 1114 px box, so the Save button
 * was cut off). The shell is a grid — a 260 px sidebar beside the page, and the
 * page's own lg:px-7 padding — so the content box is the window less 316 px:
 * 1124 px at 1440, and 708 px at 1024, which is the one that binds.
 *
 * A jsdom test cannot lay the table out, so the budget is asserted from the
 * widths the component declares. Keeping this honest means the widths live in
 * FEED_PLANNING_LAYOUT and the component renders from it.
 */
describe('Feed Planning fits 1024 without a sideways scroll (D32 follow-up)', () => {
  const CONTENT_AT_1024 = 1024 - 260 - 56;

  it('budgets every column inside the 1024 content box', () => {
    const { cellPaddingPx, farmPx, inputsPx, selectPx, savePx } = FEED_PLANNING_LAYOUT;
    const columns = 1 + inputsPx.length + 2;
    const total = farmPx + inputsPx.reduce((a, b) => a + b, 0) + selectPx + savePx + columns * cellPaddingPx;
    expect(total).toBeLessThanOrEqual(CONTENT_AT_1024);
    expect(FEED_PLANNING_LAYOUT.totalPx).toBe(total);
  });

  it('leaves room for the longest value each cell can hold', () => {
    // 12px tabular numerals are about 7.2 px wide, and nf-input-sm adds 8 px of
    // padding either side. Five digits is the widest figure any column takes.
    const widestNumber = Math.ceil(5 * 7.2) + 16;
    for (const width of FEED_PLANNING_LAYOUT.inputsPx) expect(width).toBeGreaterThanOrEqual(widestNumber);
    // "Wednesday" at 12 px, plus the select's arrow and padding.
    expect(FEED_PLANNING_LAYOUT.selectPx).toBeGreaterThanOrEqual(Math.ceil(9 * 6.9) + 20 + 16);
  });

  it('renders the inputs and the select at the budgeted widths', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    const lead = screen.getByLabelText('fpLeadTime:{"farm":"VIL100"}') as HTMLInputElement;
    expect(lead.style.width).toBe(`${FEED_PLANNING_LAYOUT.inputsPx[0]}px`);
    const day = screen.getByLabelText('fpProductionDay:{"farm":"VIL100"}') as HTMLSelectElement;
    expect(day.style.width).toBe(`${FEED_PLANNING_LAYOUT.selectPx}px`);
  });

  it('keeps the unset production day narrow, with the standard day named in the intro instead', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    const day = screen.getByLabelText('fpProductionDay:{"farm":"GRA100"}') as HTMLSelectElement;
    expect(day.options[0].textContent).toBe('—');
    expect(screen.getByText('fpIntro:{"day":"fpDaySun"}')).toBeTruthy();
  });

  it('saves with an icon-only button that still names the farm', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    const save = screen.getByRole('button', { name: 'fpSave:{"farm":"VIL100"}' });
    expect(save.textContent).toBe('');
  });
});


/**
 * D41 (Rishi, 29 Sep): the delivery settings stay per farm — one truck, one
 * trip, one deadline per farm cycle — and each farm's silos are listed beneath
 * it, their levels and reorder days editable there with the silo form's rules.
 */
describe('D41 — each farm\'s silos under its delivery settings', () => {
  it('lists a farm\'s silos as code — name, with the feed each holds read-only', async () => {
    render(<FeedPlanningPanel />);
    const silos = await screen.findByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' });
    const rows = within(silos).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('VIL100/SILO-001 — Feed Silo 1');
    expect(rows[0].textContent).toContain('Dry Sow Mash');
    // an empty silo says so rather than leaving the cell blank
    expect(rows[1].textContent).toMatch(/fpSiloEmpty/);
  });

  it('shows the feed held as text, never as a control', async () => {
    render(<FeedPlanningPanel />);
    const silos = await screen.findByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' });
    const held = within(within(silos).getAllByRole('row')[1]).getAllByRole('cell')[1];
    expect(within(held).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(held).queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('offers capacity, both levels and the reorder days per silo', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' });
    expect((screen.getByLabelText('fpSiloLow:{"silo":"VIL100/SILO-001"}') as HTMLInputElement).value).toBe('2000');
    expect((screen.getByLabelText('fpSiloHigh:{"silo":"VIL100/SILO-001"}') as HTMLInputElement).value).toBe('9000');
    expect((screen.getByLabelText('fpSiloReorder:{"silo":"VIL100/SILO-001"}') as HTMLInputElement).value).toBe('3');
    // capacity is the silo's own figure, shown for context
    expect(screen.getByText('10,000')).toBeTruthy();
  });

  it('saves one silo row through the silo endpoint, sending only what it holds', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' });
    fireEvent.change(screen.getByLabelText('fpSiloReorder:{"silo":"VIL100/SILO-001"}'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'fpSiloSave:{"silo":"VIL100/SILO-001"}' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-forecast/farm-settings/f-vil/silos/s-1', {
      low_level_kg: 2000,
      high_level_kg: 9000,
      silo_reorder_days: 1,
    }));
  });

  it('keeps a silo\'s Save off until that row is edited', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' });
    const save = screen.getByRole('button', { name: 'fpSiloSave:{"silo":"VIL100/SILO-001"}' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('fpSiloLow:{"silo":"VIL100/SILO-001"}'), { target: { value: '2500' } });
    expect(save.disabled).toBe(false);
  });

  it('shows the API\'s own refusal when the levels are wrong', async () => {
    put.mockRejectedValue({ message: 'The low feed level must be below the high feed level.' });
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpSiloTableLabel:{"farm":"VIL100"}' });
    fireEvent.change(screen.getByLabelText('fpSiloLow:{"silo":"VIL100/SILO-001"}'), { target: { value: '9500' } });
    fireEvent.click(screen.getByRole('button', { name: 'fpSiloSave:{"silo":"VIL100/SILO-001"}' }));
    expect(await screen.findByText('The low feed level must be below the high feed level.')).toBeTruthy();
  });

  it('says so when a farm has no silo', async () => {
    render(<FeedPlanningPanel />);
    await screen.findByRole('table', { name: 'fpTableLabel' });
    expect(screen.getByText('fpNoSilos:{"farm":"GRA100"}')).toBeTruthy();
  });

  it('fits 1024 without a sideways scroll: the silo row is budgeted too', () => {
    const { cellPaddingPx, siloPx, siloTotalPx, totalPx } = FEED_PLANNING_LAYOUT;
    // silo, feed held, capacity, three inputs, save — every one padded.
    expect(siloPx).toHaveLength(7);
    expect(siloTotalPx).toBe(siloPx.reduce((a, b) => a + b, 0) + 5 * cellPaddingPx);
    // The binding case: a 260 px sidebar and the page's own lg:px-7 leave 708 px.
    expect(siloTotalPx).toBeLessThanOrEqual(1024 - 260 - 56);
    // and the farm row above it still fits, so neither table scrolls sideways
    expect(totalPx).toBeLessThanOrEqual(1024 - 260 - 56);
  });
});
