import { renderHook, waitFor } from '@testing-library/react';
import { useFeedFarm } from '../src/components/console/inventory/use-feed-farm';
import { api } from '../src/services/api-client';
import { getStoredUser, getActiveFarmId } from '../src/hooks/useAuth';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({ getStoredUser: jest.fn(), getActiveFarmId: jest.fn() }));

const get = api.get as jest.Mock;

describe('useFeedFarm — D13', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fixes a STANDARD_USER to their own farm and never fetches the farm list", async () => {
    (getStoredUser as jest.Mock).mockReturnValue({ userType: 'STANDARD_USER', farmId: 'farm-grs', farm: { location_code: 'GRS', location_name: 'Grasmere' } });
    (getActiveFarmId as jest.Mock).mockReturnValue(null);

    const { result } = renderHook(() => useFeedFarm());

    expect(result.current.isFixed).toBe(true);
    expect(result.current.farmId).toBe('farm-grs');
    expect(result.current.fixedFarm).toEqual({ location_code: 'GRS', location_name: 'Grasmere' });
    expect(result.current.farms).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('loads the farm list for a non-STANDARD user and defaults to the pinned farm', async () => {
    (getStoredUser as jest.Mock).mockReturnValue({ userType: 'COMPANY_ADMIN' });
    (getActiveFarmId as jest.Mock).mockReturnValue('farm-2');
    const farms = [
      { location_id: 'farm-1', location_code: 'GRS', location_name: 'Grasmere' },
      { location_id: 'farm-2', location_code: 'WLM', location_name: 'Wollam' },
    ];
    get.mockResolvedValue({ data: farms });

    const { result } = renderHook(() => useFeedFarm());

    await waitFor(() => expect(get).toHaveBeenCalledWith('/location?locationType=FARM&rootOnly=true&isActive=true'));
    await waitFor(() => expect(result.current.farms).toEqual(farms));
    expect(result.current.isFixed).toBe(false);
    expect(result.current.farmId).toBe('farm-2'); // the pinned farm, not the list's first entry
    expect(result.current.fixedFarm).toBeNull();
  });

  it('falls back to the first farm in the list when no farm is pinned', async () => {
    (getStoredUser as jest.Mock).mockReturnValue({ userType: 'TENANT_ADMIN' });
    (getActiveFarmId as jest.Mock).mockReturnValue(null);
    const farms = [
      { location_id: 'farm-1', location_code: 'GRS', location_name: 'Grasmere' },
      { location_id: 'farm-2', location_code: 'WLM', location_name: 'Wollam' },
    ];
    get.mockResolvedValue({ data: farms });

    const { result } = renderHook(() => useFeedFarm());

    await waitFor(() => expect(result.current.farmId).toBe('farm-1'));
  });
});
