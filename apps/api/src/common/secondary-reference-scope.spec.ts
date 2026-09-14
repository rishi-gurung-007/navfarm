import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../modules/system/audit-log/audit-log.service';
import { QcService } from '../modules/production/qc/qc.service';
import { QrCodeService } from '../modules/production/qr-code/qr-code.service';

const dialect = new MySqlDialect();
const chain = (rows: unknown[], capture?: (condition: unknown) => void) => ({
  from: () => ({
    where: (condition: unknown) => {
      capture?.(condition);
      return { limit: () => Promise.resolve(rows) };
    },
  }),
});

describe('secondary production reference scope', () => {
  const audit = { log: jest.fn() } as unknown as AuditLogService;

  it('requires an exact batch company for QC parameters while allowing a shared null LOB', async () => {
    let parameterWhere: unknown;
    const db = {
      select: jest.fn()
        .mockReturnValueOnce(chain([{ batch_id: 'batch-1', company_id: 'co-1', lob_id: 'lob-pig' }]))
        .mockReturnValueOnce(chain([], (condition) => { parameterWhere = condition; })),
    };
    const cls = { get: (key: string) => key === 'tenantDb' ? db : undefined } as unknown as ClsService;
    const service = new QcService(cls, audit);

    await expect(service.create({
      company_id: 'co-1', source_batch_id: 'batch-1', qc_date: '2026-09-15',
      total_qty_received: 1, disposition: 'ACCEPT',
      results: [{ param_id: 'param-1', actual_value: '1' }],
    } as any, 'tenant-1')).rejects.toThrow("QC parameter with ID 'param-1' not found.");

    const rendered = dialect.sqlToQuery(parameterWhere as any);
    expect(rendered.sql).toContain('`qc_parameter_master`.`company_id` = ?');
    expect(rendered.sql).not.toContain('`qc_parameter_master`.`company_id` is null');
    expect(rendered.sql).toContain('`qc_parameter_master`.`lob_id` is null');
    expect(rendered.sql).toContain('`qc_parameter_master`.`lob_id` = ?');
    expect(rendered.params).toEqual(expect.arrayContaining(['tenant-1', 'co-1', 'lob-pig']));
  });

  it('does not allow a tenant-scoped item in a company batch QR pack', async () => {
    let itemWhere: unknown;
    const db = {
      select: jest.fn()
        .mockReturnValueOnce(chain([{ batch_id: 'batch-1', company_id: 'co-1', lob_id: 'lob-pig' }]))
        .mockReturnValueOnce(chain([], (condition) => { itemWhere = condition; })),
    };
    const cls = { get: (key: string) => key === 'tenantDb' ? db : undefined } as unknown as ClsService;
    const service = new QrCodeService(cls, audit);

    await expect(service.create({
      company_id: 'co-1', batch_id: 'batch-1', item_id: 'item-1',
    } as any, 'tenant-1')).rejects.toThrow("Item with ID 'item-1' not found.");

    const rendered = dialect.sqlToQuery(itemWhere as any);
    expect(rendered.sql).toContain('`item_master`.`company_id` = ?');
    expect(rendered.sql).not.toContain('`item_master`.`company_id` is null');
    expect(rendered.sql).toContain('`item_master`.`lob_id` is null');
    expect(rendered.sql).toContain('`item_master`.`lob_id` = ?');
    expect(rendered.params).toEqual(expect.arrayContaining(['tenant-1', 'co-1', 'lob-pig']));
  });
});
