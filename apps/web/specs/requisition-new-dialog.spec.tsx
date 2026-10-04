import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RequisitionNewDialog } from '../src/components/console/inventory/requisition-new-dialog';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
// Every test here passes farmId explicitly, so the farm-select branch never
// renders; mocked only so useFeedFarm's own module-level fetch of
// /feed-forecast/farms (unconditional per the hooks rule) does not register
// on the shared api.get mock and upset the "no load before Feed is chosen"
// assertions below — the same pattern requisitions-panel.spec.tsx and
// feed-forecast-panel.spec.tsx use for the same hook.
let mockFarm: any;
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({ useFeedFarm: () => mockFarm }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockFarm = { farmId: null, setFarmId: jest.fn(), farms: [], loaded: true, failed: false, isFixed: false, fixedFarm: null };
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

describe('RequisitionNewDialog — every requisition type (spec §6a)', () => {
  it('offers Item, Fixed Asset and Service when asked; Item chooses Store or Purchase; FA and Service go straight to Purchase', () => {
    const onCommon = jest.fn();
    render(<RequisitionNewDialog open farmId="farm-vil" types={['FEED', 'ITEM', 'FA', 'SERVICE']} onClose={jest.fn()} onCreated={jest.fn()} onCommon={onCommon} />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeFa' }));
    expect(onCommon).toHaveBeenLastCalledWith({ docType: 'FA', purpose: 'PURCHASE' });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeService' }));
    expect(onCommon).toHaveBeenLastCalledWith({ docType: 'SERVICE', purpose: 'PURCHASE' });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeItem' }));
    expect(onCommon).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewItemStore' }));
    expect(onCommon).toHaveBeenLastCalledWith({ docType: 'ITEM', purpose: 'STORE' });
  });

  it('offers only Feed on the Feed Forecast tab (default types)', () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'rqNewPurposeItem' })).toBeNull();
  });

  // Fix round 1: a single-line fixture could not catch setLine(0, ...) being
  // hardcoded in place of setLine(i, ...) for the reason field specifically —
  // the same class of gap Task 9 was sent back to fix. Two lines, reason on
  // the second only, and the first line's body is checked to have NO
  // exception_reason key at all (not merely a falsy one).
  it('sends a line exception reason (Req. row 13), scoped to the line it was set on', async () => {
    render(<RequisitionNewDialog open farmId="farm-vil" onClose={jest.fn()} onCreated={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeFeed' }));
    await waitFor(() => expect((screen.getByLabelText('rqNewDestination:{"line":1}') as HTMLSelectElement).options.length).toBe(3));
    fireEvent.change(screen.getByLabelText('rqNewDestination:{"line":1}'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('rqNewItem:{"line":1}'), { target: { value: 'i1' } });
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":1}'), { target: { value: '3000' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":1}'), { target: { value: '2099-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewAddLine' }));
    fireEvent.change(screen.getByLabelText('rqNewDestination:{"line":2}'), { target: { value: 'st' } });
    fireEvent.change(screen.getByLabelText('rqNewItem:{"line":2}'), { target: { value: 'i1' } });
    fireEvent.change(screen.getByLabelText('rqNewKg:{"line":2}'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('rqNewDate:{"line":2}'), { target: { value: '2099-10-02' } });
    fireEvent.change(screen.getByLabelText('rqNewException:{"line":2}'), { target: { value: 'Vet instruction' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqNewCreate' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0]).not.toHaveProperty('exception_reason');
    expect(body.lines[1].exception_reason).toBe('Vet instruction');
  });
});

describe('RequisitionNewDialog — farm chosen on the header when the caller has none (Task 10 review, fix round 1)', () => {
  it('shows a farm select when farmId is absent, and the chosen farm — not undefined — drives the options fetch', async () => {
    mockFarm = {
      farmId: null,
      setFarmId: jest.fn((id: string | null) => { mockFarm = { ...mockFarm, farmId: id }; }),
      farms: [{ farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Triple C' }],
      loaded: true,
      failed: false,
      isFixed: false,
      fixedFarm: null,
    };
    const { rerender } = render(<RequisitionNewDialog open types={['FEED']} onClose={jest.fn()} onCreated={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'rqNewPurposeFeed' }));
    const select = screen.getByLabelText('rqFarm') as HTMLSelectElement;
    expect(select).toBeTruthy();
    // No farm chosen yet: effectiveFarmId is empty, so the options endpoint
    // must not be read with an undefined/empty farmId — the bug a select
    // that merely *renders* would not catch.
    expect(get).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: 'farm-vil' } });
    expect(mockFarm.setFarmId).toHaveBeenCalledWith('farm-vil');
    // setFarmId is a prop handed to the mocked hook, not component state, so
    // the dialog only sees the new farmId once it re-renders against the
    // hook's updated return value — exactly what a real selection does when
    // the shared hook's own state changes.
    rerender(<RequisitionNewDialog open types={['FEED']} onClose={jest.fn()} onCreated={jest.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition/options?farmId=farm-vil'));
  });
});
