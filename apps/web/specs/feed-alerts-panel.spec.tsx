import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FeedAlertsPanel from '../src/components/console/inventory/feed-alerts-panel';
import { api } from '../src/services/api-client';
import { getStoredUser, getActiveFarmId } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock('../src/hooks/useAuth', () => ({ getStoredUser: jest.fn(), getActiveFarmId: jest.fn() }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const lowAlert = {
  alert_id: 'a1', notification_code: 'FEED-BELOW-L1', event_type: 'FEED_BELOW_L1', priority_level: 'CRITICAL_FIRST_PRIORITY',
  status: 'ACTIVE', title: 'Low feed: GRS/SILO-001', message: 'GRS/SILO-001 holds 900 kg of Weaner Diet R1 — at or below its low level of 1,000 kg.',
  raised_at: '2026-09-23 08:00:00', last_notified_at: '2026-09-23 08:00:00', escalation_role: null, escalated_at: null, acknowledged_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (getStoredUser as jest.Mock).mockReturnValue({ userId: 'u1', userType: 'STANDARD_USER', farmId: 'farm-grs' });
  (getActiveFarmId as jest.Mock).mockReturnValue(null);
  post.mockResolvedValue({ data: {} });
  get.mockResolvedValue({ data: [lowAlert] });
});

describe('FeedAlertsPanel', () => {
  it('evaluates the farm first, then lists its alerts', async () => {
    render(<FeedAlertsPanel />);
    await screen.findByText('Low feed: GRS/SILO-001');
    expect(post).toHaveBeenCalledWith('/feed-alert/evaluate', { farmId: 'farm-grs' });
    expect(get).toHaveBeenCalledWith('/feed-alert?farmId=farm-grs&status=ACTIVE');
    expect(post.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder[0]);
    expect(screen.getByText('CRITICAL_FIRST_PRIORITY')).toBeTruthy();
  });

  it('still lists alerts when evaluation fails', async () => {
    post.mockRejectedValueOnce(new Error('boom'));
    render(<FeedAlertsPanel />);
    await screen.findByText('Low feed: GRS/SILO-001');
  });

  it('acknowledges an alert', async () => {
    render(<FeedAlertsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'falAcknowledge' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-alert/a1/acknowledge', {}));
  });
});
