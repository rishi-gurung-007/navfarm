import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FarrowingReportPanel from '../src/components/console/reports/farrowing-report-panel';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({ getActiveCompanyId: () => 'co-1', getActiveFarmId: () => 'farm-1' }));
jest.mock('../src/hooks/useLanguage', () => {
  const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t }) };
});
jest.mock('../src/components/console/reports/farrowing-report-excel', () => ({ exportFarrowingExcel: jest.fn() }));

const get = api.get as jest.Mock;
const report = {
  farm: { farm_id: 'farm-1', farm_code: 'GRS', farm_name: 'Grasmere' },
  filters: { date_from: '2026-10-01', date_to: '2026-10-31', batch_no: null, batch_status: null, parity: null, sow_code: null },
  generated_at: '2026-11-02T10:00:00Z',
  rows: [],
};

beforeEach(() => {
  get.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/reports/farrowing/farms')) return { data: [{ farm_id: 'farm-1', farm_code: 'GRS', farm_name: 'Grasmere', company_id: 'co-1' }] };
    if (url.startsWith('/reports/farrowing/filters')) {
      return { data: { batches: [
        { batch_id: 'b-active', batch_no: 'BATCH-A', status: 'ACTIVE' },
        { batch_id: 'b-closed', batch_no: 'BATCH-C', status: 'CLOSED' },
      ], sows: [] } };
    }
    return { data: report };
  });
});

async function pick(label: string, option: string) {
  const trigger = await screen.findByRole('button', { name: label });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

async function setDates() {
  fireEvent.change(screen.getByLabelText(/rptDateFrom/), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText(/rptDateTo/), { target: { value: '2026-10-31' } });
}

const reportCalls = () => get.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/reports/farrowing?'));

// Rishi, 2 Nov: a Batch Type filter — All, Active or Closed.
describe('Farrowing Report — Batch Type', () => {
  it('sends no batch status for All, and ACTIVE or CLOSED when chosen', async () => {
    render(<FarrowingReportPanel />);
    await setDates();
    fireEvent.click(await screen.findByRole('button', { name: 'rptGenerate' }));
    await waitFor(() => expect(reportCalls()).toHaveLength(1));
    expect(reportCalls()[0]).not.toContain('batchStatus');
    await pick('rptBatchType', 'rptBatchTypeClosed');
    fireEvent.click(screen.getByRole('button', { name: 'rptRegenerate' }));
    await waitFor(() => expect(reportCalls()).toHaveLength(2));
    expect(reportCalls()[1]).toContain('batchStatus=CLOSED');
  });

  it('offers only batches of the chosen type, and clears a chosen batch of the other type', async () => {
    render(<FarrowingReportPanel />);
    await pick('rptBatch', 'BATCH-C');
    await pick('rptBatchType', 'rptBatchTypeActive');
    expect(screen.getByRole('button', { name: 'rptBatch' }).textContent).not.toContain('BATCH-C');
    fireEvent.click(screen.getByRole('button', { name: 'rptBatch' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['BATCH-A']));
    expect(screen.queryByRole('option', { name: 'BATCH-C' })).toBeNull();
  });
});

// Rishi, 2 Nov: Generate, then Generated while the filters match the report shown, then Regenerate once one changes.
describe('Farrowing Report — Generate button', () => {
  it('reads Generate, then Generated, then Regenerate after a filter changes, and Generated again after it reruns', async () => {
    render(<FarrowingReportPanel />);
    await setDates();
    fireEvent.click(await screen.findByRole('button', { name: 'rptGenerate' }));
    const generated = await screen.findByRole('button', { name: 'rptGenerated' });
    expect((generated as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/rptDateTo/), { target: { value: '2026-10-30' } });
    const regenerate = screen.getByRole('button', { name: 'rptRegenerate' });
    expect((regenerate as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(regenerate);
    expect(await screen.findByRole('button', { name: 'rptGenerated' })).toBeTruthy();
    // Putting the filter back to what the report shows needs no rerun.
    fireEvent.change(screen.getByLabelText(/rptDateTo/), { target: { value: '2026-10-31' } });
    expect(screen.getByRole('button', { name: 'rptRegenerate' })).toBeTruthy();
  });
});

// Rishi, 2 Nov: the prior year's batch number is not shown; its figures stay in the Prior YR columns.
describe('Farrowing Report — prior year batch', () => {
  it('shows the batch number without the matched prior-year batch', async () => {
    const metrics = {
      sows_served: 24, sows_farrowed: 0, farrowing_rate_pct: null, total_born_per_sow: null, born_alive_per_sow: null,
      born_dead: 0, mummified: 0, active_week_mortality: 0, pre_wean_mortality_pct: null, avg_weaning_weight_kg: null,
      litter_mass_total_kg: null, litter_mass_avg_kg: null, gilts_served: 0, second_parity_served: 0, sows_weaned: 0,
      wean_per_sow: null, gilt_body_loss_pct: null,
    };
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/reports/farrowing/farms')) return { data: [{ farm_id: 'farm-1', farm_code: 'GRS', farm_name: 'Grasmere', company_id: 'co-1' }] };
      if (url.startsWith('/reports/farrowing/filters')) return { data: { batches: [], sows: [] } };
      return { data: { ...report, rows: [{ batch_id: 'b1', batch_no: 'BATCH-000305', is_total: false, metrics, targets: {}, prior_year: metrics, prior_batch_no: 'BATCH-000078' }] } };
    });
    render(<FarrowingReportPanel />);
    await setDates();
    fireEvent.click(await screen.findByRole('button', { name: 'rptGenerate' }));
    const cell = await screen.findByText('BATCH-000305');
    expect(cell.textContent).toBe('BATCH-000305');
    expect(screen.queryByText(/BATCH-000078/)).toBeNull();
  });
});
