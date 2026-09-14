import { ClsService } from 'nestjs-cls';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';

/** All participating services read tenantDb from CLS. A child context prevents
 * the transaction executor leaking into concurrent work or the parent request.
 * Nested posting services join the outer transaction instead of committing early.
 */
export async function withTenantTransaction<T>(cls: ClsService, work: () => Promise<T>): Promise<T> {
  if (cls.get('tenantPostingTransaction') === true) return work();
  const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
  if (!db) throw new Error('Tenant database connection context not established.');
  return db.transaction(tx => cls.run(async () => {
    cls.set('tenantDb', tx);
    cls.set('tenantPostingTransaction', true);
    return work();
  }));
}
