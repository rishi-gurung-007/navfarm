import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, count, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { assertCompanyInScope, farmScope, locationReferenceScopeConditions, assertLocationOnActiveFarm, restrictedScopeConditions } from '../../../common/farm-scope';
import { CreateGoodsReceiptDto, UpdateGoodsReceiptDto, QueryGoodsReceiptDto } from './dto/goods-receipt.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class GoodsReceiptService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly ledgerService: InventoryLedgerService,
    private readonly glPostingService: GlPostingService,
    private readonly numberSeriesService: NumberSeriesService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  // `executor` must be the active transaction when called from inside one —
  // `.for('update')` locks the counted rows so a second concurrent call
  // blocks until the first commits its insert, instead of both reading the
  // same count and generating the same receipt number (matches the pattern
  // already used by the other 3 document types' number generators).
  /**
   * A warehouse taken out of service (deactivated or soft-deleted in
   * location_master) must not accept new stock. assertLocationOnActiveFarm
   * only checks the warehouse is on the right farm/company/LOB — it says
   * nothing about is_active, and skips entirely for unrestricted callers — so
   * this runs independently on create, update and post.
   */
  private async assertWarehouseActive(warehouseId: string): Promise<void> {
    const [row] = await this.db
      .select({ is_active: schema.locationMaster.is_active, deleted_at: schema.locationMaster.deleted_at })
      .from(schema.locationMaster)
      .where(eq(schema.locationMaster.location_id, warehouseId))
      .limit(1);
    if (row && (row.is_active === false || row.deleted_at)) {
      throw new BadRequestException('The selected warehouse is inactive.');
    }
  }

  private async generateReceiptNo(tenantId: string, companyId: string, executor: MySql2Database<typeof schema> = this.db): Promise<string> {
    const [row] = await executor
      .select({ total: count() })
      .from(schema.goodsReceipt)
      .where(and(eq(schema.goodsReceipt.tenant_id, tenantId), eq(schema.goodsReceipt.company_id, companyId)))
      .for('update');
    const seq = Number(row?.total || 0) + 1;
    return `GR-${String(seq).padStart(6, '0')}`;
  }

  async create(dto: CreateGoodsReceiptDto, tenantId: string, userPayload?: any) {
    assertCompanyInScope(farmScope(this.cls), dto.company_id);
    await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.warehouse_id, 'Warehouse');
    await this.assertWarehouseActive(dto.warehouse_id);
    return withTenantTransaction(this.cls, async () => {
    const receiptId = randomUUID();
    let receiptNo = '';
    await this.db.transaction(async (tx) => {
      receiptNo = await this.generateReceiptNo(tenantId, dto.company_id, tx);
      await tx.insert(schema.goodsReceipt).values({
        receipt_id: receiptId,
        tenant_id: tenantId,
        company_id: dto.company_id,
        receipt_no: receiptNo,
        posting_date: dto.posting_date,
        warehouse_id: dto.warehouse_id,
        supplier_id: dto.supplier_id || null,
        external_reference_no: dto.external_reference_no || null,
        remarks: dto.remarks || null,
        status: 'DRAFT',
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      });
      await this.insertLines(receiptId, dto.lines, dto.company_id, tenantId, tx);
    });

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'goods_receipt',
      entityId: receiptId,
      newValues: { receipt_no: receiptNo, ...dto },
    });

    return this.findOne(receiptId);
    });
  }

  private async insertLines(
    receiptId: string,
    lines: CreateGoodsReceiptDto['lines'],
    companyId: string,
    tenantId: string,
    executor: MySql2Database<typeof schema> = this.db,
  ) {
    const rowsToInsert: Array<typeof schema.goodsReceiptLine.$inferInsert> = [];
    let currentLineNo = 1;

    for (const line of lines) {
      const [item] = await executor
        .select()
        .from(schema.itemMaster)
        .where(eq(schema.itemMaster.item_id, line.item_id))
        .limit(1);

      if (!item) {
        throw new BadRequestException(`Item with ID '${line.item_id}' not found.`);
      }

      const quantityNum = Number(line.quantity);
      if (Number.isNaN(quantityNum) || quantityNum <= 0) {
        throw new BadRequestException(`Quantity for item '${item.item_code}' must be a positive number.`);
      }

      if (item.is_lot_tracked) {
        let lotNo = line.lot_no?.trim() || null;
        if (!lotNo) {
          if (!item.tracking_series_id) {
            throw new BadRequestException(
              `Item '${item.item_code}' is lot-tracked — a Lot No. is required or a Tracking No. Series must be assigned.`,
            );
          }
          const generated = await this.numberSeriesService.generateNextNumberById(
            item.tracking_series_id,
            tenantId,
            companyId,
            executor,
          );
          lotNo = generated.next_number;
        }

        rowsToInsert.push({
          line_id: randomUUID(),
          receipt_id: receiptId,
          line_no: currentLineNo++,
          item_id: line.item_id,
          quantity: quantityNum.toString(),
          uom: line.uom,
          rate: line.rate?.toString() || null,
          amount: line.rate ? (quantityNum * line.rate).toString() : null,
          lot_no: lotNo,
          serial_no: null,
          expiry_date: line.expiry_date || null,
          remarks: line.remarks || null,
        });
      } else if (item.is_serial_tracked) {
        if (!Number.isInteger(quantityNum)) {
          throw new BadRequestException(
            `Item '${item.item_code}' is serial-tracked — quantity must be a whole positive integer.`,
          );
        }
        const qty = Math.round(quantityNum);

        let serials: string[] = [];
        if (line.serials && Array.isArray(line.serials) && line.serials.length > 0) {
          serials = line.serials.map((s) => String(s).trim()).filter(Boolean);
        } else if (line.serial_no?.trim()) {
          serials = line.serial_no
            .split(/[\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        }

        if (serials.length > 0) {
          if (serials.length !== qty) {
            throw new BadRequestException(
              `Item '${item.item_code}' is serial-tracked: quantity is ${qty}, but ${serials.length} serial number(s) were provided.`,
            );
          }
          const seen = new Set<string>();
          for (const s of serials) {
            if (seen.has(s)) {
              throw new BadRequestException(`Duplicate serial number '${s}' in Goods Receipt.`);
            }
            seen.add(s);
          }

          const existingLedger = await executor
            .select({ serial_no: schema.inventoryLedger.serial_no })
            .from(schema.inventoryLedger)
            .where(
              and(
                eq(schema.inventoryLedger.tenant_id, tenantId),
                eq(schema.inventoryLedger.item_id, item.item_id),
                eq(schema.inventoryLedger.entry_type, 'POSITIVE'),
                inArray(schema.inventoryLedger.serial_no, serials),
              ),
            )
            .limit(1);

          if (existingLedger.length > 0) {
            throw new BadRequestException(
              `Serial number '${existingLedger[0].serial_no}' has already been received for item '${item.item_code}'.`,
            );
          }
        } else {
          if (!item.tracking_series_id) {
            throw new BadRequestException(
              `Item '${item.item_code}' is serial-tracked — Serial No.(s) are required or a Tracking No. Series must be assigned.`,
            );
          }
          for (let i = 0; i < qty; i++) {
            const gen = await this.numberSeriesService.generateNextNumberById(
              item.tracking_series_id,
              tenantId,
              companyId,
              executor,
            );
            serials.push(gen.next_number);
          }
        }

        for (const sn of serials) {
          rowsToInsert.push({
            line_id: randomUUID(),
            receipt_id: receiptId,
            line_no: currentLineNo++,
            item_id: line.item_id,
            quantity: '1',
            uom: line.uom,
            rate: line.rate?.toString() || null,
            amount: line.rate ? line.rate.toString() : null,
            lot_no: line.lot_no || null,
            serial_no: sn,
            expiry_date: line.expiry_date || null,
            remarks: line.remarks || null,
          });
        }
      } else {
        rowsToInsert.push({
          line_id: randomUUID(),
          receipt_id: receiptId,
          line_no: currentLineNo++,
          item_id: line.item_id,
          quantity: quantityNum.toString(),
          uom: line.uom,
          rate: line.rate?.toString() || null,
          amount: line.rate ? (quantityNum * line.rate).toString() : null,
          lot_no: line.lot_no || null,
          serial_no: line.serial_no || null,
          expiry_date: line.expiry_date || null,
          remarks: line.remarks || null,
        });
      }
    }

    if (rowsToInsert.length > 0) {
      await executor.insert(schema.goodsReceiptLine).values(rowsToInsert);
    }
  }

  async findOne(id: string) {
    const scope = farmScope(this.cls);
    const conditions = [eq(schema.goodsReceipt.receipt_id, id), isNull(schema.goodsReceipt.deleted_at)];
    conditions.push(...locationReferenceScopeConditions(scope, schema.goodsReceipt.warehouse_id));
    conditions.push(...restrictedScopeConditions(scope, { companyId: schema.goodsReceipt.company_id }));

    const [receipt] = await this.db
      .select()
      .from(schema.goodsReceipt)
      .where(and(...conditions))
      .limit(1);

    if (!receipt) {
      throw new NotFoundException(`Goods Receipt with ID '${id}' not found.`);
    }

    const lines = await this.db
      .select()
      .from(schema.goodsReceiptLine)
      .where(eq(schema.goodsReceiptLine.receipt_id, id));

    return { ...receipt, lines };
  }

  async findAll(query: QueryGoodsReceiptDto, tenantId: string) {
    const conditions: any[] = [eq(schema.goodsReceipt.tenant_id, tenantId), isNull(schema.goodsReceipt.deleted_at)];

    const scope = farmScope(this.cls);
    conditions.push(...locationReferenceScopeConditions(scope, schema.goodsReceipt.warehouse_id));
    conditions.push(...restrictedScopeConditions(scope, { companyId: schema.goodsReceipt.company_id }));

    if (query.companyId) conditions.push(eq(schema.goodsReceipt.company_id, query.companyId));
    if (query.status) conditions.push(eq(schema.goodsReceipt.status, query.status));
    if (query.warehouseId) conditions.push(eq(schema.goodsReceipt.warehouse_id, query.warehouseId));
    if (query.search) {
      conditions.push(
        or(
          like(schema.goodsReceipt.receipt_no, `%${query.search}%`),
          like(schema.goodsReceipt.external_reference_no, `%${query.search}%`)
        )
      );
    }

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.goodsReceipt)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }

  private assertDraft(receipt: { status: string }) {
    if (receipt.status !== 'DRAFT') {
      throw new BadRequestException(`Goods Receipt cannot be modified — it is already ${receipt.status}.`);
    }
  }

  async update(id: string, dto: UpdateGoodsReceiptDto, tenantId: string, userPayload?: any) {
    const receipt = await this.findOne(id);
    this.assertDraft(receipt);
    if (dto.warehouse_id !== undefined) {
      await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.warehouse_id, 'Warehouse');
      await this.assertWarehouseActive(dto.warehouse_id);
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };
    if (dto.warehouse_id !== undefined) updates.warehouse_id = dto.warehouse_id;
    if (dto.posting_date !== undefined) updates.posting_date = dto.posting_date;
    if (dto.supplier_id !== undefined) updates.supplier_id = dto.supplier_id;
    if (dto.external_reference_no !== undefined) updates.external_reference_no = dto.external_reference_no;
    if (dto.remarks !== undefined) updates.remarks = dto.remarks;

    // The Edit panel always sends the full `lines` array, so every save
    // deletes and reinserts them. Unwrapped, a failure mid-insertLines (a bad
    // item_id, a UOM FK) leaves the header updated and the receipt with zero
    // lines, which post() then refuses forever — matches create()/post(),
    // which already run their multi-step writes inside one transaction.
    return withTenantTransaction(this.cls, async () => {
      await this.db.transaction(async (tx) => {
        await tx.update(schema.goodsReceipt).set(updates).where(eq(schema.goodsReceipt.receipt_id, id));

        if (dto.lines) {
          await tx.delete(schema.goodsReceiptLine).where(eq(schema.goodsReceiptLine.receipt_id, id));
          await this.insertLines(id, dto.lines, receipt.company_id, tenantId, tx);
        }
      });

      await this.auditService.log({
        tenantId,
        companyId: receipt.company_id,
        userId: userPayload?.userId,
        action: 'UPDATE',
        entityName: 'goods_receipt',
        entityId: id,
        oldValues: receipt,
        newValues: updates,
      });

      return this.findOne(id);
    });
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const receipt = await this.findOne(id);
    this.assertDraft(receipt);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.goodsReceipt)
      .set({ status: 'CANCELLED', deleted_at: deletedTime as any, updated_by: userPayload?.userId || null })
      .where(eq(schema.goodsReceipt.receipt_id, id));

    await this.auditService.log({
      tenantId,
      companyId: receipt.company_id,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'goods_receipt',
      entityId: id,
      oldValues: receipt,
      newValues: { status: 'CANCELLED', deleted_at: deletedTime },
    });

    return { success: true, message: `Goods Receipt '${receipt.receipt_no}' has been cancelled.` };
  }

  /**
   * Posts a DRAFT receipt: writes one POSITIVE inventory_ledger entry per
   * line, then marks the receipt POSTED. Irreversible via this endpoint —
   * matches standard ERP behavior where posted documents are corrected via
   * new offsetting documents, not edits.
   */
  async post(id: string, tenantId: string, userPayload?: any) {
    return withTenantTransaction(this.cls, async () => {
    const receipt = await this.findOne(id);
    this.assertDraft(receipt);
    // The warehouse may have been deactivated after the receipt was drafted —
    // re-checked here so posting can never land stock on a dead location.
    await this.assertWarehouseActive(receipt.warehouse_id);

    if (!receipt.lines || receipt.lines.length === 0) {
      throw new BadRequestException('Cannot post a Goods Receipt with no lines.');
    }

    // Spec: ANIMAL_SUPPLIER vendors must have a valid health certificate on file before
    // their receipts can post — see supplier.service.ts's vendor_type/health_cert_url fields.
    if (receipt.supplier_id) {
      const [supplier] = await this.db
        .select()
        .from(schema.supplierMaster)
        .where(eq(schema.supplierMaster.supplier_id, receipt.supplier_id))
        .limit(1);
      if (supplier?.vendor_type === 'ANIMAL_SUPPLIER' && !supplier.health_cert_url) {
        throw new BadRequestException(
          `Supplier '${supplier.supplier_name}' is an ANIMAL_SUPPLIER without a health certificate on file — cannot post this receipt.`
        );
      }
    }

    // Claim the DRAFT -> POSTED transition atomically before writing any
    // ledger/GL entries — see goods-issue.service.ts's post() for the full
    // rationale (closes both the double-post race and the "retry after a
    // partial failure duplicates the successful lines" hole).
    const [claim] = await this.db
      .update(schema.goodsReceipt)
      .set({
        status: 'POSTED',
        posted_at: toMysqlTimestamp() as any,
        posted_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      })
      .where(and(eq(schema.goodsReceipt.receipt_id, id), eq(schema.goodsReceipt.status, 'DRAFT')));

    if (claim.affectedRows === 0) {
      throw new BadRequestException('Goods Receipt cannot be posted — it was already posted by another request.');
    }

    for (const line of receipt.lines) {
      const ledgerEntry = await this.ledgerService.writePositiveEntry({
        tenantId,
        companyId: receipt.company_id,
        itemId: line.item_id,
        documentType: 'GOODS_RECEIPT',
        documentNo: receipt.receipt_no,
        documentLineId: line.line_id,
        postingDate: receipt.posting_date,
        externalReferenceNo: receipt.external_reference_no || undefined,
        transactionType: 'PURCHASE',
        quantity: Number(line.quantity),
        uom: line.uom,
        rate: line.rate ? Number(line.rate) : undefined,
        lotNo: line.lot_no || undefined,
        serialNo: line.serial_no || undefined,
        expiryDate: line.expiry_date || undefined,
        warehouseId: receipt.warehouse_id,
        userId: userPayload?.userId,
      });

      await this.glPostingService.postInventoryLedgerEntry(ledgerEntry, userPayload?.userId);
    }

    await this.auditService.log({
      tenantId,
      companyId: receipt.company_id,
      userId: userPayload?.userId,
      action: 'POST',
      entityName: 'goods_receipt',
      entityId: id,
      newValues: { status: 'POSTED' },
    });

    return this.findOne(id);
    });
  }
}
