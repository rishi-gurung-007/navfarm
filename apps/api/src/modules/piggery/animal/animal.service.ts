import { withTenantTransaction } from '../../../common/tenant-transaction';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { farmScope, animalScopeConditions, batchScopeConditions, assertCompanyInScope, assertLobInScope, locationReferenceScopeConditions } from '../../../common/farm-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, or, like, desc, sql, isNull, inArray } from 'drizzle-orm';
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

/**
 * Client review, 2026-09-21: "Expected Cull Date should be more than Productive
 * Life Start, DOB" / "Productive Life Start should be less than Expected Cull
 * Date, more than DOB". Neither field had any cross-field check before this —
 * same gap the dob/entry_date check above closed on 2026-09-08, left open here.
 * Only compares pairs where both sides are actually supplied — none of the
 * three fields is mandatory, so a partial record is not an error.
 */
function assertProductionDatesOrdered(
  dob: string | null | undefined,
  productiveLifeStart: string | null | undefined,
  expectedCullDate: string | null | undefined,
): void {
  const parse = (label: string, value: string) => {
    const ms = Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(ms)) throw new BadRequestException(`${label} must be a valid date.`);
    return ms;
  };
  const dobMs = dob ? parse('Date of birth', dob) : null;
  const startMs = productiveLifeStart ? parse('Productive life start', productiveLifeStart) : null;
  const cullMs = expectedCullDate ? parse('Expected cull date', expectedCullDate) : null;

  if (dobMs !== null && startMs !== null && startMs <= dobMs) {
    throw new BadRequestException(
      `Productive life start '${productiveLifeStart!.slice(0, 10)}' must be after the date of birth '${dob!.slice(0, 10)}'.`,
    );
  }
  if (dobMs !== null && cullMs !== null && cullMs <= dobMs) {
    throw new BadRequestException(
      `Expected cull date '${expectedCullDate!.slice(0, 10)}' must be after the date of birth '${dob!.slice(0, 10)}'.`,
    );
  }
  if (startMs !== null && cullMs !== null && cullMs <= startMs) {
    throw new BadRequestException(
      `Expected cull date '${expectedCullDate!.slice(0, 10)}' must be after productive life start '${productiveLifeStart!.slice(0, 10)}'.`,
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

  /*
   * The lookups below answer "not found" for a row that exists but lies outside
   * the caller's scope or the animal's company, exactly as for one that does not
   * exist. They used to be tenant-wide existence checks, which let a caller
   * probe other farms' and companies' ids and read another company's receipt
   * rate into an acquisition cost (recovery review C2).
   */

  /** Breeds may be the company's own or a tenant template (company_id NULL). */
  private breedQuery(breedId: string, tenantId: string, companyId: string) {
    return this.db.select().from(schema.breedMaster).where(and(
      eq(schema.breedMaster.breed_id, breedId),
      eq(schema.breedMaster.tenant_id, tenantId),
      or(eq(schema.breedMaster.company_id, companyId), isNull(schema.breedMaster.company_id)),
    ));
  }

  private scopedAnimalQuery(animalId: string, tenantId: string, companyId: string) {
    return this.db.select().from(schema.animalRegister).where(and(
      eq(schema.animalRegister.animal_id, animalId),
      eq(schema.animalRegister.tenant_id, tenantId),
      eq(schema.animalRegister.company_id, companyId),
      ...animalScopeConditions(farmScope(this.cls)),
    ));
  }

  private scopedBatchQuery(batchId: string, tenantId: string, companyId: string) {
    return this.db.select().from(schema.batchHeader).where(and(
      eq(schema.batchHeader.batch_id, batchId),
      eq(schema.batchHeader.tenant_id, tenantId),
      eq(schema.batchHeader.company_id, companyId),
      isNull(schema.batchHeader.deleted_at),
      ...batchScopeConditions(farmScope(this.cls)),
    ));
  }

  /**
   * An individual animal may only be carried by a Registered Animals batch.
   * Placement is validated as one effective state rather than as independent
   * foreign keys: otherwise a valid batch on one farm and a valid pen on a
   * second farm can be combined into a row that belongs to neither.
   */
  private async assertOperationalPlacement(
    animal: {
      company_id: string;
      nob_id: string;
      lob_id: string;
      breed_id: string;
      current_batch_id?: string | null;
      current_location_id?: string | null;
    },
    tenantId: string,
    breedId = animal.breed_id,
  ): Promise<{ farmId: string }> {
    let batch: typeof schema.batchHeader.$inferSelect | undefined;
    if (animal.current_batch_id) {
      [batch] = await this.db
        .select()
        .from(schema.batchHeader)
        .where(and(
          eq(schema.batchHeader.batch_id, animal.current_batch_id),
          eq(schema.batchHeader.tenant_id, tenantId),
          eq(schema.batchHeader.company_id, animal.company_id),
          eq(schema.batchHeader.nob_id, animal.nob_id),
          eq(schema.batchHeader.lob_id, animal.lob_id),
          isNull(schema.batchHeader.deleted_at),
        ))
        .limit(1);
      if (!batch) {
        throw new NotFoundException(`Current Batch with ID '${animal.current_batch_id}' not found.`);
      }
      if (batch.animal_tracking !== 'REGISTERED') {
        throw new BadRequestException('An individual Animal row cannot be placed in a Count Only Batch.');
      }
      if (!batch.farm_id) {
        throw new BadRequestException('The animal Batch has no farm, so its placement is incomplete.');
      }
    }

    let location: typeof schema.locationMaster.$inferSelect | undefined;
    let locationFarmId: string | null = null;
    if (animal.current_location_id) {
      [location] = await this.db
        .select()
        .from(schema.locationMaster)
        .where(and(
          eq(schema.locationMaster.location_id, animal.current_location_id),
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.company_id, animal.company_id),
          or(eq(schema.locationMaster.nob_id, animal.nob_id), isNull(schema.locationMaster.nob_id)),
          or(eq(schema.locationMaster.lob_id, animal.lob_id), isNull(schema.locationMaster.lob_id)),
          eq(schema.locationMaster.is_active, true),
          isNull(schema.locationMaster.deleted_at),
        ))
        .limit(1);
      if (!location) {
        throw new NotFoundException(`Current Location with ID '${animal.current_location_id}' not found.`);
      }
      if (location.location_type !== 'PEN') {
        throw new BadRequestException('Animals can only be placed in a Pen.');
      }
      locationFarmId = location.parent_location_id === null ? location.location_id : location.farm_id;
      if (!locationFarmId) {
        throw new BadRequestException('The animal Location has no farm, so its placement is incomplete.');
      }
    }

    if (batch?.farm_id && locationFarmId && batch.farm_id !== locationFarmId) {
      throw new BadRequestException('The animal Batch and Location must belong to the same farm.');
    }
    const farmId = batch?.farm_id ?? locationFarmId;
    if (!farmId) {
      throw new BadRequestException('The animal placement does not resolve to a farm.');
    }

    const scope = farmScope(this.cls);
    assertCompanyInScope(scope, animal.company_id);
    assertLobInScope(scope, animal.lob_id);
    if (scope.farmId && scope.farmId !== farmId) {
      throw new ForbiddenException('Animal placement is not on your active farm.');
    }

    const [farm] = await this.db
      .select()
      .from(schema.locationMaster)
      .where(and(
        eq(schema.locationMaster.location_id, farmId),
        eq(schema.locationMaster.tenant_id, tenantId),
        eq(schema.locationMaster.company_id, animal.company_id),
        eq(schema.locationMaster.location_type, 'FARM'),
        isNull(schema.locationMaster.parent_location_id),
        eq(schema.locationMaster.is_active, true),
        isNull(schema.locationMaster.deleted_at),
      ))
      .limit(1);
    if (!farm) {
      throw new NotFoundException(`Farm with ID '${farmId}' is not active in this animal's operational scope.`);
    }
    if (batch?.breed_id && batch.breed_id !== breedId) {
      throw new BadRequestException('The animal Breed must match its Batch Breed profile.');
    }

    const [breed] = await this.db
      .select()
      .from(schema.breedMaster)
      .where(and(
        eq(schema.breedMaster.breed_id, breedId),
        eq(schema.breedMaster.tenant_id, tenantId),
        eq(schema.breedMaster.company_id, animal.company_id),
        eq(schema.breedMaster.nob_id, animal.nob_id),
        eq(schema.breedMaster.lob_id, animal.lob_id),
        eq(schema.breedMaster.location_id, farmId),
        eq(schema.breedMaster.is_active, true),
        isNull(schema.breedMaster.deleted_at),
      ))
      .limit(1);
    if (!breed) {
      throw new NotFoundException(`Breed with ID '${breedId}' is not available for this animal's farm and operational scope.`);
    }
    return { farmId };
  }

  private scopedStageQuery(
    stageId: string,
    tenantId: string,
    animal: { company_id: string; nob_id: string; lob_id: string },
  ) {
    return this.db.select().from(schema.stageMaster).where(and(
      eq(schema.stageMaster.stage_id, stageId),
      eq(schema.stageMaster.tenant_id, tenantId),
      eq(schema.stageMaster.company_id, animal.company_id),
      eq(schema.stageMaster.nob_id, animal.nob_id),
      eq(schema.stageMaster.lob_id, animal.lob_id),
      eq(schema.stageMaster.is_active, true),
      isNull(schema.stageMaster.deleted_at),
    ));
  }

  private assertPlacementFieldUnchanged(
    requested: string | null | undefined,
    current: string | null | undefined,
    label: string,
    route: string,
  ): void {
    if (requested !== undefined && requested !== current) {
      throw new BadRequestException(`${label} changes must use the ${route}.`);
    }
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
    // Number issuance, the Animal row, its IAS 41 opening ledger entry, and
    // audit are one creation. Any failure must roll the whole operation back.
    return withTenantTransaction(this.cls, async () => {
    assertGiltTeatCount(dto.animal_type, dto.no_of_teats);
    // Resolved here, beside the other cheap guards, rather than down at the
    // insert: generateAnimalCode() consumes a number series, and a create that
    // fails after it has run leaves a permanent hole in the animal codes. One
    // did — a create refused for an out-of-range age still burned PIG-2026-0022,
    // and the register jumped straight from 0021 to 0023.
    const ageAtEntryWeeks = resolveAgeAtEntryWeeks(dto.dob, dto.entry_date, dto.age_at_entry_weeks);
    assertProductionDatesOrdered(dto.dob, dto.productive_life_start, dto.expected_cull_date);

    const scope = farmScope(this.cls);
    // Every refusal below lands before the insert: the create used to write the
    // row under the caller's company and LOB and only then 404 on read-back.
    assertCompanyInScope(scope, dto.company_id);
    // A restricted user's animal must stand on a farm, or no farm scope would
    // ever show it again — including to the user who created it.
    const requestScope = this.cls.get('farmScope');
    if (requestScope && !dto.current_location_id && !dto.current_batch_id) {
      throw new BadRequestException('Choose where this animal is: a batch or a location on your farm.');
    }

    await this.assertExists(
      this.db.select().from(schema.companyMaster).where(and(
        eq(schema.companyMaster.company_id, dto.company_id),
        eq(schema.companyMaster.tenant_id, tenantId),
      )),
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
    // After resolution, because an explicit dto.lob_id wins it and must not
    // carry a restricted user into another line of business.
    assertLobInScope(scope, lobId);

    await this.assertExists(
      this.db.select().from(schema.nobMaster).where(eq(schema.nobMaster.nob_id, nobId)),
      'NOB', nobId,
    );
    await this.assertExists(
      this.db.select().from(schema.lobMaster).where(eq(schema.lobMaster.lob_id, lobId)),
      'LOB', lobId,
    );
    await this.assertExists(this.breedQuery(dto.breed_id, tenantId, dto.company_id), 'Breed', dto.breed_id);
    await this.assertExists(
      this.db.select().from(schema.itemMaster).where(and(
        eq(schema.itemMaster.item_id, dto.item_id),
        eq(schema.itemMaster.tenant_id, tenantId),
        eq(schema.itemMaster.company_id, dto.company_id),
      )),
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
      // A receipt reaches a farm through the warehouse it was received into.
      await this.assertExists(
        this.db.select().from(schema.goodsReceipt).where(and(
          eq(schema.goodsReceipt.receipt_id, dto.source_receipt_id),
          eq(schema.goodsReceipt.tenant_id, tenantId),
          eq(schema.goodsReceipt.company_id, dto.company_id),
          ...locationReferenceScopeConditions(scope, schema.goodsReceipt.warehouse_id),
        )),
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
      await this.assertExists(this.scopedBatchQuery(dto.source_batch_id, tenantId, dto.company_id), 'Batch', dto.source_batch_id);
    }
    if (dto.sire_animal_id) {
      await this.assertExists(this.scopedAnimalQuery(dto.sire_animal_id, tenantId, dto.company_id), 'Sire animal', dto.sire_animal_id);
    }
    if (dto.dam_animal_id) {
      await this.assertExists(this.scopedAnimalQuery(dto.dam_animal_id, tenantId, dto.company_id), 'Dam animal', dto.dam_animal_id);
    }
    let placementFarmId: string | null = null;
    if (dto.current_batch_id || dto.current_location_id) {
      const placement = await this.assertOperationalPlacement({
        company_id: dto.company_id,
        nob_id: nobId,
        lob_id: lobId,
        breed_id: dto.breed_id,
        current_batch_id: dto.current_batch_id,
        current_location_id: dto.current_location_id,
      }, tenantId);
      placementFarmId = placement.farmId;
      if (dto.current_batch_id && !dto.current_stage_id) {
        throw new BadRequestException('Choose the animal\'s current Stage when placing it in a Batch.');
      }
    }
    if (dto.current_stage_id) {
      await this.assertExists(
        this.scopedStageQuery(dto.current_stage_id, tenantId, {
          company_id: dto.company_id,
          nob_id: nobId,
          lob_id: lobId,
        }),
        'Stage', dto.current_stage_id,
      );
    }
    // The animal's farm is its location's, or its batch's when it has no
    // location (animalOnFarm) — a farmless batch leaves it on no farm at all.
    if (requestScope && !placementFarmId) {
      throw new BadRequestException('Choose where this animal is: a batch or a location on your farm.');
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
      // A teat count is recorded for a female only; one sent for a male is dropped.
      no_of_teats: dto.gender === 'F' ? dto.no_of_teats ?? null : null,
      expected_cull_date: dto.expected_cull_date || null,
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
      // The resolved values: the dto's are absent whenever the company's
      // operational areas supplied them, which left the ledger row without a LOB.
      nob_id: nobId,
      lob_id: lobId,
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
    });
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
          ...animalScopeConditions(farmScope(this.cls)),
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
      .where(and(eq(schema.animalRegister.animal_id, id), ...animalScopeConditions(farmScope(this.cls))))
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
    conditions.push(...animalScopeConditions(farmScope(this.cls)));
    if (query.breedId) conditions.push(eq(schema.animalRegister.breed_id, query.breedId));
    if (query.animalType) conditions.push(eq(schema.animalRegister.animal_type, query.animalType));
    if (query.status) conditions.push(eq(schema.animalRegister.status, query.status));
    if (query.currentBatchId) conditions.push(eq(schema.animalRegister.current_batch_id, query.currentBatchId));
    if (query.unassignedOnly) conditions.push(isNull(schema.animalRegister.current_batch_id));
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

    this.assertPlacementFieldUnchanged(dto.current_batch_id, animal.current_batch_id, 'Batch', 'transfer workflow');
    this.assertPlacementFieldUnchanged(dto.current_location_id, animal.current_location_id, 'Location', 'transfer workflow');
    this.assertPlacementFieldUnchanged(dto.current_stage_id, animal.current_stage_id, 'Stage', 'stage transition workflow');

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

    // Bound to the animal's own company and the caller's scope — see the note above breedQuery().
    if (dto.breed_id && dto.breed_id !== animal.breed_id) {
      await this.assertOperationalPlacement(animal, tenantId, dto.breed_id);
    }
    if (dto.sire_animal_id) {
      if (dto.sire_animal_id === id) {
        throw new BadRequestException('An animal cannot be its own sire.');
      }
      await this.assertExists(this.scopedAnimalQuery(dto.sire_animal_id, tenantId, animal.company_id), 'Sire animal', dto.sire_animal_id);
    }
    if (dto.dam_animal_id) {
      if (dto.dam_animal_id === id) {
        throw new BadRequestException('An animal cannot be its own dam.');
      }
      await this.assertExists(this.scopedAnimalQuery(dto.dam_animal_id, tenantId, animal.company_id), 'Dam animal', dto.dam_animal_id);
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
    assertProductionDatesOrdered(
      dto.dob !== undefined ? dto.dob : animal.dob,
      dto.productive_life_start !== undefined ? dto.productive_life_start : animal.productive_life_start,
      dto.expected_cull_date !== undefined ? dto.expected_cull_date : animal.expected_cull_date,
    );
    if (dto.rfid_tag !== undefined) updates.rfid_tag = dto.rfid_tag;
    if (dto.ear_tag !== undefined) updates.ear_tag = dto.ear_tag;
    if (dto.ear_tag_image_url !== undefined) updates.ear_tag_image_url = dto.ear_tag_image_url;
    if (dto.sire_animal_id !== undefined) updates.sire_animal_id = dto.sire_animal_id;
    if (dto.dam_animal_id !== undefined) updates.dam_animal_id = dto.dam_animal_id;
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
    if (dto.no_of_teats !== undefined) updates.no_of_teats = animal.gender === 'F' ? dto.no_of_teats : null;
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
      .where(and(
        eq(schema.animalRegister.animal_id, id),
        eq(schema.animalRegister.tenant_id, tenantId),
        ...animalScopeConditions(farmScope(this.cls)),
      ))
      .for('update');
    if (!animal) throw new NotFoundException(`Animal '${id}' not found.`);

    if (!animal.is_active) {
      throw new BadRequestException(`Animal '${animal.animal_code}' has already been disposed.`);
    }

    if (dto.disposal_type === 'SLAUGHTERED') {
      await this.assertWithdrawalPeriodsElapsed(id, dto.disposal_date);
    }

    // Reason Master Template, MORTALITY category: a DIED disposal with a reason
    // attached must use one of the 21 mortality codes, not a cull/return/scan
    // reason meant for a different action — the category is the only signal
    // this catalog carries for "which picker should offer this row".
    if (dto.disposal_reason_id) {
      const [reason] = await this.db.select().from(schema.reasonMaster).where(and(
        eq(schema.reasonMaster.reason_id, dto.disposal_reason_id),
        eq(schema.reasonMaster.tenant_id, tenantId),
        eq(schema.reasonMaster.is_active, true),
        ...masterScopeConditions(this.cls, schema.reasonMaster, animal.company_id),
      )).limit(1);
      if (!reason) throw new BadRequestException(`Reason '${dto.disposal_reason_id}' is not available in this workspace.`);
      if (dto.disposal_type === 'DIED' && reason.category !== 'MORTALITY') {
        throw new BadRequestException(`Reason '${reason.reason_name}' is category ${reason.category}, not MORTALITY — a DIED disposal needs a mortality reason.`);
      }
    }

    const bookValue = animal.book_value != null ? Number(animal.book_value) : null;
    const gainLoss = dto.disposal_value != null && bookValue != null ? dto.disposal_value - bookValue : null;
    const mappedStatus = DISPOSAL_STATUS_MAP[dto.disposal_type];

    const updates: any = {
      is_active: false,
      disposal_date: dto.disposal_date,
      disposal_type: dto.disposal_type,
      disposal_reason_id: dto.disposal_reason_id ?? null,
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
        boar_parity_number: schema.breedingRecord.boar_parity_number,
        semen_dose_qty: schema.breedingRecord.semen_dose_qty,
        semen_lot_id: schema.breedingRecord.semen_lot_id,
        notes: schema.breedingRecord.notes,
        batch_id: schema.breedingRecord.batch_id,
        batch_no: schema.batchHeader.batch_no,
        sow_code: sow.animal_code,
        boar_code: boar.animal_code,
      })
      .from(schema.breedingRecord)
      .leftJoin(sow, eq(sow.animal_id, schema.breedingRecord.sow_animal_id))
      .leftJoin(boar, eq(boar.animal_id, schema.breedingRecord.boar_animal_id))
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.breedingRecord.batch_id))
      .where(or(
        eq(schema.breedingRecord.sow_animal_id, animalId),
        eq(schema.breedingRecord.boar_animal_id, animalId),
      ))
      .orderBy(desc(schema.breedingRecord.mating_date));

    const breedingIds = matings.map((m) => m.breeding_id);
    // A female owns her farrowing rows directly. A male reaches the resulting
    // litter through the breeding_id of the service in which he was the sire.
    // This keeps the panel sex-specific without hiding the outcome of a boar's
    // mating after the sow farrows.
    const farrowings = await this.db
      .select()
      .from(schema.farrowingRecord)
      .where(animal.gender === 'M'
        ? (breedingIds.length ? inArray(schema.farrowingRecord.breeding_id, breedingIds) : sql`false`)
        : eq(schema.farrowingRecord.sow_animal_id, animalId))
      .orderBy(desc(schema.farrowingRecord.farrowing_date));

    const auditMovements = await this.db
      .select({
        action: schema.auditLog.action,
        old_values: schema.auditLog.old_values,
        new_values: schema.auditLog.new_values,
        occurred_at: schema.auditLog.created_at,
      })
      .from(schema.auditLog)
      .where(and(
        eq(schema.auditLog.tenant_id, animal.tenant_id),
        eq(schema.auditLog.entity_name, 'animal_register'),
        eq(schema.auditLog.entity_id, animalId),
      ))
      .orderBy(desc(schema.auditLog.created_at));

    const jsonObject = (value: unknown): Record<string, unknown> => {
      if (!value) return {};
      if (typeof value === 'string') {
        try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
      }
      return typeof value === 'object' ? value as Record<string, unknown> : {};
    };
    const referencedIds = (key: string) => [...new Set(auditMovements.flatMap((movement) => {
      const oldId = jsonObject(movement.old_values)[key];
      const newId = jsonObject(movement.new_values)[key];
      return [oldId, newId].filter((id): id is string => typeof id === 'string' && id.length > 0);
    }))];
    const stageIds = referencedIds('current_stage_id');
    const batchIds = referencedIds('current_batch_id');
    const locationIds = referencedIds('current_location_id');
    const [stageLabels, batchLabels, locationLabels] = await Promise.all([
      stageIds.length
        ? this.db.select({ id: schema.stageMaster.stage_id, label: schema.stageMaster.stage_name }).from(schema.stageMaster).where(inArray(schema.stageMaster.stage_id, stageIds))
        : [],
      batchIds.length
        ? this.db.select({ id: schema.batchHeader.batch_id, label: schema.batchHeader.batch_no }).from(schema.batchHeader).where(inArray(schema.batchHeader.batch_id, batchIds))
        : [],
      locationIds.length
        ? this.db.select({ id: schema.locationMaster.location_id, label: schema.locationMaster.location_code }).from(schema.locationMaster).where(inArray(schema.locationMaster.location_id, locationIds))
        : [],
    ]);

    // Lineage for the Traceability timeline and the Details tab: the parents
    // this animal was registered with, and the animals registered with it as a
    // parent. Codes only — the ids are meaningless to a reader.
    const parentIds = [animal.sire_animal_id, animal.dam_animal_id].filter((id): id is string => Boolean(id));
    const [parents, offspring] = await Promise.all([
      parentIds.length
        ? this.db.select({ animal_id: schema.animalRegister.animal_id, animal_code: schema.animalRegister.animal_code })
          .from(schema.animalRegister).where(inArray(schema.animalRegister.animal_id, parentIds))
        : [],
      this.db
        .select({
          animal_id: schema.animalRegister.animal_id,
          animal_code: schema.animalRegister.animal_code,
          dob: schema.animalRegister.dob,
          entry_date: schema.animalRegister.entry_date,
          gender: schema.animalRegister.gender,
        })
        .from(schema.animalRegister)
        .where(and(
          eq(schema.animalRegister.tenant_id, animal.tenant_id),
          animal.gender === 'M'
            ? eq(schema.animalRegister.sire_animal_id, animalId)
            : eq(schema.animalRegister.dam_animal_id, animalId),
          // Offspring sent to another farm stay behind that farm's boundary.
          ...animalScopeConditions(farmScope(this.cls)),
        ))
        .orderBy(desc(schema.animalRegister.entry_date)),
    ]);
    const parentCode = (id: string | null) => (id ? parents.find((p) => p.animal_id === id)?.animal_code ?? null : null);

    // The current placement, named, for the Details tab — the register row
    // carries only ids.
    const [breedRow, stageRow, batchRow, locationRow] = await Promise.all([
      this.db.select({ name: schema.breedMaster.breed_name }).from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, animal.breed_id)).limit(1),
      animal.current_stage_id
        ? this.db.select({ name: schema.stageMaster.stage_name }).from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, animal.current_stage_id)).limit(1)
        : [],
      animal.current_batch_id
        ? this.db.select({ name: schema.batchHeader.batch_no }).from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, animal.current_batch_id)).limit(1)
        : [],
      animal.current_location_id
        ? this.db.select({ code: schema.locationMaster.location_code, name: schema.locationMaster.location_name }).from(schema.locationMaster).where(eq(schema.locationMaster.location_id, animal.current_location_id)).limit(1)
        : [],
    ]);

    const fromBatch = aliasedTable(schema.batchHeader, 'from_batch');
    const toBatch = aliasedTable(schema.batchHeader, 'to_batch');
    const fromPen = aliasedTable(schema.locationMaster, 'from_pen');
    const toPen = aliasedTable(schema.locationMaster, 'to_pen');
    const transfers = await this.db
      .select({
        transfer_id: schema.batchTransfer.transfer_id,
        transfer_no: schema.batchTransfer.transfer_no,
        transfer_date: schema.batchTransfer.transfer_date,
        reason: schema.batchTransfer.reason,
        remarks: schema.batchTransferLine.remarks,
        from_batch_no: fromBatch.batch_no,
        to_batch_no: toBatch.batch_no,
        from_pen_code: fromPen.location_code,
        to_pen_code: toPen.location_code,
      })
      .from(schema.batchTransferLine)
      .innerJoin(schema.batchTransfer, eq(schema.batchTransfer.transfer_id, schema.batchTransferLine.transfer_id))
      .leftJoin(fromBatch, eq(fromBatch.batch_id, schema.batchTransfer.from_batch_id))
      .leftJoin(toBatch, eq(toBatch.batch_id, schema.batchTransfer.to_batch_id))
      .leftJoin(fromPen, eq(fromPen.location_id, schema.batchTransferLine.from_location_id))
      .leftJoin(toPen, eq(toPen.location_id, schema.batchTransferLine.to_location_id))
      .where(and(
        eq(schema.batchTransferLine.animal_id, animalId),
        eq(schema.batchTransfer.status, 'POSTED'),
      ))
      .orderBy(desc(schema.batchTransfer.transfer_date));

    return {
      animal_code: animal.animal_code,
      animal_type: animal.animal_type,
      gender: animal.gender,
      matings,
      farrowings,
      movements: auditMovements,
      transfers,
      lineage: {
        sire_code: parentCode(animal.sire_animal_id),
        dam_code: parentCode(animal.dam_animal_id),
        offspring,
      },
      current_labels: {
        breed: breedRow[0]?.name ?? null,
        stage: stageRow[0]?.name ?? null,
        batch: batchRow[0]?.name ?? null,
        location: locationRow[0] ? `${locationRow[0].code} — ${locationRow[0].name}` : null,
      },
      traceability_labels: {
        stages: Object.fromEntries(stageLabels.map((value) => [value.id, value.label])),
        batches: Object.fromEntries(batchLabels.map((value) => [value.id, value.label])),
        locations: Object.fromEntries(locationLabels.map((value) => [value.id, value.label])),
      },
    };
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

    // This route records an in-place stage change. Batch/location movement has
    // approvals, lineage and accounting of its own and must not be smuggled
    // through an optional field on the stage DTO. Re-sending the current value
    // is harmless and keeps existing clients idempotent.
    this.assertPlacementFieldUnchanged(dto.to_batch_id, animal.current_batch_id, 'Batch', 'transfer workflow');
    this.assertPlacementFieldUnchanged(dto.to_location_id, animal.current_location_id, 'Location', 'transfer workflow');
    if (!animal.current_batch_id) {
      throw new BadRequestException('An animal must be placed in a Registered Animals Batch before its stage can change.');
    }

    // 1. Verify destination stage
    const [destStage] = await this.scopedStageQuery(dto.to_stage_id, tenantId, animal).limit(1);

    if (!destStage) {
      throw new NotFoundException(`Destination Stage with ID '${dto.to_stage_id}' not found.`);
    }

    // 2. Minimum duration validation if moving from a stage that specifies min_days_before_move
    let currentStage: typeof schema.stageMaster.$inferSelect | undefined;
    if (animal.current_stage_id) {
      [currentStage] = await this.scopedStageQuery(animal.current_stage_id, tenantId, animal).limit(1);

      if (!currentStage) {
        throw new NotFoundException(`Current Stage with ID '${animal.current_stage_id}' not found.`);
      }

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

    // 3. Validate the effective persisted placement as a unit. This catches
    // Count Only batches, cross-LOB references and Batch/location farm splits
    // even when the caller sends no destination placement fields.
    await this.assertOperationalPlacement(animal, tenantId);

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
      current_location_id: animal.current_location_id,
      current_batch_id: animal.current_batch_id,
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
