import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../test-utils/transaction-cls';
import * as schema from '../core/database/schema';
import { AlertService } from '../modules/production/alert/alert.service';
import { MilkService } from '../modules/production/milk/milk.service';
import { QcService } from '../modules/production/qc/qc.service';
import { QrCodeService } from '../modules/production/qr-code/qr-code.service';

const dialect = new MySqlDialect();
const operationalAdmin = { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' };

function harness(initial: Array<[unknown, unknown[]]> = []) {
  const rows = new Map<unknown, unknown[]>(initial);
  const conditions = new Map<unknown, unknown[]>();
  const capture = (table: unknown, condition: unknown) => {
    const found = conditions.get(table) ?? [];
    found.push(condition);
    conditions.set(table, found);
  };
  const chain = (table: unknown) => {
    const self: any = {
      leftJoin: () => self,
      innerJoin: () => self,
      where: (condition: unknown) => { capture(table, condition); return self; },
      orderBy: () => self,
      limit: () => self,
      offset: () => self,
      for: () => self,
      then: (ok: any, err: any) => Promise.resolve(rows.get(table) ?? []).then(ok, err),
    };
    return self;
  };
  const db: any = {
    select: () => ({ from: (table: unknown) => chain(table) }),
    insert: () => ({ values: async () => undefined }),
    update: (table: unknown) => ({
      set: () => ({ where: (condition: unknown) => { capture(table, condition); return Promise.resolve(); } }),
    }),
  };
  const cls = transactionCls(db);
  useFarmScope(cls, operationalAdmin);
  const sqlFor = (table: unknown, occurrence = 0) => dialect.sqlToQuery(conditions.get(table)![occurrence] as any).sql;
  return { cls, sqlFor };
}

const audit = { log: jest.fn().mockResolvedValue({}) } as any;

describe('farm scope on previously exempt operational services', () => {
  it('bounds alert lists and mark-read authorization through their batch', async () => {
    const list = harness();
    await new AlertService(list.cls).findAll({} as any, 'tenant-1');
    expect(list.sqlFor(schema.notificationAlertLog)).toContain('FROM batch_header br');

    const write = harness([[schema.notificationAlertLog, [{ alert_id: 'alert-1', company_id: 'co-1', batch_id: 'batch-1' }]]]);
    await new AlertService(write.cls).markRead('alert-1', 'co-1', { userId: 'u-1' });
    expect(write.sqlFor(schema.notificationAlertLog)).toContain('FROM batch_header br');
  });

  it('bounds milk lists through their batch', async () => {
    const test = harness();
    await new MilkService(test.cls, audit).findAll({} as any, 'tenant-1');
    expect(test.sqlFor(schema.milkProductionLog)).toContain('FROM batch_header br');
  });

  it('checks milk writes against the scoped batch before recording', async () => {
    const test = harness([[schema.batchHeader, []]]);
    await expect(new MilkService(test.cls, audit).record({ batch_id: 'batch-1' } as any, 'tenant-1')).rejects.toThrow('Batch not found.');
    const sql = test.sqlFor(schema.batchHeader);
    expect(sql).toContain('`batch_header`.`lob_id` = ?');
    expect(sql).toContain('`batch_header`.`company_id` = ?');
  });

  it('bounds QC lists through their source batch', async () => {
    const test = harness();
    await new QcService(test.cls, audit).findAll({} as any, 'tenant-1');
    expect(test.sqlFor(schema.qcBatchDetail)).toContain('FROM batch_header br');
  });

  it('checks QC writes against the scoped source batch before recording', async () => {
    const test = harness([[schema.batchHeader, []]]);
    await expect(new QcService(test.cls, audit).create({ source_batch_id: 'batch-1' } as any, 'tenant-1')).rejects.toThrow('not found');
    const sql = test.sqlFor(schema.batchHeader);
    expect(sql).toContain('`batch_header`.`lob_id` = ?');
    expect(sql).toContain('`batch_header`.`company_id` = ?');
  });

  it('bounds QR pack lists through their batch', async () => {
    const test = harness();
    await new QrCodeService(test.cls, audit).findAll({} as any, 'tenant-1');
    expect(test.sqlFor(schema.qrCodeMaster)).toContain('FROM batch_header br');
  });

  it('checks QR writes against the scoped batch before generating a pack', async () => {
    const test = harness([
      [schema.itemMaster, [{ item_id: 'item-1', item_code: 'ITEM-1', is_qr_enabled: true }]],
      [schema.batchHeader, []],
    ]);
    await expect(new QrCodeService(test.cls, audit).create({ item_id: 'item-1', batch_id: 'batch-1' } as any, 'tenant-1')).rejects.toThrow('not found');
    const sql = test.sqlFor(schema.batchHeader);
    expect(sql).toContain('`batch_header`.`lob_id` = ?');
    expect(sql).toContain('`batch_header`.`company_id` = ?');
  });
});
