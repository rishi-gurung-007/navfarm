import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { FeedAlertService } from '../../inventory/feed-alert/feed-alert.service';
import { activeBinAssignments } from './feed-bin-assignments.query';
import { resolveLoadingBinId } from './feed-requisition-transfer.rules';
import type { DispatchFeedLoadingSheetDto, UpdateFeedLoadingSheetDto } from './dto/feed-requisition.dto';

/** Row 60: LOAD-<Req No>-<Line No>. */
export const loadingSheetNo = (reqNo: string, lineSeq: number) => `LOAD-${reqNo}-${lineSeq}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type User = { userId?: string; userType?: string };

@Injectable()
export class FeedLoadingService {
  constructor(private readonly cls: ClsService, @Optional() private readonly feedAlerts?: FeedAlertService) {}

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
    const assignments = await activeBinAssignments(this.db, consolidation.companyId, lines.map((line) => line.production_date), itemIds, tenantId);
    // Row 60: Loading Sheet No. is LOAD-<Req No>-<Line No>, the requisition
    // line's own number. One sheet per consolidation line, and a requisition
    // line is consolidated once, so the number is unique. Sheets numbered
    // before this rule (LOAD-000001) keep their numbers.
    const requisitionLines = await this.db.select({
      line_id: schema.requisitionLine.line_id, line_seq: schema.requisitionLine.line_seq, req_no: schema.requisition.req_no,
    }).from(schema.requisitionLine)
      .innerJoin(schema.requisition, eq(schema.requisition.requisition_id, schema.requisitionLine.requisition_id))
      .where(inArray(schema.requisitionLine.line_id, lines.map((line) => line.requisition_line_id)));
    const requisitionLineById = new Map(requisitionLines.map((line) => [line.line_id, line]));
    await this.db.insert(schema.feedLoadingSheet).values(lines.map((line) => {
      const binId = resolveLoadingBinId({ itemId: line.item_id, productionDate: line.production_date }, assignments);
      const source = requisitionLineById.get(line.requisition_line_id);
      if (!source) throw new NotFoundException('Requisition line for the consolidation line was not found.');
      return {
        loading_sheet_id: randomUUID(), loading_sheet_no: loadingSheetNo(source.req_no, source.line_seq),
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

  async update(id: string, dto: UpdateFeedLoadingSheetDto, tenantId: string, user: User) {
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
    await this.db.update(schema.feedLoadingSheet).set({ compartment_no: dto.compartmentNo?.trim() || sheet.compartment_no, kg_loaded: kg == null ? null : String(kg), loaded_by: dto.loadedBy?.trim() || sheet.loaded_by || user.userId || null, loaded_at: status === 'LOADED' ? loadedAt : sheet.loaded_at, status }).where(eq(schema.feedLoadingSheet.loading_sheet_id, id));
    return this.findOne(id, tenantId);
  }

  async dispatch(id: string, tenantId: string, dto: DispatchFeedLoadingSheetDto = {}) {
    const [sheet] = await this.db.select().from(schema.feedLoadingSheet).where(and(eq(schema.feedLoadingSheet.loading_sheet_id, id), eq(schema.feedLoadingSheet.tenant_id, tenantId))).limit(1);
    if (!sheet) throw new NotFoundException('Loading instruction sheet not found.');
    if (sheet.status === 'DISPATCHED') return this.findOne(id, tenantId);
    if (sheet.status !== 'LOADED' || !sheet.compartment_no || sheet.kg_loaded == null) throw new ConflictException('Compartment number and KG loaded are required before dispatch.');
    if (!sheet.shipment_id) {
      throw new ConflictException(
        `Dispatch is blocked for ${sheet.loading_sheet_no}: post the shared Stock Transfer shipment for the released requisition first, then return here to dispatch this loading sheet.`,
      );
    }
    // Row 76 (11 Oct): the optional typed estimated arrival, stored as 'YYYY-MM-DD HH:mm:00' and shown as dd/mm/yy HH:mm.
    const eta = dto.estimatedArrivalAt?.trim() ? dto.estimatedArrivalAt.trim().replace('T', ' ').slice(0, 16) : null;
    await this.db.update(schema.feedLoadingSheet).set({ status: 'DISPATCHED', ...(eta ? { estimated_arrival_at: `${eta}:00` } : {}) }).where(eq(schema.feedLoadingSheet.loading_sheet_id, id));
    const dispatched = await this.findOne(id, tenantId);
    // W4G1 (Req. rows 74–76): tell the destination farm what left the mill — diet, KG and compartment.
    const kg = Number(dispatched.kg_loaded).toLocaleString('en-US', { maximumFractionDigits: 2 });
    await this.feedAlerts?.raiseEventSafely({ farmId: sheet.farm_id, companyId: sheet.company_id, tenantId }, {
      eventType: 'MILL_DISPATCH', subjectType: 'LOADING_SHEET', subjectId: id, itemId: sheet.item_id, observedValue: Number(dispatched.kg_loaded),
      title: `Feed dispatched: ${sheet.loading_sheet_no}`,
      message: `Loading sheet ${sheet.loading_sheet_no} has left the mill for ${dispatched.farm_code ?? 'your farm'}: diet ${dispatched.diet_no ?? dispatched.item_code ?? ''}${dispatched.item_name ? ` (${dispatched.item_name})` : ''}, ${kg} KG, compartment ${sheet.compartment_no}.${eta ? ` ETA ${eta.slice(8, 10)}/${eta.slice(5, 7)}/${eta.slice(2, 4)} ${eta.slice(11, 16)}.` : ''}`.replace(/\s+/g, ' '),
    });
    return dispatched;
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
    if (!rows.length) return [];
    const locationIds = [...new Set(rows.flatMap((row) => [row.farm_id, row.destination_silo_id, row.mill_loading_bin_id].filter((id): id is string => !!id)))];
    const locations = locationIds.length ? await this.db.select({ id: schema.locationMaster.location_id, code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
      .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, locationIds)) : [];
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const itemIds = [...new Set(rows.map((row) => row.item_id))];
    const items = await this.db.select({ id: schema.itemMaster.item_id, code: schema.itemMaster.item_code, name: schema.itemMaster.item_name, diet_no: schema.itemMaster.diet_no })
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
    // Row 72: Loaded By is the mill staff name. The column holds either the
    // name the mill typed or, for sheets saved before that, the user's id.
    const loaderIds = [...new Set(rows.map((row) => row.loaded_by).filter((id): id is string => !!id && UUID.test(id)))];
    const users = loaderIds.length ? await this.db.select({ id: schema.userMaster.user_id, name: schema.userMaster.full_name })
      .from(schema.userMaster).where(inArray(schema.userMaster.user_id, loaderIds)) : [];
    const userById = new Map(users.map((user) => [user.id, user.name]));
    const transfers = await transfersByRequisitionLine(this.db, rows.map((row) => row.requisition_line_id));
    // Req r75/r76: the MILL_DISPATCH alert raised at dispatch is the dispatch notification; read it by its subject.
    const sheetIds = rows.map((row) => row.loading_sheet_id);
    const alerts = await this.db.select({ subject_id: schema.feedAlert.subject_id, message: schema.feedAlert.message, raised_at: schema.feedAlert.raised_at })
      .from(schema.feedAlert).where(and(
        eq(schema.feedAlert.event_type, 'MILL_DISPATCH'), eq(schema.feedAlert.subject_type, 'LOADING_SHEET'),
        inArray(schema.feedAlert.tenant_id, [...new Set(rows.map((row) => row.tenant_id))]),
        inArray(schema.feedAlert.company_id, [...new Set(rows.map((row) => row.company_id))]),
        inArray(schema.feedAlert.subject_id, sheetIds),
      )).orderBy(desc(schema.feedAlert.raised_at));
    const alertBySheet = new Map<string, { message: string; raised_at: string }>();
    for (const alert of alerts) if (!alertBySheet.has(alert.subject_id)) alertBySheet.set(alert.subject_id, alert);
    return rows.map(({ loaded_by, ...row }) => {
      const location = (id: string | null) => (id ? locationById.get(id) : undefined);
      const item = itemById.get(row.item_id);
      const transfer = transfers.get(row.requisition_line_id);
      return {
        ...row,
        adjustment_reason: consolidationLineById.get(row.consolidation_line_id)?.adjustmentReason ?? null,
        requisition_no: reqById.get(row.requisition_id)?.no ?? null,
        farm_code: location(row.farm_id)?.code ?? null,
        farm_name: location(row.farm_id)?.name ?? null,
        destination_silo_code: location(row.destination_silo_id)?.code ?? null,
        destination_silo_name: location(row.destination_silo_id)?.name ?? null,
        item_code: item?.code ?? null,
        item_name: item?.name ?? null,
        diet_no: item?.diet_no ?? null,
        mill_loading_bin_code: location(row.mill_loading_bin_id)?.code ?? null,
        mill_loading_bin_name: location(row.mill_loading_bin_id)?.name ?? null,
        loaded_by_name: !loaded_by ? null : UUID.test(loaded_by) ? userById.get(loaded_by) ?? null : loaded_by,
        transfer_id: transfer?.transfer_id ?? null,
        transfer_no: transfer?.transfer_no ?? null,
        dispatch_notification_status: alertBySheet.has(row.loading_sheet_id) ? 'SENT' : 'NOT_SENT',
        dispatch_notification_message: alertBySheet.get(row.loading_sheet_id)?.message ?? null,
        dispatch_notification_at: alertBySheet.get(row.loading_sheet_id)?.raised_at ?? null,
      };
    });
  }
}

/** The shared Stock Transfer that carries each requisition line (one per line, created at Release). */
export async function transfersByRequisitionLine(db: MySql2Database<typeof schema>, requisitionLineIds: string[]) {
  const ids = [...new Set(requisitionLineIds)];
  const rows = ids.length ? await db.select({
    requisition_line_id: schema.stockTransferLine.requisition_line_id,
    transfer_id: schema.stockTransfer.transfer_id,
    transfer_no: schema.stockTransfer.transfer_no,
  }).from(schema.stockTransferLine)
    .innerJoin(schema.stockTransfer, eq(schema.stockTransfer.transfer_id, schema.stockTransferLine.transfer_id))
    .where(and(inArray(schema.stockTransferLine.requisition_line_id, ids), isNull(schema.stockTransfer.deleted_at))) : [];
  const byLine = new Map<string, { transfer_id: string; transfer_no: string }>();
  for (const row of rows) if (row.requisition_line_id && !byLine.has(row.requisition_line_id)) byLine.set(row.requisition_line_id, { transfer_id: row.transfer_id, transfer_no: row.transfer_no });
  return byLine;
}
