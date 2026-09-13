import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateBatchDailyDataDto } from './dto/batch-daily-data.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService, type UserContext } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { DueLine, stageDayStatus, pendingDays, StageDayStatus } from './day-completeness';
import { entryVerdict, todayIn, todayAtOffset } from './entry-window';
import { userHasPermission } from '../../../common/permissions';

const toMysqlTimestamp = (date: Date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

/**
 * Turns one scheduler_line checklist answer into whatever the "LINE TYPE
 * REFERENCE" sheet (Master Templates/Schedule_master_template.xlsx) says that
 * line_type does on posting — reusing the batch module's existing, already-
 * correct costing/GL pipeline (BatchService.addTransaction) rather than
 * re-deriving FIFO/standard-cost/bio-asset logic here.
 */
@Injectable()
export class BatchDailyDataService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly batchService: BatchService,
    private readonly batchTransferService: BatchTransferService,
    private readonly glPostingService: GlPostingService,
  ) {}

  /**
   * Everything the entry screen needs to draw its stage list for one date:
   * which stages have work, how many animals are in each, and whether the
   * mandatory lines have been answered.
   *
   * A batch can carry more than one scheduler (one per stage), so the lines are
   * grouped by their own scheduler's `effective_from` — day 3 of farrowing is
   * not day 3 of gestation.
   */
  async dayStatus(batchId: string, date: string, tenantId: string) {
    const [batch] = await this.db.select().from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId)))
      .limit(1);
    if (!batch) throw new NotFoundException('Batch not found.');

    const headers = await this.db.select().from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, batchId), eq(schema.schedulerHeader.tenant_id, tenantId)));
    if (!headers.length) {
      return { batch_id: batchId, date, animal_tracking: batch.animal_tracking, stages: [], hasScheduler: false };
    }

    const lines = await this.db.select().from(schema.schedulerLine)
      .where(inArray(schema.schedulerLine.scheduler_id, headers.map((h) => h.scheduler_id)));

    const entered = new Set((await this.db.select({ line_id: schema.batchDailyData.line_id })
      .from(schema.batchDailyData)
      .where(and(
        eq(schema.batchDailyData.batch_id, batchId),
        eq(schema.batchDailyData.entry_date, date),
      ))).map((r) => r.line_id as string));

    // Per scheduler, because each has its own start date.
    const stages: (StageDayStatus & { animal_count: number | null; scheduler_id: string })[] = [];
    for (const header of headers) {
      const own = lines.filter((l) => l.scheduler_id === header.scheduler_id).map(this.toDueLine);
      const from = String(header.effective_from).slice(0, 10);
      for (const status of stageDayStatus(own, from, date, entered)) {
        stages.push({
          ...status,
          stage_id: status.stage_id ?? header.stage_id,
          // decimal(14,4) reaches here as a string; a headcount is a number.
          animal_count: header.animal_count == null ? null : Number(header.animal_count),
          scheduler_id: header.scheduler_id,
        });
      }
    }

    return {
      batch_id: batchId, date, animal_tracking: batch.animal_tracking,
      hasScheduler: true, stages,
      complete: stages.every((s) => s.complete),
    };
  }

  /**
   * The days from the batch's start up to `upTo` that still have an unanswered
   * mandatory line, oldest first — the backlog the worker must clear before
   * today can be entered.
   */
  async pendingDays(batchId: string, upTo: string, tenantId: string): Promise<string[]> {
    const [batch] = await this.db.select().from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId)))
      .limit(1);
    if (!batch) throw new NotFoundException('Batch not found.');

    const headers = await this.db.select().from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, batchId), eq(schema.schedulerHeader.tenant_id, tenantId)));
    if (!headers.length) return [];

    const lines = await this.db.select().from(schema.schedulerLine)
      .where(inArray(schema.schedulerLine.scheduler_id, headers.map((h) => h.scheduler_id)));

    const rows = await this.db.select({
      line_id: schema.batchDailyData.line_id, entry_date: schema.batchDailyData.entry_date,
    }).from(schema.batchDailyData).where(eq(schema.batchDailyData.batch_id, batchId));
    const enteredByDate = new Map<string, Set<string>>();
    for (const r of rows) {
      const key = String(r.entry_date).slice(0, 10);
      (enteredByDate.get(key) ?? enteredByDate.set(key, new Set()).get(key)!).add(r.line_id as string);
    }

    // A day is pending if ANY of the batch's schedulers still wants something
    // that day, so the union across schedulers is what the worker must clear.
    const batchStart = String(batch.start_date).slice(0, 10);
    const all = new Set<string>();
    for (const header of headers) {
      const own = lines.filter((l) => l.scheduler_id === header.scheduler_id).map(this.toDueLine);
      const from = String(header.effective_from).slice(0, 10);
      for (const d of pendingDays(own, from, batchStart, upTo, enteredByDate)) all.add(d);
    }
    return [...all].sort();
  }

  private toDueLine = (l: typeof schema.schedulerLine.$inferSelect): DueLine => ({
    line_id: l.line_id,
    stage_id: l.stage_id ?? null,
    occurrence: l.occurrence ?? null,
    start_day: l.start_day ?? null,
    end_day: l.end_day ?? null,
    day_of_week: l.day_of_week ?? null,
    is_mandatory: !!l.is_mandatory,
  });


  /**
   * Today's date on the farm, from the company's own timezone.
   *
   * The column is named default_timezone_id but holds an IANA code in the data
   * we have, so the code is tried first and timezone_master's stored offset is
   * the fallback for rows that really do hold an id.
   */
  private async companyToday(companyId: string): Promise<string> {
    const [company] = await this.db
      .select({ tz: schema.companyMaster.default_timezone_id })
      .from(schema.companyMaster)
      .where(eq(schema.companyMaster.company_id, companyId))
      .limit(1);

    const byCode = todayIn(company?.tz);
    if (byCode) return byCode;

    if (company?.tz) {
      const [zone] = await this.db
        .select({ code: schema.timezoneMaster.tz_code, offset: schema.timezoneMaster.offset_minutes })
        .from(schema.timezoneMaster)
        .where(eq(schema.timezoneMaster.tz_id, company.tz))
        .limit(1);
      if (zone) return todayIn(zone.code) ?? todayAtOffset(zone.offset);
    }
    // A company with no resolvable timezone still has to be able to record a
    // day; UTC is the honest default rather than a refusal.
    return todayAtOffset(0);
  }

  /**
   * Applies the entry window: no future days, workers may only change today's
   * own entries, and today waits until the backlog before it is cleared.
   *
   * The supervisor exemption is read from the permission table — edit on
   * PRODUCTION/BATCH_ENTRY — and never from a role name, so a farm that renames
   * or adds roles does not have to come back to this code.
   */
  private async assertMayRecord(
    batchId: string,
    companyId: string,
    lineId: string,
    entryDate: string,
    tenantId: string,
    userPayload?: UserContext,
  ): Promise<void> {
    const today = await this.companyToday(companyId);
    const mayEditAnyDay = await userHasPermission(this.db, userPayload as any, {
      moduleCode: 'PRODUCTION', resource: 'BATCH_ENTRY', action: 'edit',
    });

    const [existing] = await this.db
      .select({ entry_id: schema.batchDailyData.entry_id })
      .from(schema.batchDailyData)
      .where(and(
        eq(schema.batchDailyData.line_id, lineId),
        eq(schema.batchDailyData.entry_date, entryDate),
      ))
      .limit(1);

    // Only computed for a worker, and only up to the day being entered — a
    // supervisor is exempt, so the backlog query is work nobody would read.
    const earlierPending = mayEditAnyDay
      ? []
      : (await this.pendingDays(batchId, entryDate, tenantId)).filter((d) => d < entryDate);

    const verdict = entryVerdict({
      entryDate, today, exists: !!existing, mayEditAnyDay, earlierPending,
    });
    if (verdict.allowed) return;

    // A future date is the request being wrong; the other two are the user not
    // being allowed to do it yet, which is a different thing to the client.
    if (verdict.code === 'FUTURE') throw new BadRequestException(verdict.message);
    throw new ForbiddenException(verdict.message);
  }

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async postEntry(batchId: string, dto: CreateBatchDailyDataDto, tenantId: string, userPayload?: UserContext) {
    const [line] = await this.db.select().from(schema.schedulerLine).where(eq(schema.schedulerLine.line_id, dto.line_id)).limit(1);
    if (!line) throw new NotFoundException(`Scheduler line '${dto.line_id}' not found.`);
    if (!line.is_active) throw new ConflictException('This line has been deactivated and no longer accepts entries.');

    const [header] = await this.db.select().from(schema.schedulerHeader).where(eq(schema.schedulerHeader.scheduler_id, line.scheduler_id)).limit(1);
    if (!header || header.batch_id !== batchId) {
      throw new BadRequestException(`Line '${dto.line_id}' does not belong to batch '${batchId}'.`);
    }
    if (line.lot_required && !dto.lot_no) {
      throw new BadRequestException(`'${line.activity_name}' requires a lot number.`);
    }

    await this.assertMayRecord(batchId, header.company_id, line.line_id, dto.entry_date, tenantId, userPayload);

    const entryId = randomUUID();
    let posted = false;
    let postingReference: string | null = null;
    let alertTriggered = false;
    let alertNote: string | null = null;

    switch (line.line_type) {
      case 'CONSUMPTION':
      case 'OUTPUT': {
        if (!line.item_id) throw new ConflictException(`'${line.activity_name}' has no item configured — fix the line before posting entries against it.`);
        if (dto.entered_value == null) throw new BadRequestException('entered_value is required for this line.');
        const [item] = await this.db.select().from(schema.itemMaster).where(eq(schema.itemMaster.item_id, line.item_id)).limit(1);
        const updated = await this.batchService.addTransaction(batchId, {
          transaction_date: dto.entry_date,
          transaction_type: line.line_type,
          item_id: line.item_id,
          quantity: dto.entered_value,
          uom: item?.uom_primary || 'PCS',
          rate: dto.rate,
          remarks: dto.remarks || `${line.activity_name} — scheduled entry`,
        } as any, tenantId, userPayload);
        // No created_at in this projection to sort by — the newly-inserted row is
        // reliably last for a simple unordered SELECT against an append-only table.
        const matchingTx = (updated.transactions || [])
          .filter((t: any) => t.transaction_date === dto.entry_date && t.item_id === line.item_id && t.transaction_type === line.line_type);
        posted = true;
        postingReference = matchingTx[matchingTx.length - 1]?.transaction_id || null;
        break;
      }
      case 'DESCRIPTIVE': {
        if (dto.entered_value == null && !dto.entered_text) {
          throw new BadRequestException('entered_value or entered_text is required for this line.');
        }
        if (dto.entered_value != null) {
          const minVal = line.lower_alert_limit != null ? Number(line.lower_alert_limit) : -Infinity;
          const maxVal = line.upper_alert_limit != null ? Number(line.upper_alert_limit) : Infinity;
          if (dto.entered_value < minVal || dto.entered_value > maxVal) {
            alertTriggered = true;
            alertNote = `${line.activity_name}: ${dto.entered_value} outside [${line.lower_alert_limit ?? '-∞'}, ${line.upper_alert_limit ?? '∞'}]`;
            await this.db.insert(schema.notificationAlertLog).values({
              alert_id: randomUUID(),
              tenant_id: tenantId,
              company_id: header.company_id,
              lob_id: header.lob_id,
              batch_id: batchId,
              line_id: line.line_id,
              alert_type: 'KPI_DEVIATION',
              severity: line.alert_severity === 'INFO' || line.alert_severity === 'CRITICAL' ? line.alert_severity : 'WARNING',
              title: `${line.activity_name} Out of Range — Batch Schedule`,
              message: alertNote,
              activity_name: line.activity_name,
              kpi_mode: 'VALUE',
              expected_value: line.std_value,
              actual_value: dto.entered_value.toString(),
              kpi_min: line.lower_alert_limit,
              kpi_max: line.upper_alert_limit,
            });
          }
        }
        // "Animal count... updated daily from batch_daily_data" (Schedule_master_template.xlsx).
        // HEAD_COUNT is an absolute daily count; MORTALITY_COUNT is a delta against
        // whatever was already recorded for this line+date, so a farmer correcting
        // today's mortality entry doesn't double-decrement animal_count.
        if (dto.entered_value != null && (line.kpi_metric === 'HEAD_COUNT' || line.kpi_metric === 'MORTALITY_COUNT')) {
          let newCount: number;
          if (line.kpi_metric === 'HEAD_COUNT') {
            newCount = dto.entered_value;
          } else {
            const [existing] = await this.db.select({ entered_value: schema.batchDailyData.entered_value })
              .from(schema.batchDailyData)
              .where(and(eq(schema.batchDailyData.line_id, line.line_id), eq(schema.batchDailyData.entry_date, dto.entry_date)))
              .limit(1);
            const previousEntered = existing?.entered_value != null ? Number(existing.entered_value) : 0;
            const delta = dto.entered_value - previousEntered;
            newCount = Math.max(0, Number(header.animal_count) - delta);

            // Keep animal_register in step with the reported death count — without
            // this, a stage transition re-derives animal_count from animal_register's
            // own live count (createForStage()) and silently reverts the mortality
            // this line just recorded. Only handles a net *increase* in deaths
            // (delta > 0); a downward correction has no unambiguous animal to
            // "revive" so animal_count above is still corrected, just not the registry.
            const deathsToRecord = Math.round(delta);
            if (deathsToRecord > 0) {
              const dying = await this.db
                .select({ animal_id: schema.animalRegister.animal_id })
                .from(schema.animalRegister)
                .where(and(
                  eq(schema.animalRegister.current_batch_id, batchId),
                  eq(schema.animalRegister.is_active, true),
                  sql`${schema.animalRegister.status} NOT IN ('DEAD','SOLD','CULLED','SLAUGHTERED')`,
                ))
                .orderBy(schema.animalRegister.created_at)
                .limit(deathsToRecord);
              if (dying.length) {
                await this.db.update(schema.animalRegister)
                  .set({
                    is_active: false,
                    status: 'DEAD',
                    disposal_type: 'DIED',
                    disposal_date: dto.entry_date,
                    updated_by: userPayload?.userId || null,
                    updated_at: toMysqlTimestamp(),
                  })
                  .where(inArray(schema.animalRegister.animal_id, dying.map((a) => a.animal_id)));
              }
            }
          }
          await this.db.update(schema.schedulerHeader)
            .set({ animal_count: newCount.toString(), updated_at: toMysqlTimestamp() })
            .where(eq(schema.schedulerHeader.scheduler_id, header.scheduler_id));
        }
        break;
      }
      case 'OVERHEAD':
      case 'RESOURCE': {
        if (dto.entered_value == null) throw new BadRequestException('entered_value is required for this line.');
        let quantity = dto.entered_value;
        let rate = dto.rate ?? null;
        if (line.line_type === 'RESOURCE') {
          if (!line.resource_id) throw new ConflictException(`'${line.activity_name}' has no resource configured.`);
          if (rate == null) {
            const [resource] = await this.db.select().from(schema.resourceMaster).where(eq(schema.resourceMaster.resource_id, line.resource_id)).limit(1);
            rate = resource?.cost_rate != null ? Number(resource.cost_rate) : null;
          }
        } else if (rate == null) {
          // OVERHEAD lines are naturally entered as a single day's total cost —
          // quantity 1 x rate = that amount, rather than asking the farmer to
          // split a utility bill into a unit rate they don't track.
          rate = quantity;
          quantity = 1;
        }
        if (rate == null) throw new BadRequestException(`'${line.activity_name}' needs a rate to post — supply one or set it on the resource.`);
        const updated = await this.batchService.addTransaction(batchId, {
          transaction_date: dto.entry_date,
          transaction_type: 'OVERHEAD',
          resource_id: line.resource_id || undefined,
          quantity,
          rate,
          remarks: dto.remarks || `${line.activity_name} — scheduled entry`,
        } as any, tenantId, userPayload);
        const matchingTx = (updated.transactions || [])
          .filter((t: any) => t.transaction_date === dto.entry_date && t.transaction_type === 'OVERHEAD');
        posted = true;
        postingReference = matchingTx[matchingTx.length - 1]?.transaction_id || null;
        break;
      }
      case 'TRANSFER': {
        if (!dto.destination_batch_id) throw new BadRequestException("TRANSFER lines require destination_batch_id.");
        if (dto.entered_value == null && line.standard_qty == null) {
          throw new BadRequestException('entered_value (or the line\'s standard_qty) is required to know how many head to move.');
        }
        const headcount = Math.round(dto.entered_value ?? Number(line.standard_qty));
        // Auto-select the oldest still-in-this-batch animals up to the requested
        // headcount — the schedule line only says how many move, not which ones;
        // FIFO-by-registration is the same order the rest of the app already
        // assumes when it doesn't have a farmer's explicit pick.
        const candidates = await this.db
          .select({ animal_id: schema.animalRegister.animal_id })
          .from(schema.animalRegister)
          .where(and(eq(schema.animalRegister.current_batch_id, batchId), eq(schema.animalRegister.is_active, true)))
          .orderBy(schema.animalRegister.created_at)
          .limit(headcount);
        if (!candidates.length) {
          throw new ConflictException(`No animals currently in batch '${batchId}' to transfer.`);
        }
        const transferResult = await this.batchTransferService.create(
          {
            company_id: header.company_id,
            to_batch_id: dto.destination_batch_id,
            transfer_date: dto.entry_date,
            transfer_type: 'PARTIAL',
            animal_ids: candidates.map((c) => c.animal_id),
            reason: line.activity_name,
            remarks: dto.remarks,
            auto_triggers_stage: line.auto_triggers_stage,
          } as any,
          tenantId,
          batchId,
          userPayload,
        );
        posted = true;
        postingReference = (transferResult as any)?.transfer_id || dto.destination_batch_id;
        break;
      }
      default:
        throw new BadRequestException(`Unknown line_type '${line.line_type}'.`);
    }

    await this.db.insert(schema.batchDailyData).values({
      entry_id: entryId,
      tenant_id: tenantId,
      company_id: header.company_id,
      line_id: line.line_id,
      batch_id: batchId,
      entry_date: dto.entry_date,
      entered_value: dto.entered_value?.toString() ?? null,
      entered_text: dto.entered_text || null,
      lot_no: dto.lot_no || null,
      posted,
      posting_reference: postingReference,
      alert_triggered: alertTriggered,
      alert_note: alertNote,
      remarks: dto.remarks || null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    }).onDuplicateKeyUpdate({
      set: {
        entered_value: dto.entered_value?.toString() ?? null,
        entered_text: dto.entered_text || null,
        lot_no: dto.lot_no || null,
        posted,
        posting_reference: postingReference,
        alert_triggered: alertTriggered,
        alert_note: alertNote,
        remarks: dto.remarks || null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      },
    });

    await this.auditService.log({
      tenantId,
      companyId: header.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'batch_daily_data',
      entityId: entryId,
      newValues: { line_id: line.line_id, batch_id: batchId, entry_date: dto.entry_date },
    });

    return this.findForDate(batchId, dto.entry_date, tenantId);
  }

  async findForDate(batchId: string, entryDate: string, tenantId: string) {
    return this.db
      .select()
      .from(schema.batchDailyData)
      .where(and(eq(schema.batchDailyData.batch_id, batchId), eq(schema.batchDailyData.entry_date, entryDate), eq(schema.batchDailyData.tenant_id, tenantId)));
  }
}
