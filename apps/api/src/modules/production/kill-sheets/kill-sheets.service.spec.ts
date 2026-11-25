import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryKillSheetsDto } from './kill-sheets.dto';
import { reconcileKillSheet } from './kill-sheets.service';
import * as XLSX from 'xlsx';
import { KillSheetsService } from './kill-sheets.service';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { FARM_SCOPE_KEY } from '../../../common/farm-scope';

describe('Kill Sheet reconciliation', () => {
  const individual = { records: [{ serial_number: '1', ear_tag: 'E1', grade: null, warm_mass_kg: '10', cold_mass_kg: '9', sex: null, fat_mm: null, meat_mm: null, meat_percentage: null, sick_code: null, slaughtered_at: null }], issues: [], metadata: {}, expected: { animal_count: '1', warm_mass_kg: '10', cold_mass_kg: '9' } };
  it('keeps a cross-report discrepancy as a warning rather than changing source values', () => {
    const summary = { records: [{ category: 'A', product_code: 'P1', description: 'Product', quantity: '1', warm_mass_kg: '11', cold_mass_kg: '9', average_mass_kg: null, reported_price: '2', reported_value: '22' }], issues: [], metadata: {}, expected: { quantity: '1', warm_mass_kg: '11', cold_mass_kg: '9', value: '22' } };
    const result = reconcileKillSheet(individual, summary);
    expect(result.reconciliation).toBe('WARNING');
    expect(result.actualWarm).toBe(10);
    expect(result.issues.map((issue) => issue.message)).toContain('Summary warm mass differs from individual records by 1 kg.');
  });
  it('makes parser errors non-confirmable', () => {
    const result = reconcileKillSheet({ ...individual, issues: [{ severity: 'ERROR' as const, message: 'broken row' }] }, null);
    expect(result.reconciliation).toBe('INVALID');
  });
});

describe('Kill Sheet service safeguards', () => {
  const individualFile = () => Buffer.from(XLSX.write({ SheetNames: ['Kill'], Sheets: { Kill: XLSX.utils.aoa_to_sheet([['SN', 'Warm Mass', 'Cold Mass 3%'], ['1', 10, 9]]) } }, { type: 'buffer', bookType: 'xlsx' }));

  it('returns invalid previews without storing a file or creating an import', async () => {
    const storage = { store: jest.fn(), validateUpload: jest.fn(), read: jest.fn(), remove: jest.fn(), path: jest.fn() } as any;
    const cls = { get: jest.fn() } as any;
    const service = new KillSheetsService(cls, storage);
    jest.spyOn(service as any, 'batchFor').mockResolvedValue({ company_id: 'company-1' });
    jest.spyOn(service as any, 'parseIndividual').mockResolvedValue({ records: [], issues: [{ severity: 'ERROR', message: 'No rows' }], metadata: {}, expected: {} });
    const result = await service.preview({ farm_id: 'farm-1', batch_id: 'batch-1' }, {} as any, undefined, 'tenant-1');
    expect((result as any).persisted).toBe(false);
    expect(storage.store).not.toHaveBeenCalled();
  });

  it('does not update an import when a transactional confirmation insert fails', async () => {
    const insert = jest.fn(() => ({ values: jest.fn().mockRejectedValue(new Error('insert failed')) }));
    const update = jest.fn();
    const db = { insert, update } as any;
    const cls = { get: jest.fn((key: string) => key === 'tenantPostingTransaction' ? true : db) } as any;
    const storage = { read: jest.fn().mockResolvedValue(individualFile()) } as any;
    const service = new KillSheetsService(cls, storage);
    jest.spyOn(service as any, 'importFor').mockResolvedValue({ status: 'PREVIEW_READY', validation_json: [], reconciliation_status: 'MATCHED', individual_storage_key: 'tenant-1/import-1/individual.xlsx', summary_storage_key: null });
    await expect(service.confirm('import-1', {}, 'tenant-1')).rejects.toThrow('insert failed');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('Kill Sheet list date window', () => {
  /** Runs list() against a stub database and returns the rendered WHERE of the rows query and of the count query. */
  const listWheres = async (query: Record<string, string>, scope?: Record<string, string>) => {
    const wheres: any[] = [];
    const chain = (result: unknown[]) => {
      const link: any = {
        from: () => link, innerJoin: () => link, orderBy: () => link, limit: () => link,
        where: (where: unknown) => { wheres.push(where); return link; },
        offset: () => link,
        then: (resolve: (value: unknown[]) => unknown) => resolve(result),
      };
      return link;
    };
    const db = { select: jest.fn().mockReturnValueOnce(chain([])).mockReturnValueOnce(chain([{ count: 0 }])) };
    const cls = { get: jest.fn((key: string) => key === 'tenantDb' ? db : key === FARM_SCOPE_KEY ? scope : undefined) } as any;
    await new KillSheetsService(cls, {} as any).list(query, 'tenant-1');
    expect(wheres).toHaveLength(2);
    return wheres.map((where) => new MySqlDialect().sqlToQuery(where));
  };

  it('filters the rows and the count by slaughter date, or by confirmation date when the report has none', async () => {
    for (const { sql, params } of await listWheres({ date_from: '2026-10-25', date_to: '2026-11-21' })) {
      expect(sql).toMatch(/`slaughter_from` IS NOT NULL.*`slaughter_from` <= \?.*coalesce\(`kill_sheet_import`\.`slaughter_to`, `kill_sheet_import`\.`slaughter_from`\) >= \?/);
      expect(sql).toMatch(/`slaughter_from` IS NULL.*coalesce\(`kill_sheet_import`\.`confirmed_at`, `kill_sheet_import`\.`created_at`\) >= \?.*`created_at`\) <= \?/);
      expect(params).toEqual(['tenant-1', '2026-11-21 23:59:59', '2026-10-25 00:00:00', '2026-10-25 00:00:00', '2026-11-21 23:59:59']);
    }
  });

  it('applies only its own side when one bound is given', async () => {
    for (const { sql, params } of await listWheres({ date_from: '2026-10-25' })) {
      expect(sql).toContain('`confirmed_at`');
      expect(sql).not.toContain('<=');
      expect(params).toEqual(['tenant-1', '2026-10-25 00:00:00', '2026-10-25 00:00:00']);
    }
    for (const { sql, params } of await listWheres({ date_to: '2026-11-21' })) {
      expect(sql).not.toContain('>=');
      expect(params).toEqual(['tenant-1', '2026-11-21 23:59:59', '2026-11-21 23:59:59']);
    }
  });

  it('adds no date condition without dates', async () => {
    for (const { sql, params } of await listWheres({})) {
      expect(sql).not.toContain('slaughter_from');
      expect(sql).not.toContain('confirmed_at');
      expect(params).toEqual(['tenant-1']);
    }
  });

  it('keeps a farm-scoped caller on their own farm when a link names another', async () => {
    for (const { params } of await listWheres({ farm_id: 'other-farm' }, { companyId: 'company-1', farmId: 'own-farm' })) {
      expect(params).toEqual(['tenant-1', 'company-1', 'own-farm', 'other-farm']);
    }
  });
});

describe('Kill Sheet list query dates', () => {
  const rejected = async (query: Record<string, string>) =>
    (await validate(plainToInstance(QueryKillSheetsDto, query))).map((error) => error.property);

  it('accepts a plain day', async () => {
    expect(await rejected({ date_from: '2026-10-25', date_to: '2026-11-21' })).toEqual([]);
  });

  it('refuses a full datetime, which the window would turn into an invalid SQL value', async () => {
    expect(await rejected({ date_from: '2026-10-25T00:00:00Z', date_to: '2026-11-21 12:00:00' })).toEqual(['date_from', 'date_to']);
  });
});
