import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { farmOfLocation, farmScope } from '../../../common/farm-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { RequisitionService } from '../../procurement/requisition/requisition.service';
import { AllocateSemenLotDto, QuerySemenRequestDto } from './dto/semen-request.dto';
import { allocationPlan, planRequestProblems, type RequestLine } from './semen-request.rules';

const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/**
 * Semen requests (Phase 4, 24 Nov 2026). A farm asks the AI Station for doses with an ordinary Store requisition that names the breeding
 * line (`requisition.breed_id`). The AI Station sees the open ones here, plans a collection from them (collection-plan.service.ts links
 * them), and once the lot is clear of QC allocates it: the lot is put on each request's transfer through the requisition's own Item
 * Tracking. Shipping and receiving (and the farm's receipt QC) stay on the requisition.
 */
@Injectable()
export class SemenRequestService {
  constructor(
    private readonly cls: ClsService,
    private readonly requisitions: RequisitionService,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /**
   * What a farm needs to ask another farm for semen: every farm and store of the company and the breeding lines that have live
   * boars anywhere in it. The farm a user works in is not the farm that sends, so this list is not cut to the active farm;
   * it names places and lines only, no animals or stock.
   */
  async sources(tenantId: string) {
    const companyId = farmScope(this.cls).companyId;
    const L = schema.locationMaster;
    const places = await this.db
      .select({
        location_id: L.location_id,
        location_code: L.location_code,
        location_name: L.location_name,
        location_type: L.location_type,
        parent_location_id: L.parent_location_id,
        farm_id: L.farm_id,
      })
      .from(L)
      .where(and(
        eq(L.tenant_id, tenantId),
        inArray(L.location_type, ['FARM', 'STORE']),
        sql`${L.is_active} = true`,
        isNull(L.deleted_at),
        ...(companyId ? [eq(L.company_id, companyId)] : []),
      ))
      .orderBy(asc(L.location_code));
    const A = schema.animalRegister;
    const lines = await this.db
      .select({
        breed_id: schema.breedMaster.breed_id,
        breed_code: schema.breedMaster.breed_code,
        breed_name: schema.breedMaster.breed_name,
        boars: sql<number>`count(*)`.mapWith(Number),
      })
      .from(A)
      .innerJoin(schema.breedMaster, eq(schema.breedMaster.breed_id, A.breed_id))
      .where(and(
        eq(A.tenant_id, tenantId),
        eq(A.animal_type, 'BOAR'),
        eq(A.gender, 'M'),
        eq(A.is_active, true),
        ...(companyId ? [eq(A.company_id, companyId)] : []),
      ))
      .groupBy(schema.breedMaster.breed_id, schema.breedMaster.breed_code, schema.breedMaster.breed_name)
      .orderBy(schema.breedMaster.breed_code);
    return {
      farms: places.filter((p) => p.location_type === 'FARM'),
      stores: places.filter((p) => p.location_type === 'STORE'),
      lines,
    };
  }

  /** The semen request lines, with their requisition, line, plan and lot. */
  async lines(tenantId: string, filter: { lineIds?: string[]; breedId?: string; planId?: string } = {}) {
    const R = schema.requisition;
    const RL = schema.requisitionLine;
    const P = schema.semenPlanRequisition;
    const conditions = [eq(R.tenant_id, tenantId), isNotNull(R.breed_id), isNull(R.deleted_at)];
    if (filter.lineIds) conditions.push(inArray(RL.line_id, filter.lineIds.length ? filter.lineIds : ['-']));
    if (filter.breedId) conditions.push(eq(R.breed_id, filter.breedId));
    if (filter.planId) conditions.push(eq(P.plan_id, filter.planId));
    const rows = await this.db
      .select({
        line_id: RL.line_id,
        requisition_id: R.requisition_id,
        req_no: R.req_no,
        company_id: R.company_id,
        farm_id: R.farm_id,
        breed_id: R.breed_id,
        breed_code: schema.breedMaster.breed_code,
        approval_status: R.approval_status,
        document_status: R.document_status,
        fulfilment_status: R.fulfilment_status,
        required_date: R.required_date,
        item_id: RL.item_id,
        doses: RL.quantity,
        qty_shipped: RL.qty_shipped,
        qty_received: RL.qty_received,
        from_location_id: sql<string | null>`coalesce(${RL.from_location_id}, ${R.from_location_id})`,
        to_location_id: sql<string | null>`coalesce(${RL.to_location_id}, ${R.to_location_id})`,
        linked_transfer_id: R.linked_transfer_id,
        lot_no: RL.lot_no,
        plan_id: P.plan_id,
        plan_no: schema.semenCollectionPlan.plan_no,
        allocated_lot_id: P.semen_batch_id,
      })
      .from(RL)
      .innerJoin(R, eq(R.requisition_id, RL.requisition_id))
      .leftJoin(schema.breedMaster, eq(schema.breedMaster.breed_id, R.breed_id))
      .leftJoin(P, eq(P.requisition_line_id, RL.line_id))
      .leftJoin(schema.semenCollectionPlan, eq(schema.semenCollectionPlan.plan_id, P.plan_id))
      .where(and(...conditions))
      .orderBy(asc(R.required_date), asc(R.req_no), asc(RL.line_seq));
    const place = async (id: string | null) => {
      if (!id) return null;
      const [l] = await this.db
        .select({ code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
        .from(schema.locationMaster)
        .where(eq(schema.locationMaster.location_id, id))
        .limit(1);
      return l ?? null;
    };
    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        // A request with no farm recorded belongs to the farm of the store it asks the doses to go to.
        farm_id: r.farm_id ?? (r.to_location_id ? await farmOfLocation(this.db, r.to_location_id) : null),
        doses: Number(r.doses),
        qty_shipped: Number(r.qty_shipped ?? 0),
        qty_received: Number(r.qty_received ?? 0),
        released: !!r.linked_transfer_id,
        from_store: await place(r.from_location_id),
        to_store: await place(r.to_location_id),
        farm: await place(r.farm_id ?? (r.to_location_id ? await farmOfLocation(this.db, r.to_location_id) : null)),
      })),
    );
  }

  /** The requests the AI Station has to serve: approved and not cancelled, not yet fully received (or every one, with status ALL). */
  async list(query: QuerySemenRequestDto, tenantId: string) {
    const rows = await this.lines(tenantId, { breedId: query.breed_id });
    if (query.status === 'ALL') return rows;
    return rows.filter((r) => r.approval_status === 'APPROVED' && r.document_status !== 'CANCELLED' && r.qty_received < r.doses - 1e-9);
  }

  private asRule = (r: Awaited<ReturnType<SemenRequestService['lines']>>[number]): RequestLine => ({
    line_id: r.line_id, requisition_id: r.requisition_id, req_no: r.req_no, breed_id: r.breed_id, approval_status: r.approval_status,
    document_status: r.document_status, required_date: r.required_date ? String(r.required_date).slice(0, 10) : null, doses: r.doses,
    from_location_id: r.from_location_id, released: r.released, lot_no: r.lot_no, plan_id: r.plan_id,
  });

  /** The request lines a new collection plan of `breedId` would serve, checked; refused with every reason. */
  async linesForPlan(lineIds: string[], breedId: string, breedCode: string, tenantId: string) {
    const found = await this.lines(tenantId, { lineIds });
    const missing = lineIds.filter((id) => !found.some((f) => f.line_id === id));
    if (missing.length) throw new NotFoundException(`${missing.length} of the semen requests were not found.`);
    const problems = planRequestProblems(found.map(this.asRule), breedId, breedCode);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    return found;
  }

  /** Links the request lines to the plan (inside the plan's own transaction). */
  async linkToPlan(planId: string, lines: { line_id: string; requisition_id: string; doses: number }[], tenantId: string) {
    if (!lines.length) return;
    await this.db.insert(schema.semenPlanRequisition).values(
      lines.map((l) => ({ link_id: randomUUID(), tenant_id: tenantId, plan_id: planId, requisition_id: l.requisition_id, requisition_line_id: l.line_id, doses: l.doses.toFixed(2) })),
    );
  }

  /**
   * Allocates a collected lot, clear of QC, to request lines: the ones named, else those linked to the lot's plan. The earliest needed are
   * filled first, each whole, from the doses the lot still has at its collection store and has not already promised to another request.
   * Each allocation puts the lot on the request's transfer (the requisition's Item Tracking); the farm ships and receives as before.
   */
  async allocate(dto: AllocateSemenLotDto, tenantId: string, user?: { userId?: string; userType?: string; email?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const [lot] = await this.db
        .select()
        .from(schema.semenBatch)
        .where(and(eq(schema.semenBatch.semen_batch_id, dto.semen_batch_id), eq(schema.semenBatch.tenant_id, tenantId)))
        .limit(1);
      if (!lot) throw new NotFoundException('Semen lot not found.');
      if (!lot.inventory_posted || !lot.lot_no || !lot.output_item_id || !lot.warehouse_id) {
        throw new BadRequestException(`Lot ${lot.lot_no ?? ''} is not stock yet: it is allocated once its QC inspection has accepted it.`.replace('  ', ' '));
      }
      let lines;
      if (dto.requisition_line_ids?.length) lines = await this.lines(tenantId, { lineIds: dto.requisition_line_ids });
      else if (lot.plan_id) lines = await this.lines(tenantId, { planId: lot.plan_id });
      else throw new BadRequestException(`Lot ${lot.lot_no} was collected without a plan: name the requests to allocate it to.`);
      const otherLine = lines.filter((l) => lot.breed_id && l.breed_id !== lot.breed_id);
      const wrongItem = lines.filter((l) => l.item_id !== lot.output_item_id);
      const usable = lines.filter((l) => !otherLine.includes(l) && !wrongItem.includes(l));

      const L = schema.inventoryLedger;
      const [held] = await this.db
        .select({ qty: sql<string>`COALESCE(SUM(${L.quantity}), 0)` })
        .from(L)
        .where(and(eq(L.item_id, lot.output_item_id), eq(L.lot_no, lot.lot_no), eq(L.warehouse_id, lot.warehouse_id)));
      // Doses already given to a request but not shipped yet are still in the store: they are promised, not free.
      const promised = await this.db
        .select({ doses: schema.requisitionLine.quantity, shipped: schema.requisitionLine.qty_shipped })
        .from(schema.semenPlanRequisition)
        .innerJoin(schema.requisitionLine, eq(schema.requisitionLine.line_id, schema.semenPlanRequisition.requisition_line_id))
        .where(eq(schema.semenPlanRequisition.semen_batch_id, lot.semen_batch_id));
      const owed = promised.reduce((n, p) => n + Math.max(0, Number(p.doses) - Number(p.shipped ?? 0)), 0);
      const free = Math.max(0, Number(held?.qty ?? 0) - owed);

      const plan = allocationPlan(usable.map(this.asRule), { lot_no: lot.lot_no, store_id: lot.warehouse_id, doses: free });
      for (const a of plan.allocate) {
        await this.requisitions.assignTracking(a.requisition_id, { lines: [{ line_id: a.line_id, lot_no: lot.lot_no }] } as any, tenantId, user);
        const [link] = await this.db.select({ id: schema.semenPlanRequisition.link_id }).from(schema.semenPlanRequisition)
          .where(eq(schema.semenPlanRequisition.requisition_line_id, a.line_id)).limit(1);
        if (link) {
          await this.db.update(schema.semenPlanRequisition).set({ semen_batch_id: lot.semen_batch_id, allocated_at: nowTs() as any })
            .where(eq(schema.semenPlanRequisition.link_id, link.id));
        } else {
          await this.db.insert(schema.semenPlanRequisition).values({
            link_id: randomUUID(), tenant_id: tenantId, plan_id: null, requisition_id: a.requisition_id, requisition_line_id: a.line_id,
            doses: a.doses.toFixed(2), semen_batch_id: lot.semen_batch_id, allocated_at: nowTs() as any,
          });
        }
      }
      const skipped = [
        ...otherLine.map((l) => ({ req_no: l.req_no, reason: `asks for ${l.breed_code ?? 'another line'}, not this lot's line` })),
        ...wrongItem.map((l) => ({ req_no: l.req_no, reason: "asks for another item than this lot's" })),
        ...plan.skipped,
      ];
      await this.auditService.log({
        tenantId, companyId: lot.company_id ?? undefined, userId: user?.userId, action: 'UPDATE', entityName: 'semen_batch', entityId: lot.semen_batch_id,
        newValues: { allocated: plan.allocate.map((a) => ({ req_no: a.req_no, doses: a.doses })), skipped },
      });
      return { lot_no: lot.lot_no, free_before: free, allocated: plan.allocate, skipped, left: plan.left };
    });
  }
}
