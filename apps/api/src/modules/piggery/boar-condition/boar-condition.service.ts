import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { animalScopeConditions, farmScope } from '../../../common/farm-scope';
import { BcsScaleService } from '../../master-data/breeding-line/bcs-scale.service';
import { BreedingLineSetupService } from '../../master-data/breeding-line/breeding-line-setup.service';
import { AssessBoarConditionDto, BoarConditionListQueryDto } from './boar-condition.dto';
import { assessmentIssues, ConditionSetup, conditionStatus, ConditionStatus, feedSet, nextDueDate, scaleFor } from './boar-condition.rules';

type Animal = typeof schema.animalRegister.$inferSelect;
type Record_ = typeof schema.boarConditionRecord.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);
const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));
/** Boars needing attention come first. */
const ORDER: Record<ConditionStatus, number> = { OVERDUE: 0, DUE: 1, NEVER: 2, DUE_SOON: 3, OK: 4, NOT_SCHEDULED: 5 };

/** A boar's body condition assessments (plan 2026-11-02-ai-station-semen-collection, Phase 6; SOP 21). */
@Injectable()
export class BoarConditionService {
  constructor(
    private readonly cls: ClsService,
    private readonly lineSetups: BreedingLineSetupService,
    private readonly scales: BcsScaleService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  private boarConditions(tenantId: string, companyId: string | null) {
    return [
      eq(schema.animalRegister.tenant_id, tenantId),
      eq(schema.animalRegister.animal_type, 'BOAR'),
      eq(schema.animalRegister.gender, 'M'),
      eq(schema.animalRegister.is_active, true),
      ...(companyId ? [eq(schema.animalRegister.company_id, companyId)] : []),
      ...animalScopeConditions(farmScope(this.cls)),
    ];
  }

  private async boarOf(id: string, tenantId: string): Promise<Animal> {
    const [boar] = await this.db
      .select()
      .from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, id), ...this.boarConditions(tenantId, null)))
      .limit(1);
    if (!boar) throw new NotFoundException('Boar not found.');
    return boar;
  }

  private shape(r: Record_ | undefined) {
    return r
      ? {
          record_id: r.record_id,
          assessed_on: String(r.assessed_on).slice(0, 10),
          score: r.score,
          score_name: r.score_name,
          required_action: r.required_action,
          health_flag: !!r.health_flag,
          medication_review: !!r.medication_review,
          scale_feed_kg_per_day: num(r.scale_feed_kg_per_day),
          feed_kg_per_day: num(r.feed_kg_per_day),
          previous_feed_kg_per_day: num(r.previous_feed_kg_per_day),
          override_reason: r.override_reason,
          next_due: r.next_due ? String(r.next_due).slice(0, 10) : null,
          notes: r.notes,
        }
      : null;
  }

  /** The newest record of each boar. */
  private async latestOf(boarIds: string[]) {
    if (!boarIds.length) return new Map<string, Record_>();
    const rows = await this.db
      .select()
      .from(schema.boarConditionRecord)
      .where(inArray(schema.boarConditionRecord.boar_animal_id, boarIds))
      .orderBy(desc(schema.boarConditionRecord.assessed_on), desc(schema.boarConditionRecord.created_at));
    const latest = new Map<string, Record_>();
    for (const r of rows) if (!latest.has(r.boar_animal_id)) latest.set(r.boar_animal_id, r);
    return latest;
  }

  private setupFields(setup: Awaited<ReturnType<BreedingLineSetupService['findEffective']>>): ConditionSetup | null {
    return setup
      ? {
          bcs_frequency_days: setup.bcs_frequency_days ?? null,
          bcs_grace_days: setup.bcs_grace_days ?? null,
          bcs_reminder_days: setup.bcs_reminder_days ?? null,
          bcs_allow_feed_override: !!setup.bcs_allow_feed_override,
          bcs_override_reason_required: !!setup.bcs_override_reason_required,
        }
      : null;
  }

  /** Every live boar the caller may see, with his latest assessment, his current feed level and where he stands against his schedule. */
  async list(query: BoarConditionListQueryDto, tenantId: string) {
    const company = query.company_id ?? farmScope(this.cls).companyId;
    const boars = await this.db
      .select({
        boar: schema.animalRegister,
        breed_code: schema.breedMaster.breed_code,
      })
      .from(schema.animalRegister)
      .leftJoin(schema.breedMaster, eq(schema.breedMaster.breed_id, schema.animalRegister.breed_id))
      .where(and(...this.boarConditions(tenantId, company), ...(query.breed_id ? [eq(schema.animalRegister.breed_id, query.breed_id)] : [])));
    const latest = await this.latestOf(boars.map((b) => b.boar.animal_id));
    // The cadence follows the boar's line: its own setup, else the company default.
    const setupOf = new Map<string, ConditionSetup | null>();
    for (const breed of new Set(boars.map((b) => b.boar.breed_id ?? ''))) {
      const sample = boars.find((b) => (b.boar.breed_id ?? '') === breed)!.boar;
      setupOf.set(breed, this.setupFields(await this.lineSetups.findEffective(sample.breed_id, tenantId, sample.company_id)));
    }
    const now = today();
    const rows = boars.map(({ boar, breed_code }) => {
      const last = latest.get(boar.animal_id);
      const cond = conditionStatus({ lastAssessedOn: last ? String(last.assessed_on).slice(0, 10) : null, setup: setupOf.get(boar.breed_id ?? '') ?? null, today: now });
      return {
        boar_id: boar.animal_id,
        boar: boar.animal_code,
        rfid_tag: boar.rfid_tag,
        breed_id: boar.breed_id,
        breed_code,
        batch_id: boar.current_batch_id,
        status: cond.status,
        due: cond.due,
        days_to_due: cond.daysToDue,
        feed_kg_per_day: num(last?.feed_kg_per_day),
        latest: this.shape(last),
      };
    });
    return rows
      .filter((r) => !query.status || r.status === query.status)
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.days_to_due ?? 0) - (b.days_to_due ?? 0) || a.boar.localeCompare(b.boar));
  }

  /** What the assessment form needs for a boar: his line's scale, whether the feed level may be changed, and where he stands. */
  async scaleOf(boarId: string, tenantId: string) {
    const boar = await this.boarOf(boarId, tenantId);
    const scale = scaleFor(await this.scales.activeRows(tenantId, boar.company_id), boar.breed_id);
    const setup = this.setupFields(await this.lineSetups.findEffective(boar.breed_id, tenantId, boar.company_id));
    const last = (await this.latestOf([boar.animal_id])).get(boar.animal_id);
    return {
      boar: { boar_id: boar.animal_id, boar: boar.animal_code, rfid_tag: boar.rfid_tag },
      scale: scale.map((r) => ({
        score: r.score,
        score_name: r.score_name,
        indicators: r.indicators,
        required_action: r.required_action,
        feed_kg_per_day: r.feed_kg_per_day,
        health_assessment_required: !!r.health_assessment_required,
        medication_review: !!r.medication_review,
      })),
      frequency_days: setup?.bcs_frequency_days ?? null,
      allow_feed_override: !!setup?.bcs_allow_feed_override,
      override_reason_required: setup ? !!setup.bcs_override_reason_required : true,
      latest: this.shape(last),
    };
  }

  async history(boarId: string, tenantId: string) {
    await this.boarOf(boarId, tenantId);
    const rows = await this.db
      .select()
      .from(schema.boarConditionRecord)
      .where(eq(schema.boarConditionRecord.boar_animal_id, boarId))
      .orderBy(desc(schema.boarConditionRecord.assessed_on));
    return rows.map((r) => this.shape(r));
  }

  async assess(dto: AssessBoarConditionDto, tenantId: string, user?: any) {
    const boar = await this.boarOf(dto.boar_animal_id, tenantId);
    const assessedOn = (dto.assessed_on ?? today()).slice(0, 10);
    const scale = scaleFor(await this.scales.activeRows(tenantId, boar.company_id), boar.breed_id);
    const setup = this.setupFields(await this.lineSetups.findEffective(boar.breed_id, tenantId, boar.company_id));
    const last = (await this.latestOf([boar.animal_id])).get(boar.animal_id);

    const issues = assessmentIssues({
      scale,
      score: dto.score,
      setup,
      assessedOn,
      today: today(),
      latestOn: last ? String(last.assessed_on).slice(0, 10) : null,
      boarEntryDate: boar.entry_date ? String(boar.entry_date) : null,
      feedOverride: dto.feed_kg_per_day ?? null,
      overrideReason: dto.override_reason,
    });
    if (issues.length) throw new BadRequestException(issues.join(' '));

    const row = scale.find((r) => r.score === dto.score)!;
    const previous = num(last?.feed_kg_per_day);
    const { feed, overridden } = feedSet({ scaleFeed: row.feed_kg_per_day, override: dto.feed_kg_per_day ?? null, previous });
    const record_id = randomUUID();
    await this.db.insert(schema.boarConditionRecord).values({
      record_id,
      tenant_id: tenantId,
      company_id: boar.company_id,
      boar_animal_id: boar.animal_id,
      assessed_on: assessedOn,
      score: row.score,
      score_name: row.score_name,
      required_action: row.required_action,
      health_flag: !!row.health_assessment_required,
      medication_review: !!row.medication_review,
      scale_feed_kg_per_day: row.feed_kg_per_day == null ? null : String(row.feed_kg_per_day),
      feed_kg_per_day: feed == null ? null : String(feed),
      previous_feed_kg_per_day: previous == null ? null : String(previous),
      override_reason: overridden ? (dto.override_reason?.trim() || null) : null,
      next_due: nextDueDate(assessedOn, setup?.bcs_frequency_days),
      notes: dto.notes?.trim() || null,
      created_by: user?.userId ?? null,
    });
    const [saved] = await this.db.select().from(schema.boarConditionRecord).where(eq(schema.boarConditionRecord.record_id, record_id)).limit(1);
    return { boar: boar.animal_code, ...this.shape(saved) };
  }
}
