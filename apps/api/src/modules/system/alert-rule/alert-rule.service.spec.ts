import { ConflictException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { AlertRuleService } from './alert-rule.service';

/** "Only one low feed event applies per silo" (Master Setup §4 row 45). */
describe('AlertRuleService', () => {
  const selectQueue: unknown[][] = [];
  const chain = (rows: unknown[]) => {
    const self: any = { from: () => self, where: () => self, orderBy: () => self, offset: () => self, limit: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej) };
    return self;
  };
  const db = { select: jest.fn(() => chain(selectQueue.shift() ?? [])), insert: jest.fn() };
  const service = new AlertRuleService(transactionCls(db), { log: jest.fn() } as any);

  it('refuses a second active FEED_BELOW_L1 rule for the same company and farm filter', async () => {
    selectQueue.push([{ rule_id: 'existing', notification_code: 'FEED-BELOW-L1' }]); // the clash lookup
    await expect(service.create({
      company_id: 'co-1', notification_code: 'FEED-LOW-2', notification_name: 'Second low rule',
      event_type: 'FEED_BELOW_L1', trigger_entity: 'SILO', threshold_reference: 'SILO_BELOW', priority_level: 'CRITICAL_FIRST_PRIORITY',
      recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE',
    } as any, 'tenant-1', { userId: 'u' })).rejects.toThrow(ConflictException);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
