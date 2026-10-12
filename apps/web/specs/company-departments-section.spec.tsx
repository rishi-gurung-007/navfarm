import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CompanyTab, { SETTINGS_SECTIONS } from '../src/components/console/console-tabs/company-tab';
import { LanguageProvider } from '../src/hooks/useLanguage';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(), upload: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({
  getActiveCompanyId: () => 'co-1',
  getActiveWorkspaceScope: () => 'COMPANY',
  getActiveOperationalAreaId: () => null,
  getActiveOperationalArea: () => null,
  getStoredUser: () => ({ userType: 'COMPANY_ADMIN' }),
  hasPermission: () => true,
}));
jest.mock('../src/hooks/useMediaQuery', () => ({ useIsDesktop: () => true }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const company = { company_id: 'co-1', company_code: 'CO1', company_name: 'Company One', default_language_id: 'en', base_currency_id: 'usd', default_timezone_id: 'UTC', country_id: 'ZW' };

beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });
beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation((url: string) => {
    if (url.startsWith('/cost-center?')) return Promise.resolve({ success: true, data: [
      { cost_center_id: 'd1', company_id: 'co-1', cost_center_code: 'STORES', cost_center_name: 'Stores', cost_center_type: 'DEPARTMENT', is_active: true },
    ], total: 1, limit: 25, offset: 0 });
    if (url === '/setup/wizard/company-details/co-1') return Promise.resolve({ company, address: null, contact: null, fiscal: null, modules: [], currencies: [] });
    return Promise.resolve([]);
  });
  post.mockResolvedValue({ success: true, data: {} });
});

const open = () => render(
  <LanguageProvider>
    <CompanyTab activeCompany={company} companies={[company]} currencies={[]} tenantId="t1" currentUser={{ userType: 'COMPANY_ADMIN' }} skipDirectory section="departments" />
  </LanguageProvider>,
);

it('registers a departments section', () => {
  expect(SETTINGS_SECTIONS.map((s) => s.key)).toContain('departments');
});

it('lists only DEPARTMENT cost centres of the active company', async () => {
  open();
  expect(await screen.findByText('STORES')).toBeTruthy();
  const url = get.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/cost-center?'))!;
  const q = new URLSearchParams(url.split('?')[1]);
  expect(q.get('costCenterType')).toBe('DEPARTMENT');
  expect(q.get('companyId')).toBe('co-1');
});

it('creates a department as type DEPARTMENT for the active company, with no type field shown', async () => {
  open();
  await screen.findByText('STORES');
  fireEvent.click(screen.getByRole('button', { name: /^(add|new|create)\b/i }));
  expect(screen.queryByText(/cost center type/i)).toBeNull();
  fireEvent.change(await screen.findByPlaceholderText('STORES'), { target: { value: 'FEED-MILL' } });
  fireEvent.change(screen.getByPlaceholderText('Stores'), { target: { value: 'Feed Mill' } });
  const dialogButtons = screen.getAllByRole('button').filter((b) => /^(save|create|add)/i.test(b.textContent || ''));
  fireEvent.click(dialogButtons[dialogButtons.length - 1]);
  await waitFor(() => expect(post).toHaveBeenCalledWith('/cost-center', expect.objectContaining({
    cost_center_code: 'FEED-MILL', cost_center_name: 'Feed Mill', cost_center_type: 'DEPARTMENT', company_id: 'co-1',
  })));
});
