import { renderHook, waitFor, act } from '@testing-library/react';
import { FEED_FARM_STORAGE_KEY, resetFeedFarmCache, useFeedFarm } from '../src/components/console/inventory/use-feed-farm';
import { api } from '../src/services/api-client';
import { getActiveCompanyId, getActiveFarmId, getActiveWorkspaceScope, getStoredUser } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({
  getStoredUser: jest.fn(), getActiveFarmId: jest.fn(), getActiveCompanyId: jest.fn(), getActiveWorkspaceScope: jest.fn(),
}));

const get = api.get as jest.Mock;
const farms = [
  { farmId: 'farm-lex', code: 'LEX100', name: 'Lionshead Ext', companyId: 'co-1', companyName: 'Triple C' },
  { farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co-1', companyName: 'Triple C' },
];

beforeEach(() => {
  jest.clearAllMocks();
  resetFeedFarmCache();
  localStorage.clear();
  (getStoredUser as jest.Mock).mockReturnValue({ userId: 'u-admin', userType: 'TENANT_ADMIN' });
  (getActiveFarmId as jest.Mock).mockReturnValue(null);
  (getActiveCompanyId as jest.Mock).mockReturnValue(null);
  (getActiveWorkspaceScope as jest.Mock).mockReturnValue('TENANT');
  get.mockResolvedValue({ success: true, data: farms });
});

describe('useFeedFarm (A3, A4, A5, D13)', () => {
  it('fixes a STANDARD_USER to their own farm and never fetches', () => {
    (getStoredUser as jest.Mock).mockReturnValue({ userType: 'STANDARD_USER', farmId: 'farm-vil', farm: { location_code: 'VIL100', location_name: 'Villa Franca' } });
    const { result } = renderHook(() => useFeedFarm());
    expect(result.current).toMatchObject({ isFixed: true, farmId: 'farm-vil', loaded: true, fixedFarm: { location_code: 'VIL100', location_name: 'Villa Franca' } });
    expect(get).not.toHaveBeenCalled();
  });

  it('asks for the farm list once however many screens mount (A3)', async () => {
    const a = renderHook(() => useFeedFarm());
    const b = renderHook(() => useFeedFarm());
    await waitFor(() => expect(a.result.current.farms).toEqual(farms));
    await waitFor(() => expect(b.result.current.farms).toEqual(farms));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/feed-forecast/farms');
  });

  it('starts on the first farm by code when nothing is stored or pinned (S2)', async () => {
    const { result } = renderHook(() => useFeedFarm());
    await waitFor(() => expect(result.current.farmId).toBe('farm-lex'));
  });

  it('keeps a chosen farm for the next feed screen (A4)', async () => {
    const first = renderHook(() => useFeedFarm());
    await waitFor(() => expect(first.result.current.loaded).toBe(true));
    act(() => first.result.current.setFarmId('farm-vil'));
    expect(localStorage.getItem(FEED_FARM_STORAGE_KEY)).toBe('farm-vil');
    const next = renderHook(() => useFeedFarm());
    await waitFor(() => expect(next.result.current.loaded).toBe(true));
    expect(next.result.current.farmId).toBe('farm-vil');
  });

  it('prefers the pinned farm over the first when nothing is stored, and drops a stored farm no longer offered', async () => {
    (getActiveFarmId as jest.Mock).mockReturnValue('farm-vil');
    const pinned = renderHook(() => useFeedFarm());
    await waitFor(() => expect(pinned.result.current.farmId).toBe('farm-vil'));
    localStorage.setItem(FEED_FARM_STORAGE_KEY, 'farm-gone');
    (getActiveFarmId as jest.Mock).mockReturnValue(null);
    const stale = renderHook(() => useFeedFarm());
    await waitFor(() => expect(stale.result.current.loaded).toBe(true));
    expect(stale.result.current.farmId).toBe('farm-lex');
  });

  it('asks again after a failed read, and reads a non-array body as no farms', async () => {
    get.mockRejectedValueOnce(new Error('network'));
    const failed = renderHook(() => useFeedFarm());
    await waitFor(() => expect(failed.result.current.failed).toBe(true));
    expect(failed.result.current.farmId).toBeNull();
    get.mockResolvedValueOnce({ data: { error: 'proxy timeout' } });
    const retry = renderHook(() => useFeedFarm());
    await waitFor(() => expect(retry.result.current.loaded).toBe(true));
    expect(get).toHaveBeenCalledTimes(2);
    expect(retry.result.current.farms).toEqual([]);
  });

  it('retries a failed read on request, and clears the failure (Plan S follow-up)', async () => {
    get.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useFeedFarm());
    await waitFor(() => expect(result.current.failed).toBe(true));
    get.mockResolvedValueOnce({ success: true, data: farms });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.farms).toEqual(farms));
    expect(result.current.failed).toBe(false);
    expect(result.current.farmId).toBe('farm-lex');
  });

  it('asks again when the workspace changes', async () => {
    const a = renderHook(() => useFeedFarm());
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    (getActiveWorkspaceScope as jest.Mock).mockReturnValue('COMPANY');
    (getActiveCompanyId as jest.Mock).mockReturnValue('co-1');
    const b = renderHook(() => useFeedFarm());
    await waitFor(() => expect(b.result.current.loaded).toBe(true));
    expect(get).toHaveBeenCalledTimes(2);
  });
});
