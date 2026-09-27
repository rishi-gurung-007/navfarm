import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FeedRequisitionApprovalDetail } from '../src/components/console/approvals/feed-requisition-approval-detail';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const get = api.get as jest.Mock;
const view = {
  requisition_id: 'req-4', req_no: 'REQ-VIL100-2026-00004', remarks: 'Extra pigs arriving',
  lines: [{ line_id: 'L1', line_seq: 1, destination_code: 'VIL100/SILO-004', item_code: 'FEED-R1', item_name: 'Weaner Diet R1',
    recommended_qty_kg: '6000.0000', quantity: '9000.0000', proposed_delivery_date: '2099-10-01' }],
};

describe('FeedRequisitionApprovalDetail (D25)', () => {
  beforeEach(() => get.mockReset().mockResolvedValue({ data: view }));

  it('shows the lines, the farm\'s remarks and a link to the requisition', async () => {
    render(<FeedRequisitionApprovalDetail documentId="req-4" pending remarks="" onRemarksChange={jest.fn()} />);
    const table = await screen.findByRole('table', { name: 'apReqLinesLabel' });
    expect(get).toHaveBeenCalledWith('/feed-requisition/req-4');
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['VIL100/SILO-004', 'FEED-R1 — Weaner Diet R1', '6,000', '9,000', '01/10/99']);
    expect(screen.getByText('apReqFarmRemarks:{"remarks":"Extra pigs arriving"}')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'apReqOpen' }).getAttribute('href')).toBe('/inventory/requisitions?id=req-4');
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
