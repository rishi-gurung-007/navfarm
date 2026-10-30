import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    { date: '2026-10-31', stock_kg: 3300 },
    { date: '2026-11-01', stock_kg: 3000 },
    { date: '2026-11-02', stock_kg: 6000 },
  ],
};

describe('Mill consolidation sheet (Rishi, 30 Oct)', () => {
  beforeEach(() => (api.get as jest.Mock).mockResolvedValue({ data: [line, { ...line, line_id: 'line-2', destination_silo_id: null, destination_silo_code: null, forecast_days: [], lifecycle_ref_label: null }] }));

  it('opens near full-screen and shows each line its lifecycle row and its silo forecast day by day', async () => {
    render(<FeedConsolidationDialog open onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.getByRole('dialog').className).toContain('w-[98vw]');
    fireEvent.click(screen.getByRole('button', { name: 'fcdFind' }));
    const table = await screen.findByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['fcdColLifecycle', 'fcdColDaysBeforeDiet', '31/10/26', '01/11/26', '02/11/26']));
    const [first, second] = within(table).getAllByRole('row').slice(1);
    expect(within(first).getByText('Z-LINE-SOW GROWER weeks 14–22')).toBeTruthy();
    // The delivery morning is outlined; a morning past the 5,800 KG capacity reads red.
    const delivery = first.querySelector('td[data-delivery-day]') as HTMLElement;
    expect(delivery.textContent).toBe('3,000');
    const over = within(first).getByText('6,000');
    expect(over.getAttribute('style')).toContain('var(--danger)');
    // A store line has no silo stock to project: N/A with the reason on hover.
    expect(second.querySelectorAll('[data-hint="fcdNaStore"]')).toHaveLength(3);
  });
});
