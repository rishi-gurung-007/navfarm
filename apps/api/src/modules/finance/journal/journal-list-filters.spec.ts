/**
 * The Journal opened from a GM Dashboard overhead figure: only journals with one line that is on a listed GL account
 * and on the farm's cost centre (CC-<farm code>), the rule the dashboard adds the overheads up by.
 */
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { JournalService } from './journal.service';
import { QueryJournalDto } from './dto/journal.dto';

const FARM = '7b0c2f4e-1111-4222-8333-944455556666';

describe('JournalService list: farm and overhead accounts', () => {
  const dialect = new MySqlDialect();
  const ROW = { journal_id: 'j-1' };
  let listWhere: unknown;
  let farmWhere: unknown;
  let farmRows: { code: string }[];
  let service: JournalService;

  beforeEach(() => {
    listWhere = undefined;
    farmWhere = undefined;
    farmRows = [{ code: 'FRM-1' }];
    const db = {
      select: () => ({
        from: (table: unknown) => ({
          where: (condition: unknown) => {
            if (table === schema.locationMaster) {
              farmWhere = condition;
              return { limit: async () => farmRows };
            }
            listWhere = condition;
            return { orderBy: () => ({ limit: () => ({ offset: async () => [ROW] }) }) };
          },
        }),
      }),
    };
    const cls = { get: (key: string) => (key === 'tenantDb' ? db : undefined) } as unknown as ClsService;
    service = new JournalService(cls, {} as AuditLogService, {} as NumberSeriesService);
  });

  const where = () => {
    const rendered = dialect.sqlToQuery(listWhere as any);
    return { sql: rendered.sql.replace(/\s+/g, ' '), params: rendered.params };
  };
  const existsCount = (text: string) => (text.match(/\bexists\b/gi) ?? []).length;
  const ACCOUNT_PREDICATE =
    '`journal_line`.`gl_account_id` in (select `gl_account_master`.`gl_account_id` from `gl_account_master` where `gl_account_master`.`account_code` in (?, ?))';
  const FARM_PREDICATE =
    '`journal_line`.`cost_center_id` in (select `cost_center_master`.`cost_center_id` from `cost_center_master` where `cost_center_master`.`cost_center_code` = ?)';
  const LINE_OF_THIS_JOURNAL =
    'exists (select 1 from `journal_line` where `journal_line`.`journal_id` = `journal_header`.`journal_id`';

  it('asks for one line that is on a listed account and on the farm cost centre, keeping the header filters', async () => {
    const result = await service.findAll(
      { accountCodes: '4600,4610', farmId: FARM, companyId: 'co-1', status: 'POSTED', dateFrom: '2026-10-25', dateTo: '2026-11-21' },
      'tenant-1',
    );

    expect(result).toEqual([ROW]);
    const { sql, params } = where();
    expect(existsCount(sql)).toBe(1);
    expect(sql).toContain(`${LINE_OF_THIS_JOURNAL} and ${ACCOUNT_PREDICATE} and ${FARM_PREDICATE})`);
    for (const column of ['tenant_id', 'company_id', 'status']) expect(sql).toContain(`\`journal_header\`.\`${column}\` = ?`);
    expect(sql).toContain('`journal_header`.`deleted_at` is null');
    expect(sql).toContain('`journal_header`.`posting_date` >= ?');
    expect(sql).toContain('`journal_header`.`posting_date` <= ?');
    expect(params).toEqual(['tenant-1', 'co-1', 'POSTED', '2026-10-25', '2026-11-21', '4600', '4610', 'CC-FRM-1']);
    // The farm is looked up inside the caller's tenant only.
    const lookup = dialect.sqlToQuery(farmWhere as any);
    expect(lookup.sql).toContain('`location_master`.`tenant_id` = ?');
    expect(lookup.params).toEqual(expect.arrayContaining(['tenant-1', FARM]));
  });

  it('filters by the accounts alone', async () => {
    await service.findAll({ accountCodes: '4600,4610' }, 'tenant-1');

    const { sql } = where();
    expect(existsCount(sql)).toBe(1);
    expect(sql).toContain(`${LINE_OF_THIS_JOURNAL} and ${ACCOUNT_PREDICATE})`);
    expect(sql).not.toContain('cost_center');
    expect(farmWhere).toBeUndefined();
  });

  it('filters by the farm alone', async () => {
    await service.findAll({ farmId: FARM }, 'tenant-1');

    const { sql, params } = where();
    expect(existsCount(sql)).toBe(1);
    expect(sql).toContain(`${LINE_OF_THIS_JOURNAL} and ${FARM_PREDICATE})`);
    expect(sql).not.toContain('gl_account');
    expect(params).toContain('CC-FRM-1');
  });

  it('does not look at the lines when neither is given', async () => {
    await service.findAll({ status: 'POSTED' }, 'tenant-1');

    expect(existsCount(where().sql)).toBe(0);
    expect(where().sql).not.toContain('journal_line');
    expect(farmWhere).toBeUndefined();
  });

  it('returns nothing, not everything, for a farm it does not know', async () => {
    farmRows = [];

    await expect(service.findAll({ farmId: FARM }, 'tenant-1')).resolves.toEqual([]);
    expect(listWhere).toBeUndefined();
  });

  it('still refuses a bad date range when the farm is unknown', async () => {
    farmRows = [];

    await expect(
      service.findAll({ farmId: FARM, dateFrom: '2026-11-21', dateTo: '2026-10-25' }, 'tenant-1'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('QueryJournalDto: farm and overhead accounts', () => {
  // As main.ts sets it up.
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const check = (query: Record<string, unknown>) => pipe.transform(query, { type: 'query', metatype: QueryJournalDto });

  it('accepts one account code or a comma list, and a farm UUID', async () => {
    await expect(check({ accountCodes: '4600', farmId: FARM })).resolves.toMatchObject({ accountCodes: '4600', farmId: FARM });
    await expect(check({ accountCodes: '4600,4610' })).resolves.toMatchObject({ accountCodes: '4600,4610' });
  });

  it.each(['46', '12345678901', '4600,', '4600, 4610', 'abc', "4600') or 1=1 --"])('rejects account codes %j', async (accountCodes) => {
    await expect(check({ accountCodes })).rejects.toThrow(BadRequestException);
  });

  it('rejects a farm that is not a UUID', async () => {
    await expect(check({ farmId: 'f1' })).rejects.toThrow(BadRequestException);
  });
});
