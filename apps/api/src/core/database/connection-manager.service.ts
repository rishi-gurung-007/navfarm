import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, MySql2Database } from 'drizzle-orm/mysql2';
import * as mysql from 'mysql2/promise';
import * as schema from './schema';
import { assertDatabaseAllowed } from './database-allowlist';

@Injectable()
export class ConnectionManagerService implements OnModuleDestroy {
  private tenantConnections = new Map<string, MySql2Database<typeof schema>>();
  private pools = new Map<string, mysql.Pool>();

  async getTenantConnection(tenant: {
    tenant_id: string;
    db_host: string;
    db_port: number;
    db_name: string;
    db_user: string;
    db_password?: string;
  }): Promise<MySql2Database<typeof schema>> {
    // Checked ahead of the cache so an entry created before the allowlist was
    // in force cannot hand back a connection to a database it now forbids.
    assertDatabaseAllowed(tenant.db_name, `tenant ${tenant.tenant_id}`);

    const cacheKey = tenant.tenant_id;
    if (this.tenantConnections.has(cacheKey)) {
      return this.tenantConnections.get(cacheKey)!;
    }

    // Same physical DB host as the master connection for now, so it shares
    // the master's TLS requirement (TiDB Cloud etc.) rather than needing a
    // per-tenant ssl flag in the tenant registry.
    const ssl = process.env.DATABASE_SSL === 'true';

    const pool = mysql.createPool({
      host: tenant.db_host,
      port: tenant.db_port,
      user: tenant.db_user,
      password: tenant.db_password || '',
      database: tenant.db_name,
      connectionLimit: 10,
      waitForConnections: true,
      queueLimit: 0,
      ...(ssl ? { ssl: { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } } : {}),
    });

    const db = drizzle(pool, { schema, mode: 'default' });

    this.pools.set(cacheKey, pool);
    this.tenantConnections.set(cacheKey, db);

    return db;
  }

  async onModuleDestroy() {
    for (const [key, pool] of this.pools.entries()) {
      try {
        await pool.end();
      } catch (err) {
        console.error(`Error closing pool for tenant ${key}:`, err);
      }
    }
    this.pools.clear();
    this.tenantConnections.clear();
  }
}
