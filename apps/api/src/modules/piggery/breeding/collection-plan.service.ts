import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, like, ne, gte, lte, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { animalScopeConditions, farmScope } from '../../../common/farm-scope';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { BreedingLineSetupService } from '../../master-data/breeding-line/breeding-line-setup.service';
import { BoarSelectionService } from './boar-selection.service';
import { CreateCollectionPlanDto, QueryCollectionPlansDto } from './collection-plan.dto';
import { isoWeekOf, PlanSetup, planResult, weekdayOf } from './collection-plan.rules';

type Plan = typeof schema.semenCollectionPlan.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);

/** A planned semen collection: boars of one line for one day, checked against the line's setup (plan 2026-11-02, Phase 4). */
@Injectable()
export class CollectionPlanService {
  constructor(
    private readonly cls: ClsService,
    private readonly lineSetups: BreedingLineSetupService,
    private readonly selection: BoarSelectionService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /** The setup row as the plan rules read it (decimals and JSON arrive as MySQL gives them). */
  private setupOf(row: Awaited<ReturnType<BreedingLineSetupService['findEffective']>>): PlanSetup | null {
    if (!row) return null;
    return {
      collection_mode: row.collection_mode,
      collection_weekdays: row.collection_weekdays ?? null,
      boars_per_collection_day: row.boars_per_collection_day ?? null,
      reference_required: !!row.reference_required,
      reference_label: row.reference_label ?? null,
      destination_rule: row.destination_rule,
      destination_farm_ids: row.destination_farm_ids ?? null,
    };
  }

  /** The plan with its boars, each with his code, tag, batch and collector. */
  private async withLines(plans: Plan[]) {
    if (!plans.length) return [];
    const lines = await this.db
      .select({
        plan_id: schema.semenCollectionPlanLine.plan_id,
        boar_id: schema.semenCollectionPlanLine.boar_animal_id,
        boar_code: schema.animalRegister.animal_code,
        rfid_tag: schema.animalRegister.rfid_tag,
        batch_id: schema.animalRegister.current_batch_id,
        collector_id: schema.semenCollectionPlanLine.collector_id,
        collector_code: schema.semenCollector.collector_code,
        status: schema.semenCollectionPlanLine.status,
        skip_reason: schema.semenCollectionPlanLine.skip_reason,
        semen_batch_id: schema.semenCollectionPlanLine.semen_batch_id,
        selection_snapshot: schema.semenCollectionPlanLine.selection_snapshot,
      })
      .from(schema.semenCollectionPlanLine)
      .innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.semenCollectionPlanLine.boar_animal_id))
      .leftJoin(schema.semenCollector, eq(schema.semenCollector.collector_id, schema.semenCollectionPlanLine.collector_id))
      .where(inArray(schema.semenCollectionPlanLine.plan_id, plans.map((p) => p.plan_id)))
      .orderBy(asc(schema.semenCollectionPlanLine.sort_order));
    const breeds = await this.db
      .select({ id: schema.breedMaster.breed_id, code: schema.breedMaster.breed_code })
      .from(schema.breedMaster)
      .where(inArray(schema.breedMaster.breed_id, [...new Set(plans.map((p) => p.breed_id))]));
    const destinationIds = [...new Set(plans.map((p) => p.destination_farm_id).filter((id): id is string => !!id))];
    const farms = destinationIds.length
      ? await this.db
          .select({ id: schema.locationMaster.location_id, code: schema.locationMaster.location_code, name: schema.locationMaster.location_name })
          .from(schema.locationMaster)
          .where(inArray(schema.locationMaster.location_id, destinationIds))
      : [];
    return plans.map((p) => ({
      ...p,
      breed_code: breeds.find((b) => b.id === p.breed_id)?.code ?? null,
      destination_farm_code: farms.find((f) => f.id === p.destination_farm_id)?.code ?? null,
      destination_farm_name: farms.find((f) => f.id === p.destination_farm_id)?.name ?? null,
      lines: lines.filter((l) => l.plan_id === p.plan_id),
    }));
  }

  async findOne(id: string, tenantId: string) {
    const [plan] = await this.db
      .select()
      .from(schema.semenCollectionPlan)
      .where(and(eq(schema.semenCollectionPlan.plan_id, id), eq(schema.semenCollectionPlan.tenant_id, tenantId)))
      .limit(1);
    if (!plan) throw new NotFoundException('Collection plan not found.');
    await this.assertVisible(plan);
    return (await this.withLines([plan]))[0];
  }

  /** A restricted user sees a plan only when he may see one of its boars. */
  private async assertVisible(plan: Plan) {
    const seen = await this.db
      .select({ id: schema.semenCollectionPlanLine.boar_animal_id })
      .from(schema.semenCollectionPlanLine)
      .innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.semenCollectionPlanLine.boar_animal_id))
      .where(and(eq(schema.semenCollectionPlanLine.plan_id, plan.plan_id), ...animalScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!seen.length) throw new NotFoundException('Collection plan not found.');
  }

  async list(query: QueryCollectionPlansDto, tenantId: string) {
    const conditions = [eq(schema.semenCollectionPlan.tenant_id, tenantId)];
    if (query.breed_id) conditions.push(eq(schema.semenCollectionPlan.breed_id, query.breed_id));
    if (query.status) conditions.push(eq(schema.semenCollectionPlan.status, query.status));
    if (query.from) conditions.push(gte(schema.semenCollectionPlan.collection_date, query.from.slice(0, 10)));
    if (query.to) conditions.push(lte(schema.semenCollectionPlan.collection_date, query.to.slice(0, 10)));
    // Only plans with a boar the caller may see.
    const visible = await this.db
      .selectDistinct({ id: schema.semenCollectionPlanLine.plan_id })
      .from(schema.semenCollectionPlanLine)
      .innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.semenCollectionPlanLine.boar_animal_id))
      .where(and(eq(schema.semenCollectionPlanLine.tenant_id, tenantId), ...animalScopeConditions(farmScope(this.cls))));
    if (!visible.length) return [];
    conditions.push(inArray(schema.semenCollectionPlan.plan_id, visible.map((v) => v.id)));
    const plans = await this.db
      .select()
      .from(schema.semenCollectionPlan)
      .where(and(...conditions))
      .orderBy(desc(schema.semenCollectionPlan.collection_date), desc(schema.semenCollectionPlan.created_at))
      .limit(200);
    return this.withLines(plans);
  }

  private async planNo(date: string, tenantId: string) {
    const prefix = `CP-${date.replace(/-/g, '')}-`;
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.semenCollectionPlan)
      .where(and(eq(schema.semenCollectionPlan.tenant_id, tenantId), like(schema.semenCollectionPlan.plan_no, `${prefix}%`)));
    return `${prefix}${String(n + 1).padStart(2, '0')}`;
  }

  async create(dto: CreateCollectionPlanDto, tenantId: string, user?: any) {
    const date = dto.collection_date.slice(0, 10);
    const [breed] = await this.db.select().from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, dto.breed_id)).limit(1);
    if (!breed) throw new NotFoundException('Breeding line not found.');

    const ids = dto.boars.map((b) => b.boar_animal_id);
    const boars = await this.db
      .select()
      .from(schema.animalRegister)
      .where(
        and(
          eq(schema.animalRegister.tenant_id, tenantId),
          inArray(schema.animalRegister.animal_id, ids),
          eq(schema.animalRegister.animal_type, 'BOAR'),
          eq(schema.animalRegister.gender, 'M'),
          eq(schema.animalRegister.is_active, true),
          eq(schema.animalRegister.breed_id, dto.breed_id),
          ...animalScopeConditions(farmScope(this.cls)),
        ),
      );
    const missing = ids.filter((id) => !boars.some((b) => b.animal_id === id));
    if (missing.length) throw new BadRequestException(`Not a live boar of ${breed.breed_code} you can see: ${missing.join(', ')}.`);
    const company = boars[0].company_id;
    if (boars.some((b) => b.company_id !== company)) throw new BadRequestException('A plan is for the boars of one company.');

    const setup = await this.lineSetups.findEffective(dto.breed_id, tenantId, company);
    const planSetup = this.setupOf(setup);
    // A line with one destination has nowhere else to send its semen: the plan need not ask.
    const farms = planSetup?.destination_farm_ids ?? [];
    const destination = dto.destination_farm_id ?? (planSetup?.destination_rule === 'ONE' ? farms[0] : undefined) ?? null;

    // Boars of this line already planned that day, in plans still standing.
    const standing = await this.db
      .select({ boar: schema.semenCollectionPlanLine.boar_animal_id, plan_no: schema.semenCollectionPlan.plan_no })
      .from(schema.semenCollectionPlanLine)
      .innerJoin(schema.semenCollectionPlan, eq(schema.semenCollectionPlan.plan_id, schema.semenCollectionPlanLine.plan_id))
      .where(
        and(
          eq(schema.semenCollectionPlan.tenant_id, tenantId),
          eq(schema.semenCollectionPlan.breed_id, dto.breed_id),
          eq(schema.semenCollectionPlan.collection_date, date),
          ne(schema.semenCollectionPlan.status, 'CANCELLED'),
          ne(schema.semenCollectionPlanLine.status, 'SKIPPED'),
        ),
      );
    const twice = boars.filter((b) => standing.some((s) => s.boar === b.animal_id));
    if (twice.length) {
      throw new BadRequestException(
        `${twice.map((b) => b.animal_code).join(', ')} ${twice.length === 1 ? 'is' : 'are'} already planned for ${date} (${[...new Set(standing.filter((s) => twice.some((b) => b.animal_id === s.boar)).map((s) => s.plan_no))].join(', ')}).`,
      );
    }

    const result = planResult(
      planSetup,
      { date, today: today(), boarIds: ids, alreadyPlanned: standing.length, reference: dto.reference, destinationFarmId: destination },
      breed.breed_code,
    );
    if (result.errors.length) throw new BadRequestException(result.errors.join(' '));
    await this.assertFarm(destination, tenantId, company);
    await this.assertCollectors(dto.boars.map((b) => b.collector_id), tenantId, company);

    // The table's own figures for each boar, as they stand when he is chosen.
    const table = await this.selection.selection(dto.breed_id, tenantId, today(), company ?? undefined);
    const snapshotOf = (boarId: string) => {
      const r = table.rows.find((x) => x.boar_id === boarId);
      return r
        ? {
            tsi: r.tsi, genetic_level: r.genetic_level, genetic_rank: r.genetic_rank, dose_rank: r.dose_rank, morphology_rank: r.morphology_rank,
            overall_grading: r.overall_grading, overall_rank: r.overall_rank, last_doses: r.last_doses, last_collection_date: r.last_collection_date,
          }
        : null;
    };

    const week = isoWeekOf(date);
    const plan_id = randomUUID();
    await withTenantTransaction(this.cls, async () => {
      await this.db.insert(schema.semenCollectionPlan).values({
        plan_id, tenant_id: tenantId, company_id: company, plan_no: await this.planNo(date, tenantId), breed_id: dto.breed_id,
        collection_date: date, weekday: weekdayOf(date), week_no: week.week, week_year: week.year,
        requested_by: dto.requested_by?.trim() || null, reference: dto.reference?.trim() || null,
        destination_farm_id: destination, notes: dto.notes?.trim() || null, created_by: user?.userId ?? null,
      });
      await this.db.insert(schema.semenCollectionPlanLine).values(
        dto.boars.map((b, i) => ({
          plan_id, boar_animal_id: b.boar_animal_id, tenant_id: tenantId, collector_id: b.collector_id ?? null,
          selection_snapshot: snapshotOf(b.boar_animal_id), sort_order: i,
        })),
      );
    });
    return { ...(await this.findOne(plan_id, tenantId)), warnings: result.warnings };
  }

  private async assertFarm(farmId: string | null, tenantId: string, companyId: string | null) {
    if (!farmId) return;
    const [farm] = await this.db
      .select({ id: schema.locationMaster.location_id })
      .from(schema.locationMaster)
      .where(
        and(
          eq(schema.locationMaster.location_id, farmId),
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.location_type, 'FARM'),
          eq(schema.locationMaster.is_active, true),
          ...(companyId ? [eq(schema.locationMaster.company_id, companyId)] : []),
        ),
      )
      .limit(1);
    if (!farm) throw new BadRequestException('Select an active farm of this company as the destination.');
  }

  private async assertCollectors(ids: (string | null | undefined)[], tenantId: string, companyId: string | null) {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return;
    const rows = await this.db
      .select({ id: schema.semenCollector.collector_id })
      .from(schema.semenCollector)
      .where(
        and(
          eq(schema.semenCollector.tenant_id, tenantId),
          eq(schema.semenCollector.is_active, true),
          inArray(schema.semenCollector.collector_id, wanted),
          ...(companyId ? [eq(schema.semenCollector.company_id, companyId)] : []),
        ),
      );
    if (wanted.some((id) => !rows.some((r) => r.id === id))) throw new BadRequestException('Select active collectors of this company.');
  }

  /** A plan is COLLECTED when none of its boars is still to be tapped and one was; CANCELLED when none was. */
  private async settle(planId: string, reasonIfNoneTapped: string) {
    const lines = await this.db
      .select({ status: schema.semenCollectionPlanLine.status })
      .from(schema.semenCollectionPlanLine)
      .where(eq(schema.semenCollectionPlanLine.plan_id, planId));
    if (lines.some((l) => l.status === 'PLANNED')) return;
    const tapped = lines.some((l) => l.status === 'COLLECTED');
    await this.db
      .update(schema.semenCollectionPlan)
      .set({ status: tapped ? 'COLLECTED' : 'CANCELLED', cancel_reason: tapped ? null : reasonIfNoneTapped, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') })
      .where(eq(schema.semenCollectionPlan.plan_id, planId));
  }

  async cancel(id: string, reason: string, tenantId: string) {
    const plan = await this.findOne(id, tenantId);
    if (plan.status !== 'PLANNED') throw new BadRequestException(`This plan is ${plan.status.toLowerCase()}; only a planned collection can be cancelled.`);
    if (plan.lines.some((l) => l.status === 'COLLECTED')) {
      throw new BadRequestException('Some of its boars were already collected. Skip the ones not yet tapped instead.');
    }
    if (!reason.trim()) throw new BadRequestException('Say why the plan is cancelled.');
    await withTenantTransaction(this.cls, async () => {
      await this.db.update(schema.semenCollectionPlanLine).set({ status: 'SKIPPED', skip_reason: reason.trim() }).where(eq(schema.semenCollectionPlanLine.plan_id, id));
      await this.db
        .update(schema.semenCollectionPlan)
        .set({ status: 'CANCELLED', cancel_reason: reason.trim(), updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') })
        .where(eq(schema.semenCollectionPlan.plan_id, id));
    });
    return this.findOne(id, tenantId);
  }

  async skipLine(id: string, boarId: string, reason: string, tenantId: string) {
    const plan = await this.findOne(id, tenantId);
    const line = plan.lines.find((l) => l.boar_id === boarId);
    if (!line) throw new NotFoundException('That boar is not in this plan.');
    if (plan.status !== 'PLANNED' || line.status !== 'PLANNED') throw new BadRequestException('Only a boar still to be collected, in a planned collection, can be skipped.');
    if (!reason.trim()) throw new BadRequestException('Say why the boar is skipped.');
    await withTenantTransaction(this.cls, async () => {
      await this.db
        .update(schema.semenCollectionPlanLine)
        .set({ status: 'SKIPPED', skip_reason: reason.trim() })
        .where(and(eq(schema.semenCollectionPlanLine.plan_id, id), eq(schema.semenCollectionPlanLine.boar_animal_id, boarId)));
      await this.settle(id, 'Every boar was skipped.');
    });
    return this.findOne(id, tenantId);
  }

  /**
   * Before a collection is recorded against a plan: the plan must still be open, in the boar's company and line, and every boar
   * tapped must be one of its boars still to be collected. Returns the plan for the collection to read (its reference, destination).
   */
  async assertCollectable(planId: string, tappedBoars: { animal_id: string; animal_code: string; breed_id: string | null; company_id: string | null }[], collectionDate: string, tenantId: string) {
    const [plan] = await this.db
      .select()
      .from(schema.semenCollectionPlan)
      .where(and(eq(schema.semenCollectionPlan.plan_id, planId), eq(schema.semenCollectionPlan.tenant_id, tenantId)))
      .limit(1);
    if (!plan) throw new NotFoundException('Collection plan not found.');
    if (plan.status !== 'PLANNED') throw new BadRequestException(`Plan ${plan.plan_no} is ${plan.status.toLowerCase()}, so it cannot be collected against.`);
    if (tappedBoars.some((b) => b.company_id !== plan.company_id)) throw new BadRequestException(`Plan ${plan.plan_no} belongs to another company.`);
    const wrongLine = tappedBoars.filter((b) => b.breed_id !== plan.breed_id);
    if (wrongLine.length) throw new BadRequestException(`${wrongLine.map((b) => b.animal_code).join(', ')} ${wrongLine.length === 1 ? 'is' : 'are'} not of plan ${plan.plan_no}'s breeding line.`);
    const lines = await this.db.select().from(schema.semenCollectionPlanLine).where(eq(schema.semenCollectionPlanLine.plan_id, planId));
    const notPlanned = tappedBoars.filter((b) => !lines.some((l) => l.boar_animal_id === b.animal_id && l.status === 'PLANNED'));
    if (notPlanned.length) {
      throw new BadRequestException(`${notPlanned.map((b) => b.animal_code).join(', ')} ${notPlanned.length === 1 ? 'is' : 'are'} not a boar still to be collected in plan ${plan.plan_no}.`);
    }
    const warnings = plan.collection_date !== collectionDate ? [`Plan ${plan.plan_no} was for ${plan.collection_date}; this collection is dated ${collectionDate}.`] : [];
    return { plan, warnings };
  }

  /** The boars were tapped in this collection: their lines are done, and the plan with them once no boar is left. */
  async markCollected(planId: string, boarIds: string[], semenBatchId: string) {
    await this.db
      .update(schema.semenCollectionPlanLine)
      .set({ status: 'COLLECTED', semen_batch_id: semenBatchId })
      .where(and(eq(schema.semenCollectionPlanLine.plan_id, planId), inArray(schema.semenCollectionPlanLine.boar_animal_id, boarIds)));
    await this.settle(planId, 'Every boar was skipped.');
  }
}
