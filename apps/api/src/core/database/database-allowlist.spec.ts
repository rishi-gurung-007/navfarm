import { assertDatabaseAllowed } from './database-allowlist';

/**
 * Runtime isolation guard for UAT. The API resolves a tenant's database name
 * from the master registry (tenant.middleware.ts) and opens a pool with
 * whatever that row says, and database.config.ts defaults to
 * root@localhost with no password. On the Mac development machine that
 * reaches every retained database — nf_devco, nf_master, nf_system, and the
 * unrelated navcrm_* application — so creating a disposable database is no
 * proof the application is using it.
 *
 * NAVFARM_DB_ALLOWLIST is the opt-in: unset, nothing changes and production
 * startup is untouched; set, every database the API opens must be named in
 * it or the connection is refused before a pool exists.
 */
describe('assertDatabaseAllowed', () => {
  it('refuses a database that is not on the allowlist', () => {
    expect(() =>
      assertDatabaseAllowed('nf_devco', 'tenant devco', {
        NAVFARM_DB_ALLOWLIST: 'nf_uat_master,nf_uat_tenant',
      }),
    ).toThrow(
      "Refusing to connect to database 'nf_devco' (tenant devco): not on NAVFARM_DB_ALLOWLIST.",
    );
  });

  it('refuses a registry row whose database name is missing', () => {
    expect(() =>
      assertDatabaseAllowed(undefined as unknown as string, 'tenant with no db_name', {
        NAVFARM_DB_ALLOWLIST: 'nf_uat_tenant',
      }),
    ).toThrow("Refusing to connect to database '' (tenant with no db_name)");
  });

  it('is inactive when the variable is unset, so production startup is unchanged', () => {
    expect(() => assertDatabaseAllowed('nf_portatestnavfarm', 'production tenant', {})).not.toThrow();
  });

  it('fails closed when the variable is set but names nothing', () => {
    expect(() =>
      assertDatabaseAllowed('nf_uat_tenant', 'tenant', { NAVFARM_DB_ALLOWLIST: '  ,  ' }),
    ).toThrow('not on NAVFARM_DB_ALLOWLIST');
  });

  it('allows a database named on the allowlist, ignoring case and spacing', () => {
    expect(() =>
      assertDatabaseAllowed('NF_UAT_Tenant', 'tenant', {
        NAVFARM_DB_ALLOWLIST: ' nf_uat_master , nf_uat_tenant ',
      }),
    ).not.toThrow();
  });
});
