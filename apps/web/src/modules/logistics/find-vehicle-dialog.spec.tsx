import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FindVehicleDialog } from './find-vehicle-dialog';

jest.mock('@/hooks/useLanguage', () => {
  const { translations } = jest.requireActual('@/utils/translations');
  const t = (key: string, vars?: Record<string, string>) =>
    String((translations.en as Record<string, string>)[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, n) => vars?.[n] ?? '');
  return { useLanguage: () => ({ t }) };
});
jest.mock('@/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('@/components/ui/toast', () => ({ showToast: { success: jest.fn(), error: jest.fn() } }));

const { api } = jest.requireMock('@/services/api-client') as { api: Record<'get' | 'post' | 'put', jest.Mock> };

const options = {
  eligible: [{ vehicle_id: 'v-1', registration_no: 'ABZ-4821', vehicle_type: 'BULK_FEED', capacity_kg: '20000' }],
  excluded: [
    { vehicle: { vehicle_id: 'v-2', registration_no: 'XYZ-1000', vehicle_type: 'BULK_FEED' }, reasons: ['Insurance expired on 2026-10-01.'] },
    { vehicle: { vehicle_id: 'v-3', registration_no: 'LMN-2222', vehicle_type: 'LIVESTOCK' }, reasons: ['Wrong vehicle type.', 'Busy on TRP-000004.'] },
  ],
  drivers: {
    eligible: [{ driver_id: 'd-1', driver_name: 'Tafadzwa Moyo' }],
    excluded: [{ driver: { driver_id: 'd-2', driver_name: 'Peter Banda' }, reasons: ['Licence expired on 2026-09-30.'] }],
  },
};

beforeEach(() => {
  jest.resetAllMocks();
  api.get.mockResolvedValue({ data: options });
});

describe('FindVehicleDialog', () => {
  it('lists the excluded trucks and drivers with their reasons', async () => {
    render(<FindVehicleDialog open tripId="trip-1" tripNo="TRP-000001" onClose={jest.fn()} onAssigned={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('ABZ-4821')).toBeTruthy());
    expect(api.get).toHaveBeenCalledWith('/logistics/trip/trip-1/find-vehicle');
    expect(screen.getByText('XYZ-1000')).toBeTruthy();
    expect(screen.getByText('Insurance expired on 2026-10-01.')).toBeTruthy();
    expect(screen.getByText('LMN-2222')).toBeTruthy();
    expect(screen.getByText('Wrong vehicle type.')).toBeTruthy();
    expect(screen.getByText('Busy on TRP-000004.')).toBeTruthy();
    expect(screen.getByText('Peter Banda')).toBeTruthy();
    expect(screen.getByText('Licence expired on 2026-09-30.')).toBeTruthy();
    // An excluded truck cannot be picked.
    expect(screen.queryByRole('radio', { name: /XYZ-1000/ })).toBeNull();
  });

  it('assigns the picked truck and driver and closes', async () => {
    const onAssigned = jest.fn();
    const onClose = jest.fn();
    const assigned = { trip_id: 'trip-1', trip_no: 'TRP-000001', status: 'PLANNED', vehicle_no: 'ABZ-4821', driver_name: 'Tafadzwa Moyo' };
    api.put.mockResolvedValue({ data: assigned });
    render(<FindVehicleDialog open tripId="trip-1" tripNo="TRP-000001" onClose={onClose} onAssigned={onAssigned} />);
    fireEvent.click(await screen.findByRole('radio', { name: /ABZ-4821/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Tafadzwa Moyo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(onAssigned).toHaveBeenCalledWith(assigned));
    expect(api.put).toHaveBeenCalledWith('/logistics/trip/trip-1/assign', { vehicle_id: 'v-1', driver_id: 'd-1' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the server refusal (capacity BLOCK) and stays open', async () => {
    const onAssigned = jest.fn();
    const onClose = jest.fn();
    api.put.mockRejectedValue(new Error('ABZ-4821: Load is 112.0 % of the truck capacity, over the limit.'));
    render(<FindVehicleDialog open tripId="trip-1" tripNo="TRP-000001" onClose={onClose} onAssigned={onAssigned} />);
    fireEvent.click(await screen.findByRole('radio', { name: /ABZ-4821/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Tafadzwa Moyo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(screen.getByText('ABZ-4821: Load is 112.0 % of the truck capacity, over the limit.')).toBeTruthy());
    expect(onAssigned).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Assign' })).toBeTruthy();
  });
});
