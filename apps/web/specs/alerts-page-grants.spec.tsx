import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import AlertPanel from '../src/components/console/production/alert-panel';
import { ProductionPageShell } from '../src/components/console/production/production-page-shell';
import { api } from '../src/services/api-client';
import { getStoredUser } from '../src/hooks/useAuth';

/**
 * F1 (final review I1): a store or feed role holds INVENTORY/LEDGER/view but
 * not PRODUCTION/BATCH/view. Inventory -> Feed Alerts now redirects to
 * /alerts, so that page has to let them in and has to survive the 403 the
 * batch list gives them.
 */
jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT, tLob: (l: string) => l }) };
});
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({
  loadFeedFarms: jest.fn(async () => [{ farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'T' }]),
}));

const actual = jest.requireActual('../src/hooks/useAuth');
jest.mock('../src/hooks/useAuth', () => ({
  ...jest.requireActual('../src/hooks/useAuth'),
  getActiveCompanyId: jest.fn(() => 'co-1'),
  getActiveLob: jest.fn(() => 'PIGGERY'),
  getStoredUser: jest.fn(),
}));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const storedUser = getStoredUser as jest.Mock;

const FEED_ONLY = {
  userId: 'u-feed',
  userType: 'STANDARD_USER',
  permissions: [{ moduleCode: 'INVENTORY', resource: 'LEDGER', canView: true }],
};
const BATCH_ONLY = {
  userId: 'u-batch',
  userType: 'STANDARD_USER',
  permissions: [{ moduleCode: 'PRODUCTION', resource: 'BATCH', canView: true }],
};
const REPORTING_PERIOD_APPROVER = {
  userId: 'u-calendar-approver',
  userType: 'STANDARD_USER',
  permissions: [{
    moduleCode: 'MASTER_DATA', resource: 'REPORTING_PERIOD',
    canView: true, canEdit: true, canApprove: true,
  }],
};

const feedAlert = {
  alert_id: 'f1', company_id: 'co-1', farm_id: 'farm-vil', farm_code: 'VIL100', priority_level: 'CRITICAL_FIRST_PRIORITY',
  status: 'ACTIVE', title: 'Low feed: VIL100/SILO-004', message: 'VIL100/SILO-004 has 900 kg.',
  raised_at: '2026-09-27 06:00:00', last_notified_at: '2026-09-27 06:00:00', acknowledged_at: null,
};
const batchAlert = {
  alert_id: 'b1', company_id: 'co-1', severity: 'WARNING', title: 'ADG below target', message: 'BATCH-000013 ADG 520 g.',
  farm_id: 'farm-vil', is_read: false, created_at: '2026-09-26 08:00:00',
};

const forbidden = () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }));

beforeEach(() => {
  jest.clearAllMocks();
  post.mockResolvedValue({ data: { farms: 1, failed: [], forecastErrors: [] } });
});

describe('F1 — the Alerts page and the feed grant', () => {
  it('sanity: hasPermission separates the two grants', () => {
    expect(actual.hasPermission(FEED_ONLY as any, 'INVENTORY', 'LEDGER', 'can_view')).toBe(true);
    expect(actual.hasPermission(FEED_ONLY as any, 'PRODUCTION', 'BATCH', 'can_view')).toBe(false);
  });

  it('reads can_approve independently from can_edit', () => {
    expect(actual.hasPermission(REPORTING_PERIOD_APPROVER as any, 'MASTER_DATA', 'REPORTING_PERIOD', 'can_approve')).toBe(true);
    expect(actual.hasPermission({
      ...REPORTING_PERIOD_APPROVER,
      permissions: [{ ...REPORTING_PERIOD_APPROVER.permissions[0], canApprove: false }],
    } as any, 'MASTER_DATA', 'REPORTING_PERIOD', 'can_approve')).toBe(false);
  });

  it('does not turn Operational Admin master editing into implicit approval', () => {
    expect(actual.hasPermission({
      userId: 'u-ops', userType: 'OPERATIONAL_ADMIN', permissions: [],
    } as any, 'MASTER_DATA', 'REPORTING_PERIOD', 'can_approve')).toBe(false);
    expect(actual.hasPermission({
      ...REPORTING_PERIOD_APPROVER, userType: 'OPERATIONAL_ADMIN',
    } as any, 'MASTER_DATA', 'REPORTING_PERIOD', 'can_approve')).toBe(true);
  });

  it('lets a feed-only user onto the page when it opts into the feed grant', async () => {
    storedUser.mockReturnValue(FEED_ONLY);
    render(
      <ProductionPageShell titleKey={'navAlerts' as any} alsoAllow={[['INVENTORY', 'LEDGER']]}>
        {() => <p>the alerts</p>}
      </ProductionPageShell>,
    );
    expect(await screen.findByText('the alerts')).toBeTruthy();
    expect(screen.queryByText('ppsAccessDeniedTitle')).toBeNull();
  });

  it('still refuses a user who holds neither grant', async () => {
    storedUser.mockReturnValue({ userId: 'u-none', userType: 'STANDARD_USER', permissions: [] });
    render(
      <ProductionPageShell titleKey={'navAlerts' as any} alsoAllow={[['INVENTORY', 'LEDGER']]}>
        {() => <p>the alerts</p>}
      </ProductionPageShell>,
    );
    expect(await screen.findByText('ppsAccessDeniedTitle')).toBeTruthy();
    expect(screen.queryByText('the alerts')).toBeNull();
  });

  it('keeps the feed alerts when the batch list is refused, and offers no Batch filter', async () => {
    storedUser.mockReturnValue(FEED_ONLY);
    get.mockImplementation((url: string) =>
      url.startsWith('/feed-alert/scope') ? Promise.resolve({ data: [feedAlert] }) : forbidden(),
    );
    render(<AlertPanel />);
    const table = await screen.findByRole('table', { name: 'alrtTableLabel' });
    await within(table).findByText('Low feed: VIL100/SILO-004');
    // The whole page must not turn into the batch list's error.
    expect(screen.queryByText('Forbidden')).toBeNull();
    const typeFilter = screen.getByLabelText('alrtType') as HTMLSelectElement;
    await waitFor(() => expect([...typeFilter.options].map((o) => o.value)).not.toContain('BATCH'));
  });

  it('keeps the batch alerts when the feed list is refused, and offers no Feed filter', async () => {
    storedUser.mockReturnValue(BATCH_ONLY);
    get.mockImplementation((url: string) =>
      url.startsWith('/feed-alert/scope') ? forbidden() : Promise.resolve({ data: [batchAlert] }),
    );
    render(<AlertPanel />);
    const table = await screen.findByRole('table', { name: 'alrtTableLabel' });
    await within(table).findByText('ADG below target');
    const typeFilter = screen.getByLabelText('alrtType') as HTMLSelectElement;
    await waitFor(() => expect([...typeFilter.options].map((o) => o.value)).not.toContain('FEED'));
  });
});
