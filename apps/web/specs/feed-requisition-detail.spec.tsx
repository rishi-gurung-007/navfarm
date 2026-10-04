import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FeedRequisitionDetail } from '../src/components/console/inventory/feed-requisition-detail';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

// Copied from requisitions-panel.spec.tsx's `view` fixture (Task 11 brief, Step 1),
// with farm_id added — the one deliberate interface change this task makes.
const view: any = {
  requisition_id: 'req-1', req_no: 'REQ-VIL100-2026-00004', requisition_type: 'FEED_FORECAST', source: 'AUTO_FORECAST',
  purpose: 'INTERNAL_TRANSFER', supply_source: 'MILL', status: 'AUTO_DRAFT', priority: 'CRITICAL', approval_request_id: null,
  production_date: '2099-09-27', submission_deadline: '2099-09-26', remarks: null, truck_target_kg: 30000, approved_at: null,
  farm_id: 'farm-vil',
  header: {
    farm_code: 'VIL100', farm_name: 'Villa Franca', requisition_date: '2099-09-20', is_next_diet_requisition: true,
    farm_total_requested_kg: 15000, truck_target_kg: 30000, bulk_multiple_kg: 3000, trips: 1, required_delivery_date: '2099-09-23',
    approved_by_name: null, linked_transfer_no: null, forecast_run_no: 'FFR-farm-vil-000004',
  },
  lines: [
    { line_id: 'L1', line_seq: 10000, destination_location_id: 'silo-1', destination_code: 'VIL100/SILO-001', item_id: 'r1', item_code: 'FEED-R1', item_name: 'Weaner Diet R1',
      item_description: 'Weaner Diet R1', required_item_id: 'r1', lifecycle_ref_label: 'L-LINE WEANER days 21–24', first_shortage_date: '2099-09-23',
      exceeds_silo_capacity: false, exception_reason: null, breakdown: [], feed_type: 'BULK',
      is_next_diet: false, days_before_diet_change: null, system_balance_kg: '1500.0000', daily_requirement_kg: '2000.0000', days_remaining: 0,
      unrounded_need_kg: '4500.0000', recommended_qty_kg: '6000.0000', quantity: '6000.0000', bag_count: null, proposed_delivery_date: '2099-09-23', needs_silo_changeover: false },
    { line_id: 'L2', line_seq: 20000, destination_location_id: 'silo-2', destination_code: 'VIL100/SILO-002', item_id: 'r2', item_code: 'FEED-R2', item_name: 'Weaner Diet R2',
      item_description: 'Weaner Diet R2', required_item_id: 'r2', lifecycle_ref_label: 'L-LINE WEANER days 25–27', first_shortage_date: '2099-09-26',
      exceeds_silo_capacity: false, exception_reason: null, feed_type: 'BULK',
      breakdown: [{ batch_id: 'b1', batch_no: 'B-001', shed_id: 'h3', shed_code: 'VIL100/SHED-003', heads: 1000, feed_rate_kg: 0.5,
        lifecycle_ref_label: 'L-LINE WEANER days 25–27', demand_kg: 995, first_demand_date: '2099-09-26' }],
      is_next_diet: true, days_before_diet_change: 3, system_balance_kg: '1000.0000', daily_requirement_kg: '2500.0000', days_remaining: null,
      unrounded_need_kg: '9000.0000', recommended_qty_kg: '9000.0000', quantity: '9000.0000', bag_count: null, proposed_delivery_date: '2099-09-26', needs_silo_changeover: false },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation(async (url: string) =>
    url.startsWith('/feed-requisition/options') ? { data: { destinations: [], items: [] } } : { data: view });
  post.mockResolvedValue({ data: { ...view, status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' } });
  put.mockResolvedValue({ data: view });
});

describe('FeedRequisitionDetail (D26, Task 11: one feed document for both entry points)', () => {
  it("fetches the farm's options from view.farm_id", async () => {
    render(<FeedRequisitionDetail view={view} onView={jest.fn()} onBack={jest.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition/options?farmId=farm-vil'));
  });

  it('edits a line quantity and Save calls PUT and then onView with the response', async () => {
    const onView = jest.fn();
    render(<FeedRequisitionDetail view={view} onView={onView} onBack={jest.fn()} />);
    fireEvent.change(await screen.findByLabelText('rqdRequestedFor:{"line":10000}'), { target: { value: '6100' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqSave' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-requisition/req-1', { remarks: '', lines: [{ line_id: 'L1', quantity_kg: 6100 }] }));
    await waitFor(() => expect(onView).toHaveBeenCalledWith(view, 'rqSaved'));
  });

  it('renders no Save or Submit buttons once APPROVED', async () => {
    const approvedView = { ...view, status: 'APPROVED' };
    get.mockImplementation(async (url: string) =>
      url.startsWith('/feed-requisition/options') ? { data: { destinations: [], items: [] } } : { data: approvedView });
    render(<FeedRequisitionDetail view={approvedView} onView={jest.fn()} onBack={jest.fn()} />);
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    expect(screen.queryByRole('button', { name: 'rqSave' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'rqSubmit' })).toBeNull();
  });

  it('calls onBack when the back button is clicked', async () => {
    const onBack = jest.fn();
    render(<FeedRequisitionDetail view={view} onView={jest.fn()} onBack={onBack} />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqBack' }));
    expect(onBack).toHaveBeenCalled();
  });
});
