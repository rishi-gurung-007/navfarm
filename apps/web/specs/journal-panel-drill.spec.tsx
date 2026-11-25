/**
 * The Journal opened from a GM Dashboard overhead figure: the status, account, farm and posting dates arrive in the
 * link, show in the page's own filters, and can be changed or cleared there.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import JournalPanel from '../src/components/console/finance/journal-panel';
import { api } from '../src/services/api-client';
import { translations } from '../src/utils/translations';

let query = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query),
}));
jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
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

const en = translations.en;
const get = api.get as jest.Mock;
const listCalls = () =>
  get.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/journal?'))
    .map((url) => new URLSearchParams(url.split('?')[1]));
const lastCall = () => listCalls()[listCalls().length - 1];
const filter = (name: string) => screen.getByRole('button', { name });
const choose = (name: string, option: string) => {
  fireEvent.click(filter(name));
  fireEvent.click(screen.getByRole('option', { name: option }));
};

beforeEach(() => {
  query = '';
  mockScope = 'COMPANY';
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.startsWith('/location?'))
      return { data: [{ location_id: 'f1', location_code: 'FRM-1', location_name: 'Porta Farm' }] };
    if (url.startsWith('/gl-account?'))
      return {
        data: [
          { gl_account_id: 'a1', account_code: '4600', account_name: 'Other Overheads' },
          { gl_account_id: 'a2', account_code: '4610', account_name: 'Staff Overheads' },
        ],
      };
    return { data: [] };
  });
});

describe('Journal from a dashboard link', () => {
  it('asks for the linked status, account, farm and dates first, shows them, and drops the account and farm on All', async () => {
    query = 'status=POSTED&accounts=4600&farmId=f1&from=2026-10-25&to=2026-11-21';
    render(<JournalPanel />);

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    const first = listCalls()[0];
    expect(first.get('status')).toBe('POSTED');
    expect(first.get('accountCodes')).toBe('4600');
    expect(first.get('farmId')).toBe('f1');
    expect(first.get('dateFrom')).toBe('2026-10-25');
    expect(first.get('dateTo')).toBe('2026-11-21');
    expect(first.has('accounts')).toBe(false);

    expect(get).toHaveBeenCalledWith('/location?locationType=FARM&rootOnly=true&isActive=true&limit=100');
    await waitFor(() => expect(filter(en.jpFilterByFarm).textContent).toContain('Porta Farm'));
    await waitFor(() => expect(filter(en.jpFilterByAccount).textContent).toContain('4600 · Other Overheads'));
    expect(filter(en.jpFilterByStatus).textContent).toContain(en.jpPosted);
    expect((screen.getByRole('textbox', { name: 'From posting date' }) as HTMLInputElement).value).toBe('25/10/26');
    expect((screen.getByRole('textbox', { name: 'To posting date' }) as HTMLInputElement).value).toBe('21/11/26');

    choose(en.jpFilterByAccount, en.jpAllAccounts);
    await waitFor(() => expect(lastCall().has('accountCodes')).toBe(false));
    expect(lastCall().get('farmId')).toBe('f1');

    choose(en.jpFilterByFarm, en.jpAllFarms);
    await waitFor(() => expect(lastCall().has('farmId')).toBe(false));
    expect(lastCall().has('accountCodes')).toBe(false);
    expect(lastCall().get('status')).toBe('POSTED');
    expect(lastCall().get('dateFrom')).toBe('2026-10-25');
  });

  it('opens unfiltered without a link, and offers the two overhead accounts', async () => {
    render(<JournalPanel />);

    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
    for (const key of ['status', 'accountCodes', 'farmId', 'dateFrom', 'dateTo']) expect(listCalls()[0].has(key)).toBe(false);
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringMatching(/^\/gl-account\?/)));

    fireEvent.click(filter(en.jpFilterByAccount));
    await waitFor(() =>
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
        en.jpAllAccounts,
        '4600 · Other Overheads',
        '4610 · Staff Overheads',
      ]),
    );
    fireEvent.click(screen.getByRole('option', { name: '4610 · Staff Overheads' }));
    await waitFor(() => expect(lastCall().get('accountCodes')).toBe('4610'));
  });

  // The farm filter in force is always shown, and All Farms can be chosen and left again.
  const switchesAllAndBack = async (shown: string) => {
    await waitFor(() => expect(filter(en.jpFilterByFarm).textContent).toContain(shown));
    choose(en.jpFilterByFarm, en.jpAllFarms);
    await waitFor(() => expect(lastCall().has('farmId')).toBe(false));
    fireEvent.click(filter(en.jpFilterByFarm));
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
    render(<JournalPanel />);

    await switchesAllAndBack('Porta Farm');
    // The page asks for one company's journals, so only that company's farms are offered.
    fireEvent.click(filter(en.jpFilterByFarm));
    expect(screen.queryByRole('option', { name: /Other Company Farm/ })).toBeNull();
  });

  it('keeps a linked farm the list lacks as an option, even when the list cannot be loaded', async () => {
    query = 'farmId=f1';
    get.mockImplementation(async (url: string) => {
      if (url.startsWith('/location?')) throw new Error('Forbidden');
      return { data: [] };
    });
    render(<JournalPanel />);

    await switchesAllAndBack(en.farmPickerUnlisted);
  });
});
