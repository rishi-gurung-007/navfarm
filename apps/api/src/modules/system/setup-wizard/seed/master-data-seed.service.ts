import { Injectable } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../../core/database/schema';
import { NumberSeriesService } from '../../number-series/number-series.service';
import { STARTER_GL_ACCOUNTS, STARTER_GL_MAPPINGS, STARTER_WAREHOUSE } from './starter-master-data.seed-data';

/**
 * Provisions a starter chart of accounts, GL mappings for every real
 * transaction type, and a default warehouse for a brand-new company — run
 * automatically once at the end of the setup wizard (see
 * SetupWizardService.completeWizard()). Without this, a new company has zero
 * usable GL/warehouse master data and the very first batch activation or
 * goods receipt fails with "No GL mapping configured...".
 */
@Injectable()
export class MasterDataSeedService {
  constructor(
    private readonly cls: ClsService,
    private readonly numberSeries: NumberSeriesService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async seedStarterMasterData(tenantId: string, companyId: string): Promise<void> {
    const [existing] = await this.db
      .select({ gl_account_id: schema.glAccountMaster.gl_account_id })
      .from(schema.glAccountMaster)
      .where(and(eq(schema.glAccountMaster.company_id, companyId), isNull(schema.glAccountMaster.deleted_at)))
      .limit(1);

    // Idempotent — a company that already has any GL account (seeded before,
    // or hand-configured) is left untouched rather than layering a second copy.
    if (existing) return;

    await this.db.transaction(async (tx) => {
      const accountIdByCode = new Map<string, string>();

      for (const account of STARTER_GL_ACCOUNTS) {
        const glAccountId = randomUUID();
        accountIdByCode.set(account.account_code, glAccountId);
        await tx.insert(schema.glAccountMaster).values({
          gl_account_id: glAccountId,
          tenant_id: tenantId,
          company_id: companyId,
          account_code: account.account_code,
          account_name: account.account_name,
          account_type: account.account_type,
        });
      }

      for (const mapping of STARTER_GL_MAPPINGS) {
        const debitAccountId = accountIdByCode.get(mapping.debit_account_code);
        const creditAccountId = accountIdByCode.get(mapping.credit_account_code);
        if (!debitAccountId || !creditAccountId) continue; // defensive — every code above is defined in the same list

        // A starter mapping takes a code from the GL_MAPPING series like one made on the screen; null when the
        // company has no such series, as for any master (the column is nullable).
        const mappingCode = await this.numberSeries.resolveOptionalCode('GL_MAPPING', undefined, tenantId, companyId, undefined, mapping as unknown as Record<string, unknown>);

        await tx.insert(schema.glMappingMaster).values({
          mapping_id: randomUUID(),
          tenant_id: tenantId,
          company_id: companyId,
          mapping_code: mappingCode,
          transaction_type: mapping.transaction_type,
          debit_gl_account_id: debitAccountId,
          credit_gl_account_id: creditAccountId,
        });
      }

      // The starter warehouse is a location (type STORE), not a row of a
      // separate warehouse table — that table is gone. It has no parent
      // because a new company has no farm yet; one can be set later by
      // editing it under Locations.
      await tx.insert(schema.locationMaster).values({
        location_id: randomUUID(),
        tenant_id: tenantId,
        company_id: companyId,
        location_code: STARTER_WAREHOUSE.warehouse_code,
        location_name: STARTER_WAREHOUSE.warehouse_name,
        location_level: 1,
        location_type: 'STORE',
        storage_type: 'STORE',
      });
    });
  }
}
