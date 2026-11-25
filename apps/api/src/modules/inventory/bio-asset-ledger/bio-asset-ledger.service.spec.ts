import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { ClsService } from 'nestjs-cls';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BioAssetLedgerService } from './bio-asset-ledger.service';
import { ExportBioAssetLedgerDto } from './dto/bio-asset-ledger.dto';

describe('BioAssetLedgerService farm scope', () => {
  const dialect = new MySqlDialect();
  let capturedWhere: unknown;
  let scope: FarmScope;
  let service: BioAssetLedgerService;

  beforeEach(() => {
    capturedWhere = undefined;
    scope = { farmId: null, restricted: true, companyId: 'company-1', lobId: 'lob-pig' };
    const query = {
      from: jest.fn().mockReturnValue({
        where: jest.fn((condition) => {
          capturedWhere = condition;
          return {
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({ offset: jest.fn().mockResolvedValue([]) }),
            }),
          };
        }),
      }),
    };
    const db = { select: jest.fn().mockReturnValue(query) };
    const cls = {
      get: jest.fn((key: string) => key === 'tenantDb' ? db : key === FARM_SCOPE_KEY ? scope : undefined),
    } as unknown as ClsService;
    service = new BioAssetLedgerService(cls, { log: jest.fn() } as unknown as AuditLogService);
  });

  it('limits a farm-less operational user to its company, LOB and linked operational entries', async () => {
    await service.findAll({}, 'tenant-1');

    const rendered = dialect.sqlToQuery(capturedWhere as any);
    expect(rendered.sql).toContain('`bio_asset_ledger`.`company_id` = ?');
    expect(rendered.sql).toContain('`bio_asset_ledger`.`lob_id` = ?');
    expect(rendered.sql).toContain('`bio_asset_ledger`.`batch_id` is not null');
    expect(rendered.sql).toContain('`bio_asset_ledger`.`animal_id` is not null');
    expect(rendered.params).toEqual(expect.arrayContaining(['tenant-1', 'company-1', 'lob-pig']));
  });

  it('adds batch-or-animal farm predicates when a farm is selected', async () => {
    scope.farmId = 'farm-1';

    await service.findAll({}, 'tenant-1');

    const rendered = dialect.sqlToQuery(capturedWhere as any);
    expect(rendered.sql).toContain('FROM batch_header bf WHERE bf.farm_id = ?');
    expect(rendered.sql).toContain('FROM animal_register af');
    expect(rendered.params).toEqual(expect.arrayContaining(['farm-1']));
  });

  it('rejects manual entries from operational users before inserting', async () => {
    await expect(service.create({ company_id: 'company-1', lob_id: 'lob-pig' } as any, 'tenant-1'))
      .rejects.toThrow(ForbiddenException);
  });

  it('rejects an unlinked manual entry when an admin selected a farm', async () => {
    scope = { farmId: 'farm-1', restricted: false, companyId: 'company-1', lobId: null };
    await expect(service.create({ company_id: 'company-1' } as any, 'tenant-1'))
      .rejects.toThrow(ForbiddenException);
  });
});

describe('BioAssetLedgerService entries: farm and sales only (GM Dashboard links)', () => {
  const dialect = new MySqlDialect();
  const FARM = '7b0c2f4e-1111-4222-8333-944455556666';
  let capturedWhere: unknown;
  let service: BioAssetLedgerService;

  beforeEach(() => {
    capturedWhere = undefined;
    const scope: FarmScope = { farmId: null, restricted: true, companyId: 'company-1', lobId: 'lob-pig' };
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: (condition: unknown) => {
        capturedWhere = condition;
        return chain;
      },
      orderBy: () => chain,
      limit: () => Promise.resolve([]),
    };
    const db = { select: () => chain };
    const cls = {
      get: (key: string) => key === 'tenantDb' ? db : key === FARM_SCOPE_KEY ? scope : undefined,
    } as unknown as ClsService;
    service = new BioAssetLedgerService(cls, { log: jest.fn() } as unknown as AuditLogService);
  });

  const rendered = () => dialect.sqlToQuery(capturedWhere as any);

  it('narrows to the batches of a requested farm, keeping the user scope', async () => {
    await service.entries({ farmId: FARM }, 'tenant-1');

    const { sql, params } = rendered();
    expect(sql).toContain('FROM batch_header bf WHERE bf.farm_id = ?');
    expect(sql).toContain('`bio_asset_ledger`.`company_id` = ?');
    expect(sql).toContain('`bio_asset_ledger`.`lob_id` = ?');
    expect(params).toEqual(expect.arrayContaining([FARM, 'company-1', 'lob-pig']));
  });

  it('lists only sold disposals, dated by the sale journal, when salesOnly is on', async () => {
    await service.entries({ salesOnly: 'true', dateFrom: '2026-10-25', dateTo: '2026-11-21' }, 'tenant-1');

    const { sql, params } = rendered();
    expect(sql).toContain('journal_header');
    expect(params).toEqual(expect.arrayContaining(['SLAUGHTER_TO', '2026-10-25', '2026-11-21']));
    expect(sql).toContain('h.posting_date >= ?');
    expect(sql).toContain('h.posting_date <= ?');
    expect(sql).not.toContain('`bio_asset_ledger`.`posting_date` >=');
    expect(sql).not.toContain('`bio_asset_ledger`.`posting_date` <=');
    // The page's usual events are replaced by the disposal event alone.
    expect(params).toEqual(expect.arrayContaining(['BATCH_DISPOSAL']));
    expect(params).not.toContain('PURCHASE');
  });

  it('reads no journal and keeps the posting-date window without salesOnly', async () => {
    await service.entries({ salesOnly: 'false', dateFrom: '2026-10-25' }, 'tenant-1');

    const { sql } = rendered();
    expect(sql).not.toContain('journal_header');
    expect(sql).toContain('`bio_asset_ledger`.`posting_date` >= ?');
  });

  it('opens a sold disposal from its row, and no other disposal, within the same scope', async () => {
    // The mock finds no row, so only the WHERE is under test.
    await expect(service.entryDetail('entry-9', 'tenant-1')).rejects.toThrow('Bio Asset Ledger entry not found.');

    const { sql, params } = rendered();
    // A disposal is admitted only together with its posted sale journal: an alternative to the usual events.
    expect(sql).toMatch(/or \(`bio_asset_ledger`\.`document_type` in \(\?, \?, \?, \?, \?, \?\) and `bio_asset_ledger`\.`document_no` IN \(SELECT sold\.doc_key FROM \(/);
    expect(sql).toContain('journal_header');
    expect(sql).not.toContain('h.posting_date >= ?');
    expect(sql).toContain('`bio_asset_ledger`.`entry_id` = ?');
    expect(sql).toContain('`bio_asset_ledger`.`company_id` = ?');
    expect(sql).toContain('`bio_asset_ledger`.`lob_id` = ?');
    expect(params).toEqual(expect.arrayContaining(['tenant-1', 'company-1', 'lob-pig', 'entry-9', 'SLAUGHTER_TO']));
  });

  it('leaves disposals off the default list', async () => {
    await service.entries({}, 'tenant-1');

    const { sql, params } = rendered();
    expect(sql).not.toContain('journal_header');
    expect(params).not.toContain('BATCH_DISPOSAL');
  });

  it('exports the sales-only list: the export DTO accepts the filters and the export applies them', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
    const query = await pipe.transform(
      { salesOnly: 'true', farmId: FARM, dateFrom: '2026-10-25', format: 'csv' },
      { type: 'query', metatype: ExportBioAssetLedgerDto },
    );

    await service.entriesForExport(query, 'tenant-1');

    const { sql, params } = rendered();
    expect(sql).toContain('journal_header');
    expect(sql).toContain('FROM batch_header bf WHERE bf.farm_id = ?');
    expect(params).toEqual(expect.arrayContaining(['BATCH_DISPOSAL', FARM, '2026-10-25']));
    await expect(
      pipe.transform({ salesOnly: 'yes' }, { type: 'query', metatype: ExportBioAssetLedgerDto }),
    ).rejects.toThrow();
  });
});
