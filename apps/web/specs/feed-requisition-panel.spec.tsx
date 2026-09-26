import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FeedRequisitionPanel, { needsRemarks } from '../src/components/console/inventory/feed-requisition-panel';
import { api } from '../src/services/api-client';
import { getStoredUser, getActiveFarmId } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock('../src/hooks/useAuth', () => ({ getStoredUser: jest.fn(), getActiveFarmId: jest.fn() }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

// The Worked Example drafted: R1 6,000 kg to SILO1, R2 9,000 kg (next diet, 3 days) to SILO2.
const view = {
  requisition_id: 'req-1', req_no: 'REQ-GRS-2026-00041', requisition_type: 'FEED_FORECAST', source: 'AUTO_FORECAST',
  purpose: 'INTERNAL_TRANSFER', supply_source: 'MILL', status: 'AUTO_DRAFT', priority: 'CRITICAL',
  production_date: '2099-09-27', submission_deadline: '2099-09-26', required_date: '2099-09-23', remarks: null,
  farm_code: 'GRS', farm_total_requested_kg: 15000, truck_target_kg: 30000, truck_trips: 1,
  lines: [
    { line_id: 'L1', line_seq: 1, destination_code: 'GRS/SILO-001', item_code: 'FEED-R1', item_name: 'Weaner Diet R1', feed_type: 'BULK',
      is_next_diet: false, days_before_diet_change: null, system_balance_kg: '1500.0000', daily_requirement_kg: '2000.0000', days_remaining: 0,
      unrounded_need_kg: '4500.0000', recommended_qty_kg: '6000.0000', quantity: '6000.0000', bag_count: null, proposed_delivery_date: '2099-09-23', needs_silo_changeover: false },
    { line_id: 'L2', line_seq: 2, destination_code: 'GRS/SILO-002', item_code: 'FEED-R2', item_name: 'Weaner Diet R2', feed_type: 'BULK',
      is_next_diet: true, days_before_diet_change: 3, system_balance_kg: '1000.0000', daily_requirement_kg: '2500.0000', days_remaining: null,
      unrounded_need_kg: '9000.0000', recommended_qty_kg: '9000.0000', quantity: '9000.0000', bag_count: null, proposed_delivery_date: '2099-09-26', needs_silo_changeover: false },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  (getStoredUser as jest.Mock).mockReturnValue({ userId: 'u1', userType: 'STANDARD_USER', farmId: 'farm-grs', farm: { location_code: 'GRS', location_name: 'Grasmere' } });
  (getActiveFarmId as jest.Mock).mockReturnValue(null);
  get.mockImplementation(async (url: string) => (url.startsWith('/feed-requisition/') ? { data: view } : { data: [] }));
  post.mockImplementation(async (url: string) => (url === '/feed-requisition/auto-draft' ? { data: { requisitionId: 'req-1', created: true, linesDrafted: 2, requisition: view } } : { data: view }));
});

describe('needsRemarks — checkpoint 18', () => {
  it('matches the API rule', () => {
    expect(needsRemarks(6000, 9000)).toBe(true);
    expect(needsRemarks(6000, 7200)).toBe(false);
    expect(needsRemarks(null, 50000)).toBe(false);
    expect(needsRemarks(0, 3000)).toBe(true);
  });
});

describe('FeedRequisitionPanel', () => {
  it('drafts from the forecast for the user\'s own farm and shows the §2 columns', async () => {
    render(<FeedRequisitionPanel />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition?farmId=farm-grs'));
    expect(screen.queryByLabelText('frqFarm')).toBeNull(); // STANDARD_USER: no farm choice (D13)

    fireEvent.click(screen.getByRole('button', { name: 'frqDraftFromForecast' }));
    await screen.findByText('REQ-GRS-2026-00041');
    expect(post).toHaveBeenCalledWith('/feed-requisition/auto-draft', { farmId: 'farm-grs' });
    for (const h of ['frqColLine', 'frqColDestination', 'frqColItem', 'frqColFeedType', 'frqColNextDiet', 'frqColDaysBeforeChange',
      'frqColSystemBalance', 'frqColDailyRequirement', 'frqColDaysRemaining', 'frqColUnroundedNeed', 'frqColRecommended',
      'frqColRequested', 'frqColBagCount', 'frqColDelivery']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeTruthy();
    }
    expect(screen.getByText('frqFarmTotal:{"total":"15,000","target":"30,000","trips":1}')).toBeTruthy();
  });

  it('asks for remarks when a requested quantity moves more than 20 % and blocks Approve until given', async () => {
    render(<FeedRequisitionPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'frqDraftFromForecast' }));
    await screen.findByText('REQ-GRS-2026-00041');

    fireEvent.change(screen.getByLabelText('frqRequestedFor:{"line":1}'), { target: { value: '9000' } });
    expect(screen.getByText('frqRemarksRequired')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'frqApprove' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('frqRemarks'), { target: { value: 'Extra pigs arriving' } });
    const approve = screen.getByRole('button', { name: 'frqApprove' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition/req-1/approve', {
      remarks: 'Extra pigs arriving', lines: [{ line_id: 'L1', quantity_kg: 9000 }],
    }));
  });
});
