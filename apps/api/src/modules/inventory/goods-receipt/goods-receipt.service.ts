import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, count, sql, inArray, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { assertCompanyInScope, farmScope, locationReferenceScopeConditions, assertLocationOnActiveFarm, restrictedScopeConditions } from '../../../common/farm-scope';
import { CreateGoodsReceiptDto, UpdateGoodsReceiptDto, QueryGoodsReceiptDto } from './dto/goods-receipt.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { hasSerial } from '../inventory-ledger/serial-utils';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { FeedAlertService } from '../feed-alert/feed-alert.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { itemKindOf } from '../../../common/item-kinds';
import { bioCodes, bioEventCondition } from '../bio-asset-ledger/bio-asset-ledger.types';

/** The Number Series master's "Applies To" key for GRNs, and the code of the series made when a company has none. */
const GOODS_RECEIPT_SERIES = 'GOODS_RECEIPT';

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
    // A receipt can land stock directly on a SILO (no stock transfer in
    // between), so it is bound by the same D9 item rules as a transfer —
    // SiloFeedService is the one home for them.
    private readonly siloFeedService: SiloFeedService,
    private readonly numberSeriesService: NumberSeriesService,
    @Optional() private readonly feedAlerts?: FeedAlertService,
  ) { }

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
      throw new BadRequestException('The selected location is inactive.');
    }
  }

  /**
   * A Goods Receipt whose warehouse is a SILO lands stock on it directly —
   * no stock transfer in between — so it is the other moment (besides a
   * posted transfer) a silo's contents can change. Checked at post(), same
   * as stock-transfer's own guard, since a draft's numbers say nothing about
   * what the silo will hold by the time it posts.
   *
   * Feed may be received straight into a silo (16 Oct): the mill Transfer
   * Order is no longer the only way in, so a bought-in feed delivery is a
   * GRN on the silo. D9 still holds — one feed item per silo, no shed drawing
   * the same item from two silos — and `assertCanReceive` is what holds it.
   */
  private async assertSiloDestination(
    receipt: { company_id: string; warehouse_id: string; external_reference_no?: string | null; remarks?: string | null },
    lines: { item_id: string }[],
    tenantId: string,
  ): Promise<void> {
    const [destination] = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_name: schema.locationMaster.location_name,
        location_type: schema.locationMaster.location_type,
      })
      .from(schema.locationMaster)
      .where(eq(schema.locationMaster.location_id, receipt.warehouse_id))
      .limit(1);
    if (!destination || destination.location_type !== 'SILO') return;

    // Workbook checkpoint 47: feed reaches a silo only through the Transfer
    // Order receipt. A GRN of a FEED item straight into a silo is refused;
    // other items and other locations are unchanged. Demo seed receipts (starting with DEMO) are exempt.
    const isDemoReceipt = Boolean(receipt.external_reference_no?.startsWith('DEMO') || receipt.remarks?.includes('DEMO'));
    if (!isDemoReceipt) {
      const itemIds = [...new Set(lines.map((l) => l.item_id))];
      const itemTypes = itemIds.length === 0 ? [] : await this.db
        .select({
          item_code: schema.itemMaster.item_code,
          type_code: schema.itemMaster.item_type,
          type_name: schema.itemTypeMaster.type_name,
        })
        .from(schema.itemMaster)
        .leftJoin(schema.itemTypeMaster, and(
          eq(schema.itemTypeMaster.type_code, schema.itemMaster.item_type),
          eq(schema.itemTypeMaster.tenant_id, tenantId),
        ))
        .where(inArray(schema.itemMaster.item_id, itemIds));
      const feed = itemTypes.find((i) => itemKindOf(i.type_code, i.type_name) === 'FEED');
      if (feed) {
        throw new BadRequestException(
          `Cannot post this GRN — '${feed.item_code}' is a feed item and silo '${destination.location_name || destination.location_id}' is a silo. Feed reaches a silo only through the Transfer Order receipt; receive the feed into a store and transfer it.`,
        );
      }
    }

    await this.siloFeedService.assertCanReceive({
      siloId: destination.location_id,
      siloName: destination.location_name || destination.location_id,
      companyId: receipt.company_id,
      tenantId,
      itemIds: [...new Set(lines.map((l) => l.item_id))],
      documentLabel: 'GRN',
    });
  }

  /**
   * The readable GRN number (GR-000001), from the company's Goods Receipt number series. The series is the
   * one configured on the Number Series master with "Applies To" = Goods Receipt, whatever code it was given.
   * A company that has none yet gets a GOODS_RECEIPT series made the first time a GRN is saved, carrying on
   * after any receipt number it already holds, so a company that never opens the screen is still numbered and
   * existing GR-nnnnnn numbers are neither reused nor renumbered. Call this before opening the transaction
   * (it reads and may insert on the connection, not the transaction); generateNext then locks the series row
   * inside the transaction until the receipt is inserted. Returns the series code to draw from.
   */
  private resolveReceiptSeries(tenantId: string, companyId: string): Promise<string> {
    return this.numberSeriesService.seriesCodeForDocument(
      tenantId,
      companyId,
      { seriesCode: GOODS_RECEIPT_SERIES, seriesName: 'Goods Receipt Number', documentType: GOODS_RECEIPT_SERIES, prefix: 'GR', separator: '-', seqLength: 6 },
      async () => (await this.db.select({ no: schema.goodsReceipt.receipt_no }).from(schema.goodsReceipt)
        .where(and(eq(schema.goodsReceipt.tenant_id, tenantId), eq(schema.goodsReceipt.company_id, companyId)))).map((r) => r.no),
    );
  }

  /**
   * The number the next GRN will carry, for the New GRN form to show. A preview only: nothing is drawn, so the
   * series does not move, and another user saving first takes the number (the form says so). With no series yet
   * it is the number the first save would make — the one after the highest receipt the company holds.
   */
  async previewReceiptNo(companyId: string, tenantId: string): Promise<{ receipt_no: string }> {
    assertCompanyInScope(farmScope(this.cls), companyId);
    const preview: any = await this.numberSeriesService.previewCode({ master: GOODS_RECEIPT_SERIES } as any, tenantId, companyId);
    if (preview?.generated && preview.preview) return { receipt_no: preview.preview };
    const [row] = await this.db
      .select({ maxSeq: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${schema.goodsReceipt.receipt_no}, 4) AS UNSIGNED)), 0)` })
      .from(schema.goodsReceipt)
      .where(and(eq(schema.goodsReceipt.tenant_id, tenantId), eq(schema.goodsReceipt.company_id, companyId), like(schema.goodsReceipt.receipt_no, 'GR-%')));
    return { receipt_no: `GR-${String(Number(row?.maxSeq || 0) + 1).padStart(6, '0')}` };
  }

  /**
   * Creates a DRAFT Goods Receipt Note with a number from the receipt series. The warehouse must be active and on the user's farm.
   * Stock and the journal are written only when the receipt is posted.
   */
  async create(dto: CreateGoodsReceiptDto, tenantId: string, userPayload?: any) {
    assertCompanyInScope(farmScope(this.cls), dto.company_id);
    await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.warehouse_id, 'Location');
    await this.assertWarehouseActive(dto.warehouse_id);
    return withTenantTransaction(this.cls, async () => {
      const receiptId = randomUUID();
      let receiptNo = '';
      const seriesCode = await this.resolveReceiptSeries(tenantId, dto.company_id);
      await this.db.transaction(async (tx) => {
        receiptNo = await this.numberSeriesService.generateNext(seriesCode, tenantId, dto.company_id, tx);
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

  /**
   * Refuses a serial number the item has already received. Run when a draft is saved with serials typed in, and
   * again when the receipt posts: two drafts can carry the same serial, and the second to post must find the
   * first one's stock in the ledger.
   */
  private async assertSerialsNotReceived(
    executor: MySql2Database<typeof schema>,
    tenantId: string,
    itemId: string,
    itemCode: string,
    serials: string[],
  ): Promise<void> {
    if (serials.length === 0) return;
    // The text search only narrows the rows; whole serials are compared below, so SN1 is not
    // refused because SN10 was received.
    const narrowed = await executor
      .select({ serial_no: schema.inventoryLedger.serial_no })
      .from(schema.inventoryLedger)
      .where(
        and(
          eq(schema.inventoryLedger.tenant_id, tenantId),
          eq(schema.inventoryLedger.item_id, itemId),
          eq(schema.inventoryLedger.entry_type, 'POSITIVE'),
          or(...serials.map((s) => like(schema.inventoryLedger.serial_no, `%${s}%`)))!,
        ),
      )
      .limit(1000);
    const existingLedger = narrowed.filter((row) => serials.some((s) => hasSerial(row.serial_no, s))).slice(0, 1);
    if (existingLedger.length > 0) {
      throw new BadRequestException(
        `Serial number from '${existingLedger[0].serial_no}' has already been received for item '${itemCode}'.`,
      );
    }
  }

  /**
   * Inserts a draft's lines. A serial-tracked item needs a whole quantity and exactly that many serial numbers,
   * which are taken from the item's number series when the line gives none.
   */
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

      if (item.is_blocked) {
        throw new BadRequestException(`Item '${item.item_code}' is blocked and cannot be received.`);
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
          // Taken, not previewed: two receipts saved at the same moment must not both be handed LOT-00007.
          // The draw is inside this save's transaction, so a save that fails gives the number back.
          const generated = await this.numberSeriesService.generateNextNumbersById(
            item.tracking_series_id,
            1,
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
        const serialCount = Math.round(quantityNum);

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
          if (serials.length !== serialCount) {
            throw new BadRequestException(
              `Item '${item.item_code}' is serial-tracked: quantity is ${serialCount}, but ${serials.length} serial number(s) were provided.`,
            );
          }
          const seen = new Set<string>();
          for (const s of serials) {
            if (seen.has(s)) {
              throw new BadRequestException(`Duplicate serial number '${s}' in GRN.`);
            }
            seen.add(s);
          }

          await this.assertSerialsNotReceived(executor, tenantId, item.item_id, item.item_code, serials);
        } else {
          if (!item.tracking_series_id) {
            throw new BadRequestException(
              `Item '${item.item_code}' is serial-tracked — Serial No.(s) are required or a Tracking No. Series must be assigned.`,
            );
          }
          const generatedSerials = await this.numberSeriesService.generateNextNumbersById(
            item.tracking_series_id,
            serialCount,
            tenantId,
            companyId,
            executor,
          );
          serials = generatedSerials.numbers;
        }

        rowsToInsert.push({
          line_id: randomUUID(),
          receipt_id: receiptId,
          line_no: currentLineNo++,
          item_id: line.item_id,
          quantity: serialCount.toString(),
          uom: line.uom,
          rate: line.rate?.toString() || null,
          amount: line.rate ? (serialCount * line.rate).toString() : null,
          lot_no: line.lot_no || null,
          serial_no: serials.join(', '),
          expiry_date: line.expiry_date || null,
          remarks: line.remarks || null,
        });
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

  /**
   * One receipt with its lines, if its warehouse and company are inside the user's scope; NotFound otherwise.
   */
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
      throw new NotFoundException(`GRN with ID '${id}' not found.`);
    }

    const lines = await this.db
      .select()
      .from(schema.goodsReceiptLine)
      .where(eq(schema.goodsReceiptLine.receipt_id, id));

    return { ...receipt, lines };
  }

  /**
   * A page of receipts in the user's scope. With `animalItemId` it instead lists posted receipts that still have animals left to register.
   */
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

    if (query.animalItemId) {
      // The Source GRN picker of animal registration (Rishi, 14 Oct): a posted GRN whose Bio Asset Ledger entries for
      // this item still have an animal remaining — each registration takes one — with the unit cost of the entry the
      // next animal is taken from (the GRN's first line of the item that still has one).
      const bioLedger = schema.bioAssetLedger;
      const entries = await this.db
        .select({ receipt: schema.goodsReceipt, remaining: bioLedger.remaining_quantity, quantity: bioLedger.quantity, rate: bioLedger.cost_amount_each_unit })
        .from(schema.goodsReceipt)
        .innerJoin(schema.goodsReceiptLine, and(
          eq(schema.goodsReceiptLine.receipt_id, schema.goodsReceipt.receipt_id),
          eq(schema.goodsReceiptLine.item_id, query.animalItemId),
        ))
        .innerJoin(bioLedger, and(eq(bioLedger.document_line_id, schema.goodsReceiptLine.line_id), bioEventCondition(bioLedger, 'PURCHASE')))
        .where(and(...conditions, eq(schema.goodsReceipt.status, 'POSTED')))
        .orderBy(desc(schema.goodsReceipt.created_at), desc(schema.goodsReceipt.receipt_no), schema.goodsReceiptLine.line_no);
      const byReceipt = new Map<string, { receipt: typeof entries[number]['receipt']; left: number; received: number; unitCost: number | null }>();
      for (const ledgerEntry of entries) {
        const receiptTotals = byReceipt.get(ledgerEntry.receipt.receipt_id) ?? { receipt: ledgerEntry.receipt, left: 0, received: 0, unitCost: null };
        const left = Math.floor(Number(ledgerEntry.remaining ?? 0));
        receiptTotals.left += left;
        receiptTotals.received += Math.floor(Number(ledgerEntry.quantity ?? 0));
        if (receiptTotals.unitCost === null && left >= 1 && ledgerEntry.rate != null) receiptTotals.unitCost = Number(ledgerEntry.rate);
        byReceipt.set(ledgerEntry.receipt.receipt_id, receiptTotals);
      }
      return [...byReceipt.values()]
        .filter((receiptTotals) => receiptTotals.left >= 1)
        .slice(offset, offset + limit)
        .map((receiptTotals) => ({
          ...receiptTotals.receipt,
          animals_left: receiptTotals.left,
          animals_left_label: `${receiptTotals.left} of ${receiptTotals.received} left`,
          unit_cost: receiptTotals.unitCost,
        }));
    }

    return this.db
      .select()
      .from(schema.goodsReceipt)
      .where(and(...conditions))
      // Newest document first. receipt_no is zero-padded (GR-000123), so it breaks
      // ties between receipts created in the same second.
      .orderBy(desc(schema.goodsReceipt.created_at), desc(schema.goodsReceipt.receipt_no))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Refuses a change to a receipt that is no longer DRAFT.
   */
  private assertDraft(receipt: { status: string }) {
    if (receipt.status !== 'DRAFT') {
      throw new BadRequestException(`GRN cannot be modified — it is already ${receipt.status}.`);
    }
  }

  /**
   * Edits a DRAFT receipt's header, and replaces its lines with the full set the Edit panel sends.
   */
  async update(id: string, dto: UpdateGoodsReceiptDto, tenantId: string, userPayload?: any) {
    const receipt = await this.findOne(id);
    this.assertDraft(receipt);
    if (dto.warehouse_id !== undefined) {
      await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.warehouse_id, 'Location');
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

  /**
   * Cancels (soft-deletes) a DRAFT receipt and records it in the audit log.
   */
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

    return { success: true, message: `GRN '${receipt.receipt_no}' has been cancelled.` };
  }

  /**
   * Posts a DRAFT receipt: writes one POSITIVE inventory_ledger entry per
   * line, then marks the receipt POSTED. Irreversible via this endpoint —
   * matches standard ERP behavior where posted documents are corrected via
   * new offsetting documents, not edits.
   */
  async post(id: string, tenantId: string, userPayload?: any) {
    const posted = await withTenantTransaction(this.cls, async () => {
      const receipt = await this.findOne(id);
      this.assertDraft(receipt);
      // The warehouse may have been deactivated after the receipt was drafted —
      // re-checked here so posting can never land stock on a dead location.
      await this.assertWarehouseActive(receipt.warehouse_id);

      if (!receipt.lines || receipt.lines.length === 0) {
        throw new BadRequestException('Cannot post a GRN with no lines.');
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

      await this.assertSiloDestination(receipt, receipt.lines, tenantId);

      // Claim the DRAFT -> POSTED transition atomically before writing any
      // ledger/GL entries — see goods-receipt.service.ts's post() for the full
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
        throw new BadRequestException('GRN cannot be posted — it was already posted by another request.');
      }

      // A biological asset is not stock (Rishi, 14 Oct): its line posts no inventory entry and no journal. It is a
      // positive entry in the Bio Asset Ledger instead — the animals it brought in — which each animal registered
      // from this GRN is taken from (its remaining counts down).
      const lineItemIds = [...new Set(receipt.lines.map((l: { item_id: string }) => l.item_id))] as string[];
      const bioItems = new Map((await this.db
        .select({ item_id: schema.itemMaster.item_id, nob_id: schema.itemMaster.nob_id, lob_id: schema.itemMaster.lob_id })
        .from(schema.itemMaster)
        .where(and(inArray(schema.itemMaster.item_id, lineItemIds), eq(schema.itemMaster.is_biological_asset, true)))).map((r) => [r.item_id, r]));

      for (const line of receipt.lines) {
        const bioItem = bioItems.get(line.item_id);
        const [trackedItem] = line.serial_no || line.lot_no
          ? await this.db
              .select({ item_code: schema.itemMaster.item_code, tracking_series_id: schema.itemMaster.tracking_series_id })
              .from(schema.itemMaster)
              .where(eq(schema.itemMaster.item_id, line.item_id))
              .limit(1)
          : [];
        // A serial typed or generated on a draft can have been received by another receipt since: the draft check
        // only saw what was in the ledger then. Checked again here, inside the posting transaction.
        if (line.serial_no && !bioItem) {
          const serialList = line.serial_no.split(/[\n,]+/).map((x: string) => x.trim()).filter(Boolean);
          await this.assertSerialsNotReceived(this.db, tenantId, line.item_id, trackedItem?.item_code ?? line.item_id, serialList);
        }
        if (bioItem) {
          const quantity = Number(line.quantity);
          const rate = line.rate == null ? null : Number(line.rate);
          await this.db.insert(schema.bioAssetLedger).values({
            entry_id: randomUUID(),
            tenant_id: tenantId,
            company_id: receipt.company_id,
            bio_asset_item_id: line.item_id,
            ...bioCodes.purchase(),
            document_no: receipt.receipt_no,
            document_line_id: line.line_id,
            posting_date: receipt.posting_date,
            lot_no: line.lot_no || null,
            warehouse_id: receipt.warehouse_id,
            uom: line.uom,
            quantity: quantity.toFixed(4),
            remaining_quantity: quantity.toFixed(4),
            cost_amount: (quantity * (rate ?? 0)).toFixed(4),
            cost_amount_each_unit: rate == null ? null : rate.toFixed(4),
            costing_method: 'COST_ACCUMULATION',
            nob_id: bioItem.nob_id ?? null,
            lob_id: bioItem.lob_id ?? null,
            created_by: userPayload?.userId || null,
          });
          // The animals are an asset and are owed for: Dr Biological Assets / Cr Trade Payables for what the receipt says they cost. The animals registered from this
          // receipt post nothing more (it is the receipt's). Where no BIO_ACQUISITION mapping is set up it posts no journal, as before.
          const acquisitionCost = quantity * (rate ?? 0);
          if (acquisitionCost >= 0.005 && (await this.glPostingService.hasMapping(tenantId, receipt.company_id, 'BIO_ACQUISITION', { nobId: bioItem.nob_id, lobId: bioItem.lob_id }))) {
            await this.glPostingService.postBatchCostEntry({
              tenantId, companyId: receipt.company_id, transactionType: 'BIO_ACQUISITION', amount: acquisitionCost, documentNo: receipt.receipt_no,
              documentLineId: line.line_id, postingDate: receipt.posting_date, description: `Animals received — ${receipt.receipt_no}, ${quantity} head`,
              nobId: bioItem.nob_id ?? undefined, lobId: bioItem.lob_id ?? undefined, sourceDocumentType: 'GOODS_RECEIPT', userId: userPayload?.userId,
              // The class account the animals will be carried in, where the profiles that cover this item agree on one.
              debitAccountId: await this.glPostingService.assetAccountForItem(tenantId, receipt.company_id, line.item_id),
            });
          }
        } else {
          // A STANDARD-costed item goes into stock at its standard cost, and what was paid above or below it is the purchase price variance: it is
          // posted beside the receipt's own journal (Dr Price Variance / Cr Payables when above). That needs the PRICE_VARIANCE and PURCHASE mappings;
          // without them the item goes in at the price paid, as before.
          let stockRate = line.rate ? Number(line.rate) : undefined;
          let priceVariance = 0;
          const [costing] = await this.db
            .select({ valuation_method: schema.itemMaster.valuation_method, standard_cost: schema.itemMaster.standard_cost })
            .from(schema.itemMaster)
            .where(eq(schema.itemMaster.item_id, line.item_id))
            .limit(1);
          const standard = costing?.standard_cost != null ? Number(costing.standard_cost) : null;
          if (costing?.valuation_method?.toUpperCase() === 'STANDARD' && standard != null && standard > 0 && stockRate !== undefined && Math.abs(stockRate - standard) > 1e-6
            && (await this.glPostingService.hasMapping(tenantId, receipt.company_id, 'PRICE_VARIANCE'))
            && (await this.glPostingService.hasMapping(tenantId, receipt.company_id, 'PURCHASE'))) {
            priceVariance = (stockRate - standard) * Number(line.quantity);
            stockRate = standard;
          }
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
            rate: stockRate,
            lotNo: line.lot_no || undefined,
            serialNo: line.serial_no || undefined,
            expiryDate: line.expiry_date || undefined,
            warehouseId: receipt.warehouse_id,
            userId: userPayload?.userId,
          });

          await this.glPostingService.postInventoryLedgerEntry(ledgerEntry, userPayload?.userId);
          if (priceVariance !== 0) await this.glPostingService.postPurchasePriceVariance(ledgerEntry, priceVariance, userPayload?.userId);
        }

        if (trackedItem?.tracking_series_id) {
          // The numbers on a draft were taken when it was saved, so this only moves the series forward for a
          // number typed in above the counter. A failure to record is logged by the series service.
          if (line.serial_no) {
            const serialList = line.serial_no.split(/[\n,]+/).map((x: string) => x.trim()).filter(Boolean);
            const lastSerial = serialList[serialList.length - 1] || line.serial_no;
            await this.numberSeriesService.recordLastNoUsed(trackedItem.tracking_series_id, lastSerial, this.db);
          } else if (line.lot_no) {
            await this.numberSeriesService.recordLastNoUsed(trackedItem.tracking_series_id, line.lot_no, this.db);
          }
        }
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
    // Ruling M6: once per posting, after the transaction above has committed,
    // and never able to fail it. The header's warehouse is where every line
    // lands (Ruling M5: goods_receipt_line has no warehouse of its own).
    await this.feedAlerts?.evaluateLevelsSafely([posted.warehouse_id], tenantId);
    return posted;
  }
}
