import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, desc, isNull, lt, sql, aliasedTable } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { farmScope, animalScopeConditions, batchScopeConditions, farmOfLocation } from '../../../common/farm-scope';
import {
  CreateMatingDto,
  UpdatePregCheckDto,
  CreateFarrowingDto,
  UpdateWeaningDto,
  CreateSemenCollectionDto,
  ConceptionResult,
  MatingType,
  MatingDefaultsQueryDto,
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

  /**
   * A breeding document belongs to its animal's company. The body's company_id
   * was stamped as sent, so a caller could file a Grasmere sow's mating under
   * another company. It may still be sent, but only to agree with the animal.
   */
  private assertAnimalCompany(bodyCompanyId: string | undefined, animal: { company_id: string | null }, label: string): string {
    if (bodyCompanyId && bodyCompanyId !== animal.company_id) {
      throw new BadRequestException(`The ${label} does not belong to the request company.`);
    }
    return animal.company_id!;
  }

  /**
   * A batch named in the body must be one the caller can see and must sit in
   * the animal's company. Out of scope answers the same not-found as missing,
   * so the id cannot be used to probe other farms.
   */
  private async assertScopedBatch(batchId: string | undefined, companyId: string, tenantId: string): Promise<void> {
    if (!batchId) return;
    const [batch] = await this.db
      .select({ batch_id: schema.batchHeader.batch_id })
      .from(schema.batchHeader)
      .where(and(
        eq(schema.batchHeader.batch_id, batchId),
        eq(schema.batchHeader.tenant_id, tenantId),
        eq(schema.batchHeader.company_id, companyId),
        isNull(schema.batchHeader.deleted_at),
        ...batchScopeConditions(farmScope(this.cls)),
      ))
      .limit(1);
    if (!batch) throw new NotFoundException(`Batch with ID '${batchId}' not found.`);
  }

  // ==========================================
  // MATING & INSEMINATION
  // ==========================================

  /**
   * The farm the sow stands on: her pen's farm, or her batch's when she has no
   * pen. Null when neither says — the request's own farm scope is then the only
   * boundary, which assertScopedBatch already applies.
   */
  private async farmOfAnimal(animal: { current_location_id: string | null; current_batch_id: string | null }): Promise<string | null> {
    if (animal.current_location_id) {
      const farm = await farmOfLocation(this.db, animal.current_location_id);
      if (farm) return farm;
    }
    if (animal.current_batch_id) {
      const [batch] = await this.db
        .select({ farm_id: schema.batchHeader.farm_id })
        .from(schema.batchHeader)
        .where(eq(schema.batchHeader.batch_id, animal.current_batch_id))
        .limit(1);
      return batch?.farm_id ?? null;
    }
    return null;
  }

  /**
   * A service happens in a batch on the sow's farm (15 Sep correction 6). A
   * batch the caller can see on another of the company's farms would file the
   * service, and later its litter, under the wrong farm.
   */
  private async assertBatchOnSowFarm(batchId: string, sow: typeof schema.animalRegister.$inferSelect, tenantId: string): Promise<void> {
    await this.assertScopedBatch(batchId, sow.company_id, tenantId);
    const sowFarm = await this.farmOfAnimal(sow);
    if (!sowFarm) return;
    const [batch] = await this.db
      .select({ farm_id: schema.batchHeader.farm_id, batch_no: schema.batchHeader.batch_no })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, batchId))
      .limit(1);
    if (batch && batch.farm_id !== sowFarm) {
      throw new BadRequestException(`Batch '${batch.batch_no}' is not on the sow's farm.`);
    }
  }

  private async findScopedAnimal(animalId: string, tenantId: string) {
    const [animal] = await this.db
      .select()
      .from(schema.animalRegister)
      .where(and(
        eq(schema.animalRegister.animal_id, animalId),
        eq(schema.animalRegister.tenant_id, tenantId),
        ...animalScopeConditions(farmScope(this.cls)),
      ))
      .limit(1);
    return animal;
  }

  /** The boar behind an AI dose is the boar its semen lot was collected from. */
  private async boarOfSemenLot(semenLotId: string, companyId: string, tenantId: string): Promise<string> {
    // semen_batch has no farm of its own; it reaches one through its boar.
    const [lot] = await this.db
      .select({ boar_animal_id: schema.semenBatch.boar_animal_id })
      .from(schema.semenBatch)
      .innerJoin(schema.animalRegister, eq(schema.semenBatch.boar_animal_id, schema.animalRegister.animal_id))
      .where(and(
        eq(schema.semenBatch.semen_batch_id, semenLotId),
        eq(schema.semenBatch.tenant_id, tenantId),
        eq(schema.semenBatch.company_id, companyId),
        ...animalScopeConditions(farmScope(this.cls)),
      ))
      .limit(1);
    if (!lot) throw new NotFoundException(`Semen lot with ID '${semenLotId}' not found.`);
    return lot.boar_animal_id;
  }

  /**
   * What the service form prefills, computed once here so the form and the
   * write cannot disagree:
   * - expected farrowing: mating date + the sow's breed gestation_days (BBP
   *   §1.7, TDD row 52), 116 only when the breed row carries none;
   * - pregnancy check: mating date + 28;
   * - sow parity: her completed parities + 1, the litter this service is for;
   * - boar parity: his services recorded before this mating date + 1, counted
   *   the same way so the two numbers read alike. Null with no known boar.
   */
  private async matingDefaults(
    sow: typeof schema.animalRegister.$inferSelect,
    boarAnimalId: string | null,
    matingDate: string,
    tenantId: string,
  ) {
    let gestationDays = 116;
    if (sow.breed_id) {
      const [breed] = await this.db
        .select({ gestation_days: schema.breedMaster.gestation_days })
        .from(schema.breedMaster)
        .where(eq(schema.breedMaster.breed_id, sow.breed_id))
        .limit(1);
      if (breed?.gestation_days != null) gestationDays = breed.gestation_days;
    }

    let boarParityNumber: number | null = null;
    if (boarAnimalId) {
      const [prior] = await this.db
        .select({ services: sql<number>`COUNT(*)` })
        .from(schema.breedingRecord)
        .where(and(
          eq(schema.breedingRecord.tenant_id, tenantId),
          eq(schema.breedingRecord.boar_animal_id, boarAnimalId),
          lt(schema.breedingRecord.mating_date, matingDate),
        ));
      boarParityNumber = Number(prior?.services ?? 0) + 1;
    }

    return {
      gestation_days: gestationDays,
      expected_farrowing_date: addDaysToDate(matingDate, gestationDays),
      preg_check_date: addDaysToDate(matingDate, 28),
      parity_number: (sow.parity_count || 0) + 1,
      boar_parity_number: boarParityNumber,
      batch_id: sow.current_batch_id || null,
    };
  }

  /**
   * conception_result is the field of record; pregnancy_confirmed is its
   * boolean shadow, kept because the KPI and older screens read it:
   * CONFIRMED → true, FAILED/REPEAT → false, PENDING → null.
   */
  private pregnancyConfirmedFor(result: ConceptionResult): boolean | null {
    if (result === ConceptionResult.CONFIRMED) return true;
    if (result === ConceptionResult.PENDING) return null;
    return false;
  }

  private async resolveSowAndBoar(
    dto: { sow_animal_id: string; boar_animal_id?: string; semen_lot_id?: string; mating_type?: MatingType; company_id?: string },
    tenantId: string,
  ) {
    const sow = await this.findScopedAnimal(dto.sow_animal_id, tenantId);
    if (!sow) {
      throw new NotFoundException(`Sow animal with ID '${dto.sow_animal_id}' not found.`);
    }
    if (sow.gender !== 'F') {
      throw new BadRequestException(`Animal '${sow.animal_code}' is not female and cannot be served as a sow.`);
    }
    const companyId = this.assertAnimalCompany(dto.company_id, sow, 'sow');

    if (dto.mating_type === MatingType.NATURAL_MATING && !dto.boar_animal_id) {
      throw new BadRequestException('boar_animal_id is required for NATURAL_MATING.');
    }

    let boarAnimalId = dto.boar_animal_id || null;
    if (dto.semen_lot_id) {
      const lotBoar = await this.boarOfSemenLot(dto.semen_lot_id, companyId, tenantId);
      if (boarAnimalId && boarAnimalId !== lotBoar) {
        throw new BadRequestException('The semen lot was not collected from the selected boar.');
      }
      boarAnimalId = lotBoar;
    }

    // Verified whenever one is named, AI included — an unverified boar id used
    // to be stored as sent on an AI service.
    if (boarAnimalId) {
      const boar = await this.findScopedAnimal(boarAnimalId, tenantId);
      if (!boar || boar.company_id !== sow.company_id) {
        throw new NotFoundException(`Boar animal with ID '${boarAnimalId}' not found.`);
      }
      if (boar.gender !== 'M') {
        throw new BadRequestException(`Animal '${boar.animal_code}' is not male and cannot be the boar on a service.`);
      }
    }

    return { sow, companyId, boarAnimalId };
  }

  async getMatingDefaults(query: MatingDefaultsQueryDto, tenantId: string) {
    const { sow, boarAnimalId } = await this.resolveSowAndBoar(query, tenantId);
    return this.matingDefaults(sow, boarAnimalId, query.mating_date, tenantId);
  }

  async recordMating(dto: CreateMatingDto, tenantId: string, userPayload?: any) {
    const { sow, companyId, boarAnimalId } = await this.resolveSowAndBoar(dto, tenantId);
    if (dto.batch_id) await this.assertBatchOnSowFarm(dto.batch_id, sow, tenantId);

    const defaults = await this.matingDefaults(sow, boarAnimalId, dto.mating_date, tenantId);
    // Every default is editable on the form, so a sent value wins — but a
    // farrowing due before the service, or a check before it, is a typo.
    const expectedFarrowingDate = dto.expected_farrowing_date || defaults.expected_farrowing_date;
    const pregCheckDate = dto.preg_check_date || defaults.preg_check_date;
    if (expectedFarrowingDate <= dto.mating_date) {
      throw new BadRequestException('Expected farrowing date must be after the mating date.');
    }
    if (pregCheckDate < dto.mating_date) {
      throw new BadRequestException('Pregnancy check date cannot be before the mating date.');
    }
    const conceptionResult = dto.conception_result ?? ConceptionResult.PENDING;

    const breedingId = randomUUID();
    const newRecord = {
      breeding_id: breedingId,
      tenant_id: tenantId,
      company_id: companyId,
      sow_animal_id: dto.sow_animal_id,
      batch_id: dto.batch_id || defaults.batch_id,
      mating_type: dto.mating_type,
      boar_animal_id: boarAnimalId,
      semen_lot_id: dto.semen_lot_id || null,
      semen_dose_qty: dto.semen_dose_qty ? String(dto.semen_dose_qty) : '1.00',
      mating_date: dto.mating_date,
      second_mating_date: dto.second_mating_date || null,
      expected_farrowing_date: expectedFarrowingDate,
      preg_check_date: pregCheckDate,
      preg_check_method: dto.preg_check_method || 'ULTRASOUND',
      pregnancy_confirmed: this.pregnancyConfirmedFor(conceptionResult),
      conception_result: conceptionResult,
      parity_number: dto.parity_number ?? defaults.parity_number,
      boar_parity_number: boarAnimalId ? (dto.boar_parity_number ?? defaults.boar_parity_number) : null,
      notes: dto.notes || null,
      created_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.breedingRecord).values(newRecord);
    if (conceptionResult === ConceptionResult.CONFIRMED) {
      await this.db
        .update(schema.animalRegister)
        .set({ status: 'PREGNANT' })
        .where(eq(schema.animalRegister.animal_id, dto.sow_animal_id));
    }

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
      .select({ animal_id: schema.animalRegister.animal_id, status: schema.animalRegister.status })
      .from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, breeding.sow_animal_id), ...animalScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!scopedSow) {
      throw new NotFoundException(`Breeding record with ID '${breedingId}' not found.`);
    }

    // The result may be sent alone (CONFIRMED / REPEAT / FAILED / PENDING) or,
    // from an older client, as the boolean alone. Both at once must agree.
    let conceptionResult: ConceptionResult;
    if (dto.conception_result) {
      conceptionResult = dto.conception_result;
      if (dto.pregnancy_confirmed !== undefined && dto.pregnancy_confirmed !== this.pregnancyConfirmedFor(conceptionResult)) {
        throw new BadRequestException(`pregnancy_confirmed contradicts conception_result ${conceptionResult}.`);
      }
    } else if (dto.pregnancy_confirmed !== undefined) {
      conceptionResult = dto.pregnancy_confirmed ? ConceptionResult.CONFIRMED : ConceptionResult.FAILED;
    } else {
      throw new BadRequestException('conception_result is required.');
    }
    const pregnancyConfirmed = this.pregnancyConfirmedFor(conceptionResult);
    if (dto.preg_check_date && dto.preg_check_date < breeding.mating_date) {
      throw new BadRequestException('Pregnancy check date cannot be before the mating date.');
    }

    await this.db
      .update(schema.breedingRecord)
      .set({
        pregnancy_confirmed: pregnancyConfirmed,
        conception_result: conceptionResult,
        preg_check_date: dto.preg_check_date || breeding.preg_check_date,
        preg_check_method: dto.preg_check_method || breeding.preg_check_method,
        notes: dto.notes || breeding.notes,
      })
      .where(eq(schema.breedingRecord.breeding_id, breedingId));

    // Sow status follows the result. A result that is not CONFIRMED returns her
    // to ACTIVE only from PREGNANT: correcting an old service must not pull a
    // lactating sow out of LACTATING.
    if (conceptionResult === ConceptionResult.CONFIRMED) {
      await this.db
        .update(schema.animalRegister)
        .set({ status: 'PREGNANT' })
        .where(eq(schema.animalRegister.animal_id, breeding.sow_animal_id));
    } else if (scopedSow.status === 'PREGNANT') {
      await this.db
        .update(schema.animalRegister)
        .set({ status: 'ACTIVE' })
        .where(eq(schema.animalRegister.animal_id, breeding.sow_animal_id));
    }

    return {
      breeding_id: breedingId,
      pregnancy_confirmed: pregnancyConfirmed,
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

    // The boar and the batch are named on the list, so a service can be read
    // without opening it; left joins because AI services may carry neither.
    const boar = aliasedTable(schema.animalRegister, 'boar');
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
        boar_parity_number: schema.breedingRecord.boar_parity_number,
        semen_dose_qty: schema.breedingRecord.semen_dose_qty,
        semen_lot_id: schema.breedingRecord.semen_lot_id,
        notes: schema.breedingRecord.notes,
        created_at: schema.breedingRecord.created_at,
        sow_id: schema.breedingRecord.sow_animal_id,
        sow_code: schema.animalRegister.animal_code,
        sow_tag: schema.animalRegister.ear_tag,
        sow_status: schema.animalRegister.status,
        boar_id: schema.breedingRecord.boar_animal_id,
        boar_code: boar.animal_code,
        batch_id: schema.breedingRecord.batch_id,
        batch_no: schema.batchHeader.batch_no,
      })
      .from(schema.breedingRecord)
      .innerJoin(schema.animalRegister, eq(schema.breedingRecord.sow_animal_id, schema.animalRegister.animal_id))
      .leftJoin(boar, eq(boar.animal_id, schema.breedingRecord.boar_animal_id))
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.breedingRecord.batch_id))
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

    const companyId = this.assertAnimalCompany(dto.company_id, sow, 'sow');
    await this.assertScopedBatch(dto.batch_id, companyId, tenantId);
    if (dto.breeding_id) {
      // The breeding row carries no farm; it is in scope only as this sow's own mating.
      const [breeding] = await this.db
        .select({ breeding_id: schema.breedingRecord.breeding_id })
        .from(schema.breedingRecord)
        .where(and(
          eq(schema.breedingRecord.breeding_id, dto.breeding_id),
          eq(schema.breedingRecord.tenant_id, tenantId),
          eq(schema.breedingRecord.sow_animal_id, dto.sow_animal_id),
        ))
        .limit(1);
      if (!breeding) throw new NotFoundException(`Breeding record with ID '${dto.breeding_id}' not found.`);
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
      company_id: companyId,
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

    // Update sow lifetime statistics and status — a GILT (never farrowed)
    // becomes a SOW on her first farrowing, in the same write, so a second
    // farrowing recorded against her doesn't still read her as a GILT.
    await this.db
      .update(schema.animalRegister)
      .set({
        parity_count: parityNumber,
        total_piglets_born_live: (sow.total_piglets_born_live || 0) + live,
        status: 'LACTATING',
        ...(sow.animal_type === 'GILT' ? { animal_type: 'SOW' } : {}),
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

    const companyId = this.assertAnimalCompany(dto.company_id, boar, 'boar');
    await this.assertScopedBatch(dto.boar_batch_id, companyId, tenantId);

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
      company_id: companyId,
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
