import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanTripPanel, TripFreeTextGate, resetTripSettingCache, tripRequiredToShip } from './plan-trip-panel';

// The screen's own English strings, so the assertions read what the user reads.
jest.mock('@/hooks/useLanguage', () => {
  const { translations } = jest.requireActual('@/utils/translations');
  const t = (key: string, vars?: Record<string, string>) =>
    String((translations.en as Record<string, string>)[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, n) => vars?.[n] ?? '');
  return { useLanguage: () => ({ t }) };
});
jest.mock('@/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('@/components/ui/toast', () => ({ showToast: { success: jest.fn(), error: jest.fn() } }));
// The shared picker is a popover; a native select stands in for it so the form can be filled.
jest.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: ({ ariaLabel, value, onChange, options, valueKey = 'value', labelKey = 'label', getLabel }: any) => (
    <select aria-label={ariaLabel} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="" />
      {options.map((o: any) => (
        <option key={o[valueKey]} value={o[valueKey]}>{getLabel ? getLabel(o) : o[labelKey]}</option>
      ))}
    </select>
  ),
}));

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

describe('PlanTripPanel — planning and cancelling', () => {
  const draftTo = { transfer_id: 'to-1', status: 'DRAFT', trip: null, to_warehouse_id: 'loc-dest' };
  const withDestination = (location: Record<string, string>) =>
    api.get.mockImplementation((path: string) => {
      if (path.startsWith('/logistics/route')) return Promise.resolve({ data: [{ route_id: 'r-1', route_code: 'R-MILL-F1' }] });
      if (path === '/location/loc-dest') return Promise.resolve({ data: location });
      if (path.startsWith('/logistics/trip/')) return Promise.resolve({ data: tripDetail });
      return Promise.resolve({ data: [] });
    });

  it('posts the plan with the TO, the route, the typed local departure and the truck type', async () => {
    withDestination({ location_id: 'loc-dest', location_type: 'STORE', location_name: 'Farm 1 Feed Store' });
    api.post.mockResolvedValue({ data: tripDetail });
    const onChanged = jest.fn();
    render(<PlanTripPanel transfer={draftTo} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plan Trip' }));
    await screen.findByRole('option', { name: 'R-MILL-F1' });
    fireEvent.change(screen.getByLabelText('Route'), { target: { value: 'r-1' } });
    fireEvent.change(screen.getByLabelText('Planned Departure'), { target: { value: '2026-11-13T06:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Plan' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/logistics/trip/plan', {
      transfer_ids: ['to-1'],
      planned_departure: '2026-11-13T06:30',
      route_id: 'r-1',
      vehicle_type: 'BAGGED_FEED',
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ trip_id: 'trip-1', trip_no: 'TRP-000001' })));
  });

  it('guesses Bulk Feed for a silo destination and Bagged Feed otherwise', async () => {
    withDestination({ location_id: 'loc-dest', location_type: 'SILO', location_name: 'Silo 3' });
    const silo = render(<PlanTripPanel transfer={draftTo} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plan Trip' }));
    await waitFor(() => expect((screen.getByLabelText('Truck Type') as HTMLSelectElement).value).toBe('BULK_FEED'));
    silo.unmount();

    // The store read is held until the test lets it land, so BAGGED_FEED is asserted only after the guess has run,
    // not on the default it starts from.
    let landStore: (value: unknown) => void = () => undefined;
    const storeRead = new Promise((resolve) => {
      landStore = resolve;
    });
    api.get.mockImplementation((path: string) => {
      if (path.startsWith('/logistics/route')) return Promise.resolve({ data: [{ route_id: 'r-1', route_code: 'R-MILL-F1' }] });
      if (path === '/location/loc-dest') return storeRead;
      return Promise.resolve({ data: [] });
    });
    render(<PlanTripPanel transfer={draftTo} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plan Trip' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/location/loc-dest'));
    await act(async () => {
      landStore({ data: { location_id: 'loc-dest', location_type: 'STORE', location_name: 'Farm 1 Feed Store' } });
      await storeRead;
    });
    await waitFor(() => expect((screen.getByLabelText('Truck Type') as HTMLSelectElement).value).toBe('BAGGED_FEED'));
  });

  it('sends no cancel while the reason is empty', async () => {
    render(<PlanTripPanel transfer={{ transfer_id: 'to-1', status: 'DRAFT', trip }} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Trip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the trip' }));
    expect(await screen.findByText('Give a reason to cancel the trip.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the trip' }));
    expect(api.post).not.toHaveBeenCalled();

    api.post.mockResolvedValue({ data: { ...tripDetail, status: 'CANCELLED' } });
    fireEvent.change(screen.getByLabelText('Reason for cancelling'), { target: { value: 'Mill breakdown' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the trip' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/logistics/trip/trip-1/cancel', { reason: 'Mill breakdown' }));
  });
});

describe('tripRequiredToShip', () => {
  it('answers false to every caller sharing a read that fails, and reads again afterwards', async () => {
    let fail: (err: Error) => void = () => undefined;
    api.get.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const first = tripRequiredToShip('co-2');
    const second = tripRequiredToShip('co-2');
    expect(api.get).toHaveBeenCalledTimes(1);
    fail(new Error('Network down'));
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    api.get.mockResolvedValueOnce({ data: [{ company_id: 'co-2', trip_required_to_ship: true }] });
    await expect(tripRequiredToShip('co-2')).resolves.toBe(true);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failed read: the next read asks again', async () => {
    api.get.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(tripRequiredToShip('co-1')).resolves.toBe(false);
    api.get.mockResolvedValueOnce({ data: [{ company_id: 'co-1', trip_required_to_ship: true }] });
    await expect(tripRequiredToShip('co-1')).resolves.toBe(true);
    expect(api.get).toHaveBeenCalledTimes(2);
    // A successful read is kept.
    await expect(tripRequiredToShip('co-1')).resolves.toBe(true);
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
