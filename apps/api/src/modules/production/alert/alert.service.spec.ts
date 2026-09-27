import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { AlertService } from './alert.service';

/** D24: the Alerts page filters batch alerts by farm, and shows each alert's batch. */
describe('AlertService.findAll — farm filter (D24)', () => {
  it('limits batch alerts to the batches of one farm when a farm is named', async () => {
    let where: unknown;
    const chain: any = {
      from: () => chain, leftJoin: () => chain,
      where: (w: unknown) => { where = w; return chain; },
      orderBy: () => chain, limit: () => chain, offset: async () => [],
    };
    const db = { select: jest.fn(() => chain) };
    await new AlertService(transactionCls(db)).findAll({ farmId: 'farm-vil' } as any, 'tenant-1');
    const q = new MySqlDialect().sqlToQuery(where as any);
    expect(q.sql).toContain('IN (SELECT bf.batch_id FROM batch_header bf WHERE bf.farm_id = ?)');
    expect(q.params).toContain('farm-vil');
  });
});
