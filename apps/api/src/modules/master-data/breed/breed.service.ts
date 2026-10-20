import { withTenantTransaction } from '../../../common/tenant-transaction';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { validateFeedLines, linesOf, siblingKey, type FeedLine } from './lifecycle-feed-lines';
import { feedQtyToKg } from '../../production/lifecycle/feed-qty-kg';
import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, ne, inArray, isNotNull, sql, getTableColumns, count, asc, desc } from 'drizzle-orm';
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
  assertLobInScope,
  farmScope,
  nullableFarmScopeConditions,
  restrictedScopeConditions,
} from '../../../common/farm-scope';
import { findEffectiveOverlap } from '../../production/lifecycle/lifecycle-effective.rules';
import { assertCodeUnchanged } from '../../../common/master-code';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};


/**
 * A JSON list column's value as plain rows. The column type serialises it itself: JSON.stringify'ing it first stored
 * the list as an encoded string (13 Oct), which the KPI evaluator (Array.isArray) then ignored.
 */
const jsonRows = (rows: unknown): unknown => JSON.parse(JSON.stringify(rows));

@Injectable()
export class BreedService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly numberSeriesService: NumberSeriesService,
    private readonly nobLobResolution: NobLobResolutionService,
  ) { }

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /** Resolves by breed_type first (e.g. BREED_BROILER), then the master-alone BREED series, else manual. */
  private async resolveBreedCode(dto: CreateBreedDto, tenantId: string, companyId: string | null, executor: MySql2Database<typeof schema> = this.db): Promise<string> {
    const seriesCode = await this.numberSeriesService.resolveSeriesFor('BREED', dto.breed_type, tenantId, companyId, executor);
    if (!seriesCode) {
      if (!dto.breed_code) {
        throw new BadRequestException('Enter a breed code or configure a breed number series.');
      }
      return dto.breed_code.toUpperCase();
    }
    const series = await this.numberSeriesService.lockSeries(seriesCode, tenantId, companyId, executor);
    if (series.manual_nos && dto.breed_code) {
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

  // ========================================================
  // SPECIES MASTER CRUD
  // ========================================================

  async createSpecies(dto: CreateSpeciesDto, tenantId: string, userPayload?: any) {
    // The number is drawn from the series inside this transaction, so a save that fails after it (a duplicate,
    // a bad reference) rolls the counter back instead of burning the number.
    return withTenantTransaction(this.cls, () => this.createSpeciesRecord(dto, tenantId, userPayload));
  }

  private async createSpeciesRecord(dto: CreateSpeciesDto, tenantId: string, userPayload?: any) {
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
      .where(eq(schema.speciesMaster.species_id, id))
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

    assertCodeUnchanged('Species', species.species_code, dto.species_code);
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
    if (dto.species_code !== undefined && dto.species_code.trim()) {
      const trimmed = dto.species_code.trim().toUpperCase();
      if (trimmed !== species.species_code) {
        const edited = await this.numberSeriesService.editedCode(
          'SPECIES',
          trimmed,
          species.species_code,
          tenantId,
          species.company_id,
        );
        if (edited) updates.species_code = edited;
      }
    } else if (dto.species_name !== undefined && dto.species_name.trim() !== species.species_name
      && species.species_code === species.species_name.replaceAll(/\s+/g, '_').toUpperCase()) {
      updates.species_code = await this.numberSeriesService.renameCode(
        'SPECIES',
        { ...species, species_name: dto.species_name },
        tenantId,
        species.company_id,
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
    const area: any = this.cls.get('activeOperationalArea');
    const clsCompanyId = typeof this.cls.get('companyId') === 'string' ? (this.cls.get('companyId') as string) : null;
    const areaCompanyId = area && typeof area.company_id === 'string' ? area.company_id : null;
    const companyId = dto.company_id || areaCompanyId || clsCompanyId || null;

    // Verify species exists if provided
    const species = dto.species_id ? await this.findOneSpecies(dto.species_id) : null;

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
        "Cannot determine this breed's Nature of Business — this company's operational areas span multiple business verticals. Choose the Nature of Business explicitly.",
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
        tenant_id: tenantId,
        company_id: companyId,
        nob_id: nobId,
        lob_id: lobId,
        breed_code: breedCode,
        breed_name: dto.breed_name,
        species_id: dto.species_id || null,
        species: dto.species || species?.species_name || null, // legacy fallback
        breed_type: dto.breed_type || 'MEAT',
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
        is_blocked: dto.is_blocked ?? false,
        is_active: dto.is_blocked ? false : true,
        status: dto.is_blocked ? 'INACTIVE' : 'ACTIVE',
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

  async createBreedsBulk(dtos: CreateBreedDto[], tenantId: string, userPayload?: any) {
    if (!dtos || !dtos.length) {
      throw new BadRequestException('No breed items provided for bulk creation.');
    }
    const results: any[] = [];
    const errors: { index: number; code?: string; error: string }[] = [];

    for (let i = 0; i < dtos.length; i++) {
      try {
        const item = await this.createBreed(dtos[i], tenantId, userPayload);
        results.push(item);
      } catch (err: any) {
        // If conflict on existing code, update the existing record so re-imports refresh benchmark data
        if (err instanceof ConflictException && dtos[i]?.breed_code) {
          try {
            const area: any = this.cls.get('activeOperationalArea');
            const clsCompanyId = typeof this.cls.get('companyId') === 'string' ? (this.cls.get('companyId') as string) : null;
            const areaCompanyId = area && typeof area.company_id === 'string' ? area.company_id : null;
            const companyId = dtos[i].company_id || areaCompanyId || clsCompanyId || null;

            const duplicateConditions = [
              eq(schema.breedMaster.tenant_id, tenantId),
              eq(schema.breedMaster.breed_code, dtos[i].breed_code!),
              isNull(schema.breedMaster.deleted_at),
            ];
            if (companyId) {
              duplicateConditions.push(eq(schema.breedMaster.company_id, companyId));
            } else {
              duplicateConditions.push(isNull(schema.breedMaster.company_id));
            }

            const [existing] = await this.db
              .select()
              .from(schema.breedMaster)
              .where(and(...duplicateConditions))
              .limit(1);

            if (existing) {
              const updated = await this.updateBreed(existing.breed_id, dtos[i] as any, tenantId, userPayload);
              results.push(updated);
              continue;
            }
          } catch (updateErr: any) {
            errors.push({
              index: i,
              code: dtos[i]?.breed_code,
              error: updateErr?.message || err?.message || 'Failed to update existing breed',
            });
            continue;
          }
        }

        errors.push({
          index: i,
          code: dtos[i]?.breed_code,
          error: err?.message || 'Failed to create breed',
        });
      }
    }

    if (errors.length > 0 && results.length === 0) {
      throw new BadRequestException({
        message: 'All items in bulk upload failed validation.',
        errors,
      });
    }

    return {
      success: true,
      totalCount: dtos.length,
      createdCount: results.length,
      failedCount: errors.length,
      items: results,
      errors: errors.length > 0 ? errors : undefined,
    };
  }


  async findOneBreed(id: string, tenantId: string) {
    const scope = farmScope(this.cls);
    const conditions: any[] = [
      eq(schema.breedMaster.breed_id, id),
      eq(schema.breedMaster.tenant_id, tenantId),
      ...restrictedScopeConditions(scope, {
        companyId: schema.breedMaster.company_id,
        lobId: schema.breedMaster.lob_id,
      }),
    ];
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
      .select()
      .from(schema.breedMaster)
      .where(and(...conditions))
      .orderBy(listOrderBy(schema.breedMaster, query, schema.breedMaster.breed_code))
      .limit(limit)
      .offset(offset);
  }

  async updateBreed(id: string, dto: UpdateBreedDto, tenantId: string, userPayload?: any) {
    const breed = await this.findOneBreed(id, tenantId);

    if (dto.nob_id !== undefined && dto.nob_id !== breed.nob_id) {
      throw new BadRequestException('A breed profile cannot be moved to another Nature of Business. Create the correct farm profile instead.');
    }
    if (dto.lob_id !== undefined && dto.lob_id !== breed.lob_id) {
      throw new BadRequestException('A breed profile cannot be moved to another Line of Business. Create the correct farm profile instead.');
    }
    assertLobInScope(farmScope(this.cls), dto.lob_id ?? breed.lob_id);

    if (dto.species_id) {
      await this.findOneSpecies(dto.species_id);
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.nob_id !== undefined) updates.nob_id = dto.nob_id;
    if (dto.lob_id !== undefined) updates.lob_id = dto.lob_id;

    // The code belongs to the BREED series (Rishi, 2026-09-15): a named series
    // with a `breed_name` segment, so "Large White" -> LARGE_WHITE on every
    // farm. Renaming a breed recomposes its code from the new name — animals,
    // batches and transfers reference a breed by UUID, so nothing can go stale.
    // A hand-typed code (Rishi enters codes matching the breed's code on other
    // farms; allow_manual is for exactly that) is left alone: it was never
    // following the series, so it has nothing to follow.
    assertCodeUnchanged('Breed', breed.breed_code, dto.breed_code);
    if (dto.breed_code !== undefined && dto.breed_code.trim()) {
      const trimmed = dto.breed_code.trim().toUpperCase();
      if (trimmed !== breed.breed_code) {
        const edited = await this.numberSeriesService.editedCode(
          'BREED',
          trimmed,
          breed.breed_code,
          tenantId,
          breed.company_id,
        );
        if (edited) updates.breed_code = edited;
      }
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
    if (dto.is_blocked !== undefined) {
      updates.is_blocked = dto.is_blocked;
      if (dto.is_active === undefined) updates.is_active = !dto.is_blocked;
      if (dto.status === undefined) updates.status = dto.is_blocked ? 'INACTIVE' : 'ACTIVE';
    }
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
      if ((row.tolerance_pct == null) !== (row.tolerance_type == null)) {
        throw new BadRequestException(`KPI ${row.metric}: Tolerance (%) and Tolerance Type go together; set both or neither.`);
      }
      if (row.tolerance_pct != null && row.average_value == null) {
        throw new BadRequestException(`KPI ${row.metric}: a tolerance is measured around the Average Value, so enter one.`);
      }
      if (row.lower_limit != null && row.upper_limit != null && row.lower_limit > row.upper_limit) {
        throw new BadRequestException(`KPI ${row.metric}: Lower Limit ${row.lower_limit} is above Upper Limit ${row.upper_limit}.`);
      }
    }
    // metric is a kpi_metric_master code now, not a hardcoded enum the DTO could
    // check on its own (see the comment on KpiThresholdRowDto) — checked the same
    // way resource_id is checked just below.
    const metricCodes = [...new Set((dto.kpi_thresholds || []).map((row) => row.metric))];
    if (metricCodes.length) {
      const found = await this.db
        .select({ metric_code: schema.kpiMetricMaster.metric_code })
        .from(schema.kpiMetricMaster)
        .where(and(
          eq(schema.kpiMetricMaster.tenant_id, tenantId),
          inArray(schema.kpiMetricMaster.metric_code, metricCodes),
          eq(schema.kpiMetricMaster.is_active, true),
          isNull(schema.kpiMetricMaster.deleted_at),
        ));
      const missing = metricCodes.filter((code) => !found.some((row) => row.metric_code === code));
      if (missing.length) throw new NotFoundException(`KPI metric '${missing[0]}' not found. Add it under KPI Metrics first.`);
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

  /** Master Setup r30/r39: a farm override must name a FARM location of the breed's own company. */
  private async assertFarmOverride(farmId: string | null | undefined, companyId: string | null | undefined, tenantId: string) {
    const scope = farmScope(this.cls);
    if (scope.farmBound && !farmId) throw new ForbiddenException('A farm override is required for your assigned farm.');
    if (scope.farmId && farmId && scope.farmId !== farmId) throw new ForbiddenException('Farm override is outside the active farm.');
    if (scope.farmBound && farmId !== scope.farmId) throw new ForbiddenException('Farm override is outside your assigned farm.');
    if (!farmId) return;
    const [farm] = await this.db
      .select({ location_id: schema.locationMaster.location_id, company_id: schema.locationMaster.company_id, location_type: schema.locationMaster.location_type })
      .from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.location_id, farmId), eq(schema.locationMaster.tenant_id, tenantId)))
      .limit(1);
    if (!farm || farm.location_type !== 'FARM') {
      throw new BadRequestException('Farm (override) must be a farm location.');
    }
    if (companyId && farm.company_id !== companyId) {
      throw new BadRequestException('Farm (override) must be a farm of the same company as the breed.');
    }
  }

  /**
   * Master Setup r35-r38: a feed row's stage days may not overlap another active feed row's for the same breed, stage
   * and farm scope. Rows with no feed item never feed, so they are not compared.
   */
  private async assertNoEffectiveOverlap(
    row: { lifecycle_id?: string; breed_id: string; stage_id: string; feed_item_id?: string | null; calc_unit?: string; period_from?: number; period_to?: number; farm_id?: string | null; season_type?: string | null; category?: string | null; company_id?: string | null },
    tenantId: string,
    /** The stage record's own rows (its other feed lines), checked against each other by validateFeedLines instead. */
    excludeIds: string[] = [],
  ) {
    if (!row.feed_item_id || !row.calc_unit || row.period_from == null || row.period_to == null) return;
    const others = await this.db
      .select({
        lifecycle_id: schema.breedLifecycleStages.lifecycle_id,
        calc_unit: schema.breedLifecycleStages.calc_unit,
        period_from: schema.breedLifecycleStages.period_from,
        period_to: schema.breedLifecycleStages.period_to,
        farm_id: schema.breedLifecycleStages.farm_id,
        season_type: schema.breedLifecycleStages.season_type,
        category: schema.breedLifecycleStages.category,
        company_id: schema.breedLifecycleStages.company_id,
      })
      .from(schema.breedLifecycleStages)
      .where(and(
        eq(schema.breedLifecycleStages.tenant_id, tenantId),
        eq(schema.breedLifecycleStages.breed_id, row.breed_id),
        eq(schema.breedLifecycleStages.stage_id, row.stage_id),
        eq(schema.breedLifecycleStages.is_active, true),
        isNotNull(schema.breedLifecycleStages.feed_item_id),
      ));
    const clash = findEffectiveOverlap(
      { lifecycleId: row.lifecycle_id, calcUnit: row.calc_unit, periodFrom: row.period_from, periodTo: row.period_to,
        farmId: row.farm_id ?? null, seasonType: row.season_type ?? null, category: row.category ?? null, companyId: row.company_id ?? null },
      (others ?? []).filter((o) => !excludeIds.includes(o.lifecycle_id)).map((o) => ({
        lifecycleId: o.lifecycle_id, calcUnit: o.calc_unit, periodFrom: o.period_from, periodTo: o.period_to,
        farmId: o.farm_id ?? null, seasonType: o.season_type ?? null, category: o.category ?? null, companyId: o.company_id ?? null })),
    );
    if (clash) {
      throw new BadRequestException('Another feed row for this breed, stage and farm scope already covers these days. Change Effective From / Effective To so they do not overlap.');
    }
  }

  // A stage's changes do not reach existing schedulers (Rishi, 14 Oct): a scheduler's activities are taken from the
  // stage when it is created and fixed from then on (scheduler-header/stage-scheduler-lines.ts).

  /**
   * The rows that make one stage record (its Feed Consumption lines, 13 Oct): same breed, stage, farm override,
   * season and category, and the same active state. Sorted by Period From.
   */
  private async stageRows(row: Record<string, any>) {
    const t = schema.breedLifecycleStages;
    const nullSafe = (col: any, v: unknown) => sql`${col} <=> ${v ?? null}`;
    return this.db.select().from(t).where(and(
      eq(t.tenant_id, row.tenant_id),
      eq(t.breed_id, row.breed_id),
      eq(t.stage_id, row.stage_id),
      nullSafe(t.farm_id, row.farm_id),
      nullSafe(t.season_type, row.season_type),
      nullSafe(t.category, row.category),
      // Company is part of the scope for the same reason the overlap rule now uses it:
      // breed and stage can both be tenant-level rows, and without this one company's
      // feed lines appeared on another's stage record (Rishi, 13 Oct).
      nullSafe(t.company_id, row.company_id),
      eq(t.is_active, row.is_active ?? true),
      isNull(t.retired_at),
    )).orderBy(asc(t.period_from));
  }

  /** A stage record as the form reads it: the whole day range of its rows and their feeds as lines. */
  private withFeedLines<T extends Record<string, any>>(record: T, rows: Array<Record<string, any>>) {
    const all = rows.length ? rows : [record];
    return {
      ...record,
      period_from: Math.min(...all.map((r) => Number(r.period_from))),
      period_to: Math.max(...all.map((r) => Number(r.period_to))),
      feed_lines: linesOf(all),
    };
  }

  /** The feed columns a line sets on its row; every other column is shared by the stage's rows. */
  private static readonly LINE_COLUMNS = ['period_from', 'period_to', 'feed_item_id', 'feed_form', 'feed_qty_per_head_per_day_kg', 'feed_qty_per_head_per_day', 'feed_qty_uom', 'feed_wastage_pct'] as const;

  private lineColumns(line: FeedLine) {
    return {
      period_from: line.period_from,
      period_to: line.period_to,
      feed_item_id: line.feed_item_id,
      feed_form: line.feed_form || null,
      // The _kg column stays in kg for everything that reads it; the line keeps what was entered (0195, 14 Oct).
      feed_qty_per_head_per_day_kg: String(line.kg ?? line.feed_qty_per_head_per_day_kg),
      feed_qty_per_head_per_day: String(line.feed_qty_per_head_per_day_kg),
      feed_qty_uom: line.feed_qty_uom || 'KG',
      feed_wastage_pct: line.feed_wastage_pct == null ? null : String(line.feed_wastage_pct),
    };
  }

  /** Each feed line with its daily amount in kg (line.kg). The UOM table and the refusal live in
   * feed-qty-kg.ts, shared with the scheduler's own feed editor so the two cannot disagree. */
  private async withKg(lines: FeedLine[]): Promise<FeedLine[]> {
    const out: FeedLine[] = [];
    for (const [i, line] of lines.entries()) {
      const { uom, kg } = await feedQtyToKg(this.db, line.feed_qty_per_head_per_day_kg, line.feed_qty_uom, `Feed line ${i + 1}`);
      out.push({ ...line, feed_qty_uom: uom, kg });
    }
    return out;
  }

  async createLifecycleStage(dto: CreateBreedLifecycleStageDto, tenantId: string, userPayload?: any) {
    // The number is drawn from the series inside this transaction, so a save that fails after it (a duplicate,
    // a bad reference) rolls the counter back instead of burning the number.
    return withTenantTransaction(this.cls, () => this.createLifecycleStageRecord(dto, tenantId, userPayload));
  }

  private async createLifecycleStageRecord(dto: CreateBreedLifecycleStageDto, tenantId: string, userPayload?: any) {
    const breed = await this.findOneBreed(dto.breed_id, tenantId);
    // Feed Consumption lines (13 Oct): the first line is this row; the others become the stage's further rows.
    const feedLines = dto.feed_lines?.length ? await this.withKg(validateFeedLines(dto.feed_lines as FeedLine[])) : null;
    if (feedLines) {
      for (const line of feedLines) await this.assertItemExists(line.feed_item_id);
      Object.assign(dto, this.lineColumns(feedLines[0]), {
        feed_qty_per_head_per_day_kg: feedLines[0].kg,
        feed_wastage_pct: feedLines[0].feed_wastage_pct ?? undefined,
      });
    }

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
    if (dto.period_from != null && dto.period_to != null && dto.period_from > dto.period_to) {
      throw new BadRequestException('Effective From cannot be greater than Effective To.');
    }
    await this.assertFarmOverride(dto.farm_id, breed.company_id, tenantId);
    await this.assertLifecycleRows(dto, tenantId);
    await this.assertNoEffectiveOverlap({ breed_id: dto.breed_id, stage_id: dto.stage_id, feed_item_id: dto.feed_item_id, calc_unit: dto.calc_unit, period_from: dto.period_from, period_to: dto.period_to, farm_id: dto.farm_id || null, season_type: dto.season_type ?? null, category: dto.category ?? null, company_id: breed.company_id ?? null }, tenantId);

    // The row carries company_id (0084) — a request may not choose its value:
    // it is stamped FROM THE BREED, so a row created under a company breed is
    // visible at that company's workspaces. 593d7c96's gap: rows were inserted
    // with every scope column NULL and enforceMasterRequest then refused them
    // in a company/operational workspace ("Master record is not available in
    // this workspace"). The code resolves against the tenant-wide series scope
    // regardless — manual today, automatic once a BREED_LIFECYCLE_STAGE series
    // is configured, null otherwise.
    const lifecycleCode = await this.numberSeriesService.resolveOptionalCode('BREED_LIFECYCLE_STAGE', dto.lifecycle_code, tenantId, null, undefined, dto as unknown as Record<string, unknown>);

    const lifecycleId = randomUUID();
    const newLifecycleStage = {
      lifecycle_id: lifecycleId,
      tenant_id: tenantId,
      lifecycle_code: lifecycleCode,
      // From the breed row (ADDENDUM 3): never from the request — a request
      // cannot scope a row into a company the breed does not belong to.
      company_id: breed.company_id ?? null,
      nob_id: breed.nob_id ?? null,
      lob_id: breed.lob_id ?? null,
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
      feed_form: dto.feed_form || null,
      feed_wastage_pct: dto.feed_wastage_pct?.toString() || null,
      farm_id: dto.farm_id || null,
      std_body_weight_kg: dto.std_body_weight_kg?.toString() || null,
      std_adg_gpd: dto.std_adg_gpd?.toString() || null,
      std_fcr: dto.std_fcr?.toString() || null,
      std_mortality_rate_pct: dto.std_mortality_rate_pct?.toString() || null,
      output_item_id: dto.output_item_id || null,
      output_uom: dto.output_uom || null,
      std_output_qty: dto.std_output_qty?.toString() || null,
      medication_protocol: dto.medication_protocol ? jsonRows(dto.medication_protocol) : null,
      vaccination_protocol: dto.vaccination_protocol ? jsonRows(dto.vaccination_protocol) : null,
      resource_requirements: dto.resource_requirements ? jsonRows(dto.resource_requirements) : null,
      kpi_thresholds: dto.kpi_thresholds ? jsonRows(dto.kpi_thresholds) : null,
      kpi_lower_limit: dto.kpi_lower_limit?.toString() || null,
      kpi_upper_limit: dto.kpi_upper_limit?.toString() || null,
      alert_severity: dto.alert_severity || null,
      kpi_alert_period: dto.kpi_alert_period || null,
      notes: dto.notes || null,
      is_active: true,
      created_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.breedLifecycleStages).values(newLifecycleStage);
    // The first line's amount and UOM as entered (0195).
    if (feedLines) await this.db.update(schema.breedLifecycleStages).set(this.lineColumns(feedLines[0])).where(eq(schema.breedLifecycleStages.lifecycle_id, lifecycleId));
    // The further feed lines: copies of this row with their own days and feed (no code of their own).
    for (const line of feedLines?.slice(1) ?? []) {
      await this.assertNoEffectiveOverlap({ breed_id: dto.breed_id, stage_id: dto.stage_id, feed_item_id: line.feed_item_id, calc_unit: dto.calc_unit, period_from: line.period_from, period_to: line.period_to, farm_id: dto.farm_id || null, season_type: dto.season_type ?? null, category: dto.category ?? null, company_id: breed.company_id ?? null }, tenantId, [lifecycleId]);
      await this.db.insert(schema.breedLifecycleStages).values({ ...newLifecycleStage, ...this.lineColumns(line), lifecycle_id: randomUUID(), lifecycle_code: null });
    }

    await this.auditService.log({
      tenantId,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'breed_lifecycle_stages',
      entityId: lifecycleId,
      newValues: { ...newLifecycleStage, feed_lines: feedLines ?? undefined },
    });

    return this.findOneLifecycleStage(lifecycleId);
  }

  async createLifecycleStagesBulk(dtos: CreateBreedLifecycleStageDto[], tenantId: string, userPayload?: any) {
    if (!dtos || !dtos.length) {
      throw new BadRequestException('No breed lifecycle stage items provided for bulk creation.');
    }
    const results: any[] = [];
    const errors: { index: number; code?: string; error: string }[] = [];

    for (let i = 0; i < dtos.length; i++) {
      try {
        const item = await this.createLifecycleStage(dtos[i], tenantId, userPayload);
        results.push(item);
      } catch (err: any) {
        errors.push({
          index: i,
          code: dtos[i]?.lifecycle_code,
          error: err?.message || 'Failed to create lifecycle stage',
        });
      }
    }

    if (errors.length > 0 && results.length === 0) {
      throw new BadRequestException({
        message: 'All items in bulk upload failed validation.',
        errors,
      });
    }

    return {
      success: true,
      totalCount: dtos.length,
      createdCount: results.length,
      failedCount: errors.length,
      items: results,
      errors: errors.length > 0 ? errors : undefined,
    };
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
      .where(and(
        eq(schema.breedLifecycleStages.lifecycle_id, id),
        ...nullableFarmScopeConditions(farmScope(this.cls), schema.breedLifecycleStages.farm_id),
      ))
      .limit(1);

    if (!lifecycleStage) {
      throw new NotFoundException(`Breed lifecycle stage with ID '${id}' not found.`);
    }
    // A retired line (0197) stands for the stage it was removed from, active or not.
    const rows = lifecycleStage.retired_at
      ? ((await this.stageRows({ ...lifecycleStage, is_active: true })).length
        ? await this.stageRows({ ...lifecycleStage, is_active: true })
        : await this.stageRows({ ...lifecycleStage, is_active: false }))
      : await this.stageRows(lifecycleStage);
    // Any row of a stage stands for the stage, which is its first row (the one the list shows, holding the code): a
    // link to a later feed line's row (a requisition or scheduler line keeps one) opens and saves the stage itself.
    const first = [...rows].sort((a, b) => Number(a.period_from) - Number(b.period_from) || String(a.lifecycle_id).localeCompare(String(b.lifecycle_id)))[0];
    if (first && first.lifecycle_id !== id) return this.findOneLifecycleStage(first.lifecycle_id);
    return this.withFeedLines(lifecycleStage, rows);
  }

  async findAllLifecycleStages(query: QueryBreedLifecycleStageDto, tenantId: string) {
    const conditions: any[] = [eq(schema.breedLifecycleStages.tenant_id, tenantId)];
    conditions.push(...nullableFarmScopeConditions(farmScope(this.cls), schema.breedLifecycleStages.farm_id));
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

    // One record per stage (13 Oct): a stage fed several feeds is several rows; only its first (lowest Period From)
    // is listed, carrying the others as its feed lines.
    // Retired feed lines (0197) are history, never listed.
    conditions.push(isNull(schema.breedLifecycleStages.retired_at));
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM breed_lifecycle_stages s2 WHERE s2.tenant_id = ${schema.breedLifecycleStages.tenant_id}
      AND s2.breed_id = ${schema.breedLifecycleStages.breed_id} AND s2.stage_id = ${schema.breedLifecycleStages.stage_id}
      AND s2.farm_id <=> ${schema.breedLifecycleStages.farm_id} AND s2.season_type <=> ${schema.breedLifecycleStages.season_type}
      AND s2.category <=> ${schema.breedLifecycleStages.category} AND s2.is_active = ${schema.breedLifecycleStages.is_active} AND s2.retired_at IS NULL
      AND (s2.period_from < ${schema.breedLifecycleStages.period_from}
        OR (s2.period_from = ${schema.breedLifecycleStages.period_from} AND s2.lifecycle_id < ${schema.breedLifecycleStages.lifecycle_id})))`);

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
        // Master Setup r30/r39: the farm a row overrides for; NULL = the default row. A subquery, not a join, so the count query is unchanged.
        farm_name: sql<string | null>`(select ${schema.locationMaster.location_name} from ${schema.locationMaster} where ${schema.locationMaster.location_id} = ${schema.breedLifecycleStages.farm_id})`,
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

    // Each listed stage's rows, to show its whole day range and its feed lines.
    const pairs = [...new Set(data.map((r) => r.breed_id))];
    const siblings = pairs.length
      ? await this.db.select().from(schema.breedLifecycleStages).where(and(
          eq(schema.breedLifecycleStages.tenant_id, tenantId),
          inArray(schema.breedLifecycleStages.breed_id, pairs),
        ))
      : [];
    const byKey = new Map<string, Array<Record<string, any>>>();
    for (const r of siblings) {
      const k = `${siblingKey(r)}|${r.is_active ? 1 : 0}`;
      byKey.set(k, [...(byKey.get(k) ?? []), r]);
    }
    const withLines = data.map((r) => this.withFeedLines(r, byKey.get(`${siblingKey(r)}|${r.is_active ? 1 : 0}`) ?? [r]));

    return { data: withLines, total: Number(counted?.total ?? 0), limit, offset };
  }

  async updateLifecycleStage(id: string, dto: UpdateBreedLifecycleStageDto, tenantId: string, userPayload?: any) {
    const lifecycleStage = await this.findOneLifecycleStage(id);
    // Saved through a later feed line's row: the stage is edited through its first row (see findOneLifecycleStage).
    id = lifecycleStage.lifecycle_id;
    // The stage's other rows (its other feed lines), read before anything changes: they follow this row's shared
    // fields, and with feed_lines they are reassigned, added to or removed (13 Oct).
    const otherRows = (await this.stageRows(lifecycleStage)).filter((r) => r.lifecycle_id !== id);
    const feedLines = dto.feed_lines?.length ? await this.withKg(validateFeedLines(dto.feed_lines as FeedLine[])) : null;
    if (feedLines) {
      for (const line of feedLines) await this.assertItemExists(line.feed_item_id);
      Object.assign(dto, {
        period_from: feedLines[0].period_from, period_to: feedLines[0].period_to,
        feed_item_id: feedLines[0].feed_item_id, feed_form: feedLines[0].feed_form || null,
        feed_qty_per_head_per_day_kg: feedLines[0].kg,
        feed_wastage_pct: feedLines[0].feed_wastage_pct ?? null,
      });
    }
    // ADDENDUM 3: scope is re-derived FROM THE BREED on every update, so the
    // row always carries its breed's company/nob/lob — a request can never set
    // them to something else, and a row saved under 593d7c96's gap is stamped
    // the first time it is edited.
    const breed = await this.findOneBreed(lifecycleStage.breed_id, tenantId);

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
    const effectiveFrom = dto.period_from !== undefined ? dto.period_from : lifecycleStage.period_from;
    const effectiveTo = dto.period_to !== undefined ? dto.period_to : lifecycleStage.period_to;
    if (effectiveFrom != null && effectiveTo != null && effectiveFrom > effectiveTo) {
      throw new BadRequestException('Effective From cannot be greater than Effective To.');
    }
    await this.assertFarmOverride(dto.farm_id, breed.company_id, tenantId);
    await this.assertLifecycleRows(dto, tenantId);
    const pick = <T,>(next: T | undefined, current: T) => (next !== undefined ? next : current);
    await this.assertNoEffectiveOverlap({
      lifecycle_id: id,
      breed_id: lifecycleStage.breed_id,
      stage_id: pick(dto.stage_id, lifecycleStage.stage_id),
      feed_item_id: pick(dto.feed_item_id, lifecycleStage.feed_item_id),
      calc_unit: pick(dto.calc_unit, lifecycleStage.calc_unit),
      period_from: effectiveFrom,
      period_to: effectiveTo,
      farm_id: pick(dto.farm_id, lifecycleStage.farm_id) || null,
      season_type: pick(dto.season_type, lifecycleStage.season_type) ?? null,
      category: pick(dto.category, lifecycleStage.category) ?? null,
      company_id: lifecycleStage.company_id ?? null,
    }, tenantId, otherRows.map((r) => r.lifecycle_id));

    const updates: any = {};
    // Blank means "untouched": the form posts "" for every optional field, and the
    // 24 live rows created before this column existed still hold NULL.
    assertCodeUnchanged('Lifecycle stage', lifecycleStage.lifecycle_code, dto.lifecycle_code);
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
    if (dto.feed_form !== undefined) updates.feed_form = dto.feed_form || null;
    if (dto.feed_wastage_pct !== undefined) updates.feed_wastage_pct = dto.feed_wastage_pct?.toString() || null;
    if (dto.farm_id !== undefined) updates.farm_id = dto.farm_id || null;
    if (dto.std_body_weight_kg !== undefined) updates.std_body_weight_kg = dto.std_body_weight_kg?.toString() || null;
    if (dto.std_adg_gpd !== undefined) updates.std_adg_gpd = dto.std_adg_gpd?.toString() || null;
    if (dto.std_fcr !== undefined) updates.std_fcr = dto.std_fcr?.toString() || null;
    if (dto.std_mortality_rate_pct !== undefined) updates.std_mortality_rate_pct = dto.std_mortality_rate_pct?.toString() || null;
    if (dto.output_item_id !== undefined) updates.output_item_id = dto.output_item_id;
    if (dto.output_uom !== undefined) updates.output_uom = dto.output_uom;
    if (dto.std_output_qty !== undefined) updates.std_output_qty = dto.std_output_qty?.toString() || null;
    if (dto.medication_protocol !== undefined) updates.medication_protocol = dto.medication_protocol ? jsonRows(dto.medication_protocol) : null;
    if (dto.vaccination_protocol !== undefined) updates.vaccination_protocol = dto.vaccination_protocol ? jsonRows(dto.vaccination_protocol) : null;
    if (dto.resource_requirements !== undefined) updates.resource_requirements = dto.resource_requirements ? jsonRows(dto.resource_requirements) : null;
    if (dto.kpi_thresholds !== undefined) updates.kpi_thresholds = dto.kpi_thresholds ? jsonRows(dto.kpi_thresholds) : null;
    if (dto.kpi_lower_limit !== undefined) updates.kpi_lower_limit = dto.kpi_lower_limit?.toString() || null;
    if (dto.kpi_upper_limit !== undefined) updates.kpi_upper_limit = dto.kpi_upper_limit?.toString() || null;
    if (dto.alert_severity !== undefined) updates.alert_severity = dto.alert_severity;
    if (dto.kpi_alert_period !== undefined) updates.kpi_alert_period = dto.kpi_alert_period || null;
    if (dto.notes !== undefined) updates.notes = dto.notes;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    // From the breed, never the request (ADDENDUM 3).
    updates.company_id = breed.company_id ?? null;
    updates.nob_id = breed.nob_id ?? null;
    updates.lob_id = breed.lob_id ?? null;

    await this.db
      .update(schema.breedLifecycleStages)
      .set(updates)
      .where(eq(schema.breedLifecycleStages.lifecycle_id, id));
    // The first line's amount and UOM as entered (0195); a kg rate set without lines was entered in kg.
    if (feedLines) {
      await this.db.update(schema.breedLifecycleStages).set(this.lineColumns(feedLines[0])).where(eq(schema.breedLifecycleStages.lifecycle_id, id));
    } else if (updates.feed_qty_per_head_per_day_kg !== undefined) {
      await this.db.update(schema.breedLifecycleStages).set({ feed_qty_per_head_per_day: null, feed_qty_uom: null }).where(eq(schema.breedLifecycleStages.lifecycle_id, id));
    }

    // The stage's other rows take the same shared fields (KPIs, mortality, protocols, scope, dates): one stage, one
    // set of standards. Their own days and feed are left alone unless feed_lines reassigns them.
    const shared: Record<string, unknown> = { ...updates };
    for (const c of [...BreedService.LINE_COLUMNS, 'lifecycle_code', 'is_active']) delete shared[c];
    const [updated] = await this.db.select().from(schema.breedLifecycleStages).where(eq(schema.breedLifecycleStages.lifecycle_id, id)).limit(1);
    if (Object.keys(shared).length) {
      for (const r of otherRows) {
        await this.db.update(schema.breedLifecycleStages).set(shared).where(eq(schema.breedLifecycleStages.lifecycle_id, r.lifecycle_id));
      }
    }
    if (feedLines) {
      const rest = feedLines.slice(1);
      for (let i = 0; i < rest.length; i++) {
        const line = rest[i];
        await this.assertNoEffectiveOverlap({
          breed_id: updated.breed_id, stage_id: updated.stage_id, feed_item_id: line.feed_item_id, calc_unit: updated.calc_unit,
          period_from: line.period_from, period_to: line.period_to, farm_id: updated.farm_id,
          season_type: updated.season_type ?? null, category: updated.category ?? null, company_id: updated.company_id ?? null,
        }, tenantId, [id, ...otherRows.map((r) => r.lifecycle_id)]);
        if (otherRows[i]) {
          await this.db.update(schema.breedLifecycleStages).set(this.lineColumns(line)).where(eq(schema.breedLifecycleStages.lifecycle_id, otherRows[i].lifecycle_id));
        } else {
          const { lifecycle_id: _id, lifecycle_code: _code, created_at: _created, ...copy } = updated as any;
          await this.db.insert(schema.breedLifecycleStages).values({ ...copy, ...this.lineColumns(line), lifecycle_id: randomUUID(), lifecycle_code: null, created_by: userPayload?.userId || null });
        }
      }
      // Lines taken away are kept as hidden history rows (Rishi, 14 Oct; 0197): a requisition or scheduler line that
      // points at one keeps its stage label and required-feed check, while the row is no longer a line of the stage.
      for (const r of otherRows.slice(rest.length)) {
        await this.db.update(schema.breedLifecycleStages)
          .set({ is_active: false, retired_at: sql`CURRENT_TIMESTAMP` })
          .where(eq(schema.breedLifecycleStages.lifecycle_id, r.lifecycle_id));
      }
    }

    await this.auditService.log({
      tenantId,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'breed_lifecycle_stages',
      entityId: id,
      oldValues: { ...lifecycleStage },
      newValues: { ...updates, ...(feedLines ? { feed_lines: feedLines } : {}) },
    });

    return this.findOneLifecycleStage(id);
  }

  async removeLifecycleStage(id: string, tenantId: string, userPayload?: any) {
    const lifecycleStage = await this.findOneLifecycleStage(id);

    // The whole stage: all its feed lines' rows.
    const rowIds = (await this.stageRows(lifecycleStage)).map((r) => r.lifecycle_id);
    await this.db
      .update(schema.breedLifecycleStages)
      .set({ is_active: false })
      .where(inArray(schema.breedLifecycleStages.lifecycle_id, rowIds.length ? rowIds : [id]));

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

    const rowIds = (await this.stageRows(lifecycleStage)).map((r) => r.lifecycle_id);
    await this.db
      .update(schema.breedLifecycleStages)
      .set({ is_active: true })
      .where(inArray(schema.breedLifecycleStages.lifecycle_id, rowIds.length ? rowIds : [id]));

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
