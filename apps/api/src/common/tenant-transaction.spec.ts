import { ClsService } from 'nestjs-cls';
import { AsyncLocalStorage } from 'node:async_hooks';
import { withTenantTransaction } from './tenant-transaction';

describe('tenant posting transaction', () => {
  it('shares one executor across nested services and restores the request after a failure', async () => {
    const cls = new ClsService(new AsyncLocalStorage());
    const tx = { marker: 'transaction' };
    const database = { transaction: jest.fn(async (work) => work(tx)) };
    await cls.run(async () => {
      cls.set('tenantDb', database);
      cls.set('userId', 'request-user');
      await expect(withTenantTransaction(cls, async () => {
        expect(cls.get('tenantDb')).toBe(tx);
        expect(cls.get('userId')).toBe('request-user');
        await withTenantTransaction(cls, async () => {
          expect(cls.get('tenantDb')).toBe(tx);
          throw new Error('journal line failed');
        });
      })).rejects.toThrow('journal line failed');
      expect(cls.get('tenantDb')).toBe(database);
      expect(database.transaction).toHaveBeenCalledTimes(1);
    });
  });
});
