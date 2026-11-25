/** Profit & Loss opened from the GM Dashboard: the dates arrive in the link and the first request already uses them. */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfitLossPanel from '../src/components/console/finance/profit-loss-panel';
import { api } from '../src/services/api-client';

let query = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query),
}));
jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({
  getActiveCompanyId: () => 'co-1',
}));
jest.mock('../src/hooks/useLanguage', () => {
  const t = (key: string) => key;
  return { useLanguage: () => ({ t }) };
});

const get = api.get as jest.Mock;
const calls = () =>
  get.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/financial-reports/profit-loss?'))
    .map((url) => Object.fromEntries(new URLSearchParams(url.split('?')[1])));
const settle = () => act(() => new Promise((done) => setTimeout(done, 20)));
const dates = () =>
  (screen.getAllByRole('textbox') as HTMLInputElement[]).map((i) => i.value);

beforeEach(() => {
  query = '';
  get.mockReset().mockResolvedValue({
    data: { income: [], expense: [], totalIncome: 0, totalExpense: 0, netIncome: 0 },
  });
});

describe('Profit & Loss from a dashboard link', () => {
  it('asks once, for the linked dates, shows them, and lets them be changed', async () => {
    query = 'from=2026-10-25&to=2026-11-21';
    render(<ProfitLossPanel />);
    await settle();
    expect(calls()).toEqual([
      { companyId: 'co-1', dateFrom: '2026-10-25', dateTo: '2026-11-21' },
    ]);
    expect(dates()).toEqual(['25/10/26', '21/11/26']);

    fireEvent.change(screen.getAllByRole('textbox')[0], {
      target: { value: '2026-11-01' },
    });
    await waitFor(() => expect(calls()).toHaveLength(2));
    expect(calls()[1]).toEqual({
      companyId: 'co-1',
      dateFrom: '2026-11-01',
      dateTo: '2026-11-21',
    });
  });

  it('opens on this year to date without a link', async () => {
    const today = new Date().toISOString().slice(0, 10);
    render(<ProfitLossPanel />);
    await settle();
    expect(calls()).toEqual([
      { companyId: 'co-1', dateFrom: `${today.slice(0, 4)}-01-01`, dateTo: today },
    ]);
  });
});
