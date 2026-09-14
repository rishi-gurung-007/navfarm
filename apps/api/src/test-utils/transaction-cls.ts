import { ClsService } from 'nestjs-cls';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Real CLS propagation; query doubles supply the database operations. */
export function transactionCls(db: object): ClsService {
  const cls = new ClsService(new AsyncLocalStorage());
  const get = cls.get.bind(cls);
  cls.get = ((key?: string) => get(key as any) ?? (key === 'tenantDb' ? db : undefined)) as typeof cls.get;
  if (!('transaction' in db)) Object.assign(db, { transaction: async (work: (tx: object) => Promise<unknown>) => work(db) });
  return cls;
}
