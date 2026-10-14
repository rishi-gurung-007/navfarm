import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, desc, isNotNull, or, SQL, gte, lte, gt, lt, like, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateBioAssetLedgerDto, QueryBioAssetLedgerDto, QueryBioAssetLedgerEntriesDto } from './dto/bio-asset-ledger.dto';
import { LEDGER_EXPORT_MAX_ROWS } from '../inventory-ledger/inventory-ledger-export';
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

  /**
   * The Bio Asset Ledger page (Rishi, 14 Oct): each animal's registration (+1) and each death (-1), read like the
   * Inventory Ledger — entry no., document, item, location, quantity, cost — with the GRN a registered animal came
   * from. Other bio-asset movements (a batch's feed, a transformation) stay off this page.
   */
  async entries(query: QueryBioAssetLedgerEntriesDto, tenantId: string, max = query.limit || 250) {
    const B = schema.bioAssetLedger;
    const loc = schema.locationMaster;
    const conditions: SQL[] = [
      eq(B.tenant_id, tenantId),
      ...this.scopeConditions(),
      or(and(eq(B.entry_type, 'ACQUISITION'), isNotNull(B.animal_id)), eq(B.entry_type, 'MORTALITY'))!,
    ];
    if (query.companyId) conditions.push(eq(B.company_id, query.companyId));
    if (query.itemId) conditions.push(eq(B.bio_asset_item_id, query.itemId));
    if (query.warehouseId) conditions.push(eq(B.warehouse_id, query.warehouseId));
    if (query.entryType === 'POSITIVE') conditions.push(gt(B.quantity, '0'));
    if (query.entryType === 'NEGATIVE') conditions.push(lt(B.quantity, '0'));
    if (query.transactionType === 'ANIMAL_REGISTRATION') conditions.push(eq(B.entry_type, 'ACQUISITION'));
    if (query.transactionType === 'MORTALITY') conditions.push(eq(B.entry_type, 'MORTALITY'));
    if (query.dateFrom) conditions.push(gte(B.posting_date, query.dateFrom));
    if (query.dateTo) conditions.push(lte(B.posting_date, query.dateTo));
    if (query.documentNo?.trim()) {
      const q = `%${query.documentNo.trim()}%`;
      conditions.push(or(
        like(B.document_no, q), like(B.batch_no, q), like(schema.itemMaster.item_code, q), like(schema.itemMaster.item_name, q),
        like(schema.animalRegister.animal_code, q), like(schema.goodsReceipt.receipt_no, q),
      )!);
    }

    const rows = await this.db
      .select({
        entry_id: B.entry_id,
        entry_no: B.entry_no,
        posting_date: B.posting_date,
        document_type: B.document_type,
        document_no: B.document_no,
        entry_type: B.entry_type,
        item_id: B.bio_asset_item_id,
        item_code: schema.itemMaster.item_code,
        item_description: schema.itemMaster.item_name,
        warehouse_id: B.warehouse_id,
        warehouse_code: loc.location_code,
        warehouse_name: loc.location_name,
        quantity: B.quantity,
        uom: sql<string | null>`COALESCE(${B.uom}, ${schema.itemMaster.uom_primary})`,
        rate: B.cost_amount_each_unit,
        amount: B.cost_amount,
        lot_no: B.lot_no,
        batch_no: B.batch_no,
        animal_id: B.animal_id,
        animal_code: schema.animalRegister.animal_code,
        source_receipt_id: schema.animalRegister.source_receipt_id,
        source_grn_no: schema.goodsReceipt.receipt_no,
        status: B.status,
        created_by: B.created_by,
        created_at: B.created_at,
      })
      .from(B)
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, B.bio_asset_item_id))
      .leftJoin(loc, eq(loc.location_id, B.warehouse_id))
      .leftJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, B.animal_id))
      .leftJoin(schema.goodsReceipt, and(eq(schema.goodsReceipt.receipt_id, schema.animalRegister.source_receipt_id), eq(B.entry_type, 'ACQUISITION')))
      .where(and(...conditions))
      .orderBy(...(query.sortBy === 'posting_date' ? [desc(B.posting_date), desc(B.entry_no)] : [desc(B.entry_no)]))
      .limit(max);

    return rows.map((r) => ({
      ...r,
      transaction_type: r.entry_type === 'MORTALITY' ? 'MORTALITY' : 'ANIMAL_REGISTRATION',
      document_type: r.document_type ?? (r.entry_type === 'MORTALITY' ? 'MORTALITY' : 'ANIMAL_REGISTRATION'),
    }));
  }

  async entriesForExport(query: QueryBioAssetLedgerEntriesDto, tenantId: string) {
    const rows = await this.entries(query, tenantId, LEDGER_EXPORT_MAX_ROWS + 1);
    const truncated = rows.length > LEDGER_EXPORT_MAX_ROWS;
    return { rows: truncated ? rows.slice(0, LEDGER_EXPORT_MAX_ROWS) : rows, truncated };
  }
}
