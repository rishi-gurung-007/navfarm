import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeedRequisitionApprovalDetail } from '../src/components/console/approvals/feed-requisition-approval-detail';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const get = api.get as jest.Mock;
const line = (id: string, seq: number, dest: string, item: string, name: string, rec: string, qty: string, date: string) => ({
  line_id: id, line_seq: seq, destination_location_id: `loc-${id}`, destination_code: dest, item_id: `i-${id}`, item_code: item, item_name: name,
  item_description: name, required_item_id: `i-${id}`, lifecycle_ref_label: 'L-LINE WEANER days 21–24', first_shortage_date: date,
  exceeds_silo_capacity: false, exception_reason: null, breakdown: [], feed_type: 'BULK', is_next_diet: false, days_before_diet_change: null,
  system_balance_kg: '1500.0000', daily_requirement_kg: '2000.0000', days_remaining: 0, unrounded_need_kg: rec,
  recommended_qty_kg: rec, quantity: qty, bag_count: null, proposed_delivery_date: date, needs_silo_changeover: false,
});
const view = {
  requisition_id: 'req-4', req_no: 'REQ-VIL100-2026-00004', requisition_type: 'FEED_FORECAST', source: 'AUTO_FORECAST',
  purpose: 'INTERNAL_TRANSFER', supply_source: 'MILL', status: 'PENDING_APPROVAL', priority: 'CRITICAL', approval_request_id: 'ar-4',
  production_date: '2099-09-27', submission_deadline: '2099-09-26', remarks: 'Extra pigs arriving', truck_target_kg: 30000, approved_at: null,
  header: {
    farm_code: 'VIL100', farm_name: 'Villa Franca', requisition_date: '2099-09-20', is_next_diet_requisition: false,
    farm_total_requested_kg: 15000, truck_target_kg: 30000, bulk_multiple_kg: 3000, trips: 1, required_delivery_date: '2099-09-23',
    approved_by_name: null, linked_transfer_no: null, forecast_run_no: 'FFR-farm-vil-000004',
  },
  lines: [
    line('L1', 10000, 'VIL100/SILO-001', 'FEED-R1', 'Weaner Diet R1', '6000.0000', '6000.0000', '2099-09-23'),
    line('L2', 20000, 'VIL100/SILO-002', 'FEED-R2', 'Weaner Diet R2', '9000.0000', '9000.0000', '2099-09-26'),
  ],
};

describe('FeedRequisitionApprovalDetail (D25)', () => {
  beforeEach(() => get.mockReset().mockResolvedValue({ data: view }));

  it('shows the full requisition document read-only, with a link to the requisition', async () => {
    render(<FeedRequisitionApprovalDetail documentId="req-4" pending remarks="" onRemarksChange={jest.fn()} />);
    expect(await screen.findByText('rqdHeaderTitle')).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/feed-requisition/req-4');
    expect(screen.getByText('10000')).toBeTruthy();
    expect(screen.getByText('20000')).toBeTruthy();
    // The approver reads the document; the only input is the approver's own remarks.
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByLabelText('apReqApproverRemarks')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'apReqOpen' }).getAttribute('href')).toBe('/approvals/requisitions?id=req-4');
  });

  it('takes the approver\'s remarks while pending, and hides the box once decided', async () => {
    const onRemarksChange = jest.fn();
    const { rerender } = render(<FeedRequisitionApprovalDetail documentId="req-4" pending remarks="" onRemarksChange={onRemarksChange} />);
    fireEvent.change(await screen.findByLabelText('apReqApproverRemarks'), { target: { value: 'Mill has capacity' } });
    expect(onRemarksChange).toHaveBeenCalledWith('Mill has capacity');
    rerender(<FeedRequisitionApprovalDetail documentId="req-4" pending={false} remarks="" onRemarksChange={onRemarksChange} />);
    expect(screen.queryByLabelText('apReqApproverRemarks')).toBeNull();
  });

  it('says so when the lines cannot be read', async () => {
    get.mockRejectedValue({ message: 'Requisition not found.' });
    render(<FeedRequisitionApprovalDetail documentId="req-4" pending remarks="" onRemarksChange={jest.fn()} />);
    expect(await screen.findByText('apReqLinesUnavailable')).toBeTruthy();
  });
});
