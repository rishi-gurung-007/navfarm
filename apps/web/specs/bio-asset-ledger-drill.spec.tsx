/**
 * Assets Ledger opened from the GM Dashboard: the farm, the sold-only switch and the dates arrive in the link, show in
 * the page's own filters, and can be changed there.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BioAssetLedgerPanel from '../src/components/console/inventory/bio-asset-ledger-panel';
import { api } from '../src/services/api-client';
import { translations } from '../src/utils/translations';

let query = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/lib/api-client', () => ({ apiDownload: jest.fn() }));
jest.mock('../src/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) =>
      (jest.requireActual('../src/utils/translations').translations.en as any)[key] ?? key,
  }),
}));
let mockScope = 'COMPANY';
jest.mock('../src/hooks/useAuth', () => ({
  getActiveCompanyId: () => 'co-1',
  getActiveWorkspaceScope: () => mockScope,
}));
jest.mock('../src/hooks/useCompanyCurrency', () => ({
  useCompanyCurrency: () => ({ formatMoney: (n: number) => String(n) }),
}));

const get = api.get as jest.Mock;
const entryCalls = () =>
  get.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/bio-asset-ledger/entries?'))
    .map((url) => new URLSearchParams(url.split('?')[1]));

beforeEach(() => {
  query = '';
  mockScope = 'COMPANY';
  get.mockReset();
  get.mockImplementation(async (url: string) =>
    url.startsWith('/location?')
      ? { data: [{ location_id: 'f1', location_code: 'FRM-1', location_name: 'Porta Farm' }] }
      : { data: [] },
  );
});

describe('Assets Ledger from a dashboard link', () => {
  it('asks for the linked farm, sales and dates first, shows them, and drops sales only when switched off', async () => {
    query = 'salesOnly=true&farmId=f1&from=2026-10-25&to=2026-11-21';
    render(<BioAssetLedgerPanel />);

    await waitFor(() => expect(entryCalls().length).toBeGreaterThan(0));
    const first = entryCalls()[0];
    expect(first.get('farmId')).toBe('f1');
    expect(first.get('salesOnly')).toBe('true');
    expect(first.get('dateFrom')).toBe('2026-10-25');
    expect(first.get('dateTo')).toBe('2026-11-21');

    expect(get).toHaveBeenCalledWith('/location?locationType=FARM&rootOnly=true&isActive=true&limit=100');
    const farm = screen.getByRole('button', { name: translations.en.balFarm });
    await waitFor(() => expect(farm.textContent).toContain('Porta Farm'));
    const salesOnly = screen.getByRole('checkbox', { name: translations.en.balSalesOnly }) as HTMLInputElement;
    expect(salesOnly.checked).toBe(true);

    fireEvent.click(salesOnly);
    await waitFor(() => expect(entryCalls().length).toBe(2));
    expect(entryCalls()[1].has('salesOnly')).toBe(false);
    expect(entryCalls()[1].get('farmId')).toBe('f1');
  });

  it('clears the farm and sales only with the other filters', async () => {
    query = 'salesOnly=true&farmId=f1';
    render(<BioAssetLedgerPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /Reset Filters/ }));

    await waitFor(() => expect(entryCalls().length).toBe(2));
    expect(entryCalls()[1].has('farmId')).toBe(false);
    expect(entryCalls()[1].has('salesOnly')).toBe(false);
  });

  it('opens unfiltered without a link', async () => {
    render(<BioAssetLedgerPanel />);

    await waitFor(() => expect(entryCalls().length).toBe(1));
    expect(entryCalls()[0].has('farmId')).toBe(false);
    expect(entryCalls()[0].has('salesOnly')).toBe(false);
    expect(screen.queryByRole('button', { name: /Reset Filters/ })).toBeNull();
  });

  const farmFilter = () => screen.getByRole('button', { name: translations.en.balFarm });
  const lastCall = () => entryCalls()[entryCalls().length - 1];
  const switchesAllAndBack = async (shown: string) => {
    await waitFor(() => expect(farmFilter().textContent).toContain(shown));
    fireEvent.click(farmFilter());
    fireEvent.click(screen.getByRole('option', { name: translations.en.balAllFarms }));
    await waitFor(() => expect(lastCall().has('farmId')).toBe(false));
    fireEvent.click(farmFilter());
    fireEvent.click(screen.getByRole('option', { name: new RegExp(shown.replace(/[()]/g, '.')) }));
    await waitFor(() => expect(lastCall().get('farmId')).toBe('f1'));
  };

  it('lists the company farms in the tenant-wide workspace, where the location master has none', async () => {
    mockScope = 'TENANT';
    query = 'farmId=f1';
    get.mockImplementation(async (url: string) => {
    if (url === '/reports/farrowing/farms')
      return {
        data: [
          { farm_id: 'f1', farm_code: 'FRM-1', farm_name: 'Porta Farm', company_id: 'co-1' },
          { farm_id: 'f9', farm_code: 'FRM-9', farm_name: 'Other Company Farm', company_id: 'co-2' },
        ],
      };
      return { data: [] };
    });
    render(<BioAssetLedgerPanel />);

    await switchesAllAndBack('Porta Farm');
    fireEvent.click(farmFilter());
    expect(screen.queryByRole('option', { name: /Other Company Farm/ })).toBeNull();
  });

  it('keeps a linked farm the list lacks as an option', async () => {
    query = 'farmId=f1';
    get.mockImplementation(async () => ({ data: [] }));
    render(<BioAssetLedgerPanel />);

    await switchesAllAndBack(translations.en.farmPickerUnlisted);
  });
});
