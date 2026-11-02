import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MonthlyOpsPanel from '../src/components/console/reports/monthly-ops-panel';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({ getActiveCompanyId: () => 'co-1', getActiveFarmId: () => 'farm-1' }));
jest.mock('../src/hooks/useLanguage', () => {
  const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t }) };
});

const get = api.get as jest.Mock;

beforeEach(() => {
  get.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/reports/monthly-ops/farms')) {
      return { data: [
        { farm_id: 'farm-1', farm_code: 'GRS', farm_name: 'Grasmere', company_id: 'co-1' },
        { farm_id: 'farm-2', farm_code: 'KIN', farm_name: 'Kintyre', company_id: 'co-1' },
      ] };
    }
    if (url.startsWith('/reports/monthly-ops/years')) return { data: { years: ['2026-27', '2025-26'], current: '2026-27' } };
    return { data: { farm: { farm_id: 'farm-1', farm_code: 'GRS', farm_name: 'Grasmere' }, year: '2026-27', generated_at: '2026-11-02T10:00:00Z', rows: [] } };
  });
});

async function pick(label: string, option: string) {
  const trigger = await screen.findByRole('button', { name: label });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

// Rishi, 2 Nov: Generate, then Generated while Year and Farm match the report shown, then Regenerate once one changes.
describe('Monthly Ops — Generate button', () => {
  it('reads Generate, then Generated, then Regenerate after Year or Farm changes, and Generated after it reruns', async () => {
    render(<MonthlyOpsPanel />);
    const generate = await screen.findByRole('button', { name: 'rptGenerate' });
    await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(generate);
    const generated = await screen.findByRole('button', { name: 'rptGenerated' });
    expect((generated as HTMLButtonElement).disabled).toBe(true);

    await pick('mopYear', '2025-26');
    const regenerate = screen.getByRole('button', { name: 'rptRegenerate' });
    expect((regenerate as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(regenerate);
    expect(await screen.findByRole('button', { name: 'rptGenerated' })).toBeTruthy();
    expect(get).toHaveBeenLastCalledWith(expect.stringContaining('year=2025-26'));

    await pick('rptFarm', 'Kintyre');
    expect(screen.getByRole('button', { name: 'rptRegenerate' })).toBeTruthy();
  });
});

// Rishi, 2 Nov: Empty Days and Cull are two columns; Empty Days is the month's total, with the sows it covers beneath.
describe('Monthly Ops — Empty Days and Cull', () => {
  it('shows Empty Days and Cull as separate columns', async () => {
    const metrics = {
      empty_days: 212, empty_sows: 18, sows_culled: 3, total_born: 0, born_alive: 0, litters_farrowed: 0,
      sows_served_one_gestation_earlier: 0, services_farrowed: 0, farrowing_rate_pct: null, avg_wean_weight_kg: null,
      total_litter_mass_kg: null, litters_weaned: 0, cdm_kg: 0, kg_sold: 0, average_sows: null, kg_sold_per_sow_year: null,
      sows_due: 0, standovers: 0, standovers_pct: null, mortality_total: 0, mortality_by_category: [], sows_on_last_day: 0,
      parity_distribution: [],
    };
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/reports/monthly-ops/farms')) return { data: [{ farm_id: 'farm-1', farm_code: 'GRS', farm_name: 'Grasmere', company_id: 'co-1' }] };
      if (url.startsWith('/reports/monthly-ops/years')) return { data: { years: ['2026-27'], current: '2026-27' } };
      return { data: { farm: { farm_id: 'farm-1', farm_code: 'GRS', farm_name: 'Grasmere' }, year: '2026-27', generated_at: '2026-11-02T10:00:00Z',
        rows: [{ month: 'October', start_date: '2026-09-27', end_date: '2026-10-24', breed_id: 'b', breed_name: 'Z-Line-Sow', metrics }] } };
    });
    render(<MonthlyOpsPanel />);
    const generate = await screen.findByRole('button', { name: 'rptGenerate' });
    await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(generate);
    const table = await screen.findByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['mopEmptyDays', 'mopCull']));
    expect(headers).not.toContain('mopEmptyDaysCull');
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell').map((c) => c.textContent);
    const at = headers.indexOf('mopEmptyDays');
    expect(cells[at]).toBe('21218 sows');
    expect(cells[headers.indexOf('mopCull')]).toBe('3');
  });
});
