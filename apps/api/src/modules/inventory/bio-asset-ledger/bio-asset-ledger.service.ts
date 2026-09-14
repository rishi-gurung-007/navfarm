import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, desc, isNotNull, or, SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateBioAssetLedgerDto, QueryBioAssetLedgerDto } from './dto/bio-asset-ledger.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import {
  animalOnFarm,
  assertCompanyInScope,
  assertLobInScope,
  batchOnFarm,
  farmScope,
  restrictedScopeConditions,
} from '../../../common/farm-scope';

/**
 * Manual-entry API for the Bio-Asset Ledger (living/biological assets:
 * mortality, growth adjustment, fair-value changes, transformation). Nothing
 * auto-writes here yet — that requires Batch Management (Phase 5). This
 * exists so the table and API shape are ready for Phase 5 to build on.
 */
@Injectable()
export class BioAssetLedgerService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async create(dto: CreateBioAssetLedgerDto, tenantId: string, userPayload?: any) {
    const scope = farmScope(this.cls);
    assertCompanyInScope(scope, dto.company_id);
    assertLobInScope(scope, dto.lob_id);
    if (scope.restricted || scope.farmId) {
      throw new ForbiddenException('Farm-scoped biological-asset changes must be recorded through a batch or animal workflow.');
    }
    const entryId = randomUUID();

    const costAmount = dto.cost_amount ?? null;
    const quantity = dto.quantity ?? null;
    const costAmountEachUnit = costAmount !== null && quantity ? costAmount / quantity : null;

    await this.db.insert(schema.bioAssetLedger).values({
      entry_id: entryId,
      tenant_id: tenantId,
      company_id: dto.company_id,
      bio_asset_item_id: dto.bio_asset_item_id,
      entry_type: dto.entry_type,
      document_no: dto.document_no || null,
      posting_date: dto.posting_date,
      asset_tracking_type: dto.asset_tracking_type || null,
      lot_no: dto.lot_no || null,
      asset_rfid_no: dto.asset_rfid_no || null,
      batch_no: dto.batch_no || null,
      stage: dto.stage || null,
      quantity: quantity?.toString() ?? null,
      cost_amount: costAmount?.toString() ?? null,
      cost_amount_each_unit: costAmountEachUnit?.toString() ?? null,
      costing_method: dto.costing_method || null,
      nob_id: dto.nob_id || null,
      lob_id: dto.lob_id || null,
      created_by: userPayload?.userId || null,
    });

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'bio_asset_ledger',
      entityId: entryId,
      newValues: dto,
    });

    return this.findOne(entryId);
  }

  async findOne(id: string) {
    const conditions: SQL[] = [eq(schema.bioAssetLedger.entry_id, id), ...this.scopeConditions()];
    const [entry] = await this.db
      .select()
      .from(schema.bioAssetLedger)
      .where(and(...conditions))
      .limit(1);
    if (!entry) throw new NotFoundException('Bio-Asset Ledger entry not found.');
    return entry;
  }

  private scopeConditions(): SQL[] {
    const scope = farmScope(this.cls);
    const conditions = restrictedScopeConditions(scope, {
      companyId: schema.bioAssetLedger.company_id,
      lobId: schema.bioAssetLedger.lob_id,
    });
    if (scope.farmId) {
      conditions.push(or(
        batchOnFarm(schema.bioAssetLedger.batch_id, scope.farmId),
        animalOnFarm(schema.bioAssetLedger.animal_id, scope.farmId),
      )!);
    }
    if (scope.restricted) {
      conditions.push(or(isNotNull(schema.bioAssetLedger.batch_id), isNotNull(schema.bioAssetLedger.animal_id))!);
    }
    return conditions;
  }

  async findAll(query: QueryBioAssetLedgerDto, tenantId: string) {
    const conditions: SQL[] = [eq(schema.bioAssetLedger.tenant_id, tenantId), ...this.scopeConditions()];

    if (query.companyId) conditions.push(eq(schema.bioAssetLedger.company_id, query.companyId));
    if (query.bioAssetItemId) conditions.push(eq(schema.bioAssetLedger.bio_asset_item_id, query.bioAssetItemId));
    if (query.entryType) conditions.push(eq(schema.bioAssetLedger.entry_type, query.entryType));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.bioAssetLedger)
      .where(and(...conditions))
      .orderBy(desc(schema.bioAssetLedger.posting_date), desc(schema.bioAssetLedger.created_at))
      .limit(limit)
      .offset(offset);
  }
}
