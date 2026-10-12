import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, inArray, like, asc, count, max, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { farmScope, restrictedScopeConditions, assertCompanyInScope, assertLobInScope } from '../../../common/farm-scope';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { SchedulerHeaderService, pickLineFields } from './scheduler-header.service';
import { CreateSchedulerLineDto, UpdateSchedulerLineDto, CopySchedulerLinesDto } from './dto/scheduler-header.dto';
import {
  CreateSystemSchedulerDto, UpdateSystemSchedulerDto, QuerySystemSchedulerDto, MatchSystemSchedulerDto,
} from './dto/system-scheduler.dto';

const toMysqlTimestamp = (date: Date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

type LineInput = CreateSchedulerLineDto | UpdateSchedulerLineDto;

/**
 * System schedulers — a stage's standard activities with no batch, copied into
 * a batch's scheduler_header when the user accepts one (see
 * SchedulerHeaderService.findMatchingSystemScheduler / createForStage). The
 * lines follow the same LINE TYPE REFERENCE rules and overlap check as a
 * batch's lines, borrowed from SchedulerHeaderService so the two never drift.
 */
@Injectable()
export class SystemSchedulerService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly schedulerHeaderService: SchedulerHeaderService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  private scopeConditions() {
    return restrictedScopeConditions(farmScope(this.cls), {
      companyId: schema.systemScheduler.company_id,
      lobId: schema.systemScheduler.lob_id,
    });
  }

  async findAll(query: QuerySystemSchedulerDto, tenantId: string) {
    const conditions = [eq(schema.systemScheduler.tenant_id, tenantId), ...this.scopeConditions()];
    if (query.companyId) conditions.push(eq(schema.systemScheduler.company_id, query.companyId));
    if (query.lobId) conditions.push(eq(schema.systemScheduler.lob_id, query.lobId));
    if (query.stageId) {
      // Either id of the stage finds it — see findMatchingSystemScheduler.
      const [stage] = await this.db.select({ lob_id: schema.stageMaster.lob_id, stage_code: schema.stageMaster.stage_code })
        .from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, query.stageId)).limit(1);
      if (!stage) return [];
      conditions.push(eq(schema.systemScheduler.lob_id, stage.lob_id), eq(schema.systemScheduler.stage_code, stage.stage_code));
    }
    if (query.breedId) conditions.push(eq(schema.systemScheduler.breed_id, query.breedId));
    if (query.search) conditions.push(like(schema.systemScheduler.scheduler_name, `%${query.search}%`));

    const rows = await this.db.select().from(schema.systemScheduler).where(and(...conditions));
    if (!rows.length) return [];

    const stageIds = [...new Set(rows.map((r) => r.stage_id))];
    const stages = await this.db
      .select({ stage_id: schema.stageMaster.stage_id, stage_name: schema.stageMaster.stage_name, stage_sequence: schema.stageMaster.stage_sequence })
      .from(schema.stageMaster).where(inArray(schema.stageMaster.stage_id, stageIds));
    const stageById = new Map(stages.map((s) => [s.stage_id, s]));

    const breedIds = [...new Set(rows.map((r) => r.breed_id).filter((x): x is string => !!x))];
    const breedNameById = breedIds.length ? new Map(
      (await this.db.select({ breed_id: schema.breedMaster.breed_id, breed_name: schema.breedMaster.breed_name })
        .from(schema.breedMaster).where(inArray(schema.breedMaster.breed_id, breedIds))
      ).map((b) => [b.breed_id, b.breed_name]),
    ) : new Map<string, string>();

    const lineCounts = await this.db
      .select({ system_scheduler_id: schema.systemSchedulerLine.system_scheduler_id, total: count() })
      .from(schema.systemSchedulerLine)
      .where(and(
        inArray(schema.systemSchedulerLine.system_scheduler_id, rows.map((r) => r.system_scheduler_id)),
        eq(schema.systemSchedulerLine.is_active, true),
      ))
      .groupBy(schema.systemSchedulerLine.system_scheduler_id);
    const lineCountById = new Map(lineCounts.map((l) => [l.system_scheduler_id, Number(l.total)]));

    // Stage order first (the order a batch passes through them), then the
    // every-breed row ahead of the breed-specific ones it is overridden by.
    return rows
      .map((r) => ({
        ...r,
        stage_name: stageById.get(r.stage_id)?.stage_name ?? null,
        stage_sequence: stageById.get(r.stage_id)?.stage_sequence ?? null,
        breed_name: r.breed_id ? breedNameById.get(r.breed_id) ?? null : null,
        line_count: lineCountById.get(r.system_scheduler_id) ?? 0,
      }))
      .sort((a, b) =>
        (a.stage_sequence ?? Number.MAX_SAFE_INTEGER) - (b.stage_sequence ?? Number.MAX_SAFE_INTEGER)
        || (a.stage_name ?? '').localeCompare(b.stage_name ?? '')
        || (a.breed_id ? 1 : 0) - (b.breed_id ? 1 : 0)
        || (a.breed_name ?? '').localeCompare(b.breed_name ?? ''));
  }

  /**
   * Which of these stages has a system scheduler a batch of this breed would
   * copy — what the web asks before creating a batch or transferring a stage,
   * to decide whether to put the question to the user at all.
   */
  async match(query: MatchSystemSchedulerDto) {
    assertCompanyInScope(farmScope(this.cls), query.companyId);
    const stageIds = [...(query.stageIds ?? [])];
    if (query.stageCodes?.length) {
      if (!query.lobId) throw new BadRequestException('lobId is required with stageCodes.');
      // Any one id of each code will do: the match itself is on LOB + code.
      const rows = await this.db.select({ stage_id: schema.stageMaster.stage_id, stage_code: schema.stageMaster.stage_code })
        .from(schema.stageMaster)
        .where(and(eq(schema.stageMaster.lob_id, query.lobId), inArray(schema.stageMaster.stage_code, query.stageCodes), isNull(schema.stageMaster.deleted_at)));
      const idByCode = new Map<string, string>();
      for (const r of rows) if (!idByCode.has(r.stage_code)) idByCode.set(r.stage_code, r.stage_id);
      stageIds.push(...idByCode.values());
    }
    const matches: Array<{
      stage_id: string; stage_code: string | null; stage_name: string | null; system_scheduler_id: string;
      scheduler_name: string; breed_id: string | null; line_count: number;
    }> = [];
    for (const stageId of [...new Set(stageIds)]) {
      const found = await this.schedulerHeaderService.findMatchingSystemScheduler(query.companyId, stageId, query.breedId);
      if (!found) continue;
      const [stage] = await this.db.select({ stage_name: schema.stageMaster.stage_name, stage_code: schema.stageMaster.stage_code })
        .from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, stageId)).limit(1);
      matches.push({
        stage_id: stageId,
        stage_code: stage?.stage_code ?? null,
        stage_name: stage?.stage_name ?? null,
        system_scheduler_id: found.system_scheduler_id,
        scheduler_name: found.scheduler_name,
        breed_id: found.breed_id,
        line_count: found.line_count,
      });
    }
    return matches;
  }

  async findOne(id: string) {
    const [header] = await this.db.select().from(schema.systemScheduler)
      .where(and(eq(schema.systemScheduler.system_scheduler_id, id), ...this.scopeConditions()))
      .limit(1);
    if (!header) throw new NotFoundException(`System scheduler '${id}' not found.`);

    const lines = await this.db.select().from(schema.systemSchedulerLine)
      .where(and(eq(schema.systemSchedulerLine.system_scheduler_id, id), eq(schema.systemSchedulerLine.is_active, true)))
      .orderBy(asc(schema.systemSchedulerLine.line_seq));
    const lineIds = lines.map((l) => l.line_id);
    const customDays = lineIds.length
      ? await this.db.select().from(schema.systemSchedulerLineCustomDays).where(inArray(schema.systemSchedulerLineCustomDays.line_id, lineIds))
      : [];

    const [stage] = await this.db.select({ stage_name: schema.stageMaster.stage_name, lob_id: schema.stageMaster.lob_id })
      .from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, header.stage_id)).limit(1);
    const [breed] = header.breed_id
      ? await this.db.select({ breed_name: schema.breedMaster.breed_name }).from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, header.breed_id)).limit(1)
      : [null];

    const itemIds = [...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x))];
    const itemById = itemIds.length ? new Map(
      (await this.db.select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name, uom_primary: schema.itemMaster.uom_primary, withdrawal_days: schema.itemMaster.withdrawal_days })
        .from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, itemIds))
      ).map((it) => [it.item_id, it]),
    ) : new Map();
    const resourceIds = [...new Set(lines.map((l) => l.resource_id).filter((x): x is string => !!x))];
    const resourceNameById = resourceIds.length ? new Map(
      (await this.db.select({ resource_id: schema.resourceMaster.resource_id, resource_name: schema.resourceMaster.resource_name })
        .from(schema.resourceMaster).where(inArray(schema.resourceMaster.resource_id, resourceIds))
      ).map((r) => [r.resource_id, r.resource_name]),
    ) : new Map<string, string>();

    return {
      ...header,
      stage_name: stage?.stage_name ?? null,
      breed_name: breed?.breed_name ?? null,
      // Same line shape scheduler-header's findOne returns, so the web's line
      // table and form serve both.
      lines: lines.map((line) => {
        const item = line.item_id ? itemById.get(line.item_id) : null;
        return {
          ...line,
          uom: item?.uom_primary || (item ? 'PCS' : null),
          item_description: line.item_description || item?.item_name || null,
          withdrawal_days: item?.withdrawal_days ?? null,
          resource_name: line.resource_id ? resourceNameById.get(line.resource_id) ?? null : null,
          custom_days: customDays.filter((d) => d.line_id === line.line_id),
        };
      }),
    };
  }

  async create(dto: CreateSystemSchedulerDto, tenantId: string, userPayload?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const scope = farmScope(this.cls);
      assertCompanyInScope(scope, dto.company_id);

      const [stage] = await this.db.select().from(schema.stageMaster).where(eq(schema.stageMaster.stage_id, dto.stage_id)).limit(1);
      if (!stage || stage.deleted_at) throw new NotFoundException(`Stage '${dto.stage_id}' not found.`);
      assertLobInScope(scope, stage.lob_id);

      if (dto.breed_id) {
        const [breed] = await this.db.select({ breed_id: schema.breedMaster.breed_id, lob_id: schema.breedMaster.lob_id })
          .from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, dto.breed_id)).limit(1);
        if (!breed) throw new NotFoundException(`Breed '${dto.breed_id}' not found.`);
        if (breed.lob_id && breed.lob_id !== stage.lob_id) {
          throw new BadRequestException(`That breed does not belong to stage '${stage.stage_name}'s line of business.`);
        }
      }

      const breedKey = dto.breed_id || '*';
      const [existing] = await this.db.select({ scheduler_name: schema.systemScheduler.scheduler_name })
        .from(schema.systemScheduler)
        .where(and(
          eq(schema.systemScheduler.company_id, dto.company_id),
          eq(schema.systemScheduler.lob_id, stage.lob_id),
          eq(schema.systemScheduler.stage_code, stage.stage_code),
          eq(schema.systemScheduler.breed_key, breedKey),
        ))
        .limit(1);
      if (existing) {
        throw new ConflictException(
          `Stage '${stage.stage_name}' already has a system scheduler ${dto.breed_id ? 'for this breed' : 'for every breed'} ('${existing.scheduler_name}'). Edit that one instead.`,
        );
      }

      const lines = dto.lines ?? [];
      lines.forEach((line, i) => {
        this.schedulerHeaderService.assertLineTypeFields(line.line_type, line, line as unknown as Record<string, unknown>);
        this.schedulerHeaderService.assertNoConflictingLines(line, lines.slice(0, i));
      });

      const id = randomUUID();
      await this.db.insert(schema.systemScheduler).values({
        system_scheduler_id: id,
        tenant_id: tenantId,
        company_id: dto.company_id,
        lob_id: stage.lob_id,
        nob_id: stage.nob_id ?? null,
        stage_id: dto.stage_id,
        stage_code: stage.stage_code,
        breed_id: dto.breed_id || null,
        breed_key: breedKey,
        scheduler_name: dto.scheduler_name.trim(),
        data_entry_level: dto.data_entry_level || 'SHED',
        notes: dto.notes || null,
        created_by: userPayload?.userId || null,
      });
      for (let i = 0; i < lines.length; i++) await this.insertLine(id, i + 1, lines[i]);

      await this.auditService.log({
        tenantId, companyId: dto.company_id, userId: userPayload?.userId,
        action: 'CREATE', entityName: 'system_scheduler', entityId: id,
        newValues: { stage_id: dto.stage_id, breed_id: dto.breed_id || null, scheduler_name: dto.scheduler_name, lines_count: lines.length },
      });
      return this.findOne(id);
    });
  }

  async update(id: string, dto: UpdateSystemSchedulerDto, tenantId: string, userPayload?: { userId?: string }) {
    const header = await this.findOne(id);
    const updates: Record<string, unknown> = { updated_at: toMysqlTimestamp() };
    if (dto.scheduler_name !== undefined) updates.scheduler_name = dto.scheduler_name.trim();
    if (dto.data_entry_level !== undefined) updates.data_entry_level = dto.data_entry_level;
    if (dto.notes !== undefined) updates.notes = dto.notes;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    await this.db.update(schema.systemScheduler).set(updates).where(eq(schema.systemScheduler.system_scheduler_id, id));
    await this.auditService.log({
      tenantId, companyId: header.company_id, userId: userPayload?.userId,
      action: 'UPDATE', entityName: 'system_scheduler', entityId: id, newValues: updates,
    });
    return this.findOne(id);
  }

  /** Batch schedulers copied from it keep their lines — they were snapshots — and only lose the link's name. */
  async remove(id: string, tenantId: string, userPayload?: { userId?: string }) {
    const header = await this.findOne(id);
    await withTenantTransaction(this.cls, async () => {
      await this.db.delete(schema.systemScheduler).where(eq(schema.systemScheduler.system_scheduler_id, id));
      await this.auditService.log({
        tenantId, companyId: header.company_id, userId: userPayload?.userId,
        action: 'DELETE', entityName: 'system_scheduler', entityId: id,
        oldValues: { stage_id: header.stage_id, breed_id: header.breed_id, scheduler_name: header.scheduler_name, lines_count: header.lines.length },
      });
    });
    return { system_scheduler_id: id, deleted: true };
  }

  async addLine(id: string, dto: CreateSchedulerLineDto, tenantId: string, userPayload?: { userId?: string }) {
    const header = await this.findOne(id);
    this.schedulerHeaderService.assertLineTypeFields(dto.line_type, dto, dto as unknown as Record<string, unknown>);
    this.schedulerHeaderService.assertNoConflictingLines(dto, header.lines);
    // line_seq is unique per system scheduler, and removed lines are deleted,
    // so the next one is the highest in use plus one — not the row count.
    const [{ maxSeq }] = await this.db
      .select({ maxSeq: max(schema.systemSchedulerLine.line_seq) })
      .from(schema.systemSchedulerLine)
      .where(eq(schema.systemSchedulerLine.system_scheduler_id, id));
    const lineId = await withTenantTransaction(this.cls, () => this.insertLine(id, Number(maxSeq ?? 0) + 1, dto));
    await this.auditService.log({
      tenantId, companyId: header.company_id, userId: userPayload?.userId,
      action: 'CREATE', entityName: 'system_scheduler_line', entityId: lineId, newValues: dto,
    });
    return this.findOne(id);
  }

  async updateLine(id: string, lineId: string, dto: UpdateSchedulerLineDto, tenantId: string, userPayload?: { userId?: string }) {
    const header = await this.findOne(id);
    const line = header.lines.find((l) => l.line_id === lineId);
    if (!line) throw new NotFoundException(`Line '${lineId}' not found on this system scheduler.`);

    const effectiveType = dto.line_type ?? line.line_type;
    const effective = { ...line, ...dto };
    this.schedulerHeaderService.assertLineTypeFields(effectiveType, { ...dto, line_type: effectiveType }, effective as unknown as Record<string, unknown>);
    this.schedulerHeaderService.assertNoConflictingLines(effective, header.lines.filter((l) => l.line_id !== lineId));

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined || key === 'custom_days') continue;
      updates[key] = typeof value === 'number' ? value.toString() : value;
    }
    if ('kpi_metric' in updates || 'kpi_uom' in updates) {
      updates.kpi_uom = this.schedulerHeaderService.resolveKpiUom((updates.kpi_metric as string) ?? line.kpi_metric, (updates.kpi_uom as string) ?? line.kpi_uom);
    }

    await withTenantTransaction(this.cls, async () => {
      if (Object.keys(updates).length) {
        await this.db.update(schema.systemSchedulerLine).set(updates).where(eq(schema.systemSchedulerLine.line_id, lineId));
      }
      if (dto.custom_days) {
        await this.db.delete(schema.systemSchedulerLineCustomDays).where(eq(schema.systemSchedulerLineCustomDays.line_id, lineId));
        if (dto.custom_days.length) {
          await this.db.insert(schema.systemSchedulerLineCustomDays).values(
            [...new Set(dto.custom_days)].map((day) => ({ custom_day_id: randomUUID(), line_id: lineId, day_number: day })),
          );
        }
      }
      await this.db.update(schema.systemScheduler).set({ updated_at: toMysqlTimestamp() }).where(eq(schema.systemScheduler.system_scheduler_id, id));
    });

    await this.auditService.log({
      tenantId, companyId: header.company_id, userId: userPayload?.userId,
      action: 'UPDATE', entityName: 'system_scheduler_line', entityId: lineId, oldValues: line, newValues: dto,
    });
    return this.findOne(id);
  }

  /**
   * Fills an empty system scheduler from another one, or from a batch's
   * scheduler — so a plan that worked on a real batch can become the stage's
   * standard. Refused once it has a line, like the batch-side copy.
   */
  async copyLinesInto(id: string, dto: CopySchedulerLinesDto, tenantId: string, userPayload?: { userId?: string }) {
    await withTenantTransaction(this.cls, async () => {
      const header = await this.findOne(id);
      if (header.lines.length) {
        throw new ConflictException('This system scheduler already has activities. Copying is offered only while it has none.');
      }
      let sourceLines: Array<Record<string, any>>;
      if (dto.source_type === 'SYSTEM') {
        if (dto.source_id === id) throw new BadRequestException('A system scheduler cannot copy its own activities.');
        const source = await this.findOne(dto.source_id);
        if (source.company_id !== header.company_id) throw new NotFoundException(`System scheduler '${dto.source_id}' not found.`);
        sourceLines = source.lines;
      } else {
        const source = await this.schedulerHeaderService.findOne(dto.source_id);
        if (source.company_id !== header.company_id) throw new NotFoundException(`Scheduler '${dto.source_id}' not found.`);
        sourceLines = source.lines.filter((l) => l.is_active);
      }
      if (!sourceLines.length) throw new BadRequestException('The chosen scheduler has no activities to copy.');

      const [{ maxSeq }] = await this.db
        .select({ maxSeq: max(schema.systemSchedulerLine.line_seq) })
        .from(schema.systemSchedulerLine)
        .where(eq(schema.systemSchedulerLine.system_scheduler_id, id));
      let seq = Number(maxSeq ?? 0);
      for (const line of [...sourceLines].sort((a, b) => a.line_seq - b.line_seq)) {
        await this.insertLine(id, ++seq, {
          ...pickLineFields(line),
          line_type: line.line_type,
          activity_name: line.activity_name,
          custom_days: (line.custom_days || []).map((d: { day_number: number }) => d.day_number),
        } as CreateSchedulerLineDto);
      }
      await this.db.update(schema.systemScheduler).set({ updated_at: toMysqlTimestamp() }).where(eq(schema.systemScheduler.system_scheduler_id, id));
      await this.auditService.log({
        tenantId, companyId: header.company_id, userId: userPayload?.userId,
        action: 'COPY_LINES', entityName: 'system_scheduler', entityId: id,
        newValues: { source_type: dto.source_type, source_id: dto.source_id, lines_copied: sourceLines.length },
      });
    });
    return this.findOne(id);
  }

  /** A template has no history to keep, so a removed line is deleted outright (custom days cascade). */
  async removeLine(id: string, lineId: string, tenantId: string, userPayload?: { userId?: string }) {
    const header = await this.findOne(id);
    const line = header.lines.find((l) => l.line_id === lineId);
    if (!line) throw new NotFoundException(`Line '${lineId}' not found on this system scheduler.`);
    await this.db.delete(schema.systemSchedulerLine).where(eq(schema.systemSchedulerLine.line_id, lineId));
    await this.auditService.log({
      tenantId, companyId: header.company_id, userId: userPayload?.userId,
      action: 'DELETE', entityName: 'system_scheduler_line', entityId: lineId, oldValues: line,
    });
    return this.findOne(id);
  }

  private async insertLine(systemSchedulerId: string, seq: number, line: LineInput & { line_type: string; activity_name: string }) {
    const lineId = randomUUID();
    await this.db.insert(schema.systemSchedulerLine).values({
      line_id: lineId,
      system_scheduler_id: systemSchedulerId,
      line_seq: seq,
      line_type: line.line_type,
      activity_name: line.activity_name,
      occurrence: line.occurrence || 'DAILY',
      start_day: line.start_day ?? 1,
      end_day: line.end_day ?? null,
      day_of_week: line.day_of_week ?? null,
      is_mandatory: line.is_mandatory ?? false,
      item_id: line.item_id || null,
      item_description: line.item_description || null,
      standard_qty: line.standard_qty != null ? line.standard_qty.toString() : null,
      qty_basis: line.qty_basis || null,
      allow_qty_edit: line.allow_qty_edit ?? true,
      lot_required: line.lot_required ?? false,
      creates_inventory: line.creates_inventory ?? false,
      output_lot_auto: line.output_lot_auto ?? true,
      output_basis: line.output_basis || null,
      auto_triggers_stage: line.auto_triggers_stage ?? false,
      kpi_metric: line.kpi_metric || null,
      kpi_uom: this.schedulerHeaderService.resolveKpiUom(line.kpi_metric, line.kpi_uom),
      std_value: line.std_value != null ? line.std_value.toString() : null,
      lower_alert_limit: line.lower_alert_limit != null ? line.lower_alert_limit.toString() : null,
      upper_alert_limit: line.upper_alert_limit != null ? line.upper_alert_limit.toString() : null,
      alert_severity: line.alert_severity || 'WARNING',
      capture_per: line.capture_per || null,
      overhead_category: line.overhead_category || null,
      gl_account: line.gl_account || null,
      estimated_cost: line.estimated_cost != null ? line.estimated_cost.toString() : null,
      resource_id: line.resource_id || null,
    });
    if (line.occurrence === 'CUSTOM' && line.custom_days?.length) {
      await this.db.insert(schema.systemSchedulerLineCustomDays).values(
        [...new Set(line.custom_days)].map((day) => ({ custom_day_id: randomUUID(), line_id: lineId, day_number: day })),
      );
    }
    return lineId;
  }
}
