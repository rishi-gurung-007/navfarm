import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, isNull, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { assertCompanyInScope, farmScope, locationReferenceScopeConditions, assertLocationOnActiveFarm, restrictedScopeConditions } from '../../../common/farm-scope';
import { CreateGoodsIssueDto, UpdateGoodsIssueDto, QueryGoodsIssueDto } from './dto/goods-issue.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class GoodsIssueService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly ledgerService: InventoryLedgerService,
    private readonly glPostingService: GlPostingService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  // `executor` must be the active transaction when called from inside one (see
  // `create()`) — `.for('update')` locks the counted rows so a second concurrent
  // call blocks until the first commits its insert, instead of both reading the
  // same count and generating the same issue number.
  private async generateIssueNo(tenantId: string, companyId: string, executor: MySql2Database<typeof schema> = this.db): Promise<string> {
    const [row] = await executor
      .select({ total: count() })
      .from(schema.goodsIssue)
      .where(and(eq(schema.goodsIssue.tenant_id, tenantId), eq(schema.goodsIssue.company_id, companyId)))
      .for('update');
    const seq = Number(row?.total || 0) + 1;
    return `GI-${String(seq).padStart(6, '0')}`;
  }

  async create(dto: CreateGoodsIssueDto, tenantId: string, userPayload?: any) {
    assertCompanyInScope(farmScope(this.cls), dto.company_id);
    await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.warehouse_id, 'Warehouse');
    return withTenantTransaction(this.cls, async () => {
    const issueId = randomUUID();
    const issueNo = await this.db.transaction(async (tx) => {
      const no = await this.generateIssueNo(tenantId, dto.company_id, tx);
      await tx.insert(schema.goodsIssue).values({
        issue_id: issueId,
        tenant_id: tenantId,
        company_id: dto.company_id,
        issue_no: no,
        posting_date: dto.posting_date,
        warehouse_id: dto.warehouse_id,
        cost_center_id: dto.cost_center_id || null,
        remarks: dto.remarks || null,
        status: 'DRAFT',
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      });
      return no;
    });

    await this.insertLines(issueId, dto.lines);

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'goods_issue',
      entityId: issueId,
      newValues: { issue_no: issueNo, ...dto },
    });

    return this.findOne(issueId);
    });
  }

  private async insertLines(issueId: string, lines: CreateGoodsIssueDto['lines']) {
    await this.db.insert(schema.goodsIssueLine).values(
      lines.map((line, idx) => ({
        line_id: randomUUID(),
        issue_id: issueId,
        line_no: idx + 1,
        item_id: line.item_id,
        quantity: line.quantity.toString(),
        uom: line.uom,
        remarks: line.remarks || null,
      }))
    );
  }

  async findOne(id: string) {
    const scope = farmScope(this.cls);
    const conditions = [eq(schema.goodsIssue.issue_id, id), isNull(schema.goodsIssue.deleted_at)];
    conditions.push(...locationReferenceScopeConditions(scope, schema.goodsIssue.warehouse_id));
    conditions.push(...restrictedScopeConditions(scope, { companyId: schema.goodsIssue.company_id }));

    const [issue] = await this.db
      .select()
      .from(schema.goodsIssue)
      .where(and(...conditions))
      .limit(1);

    if (!issue) {
      throw new NotFoundException(`Goods Issue with ID '${id}' not found.`);
    }

    const lines = await this.db
      .select()
      .from(schema.goodsIssueLine)
      .where(eq(schema.goodsIssueLine.issue_id, id));

    return { ...issue, lines };
  }

  async findAll(query: QueryGoodsIssueDto, tenantId: string) {
    const conditions: any[] = [eq(schema.goodsIssue.tenant_id, tenantId), isNull(schema.goodsIssue.deleted_at)];

    const scope = farmScope(this.cls);
    conditions.push(...locationReferenceScopeConditions(scope, schema.goodsIssue.warehouse_id));
    conditions.push(...restrictedScopeConditions(scope, { companyId: schema.goodsIssue.company_id }));

    if (query.companyId) conditions.push(eq(schema.goodsIssue.company_id, query.companyId));
    if (query.status) conditions.push(eq(schema.goodsIssue.status, query.status));
    if (query.warehouseId) conditions.push(eq(schema.goodsIssue.warehouse_id, query.warehouseId));
    if (query.search) conditions.push(like(schema.goodsIssue.issue_no, `%${query.search}%`));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.goodsIssue)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }

  private assertDraft(issue: { status: string }) {
    if (issue.status !== 'DRAFT') {
      throw new BadRequestException(`Goods Issue cannot be modified — it is already ${issue.status}.`);
    }
  }

  async update(id: string, dto: UpdateGoodsIssueDto, tenantId: string, userPayload?: any) {
    const issue = await this.findOne(id);
    this.assertDraft(issue);
    if (dto.warehouse_id !== undefined) {
      await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.warehouse_id, 'Warehouse');
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };
    if (dto.warehouse_id !== undefined) updates.warehouse_id = dto.warehouse_id;
    if (dto.posting_date !== undefined) updates.posting_date = dto.posting_date;
    if (dto.cost_center_id !== undefined) updates.cost_center_id = dto.cost_center_id;
    if (dto.remarks !== undefined) updates.remarks = dto.remarks;

    await this.db.update(schema.goodsIssue).set(updates).where(eq(schema.goodsIssue.issue_id, id));

    if (dto.lines) {
      await this.db.delete(schema.goodsIssueLine).where(eq(schema.goodsIssueLine.issue_id, id));
      await this.insertLines(id, dto.lines);
    }

    await this.auditService.log({
      tenantId,
      companyId: issue.company_id,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'goods_issue',
      entityId: id,
      oldValues: issue,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const issue = await this.findOne(id);
    this.assertDraft(issue);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.goodsIssue)
      .set({ status: 'CANCELLED', deleted_at: deletedTime as any, updated_by: userPayload?.userId || null })
      .where(eq(schema.goodsIssue.issue_id, id));

    await this.auditService.log({
      tenantId,
      companyId: issue.company_id,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'goods_issue',
      entityId: id,
      oldValues: issue,
      newValues: { status: 'CANCELLED', deleted_at: deletedTime },
    });

    return { success: true, message: `Goods Issue '${issue.issue_no}' has been cancelled.` };
  }

  async post(id: string, tenantId: string, userPayload?: any) {
    return withTenantTransaction(this.cls, async () => {
    const issue = await this.findOne(id);
    this.assertDraft(issue);

    if (!issue.lines || issue.lines.length === 0) {
      throw new BadRequestException('Cannot post a Goods Issue with no lines.');
    }

    // Claim the DRAFT -> POSTED transition atomically, before writing any
    // ledger/GL entries: the WHERE also requires status='DRAFT', so if two
    // concurrent post() calls race here only one UPDATE matches a row — the
    // loser's affectedRows is 0 and it aborts before touching the ledger. This
    // also closes the "retry after a partial failure" hole: since status is
    // already POSTED once this succeeds, a retry hits assertDraft()'s
    // rejection instead of silently re-running the loop and duplicating the
    // lines that already succeeded.
    const [claim] = await this.db
      .update(schema.goodsIssue)
      .set({
        status: 'POSTED',
        posted_at: toMysqlTimestamp() as any,
        posted_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      })
      .where(and(eq(schema.goodsIssue.issue_id, id), eq(schema.goodsIssue.status, 'DRAFT')));

    if (claim.affectedRows === 0) {
      throw new BadRequestException('Goods Issue cannot be posted — it was already posted by another request.');
    }

    for (const line of issue.lines) {
      const ledgerEntry = await this.ledgerService.writeNegativeEntry({
        tenantId,
        companyId: issue.company_id,
        itemId: line.item_id,
        documentType: 'GOODS_ISSUE',
        documentNo: issue.issue_no,
        documentLineId: line.line_id,
        postingDate: issue.posting_date,
        transactionType: 'CONSUMPTION',
        quantity: Number(line.quantity),
        uom: line.uom,
        warehouseId: issue.warehouse_id,
        userId: userPayload?.userId,
      });

      await this.glPostingService.postInventoryLedgerEntry(ledgerEntry, userPayload?.userId);
    }

    await this.auditService.log({
      tenantId,
      companyId: issue.company_id,
      userId: userPayload?.userId,
      action: 'POST',
      entityName: 'goods_issue',
      entityId: id,
      newValues: { status: 'POSTED' },
    });

    return this.findOne(id);
    });
  }
}
