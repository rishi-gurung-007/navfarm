import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import OperationalBatchDataEntry from '../src/components/console/production/operational-batch-data-entry';
import { api } from '../src/services/api-client';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('../src/services/api-client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) =>
    key === 'deNoBatches'
      ? 'No active batches'
      : key === 'deNoBatchesBody'
      ? 'Data entry needs an active batch. Create or activate one first.'
      : vars
      ? `${key}:${JSON.stringify(vars)}`
      : key;
  return { useLanguage: () => ({ t: stableT }) };
});

jest.mock('../src/hooks/useAuth', () => ({
  getActiveCompanyId: jest.fn(() => 'co-test-123'),
  getStoredUser: jest.fn(() => ({ userId: 'u-1', userType: 'TENANT_ADMIN' })),
}));

const get = api.get as jest.Mock;

describe('OperationalBatchDataEntry empty state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders clean empty state and no dummy UI when no batches exist', async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith('/batch')) {
        return Promise.resolve({ data: [] });
      }
      if (url.startsWith('/breed')) {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: [] });
    });

    render(<OperationalBatchDataEntry />);

    await waitFor(() => {
      expect(screen.getByText('No active batches')).toBeTruthy();
      expect(
        screen.getByText('Data entry needs an active batch. Create or activate one first.')
      ).toBeTruthy();
    });

    // Ensure dummy UI elements are NOT displayed
    expect(screen.queryByText('LIVE ACTIVE')).toBeNull();
    expect(screen.queryByText('Save Draft Entry')).toBeNull();
    expect(screen.queryByText('Post Entry')).toBeNull();
    expect(screen.queryByText('Transfer Stage')).toBeNull();
    expect(screen.queryByText('Quarantine')).toBeNull();
    expect(screen.queryByText('Gilt Grower')).toBeNull();
  });
});
