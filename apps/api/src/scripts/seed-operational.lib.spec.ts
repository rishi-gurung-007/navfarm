import { getTableName } from 'drizzle-orm';
import { MySqlTable } from 'drizzle-orm/mysql-core';
import { is } from 'drizzle-orm';
import * as schema from '../core/database/schema';
import { companyTemplateTables } from '../modules/core/company/copy-master-templates';
import { parseSeedArgs } from './seed-test-masters.lib';
import { planFullCopies, selectTables, unkeyable, userColumns } from './seed-operational.lib';

describe('seed-test-masters --with-operational', () => {
  const all = [...new Set((Object.values(schema) as unknown[]).filter((v) => is(v as any, MySqlTable)))] as any[];
  const sel = selectTables(all, companyTemplateTables);
  const names = (list: any[]) => list.map(getTableName);

  it('parses the new flags', () => {
    const a = parseSeedArgs(['--source-company', 'A', '--tenant', 't', '--company', 'B', '--with-operational', '--as-user', 'x@y.z']);
    expect(a.withOperational).toBe(true);
    expect(a.asUser).toBe('x@y.z');
    expect(parseSeedArgs(['--source-company', 'A', '--tenant', 't', '--company', 'B']).withOperational).toBe(false);
  });

  it('selects operational tables and line tables, never users or company configuration', () => {
    const picked = [...names(sel.masters), ...names(sel.company), ...names(sel.children)];
    for (const t of ['batch_header', 'inventory_ledger', 'journal_header', 'journal_line', 'goods_receipt_line', 'requisition_line']) expect(picked).toContain(t);
    for (const t of ['user_master', 'role_master', 'audit_log', 'company_master', 'company_fiscal', 'user_session', 'country_master']) expect(picked).not.toContain(t);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it('keys every picked table with a UUID primary key or reports why not', () => {
    for (const t of [...sel.masters, ...sel.company, ...sel.children]) expect(unkeyable(t)).toBeUndefined();
  });

  it('replaces *_by columns but not increment_by', () => {
    expect(userColumns(schema.noSeries).get('created_by')).toBe('admin');
    expect(userColumns(schema.noSeries).has('increment_by')).toBe(false);
  });

  it('re-keys a header and its line, keeps history and swaps the user', () => {
    const header = { journal_id: 'h1', tenant_id: 'T0', company_id: 'C0', created_by: '11111111-1111-1111-1111-111111111111', created_at: '2026-01-01 10:00:00' } as any;
    const line = { line_id: 'l1', journal_id: 'h1', tenant_id: 'T0' } as any;
    const plan = planFullCopies([{ table: schema.journalHeader, rows: [header] }, { table: schema.journalLine, rows: [line] }], { tenantId: 'T1', companyId: 'C1', adminUserId: 'ADMIN' });
    const h = plan.copies.find((c) => c.table === schema.journalHeader)!.row;
    const l = plan.copies.find((c) => c.table === schema.journalLine)!.row;
    expect(h.journal_id).not.toBe('h1');
    expect(l.journal_id).toBe(h.journal_id);
    expect(h).toMatchObject({ company_id: 'C1', tenant_id: 'T1', created_by: 'ADMIN', created_at: '2026-01-01 10:00:00' });
    expect(plan.tableOrder.indexOf('journal_header')).toBeLessThan(plan.tableOrder.indexOf('journal_line'));
  });
});
