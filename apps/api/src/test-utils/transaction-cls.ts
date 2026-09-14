import { ClsService } from 'nestjs-cls';
import { AsyncLocalStorage } from 'node:async_hooks';
import { FARM_SCOPE_KEY, type FarmScope } from '../common/farm-scope';

/** Real CLS propagation; query doubles supply the database operations. */
export function transactionCls(db: object): ClsService {
  const cls = new ClsService(new AsyncLocalStorage());
  const get = cls.get.bind(cls);
  cls.get = ((key?: string) => get(key as any) ?? (key === 'tenantDb' ? db : undefined)) as typeof cls.get;
  if (!('transaction' in db)) Object.assign(db, { transaction: async (work: (tx: object) => Promise<unknown>) => work(db) });
  return cls;
}

/**
 * Wraps a spec's ClsService so 'farmScope' resolves to `scope`, alongside
 * whatever `transactionCls` already answers for 'tenantDb'. Specs call this
 * to exercise a restricted or active-farm request without a real RolesGuard.
 */
export function useFarmScope(cls: ClsService, scope: FarmScope): void {
  const get = cls.get.bind(cls);
  cls.get = ((key?: string) => (key === FARM_SCOPE_KEY ? scope : get(key as any))) as typeof cls.get;
}
