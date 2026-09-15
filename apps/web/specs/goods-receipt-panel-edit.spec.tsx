import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import GoodsReceiptPanel from '../src/components/console/inventory/goods-receipt-panel';
import { api } from '../src/services/api-client';

/**
 * Item 2 (web half): a DRAFT goods receipt row had no way back into the form —
 * only View, which never offered PUT. Before this fix there was no Edit
 * action at all, so these tests fail against the old panel: no "Edit" button
 * is rendered for a DRAFT row, and there is nothing that calls
 * PUT /goods-receipt/:id. A POSTED row must keep Edit absent — posted
 * documents are corrected with offsetting documents, not edits.
 */
jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({ getActiveCompanyId: () => 'company-id' }));
jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock('../src/components/ui/dialog', () => ({
  Dialog: ({ open, title, children, footer }: { open: boolean; title: string; children: React.ReactNode; footer?: React.ReactNode }) =>
    open ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
}));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

const draftRow = { receipt_id: 'gr-1', receipt_no: 'GR-000001', posting_date: '2026-09-01', warehouse_id: 'wh-1', status: 'DRAFT' };
const postedRow = { receipt_id: 'gr-2', receipt_no: 'GR-000002', posting_date: '2026-09-02', warehouse_id: 'wh-1', status: 'POSTED' };
const fullDraft = {
  ...draftRow,
  supplier_id: '', external_reference_no: 'DC-1', remarks: 'note',
  lines: [{ line_id: 'l1', item_id: 'item-1', quantity: '10', uom: 'KG', rate: '5', lot_no: 'lot-1' }],
};

describe('GoodsReceiptPanel — Edit a DRAFT receipt', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    get.mockImplementation(async (path: string) => {
      if (path.startsWith('/goods-receipt?')) return { data: [draftRow, postedRow] };
      if (path === '/goods-receipt/gr-1') return { data: fullDraft };
      if (path.startsWith('/warehouse')) return { data: [{ warehouse_id: 'wh-1', warehouse_code: 'WH1', warehouse_name: 'Main Store' }] };
      if (path.startsWith('/supplier')) return { data: [] };
      if (path.startsWith('/item')) return { data: [{ item_id: 'item-1', item_code: 'ITM-1', item_name: 'Feed' }] };
      if (path.startsWith('/uom')) return { data: [{ uom_code: 'KG' }] };
      return { data: [] };
    });
  });

  it('offers Edit on a DRAFT row and not on a POSTED row', async () => {
    render(<GoodsReceiptPanel />);
    await screen.findByText('GR-000001');
    const draftCells = screen.getByText('GR-000001').closest('tr')!;
    const postedCells = screen.getByText('GR-000002').closest('tr')!;
    expect(within(draftCells).getByTitle('grpEdit')).toBeTruthy();
    expect(within(postedCells).queryByTitle('grpEdit')).toBeNull();
  });

  it('prefills the form from the draft and saves via PUT /goods-receipt/:id', async () => {
    put.mockResolvedValue({ data: { ...fullDraft, status: 'DRAFT' } });
    render(<GoodsReceiptPanel />);
    await screen.findByText('GR-000001');

    fireEvent.click(within(screen.getByText('GR-000001').closest('tr')!).getByTitle('grpEdit'));

    const dialog = await screen.findByRole('dialog', { name: 'grpEditGoodsReceiptTitle' });
    await within(dialog).findByDisplayValue('DC-1');
    expect((within(dialog).getByDisplayValue('note') as HTMLTextAreaElement).value).toBe('note');

    fireEvent.click(within(dialog).getByRole('button', { name: 'grpSaveChanges' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('/goods-receipt/gr-1', expect.objectContaining({
      warehouse_id: 'wh-1',
      external_reference_no: 'DC-1',
      lines: [expect.objectContaining({ item_id: 'item-1', quantity: 10, uom: 'KG' })],
    }));
    expect(post).not.toHaveBeenCalled();
  });

  // C1: UpdateGoodsReceiptDto has no company_id property, and the global
  // ValidationPipe runs with forbidNonWhitelisted — an extra key is a 400,
  // not a silently dropped one. `objectContaining` above cannot see an
  // extra key, so it kept passing while the panel sent one; this asserts
  // the property set directly and fails against the unfixed panel, which
  // hard-codes `company_id: companyId` onto the PUT payload.
  it('never sends company_id on the PUT payload (UpdateGoodsReceiptDto forbids it)', async () => {
    put.mockResolvedValue({ data: { ...fullDraft, status: 'DRAFT' } });
    render(<GoodsReceiptPanel />);
    await screen.findByText('GR-000001');

    fireEvent.click(within(screen.getByText('GR-000001').closest('tr')!).getByTitle('grpEdit'));
    const dialog = await screen.findByRole('dialog', { name: 'grpEditGoodsReceiptTitle' });
    await within(dialog).findByDisplayValue('DC-1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'grpSaveChanges' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const sentPayload = put.mock.calls[0][1];
    expect(Object.keys(sentPayload)).not.toContain('company_id');
  });
});
