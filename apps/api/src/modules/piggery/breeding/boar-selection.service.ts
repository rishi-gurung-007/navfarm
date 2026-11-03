import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { animalScopeConditions, farmScope } from '../../../common/farm-scope';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { BreedingLineSetupService } from '../../master-data/breeding-line/breeding-line-setup.service';
import { GeneticLevelBandService } from '../../master-data/breeding-line/genetic-level-band.service';
import { SELECTION_COLUMNS } from '../../master-data/breeding-line/breeding-line.rules';
import { GradingFormula, rankBoars, TieBreak } from './boar-ranking.rules';
import { nextCollectionDate } from './collection-plan.rules';
import { conditionStatus } from '../boar-condition/boar-condition.rules';
import { ImportBoarTsiDto, RecordBoarTsiDto } from './boar-selection.dto';

type Animal = typeof schema.animalRegister.$inferSelect;

const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The boar selection table of the AI Station (plan 2026-11-02-ai-station-semen-collection, Phase 3). */
@Injectable()
export class BoarSelectionService {
  constructor(
    private readonly cls: ClsService,
    private readonly lineSetups: BreedingLineSetupService,
    private readonly bands: GeneticLevelBandService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /** The live boars the caller may see, optionally of one breed and company. */
  private boarConditions(tenantId: string, companyId: string | null, breedId?: string) {
    return [
      eq(schema.animalRegister.tenant_id, tenantId),
      eq(schema.animalRegister.animal_type, 'BOAR'),
      eq(schema.animalRegister.gender, 'M'),
      eq(schema.animalRegister.is_active, true),
      ...(companyId ? [eq(schema.animalRegister.company_id, companyId)] : []),
      ...(breedId ? [eq(schema.animalRegister.breed_id, breedId)] : []),
      ...animalScopeConditions(farmScope(this.cls)),
    ];
  }

  /** The breeding lines (breeds) that have live boars, with how many. */
  async lines(tenantId: string, companyId?: string) {
    const company = companyId ?? farmScope(this.cls).companyId;
    return this.db
      .select({
        breed_id: schema.breedMaster.breed_id,
        breed_code: schema.breedMaster.breed_code,
        breed_name: schema.breedMaster.breed_name,
        boars: sql<number>`count(*)`.mapWith(Number),
      })
      .from(schema.animalRegister)
      .innerJoin(schema.breedMaster, eq(schema.breedMaster.breed_id, schema.animalRegister.breed_id))
      .where(and(...this.boarConditions(tenantId, company)))
      .groupBy(schema.breedMaster.breed_id, schema.breedMaster.breed_code, schema.breedMaster.breed_name)
      .orderBy(schema.breedMaster.breed_code);
  }

  async selection(breedId: string, tenantId: string, asOf: string = today(), companyId?: string) {
    const [breed] = await this.db.select().from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, breedId)).limit(1);
    if (!breed) throw new NotFoundException('Breeding line not found.');
    const scopedCompany = companyId ?? farmScope(this.cls).companyId;
    const boars = await this.db
      .select()
      .from(schema.animalRegister)
      .where(and(...this.boarConditions(tenantId, scopedCompany, breedId)));
    const company = scopedCompany ?? boars[0]?.company_id ?? null;
    const ids = boars.map((b) => b.animal_id);

    const setup = await this.lineSetups.findEffective(breedId, tenantId, company);
    const bands = await this.bands.findForLine(breedId, tenantId, company);

    // A boar's TSI as of the date: his latest history entry on or before it, else the TSI on his record.
    const tsiOf = new Map<string, { tsi: number | null; published_rank: number | null; effective_date: string | null }>();
    // His last accepted collection on or before the date.
    const lastOf = new Map<string, { volume_ml: number | null; doses: number; morphology_pct: number | null; motility_pct: number | null; collector_code: string | null; collection_date: string }>();
    if (ids.length) {
      const history = await this.db
        .select()
        .from(schema.boarTsiHistory)
        .where(and(inArray(schema.boarTsiHistory.boar_animal_id, ids), lte(schema.boarTsiHistory.effective_date, asOf)))
        .orderBy(desc(schema.boarTsiHistory.effective_date), desc(schema.boarTsiHistory.created_at));
      for (const h of history) {
        if (!tsiOf.has(h.boar_animal_id)) {
          tsiOf.set(h.boar_animal_id, { tsi: num(h.tsi), published_rank: h.published_rank, effective_date: String(h.effective_date).slice(0, 10) });
        }
      }
      const results = await this.db
        .select({
          boar: schema.semenBoarResult.boar_animal_id,
          volume_ml: schema.semenBoarResult.volume_ml,
          doses: schema.semenBoarResult.doses,
          morphology_pct: schema.semenBoarResult.morphology_pct,
          motility_pct: schema.semenBoarResult.motility_pct,
          collector_code: schema.semenCollector.collector_code,
          collection_date: schema.semenBatch.collection_date,
        })
        .from(schema.semenBoarResult)
        .innerJoin(schema.semenBatch, eq(schema.semenBatch.semen_batch_id, schema.semenBoarResult.semen_batch_id))
        .leftJoin(schema.semenCollector, eq(schema.semenCollector.collector_id, schema.semenBoarResult.collector_id))
        .where(
          and(
            inArray(schema.semenBoarResult.boar_animal_id, ids),
            eq(schema.semenBoarResult.accepted, true),
            isNotNull(schema.semenBoarResult.doses),
            lte(schema.semenBatch.collection_date, asOf),
          ),
        )
        .orderBy(desc(schema.semenBatch.collection_date), desc(schema.semenBoarResult.created_at));
      for (const r of results) {
        if (!lastOf.has(r.boar)) {
          lastOf.set(r.boar, {
            volume_ml: num(r.volume_ml),
            doses: r.doses as number,
            morphology_pct: num(r.morphology_pct),
            motility_pct: num(r.motility_pct),
            collector_code: r.collector_code,
            collection_date: String(r.collection_date).slice(0, 10),
          });
        }
      }
    }

    // The next collection each boar is planned for, on or after the date (a plan still standing, himself still to be collected).
    const plannedOf = new Map<string, { plan_id: string; plan_no: string; date: string; weekday: string }>();
    if (ids.length) {
      const planned = await this.db
        .select({
          boar: schema.semenCollectionPlanLine.boar_animal_id,
          plan_id: schema.semenCollectionPlan.plan_id,
          plan_no: schema.semenCollectionPlan.plan_no,
          date: schema.semenCollectionPlan.collection_date,
          weekday: schema.semenCollectionPlan.weekday,
        })
        .from(schema.semenCollectionPlanLine)
        .innerJoin(schema.semenCollectionPlan, eq(schema.semenCollectionPlan.plan_id, schema.semenCollectionPlanLine.plan_id))
        .where(
          and(
            inArray(schema.semenCollectionPlanLine.boar_animal_id, ids),
            eq(schema.semenCollectionPlanLine.status, 'PLANNED'),
            eq(schema.semenCollectionPlan.status, 'PLANNED'),
            gte(schema.semenCollectionPlan.collection_date, asOf),
          ),
        )
        .orderBy(asc(schema.semenCollectionPlan.collection_date));
      for (const p of planned) {
        if (!plannedOf.has(p.boar)) plannedOf.set(p.boar, { plan_id: p.plan_id, plan_no: p.plan_no, date: String(p.date).slice(0, 10), weekday: p.weekday });
      }
    }

    // Each boar's latest body condition on or before the date, and where he stands against the line's schedule (Phase 6).
    const conditionOf = new Map<string, { score: number; assessed_on: string }>();
    if (ids.length) {
      const records = await this.db
        .select({ boar: schema.boarConditionRecord.boar_animal_id, score: schema.boarConditionRecord.score, assessed_on: schema.boarConditionRecord.assessed_on })
        .from(schema.boarConditionRecord)
        .where(and(inArray(schema.boarConditionRecord.boar_animal_id, ids), lte(schema.boarConditionRecord.assessed_on, asOf)))
        .orderBy(desc(schema.boarConditionRecord.assessed_on), desc(schema.boarConditionRecord.created_at));
      for (const r of records) if (!conditionOf.has(r.boar)) conditionOf.set(r.boar, { score: r.score, assessed_on: String(r.assessed_on).slice(0, 10) });
    }

    // What planning a collection for this line asks for, from its setup: the dialog offers only what the line allows.
    const farmIds = (setup?.destination_farm_ids ?? []) as string[];
    const destinationFarms = farmIds.length
      ? await this.db
          .select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code, location_name: schema.locationMaster.location_name })
          .from(schema.locationMaster)
          .where(and(inArray(schema.locationMaster.location_id, farmIds), eq(schema.locationMaster.is_active, true)))
      : [];
    const planRules = {
      collection_mode: setup?.collection_mode ?? null,
      collection_weekdays: setup?.collection_weekdays ?? null,
      boars_per_collection_day: setup?.boars_per_collection_day ?? null,
      pooling_allowed: setup?.pooling_allowed ?? true,
      reference_required: !!setup?.reference_required,
      reference_label: setup?.reference_label ?? null,
      destination_rule: setup?.destination_rule ?? 'ANY',
      destination_farms: destinationFarms,
      next_collection_date: nextCollectionDate(setup?.collection_weekdays, today()),
    };

    const formula: GradingFormula = {
      genetic_weight: num(setup?.grading_genetic_weight),
      dose_weight: num(setup?.grading_dose_weight),
      morphology_weight: num(setup?.grading_morphology_weight),
      tie_break: (setup?.rank_tie_break as TieBreak) ?? 'GENETIC_RANK',
    };
    const tsiFor = (b: Animal) => tsiOf.get(b.animal_id) ?? { tsi: num(b.tsi), published_rank: null, effective_date: null };
    const ranks = rankBoars(
      boars.map((b) => ({
        boar_id: b.animal_id,
        boar_code: b.animal_code,
        tsi: tsiFor(b).tsi,
        published_rank: tsiFor(b).published_rank,
        last_doses: lastOf.get(b.animal_id)?.doses ?? null,
        last_morphology_pct: lastOf.get(b.animal_id)?.morphology_pct ?? null,
      })),
      formula,
      bands,
    );

    const rows = boars
      .map((b) => {
        const rank = ranks.find((r) => r.boar_id === b.animal_id)!;
        const last = lastOf.get(b.animal_id);
        return {
          boar_id: b.animal_id,
          collector: last?.collector_code ?? null,
          boar: b.animal_code,
          rfid_tag: b.rfid_tag,
          batch_id: b.current_batch_id,
          dob: b.dob ? String(b.dob).slice(0, 10) : null,
          age: b.dob ? daysBetween(String(b.dob).slice(0, 10), asOf) : null,
          tsi: tsiFor(b).tsi,
          tsi_effective_date: tsiFor(b).effective_date,
          genetic_level: rank.genetic_level,
          genetic_rank: rank.genetic_rank,
          last_volume_ml: last?.volume_ml ?? null,
          last_doses: last?.doses ?? null,
          dose_rank: rank.dose_rank,
          last_morphology: last?.morphology_pct ?? null,
          morphology_rank: rank.morphology_rank,
          last_collection_date: last?.collection_date ?? null,
          overall_grading: rank.overall_grading,
          overall_rank: rank.overall_rank,
          planned_day: plannedOf.has(b.animal_id) ? `${plannedOf.get(b.animal_id)!.weekday} ${plannedOf.get(b.animal_id)!.date}` : null,
          planned_plan_no: plannedOf.get(b.animal_id)?.plan_no ?? null,
          bcs_score: conditionOf.get(b.animal_id)?.score ?? null,
          bcs_assessed_on: conditionOf.get(b.animal_id)?.assessed_on ?? null,
          ...(() => {
            const c = conditionStatus({
              lastAssessedOn: conditionOf.get(b.animal_id)?.assessed_on ?? null,
              setup: setup ? { bcs_frequency_days: setup.bcs_frequency_days ?? null, bcs_grace_days: setup.bcs_grace_days ?? null, bcs_reminder_days: setup.bcs_reminder_days ?? null } : null,
              today: asOf,
            });
            return { bcs_status: c.status, bcs_due: c.due };
          })(),
        };
      })
      .sort((a, b) => (a.genetic_rank ?? Number.MAX_SAFE_INTEGER) - (b.genetic_rank ?? Number.MAX_SAFE_INTEGER) || a.boar.localeCompare(b.boar));

    // The columns the line shows, in its order; every column in the default order when it names none.
    const labelOf = new Map<string, string>(SELECTION_COLUMNS.map((c) => [c.key, c.label]));
    const layout = setup?.selection_columns?.length
      ? setup.selection_columns
      : SELECTION_COLUMNS.map((c) => ({ key: c.key as string, label: '', visible: true }));
    const columns = layout.filter((c) => c.visible).map((c) => ({ key: c.key, label: c.label?.trim() || labelOf.get(c.key) || c.key }));

    return {
      breed: { breed_id: breed.breed_id, breed_code: breed.breed_code, breed_name: breed.breed_name },
      as_of: asOf,
      setup_id: setup?.setup_id ?? null,
      plan_rules: planRules,
      grading: { ...formula, used: formula.genetic_weight || formula.dose_weight || formula.morphology_weight ? true : false },
      columns,
      rows,
    };
  }

  private async liveBoarByCode(codes: string[], tenantId: string, companyId: string | null) {
    const rows = await this.db
      .select()
      .from(schema.animalRegister)
      .where(and(...this.boarConditions(tenantId, companyId), inArray(schema.animalRegister.animal_code, codes)));
    return rows;
  }

  /** Writes one TSI entry, and moves the boar's current TSI on his record when it is the newest. */
  private async writeTsi(boar: Animal, tsi: number, effectiveDate: string, publishedRank: number | null, source: 'MANUAL' | 'IMPORT', notes: string | null, userId?: string) {
    if (effectiveDate > today()) throw new BadRequestException('The effective date cannot be in the future.');
    const [latest] = await this.db
      .select({ d: schema.boarTsiHistory.effective_date })
      .from(schema.boarTsiHistory)
      .where(eq(schema.boarTsiHistory.boar_animal_id, boar.animal_id))
      .orderBy(desc(schema.boarTsiHistory.effective_date))
      .limit(1);
    await this.db.insert(schema.boarTsiHistory).values({
      history_id: randomUUID(),
      tenant_id: boar.tenant_id,
      company_id: boar.company_id,
      boar_animal_id: boar.animal_id,
      tsi: String(tsi),
      published_rank: publishedRank,
      effective_date: effectiveDate,
      source,
      notes,
      created_by: userId ?? null,
    });
    if (!latest || String(latest.d).slice(0, 10) <= effectiveDate) {
      await this.db.update(schema.animalRegister).set({ tsi: String(tsi) }).where(eq(schema.animalRegister.animal_id, boar.animal_id));
    }
  }

  async recordTsi(dto: RecordBoarTsiDto, tenantId: string, user?: any) {
    const [boar] = await this.db
      .select()
      .from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, dto.boar_animal_id), ...this.boarConditions(tenantId, null)))
      .limit(1);
    if (!boar) throw new NotFoundException('Boar not found.');
    await withTenantTransaction(this.cls, () =>
      this.writeTsi(boar, dto.tsi, dto.effective_date ?? today(), dto.published_rank ?? null, 'MANUAL', dto.notes?.trim() || null, user?.userId),
    );
    return { boar: boar.animal_code, tsi: dto.tsi, effective_date: dto.effective_date ?? today(), published_rank: dto.published_rank ?? null };
  }

  /** All or nothing: every code must be a live boar the caller may see, and none may repeat. */
  async importTsi(dto: ImportBoarTsiDto, tenantId: string, user?: any) {
    const company = dto.company_id ?? farmScope(this.cls).companyId;
    const codes = dto.rows.map((r) => r.animal_code.trim());
    const repeated = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (repeated.length) throw new BadRequestException(`A boar is listed twice: ${[...new Set(repeated)].join(', ')}.`);
    const found = await this.liveBoarByCode(codes, tenantId, company);
    const unknown = codes.filter((c) => !found.some((b) => b.animal_code === c));
    if (unknown.length) throw new BadRequestException(`Not a live boar you can see: ${unknown.join(', ')}. Nothing was imported.`);
    const date = dto.effective_date ?? today();
    await withTenantTransaction(this.cls, async () => {
      for (const row of dto.rows) {
        const boar = found.find((b) => b.animal_code === row.animal_code.trim())!;
        await this.writeTsi(boar, row.tsi, date, row.published_rank ?? null, 'IMPORT', null, user?.userId);
      }
    });
    return { imported: dto.rows.length, effective_date: date };
  }
}
