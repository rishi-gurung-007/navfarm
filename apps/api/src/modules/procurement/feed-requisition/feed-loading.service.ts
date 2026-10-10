import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { resolveLoadingBinId } from './feed-requisition-transfer.rules';

type User = { userId?: string; userType?: string };

@Injectable()
export class FeedLoadingService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  async createForConsolidation(consolidationId: string, tenantId: string, user: User) {
    const existing = await this.db.select({ id: schema.feedLoadingSheet.loading_sheet_id })
      .from(schema.feedLoadingSheet)
      .where(and(eq(schema.feedLoadingSheet.tenant_id, tenantId), eq(schema.feedLoadingSheet.consolidation_id, consolidationId)))
      .limit(1);
    if (existing.length) return { created: 0, existing: true };
    const [consolidation] = await this.db.select({ no: schema.feedConsolidation.consolidation_no, companyId: schema.feedConsolidation.company_id })
      .from(schema.feedConsolidation).where(and(eq(schema.feedConsolidation.consolidation_id, consolidationId), eq(schema.feedConsolidation.tenant_id, tenantId))).limit(1);
    if (!consolidation) throw new NotFoundException('Feed consolidation not found.');
    const lines = await this.db.select().from(schema.feedConsolidationLine)
      .where(eq(schema.feedConsolidationLine.consolidation_id, consolidationId));
    if (!lines.length) return { created: 0, existing: false };
    const itemIds = [...new Set(lines.map((line) => line.item_id))];
    const productionDates = [...new Set(lines.map((line) => line.production_date).filter((date): date is string => !!date))];
    const assignments = productionDates.length ? await this.db.select({
      assignmentId: schema.binDietAssignment.assignment_id,
      itemId: schema.binDietAssignment.feed_item_id,
      productionDate: schema.binDietAssignment.production_date,
      binLocationId: schema.binDietAssignment.bin_location_id,
      productionSlotId: schema.binDietAssignment.production_slot_id,
    }).from(schema.binDietAssignment).where(and(
      eq(schema.binDietAssignment.tenant_id, tenantId),
      eq(schema.binDietAssignment.company_id, consolidation.companyId),
      inArray(schema.binDietAssignment.production_date, productionDates),
      inArray(schema.binDietAssignment.feed_item_id, itemIds),
      eq(schema.binDietAssignment.is_active, true),
      eq(schema.binDietAssignment.status, 'ACTIVE'),
      isNull(schema.binDietAssignment.deleted_at),
    )) : [];
    const [sequence] = await this.db.select({ max: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${schema.feedLoadingSheet.loading_sheet_no}, 6) AS UNSIGNED)), 0)` })
      .from(schema.feedLoadingSheet).where(eq(schema.feedLoadingSheet.tenant_id, tenantId)).for('update');
    let next = Number(sequence?.max ?? 0) + 1;
    await this.db.insert(schema.feedLoadingSheet).values(lines.map((line) => {
      const binId = resolveLoadingBinId({ itemId: line.item_id, productionDate: line.production_date }, assignments);
      return {
        loading_sheet_id: randomUUID(), loading_sheet_no: `LOAD-${String(next++).padStart(6, '0')}`,
        tenant_id: tenantId, company_id: consolidation.companyId, consolidation_id: consolidationId,
        consolidation_line_id: line.consolidation_line_id, requisition_id: line.requisition_id,
        requisition_line_id: line.requisition_line_id, farm_id: line.farm_id,
        destination_silo_id: line.destination_silo_id, item_id: line.item_id,
        mill_loading_bin_id: binId, requested_qty_kg: line.requested_qty_kg,
        mill_approved_qty_kg: line.mill_approved_qty_kg, scheduled_qty_kg: line.mill_approved_qty_kg,
        requested_delivery_date: line.requested_delivery_date, production_date: line.production_date,
        status: 'DRAFT',
      };
    }));
    return { created: lines.length, existing: false };
  }

  async list(tenantId: string, consolidationId?: string) {
    const conditions = [eq(schema.feedLoadingSheet.tenant_id, tenantId)];
    if (consolidationId) conditions.push(eq(schema.feedLoadingSheet.consolidation_id, consolidationId));
    const rows = await this.db.select().from(schema.feedLoadingSheet).where(and(...conditions)).orderBy(desc(schema.feedLoadingSheet.created_at));
    return this.decorate(rows);
  }

  async update(id: string, dto: { compartmentNo?: string; kgLoaded?: number; loadedBy?: string }, tenantId: string, user: User) {
    const [sheet] = await this.db.select().from(schema.feedLoadingSheet).where(and(eq(schema.feedLoadingSheet.loading_sheet_id, id), eq(schema.feedLoadingSheet.tenant_id, tenantId))).limit(1);
    if (!sheet) throw new NotFoundException('Loading instruction sheet not found.');
    if (sheet.status !== 'DRAFT' && sheet.status !== 'LOADED') throw new ConflictException('Only draft loading sheets may be edited.');
    const kg = dto.kgLoaded ?? (sheet.kg_loaded == null ? null : Number(sheet.kg_loaded));
    if (dto.kgLoaded !== undefined && (!Number.isFinite(dto.kgLoaded) || dto.kgLoaded < 0)) throw new BadRequestException('KG loaded must be a non-negative number.');
    if (dto.kgLoaded !== undefined && dto.kgLoaded > Number(sheet.scheduled_qty_kg)) throw new ConflictException('KG loaded cannot exceed the mill-approved allocation.');
    if (dto.compartmentNo?.trim()) {
      const conflict = await this.db.select({
        id: schema.feedLoadingSheet.loading_sheet_id,
        loadingSheetNo: schema.feedLoadingSheet.loading_sheet_no,
        itemId: schema.feedLoadingSheet.item_id,
        itemCode: schema.itemMaster.item_code,
        itemName: schema.itemMaster.item_name,
        consolidationNo: schema.feedConsolidation.consolidation_no,
        productionDate: schema.feedLoadingSheet.production_date,
      })
        .from(schema.feedLoadingSheet)
        .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.feedLoadingSheet.item_id))
        .innerJoin(schema.feedConsolidation, eq(schema.feedConsolidation.consolidation_id, schema.feedLoadingSheet.consolidation_id))
        .where(and(
          eq(schema.feedLoadingSheet.tenant_id, tenantId),
          eq(schema.feedLoadingSheet.compartment_no, dto.compartmentNo.trim()),
          eq(schema.feedLoadingSheet.production_date, sheet.production_date!),
          inArray(schema.feedLoadingSheet.status, ['LOADED', 'DISPATCHED']),
          sql`${schema.feedLoadingSheet.loading_sheet_id} <> ${id}`,
        )).limit(1);
      if (conflict.length && conflict[0].itemId !== sheet.item_id) {
        const other = conflict[0];
        throw new ConflictException(
          `Compartment ${dto.compartmentNo.trim()} on production date ${other.productionDate ?? sheet.production_date ?? 'not set'} is already assigned to ${other.itemCode} (${other.itemName}) in loading sheet ${other.loadingSheetNo} / consolidation ${other.consolidationNo}. Choose a different compartment or production date.`,
        );
      }
    }
    if (kg != null && sheet.mill_loading_bin_id) {
      const [bin] = await this.db.select({ capacity: schema.locationMaster.bin_capacity_kg }).from(schema.locationMaster).where(eq(schema.locationMaster.location_id, sheet.mill_loading_bin_id)).limit(1);
      if (bin?.capacity != null && kg > Number(bin.capacity)) throw new ConflictException('KG loaded exceeds the configured loading BIN capacity.');
    }
    const status = dto.compartmentNo?.trim() && kg != null ? 'LOADED' : 'DRAFT';
    const loadedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await this.db.update(schema.feedLoadingSheet).set({ compartment_no: dto.compartmentNo?.trim() || sheet.compartment_no, kg_loaded: kg == null ? null : String(kg), loaded_by: dto.loadedBy || user.userId || sheet.loaded_by, loaded_at: status === 'LOADED' ? loadedAt : sheet.loaded_at, status }).where(eq(schema.feedLoadingSheet.loading_sheet_id, id));
    return this.findOne(id, tenantId);
  }

  async dispatch(id: string, tenantId: string) {
    const [sheet] = await this.db.select().from(schema.feedLoadingSheet).where(and(eq(schema.feedLoadingSheet.loading_sheet_id, id), eq(schema.feedLoadingSheet.tenant_id, tenantId))).limit(1);
    if (!sheet) throw new NotFoundException('Loading instruction sheet not found.');
    if (sheet.status === 'DISPATCHED') return sheet;
    if (sheet.status !== 'LOADED' || !sheet.compartment_no || sheet.kg_loaded == null) throw new ConflictException('Compartment number and KG loaded are required before dispatch.');
    if (!sheet.shipment_id) {
      throw new ConflictException(
        `Dispatch is blocked for ${sheet.loading_sheet_no}: post the shared Stock Transfer shipment for the released requisition first, then return here to dispatch this loading sheet.`,
      );
    }
    await this.db.update(schema.feedLoadingSheet).set({ status: 'DISPATCHED' }).where(eq(schema.feedLoadingSheet.loading_sheet_id, id));
    return this.findOne(id, tenantId);
  }

  async linkShipment(requisitionId: string, shipmentId: string, shipmentNo: string, tenantId: string) {
    await this.db.update(schema.feedLoadingSheet).set({ shipment_id: shipmentId, shipment_no: shipmentNo })
      .where(and(eq(schema.feedLoadingSheet.tenant_id, tenantId), eq(schema.feedLoadingSheet.requisition_id, requisitionId), inArray(schema.feedLoadingSheet.status, ['LOADED', 'DRAFT'])));
  }

  async markReceivedForRequisition(requisitionId: string, tenantId: string) {
    await this.db.update(schema.feedLoadingSheet).set({ status: 'RECEIVED' })
      .where(and(
        eq(schema.feedLoadingSheet.tenant_id, tenantId),
        eq(schema.feedLoadingSheet.requisition_id, requisitionId),
        eq(schema.feedLoadingSheet.status, 'DISPATCHED'),
      ));
  }

  async findOne(id: string, tenantId: string) {
    const [sheet] = await this.db.select().from(schema.feedLoadingSheet).where(and(eq(schema.feedLoadingSheet.loading_sheet_id, id), eq(schema.feedLoadingSheet.tenant_id, tenantId))).limit(1);
    if (!sheet) throw new NotFoundException('Loading instruction sheet not found.');
    return (await this.decorate([sheet]))[0];
  }

  private async decorate(rows: Array<typeof schema.feedLoadingSheet.$inferSelect>) {
    if (!rows.length) return rows;
    const locationIds = [...new Set(rows.flatMap((row) => [row.farm_id, row.destination_silo_id, row.mill_loading_bin_id].filter((id): id is string => !!id)))];
    const locations = locationIds.length ? await this.db.select({ id: schema.locationMaster.location_id, code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
      .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, locationIds)) : [];
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const itemIds = [...new Set(rows.map((row) => row.item_id))];
    const items = await this.db.select({ id: schema.itemMaster.item_id, code: schema.itemMaster.item_code, name: schema.itemMaster.item_name })
      .from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, itemIds));
    const itemById = new Map(items.map((item) => [item.id, item]));
    const reqIds = [...new Set(rows.map((row) => row.requisition_id))];
    const requisitions = await this.db.select({ id: schema.requisition.requisition_id, no: schema.requisition.req_no })
      .from(schema.requisition).where(inArray(schema.requisition.requisition_id, reqIds));
    const reqById = new Map(requisitions.map((req) => [req.id, req]));
    const lineIds = [...new Set(rows.map((row) => row.consolidation_line_id))];
    const consolidationLines = lineIds.length ? await this.db.select({
      id: schema.feedConsolidationLine.consolidation_line_id,
      adjustmentReason: schema.feedConsolidationLine.adjustment_reason,
    }).from(schema.feedConsolidationLine).where(inArray(schema.feedConsolidationLine.consolidation_line_id, lineIds)) : [];
    const consolidationLineById = new Map(consolidationLines.map((line) => [line.id, line]));
    return rows.map((row) => ({
      ...row,
      adjustment_reason: consolidationLineById.get(row.consolidation_line_id)?.adjustmentReason ?? null,
      requisition_no: reqById.get(row.requisition_id)?.no ?? row.requisition_id,
      farm_code: locationById.get(row.farm_id)?.code ?? row.farm_id,
      farm_name: locationById.get(row.farm_id)?.name ?? null,
      destination_silo_code: row.destination_silo_id ? locationById.get(row.destination_silo_id)?.code ?? row.destination_silo_id : null,
      destination_silo_name: row.destination_silo_id ? locationById.get(row.destination_silo_id)?.name ?? null : null,
      item_code: itemById.get(row.item_id)?.code ?? row.item_id,
      item_name: itemById.get(row.item_id)?.name ?? null,
      mill_loading_bin_code: row.mill_loading_bin_id ? locationById.get(row.mill_loading_bin_id)?.code ?? row.mill_loading_bin_id : null,
      mill_loading_bin_name: row.mill_loading_bin_id ? locationById.get(row.mill_loading_bin_id)?.name ?? null : null,
    }));
  }
}
