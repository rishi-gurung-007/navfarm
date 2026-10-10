import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { api } from '../src/services/api-client';
import { FeedForecastRunHistory } from '../src/components/console/inventory/feed-forecast-run-history';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string, vars?: unknown) => vars ? `${key}:${JSON.stringify(vars)}` : key }) }));

describe('FeedForecastRunHistory', () => {
  beforeEach(() => (api.get as jest.Mock).mockReset());

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
    expect(screen.getByText('ffRunSelectedFilters:{"view":"CUSTOM","planning":"01/10/26","from":"01/10/26","to":"07/10/26"}')).toBeTruthy();
    expect(screen.getByText('ffRunConfigVersion:{"version":"sha256:config-2"}')).toBeTruthy();
    expect(screen.getByText('ffRunAuthor:{"author":"Asha Rai"}')).toBeTruthy();
    expect(screen.queryByText(/user-2/)).toBeNull();
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
});
