import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, like, isNull, count, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { assertCompanyInScope, farmScope, locationOnFarm, locationReferenceScopeConditions, assertLocationOnActiveFarm, restrictedScopeConditions } from '../../../common/farm-scope';
import { CreateStockTransferDto, UpdateStockTransferDto, QueryStockTransferDto } from './dto/stock-transfer.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { UomService } from '../../master-data/uom/uom.service';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class StockTransferService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly ledgerService: InventoryLedgerService,
    private readonly glPostingService: GlPostingService,
    // Silo capacity is kilograms and a feed line can be entered in any unit
    // the item is stocked in, so the capacity guard below needs the tenant's
    // own uom_conversion_master rather than an assumption about the unit.
    private readonly uomService: UomService,
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
  // same count and generating the same transfer number.
  private async generateTransferNo(tenantId: string, companyId: string, executor: MySql2Database<typeof schema> = this.db): Promise<string> {
    const [row] = await executor
      .select({ total: count() })
      .from(schema.stockTransfer)
      .where(and(eq(schema.stockTransfer.tenant_id, tenantId), eq(schema.stockTransfer.company_id, companyId)))
      .for('update');
    const seq = Number(row?.total || 0) + 1;
    return `TR-${String(seq).padStart(6, '0')}`;
  }

  async create(dto: CreateStockTransferDto, tenantId: string, userPayload?: any) {
    assertCompanyInScope(farmScope(this.cls), dto.company_id);
    return withTenantTransaction(this.cls, async () => {
    if (dto.from_warehouse_id === dto.to_warehouse_id) {
      throw new BadRequestException('Source and destination warehouse must be different.');
    }
    await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.from_warehouse_id, 'Source warehouse');
    await assertLocationOnActiveFarm(
      this.db,
      { ...farmScope(this.cls), farmId: null },
      dto.to_warehouse_id,
      'Destination warehouse',
    );

    const transferId = randomUUID();
    const transferNo = await this.db.transaction(async (tx) => {
      const no = await this.generateTransferNo(tenantId, dto.company_id, tx);
      await tx.insert(schema.stockTransfer).values({
        transfer_id: transferId,
        tenant_id: tenantId,
        company_id: dto.company_id,
        transfer_no: no,
        posting_date: dto.posting_date,
        from_warehouse_id: dto.from_warehouse_id,
        to_warehouse_id: dto.to_warehouse_id,
        remarks: dto.remarks || null,
        status: 'DRAFT',
        created_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      });
      return no;
    });

    await this.insertLines(transferId, dto.lines);

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'stock_transfer',
      entityId: transferId,
      newValues: { transfer_no: transferNo, ...dto },
    });

    return this.findOne(transferId);
    });
  }

  private async insertLines(transferId: string, lines: CreateStockTransferDto['lines']) {
    await this.db.insert(schema.stockTransferLine).values(
      lines.map((line, idx) => ({
        line_id: randomUUID(),
        transfer_id: transferId,
        line_no: idx + 1,
        item_id: line.item_id,
        quantity: line.quantity.toString(),
        uom: line.uom,
        lot_no: line.lot_no || null,
        serial_no: line.serial_no || null,
        remarks: line.remarks || null,
      }))
    );
  }

  /**
   * The row every mutation authorizes through, locked. findOne() shows a
   * transfer to either farm it touches, but only the source farm may change
   * it: through to_warehouse_id a destination-farm manager could rewrite a
   * draft's quantities and post it, draining the source farm's warehouse. So
   * farm, LOB and company sit on from_warehouse_id only.
   */
  private async loadForMutation(id: string, tenantId: string) {
    const scope = farmScope(this.cls);
    const [transfer] = await this.db
      .select()
      .from(schema.stockTransfer)
      .where(and(
        eq(schema.stockTransfer.transfer_id, id),
        eq(schema.stockTransfer.tenant_id, tenantId),
        isNull(schema.stockTransfer.deleted_at),
        ...locationReferenceScopeConditions(scope, schema.stockTransfer.from_warehouse_id),
        ...restrictedScopeConditions(scope, { companyId: schema.stockTransfer.company_id }),
      ))
      .for('update');

    if (!transfer) {
      throw new NotFoundException(`Stock Transfer with ID '${id}' not found.`);
    }

    const lines = await this.db
      .select()
      .from(schema.stockTransferLine)
      .where(eq(schema.stockTransferLine.transfer_id, id));

    return { ...transfer, lines };
  }

  /** The same two checks create() applies: source on the active farm, destination in the company and LOB. */
  private async assertWarehouses(fromWarehouseId: string, toWarehouseId: string) {
    if (fromWarehouseId === toWarehouseId) {
      throw new BadRequestException('Source and destination warehouse must be different.');
    }
    await assertLocationOnActiveFarm(this.db, farmScope(this.cls), fromWarehouseId, 'Source warehouse');
    await assertLocationOnActiveFarm(
      this.db,
      { ...farmScope(this.cls), farmId: null },
      toWarehouseId,
      'Destination warehouse',
    );
  }

  /**
   * Feed only ever reaches a silo through a stock transfer (farm STORE ->
   * SILO) and only ever leaves it through a daily feed entry, so posting the
   * transfer is the single moment at which a silo can be overfilled or handed
   * a second feed to hold. Both of the client's rules of 2026-09-24 therefore
   * live here, and both apply to a SILO destination only — a STORE is a
   * general warehouse and takes any item in any quantity.
   *
   * Checked at post() rather than at create()/update(): a draft's numbers say
   * nothing about what the silo will hold by the time it is posted, and
   * post() is where the stock actually moves.
   */
  private async assertSiloDestination(
    transfer: { company_id: string; to_warehouse_id: string },
    lines: { item_id: string; quantity: unknown; uom: string }[],
    tenantId: string,
  ) {
    const [destination] = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_name: schema.locationMaster.location_name,
        location_type: schema.locationMaster.location_type,
        silo_capacity_kg: schema.locationMaster.silo_capacity_kg,
      })
      .from(schema.locationMaster)
      .where(eq(schema.locationMaster.location_id, transfer.to_warehouse_id))
      .limit(1);
    if (!destination || destination.location_type !== 'SILO') return;
    const siloName = destination.location_name || destination.location_id;

    // A silo holds ONE feed item at a time, so a transfer that carries two of
    // them into the same silo is refused on the document alone, before any
    // stock is read.
    const incomingItems = new Set(lines.map((l) => l.item_id));
    if (incomingItems.size > 1) {
      throw new BadRequestException(
        `Cannot post this Stock Transfer — silo '${siloName}' holds one feed item at a time and this transfer carries ${incomingItems.size} different items.`,
      );
    }

    // On-hand per item in the silo, straight from the FIFO layers —
    // InventoryLedgerService.getStockBalance() is the canonical
    // remaining_quantity sum and is reused rather than recomputed here.
    const balances = await this.ledgerService.getStockBalance(
      { companyId: transfer.company_id, warehouseId: destination.location_id } as any,
      tenantId,
    );

    const resident = balances.find((b) => !incomingItems.has(b.item_id));
    if (resident) {
      throw new BadRequestException(
        `Cannot post this Stock Transfer — silo '${siloName}' already holds '${resident.item_code}'. A silo holds one feed item at a time; empty it before moving a different item in.`,
      );
    }

    // silo_capacity_kg is required on a SILO going forward, but silos
    // configured before the column existed still have none — nothing to
    // exceed, so there is nothing to refuse.
    if (destination.silo_capacity_kg == null) return;
    const capacityKg = Number(destination.silo_capacity_kg);

    let onHandKg = 0;
    for (const balance of balances) {
      onHandKg += await this.toKilograms(
        balance.on_hand_qty, balance.uom, balance.item_id, transfer.company_id, tenantId, siloName,
      );
    }
    let incomingKg = 0;
    for (const line of lines) {
      incomingKg += await this.toKilograms(
        Number(line.quantity), line.uom, line.item_id, transfer.company_id, tenantId, siloName,
      );
    }

    // The 0.0001 slack is the same tolerance getStockBalance uses to decide a
    // layer is spent — without it a decimal(12,2) capacity and a float sum can
    // disagree in the last place and refuse a transfer that exactly fills.
    if (onHandKg + incomingKg > capacityKg + 0.0001) {
      throw new BadRequestException(
        `Cannot post this Stock Transfer — silo '${siloName}' holds ${onHandKg} KG of a ${capacityKg} KG capacity, and this transfer of ${incomingKg} KG would overfill it by ${Math.round((onHandKg + incomingKg - capacityKg) * 100) / 100} KG.`,
      );
    }
  }

  /**
   * Capacity is canonical kilograms, so every quantity compared against it has
   * to be converted first. Never assumed: an item stocked in BAG or TON whose
   * conversion nobody has configured is refused outright, because treating its
   * number as kilograms would silently under- or over-fill the silo by orders
   * of magnitude.
   */
  private async toKilograms(
    quantity: number,
    uom: string,
    itemId: string,
    companyId: string,
    tenantId: string,
    siloName: string,
  ): Promise<number> {
    const unit = (uom || '').toUpperCase().trim();
    try {
      const factor = await this.uomService.resolveConversionFactor(unit, 'KG', itemId, companyId, tenantId);
      return quantity * factor;
    } catch {
      throw new BadRequestException(
        `Cannot post this Stock Transfer — silo '${siloName}' has its capacity in KG and there is no conversion from '${unit}' to KG. Record the conversion in UOM Conversion before transferring this item into a silo.`,
      );
    }
  }

  /** Visibility only — a mutation authorizes through loadForMutation(). */
  async findOne(id: string) {
    const scope = farmScope(this.cls);
    const conditions = [eq(schema.stockTransfer.transfer_id, id), isNull(schema.stockTransfer.deleted_at)];
    if (scope.farmId) {
      conditions.push(
        or(
          locationOnFarm(schema.stockTransfer.from_warehouse_id, scope.farmId),
          locationOnFarm(schema.stockTransfer.to_warehouse_id, scope.farmId)
        )!
      );
    }
    conditions.push(...restrictedScopeConditions(scope, { companyId: schema.stockTransfer.company_id }));
    if (scope.restricted && scope.lobId) conditions.push(or(
      sql`${schema.stockTransfer.from_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`,
      sql`${schema.stockTransfer.to_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`,
    )!);

    const [transfer] = await this.db
      .select()
      .from(schema.stockTransfer)
      .where(and(...conditions))
      .limit(1);

    if (!transfer) {
      throw new NotFoundException(`Stock Transfer with ID '${id}' not found.`);
    }

    const lines = await this.db
      .select()
      .from(schema.stockTransferLine)
      .where(eq(schema.stockTransferLine.transfer_id, id));

    return { ...transfer, lines };
  }

  async findAll(query: QueryStockTransferDto, tenantId: string) {
    const conditions: any[] = [eq(schema.stockTransfer.tenant_id, tenantId), isNull(schema.stockTransfer.deleted_at)];

    const scope = farmScope(this.cls);
    if (scope.farmId) {
      conditions.push(
        or(
          locationOnFarm(schema.stockTransfer.from_warehouse_id, scope.farmId),
          locationOnFarm(schema.stockTransfer.to_warehouse_id, scope.farmId)
        )!
      );
    }
    conditions.push(...restrictedScopeConditions(scope, { companyId: schema.stockTransfer.company_id }));
    if (scope.restricted && scope.lobId) conditions.push(or(
      sql`${schema.stockTransfer.from_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`,
      sql`${schema.stockTransfer.to_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`,
    )!);

    if (query.companyId) conditions.push(eq(schema.stockTransfer.company_id, query.companyId));
    if (query.status) conditions.push(eq(schema.stockTransfer.status, query.status));
    if (query.search) conditions.push(like(schema.stockTransfer.transfer_no, `%${query.search}%`));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.stockTransfer)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }

  private assertDraft(transfer: { status: string }) {
    if (transfer.status !== 'DRAFT') {
      throw new BadRequestException(`Stock Transfer cannot be modified — it is already ${transfer.status}.`);
    }
  }

  async update(id: string, dto: UpdateStockTransferDto, tenantId: string, userPayload?: any) {
    return withTenantTransaction(this.cls, async () => {
    const transfer = await this.loadForMutation(id, tenantId);
    this.assertDraft(transfer);

    // Both warehouses, changed or not, against create()'s rules. The source
    // staying on the editor's farm is also what keeps the edited transfer
    // visible to them whatever to_warehouse_id becomes.
    const fromWarehouseId = dto.from_warehouse_id ?? transfer.from_warehouse_id;
    const toWarehouseId = dto.to_warehouse_id ?? transfer.to_warehouse_id;
    await this.assertWarehouses(fromWarehouseId, toWarehouseId);

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };
    if (dto.from_warehouse_id !== undefined) updates.from_warehouse_id = dto.from_warehouse_id;
    if (dto.to_warehouse_id !== undefined) updates.to_warehouse_id = dto.to_warehouse_id;
    if (dto.posting_date !== undefined) updates.posting_date = dto.posting_date;
    if (dto.remarks !== undefined) updates.remarks = dto.remarks;

    await this.db.update(schema.stockTransfer).set(updates)
      .where(and(eq(schema.stockTransfer.transfer_id, id), eq(schema.stockTransfer.status, 'DRAFT')));

    if (dto.lines) {
      await this.db.delete(schema.stockTransferLine).where(eq(schema.stockTransferLine.transfer_id, id));
      await this.insertLines(id, dto.lines);
    }

    await this.auditService.log({
      tenantId,
      companyId: transfer.company_id,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'stock_transfer',
      entityId: id,
      oldValues: transfer,
      newValues: updates,
    });

    return this.findOne(id);
    });
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    return withTenantTransaction(this.cls, async () => {
    const transfer = await this.loadForMutation(id, tenantId);
    this.assertDraft(transfer);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.stockTransfer)
      .set({ status: 'CANCELLED', deleted_at: deletedTime as any, updated_by: userPayload?.userId || null })
      .where(and(eq(schema.stockTransfer.transfer_id, id), eq(schema.stockTransfer.status, 'DRAFT')));

    await this.auditService.log({
      tenantId,
      companyId: transfer.company_id,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'stock_transfer',
      entityId: id,
      oldValues: transfer,
      newValues: { status: 'CANCELLED', deleted_at: deletedTime },
    });

    return { success: true, message: `Stock Transfer '${transfer.transfer_no}' has been cancelled.` };
    });
  }

  async post(id: string, tenantId: string, userPayload?: any) {
    return withTenantTransaction(this.cls, async () => {
    const transfer = await this.loadForMutation(id, tenantId);
    this.assertDraft(transfer);

    // The source with the caller's full scope, farm included — posting drains
    // it. (This used to drop farmId for both warehouses.)
    await this.assertWarehouses(transfer.from_warehouse_id, transfer.to_warehouse_id);

    if (!transfer.lines || transfer.lines.length === 0) {
      throw new BadRequestException('Cannot post a Stock Transfer with no lines.');
    }

    // Before the DRAFT -> POSTED claim: a refusal here must leave the transfer
    // a draft the farm can correct, which is also the order every other check
    // in this method already follows.
    await this.assertSiloDestination(transfer, transfer.lines, tenantId);

    // Claim the DRAFT -> POSTED transition atomically before writing any
    // ledger/GL entries — see goods-issue.service.ts's post() for the full
    // rationale (closes both the double-post race and the "retry after a
    // partial failure duplicates the successful lines" hole).
    const [claim] = await this.db
      .update(schema.stockTransfer)
      .set({
        status: 'POSTED',
        posted_at: toMysqlTimestamp() as any,
        posted_by: userPayload?.userId || null,
        updated_by: userPayload?.userId || null,
      })
      .where(and(eq(schema.stockTransfer.transfer_id, id), eq(schema.stockTransfer.status, 'DRAFT')));

    if (claim.affectedRows === 0) {
      throw new BadRequestException('Stock Transfer cannot be posted — it was already posted by another request.');
    }

    for (const line of transfer.lines) {
      const { shipment, receipt } = await this.ledgerService.writeTransferEntries({
        tenantId,
        companyId: transfer.company_id,
        itemId: line.item_id,
        documentNo: transfer.transfer_no,
        documentLineId: line.line_id,
        postingDate: transfer.posting_date,
        quantity: Number(line.quantity),
        uom: line.uom,
        fromWarehouseId: transfer.from_warehouse_id,
        toWarehouseId: transfer.to_warehouse_id,
        lotNo: line.lot_no || undefined,
        serialNo: line.serial_no || undefined,
        userId: userPayload?.userId,
      });

      // Both legs post to GL independently (each carries its own
      // transaction_type — TRANSFER_SHIPMENT / TRANSFER_RECEIPT — so
      // gl_mapping_master resolves them separately, typically via an
      // inventory-in-transit clearing account).
      await this.glPostingService.postInventoryLedgerEntry(shipment, userPayload?.userId);
      await this.glPostingService.postInventoryLedgerEntry(receipt, userPayload?.userId);
    }

    await this.auditService.log({
      tenantId,
      companyId: transfer.company_id,
      userId: userPayload?.userId,
      action: 'POST',
      entityName: 'stock_transfer',
      entityId: id,
      newValues: { status: 'POSTED' },
    });

    return this.findOne(id);
    });
  }
}
