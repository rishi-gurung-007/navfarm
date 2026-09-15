/**
 * A STANDARD_USER is bound to exactly one farm (user_master.farm_id, decided
 * 2026-09-14/15) — never a switch. getActiveFarmId() must always answer with
 * that user's own farm regardless of what is stored, and setActiveFarmId()
 * must be a no-op for them so a stray write (or a leftover value from an
 * earlier admin session on the same browser) can never surface as a header
 * the API would reject with "Not authorized for this farm."
 */
describe('useAuth — active farm', () => {
  const loadHook = async () => import('../src/hooks/useAuth');

  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
  });

  it("a standard user's active farm is always their own, ignoring any stored value", async () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'STANDARD_USER', farmId: 'farm-own' }));
    localStorage.setItem('active_farm_id', 'farm-other');

    const { getActiveFarmId } = await loadHook();
    expect(getActiveFarmId()).toBe('farm-own');
  });

  it('setActiveFarmId is a no-op for a standard user', async () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'STANDARD_USER', farmId: 'farm-own' }));

    const { setActiveFarmId, getActiveFarmId } = await loadHook();
    setActiveFarmId('farm-other');

    expect(localStorage.getItem('active_farm_id')).toBeNull();
    expect(getActiveFarmId()).toBe('farm-own');
  });

  it('an admin can select and clear an active farm', async () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'COMPANY_ADMIN' }));

    const { setActiveFarmId, getActiveFarmId } = await loadHook();
    expect(getActiveFarmId()).toBeNull();

    setActiveFarmId('farm-1');
    expect(getActiveFarmId()).toBe('farm-1');

    setActiveFarmId(null);
    expect(getActiveFarmId()).toBeNull();
  });
});
