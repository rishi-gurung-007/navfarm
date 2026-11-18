import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TripsScreen } from './trips-screen';

jest.mock('@/hooks/useLanguage', () => {
  const { translations } = jest.requireActual('@/utils/translations');
  const t = (key: string, vars?: Record<string, string>) =>
    String((translations.en as Record<string, string>)[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, n) => vars?.[n] ?? '');
  return { useLanguage: () => ({ t }) };
});
jest.mock('@/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('@/components/ui/toast', () => ({ showToast: { success: jest.fn(), error: jest.fn() } }));

const { api } = jest.requireMock('@/services/api-client') as { api: Record<'get' | 'post' | 'put', jest.Mock> };

const row = {
  trip_id: 'trip-1', trip_no: 'TRP-000001', status: 'PLANNED', route_id: 'r-1', vehicle_id: 'v-1', driver_id: 'd-1',
  planned_departure: '2026-11-13 06:00:00', estimated_arrival: '2026-11-13 09:00:00', estimated_cost: '1250.00', estimate_note: null,
};
const detail = { ...row, route_code: 'R-MILL-F1', vehicle_no: 'ABZ-4821', driver_name: 'Tafadzwa Moyo', lines: [], farm_shares: [] };

beforeEach(() => {
  jest.resetAllMocks();
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/logistics/trip/trip-1')) return Promise.resolve({ data: detail });
    if (path.startsWith('/logistics/trip')) return Promise.resolve({ data: [row], total: 1 });
    if (path.startsWith('/logistics/route')) return Promise.resolve({ data: [{ route_id: 'r-1', route_code: 'R-MILL-F1' }] });
    if (path.startsWith('/logistics/vehicle')) return Promise.resolve({ data: [{ vehicle_id: 'v-1', registration_no: 'ABZ-4821' }] });
    if (path.startsWith('/logistics/driver')) return Promise.resolve({ data: [{ driver_id: 'd-1', driver_name: 'Tafadzwa Moyo' }] });
    return Promise.resolve({ data: [] });
  });
});

describe('TripsScreen', () => {
  it('lists trips with their route, truck and driver by name', async () => {
    render(<TripsScreen />);
    expect(await screen.findByText('TRP-000001')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('R-MILL-F1')).toBeTruthy());
    expect(screen.getByText('ABZ-4821')).toBeTruthy();
    expect(screen.getByText('Tafadzwa Moyo')).toBeTruthy();
  });

  it('confirms a PLANNED trip, and asks for the HQ reference when the server refuses for it', async () => {
    api.post.mockRejectedValueOnce(new Error('A trip to Colcom needs the HQ approval reference before it is confirmed.'));
    render(<TripsScreen />);
    fireEvent.click(await screen.findByText('TRP-000001'));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('A trip to Colcom needs the HQ approval reference before it is confirmed.')).toBeTruthy());
    expect(api.post).toHaveBeenCalledWith('/logistics/trip/trip-1/move', { to: 'CONFIRMED' });
    const ref = screen.getByLabelText('HQ Approval Ref.');
    fireEvent.change(ref, { target: { value: 'HQ-77' } });
    api.post.mockResolvedValueOnce({ data: { ...detail, status: 'CONFIRMED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/logistics/trip/trip-1/move', { to: 'CONFIRMED', hq_approval_ref: 'HQ-77' }));
  });

  it('offers the HQ reference on any refused Confirm, whatever the server says', async () => {
    api.post.mockRejectedValueOnce(new Error('The trip cannot be confirmed yet.'));
    render(<TripsScreen />);
    fireEvent.click(await screen.findByText('TRP-000001'));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.getByText('The trip cannot be confirmed yet.')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('HQ Approval Ref.'), { target: { value: 'HQ-12' } });
    api.post.mockResolvedValueOnce({ data: { ...detail, status: 'CONFIRMED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/logistics/trip/trip-1/move', { to: 'CONFIRMED', hq_approval_ref: 'HQ-12' }));
  });
});
