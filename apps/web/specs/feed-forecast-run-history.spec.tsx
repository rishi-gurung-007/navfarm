import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../src/services/api-client';
import { FeedForecastRunHistory } from '../src/components/console/inventory/feed-forecast-run-history';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), delete: jest.fn() } }));
jest.mock('../src/components/ui/toast', () => ({ showToast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../src/components/console/inventory/feed-forecast-grid', () => ({
  FeedForecastGrid: ({ rows }: { rows: unknown[] }) => <div data-testid="run-grid">{rows.length} rows</div>,
}));
jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string, vars?: unknown) => vars ? `${key}:${JSON.stringify(vars)}` : key }) }));

describe('FeedForecastRunHistory', () => {
  beforeEach(() => { (api.get as jest.Mock).mockReset(); (api.delete as jest.Mock).mockReset(); });

  it('loads only the selected farm and renders immutable versions newest first', async () => {
    (api.get as jest.Mock).mockResolvedValue({ success: true, data: [
      { run_id: 'run-2', run_code: 'FFR-farm-1-000002', version: 2, planning_date: '2026-10-01', view: 'CUSTOM', from_date: '2026-10-01', to_date: '2026-10-07', period_id: null, source_cutoff_at: '2026-10-01 08:59:30', created_at: '2026-10-01 09:00:00', created_by: 'user-2', created_by_name: 'Asha Rai', config_snapshot: { version: 'sha256:config-2' }, source_snapshot: { values: { engineInput: { stockDate: '2026-10-01' } } } },
      { run_id: 'run-1', run_code: 'FFR-farm-1-000001', version: 1, view: 'CUSTOM', from_date: '2026-09-24', to_date: '2026-09-30', created_at: '2026-09-24 09:00:00' },
    ] });

    render(<FeedForecastRunHistory farmId="farm-1" reloadToken={0} />);

    expect(await screen.findByText('FFR-farm-1-000002')).toBeTruthy();
    expect(screen.getByText('FFR-farm-1-000001')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/feed-forecast/runs?farmId=farm-1');
    expect(screen.getByText('ffRunAsOf:{"date":"01/10/26","time":"09:00:00"}')).toBeTruthy();
    expect(screen.getByText('ffRunPostingCutoff:{"date":"01/10/26","time":"08:59:30"}')).toBeTruthy();
    expect(screen.getByText('ffRunSelectedFilters:{"view":"ffViewCustom","planning":"01/10/26","from":"01/10/26","to":"07/10/26"}')).toBeTruthy();
    expect(screen.getByText('ffRunConfigVersion:{"version":"sha256:config-2"}')).toBeTruthy();
    expect(screen.getByText('ffRunAuthor:{"author":"Asha Rai"}')).toBeTruthy();
    expect(screen.queryByText(/user-2/)).toBeNull();
    expect(screen.getByText('ffRunHistoryRow:{"version":2,"view":"ffViewCustom","from":"01/10/26","to":"07/10/26"}')).toBeTruthy();
    expect(screen.queryByText(/"view":"CUSTOM"/)).toBeNull();
  });

  it('falls back to Unknown user when the author name is missing, never the raw id', async () => {
    (api.get as jest.Mock).mockResolvedValue({ success: true, data: [
      { run_id: 'run-3', run_code: 'FFR-farm-1-000003', version: 3, view: 'CUSTOM', from_date: '2026-10-01', to_date: '2026-10-07', created_by: 'user-raw-id', created_by_name: null },
    ] });
    render(<FeedForecastRunHistory farmId="farm-1" reloadToken={0} />);
    expect(await screen.findByText('ffRunAuthor:{"author":"ffUnknownUser"}')).toBeTruthy();
    expect(screen.queryByText(/user-raw-id/)).toBeNull();
  });

  it('hides the previous farm immediately and shows loading until the new farm resolves', async () => {
    let resolveFarmTwo!: (value: unknown) => void;
    (api.get as jest.Mock)
      .mockResolvedValueOnce({ success: true, data: [
        { run_id: 'run-old', run_code: 'FFR-farm-1-000003', version: 3, view: 'CUSTOM', from_date: '2026-10-01', to_date: '2026-10-07' },
      ] })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFarmTwo = resolve; }));
    const { rerender } = render(<FeedForecastRunHistory farmId="farm-1" reloadToken={0} />);
    expect(await screen.findByText('FFR-farm-1-000003')).toBeTruthy();

    rerender(<FeedForecastRunHistory farmId="farm-2" reloadToken={0} />);

    expect(screen.queryByText('FFR-farm-1-000003')).toBeNull();
    expect(screen.getByText('ffLoadingRunHistory')).toBeTruthy();

    await act(async () => resolveFarmTwo({ success: true, data: [] }));
    expect(await screen.findByText('ffNoSavedRuns')).toBeTruthy();
  });

  const twoRuns = { success: true, data: [
    { run_id: 'run-2', run_code: 'FFR-farm-1-000002', version: 2, view: 'CUSTOM', from_date: '2026-10-01', to_date: '2026-10-07' },
    { run_id: 'run-1', run_code: 'FFR-farm-1-000001', version: 1, view: 'CUSTOM', from_date: '2026-09-24', to_date: '2026-09-30' },
  ] };

  it('confirms before permanently deleting a run, then refreshes the list', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce(twoRuns).mockResolvedValueOnce({ success: true, data: [twoRuns.data[1]] });
    (api.delete as jest.Mock).mockResolvedValue({ success: true });
    render(<FeedForecastRunHistory farmId="farm-1" reloadToken={0} />);
    await screen.findByText('FFR-farm-1-000002');

    fireEvent.click(screen.getAllByRole('button', { name: 'ffRunDelete' })[0]);
    expect(screen.getByText('ffRunDeleteConfirm:{"code":"FFR-farm-1-000002"}')).toBeTruthy();
    expect(api.delete).not.toHaveBeenCalled();

    const buttons = screen.getAllByRole('button', { name: 'ffRunDelete' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/feed-forecast/runs/run-2/permanent'));
    await waitFor(() => expect(screen.queryByText('FFR-farm-1-000002')).toBeNull());
    expect(screen.getByText('FFR-farm-1-000001')).toBeTruthy();
  });

  it('cancelling the confirm deletes nothing', async () => {
    (api.get as jest.Mock).mockResolvedValue(twoRuns);
    render(<FeedForecastRunHistory farmId="farm-1" reloadToken={0} />);
    await screen.findByText('FFR-farm-1-000002');
    fireEvent.click(screen.getAllByRole('button', { name: 'ffRunDelete' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.queryByText(/ffRunDeleteConfirm/)).toBeNull();
  });

  it('shows the refusal naming what uses the run and keeps the run listed', async () => {
    (api.get as jest.Mock).mockResolvedValue(twoRuns);
    (api.delete as jest.Mock).mockRejectedValue({ message: 'Used by requisition REQ-0007 — cannot delete FFR-farm-1-000002.' });
    render(<FeedForecastRunHistory farmId="farm-1" reloadToken={0} />);
    await screen.findByText('FFR-farm-1-000002');
    fireEvent.click(screen.getAllByRole('button', { name: 'ffRunDelete' })[0]);
    const buttons = screen.getAllByRole('button', { name: 'ffRunDelete' });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText(/Used by requisition REQ-0007/)).toBeTruthy();
    expect(screen.getAllByText('FFR-farm-1-000002').length).toBeGreaterThan(0);
  });

  it('opens View calculation in a dialog on top of the history, not in the page', async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => Promise.resolve(url.includes('/runs/run-2')
      ? { success: true, data: { run_id: 'run-2', run_code: 'FFR-farm-1-000002', output_snapshot: { display: { rows: [{}, {}, {}], filters: { view: 'CUSTOM', from: '2026-10-01' } } } } }
      : twoRuns));
    const onViewRun = undefined;
    render(<FeedForecastRunHistory farmId="farm-1" reloadToken={0} onViewRun={onViewRun} />);
    await screen.findByText('FFR-farm-1-000002');
    fireEvent.click(screen.getAllByRole('button', { name: 'ffRunViewCalculation' })[0]);
    expect(await screen.findByTestId('run-grid')).toBeTruthy();
    expect(screen.getByText('3 rows')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/feed-forecast/runs/run-2');
    // the history list is still there underneath
    expect(screen.getByText('FFR-farm-1-000001')).toBeTruthy();
  });
});
