import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { DispatchBoard } from './dispatch-board';

jest.mock('@/hooks/useLanguage', () => {
  const { translations } = jest.requireActual('@/utils/translations');
  const t = (key: string, vars?: Record<string, string>) =>
    String((translations.en as Record<string, string>)[key] ?? key).replace(
      /\{\{(\w+)\}\}/g,
      (_m, n) => vars?.[n] ?? '',
    );
  return { useLanguage: () => ({ t }) };
});
jest.mock('@/services/api-client', () => ({ api: { get: jest.fn() } }));

const { api } = jest.requireMock('@/services/api-client') as {
  api: { get: jest.Mock };
};

const trip = (over: Record<string, unknown>) => ({
  trip_id: 'x',
  trip_no: 'TRP-000001',
  status: 'PLANNED',
  planned_departure: '2026-11-18 06:00:00',
  estimated_cost: '1250.00',
  vehicle_no: 'ABZ-4821',
  driver_name: 'Tafadzwa Moyo',
  route_code: 'R-MILL-F1',
  ...over,
});

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({
    data: {
      from: '2026-11-16',
      until: '2026-11-23',
      columns: {
        PLANNED: [trip({ trip_id: 'a' })],
        CONFIRMED: [],
        IN_TRANSIT: [
          trip({
            trip_id: 'b',
            trip_no: 'TRP-000002',
            status: 'IN_TRANSIT',
            vehicle_no: null,
          }),
        ],
        ARRIVED: [],
      },
      waiting: [
        {
          kind: 'STOCK_TRANSFER',
          id: 'to-1',
          document_no: 'TR-000105',
          posting_date: '2026-11-17',
          from_name: 'Mill',
          to_name: 'Grasmere',
        },
      ],
    },
  });
});

describe('DispatchBoard', () => {
  it('asks for the next 7 days and puts each trip in its status column', async () => {
    render(<DispatchBoard />);
    await screen.findByText('TRP-000001');
    expect(api.get).toHaveBeenCalledWith('/logistics/trip/dispatch?days=7');
    expect(
      within(screen.getByRole('region', { name: 'Planned' })).getByText(
        'TRP-000001',
      ),
    ).toBeTruthy();
    const transit = screen.getByRole('region', { name: 'In transit' });
    expect(within(transit).getByText('TRP-000002')).toBeTruthy();
    expect(transit.textContent).toContain('No vehicle');
    expect(
      within(screen.getByRole('region', { name: 'Confirmed' })).getByText(
        'No trips.',
      ),
    ).toBeTruthy();
  });

  it('lists the Transfer Orders still waiting for a trip, linking to each', async () => {
    render(<DispatchBoard />);
    const link = await screen.findByRole('link', { name: 'TR-000105' });
    expect(link.getAttribute('href')).toBe('/inventory/transfers?id=to-1');
    expect(
      screen.getByRole('region', { name: 'Transfer Orders waiting for a trip' })
        .textContent,
    ).toContain('Mill → Grasmere');
  });

  it('shows the server message when the board cannot load', async () => {
    api.get.mockReset().mockRejectedValue(new Error('Forbidden'));
    render(<DispatchBoard />);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('Forbidden'),
    );
  });
});
