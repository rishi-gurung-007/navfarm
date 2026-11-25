/**
 * Kill Sheets opened from the GM Dashboard: the farm, status and slaughter dates arrive in the link, show in the page's
 * own filters, can be changed there, and go for good with Clear Filters.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import KillSheetsPage from '../src/app/(app)/batches/kill-sheets/page';
import { api } from '../src/services/api-client';

let query = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key: string) =>
      (jest.requireActual('../src/utils/translations').translations.en as any)[key] ?? key,
  }),
}));
let mockScope = 'COMPANY';
jest.mock('../src/hooks/useAuth', () => ({
  getActiveCompanyId: () => 'co-1',
  getActiveWorkspaceScope: () => mockScope,
  getStoredUser: () => ({ tenantId: 't-1', companies: [{ company_id: 'co-1', company_name: 'Porta' }] }),
}));
jest.mock('../src/hooks/useCompanyCurrency', () => ({
  useCompanyCurrency: () => ({ currency: 'USD' }),
  formatMoney: (n: number) => String(n),
}));

const get = api.get as jest.Mock;
const listCalls = () =>
  get.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/kill-sheets?'))
    .map((url) => new URLSearchParams(url.split('?')[1]));
const lastCall = () => listCalls()[listCalls().length - 1];
const linked = ['status', 'farm_id', 'date_from', 'date_to'];

beforeEach(() => {
  query = '';
  mockScope = 'COMPANY';
  get.mockReset();
  get.mockImplementation(async (url: string) =>
    url.startsWith('/location?')
      ? { data: [{ location_id: 'f1', location_code: 'FRM-1', location_name: 'Porta Farm' }] }
      : { data: [], total: 0 },
  );
});

const from = () => screen.getByRole('textbox', { name: 'Slaughtered from' }) as HTMLInputElement;
const to = () => screen.getByRole('textbox', { name: 'Slaughtered to' }) as HTMLInputElement;

describe('Kill Sheets from a dashboard link', () => {
  it('asks for the linked status, farm and dates first, shows them, and keeps them until changed', async () => {
    query = 'status=IMPORTED&farmId=f1&from=2026-10-25&to=2026-11-21';
    render(<KillSheetsPage />);

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    const first = listCalls()[0];
    expect(first.get('status')).toBe('IMPORTED');
    expect(first.get('farm_id')).toBe('f1');
    expect(first.get('date_from')).toBe('2026-10-25');
    expect(first.get('date_to')).toBe('2026-11-21');
    expect(first.get('company_id')).toBe('co-1');
    expect(from().value).toBe('25/10/26');
    expect(to().value).toBe('21/11/26');
    // The farm and status dropdowns show the linked values.
    const dropdown = (value: string) => document.querySelector(`button[value="${value}"]`)?.textContent;
    await waitFor(() => expect(dropdown('f1')).toBe('Porta Farm (FRM-1)'));
    expect(dropdown('IMPORTED')).toBe('Confirmed (Imported)');

    fireEvent.change(from(), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(lastCall().get('date_from')).toBe('2026-11-01'));
    expect(lastCall().get('date_to')).toBe('2026-11-21');
    expect(lastCall().get('farm_id')).toBe('f1');
    expect(lastCall().get('status')).toBe('IMPORTED');
    expect(lastCall().get('page')).toBe('1');
    for (const call of listCalls()) {
      expect(call.get('status')).toBe('IMPORTED');
      expect(call.get('farm_id')).toBe('f1');
      expect(call.get('date_to')).toBe('2026-11-21');
    }
  });

  it('drops everything the link brought on Clear Filters, and it does not come back', async () => {
    query = 'status=IMPORTED&farmId=f1&from=2026-10-25&to=2026-11-21';
    const view = render(<KillSheetsPage />);
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    const before = listCalls().length;

    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
    for (const key of linked) expect(lastCall().has(key)).toBe(false);

    view.rerender(<KillSheetsPage />);
    // A further request after the re-render still carries none of them.
    fireEvent.change(from(), { target: { value: '2026-11-02' } });
    await waitFor(() => expect(lastCall().get('date_from')).toBe('2026-11-02'));
    for (const call of listCalls().slice(before)) {
      for (const key of ['status', 'farm_id', 'date_to']) expect(call.has(key)).toBe(false);
    }
    expect(from().value).toBe('02/11/26');
    expect(to().value).toBe('');
  });

  it('treats a date alone as an active filter', async () => {
    query = 'from=2026-10-25';
    render(<KillSheetsPage />);

    expect(await screen.findByText(/No kill sheets match your active filter criteria/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear Filters' })).toBeTruthy();
  });

  it('opens as before without a link', async () => {
    render(<KillSheetsPage />);

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    for (const key of linked) expect(listCalls()[0].has(key)).toBe(false);
    expect(listCalls()[0].get('company_id')).toBe('co-1');
    expect(from().value).toBe('');
    expect(await screen.findByText(/Upload an individual slaughter sheet/)).toBeTruthy();
  });

  const farmFilter = () => screen.getByRole('button', { name: 'Farm' });
  const switchesAllAndBack = async (shown: string) => {
    await waitFor(() => expect(farmFilter().textContent).toContain(shown));
    fireEvent.click(farmFilter());
    fireEvent.click(screen.getByRole('option', { name: 'All Farms' }));
    await waitFor(() => expect(lastCall().has('farm_id')).toBe(false));
    fireEvent.click(farmFilter());
    fireEvent.click(screen.getByRole('option', { name: new RegExp(shown.replace(/[()]/g, '.')) }));
    await waitFor(() => expect(lastCall().get('farm_id')).toBe('f1'));
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
      return { data: [], total: 0 };
    });
    render(<KillSheetsPage />);

    await switchesAllAndBack('Porta Farm');
    // The company filter is on one company, so only its farms are offered.
    fireEvent.click(farmFilter());
    expect(screen.queryByRole('option', { name: /Other Company Farm/ })).toBeNull();
  });

  it('keeps a linked farm the list lacks as an option', async () => {
    query = 'farmId=f1';
    get.mockImplementation(async () => ({ data: [], total: 0 }));
    render(<KillSheetsPage />);

    await switchesAllAndBack('Selected farm');
  });
});
