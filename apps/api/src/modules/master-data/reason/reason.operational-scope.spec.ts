import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { ReasonService } from './reason.service';

describe('ReasonService active operational lookup', () => {
  it('limits a reason to the exact company and the farm NOB/LOB or shared classifications', async () => {
    let where: unknown;
    const chain: any = {
      from: () => chain,
      where: (value: unknown) => { where = value; return chain; },
      limit: async () => [{ reason_id: 'reason-1', is_active: true, status: 'ACTIVE', deleted_at: null }],
    };
    const service = new ReasonService(
      transactionCls({ select: jest.fn(() => chain) }),
      {} as any,
      {} as any,
    );

    await expect(service.findActiveForOperationalScope('reason-1', 'tenant-1', {
      companyId: 'company-1', nobId: 'livestock', lobId: 'piggery',
    })).resolves.toMatchObject({ reason_id: 'reason-1' });

    const rendered = new MySqlDialect().sqlToQuery(where as any);
    expect(rendered.sql).toContain('`reason_id` = ?');
    expect(rendered.sql).toContain('`tenant_id` = ?');
    expect(rendered.sql).toContain('`company_id` = ?');
    expect(rendered.sql).toMatch(/`nob_id` = \? or .*`nob_id` is null/);
    expect(rendered.sql).toMatch(/`lob_id` = \? or .*`lob_id` is null/);
    expect(rendered.sql).toContain('`is_active` = ?');
    expect(rendered.sql).toContain('`status` = ?');
    expect(rendered.sql).toContain('`deleted_at` is null');
    expect(rendered.params).toEqual(expect.arrayContaining([
      'reason-1', 'tenant-1', 'company-1', 'livestock', 'piggery', true, 'ACTIVE',
    ]));
  });

  it('rejects a reason that is outside the requested operational scope', async () => {
    const chain: any = { from: () => chain, where: () => chain, limit: async () => [] };
    const service = new ReasonService(
      transactionCls({ select: jest.fn(() => chain) }),
      {} as any,
      {} as any,
    );
    await expect(service.findActiveForOperationalScope('reason-other-company', 'tenant-1', {
      companyId: 'company-1', nobId: 'livestock', lobId: 'piggery',
    })).rejects.toThrow('active Reason Master row');
  });
});
