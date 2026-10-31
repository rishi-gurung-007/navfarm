import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { FeedConsolidationDialog } from '../src/components/console/inventory/feed-consolidation-dialog';
import { api } from '../src/services/api-client';

jest.mock('../src/components/ui/toast', () => ({ showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }, Toast: () => null }));
jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t }) };
});

const line = {
  requisition_id: 'req-1', req_no: 'REQ-MUL100-2026-00001', farm_id: 'farm-1', farm_code: 'MUL100', farm_name: 'GRASMERE',
  line_id: 'line-1', item_id: 'item-1', item_code: 'FEED000017', item_name: 'Grower 2', quantity: '3000.0000',
  destination_silo_id: 'silo-1', destination_silo_code: 'MGH6-G2', destination_silo_name: 'Grower house 6 silo 2',
  proposed_delivery_date: '2026-11-01', production_date: null, feed_type: 'BULK', diet_no: null, loading_bin: null,
  available_mill_output_kg: null, priority: 'CRITICAL', priority_no: 1, figures_source: 'STORED',
  silo_capacity_kg: 5800, system_balance_kg: 700, daily_requirement_kg: 347.3, days_remaining: 2,
  lifecycle_ref_label: 'Z-LINE-SOW GROWER weeks 14–22', days_before_diet_change: null, is_next_diet: false,
  delivery_day_stock_kg: 3000,
  forecast_days: [
    { date: '2026-10-31', stock_kg: 3300, required_kg: 347.3, covered: true },
    { date: '2026-11-01', stock_kg: 3000, required_kg: 347.3, covered: true },
    { date: '2026-11-02', stock_kg: 6000, required_kg: 347.3, covered: true },
    { date: '2026-11-03', stock_kg: 5.4, required_kg: 347.3, covered: false },
    { date: '2026-11-04', stock_kg: 0, required_kg: null, covered: null },
  ],
};

describe('Mill consolidation sheet (Rishi, 30 Oct)', () => {
  beforeEach(() => (api.get as jest.Mock).mockResolvedValue({ data: [line, { ...line, line_id: 'line-2', destination_silo_id: null, destination_silo_code: null, forecast_days: [], lifecycle_ref_label: null }, { ...line, line_id: 'line-3', requisition_id: 'req-3', proposed_delivery_date: '2026-10-26', delivery_overdue: true }] }));

  it('opens near full-screen and shows each line its lifecycle row and its silo forecast day by day', async () => {
    render(<FeedConsolidationDialog open onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.getByRole('dialog').className).toContain('w-[98vw]');
    // Rishi, 31 Oct: the waiting requisitions load as the sheet opens — no Find needed.
    const table = await screen.findByRole('table');
    expect(api.get).toHaveBeenCalledWith('/feed-requisition/consolidations/eligible?withPriority=true');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['fcdColLifecycle', 'fcdColDaysBeforeDiet', '31/10/26', '01/11/26', '02/11/26']));
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(within(first).getByText('Z-LINE-SOW GROWER weeks 14–22')).toBeTruthy();
    // The delivery morning is outlined; a morning past the 5,800 KG capacity says so on hover.
    const delivery = first.querySelector('td[data-delivery-day]') as HTMLElement;
    expect(delivery.querySelector('[data-hint]')!.getAttribute('data-hint')).toContain('fcdDeliveryDayHint');
    const over = first.querySelector('td[data-over-capacity]')!;
    expect(over.querySelector('[data-hint]')!.getAttribute('data-hint')).toContain('fcdOverCapacityHint');
    // Rishi, 31 Oct: the day cells hold no kilograms — only the tick, the cross or N/A.
    for (const cell of first.querySelectorAll('td[data-covered]')) expect(cell.textContent).toBe('');
    expect(first.querySelector('td[data-covered="true"] [data-hint]')!.getAttribute('data-hint')).toContain('fcdCoveredHint');
    // Rishi, 31 Oct: a tick on a day the silo covers, a cross on a short one, N/A when the feed is not needed.
    expect(first.querySelectorAll('td[data-covered="true"] [aria-label="fcdCovered"]')).toHaveLength(3);
    const short = first.querySelector('td[data-covered="false"]')!;
    expect(short.querySelector('[aria-label="fcdShort"]')).toBeTruthy();
    expect(short.querySelector('[data-hint]')!.getAttribute('data-hint')).toContain('fcdShortHint');
    const notNeeded = first.querySelector('td[data-not-required]')!;
    expect(notNeeded.textContent).toBe('fcdNotAvailable');
    expect(notNeeded.querySelector('[data-hint]')!.getAttribute('data-hint')).toBe('fcdNotRequiredOnDate');
    // A late delivery is outlined on the first day and says so on hover.
    const lateRow = within(table).getAllByRole('row')[3];
    const late = lateRow.querySelector('td[data-delivery-late]') as HTMLElement;
    expect(late.textContent).toBe('');
    expect(late.querySelector('[data-hint]')!.getAttribute('data-hint')).toContain('fcdLateDeliveryHint');
    // A store line has no silo stock to project: N/A with the reason on hover.
    expect(second.querySelectorAll('[data-hint="fcdNaStore"]')).toHaveLength(5);
  });

  it('says none are waiting, not "press Find", when the opening search finds nothing', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });
    render(<FeedConsolidationDialog open onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(await screen.findByText('fcdEmpty')).toBeTruthy();
    expect(screen.queryByText('fcdPrompt')).toBeNull();
  });
});
