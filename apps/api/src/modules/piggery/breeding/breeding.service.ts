import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { farmScope, animalScopeConditions } from '../../../common/farm-scope';
import {
  CreateMatingDto,
  UpdatePregCheckDto,
  CreateFarrowingDto,
  UpdateWeaningDto,
  CreateSemenCollectionDto,
  ConceptionResult,
} from './dto/breeding.dto';

function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class BreedingService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  // ==========================================
  // MATING & INSEMINATION
  // ==========================================

  async recordMating(dto: CreateMatingDto, tenantId: string, userPayload?: any) {
    // 1. Verify sow
    const [sow] = await this.db
      .select()
      .from(schema.animalRegister)
      .where(
        and(
          eq(schema.animalRegister.animal_id, dto.sow_animal_id),
          eq(schema.animalRegister.tenant_id, tenantId),
          ...animalScopeConditions(farmScope(this.cls)),
        )
      )
      .limit(1);

    if (!sow) {
      throw new NotFoundException(`Sow animal with ID '${dto.sow_animal_id}' not found.`);
    }

    // 2. If natural mating, verify boar
    if (dto.mating_type === 'NATURAL_MATING') {
      if (!dto.boar_animal_id) {
        throw new BadRequestException('boar_animal_id is required for NATURAL_MATING.');
      }
      const [boar] = await this.db
        .select()
        .from(schema.animalRegister)
        .where(
          and(
            eq(schema.animalRegister.animal_id, dto.boar_animal_id),
            eq(schema.animalRegister.tenant_id, tenantId),
            ...animalScopeConditions(farmScope(this.cls)),
          )
        )
        .limit(1);
      if (!boar) {
        throw new NotFoundException(`Boar animal with ID '${dto.boar_animal_id}' not found.`);
      }
    }

    // Swine standard gestation: 114 days (3 months, 3 weeks, 3 days)
    const expectedFarrowingDate = dto.expected_farrowing_date || addDaysToDate(dto.mating_date, 114);
    // Standard ultrasound check: 28 days post-mating
    const pregCheckDate = dto.preg_check_date || addDaysToDate(dto.mating_date, 28);
    const parityNumber = dto.parity_number ?? (sow.parity_count + 1);

    const breedingId = randomUUID();
    const newRecord = {
      breeding_id: breedingId,
      tenant_id: tenantId,
      company_id: dto.company_id || sow.company_id || null,
      sow_animal_id: dto.sow_animal_id,
      batch_id: dto.batch_id || sow.current_batch_id || null,
      mating_type: dto.mating_type,
      boar_animal_id: dto.boar_animal_id || null,
      semen_lot_id: dto.semen_lot_id || null,
      semen_dose_qty: dto.semen_dose_qty ? String(dto.semen_dose_qty) : '1.00',
      mating_date: dto.mating_date,
      second_mating_date: dto.second_mating_date || null,
      expected_farrowing_date: expectedFarrowingDate,
      preg_check_date: pregCheckDate,
      preg_check_method: dto.preg_check_method || 'ULTRASOUND',
      pregnancy_confirmed: null,
      conception_result: ConceptionResult.PENDING,
      parity_number: parityNumber,
      notes: dto.notes || null,
      created_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.breedingRecord).values(newRecord);

    return {
      ...newRecord,
      message: 'Mating event recorded successfully with auto-scheduled farrowing and pregnancy check dates.',
    };
  }

  async recordPregnancyCheck(breedingId: string, dto: UpdatePregCheckDto, tenantId: string, userPayload?: any) {
    const [breeding] = await this.db
      .select()
      .from(schema.breedingRecord)
      .where(
        and(
          eq(schema.breedingRecord.breeding_id, breedingId),
          eq(schema.breedingRecord.tenant_id, tenantId)
        )
      )
      .limit(1);

    if (!breeding) {
      throw new NotFoundException(`Breeding record with ID '${breedingId}' not found.`);
    }

    // The breeding row is looked up by its own id, not the sow's, so the farm
    // check has to follow the sow_animal_id it carries — answering the same
    // not-found message keeps another farm's breeding id indistinguishable
    // from one that never existed.
    const [scopedSow] = await this.db
      .select({ animal_id: schema.animalRegister.animal_id })
      .from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, breeding.sow_animal_id), ...animalScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!scopedSow) {
      throw new NotFoundException(`Breeding record with ID '${breedingId}' not found.`);
    }

    const conceptionResult = dto.conception_result || (dto.pregnancy_confirmed ? ConceptionResult.CONFIRMED : ConceptionResult.FAILED);

    await this.db
      .update(schema.breedingRecord)
      .set({
        pregnancy_confirmed: dto.pregnancy_confirmed,
        conception_result: conceptionResult,
        preg_check_date: dto.preg_check_date || breeding.preg_check_date,
        preg_check_method: dto.preg_check_method || breeding.preg_check_method,
        notes: dto.notes || breeding.notes,
      })
      .where(eq(schema.breedingRecord.breeding_id, breedingId));

    // Update sow status based on confirmation
    if (dto.pregnancy_confirmed) {
      await this.db
        .update(schema.animalRegister)
        .set({ status: 'PREGNANT' })
        .where(eq(schema.animalRegister.animal_id, breeding.sow_animal_id));
    } else if (conceptionResult === ConceptionResult.FAILED) {
      await this.db
        .update(schema.animalRegister)
        .set({ status: 'ACTIVE' })
        .where(eq(schema.animalRegister.animal_id, breeding.sow_animal_id));
    }

    return {
      breeding_id: breedingId,
      pregnancy_confirmed: dto.pregnancy_confirmed,
      conception_result: conceptionResult,
      message: `Pregnancy check recorded (${conceptionResult}). Sow status updated.`,
    };
  }

  async getMatingRecords(tenantId: string, companyId?: string) {
    const scope = farmScope(this.cls);
    const conditions = [eq(schema.breedingRecord.tenant_id, tenantId)];
    if (companyId) {
      conditions.push(eq(schema.breedingRecord.company_id, companyId));
    }
    conditions.push(...animalScopeConditions(scope));

    const records = await this.db
      .select({
        breeding_id: schema.breedingRecord.breeding_id,
        mating_type: schema.breedingRecord.mating_type,
        mating_date: schema.breedingRecord.mating_date,
        second_mating_date: schema.breedingRecord.second_mating_date,
        expected_farrowing_date: schema.breedingRecord.expected_farrowing_date,
        preg_check_date: schema.breedingRecord.preg_check_date,
        preg_check_method: schema.breedingRecord.preg_check_method,
        pregnancy_confirmed: schema.breedingRecord.pregnancy_confirmed,
        conception_result: schema.breedingRecord.conception_result,
        parity_number: schema.breedingRecord.parity_number,
        semen_dose_qty: schema.breedingRecord.semen_dose_qty,
        notes: schema.breedingRecord.notes,
        created_at: schema.breedingRecord.created_at,
        sow_id: schema.breedingRecord.sow_animal_id,
        sow_code: schema.animalRegister.animal_code,
        sow_tag: schema.animalRegister.ear_tag,
        sow_status: schema.animalRegister.status,
      })
      .from(schema.breedingRecord)
      .innerJoin(schema.animalRegister, eq(schema.breedingRecord.sow_animal_id, schema.animalRegister.animal_id))
      .where(and(...conditions))
      .orderBy(desc(schema.breedingRecord.mating_date));

    // Calculate days remaining to farrowing
    const today = new Date();
    return records.map((r) => {
      const farrowDate = new Date(r.expected_farrowing_date);
      const daysUntilFarrowing = Math.ceil((farrowDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return {
        ...r,
        days_until_farrowing: daysUntilFarrowing,
      };
    });
  }

  // ==========================================
  // FARROWING & LITTERS
  // ==========================================

  async recordFarrowing(dto: CreateFarrowingDto, tenantId: string, userPayload?: any) {
    const [sow] = await this.db
      .select()
      .from(schema.animalRegister)
      .where(
        and(
          eq(schema.animalRegister.animal_id, dto.sow_animal_id),
          eq(schema.animalRegister.tenant_id, tenantId),
          ...animalScopeConditions(farmScope(this.cls)),
        )
      )
      .limit(1);

    if (!sow) {
      throw new NotFoundException(`Sow animal with ID '${dto.sow_animal_id}' not found.`);
    }

    const stillborn = dto.piglets_stillborn || 0;
    const mummified = dto.piglets_mummified || 0;
    const live = dto.piglets_born_live;
    const totalBorn = live + stillborn + mummified;

    let totalLitterWeight = dto.total_litter_weight_kg;
    if (totalLitterWeight === undefined && dto.avg_birth_weight_kg && live > 0) {
      totalLitterWeight = Number((dto.avg_birth_weight_kg * live).toFixed(3));
    }

    const plannedWeaningDate = addDaysToDate(dto.farrowing_date, 28);
    const parityNumber = sow.parity_count + 1;
    const farrowId = randomUUID();

    const newRecord = {
      farrow_id: farrowId,
      tenant_id: tenantId,
      company_id: dto.company_id || sow.company_id || null,
      sow_animal_id: dto.sow_animal_id,
      breeding_id: dto.breeding_id || null,
      batch_id: dto.batch_id || sow.current_batch_id || null,
      farrowing_date: dto.farrowing_date,
      piglets_born_total: totalBorn,
      piglets_born_live: live,
      piglets_stillborn: stillborn,
      piglets_mummified: mummified,
      avg_birth_weight_kg: dto.avg_birth_weight_kg ? String(dto.avg_birth_weight_kg) : null,
      total_litter_weight_kg: totalLitterWeight !== undefined ? String(totalLitterWeight) : null,
      farrowing_status: dto.farrowing_status || 'NORMAL',
      foster_received: dto.foster_received || 0,
      fostered_out: dto.fostered_out || 0,
      weaning_date: plannedWeaningDate,
      piglets_weaned: 0,
      avg_weaning_weight_kg: null,
      cost_per_piglet: null,
      parity_number: parityNumber,
      notes: dto.notes || null,
      created_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.farrowingRecord).values(newRecord);

    // Update sow lifetime statistics and status
    await this.db
      .update(schema.animalRegister)
      .set({
        parity_count: parityNumber,
        total_piglets_born_live: (sow.total_piglets_born_live || 0) + live,
        status: 'LACTATING',
      })
      .where(eq(schema.animalRegister.animal_id, dto.sow_animal_id));

    return {
      ...newRecord,
      message: `Farrowing recorded: ${live} live piglets born. Sow parity incremented to ${parityNumber} and status set to LACTATING.`,
    };
  }

  async recordWeaning(farrowId: string, dto: UpdateWeaningDto, tenantId: string, userPayload?: any) {
    const [farrow] = await this.db
      .select()
      .from(schema.farrowingRecord)
      .where(
        and(
          eq(schema.farrowingRecord.farrow_id, farrowId),
          eq(schema.farrowingRecord.tenant_id, tenantId)
        )
      )
      .limit(1);

    if (!farrow) {
      throw new NotFoundException(`Farrowing record with ID '${farrowId}' not found.`);
    }

    // Looked up by the farrowing record's own id, not the sow's — see the same
    // note in recordPregnancyCheck.
    const [sow] = await this.db
      .select()
      .from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, farrow.sow_animal_id), ...animalScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!sow) {
      throw new NotFoundException(`Farrowing record with ID '${farrowId}' not found.`);
    }

    await this.db
      .update(schema.farrowingRecord)
      .set({
        weaning_date: dto.weaning_date,
        piglets_weaned: dto.piglets_weaned,
        avg_weaning_weight_kg: dto.avg_weaning_weight_kg ? String(dto.avg_weaning_weight_kg) : null,
        cost_per_piglet: dto.cost_per_piglet ? String(dto.cost_per_piglet) : null,
        notes: dto.notes || farrow.notes,
      })
      .where(eq(schema.farrowingRecord.farrow_id, farrowId));

    await this.db
      .update(schema.animalRegister)
      .set({
        total_piglets_weaned: (sow.total_piglets_weaned || 0) + dto.piglets_weaned,
        status: 'ACTIVE',
      })
      .where(eq(schema.animalRegister.animal_id, sow.animal_id));

    return {
      farrow_id: farrowId,
      piglets_weaned: dto.piglets_weaned,
      message: `Weaning recorded: ${dto.piglets_weaned} piglets weaned. Sow returned to ACTIVE status.`,
    };
  }

  async getFarrowingRecords(tenantId: string, companyId?: string) {
    const scope = farmScope(this.cls);
    const conditions = [eq(schema.farrowingRecord.tenant_id, tenantId)];
    if (companyId) {
      conditions.push(eq(schema.farrowingRecord.company_id, companyId));
    }
    conditions.push(...animalScopeConditions(scope));

    const records = await this.db
      .select({
        farrow_id: schema.farrowingRecord.farrow_id,
        farrowing_date: schema.farrowingRecord.farrowing_date,
        piglets_born_total: schema.farrowingRecord.piglets_born_total,
        piglets_born_live: schema.farrowingRecord.piglets_born_live,
        piglets_stillborn: schema.farrowingRecord.piglets_stillborn,
        piglets_mummified: schema.farrowingRecord.piglets_mummified,
        avg_birth_weight_kg: schema.farrowingRecord.avg_birth_weight_kg,
        total_litter_weight_kg: schema.farrowingRecord.total_litter_weight_kg,
        farrowing_status: schema.farrowingRecord.farrowing_status,
        foster_received: schema.farrowingRecord.foster_received,
        fostered_out: schema.farrowingRecord.fostered_out,
        weaning_date: schema.farrowingRecord.weaning_date,
        piglets_weaned: schema.farrowingRecord.piglets_weaned,
        avg_weaning_weight_kg: schema.farrowingRecord.avg_weaning_weight_kg,
        cost_per_piglet: schema.farrowingRecord.cost_per_piglet,
        parity_number: schema.farrowingRecord.parity_number,
        notes: schema.farrowingRecord.notes,
        created_at: schema.farrowingRecord.created_at,
        sow_id: schema.farrowingRecord.sow_animal_id,
        sow_code: schema.animalRegister.animal_code,
        sow_tag: schema.animalRegister.ear_tag,
      })
      .from(schema.farrowingRecord)
      .innerJoin(schema.animalRegister, eq(schema.farrowingRecord.sow_animal_id, schema.animalRegister.animal_id))
      .where(and(...conditions))
      .orderBy(desc(schema.farrowingRecord.farrowing_date));

    return records.map((r) => {
      const netLitter = r.piglets_born_live + r.foster_received - r.fostered_out;
      const survivalRatePct = r.piglets_weaned > 0 && netLitter > 0 ? Number(((r.piglets_weaned / netLitter) * 100).toFixed(1)) : null;
      return {
        ...r,
        net_litter_size: netLitter,
        weaning_survival_rate_pct: survivalRatePct,
      };
    });
  }

  // ==========================================
  // BOAR SEMEN COLLECTION & AI STATION
  // ==========================================

  async recordSemenCollection(dto: CreateSemenCollectionDto, tenantId: string, userPayload?: any) {
    const [boar] = await this.db
      .select()
      .from(schema.animalRegister)
      .where(
        and(
          eq(schema.animalRegister.animal_id, dto.boar_animal_id),
          eq(schema.animalRegister.tenant_id, tenantId),
          ...animalScopeConditions(farmScope(this.cls)),
        )
      )
      .limit(1);

    if (!boar) {
      throw new NotFoundException(`Boar animal with ID '${dto.boar_animal_id}' not found.`);
    }

    const amort = dto.amortisation_period || 0;
    const feed = dto.feed_cost_period || 0;
    const drug = dto.drug_cost_period || 0;
    const overhead = dto.overhead_cost_period || 0;
    const runningCost = amort + feed + drug + overhead;
    const unitCostPerDose = dto.doses_collected > 0 ? runningCost / dto.doses_collected : 0;

    const semenBatchId = randomUUID();
    const newRecord = {
      semen_batch_id: semenBatchId,
      tenant_id: tenantId,
      company_id: dto.company_id || boar.company_id || null,
      boar_animal_id: dto.boar_animal_id,
      boar_batch_id: dto.boar_batch_id || boar.current_batch_id || null,
      collection_date: dto.collection_date,
      period_from: dto.period_from || null,
      period_to: dto.period_to || null,
      amortisation_period: String(amort.toFixed(4)),
      feed_cost_period: String(feed.toFixed(4)),
      drug_cost_period: String(drug.toFixed(4)),
      overhead_cost_period: String(overhead.toFixed(4)),
      running_cost_period: String(runningCost.toFixed(4)),
      doses_collected: String(dto.doses_collected),
      unit_cost_per_dose: String(unitCostPerDose.toFixed(6)),
      doses_used_internal: String(dto.doses_used_internal || 0),
      doses_sold: String(dto.doses_sold || 0),
      output_item_id: dto.output_item_id || null,
      inventory_posted: false,
      notes: dto.notes || null,
      created_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.semenBatch).values(newRecord);

    return {
      ...newRecord,
      message: `Semen collection logged: ${dto.doses_collected} doses collected at computed unit cost of ${unitCostPerDose.toFixed(4)}/dose.`,
    };
  }

  async getSemenBatches(tenantId: string, companyId?: string) {
    const scope = farmScope(this.cls);
    const conditions = [eq(schema.semenBatch.tenant_id, tenantId)];
    if (companyId) {
      conditions.push(eq(schema.semenBatch.company_id, companyId));
    }
    conditions.push(...animalScopeConditions(scope));

    return await this.db
      .select({
        semen_batch_id: schema.semenBatch.semen_batch_id,
        collection_date: schema.semenBatch.collection_date,
        period_from: schema.semenBatch.period_from,
        period_to: schema.semenBatch.period_to,
        running_cost_period: schema.semenBatch.running_cost_period,
        doses_collected: schema.semenBatch.doses_collected,
        unit_cost_per_dose: schema.semenBatch.unit_cost_per_dose,
        doses_used_internal: schema.semenBatch.doses_used_internal,
        doses_sold: schema.semenBatch.doses_sold,
        inventory_posted: schema.semenBatch.inventory_posted,
        notes: schema.semenBatch.notes,
        created_at: schema.semenBatch.created_at,
        boar_id: schema.semenBatch.boar_animal_id,
        boar_code: schema.animalRegister.animal_code,
        boar_tag: schema.animalRegister.ear_tag,
      })
      .from(schema.semenBatch)
      .innerJoin(schema.animalRegister, eq(schema.semenBatch.boar_animal_id, schema.animalRegister.animal_id))
      .where(and(...conditions))
      .orderBy(desc(schema.semenBatch.collection_date));
  }
}
