import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PiggeryGmDashboard from '../src/components/console/piggery/piggery-gm-dashboard';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({ getActiveCompanyId: () => 'co-1' }));
jest.mock('../src/hooks/useCompanyCurrency', () => ({ useCompanyCurrency: () => ({ currency: { iso_code: 'USD' }, ready: true }) }));
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
    farm_view: farmId ? {
      farm: farms.find((f) => f.farm_id === farmId),
      sows: 65,
      kg_sold_per_sow_year_ytd: 2950,
      breeding: [{ key: 'farrowing_rate_pct', label: 'Farrowing Rate', unit: '%', lower_is_better: false, target: 90, status: 'GREEN',
        values: { this_week: 100, avg_4w: 57.14, this_month: 57.14, prev_month: 100, three_month: 91.84 },
        trend: [100, 100, 100, 50, 0, 100] }],
      weaner_grower: [{ key: 'fce_grower', label: 'FCE Grower', unit: '', lower_is_better: true, target: 2.4, status: 'RED',
        values: { this_week: 3.65, avg_4w: 5.19, this_month: 5.19, prev_month: 2.15, three_month: 3.7 },
        trend: [4.2, null, null, 3.43, null, 3.65] }],
      alerts: [
        { metric: 'FCE Grower', unit: '', value: 3.65, target: 2.4, status: 'RED', above: true },
        { metric: 'Farrowing Rate', unit: '%', value: 100, target: 90, status: 'GREEN', above: true },
      ],
    } : null,
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
    expect(await screen.findByRole('region', { name: 'gmdBreedingMatrix' })).toBeTruthy();
    expect(get.mock.calls[0][0]).not.toContain('periodId');
    expect(screen.getByRole('button', { name: 'gmdPeriod' }).textContent).toContain('2026-10 (2026-27)');
    expect(screen.getByTestId('gmd-dates').textContent).toContain('27 Sept 2026');
  });

  it('shows each farm as a column of status dots, with value and target on hover, and the alerts', async () => {
    render(<PiggeryGmDashboard />);
    const table = await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['gmdMetric', 'GRASMERE', 'PORTA']);
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[1].querySelector('[data-status]')?.getAttribute('data-status')).toBe('RED');
    expect(cells[1].getAttribute('title')).toBe('GRASMERE — Farrowing Rate: 57.14% · gmdTarget 90%');
    expect(cells[2].getAttribute('title')).toContain('N/A');
    // Kg Meat Sold / Sow / Year closes the matrix, with no target.
    const kgRow = within(table).getAllByRole('row').at(-1)!;
    expect(kgRow.textContent).toContain('gmdKgSoldPerSowYear');
    expect(within(kgRow).getAllByRole('cell')[1].getAttribute('title')).toContain('2,900 kg · gmdNoTarget');
    const alerts = screen.getByRole('region', { name: 'gmdAlerts' });
    expect(alerts.textContent).toContain('Farrowing Rate gmdBelowTarget — GRASMERE');
  });

  it('lays out the phase 2 cards, matrix and charts with no data yet', async () => {
    render(<PiggeryGmDashboard />);
    await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    const kpis = screen.getByTestId('gmd-kpis');
    expect(within(kpis).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual([
      'gmdPigsToSlaughter', 'gmdAvgCdm', 'gmdCostOfSales', 'gmdGrossMargin', 'gmdOtherOverheads',
    ]);
    expect(within(kpis).getAllByText('gmdNoDataYet')).toHaveLength(5);
    const financial = screen.getByRole('region', { name: 'gmdFinancialMatrix' });
    expect(within(financial).getAllByRole('row')).toHaveLength(9);
    expect(financial.querySelectorAll('[data-status="NONE"]')).toHaveLength(16);
    expect(screen.getByRole('region', { name: 'gmdPigsToSlaughterProgress' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'gmdPbtProgress' })).toBeTruthy();
    expect(screen.getByTestId('gmd-kg-value').textContent).toBe('3,000');
  });

  it('reloads for a chosen farm and keeps every farm in the picker', async () => {
    render(<PiggeryGmDashboard />);
    await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    fireEvent.click(screen.getByRole('button', { name: 'rptFarm' }));
    fireEvent.click(await screen.findByRole('option', { name: 'PORTA' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.stringContaining('farmId=p')));
    expect(await screen.findByRole('heading', { name: 'PORTA' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'rptFarm' }));
    expect(await screen.findByRole('option', { name: 'GRASMERE' })).toBeTruthy();
  });
});

// Rishi, 2 Nov: with one farm chosen, the Farm view of the mockup.
describe('GM Dashboard — one farm', () => {
  async function chooseGrasmere() {
    render(<PiggeryGmDashboard />);
    await screen.findByRole('region', { name: 'gmdBreedingMatrix' });
    fireEvent.click(screen.getByRole('button', { name: 'rptFarm' }));
    fireEvent.click(await screen.findByRole('option', { name: 'GRASMERE' }));
    await screen.findByRole('heading', { name: 'GRASMERE' });
  }

  it('heads the page with the farm and its sows', async () => {
    await chooseGrasmere();
    expect(screen.getByText(/gmdSows/)).toBeTruthy();
  });

  it('shows This Week coloured by its status, the four averages and a six-week trend', async () => {
    await chooseGrasmere();
    const table = screen.getByRole('region', { name: 'gmdBreedingMatrix' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'gmdMetric', 'gmdThisWeek', 'gmdWeeklyAvg4w', 'gmdThisMonthAvg', 'gmdPrevMonthAvg', 'gmdThreeMonthAvg', 'gmdTrend',
    ]);
    const row = within(table).getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells.slice(0, 6).map((c) => c.textContent)).toEqual(['Farrowing Rate (%)', '100', '57.14', '57.14', '100', '91.84']);
    expect((cells[1] as HTMLElement).style.color).toBe('var(--success)');
    expect(within(table).getByTestId('trend').children).toHaveLength(6);
    expect(screen.getByRole('region', { name: 'gmdFinancialMatrix' }).textContent).toContain('Pigs to Slaughter');
  });

  it('shows Kg Meat Sold for the year to date and This Week\'s alerts, misses first and on-target after', async () => {
    await chooseGrasmere();
    expect(screen.getByRole('region', { name: 'gmdKgSoldPerSowYearYtd' })).toBeTruthy();
    expect(screen.getByTestId('gmd-kg-value').textContent).toBe('2,950');
    const items = within(screen.getByRole('region', { name: 'gmdAlerts' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('FCE Grower gmdAboveTarget (gmdThisWeek)');
    expect(items[1]).toContain('Farrowing Rate gmdOnTarget (gmdThisWeek)');
  });
});
