import { masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateStageDto, UpdateStageDto, QueryStageDto } from './dto/stage.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';

@Injectable()
export class StageService {
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

  /** Resolves by stage_category first (e.g. STAGE_PRODUCTIVE), then the master-alone STAGE series, else manual. */
  private async resolveStageCode(dto: CreateStageDto, tenantId: string): Promise<string> {
    const seriesCode = await this.numberSeriesService.resolveSeriesFor('STAGE', dto.stage_category, tenantId, dto.company_id);
    if (!seriesCode) {
      if (!dto.stage_code) {
        throw new BadRequestException('stage_code is required — no number series is configured for stages.');
      }
      return dto.stage_code.toUpperCase();
    }
    const series = await this.numberSeriesService.lockSeries(seriesCode, tenantId, dto.company_id);
    if (series.allow_manual && dto.stage_code) {
      return dto.stage_code.toUpperCase();
    }
    return this.numberSeriesService.generateNext(seriesCode, tenantId, dto.company_id, undefined, dto as unknown as Record<string, unknown>);
  }

  /** AUTO_BY_DAY stages must specify which day to auto-move on. */
  private assertAutoMoveDayWhenAutoByDay(transitionTrigger: string, autoMoveOnDay?: number | null) {
    if (transitionTrigger === 'AUTO_BY_DAY' && autoMoveOnDay == null) {
      throw new ConflictException('auto_move_on_day is required when transition_trigger is AUTO_BY_DAY.');
    }
  }

  private async assertStageExists(stageId: string) {
    const [stage] = await this.db
      .select()
      .from(schema.stageMaster)
      .where(and(eq(schema.stageMaster.stage_id, stageId), isNull(schema.stageMaster.deleted_at)))
      .limit(1);
    if (!stage) {
      throw new NotFoundException(`Stage with ID '${stageId}' not found.`);
    }
  }

  async create(dto: CreateStageDto, tenantId: string, userPayload?: any) {
    // NOB/LOB are no longer asked on the form — derive them from the company's
    // operational areas (an explicit dto value, if a caller still sends one,
    // wins). stage_master.nob_id/lob_id are NOT NULL, so an ambiguous company
    // (operational areas split across LOBs) surfaces a clear error here
    // instead of a raw DB constraint failure — unlike item/resource/number-series,
    // a stage genuinely cannot exist without knowing which LOB it belongs to.
    const resolved = await this.nobLobResolution.resolve(tenantId, dto.company_id, {
      nob_id: dto.nob_id,
      lob_id: dto.lob_id,
    });
    if (!resolved.nob_id || !resolved.lob_id) {
      throw new BadRequestException(
        "Cannot determine this stage's Nature of Business / Line of Business — this company's operational areas span multiple business verticals. Specify nob_id and lob_id explicitly.",
      );
    }
    const nobId = resolved.nob_id;
    const lobId = resolved.lob_id;

    const [nob] = await this.db
      .select()
      .from(schema.nobMaster)
      .where(eq(schema.nobMaster.nob_id, nobId))
      .limit(1);
    if (!nob) {
      throw new NotFoundException(`NOB with ID '${nobId}' not found.`);
    }

    const [lob] = await this.db
      .select()
      .from(schema.lobMaster)
      .where(eq(schema.lobMaster.lob_id, lobId))
      .limit(1);
    if (!lob) {
      throw new NotFoundException(`LOB with ID '${lobId}' not found.`);
    }

    this.assertAutoMoveDayWhenAutoByDay(dto.transition_trigger, dto.auto_move_on_day);

    if (dto.next_stage_id) await this.assertStageExists(dto.next_stage_id);
    if (dto.alt_next_stage_id) await this.assertStageExists(dto.alt_next_stage_id);

    // Resolve the stage code — a series (stage_category first, then STAGE alone) if
    // one is configured, else the user-supplied code.
    const stageCode = await this.resolveStageCode(dto, tenantId);

    const duplicateConditions = [
      eq(schema.stageMaster.tenant_id, tenantId),
      eq(schema.stageMaster.lob_id, lobId),
      eq(schema.stageMaster.stage_code, stageCode),
      isNull(schema.stageMaster.deleted_at),
    ];
    if (dto.company_id) {
      duplicateConditions.push(eq(schema.stageMaster.company_id, dto.company_id));
    } else {
      duplicateConditions.push(isNull(schema.stageMaster.company_id));
    }

    const existing = await this.db
      .select()
      .from(schema.stageMaster)
      .where(and(...duplicateConditions))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Stage code '${stageCode}' already exists for this LOB.`);
    }

    const stageId = randomUUID();
    const newStage = {
      stage_id: stageId,
      tenant_id: tenantId,
      company_id: dto.company_id || null,
      nob_id: nobId,
      lob_id: lobId,
      stage_code: stageCode,
      stage_name: dto.stage_name,
      stage_category: dto.stage_category,
      stage_sequence: dto.stage_sequence,
      typical_duration_days: dto.typical_duration_days ?? null,
      min_days_before_move: dto.min_days_before_move ?? 0,
      transition_trigger: dto.transition_trigger,
      auto_move_on_day: dto.auto_move_on_day ?? null,
      next_stage_id: dto.next_stage_id || null,
      alt_next_stage_id: dto.alt_next_stage_id || null,
      alt_trigger_condition: dto.alt_trigger_condition || null,
      required_kpi_to_pass: dto.required_kpi_to_pass ? JSON.stringify(dto.required_kpi_to_pass) : null,
      data_entry_form: dto.data_entry_form || 'STANDARD',
      scheduler_auto_create: dto.scheduler_auto_create ?? true,
      show_on_animal_card: dto.show_on_animal_card ?? true,
      icon_code: dto.icon_code || null,
      stage_description: dto.stage_description || null,
      sort_order: dto.sort_order ?? null,
      is_system: false,
      is_active: true,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.stageMaster).values(newStage);

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'stage_master',
      entityId: stageId,
      newValues: newStage,
    });

    return this.findOne(stageId);
  }

  async findOne(id: string) {
    const [stage] = await this.db
      .select()
      .from(schema.stageMaster)
      .where(and(eq(schema.stageMaster.stage_id, id), isNull(schema.stageMaster.deleted_at)))
      .limit(1);

    if (!stage) {
      throw new NotFoundException(`Stage with ID '${id}' not found.`);
    }

    return stage;
  }

  async findAll(query: QueryStageDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.stageMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.stageMaster, query.companyId));
    if (query.nobId) conditions.push(eq(schema.stageMaster.nob_id, query.nobId));
    if (query.lobId) conditions.push(eq(schema.stageMaster.lob_id, query.lobId));
    if (query.stageCategory) conditions.push(eq(schema.stageMaster.stage_category, query.stageCategory));
    if (query.isActive !== undefined) conditions.push(eq(schema.stageMaster.is_active, query.isActive));
    if (query.search) {
      conditions.push(
        or(
          like(schema.stageMaster.stage_code, `%${query.search}%`),
          like(schema.stageMaster.stage_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.stageMaster, query.filter));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.stageMaster)
      .where(and(...conditions))
      .orderBy(listOrderBy(schema.stageMaster, query, schema.stageMaster.stage_sequence))
      .limit(limit)
      .offset(offset);
  }

  async update(id: string, dto: UpdateStageDto, tenantId: string, userPayload?: any) {
    const stage = await this.findOne(id);

    const effectiveTrigger = dto.transition_trigger ?? stage.transition_trigger;
    const effectiveAutoMoveDay = dto.auto_move_on_day !== undefined ? dto.auto_move_on_day : stage.auto_move_on_day;
    this.assertAutoMoveDayWhenAutoByDay(effectiveTrigger, effectiveAutoMoveDay as any);

    if (dto.next_stage_id) await this.assertStageExists(dto.next_stage_id);
    if (dto.alt_next_stage_id) await this.assertStageExists(dto.alt_next_stage_id);

    const updates: any = {
      updated_by: userPayload?.userId || null,
    };

    if (dto.stage_name !== undefined) updates.stage_name = dto.stage_name;
    if (dto.stage_category !== undefined) updates.stage_category = dto.stage_category;
    if (dto.stage_sequence !== undefined) updates.stage_sequence = dto.stage_sequence;
    if (dto.typical_duration_days !== undefined) updates.typical_duration_days = dto.typical_duration_days;
    if (dto.min_days_before_move !== undefined) updates.min_days_before_move = dto.min_days_before_move;
    if (dto.transition_trigger !== undefined) updates.transition_trigger = dto.transition_trigger;
    if (dto.auto_move_on_day !== undefined) updates.auto_move_on_day = dto.auto_move_on_day;
    if (dto.next_stage_id !== undefined) updates.next_stage_id = dto.next_stage_id;
    if (dto.alt_next_stage_id !== undefined) updates.alt_next_stage_id = dto.alt_next_stage_id;
    if (dto.alt_trigger_condition !== undefined) updates.alt_trigger_condition = dto.alt_trigger_condition;
    if (dto.required_kpi_to_pass !== undefined) updates.required_kpi_to_pass = JSON.stringify(dto.required_kpi_to_pass);
    if (dto.data_entry_form !== undefined) updates.data_entry_form = dto.data_entry_form;
    if (dto.scheduler_auto_create !== undefined) updates.scheduler_auto_create = dto.scheduler_auto_create;
    if (dto.show_on_animal_card !== undefined) updates.show_on_animal_card = dto.show_on_animal_card;
    if (dto.icon_code !== undefined) updates.icon_code = dto.icon_code;
    if (dto.stage_description !== undefined) updates.stage_description = dto.stage_description;
    if (dto.sort_order !== undefined) updates.sort_order = dto.sort_order;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;

    await this.db
      .update(schema.stageMaster)
      .set(updates)
      .where(eq(schema.stageMaster.stage_id, id));

    await this.auditService.log({
      tenantId,
      companyId: stage.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'stage_master',
      entityId: id,
      oldValues: stage,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const stage = await this.findOne(id);

    if (stage.is_system) {
      throw new BadRequestException(`Stage '${stage.stage_code}' is a system-seeded stage and cannot be deleted.`);
    }

    await this.db
      .update(schema.stageMaster)
      .set({
        is_active: false,
        deleted_at: new Date().toISOString().slice(0, 19).replace('T', ' ') as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.stageMaster.stage_id, id));

    await this.auditService.log({
      tenantId,
      companyId: stage.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'stage_master',
      entityId: id,
      oldValues: stage,
    });

    return { success: true, message: `Stage '${stage.stage_name}' has been deactivated.` };
  }
}
