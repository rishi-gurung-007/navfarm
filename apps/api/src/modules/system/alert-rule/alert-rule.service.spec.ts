import { ConflictException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { AlertRuleService } from './alert-rule.service';

/** "Only one low feed event applies per silo" (Master Setup §4 row 45). */
describe('AlertRuleService', () => {
  let capturedWhere: unknown;
  const renderedWhere = () => new MySqlDialect().sqlToQuery(capturedWhere as any).sql;
  const selectQueue: unknown[][] = [];
  const chain = (rows: unknown[]) => {
    const self: any = {
      from: () => self,
      where: (cond: unknown) => { capturedWhere = cond; return self; },
      orderBy: () => self, offset: () => self, limit: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    };
    return self;
  };
  const db = { select: jest.fn(() => chain(selectQueue.shift() ?? [])), insert: jest.fn() };
  const service = new AlertRuleService(transactionCls(db), { log: jest.fn() } as any);

  beforeEach(() => {
    selectQueue.length = 0;
    capturedWhere = undefined;
    (db.select as jest.Mock).mockClear();
    (db.insert as jest.Mock).mockReset();
  });

  it('refuses a second active FEED_BELOW_L1 rule for the same company and farm filter', async () => {
    selectQueue.push([{ rule_id: 'existing', notification_code: 'FEED-BELOW-L1' }]); // the clash lookup
    await expect(service.create({
      company_id: 'co-1', notification_code: 'FEED-LOW-2', notification_name: 'Second low rule',
      event_type: 'FEED_BELOW_L1', trigger_entity: 'SILO', threshold_reference: 'SILO_BELOW', priority_level: 'CRITICAL_FIRST_PRIORITY',
      recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE',
    } as any, 'tenant-1', { userId: 'u' })).rejects.toThrow(ConflictException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  // Fix round 1: the clash lookup was asymmetric — a company-wide rule
  // (farm_id null) only ever checked other farm_id-IS-NULL rows, so it missed
  // an already-active farm-specific rule it would also cover. These inspect
  // the actual WHERE built (a mocked query returns whatever it's told
  // regardless of the predicate, so only the rendered SQL proves the fix).
  describe('assertSingleLowRule — row 45 clash lookup shape', () => {
    it('restricts a farm-specific rule to the same farm or a company-wide rule (unchanged direction)', async () => {
      selectQueue.push([]);
      await (service as any).assertSingleLowRule({ event_type: 'FEED_BELOW_L1', company_id: 'co-1', farm_id: 'farm-1', is_active: true }, 'tenant-1');
      const rendered = renderedWhere();
      expect(rendered).toContain('`farm_id` = ?');
      expect(rendered.toLowerCase()).toContain('is null');
    });

    it('does not filter by farm at all for a company-wide rule, so it clashes with any farm of the company', async () => {
      selectQueue.push([]);
      await (service as any).assertSingleLowRule({ event_type: 'FEED_BELOW_L1', company_id: 'co-1', farm_id: null, is_active: true }, 'tenant-1');
      expect(renderedWhere()).not.toContain('farm_id');
    });

    it('a company-wide rule clashes when a farm-specific rule of the company already exists', async () => {
      selectQueue.push([{ rule_id: 'existing-farm', notification_code: 'FEED-BELOW-L1' }]);
      await expect((service as any).assertSingleLowRule({ event_type: 'FEED_BELOW_L1', company_id: 'co-1', farm_id: null, is_active: true }, 'tenant-1'))
        .rejects.toThrow(ConflictException);
    });

    it('a farm-specific rule clashes when a company-wide rule of the company already exists (unchanged direction)', async () => {
      selectQueue.push([{ rule_id: 'existing-wide', notification_code: 'FEED-BELOW-L1' }]);
      await expect((service as any).assertSingleLowRule({ event_type: 'FEED_BELOW_L1', company_id: 'co-1', farm_id: 'farm-1', is_active: true }, 'tenant-1'))
        .rejects.toThrow(ConflictException);
    });

    // Final review minor 1: a tenant-wide rule (company_id NULL) applies to
    // every company's silos, so it and any company's low rule are one event.
    const rendered = () => new MySqlDialect().sqlToQuery(capturedWhere as any);

    it('a tenant-wide rule clashes with any active low rule of the tenant — no company or farm bound', async () => {
      for (const farm_id of [null, 'farm-1']) {
        selectQueue.push([]);
        await (service as any).assertSingleLowRule({ event_type: 'FEED_BELOW_L1', company_id: null, farm_id, is_active: true }, 'tenant-1');
        const q = rendered();
        expect(q.sql).not.toContain('company_id');
        expect(q.sql).not.toContain('farm_id');
        expect(q.params).toEqual(expect.arrayContaining(['tenant-1', 'FEED_BELOW_L1']));
      }
      selectQueue.push([{ rule_id: 'co-rule', notification_code: 'FEED-BELOW-L1' }]);
      await expect((service as any).assertSingleLowRule({ event_type: 'FEED_BELOW_L1', company_id: null, farm_id: null, is_active: true }, 'tenant-1'))
        .rejects.toThrow(ConflictException);
    });

    it('a company rule also clashes with an active tenant-wide rule, whatever its farm filter', async () => {
      for (const farm_id of [null, 'farm-1']) {
        selectQueue.push([]);
        await (service as any).assertSingleLowRule({ event_type: 'FEED_BELOW_L1', company_id: 'co-1', farm_id, is_active: true }, 'tenant-1');
        const q = rendered();
        // (own company [and farm filter]) OR tenant-wide
        expect(q.sql).toContain('or `alert_rule`.`company_id` is null)');
        if (farm_id) expect(q.sql).toContain('`alert_rule`.`farm_id` = ?');
        expect(q.params).toContain('co-1');
      }
      selectQueue.push([{ rule_id: 'tenant-rule', notification_code: 'FEED-BELOW-L1' }]);
      await expect((service as any).assertSingleLowRule({ event_type: 'FEED_BELOW_L1', company_id: 'co-1', farm_id: 'farm-1', is_active: true }, 'tenant-1'))
        .rejects.toThrow(ConflictException);
    });

    it('excludes the rule being edited from its own clash check', async () => {
      selectQueue.push([]);
      await (service as any).assertSingleLowRule({ event_type: 'FEED_BELOW_L1', company_id: 'co-1', farm_id: null, is_active: true }, 'tenant-1', 'rule-1');
      expect(renderedWhere()).toContain('<>');
    });
  });

  // M8, fix round 1: ensureDefaultRules' select-then-insert is not itself
  // atomic, so a concurrent duplicate insert must be a no-op rather than an
  // unhandled ER_DUP_ENTRY.
  describe('ensureDefaultRules — idempotent under concurrency', () => {
    it('inserts nothing when all five default rules are already present', async () => {
      selectQueue.push([
        { code: 'FEED-BELOW-L1' }, { code: 'FEED-ABOVE' }, { code: 'DIET-CHANGE' }, { code: 'REQ-REMINDER' }, { code: 'REQ-OVERDUE' },
      ]);
      await service.ensureDefaultRules('co-1', 'tenant-1');
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('inserts only the codes missing for this company, with an ON DUPLICATE KEY UPDATE guard', async () => {
      selectQueue.push([{ code: 'FEED-BELOW-L1' }, { code: 'FEED-ABOVE' }]);
      const onDuplicateKeyUpdate = jest.fn().mockResolvedValue({});
      const values = jest.fn().mockReturnValue({ onDuplicateKeyUpdate });
      (db.insert as jest.Mock).mockReturnValueOnce({ values });
      await service.ensureDefaultRules('co-1', 'tenant-1');
      const inserted = values.mock.calls[0][0];
      expect(inserted).toHaveLength(3);
      expect(inserted.map((row: any) => row.notification_code).sort()).toEqual(['DIET-CHANGE', 'REQ-OVERDUE', 'REQ-REMINDER']);
      expect(onDuplicateKeyUpdate).toHaveBeenCalledWith(expect.objectContaining({ set: expect.any(Object) }));
    });

    it('keeps two companies isolated — one company missing rows never inserts into the other', async () => {
      selectQueue.push([]); // company A has none
      const valuesA = jest.fn().mockReturnValue({ onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}) });
      (db.insert as jest.Mock).mockReturnValueOnce({ values: valuesA });
      await service.ensureDefaultRules('co-A', 'tenant-1');
      expect(valuesA.mock.calls[0][0]).toHaveLength(5);
      expect(valuesA.mock.calls[0][0].every((row: any) => row.company_id === 'co-A')).toBe(true);

      selectQueue.push([
        { code: 'FEED-BELOW-L1' }, { code: 'FEED-ABOVE' }, { code: 'DIET-CHANGE' }, { code: 'REQ-REMINDER' }, { code: 'REQ-OVERDUE' },
      ]); // company B already has all five
      await service.ensureDefaultRules('co-B', 'tenant-1');
      expect(db.insert).toHaveBeenCalledTimes(1); // only company A's insert ever happened
    });
  });
});
