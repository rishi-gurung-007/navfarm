import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, isNull, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateStockAdjustmentDto, UpdateStockAdjustmentDto, QueryStockAdjustmentDto } from './dto/stock-adjustment.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class StockAdjustmentService {
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
  // same count and generating the same adjustment number.
  private async generateAdjustmentNo(tenantId: string, companyId: string, executor: MySql2Database<typeof schema> = this.db): Promise<string> {
    const [row] = await executor
      .select({ total: count() })
      .from(schema.stockAdjustment)
      .where(and(eq(schema.stockAdjustment.tenant_id, tenantId), eq(schema.stockAdjustment.company_id, companyId)))
      .for('update');
    const seq = Number(row?.total || 0) + 1;
    return `ADJ-${String(seq).padStart(6, '0')}`;
  }

  async create(dto: CreateStockAdjustmentDto, tenantId: string, userPayload?: any) {
    return withTenantTransaction(this.cls, async () => {
    const adjustmentId = randomUUID();
    const adjustmentNo = await this.db.transaction(async (tx) => {
      const no = await this.generateAdjustmentNo(tenantId, dto.company_id, tx);
      await tx.insert(schema.stockAdjustment).values({
        adjustment_id: adjustmentId,
        tenant_id: tenantId,
        company_id: dto.company_id,
        adjustment_no: no,
        posting_date: dto.posting_date,
        warehouse_id: dto.warehouse_id,
        reason: dto.reason || null,
        remarks: dto.remarks || null,
        status: 'DRAFT',
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      });
      return no;
    });

    await this.insertLines(adjustmentId, dto.lines);

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'stock_adjustment',
      entityId: adjustmentId,
      newValues: { adjustment_no: adjustmentNo, ...dto },
    });

    return this.findOne(adjustmentId);
    });
  }

  private async insertLines(adjustmentId: string, lines: CreateStockAdjustmentDto['lines']) {
    await this.db.insert(schema.stockAdjustmentLine).values(
      lines.map((line, idx) => ({
        line_id: randomUUID(),
        adjustment_id: adjustmentId,
        line_no: idx + 1,
        item_id: line.item_id,
        quantity: line.quantity.toString(),
        uom: line.uom,
        rate: line.rate?.toString() || null,
        remarks: line.remarks || null,
      }))
    );
  }

  async findOne(id: string) {
    const [adjustment] = await this.db
      .select()
      .from(schema.stockAdjustment)
      .where(and(eq(schema.stockAdjustment.adjustment_id, id), isNull(schema.stockAdjustment.deleted_at)))
      .limit(1);

    if (!adjustment) {
      throw new NotFoundException(`Stock Adjustment with ID '${id}' not found.`);
    }

    const lines = await this.db
      .select()
      .from(schema.stockAdjustmentLine)
      .where(eq(schema.stockAdjustmentLine.adjustment_id, id));

    return { ...adjustment, lines };
  }

  async findAll(query: QueryStockAdjustmentDto, tenantId: string) {
    const conditions: any[] = [eq(schema.stockAdjustment.tenant_id, tenantId), isNull(schema.stockAdjustment.deleted_at)];

    if (query.companyId) conditions.push(eq(schema.stockAdjustment.company_id, query.companyId));
    if (query.status) conditions.push(eq(schema.stockAdjustment.status, query.status));
    if (query.warehouseId) conditions.push(eq(schema.stockAdjustment.warehouse_id, query.warehouseId));
    if (query.search) conditions.push(like(schema.stockAdjustment.adjustment_no, `%${query.search}%`));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.stockAdjustment)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }

  private assertDraft(adjustment: { status: string }) {
    if (adjustment.status !== 'DRAFT') {
      throw new BadRequestException(`Stock Adjustment cannot be modified — it is already ${adjustment.status}.`);
    }
  }

  async update(id: string, dto: UpdateStockAdjustmentDto, tenantId: string, userPayload?: any) {
    const adjustment = await this.findOne(id);
    this.assertDraft(adjustment);

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };
    if (dto.warehouse_id !== undefined) updates.warehouse_id = dto.warehouse_id;
    if (dto.posting_date !== undefined) updates.posting_date = dto.posting_date;
    if (dto.reason !== undefined) updates.reason = dto.reason;
    if (dto.remarks !== undefined) updates.remarks = dto.remarks;

    await this.db.update(schema.stockAdjustment).set(updates).where(eq(schema.stockAdjustment.adjustment_id, id));

    if (dto.lines) {
      await this.db.delete(schema.stockAdjustmentLine).where(eq(schema.stockAdjustmentLine.adjustment_id, id));
      await this.insertLines(id, dto.lines);
    }

    await this.auditService.log({
      tenantId,
      companyId: adjustment.company_id,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'stock_adjustment',
      entityId: id,
      oldValues: adjustment,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const adjustment = await this.findOne(id);
    this.assertDraft(adjustment);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.stockAdjustment)
      .set({ status: 'CANCELLED', deleted_at: deletedTime as any, updated_by: userPayload?.userId || null })
      .where(eq(schema.stockAdjustment.adjustment_id, id));

    await this.auditService.log({
      tenantId,
      companyId: adjustment.company_id,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'stock_adjustment',
      entityId: id,
      oldValues: adjustment,
      newValues: { status: 'CANCELLED', deleted_at: deletedTime },
    });

    return { success: true, message: `Stock Adjustment '${adjustment.adjustment_no}' has been cancelled.` };
  }

  async post(id: string, tenantId: string, userPayload?: any) {
    return withTenantTransaction(this.cls, async () => {
    const adjustment = await this.findOne(id);
    this.assertDraft(adjustment);

    if (!adjustment.lines || adjustment.lines.length === 0) {
      throw new BadRequestException('Cannot post a Stock Adjustment with no lines.');
    }

    // Claim the DRAFT -> POSTED transition atomically before writing any
    // ledger/GL entries — see goods-issue.service.ts's post() for the full
    // rationale (closes both the double-post race and the "retry after a
    // partial failure duplicates the successful lines" hole).
    const [claim] = await this.db
      .update(schema.stockAdjustment)
      .set({
        status: 'POSTED',
        posted_at: toMysqlTimestamp() as any,
        posted_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      })
      .where(and(eq(schema.stockAdjustment.adjustment_id, id), eq(schema.stockAdjustment.status, 'DRAFT')));

    if (claim.affectedRows === 0) {
      throw new BadRequestException('Stock Adjustment cannot be posted — it was already posted by another request.');
    }

    for (const line of adjustment.lines) {
      const quantity = Number(line.quantity);
      if (quantity > 0) {
        const ledgerEntry = await this.ledgerService.writePositiveEntry({
          tenantId,
          companyId: adjustment.company_id,
          itemId: line.item_id,
          documentType: 'STOCK_ADJUSTMENT',
          documentNo: adjustment.adjustment_no,
          documentLineId: line.line_id,
          postingDate: adjustment.posting_date,
          transactionType: 'VARIANCE_POSITIVE',
          quantity,
          uom: line.uom,
          rate: line.rate ? Number(line.rate) : 0,
          warehouseId: adjustment.warehouse_id,
          userId: userPayload?.userId,
        });
        await this.glPostingService.postInventoryLedgerEntry(ledgerEntry, userPayload?.userId);
      } else if (quantity < 0) {
        const ledgerEntry = await this.ledgerService.writeNegativeEntry({
          tenantId,
          companyId: adjustment.company_id,
          itemId: line.item_id,
          documentType: 'STOCK_ADJUSTMENT',
          documentNo: adjustment.adjustment_no,
          documentLineId: line.line_id,
          postingDate: adjustment.posting_date,
          transactionType: 'VARIANCE_NEGATIVE',
          quantity: Math.abs(quantity),
          uom: line.uom,
          warehouseId: adjustment.warehouse_id,
          userId: userPayload?.userId,
        });
        await this.glPostingService.postInventoryLedgerEntry(ledgerEntry, userPayload?.userId);
      }
    }

    await this.auditService.log({
      tenantId,
      companyId: adjustment.company_id,
      userId: userPayload?.userId,
      action: 'POST',
      entityName: 'stock_adjustment',
      entityId: id,
      newValues: { status: 'POSTED' },
    });

    return this.findOne(id);
    });
  }
}
