import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, desc, inArray, isNull, lt, sql, aliasedTable } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { PigletLotService } from '../../production/batch/piglet-lot.service';
import { BatchService } from '../../production/batch/batch.service';
import { BatchTransferService } from '../../production/batch/batch-transfer.service';
import { SemenLotService } from './semen-lot.service';
import { AnimalService } from '../animal/animal.service';
import { dayAfter, periodCostsOf, type PeriodCosts, type PostedCost } from './semen-cost';
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

/** The stage a sow goes to when her litter is weaned (Stage Master seed code). */
const DRY_SOW_STAGE = 'DRY_SOW';

function addDaysToDate(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class BreedingService {
  constructor(
    private readonly cls: ClsService,
    private readonly pigletLots: PigletLotService,
    private readonly batchService: BatchService,
    private readonly batchTransfers: BatchTransferService,
    private readonly semenLots: SemenLotService,
    private readonly animals: AnimalService,
  ) {}

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

  /**
   * Where a breeding event happens: an active, animal-wise batch the animal is in now. The batch is the one named, else
   * the animal's own (Data Entry names none — it posts from inside the batch). A breeding event files its cost, its
   * stock and its litter under that batch, so an animal standing in another batch, or in none, is refused.
   */
  private async assertAnimalInBatch(
    animal: typeof schema.animalRegister.$inferSelect,
    batchId: string | undefined,
    role: 'sow' | 'boar',
    tenantId: string,
  ): Promise<string> {
    const id = batchId || animal.current_batch_id;
    if (!id) {
      throw new BadRequestException(`${animal.animal_code} is not in a batch. Put the ${role} in an animal-wise batch first — breeding is recorded batch by batch.`);
    }
    await this.assertScopedBatch(id, animal.company_id, tenantId);
    const [batch] = await this.db
      .select({ batch_no: schema.batchHeader.batch_no, tracking_mode: schema.batchHeader.tracking_mode, status: schema.batchHeader.status })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, id))
      .limit(1);
    if (!batch) throw new NotFoundException(`Batch with ID '${id}' not found.`);
    if (batch.tracking_mode !== 'ANIMAL_WISE') {
      throw new BadRequestException(`Batch '${batch.batch_no}' is not animal-wise. Breeding is recorded for animals, so choose an animal-wise batch.`);
    }
    if (batch.status !== 'ACTIVE') {
      throw new BadRequestException(`Batch '${batch.batch_no}' is ${String(batch.status).toLowerCase()}, not active.`);
    }
    if (animal.current_batch_id !== id) {
      throw new BadRequestException(`${animal.animal_code} is not in batch '${batch.batch_no}'.`);
    }
    return id;
  }

  /** A breeding event is dated on or before today. One day of slack, so a farm ahead of UTC can record its own today. */
  private assertNotFuture(date: string, label: string): void {
    const limit = new Date();
    limit.setUTCDate(limit.getUTCDate() + 1);
    if (date > limit.toISOString().slice(0, 10)) {
      throw new BadRequestException(`${label} cannot be in the future.`);
    }
  }

  private assertLiveAnimal(animal: typeof schema.animalRegister.$inferSelect, kinds: string[], label: string): void {
    if (animal.is_active === false) {
      throw new BadRequestException(`${animal.animal_code} is no longer active and cannot be used as the ${label}.`);
    }
    if (animal.animal_type && !kinds.includes(animal.animal_type)) {
      throw new BadRequestException(`${animal.animal_code} is a ${animal.animal_type}, not a ${kinds.join(' or ')}, so it cannot be the ${label}.`);
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

  /**
   * The boar behind an AI dose is the boar its semen lot was collected from. A pooled lot has no single boar — its doses
   * are the mix of several — so the sire of a service from it is not known to be any one of them (null).
   */
  private async boarOfSemenLot(semenLotId: string, companyId: string, tenantId: string): Promise<{ boarId: string | null; poolBoarIds: string[] }> {
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
    const pool = await this.db
      .select({ boar_animal_id: schema.semenBatchBoar.boar_animal_id })
      .from(schema.semenBatchBoar)
      .where(eq(schema.semenBatchBoar.semen_batch_id, semenLotId));
    const poolBoarIds = pool.map((p) => p.boar_animal_id);
    return { boarId: poolBoarIds.length ? null : lot.boar_animal_id, poolBoarIds };
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
    this.assertLiveAnimal(sow, ['SOW', 'GILT'], 'sow');
    const companyId = this.assertAnimalCompany(dto.company_id, sow, 'sow');

    if (dto.mating_type === MatingType.NATURAL_MATING && !dto.boar_animal_id) {
      throw new BadRequestException('Select a boar for a natural mating.');
    }

    if (dto.semen_lot_id && dto.mating_type === MatingType.NATURAL_MATING) {
      throw new BadRequestException('A semen lot is used for an AI service, not a natural mating.');
    }

    let boarAnimalId = dto.boar_animal_id || null;
    if (dto.semen_lot_id) {
      const lot = await this.boarOfSemenLot(dto.semen_lot_id, companyId, tenantId);
      if (lot.poolBoarIds.length) {
        // A pooled lot: any boar named must be one of those mixed into it; none named leaves the sire unrecorded.
        if (boarAnimalId && !lot.poolBoarIds.includes(boarAnimalId)) {
          throw new BadRequestException('The selected boar is not one of the boars this pooled semen lot was mixed from.');
        }
      } else {
        if (boarAnimalId && boarAnimalId !== lot.boarId) {
          throw new BadRequestException('The semen lot was not collected from the selected boar.');
        }
        boarAnimalId = lot.boarId;
      }
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
      this.assertLiveAnimal(boar, ['BOAR'], 'boar');
    }

    return { sow, companyId, boarAnimalId };
  }

  /**
   * A sow is served when she is not already carrying or nursing a litter: no open service of hers (pending or confirmed
   * and not yet farrowed), not PREGNANT, and not LACTATING — a nursing sow is weaned first. Read from the records, not
   * the status alone, which can be set by hand.
   */
  private async assertSowCanBeServed(sow: typeof schema.animalRegister.$inferSelect, tenantId: string): Promise<void> {
    const farrowed = aliasedTable(schema.farrowingRecord, 'farrowed');
    const [open] = await this.db
      .select({ breeding_id: schema.breedingRecord.breeding_id, mating_date: schema.breedingRecord.mating_date })
      .from(schema.breedingRecord)
      .leftJoin(farrowed, eq(farrowed.breeding_id, schema.breedingRecord.breeding_id))
      .where(
        and(
          eq(schema.breedingRecord.tenant_id, tenantId),
          eq(schema.breedingRecord.sow_animal_id, sow.animal_id),
          isNull(farrowed.farrow_id),
          sql`COALESCE(${schema.breedingRecord.conception_result}, 'PENDING') IN ('PENDING', 'CONFIRMED')`,
        ),
      )
      .orderBy(desc(schema.breedingRecord.mating_date))
      .limit(1);
    if (open) {
      throw new BadRequestException(
        `${sow.animal_code} already has an open service (${String(open.mating_date).slice(0, 10)}) that has not farrowed. Record its pregnancy check as REPEAT or FAILED, or its farrowing, before a new service.`,
      );
    }
    if (sow.status === 'PREGNANT') {
      throw new BadRequestException(`${sow.animal_code} is PREGNANT. Correct her pregnancy check first if she is not.`);
    }
    if (sow.status === 'LACTATING') {
      throw new BadRequestException(`${sow.animal_code} is nursing a litter. Record its weaning before a new service.`);
    }
  }

  /** The semen lot a service draws from: collected on or before the service, not past its expiry. */
  private async assertLotUsable(lotId: string, matingDate: string, tenantId: string) {
    const [lot] = await this.db
      .select()
      .from(schema.semenBatch)
      .where(and(eq(schema.semenBatch.semen_batch_id, lotId), eq(schema.semenBatch.tenant_id, tenantId)))
      .limit(1);
    if (!lot) return null;
    const label = lot.lot_no ? ` ${lot.lot_no}` : '';
    if (lot.collection_date && String(lot.collection_date).slice(0, 10) > matingDate) {
      throw new BadRequestException(`The semen lot${label} was collected on ${String(lot.collection_date).slice(0, 10)}, after this mating.`);
    }
    if (lot.expiry_date && String(lot.expiry_date).slice(0, 10) < matingDate) {
      throw new BadRequestException(`The semen lot${label} expired on ${String(lot.expiry_date).slice(0, 10)}; it cannot be used for a mating on ${matingDate}.`);
    }
    return lot;
  }

  async getMatingDefaults(query: MatingDefaultsQueryDto, tenantId: string) {
    const { sow, boarAnimalId } = await this.resolveSowAndBoar(query, tenantId);
    return this.matingDefaults(sow, boarAnimalId, query.mating_date, tenantId);
  }

  async recordMating(dto: CreateMatingDto, tenantId: string, userPayload?: any) {
    // The service and the doses it used are one event: both recorded, or neither.
    return withTenantTransaction(this.cls, () => this.recordMatingInner(dto, tenantId, userPayload));
  }

  private async recordMatingInner(dto: CreateMatingDto, tenantId: string, userPayload?: any) {
    const { sow, companyId, boarAnimalId } = await this.resolveSowAndBoar(dto, tenantId);
    // The service is filed under the batch the sow stands in (the Breeding screen asks for it first; Data Entry is inside it).
    const batchId = await this.assertAnimalInBatch(sow, dto.batch_id, 'sow', tenantId);
    await this.assertBatchOnSowFarm(batchId, sow, tenantId);
    await this.assertSowCanBeServed(sow, tenantId);
    this.assertNotFuture(dto.mating_date, 'The mating date');
    if (dto.second_mating_date) {
      if (dto.second_mating_date < dto.mating_date) throw new BadRequestException('The second insemination cannot be before the first.');
      if (dto.second_mating_date > addDaysToDate(dto.mating_date, 7)) {
        throw new BadRequestException('The second insemination is within a week of the first — for a later service, record a new mating.');
      }
      this.assertNotFuture(dto.second_mating_date, 'The second insemination date');
    }
    const doseQty = dto.semen_dose_qty ?? 1;
    if (dto.mating_type === MatingType.AI && !Number.isInteger(doseQty)) {
      throw new BadRequestException('Doses used must be a whole number.');
    }
    const lot = dto.semen_lot_id ? await this.assertLotUsable(dto.semen_lot_id, dto.mating_date, tenantId) : null;

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
      batch_id: batchId,
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

    // An AI service that names a semen lot uses doses from it: refused if the lot has too few, and a lot held as stock
    // has them issued from that stock.
    if (lot) await this.semenLots.issueDoses(lot, Number(newRecord.semen_dose_qty), breedingId, dto.mating_date, tenantId, userPayload);

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
        throw new BadRequestException(`The pregnancy confirmation contradicts the conception result (${conceptionResult}).`);
      }
    } else if (dto.pregnancy_confirmed !== undefined) {
      conceptionResult = dto.pregnancy_confirmed ? ConceptionResult.CONFIRMED : ConceptionResult.FAILED;
    } else {
      throw new BadRequestException('Choose a conception result.');
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
    const farrowed = aliasedTable(schema.farrowingRecord, 'farrowed');
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
        sow_tag: schema.animalRegister.rfid_tag,
        sow_status: schema.animalRegister.status,
        boar_id: schema.breedingRecord.boar_animal_id,
        boar_code: boar.animal_code,
        batch_id: schema.breedingRecord.batch_id,
        batch_no: schema.batchHeader.batch_no,
        // The litter this service produced, when it has farrowed: a service that has is no longer open.
        farrow_id: farrowed.farrow_id,
      })
      .from(schema.breedingRecord)
      .innerJoin(schema.animalRegister, eq(schema.breedingRecord.sow_animal_id, schema.animalRegister.animal_id))
      .leftJoin(boar, eq(boar.animal_id, schema.breedingRecord.boar_animal_id))
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.breedingRecord.batch_id))
      .leftJoin(farrowed, eq(farrowed.breeding_id, schema.breedingRecord.breeding_id))
      .where(and(...conditions))
      .orderBy(desc(schema.breedingRecord.mating_date));

    // Calculate days remaining to farrowing.
    // The row type is written out rather than inferred: with the boar alias and
    // the batch join this select is past the depth Drizzle's inference handles
    // here, and it collapses to `never`. The shape below is the select above.
    type MatingRow = Record<string, unknown> & { expected_farrowing_date: string };
    const rows = records as unknown as MatingRow[];
    const today = new Date();
    return rows.map((r) => {
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
    // The litter and its piglet lot are one event: both are recorded, or neither.
    return withTenantTransaction(this.cls, () => this.recordFarrowingInner(dto, tenantId, userPayload));
  }

  private async recordFarrowingInner(dto: CreateFarrowingDto, tenantId: string, userPayload?: any) {
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

    this.assertLiveAnimal(sow, ['SOW', 'GILT'], 'sow');
    const companyId = this.assertAnimalCompany(dto.company_id, sow, 'sow');
    // The litter is filed under the batch the sow stands in (named on the Breeding screen; Data Entry is inside it).
    const batchId = await this.assertAnimalInBatch(sow, dto.batch_id, 'sow', tenantId);
    this.assertNotFuture(dto.farrowing_date, 'The farrowing date');
    // A litter comes from a mating (audit G9): the one named, else the sow's open mating — her latest service on or
    // before the farrowing, not failed and not already farrowed. With none, the farrowing is refused: the sire, and the
    // boar's own litters, come through the mating. The breeding row carries no farm; it is in scope only as this
    // sow's own mating.
    const breedingId = await this.matingOfLitter(dto, sow.animal_code, tenantId);
    const stillborn = dto.piglets_stillborn || 0;
    const mummified = dto.piglets_mummified || 0;
    const live = dto.piglets_born_live;
    const totalBorn = live + stillborn + mummified;
    if (!Number.isInteger(live) || !Number.isInteger(stillborn) || !Number.isInteger(mummified)) {
      throw new BadRequestException('Piglet counts must be whole numbers.');
    }
    if (totalBorn === 0) {
      throw new BadRequestException('A farrowing needs at least one piglet born — live, stillborn or mummified.');
    }
    const fosterIn = dto.foster_received || 0;
    const fosterOut = dto.fostered_out || 0;
    if (!Number.isInteger(fosterIn) || !Number.isInteger(fosterOut)) {
      throw new BadRequestException('Fostered piglet counts must be whole numbers.');
    }
    if (fosterOut > live + fosterIn) {
      throw new BadRequestException(`Fostered out (${fosterOut}) cannot be more than the piglets the sow has to give: ${live} born live plus ${fosterIn} received.`);
    }

    let totalLitterWeight = dto.total_litter_weight_kg;
    if (totalLitterWeight === undefined && dto.avg_birth_weight_kg && live > 0) {
      totalLitterWeight = Number((dto.avg_birth_weight_kg * live).toFixed(3));
    }

    // Parity counts completed pregnancies, post weaning (decisions.md, TDD row 27): this
    // litter is parity_count + 1, and parity_count itself only moves when it is weaned.
    // A farrowing numbered above parity_count has not been weaned, so a second one now
    // would be numbered the same. Read from the records rather than the sow's status,
    // which can be set by hand or by a seed without any farrowing behind it.
    const [nursing] = await this.db
      .select({ farrow_id: schema.farrowingRecord.farrow_id })
      .from(schema.farrowingRecord)
      .where(
        and(
          eq(schema.farrowingRecord.sow_animal_id, dto.sow_animal_id),
          eq(schema.farrowingRecord.tenant_id, tenantId),
          sql`${schema.farrowingRecord.parity_number} > ${sow.parity_count || 0}`,
        ),
      )
      .limit(1);
    if (nursing) {
      throw new BadRequestException(
        `Sow '${sow.animal_code}' has a litter that is not weaned yet. Record its weaning before a new farrowing.`,
      );
    }
    const plannedWeaningDate = addDaysToDate(dto.farrowing_date, 28);
    const parityNumber = sow.parity_count + 1;
    const farrowId = randomUUID();

    // The piglets, as a lot of the piglet bio-asset item in a batch-wise batch. Fostering moves piglets between
    // litters, so the lot is the litter as it stands: born live, plus received, less fostered out. A farrowing recorded
    // without a piglet item records the litter only.
    const netLitter = Math.max(0, live + (dto.foster_received || 0) - (dto.fostered_out || 0));
    const pigletLot =
      dto.piglet_item_id && netLitter > 0
        ? await this.pigletLots.createLot(
            { sow, farrowing_date: dto.farrowing_date, quantity: netLitter, item_id: dto.piglet_item_id, stage_id: dto.piglet_stage_id },
            tenantId,
            userPayload,
          )
        : null;

    const newRecord = {
      farrow_id: farrowId,
      tenant_id: tenantId,
      company_id: companyId,
      sow_animal_id: dto.sow_animal_id,
      breeding_id: breedingId,
      batch_id: batchId,
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
      piglet_batch_id: pigletLot?.batch_id ?? null,
      piglet_lot_no: pigletLot?.lot_no ?? null,
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
    // parity_count is deliberately not touched here; weaning completes the parity.
    await this.db
      .update(schema.animalRegister)
      .set({
        total_piglets_born_live: (sow.total_piglets_born_live || 0) + live,
        status: 'LACTATING',
        ...(sow.animal_type === 'GILT' ? { animal_type: 'SOW' } : {}),
      })
      .where(eq(schema.animalRegister.animal_id, dto.sow_animal_id));

    return {
      ...newRecord,
      piglet_batch_no: pigletLot?.batch_no ?? null,
      message:
        `Farrowing recorded: ${live} live piglets born (litter ${parityNumber}). Sow status set to LACTATING; parity completes at weaning.` +
        (pigletLot
          ? ` ${netLitter} piglets held as lot ${pigletLot.lot_no} in batch ${pigletLot.batch_no}.`
          : ' No piglet lot was created — choose the piglet item to hold them as a lot.'),
    };
  }

  async recordWeaning(farrowId: string, dto: UpdateWeaningDto, tenantId: string, userPayload?: any) {
    // The litter's weaning, the losses before it and the piglets' move are one event: all recorded, or none.
    return withTenantTransaction(this.cls, () => this.recordWeaningInner(farrowId, dto, tenantId, userPayload));
  }

  private async recordWeaningInner(farrowId: string, dto: UpdateWeaningDto, tenantId: string, userPayload?: any) {
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

    // The piglets. Anything the lot has lost since farrowing and not yet recorded is pre-weaning mortality; the head
    // that were weaned then go where they are sent — to another batch, or on to a stage — by the ordinary transfer.
    // Only the first weaning of a litter moves them, so posting it again cannot move the same piglets twice.
    let pigletNote = '';
    if (dto.move_to_batch_id && dto.move_to_stage_code) {
      throw new BadRequestException('Send the weaned piglets to a batch or on to a stage, not both.');
    }
    if (farrow.piglet_batch_id && (farrow.piglets_weaned || 0) === 0) {
      const onHand = await this.pigletHead(farrow.piglet_batch_id);
      if (dto.piglets_weaned > onHand + 1e-9) {
        throw new BadRequestException(
          `The piglet lot ${farrow.piglet_lot_no ?? ''} holds ${onHand} piglets; ${dto.piglets_weaned} cannot have been weaned.`,
        );
      }
      const lost = onHand - dto.piglets_weaned;
      if (lost > 0) {
        await this.batchService.recordMortality(
          farrow.piglet_batch_id,
          { transaction_date: dto.weaning_date, quantity: lost, remarks: 'Pre-weaning loss, recorded at weaning' },
          tenantId,
          userPayload,
        );
        pigletNote += ` ${lost} lost before weaning.`;
      }
      if (dto.move_to_batch_id && dto.piglets_weaned > 0) {
        await this.batchTransfers.create(
          {
            company_id: farrow.company_id ?? sow.company_id,
            to_batch_id: dto.move_to_batch_id,
            transfer_date: dto.weaning_date,
            transfer_type: 'PARTIAL',
            quantity: dto.piglets_weaned,
            reason: 'WEANING',
            remarks: `Weaned from ${sow.animal_code}, lot ${farrow.piglet_lot_no ?? ''}`,
          } as any,
          tenantId,
          farrow.piglet_batch_id,
          userPayload,
        );
        pigletNote += ` ${dto.piglets_weaned} moved to the destination batch.`;
      } else if (dto.move_to_stage_code) {
        await this.batchService.transferStage(
          farrow.piglet_batch_id,
          { to_stage_code: dto.move_to_stage_code, transfer_date: dto.weaning_date } as any,
          tenantId,
          userPayload,
        );
        pigletNote += ` The piglet lot moved on to ${dto.move_to_stage_code}.`;
      }
    } else if (dto.move_to_batch_id || dto.move_to_stage_code) {
      throw new BadRequestException(
        farrow.piglet_batch_id
          ? 'This litter was already weaned, so its piglets have already been dealt with.'
          : 'This litter has no piglet lot to move — it was recorded without a piglet item.',
      );
    }

    // A litter's lot left with nothing in it — all weaned and moved on, or all lost — stays ACTIVE at nil head until a
    // user closes it (Rishi, 19 Oct: a batch is closed by a user, never by a posting). Data entry refuses it meanwhile.
    if (farrow.piglet_batch_id && (farrow.piglets_weaned || 0) === 0 && (await this.pigletHead(farrow.piglet_batch_id)) <= 1e-9) {
      pigletNote += ' The piglet lot is now empty; close it from the batch when you are done with it.';
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

    // Weaning completes this litter's parity (BBP: "Parity incremented on weaning POST").
    // Set from the farrowing's own number, and the weaned total moved by the change from
    // what was already recorded, so posting the same weaning twice (or correcting it)
    // cannot count the litter or its piglets twice.
    await this.db
      .update(schema.animalRegister)
      .set({
        parity_count: Math.max(sow.parity_count || 0, farrow.parity_number),
        total_piglets_weaned: Math.max(0, (sow.total_piglets_weaned || 0) + dto.piglets_weaned - (farrow.piglets_weaned || 0)),
        status: 'ACTIVE',
      })
      .where(eq(schema.animalRegister.animal_id, sow.animal_id));

    const sowNote = await this.moveWeanedSowToDrySow(sow, farrow.parity_number, dto.weaning_date, tenantId, userPayload);

    return {
      farrow_id: farrowId,
      piglets_weaned: dto.piglets_weaned,
      parity_count: Math.max(sow.parity_count || 0, farrow.parity_number),
      message: `Weaning recorded: ${dto.piglets_weaned} piglets weaned. Parity ${farrow.parity_number} complete; ${sowNote}${pigletNote}`,
    };
  }

  /** The mating a farrowing comes from: the one named, or the sow's open one. Refuses when there is none. */
  private async matingOfLitter(dto: CreateFarrowingDto, sowCode: string, tenantId: string): Promise<string> {
    const farrowed = aliasedTable(schema.farrowingRecord, 'farrowed');
    const conditions = [
      eq(schema.breedingRecord.tenant_id, tenantId),
      eq(schema.breedingRecord.sow_animal_id, dto.sow_animal_id),
    ];
    if (dto.breeding_id) {
      const [named] = await this.db
        .select({ breeding_id: schema.breedingRecord.breeding_id, mating_date: schema.breedingRecord.mating_date, farrow_id: farrowed.farrow_id, conception_result: schema.breedingRecord.conception_result })
        .from(schema.breedingRecord)
        .leftJoin(farrowed, eq(farrowed.breeding_id, schema.breedingRecord.breeding_id))
        .where(and(eq(schema.breedingRecord.breeding_id, dto.breeding_id), ...conditions))
        .limit(1);
      if (!named) throw new NotFoundException(`Breeding record with ID '${dto.breeding_id}' not found.`);
      if (named.farrow_id) throw new BadRequestException(`That mating of ${sowCode} has already farrowed.`);
      if (named.conception_result === ConceptionResult.FAILED || named.conception_result === ConceptionResult.REPEAT) {
        throw new BadRequestException(`That mating of ${sowCode} was recorded as ${named.conception_result}, so no litter can come from it.`);
      }
      if (String(named.mating_date).slice(0, 10) >= dto.farrowing_date) {
        throw new BadRequestException(`The mating of ${sowCode} is dated on or after this farrowing.`);
      }
      return named.breeding_id;
    }
    const [open] = await this.db
      .select({ breeding_id: schema.breedingRecord.breeding_id })
      .from(schema.breedingRecord)
      .leftJoin(farrowed, eq(farrowed.breeding_id, schema.breedingRecord.breeding_id))
      .where(
        and(
          ...conditions,
          isNull(farrowed.farrow_id),
          sql`${schema.breedingRecord.mating_date} < ${dto.farrowing_date}`,
          sql`COALESCE(${schema.breedingRecord.conception_result}, 'PENDING') NOT IN ('FAILED', 'REPEAT')`,
        ),
      )
      .orderBy(desc(schema.breedingRecord.mating_date))
      .limit(1);
    if (!open) {
      throw new BadRequestException(
        `No open mating is recorded for ${sowCode} before ${dto.farrowing_date}. Record her mating (Breeding → Mating) before her farrowing — the litter's sire comes from it.`,
      );
    }
    return open.breeding_id;
  }

  /**
   * A weaned sow goes to the Dry Sow stage (agreed 9 Oct), by the ordinary stage move, so it is checked, logged and
   * counted like any other. Only for a sow in an animal-wise batch — the stage is hers there — and only when her company
   * has a Dry Sow stage; her status stays ACTIVE (the stage carries "dry"). Returns what the message should say.
   */
  private async moveWeanedSowToDrySow(
    sow: typeof schema.animalRegister.$inferSelect,
    litter: number,
    weaningDate: string,
    tenantId: string,
    userPayload?: any,
  ): Promise<string> {
    const [batch] = sow.current_batch_id
      ? await this.db
          .select({ tracking_mode: schema.batchHeader.tracking_mode })
          .from(schema.batchHeader)
          .where(eq(schema.batchHeader.batch_id, sow.current_batch_id))
          .limit(1)
      : [];
    if (batch?.tracking_mode !== 'ANIMAL_WISE') return 'sow returned to ACTIVE status.';

    const [drySow] = await this.db
      .select({ stage_id: schema.stageMaster.stage_id })
      .from(schema.stageMaster)
      .where(
        and(
          eq(schema.stageMaster.tenant_id, tenantId),
          eq(schema.stageMaster.company_id, sow.company_id),
          eq(schema.stageMaster.nob_id, sow.nob_id),
          eq(schema.stageMaster.lob_id, sow.lob_id),
          eq(schema.stageMaster.stage_code, DRY_SOW_STAGE),
          eq(schema.stageMaster.is_active, true),
          isNull(schema.stageMaster.deleted_at),
        ),
      )
      .limit(1);
    if (!drySow) return 'sow returned to ACTIVE status (no Dry Sow stage is set up, so her stage is unchanged).';
    if (drySow.stage_id === sow.current_stage_id) return 'sow returned to ACTIVE status in Dry Sow.';

    await this.animals.transitionStage(
      sow.animal_id,
      { to_stage_id: drySow.stage_id, transition_date: weaningDate, reason: `Weaned litter ${litter}` } as any,
      tenantId,
      userPayload,
    );
    return 'sow returned to ACTIVE status and moved to Dry Sow.';
  }

  /** The head a piglet lot holds now: its bio-asset state, else the batch's own figure. */
  private async pigletHead(batchId: string): Promise<number> {
    const [state] = await this.db
      .select({ current_quantity: schema.batchBioAssetState.current_quantity })
      .from(schema.batchBioAssetState)
      .where(eq(schema.batchBioAssetState.batch_id, batchId))
      .limit(1);
    if (state) return Number(state.current_quantity) || 0;
    const [batch] = await this.db
      .select({ closing_quantity: schema.batchHeader.closing_quantity, opening_quantity: schema.batchHeader.opening_quantity })
      .from(schema.batchHeader)
      .where(eq(schema.batchHeader.batch_id, batchId))
      .limit(1);
    return Number(batch?.closing_quantity ?? batch?.opening_quantity) || 0;
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
        piglet_batch_id: schema.farrowingRecord.piglet_batch_id,
        piglet_lot_no: schema.farrowingRecord.piglet_lot_no,
        notes: schema.farrowingRecord.notes,
        created_at: schema.farrowingRecord.created_at,
        sow_id: schema.farrowingRecord.sow_animal_id,
        sow_code: schema.animalRegister.animal_code,
        sow_tag: schema.animalRegister.rfid_tag,
        breeding_id: schema.farrowingRecord.breeding_id,
        batch_id: schema.farrowingRecord.batch_id,
        batch_no: schema.batchHeader.batch_no,
      })
      .from(schema.farrowingRecord)
      .innerJoin(schema.animalRegister, eq(schema.farrowingRecord.sow_animal_id, schema.animalRegister.animal_id))
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.farrowingRecord.batch_id))
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
    // The lot, its stock and its QR are one event: all recorded, or none.
    return withTenantTransaction(this.cls, () => this.recordSemenCollectionInner(dto, tenantId, userPayload));
  }

  private async recordSemenCollectionInner(dto: CreateSemenCollectionDto, tenantId: string, userPayload?: any) {
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

    if (boar.gender !== 'M') {
      throw new BadRequestException(`Animal '${boar.animal_code}' is not male and cannot be collected from.`);
    }
    this.assertLiveAnimal(boar, ['BOAR'], 'boar');
    const companyId = this.assertAnimalCompany(dto.company_id, boar, 'boar');
    // The lot is filed under the boar's batch — its cost, its stock and its QR. The Breeding screen asks for the batch
    // first; Data Entry is inside it. Every boar of a pooled lot is from that same batch.
    const boarBatchId = await this.assertAnimalInBatch(boar, dto.boar_batch_id, 'boar', tenantId);
    this.assertNotFuture(dto.collection_date, 'The collection date');
    if (boar.entry_date && dto.collection_date < String(boar.entry_date).slice(0, 10)) {
      throw new BadRequestException(`${boar.animal_code} entered on ${String(boar.entry_date).slice(0, 10)}; he cannot have been collected before that.`);
    }
    if (!Number.isInteger(dto.doses_collected)) {
      throw new BadRequestException('Doses collected must be a whole number.');
    }
    if ((dto.doses_used_internal || 0) + (dto.doses_sold || 0) > dto.doses_collected) {
      throw new BadRequestException('Doses used and sold cannot be more than the doses collected.');
    }
    // Pooled semen: the lot is mixed from several boars. The first is the lot's primary boar; each of the others must be a
    // live boar of the same company, and counts once however often he is named.
    const poolBoars = await this.loadPoolBoars(boar, dto.pool_boar_animal_ids ?? [], companyId, boarBatchId, tenantId);
    const allBoars = [boar, ...poolBoars];

    // The period costs: as typed (for the lot as a whole), else worked out from what was posted for each boar over his own
    // period and added up (G7) — a pooled lot carries what every boar in it cost.
    const typed = [dto.amortisation_period, dto.feed_cost_period, dto.drug_cost_period, dto.overhead_cost_period].some((v) => v != null);
    let period: { from: string | null; to: string | null };
    let amort: number, feed: number, drug: number, overhead: number;
    let costShares: number[];
    let derived: PeriodCosts | null = null;
    if (typed) {
      period = { from: dto.period_from || null, to: dto.period_to || null };
      amort = dto.amortisation_period || 0;
      feed = dto.feed_cost_period || 0;
      drug = dto.drug_cost_period || 0;
      overhead = dto.overhead_cost_period || 0;
      costShares = allBoars.map(() => (amort + feed + drug + overhead) / allBoars.length);
    } else {
      const perBoar: { from: string; to: string; costs: PeriodCosts }[] = [];
      for (const b of allBoars) {
        const p = await this.semenCostPeriod(b, dto, tenantId);
        perBoar.push({ ...p, costs: await this.postedSemenCosts(b, boarBatchId, p.from, p.to, tenantId) });
      }
      const sum = (pick: (c: PeriodCosts) => number) => perBoar.reduce((t, x) => t + pick(x.costs), 0);
      amort = sum((c) => c.amortisation);
      feed = sum((c) => c.feed);
      drug = sum((c) => c.drug);
      overhead = sum((c) => c.overhead);
      derived = { feed, drug, overhead, amortisation: amort };
      costShares = perBoar.map((x) => x.costs.feed + x.costs.drug + x.costs.overhead + x.costs.amortisation);
      period = {
        from: perBoar.map((x) => x.from).sort()[0],
        to: perBoar.map((x) => x.to).sort().slice(-1)[0],
      };
    }
    const runningCost = amort + feed + drug + overhead;
    const unitCostPerDose = dto.doses_collected > 0 ? runningCost / dto.doses_collected : 0;

    const semenBatchId = randomUUID();
    // Naming an item posts the collection to inventory as a lot of it, with its QR (any item the farm uses for semen).
    const posted = dto.output_item_id
      ? await this.semenLots.postCollection(
          {
            boar,
            poolBoars,
            boarBatchId,
            semenBatchId,
            collectionDate: dto.collection_date,
            doses: dto.doses_collected,
            itemId: dto.output_item_id,
            quality: { volume_ml: dto.volume_ml ?? null, motility_pct: dto.motility_pct ?? null, concentration_m_per_ml: dto.concentration_m_per_ml ?? null },
          },
          tenantId,
          userPayload,
        )
      : null;
    const newRecord = {
      semen_batch_id: semenBatchId,
      tenant_id: tenantId,
      company_id: companyId,
      boar_animal_id: dto.boar_animal_id,
      boar_batch_id: boarBatchId,
      collection_date: dto.collection_date,
      period_from: period.from,
      period_to: period.to,
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
      inventory_posted: !!posted,
      lot_no: posted?.lot_no ?? null,
      expiry_date: posted?.expiry_date ?? null,
      warehouse_id: posted?.warehouse_id ?? null,
      qr_id: posted?.qr_id ?? null,
      volume_ml: dto.volume_ml != null ? String(dto.volume_ml) : null,
      motility_pct: dto.motility_pct != null ? String(dto.motility_pct) : null,
      concentration_m_per_ml: dto.concentration_m_per_ml != null ? String(dto.concentration_m_per_ml) : null,
      notes: dto.notes || null,
      created_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.semenBatch).values(newRecord);
    if (poolBoars.length) {
      await this.db.insert(schema.semenBatchBoar).values(
        allBoars.map((b, i) => ({
          semen_batch_id: semenBatchId,
          boar_animal_id: b.animal_id,
          tenant_id: tenantId,
          boar_batch_id: boarBatchId,
          sort_order: i,
          cost_share: costShares[i].toFixed(4),
        })),
      );
    }

    return {
      ...newRecord,
      pooled_boars: poolBoars.length ? allBoars.map((b) => b.animal_code) : undefined,
      qr_pack_no: posted?.pack_no ?? null,
      message:
        `Semen collection logged: ${dto.doses_collected} doses collected${poolBoars.length ? ` as one pooled lot from ${allBoars.length} boars (${allBoars.map((b) => b.animal_code).join(', ')})` : ''} at computed unit cost of ${unitCostPerDose.toFixed(4)}/dose` +
        (derived ? ` (worked out from ${poolBoars.length ? 'their' : 'his'} posted costs ${period.from} to ${period.to})` : '') +
        '.' +
        (posted
          ? ` Posted to inventory as lot ${posted.lot_no}${posted.expiry_date ? ` (expires ${posted.expiry_date})` : ''}${posted.pack_no ? `, QR ${posted.pack_no}` : ', no QR — the boar is in no batch'}.`
          : ' Not posted to inventory — choose the semen item to hold the doses as stock.'),
    };
  }

  /**
   * The other boars of a pooled lot, in the order named: each must exist in scope, be male, live, and belong to the same
   * company as the primary boar. The primary is not repeated, and a boar named twice counts once.
   */
  private async loadPoolBoars(
    primary: typeof schema.animalRegister.$inferSelect,
    ids: string[],
    companyId: string,
    boarBatchId: string,
    tenantId: string,
  ): Promise<(typeof schema.animalRegister.$inferSelect)[]> {
    const wanted = [...new Set(ids.filter((id) => id && id !== primary.animal_id))];
    if (!wanted.length) return [];
    if (primary.gender !== 'M') {
      throw new BadRequestException(`${primary.animal_code} is not a boar, so semen cannot be pooled from him.`);
    }
    const rows = await this.db
      .select()
      .from(schema.animalRegister)
      .where(
        and(
          inArray(schema.animalRegister.animal_id, wanted),
          eq(schema.animalRegister.tenant_id, tenantId),
          ...animalScopeConditions(farmScope(this.cls)),
        ),
      );
    const byId = new Map(rows.map((r) => [r.animal_id, r]));
    return wanted.map((id) => {
      const b = byId.get(id);
      if (!b) throw new NotFoundException(`Boar animal with ID '${id}' not found.`);
      if (b.gender !== 'M') throw new BadRequestException(`${b.animal_code} is not a boar, so his semen cannot be pooled.`);
      if (b.is_active === false) throw new BadRequestException(`${b.animal_code} is no longer active, so he cannot go into a pooled lot.`);
      this.assertAnimalCompany(companyId, b, 'boar');
      if (b.current_batch_id !== boarBatchId) {
        throw new BadRequestException(`${b.animal_code} is not in the same batch as ${primary.animal_code}, so his semen cannot be pooled into the lot.`);
      }
      return b;
    });
  }

  /** The period a collection's cost covers: as given, else from the day after his last collection (or his entry) to this one. */
  private async semenCostPeriod(
    boar: typeof schema.animalRegister.$inferSelect,
    dto: CreateSemenCollectionDto,
    tenantId: string,
  ): Promise<{ from: string; to: string }> {
    const to = dto.period_to || dto.collection_date;
    if (dto.period_from) return { from: dto.period_from, to };
    // His last collection is a lot he was the primary boar of, or one he was pooled into.
    const [last] = await this.db
      .select({ collection_date: schema.semenBatch.collection_date })
      .from(schema.semenBatch)
      .where(
        and(
          eq(schema.semenBatch.tenant_id, tenantId),
          or(
            eq(schema.semenBatch.boar_animal_id, boar.animal_id),
            sql`${schema.semenBatch.semen_batch_id} IN (SELECT semen_batch_id FROM semen_batch_boar WHERE boar_animal_id = ${boar.animal_id})`,
          ),
          lt(schema.semenBatch.collection_date, dto.collection_date),
        ),
      )
      .orderBy(desc(schema.semenBatch.collection_date))
      .limit(1);
    const from = last ? dayAfter(String(last.collection_date)) : String(boar.entry_date ?? dto.collection_date).slice(0, 10);
    return { from, to };
  }

  /** What was posted for the boar over the period: his consumption, overhead and amortisation, with his batch share (G7). */
  private async postedSemenCosts(
    boar: typeof schema.animalRegister.$inferSelect,
    batchId: string | null,
    from: string,
    to: string,
    tenantId: string,
  ): Promise<PeriodCosts> {
    if (!batchId) return periodCostsOf([], 0);
    const inPeriod = and(
      eq(schema.batchTransaction.batch_id, batchId),
      isNull(schema.batchTransaction.reversed_at),
      sql`${schema.batchTransaction.transaction_date} BETWEEN ${from} AND ${to}`,
    );
    const txs = await this.db
      .select({
        type: schema.batchTransaction.transaction_type,
        animal_id: schema.batchTransaction.animal_id,
        amount: schema.batchTransaction.amount,
        item_type: schema.itemMaster.item_type,
      })
      .from(schema.batchTransaction)
      .leftJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.batchTransaction.item_id))
      .where(and(inPeriod, inArray(schema.batchTransaction.transaction_type, ['CONSUMPTION', 'OVERHEAD'])));
    const amortisation = await this.db
      .select({ animal_id: schema.bioAssetLedger.animal_id, batch_id: schema.bioAssetLedger.batch_id, amount: schema.bioAssetLedger.cost_amount })
      .from(schema.bioAssetLedger)
      .where(
        and(
          eq(schema.bioAssetLedger.tenant_id, tenantId),
          eq(schema.bioAssetLedger.entry_type, 'AMORTIZATION'),
          sql`${schema.bioAssetLedger.posting_date} BETWEEN ${from} AND ${to}`,
          sql`(${schema.bioAssetLedger.animal_id} = ${boar.animal_id} OR (${schema.bioAssetLedger.batch_id} = ${batchId} AND ${schema.bioAssetLedger.animal_id} IS NULL))`,
        ),
      );
    const [{ head }] = await this.db
      .select({ head: sql<number>`COUNT(*)` })
      .from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.current_batch_id, batchId), eq(schema.animalRegister.is_active, true)));
    const postings: PostedCost[] = [
      ...txs
        .filter((t) => t.animal_id === boar.animal_id || (t.type === 'OVERHEAD' && !t.animal_id))
        .map((t) => ({ kind: t.type as 'CONSUMPTION' | 'OVERHEAD', own: t.animal_id === boar.animal_id, amount: Number(t.amount ?? 0), item_type: t.item_type })),
      ...amortisation.map((a) => ({ kind: 'AMORTIZATION' as const, own: a.animal_id === boar.animal_id, amount: Number(a.amount ?? 0) })),
    ];
    return periodCostsOf(postings, Number(head) || 0);
  }

  async getSemenBatches(tenantId: string, companyId?: string) {
    const scope = farmScope(this.cls);
    const conditions = [eq(schema.semenBatch.tenant_id, tenantId)];
    if (companyId) {
      conditions.push(eq(schema.semenBatch.company_id, companyId));
    }
    conditions.push(...animalScopeConditions(scope));

    const lots = await this.db
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
        lot_no: schema.semenBatch.lot_no,
        expiry_date: schema.semenBatch.expiry_date,
        warehouse_id: schema.semenBatch.warehouse_id,
        qr_id: schema.semenBatch.qr_id,
        notes: schema.semenBatch.notes,
        created_at: schema.semenBatch.created_at,
        boar_id: schema.semenBatch.boar_animal_id,
        boar_code: schema.animalRegister.animal_code,
        boar_tag: schema.animalRegister.rfid_tag,
        boar_batch_id: schema.semenBatch.boar_batch_id,
        boar_batch_no: schema.batchHeader.batch_no,
        output_item_id: schema.semenBatch.output_item_id,
      })
      .from(schema.semenBatch)
      .innerJoin(schema.animalRegister, eq(schema.semenBatch.boar_animal_id, schema.animalRegister.animal_id))
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.semenBatch.boar_batch_id))
      .where(and(...conditions))
      .orderBy(desc(schema.semenBatch.collection_date));

    // A pooled lot names every boar that went into it, in the order they were chosen.
    const pooled = lots.length
      ? await this.db
          .select({
            semen_batch_id: schema.semenBatchBoar.semen_batch_id,
            boar_id: schema.semenBatchBoar.boar_animal_id,
            boar_code: schema.animalRegister.animal_code,
          })
          .from(schema.semenBatchBoar)
          .innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.semenBatchBoar.boar_animal_id))
          .where(inArray(schema.semenBatchBoar.semen_batch_id, lots.map((l) => l.semen_batch_id)))
          .orderBy(schema.semenBatchBoar.sort_order)
      : [];
    return lots.map((l) => {
      const boars = pooled.filter((p) => p.semen_batch_id === l.semen_batch_id);
      return { ...l, pooled: boars.length > 0, boars: boars.map((b) => ({ boar_id: b.boar_id, boar_code: b.boar_code })) };
    });
  }
}
