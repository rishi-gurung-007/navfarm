import { ForbiddenException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { ClsService } from 'nestjs-cls';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BioAssetLedgerService } from './bio-asset-ledger.service';

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
