import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, like, isNull, count, sql, desc, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { assertCompanyInScope, farmScope, locationOnFarm, locationReferenceScopeConditions, assertLocationOnActiveFarm, restrictedScopeConditions } from '../../../common/farm-scope';
import { CreateStockTransferDto, UpdateStockTransferDto, QueryStockTransferDto, PostShipmentDto, PostReceiptDto, PostDirectTransferDto, ReceiveStockTransferDto, ShipStockTransferDto } from './dto/stock-transfer.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { UomService } from '../../master-data/uom/uom.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { FeedAlertService } from '../feed-alert/feed-alert.service';
import { OPEN_TRANSFER_STATUSES, transferStatusFor, assertTrackingForShipment, serialsForReceipt, splitAmount } from './transfer-execution.rules';
import { syncRequisitionFulfilment } from '../../procurement/requisition/requisition-fulfilment';

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
        throw new BadRequestException('Source and destination location must be different.');
      }
      await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.from_warehouse_id, 'Source location');
      await assertLocationOnActiveFarm(
        this.db,
        { ...farmScope(this.cls), farmId: null },
        dto.to_warehouse_id,
        'Destination location',
      );

      const created = await this.createRecord(dto, tenantId, userPayload);
      return this.findOne(created.transfer_id);
    });
  }

  /**
   * Internal feed release path. The feed service owns the surrounding tenant
   * transaction so every grouped transfer and its link either commits together
   * or disappears together. This method deliberately refuses standalone use.
   */
  async createForFeedRelease(
    dto: CreateStockTransferDto,
    tenantId: string,
    userPayload?: { userId?: string; userType?: string; email?: string },
  ): Promise<{ transfer_id: string; transfer_no: string }> {
    if (this.cls.get('tenantPostingTransaction') !== true) {
      throw new Error('Feed release transfers must be created inside the feed requisition transaction.');
    }
    assertCompanyInScope(farmScope(this.cls), dto.company_id);
    if (dto.lines.some((line) => !line.requisition_line_id)) {
      throw new BadRequestException('Every feed release transfer line must include requisition_line_id.');
    }

    const context = await this.loadFeedReleaseContext(dto, tenantId);
    const active = (row: any) => row?.is_active === true && row?.status === 'ACTIVE' && !row?.deleted_at;
    if (!context.source || context.source.location_type !== 'BIN' || !active(context.source)) {
      throw new BadRequestException(`Feed transfer source ${dto.from_warehouse_id} must be an active BIN.`);
    }
    if (context.source.tenant_id !== tenantId || context.source.company_id !== dto.company_id) {
      throw new BadRequestException(`Feed transfer source ${dto.from_warehouse_id} must belong to company ${dto.company_id}.`);
    }
    if (!context.mill || context.mill.location_type !== 'MILL' || !active(context.mill)
      || context.mill.tenant_id !== tenantId || context.mill.company_id !== dto.company_id) {
      throw new BadRequestException(`Feed transfer source ${dto.from_warehouse_id} must have an active MILL parent.`);
    }
    if (!context.destination || !['SILO', 'STORE'].includes(context.destination.location_type) || !active(context.destination)) {
      throw new BadRequestException(`Feed transfer destination ${dto.to_warehouse_id} must be an active SILO or STORE.`);
    }
    if (context.destination.tenant_id !== tenantId || context.destination.company_id !== dto.company_id) {
      throw new BadRequestException(`Feed transfer destination ${dto.to_warehouse_id} must belong to company ${dto.company_id}.`);
    }
    // Feed requisitions use farm_id as the canonical farm location. Older
    // drafts may not populate the optional common-requisition field.
    const requisitionFarmId = context.requisition.main_location_id ?? context.requisition.farm_id;
    if (!requisitionFarmId
      || (context.destination.parent_location_id !== requisitionFarmId && context.destination.farm_id !== requisitionFarmId)) {
      throw new BadRequestException(`Feed transfer destination ${dto.to_warehouse_id} must belong to requisition farm ${requisitionFarmId ?? '(missing)'}.`);
    }

    return this.createRecord(dto, tenantId, userPayload);
  }

  private async loadFeedReleaseContext(dto: CreateStockTransferDto, tenantId: string) {
    const lineIds = dto.lines.map((line) => line.requisition_line_id!);
    const requisitions = await this.db
      .select({
        line_id: schema.requisitionLine.line_id,
        requisition_id: schema.requisition.requisition_id,
        tenant_id: schema.requisition.tenant_id,
        company_id: schema.requisition.company_id,
        main_location_id: schema.requisition.main_location_id,
        farm_id: schema.requisition.farm_id,
      })
      .from(schema.requisitionLine)
      .innerJoin(schema.requisition, eq(schema.requisition.requisition_id, schema.requisitionLine.requisition_id))
      .where(and(
        inArray(schema.requisitionLine.line_id, lineIds),
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.company_id, dto.company_id),
        isNull(schema.requisition.deleted_at),
      ));
    const requisitionIds = new Set(requisitions.map((row) => row.requisition_id));
    if (requisitions.length !== lineIds.length || requisitionIds.size !== 1) {
      throw new BadRequestException('Every feed transfer line must belong to the same active feed requisition.');
    }

    const selectLocation = async (locationId: string) => {
      const [row] = await this.db.select().from(schema.locationMaster).where(and(
        eq(schema.locationMaster.location_id, locationId),
        eq(schema.locationMaster.tenant_id, tenantId),
        isNull(schema.locationMaster.deleted_at),
      )).limit(1);
      return row;
    };
    const source = await selectLocation(dto.from_warehouse_id);
    const mill = source?.parent_location_id ? await selectLocation(source.parent_location_id) : undefined;
    const destination = await selectLocation(dto.to_warehouse_id);
    return { requisition: requisitions[0], source, mill, destination };
  }

  private async createRecord(dto: CreateStockTransferDto, tenantId: string, userPayload?: { userId?: string }) {
    const transferId = randomUUID();
    const transferNo = await this.generateTransferNo(tenantId, dto.company_id, this.db);
    await this.db.insert(schema.stockTransfer).values({
      transfer_id: transferId,
      tenant_id: tenantId,
      company_id: dto.company_id,
      transfer_no: transferNo,
      posting_date: dto.posting_date,
      from_warehouse_id: dto.from_warehouse_id,
      to_warehouse_id: dto.to_warehouse_id,
      remarks: dto.remarks || null,
      status: 'DRAFT',
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
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
    return { transfer_id: transferId, transfer_no: transferNo };
  }

  private async insertLines(transferId: string, lines: CreateStockTransferDto['lines']) {
    await this.db.insert(schema.stockTransferLine).values(
      lines.map((line, idx) => {
        const noteParts: string[] = [];
        if (line.shipment_date && !line.remarks?.includes(line.shipment_date)) {
          noteParts.push(`Ship Date: ${line.shipment_date}`);
        }
        if (line.receipt_date && !line.remarks?.includes(line.receipt_date)) {
          noteParts.push(`Receipt Date: ${line.receipt_date}`);
        }
        if (line.unit_cost !== undefined && line.unit_cost !== null && !line.remarks?.includes('Unit Cost:')) {
          noteParts.push(`Unit Cost: ${line.unit_cost}`);
        }
        if (line.amount !== undefined && line.amount !== null && !line.remarks?.includes('Amount:')) {
          noteParts.push(`Amount: ${line.amount}`);
        }
        if (line.remarks?.trim()) {
          noteParts.push(line.remarks.trim());
        }
        const finalRemarks = noteParts.length > 0 ? noteParts.join(' | ') : null;

        return {
          line_id: randomUUID(),
          transfer_id: transferId,
          line_no: idx + 1,
          item_id: line.item_id,
          quantity: line.quantity.toString(),
          uom: line.uom,
          lot_no: line.lot_no || null,
          serial_no: line.serial_no || null,
          remarks: finalRemarks,
          requisition_line_id: line.requisition_line_id ?? null,
        };
      })
    );
  }

  /**
   * The row every mutation authorizes through, locked. findOne() shows a
   * transfer to either farm it touches, but only the source farm may change
   * it: through to_warehouse_id a destination-farm manager could rewrite a
   * draft's quantities and post it, draining the source farm's warehouse. So
   * farm, LOB and company sit on from_warehouse_id only.
   */
  private async loadForMutation(id: string, tenantId: string, requisitionExecution = false) {
    const scope = farmScope(this.cls);
    const locationScope = requisitionExecution ? [] : locationReferenceScopeConditions(scope, schema.stockTransfer.from_warehouse_id);
    const [transfer] = await this.db
      .select()
      .from(schema.stockTransfer)
      .where(and(
        eq(schema.stockTransfer.transfer_id, id),
        eq(schema.stockTransfer.tenant_id, tenantId),
        isNull(schema.stockTransfer.deleted_at),
        ...locationScope,
        ...restrictedScopeConditions(scope, { companyId: schema.stockTransfer.company_id }),
      ))
      .for('update');

    if (!transfer) {
      throw new NotFoundException(`Transfer Order with ID '${id}' not found.`);
    }

    const lines = await this.db
      .select()
      .from(schema.stockTransferLine)
      .where(eq(schema.stockTransferLine.transfer_id, id));

    return { ...transfer, lines };
  }

  /**
   * Authorizes stock reception by ensuring the transfer is destined for the
   * caller's farm/company scope.
   */
  private async loadForReceive(id: string, tenantId: string) {
    const scope = farmScope(this.cls);
    const conditions = [
      eq(schema.stockTransfer.transfer_id, id),
      eq(schema.stockTransfer.tenant_id, tenantId),
      isNull(schema.stockTransfer.deleted_at),
      ...restrictedScopeConditions(scope, { companyId: schema.stockTransfer.company_id }),
    ];
    if (scope.farmId) {
      conditions.push(locationOnFarm(schema.stockTransfer.to_warehouse_id, scope.farmId)!);
    }
    if (scope.restricted && scope.lobId) {
      conditions.push(
        sql`${schema.stockTransfer.to_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`
      );
    }

    const [transfer] = await this.db
      .select()
      .from(schema.stockTransfer)
      .where(and(...conditions))
      .for('update');

    if (!transfer) {
      throw new NotFoundException(`Transfer Order with ID '${id}' not found or not destined for your active location.`);
    }

    const lines = await this.db
      .select()
      .from(schema.stockTransferLine)
      .where(eq(schema.stockTransferLine.transfer_id, id));

    return { ...transfer, lines };
  }

  /**
   * Authorizes closing a Transfer Order if the caller's active farm is either
   * the source (shipping) or destination (receiving) warehouse.
   */
  private async loadForClose(id: string, tenantId: string) {
    const scope = farmScope(this.cls);
    const conditions = [
      eq(schema.stockTransfer.transfer_id, id),
      eq(schema.stockTransfer.tenant_id, tenantId),
      isNull(schema.stockTransfer.deleted_at),
      ...restrictedScopeConditions(scope, { companyId: schema.stockTransfer.company_id }),
    ];
    if (scope.farmId) {
      conditions.push(
        or(
          locationOnFarm(schema.stockTransfer.from_warehouse_id, scope.farmId),
          locationOnFarm(schema.stockTransfer.to_warehouse_id, scope.farmId),
        )!,
      );
    }
    if (scope.restricted && scope.lobId) {
      conditions.push(
        or(
          sql`${schema.stockTransfer.from_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`,
          sql`${schema.stockTransfer.to_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`,
        )!,
      );
    }

    const [transfer] = await this.db
      .select()
      .from(schema.stockTransfer)
      .where(and(...conditions))
      .for('update');

    if (!transfer) {
      throw new NotFoundException(`Transfer Order with ID '${id}' not found.`);
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
      throw new BadRequestException('Source and destination location must be different.');
    }
    await assertLocationOnActiveFarm(this.db, farmScope(this.cls), fromWarehouseId, 'Source location');
    await assertLocationOnActiveFarm(
      this.db,
      { ...farmScope(this.cls), farmId: null },
      toWarehouseId,
      'Destination location',
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
      documentLabel: 'Transfer Order',
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
        `Cannot post this Transfer Order — silo '${siloName}' holds ${onHandKg} KG of a ${capacityKg} KG capacity, and this transfer of ${incomingKg} KG would overfill it by ${Math.round((onHandKg + incomingKg - capacityKg) * 100) / 100} KG.`,
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
        `Cannot post this Transfer Order — silo '${siloName}' has its capacity in KG and there is no conversion from '${unit}' to KG. Record the conversion in UOM Conversion before transferring this item into a silo.`,
      );
    }
  }


  private async getLedgerHistory(transferNo: string, companyId: string, tenantId: string) {
    try {
      const rows = await this.db
        .select()
        .from(schema.inventoryLedger)
        .where(
          and(
            eq(schema.inventoryLedger.tenant_id, tenantId),
            eq(schema.inventoryLedger.company_id, companyId),
            eq(schema.inventoryLedger.document_no, transferNo),
          ),
        );

      const userIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];
      const users = userIds.length > 0
        ? await this.db
            .select({
              user_id: schema.userMaster.user_id,
              full_name: schema.userMaster.full_name,
            })
            .from(schema.userMaster)
            .where(
              and(
                eq(schema.userMaster.tenant_id, tenantId),
                inArray(schema.userMaster.user_id, userIds),
              ),
            )
        : [];
      const userMap = new Map(users.map((u) => [u.user_id, u.full_name]));

      return rows.map((r) => {
        const authorName = (r.created_by && userMap.get(r.created_by)) || r.created_by || 'System';
        return {
          ...r,
          created_by_name: authorName,
          created_by: authorName,
          created_by_id: r.created_by,
        };
      });
    } catch {
      return [];
    }
  }

  private enrichLinesWithQuantities(lines: any[], ledgerEntries: any[], fallbackStatus?: string) {
    return lines.map((line) => {
      const lineShipments = ledgerEntries.filter(
        (e) =>
          (e.document_line_id === line.line_id || (!e.document_line_id && e.item_id === line.item_id)) &&
          e.transaction_type === 'TRANSFER_SHIPMENT',
      );
      const lineReceipts = ledgerEntries.filter(
        (e) =>
          (e.document_line_id === line.line_id || (!e.document_line_id && e.item_id === line.item_id)) &&
          e.transaction_type === 'TRANSFER_RECEIPT',
      );

      let qty_shipped = lineShipments.reduce((sum, e) => sum + Math.abs(Number(e.quantity) || 0), 0);

      const goodReceipts = lineReceipts.filter(
        (e) => e.external_reference_no !== 'DOA_IN_TRANSIT',
      );
      const doaReceipts = lineReceipts.filter(
        (e) => e.external_reference_no === 'DOA_IN_TRANSIT',
      );

      let qty_received = goodReceipts.reduce((sum, e) => sum + Number(e.quantity || 0), 0);
      let qty_doa = doaReceipts.reduce((sum, e) => sum + Number(e.quantity || 0), 0);

      // If no DOA_IN_TRANSIT entry was isolated, check if externalReferenceNo was encoded as DOA:X
      if (qty_doa === 0) {
        for (const e of goodReceipts) {
          if (e.external_reference_no?.startsWith('DOA:')) {
            const parsed = Number(e.external_reference_no.split(':')[1]);
            if (!isNaN(parsed) && parsed > 0) {
              qty_doa += parsed;
            }
          }
        }
      }

      const ordered = Number(line.quantity) || 0;

      // Fallback for mock environments or legacy records where status is IN_TRANSIT or RECEIVED but no ledger rows exist
      if (lineShipments.length === 0 && (fallbackStatus === 'IN_TRANSIT' || fallbackStatus === 'RECEIVED')) {
        qty_shipped = ordered;
      }

      const total_accounted = qty_received + qty_doa;
      const qty_in_transit = Math.max(0, qty_shipped - total_accounted);
      const qty_to_ship = Math.max(0, ordered - qty_shipped);
      const qty_to_receive = qty_in_transit;

      const shipDateMatch = (line.remarks || '').match(/(?:Ship Date|Shipment Date|Shipment):\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
      const receiptDateMatch = (line.remarks || '').match(/(?:Receipt Date|Receipt|Exp\.\s*Delivery|Delivery|Exp\.\s*Arrival):\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
      const unitCostMatch = (line.remarks || '').match(/(?:Unit Cost|Rate|Cost):\s*([0-9]+(?:\.[0-9]+)?)/i);
      const amountMatch = (line.remarks || '').match(/(?:Amount|Total|Value):\s*([0-9]+(?:\.[0-9]+)?)/i);

      const shipment_date = shipDateMatch ? shipDateMatch[1] : null;
      const receipt_date = receiptDateMatch ? receiptDateMatch[1] : null;

      const shipmentEntry = lineShipments[0];
      const unit_cost = shipmentEntry
        ? Number(shipmentEntry.unit_cost || 0)
        : unitCostMatch
        ? Number(unitCostMatch[1])
        : null;
      const amount =
        unit_cost !== null
          ? Math.round(ordered * unit_cost * 100) / 100
          : amountMatch
          ? Number(amountMatch[1])
          : null;

      return {
        ...line,
        qty_shipped,
        qty_received,
        qty_doa,
        doa_quantity: qty_doa,
        qty_in_transit,
        qty_to_ship,
        qty_to_receive,
        shipment_date,
        receipt_date,
        unit_cost,
        amount,
      };
    });
  }

  async findOne(id: string) {
    const scope = farmScope(this.cls);
    const conditions = [
      eq(schema.stockTransfer.transfer_id, id),
      isNull(schema.stockTransfer.deleted_at),
    ];
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
      throw new NotFoundException(`Transfer Order with ID '${id}' not found.`);
    }

    const lines = await this.db
      .select()
      .from(schema.stockTransferLine)
      .where(eq(schema.stockTransferLine.transfer_id, id));

    const ledgerEntries = await this.getLedgerHistory(transfer.transfer_no, transfer.company_id, transfer.tenant_id);
    const enrichedLines = this.enrichLinesWithQuantities(lines, ledgerEntries, transfer.status);
    const [shipped, received] = await Promise.all([
      this.shippedQuantities(id, transfer.tenant_id),
      this.receivedQuantities(id, transfer.tenant_id),
    ]);
    return {
      ...transfer,
      lines: enrichedLines.map((line: any) => ({
        ...line,
        qty_shipped: shipped.get(line.line_id) ?? 0,
        qty_received: received.get(line.line_id) ?? 0,
      })),
      ledgerEntries,
    };
  }

  async findAll(query: QueryStockTransferDto, tenantId: string) {
    const conditions: any[] = [eq(schema.stockTransfer.tenant_id, tenantId), isNull(schema.stockTransfer.deleted_at)];

    const scope = farmScope(this.cls);
    if (scope.farmId) {
      if (query.direction === 'OUTBOUND') {
        conditions.push(locationOnFarm(schema.stockTransfer.from_warehouse_id, scope.farmId)!);
      } else if (query.direction === 'INBOUND') {
        conditions.push(locationOnFarm(schema.stockTransfer.to_warehouse_id, scope.farmId)!);
      } else {
        conditions.push(
          or(
            locationOnFarm(schema.stockTransfer.from_warehouse_id, scope.farmId),
            locationOnFarm(schema.stockTransfer.to_warehouse_id, scope.farmId)
          )!
        );
      }
    }
    conditions.push(...restrictedScopeConditions(scope, { companyId: schema.stockTransfer.company_id }));
    if (scope.restricted && scope.lobId) {
      if (query.direction === 'OUTBOUND') {
        conditions.push(
          sql`${schema.stockTransfer.from_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`
        );
      } else if (query.direction === 'INBOUND') {
        conditions.push(
          sql`${schema.stockTransfer.to_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`
        );
      } else {
        conditions.push(or(
          sql`${schema.stockTransfer.from_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`,
          sql`${schema.stockTransfer.to_warehouse_id} IN (SELECT lsl.location_id FROM location_master lsl WHERE lsl.lob_id = ${scope.lobId})`,
        )!);
      }
    }

    if (query.companyId) conditions.push(eq(schema.stockTransfer.company_id, query.companyId));
    if (query.status) conditions.push(eq(schema.stockTransfer.status, query.status));
    if (query.fromWarehouseId) conditions.push(eq(schema.stockTransfer.from_warehouse_id, query.fromWarehouseId));
    if (query.toWarehouseId) conditions.push(eq(schema.stockTransfer.to_warehouse_id, query.toWarehouseId));
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

  async getPendingReceipts(query: QueryStockTransferDto, tenantId: string) {
    return this.findAll({ ...query, status: 'IN_TRANSIT', direction: 'INBOUND' }, tenantId);
  }

  async getReceiptHistory(query: QueryStockTransferDto, tenantId: string) {
    const scope = farmScope(this.cls);
    const conditions: any[] = [
      eq(schema.inventoryLedger.tenant_id, tenantId),
      eq(schema.inventoryLedger.document_type, 'STOCK_TRANSFER'),
      eq(schema.inventoryLedger.transaction_type, 'TRANSFER_RECEIPT'),
    ];

    if (query.companyId) {
      conditions.push(eq(schema.inventoryLedger.company_id, query.companyId));
    }
    if (scope.farmId) {
      conditions.push(locationOnFarm(schema.inventoryLedger.warehouse_id, scope.farmId)!);
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.inventoryLedger.document_no, `%${query.search}%`),
          like(schema.inventoryLedger.external_reference_no, `%${query.search}%`),
          like(schema.inventoryLedger.serial_no, `%${query.search}%`),
          like(schema.inventoryLedger.lot_no, `%${query.search}%`),
          like(schema.inventoryLedger.item_code, `%${query.search}%`),
          like(schema.inventoryLedger.item_description, `%${query.search}%`),
        )!,
      );
    }

    const receipts = await this.db
      .select({
        ledger_id: schema.inventoryLedger.ledger_id,
        transfer_no: schema.inventoryLedger.document_no,
        posting_date: schema.inventoryLedger.posting_date,
        created_at: schema.inventoryLedger.created_at,
        item_id: schema.inventoryLedger.item_id,
        item_code: schema.inventoryLedger.item_code,
        item_name: schema.inventoryLedger.item_description,
        quantity: schema.inventoryLedger.quantity,
        uom: schema.inventoryLedger.uom,
        rate: schema.inventoryLedger.rate,
        lot_no: schema.inventoryLedger.lot_no,
        serial_no: schema.inventoryLedger.serial_no,
        warehouse_id: schema.inventoryLedger.warehouse_id,
        created_by: schema.inventoryLedger.created_by,
        external_reference_no: schema.inventoryLedger.external_reference_no,
        document_line_id: schema.inventoryLedger.document_line_id,
      })
      .from(schema.inventoryLedger)
      .where(and(...conditions))
      .orderBy(desc(schema.inventoryLedger.created_at))
      .limit(query.limit || 100)
      .offset(query.offset || 0);

    const transferNos = [...new Set(receipts.map((r) => r.transfer_no).filter(Boolean))];
    const transfers = transferNos.length > 0
      ? await this.db
          .select({
            transfer_id: schema.stockTransfer.transfer_id,
            transfer_no: schema.stockTransfer.transfer_no,
            from_warehouse_id: schema.stockTransfer.from_warehouse_id,
            to_warehouse_id: schema.stockTransfer.to_warehouse_id,
            transfer_status: schema.stockTransfer.status,
          })
          .from(schema.stockTransfer)
          .where(
            and(
              eq(schema.stockTransfer.tenant_id, tenantId),
              inArray(schema.stockTransfer.transfer_no, transferNos),
            ),
          )
      : [];

    const transferMap = new Map(transfers.map((t) => [t.transfer_no, t]));

    const itemIds = [...new Set(receipts.map((r) => r.item_id).filter(Boolean))] as string[];
    const items = itemIds.length > 0
      ? await this.db
          .select({
            item_id: schema.itemMaster.item_id,
            item_code: schema.itemMaster.item_code,
            item_name: schema.itemMaster.item_name,
          })
          .from(schema.itemMaster)
          .where(and(eq(schema.itemMaster.tenant_id, tenantId), inArray(schema.itemMaster.item_id, itemIds)))
      : [];

    const itemMap = new Map(items.map((i) => [i.item_id, i]));

    const userIds = [...new Set(receipts.map((r) => r.created_by).filter(Boolean))] as string[];
    const users = userIds.length > 0
      ? await this.db
          .select({
            user_id: schema.userMaster.user_id,
            full_name: schema.userMaster.full_name,
          })
          .from(schema.userMaster)
          .where(and(eq(schema.userMaster.tenant_id, tenantId), inArray(schema.userMaster.user_id, userIds)))
      : [];
    const userMap = new Map(users.map((u) => [u.user_id, u.full_name]));

    // Deduplicate twin DOA entries: if a primary receipt already accounts for the DOA qty, skip the secondary DOA receipt entry
    const primaryReceiptLineIds = new Set(
      receipts
        .filter((r) => (r.external_reference_no || '').startsWith('DOA:'))
        .map((r) => `${r.transfer_no}_${r.document_line_id}_${r.posting_date}`),
    );

    const filteredReceipts = receipts.filter((r) => {
      const isDoaTwin = r.external_reference_no === 'DOA_IN_TRANSIT';
      if (isDoaTwin && primaryReceiptLineIds.has(`${r.transfer_no}_${r.document_line_id}_${r.posting_date}`)) {
        return false;
      }
      return true;
    });

    return filteredReceipts.map((r) => {
      const parentTransfer = transferMap.get(r.transfer_no);
      const it = itemMap.get(r.item_id!);
      const authorName = (r.created_by && userMap.get(r.created_by)) || r.created_by || 'System';

      const isDoaTwin = r.external_reference_no === 'DOA_IN_TRANSIT';
      let doa_qty = 0;
      let good_qty = Number(r.quantity || 0);

      if (isDoaTwin) {
        good_qty = 0;
        doa_qty = Number(r.quantity || 0);
      } else if (r.external_reference_no?.startsWith('DOA:')) {
        const parsed = Number(r.external_reference_no.split(':')[1]);
        if (!isNaN(parsed) && parsed > 0) {
          doa_qty = parsed;
        }
      }

      return {
        ledger_id: r.ledger_id,
        receipt_no: `GRN-${r.ledger_id.slice(0, 8).toUpperCase()}`,
        transfer_id: parentTransfer?.transfer_id || null,
        transfer_no: r.transfer_no,
        posting_date: r.posting_date,
        created_at: r.created_at,
        created_by: authorName,
        created_by_name: authorName,
        from_warehouse_id: parentTransfer?.from_warehouse_id || null,
        to_warehouse_id: r.warehouse_id || parentTransfer?.to_warehouse_id || null,
        warehouse_id: r.warehouse_id,
        transfer_status: parentTransfer?.transfer_status || 'RECEIVED',
        item_id: r.item_id,
        item_code: it?.item_code || r.item_code || r.item_id,
        item_name: it?.item_name || r.item_name || '—',
        quantity: good_qty,
        doa_quantity: doa_qty,
        uom: r.uom,
        rate: r.rate,
        lot_no: r.lot_no,
        serial_no: r.serial_no,
        document_line_id: r.document_line_id,
        remarks: r.external_reference_no || '',
      };
    });
  }

  private assertDraft(transfer: { status: string }) {
    if (transfer.status !== 'DRAFT') {
      throw new BadRequestException(`Transfer Order cannot be modified — it is already ${transfer.status}.`);
    }
  }

  /** Shipment numbers already posted against the transfer, oldest first. */
  private async shipmentNos(transferId: string, tenantId: string): Promise<string[]> {
    const rows = await this.db
      .select({ shipment_no: schema.transferShipment.shipment_no })
      .from(schema.transferShipment)
      .where(and(
        eq(schema.transferShipment.transfer_id, transferId),
        eq(schema.transferShipment.tenant_id, tenantId),
        isNull(schema.transferShipment.deleted_at),
      ))
      .orderBy(schema.transferShipment.shipment_no);
    return rows.map((r) => r.shipment_no);
  }

  /**
   * Once any shipment exists the order is fixed (Part E Task 4b): an edit
   * replaces the lines with new ids and orphans the shipment/receipt lines,
   * or moves the destination after the stock has left; a cancel leaves the
   * stock in In Transit with no reversal. The events are read, not only the
   * status, so a DRAFT row written before statuses followed events is
   * refused too.
   */
  private async assertNotShipped(transfer: { transfer_id: string; transfer_no: string }, tenantId: string, action: 'edited' | 'cancelled') {
    const shipped = await this.shipmentNos(transfer.transfer_id, tenantId);
    if (shipped.length > 0) {
      throw new BadRequestException(
        `Stock Transfer ${transfer.transfer_no} cannot be ${action} — stock has already shipped on ${shipped.join(', ')}. ` +
        'Receive what was shipped; the order can no longer change.',
      );
    }
  }

  /**
   * A further shipment or receipt may be posted while the transfer is open:
   * DRAFT, IN_TRANSIT or PARTIALLY_RECEIVED (Part E Task 4b). assertDraft
   * stays for the edits that must stop once stock has moved.
   */
  private assertOpen(transfer: { status: string; transfer_no?: string }) {
    if (!(OPEN_TRANSFER_STATUSES as readonly string[]).includes(transfer.status)) {
      const name = transfer.transfer_no ? `Stock Transfer ${transfer.transfer_no}` : 'Stock Transfer';
      throw new BadRequestException(`${name} cannot take a further shipment or receipt — it is already ${transfer.status}.`);
    }
  }

  /**
   * Write the status the events now imply (transferStatusFor), inside the
   * event's own transaction. POSTED carries the same posted_at / posted_by
   * stamping postDirectTransfer has always used. The row is already locked
   * by loadForMutation; the open-status guard on the UPDATE is the same
   * claim discipline as the old DRAFT -> POSTED claim.
   */
  private async writeEventStatus(
    id: string,
    lines: Array<{ line_id: string; quantity: unknown }>,
    shipped: Map<string, number>,
    received: Map<string, number>,
    userPayload?: any,
  ) {
    const status = transferStatusFor(lines.map((l) => ({
      ordered: Number(l.quantity),
      shipped: shipped.get(l.line_id) ?? 0,
      received: received.get(l.line_id) ?? 0,
    })));
    const set: Record<string, unknown> = {
      status,
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };
    if (status === 'POSTED') {
      set.posted_at = toMysqlTimestamp();
      set.posted_by = userPayload?.userId || null;
    }
    const [claim] = await this.db
      .update(schema.stockTransfer)
      .set(set as any)
      .where(and(eq(schema.stockTransfer.transfer_id, id), inArray(schema.stockTransfer.status, [...OPEN_TRANSFER_STATUSES])));
    if (claim.affectedRows === 0) {
      throw new BadRequestException('Stock Transfer cannot take this event — it was already posted or cancelled by another request.');
    }
    return status;
  }

  async update(id: string, dto: UpdateStockTransferDto, tenantId: string, userPayload?: any) {
    return withTenantTransaction(this.cls, async () => {
      const transfer = await this.loadForMutation(id, tenantId);

      // Both warehouses, changed or not, against create()'s rules. The source
      // staying on the editor's farm is also what keeps the edited transfer
      // visible to them whatever to_warehouse_id becomes.
      const fromWarehouseId = dto.from_warehouse_id ?? transfer.from_warehouse_id;
      const toWarehouseId = dto.to_warehouse_id ?? transfer.to_warehouse_id;
      // M6 (fix round 1): the cheap, event-based refusal first — if stock has
      // already shipped the edit is refused outright, so there is no reason
      // to also validate warehouses the caller may be trying to change.
      // Reads only below; nothing is written before both refusals.
      await this.assertNotShipped(transfer, tenantId, 'edited');
      this.assertDraft(transfer);
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
        // Fix round 2, Important (coordinator, 4 Oct): round 1's position
        // (line_no) inference was unsound — insertLines always assigns
        // line_no = idx + 1 with no item cross-check, so a reorder swaps two
        // lines' links, a removal from the front/middle hands the survivor a
        // stranger's FK, and a front-insertion misattributes two links while
        // silently dropping a third. That trades a loud NULL for a silent
        // wrong FK (shipped/received quantities posted to the wrong
        // requisition line) — worse, not better. There is no sound inference
        // here: only the caller knows which incoming line is which. So this
        // refuses instead: if the transfer carries ANY requisition_line_id
        // today, every replacement line must supply its own; an ordinary
        // hand-made transfer (no links anywhere) is unaffected.
        const existingLinks = await this.db
          .select({ requisition_line_id: schema.stockTransferLine.requisition_line_id })
          .from(schema.stockTransferLine)
          .where(eq(schema.stockTransferLine.transfer_id, id));
        const hasExistingLinks = existingLinks.some((l) => l.requisition_line_id);
        if (hasExistingLinks && dto.lines.some((line) => !line.requisition_line_id)) {
          throw new BadRequestException(
            `Stock Transfer ${transfer.transfer_no} came from a requisition release; every replacement line must supply its requisition_line_id.`,
          );
        }
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
      await this.assertNotShipped(transfer, tenantId, 'cancelled');
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

      return { success: true, message: `Transfer Order '${transfer.transfer_no}' has been cancelled.` };
    });
  }

  /**
   * P1 follow-up I1 (Rishi, 4 and 5 Oct): a transfer created by a requisition's
   * Release is posted from the requisition only. There the From department
   * ships and the requester receives. The generic stock-transfer posting
   * routes call this first, and so do PUT and DELETE, because editing or
   * cancelling the transfer would change what the requisition ships and
   * receives behind its back. postShipment and postReceipt do not, because
   * RequisitionService.ship and receive call them after their own checks. A
   * transfer is linked when any line carries a requisition_line_id, the same
   * test update() applies to replacement lines.
   */
  async assertNotRequisitionTransfer(id: string, tenantId: string): Promise<void> {
    const [linked] = await this.db
      .select({
        requisition_line_id: schema.stockTransferLine.requisition_line_id,
        transfer_no: schema.stockTransfer.transfer_no,
        req_no: schema.requisition.req_no,
      })
      .from(schema.stockTransferLine)
      .innerJoin(schema.stockTransfer, eq(schema.stockTransfer.transfer_id, schema.stockTransferLine.transfer_id))
      .leftJoin(schema.requisitionLine, eq(schema.requisitionLine.line_id, schema.stockTransferLine.requisition_line_id))
      .leftJoin(schema.requisition, eq(schema.requisition.requisition_id, schema.requisitionLine.requisition_id))
      .where(and(
        eq(schema.stockTransferLine.transfer_id, id),
        eq(schema.stockTransfer.tenant_id, tenantId),
        sql`${schema.stockTransferLine.requisition_line_id} IS NOT NULL`,
      ))
      .limit(1);
    if (linked) {
      throw new BadRequestException(
        `Stock Transfer ${linked.transfer_no} belongs to requisition ${linked.req_no ?? '(unknown)'}; post its shipment and receipt from the requisition.`,
      );
    }
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
  async postShipment(id: string, dto: PostShipmentDto, tenantId: string, userPayload?: any, requisitionExecution = false) {
    const result = await withTenantTransaction(this.cls, async () => {
      const transfer = await this.loadForMutation(id, tenantId, requisitionExecution);
      this.assertOpen(transfer);
      if (transfer.from_warehouse_id === transfer.to_warehouse_id) {
        throw new BadRequestException('A transfer needs two different warehouses.');
      }
      if (!requisitionExecution) await this.assertWarehouses(transfer.from_warehouse_id, transfer.to_warehouse_id);
      await this.assertSiloDestination(transfer, transfer.lines, tenantId);

      this.assertDistinctLines(dto.lines, 'shipment');
      // Cumulative shipped quantities per line, from the events so far.
      const shippedByLine = await this.shippedQuantities(id, tenantId);
      const eventLines: Array<{ line: typeof schema.stockTransferLine.$inferSelect; qty: number; balance: number; lotNo?: string; serialNo?: string }> = [];
      for (const input of dto.lines) {
        const line = transfer.lines.find((l) => l.line_id === input.line_id);
        if (!line) throw new BadRequestException(`Transfer line '${input.line_id}' is not part of ${transfer.transfer_no}.`);
        const alreadyShipped = shippedByLine.get(line.line_id) ?? 0;
        // Bounds run in the line's own UOM: the ordered quantity is the line,
        // already-shipped comes from the events.
        this.assertShipment(Number(line.quantity), alreadyShipped, input.quantity, line);
        eventLines.push({ line, qty: input.quantity, balance: Number(line.quantity) - alreadyShipped, lotNo: line.lot_no ?? undefined, serialNo: line.serial_no ?? undefined });
      }
      // WP1c: a tracked item (is_lot_tracked / is_serial_tracked on the
      // Item Master) refuses shipment without its lot/serial assignment. Load
      // the flags once, per distinct item, so a line's assignment and qty
      // cannot disagree (the hole the WP1c ruled was closed).
      const itemFlags = new Map<string, { isLotTracked: boolean; isSerialTracked: boolean }>();
      if (eventLines.some((e) => e.line.item_id)) {
        const itemIds = [...new Set(eventLines.map((e) => e.line.item_id).filter((v): v is string => Boolean(v)))];
        const flags = await this.db
          .select({ item_id: schema.itemMaster.item_id, is_lot_tracked: schema.itemMaster.is_lot_tracked, is_serial_tracked: schema.itemMaster.is_serial_tracked })
          .from(schema.itemMaster)
          .where(and(eq(schema.itemMaster.tenant_id, tenantId), inArray(schema.itemMaster.item_id, itemIds)));
        for (const f of flags) itemFlags.set(f.item_id, { isLotTracked: Boolean(f.is_lot_tracked), isSerialTracked: Boolean(f.is_serial_tracked) });
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
      // Enforce before anything is written: a tracked item's lot/serial
      // assignment must exist and cover the shipped quantity exactly.
      // WP4a fix round 1: the ONE tracking rule (also the requisition's Item
      // Tracking route's) — a serial-tracked line ships its whole balance with
      // exactly one serial per unit.
      for (const { line, qty, balance, lotNo, serialNo } of eventLines) {
        const flags = itemFlags.get(line.item_id ?? '');
        if (flags?.isLotTracked || flags?.isSerialTracked) {
          assertTrackingForShipment(flags, { lot_no: lotNo ?? null, serial_no: serialNo ?? null }, qty, balance);
        }
      }

      for (const { line, qty, lotNo, serialNo } of eventLines) {
        // Out of the source only; the destination leg is the receipt's (Part E Task 4).
        // WP4a fix round 1: a serial-tracked line leaves as one ledger row per
        // serial — each a FIFO draw of exactly that unit from the From location
        // (strict, writeTransferShipment) — and the shipment line records the
        // identities those rows were written with, so the receipt copies exactly
        // what left. A lot is FIFO-filtered to the line's lot and recorded from
        // its ledger row the same way.
        const serials = itemFlags.get(line.item_id ?? '')?.isSerialTracked
          ? String(serialNo ?? '').split(',').map((v) => v.trim()).filter(Boolean)
          : [];
        const draws = serials.length > 0 ? serials.map((sn) => ({ quantity: 1, serialNo: sn as string | undefined })) : [{ quantity: qty, serialNo }];
        const entries: Array<{ lot_no?: string | null; serial_no?: string | null }> = [];
        for (const draw of draws) {
          const shipmentEntry = await this.ledgerService.writeTransferShipment({
            tenantId, companyId: transfer.company_id, itemId: line.item_id, documentNo: shipmentNo, documentLineId: line.line_id,
            postingDate: dto.posting_date, quantity: draw.quantity, uom: line.uom, fromWarehouseId: transfer.from_warehouse_id,
            lotNo, serialNo: draw.serialNo, userId: userPayload?.userId,
          });
          await this.glPostingService.postInventoryLedgerEntry(shipmentEntry, userPayload?.userId);
          entries.push({ lot_no: shipmentEntry?.lot_no, serial_no: shipmentEntry?.serial_no });
        }
        const recorded = (key: 'lot_no' | 'serial_no', requested: string | undefined) => {
          const values = entries.map((e) => (e[key] === undefined ? requested : e[key])).filter((v): v is string => Boolean(v));
          return values.length ? [...new Set(values)].join(',') : null;
        };
        await this.db.insert(schema.transferShipmentLine).values({
          shipment_id: shipmentId,
          line_id: line.line_id,
          quantity: String(qty),
          uom: line.uom,
          lot_no: recorded('lot_no', lotNo),
          serial_no: serials.length > 0 ? recorded('serial_no', undefined) ?? serials.join(',') : recorded('serial_no', serialNo),
        });
      }

      // Status follows the event (Part E Task 4b): shipped so far plus this
      // shipment, against what has been received.
      const shippedAfter = new Map(shippedByLine);
      for (const { line, qty } of eventLines) shippedAfter.set(line.line_id, (shippedAfter.get(line.line_id) ?? 0) + qty);
      const status = await this.writeEventStatus(id, transfer.lines, shippedAfter, await this.receivedQuantities(id, tenantId), userPayload);

      await this.auditService.log({
        tenantId,
        companyId: transfer.company_id,
        userId: userPayload?.userId,
        action: 'POST',
        entityName: 'transfer_shipment',
        entityId: shipmentId,
        newValues: { shipment_no: shipmentNo, transfer_no: transfer.transfer_no, lines: eventLines.length, status },
      });
      // Part E Task 7: a requisition linked to this transfer follows its events.
      await syncRequisitionFulfilment(this.db, id);
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
  async postReceipt(id: string, dto: PostReceiptDto, tenantId: string, userPayload?: any, requisitionExecution = false) {
    return withTenantTransaction(this.cls, async () => {
      const transfer = await this.loadForMutation(id, tenantId, requisitionExecution);
      this.assertOpen(transfer);
      if (!requisitionExecution) await this.assertWarehouses(transfer.from_warehouse_id, transfer.to_warehouse_id);

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
        // The same 1e-9 tolerance as the shipment-level bound just below (and
        // assertShipment) — alreadyShipped sums real event rows in JS float
        // arithmetic, so closing a line shipped as e.g. 0.6 + 0.7 must not
        // read as short of 0.7 remaining (fix round 1, Important 1).
        if (input.quantity > alreadyShipped - alreadyReceived + 1e-9) {
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
        // WP4a: several serials on one shipment line land as one layer PER
        // SERIAL (qty 1 each, the Goods Receipt's shape) — a single layer named
        // "SN1,SN2" matched no consumer. A partial receipt takes the next
        // serials not yet received on this shipment line.
        const shippedSerials = String(shipmentLine.serial_no ?? '').split(',').map((v) => v.trim()).filter(Boolean);
        let receivedSerialNo = shipmentLine.serial_no;
        if (shippedSerials.length > 1) {
          const serials = serialsForReceipt(shipmentLine.serial_no, prior.qty, input.quantity);
          const amounts = splitAmount(amount ?? input.quantity * rate, serials.length);
          for (const [i, serialNo] of serials.entries()) {
            const entry = await this.ledgerService.writeTransferReceipt({
              tenantId, companyId: transfer.company_id, itemId: line.item_id, documentNo: receiptNo, documentLineId: line.line_id,
              postingDate: dto.posting_date, quantity: 1, uom: line.uom, toWarehouseId: transfer.to_warehouse_id, rate, amount: amounts[i],
              lotNo: shipmentLine.lot_no ?? undefined, serialNo, userId: userPayload?.userId,
            });
            await this.glPostingService.postInventoryLedgerEntry(entry, userPayload?.userId);
          }
          receivedSerialNo = serials.join(',');
        } else {
          const receiptEntry = await this.ledgerService.writeTransferReceipt({
            tenantId, companyId: transfer.company_id, itemId: line.item_id, documentNo: receiptNo, documentLineId: line.line_id,
            postingDate: dto.posting_date, quantity: input.quantity, uom: line.uom, toWarehouseId: transfer.to_warehouse_id, rate, amount,
            lotNo: shipmentLine.lot_no ?? undefined, serialNo: shipmentLine.serial_no ?? undefined, userId: userPayload?.userId,
          });
          await this.glPostingService.postInventoryLedgerEntry(receiptEntry, userPayload?.userId);
        }
        await this.db.insert(schema.transferReceiptLine).values({
          receipt_id: receiptId,
          shipment_line_id: shipmentLine.shipment_line_id,
          line_id: line.line_id,
          quantity: String(input.quantity),
          uom: line.uom,
          // Identity copied from the shipment, never re-typed (spec) — for a
          // multi-serial line, the serials this receipt actually carried.
          lot_no: shipmentLine.lot_no,
          serial_no: receivedSerialNo,
        });
      }

      // Status follows the event (Part E Task 4b): received so far plus this
      // receipt, against everything shipped.
      const receivedAfter = new Map(receivedByLine);
      for (const l of dto.lines) receivedAfter.set(l.line_id, (receivedAfter.get(l.line_id) ?? 0) + l.quantity);
      const status = await this.writeEventStatus(id, transfer.lines, shippedByLine, receivedAfter, userPayload);

      await this.auditService.log({
        tenantId,
        companyId: transfer.company_id,
        userId: userPayload?.userId,
        action: 'POST',
        entityName: 'transfer_receipt',
        entityId: receiptId,
        newValues: { receipt_no: receiptNo, shipment_no: shipment.shipment_no, lines: dto.lines.length, status },
      });
      // Part E Task 7: a requisition linked to this transfer follows its events.
      await syncRequisitionFulfilment(this.db, id);
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
      if (dto.lines.length === 0 && row.status !== 'DRAFT') {
        throw new BadRequestException(`Stock Transfer ${row.transfer_no} cannot be posted in one step — it is already ${row.status}.`);
      }
      this.assertOpen(row);
      if (row.from_warehouse_id === row.to_warehouse_id) {
        throw new BadRequestException('A transfer needs two different warehouses.');
      }
      await this.assertWarehouses(row.from_warehouse_id, row.to_warehouse_id);
      if (dto.lines.length === 0) {
        // The one-step whole-order post (post(), or Direct Transfer with no
        // lines) ships and receives every line in full, so it only fits a
        // DRAFT with no events. Without this it failed later on the balance
        // ("exceeds the remaining balance to ship"), which did not say why.
        const shipped = await this.shipmentNos(id, tenantId);
        if (shipped.length > 0) {
          throw new BadRequestException(
            `Stock Transfer ${row.transfer_no} cannot be posted in one step — it already has shipment ${shipped.join(', ')}. ` +
            'Receive against the shipment, or post the remaining quantity with Direct Transfer.',
          );
        }
      }
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
        // Same 1e-9 tolerance as postReceipt's identical bound (fix round 1,
        // Important 1): shippedByLine/receivedByLine sum real event rows in
        // JS float arithmetic.
        if (input.quantity > remainingToReceive + 1e-9) {
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

      // No claim of its own any more (Part E Task 4b): postShipment and
      // postReceipt each write the status their event implies, so a full
      // direct transfer ends POSTED (stamped) through postReceipt, and a
      // partial one ends PARTIALLY_RECEIVED, open for further events.
      const after = await this.findOne(id);

      await this.auditService.log({
        tenantId,
        companyId: row.company_id,
        userId: userPayload?.userId,
        action: 'POST',
        entityName: 'stock_transfer',
        entityId: id,
        newValues: { status: after.status, shipment_no: shipment.shipment_no, receipt_no: receipt.receipt_no },
      });
      return after;
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

  /** SH-2026-0001 / RC-2026-0001 per tenant — keep the series monotonic even
   * when older rows were inserted out of order. The old lexical `ORDER BY`
   * lookup could reuse an existing number inside a posting transaction. */
  private async nextEventNo(companyId: string, tenantId: string, kind: 'SH' | 'RC'): Promise<string> {
    const table = kind === 'SH' ? schema.transferShipment : schema.transferReceipt;
    const noColumn = kind === 'SH' ? schema.transferShipment.shipment_no : schema.transferReceipt.receipt_no;
    const year = new Date().getFullYear();
    const prefix = `${kind === 'SH' ? 'SH' : 'RC'}-${year}-`;
    const [last] = await this.db
      .select({ maxSeq: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${noColumn}, ${prefix.length + 1}) AS UNSIGNED)), 0)` })
      .from(table)
      .where(and(eq(table.tenant_id, tenantId), like(noColumn, `${prefix}%`)))
      .for('update');
    const lastSeq = Number(last?.maxSeq ?? 0);
    return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(4, '0')}`;
  }

  /**
   * Step 1 of a Two-Step Stock Transfer:
   * Ships / dispatches goods out of the source warehouse.
   * Supports partial shipments: original ordered quantities are preserved,
   * un-shipped balance remains available for subsequent shipments, and status is set to IN_TRANSIT.
   */
  async ship(
    id: string,
    dtoOrTenantId: ShipStockTransferDto | string = {},
    tenantIdOrUser?: string | any,
    userPayload?: any,
  ) {
    let dto: ShipStockTransferDto = {};
    let tenantId: string;
    let user: any = userPayload;

    if (typeof dtoOrTenantId === 'string') {
      tenantId = dtoOrTenantId;
      user = tenantIdOrUser;
      dto = {};
    } else {
      dto = dtoOrTenantId || {};
      tenantId = typeof tenantIdOrUser === 'string' ? tenantIdOrUser : '';
      user = userPayload;
    }

    const shipped = await withTenantTransaction(this.cls, async () => {
      const transfer = await this.loadForMutation(id, tenantId);

      // Allowed statuses for shipping: DRAFT, IN_TRANSIT (subsequent partial shipment)
      if (['CANCELLED', 'POSTED'].includes(transfer.status)) {
        throw new BadRequestException(`Transfer Order cannot be shipped — it is ${transfer.status}.`);
      }
      await this.assertWarehouses(transfer.from_warehouse_id, transfer.to_warehouse_id);

      if (!transfer.lines || transfer.lines.length === 0) {
        throw new BadRequestException('Cannot ship a Transfer Order with no lines.');
      }

      // Fetch existing shipment history for this transfer order
      const existingLedger = await this.getLedgerHistory(transfer.transfer_no, transfer.company_id, tenantId);
      const enrichedLines = this.enrichLinesWithQuantities(transfer.lines, existingLedger);

      // Determine lines and quantities to ship in this batch
      const itemsToShip: Array<{
        line: typeof transfer.lines[0];
        shipQty: number;
        lotNo?: string;
        serialNo?: string;
        remarks?: string;
      }> = [];

      for (const line of enrichedLines) {
        const remainingToShip = line.qty_to_ship;
        const lineInput = dto.lines?.find(
          (l) => (l.line_id && l.line_id === line.line_id) || (l.item_id && l.item_id === line.item_id),
        );

        let shipQty = 0;
        if (lineInput) {
          shipQty = Number(lineInput.quantity);
          if (isNaN(shipQty) || shipQty < 0) {
            throw new BadRequestException(`Ship quantity must be non-negative for item '${line.item_id}'.`);
          }
          if (shipQty > remainingToShip + 0.0001) {
            throw new BadRequestException(
              `Ship quantity (${shipQty}) cannot exceed remaining un-shipped quantity (${remainingToShip}). Ordered: ${line.quantity}, already shipped: ${line.qty_shipped}.`,
            );
          }
        } else if (!dto.lines || dto.lines.length === 0) {
          // If no specific lines payload provided, ship whatever remains un-shipped
          shipQty = remainingToShip;
        }

        if (shipQty > 0) {
          itemsToShip.push({
            line,
            shipQty,
            lotNo: lineInput?.lot_no ?? line.lot_no,
            serialNo: lineInput?.serial_no ?? line.serial_no,
            remarks: lineInput?.remarks ?? line.remarks,
          });
        }
      }

      if (itemsToShip.length === 0) {
        throw new BadRequestException('All quantities on this Transfer Order have already been shipped.');
      }

      // Check on-hand stock for all items being shipped
      for (const item of itemsToShip) {
        const balances = await this.ledgerService.getStockBalance(
          { companyId: transfer.company_id, warehouseId: transfer.from_warehouse_id, itemId: item.line.item_id } as any,
          tenantId,
        );
        let onHand = 0;
        if (item.lotNo) {
          const directLot = balances.find((b: any) => b.lot_no === item.lotNo);
          if (directLot) {
            onHand = Number(directLot.on_hand_qty || 0);
          } else {
            try {
              const lots = await this.ledgerService.getAvailableLots(
                {
                  companyId: transfer.company_id,
                  warehouseId: transfer.from_warehouse_id,
                  itemId: item.line.item_id,
                } as any,
                tenantId,
              );
              const lotBalance = (lots || []).find((l: any) => l.lot_no === item.lotNo);
              onHand = lotBalance ? Number(lotBalance.remaining_quantity || 0) : 0;
            } catch {
              onHand = balances.reduce((acc: number, b: any) => acc + Number(b.on_hand_qty || 0), 0);
            }
          }
        } else {
          onHand = balances.reduce((acc: number, b: any) => acc + Number(b.on_hand_qty || 0), 0);
        }
        if (item.shipQty > onHand + 0.0001) {
          throw new BadRequestException(
            `Cannot ship line for item '${item.line.item_id}' — source location has ${onHand} ${item.line.uom} available, but ${item.shipQty} ${item.line.uom} was requested.`,
          );
        }
      }

      const shipmentPostingDate = dto.posting_date || transfer.posting_date || new Date().toISOString().slice(0, 10);

      // Append logistics tracking details to remarks if provided
      const logisticsParts: string[] = [];
      if (dto.vehicle_no) logisticsParts.push(`Vehicle: ${dto.vehicle_no}`);
      if (dto.driver_name) logisticsParts.push(`Driver: ${dto.driver_name}`);
      if (dto.waybill_ref) logisticsParts.push(`Waybill: ${dto.waybill_ref}`);
      if (dto.remarks) logisticsParts.push(dto.remarks);

      let formattedRemarks = transfer.remarks;
      if (logisticsParts.length > 0) {
        formattedRemarks = [transfer.remarks, logisticsParts.join(' | ')].filter(Boolean).join('\n');
      }

      // Update transfer status to IN_TRANSIT
      await this.db
        .update(schema.stockTransfer)
        .set({
          status: 'IN_TRANSIT',
          posting_date: shipmentPostingDate,
          remarks: formattedRemarks,
          posted_at: toMysqlTimestamp() as any,
          posted_by: user?.userId || null,
          updated_by: user?.userId || null,
        })
        .where(eq(schema.stockTransfer.transfer_id, id));

      // Post TRANSFER_SHIPMENT entry for each shipped line item (without mutating ordered quantity in stock_transfer_line)
      for (const item of itemsToShip) {
        // Update tracking on line if specified
        if (item.lotNo || item.serialNo || item.remarks) {
          const lineUpdates: any = {};
          if (item.lotNo) lineUpdates.lot_no = item.lotNo;
          if (item.serialNo) lineUpdates.serial_no = item.serialNo;
          if (item.remarks) lineUpdates.remarks = item.remarks;
          await this.db
            .update(schema.stockTransferLine)
            .set(lineUpdates)
            .where(eq(schema.stockTransferLine.line_id, item.line.line_id));
        }

        const shipment = await this.ledgerService.writeNegativeEntry({
          tenantId,
          companyId: transfer.company_id,
          itemId: item.line.item_id,
          documentType: 'STOCK_TRANSFER',
          documentNo: transfer.transfer_no,
          documentLineId: item.line.line_id,
          postingDate: shipmentPostingDate,
          transactionType: 'TRANSFER_SHIPMENT',
          entryType: 'TRANSFER',
          quantity: item.shipQty,
          uom: item.line.uom,
          lotNo: item.lotNo || undefined,
          serialNo: item.serialNo || undefined,
          warehouseId: transfer.from_warehouse_id,
          userId: user?.userId,
        });

        await this.glPostingService.postInventoryLedgerEntry(shipment, user?.userId);
      }

      await this.auditService.log({
        tenantId,
        companyId: transfer.company_id,
        userId: user?.userId,
        action: 'SHIP',
        entityName: 'stock_transfer',
        entityId: id,
        newValues: { status: 'IN_TRANSIT', remarks: formattedRemarks, posting_date: shipmentPostingDate },
      });

      return this.findOne(id);
    });

    await this.feedAlerts?.evaluateLevelsSafely([shipped.from_warehouse_id], tenantId);
    return shipped;
  }

  /**
   * Step 2 of a Two-Step Stock Transfer:
   * Confirms stock receipt at the destination warehouse/silo.
   * Atomically claims in-transit stock and writes TRANSFER_RECEIPT ledger entries.
   * If partial receipt, remaining balance is tracked accurately.
   */
  async receive(id: string, dto: ReceiveStockTransferDto, tenantId: string, userPayload?: any) {
    const received = await withTenantTransaction(this.cls, async () => {
      const transfer = await this.loadForReceive(id, tenantId);
      if (transfer.status !== 'IN_TRANSIT') {
        throw new BadRequestException(`Transfer Order cannot be received — it is ${transfer.status}, expected 'IN_TRANSIT'.`);
      }

      await assertLocationOnActiveFarm(
        this.db,
        farmScope(this.cls),
        transfer.to_warehouse_id,
        'Destination location',
      );

      // Check silo destination constraints at the moment of receiving
      await this.assertSiloDestination(transfer, transfer.lines, tenantId);

      // Fetch the shipment and receipt entries previously posted for this transfer
      const existingLedger = await this.getLedgerHistory(transfer.transfer_no, transfer.company_id, tenantId);
      const enrichedLines = this.enrichLinesWithQuantities(transfer.lines, existingLedger, transfer.status);

      const receiptPostingDate = dto.posting_date || transfer.posting_date || new Date().toISOString().slice(0, 10);

      const itemsToReceive: Array<{
        line: typeof enrichedLines[0];
        receivedQty: number;
        doaQty: number;
        doaRemarks: string;
        rate: number;
        lotNo?: string;
        serialNo?: string;
        doaSerialNo?: string;
      }> = [];

      for (const line of enrichedLines) {
        const inTransit = line.qty_in_transit;
        const lineDto = dto.lines?.find((l) => l.line_id === line.line_id);

        let receivedQty = 0;
        let doaQty = 0;
        let doaRemarks = '';

        if (lineDto) {
          receivedQty = Number(lineDto.received_quantity || 0);
          doaQty = Number(lineDto.doa_quantity || 0);
          doaRemarks = lineDto.doa_remarks || '';

          if (isNaN(receivedQty) || receivedQty < 0) {
            throw new BadRequestException(`Received quantity must be non-negative for line ${line.line_no}.`);
          }
          if (isNaN(doaQty) || doaQty < 0) {
            throw new BadRequestException(`DOA quantity must be non-negative for line ${line.line_no}.`);
          }
          if (receivedQty + doaQty > inTransit + 0.0001) {
            throw new BadRequestException(
              doaQty > 0
                ? `Total received (${receivedQty}) plus DOA (${doaQty}) cannot exceed shipped quantity (${inTransit}) for line ${line.line_no}.`
                : `Received quantity (${receivedQty}) cannot exceed shipped quantity (${inTransit}) for line ${line.line_no}.`,
            );
          }
        } else {
          receivedQty = inTransit;
        }

        const totalAccounted = receivedQty + doaQty;
        if (totalAccounted > 0) {
          const shipmentEntry = existingLedger.find(
            (s) => (s.document_line_id === line.line_id || (!s.document_line_id && s.item_id === line.item_id)) && s.transaction_type === 'TRANSFER_SHIPMENT',
          );
          const rate = shipmentEntry?.rate ? Math.abs(Number(shipmentEntry.rate)) : Number((line as any).unit_cost || 0);

          let allocatedSerials: string | undefined = undefined;
          let doaSerials: string | undefined = undefined;
          const rawShipSerials = (shipmentEntry?.serial_no || line.serial_no || '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);

          if (rawShipSerials.length > 0) {
            const alreadyReceivedSerials = new Set(
              existingLedger
                .filter(
                  (s) =>
                    (s.document_line_id === line.line_id || (!s.document_line_id && s.item_id === line.item_id)) &&
                    s.transaction_type === 'TRANSFER_RECEIPT',
                )
                .flatMap((s) => (s.serial_no || '').split(',').map((x: string) => x.trim()).filter(Boolean)),
            );

            const availableSerials = rawShipSerials.filter((s: string) => !alreadyReceivedSerials.has(s));
            const takeGoodSerials = availableSerials.slice(0, Math.round(receivedQty));
            const takeDoaSerials = availableSerials.slice(Math.round(receivedQty), Math.round(receivedQty + doaQty));
            if (takeGoodSerials.length > 0) {
              allocatedSerials = takeGoodSerials.join(', ');
            }
            if (takeDoaSerials.length > 0) {
              doaSerials = takeDoaSerials.join(', ');
            }
          }

          itemsToReceive.push({
            line,
            receivedQty,
            doaQty,
            doaRemarks,
            rate,
            lotNo: shipmentEntry?.lot_no || line.lot_no || undefined,
            serialNo: allocatedSerials || shipmentEntry?.serial_no || line.serial_no || undefined,
            doaSerialNo: doaSerials || undefined,
          });
        }
      }

      if (itemsToReceive.length === 0) {
        throw new BadRequestException('No in-transit quantities available to receive on this Transfer Order.');
      }

      for (const item of itemsToReceive) {
        if (item.receivedQty > 0) {
          const receipt = await this.ledgerService.writePositiveEntry({
            tenantId,
            companyId: transfer.company_id,
            itemId: item.line.item_id,
            documentType: 'STOCK_TRANSFER',
            documentNo: transfer.transfer_no,
            documentLineId: item.line.line_id,
            postingDate: receiptPostingDate,
            transactionType: 'TRANSFER_RECEIPT',
            entryType: 'TRANSFER',
            quantity: item.receivedQty,
            uom: item.line.uom,
            rate: item.rate,
            lotNo: item.lotNo,
            serialNo: item.serialNo,
            warehouseId: transfer.to_warehouse_id,
            userId: userPayload?.userId,
            externalReferenceNo: item.doaQty > 0
              ? `DOA:${item.doaQty}`
              : (dto.remarks ? dto.remarks.slice(0, 50) : undefined),
          });

          await this.glPostingService.postInventoryLedgerEntry(receipt, userPayload?.userId);
        }

        if (item.doaQty > 0) {
          const doaReceipt = await this.ledgerService.writePositiveEntry({
            tenantId,
            companyId: transfer.company_id,
            itemId: item.line.item_id,
            documentType: 'STOCK_TRANSFER',
            documentNo: transfer.transfer_no,
            documentLineId: item.line.line_id,
            postingDate: receiptPostingDate,
            transactionType: 'TRANSFER_RECEIPT',
            entryType: 'TRANSFER',
            quantity: item.doaQty,
            uom: item.line.uom,
            rate: item.rate,
            lotNo: item.lotNo,
            serialNo: item.doaSerialNo,
            warehouseId: transfer.to_warehouse_id,
            userId: userPayload?.userId,
            externalReferenceNo: 'DOA_IN_TRANSIT',
          });
          await this.glPostingService.postInventoryLedgerEntry(doaReceipt, userPayload?.userId);

          const doaAdjustment = await this.ledgerService.writeNegativeEntry({
            tenantId,
            companyId: transfer.company_id,
            itemId: item.line.item_id,
            documentType: 'STOCK_ADJUSTMENT',
            documentNo: `${transfer.transfer_no}-DOA`,
            documentLineId: item.line.line_id,
            postingDate: receiptPostingDate,
            transactionType: 'VARIANCE_NEGATIVE',
            entryType: 'ADJUSTMENT',
            quantity: item.doaQty,
            uom: item.line.uom,
            lotNo: item.lotNo,
            serialNo: item.doaSerialNo,
            warehouseId: transfer.to_warehouse_id,
            userId: userPayload?.userId,
            externalReferenceNo: 'MRT-017',
          });
          await this.glPostingService.postInventoryLedgerEntry(doaAdjustment, userPayload?.userId);
        }
      }

      // Determine new status based on remaining in-transit and un-shipped quantities:
      let totalRemainingToShip = 0;
      let totalRemainingInTransit = 0;

      for (const line of enrichedLines) {
        const itemInfo = itemsToReceive.find((i) => i.line.line_id === line.line_id);
        const accountedNow = (itemInfo?.receivedQty || 0) + (itemInfo?.doaQty || 0);
        const newInTransit = Math.max(0, line.qty_in_transit - accountedNow);
        totalRemainingInTransit += newInTransit;
        totalRemainingToShip += line.qty_to_ship;
      }

      const postReceiptStatus =
        totalRemainingInTransit > 0
          ? 'IN_TRANSIT'
          : totalRemainingToShip > 0
          ? 'DRAFT'
          : 'RECEIVED';

      await this.db
        .update(schema.stockTransfer)
        .set({
          status: postReceiptStatus,
          posted_at: toMysqlTimestamp() as any,
          posted_by: userPayload?.userId || null,
          updated_by: userPayload?.userId || null,
        })
        .where(eq(schema.stockTransfer.transfer_id, id));

      await this.auditService.log({
        tenantId,
        companyId: transfer.company_id,
        userId: userPayload?.userId,
        action: 'RECEIVE',
        entityName: 'stock_transfer',
        entityId: id,
        newValues: { status: postReceiptStatus, remarks: dto.remarks },
      });

      return this.findOne(id);
    });

    await this.feedAlerts?.evaluateLevelsSafely([received.to_warehouse_id], tenantId);
    return received;
  }

  /**
   * Short-closes a Transfer Order when all currently in-transit stock has been received,
   * or writes off / returns in-transit discrepancies when goods were lost or damaged.
   */
  async close(
    id: string,
    tenantId: string,
    userPayload?: any,
    body?: { writeOffInTransit?: boolean; returnToSource?: boolean; reason?: string },
  ) {
    return withTenantTransaction(this.cls, async () => {
      const transfer = await this.loadForClose(id, tenantId);
      if (['CANCELLED', 'POSTED'].includes(transfer.status)) {
        throw new BadRequestException(`Transfer Order cannot be closed — it is already ${transfer.status}.`);
      }

      const existingLedger = await this.getLedgerHistory(transfer.transfer_no, transfer.company_id, tenantId);
      const enrichedLines = this.enrichLinesWithQuantities(transfer.lines, existingLedger);
      const inTransitTotal = enrichedLines.reduce((acc, l) => acc + l.qty_in_transit, 0);

      let closeNote = 'Order short-closed. Remaining un-shipped balance cancelled.';

      if (inTransitTotal > 0) {
        if (body?.writeOffInTransit) {
          const writeOffReason = body.reason?.trim() || 'Transit Discrepancy / Loss Write-Off';
          closeNote = `Order closed with In-Transit Write-Off (${inTransitTotal} units): ${writeOffReason}`;
          const today = new Date().toISOString().slice(0, 10);

          for (const line of enrichedLines) {
            if (line.qty_in_transit > 0) {
              const shipmentEntry = existingLedger.find(
                (s) => (s.document_line_id === line.line_id || (!s.document_line_id && s.item_id === line.item_id)) && s.transaction_type === 'TRANSFER_SHIPMENT',
              );
              const rate = shipmentEntry?.rate ? Math.abs(Number(shipmentEntry.rate)) : Number((line as any).unit_cost || 0);

              let allocatedSerials: string | undefined = undefined;
              const rawShipSerials = (shipmentEntry?.serial_no || line.serial_no || '')
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean);

              if (rawShipSerials.length > 0) {
                const alreadyReceivedSerials = new Set(
                  existingLedger
                    .filter(
                      (s) =>
                        (s.document_line_id === line.line_id || (!s.document_line_id && s.item_id === line.item_id)) &&
                        s.transaction_type === 'TRANSFER_RECEIPT',
                    )
                    .flatMap((s) => (s.serial_no || '').split(',').map((x: string) => x.trim()).filter(Boolean)),
                );
                const availableSerials = rawShipSerials.filter((s: string) => !alreadyReceivedSerials.has(s));
                const take = availableSerials.slice(0, Math.round(line.qty_in_transit));
                if (take.length > 0) {
                  allocatedSerials = take.join(', ');
                }
              }

              // 1. Write receipt into destination warehouse to clear in-transit balance
              const receipt = await this.ledgerService.writePositiveEntry({
                tenantId,
                companyId: transfer.company_id,
                itemId: line.item_id,
                documentType: 'STOCK_TRANSFER',
                documentNo: transfer.transfer_no,
                documentLineId: line.line_id,
                postingDate: today,
                transactionType: 'TRANSFER_RECEIPT',
                entryType: 'TRANSFER',
                quantity: line.qty_in_transit,
                uom: line.uom,
                rate,
                lotNo: shipmentEntry?.lot_no || line.lot_no || undefined,
                serialNo: allocatedSerials || shipmentEntry?.serial_no || line.serial_no || undefined,
                warehouseId: transfer.to_warehouse_id,
                userId: userPayload?.userId,
              });
              await this.glPostingService.postInventoryLedgerEntry(receipt, userPayload?.userId);

              // 2. Immediately write negative adjustment at destination to write off the loss
              const loss = await this.ledgerService.writeNegativeEntry({
                tenantId,
                companyId: transfer.company_id,
                itemId: line.item_id,
                documentType: 'STOCK_TRANSFER',
                documentNo: transfer.transfer_no,
                documentLineId: line.line_id,
                postingDate: today,
                transactionType: 'VARIANCE_NEGATIVE',
                entryType: 'NEGATIVE',
                quantity: line.qty_in_transit,
                uom: line.uom,
                lotNo: shipmentEntry?.lot_no || line.lot_no || undefined,
                serialNo: allocatedSerials || undefined,
                warehouseId: transfer.to_warehouse_id,
                userId: userPayload?.userId,
              });
              await this.glPostingService.postInventoryLedgerEntry(loss, userPayload?.userId);
            }
          }
        } else if (body?.returnToSource) {
          const returnReason = body.reason?.trim() || 'Returned In-Transit Stock to Source';
          closeNote = `Order closed with In-Transit Return to Source (${inTransitTotal} units): ${returnReason}`;
          const today = new Date().toISOString().slice(0, 10);

          for (const line of enrichedLines) {
            if (line.qty_in_transit > 0) {
              const shipmentEntry = existingLedger.find(
                (s) => (s.document_line_id === line.line_id || (!s.document_line_id && s.item_id === line.item_id)) && s.transaction_type === 'TRANSFER_SHIPMENT',
              );
              const rate = shipmentEntry?.rate ? Math.abs(Number(shipmentEntry.rate)) : Number((line as any).unit_cost || 0);

              let allocatedSerials: string | undefined = undefined;
              const rawShipSerials = (shipmentEntry?.serial_no || line.serial_no || '')
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean);

              if (rawShipSerials.length > 0) {
                const alreadyReceivedSerials = new Set(
                  existingLedger
                    .filter(
                      (s) =>
                        (s.document_line_id === line.line_id || (!s.document_line_id && s.item_id === line.item_id)) &&
                        s.transaction_type === 'TRANSFER_RECEIPT',
                    )
                    .flatMap((s) => (s.serial_no || '').split(',').map((x: string) => x.trim()).filter(Boolean)),
                );
                const availableSerials = rawShipSerials.filter((s: string) => !alreadyReceivedSerials.has(s));
                const take = availableSerials.slice(0, Math.round(line.qty_in_transit));
                if (take.length > 0) {
                  allocatedSerials = take.join(', ');
                }
              }

              // Return stock to source warehouse
              const returnReceipt = await this.ledgerService.writePositiveEntry({
                tenantId,
                companyId: transfer.company_id,
                itemId: line.item_id,
                documentType: 'STOCK_TRANSFER',
                documentNo: transfer.transfer_no,
                documentLineId: line.line_id,
                postingDate: today,
                transactionType: 'TRANSFER_RECEIPT',
                entryType: 'TRANSFER',
                quantity: line.qty_in_transit,
                uom: line.uom,
                rate,
                lotNo: shipmentEntry?.lot_no || line.lot_no || undefined,
                serialNo: allocatedSerials || shipmentEntry?.serial_no || line.serial_no || undefined,
                warehouseId: transfer.from_warehouse_id,
                userId: userPayload?.userId,
              });
              await this.glPostingService.postInventoryLedgerEntry(returnReceipt, userPayload?.userId);
            }
          }
        } else {
          throw new BadRequestException(
            `Cannot close Transfer Order while ${inTransitTotal} units are still In Transit. Receive, return to source, or write off in-transit discrepancy first.`,
          );
        }
      }

      const closeRemarks = [transfer.remarks, closeNote]
        .filter(Boolean)
        .join('\n');

      await this.db
        .update(schema.stockTransfer)
        .set({
          status: 'RECEIVED',
          remarks: closeRemarks,
          updated_by: userPayload?.userId || null,
          updated_at: toMysqlTimestamp() as any,
        })
        .where(eq(schema.stockTransfer.transfer_id, id));

      await this.auditService.log({
        tenantId,
        companyId: transfer.company_id,
        userId: userPayload?.userId,
        action: 'UPDATE',
        entityName: 'stock_transfer',
        entityId: id,
        newValues: { status: 'RECEIVED', remarks: closeRemarks },
      });

      return this.findOne(id);
    });
  }
}
