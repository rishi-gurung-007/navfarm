import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, like, isNull, count, sql, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { assertCompanyInScope, farmScope, locationOnFarm, locationReferenceScopeConditions, assertLocationOnActiveFarm, restrictedScopeConditions } from '../../../common/farm-scope';
import { CreateStockTransferDto, UpdateStockTransferDto, QueryStockTransferDto, PostShipmentDto, PostReceiptDto, PostDirectTransferDto } from './dto/stock-transfer.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { UomService } from '../../master-data/uom/uom.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { FeedAlertService } from '../feed-alert/feed-alert.service';
import { transferIsFullyReceived, transferIsFullyShipped } from './transfer-execution.rules';

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
    // Silo receiving rules are shared with Goods Receipt so both posting paths
    // enforce the same item, house and capacity constraints.
    private readonly siloFeedService: SiloFeedService,
    // Re-check feed thresholds only after the stock posting commits.
    @Optional() private readonly feedAlerts?: FeedAlertService,
  ) { }

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
      .select({
        maxSeq: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${schema.stockTransfer.transfer_no}, 4) AS UNSIGNED)), 0)`,
      })
      .from(schema.stockTransfer)
      .where(and(eq(schema.stockTransfer.tenant_id, tenantId), eq(schema.stockTransfer.company_id, companyId)))
      .for('update');
    const seq = Number(row?.maxSeq || 0) + 1;
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

    const incomingItems = new Set(lines.map((l) => l.item_id));

    // One feed item at a time, a different feed only into an empty silo, and
    // D9's sibling-shed check — all three now live in SiloFeedService, shared
    // with Goods Receipt (see silo-feed.service.ts).
    await this.siloFeedService.assertCanReceive({
      siloId: destination.location_id,
      siloName,
      companyId: transfer.company_id,
      tenantId,
      itemIds: [...incomingItems],
      documentLabel: 'Stock Transfer',
    });

    // On-hand per item in the silo, straight from the FIFO layers —
    // InventoryLedgerService.getStockBalance() is the canonical
    // remaining_quantity sum and is reused rather than recomputed here.
    const balances = await this.ledgerService.getStockBalance(
      { companyId: transfer.company_id, warehouseId: destination.location_id } as any,
      tenantId,
    );

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

    // Task 10: cumulative event coverage per line, so the UI shows how much
    // of each line has shipped and received without a second endpoint.
    const [shipped, received] = await Promise.all([
      this.shippedQuantities(id, transfer.tenant_id),
      this.receivedQuantities(id, transfer.tenant_id),
    ]);

    return {
      ...transfer,
      lines: lines.map((l) => ({
        ...l,
        qty_shipped: shipped.get(l.line_id) ?? 0,
        qty_received: received.get(l.line_id) ?? 0,
      })),
    };
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
    // Compatibility wrapper (Task 10): the atomic one-step posting is now a
    // direct transfer — one shipment covering every line plus its matching
    // receipt, in one transaction — through the same services a partial
    // shipment or receipt uses. The DRAFT claim stays, so the old race
    // protections hold.
    return this.postDirectTransfer(id, { posting_date: new Date().toISOString().slice(0, 10), lines: [] }, tenantId, userPayload);
  }

  /**
   * Transfer a draft's lines with their already-assigned lot/serial (Task 10):
   * the events carry identity, the order line stays the contract. Lines with
   * no event in this call are simply not shipped yet — partial by design.
   */
  async postShipment(id: string, dto: PostShipmentDto, tenantId: string, userPayload?: any) {
    const result = await withTenantTransaction(this.cls, async () => {
      const transfer = await this.loadForMutation(id, tenantId);
      this.assertDraft(transfer);
      if (transfer.from_warehouse_id === transfer.to_warehouse_id) {
        throw new BadRequestException('A transfer needs two different warehouses.');
      }
      await this.assertWarehouses(transfer.from_warehouse_id, transfer.to_warehouse_id);
      await this.assertSiloDestination(transfer, transfer.lines, tenantId);

      this.assertDistinctLines(dto.lines, 'shipment');
      // Cumulative shipped quantities per line, from the events so far.
      const shippedByLine = await this.shippedQuantities(id, tenantId);
      const eventLines: Array<{ line: typeof schema.stockTransferLine.$inferSelect; qty: number; lotNo?: string; serialNo?: string }> = [];
      for (const input of dto.lines) {
        const line = transfer.lines.find((l) => l.line_id === input.line_id);
        if (!line) throw new BadRequestException(`Transfer line '${input.line_id}' is not part of ${transfer.transfer_no}.`);
        const alreadyShipped = shippedByLine.get(line.line_id) ?? 0;
        // Bounds run in the line's own UOM: the ordered quantity is the line,
        // already-shipped comes from the events.
        this.assertShipment(Number(line.quantity), alreadyShipped, input.quantity, line);
        eventLines.push({ line, qty: input.quantity, lotNo: line.lot_no ?? undefined, serialNo: line.serial_no ?? undefined });
      }

      const shipmentId = randomUUID();
      const shipmentNo = await this.nextEventNo(transfer.company_id, tenantId, 'SH');
      await this.db.insert(schema.transferShipment).values({
        shipment_id: shipmentId,
        tenant_id: tenantId,
        transfer_id: id,
        shipment_no: shipmentNo,
        shipment_date: dto.posting_date,
        status: 'POSTED',
        created_by: userPayload?.userId || null,
      });
      for (const { line, qty, lotNo, serialNo } of eventLines) {
        await this.db.insert(schema.transferShipmentLine).values({
          shipment_id: shipmentId,
          line_id: line.line_id,
          quantity: String(qty),
          uom: line.uom,
          lot_no: lotNo ?? null,
          serial_no: serialNo ?? null,
        });
        // Out of the source only; the destination leg is the receipt's (Part E Task 4).
        const shipmentEntry = await this.ledgerService.writeTransferShipment({
          tenantId, companyId: transfer.company_id, itemId: line.item_id, documentNo: shipmentNo, documentLineId: line.line_id,
          postingDate: dto.posting_date, quantity: qty, uom: line.uom, fromWarehouseId: transfer.from_warehouse_id,
          lotNo, serialNo, userId: userPayload?.userId,
        });
        await this.glPostingService.postInventoryLedgerEntry(shipmentEntry, userPayload?.userId);
      }

      await this.auditService.log({
        tenantId,
        companyId: transfer.company_id,
        userId: userPayload?.userId,
        action: 'POST',
        entityName: 'transfer_shipment',
        entityId: shipmentId,
        newValues: { shipment_no: shipmentNo, transfer_no: transfer.transfer_no, lines: eventLines.length },
      });
      return { shipment_id: shipmentId, shipment_no: shipmentNo, transfer_id: id, lines: eventLines.map((e) => ({ line_id: e.line.line_id, qty_shipped: e.qty })) };
    });
    return result;
  }

  /**
   * Receive against a shipment (Task 10). The receipt is bound to its shipment,
   * so a receipt cannot precede shipment structurally. Each line is bounded
   * twice: by what THIS shipment carried on that line less the receipts
   * already posted against the same shipment line, and by the whole line's
   * shipped-minus-received. Lot/serial identity is copied from the shipment
   * event, never re-typed. The receipt that closes a shipment line takes the
   * line's remaining shipped value, so Inventory in Transit nets to zero.
   */
  async postReceipt(id: string, dto: PostReceiptDto, tenantId: string, userPayload?: any) {
    return withTenantTransaction(this.cls, async () => {
      const transfer = await this.loadForMutation(id, tenantId);
      this.assertDraft(transfer);
      await this.assertWarehouses(transfer.from_warehouse_id, transfer.to_warehouse_id);

      const [shipment] = await this.db.select().from(schema.transferShipment)
        .where(and(
          eq(schema.transferShipment.shipment_id, dto.shipment_id),
          eq(schema.transferShipment.transfer_id, id),
          eq(schema.transferShipment.tenant_id, tenantId),
          isNull(schema.transferShipment.deleted_at),
        ))
        .limit(1);
      if (!shipment) throw new NotFoundException(`Shipment '${dto.shipment_id}' does not belong to ${transfer.transfer_no}.`);

      this.assertDistinctLines(dto.lines, 'receipt');
      const shippedByLine = await this.shippedQuantities(id, tenantId);
      const receivedByLine = await this.receivedQuantities(id, tenantId);
      const shipmentLines = await this.db.select().from(schema.transferShipmentLine)
        .where(eq(schema.transferShipmentLine.shipment_id, dto.shipment_id));
      const receivedOnShipment = await this.receivedAgainstShipment(dto.shipment_id, tenantId);

      const receiptId = randomUUID();
      const receiptNo = await this.nextEventNo(transfer.company_id, tenantId, 'RC');
      await this.db.insert(schema.transferReceipt).values({
        receipt_id: receiptId,
        tenant_id: tenantId,
        transfer_id: id,
        shipment_id: dto.shipment_id,
        receipt_no: receiptNo,
        receipt_date: dto.posting_date,
        status: 'POSTED',
        created_by: userPayload?.userId || null,
      });
      for (const input of dto.lines) {
        const shipmentLine = shipmentLines.find((sl) => sl.line_id === input.line_id);
        if (!shipmentLine) {
          // A line the shipment never carried is exactly "receipt before
          // shipment" — whether or not the order happens to hold such a line.
          throw new BadRequestException(`Line ${input.line_id} was not on shipment ${shipment.shipment_no}; a receipt cannot precede its shipment.`);
        }
        const line = transfer.lines.find((l) => l.line_id === input.line_id);
        if (!line) throw new BadRequestException(`Transfer line '${input.line_id}' is not part of ${transfer.transfer_no}.`);
        const alreadyShipped = shippedByLine.get(line.line_id) ?? 0;
        const alreadyReceived = receivedByLine.get(line.line_id) ?? 0;
        // Over-receipt is measured against what has shipped, never the order.
        if (input.quantity > alreadyShipped - alreadyReceived) {
          throw new BadRequestException('Receipt quantity exceeds the remaining quantity to receive.');
        }
        // ...and against THIS shipment: a receipt cannot draw on what another
        // shipment carried (Part E Task 4, fix round 1).
        const prior = receivedOnShipment.get(shipmentLine.shipment_line_id) ?? { qty: 0, receiptNos: [] };
        const leftOnShipment = Number(shipmentLine.quantity) - prior.qty;
        if (input.quantity > leftOnShipment + 1e-9) {
          throw new BadRequestException(`Receipt quantity exceeds what shipment ${shipment.shipment_no} has left to receive on this line (${leftOnShipment}).`);
        }
        // Into the destination only, at the rate the shipment carried out (Part E Task 4).
        // The receipt that closes the shipment line takes its remaining value
        // instead, so per-unit rounding never strands a residue in In Transit.
        const rate = await this.ledgerService.transferShipmentRate({ tenantId, shipmentNo: shipment.shipment_no, lineId: line.line_id });
        const closesShipmentLine = input.quantity >= leftOnShipment - 1e-9;
        const amount = closesShipmentLine
          ? await this.ledgerService.transferShipmentRemainingValue({
            tenantId, shipmentNo: shipment.shipment_no, lineId: line.line_id, receiptNos: prior.receiptNos,
          })
          : undefined;
        const receiptEntry = await this.ledgerService.writeTransferReceipt({
          tenantId, companyId: transfer.company_id, itemId: line.item_id, documentNo: receiptNo, documentLineId: line.line_id,
          postingDate: dto.posting_date, quantity: input.quantity, uom: line.uom, toWarehouseId: transfer.to_warehouse_id, rate, amount,
          lotNo: shipmentLine.lot_no ?? undefined, serialNo: shipmentLine.serial_no ?? undefined, userId: userPayload?.userId,
        });
        await this.glPostingService.postInventoryLedgerEntry(receiptEntry, userPayload?.userId);
        await this.db.insert(schema.transferReceiptLine).values({
          receipt_id: receiptId,
          shipment_line_id: shipmentLine.shipment_line_id,
          line_id: line.line_id,
          quantity: String(input.quantity),
          uom: line.uom,
          // Identity copied from the shipment, never re-typed (spec).
          lot_no: shipmentLine.lot_no,
          serial_no: shipmentLine.serial_no,
        });
      }

      await this.auditService.log({
        tenantId,
        companyId: transfer.company_id,
        userId: userPayload?.userId,
        action: 'POST',
        entityName: 'transfer_receipt',
        entityId: receiptId,
        newValues: { receipt_no: receiptNo, shipment_no: shipment.shipment_no, lines: dto.lines.length },
      });
      return { receipt_id: receiptId, receipt_no: receiptNo, transfer_id: id, lines: dto.lines.map((l) => ({ line_id: l.line_id, qty_received: l.quantity })) };
    });
  }

  /**
   * Direct Transfer (Task 10): a selected shipment and its matching receipt in
   * ONE transaction. It calls the same posting pieces as the staged path —
   * it is not a second implementation — and because shipment and receipt
   * happen together, the receipt can never precede its shipment.
   */
  async postDirectTransfer(id: string, dto: PostDirectTransferDto, tenantId: string, userPayload?: any) {
    const transfer = await withTenantTransaction(this.cls, async () => {
      const row = await this.loadForMutation(id, tenantId);
      this.assertDraft(row);
      if (row.from_warehouse_id === row.to_warehouse_id) {
        throw new BadRequestException('A transfer needs two different warehouses.');
      }
      await this.assertWarehouses(row.from_warehouse_id, row.to_warehouse_id);
      await this.assertSiloDestination(row, row.lines, tenantId);
      if (!row.lines || row.lines.length === 0) {
        throw new BadRequestException('Cannot post a Stock Transfer with no lines.');
      }

      // Empty lines = every line, full quantity: the legacy atomic post.
      const inputs = dto.lines.length > 0
        ? dto.lines
        : row.lines.map((l) => ({ line_id: l.line_id, quantity: Number(l.quantity) }));

      const shippedByLine = await this.shippedQuantities(id, tenantId);
      const receivedByLine = await this.receivedQuantities(id, tenantId);
      for (const input of inputs) {
        const line = row.lines.find((l) => l.line_id === input.line_id);
        if (!line) throw new BadRequestException(`Transfer line '${input.line_id}' is not part of ${row.transfer_no}.`);
        this.assertShipment(Number(line.quantity), shippedByLine.get(line.line_id) ?? 0, input.quantity, line);
        const remainingToReceive = (shippedByLine.get(line.line_id) ?? 0) + input.quantity - (receivedByLine.get(line.line_id) ?? 0);
        if (input.quantity > remainingToReceive) {
          throw new BadRequestException('Receipt quantity exceeds the remaining quantity to receive.');
        }
      }

      // Ship, then receive, inside this same transaction.
      const shipment = await this.postShipment(id, {
        posting_date: dto.posting_date,
        lines: inputs.map((l) => ({ line_id: l.line_id, quantity: l.quantity })),
        remarks: dto.remarks,
      }, tenantId, userPayload);
      const receipt = await this.postReceipt(id, {
        posting_date: dto.posting_date,
        shipment_id: shipment.shipment_id,
        lines: inputs.map((l) => ({ line_id: l.line_id, quantity: l.quantity })),
        remarks: dto.remarks,
      }, tenantId, userPayload);

      // The DRAFT -> POSTED claim on the order, last so a refusal above leaves
      // the transfer a correctable draft. A partial direct transfer leaves the
      // order open for further events; only full coverage claims it. Coverage
      // is recounted AFTER the events this call just wrote — the maps above
      // were read before shipping, so a first-time full direct transfer would
      // otherwise never claim POSTED.
      const shippedAfter = await this.shippedQuantities(id, tenantId);
      const receivedAfter = await this.receivedQuantities(id, tenantId);
      const coverage = row.lines.map((l) => ({
        ordered: Number(l.quantity),
        shipped: shippedAfter.get(l.line_id) ?? 0,
        received: receivedAfter.get(l.line_id) ?? 0,
      }));
      if (transferIsFullyShipped(coverage) && transferIsFullyReceived(coverage)) {
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
      }

      await this.auditService.log({
        tenantId,
        companyId: row.company_id,
        userId: userPayload?.userId,
        action: 'POST',
        entityName: 'stock_transfer',
        entityId: id,
        newValues: { status: 'POSTED', shipment_no: shipment.shipment_no, receipt_no: receipt.receipt_no },
      });
      return this.findOne(id);
    });
    await this.feedAlerts?.evaluateLevelsSafely([transfer.from_warehouse_id, transfer.to_warehouse_id], tenantId);
    return transfer;
  }

  /** Cumulative shipped quantity per transfer line, from the event rows. */
  private async shippedQuantities(transferId: string, tenantId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ line_id: schema.transferShipmentLine.line_id, qty: schema.transferShipmentLine.quantity })
      .from(schema.transferShipmentLine)
      .innerJoin(schema.transferShipment, eq(schema.transferShipmentLine.shipment_id, schema.transferShipment.shipment_id))
      .where(and(
        eq(schema.transferShipment.transfer_id, transferId),
        eq(schema.transferShipment.tenant_id, tenantId),
        isNull(schema.transferShipment.deleted_at),
      ));
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.line_id, (map.get(r.line_id) ?? 0) + Number(r.qty));
    return map;
  }

  /**
   * Receipts already posted against one shipment, per shipment line: the
   * received quantity and the receipt numbers (their ledger rows carry the
   * value already taken out of In Transit).
   */
  private async receivedAgainstShipment(shipmentId: string, tenantId: string): Promise<Map<string, { qty: number; receiptNos: string[] }>> {
    const rows = await this.db
      .select({
        shipment_line_id: schema.transferReceiptLine.shipment_line_id,
        qty: schema.transferReceiptLine.quantity,
        receipt_no: schema.transferReceipt.receipt_no,
      })
      .from(schema.transferReceiptLine)
      .innerJoin(schema.transferReceipt, eq(schema.transferReceiptLine.receipt_id, schema.transferReceipt.receipt_id))
      .where(and(
        eq(schema.transferReceipt.shipment_id, shipmentId),
        eq(schema.transferReceipt.tenant_id, tenantId),
        isNull(schema.transferReceipt.deleted_at),
      ));
    const map = new Map<string, { qty: number; receiptNos: string[] }>();
    for (const r of rows) {
      if (!r.shipment_line_id) continue;
      const entry = map.get(r.shipment_line_id) ?? { qty: 0, receiptNos: [] };
      entry.qty += Number(r.qty);
      if (r.receipt_no) entry.receiptNos.push(r.receipt_no);
      map.set(r.shipment_line_id, entry);
    }
    return map;
  }

  /**
   * One event names a line once. The bounds read the cumulative quantities
   * once, before the loop, so a repeated line id would pass each check on its
   * own and together exceed them (Part E Task 4, fix round 1).
   */
  private assertDistinctLines(lines: Array<{ line_id: string }>, event: 'shipment' | 'receipt'): void {
    const seen = new Set<string>();
    for (const l of lines) {
      if (seen.has(l.line_id)) {
        throw new BadRequestException(`Line ${l.line_id} appears more than once in this ${event}; enter each line once with its total quantity.`);
      }
      seen.add(l.line_id);
    }
  }

  /** Cumulative received quantity per transfer line, from the event rows. */
  private async receivedQuantities(transferId: string, tenantId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ line_id: schema.transferReceiptLine.line_id, qty: schema.transferReceiptLine.quantity })
      .from(schema.transferReceiptLine)
      .innerJoin(schema.transferReceipt, eq(schema.transferReceiptLine.receipt_id, schema.transferReceipt.receipt_id))
      .where(and(
        eq(schema.transferReceipt.transfer_id, transferId),
        eq(schema.transferReceipt.tenant_id, tenantId),
        isNull(schema.transferReceipt.deleted_at),
      ));
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.line_id, (map.get(r.line_id) ?? 0) + Number(r.qty));
    return map;
  }

  /**
   * The shipment bounds: never beyond the ordered quantity, once the already-
   * shipped events are counted. Tracking identity rides the order line — the
   * same contract the atomic post has always had.
   */
  private assertShipment(
    orderedLineQty: number,
    alreadyShipped: number,
    qty: number,
    line: { lot_no: string | null; serial_no: string | null; item_id: string },
  ): void {
    void line;
    if (!(qty > 0)) throw new BadRequestException('Shipment quantity must be greater than zero.');
    if (alreadyShipped + qty > orderedLineQty + 1e-9) {
      throw new BadRequestException('Shipment quantity exceeds the remaining balance to ship.');
    }
  }

  /** SH-2026-0001 / RC-2026-0001 per company — ours (no document names the event series). */
  private async nextEventNo(companyId: string, tenantId: string, kind: 'SH' | 'RC'): Promise<string> {
    const table = kind === 'SH' ? schema.transferShipment : schema.transferReceipt;
    const noColumn = kind === 'SH' ? schema.transferShipment.shipment_no : schema.transferReceipt.receipt_no;
    const year = new Date().getFullYear();
    const prefix = `${kind === 'SH' ? 'SH' : 'RC'}-${year}-`;
    const [last] = await this.db
      .select({ no: noColumn })
      .from(table)
      .where(and(eq(table.tenant_id, tenantId), like(noColumn, `${prefix}%`)))
      .orderBy(desc(noColumn))
      .limit(1);
    const lastSeq = last?.no ? Number(last.no.slice(prefix.length)) : 0;
    return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(4, '0')}`;
  }

  /**
   * The original atomic post, kept as reference until Task 13 deletes it:
   * its body is the direct-transfer path below, line for line.
   */
  private async postOriginal_superseded(id: string, tenantId: string, userPayload?: any) {
    const posted = await withTenantTransaction(this.cls, async () => {
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
    // Ruling M6: once per posting, after the transaction above has committed,
    // and never able to fail it. Both ends — a transfer out of a silo lowers it.
    await this.feedAlerts?.evaluateLevelsSafely([posted.from_warehouse_id, posted.to_warehouse_id], tenantId);
    return posted;
  }
}
