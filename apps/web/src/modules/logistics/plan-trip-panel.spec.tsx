import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { PlanTripPanel, TripFreeTextGate, resetTripSettingCache } from './plan-trip-panel';

// The screen's own English strings, so the assertions read what the user reads.
jest.mock('@/hooks/useLanguage', () => {
  const { translations } = jest.requireActual('@/utils/translations');
  const t = (key: string, vars?: Record<string, string>) =>
    String((translations.en as Record<string, string>)[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, n) => vars?.[n] ?? '');
  return { useLanguage: () => ({ t }) };
});
jest.mock('@/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));

const { api } = jest.requireMock('@/services/api-client') as { api: Record<'get' | 'post' | 'put', jest.Mock> };

const trip = {
  trip_id: 'trip-1', trip_no: 'TRP-000001', status: 'PLANNED', vehicle_no: 'ABZ-4821', driver_name: 'Tafadzwa Moyo',
  estimated_arrival: '2026-11-13T14:30:00',
};
const tripDetail = { ...trip, capacity_pct: '87.50', estimated_cost: '1250.00', estimate_note: null, route_code: 'R-MILL-F1' };

beforeEach(() => {
  jest.resetAllMocks();
  resetTripSettingCache();
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/logistics/trip/')) return Promise.resolve({ data: tripDetail });
    if (path.startsWith('/logistics/setting')) return Promise.resolve({ data: [{ trip_required_to_ship: false }] });
    return Promise.resolve({ data: [] });
  });
});

describe('PlanTripPanel', () => {
  it('shows "No trip planned" and a Plan Trip button for a DRAFT TO without a trip', () => {
    render(<PlanTripPanel transfer={{ transfer_id: 'to-1', status: 'DRAFT', trip: null }} onChanged={jest.fn()} />);
    expect(screen.getByText('No trip planned')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plan Trip' })).toBeTruthy();
  });

  it('offers no Plan Trip on a TO that is no longer DRAFT', () => {
    render(<PlanTripPanel transfer={{ transfer_id: 'to-1', status: 'IN_TRANSIT', trip: null }} onChanged={jest.fn()} />);
    expect(screen.getByText('No trip planned')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Plan Trip' })).toBeNull();
  });

  it('shows the trip with its truck, driver, estimate and capacity, with Find Vehicle and Cancel on a DRAFT TO', async () => {
    render(<PlanTripPanel transfer={{ transfer_id: 'to-1', status: 'DRAFT', trip }} onChanged={jest.fn()} />);
    expect(screen.getByText('TRP-000001')).toBeTruthy();
    expect(screen.getByText('ABZ-4821')).toBeTruthy();
    expect(screen.getByText('Tafadzwa Moyo')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('87.50 %')).toBeTruthy());
    expect(screen.getByText(/1,250\.00/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Find Vehicle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel Trip' })).toBeTruthy();
  });

  it('renders the trip read-only for a TO that is not DRAFT', async () => {
    render(<PlanTripPanel transfer={{ transfer_id: 'to-1', status: 'IN_TRANSIT', trip: { ...trip, status: 'IN_TRANSIT' } }} onChanged={jest.fn()} />);
    expect(screen.getByText('TRP-000001')).toBeTruthy();
    expect(screen.getByText('ABZ-4821')).toBeTruthy();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/logistics/trip/trip-1'));
    expect(screen.queryByRole('button', { name: 'Plan Trip' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Find Vehicle' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel Trip' })).toBeNull();
  });
});

describe('TripFreeTextGate', () => {
  const fields = <input aria-label="Vehicle / Truck Plate #" />;

  it('keeps the free-text fields editable with no trip and the setting off', async () => {
    render(<TripFreeTextGate transfer={{ transfer_id: 'to-1', status: 'DRAFT', trip: null }}>{fields}</TripFreeTextGate>);
    const input = screen.getByLabelText('Vehicle / Truck Plate #') as HTMLInputElement;
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(input.closest('fieldset')?.disabled).toBe(false);
  });

  it('shows the free-text fields read-only when a trip is attached', () => {
    render(<TripFreeTextGate transfer={{ transfer_id: 'to-1', status: 'DRAFT', trip }}>{fields}</TripFreeTextGate>);
    const input = screen.getByLabelText('Vehicle / Truck Plate #') as HTMLInputElement;
    expect(input.closest('fieldset')?.disabled).toBe(true);
  });

  it('hides the free-text fields when shipping needs a trip and there is none', async () => {
    api.get.mockImplementation((path: string) =>
      Promise.resolve({ data: path.startsWith('/logistics/setting') ? [{ trip_required_to_ship: 1 }] : [] }));
    render(<TripFreeTextGate transfer={{ transfer_id: 'to-1', status: 'DRAFT', trip: null }}>{fields}</TripFreeTextGate>);
    await waitFor(() => expect(screen.queryByLabelText('Vehicle / Truck Plate #')).toBeNull());
  });
});
