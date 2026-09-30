import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AlertPanel from '../src/components/console/production/alert-panel';
import { fromBatchAlert, fromFeedAlert, mergeAlerts } from '../src/components/console/production/alerts-list';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock('../src/hooks/useAuth', () => ({ getActiveCompanyId: jest.fn(() => 'co-1'), getStoredUser: jest.fn(() => ({ userId: 'u', userType: 'TENANT_ADMIN' })) }));
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({
  loadFeedFarms: jest.fn(async () => [
    { farmId: 'farm-gra', code: 'GRA100', name: 'Grasmere', companyId: 'co-1', companyName: 'T' },
    { farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'T' },
  ]),
}));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

const batchAlert = {
  alert_id: 'b1', company_id: 'co-1', severity: 'WARNING', title: 'ADG below target', message: 'BATCH-000013 ADG 520 g against 600 g.',
  batch_no: 'BATCH-000013', farm_id: 'farm-gra', is_read: false, created_at: '2026-09-26 08:00:00',
};
const feedAlert = {
  alert_id: 'f1', company_id: 'co-1', farm_id: 'farm-vil', farm_code: 'VIL100', priority_level: 'CRITICAL_FIRST_PRIORITY', status: 'ACTIVE',
  title: 'Low feed: VIL100/SILO-004', message: 'VIL100/SILO-004 has 900 kg of Weaner Diet R1, at or below its low level of 1,000 kg.',
  raised_at: '2026-09-27 06:00:00', last_notified_at: '2026-09-27 06:00:00', acknowledged_at: null,
};

function route(over: { feed?: () => Promise<any> } = {}) {
  get.mockImplementation((url: string) => {
    if (url.startsWith('/feed-alert/scope')) return over.feed ? over.feed() : Promise.resolve({ data: [feedAlert] });
    return Promise.resolve({ data: [batchAlert] });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  route();
  post.mockResolvedValue({ data: { farms: 2, failed: [], forecastErrors: [] } });
});

describe('alerts-list (D24)', () => {
  it('maps both kinds onto one row shape and orders newest first', () => {
    const rows = mergeAlerts([fromBatchAlert(batchAlert, () => 'GRA100')], [fromFeedAlert(feedAlert)]);
    expect(rows.map((r) => [r.kind, r.id, r.farmCode, r.state, r.priority])).toEqual([
      ['FEED', 'f1', 'VIL100', 'OPEN', 'CRITICAL_FIRST_PRIORITY'],
      ['BATCH', 'b1', 'GRA100', 'OPEN', 'WARNING'],
    ]);
    expect(fromFeedAlert({ ...feedAlert, acknowledged_at: '2026-09-27 07:00:00' }).state).toBe('ACKNOWLEDGED');
    expect(fromFeedAlert({ ...feedAlert, status: 'RESOLVED' }).state).toBe('RESOLVED');
    expect(fromBatchAlert({ ...batchAlert, is_read: true }, () => null).state).toBe('READ');
  });
});

describe('Alerts page (D24)', () => {
  it('evaluates feed alerts once on open, then lists both kinds in one table with labels', async () => {
    render(<AlertPanel />);
    const table = await screen.findByRole('table', { name: 'alrtTableLabel' });
    await within(table).findByText('Low feed: VIL100/SILO-004');
    expect(post).toHaveBeenCalledWith('/feed-alert/evaluate-scope', {});
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder.find((_, i) => String(get.mock.calls[i][0]).startsWith('/feed-alert/scope'))!);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('prioUrgent')).toBeTruthy();
    expect(within(rows[0]).getByText('VIL100')).toBeTruthy();
    expect(within(rows[1]).getByText('GRA100')).toBeTruthy();
    expect(within(rows[1]).getByText('26/09/26 08:00')).toBeTruthy();
    expect(screen.queryByText('CRITICAL_FIRST_PRIORITY')).toBeNull();
    expect(get).toHaveBeenCalledWith('/feed-alert/scope?status=ACTIVE');
    expect(get).toHaveBeenCalledWith('/alert?companyId=co-1&isRead=false&limit=200');
  });

  it('filters by type and farm without evaluating again', async () => {
    render(<AlertPanel />);
    await screen.findByText('Low feed: VIL100/SILO-004');
    get.mockClear();
    fireEvent.change(screen.getByLabelText('alrtType'), { target: { value: 'FEED' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-alert/scope?status=ACTIVE'));
    expect(get.mock.calls.some(([url]) => String(url).startsWith('/alert?'))).toBe(false);
    fireEvent.change(screen.getByLabelText('alrtFarm'), { target: { value: 'farm-vil' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-alert/scope?status=ACTIVE&farmId=farm-vil'));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a feed alert and marks a batch alert read', async () => {
    render(<AlertPanel />);
    await screen.findByText('Low feed: VIL100/SILO-004');
    fireEvent.click(screen.getByRole('button', { name: 'alrtAcknowledge' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-alert/f1/acknowledge', {}));
    fireEvent.click(await screen.findByRole('button', { name: 'alrtMarkRead' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/alert/b1/read', { companyId: 'co-1' }));
  });

  it('still shows batch alerts when the feed read is refused, without an error', async () => {
    route({ feed: () => Promise.reject({ message: 'Forbidden resource', statusCode: 403 }) });
    render(<AlertPanel />);
    expect(await screen.findByText('ADG below target')).toBeTruthy();
    expect(screen.queryByText('Forbidden resource')).toBeNull();
  });

  it('says which farms could not be fully checked', async () => {
    post.mockResolvedValue({ data: { farms: 2, failed: [{ farmCode: 'GRA100', reason: 'x' }], forecastErrors: [{ farmCode: 'VIL100', reason: 'y' }] } });
    render(<AlertPanel />);
    expect(await screen.findByText('alrtFeedPartly:{"farms":"GRA100, VIL100"}')).toBeTruthy();
  });
});
