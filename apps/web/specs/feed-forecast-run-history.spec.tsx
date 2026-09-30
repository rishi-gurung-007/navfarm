import React from 'react';
import { render, screen } from '@testing-library/react';
import { api } from '../src/services/api-client';
import { FeedForecastRunHistory } from '../src/components/console/inventory/feed-forecast-run-history';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string, vars?: unknown) => vars ? `${key}:${JSON.stringify(vars)}` : key }) }));

describe('FeedForecastRunHistory', () => {
  it('loads only the selected farm and renders immutable versions newest first', async () => {
    (api.get as jest.Mock).mockResolvedValue({ success: true, data: [
      { run_id: 'run-2', run_code: 'FFR-farm-1-000002', version: 2, view: 'CUSTOM', from_date: '2026-10-01', to_date: '2026-10-07', created_at: '2026-10-01 09:00:00' },
      { run_id: 'run-1', run_code: 'FFR-farm-1-000001', version: 1, view: 'CUSTOM', from_date: '2026-09-24', to_date: '2026-09-30', created_at: '2026-09-24 09:00:00' },
    ] });

    render(<FeedForecastRunHistory farmId="farm-1" reloadToken={0} />);

    expect(await screen.findByText('FFR-farm-1-000002')).toBeTruthy();
    expect(screen.getByText('FFR-farm-1-000001')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/feed-forecast/runs?farmId=farm-1');
  });
});
