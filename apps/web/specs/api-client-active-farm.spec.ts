/**
 * The API resolves a farm-bound persona's farm itself from user_master.farm_id and
 * 403s if `x-active-farm-id` names anything else (see resolveFarmScope in
 * apps/api/src/common/farm-scope.ts). The client must never send that header
 * for either farm-bound persona, whatever is stored in `active_farm_id` — and must send
 * it for every other user type that has selected one, exactly like the
 * existing x-active-company-id / x-active-operational-area-id headers.
 */
describe('apiRequest — x-active-farm-id', () => {
  let capturedHeaders: Headers | undefined;

  const loadClient = async () => import('../src/lib/api-client');

  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    capturedHeaders = undefined;
    global.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    (global.fetch as unknown as jest.Mock | undefined)?.mockReset?.();
  });

  it('sends x-active-farm-id for an admin user with an active farm selected', async () => {
    localStorage.setItem('navfarm_access_token', 'token');
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'COMPANY_ADMIN' }));
    localStorage.setItem('active_farm_id', 'farm-1');

    const { api } = await loadClient();
    await api.get('/batch');

    expect(capturedHeaders?.get('x-active-farm-id')).toBe('farm-1');
  });

  it.each(['STANDARD_USER', 'FARM_MANAGER'])('never sends x-active-farm-id for a farm-bound %s, even if one is stored', async (userType) => {
    localStorage.setItem('navfarm_access_token', 'token');
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType, farmId: 'farm-own' }));
    // A stray value should not leak through even though setActiveFarmId()
    // refuses to write one for this user type.
    localStorage.setItem('active_farm_id', 'farm-other');

    const { api } = await loadClient();
    await api.get('/batch');

    expect(capturedHeaders?.has('x-active-farm-id')).toBe(false);
    expect(capturedHeaders?.get('x-workspace-scope')).toBe('OPERATIONAL');
  });

  it('omits x-active-farm-id when no farm is active', async () => {
    localStorage.setItem('navfarm_access_token', 'token');
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'COMPANY_ADMIN' }));

    const { api } = await loadClient();
    await api.get('/batch');

    expect(capturedHeaders?.has('x-active-farm-id')).toBe(false);
  });
});
