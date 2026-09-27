import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import RequisitionsPanel, { needsRemarks } from '../src/components/console/inventory/requisitions-panel';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
let mockFarm: any;
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({ useFeedFarm: () => mockFarm }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

const listRow = {
  requisition_id: 'req-1', req_no: 'REQ-VIL100-2026-00004', requisition_type: 'FEED_FORECAST', status: 'AUTO_DRAFT', priority: 'CRITICAL',
  required_date: '2099-09-23', submission_deadline: '2099-09-26', line_count: 2, requested_kg: '15000.0000', approval_request_id: null,
};
const view = {
  requisition_id: 'req-1', req_no: 'REQ-VIL100-2026-00004', requisition_type: 'FEED_FORECAST', source: 'AUTO_FORECAST',
  purpose: 'INTERNAL_TRANSFER', supply_source: 'MILL', status: 'AUTO_DRAFT', priority: 'CRITICAL', approval_request_id: null,
  production_date: '2099-09-27', submission_deadline: '2099-09-26', remarks: null, truck_target_kg: 30000,
  lines: [
    { line_id: 'L1', line_seq: 1, destination_code: 'VIL100/SILO-001', item_code: 'FEED-R1', item_name: 'Weaner Diet R1', feed_type: 'BULK',
      is_next_diet: false, days_before_diet_change: null, system_balance_kg: '1500.0000', daily_requirement_kg: '2000.0000', days_remaining: 0,
      unrounded_need_kg: '4500.0000', recommended_qty_kg: '6000.0000', quantity: '6000.0000', bag_count: null, proposed_delivery_date: '2099-09-23', needs_silo_changeover: false },
    { line_id: 'L2', line_seq: 2, destination_code: 'VIL100/SILO-002', item_code: 'FEED-R2', item_name: 'Weaner Diet R2', feed_type: 'BULK',
      is_next_diet: true, days_before_diet_change: 3, system_balance_kg: '1000.0000', daily_requirement_kg: '2500.0000', days_remaining: null,
      unrounded_need_kg: '9000.0000', recommended_qty_kg: '9000.0000', quantity: '9000.0000', bag_count: null, proposed_delivery_date: '2099-09-26', needs_silo_changeover: false },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/inventory/requisitions');
  mockFarm = { farmId: 'farm-vil', setFarmId: jest.fn(), farms: [{ farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co', companyName: 'T' }], loaded: true, failed: false, isFixed: false, fixedFarm: null };
  get.mockImplementation(async (url: string) => (url.startsWith('/feed-requisition/') ? { data: view } : { data: [listRow] }));
  post.mockImplementation(async (url: string) =>
    url === '/feed-requisition/auto-draft' ? { data: { requisitionId: 'req-1', requisition: view } } : { data: { ...view, status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' } });
  put.mockResolvedValue({ data: view });
});

describe('needsRemarks — checkpoint 18', () => {
  it('matches the API rule', () => {
    expect(needsRemarks(6000, 9000)).toBe(true);
    expect(needsRemarks(6000, 7200)).toBe(false);
    expect(needsRemarks(null, 50000)).toBe(false);
  });
});

describe('RequisitionsPanel (D26)', () => {
  it("lists the farm's requisitions with labels, not codes, and DD/MM/YY dates (A8, A9)", async () => {
    render(<RequisitionsPanel />);
    const table = await screen.findByRole('table', { name: 'rqListLabel' });
    expect(get).toHaveBeenCalledWith('/feed-requisition?farmId=farm-vil');
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['REQ-VIL100-2026-00004', 'reqTypeForecast', 'reqStatusAutoDraft', 'prioCritical', '23/09/99', '26/09/99', '2', '15,000']);
    expect(screen.queryByText('FEED_FORECAST')).toBeNull();
    expect(screen.getByLabelText('rqType')).toBeTruthy();
  });

  it('filters by status through the API', async () => {
    render(<RequisitionsPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('rqShow'), { target: { value: 'PENDING_APPROVAL' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition?farmId=farm-vil&status=PENDING_APPROVAL'));
  });

  it('drafts from the forecast and opens it with Save and Submit for approval, and no approve or reject (D25)', async () => {
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    expect(post).toHaveBeenCalledWith('/feed-requisition/auto-draft', { farmId: 'farm-vil' });
    expect(screen.getByRole('button', { name: 'rqSubmit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve|reject/i })).toBeNull();
    const lines = screen.getByRole('table', { name: 'rqLinesLabel' });
    expect(within(lines).getAllByRole('columnheader')).toHaveLength(14);
    expect(within(lines).getAllByText('reqFeedBulk')).toHaveLength(2);
  });

  it('asks for remarks when a quantity moves more than 20 %, and submits with them', async () => {
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    fireEvent.change(screen.getByLabelText('rqRequestedFor:{"line":1}'), { target: { value: '9000' } });
    expect(screen.getByText('rqRemarksRequired')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'rqSubmit' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('rqRemarks'), { target: { value: 'Extra pigs arriving' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqSubmit' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition/req-1/submit', { remarks: 'Extra pigs arriving', lines: [{ line_id: 'L1', quantity_kg: 9000 }] }));
    expect(await screen.findByText('rqSubmitted')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'rqOpenApproval' }).getAttribute('href')).toBe('/approvals/pending?request=ar-1');
    expect(screen.queryByRole('button', { name: 'rqSubmit' })).toBeNull();
  });

  it('saves an edited delivery date', async () => {
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    fireEvent.change(screen.getByLabelText('rqDeliveryFor:{"line":1}'), { target: { value: '2099-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqSave' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-requisition/req-1', { remarks: '', lines: [{ line_id: 'L1', proposed_delivery_date: '2099-09-30' }] }));
  });

  it('opens the requisition named in the address (the Approvals inbox links here)', async () => {
    window.history.replaceState(null, '', '/inventory/requisitions?id=req-1');
    render(<RequisitionsPanel />);
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    expect(get).toHaveBeenCalledWith('/feed-requisition/req-1');
  });
});
