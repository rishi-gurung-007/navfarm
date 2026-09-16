import { masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, ne, inArray, sql, getTableColumns, count, asc, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import {
  CreateSpeciesDto,
  UpdateSpeciesDto,
  QuerySpeciesDto,
  CreateBreedDto,
  UpdateBreedDto,
  QueryBreedDto,
  CreateBreedLifecycleStageDto,
  UpdateBreedLifecycleStageDto,
  QueryBreedLifecycleStageDto,
} from './dto/breed.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';
import {
  assertLocationOnActiveFarm,
  assertLobInScope,
  farmScope,
  restrictedScopeConditions,
} from '../../../common/farm-scope';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class BreedService {
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

  /** Resolves by breed_type first (e.g. BREED_BROILER), then the master-alone BREED series, else manual. */
  private async resolveBreedCode(dto: CreateBreedDto, tenantId: string, companyId: string | null, executor: MySql2Database<typeof schema> = this.db): Promise<string> {
    if (dto.location_id) await this.requireRootFarm(dto.location_id, tenantId, companyId, executor);
    const seriesCode = await this.numberSeriesService.resolveSeriesFor('BREED', dto.breed_type, tenantId, companyId, executor);
    if (!seriesCode) {
      if (!dto.breed_code) {
        throw new BadRequestException('Enter a breed code or configure a breed number series.');
      }
      return dto.breed_code.toUpperCase();
    }
    const series = await this.numberSeriesService.lockSeries(seriesCode, tenantId, companyId, executor);
    if (series.allow_manual && dto.breed_code) {
      return dto.breed_code.toUpperCase();
    }
    // The record goes to the generator so a series configured with
    // code_segments / prefix_field can read its own fields — breed_name is the
    // one Rishi named, giving LARGEWHITE-0001 rather than BRD-0001.
    return this.numberSeriesService.generateNext(
      seriesCode,
      tenantId,
      companyId,
      executor,
      dto as unknown as Record<string, unknown>,
    );
  }

  private async requireRootFarm(locationId: string, tenantId: string, companyId: string | null, executor = this.db) {
    const [location] = await executor.select().from(schema.locationMaster).where(and(
      eq(schema.locationMaster.location_id, locationId), eq(schema.locationMaster.tenant_id, tenantId),
      companyId ? eq(schema.locationMaster.company_id, companyId) : isNull(schema.locationMaster.company_id),
      eq(schema.locationMaster.is_active, true), isNull(schema.locationMaster.deleted_at),
    )).limit(1);
    if (!location || location.location_type !== 'FARM' || location.parent_location_id !== null) {
      throw new BadRequestException('Breed location must be an active, first-level farm without a parent in this workspace.');
    }
    return location;
  }

  // ========================================================
  // SPECIES MASTER CRUD
  // ========================================================

  async createSpecies(dto: CreateSpeciesDto, tenantId: string, userPayload?: any) {
    const companyId = dto.company_id || null;
    const speciesCode = await this.numberSeriesService.resolveNewCode('SPECIES', dto.species_code, tenantId, companyId, undefined, dto as unknown as Record<string, unknown>);

    // Check duplicate code
    const duplicateConditions = [
      eq(schema.speciesMaster.tenant_id, tenantId),
      eq(schema.speciesMaster.species_code, speciesCode),
      isNull(schema.speciesMaster.deleted_at),
    ];
    if (companyId) {
      duplicateConditions.push(eq(schema.speciesMaster.company_id, companyId));
    } else {
      duplicateConditions.push(isNull(schema.speciesMaster.company_id));
    }

    const existing = await this.db
      .select()
      .from(schema.speciesMaster)
      .where(and(...duplicateConditions))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Species with code '${dto.species_code}' already exists.`);
    }

    const speciesId = randomUUID();
    const newSpecies = {
      species_id: speciesId,
      tenant_id: tenantId,
      company_id: companyId,
      species_code: speciesCode,
      species_name: dto.species_name,
      status: 'ACTIVE',
      is_active: true,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.speciesMaster).values(newSpecies);

    await this.auditService.log({
      tenantId,
      companyId: companyId || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'species_master',
      entityId: speciesId,
      newValues: newSpecies,
    });

    return this.findOneSpecies(speciesId);
  }

  async findOneSpecies(id: string) {
    const [species] = await this.db
      .select()
      .from(schema.speciesMaster)
      .where(and(eq(schema.speciesMaster.species_id, id), isNull(schema.speciesMaster.deleted_at)))
      .limit(1);

    if (!species) {
      throw new NotFoundException(`Species with ID '${id}' not found.`);
    }

    return species;
  }

  async findAllSpecies(query: QuerySpeciesDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.speciesMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.speciesMaster, query.companyId));
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.speciesMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.speciesMaster.species_code, `%${query.search}%`),
          like(schema.speciesMaster.species_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.speciesMaster, query.filter));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.speciesMaster)
      .where(and(...conditions))
      .orderBy(listOrderBy(schema.speciesMaster, query, schema.speciesMaster.species_code))
      .limit(limit)
      .offset(offset);
  }

  async updateSpecies(id: string, dto: UpdateSpeciesDto, tenantId: string, userPayload?: any) {
    const species = await this.findOneSpecies(id);

    if (dto.species_code && dto.species_code.toUpperCase() !== species.species_code) {
      const duplicateConditions = [
        eq(schema.speciesMaster.tenant_id, tenantId),
        eq(schema.speciesMaster.species_code, dto.species_code.toUpperCase()),
        ne(schema.speciesMaster.species_id, id),
        isNull(schema.speciesMaster.deleted_at),
      ];
      if (species.company_id) {
        duplicateConditions.push(eq(schema.speciesMaster.company_id, species.company_id));
      } else {
        duplicateConditions.push(isNull(schema.speciesMaster.company_id));
      }

      const existing = await this.db
        .select()
        .from(schema.speciesMaster)
        .where(and(...duplicateConditions))
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictException(`Species with code '${dto.species_code}' already exists.`);
      }
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    // SPECIES is a named series (code = the uppercased name) and breeds point at
    // a species by UUID, so a rename's code follows freely — no string-held
    // reference can go stale.
    if (dto.species_name !== undefined && dto.species_name.trim() !== species.species_name
        && species.species_code === species.species_name.replaceAll(/\s+/g, '_').toUpperCase()) {
      updates.species_code = await this.numberSeriesService.renameCode(
        'SPECIES',
        { ...species, species_name: dto.species_name },
        tenantId,
        species.company_id,
      );
    } else if (dto.species_code !== undefined && dto.species_code.toUpperCase() !== species.species_code) {
      throw new ConflictException(
        `Species codes follow the number series and cannot be typed over. Rename the species' name and the code follows it.`,
      );
    }
    if (dto.species_name !== undefined) updates.species_name = dto.species_name;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;

    await this.db
      .update(schema.speciesMaster)
      .set(updates)
      .where(eq(schema.speciesMaster.species_id, id));

    await this.auditService.log({
      tenantId,
      companyId: species.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'species_master',
      entityId: id,
      oldValues: species,
      newValues: updates,
    });

    return this.findOneSpecies(id);
  }

  async removeSpecies(id: string, tenantId: string, userPayload?: any) {
    const species = await this.findOneSpecies(id);
    const deletedTime = toMysqlTimestamp();

    // Soft delete
    await this.db
      .update(schema.speciesMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.speciesMaster.species_id, id));

    await this.auditService.log({
      tenantId,
      companyId: species.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'species_master',
      entityId: id,
      oldValues: species,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Species '${species.species_name}' has been soft-deleted.` };
  }

  async restoreSpecies(id: string, tenantId: string, userPayload?: any) {
    const [species] = await this.db
      .select()
      .from(schema.speciesMaster)
      .where(eq(schema.speciesMaster.species_id, id))
      .limit(1);

    if (!species) {
      throw new NotFoundException(`Species with ID '${id}' not found.`);
    }

    if (!species.deleted_at) {
      return species;
    }

    await this.db
      .update(schema.speciesMaster)
      .set({
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.speciesMaster.species_id, id));

    await this.auditService.log({
      tenantId,
      companyId: species.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'species_master',
      entityId: id,
      oldValues: species,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOneSpecies(id);
  }

  // ========================================================
  // BREED MASTER CRUD
  // ========================================================

  async createBreed(dto: CreateBreedDto, tenantId: string, userPayload?: any) {
    const companyId = dto.company_id || null;
    if (!dto.location_id) {
      throw new BadRequestException('Select the farm where this breed profile applies.');
    }
    await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.location_id, 'Breed farm');

    // Verify species exists
    const species = await this.findOneSpecies(dto.species_id);

    // NOB/LOB are no longer asked on the form — derive them from the company's
    // operational areas (an explicit dto value, if a caller still sends one,
    // wins). breed_master.nob_id is NOT NULL (lob_id is nullable), so an
    // ambiguous company surfaces a clear error for nob_id rather than a raw
    // DB constraint failure; lob_id simply stores null.
    const resolvedNobLob = await this.nobLobResolution.resolve(tenantId, companyId, {
      nob_id: dto.nob_id,
      lob_id: dto.lob_id,
    });
    if (!resolvedNobLob.nob_id) {
      throw new BadRequestException(
        "Cannot determine this breed's Nature of Business — this company's operational areas span multiple business verticals. Specify nob_id explicitly.",
      );
    }
    const nobId = resolvedNobLob.nob_id;
    const lobId = resolvedNobLob.lob_id;
    assertLobInScope(farmScope(this.cls), lobId);

    // Resolve the breed code — a series (breed_type first, then BREED alone) if
    // one is configured, else the user-supplied code.
    const newBreed = await this.db.transaction(async (tx) => {
    const breedCode = await this.resolveBreedCode(dto, tenantId, companyId, tx);

    // Verify duplicate breed code in company scope
    const duplicateConditions = [
      eq(schema.breedMaster.tenant_id, tenantId),
      eq(schema.breedMaster.breed_code, breedCode),
      eq(schema.breedMaster.location_id, dto.location_id),
      isNull(schema.breedMaster.deleted_at),
    ];
    if (companyId) {
      duplicateConditions.push(eq(schema.breedMaster.company_id, companyId));
    } else {
      duplicateConditions.push(isNull(schema.breedMaster.company_id));
    }

    const existing = await tx
      .select()
      .from(schema.breedMaster)
      .where(and(...duplicateConditions))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Breed with code '${breedCode}' already exists.`);
    }

    const breedId = randomUUID();
    const newBreed = {
      breed_id: breedId,
      location_id: dto.location_id || null,
      tenant_id: tenantId,
      company_id: companyId,
      nob_id: nobId,
      lob_id: lobId,
      breed_code: breedCode,
      breed_name: dto.breed_name,
      species_id: dto.species_id,
      species: dto.species || species.species_name, // legacy fallback
      breed_type: dto.breed_type,
      avg_growth_rate_g_day: dto.avg_growth_rate_g_day?.toString() || null,
      avg_fcr: dto.avg_fcr?.toString() || null,
      avg_mortality_pct: dto.avg_mortality_pct?.toString() || null,
      avg_lay_rate_pct: dto.avg_lay_rate_pct?.toString() || null,
      incubation_days: dto.incubation_days ?? null,
      gestation_days: dto.gestation_days ?? null,
      avg_litter_size: dto.avg_litter_size?.toString() || null,
      mature_age_months: dto.mature_age_months ?? null,
      productive_life_months: dto.productive_life_months ?? null,
      premature_years: dto.premature_years?.toString() || null,
      avg_yield_per_unit: dto.avg_yield_per_unit?.toString() || null,
      lactation_days: dto.lactation_days ?? null,
      residual_value_pct: dto.residual_value_pct?.toString() || null,
      productive_life_cycles: dto.productive_life_cycles ?? null,
      avg_litter_size_born: dto.avg_litter_size_born?.toString() || null,
      avg_litter_size_weaned: dto.avg_litter_size_weaned?.toString() || null,
      avg_weaning_weight_kg: dto.avg_weaning_weight_kg?.toString() || null,
      farrowing_rate_pct: dto.farrowing_rate_pct?.toString() || null,
      boar_doses_per_week: dto.boar_doses_per_week?.toString() || null,
      boar_productive_life_months: dto.boar_productive_life_months ?? null,
      vaccination_schedule: dto.vaccination_schedule ? JSON.stringify(dto.vaccination_schedule) : null,
      age_labels: dto.age_labels ? JSON.stringify(dto.age_labels) : null,
      description: dto.description || null,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await tx.insert(schema.breedMaster).values(newBreed);
    return newBreed;
    });

    await this.auditService.log({
      tenantId,
      companyId: companyId || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'breed_master',
      entityId: newBreed.breed_id,
      newValues: newBreed,
    });

    return this.findOneBreed(newBreed.breed_id, tenantId);
  }

  async findOneBreed(id: string, tenantId: string) {
    const scope = farmScope(this.cls);
    const conditions: any[] = [
      eq(schema.breedMaster.breed_id, id),
      eq(schema.breedMaster.tenant_id, tenantId),
      isNull(schema.breedMaster.deleted_at),
      ...restrictedScopeConditions(scope, {
        companyId: schema.breedMaster.company_id,
        lobId: schema.breedMaster.lob_id,
      }),
    ];
    if (scope.farmId) conditions.push(eq(schema.breedMaster.location_id, scope.farmId));
    const [breed] = await this.db
      .select()
      .from(schema.breedMaster)
      .where(and(...conditions))
      .limit(1);

    if (!breed) {
      throw new NotFoundException(`Breed with ID '${id}' not found.`);
    }

    return breed;
  }

  async findAllBreeds(query: QueryBreedDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.breedMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.breedMaster, query.companyId));
    const scope = farmScope(this.cls);
    conditions.push(...restrictedScopeConditions(scope, {
      companyId: schema.breedMaster.company_id,
      lobId: schema.breedMaster.lob_id,
    }));
    if (scope.farmId) conditions.push(eq(schema.breedMaster.location_id, scope.farmId));
    if (query.locationId) conditions.push(eq(schema.breedMaster.location_id, query.locationId));
    if (query.speciesId) {
      conditions.push(eq(schema.breedMaster.species_id, query.speciesId));
    }
    if (query.nobId) {
      conditions.push(eq(schema.breedMaster.nob_id, query.nobId));
    }
    if (query.lobId) {
      // A breed with lob_id IS NULL applies to every LOB under its NOB — eq() never
      // matches NULL, so without the wildcard these breeds would be wrongly excluded
      // whenever a specific LOB is requested.
      conditions.push(or(eq(schema.breedMaster.lob_id, query.lobId), isNull(schema.breedMaster.lob_id))!);
    }
    if (query.breedType) {
      conditions.push(eq(schema.breedMaster.breed_type, query.breedType));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.breedMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.breedMaster.breed_code, `%${query.search}%`),
          like(schema.breedMaster.breed_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.breedMaster, query.filter));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select({
        ...getTableColumns(schema.breedMaster),
        location_code: schema.locationMaster.location_code,
        location_name: schema.locationMaster.location_name,
      })
      .from(schema.breedMaster)
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.breedMaster.location_id))
      .where(and(...conditions))
      .orderBy(listOrderBy(schema.breedMaster, query, schema.breedMaster.breed_code))
      .limit(limit)
      .offset(offset);
  }

  async updateBreed(id: string, dto: UpdateBreedDto, tenantId: string, userPayload?: any) {
    const breed = await this.findOneBreed(id, tenantId);
    if (dto.location_id === null) {
      throw new BadRequestException('A breed profile must remain assigned to a farm.');
    }
    const locationId = dto.location_id ?? breed.location_id;
    if (!locationId) throw new BadRequestException('Select the farm where this breed profile applies.');
    if (locationId !== breed.location_id) {
      throw new BadRequestException('A breed profile cannot be moved to another farm. Create the destination farm profile instead.');
    }
    await assertLocationOnActiveFarm(this.db, farmScope(this.cls), locationId, 'Breed farm');
    await this.requireRootFarm(locationId, tenantId, breed.company_id);

    if (dto.nob_id !== undefined && dto.nob_id !== breed.nob_id) {
      throw new BadRequestException('A breed profile cannot be moved to another Nature of Business. Create the correct farm profile instead.');
    }
    if (dto.lob_id !== undefined && dto.lob_id !== breed.lob_id) {
      throw new BadRequestException('A breed profile cannot be moved to another Line of Business. Create the correct farm profile instead.');
    }
    assertLobInScope(farmScope(this.cls), dto.lob_id ?? breed.lob_id);

    // dto.breed_code is no longer writable (the code follows the BREED series —
    // see below), so the effective code here is the row's own.
    const effectiveCode = breed.breed_code;
    if (effectiveCode !== breed.breed_code || locationId !== breed.location_id) {
      const duplicateConditions = [
        eq(schema.breedMaster.tenant_id, tenantId),
        eq(schema.breedMaster.breed_code, effectiveCode),
        eq(schema.breedMaster.location_id, locationId),
        ne(schema.breedMaster.breed_id, id),
        isNull(schema.breedMaster.deleted_at),
      ];
      if (breed.company_id) {
        duplicateConditions.push(eq(schema.breedMaster.company_id, breed.company_id));
      } else {
        duplicateConditions.push(isNull(schema.breedMaster.company_id));
      }

      const existing = await this.db
        .select()
        .from(schema.breedMaster)
        .where(and(...duplicateConditions))
        .limit(1);

      if (existing.length > 0) {
        throw new ConflictException(`Breed with code '${effectiveCode}' already exists on this farm.`);
      }
    }

    if (dto.species_id) {
      await this.findOneSpecies(dto.species_id);
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.location_id !== undefined) updates.location_id = dto.location_id;
    if (dto.nob_id !== undefined) updates.nob_id = dto.nob_id;
    if (dto.lob_id !== undefined) updates.lob_id = dto.lob_id;

    // The code belongs to the BREED series (Rishi, 2026-09-15): a named series
    // with a `breed_name` segment, so "Large White" -> LARGE_WHITE on every
    // farm. Renaming a breed recomposes its code from the new name — animals,
    // batches and transfers reference a breed by UUID, so nothing can go stale.
    // A hand-typed code (Rishi enters codes matching the breed's code on other
    // farms; allow_manual is for exactly that) is left alone: it was never
    // following the series, so it has nothing to follow.
    if (dto.breed_name !== undefined && dto.breed_name.trim() !== breed.breed_name
        && breed.breed_code === breed.breed_name.replaceAll(/\s+/g, '_').toUpperCase()) {
      updates.breed_code = await this.numberSeriesService.renameCode(
        'BREED',
        { ...breed, breed_name: dto.breed_name },
        tenantId,
        breed.company_id,
      );
    }
    if (dto.breed_name !== undefined) updates.breed_name = dto.breed_name;
    if (dto.species_id !== undefined) updates.species_id = dto.species_id;
    if (dto.species !== undefined) updates.species = dto.species;
    if (dto.breed_type !== undefined) updates.breed_type = dto.breed_type;
    if (dto.avg_growth_rate_g_day !== undefined) updates.avg_growth_rate_g_day = dto.avg_growth_rate_g_day?.toString() || null;
    if (dto.avg_fcr !== undefined) updates.avg_fcr = dto.avg_fcr?.toString() || null;
    if (dto.avg_mortality_pct !== undefined) updates.avg_mortality_pct = dto.avg_mortality_pct?.toString() || null;
    if (dto.avg_lay_rate_pct !== undefined) updates.avg_lay_rate_pct = dto.avg_lay_rate_pct?.toString() || null;
    if (dto.incubation_days !== undefined) updates.incubation_days = dto.incubation_days;
    if (dto.gestation_days !== undefined) updates.gestation_days = dto.gestation_days;
    if (dto.avg_litter_size !== undefined) updates.avg_litter_size = dto.avg_litter_size?.toString() || null;
    if (dto.mature_age_months !== undefined) updates.mature_age_months = dto.mature_age_months;
    if (dto.productive_life_months !== undefined) updates.productive_life_months = dto.productive_life_months;
    if (dto.premature_years !== undefined) updates.premature_years = dto.premature_years?.toString() || null;
    if (dto.avg_yield_per_unit !== undefined) updates.avg_yield_per_unit = dto.avg_yield_per_unit?.toString() || null;
    if (dto.lactation_days !== undefined) updates.lactation_days = dto.lactation_days;
    if (dto.residual_value_pct !== undefined) updates.residual_value_pct = dto.residual_value_pct?.toString() || null;
    if (dto.productive_life_cycles !== undefined) updates.productive_life_cycles = dto.productive_life_cycles;
    if (dto.avg_litter_size_born !== undefined) updates.avg_litter_size_born = dto.avg_litter_size_born?.toString() || null;
    if (dto.avg_litter_size_weaned !== undefined) updates.avg_litter_size_weaned = dto.avg_litter_size_weaned?.toString() || null;
    if (dto.avg_weaning_weight_kg !== undefined) updates.avg_weaning_weight_kg = dto.avg_weaning_weight_kg?.toString() || null;
    if (dto.farrowing_rate_pct !== undefined) updates.farrowing_rate_pct = dto.farrowing_rate_pct?.toString() || null;
    if (dto.boar_doses_per_week !== undefined) updates.boar_doses_per_week = dto.boar_doses_per_week?.toString() || null;
    if (dto.boar_productive_life_months !== undefined) updates.boar_productive_life_months = dto.boar_productive_life_months;
    if (dto.vaccination_schedule !== undefined) updates.vaccination_schedule = JSON.stringify(dto.vaccination_schedule);
    if (dto.age_labels !== undefined) updates.age_labels = JSON.stringify(dto.age_labels);
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    await this.db
      .update(schema.breedMaster)
      .set(updates)
      .where(eq(schema.breedMaster.breed_id, id));

    await this.auditService.log({
      tenantId,
      companyId: breed.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'breed_master',
      entityId: id,
      oldValues: breed,
      newValues: updates,
    });

    return this.findOneBreed(id, tenantId);
  }

  async removeBreed(id: string, tenantId: string, userPayload?: any) {
    const breed = await this.findOneBreed(id, tenantId);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.breedMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.breedMaster.breed_id, id));

    await this.auditService.log({
      tenantId,
      companyId: breed.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'breed_master',
      entityId: id,
      oldValues: breed,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Breed '${breed.breed_name}' has been soft-deleted.` };
  }

  async restoreBreed(id: string, tenantId: string, userPayload?: any) {
    const scope = farmScope(this.cls);
    const conditions: any[] = [
      eq(schema.breedMaster.breed_id, id),
      eq(schema.breedMaster.tenant_id, tenantId),
      ...restrictedScopeConditions(scope, {
        companyId: schema.breedMaster.company_id,
        lobId: schema.breedMaster.lob_id,
      }),
    ];
    if (scope.farmId) conditions.push(eq(schema.breedMaster.location_id, scope.farmId));
    const [breed] = await this.db
      .select()
      .from(schema.breedMaster)
      .where(and(...conditions))
      .limit(1);

    if (!breed) {
      throw new NotFoundException(`Breed with ID '${id}' not found.`);
    }

    if (!breed.deleted_at) {
      return breed;
    }

    await this.db
      .update(schema.breedMaster)
      .set({
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.breedMaster.breed_id, id));

    await this.auditService.log({
      tenantId,
      companyId: breed.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'breed_master',
      entityId: id,
      oldValues: breed,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOneBreed(id, tenantId);
  }

  // ==========================================
  // BREED LIFECYCLE STAGES
  // ==========================================

  private async assertItemExists(itemId: string) {
    const [item] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_id, itemId), isNull(schema.itemMaster.deleted_at)))
      .limit(1);
    if (!item) {
      throw new NotFoundException(`Item with ID '${itemId}' not found.`);
    }
  }

  /**
   * What the row shapes cannot say on their own. The DTO already holds each KPI
   * row to a known metric and severity and each resource row to a UUID; this
   * checks a KPI's limits are the right way round, that each resource is a real
   * resource in this tenant, and that a protocol row's withdrawal period — on
   * vaccination rows as on medication rows — is a whole number of days within
   * the two digits TDD row 21 allows an item's.
   *
   * Protocol rows are otherwise left as they are: the seeded rows carry an
   * older { day, vaccine, dose, route } shape, and refusing unknown keys would
   * make those records impossible to edit.
   */
  private async assertLifecycleRows(
    dto: Pick<CreateBreedLifecycleStageDto, 'kpi_thresholds' | 'resource_requirements' | 'vaccination_protocol' | 'medication_protocol'>,
    tenantId: string,
  ) {
    for (const row of dto.kpi_thresholds || []) {
      if (row.lower_limit == null && row.upper_limit == null) {
        throw new BadRequestException(`KPI ${row.metric} needs a Lower Limit, an Upper Limit, or both.`);
      }
      if (row.lower_limit != null && row.upper_limit != null && row.lower_limit > row.upper_limit) {
        throw new BadRequestException(`KPI ${row.metric}: Lower Limit ${row.lower_limit} is above Upper Limit ${row.upper_limit}.`);
      }
    }
    const resourceIds = [...new Set((dto.resource_requirements || []).map((row) => row.resource_id))];
    if (resourceIds.length) {
      const found = await this.db
        .select({ resource_id: schema.resourceMaster.resource_id })
        .from(schema.resourceMaster)
        .where(and(
          eq(schema.resourceMaster.tenant_id, tenantId),
          inArray(schema.resourceMaster.resource_id, resourceIds),
          isNull(schema.resourceMaster.deleted_at),
        ));
      const missing = resourceIds.filter((resourceId) => !found.some((row) => row.resource_id === resourceId));
      if (missing.length) throw new NotFoundException(`Resource with ID '${missing[0]}' not found.`);
    }
    for (const [label, rows] of [['Vaccination', dto.vaccination_protocol], ['Medication', dto.medication_protocol]] as const) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const days = row && typeof row === 'object' ? (row as Record<string, unknown>).withdrawal_days : undefined;
        if (days === undefined || days === null || days === '') continue;
        if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 99) {
          throw new BadRequestException(`${label} protocol withdrawal period must be a whole number of days from 0 to 99.`);
        }
      }
    }
  }

  async createLifecycleStage(dto: CreateBreedLifecycleStageDto, tenantId: string, userPayload?: any) {
    await this.findOneBreed(dto.breed_id, tenantId);

    const [stage] = await this.db
      .select()
      .from(schema.stageMaster)
      .where(and(eq(schema.stageMaster.stage_id, dto.stage_id), isNull(schema.stageMaster.deleted_at)))
      .limit(1);
    if (!stage) {
      throw new NotFoundException(`Stage with ID '${dto.stage_id}' not found.`);
    }

    if (dto.feed_item_id) await this.assertItemExists(dto.feed_item_id);
    if (dto.output_item_id) await this.assertItemExists(dto.output_item_id);
    await this.assertLifecycleRows(dto, tenantId);

    // breed_lifecycle_stages has no company_id — a row is scoped through its breed —
    // so the code resolves against the tenant-wide series scope. Manual today,
    // automatic once a BREED_LIFECYCLE_STAGE series is configured, null otherwise.
    const lifecycleCode = await this.numberSeriesService.resolveOptionalCode('BREED_LIFECYCLE_STAGE', dto.lifecycle_code, tenantId, null, undefined, dto as unknown as Record<string, unknown>);

    const lifecycleId = randomUUID();
    const newLifecycleStage = {
      lifecycle_id: lifecycleId,
      tenant_id: tenantId,
      lifecycle_code: lifecycleCode,
      breed_id: dto.breed_id,
      stage_id: dto.stage_id,
      category: dto.category || null,
      calc_unit: dto.calc_unit,
      period_from: dto.period_from,
      period_to: dto.period_to,
      std_teats: dto.std_teats ?? null,
      season_type: dto.season_type || null,
      feed_item_id: dto.feed_item_id || null,
      feed_qty_per_head_per_day_kg: dto.feed_qty_per_head_per_day_kg?.toString() || null,
      feed_wastage_pct: dto.feed_wastage_pct?.toString() || null,
      std_body_weight_kg: dto.std_body_weight_kg?.toString() || null,
      std_adg_gpd: dto.std_adg_gpd?.toString() || null,
      std_fcr: dto.std_fcr?.toString() || null,
      std_mortality_rate_pct: dto.std_mortality_rate_pct?.toString() || null,
      output_item_id: dto.output_item_id || null,
      output_uom: dto.output_uom || null,
      std_output_qty: dto.std_output_qty?.toString() || null,
      medication_protocol: dto.medication_protocol ? JSON.stringify(dto.medication_protocol) : null,
      vaccination_protocol: dto.vaccination_protocol ? JSON.stringify(dto.vaccination_protocol) : null,
      resource_requirements: dto.resource_requirements ? JSON.stringify(dto.resource_requirements) : null,
      kpi_thresholds: dto.kpi_thresholds ? JSON.stringify(dto.kpi_thresholds) : null,
      kpi_lower_limit: dto.kpi_lower_limit?.toString() || null,
      kpi_upper_limit: dto.kpi_upper_limit?.toString() || null,
      alert_severity: dto.alert_severity || null,
      notes: dto.notes || null,
      is_active: true,
      created_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.breedLifecycleStages).values(newLifecycleStage);

    await this.auditService.log({
      tenantId,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'breed_lifecycle_stages',
      entityId: lifecycleId,
      newValues: newLifecycleStage,
    });

    return this.findOneLifecycleStage(lifecycleId);
  }

  async findOneLifecycleStage(id: string) {
    const [lifecycleStage] = await this.db
      .select({
        ...getTableColumns(schema.breedLifecycleStages),
        stage_name: schema.stageMaster.stage_name,
        stage_code: schema.stageMaster.stage_code,
        stage: sql<string>`COALESCE(${schema.stageMaster.stage_name}, ${schema.stageMaster.stage_code})`,
        breed_name: schema.breedMaster.breed_name,
        breed_code: schema.breedMaster.breed_code,
      })
      .from(schema.breedLifecycleStages)
      .leftJoin(schema.stageMaster, eq(schema.breedLifecycleStages.stage_id, schema.stageMaster.stage_id))
      .leftJoin(schema.breedMaster, eq(schema.breedLifecycleStages.breed_id, schema.breedMaster.breed_id))
      .where(eq(schema.breedLifecycleStages.lifecycle_id, id))
      .limit(1);

    if (!lifecycleStage) {
      throw new NotFoundException(`Breed lifecycle stage with ID '${id}' not found.`);
    }
    return lifecycleStage;
  }

  async findAllLifecycleStages(query: QueryBreedLifecycleStageDto, tenantId: string) {
    const conditions: any[] = [eq(schema.breedLifecycleStages.tenant_id, tenantId)];
    const scopeConditions = masterScopeConditions(this.cls, schema.breedMaster);
    if (scopeConditions.length) {
      conditions.push(inArray(schema.breedLifecycleStages.breed_id,
        this.db.select({ id: schema.breedMaster.breed_id }).from(schema.breedMaster).where(and(...scopeConditions))));
    }

    if (query.breedId) conditions.push(eq(schema.breedLifecycleStages.breed_id, query.breedId));
    if (query.stageId) conditions.push(eq(schema.breedLifecycleStages.stage_id, query.stageId));
    if (query.search) {
      const s = `%${query.search.trim()}%`;
      conditions.push(or(
        like(schema.breedLifecycleStages.lifecycle_code, s),
        like(schema.stageMaster.stage_name, s),
        like(schema.stageMaster.stage_code, s),
        like(schema.breedMaster.breed_name, s),
        like(schema.breedMaster.breed_code, s)
      ));
    }

    // `stage` is not a column on breed_lifecycle_stages — it is the
    // COALESCE(stage_name, stage_code) alias the select below computes.
    // listFilterConditions/listOrderBy only know real table columns and 400
    // on anything else, so `stage` is pulled out and matched against the
    // same expression by hand before the rest of the filter is delegated.
    const stageAlias = sql<string>`COALESCE(${schema.stageMaster.stage_name}, ${schema.stageMaster.stage_code})`;
    const { stage: stageFilter, ...restFilter } = query.filter ?? {};
    conditions.push(...listFilterConditions(schema.breedLifecycleStages, restFilter));
    if (stageFilter !== undefined && stageFilter !== null && stageFilter !== '') {
      if (Array.isArray(stageFilter)) {
        const values = stageFilter.filter((value) => value !== '');
        if (values.length) conditions.push(inArray(stageAlias, values));
      } else {
        const value = String(stageFilter);
        conditions.push(value.includes('*') ? like(stageAlias, value.replace(/\*/g, '%')) : eq(stageAlias, value));
      }
    }

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const where = and(...conditions);

    const orderBy = query.sort === 'stage'
      ? ((query.dir === 'desc' ? desc(stageAlias) : asc(stageAlias)) as any)
      : listOrderBy(schema.breedLifecycleStages, query, schema.breedLifecycleStages.period_from);

    const data = await this.db
      .select({
        ...getTableColumns(schema.breedLifecycleStages),
        stage_name: schema.stageMaster.stage_name,
        stage_code: schema.stageMaster.stage_code,
        stage: stageAlias,
        breed_name: schema.breedMaster.breed_name,
        breed_code: schema.breedMaster.breed_code,
      })
      .from(schema.breedLifecycleStages)
      .leftJoin(schema.stageMaster, eq(schema.breedLifecycleStages.stage_id, schema.stageMaster.stage_id))
      .leftJoin(schema.breedMaster, eq(schema.breedLifecycleStages.breed_id, schema.breedMaster.breed_id))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    // The same two joins as the page query, because `search` matches on the
    // joined stage and breed columns — counting from the bare table would ask
    // MySQL for stage_master.stage_name with no stage_master in the FROM.
    const [counted] = await this.db
      .select({ total: count() })
      .from(schema.breedLifecycleStages)
      .leftJoin(schema.stageMaster, eq(schema.breedLifecycleStages.stage_id, schema.stageMaster.stage_id))
      .leftJoin(schema.breedMaster, eq(schema.breedLifecycleStages.breed_id, schema.breedMaster.breed_id))
      .where(where);

    return { data, total: Number(counted?.total ?? 0), limit, offset };
  }

  async updateLifecycleStage(id: string, dto: UpdateBreedLifecycleStageDto, tenantId: string, userPayload?: any) {
    const lifecycleStage = await this.findOneLifecycleStage(id);

    if (dto.stage_id) {
      const [stage] = await this.db
        .select()
        .from(schema.stageMaster)
        .where(and(eq(schema.stageMaster.stage_id, dto.stage_id), isNull(schema.stageMaster.deleted_at)))
        .limit(1);
      if (!stage) {
        throw new NotFoundException(`Stage with ID '${dto.stage_id}' not found.`);
      }
    }
    if (dto.feed_item_id) await this.assertItemExists(dto.feed_item_id);
    if (dto.output_item_id) await this.assertItemExists(dto.output_item_id);
    await this.assertLifecycleRows(dto, tenantId);

    const updates: any = {};
    // Blank means "untouched": the form posts "" for every optional field, and the
    // 24 live rows created before this column existed still hold NULL.
    const lifecycleCode = await this.numberSeriesService.editedCode('BREED_LIFECYCLE_STAGE', dto.lifecycle_code, lifecycleStage.lifecycle_code, tenantId, null);
    if (lifecycleCode) updates.lifecycle_code = lifecycleCode;
    if (dto.stage_id !== undefined) updates.stage_id = dto.stage_id;
    if (dto.category !== undefined) updates.category = dto.category || null;
    if (dto.calc_unit !== undefined) updates.calc_unit = dto.calc_unit;
    if (dto.period_from !== undefined) updates.period_from = dto.period_from;
    if (dto.period_to !== undefined) updates.period_to = dto.period_to;
    if (dto.std_teats !== undefined) updates.std_teats = dto.std_teats;
    if (dto.season_type !== undefined) updates.season_type = dto.season_type;
    if (dto.feed_item_id !== undefined) updates.feed_item_id = dto.feed_item_id;
    if (dto.feed_qty_per_head_per_day_kg !== undefined) updates.feed_qty_per_head_per_day_kg = dto.feed_qty_per_head_per_day_kg?.toString() || null;
    if (dto.feed_wastage_pct !== undefined) updates.feed_wastage_pct = dto.feed_wastage_pct?.toString() || null;
    if (dto.std_body_weight_kg !== undefined) updates.std_body_weight_kg = dto.std_body_weight_kg?.toString() || null;
    if (dto.std_adg_gpd !== undefined) updates.std_adg_gpd = dto.std_adg_gpd?.toString() || null;
    if (dto.std_fcr !== undefined) updates.std_fcr = dto.std_fcr?.toString() || null;
    if (dto.std_mortality_rate_pct !== undefined) updates.std_mortality_rate_pct = dto.std_mortality_rate_pct?.toString() || null;
    if (dto.output_item_id !== undefined) updates.output_item_id = dto.output_item_id;
    if (dto.output_uom !== undefined) updates.output_uom = dto.output_uom;
    if (dto.std_output_qty !== undefined) updates.std_output_qty = dto.std_output_qty?.toString() || null;
    if (dto.medication_protocol !== undefined) updates.medication_protocol = JSON.stringify(dto.medication_protocol);
    if (dto.vaccination_protocol !== undefined) updates.vaccination_protocol = JSON.stringify(dto.vaccination_protocol);
    if (dto.resource_requirements !== undefined) updates.resource_requirements = JSON.stringify(dto.resource_requirements);
    if (dto.kpi_thresholds !== undefined) updates.kpi_thresholds = JSON.stringify(dto.kpi_thresholds);
    if (dto.kpi_lower_limit !== undefined) updates.kpi_lower_limit = dto.kpi_lower_limit?.toString() || null;
    if (dto.kpi_upper_limit !== undefined) updates.kpi_upper_limit = dto.kpi_upper_limit?.toString() || null;
    if (dto.alert_severity !== undefined) updates.alert_severity = dto.alert_severity;
    if (dto.notes !== undefined) updates.notes = dto.notes;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;

    await this.db
      .update(schema.breedLifecycleStages)
      .set(updates)
      .where(eq(schema.breedLifecycleStages.lifecycle_id, id));

    await this.auditService.log({
      tenantId,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'breed_lifecycle_stages',
      entityId: id,
      oldValues: lifecycleStage,
      newValues: updates,
    });

    return this.findOneLifecycleStage(id);
  }

  async removeLifecycleStage(id: string, tenantId: string, userPayload?: any) {
    const lifecycleStage = await this.findOneLifecycleStage(id);

    await this.db
      .update(schema.breedLifecycleStages)
      .set({ is_active: false })
      .where(eq(schema.breedLifecycleStages.lifecycle_id, id));

    await this.auditService.log({
      tenantId,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'breed_lifecycle_stages',
      entityId: id,
      oldValues: lifecycleStage,
    });

    return { success: true, message: 'Breed lifecycle stage has been deactivated.' };
  }

  /**
   * The counterpart removeLifecycleStage never had. Deactivating a stage only
   * sets is_active = false, so the row was always recoverable in principle —
   * but with no restore endpoint the list could offer a one-way switch at best,
   * which is why it fell back to a text badge. breed_lifecycle_stages carries
   * no deleted_at/updated_at, so flipping the flag is the whole operation.
   */
  async restoreLifecycleStage(id: string, tenantId: string, userPayload?: any) {
    const lifecycleStage = await this.findOneLifecycleStage(id);

    if (lifecycleStage.is_active) {
      return { success: true, message: 'Breed lifecycle stage is already active.' };
    }

    await this.db
      .update(schema.breedLifecycleStages)
      .set({ is_active: true })
      .where(eq(schema.breedLifecycleStages.lifecycle_id, id));

    await this.auditService.log({
      tenantId,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'breed_lifecycle_stages',
      entityId: id,
      oldValues: lifecycleStage,
    });

    return { success: true, message: 'Breed lifecycle stage has been restored.' };
  }
}
