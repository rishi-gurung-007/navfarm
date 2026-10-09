import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { FeedForecastService } from '../../inventory/feed-forecast/feed-forecast.service';
import { isoProductionWeek } from '../../inventory/feed-forecast/feed-plan.rules';
import type { CreateFeedConsolidationDto, FeedConsolidationQueryDto } from './dto/feed-requisition.dto';
import { FeedLoadingService } from './feed-loading.service';

type User = { userId?: string; userType?: string };

@Injectable()
export class FeedConsolidationService {
  constructor(private readonly cls: ClsService, private readonly forecast: FeedForecastService, private readonly loading: FeedLoadingService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private async allowedFarmIds(tenantId: string, user: User, farmId?: string) {
    const farms = await this.forecast.listFarms(tenantId, user.userType);
    const allowed = new Set(farms.map((farm) => farm.farmId));
    if (farmId) {
      if (!allowed.has(farmId)) throw new NotFoundException('Farm not found.');
      return [farmId];
    }
    if (!farms.length) throw new NotFoundException('No farms are available in this scope.');
    return [...allowed];
  }

  private eligibleConditions(tenantId: string, farmIds: string[], query: FeedConsolidationQueryDto) {
    const R = schema.requisition;
    const conditions = [
      eq(R.tenant_id, tenantId),
      inArray(R.farm_id, farmIds),
      eq(R.doc_type, 'FEED'),
      isNull(R.deleted_at),
      isNull(R.feed_consolidation_id),
      sql`(${R.status} = 'APPROVED' OR ${R.approval_status} = 'APPROVED')`,
    ];
    if (query.requisitionIds?.length) conditions.push(inArray(R.requisition_id, query.requisitionIds));
    if (query.fromDate) conditions.push(sql`DATE(${R.created_at}) >= ${query.fromDate}`);
    if (query.toDate) conditions.push(sql`DATE(${R.created_at}) <= ${query.toDate}`);
    return conditions;
  }

  async eligible(query: FeedConsolidationQueryDto, tenantId: string, user: User) {
    const farmIds = await this.allowedFarmIds(tenantId, user, query.farmId);
    const R = schema.requisition;
    const rows = await this.db.select({
      requisition_id: R.requisition_id,
      req_no: R.req_no,
      requisition_date: R.requisition_date,
      production_date: R.production_date,
      created_at: R.created_at,
      farm_id: R.farm_id,
      farm_code: schema.locationMaster.location_code,
      farm_name: schema.locationMaster.location_name,
      line_id: schema.requisitionLine.line_id,
      item_id: schema.requisitionLine.item_id,
      item_code: schema.itemMaster.item_code,
      item_name: schema.itemMaster.item_name,
      diet_no: schema.itemMaster.diet_no,
      quantity: schema.requisitionLine.quantity,
      destination_silo_id: schema.requisitionLine.destination_location_id,
      proposed_delivery_date: schema.requisitionLine.proposed_delivery_date,
      feed_type: schema.requisitionLine.feed_type,
    }).from(R)
      .innerJoin(schema.locationMaster, eq(schema.locationMaster.location_id, R.farm_id))
      .innerJoin(schema.requisitionLine, eq(schema.requisitionLine.requisition_id, R.requisition_id))
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.requisitionLine.item_id))
      .where(and(...this.eligibleConditions(tenantId, farmIds, query)))
      .orderBy(desc(R.created_at), R.req_no);
    const siloIds = [...new Set(rows.map((row) => row.destination_silo_id).filter((id): id is string => Boolean(id)))];
    const silos = siloIds.length
      ? await this.db.select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code, location_name: schema.locationMaster.location_name })
        .from(schema.locationMaster)
        .where(inArray(schema.locationMaster.location_id, siloIds))
      : [];
    const siloById = new Map(silos.map((silo) => [silo.location_id, silo]));
    const bins = await this.db.select({
      location_code: schema.locationMaster.location_code,
      location_name: schema.locationMaster.location_name,
      bin_feed_type: schema.locationMaster.bin_feed_type,
      bin_capacity_kg: schema.locationMaster.bin_capacity_kg,
    }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.location_type, 'BIN'),
      isNull(schema.locationMaster.deleted_at),
    ));
    const binByFeedType = new Map(bins.map((bin) => [bin.bin_feed_type ?? 'BULK', bin]));
    return rows.map((row) => {
      const silo = row.destination_silo_id ? siloById.get(row.destination_silo_id) : undefined;
      const bin = row.feed_type ? binByFeedType.get(row.feed_type) : undefined;
      return {
        ...row,
        destination_silo_code: silo?.location_code ?? null,
        destination_silo_name: silo?.location_name ?? null,
        loading_bin: bin?.location_code ?? null,
        loading_bin_name: bin?.location_name ?? null,
        loading_bin_capacity_kg: bin?.bin_capacity_kg ?? null,
        available_mill_output_kg: null,
      };
    });
  }

  async create(dto: CreateFeedConsolidationDto, tenantId: string, user: User) {
    if ((dto.fromDate && !dto.toDate) || (!dto.fromDate && dto.toDate) || (dto.fromDate && dto.toDate && dto.fromDate > dto.toDate)) {
      throw new ConflictException('A valid date range requires both From date and To date.');
    }
    const eligible = await this.eligible({
      farmId: dto.farmId,
      requisitionIds: dto.requisitionIds,
      fromDate: dto.fromDate,
      toDate: dto.toDate,
    }, tenantId, user);
    const requested = new Map(eligible.map((line) => [line.line_id, Number(line.quantity)]));
    const selected = eligible.filter((line) => dto.lines.some((input) => input.requisitionLineId === line.line_id));
    if (!selected.length) throw new ConflictException('Select at least one approved requisition line without a consolidation sheet.');
    const edits = new Map(dto.lines.map((line) => [line.requisitionLineId, line]));
    for (const line of selected) {
      const edit = edits.get(line.line_id)!;
      const approved = edit.millApprovedQtyKg ?? requested.get(line.line_id)!;
      if (approved < 0) throw new ConflictException(`Mill approved quantity for ${line.req_no} cannot be negative.`);
      if (approved !== requested.get(line.line_id) && !edit.adjustmentReason?.trim()) {
        throw new ConflictException(`Adjustment reason is required for ${line.req_no}.`);
      }
    }
    const productionDate = selected.map((line) => line.production_date || line.proposed_delivery_date).find(Boolean) || new Date().toISOString().slice(0, 10);
    const productionWeek = isoProductionWeek(productionDate);
    return withTenantTransaction(this.cls, async () => {
      const [countRow] = await this.db.select({ count: sql<number>`COUNT(*)` }).from(schema.feedConsolidation).where(and(
        eq(schema.feedConsolidation.tenant_id, tenantId),
        eq(schema.feedConsolidation.production_week, productionWeek),
      )).for('update');
      const sequence = Number(countRow?.count ?? 0) + 1;
      const consolidationId = randomUUID();
      const consolidationNo = `CONS-${productionWeek}-${String(sequence).padStart(3, '0')}`;
      const companyIds = new Set(selected.map((line) => line.farm_id));
      const farms = await this.db.select({ farm_id: schema.locationMaster.location_id, company_id: schema.locationMaster.company_id })
        .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, [...companyIds]));
      const companyId = farms[0]?.company_id;
      if (!companyId || farms.some((farm) => farm.company_id !== companyId)) throw new ConflictException('Selected requisitions must belong to one company.');
      await this.db.insert(schema.feedConsolidation).values({
        consolidation_id: consolidationId, consolidation_no: consolidationNo, tenant_id: tenantId,
        company_id: companyId, production_week: productionWeek,
        consolidation_date: new Date().toISOString().slice(0, 10), created_by: user.userId ?? null, status: 'DRAFT',
      });
      await this.db.insert(schema.feedConsolidationLine).values(selected.map((line) => {
        const edit = edits.get(line.line_id)!;
        const approved = edit.millApprovedQtyKg ?? requested.get(line.line_id)!;
        return {
          consolidation_line_id: randomUUID(), consolidation_id: consolidationId,
          requisition_id: line.requisition_id, requisition_line_id: line.line_id,
          farm_id: line.farm_id!, item_id: line.item_id!, requested_qty_kg: String(requested.get(line.line_id)),
          destination_silo_id: line.destination_silo_id, requested_delivery_date: line.proposed_delivery_date,
          production_date: line.production_date,
          mill_approved_qty_kg: String(approved), adjustment_reason: edit.adjustmentReason?.trim() || null, bc_to_no: null,
        };
      }));
      await this.db.update(schema.requisition).set({ feed_consolidation_id: consolidationId, status: 'IN_CONSOLIDATION', updated_by: user.userId ?? null })
        .where(inArray(schema.requisition.requisition_id, [...new Set(selected.map((line) => line.requisition_id))]));
      await this.loading.createForConsolidation(consolidationId, tenantId, user);
      return { consolidationId, consolidationNo, productionWeek, status: 'DRAFT', lineCount: selected.length };
    });
  }

  async list(query: FeedConsolidationQueryDto, tenantId: string, user: User) {
    const farmIds = await this.allowedFarmIds(tenantId, user, query.farmId);
    const companyIds = (await this.db.select({ company_id: schema.locationMaster.company_id })
      .from(schema.locationMaster)
      .where(inArray(schema.locationMaster.location_id, farmIds)))
      .map((r) => r.company_id!).filter(Boolean);
    const conditions = [
      eq(schema.feedConsolidation.tenant_id, tenantId),
      inArray(schema.feedConsolidation.company_id, companyIds),
    ];
    if (query.status) conditions.push(eq(schema.feedConsolidation.status, query.status));
    if (query.fromDate) conditions.push(sql`${schema.feedConsolidation.consolidation_date} >= ${query.fromDate}`);
    if (query.toDate) conditions.push(sql`${schema.feedConsolidation.consolidation_date} <= ${query.toDate}`);
    const rows = await this.db.select().from(schema.feedConsolidation).where(and(...conditions)).orderBy(desc(schema.feedConsolidation.consolidation_date), desc(schema.feedConsolidation.created_at));
    const ids = rows.map((row) => row.consolidation_id);
    const lines = ids.length ? await this.db.select({ consolidation_id: schema.feedConsolidationLine.consolidation_id, requested_qty_kg: schema.feedConsolidationLine.requested_qty_kg, mill_approved_qty_kg: schema.feedConsolidationLine.mill_approved_qty_kg }).from(schema.feedConsolidationLine).where(inArray(schema.feedConsolidationLine.consolidation_id, ids)) : [];
    return rows.map((row) => ({ ...row, line_count: lines.filter((line) => line.consolidation_id === row.consolidation_id).length, requested_qty_kg: lines.filter((line) => line.consolidation_id === row.consolidation_id).reduce((sum, line) => sum + Number(line.requested_qty_kg), 0), mill_approved_qty_kg: lines.filter((line) => line.consolidation_id === row.consolidation_id).reduce((sum, line) => sum + Number(line.mill_approved_qty_kg), 0) }));
  }

  async findOne(consolidationId: string, tenantId: string, user: User) {
    const [header] = await this.db.select().from(schema.feedConsolidation).where(and(eq(schema.feedConsolidation.consolidation_id, consolidationId), eq(schema.feedConsolidation.tenant_id, tenantId)));
    if (!header) throw new NotFoundException('Consolidation sheet not found.');
    const lines = await this.db.select().from(schema.feedConsolidationLine).where(eq(schema.feedConsolidationLine.consolidation_id, consolidationId));
    const locationIds = [...new Set(lines.flatMap((line) => [line.farm_id, line.destination_silo_id].filter((id): id is string => !!id)))];
    const locations = locationIds.length ? await this.db.select({ id: schema.locationMaster.location_id, code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
      .from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, locationIds)) : [];
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const items = lines.length ? await this.db.select({ id: schema.itemMaster.item_id, code: schema.itemMaster.item_code, name: schema.itemMaster.item_name })
      .from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, [...new Set(lines.map((line) => line.item_id))])) : [];
    const itemById = new Map(items.map((item) => [item.id, item]));
    const requisitions = lines.length ? await this.db.select({ id: schema.requisition.requisition_id, no: schema.requisition.req_no })
      .from(schema.requisition).where(inArray(schema.requisition.requisition_id, [...new Set(lines.map((line) => line.requisition_id))])) : [];
    const reqById = new Map(requisitions.map((req) => [req.id, req]));
    return { ...header, lines: lines.map((line) => ({
      ...line,
      requisition_no: reqById.get(line.requisition_id)?.no ?? line.requisition_id,
      farm_code: locationById.get(line.farm_id)?.code ?? line.farm_id,
      farm_name: locationById.get(line.farm_id)?.name ?? null,
      destination_silo_code: line.destination_silo_id ? locationById.get(line.destination_silo_id)?.code ?? line.destination_silo_id : null,
      destination_silo_name: line.destination_silo_id ? locationById.get(line.destination_silo_id)?.name ?? null : null,
      item_code: itemById.get(line.item_id)?.code ?? line.item_id,
      item_name: itemById.get(line.item_id)?.name ?? null,
    })) };
  }

  async finalize(consolidationId: string, tenantId: string, user: User) {
    const [row] = await this.db.select().from(schema.feedConsolidation).where(and(eq(schema.feedConsolidation.consolidation_id, consolidationId), eq(schema.feedConsolidation.tenant_id, tenantId))).limit(1).for('update');
    if (!row) throw new NotFoundException('Consolidation sheet not found.');
    if (!['DRAFT', 'REVIEWED'].includes(row.status)) throw new ConflictException(`Consolidation ${row.consolidation_no} cannot be finalized from ${row.status}.`);
    await this.db.update(schema.feedConsolidation).set({ status: 'CONSOLIDATED' }).where(eq(schema.feedConsolidation.consolidation_id, consolidationId));
    return this.findOne(consolidationId, tenantId, user);
  }
}
