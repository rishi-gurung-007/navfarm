import { Injectable, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, desc, eq, gte, isNull, lte, or, SQL } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { QueryResourceLedgerDto } from './dto/resource-ledger.dto';
import { batchOnFarm, farmScope, restrictedScopeConditions } from '../../../common/farm-scope';

export interface WriteResourceUsageParams {
  tenantId: string;
  companyId: string;
  farmId?: string | null;
  resourceId: string;
  documentType: string;
  documentNo: string;
  documentLineId?: string | null;
  postingDate: string;
  /** RESOURCE_USAGE for a Resource line, OVERHEAD for an overhead line that names a resource. */
  transactionType: string;
  batchId?: string | null;
  batchNo?: string | null;
  stageId?: string | null;
  lineId?: string | null;
  /** Positive — the amount of the resource used. */
  quantity: number;
  uom?: string | null;
  rate?: number | null;
  remarks?: string | null;
  nobId?: string | null;
  lobId?: string | null;
  userId?: string;
}

/**
 * The posting engine for the Resource Ledger — the append-only usage log that
 * Resource activity entries write, the counterpart of InventoryLedgerService
 * for things that are booked and costed but never stocked.
 *
 * Every write here runs inside the caller's transaction (the CLS `tenantDb` is
 * the posting transaction while one is open), which is the whole point: a
 * posted resource entry and its ledger row commit together or not at all.
 */
@Injectable()
export class ResourceLedgerService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /** Writes the USAGE row for one resource posting. Returns the row as stored. */
  async writeUsageEntry(params: WriteResourceUsageParams) {
    const [resource] = await this.db
      .select()
      .from(schema.resourceMaster)
      .where(eq(schema.resourceMaster.resource_id, params.resourceId))
      .limit(1);
    if (!resource) throw new BadRequestException(`Resource with ID '${params.resourceId}' not found.`);

    const rate = params.rate ?? (resource.cost_rate != null ? Number(resource.cost_rate) : null);
    const ledgerId = randomUUID();
    await this.db.insert(schema.resourceLedger).values({
      ledger_id: ledgerId,
      tenant_id: params.tenantId,
      company_id: params.companyId,
      farm_id: params.farmId || null,
      resource_id: params.resourceId,
      // Snapshot, not a join: what the resource was called and cost on the day.
      resource_code: resource.resource_code,
      resource_name: resource.resource_name,
      resource_type: resource.resource_type,
      document_type: params.documentType,
      document_no: params.documentNo,
      document_line_id: params.documentLineId || null,
      posting_date: params.postingDate,
      entry_type: 'USAGE',
      transaction_type: params.transactionType,
      batch_id: params.batchId || null,
      batch_no: params.batchNo || null,
      stage_id: params.stageId || null,
      line_id: params.lineId || null,
      quantity: params.quantity.toString(),
      uom: params.uom || resource.unit || resource.capacity_uom || null,
      rate: rate != null ? rate.toString() : null,
      amount: rate != null ? (params.quantity * rate).toString() : null,
      remarks: params.remarks || null,
      nob_id: params.nobId || null,
      lob_id: params.lobId || null,
      created_by: params.userId || null,
    });
    return this.loadOne(ledgerId);
  }

  /**
   * Reverses one USAGE row with an offsetting REVERSAL row — the same shape the
   * Inventory Ledger uses, so a corrected resource entry reads the way a
   * corrected consumption does: original row untouched, reversal naming it in
   * `external_reference_no`, net zero.
   */
  async reverseEntry(ledgerId: string, tenantId: string, userId?: string) {
    const [original] = await this.db
      .select()
      .from(schema.resourceLedger)
      .where(and(eq(schema.resourceLedger.ledger_id, ledgerId), eq(schema.resourceLedger.tenant_id, tenantId)))
      .for('update');
    if (!original || original.entry_type !== 'USAGE') {
      throw new BadRequestException('Only an existing resource usage entry can be reversed here.');
    }
    const [already] = await this.db
      .select({ ledger_id: schema.resourceLedger.ledger_id })
      .from(schema.resourceLedger)
      .where(and(
        eq(schema.resourceLedger.external_reference_no, ledgerId),
        eq(schema.resourceLedger.transaction_type, 'REVERSAL'),
      ))
      .limit(1);
    if (already) throw new BadRequestException('This resource usage has already been reversed.');

    const reversalId = randomUUID();
    // created_at is dropped from the spread so the reversal carries its own
    // (column-default) timestamp rather than the original's — the same reason
    // InventoryLedgerService.reverseEntry does it.
    const { created_at: _originalCreatedAt, ...originalForReversal } = original;
    await this.db.insert(schema.resourceLedger).values({
      ...originalForReversal,
      ledger_id: reversalId,
      entry_type: 'REVERSAL',
      transaction_type: 'REVERSAL',
      quantity: (-Number(original.quantity)).toString(),
      amount: original.amount == null ? null : (-Number(original.amount)).toString(),
      external_reference_no: ledgerId,
      remarks: `Reversal of ${ledgerId} — daily entry correction`,
      created_by: userId || null,
    });
    return this.loadOne(reversalId);
  }

  /** The USAGE row a batch_transaction wrote, if it wrote one. */
  async findByDocumentLine(documentLineId: string) {
    const [row] = await this.db
      .select()
      .from(schema.resourceLedger)
      .where(and(
        eq(schema.resourceLedger.document_line_id, documentLineId),
        eq(schema.resourceLedger.entry_type, 'USAGE'),
      ))
      .limit(1);
    return row ?? null;
  }

  private async loadOne(ledgerId: string) {
    const [row] = await this.db
      .select()
      .from(schema.resourceLedger)
      .where(eq(schema.resourceLedger.ledger_id, ledgerId))
      .limit(1);
    return row;
  }

  /**
   * The caller's farm/company/LOB boundary. `farm_id` is written on every row
   * this service creates; the batch fallback covers a row whose batch had no
   * farm recorded when it was posted, rather than hiding it from everyone.
   */
  private farmConditions(): SQL[] {
    const scope = farmScope(this.cls);
    const conditions: SQL[] = [];
    if (scope.farmId) {
      conditions.push(or(
        eq(schema.resourceLedger.farm_id, scope.farmId),
        and(
          isNull(schema.resourceLedger.farm_id),
          batchOnFarm(schema.resourceLedger.batch_id, scope.farmId),
        ),
      )!);
    }
    conditions.push(...restrictedScopeConditions(scope, {
      companyId: schema.resourceLedger.company_id,
      lobId: schema.resourceLedger.lob_id,
    }));
    return conditions;
  }

  async findAll(query: QueryResourceLedgerDto, tenantId: string) {
    const conditions: SQL[] = [eq(schema.resourceLedger.tenant_id, tenantId), ...this.farmConditions()];

    if (query.companyId) conditions.push(eq(schema.resourceLedger.company_id, query.companyId));
    if (query.farmId) conditions.push(eq(schema.resourceLedger.farm_id, query.farmId));
    if (query.resourceId) conditions.push(eq(schema.resourceLedger.resource_id, query.resourceId));
    if (query.batchId) conditions.push(eq(schema.resourceLedger.batch_id, query.batchId));
    if (query.transactionType) conditions.push(eq(schema.resourceLedger.transaction_type, query.transactionType));
    if (query.dateFrom) conditions.push(gte(schema.resourceLedger.posting_date, query.dateFrom));
    if (query.dateTo) conditions.push(lte(schema.resourceLedger.posting_date, query.dateTo));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select({
        ledger_id: schema.resourceLedger.ledger_id,
        posting_date: schema.resourceLedger.posting_date,
        document_type: schema.resourceLedger.document_type,
        document_no: schema.resourceLedger.document_no,
        document_line_id: schema.resourceLedger.document_line_id,
        external_reference_no: schema.resourceLedger.external_reference_no,
        entry_type: schema.resourceLedger.entry_type,
        transaction_type: schema.resourceLedger.transaction_type,
        resource_id: schema.resourceLedger.resource_id,
        resource_code: schema.resourceLedger.resource_code,
        resource_name: schema.resourceLedger.resource_name,
        resource_type: schema.resourceLedger.resource_type,
        farm_id: schema.resourceLedger.farm_id,
        batch_id: schema.resourceLedger.batch_id,
        batch_no: schema.resourceLedger.batch_no,
        stage_id: schema.resourceLedger.stage_id,
        stage_name: schema.stageMaster.stage_name,
        line_id: schema.resourceLedger.line_id,
        quantity: schema.resourceLedger.quantity,
        uom: schema.resourceLedger.uom,
        rate: schema.resourceLedger.rate,
        amount: schema.resourceLedger.amount,
        remarks: schema.resourceLedger.remarks,
        created_at: schema.resourceLedger.created_at,
      })
      .from(schema.resourceLedger)
      .leftJoin(schema.stageMaster, eq(schema.resourceLedger.stage_id, schema.stageMaster.stage_id))
      .where(and(...conditions))
      .orderBy(desc(schema.resourceLedger.posting_date), desc(schema.resourceLedger.created_at))
      .limit(limit)
      .offset(offset);
  }
}
