import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CompanyTab from '../src/components/console/console-tabs/company-tab';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), upload: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;
const company = {
  company_id: 'co-1', company_code: 'CO1', company_name: 'Company One',
  default_language_id: 'en', base_currency_id: 'usd', default_timezone_id: 'Africa/Harare', country_id: 'ZW',
};
const currencies = [
  { currency_id: 'usd', iso_code: 'USD', currency_name: 'US Dollar' },
  { currency_id: 'local', iso_code: 'LOC', currency_name: 'Local Currency' },
];

beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation((url: string) => {
    if (url === '/language' || url === '/setup/wizard/nobs') return Promise.resolve([]);
    if (url === '/setup/wizard/company-details/co-1') return Promise.resolve({
      company, address: null, contact: null, fiscal: null, modules: [],
      currencies: [{ ...currencies[0], is_base: true, is_local: false }, { ...currencies[1], is_base: false, is_local: true }],
    });
    if (url === '/feed-settings?companyId=co-1') return Promise.resolve({ data: {
      defaultForecastDays: 7, maxForecastDays: 45,
      productionWeekday: null, productionShift: null,
      submissionWeekday: null, submissionTime: null,
      reminderWeekday: null, reminderTime: null,
      physicalCountWeekday: null, physicalCountTime: null,
      truckTargetKg: null, bulkMultipleKg: null,
      capacityWarningPct: 90, bagTolerancePct: null,
      financeVariancePct: 5, financeVarianceAmount: null,
    } });
    return Promise.resolve([]);
  });
  post.mockResolvedValue({ success: true });
  put.mockResolvedValue({ success: true });
});

it('shows separate base and local currency fields and submits both explicit choices', async () => {
  render(<CompanyTab activeCompany={company} companies={[company]} currencies={currencies} tenantId="tenant-1" currentUser={{ userType: 'COMPANY_ADMIN' }} skipDirectory section="localization" />);
  const local = await screen.findByLabelText(/ctLocalCurrency/, { selector: 'select' });
  await waitFor(() => expect((local as HTMLSelectElement).value).toBe('local'));
  fireEvent.change(local, { target: { value: 'usd' } });
  fireEvent.click(screen.getByRole('button', { name: 'saveChanges' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith('/setup/wizard/step-5/co-1/usd/usd'));
});

it('loads and saves company feed settings without inserting a client schedule into blank fields', async () => {
  render(<CompanyTab activeCompany={company} companies={[company]} currencies={currencies} tenantId="tenant-1" currentUser={{ userType: 'COMPANY_ADMIN' }} skipDirectory section="feed" />);
  expect((await screen.findByLabelText(/ctFeedDefaultForecastDays/) as HTMLInputElement).value).toBe('7');
  expect((screen.getByLabelText('ctFeedSubmissionTime') as HTMLInputElement).value).toBe('');
  expect(screen.getByLabelText('ctFeedTruckTargetKg').getAttribute('min')).toBe('0.01');
  expect(screen.getByLabelText('ctFeedBulkMultipleKg').getAttribute('min')).toBe('0.01');
  fireEvent.change(screen.getByLabelText('ctFeedSubmissionTime'), { target: { value: '12:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'saveChanges' }));
  await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-settings', expect.objectContaining({
    companyId: 'co-1', defaultForecastDays: 7, maxForecastDays: 45, submissionTime: '12:00',
  })));
});
