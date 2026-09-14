import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, inArray, sql, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateBatchDailyDataDto } from './dto/batch-daily-data.dto';
import { CreateUnscheduledHealthDto } from './dto/unscheduled-health.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService, type UserContext } from '../batch/batch.service';
import { BatchTransferService } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { DueLine, stageDayStatus, pendingDays, isLineDue, StageDayStatus } from './day-completeness';
import { entryVerdict, todayIn, todayAtOffset } from './entry-window';
import { userHasPermission } from '../../../common/permissions';
import { ApprovalService } from '../approval/approval.service';
import { batchScopeConditions, farmScope } from '../../../common/farm-scope';

/** approval_request.doc_type for a health event outside the schedule. */
export const UNSCHEDULED_HEALTH = 'UNSCHEDULED_HEALTH';

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
    private readonly approvalService: ApprovalService,
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
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
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
  async pendingDays(batchId: string, upTo: string | undefined, tenantId: string): Promise<string[]> {
    const [batch] = await this.db.select().from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!batch) throw new NotFoundException('Batch not found.');
    const upToDate = upTo || await this.companyToday(batch.company_id);

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
      for (const d of pendingDays(own, from, batchStart, upToDate, enteredByDate)) all.add(d);
    }
    return [...all].sort();
  }

  /**
   * Everything one screen needs to enter a day: the stage list with its ticks,
   * the lines due under the chosen stage with their standard quantity already
   * worked out, whatever was entered before, and — per line — whether this user
   * may touch it today and why not.
   *
   * One call rather than five, and the entry window is answered here rather
   * than re-derived in the browser. A rule the client re-implements is a rule
   * that drifts, and this one decides whether a farm's day is recorded.
   */
  async entryForm(batchId: string, requestedDate: string | undefined, tenantId: string, userPayload?: UserContext, stageId?: string) {
    const [batch] = await this.db.select().from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!batch) throw new NotFoundException('Batch not found.');

    const today = await this.companyToday(batch.company_id);
    // The day defaults here rather than in the browser. A worker in Harare
    // opening this at 01:00 has a browser that says tomorrow; the farm does
    // not, and it is the farm's day that is being recorded.
    const date = requestedDate || today;
    const mayEditAnyDay = await userHasPermission(this.db, userPayload as any, {
      moduleCode: 'PRODUCTION', resource: 'BATCH_ENTRY', action: 'edit',
    });

    const headers = await this.db.select().from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, batchId), eq(schema.schedulerHeader.tenant_id, tenantId)));
    if (!headers.length) {
      return {
        batch: this.batchSummary(batch), date, today, hasScheduler: false,
        mayEditAnyDay, backlog: [], stages: [], lines: [],
      };
    }

    const schedulerIds = headers.map((h) => h.scheduler_id);
    const lines = await this.db.select().from(schema.schedulerLine)
      .where(and(inArray(schema.schedulerLine.scheduler_id, schedulerIds), eq(schema.schedulerLine.is_active, true)));

    const entries = await this.findForDate(batchId, date, tenantId);
    const enteredIds = new Set(entries.map((e) => e.line_id as string));

    // A batch that registers its animals can have them spread across stages, so
    // the count beside a stage is the animals actually standing in it. A count-
    // only batch moves as one, and the scheduler's own figure is all there is.
    const perStageAnimals = new Map<string, number>();
    if (batch.animal_tracking === 'REGISTERED') {
      const counted = await this.db
        .select({ stage_id: schema.animalRegister.current_stage_id, n: sql<number>`count(*)` })
        .from(schema.animalRegister)
        .where(and(
          eq(schema.animalRegister.current_batch_id, batchId),
          eq(schema.animalRegister.is_active, true),
        ))
        .groupBy(schema.animalRegister.current_stage_id);
      for (const row of counted) if (row.stage_id) perStageAnimals.set(row.stage_id, Number(row.n));
    }

    const backlog = mayEditAnyDay
      ? []
      : (await this.pendingDays(batchId, date, tenantId)).filter((d) => d < date);

    const stageIds = [...new Set([
      ...headers.map((h) => h.stage_id).filter(Boolean) as string[],
      ...lines.map((l) => l.stage_id).filter(Boolean) as string[],
      ...perStageAnimals.keys(),
    ])];
    const stageNames = new Map<string, string>();
    if (stageIds.length) {
      for (const st of await this.db
        .select({ id: schema.stageMaster.stage_id, name: schema.stageMaster.stage_name })
        .from(schema.stageMaster).where(inArray(schema.stageMaster.stage_id, stageIds))) {
        stageNames.set(st.id, st.name);
      }
    }

    /* ── The stage strip ─────────────────────────────────────────────────── */
    const stages: any[] = [];
    for (const header of headers) {
      const own = lines.filter((l) => l.scheduler_id === header.scheduler_id).map(this.toDueLine);
      const from = String(header.effective_from).slice(0, 10);
      for (const status of stageDayStatus(own, from, date, enteredIds)) {
        const sid = status.stage_id ?? header.stage_id;
        stages.push({
          ...status,
          stage_id: sid,
          stage_name: sid ? stageNames.get(sid) ?? null : null,
          scheduler_id: header.scheduler_id,
          animal_count: (sid && perStageAnimals.get(sid))
            ?? (header.animal_count == null ? null : Number(header.animal_count)),
        });
      }
    }

    /* ── The lines under the chosen stage ────────────────────────────────── */
    // A count-only batch has one stage and no choice to make, so nothing is
    // asked of the worker: the first stage with work is the one they land on.
    // A registered-animal batch can have animals standing in a stage nothing is
    // scheduled for. Those stages still belong on the strip with their count —
    // leaving them off hides animals, and a farm cannot notice a stage it has
    // no schedule for if the screen never mentions it.
    for (const [sid, n] of perStageAnimals) {
      if (stages.some((st) => st.stage_id === sid)) continue;
      stages.push({
        stage_id: sid, stage_name: stageNames.get(sid) ?? null, scheduler_id: null,
        animal_count: n, due: 0, mandatory: 0, mandatoryEntered: 0, entered: 0,
        // Nothing is owed, but nothing can be entered either — the UI marks
        // this differently from a day's work that is finished.
        complete: true, scheduled: false,
      });
    }
    for (const st of stages) if (st.scheduled === undefined) st.scheduled = true;
    stages.sort((a, b) => Number(b.scheduled) - Number(a.scheduled)
      || String(a.stage_name ?? '').localeCompare(String(b.stage_name ?? '')));

    const chosen = stageId
      ?? stages.find((s) => s.scheduled && !s.complete)?.stage_id
      ?? stages.find((s) => s.scheduled)?.stage_id
      ?? stages[0]?.stage_id ?? null;
    const chosenStage = stages.find((s) => s.stage_id === chosen);
    const headcount = chosenStage?.animal_count ?? null;

    const dueLines = lines.filter((l) => {
      const header = headers.find((h) => h.scheduler_id === l.scheduler_id);
      if (!header) return false;
      const sid = l.stage_id ?? header.stage_id;
      if (chosen && sid !== chosen) return false;
      return isLineDue(this.toDueLine(l), String(header.effective_from).slice(0, 10), date);
    });

    const itemIds = [...new Set(dueLines.map((l) => l.item_id).filter(Boolean) as string[])];
    const items = new Map<string, { name: string; uom: string }>();
    if (itemIds.length) {
      for (const it of await this.db
        .select({ id: schema.itemMaster.item_id, name: schema.itemMaster.item_name, uom: schema.itemMaster.uom_primary })
        .from(schema.itemMaster).where(inArray(schema.itemMaster.item_id, itemIds))) {
        items.set(it.id, { name: it.name, uom: it.uom ?? 'PCS' });
      }
    }

    const formLines = dueLines
      .sort((a, b) => (a.line_seq ?? 0) - (b.line_seq ?? 0))
      .map((l) => {
        const entry = entries.find((e) => e.line_id === l.line_id) ?? null;
        const item = l.item_id ? items.get(l.item_id) : undefined;
        const standard = l.standard_qty == null ? null : Number(l.standard_qty);
        // PER_HEAD is a per-animal ration; the worker is shown the whole pen's
        // quantity, which is what they actually weigh out.
        const suggested = standard != null && l.qty_basis === 'PER_HEAD' && headcount
          ? Number((standard * headcount).toFixed(4))
          : standard;

        const verdict = entryVerdict({
          entryDate: date, today, exists: !!entry, mayEditAnyDay, earlierPending: backlog,
        });

        return {
          line_id: l.line_id,
          line_seq: l.line_seq,
          line_type: l.line_type,
          activity_name: l.activity_name,
          stage_id: l.stage_id,
          is_mandatory: !!l.is_mandatory,
          item_id: l.item_id,
          item_name: item?.name ?? l.item_description ?? null,
          uom: item?.uom ?? l.kpi_uom ?? null,
          standard_qty: standard,
          qty_basis: l.qty_basis,
          suggested_value: suggested,
          allow_qty_edit: l.allow_qty_edit !== false,
          lot_required: !!l.lot_required,
          kpi_metric: l.kpi_metric,
          std_value: l.std_value == null ? null : Number(l.std_value),
          lower_alert_limit: l.lower_alert_limit == null ? null : Number(l.lower_alert_limit),
          upper_alert_limit: l.upper_alert_limit == null ? null : Number(l.upper_alert_limit),
          resource_id: l.resource_id,
          entry: entry
            ? {
                entry_id: entry.entry_id,
                entered_value: entry.entered_value == null ? null : Number(entry.entered_value),
                entered_text: entry.entered_text,
                lot_no: entry.lot_no,
                remarks: entry.remarks,
                posted: !!entry.posted,
                alert_triggered: !!entry.alert_triggered,
                alert_note: entry.alert_note,
              }
            : null,
          editable: verdict.allowed,
          locked_reason: verdict.allowed ? null : verdict.message,
        };
      });

    return {
      batch: this.batchSummary(batch),
      date, today, hasScheduler: true, mayEditAnyDay,
      backlog,
      selected_stage_id: chosen,
      stages,
      lines: formLines,
      complete: stages.some((s) => s.scheduled) && stages.every((s) => s.complete),
    };
  }

  /* ──────────────────────────────────────────────────────────────────────
   * Health events the schedule did not call for.
   *
   * The schedule is what a worker may enter, and that is deliberate: a feed or
   * overhead line invented on the floor is the batch's cost invented on the
   * floor. Health is the exception the farm asked for, because a sick animal
   * will not wait for a schedule to be redesigned.
   *
   * These live in approval_request rather than batch_daily_data. Every row in
   * batch_daily_data answers a scheduler_line — that is what its NOT NULL
   * line_id and its unique (line_id, entry_date) mean — and an event with no
   * line has no honest place there. approval_request already carries a batch, a
   * date, a quantity, a justification and a decision, which is the whole of
   * what an unscheduled event is until someone approves it.
   *
   * The observation is recorded the instant it is raised. What waits for a
   * supervisor is the stock movement and the cost.
   * ────────────────────────────────────────────────────────────────────── */

  async recordUnscheduledHealth(
    batchId: string,
    dto: CreateUnscheduledHealthDto,
    tenantId: string,
    userPayload?: UserContext,
  ) {
    const [batch] = await this.db.select().from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!batch) throw new NotFoundException('Batch not found.');

    // A day that has not happened cannot have been observed. The rest of the
    // entry window does not apply: this is precisely the case the schedule did
    // not foresee, so a backlog must not stop someone reporting a sick animal.
    const today = await this.companyToday(batch.company_id);
    if (dto.entry_date > today) {
      throw new BadRequestException(`${dto.entry_date} has not happened yet — an event cannot be reported in advance.`);
    }

    let medicine: { item_id: string; item_name: string; uom: string } | null = null;
    if (dto.item_id) {
      const [item] = await this.db.select({
        item_id: schema.itemMaster.item_id,
        item_name: schema.itemMaster.item_name,
        uom: schema.itemMaster.uom_primary,
      }).from(schema.itemMaster).where(and(
        eq(schema.itemMaster.item_id, dto.item_id),
        eq(schema.itemMaster.tenant_id, tenantId),
      )).limit(1);
      if (!item) throw new NotFoundException('That medicine is not in the Item Master.');
      medicine = { ...item, uom: item.uom ?? 'PCS' };
    }

    let disease: string | null = null;
    if (dto.disease_id) {
      const [row] = await this.db.select({ name: schema.diseaseMaster.disease_name })
        .from(schema.diseaseMaster).where(and(
          eq(schema.diseaseMaster.disease_id, dto.disease_id),
          eq(schema.diseaseMaster.tenant_id, tenantId),
        )).limit(1);
      if (!row) throw new NotFoundException('That disease is not in the Disease Master.');
      disease = row.name;
    }

    // The decided fields are packed into justification because approval_request
    // is a generic queue: giving it an item_id column for this one case would
    // make every other request carry a column it has no use for.
    const detail = [
      `Observed: ${dto.observation}`,
      disease ? `Suspected: ${disease}` : null,
      medicine ? `Treatment: ${medicine.item_name}${dto.quantity != null ? ` — ${dto.quantity} ${medicine.uom}` : ''}` : null,
      dto.animals_affected != null ? `Animals affected: ${dto.animals_affected}` : null,
      `Date: ${dto.entry_date}`,
      dto.remarks || null,
    ].filter(Boolean).join('\n');

    const request = await this.approvalService.create({
      company_id: batch.company_id,
      doc_type: UNSCHEDULED_HEALTH,
      title: `${batch.batch_no}: ${dto.observation}`.slice(0, 200),
      batch_id: batchId,
      urgency: dto.urgency || 'HIGH',
      item_or_stage: medicine?.item_name ?? disease ?? 'Health event',
      requested_qty: dto.quantity != null ? String(dto.quantity) : undefined,
      uom: medicine?.uom,
      justification: detail,
    } as any, tenantId, userPayload);

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'unscheduled_health_event',
      entityId: (request as any).request_id,
      newValues: { batch_id: batchId, entry_date: dto.entry_date, item_id: dto.item_id ?? null },
    });

    return request;
  }

  /**
   * Health events raised against this batch, newest first.
   *
   * findAll answers with a bare array. Spreading it into an object turned the
   * list into `{"0": {...}}` with the rows also under a nested `data` key —
   * the controller's envelope then carried that instead of an array, so any
   * caller doing `data.map` on it fails. Return the array itself; the
   * controller is what wraps it.
   */
  async listUnscheduledHealth(batchId: string, tenantId: string, status?: string) {
    const res: any = await this.approvalService.findAll({
      doc_type: UNSCHEDULED_HEALTH,
      status,
    } as any, tenantId);
    const rows: any[] = Array.isArray(res) ? res : (res?.data ?? []);
    return rows.filter((r: any) => r.batch_id === batchId);
  }

  /**
   * Approve a health event and let its cost reach the batch.
   *
   * Approval is what moves the stock, so it runs before the decision is
   * recorded: if the medicine cannot be issued — none on hand, no rate — the
   * request stays PENDING rather than being marked approved against a posting
   * that never happened.
   */
  async approveUnscheduledHealth(
    batchId: string,
    requestId: string,
    tenantId: string,
    userPayload?: UserContext,
  ) {
    return this.approvalService.approveUnscheduledHealth(batchId, requestId, tenantId, userPayload);
  }

  async rejectUnscheduledHealth(
    batchId: string,
    requestId: string,
    reason: string | undefined,
    tenantId: string,
    userPayload?: UserContext,
  ) {
    const request: any = await this.approvalService.findOne(requestId, tenantId);
    if (request.doc_type !== UNSCHEDULED_HEALTH || request.batch_id !== batchId) {
      throw new BadRequestException('That request is not an unscheduled health event on this batch.');
    }
    return this.approvalService.reject(requestId, { rejection_reason: reason } as any, tenantId, userPayload);
  }

  /** The dates this batch has anything recorded on, newest first. */
  async entryDates(batchId: string, tenantId: string, limit = 60): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ entry_date: schema.batchDailyData.entry_date })
      .from(schema.batchDailyData)
      .where(and(eq(schema.batchDailyData.batch_id, batchId), eq(schema.batchDailyData.tenant_id, tenantId)))
      .orderBy(desc(schema.batchDailyData.entry_date))
      .limit(limit);
    return rows.map((r) => String(r.entry_date).slice(0, 10));
  }

  private batchSummary(batch: typeof schema.batchHeader.$inferSelect) {
    return {
      batch_id: batch.batch_id,
      batch_no: batch.batch_no,
      animal_tracking: batch.animal_tracking,
      stage_id: batch.stage_id,
      start_date: String(batch.start_date).slice(0, 10),
      status: batch.status,
    };
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
    return withTenantTransaction(this.cls, async () => {
    // Serialize entries/corrections on the batch before taking any snapshot.
    // The scope filter means this lock also doubles as the out-of-farm guard —
    // nothing after here checks the batch's farm again.
    const [lockedBatch] = await this.db.select({ batch_id: schema.batchHeader.batch_id }).from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
      .for('update');
    if (!lockedBatch) throw new NotFoundException('Batch not found.');
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

    const [previous] = await this.db.select().from(schema.batchDailyData)
      .where(and(eq(schema.batchDailyData.line_id, line.line_id), eq(schema.batchDailyData.entry_date, dto.entry_date))).limit(1);
    if (previous?.posted) {
      const sameValue = (previous.entered_value == null ? null : Number(previous.entered_value)) === (dto.entered_value ?? null);
      const sameText = (previous.entered_text || null) === (dto.entered_text || null);
      const sameLot = (previous.lot_no || null) === (dto.lot_no || null);
      if (sameValue && sameText && sameLot && dto.rate == null && !dto.destination_batch_id) {
        return this.findForDate(batchId, dto.entry_date, tenantId);
      }
      if (line.line_type !== 'CONSUMPTION' || !previous.posting_reference) {
        throw new ConflictException('This posted entry requires a document-specific reversal before it can be changed.');
      }
      await this.batchService.reverseConsumption(batchId, previous.posting_reference, tenantId, userPayload);
    }

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
          lot_no: dto.lot_no,
          quantity: dto.entered_value,
          uom: item?.uom_primary || 'PCS',
          rate: dto.rate,
          remarks: dto.remarks || `${line.activity_name} — scheduled entry`,
        } as any, tenantId, userPayload);
        posted = true;
        postingReference = updated.posting_transaction_id;
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
        posted = true;
        postingReference = updated.posting_transaction_id;
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
    });
  }

  async findForDate(batchId: string, entryDate: string, tenantId: string) {
    return this.db
      .select()
      .from(schema.batchDailyData)
      .where(and(eq(schema.batchDailyData.batch_id, batchId), eq(schema.batchDailyData.entry_date, entryDate), eq(schema.batchDailyData.tenant_id, tenantId)));
  }
}
