import { withTenantTransaction } from '../../../common/tenant-transaction';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, like, desc, sql } from 'drizzle-orm';
import { aliasedTable } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { BulkTransitionAnimalStageDto, CreateAnimalDto, UpdateAnimalDto, DisposeAnimalDto, QueryAnimalDto, TransitionAnimalStageDto } from './dto/animal.dto';

import { AuditLogService } from '../../system/audit-log/audit-log.service';

import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

// Maps a disposal_type to the terminal `status` it leaves the animal in. TRANSFERRED has no
// direct status match in the spec's STATUSES enum (it means the animal left this tenant's
// register, not that it died/sold/slaughtered here) — SOLD is the closest "left the register"
// status other than the disposal-specific ones, but rather than guessing, TRANSFERRED keeps
// whatever status it already had and only is_active flips false.
const DISPOSAL_STATUS_MAP: Record<string, string | undefined> = {
  SOLD: 'SOLD',
  SLAUGHTERED: 'SLAUGHTERED',
  DIED: 'DEAD',
  TRANSFERRED: undefined,
};

// BBP §6: "teat count < 15 is a hard block at selection" — regardless of TSI score. There is no
// dedicated gilt-selection endpoint in this codebase yet, so this guards every path that can set
// no_of_teats on a GILT (create and update) rather than a selection action that does not exist.
const MIN_GILT_TEATS = 15;

/**
 * Statuses that mean the animal has left the herd. Only dispose() may set
 * these, because only dispose() does the work they imply: for SLAUGHTERED it
 * blocks until every administered medicine's withdrawal period has elapsed
 * (assertWithdrawalPeriodsElapsed — a food-safety rule, not bookkeeping), it
 * computes gain_loss_on_disposal against book value, and it records
 * disposal_date, disposal_type and disposal_value while flipping is_active.
 *
 * Without this guard a plain PUT /animal/:id with { status: 'SLAUGHTERED' }
 * returned 200 and left the row SLAUGHTERED with is_active still 1, no
 * disposal record and no withdrawal check — verified against the running API
 * on 2026-09-07 before the guard existed.
 */
const DISPOSAL_ONLY_STATUSES = new Set(Object.values(DISPOSAL_STATUS_MAP).filter(Boolean) as string[]);

/**
 * CULLED is blocked too, but it is NOT a disposal type — DISPOSAL_TYPES is
 * SOLD / SLAUGHTERED / DIED / TRANSFERRED — so dispose() cannot set it either
 * and the message must not send anyone there.
 *
 * BBP-1: "On mortality or cull: record CLOSED (not deleted). Closure date,
 * reason, disposal destination, weight at death/cull recorded. D365BC FA or
 * inventory write-off triggered", and "Out-of-Production Date and Cull Date are
 * TWO SEPARATE fields (MOM 24 Aug). System does not allow Cull Date <
 * Out-of-Production Date", with an INFO alert when the gap exceeds 14 days
 * because the animal is still eating during the hold.
 *
 * None of that is built: the register has expected_cull_date and nothing else —
 * no out_of_production_date, no cull_date, no disposal destination, no weight
 * at cull — and the CULL reason category holds one code. So culling has no
 * correct path today, and letting a status dropdown fake one would record a
 * culled animal with none of the closure data the blueprint requires.
 */
const CULL_STATUS = 'CULLED';

/**
 * Upper bound on a hand-typed age at entry. Not a client figure and not a
 * domain rule — ten years is well past any pig's productive life, so a value
 * above it is a typing slip (a birth year in the weeks box), not a claim about
 * the animal. Computed ages are never checked against it: if the dates say the
 * animal is older, the dates are the record.
 */
const MAX_TYPED_AGE_AT_ENTRY_WEEKS = 520;

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * TDD tracker Excel row 12 (S.No. 11) and Animal Register Master Template
 * column G: "Computed from dob and entry_date. Manual entry if imported and
 * DOB unknown."
 *
 * The two documents disagree on the trigger — the tracker keys the automatic
 * computation off entry_type (BORN_ON_FARM), the template keys it off whether
 * a dob exists at all. Rishi settled it on 2026-09-08 in favour of the
 * template: an imported animal that arrives with a birth certificate should
 * not have its age typed in when the dates already say it.
 *
 * A supplied value is discarded rather than merged when dob is known, because
 * a row holding both a dob and a contradicting age has no reading that is
 * true. Parsed as UTC midnight so the result does not shift by a day for
 * anyone east or west of the server.
 */
export function resolveAgeAtEntryWeeks(
  dob: string | null | undefined,
  entryDate: string | null | undefined,
  typed: number | null | undefined,
): number | null {
  if (dob && entryDate) {
    const born = Date.parse(`${String(dob).slice(0, 10)}T00:00:00Z`);
    const entered = Date.parse(`${String(entryDate).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(born) || Number.isNaN(entered)) {
      throw new BadRequestException('Date of birth and entry date must both be valid dates.');
    }
    if (born > entered) {
      throw new BadRequestException(
        `Date of birth '${String(dob).slice(0, 10)}' falls after the entry date '${String(entryDate).slice(0, 10)}' — an animal cannot enter the farm before it is born.`,
      );
    }
    // Floored: six days into a week is not a week lived.
    return Math.floor((entered - born) / MS_PER_WEEK);
  }

  if (typed === undefined || typed === null) return null;

  if (!Number.isInteger(typed) || typed < 0 || typed > MAX_TYPED_AGE_AT_ENTRY_WEEKS) {
    throw new BadRequestException(
      `Age at entry must be a whole number of weeks between 0 and ${MAX_TYPED_AGE_AT_ENTRY_WEEKS}.`,
    );
  }
  return typed;
}

function assertGiltTeatCount(animalType: string | undefined, noOfTeats: number | undefined | null): void {
  if (animalType !== 'GILT' || noOfTeats === undefined || noOfTeats === null) return;
  if (noOfTeats < MIN_GILT_TEATS) {
    throw new BadRequestException(
      `Teat count ${noOfTeats} is below the minimum of ${MIN_GILT_TEATS} — this gilt cannot be selected regardless of TSI score.`,
    );
  }
}

@Injectable()
export class AnimalService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly numberSeriesService: NumberSeriesService,
    private readonly nobLobResolution: NobLobResolutionService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  private async assertExists<T extends { limit: (n: number) => Promise<any[]> }>(
    query: T,
    label: string,
    id: string,
  ) {
    const rows = await query.limit(1);
    if (rows.length === 0) {
      throw new NotFoundException(`${label} with ID '${id}' not found.`);
    }
    return rows[0];
  }

  /**
   * Spec: "At the time of a slaughter entry the system must check that today minus the
   * last administration date for each medicine given to that animal is greater than or
   * equal to withdrawal_days. Block the slaughter if not." Reduced in JS rather than a SQL
   * GROUP BY. Both medication logs and batch treatments record administrations;
   * treatment-specific withdrawal days take precedence over master defaults.
   */
  private async activeWithdrawalPeriods(animalId: string, asOfDate: string) {
    const medicationRows = await this.db
      .select({
        item_id: schema.itemMaster.item_id,
        item_name: schema.itemMaster.item_name,
        item_type: schema.itemMaster.item_type,
        withdrawal_days: schema.itemMaster.withdrawal_days,
        administered_date: schema.animalMedicationLog.administered_date,
      })
      .from(schema.animalMedicationLog)
      .innerJoin(schema.itemMaster, eq(schema.animalMedicationLog.item_id, schema.itemMaster.item_id))
      .where(eq(schema.animalMedicationLog.animal_id, animalId));
    const treatmentRows = await this.db
      .select({
        item_id: schema.itemMaster.item_id,
        item_name: schema.itemMaster.item_name,
        item_type: schema.itemMaster.item_type,
        withdrawal_days: schema.batchTreatmentDetail.withdrawal_days,
        master_withdrawal_days: schema.itemMaster.withdrawal_days,
        administered_date: schema.batchTransaction.transaction_date,
      })
      .from(schema.batchTransaction)
      .innerJoin(schema.batchTreatmentDetail, eq(schema.batchTreatmentDetail.transaction_id, schema.batchTransaction.transaction_id))
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.batchTransaction.item_id))
      .where(and(
        eq(schema.batchTransaction.animal_id, animalId),
        eq(schema.batchTransaction.transaction_type, 'CONSUMPTION'),
        sql`${schema.batchTransaction.quantity} > 0`,
      ));
    const rows = [...medicationRows, ...treatmentRows.map(row => ({
      ...row, withdrawal_days: row.withdrawal_days ?? row.master_withdrawal_days,
    }))];
    const dayMs = 86400000;
    const asOfMs = new Date(asOfDate).getTime();
    // Recorded treatment durations can differ between doses. The most recent
    // dose must not erase an earlier dose whose withdrawal expires later.
    const latestExpiryByItem = new Map<string, { item_name: string; expiry: number; lastDose: string }>();
    for (const row of rows) {
      if (row.withdrawal_days == null || !['MEDICINE', 'VACCINE'].includes(row.item_type)) continue;
      const expiry = new Date(row.administered_date).getTime() + Number(row.withdrawal_days) * dayMs;
      const existing = latestExpiryByItem.get(row.item_id);
      if (!existing || expiry > existing.expiry) {
        latestExpiryByItem.set(row.item_id, { item_name: row.item_name, expiry, lastDose: row.administered_date });
      }
    }
    return [...latestExpiryByItem.values()]
      .filter(row => row.expiry > asOfMs)
      .map(row => ({ item_name: row.item_name, daysRemaining: Math.ceil((row.expiry - asOfMs) / dayMs), lastDose: row.lastDose }));
  }

  private async assertWithdrawalPeriodsElapsed(animalId: string, disposalDate: string) {
    const withdrawals = await this.activeWithdrawalPeriods(animalId, disposalDate);
    if (withdrawals.length) {
      const violations = withdrawals.map(row => `${row.item_name} (${row.daysRemaining} day(s) remaining, last dose ${row.lastDose})`);
      throw new BadRequestException(`Cannot slaughter — withdrawal period not elapsed for: ${violations.join('; ')}`);
    }
  }

  /**
   * Animal codes were always drawn from the ANIMAL_PIGGERY series, so a dairy
   * cow or a layer bird would be issued a code like PIG-2026-0001. The series
   * is now resolved from the animal's line of business, falling back to a
   * tenant-wide ANIMAL series and finally to ANIMAL_PIGGERY so existing
   * piggery tenants keep their numbering unchanged.
   */
  private async generateAnimalCode(lobId: string, tenantId: string, companyId: string, manualCode?: string, record: Record<string, unknown> = {}): Promise<string> {
    const [lob] = await this.db
      .select({ lob_code: schema.lobMaster.lob_code })
      .from(schema.lobMaster)
      .where(eq(schema.lobMaster.lob_id, lobId))
      .limit(1);

    if (manualCode) return this.numberSeriesService.manualCode('ANIMAL', manualCode, tenantId, companyId, lob?.lob_code?.toUpperCase());

    const candidates = [
      lob?.lob_code ? `ANIMAL_${lob.lob_code.toUpperCase()}` : null,
      'ANIMAL',
      'ANIMAL_PIGGERY',
    ].filter((x): x is string => !!x);

    let lastError: unknown;
    for (const seriesCode of candidates) {
      try {
        return await this.numberSeriesService.generateNext(seriesCode, tenantId, companyId, undefined, record);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  async create(dto: CreateAnimalDto, tenantId: string, userPayload?: any) {
    assertGiltTeatCount(dto.animal_type, dto.no_of_teats);
    // Resolved here, beside the other cheap guards, rather than down at the
    // insert: generateAnimalCode() consumes a number series, and a create that
    // fails after it has run leaves a permanent hole in the animal codes. One
    // did — a create refused for an out-of-range age still burned PIG-2026-0022,
    // and the register jumped straight from 0021 to 0023.
    const ageAtEntryWeeks = resolveAgeAtEntryWeeks(dto.dob, dto.entry_date, dto.age_at_entry_weeks);

    await this.assertExists(
      this.db.select().from(schema.companyMaster).where(eq(schema.companyMaster.company_id, dto.company_id)),
      'Company', dto.company_id,
    );

    // NOB/LOB are no longer asked on the form — derive them from the company's
    // operational areas (an explicit dto value, if a caller still sends one,
    // wins). animal_register.nob_id/lob_id are NOT NULL, so an ambiguous
    // company (operational areas split across LOBs) surfaces a clear error
    // here rather than a raw DB constraint failure.
    const resolved = await this.nobLobResolution.resolve(tenantId, dto.company_id, {
      nob_id: dto.nob_id,
      lob_id: dto.lob_id,
    });
    if (!resolved.nob_id || !resolved.lob_id) {
      throw new BadRequestException(
        "Cannot determine this animal's Nature of Business / Line of Business — this company's operational areas span multiple business verticals. Specify nob_id and lob_id explicitly.",
      );
    }
    const nobId = resolved.nob_id;
    const lobId = resolved.lob_id;

    await this.assertExists(
      this.db.select().from(schema.nobMaster).where(eq(schema.nobMaster.nob_id, nobId)),
      'NOB', nobId,
    );
    await this.assertExists(
      this.db.select().from(schema.lobMaster).where(eq(schema.lobMaster.lob_id, lobId)),
      'LOB', lobId,
    );
    await this.assertExists(
      this.db.select().from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, dto.breed_id)),
      'Breed', dto.breed_id,
    );
    await this.assertExists(
      this.db.select().from(schema.itemMaster).where(eq(schema.itemMaster.item_id, dto.item_id)),
      'Item', dto.item_id,
    );

    // COND rules from the spec: source_receipt_id required for purchased entries,
    // source_batch_id required for on-farm births.
    if (['PURCHASED_IMPORTED', 'PURCHASED_LOCAL'].includes(dto.entry_type) && !dto.source_receipt_id) {
      throw new BadRequestException(`source_receipt_id is required when entry_type is '${dto.entry_type}'.`);
    }
    if (dto.entry_type === 'BORN_ON_FARM' && !dto.source_batch_id) {
      throw new BadRequestException(`source_batch_id is required when entry_type is 'BORN_ON_FARM'.`);
    }

    // A purchased animal's cost is a fact on the receipt it arrived on, not a
    // number retyped into the register. Derived here and the caller's value
    // discarded, so the register and the receipt cannot drift apart. Animals
    // that were not purchased keep the cost as entered — there is no document
    // to read it off.
    let acquisitionCost = dto.acquisition_cost;
    if (dto.source_receipt_id) {
      await this.assertExists(
        this.db.select().from(schema.goodsReceipt).where(eq(schema.goodsReceipt.receipt_id, dto.source_receipt_id)),
        'Goods receipt', dto.source_receipt_id,
      );

      const [receiptLine] = await this.db
        .select({ rate: schema.goodsReceiptLine.rate, amount: schema.goodsReceiptLine.amount })
        .from(schema.goodsReceiptLine)
        .where(and(
          eq(schema.goodsReceiptLine.receipt_id, dto.source_receipt_id),
          eq(schema.goodsReceiptLine.item_id, dto.item_id),
        ))
        .limit(1);

      if (!receiptLine) {
        throw new BadRequestException(
          `The source goods receipt has no line for this animal's item, so there is no purchase price to read. Either the wrong receipt was chosen or the wrong item.`,
        );
      }
      if (receiptLine.rate === null || receiptLine.rate === undefined) {
        throw new BadRequestException(
          `The source goods receipt line for this animal's item carries no rate, so the acquisition cost cannot be derived from it.`,
        );
      }
      acquisitionCost = Number(receiptLine.rate);
    }

    // Only reachable for an entry with no receipt behind it: the form omits the
    // field entirely for purchased animals (it is readOnly there, and readOnly
    // fields are stripped from the payload), so this cannot be a plain
    // "required field missing" on the DTO without breaking that path.
    if (acquisitionCost === undefined || acquisitionCost === null) {
      throw new BadRequestException(
        `Acquisition cost is required for a '${dto.entry_type}' entry — there is no goods receipt to read it from.`,
      );
    }
    if (dto.source_batch_id) {
      await this.assertExists(
        this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, dto.source_batch_id)),
        'Batch', dto.source_batch_id,
      );
    }
    if (dto.sire_animal_id) {
      await this.assertExists(
        this.db.select().from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, dto.sire_animal_id)),
        'Sire animal', dto.sire_animal_id,
      );
    }
    if (dto.dam_animal_id) {
      await this.assertExists(
        this.db.select().from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, dto.dam_animal_id)),
        'Dam animal', dto.dam_animal_id,
      );
    }
    if (dto.current_stage_id) {
      await this.assertExists(
        this.db.select().from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, dto.current_stage_id)),
        'Stage', dto.current_stage_id,
      );
    }
    if (dto.current_batch_id) {
      await this.assertExists(
        this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, dto.current_batch_id)),
        'Batch', dto.current_batch_id,
      );
    }
    if (dto.current_location_id) {
      await this.assertExists(
        this.db.select().from(schema.locationMaster).where(eq(schema.locationMaster.location_id, dto.current_location_id)),
        'Location', dto.current_location_id,
      );
    }

    if (dto.rfid_tag) {
      const duplicateRfid = await this.db
        .select()
        .from(schema.animalRegister)
        .where(and(eq(schema.animalRegister.tenant_id, tenantId), eq(schema.animalRegister.rfid_tag, dto.rfid_tag)))
        .limit(1);
      if (duplicateRfid.length > 0) {
        throw new ConflictException(`RFID tag '${dto.rfid_tag}' is already registered to another animal.`);
      }
    }

    const animalId = randomUUID();
    const animalCode = await this.generateAnimalCode(lobId, tenantId, dto.company_id, dto.animal_code, dto as unknown as Record<string, unknown>);
    const totalOpeningAssetValue = acquisitionCost + (dto.landing_cost || 0);

    const newAnimal = {
      animal_id: animalId,
      tenant_id: tenantId,
      company_id: dto.company_id,
      nob_id: nobId,
      lob_id: lobId,
      animal_code: animalCode,
      animal_type: dto.animal_type,
      breed_id: dto.breed_id,
      gender: dto.gender,
      dob: dto.dob || null,
      age_at_entry_weeks: ageAtEntryWeeks,
      entry_type: dto.entry_type,
      entry_date: dto.entry_date,
      source_receipt_id: dto.source_receipt_id || null,
      source_batch_id: dto.source_batch_id || null,
      item_id: dto.item_id,
      rfid_tag: dto.rfid_tag || null,
      ear_tag: dto.ear_tag || null,
      ear_tag_image_url: dto.ear_tag_image_url || null,
      sire_animal_id: dto.sire_animal_id || null,
      dam_animal_id: dto.dam_animal_id || null,
      acquisition_cost: acquisitionCost.toString(),
      landing_cost: dto.landing_cost?.toString() || null,
      total_opening_asset_value: totalOpeningAssetValue.toString(),
      current_bio_asset_value: totalOpeningAssetValue.toString(),
      total_amortised: '0.0000',
      book_value: totalOpeningAssetValue.toString(),
      current_stage_id: dto.current_stage_id || null,
      current_batch_id: dto.current_batch_id || null,
      current_location_id: dto.current_location_id || null,
      productive_life_start: dto.productive_life_start || null,
      status: dto.status || 'ACTIVE',
      no_of_teats: dto.no_of_teats ?? null,
      tsi: dto.tsi?.toString() ?? null,
      grading: dto.grading || null,
      serial_number: dto.serial_number || null,
      notes: dto.notes || null,
      is_active: true,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.animalRegister).values(newAnimal);

    // Record IAS 41 Opening Acquisition in bio_asset_ledger for this tagged animal
    await this.db.insert(schema.bioAssetLedger).values({
      entry_id: randomUUID(),
      tenant_id: tenantId,
      company_id: dto.company_id,
      bio_asset_item_id: dto.item_id,
      animal_id: animalId,
      entry_type: 'ACQUISITION',
      document_no: animalCode,
      posting_date: dto.entry_date,
      stage: dto.current_stage_id || null,
      status: 'ACTIVE',
      quantity: '1.0000',
      cost_amount: totalOpeningAssetValue.toString(),
      cost_amount_each_unit: totalOpeningAssetValue.toString(),
      costing_method: 'COST_ACCUMULATION',
      nob_id: dto.nob_id,
      lob_id: dto.lob_id,
      created_by: userPayload?.userId || null,
    });

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'animal_register',
      entityId: animalId,
      newValues: newAnimal,
    });

    return this.findOne(animalId);
  }

  async lookupByTag(tag: string, tenantId: string) {
    const trimmed = tag.trim();
    if (!trimmed) {
      throw new BadRequestException('Tag / Code query parameter cannot be empty.');
    }

    const rows = await this.db
      .select({
        animal: schema.animalRegister,
        breed: schema.breedMaster,
        stage: schema.stageMaster,
        batch: schema.batchHeader,
      })
      .from(schema.animalRegister)
      .leftJoin(schema.breedMaster, eq(schema.animalRegister.breed_id, schema.breedMaster.breed_id))
      .leftJoin(schema.stageMaster, eq(schema.animalRegister.current_stage_id, schema.stageMaster.stage_id))
      .leftJoin(schema.batchHeader, eq(schema.animalRegister.current_batch_id, schema.batchHeader.batch_id))
      .where(
        and(
          eq(schema.animalRegister.tenant_id, tenantId),
          or(
            eq(schema.animalRegister.rfid_tag, trimmed),
            eq(schema.animalRegister.ear_tag, trimmed),
            eq(schema.animalRegister.animal_code, trimmed),
            eq(schema.animalRegister.animal_id, trimmed)
          )
        )
      )
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(`No animal found matching RFID tag, ear tag, or code '${trimmed}'.`);
    }

    const { animal, breed, stage, batch } = rows[0];

    const activeWithdrawals = await this.activeWithdrawalPeriods(animal.animal_id, new Date().toISOString().slice(0, 10));

    return {
      ...animal,
      breed_name: breed?.breed_name,
      stage_name: stage?.stage_name,
      // batch_header's column is batch_no — `batch_code` does not exist on it,
      // so this field was always undefined and the animal never showed its batch.
      batch_no: batch?.batch_no,
      hasActiveWithdrawal: activeWithdrawals.length > 0,
      activeWithdrawals,
    };
  }

  async findOne(id: string) {
    const [animal] = await this.db
      .select()
      .from(schema.animalRegister)

      .where(eq(schema.animalRegister.animal_id, id))
      .limit(1);

    if (!animal) {
      throw new NotFoundException(`Animal with ID '${id}' not found.`);
    }
    return animal;
  }

  async findAll(query: QueryAnimalDto, tenantId: string) {
    const conditions: any[] = [eq(schema.animalRegister.tenant_id, tenantId)];

    if (!query.includeDisposed) conditions.push(eq(schema.animalRegister.is_active, true));
    conditions.push(...masterScopeConditions(this.cls, schema.animalRegister, query.companyId));
    if (query.breedId) conditions.push(eq(schema.animalRegister.breed_id, query.breedId));
    if (query.animalType) conditions.push(eq(schema.animalRegister.animal_type, query.animalType));
    if (query.status) conditions.push(eq(schema.animalRegister.status, query.status));
    if (query.currentBatchId) conditions.push(eq(schema.animalRegister.current_batch_id, query.currentBatchId));
    if (query.currentLocationId) conditions.push(eq(schema.animalRegister.current_location_id, query.currentLocationId));
    if (query.search) {
      conditions.push(
        or(
          like(schema.animalRegister.animal_code, `%${query.search}%`),
          like(schema.animalRegister.rfid_tag, `%${query.search}%`),
          like(schema.animalRegister.ear_tag, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.animalRegister, query.filter));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.animalRegister)
      .where(and(...conditions))
      .orderBy(listOrderBy(schema.animalRegister, query, schema.animalRegister.animal_code))
      .limit(limit)
      .offset(offset);
  }

  async update(id: string, dto: UpdateAnimalDto, tenantId: string, userPayload?: any) {
    const animal = await this.findOne(id);

    // Changing to the same value is not a disposal, so re-saving a form that
    // shows an already-disposed animal is still allowed.
    if (dto.status && dto.status !== animal.status) {
      if (DISPOSAL_ONLY_STATUSES.has(dto.status)) {
        throw new BadRequestException(
          `'${dto.status}' records that the animal has left the herd and must be set through Dispose, which checks medicine withdrawal periods and posts the gain or loss on disposal.`,
        );
      }
      if (dto.status === CULL_STATUS) {
        throw new BadRequestException(
          `'CULLED' closes the animal's record and triggers a write-off, and needs the out-of-production date, cull date, reason and weight that go with it. That flow is not built yet, so it cannot be set here.`,
        );
      }
    }

    assertGiltTeatCount(animal.animal_type, dto.no_of_teats);

    if (dto.breed_id) {
      await this.assertExists(
        this.db.select().from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, dto.breed_id)),
        'Breed', dto.breed_id,
      );
    }
    if (dto.sire_animal_id) {
      if (dto.sire_animal_id === id) {
        throw new BadRequestException('An animal cannot be its own sire.');
      }
      await this.assertExists(
        this.db.select().from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, dto.sire_animal_id)),
        'Sire animal', dto.sire_animal_id,
      );
    }
    if (dto.dam_animal_id) {
      if (dto.dam_animal_id === id) {
        throw new BadRequestException('An animal cannot be its own dam.');
      }
      await this.assertExists(
        this.db.select().from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, dto.dam_animal_id)),
        'Dam animal', dto.dam_animal_id,
      );
    }
    if (dto.current_stage_id) {
      await this.assertExists(
        this.db.select().from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, dto.current_stage_id)),
        'Stage', dto.current_stage_id,
      );
    }
    if (dto.current_batch_id) {
      await this.assertExists(
        this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, dto.current_batch_id)),
        'Batch', dto.current_batch_id,
      );
    }
    if (dto.current_location_id) {
      await this.assertExists(
        this.db.select().from(schema.locationMaster).where(eq(schema.locationMaster.location_id, dto.current_location_id)),
        'Location', dto.current_location_id,
      );
    }
    if (dto.rfid_tag && dto.rfid_tag !== animal.rfid_tag) {
      const duplicateRfid = await this.db
        .select()
        .from(schema.animalRegister)
        .where(and(eq(schema.animalRegister.tenant_id, tenantId), eq(schema.animalRegister.rfid_tag, dto.rfid_tag)))
        .limit(1);
      if (duplicateRfid.length > 0) {
        throw new ConflictException(`RFID tag '${dto.rfid_tag}' is already registered to another animal.`);
      }
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.breed_id !== undefined) updates.breed_id = dto.breed_id;
    if (dto.dob !== undefined) updates.dob = dto.dob;
    // entry_date is not editable, so the animal's own is always the second
    // term. Recomputed rather than copied through: an edited dob that left a
    // stale age behind would contradict itself on the very screen that shows
    // both, and a typed age sent for an animal that has a dob loses to the dob.
    if (dto.dob !== undefined || dto.age_at_entry_weeks !== undefined) {
      updates.age_at_entry_weeks = resolveAgeAtEntryWeeks(
        dto.dob !== undefined ? dto.dob : animal.dob,
        animal.entry_date,
        dto.age_at_entry_weeks,
      );
    }
    if (dto.rfid_tag !== undefined) updates.rfid_tag = dto.rfid_tag;
    if (dto.ear_tag !== undefined) updates.ear_tag = dto.ear_tag;
    if (dto.ear_tag_image_url !== undefined) updates.ear_tag_image_url = dto.ear_tag_image_url;
    if (dto.sire_animal_id !== undefined) updates.sire_animal_id = dto.sire_animal_id;
    if (dto.dam_animal_id !== undefined) updates.dam_animal_id = dto.dam_animal_id;
    if (dto.current_stage_id !== undefined) updates.current_stage_id = dto.current_stage_id;
    if (dto.current_batch_id !== undefined) updates.current_batch_id = dto.current_batch_id;
    if (dto.current_location_id !== undefined) updates.current_location_id = dto.current_location_id;
    if (dto.parity_count !== undefined) updates.parity_count = dto.parity_count;
    if (dto.total_piglets_born_live !== undefined) updates.total_piglets_born_live = dto.total_piglets_born_live;
    if (dto.total_piglets_weaned !== undefined) updates.total_piglets_weaned = dto.total_piglets_weaned;
    if (dto.current_bio_asset_value !== undefined) updates.current_bio_asset_value = dto.current_bio_asset_value?.toString() ?? null;
    if (dto.total_amortised !== undefined) updates.total_amortised = dto.total_amortised?.toString() ?? null;
    if (dto.book_value !== undefined) updates.book_value = dto.book_value?.toString() ?? null;
    if (dto.residual_value !== undefined) updates.residual_value = dto.residual_value?.toString() ?? null;
    if (dto.amortisation_monthly !== undefined) updates.amortisation_monthly = dto.amortisation_monthly?.toString() ?? null;
    if (dto.productive_life_start !== undefined) updates.productive_life_start = dto.productive_life_start;
    if (dto.expected_cull_date !== undefined) updates.expected_cull_date = dto.expected_cull_date;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.no_of_teats !== undefined) updates.no_of_teats = dto.no_of_teats;
    if (dto.tsi !== undefined) updates.tsi = dto.tsi?.toString() ?? null;
    if (dto.grading !== undefined) updates.grading = dto.grading;
    if (dto.serial_number !== undefined) updates.serial_number = dto.serial_number;
    if (dto.notes !== undefined) updates.notes = dto.notes;

    await this.db
      .update(schema.animalRegister)
      .set(updates)
      .where(eq(schema.animalRegister.animal_id, id));

    await this.auditService.log({
      tenantId,
      companyId: animal.company_id,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'animal_register',
      entityId: id,
      oldValues: animal,
      newValues: updates,
    });

    return this.findOne(id);
  }

  /**
   * Animals are never physically deleted (spec: "must never be physically deleted").
   * Disposal is its own action rather than a generic remove()/restore() toggle —
   * it records how/when/for-how-much the animal left, and computes the gain/loss
   * only when book_value is already known (it's a plain column in this phase, not
   * ledger-derived — see schema.ts's animal_register comment).
   */
  async dispose(id: string, dto: DisposeAnimalDto, tenantId: string, userPayload?: any) {
    return withTenantTransaction(this.cls, async () => {
    // Treatment posting locks this same animal after its batch. Disposal never
    // locks a batch, so there is no reverse batch/animal lock ordering.
    const [animal] = await this.db.select().from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, id), eq(schema.animalRegister.tenant_id, tenantId)))
      .for('update');
    if (!animal) throw new NotFoundException(`Animal '${id}' not found.`);

    if (!animal.is_active) {
      throw new BadRequestException(`Animal '${animal.animal_code}' has already been disposed.`);
    }

    if (dto.disposal_type === 'SLAUGHTERED') {
      await this.assertWithdrawalPeriodsElapsed(id, dto.disposal_date);
    }

    const bookValue = animal.book_value != null ? Number(animal.book_value) : null;
    const gainLoss = dto.disposal_value != null && bookValue != null ? dto.disposal_value - bookValue : null;
    const mappedStatus = DISPOSAL_STATUS_MAP[dto.disposal_type];

    const updates: any = {
      is_active: false,
      disposal_date: dto.disposal_date,
      disposal_type: dto.disposal_type,
      disposal_value: dto.disposal_value?.toString() ?? null,
      gain_loss_on_disposal: gainLoss != null ? gainLoss.toString() : null,
      notes: dto.notes !== undefined ? dto.notes : animal.notes,
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };
    if (mappedStatus) updates.status = mappedStatus;

    await this.db
      .update(schema.animalRegister)
      .set(updates)
      .where(eq(schema.animalRegister.animal_id, id));

    // Record IAS 41 Exit / Disposal in bio_asset_ledger for this tagged animal
    if (bookValue != null) {
      await this.db.insert(schema.bioAssetLedger).values({
        entry_id: randomUUID(),
        tenant_id: tenantId,
        company_id: animal.company_id,
        bio_asset_item_id: animal.item_id,
        animal_id: id,
        entry_type: 'TRANSFORMATION',
        document_no: animal.animal_code,
        posting_date: dto.disposal_date,
        stage: animal.current_stage_id || null,
        status: mappedStatus || 'CLOSED',
        quantity: '-1.0000',
        cost_amount: (-bookValue).toString(),
        cost_amount_each_unit: bookValue.toString(),
        costing_method: 'AMORTIZED_COST',
        nob_id: animal.nob_id,
        lob_id: animal.lob_id,
        created_by: userPayload?.userId || null,
      });
    }

    await this.auditService.log({
      tenantId,
      companyId: animal.company_id,
      userId: userPayload?.userId,
      action: 'DISPOSE',
      entityName: 'animal_register',
      entityId: id,
      oldValues: animal,
      newValues: updates,
    });

    return this.findOne(id);
    });
  }

  /**
   * Every breeding record this animal appears in, from either side.
   *
   * A boar is not a sow with a different flag: he appears on the mating as
   * boar_animal_id and never as sow_animal_id, so filtering on one column would
   * have shown an empty breeding history for both boars in the herd. The join
   * to the partner animal is what lets the screen name the other parent
   * without a second round trip per row.
   */
  async getBreedingHistory(animalId: string) {
    const animal = await this.findOne(animalId);
    const sow = aliasedTable(schema.animalRegister, 'sow');
    const boar = aliasedTable(schema.animalRegister, 'boar');

    const matings = await this.db
      .select({
        breeding_id: schema.breedingRecord.breeding_id,
        role: sql<string>`CASE WHEN ${schema.breedingRecord.sow_animal_id} = ${animalId} THEN 'DAM' ELSE 'SIRE' END`,
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
        sow_code: sow.animal_code,
        boar_code: boar.animal_code,
      })
      .from(schema.breedingRecord)
      .leftJoin(sow, eq(sow.animal_id, schema.breedingRecord.sow_animal_id))
      .leftJoin(boar, eq(boar.animal_id, schema.breedingRecord.boar_animal_id))
      .where(or(
        eq(schema.breedingRecord.sow_animal_id, animalId),
        eq(schema.breedingRecord.boar_animal_id, animalId),
      ))
      .orderBy(desc(schema.breedingRecord.mating_date));

    // Farrowings hang off the sow only — a boar's litters are reachable through
    // his matings, which the caller already has.
    const farrowings = await this.db
      .select()
      .from(schema.farrowingRecord)
      .where(eq(schema.farrowingRecord.sow_animal_id, animalId))
      .orderBy(desc(schema.farrowingRecord.farrowing_date));

    return { animal_code: animal.animal_code, animal_type: animal.animal_type, matings, farrowings };
  }

  async getBioAssetLedger(animalId: string) {
    await this.findOne(animalId);
    return this.db
      .select()
      .from(schema.bioAssetLedger)
      .where(eq(schema.bioAssetLedger.animal_id, animalId))
      .orderBy(schema.bioAssetLedger.posting_date);
  }

  /**
   * Move a group of animals to a stage in one action.
   *
   * A batch-level stage move deliberately carries only the animals in step with
   * the batch, which leaves the tail-enders behind by design. Advancing those
   * afterwards meant one modal per animal — and roughly a tenth of any cohort
   * are tail-enders, so that is the normal case, not an edge case.
   *
   * One animal failing its own validation (short of min_days_before_move, or
   * already disposed) must not block the rest, so each is attempted
   * independently and the refusals are reported back rather than thrown.
   */
  async bulkTransitionStage(
    dto: BulkTransitionAnimalStageDto,
    tenantId: string,
    userPayload?: any,
  ): Promise<{ moved: number; failed: Array<{ animal_id: string; reason: string }> }> {
    const animalIds = dto.animal_ids ?? [];
    if (animalIds.length === 0) {
      throw new BadRequestException('Select at least one animal to move.');
    }

    const failed: Array<{ animal_id: string; reason: string }> = [];
    let moved = 0;

    for (const animalId of animalIds) {
      try {
        await this.transitionStage(animalId, dto, tenantId, userPayload);
        moved += 1;
      } catch (err) {
        failed.push({
          animal_id: animalId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { moved, failed };
  }

  async transitionStage(id: string, dto: TransitionAnimalStageDto, tenantId: string, userPayload?: any) {
    const animal = await this.findOne(id);
    if (!animal.is_active) {
      throw new BadRequestException(`Cannot transition disposed or inactive animal '${animal.animal_code}'.`);
    }

    // 1. Verify destination stage
    const [destStage] = await this.db
      .select()
      .from(schema.stageMaster)
      .where(and(eq(schema.stageMaster.stage_id, dto.to_stage_id), eq(schema.stageMaster.tenant_id, tenantId)))
      .limit(1);

    if (!destStage) {
      throw new NotFoundException(`Destination Stage with ID '${dto.to_stage_id}' not found.`);
    }

    // 2. Minimum duration validation if moving from a stage that specifies min_days_before_move
    let currentStage: typeof schema.stageMaster.$inferSelect | undefined;
    if (animal.current_stage_id) {
      [currentStage] = await this.db
        .select()
        .from(schema.stageMaster)
        .where(eq(schema.stageMaster.stage_id, animal.current_stage_id))
        .limit(1);

      if (currentStage?.min_days_before_move && currentStage.min_days_before_move > 0) {
        const entryDate = animal.entry_date ? new Date(animal.entry_date) : new Date(animal.created_at);
        const transDate = new Date(dto.transition_date);
        const daysPassed = Math.floor((transDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysPassed < currentStage.min_days_before_move && !dto.reason) {
          throw new BadRequestException(
            `Minimum duration of ${currentStage.min_days_before_move} days required for '${currentStage.stage_name}' before transition (current: ${daysPassed} days). Provide a reason to override.`
          );
        }
      }
    }

    // 3. Optional location verification
    if (dto.to_location_id) {
      const [loc] = await this.db
        .select()
        .from(schema.locationMaster)
        .where(and(eq(schema.locationMaster.location_id, dto.to_location_id), eq(schema.locationMaster.tenant_id, tenantId)))
        .limit(1);
      if (!loc) {
        throw new NotFoundException(`Destination Location with ID '${dto.to_location_id}' not found.`);
      }
    }

    // 4. Optional batch verification
    if (dto.to_batch_id) {
      const [batch] = await this.db
        .select()
        .from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.batch_id, dto.to_batch_id), eq(schema.batchHeader.tenant_id, tenantId)))
        .limit(1);
      if (!batch) {
        throw new NotFoundException(`Destination Batch with ID '${dto.to_batch_id}' not found.`);
      }
    }

    // 5. Parity count increment check: if moving through weaning/dry from farrowing
    let newParity = animal.parity_count || 0;
    const destCode = destStage.stage_code?.toUpperCase();
    if (
      animal.gender === 'F' &&
      ['WEANING', 'DRY_SOW_GESTATION', 'FLUSH_SERVICE', 'DRY_PERIOD', 'GESTATION', 'FLUSH'].includes(destCode || '') &&
      currentStage?.stage_code?.toUpperCase()?.includes('FARROW')
    ) {
      newParity += 1;
    }

    const updates = {
      current_stage_id: dto.to_stage_id,
      current_location_id: dto.to_location_id !== undefined ? dto.to_location_id : animal.current_location_id,
      current_batch_id: dto.to_batch_id !== undefined ? dto.to_batch_id : animal.current_batch_id,
      parity_count: newParity,
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    await this.db
      .update(schema.animalRegister)
      .set(updates)
      .where(eq(schema.animalRegister.animal_id, id));

    await this.auditService.log({
      tenantId,
      companyId: animal.company_id,
      userId: userPayload?.userId,
      action: 'TRANSITION_STAGE',
      entityName: 'animal_register',
      entityId: id,
      oldValues: {
        current_stage_id: animal.current_stage_id,
        current_location_id: animal.current_location_id,
        current_batch_id: animal.current_batch_id,
      },
      newValues: {
        ...updates,
        transition_date: dto.transition_date,
        reason: dto.reason,
        remarks: dto.remarks,
      },
    });

    return this.findOne(id);
  }
}
