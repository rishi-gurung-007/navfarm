import { withTenantTransaction } from '../../../common/tenant-transaction';
import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException, Optional } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, inArray, sql, desc, ne, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CorrectDailyEntryDto, CreateBatchDailyDataDto, PostDailyDraftsDto, SaveDailyDraftDto } from './dto/batch-daily-data.dto';
import { CreateUnscheduledHealthDto } from './dto/unscheduled-health.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { BatchService, type UserContext } from '../batch/batch.service';
import { BatchTransferService, transferActorApprovalMode } from '../batch/batch-transfer.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { DueLine, stageDayStatus, pendingDays, isLineDue, StageDayStatus, addDays, datesBetween } from './day-completeness';
import { entryVerdict, isCorrectableLineType, todayIn, todayAtOffset } from './entry-window';
import { resolveTarget, TargetScope } from './entry-targeting';
import { activityStates, dayState, DayState } from './entry-history-state';
import { userHasPermission } from '../../../common/permissions';
import { ApprovalService } from '../approval/approval.service';
import { ResourceLedgerService } from '../resource-ledger/resource-ledger.service';
import { batchReferenceScopeConditions, batchScopeConditions, farmScope, restrictedScopeConditions } from '../../../common/farm-scope';

/** approval_request.doc_type for a health event outside the schedule. */
export const UNSCHEDULED_HEALTH = 'UNSCHEDULED_HEALTH';

const toMysqlTimestamp = (date: Date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

/* Phase 6 messages — the web shows these as written, so they are fixed text. */
const STALE_ENTRY = 'This entry was changed by someone else. Reload to see the latest.';
const ALREADY_POSTED = 'This line is already posted. Use Correct to change it.';
const NOTHING_TO_POST = 'Nothing to post.';

type DailyRow = typeof schema.batchDailyData.$inferSelect;
type BatchRow = typeof schema.batchHeader.$inferSelect;
type LineRow = typeof schema.schedulerLine.$inferSelect;
type HeaderRow = typeof schema.schedulerHeader.$inferSelect;
/** What a posting needs from an entry, whether it arrives in a request or from a saved draft. */
type EntryValues = Omit<CreateBatchDailyDataDto, 'line_id'>;
type ResolvedTarget = { scope: TargetScope; animalIds: string[]; stageAnimalIds: string[] };

/** GET form / PUT draft / POST post / POST correct — the contract's EntryView (plus the alert it raised). */
export interface EntryView {
  entry_id: string;
  status: 'DRAFT' | 'POSTED';
  version: number;
  entered_value: number | null;
  entered_text: string | null;
  lot_no: string | null;
  remarks: string | null;
  target_scope: TargetScope;
  animal_ids: string[];
  supersedes_entry_id: string | null;
  posted: boolean;
  alert_triggered: boolean;
  alert_note: string | null;
}

/**
 * A row's place in DRAFT → POSTED → SUPERSEDED. Every row written before
 * Phase 6 went through save-is-post, which is why the column defaults to
 * POSTED (Ruling 2); a row read without the column is read the same way.
 */
const statusOf = (row: Partial<DailyRow> | null | undefined) => (row ? (row.status ?? 'POSTED') : null);

/** mysql2 answers an UPDATE with [ResultSetHeader, fields]; undefined when the driver says nothing. */
const affectedRows = (result: unknown): number | undefined => {
  const header = Array.isArray(result) ? result[0] : result;
  return (header as { affectedRows?: number } | undefined)?.affectedRows;
};

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
    @Optional() private readonly resourceLedgerService?: ResourceLedgerService,
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
    const customDaysByLine = await this.loadCustomDays(lines.map((l) => l.line_id));

    const entered = new Set((await this.db.select({ line_id: schema.batchDailyData.line_id })
      .from(schema.batchDailyData)
      .where(and(
        eq(schema.batchDailyData.batch_id, batchId),
        eq(schema.batchDailyData.entry_date, date),
        // A draft is not an answer: only a posted line ticks the stage.
        eq(schema.batchDailyData.status, 'POSTED'),
      ))).map((r) => r.line_id as string));

    // A REGISTERED batch's animals move stage-by-stage, so the scheduler's own
    // animal_count (a snapshot from whenever the stage started) drifts from
    // reality; the live animal_register count is what "how many are here now"
    // actually means for that kind of batch. A COUNT_ONLY batch has no register
    // rows to re-derive from, so its scheduler figure is still all there is.
    const perStageAnimals = batch.animal_tracking === 'REGISTERED'
      ? await this.liveStageAnimalCounts(batchId)
      : new Map<string, number>();

    // Per scheduler, because each has its own start date.
    const stages: (StageDayStatus & { animal_count: number | null; scheduler_id: string })[] = [];
    for (const header of headers) {
      const own = lines.filter((l) => l.scheduler_id === header.scheduler_id).map((l) => this.toDueLine(l, customDaysByLine));
      const from = String(header.effective_from).slice(0, 10);
      for (const status of stageDayStatus(own, from, date, entered)) {
        const sid = status.stage_id ?? header.stage_id;
        // Guarded rather than `sid && get(sid)`: with no stage the && yields the
        // empty string itself, which ?? passes straight through as a headcount.
        const liveCount = sid ? perStageAnimals.get(sid) : undefined;
        stages.push({
          ...status,
          stage_id: sid,
          // decimal(14,4) reaches here as a string; a headcount is a number.
          animal_count: liveCount
            ?? (header.animal_count == null ? null : Number(header.animal_count)),
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
   * mandatory line, oldest first. These no longer gate today's entry (decided
   * 2026-09-14) — they surface in History as Missing, for the worker to
   * backfill and for admins to be notified about.
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
    const customDaysByLine = await this.loadCustomDays(lines.map((l) => l.line_id));

    const rows = await this.db.select({
      line_id: schema.batchDailyData.line_id, entry_date: schema.batchDailyData.entry_date,
    }).from(schema.batchDailyData).where(and(
      eq(schema.batchDailyData.batch_id, batchId),
      eq(schema.batchDailyData.status, 'POSTED'),
    ));
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
      const own = lines.filter((l) => l.scheduler_id === header.scheduler_id).map((l) => this.toDueLine(l, customDaysByLine));
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
    const mode: 'COUNT_ONLY' | 'REGISTERED' = batch.animal_tracking === 'REGISTERED' ? 'REGISTERED' : 'COUNT_ONLY';
    if (!headers.length) {
      return {
        batch: this.batchSummary(batch), date, today, hasScheduler: false,
        mayEditAnyDay, backlog: [], stages: [], lines: [], activities: [],
        targeting: { mode, default_scope: mode === 'REGISTERED' ? 'STAGE_ANIMALS' : 'BATCH', stage_animals: [] },
      };
    }

    const schedulerIds = headers.map((h) => h.scheduler_id);
    const lines = await this.db.select().from(schema.schedulerLine)
      .where(and(inArray(schema.schedulerLine.scheduler_id, schedulerIds), eq(schema.schedulerLine.is_active, true)));
    const customDaysByLine = await this.loadCustomDays(lines.map((l) => l.line_id));

    const entries = await this.findForDate(batchId, date, tenantId);
    // The stage ticks count postings only; a draft shows on its sub-card but owes the day still.
    const enteredIds = new Set(entries.filter((e) => statusOf(e) === 'POSTED').map((e) => e.line_id as string));
    const targetsByEntry = await this.loadTargets(entries.map((e) => e.entry_id));

    // A batch that registers its animals can have them spread across stages, so
    // the count beside a stage is the animals actually standing in it. A count-
    // only batch moves as one, and the scheduler's own figure is all there is.
    const perStageAnimals = batch.animal_tracking === 'REGISTERED'
      ? await this.liveStageAnimalCounts(batchId)
      : new Map<string, number>();

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
      const own = lines.filter((l) => l.scheduler_id === header.scheduler_id).map((l) => this.toDueLine(l, customDaysByLine));
      const from = String(header.effective_from).slice(0, 10);
      for (const status of stageDayStatus(own, from, date, enteredIds)) {          const sid = status.stage_id ?? header.stage_id;
          // Guarded rather than `sid && get(sid)`, matching dayStatus: with no
          // stage the && yields the empty string itself, which ?? passes
          // straight through as a headcount.
          const liveCount = sid ? perStageAnimals.get(sid) : undefined;
          stages.push({
            ...status,
            stage_id: sid,
            stage_name: sid ? stageNames.get(sid) ?? null : null,
            scheduler_id: header.scheduler_id,
            animal_count: liveCount
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
      return isLineDue(this.toDueLine(l, customDaysByLine), String(header.effective_from).slice(0, 10), date);
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

        const isPosted = statusOf(entry) === 'POSTED';
        // Only a posting fences the worker off a past day; finishing a draft is still entry.
        const verdict = entryVerdict({
          entryDate: date, today, exists: isPosted, mayEditAnyDay,
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
          entry: entry ? this.toEntryView(entry, targetsByEntry.get(entry.entry_id) ?? []) : null,
          editable: verdict.allowed,
          locked_reason: verdict.allowed ? null : verdict.message,
          // Correct is offered where the window allows a change and a reversal exists (Ruling 3).
          correctable: isPosted && verdict.allowed && isCorrectableLineType(l),
        };
      });

    // Parent Activity cards, derived from their sub-cards by the shared rule.
    const activities = activityStates(formLines.map((l) => ({
      line_id: l.line_id,
      line_type: l.line_type,
      line_seq: l.line_seq ?? 0,
      is_mandatory: l.is_mandatory,
      status: l.entry?.status ?? null,
    })));

    // Who a line may be recorded against (spec §4): a Registered batch's animals
    // standing in the chosen stage, or nothing to choose on a Count Only batch.
    const stageAnimals = mode === 'REGISTERED' && chosen ? await this.stageAnimals(batchId, chosen) : [];

    return {
      batch: this.batchSummary(batch),
      date, today, hasScheduler: true, mayEditAnyDay,
      backlog,
      selected_stage_id: chosen,
      stages,
      lines: formLines,
      complete: stages.some((s) => s.scheduled) && stages.every((s) => s.complete),
      activities,
      targeting: {
        mode,
        default_scope: mode === 'REGISTERED' ? 'STAGE_ANIMALS' : 'BATCH',
        stage_animals: stageAnimals,
      },
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

  /**
   * The dates this batch has anything recorded on, newest first.
   *
   * Unlike every other read here this one never loads the batch, so before
   * 14 September it answered for any batch id in the tenant. batch_daily_data
   * has no farm of its own — the farm is its batch's — hence batchOnFarm.
   */
  async entryDates(batchId: string, tenantId: string, limit = 60): Promise<string[]> {
    const scope = farmScope(this.cls);
    const rows = await this.db
      .selectDistinct({ entry_date: schema.batchDailyData.entry_date })
      .from(schema.batchDailyData)
      .where(and(
        eq(schema.batchDailyData.batch_id, batchId),
        eq(schema.batchDailyData.tenant_id, tenantId),
        // A corrected line keeps its old row for the trail (Ruling 1); it is not a date of its own.
        ne(schema.batchDailyData.status, 'SUPERSEDED'),
        ...batchReferenceScopeConditions(scope, schema.batchDailyData.batch_id),
        ...restrictedScopeConditions(scope, { companyId: schema.batchDailyData.company_id }),
      ))
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

  private toDueLine = (l: typeof schema.schedulerLine.$inferSelect, customDaysByLine?: Map<string, number[]>): DueLine => ({
    line_id: l.line_id,
    stage_id: l.stage_id ?? null,
    occurrence: l.occurrence ?? null,
    start_day: l.start_day ?? null,
    end_day: l.end_day ?? null,
    day_of_week: l.day_of_week ?? null,
    is_mandatory: !!l.is_mandatory,
    custom_days: customDaysByLine?.get(l.line_id) ?? null,
  });

  /** scheduler_line_custom_days for a set of lines, keyed by line_id — CUSTOM
   * occurrence's day list, day 1 = the header's own effective_from. */
  private async loadCustomDays(lineIds: string[]): Promise<Map<string, number[]>> {
    const map = new Map<string, number[]>();
    if (!lineIds.length) return map;
    const rows = await this.db
      .select({ line_id: schema.schedulerLineCustomDays.line_id, day_number: schema.schedulerLineCustomDays.day_number })
      .from(schema.schedulerLineCustomDays)
      .where(inArray(schema.schedulerLineCustomDays.line_id, lineIds));
    for (const r of rows) {
      const list = map.get(r.line_id);
      if (list) list.push(r.day_number);
      else map.set(r.line_id, [r.day_number]);
    }
    return map;
  }

  /** The live count of active animals actually standing in each stage, for a
   * REGISTERED-tracking batch — the same query entryForm() uses, so the
   * Registered day status and the entry screen never disagree on "how many".
   */
  private async liveStageAnimalCounts(batchId: string): Promise<Map<string, number>> {
    const perStageAnimals = new Map<string, number>();
    const counted = await this.db
      .select({ stage_id: schema.animalRegister.current_stage_id, n: sql<number>`count(*)` })
      .from(schema.animalRegister)
      .where(and(
        eq(schema.animalRegister.current_batch_id, batchId),
        eq(schema.animalRegister.is_active, true),
      ))
      .groupBy(schema.animalRegister.current_stage_id);
    for (const row of counted) if (row.stage_id) perStageAnimals.set(row.stage_id, Number(row.n));
    return perStageAnimals;
  }


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
   * Applies the entry window: no future days, and workers may only change
   * today's own entries. A missed day never blocks today (decided 2026-09-14)
   * — gaps are surfaced as Missing and notified instead, not gated here.
   *
   * The supervisor exemption is read from the permission table — edit on
   * PRODUCTION/BATCH_ENTRY — and never from a role name, so a farm that renames
   * or adds roles does not have to come back to this code.
   */
  private async assertMayRecord(
    companyId: string,
    entryDate: string,
    /** Whether the line already has a *posted* entry that date — a draft is still entry, not a change. */
    postedExists: boolean,
    userPayload?: UserContext,
  ): Promise<void> {
    const today = await this.companyToday(companyId);
    const mayEditAnyDay = await userHasPermission(this.db, userPayload as any, {
      moduleCode: 'PRODUCTION', resource: 'BATCH_ENTRY', action: 'edit',
    });

    const verdict = entryVerdict({
      entryDate, today, exists: postedExists, mayEditAnyDay,
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

  /* ──────────────────────────────────────────────────────────────────────
   * Phase 6: Draft → Post → Correct.
   *
   * A sub-card saves as a DRAFT row with no side effect at all; posting runs
   * the per-line-type switch below for a set of drafts inside one transaction;
   * a correction supersedes a posted row — it is never edited — reverses what
   * it did, and posts a replacement linked to it. The switch itself is the one
   * proven live on 14 September, moved rather than rewritten.
   * ────────────────────────────────────────────────────────────────────── */

  /**
   * PUT draft. Values and who they are about, saved so a reload or another
   * worker's phone finds them — and nothing else: no batch transaction, no
   * ledger, no journal, no animal or alert row.
   */
  async saveDraft(batchId: string, body: SaveDailyDraftDto, tenantId: string, userPayload?: UserContext): Promise<EntryView> {
    return withTenantTransaction(this.cls, async () => {
      const batch = await this.lockBatch(batchId, tenantId);
      const { line, header } = await this.loadLine(batchId, body.line_id);
      const active = await this.activeRow(line.line_id, body.entry_date);
      await this.assertMayRecord(header.company_id, body.entry_date, statusOf(active) === 'POSTED', userPayload);
      if (active && statusOf(active) === 'POSTED') throw new ConflictException(ALREADY_POSTED);
      // The version is what stops two phones on one line overwriting each other.
      if (active && body.version !== Number(active.version ?? 1)) throw new ConflictException(STALE_ENTRY);

      const target = await this.resolveEntryTarget(batch, line.stage_id ?? header.stage_id, body.target_scope, body.animal_ids);
      const values = {
        entered_value: body.entered_value?.toString() ?? null,
        entered_text: body.entered_text || null,
        lot_no: body.lot_no || null,
        remarks: body.remarks || null,
        target_scope: target.scope,
        updated_by: userPayload?.userId || null,
      };

      let row: Partial<DailyRow>;
      if (active) {
        const version = Number(active.version ?? 1) + 1;
        const result = await this.db.update(schema.batchDailyData)
          .set({ ...values, version, updated_at: toMysqlTimestamp() })
          .where(and(
            eq(schema.batchDailyData.entry_id, active.entry_id),
            eq(schema.batchDailyData.version, Number(active.version ?? 1)),
          ));
        if (affectedRows(result) === 0) throw new ConflictException(STALE_ENTRY);
        row = { ...active, ...values, version };
      } else {
        row = {
          entry_id: randomUUID(), tenant_id: tenantId, company_id: header.company_id,
          line_id: line.line_id, batch_id: batchId, entry_date: body.entry_date,
          ...values, status: 'DRAFT', version: 1, posted: false, created_by: userPayload?.userId || null,
        };
        await this.db.insert(schema.batchDailyData).values(row as typeof schema.batchDailyData.$inferInsert);
      }

      // Only a selection is stored on a draft; the stage-wide set is taken at post (Ruling 5).
      await this.replaceTargets(row.entry_id!, target.scope === 'SELECTED_ANIMALS' ? target.animalIds : [], !!active);

      await this.auditService.log({
        tenantId,
        companyId: header.company_id,
        userId: userPayload?.userId,
        action: active ? 'UPDATE' : 'CREATE',
        entityName: 'batch_daily_data',
        entityId: row.entry_id!,
        newValues: { line_id: line.line_id, batch_id: batchId, entry_date: body.entry_date, status: 'DRAFT', version: row.version },
      });

      return this.toEntryView(row, target.scope === 'SELECTED_ANIMALS' ? target.animalIds : []);
    });
  }

  /**
   * POST post. Every named line's draft for the date posts, or none does: the
   * whole set runs inside one transaction, so a failure on the third sub-card
   * rolls back the inventory and GL the first two had already written.
   */
  async postDrafts(batchId: string, body: PostDailyDraftsDto, tenantId: string, userPayload?: UserContext): Promise<EntryView[]> {
    return withTenantTransaction(this.cls, async () => {
      const batch = await this.lockBatch(batchId, tenantId);
      const lineIds = [...new Set(body.line_ids)];
      const drafts = await this.db.select().from(schema.batchDailyData)
        .where(and(
          eq(schema.batchDailyData.batch_id, batchId),
          eq(schema.batchDailyData.entry_date, body.entry_date),
          inArray(schema.batchDailyData.line_id, lineIds),
          ne(schema.batchDailyData.status, 'SUPERSEDED'),
        ))
        .for('update');
      const byLine = new Map(drafts.map((d) => [d.line_id, d]));
      if (!lineIds.length || lineIds.some((id) => statusOf(byLine.get(id)) !== 'DRAFT')) {
        throw new BadRequestException(NOTHING_TO_POST);
      }
      const selections = await this.loadTargets(drafts.map((d) => d.entry_id));

      const posted: EntryView[] = [];
      for (const lineId of lineIds) {
        const draft = byLine.get(lineId)!;
        const { line, header } = await this.loadLine(batchId, lineId);
        await this.assertMayRecord(header.company_id, body.entry_date, false, userPayload);
        // Targeting is decided again now: a selected animal may have moved since the draft.
        const scope = (draft.target_scope ?? undefined) as TargetScope | undefined;
        const target = await this.resolveEntryTarget(
          batch, line.stage_id ?? header.stage_id, scope,
          scope === 'SELECTED_ANIMALS' ? selections.get(draft.entry_id) ?? [] : undefined,
        );
        posted.push(await this.commitEntry({
          batch, line, header, target, tenantId, userPayload,
          values: {
            entry_date: body.entry_date,
            entered_value: draft.entered_value == null ? undefined : Number(draft.entered_value),
            entered_text: draft.entered_text ?? undefined,
            lot_no: draft.lot_no ?? undefined,
            remarks: draft.remarks ?? undefined,
          },
          draft,
        }));
      }
      return posted;
    });
  }

  /**
   * POST correct. The posted row is superseded, not edited; what it did is
   * reversed; the replacement posts and names the row it replaced. Offered
   * only where a reversal exists today (Ruling 3) and inside the entry window.
   */
  async correctEntry(batchId: string, body: CorrectDailyEntryDto, tenantId: string, userPayload?: UserContext): Promise<EntryView> {
    return withTenantTransaction(this.cls, async () => {
      const batch = await this.lockBatch(batchId, tenantId);
      const { line, header } = await this.loadLine(batchId, body.line_id);
      const active = await this.activeRow(line.line_id, body.entry_date);
      if (statusOf(active) !== 'POSTED') throw new ConflictException('Only a posted entry can be corrected.');
      await this.assertMayRecord(header.company_id, body.entry_date, true, userPayload);
      if (body.version !== Number(active!.version ?? 1)) throw new ConflictException(STALE_ENTRY);
      return this.supersede(batch, line, header, active!, body, tenantId, userPayload);
    });
  }

  /**
   * POST /batch/:batchId/daily-data — the original save-is-post route, kept:
   * a draft saved and posted in one transaction. The same values again return
   * the day unchanged; different values on a posted line go through the same
   * correction as POST correct.
   */
  async postEntry(batchId: string, dto: CreateBatchDailyDataDto, tenantId: string, userPayload?: UserContext) {
    return withTenantTransaction(this.cls, async () => {
      // Serialize entries/corrections on the batch before taking any snapshot.
      // The scope filter means this lock also doubles as the out-of-farm guard —
      // nothing after here checks the batch's farm again.
      const batch = await this.lockBatch(batchId, tenantId);
      const { line, header } = await this.loadLine(batchId, dto.line_id);
      if (line.lot_required && !dto.lot_no) {
        throw new BadRequestException(`'${line.activity_name}' requires a lot number.`);
      }

      const previous = await this.activeRow(line.line_id, dto.entry_date);
      await this.assertMayRecord(header.company_id, dto.entry_date, statusOf(previous) === 'POSTED', userPayload);

      if (previous && statusOf(previous) === 'POSTED') {
        const sameValue = (previous.entered_value == null ? null : Number(previous.entered_value)) === (dto.entered_value ?? null);
        const sameText = (previous.entered_text || null) === (dto.entered_text || null);
        const sameLot = (previous.lot_no || null) === (dto.lot_no || null);
        if (sameValue && sameText && sameLot && dto.rate == null && !dto.destination_batch_id) {
          return this.findForDate(batchId, dto.entry_date, tenantId);
        }
        await this.supersede(batch, line, header, previous, dto, tenantId, userPayload);
        return this.findForDate(batchId, dto.entry_date, tenantId);
      }

      const target = await this.resolveEntryTarget(batch, line.stage_id ?? header.stage_id);
      await this.commitEntry({
        batch, line, header, target, tenantId, userPayload,
        values: dto,
        draft: previous && statusOf(previous) === 'DRAFT' ? previous : null,
      });
      return this.findForDate(batchId, dto.entry_date, tenantId);
    });
  }

  /** Marks `previous` superseded, reverses it, and posts the replacement. Runs inside the caller's transaction. */
  private async supersede(
    batch: BatchRow, line: LineRow, header: HeaderRow, previous: DailyRow,
    body: CreateBatchDailyDataDto & { target_scope?: TargetScope; animal_ids?: string[] },
    tenantId: string, userPayload?: UserContext,
  ): Promise<EntryView> {
    if (!isCorrectableLineType(line)) {
      throw new ConflictException(`Correction of ${line.line_type} entries is not available yet.`);
    }
    const target = await this.resolveEntryTarget(batch, line.stage_id ?? header.stage_id, body.target_scope, body.animal_ids);

    const previousVersion = Number(previous.version ?? 1);
    const result = await this.db.update(schema.batchDailyData)
      .set({
        status: 'SUPERSEDED',
        superseded_at: toMysqlTimestamp(),
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(and(
        eq(schema.batchDailyData.entry_id, previous.entry_id),
        eq(schema.batchDailyData.version, previousVersion),
      ));
    if (affectedRows(result) === 0) throw new ConflictException(STALE_ENTRY);

    if (line.line_type === 'CONSUMPTION') {
      if (!previous.posting_reference) {
        throw new ConflictException('This posted entry requires a document-specific reversal before it can be changed.');
      }
      await this.batchService.reverseConsumption(batch.batch_id, previous.posting_reference, tenantId, userPayload);
    }

    if (line.line_type === 'RESOURCE' && previous.posting_reference && this.resourceLedgerService) {
      const usageRow = await this.resourceLedgerService.findByDocumentLine(previous.posting_reference);
      if (usageRow) {
        await this.resourceLedgerService.reverseEntry(usageRow.ledger_id, tenantId, userPayload?.userId);
      }
    }

    const { line_id: _lineId, target_scope: _scope, animal_ids: _animals, ...values } = body as any;
    return this.commitEntry({
      batch, line, header, target, tenantId, userPayload,
      values: values as EntryValues,
      draft: null,
      supersedes: previous,
    });
  }

  /**
   * Runs the posting for one entry and writes its row as POSTED: the draft
   * promoted in place, or a new row (after a supersession, linked to the row it
   * replaces). A Registered entry's target set is written here and is not
   * touched again — the snapshot is immutable after post.
   */
  private async commitEntry(args: {
    batch: BatchRow; line: LineRow; header: HeaderRow;
    values: EntryValues; target: ResolvedTarget;
    draft: DailyRow | null; supersedes?: DailyRow;
    tenantId: string; userPayload?: UserContext;
  }): Promise<EntryView> {
    const { batch, line, header, values, target, draft, supersedes, tenantId, userPayload } = args;
    const outcome = await this.applyPosting(batch.batch_id, line, header, values, tenantId, userPayload, 0);

    const snapshot = target.scope === 'STAGE_ANIMALS' ? target.stageAnimalIds
      : target.scope === 'SELECTED_ANIMALS' ? target.animalIds : [];
    const written = {
      entered_value: values.entered_value?.toString() ?? null,
      entered_text: values.entered_text || null,
      lot_no: values.lot_no || null,
      remarks: values.remarks || null,
      status: 'POSTED',
      target_scope: target.scope,
      posted: outcome.posted,
      posting_reference: outcome.postingReference,
      alert_triggered: outcome.alertTriggered,
      alert_note: outcome.alertNote,
      updated_by: userPayload?.userId || null,
    };

    let row: Partial<DailyRow>;
    if (draft) {
      const version = Number(draft.version ?? 1) + 1;
      const result = await this.db.update(schema.batchDailyData)
        .set({ ...written, version, updated_at: toMysqlTimestamp() })
        .where(and(
          eq(schema.batchDailyData.entry_id, draft.entry_id),
          eq(schema.batchDailyData.version, Number(draft.version ?? 1)),
        ));
      if (affectedRows(result) === 0) throw new ConflictException(STALE_ENTRY);
      row = { ...draft, ...written, version };
    } else {
      row = {
        entry_id: randomUUID(),
        tenant_id: tenantId,
        company_id: header.company_id,
        line_id: line.line_id,
        batch_id: batch.batch_id,
        entry_date: values.entry_date,
        ...written,
        version: supersedes ? Number(supersedes.version ?? 1) + 1 : 1,
        supersedes_entry_id: supersedes?.entry_id ?? null,
        created_by: userPayload?.userId || null,
      };
      await this.db.insert(schema.batchDailyData).values(row as typeof schema.batchDailyData.$inferInsert);
    }
    await this.replaceTargets(row.entry_id!, snapshot, !!draft && !!draft.target_scope && draft.target_scope !== 'BATCH');

    await this.auditService.log({
      tenantId,
      companyId: header.company_id,
      userId: userPayload?.userId,
      action: supersedes ? 'UPDATE' : 'CREATE',
      entityName: 'batch_daily_data',
      entityId: row.entry_id!,
      oldValues: supersedes ? { entry_id: supersedes.entry_id, entered_value: supersedes.entered_value, status: 'SUPERSEDED' } : undefined,
      newValues: {
        line_id: line.line_id, batch_id: batch.batch_id, entry_date: values.entry_date,
        status: 'POSTED', target_scope: target.scope, supersedes_entry_id: supersedes?.entry_id ?? null,
      },
    } as any);

    return this.toEntryView(row, snapshot);
  }

  /**
   * Turns one scheduler_line answer into whatever the "LINE TYPE REFERENCE"
   * sheet says that line_type does on posting. Extracted unchanged from the
   * pre-Phase-6 postEntry; it writes no batch_daily_data row itself.
   *
   * `previousPostedValue` is what the line had posted before on that date, for
   * MORTALITY_COUNT's delta. A correction of a count line is refused until
   * Phase 13, so today every caller passes 0.
   */
  private async applyPosting(
    batchId: string, line: LineRow, header: HeaderRow, values: EntryValues,
    tenantId: string, userPayload: UserContext | undefined, previousPostedValue: number,
  ): Promise<{ posted: boolean; postingReference: string | null; alertTriggered: boolean; alertNote: string | null }> {
    if (line.lot_required && !values.lot_no) {
      throw new BadRequestException(`'${line.activity_name}' requires a lot number.`);
    }
    let posted = false;
    let postingReference: string | null = null;
    let alertTriggered = false;
    let alertNote: string | null = null;

    switch (line.line_type) {
      case 'CONSUMPTION':
      case 'OUTPUT': {
        if (!line.item_id) throw new ConflictException(`'${line.activity_name}' has no item configured — fix the line before posting entries against it.`);
        if (values.entered_value == null) throw new BadRequestException('entered_value is required for this line.');
        const [item] = await this.db.select().from(schema.itemMaster).where(eq(schema.itemMaster.item_id, line.item_id)).limit(1);
        const updated = await this.batchService.addTransaction(batchId, {
          transaction_date: values.entry_date,
          transaction_type: line.line_type,
          item_id: line.item_id,
          lot_no: values.lot_no,
          quantity: values.entered_value,
          uom: item?.uom_primary || 'PCS',
          rate: values.rate,
          remarks: values.remarks || `${line.activity_name} — scheduled entry`,
        } as any, tenantId, userPayload);
        posted = true;
        postingReference = updated.posting_transaction_id;
        break;
      }
      case 'DESCRIPTIVE': {
        if (values.entered_value == null && !values.entered_text) {
          throw new BadRequestException('entered_value or entered_text is required for this line.');
        }
        if (values.entered_value != null) {
          const minVal = line.lower_alert_limit != null ? Number(line.lower_alert_limit) : -Infinity;
          const maxVal = line.upper_alert_limit != null ? Number(line.upper_alert_limit) : Infinity;
          if (values.entered_value < minVal || values.entered_value > maxVal) {
            alertTriggered = true;
            alertNote = `${line.activity_name}: ${values.entered_value} outside [${line.lower_alert_limit ?? '-∞'}, ${line.upper_alert_limit ?? '∞'}]`;
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
              actual_value: values.entered_value.toString(),
              kpi_min: line.lower_alert_limit,
              kpi_max: line.upper_alert_limit,
            });
          }
        }
        // "Animal count... updated daily from batch_daily_data" (Schedule_master_template.xlsx).
        // HEAD_COUNT is an absolute daily count; MORTALITY_COUNT is a delta against
        // whatever was already recorded for this line+date, so a farmer correcting
        // today's mortality entry doesn't double-decrement animal_count.
        if (values.entered_value != null && (line.kpi_metric === 'HEAD_COUNT' || line.kpi_metric === 'MORTALITY_COUNT')) {
          let newCount: number;
          if (line.kpi_metric === 'HEAD_COUNT') {
            newCount = values.entered_value;
          } else {
            // Measured against what was posted before, which the caller hands in:
            // the active row is by now this entry's own draft, so reading it back
            // would make every delta zero.
            const delta = values.entered_value - previousPostedValue;
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
                    disposal_date: values.entry_date,
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
        if (values.entered_value == null) throw new BadRequestException('entered_value is required for this line.');
        let quantity = values.entered_value;
        let rate = values.rate ?? null;
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
          transaction_date: values.entry_date,
          transaction_type: 'OVERHEAD',
          resource_id: line.resource_id || undefined,
          quantity,
          rate,
          remarks: values.remarks || `${line.activity_name} — scheduled entry`,
        } as any, tenantId, userPayload);
        posted = true;
        postingReference = updated.posting_transaction_id;

        if (line.line_type === 'RESOURCE' && line.resource_id && updated.posting_transaction_id && this.resourceLedgerService) {
          const [batchRow] = await this.db
            .select({ farm_id: schema.batchHeader.farm_id, batch_no: schema.batchHeader.batch_no, nob_id: schema.batchHeader.nob_id, lob_id: schema.batchHeader.lob_id })
            .from(schema.batchHeader)
            .where(eq(schema.batchHeader.batch_id, batchId))
            .limit(1);
          await this.resourceLedgerService.writeUsageEntry({
            tenantId,
            companyId: header.company_id,
            farmId: batchRow?.farm_id ?? null,
            resourceId: line.resource_id,
            documentType: 'DAILY_ENTRY',
            documentNo: batchRow?.batch_no || batchId,
            documentLineId: updated.posting_transaction_id,
            postingDate: values.entry_date,
            transactionType: 'RESOURCE_USAGE',
            batchId,
            batchNo: batchRow?.batch_no || null,
            stageId: line.stage_id ?? header.stage_id,
            lineId: line.line_id,
            quantity,
            uom: line.kpi_uom || undefined,
            rate,
            remarks: values.remarks || `${line.activity_name} — scheduled entry`,
            nobId: batchRow?.nob_id,
            lobId: batchRow?.lob_id,
            userId: userPayload?.userId,
          });
        }
        break;
      }
      case 'TRANSFER': {
        if (!values.destination_batch_id) throw new BadRequestException("TRANSFER lines require destination_batch_id.");
        if (values.entered_value == null && line.standard_qty == null) {
          throw new BadRequestException('entered_value (or the line\'s standard_qty) is required to know how many head to move.');
        }
        // destination_batch_id comes from the request body, so this is the same
        // movement as POST /batch-transfer and obeys the same rule: a farm
        // worker's movement is gated behind a PENDING approval (raised inside
        // create(), which re-checks); top-level users post directly. The mode
        // read here only skips the candidate read when it would be refused.
        const transferMode = transferActorApprovalMode(userPayload, farmScope(this.cls));
        const headcount = Math.round(values.entered_value ?? Number(line.standard_qty));
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
            to_batch_id: values.destination_batch_id,
            transfer_date: values.entry_date,
            transfer_type: 'PARTIAL',
            animal_ids: candidates.map((c) => c.animal_id),
            reason: line.activity_name,
            remarks: values.remarks,
          } as any,
          tenantId,
          batchId,
          userPayload,
          // A service option, not a DTO field: the HTTP body cannot set it.
          { autoTriggersStage: line.auto_triggers_stage },
        );
        posted = true;
        postingReference = (transferResult as any)?.transfer_id || values.destination_batch_id;
        break;
      }
      default:
        throw new BadRequestException(`Unknown line_type '${line.line_type}'.`);
    }

    return { posted, postingReference, alertTriggered, alertNote };
  }

  /** The batch, locked for the rest of the transaction, through the farm scope — out of scope reads as not found. */
  private async lockBatch(batchId: string, tenantId: string): Promise<BatchRow> {
    const [batch] = await this.db.select().from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
      .for('update');
    if (!batch) throw new NotFoundException('Batch not found.');
    return batch;
  }

  /** An active line of one of this batch's schedulers; the stage is the line's, never the client's. */
  private async loadLine(batchId: string, lineId: string): Promise<{ line: LineRow; header: HeaderRow }> {
    const [line] = await this.db.select().from(schema.schedulerLine).where(eq(schema.schedulerLine.line_id, lineId)).limit(1);
    if (!line) throw new NotFoundException(`Scheduler line '${lineId}' not found.`);
    if (!line.is_active) throw new ConflictException('This line has been deactivated and no longer accepts entries.');
    const [header] = await this.db.select().from(schema.schedulerHeader).where(eq(schema.schedulerHeader.scheduler_id, line.scheduler_id)).limit(1);
    if (!header || header.batch_id !== batchId) {
      throw new BadRequestException(`Line '${lineId}' does not belong to batch '${batchId}'.`);
    }
    return { line, header };
  }

  /** The one non-superseded row for a line and date, locked. */
  private async activeRow(lineId: string, entryDate: string): Promise<DailyRow | null> {
    const [row] = await this.db.select().from(schema.batchDailyData)
      .where(and(
        eq(schema.batchDailyData.line_id, lineId),
        eq(schema.batchDailyData.entry_date, entryDate),
        ne(schema.batchDailyData.status, 'SUPERSEDED'),
      ))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  /** Active animals standing in a stage of this batch, with the codes a worker recognises. */
  private async stageAnimals(batchId: string, stageId: string | null) {
    if (!stageId) return [];
    const animals = await this.db
      .select({
        animal_id: schema.animalRegister.animal_id,
        animal_code: schema.animalRegister.animal_code,
        ear_tag: schema.animalRegister.ear_tag,
      })
      .from(schema.animalRegister)
      .where(and(
        eq(schema.animalRegister.current_batch_id, batchId),
        eq(schema.animalRegister.current_stage_id, stageId),
        eq(schema.animalRegister.is_active, true),
      ))
      .orderBy(schema.animalRegister.animal_code);
    return animals.map((a) => ({ animal_id: a.animal_id, animal_code: a.animal_code, ear_tag: a.ear_tag ?? null }));
  }

  /**
   * resolveTarget with the stage's animals as of now. The rule's message names
   * an animal by id; when the animal belongs to this batch it is renamed by its
   * code, which is what the worker can find in the pen.
   */
  private async resolveEntryTarget(
    batch: BatchRow, stageId: string | null, requestedScope?: TargetScope, animalIds?: string[],
  ): Promise<ResolvedTarget> {
    const mode = batch.animal_tracking === 'REGISTERED' ? 'REGISTERED' : 'COUNT_ONLY';
    const stageAnimalIds = mode === 'REGISTERED' ? (await this.stageAnimals(batch.batch_id, stageId)).map((a) => a.animal_id) : [];
    try {
      return { ...resolveTarget({ mode, requestedScope, animalIds, stageAnimalIds }), stageAnimalIds };
    } catch (error) {
      const stranger = error instanceof BadRequestException ? /^Animal (\S+) is not/.exec(error.message)?.[1] : undefined;
      if (stranger) {
        const [animal] = await this.db.select({ code: schema.animalRegister.animal_code })
          .from(schema.animalRegister)
          .where(and(eq(schema.animalRegister.animal_id, stranger), eq(schema.animalRegister.current_batch_id, batch.batch_id)))
          .limit(1);
        if (animal?.code) throw new BadRequestException(`Animal ${animal.code} is not an active animal in this stage.`);
      }
      throw error;
    }
  }

  /** batch_daily_data_target rows for a set of entries, keyed by entry. */
  private async loadTargets(entryIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (!entryIds.length) return map;
    const rows = await this.db
      .select({ entry_id: schema.batchDailyDataTarget.entry_id, animal_id: schema.batchDailyDataTarget.animal_id })
      .from(schema.batchDailyDataTarget)
      .where(inArray(schema.batchDailyDataTarget.entry_id, entryIds));
    for (const r of rows) {
      const list = map.get(r.entry_id);
      if (list) list.push(r.animal_id);
      else map.set(r.entry_id, [r.animal_id]);
    }
    return map;
  }

  /** Replaces an entry's target rows. `hadRows` skips the delete for an entry that cannot have any. */
  private async replaceTargets(entryId: string, animalIds: string[], hadRows: boolean): Promise<void> {
    if (hadRows) {
      await this.db.delete(schema.batchDailyDataTarget).where(eq(schema.batchDailyDataTarget.entry_id, entryId));
    }
    if (!animalIds.length) return;
    await this.db.insert(schema.batchDailyDataTarget).values(
      animalIds.map((animal_id) => ({ target_id: randomUUID(), entry_id: entryId, animal_id })),
    );
  }

  private toEntryView(row: Partial<DailyRow>, animalIds: string[]): EntryView {
    return {
      entry_id: row.entry_id!,
      status: statusOf(row) === 'DRAFT' ? 'DRAFT' : 'POSTED',
      version: Number(row.version ?? 1),
      entered_value: row.entered_value == null ? null : Number(row.entered_value),
      entered_text: row.entered_text ?? null,
      lot_no: row.lot_no ?? null,
      remarks: row.remarks ?? null,
      // A row from before Phase 6 was posted against the whole batch.
      target_scope: (row.target_scope ?? 'BATCH') as TargetScope,
      animal_ids: [...animalIds].sort(),
      supersedes_entry_id: row.supersedes_entry_id ?? null,
      posted: !!row.posted,
      alert_triggered: !!row.alert_triggered,
      alert_note: row.alert_note ?? null,
    };
  }

  /**
   * GET history. One row per day from `to` back `days` days (at most sixty,
   * never before the batch started), newest first, each with the state
   * dayState() gives it from the required lines due that day across all the
   * batch's schedulers and the posted and draft rows against them.
   */
  async history(batchId: string, to: string | undefined, days: number | undefined, tenantId: string): Promise<Array<{
    date: string; state: DayState; required: number; posted: number; drafts: number;
  }>> {
    const [batch] = await this.db.select().from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!batch) throw new NotFoundException('Batch not found.');

    const today = await this.companyToday(batch.company_id);
    // A day that has not happened owes nothing yet.
    const end = to && to < today ? to : today;
    const span = Math.min(60, Math.max(1, Math.floor(Number(days) || 30)));
    const batchStart = String(batch.start_date).slice(0, 10);
    const reach = addDays(end, -(span - 1));
    const start = reach > batchStart ? reach : batchStart;
    if (start > end) return [];

    const headers = await this.db.select().from(schema.schedulerHeader)
      .where(and(eq(schema.schedulerHeader.batch_id, batchId), eq(schema.schedulerHeader.tenant_id, tenantId)));
    if (!headers.length) return [];

    // Active lines, as the form shows them, so the rail and the day it opens agree.
    const lines = await this.db.select().from(schema.schedulerLine)
      .where(and(inArray(schema.schedulerLine.scheduler_id, headers.map((h) => h.scheduler_id)), eq(schema.schedulerLine.is_active, true)));
    const customDaysByLine = await this.loadCustomDays(lines.map((l) => l.line_id));

    const rows = await this.db.select({
      line_id: schema.batchDailyData.line_id,
      entry_date: schema.batchDailyData.entry_date,
      status: schema.batchDailyData.status,
    }).from(schema.batchDailyData).where(and(
      eq(schema.batchDailyData.batch_id, batchId),
      ne(schema.batchDailyData.status, 'SUPERSEDED'),
      gte(schema.batchDailyData.entry_date, start),
      lte(schema.batchDailyData.entry_date, end),
    ));
    const statusByDate = new Map<string, Map<string, string>>();
    for (const r of rows) {
      const key = String(r.entry_date).slice(0, 10);
      (statusByDate.get(key) ?? statusByDate.set(key, new Map()).get(key)!).set(r.line_id as string, r.status ?? 'POSTED');
    }

    return datesBetween(start, end).reverse().map((date) => {
      const saved = statusByDate.get(date) ?? new Map<string, string>();
      let required = 0;
      let posted = 0;
      let drafts = 0;
      for (const header of headers) {
        const from = String(header.effective_from).slice(0, 10);
        for (const l of lines) {
          if (l.scheduler_id !== header.scheduler_id) continue;
          if (!isLineDue(this.toDueLine(l, customDaysByLine), from, date)) continue;
          const status = saved.get(l.line_id);
          if (status === 'DRAFT') drafts += 1;
          if (!l.is_mandatory) continue;
          required += 1;
          if (status === 'POSTED') posted += 1;
        }
      }
      return { date, state: dayState({ date, today, required, posted, drafts }), required, posted, drafts };
    });
  }

  /** Same unscoped-read fix as entryDates: the day's entries follow their batch's farm. */
  async findForDate(batchId: string, entryDate: string, tenantId: string) {
    const scope = farmScope(this.cls);
    return this.db
      .select()
      .from(schema.batchDailyData)
      .where(and(
        eq(schema.batchDailyData.batch_id, batchId),
        eq(schema.batchDailyData.entry_date, entryDate),
        eq(schema.batchDailyData.tenant_id, tenantId),
        // The active row per line: a draft or a posting, never what it replaced.
        ne(schema.batchDailyData.status, 'SUPERSEDED'),
        ...batchReferenceScopeConditions(scope, schema.batchDailyData.batch_id),
        ...restrictedScopeConditions(scope, { companyId: schema.batchDailyData.company_id }),
      ));
  }
}
