/**
 * A dead session used to leave the user sitting on a signed-in page whose every
 * request 401s — the dashboard rendered zeroes instead of sending them to login.
 * These guard that the client signs the user out and navigates.
 */
describe('apiRequest — dead session handling', () => {
  // jsdom's Location is read-only and refuses to navigate, so the client's own
  // navigation hook is what gets stubbed here.
  const replace = jest.fn();

  const loadClient = async () => {
    const mod = await import('../src/lib/api-client');
    mod.sessionNavigation.toLogin = () => replace('/login');
    return mod;
  };

  beforeEach(() => {
    jest.resetModules();
    replace.mockReset();
    localStorage.clear();
    window.history.replaceState({}, '', '/dashboard');
  });

  afterEach(() => {
    (global.fetch as unknown as jest.Mock | undefined)?.mockReset?.();
  });

  const seedSession = () => {
    localStorage.setItem('navfarm_access_token', 'stale-access');
    localStorage.setItem('navfarm_refresh_token', 'stale-refresh');
    localStorage.setItem('navfarm_tenant_id', 'tenant-1');
    localStorage.setItem('active_company_id', 'company-1');
  };

  it('signs out and navigates to login when the refresh token is rejected', async () => {
    seedSession();
    global.fetch = jest.fn(async (url: unknown) => {
      const href = String(url);
      if (href.endsWith('/auth/refresh')) {
        return { ok: false, status: 400, json: async () => ({ message: 'Invalid refresh token' }) } as Response;
      }
      if (href.endsWith('/auth/logout')) {
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }
      return { ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) } as Response;
    }) as unknown as typeof fetch;

    const { api } = await loadClient();
    await expect(api.get('/batch')).rejects.toThrow();

    expect(replace).toHaveBeenCalledWith('/login');
    expect(localStorage.getItem('navfarm_access_token')).toBeNull();
    expect(localStorage.getItem('active_company_id')).toBeNull();
  });

  it('signs out and navigates to login when a 401 arrives with no refresh token stored', async () => {
    localStorage.setItem('navfarm_access_token', 'stale-access');
    global.fetch = jest.fn(async () =>
      ({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) }) as Response
    ) as unknown as typeof fetch;

    const { api } = await loadClient();
    await expect(api.get('/batch')).rejects.toThrow();

    expect(replace).toHaveBeenCalledWith('/login');
    expect(localStorage.getItem('navfarm_access_token')).toBeNull();
  });

  it('does not bounce a user who is already on the login page', async () => {
    window.history.replaceState({}, '', '/login');
    localStorage.setItem('navfarm_access_token', 'stale-access');
    global.fetch = jest.fn(async () =>
      ({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) }) as Response
    ) as unknown as typeof fetch;

    const { api } = await loadClient();
    await expect(api.get('/batch')).rejects.toThrow();

    expect(replace).not.toHaveBeenCalled();
  });
});

describe('restoring the navigation cookie', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'navfarm_session=; path=/; max-age=0';
  });

  it('restores the presence hint when stored credentials survive cookie expiry', async () => {
    localStorage.setItem('navfarm_access_token', 'stored-token');
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'COMPANY_ADMIN' }));
    const { restoreSessionCookie } = await import('../src/lib/api-client');
    expect(restoreSessionCookie()).toBe(true);
    expect(document.cookie).toContain('navfarm_session=1');
  });

  it('does not restore a signed-out or incomplete session', async () => {
    localStorage.setItem('navfarm_auth_user', '{}');
    const { restoreSessionCookie } = await import('../src/lib/api-client');
    expect(restoreSessionCookie()).toBe(false);
    expect(document.cookie).not.toContain('navfarm_session=1');
  });
});
