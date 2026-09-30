import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RequisitionNewDialog } from '../src/components/console/inventory/requisition-new-dialog';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  // F3: one feed-scoped read, not the two Master Data ones.
  get.mockImplementation(async (_url: string) => ({
    data: {
      farmId: 'farm-vil',
      companyId: 'co-1',
      destinations: [
        { location_id: 's1', location_code: 'VIL100/SILO-001', location_type: 'SILO' },
        { location_id: 'st', location_code: 'VIL100/STORE-001', location_type: 'STORE' },
      ],
      items: [{ item_id: 'i1', item_code: 'FEED-R1', item_name: 'Weaner Diet R1' }],
    },
  }));
  post.mockResolvedValue({ data: { requisition_id: 'req-9', req_no: 'REQ-VIL100-2026-00009', lines: [] } });
});

describe('RequisitionNewDialog (D26)', () => {
  it('offers only the farm\'s silos and store, and creates the requisition', async () => {
    const onCreated = jest.fn();
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={onCreated} />);
    expect(screen.getByText('rqNew')).toBeTruthy();
    expect(screen.getByText('rqNewPurposePrompt')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'rqNewPurposeFeed' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'rqNewCancel' })).toBeNull();
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeFeed' }));
    expect(screen.getByText('rqNewTitle')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'rqNewCancel' })).toBeNull();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition/options?farmId=farm-vil'));
    // The Master Data routes are not reachable for a farm login, and answer
    // with templates in the tenant-wide workspace (F3, review I3).
    expect(get.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/location') || u.startsWith('/item'))).toEqual([]);
    const dest = await screen.findByLabelText('rqNewDestination:{"line":1}') as HTMLSelectElement;
    await waitFor(() => expect(dest.options.length).toBe(3));
    expect([...dest.options].map((o) => o.textContent)).toEqual(['rqNewChoose', 'VIL100/SILO-001', 'VIL100/STORE-001']);
    fireEvent.change(dest, { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('rqNewItem:{"line":1}'), { target: { value: 'i1' } });
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: '2099-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewCreate' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition', {
      farmId: 'farm-vil', lines: [{ destination_location_id: 's1', item_id: 'i1', quantity_kg: 3000, proposed_delivery_date: '2099-10-01' }],
    }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ requisition_id: 'req-9' }));
  });

  it('keeps Create off until every line is complete, and shows the API refusal', async () => {
    post.mockRejectedValue({ message: 'Destination VIL100/SILO-001 has the same feed item on two lines.' });
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeFeed' }));
    const create = await screen.findByRole('button', { name: 'rqNewCreate' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await waitFor(() => expect((screen.getByLabelText('rqNewDestination:{"line":1}') as HTMLSelectElement).options.length).toBe(3));
    fireEvent.change(screen.getByLabelText('rqNewDestination:{"line":1}'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('rqNewItem:{"line":1}'), { target: { value: 'i1' } });
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: '2099-10-01' } });
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    expect(await screen.findByText('Destination VIL100/SILO-001 has the same feed item on two lines.')).toBeTruthy();
  });
});
