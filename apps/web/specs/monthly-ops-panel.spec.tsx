import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
