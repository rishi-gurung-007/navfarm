/**
 * Every NAVFarm database carries the `nf_` prefix: `nf_master`, `nf_system`,
 * and `nf_<tenant code>` for each tenant (Rishi, 2026-09-24).
 *
 * The test RDP server's MySQL is shared with another application, and the old
 * names — `navfarm_master`, `tenant_system`, `tenant_<code>` — said nothing
 * about whose they were; `tenant_` in particular is a prefix any multi-tenant
 * app might reach for. One prefix makes NAVFarm's databases recognisable at a
 * glance and gives the rebuild a pattern it can drop without touching anyone
 * else's.
 *
 * Lowercase deliberately. MySQL on Windows stores database names lowercased by
 * default and on Linux keeps them as written, so an uppercase `NF_` would read
 * differently depending on which server it landed on.
 *
 * The system tenant's code is `system`, so `nf_system` is simply that tenant's
 * `nf_<code>`. The master database is not a tenant, which is why `master` is
 * reserved: a tenant signed up with that code would be handed `nf_master`.
 */
export const NAVFARM_DB_PREFIX = 'nf_';
export const DEFAULT_MASTER_DATABASE = `${NAVFARM_DB_PREFIX}master`;
export const DEFAULT_SYSTEM_DATABASE = `${NAVFARM_DB_PREFIX}system`;

/** Tenant codes whose database name would collide with a non-tenant database. */
export const RESERVED_TENANT_CODES = ['master'];

/** The database a tenant with this code lives in, for a tenant being created now. */
export function tenantDatabaseName(tenantCode: string): string {
  return `${NAVFARM_DB_PREFIX}${tenantCode.toLowerCase()}`;
}
