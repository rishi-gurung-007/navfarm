import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PiggeryGmDashboard from '../src/components/console/piggery/piggery-gm-dashboard';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({ getActiveCompanyId: () => 'co-1' }));
jest.mock('../src/hooks/useLanguage', () => {
  const t = (key: string) => key;
  return { useLanguage: () => ({ t }) };
});

const get = api.get as jest.Mock;
const periods = [
  { period_id: 'p10', period_code: '2026-10', business_year: '2026-27', start_date: '2026-09-27', end_date: '2026-10-24' },
  { period_id: 'p11', period_code: '2026-11', business_year: '2026-27', start_date: '2026-10-25', end_date: '2026-11-21' },
];
const farms = [
  { farm_id: 'g', farm_code: 'MUL100', farm_name: 'GRASMERE' },
  { farm_id: 'p', farm_code: 'POR100', farm_name: 'PORTA' },
];
const response = (periodId: string, farmId?: string) => ({
  data: {
    period: { ...periods.find((p) => p.period_id === periodId)!, ytd_from: '2026-06-28', to: '2026-10-24' },
    periods,
    farms: farmId ? farms.filter((f) => f.farm_id === farmId) : farms,
    kg_sold_per_sow_year: { month: { g: 2900, p: 3100, all: 3000 }, ytd: { g: 2800, p: 3000, all: 2950 } },
    breeding: [{ key: 'farrowing_rate_pct', label: 'Farrowing Rate', unit: '%', lower_is_better: false, cells: {
      g: { value: 57.14, target: 90, status: 'RED' }, p: { value: null, target: 92, status: null } } }],
    weaner_grower: [{ key: 'gain_70_day', label: '70 Day Gain', unit: 'kg', lower_is_better: false, cells: {
      g: { value: 21.9, target: null, status: null }, p: { value: null, target: null, status: null } } }],
    alerts: [{ farm_id: 'g', farm_name: 'GRASMERE', metric: 'Farrowing Rate', unit: '%', value: 57.14, target: 90, status: 'RED' }],
  },
});

beforeEach(() => {
  get.mockReset().mockImplementation(async (url: string) => {
    const q = new URLSearchParams(url.split('?')[1]);
    return response(q.get('periodId') ?? 'p10', q.get('farmId') ?? undefined);
  });
});

// Rishi, 2 Nov: the GM Dashboard opens on the period holding today, from the Reporting Period master.
describe('GM Dashboard', () => {
  it('opens on the period the API chose and shows the month and YTD dates', async () => {
    render(<PiggeryGmDashboard />);
    expect(await screen.findByText(/gmdBreedingMatrix/)).toBeTruthy();
    expect(get.mock.calls[0][0]).not.toContain('periodId');
    expect(screen.getByRole('button', { name: 'gmdPeriod' }).textContent).toContain('2026-10 (2026-27)');
    expect(screen.getByTestId('gmd-dates').textContent).toContain('27 Sept 2026');
  });

  it('shows each farm as a column with value, status and target, and the alerts', async () => {
    render(<PiggeryGmDashboard />);
    const table = (await screen.findByText('gmdBreedingMatrix')).closest('section')!;
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['gmdMetric', 'GRASMERE', 'PORTA']);
    const row = within(table).getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells[1].textContent).toContain('57.14');
    expect(cells[1].querySelector('[data-status]')?.getAttribute('data-status')).toBe('RED');
    expect(cells[1].textContent).toContain('gmdTarget 90');
    expect(cells[2].textContent).toContain('N/A');
    const gain = within((screen.getByText('gmdWeanerGrowerMatrix').closest('section'))!).getAllByRole('row')[1];
    expect(gain.textContent).toContain('gmdNoTarget');
    const alerts = screen.getByRole('region', { name: 'gmdAlerts' });
    expect(alerts.textContent).toContain('GRASMERE');
    expect(alerts.textContent).toContain('Farrowing Rate');
  });

  it('reloads for a chosen farm and keeps every farm in the picker', async () => {
    render(<PiggeryGmDashboard />);
    await screen.findByText('gmdBreedingMatrix');
    fireEvent.click(screen.getByRole('button', { name: 'rptFarm' }));
    fireEvent.click(await screen.findByRole('option', { name: 'PORTA' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.stringContaining('farmId=p')));
    await waitFor(() => expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).not.toContain('GRASMERE'));
    expect(screen.getByText('3,100')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'rptFarm' }));
    expect(await screen.findByRole('option', { name: 'GRASMERE' })).toBeTruthy();
  });
});
