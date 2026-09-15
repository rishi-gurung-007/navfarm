import { assertSafeRebuildTarget, parseRebuildArgs } from './rebuild-guards';

describe('rebuild guards', () => {
  const local = { DATABASE_HOST: '127.0.0.1' };

  it('allows the local NAVFarm databases', () => {
    expect(() => assertSafeRebuildTarget(local, ['navfarm_master', 'tenant_system', 'tenant_devco'])).not.toThrow();
  });

  it('refuses a remote host', () => {
    expect(() => assertSafeRebuildTarget({ DATABASE_HOST: 'gateway01.tidbcloud.com' }, ['tenant_devco']))
      .toThrow('Demo rebuild only runs against a local MySQL');
  });

  it('refuses any NavCRM database', () => {
    expect(() => assertSafeRebuildTarget(local, ['tenant_devco', 'navcrm_tenant_dev']))
      .toThrow('Refusing to drop navcrm_tenant_dev');
  });

  it('refuses a database outside the NAVFarm naming', () => {
    expect(() => assertSafeRebuildTarget(local, ['mysql'])).toThrow('Refusing to drop mysql');
  });

  it('is read-only unless --apply is passed', () => {
    expect(parseRebuildArgs([])).toEqual({ apply: false, chaptersOnly: false, skipReset: false });
    expect(parseRebuildArgs(['--apply', '--skip-reset'])).toEqual({ apply: true, chaptersOnly: false, skipReset: true });
  });

  // Added in fix round 1: a name that matches the NAVFarm regex (tenant_[a-z0-9_]+)
  // AND contains "navcrm" isolates the `.includes('navcrm')` branch from the
  // regex-mismatch branch above it — "refuses a database outside the NAVFarm
  // naming" only proves a name failing BOTH checks is rejected; this proves the
  // navcrm substring check still fires even when the regex alone would have let
  // the name through.
  it('refuses a NavCRM database even if it happens to match the NAVFarm naming shape', () => {
    expect(() => assertSafeRebuildTarget(local, ['tenant_navcrm_x'])).toThrow('Refusing to drop tenant_navcrm_x');
  });
});
