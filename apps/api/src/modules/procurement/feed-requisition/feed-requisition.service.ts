/**
 * Feed requisitions (Feed Forecast Plan B; Requisition and Loading Sheet §1–§2
 * and §4 steps 1–5). Stored on the existing requisition tables as doc_type
 * FEED. Every number on a drafted line comes from feed-requisition.rules.ts;
 * this service loads, locks and writes. Farm scope is resolved exactly as the
 * forecast resolves it (FeedForecastService.resolveFarm, D13), and every
 * read runs under that farm (withFarmScope) — a by-id read resolves the row's
 * own farm first (Ruling H3), so an id is never a way round the farm check.
 *
 * Ruling C2: this is its own module and controller. The generic
 * RequisitionModule stays unregistered (its /requisition controller would
 * mount with it), so nothing here imports it.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, like, notInArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { farmScope } from '../../../common/farm-scope';
import { userHasPermission } from '../../../common/permissions';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { isDuplicateEntry } from '../../../common/filters/http-exception.filter';
import { FeedForecastService, MAX_SPAN_DAYS } from '../../inventory/feed-forecast/feed-forecast.service';
import { utcTimestamp } from '../../inventory/feed-forecast/feed-forecast.engine';
import { FeedAlertService } from '../../inventory/feed-alert/feed-alert.service';
import { ApprovalService } from '../../production/approval/approval.service';
import {
  DestinationInfo, DraftLine, FarmFeedSettings, FeedType, approvalProblems, bagCountFor, diffDaysIso, feedTypeOf, lineKey, planDraftUpsert,
  productionCycle, recommendLines, requisitionPriority, runKeyFor, serverToday, wasEdited,
} from './feed-requisition.rules';
import {
  AutoDraftFeedRequisitionDto, CreateManualFeedRequisitionDto, DecideFeedRequisitionDto, FeedLineEditInput, QueryFeedRequisitionDto,
  UpdateFeedRequisitionDto,
} from './dto/feed-requisition.dto';

/** The caller as the JWT carries it. userType is required by resolveFarm, which fails closed without it. */
export type UserCtx = { userId?: string; userType?: string; email?: string };

export const FEED_DOC_TYPE = 'FEED';
/** Statuses a feed requisition can still be edited, approved or rejected in (Requisition §1 row 33, up to APPROVED). */
export const OPEN_FEED_STATUSES = ['AUTO_DRAFT', 'DRAFT', 'PENDING_APPROVAL'];
/** Statuses that take a requisition out of its cycle: its lines no longer cover a silo and item (row 9). */
const DEAD_FEED_STATUSES = ['REJECTED', 'CANCELLED'];
export const NUMBERING_CLASH = 'Another requisition was numbered at the same moment — try again.';

/** MySQL 1213: InnoDB rolled the transaction back to break a deadlock. Drizzle wraps the driver error in `cause`. */
function isDeadlock(error: unknown): boolean {
  for (let e: any = error, depth = 0; e && typeof e === 'object' && depth < 5; e = e.cause, depth++) {
    if (e.code === 'ER_LOCK_DEADLOCK' || e.errno === 1213) return true;
  }
  return false;
}

const dec = (n: number | null | undefined) => (n == null ? null : String(n));
/** approved_at / deleted_at in the one Plan B timestamp convention: UTC, as utcTimestamp documents in the engine. */
const nowTs = () => utcTimestamp();
/** A farm code is data, not a pattern: `_` or `%` in it must not widen the req_no LIKE. */
const likePrefix = (prefix: string) => `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

interface FarmRow { code: string; settings: FarmFeedSettings }
type Destination = DestinationInfo & { code: string; farmId: string | null; isActive: boolean; rawType: string };

@Injectable()
export class FeedRequisitionService {
  constructor(
    private readonly cls: ClsService,
    private readonly forecast: FeedForecastService,
    // Approve/reject record their decision through its document-scoped path (Ruling C1).
    private readonly approvals: ApprovalService,
    private readonly feedAlerts: FeedAlertService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /** The same farm/LOB bound requisition.service.ts applies. */
  private scopeConditions(): SQL[] {
    const scope = farmScope(this.cls);
    const conditions: SQL[] = [];
    if (scope.farmId) conditions.push(eq(schema.requisition.farm_id, scope.farmId));
    if (scope.restricted && scope.lobId) {
      conditions.push(sql`${schema.requisition.company_id} IN (SELECT company_id FROM company_master WHERE lob_id IS NULL OR lob_id = ${scope.lobId})`);
    }
    return conditions;
  }

  private async loadFarm(farmId: string, tenantId: string): Promise<FarmRow> {
    const [row] = await this.db
      .select({
        location_code: schema.locationMaster.location_code,
        feed_bulk_multiple_kg: schema.locationMaster.feed_bulk_multiple_kg,
        feed_bag_size_kg: schema.locationMaster.feed_bag_size_kg,
        feed_truck_target_kg: schema.locationMaster.feed_truck_target_kg,
        feed_production_weekday: schema.locationMaster.feed_production_weekday,
      })
      .from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.location_id, farmId), eq(schema.locationMaster.tenant_id, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Farm not found.');
    return {
      code: row.location_code,
      settings: {
        bulkMultipleKg: row.feed_bulk_multiple_kg ?? 3000,
        bagSizeKg: row.feed_bag_size_kg ?? 50,
        truckTargetKg: row.feed_truck_target_kg ?? 30000,
        productionWeekday: row.feed_production_weekday ?? 0,
      },
    };
  }

  /**
   * Ruling M10: the farm's own location_master row, locked for the rest of the
   * transaction. Two auto-drafts (or a draft and a manual entry) of one farm
   * queue here — before the open-draft lookup, which on a first run finds no
   * requisition row to lock — and the req_no they allocate is read under it.
   */
  private async lockFarm(farmId: string, tenantId: string): Promise<void> {
    const [row] = await this.db
      .select({ location_id: schema.locationMaster.location_id })
      .from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.location_id, farmId), eq(schema.locationMaster.tenant_id, tenantId)))
      .limit(1)
      .for('update');
    if (!row) throw new NotFoundException('Farm not found.');
  }

  private async loadDestinations(ids: string[], tenantId: string): Promise<Map<string, Destination>> {
    const map = new Map<string, Destination>();
    if (!ids.length) return map;
    const rows = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_code: schema.locationMaster.location_code,
        location_type: schema.locationMaster.location_type,
        farm_id: schema.locationMaster.farm_id,
        is_active: schema.locationMaster.is_active,
        feed_in_bags: schema.locationMaster.feed_in_bags,
        low_level_kg: schema.locationMaster.low_level_kg,
      })
      .from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.tenant_id, tenantId), inArray(schema.locationMaster.location_id, [...new Set(ids)])));
    for (const r of rows) {
      map.set(r.location_id, {
        locationId: r.location_id,
        locationType: r.location_type === 'STORE' ? 'STORE' : 'SILO',
        rawType: r.location_type,
        feedInBags: r.feed_in_bags,
        lowLevelKg: r.low_level_kg == null ? null : Number(r.low_level_kg),
        code: r.location_code,
        farmId: r.farm_id,
        isActive: r.is_active,
      });
    }
    return map;
  }

  /**
   * Requisition §1 row 5: REQ-FarmCode-YYYY-NNNNN (Q11). Called only inside the
   * transaction that holds the farm row (lockFarm), so two requisitions of one
   * farm cannot read the same last number; the read itself is a locking one
   * too, so it sees the latest committed number rather than the transaction's
   * snapshot. Two farms of different companies that share a code share the
   * prefix but not the farm lock, so they can read the same last number: the
   * second insert then fails req_no's unique key (or InnoDB breaks the
   * resulting gap-lock deadlock). numbered() runs the whole transaction once
   * more — it reads the number the first committed — and answers 409 only if
   * that clashes too. A duplicate number is never written.
   *
   * `today` is the farm-zone day (D16) — both callers already hold it from
   * their own farmToday call, so a requisition made after midnight in Harare
   * but before midnight on the server numbers into the year that has already
   * turned for the farm, not the one still current on the server.
   */
  private async nextReqNo(farmCode: string, tenantId: string, today: string): Promise<string> {
    const prefix = `REQ-${farmCode}-${today.slice(0, 4)}-`;
    const [last] = await this.db
      .select({ req_no: schema.requisition.req_no })
      .from(schema.requisition)
      .where(and(eq(schema.requisition.tenant_id, tenantId), like(schema.requisition.req_no, likePrefix(prefix))))
      .orderBy(desc(schema.requisition.req_no))
      .limit(1)
      .for('update');
    const lastSeq = last ? Number(last.req_no.slice(prefix.length)) : 0;
    return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(5, '0')}`;
  }

  /**
   * Runs a transaction that allocates a req_no, once more if its number
   * clashed with another farm's of the same code (see nextReqNo). Inside an
   * outer transaction there is nothing to retry — the clash has already
   * spoiled it — so it is left to the caller.
   */
  private async numbered<T>(transaction: () => Promise<T>): Promise<T> {
    const clash = (e: unknown) => isDuplicateEntry(e) || isDeadlock(e);
    if (this.cls.get('tenantPostingTransaction') === true) return transaction();
    try {
      return await transaction();
    } catch (error) {
      if (!clash(error)) throw error;
    }
    try {
      return await transaction();
    } catch (error) {
      if (clash(error)) throw new ConflictException(NUMBERING_CLASH);
      throw error;
    }
  }

  /**
   * Every live feed requisition of this farm's cycle, locked. Read under the
   * farm lock and as a locking read, so a caller that waited sees what the
   * transaction before it committed rather than its own stale snapshot.
   */
  private async lockCycle(farmId: string, tenantId: string, submissionDeadline: string) {
    return this.db
      .select({
        requisition_id: schema.requisition.requisition_id, req_no: schema.requisition.req_no,
        status: schema.requisition.status, requisition_type: schema.requisition.requisition_type,
      })
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.farm_id, farmId),
        eq(schema.requisition.doc_type, FEED_DOC_TYPE),
        eq(schema.requisition.submission_deadline, submissionDeadline),
        notInArray(schema.requisition.status, DEAD_FEED_STATUSES),
        isNull(schema.requisition.deleted_at),
      ))
      .for('update');
  }

  /** The draft-time snapshot columns of a line (Requisition §2). */
  private lineValues(line: DraftLine) {
    return {
      item_id: line.itemId,
      description: line.itemName.slice(0, 200),
      uom: 'KG',
      destination_location_id: line.destinationLocationId,
      source_type: line.sourceType,
      feed_type: line.feedType,
      is_next_diet: line.isNextDiet,
      days_before_diet_change: line.daysBeforeDietChange,
      lifecycle_ref_id: line.lifecycleRefId,
      system_balance_kg: dec(line.systemBalanceKg),
      daily_requirement_kg: dec(line.dailyRequirementKg),
      days_remaining: line.daysRemaining,
      first_shortage_date: line.firstShortageDate,
      unrounded_need_kg: dec(line.unroundedNeedKg),
      recommended_qty_kg: dec(line.recommendedQtyKg),
      bag_count: line.bagCount,
      proposed_delivery_date: line.proposedDeliveryDate,
      needs_silo_changeover: line.needsSiloChangeover,
    };
  }

  async autoDraft(dto: AutoDraftFeedRequisitionDto, tenantId: string, user: UserCtx) {
    const { farmId, companyId } = await this.forecast.resolveFarm(dto.farmId, tenantId, user?.userType);
    // D16: the forecast plans from today in the farm's time zone, so `to` is held to the same day —
    // and the clock is handed on (M6) so the forecast plans on exactly the day `to` was checked against.
    const clock = await this.forecast.farmToday(companyId, tenantId);
    const { today } = clock;
    if (dto.to && (dto.to < today || diffDaysIso(today, dto.to) > MAX_SPAN_DAYS)) {
      throw new BadRequestException(`to must be between today and ${MAX_SPAN_DAYS} days ahead.`);
    }
    const outcome = await this.forecast.withFarmScope(farmId, companyId, async () => {
      const forecast = await this.forecast.computeForFarm(farmId, companyId, tenantId, { to: dto.to }, clock);
      const farm = await this.loadFarm(farmId, tenantId);
      const destinations = await this.loadDestinations(forecast.sources.map((s) => s.locationId), tenantId);
      // Task 3 carry: recommendLines synthesizes a destination it is not
      // handed, with no low level — a silo at its low level would then draft
      // as an ordinary line and the requisition lose CRITICAL_FIRST_PRIORITY
      // without a trace. Every source is a silo or store the forecast just
      // read, so a missing one is a broken invariant, not something to draft around.
      const orphan = forecast.sources.find((s) => !destinations.has(s.locationId));
      if (orphan) {
        throw new InternalServerErrorException(`Feed source ${orphan.sourceCode} has no location record; the draft was not written.`);
      }
      const wanted = recommendLines({ planningDate: forecast.planningDate, to: forecast.to, sources: forecast.sources, destinations, settings: farm.settings });
      const cycle = productionCycle(forecast.planningDate, farm.settings.productionWeekday);
      const runKey = runKeyFor(farm.code);

      return this.numbered(() => withTenantTransaction(this.cls, async () => {
        await this.lockFarm(farmId, tenantId);
        const cycleRows = await this.lockCycle(farmId, tenantId, cycle.submissionDeadline);
        const draft = cycleRows.find((r) => r.status === 'AUTO_DRAFT' && r.requisition_type === 'FEED_FORECAST');
        const otherIds = cycleRows.filter((r) => r !== draft).map((r) => r.requisition_id);

        const covered = new Set<string>();
        if (otherIds.length) {
          const otherLines = await this.db
            .select({ dest: schema.requisitionLine.destination_location_id, item: schema.requisitionLine.item_id })
            .from(schema.requisitionLine)
            .where(inArray(schema.requisitionLine.requisition_id, otherIds));
          for (const l of otherLines) if (l.dest && l.item) covered.add(lineKey(l.dest, l.item));
        }

        const existing = draft
          ? await this.db
              .select({
                line_id: schema.requisitionLine.line_id, line_seq: schema.requisitionLine.line_seq,
                dest: schema.requisitionLine.destination_location_id, item: schema.requisitionLine.item_id,
                quantity: schema.requisitionLine.quantity, recommended: schema.requisitionLine.recommended_qty_kg,
                edited: schema.requisitionLine.quantity_edited,
              })
              .from(schema.requisitionLine)
              .where(eq(schema.requisitionLine.requisition_id, draft.requisition_id))
          : [];
        const plan = planDraftUpsert(
          existing.filter((l) => l.dest && l.item).map((l) => ({
            lineId: l.line_id, key: lineKey(l.dest!, l.item!), quantityKg: Number(l.quantity),
            recommendedQtyKg: l.recommended == null ? null : Number(l.recommended),
            quantityEdited: !!l.edited,
          })),
          covered,
          wanted,
        );

        const drafted = [...plan.insert, ...plan.update.map((u) => u.line)];
        const header = {
          // A rerun that drafts nothing new but keeps the farm's own lines leaves
          // priority and required date as they were rather than blanking them.
          ...(drafted.length ? {
            priority: requisitionPriority(forecast.planningDate, drafted),
            required_date: drafted.map((l) => l.proposedDeliveryDate).sort()[0] ?? null,
          } : {}),
          forecast_run_key: runKey,
          production_date: cycle.productionDate,
          submission_deadline: cycle.submissionDeadline,
          updated_by: user?.userId ?? null,
        };

        if (!draft) {
          if (!plan.insert.length) return { requisitionId: null as string | null, created: false, linesDrafted: 0 };
          const requisitionId = randomUUID();
          await this.db.insert(schema.requisition).values({
            requisition_id: requisitionId,
            tenant_id: tenantId,
            company_id: companyId,
            farm_id: farmId,
            req_no: await this.nextReqNo(farm.code, tenantId, today),
            doc_type: FEED_DOC_TYPE,
            status: 'AUTO_DRAFT',
            requisition_type: 'FEED_FORECAST',
            source: 'AUTO_FORECAST',
            purpose: 'INTERNAL_TRANSFER',
            supply_source: 'MILL',
            created_by: user?.userId ?? null,
            ...header,
          });
          await this.db.insert(schema.requisitionLine).values(
            plan.insert.map((line, i) => ({
              requisition_id: requisitionId, line_seq: i + 1, quantity: String(line.recommendedQtyKg), quantity_edited: false, ...this.lineValues(line),
            })),
          );
          return { requisitionId, created: true, linesDrafted: plan.insert.length };
        }

        if (plan.remove.length) {
          await this.db.delete(schema.requisitionLine).where(inArray(schema.requisitionLine.line_id, plan.remove));
        }
        for (const u of plan.update) {
          await this.db.update(schema.requisitionLine).set({
            ...this.lineValues(u.line),
            // M9: an edited line keeps the farm's quantity (and its flag); only
            // the snapshot and the recommendation beside it are refreshed.
            ...(u.keepQuantity
              ? { bag_count: bagCountFor(u.priorQuantityKg, u.line.feedType, farm.settings) }
              : { quantity: String(u.line.recommendedQtyKg) }),
          }).where(eq(schema.requisitionLine.line_id, u.lineId));
        }
        if (plan.insert.length) {
          const maxSeq = Math.max(0, ...existing.map((l) => l.line_seq));
          await this.db.insert(schema.requisitionLine).values(
            plan.insert.map((line, i) => ({
              requisition_id: draft.requisition_id, line_seq: maxSeq + i + 1, quantity: String(line.recommendedQtyKg), quantity_edited: false, ...this.lineValues(line),
            })),
          );
        }
        if (!drafted.length && !plan.keep.length) {
          // Nothing is needed any more and the farm kept nothing: the draft goes, rather than lingering empty.
          await this.db.update(schema.requisition).set({ deleted_at: nowTs(), updated_by: user?.userId ?? null })
            .where(eq(schema.requisition.requisition_id, draft.requisition_id));
          return { requisitionId: null as string | null, created: false, linesDrafted: 0 };
        }
        await this.db.update(schema.requisition).set(header).where(eq(schema.requisition.requisition_id, draft.requisition_id));
        return { requisitionId: draft.requisition_id as string | null, created: false, linesDrafted: drafted.length };
      }));
    });

    // Checkpoint 20: the draft's deadline reminders start from here. Only now,
    // after the transaction committed — inside it the evaluator skips itself
    // (it must not read figures that may yet roll back) — and it never throws.
    await this.feedAlerts.evaluateFarmSafely(farmId, companyId, tenantId);
    const requisition = outcome.requisitionId
      ? await this.forecast.withFarmScope(farmId, companyId, () => this.readView(outcome.requisitionId!, tenantId))
      : null;
    return { ...outcome, requisition };
  }

  async createManual(dto: CreateManualFeedRequisitionDto, tenantId: string, user: UserCtx) {
    const { farmId, companyId } = await this.forecast.resolveFarm(dto.farmId, tenantId, user?.userType);
    const requisitionId = await this.forecast.withFarmScope(farmId, companyId, async () => {
      const farm = await this.loadFarm(farmId, tenantId);
      const destinations = await this.loadDestinations(dto.lines.map((l) => l.destination_location_id), tenantId);
      const seen = new Set<string>();
      for (const line of dto.lines) {
        const dest = destinations.get(line.destination_location_id);
        if (!dest || dest.farmId !== farmId || !dest.isActive || !['SILO', 'STORE'].includes(dest.rawType)) {
          throw new BadRequestException(`Destination ${dest?.code ?? line.destination_location_id} must be an active silo or store of farm ${farm.code}.`);
        }
        // Requisition §1 row 9: one line per silo per feed item.
        const key = lineKey(line.destination_location_id, line.item_id);
        if (seen.has(key)) throw new BadRequestException(`Destination ${dest.code} has the same feed item on two lines.`);
        seen.add(key);
      }
      const itemIds = [...new Set(dto.lines.map((l) => l.item_id))];
      const items = await this.db
        .select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name })
        .from(schema.itemMaster)
        .where(and(eq(schema.itemMaster.tenant_id, tenantId), inArray(schema.itemMaster.item_id, itemIds)));
      const nameOf = new Map(items.map((i) => [i.item_id, i.item_name]));
      const missing = itemIds.find((id) => !nameOf.has(id));
      if (missing) throw new BadRequestException(`Feed item ${missing} was not found.`);

      // D16: the requisition cycle is dated by the farm's day, the same one the forecast plans from.
      const { today: manualToday } = await this.forecast.farmToday(companyId, tenantId);
      const cycle = productionCycle(manualToday, farm.settings.productionWeekday);
      return this.numbered(() => withTenantTransaction(this.cls, async () => {
        await this.lockFarm(farmId, tenantId);
        await this.supersedeCoverage(dto.lines, destinations, nameOf, farmId, tenantId, cycle.submissionDeadline, user);
        const id = randomUUID();
        await this.db.insert(schema.requisition).values({
          requisition_id: id,
          tenant_id: tenantId,
          company_id: companyId,
          farm_id: farmId,
          req_no: await this.nextReqNo(farm.code, tenantId, manualToday),
          doc_type: FEED_DOC_TYPE,
          status: 'DRAFT',
          requisition_type: 'MANUAL',
          source: 'MANUAL_ENTRY',
          purpose: 'INTERNAL_TRANSFER',
          supply_source: 'MILL',
          remarks: dto.remarks?.trim() || null,
          required_date: dto.lines.map((l) => l.proposed_delivery_date).sort()[0],
          production_date: cycle.productionDate,
          submission_deadline: cycle.submissionDeadline,
          created_by: user?.userId ?? null,
          updated_by: user?.userId ?? null,
        });
        await this.db.insert(schema.requisitionLine).values(dto.lines.map((line, i) => {
          const dest = destinations.get(line.destination_location_id)!;
          const feedType: FeedType = feedTypeOf(dest);
          return {
            requisition_id: id,
            line_seq: i + 1,
            item_id: line.item_id,
            description: (nameOf.get(line.item_id) ?? '').slice(0, 200),
            quantity: String(line.quantity_kg),
            uom: 'KG',
            destination_location_id: line.destination_location_id,
            source_type: dest.locationType,
            feed_type: feedType,
            bag_count: bagCountFor(line.quantity_kg, feedType, farm.settings),
            proposed_delivery_date: line.proposed_delivery_date,
          };
        }));
        return id;
      }));
    });
    // After commit, as autoDraft: a manual requisition also counts for the deadline reminders.
    await this.feedAlerts.evaluateFarmSafely(farmId, companyId, tenantId);
    return this.forecast.withFarmScope(farmId, companyId, () => this.readView(requisitionId, tenantId));
  }

  /**
   * Requisition §1 row 9 across requisitions: one line per silo per feed item
   * in a cycle. Called under the farm lock, before the manual requisition is
   * written. A (destination, item) already on a requisition the farm or an
   * approver has acted on — another manual one, one pending or approved, or
   * an auto-draft line whose quantity the farm made its own — is refused
   * with 409. One covered only by an untouched AUTO_DRAFT line is the
   * system's suggestion, which the manual line supersedes: that line is
   * removed, and a draft left with no lines goes with it, as a rerun that
   * drafts nothing removes it.
   */
  private async supersedeCoverage(
    lines: CreateManualFeedRequisitionDto['lines'], destinations: Map<string, Destination>, nameOf: Map<string, string>,
    farmId: string, tenantId: string, submissionDeadline: string, user: UserCtx,
  ): Promise<void> {
    const cycleRows = await this.lockCycle(farmId, tenantId, submissionDeadline);
    if (!cycleRows.length) return;
    const byId = new Map(cycleRows.map((r) => [r.requisition_id, r]));
    const existing = await this.db
      .select({
        line_id: schema.requisitionLine.line_id, requisition_id: schema.requisitionLine.requisition_id,
        dest: schema.requisitionLine.destination_location_id, item: schema.requisitionLine.item_id,
        quantity: schema.requisitionLine.quantity, recommended: schema.requisitionLine.recommended_qty_kg,
        edited: schema.requisitionLine.quantity_edited,
      })
      .from(schema.requisitionLine)
      .where(inArray(schema.requisitionLine.requisition_id, [...byId.keys()]));
    const wanted = new Set(lines.map((l) => lineKey(l.destination_location_id, l.item_id)));
    const superseded: typeof existing = [];
    for (const line of existing) {
      if (!line.dest || !line.item || !wanted.has(lineKey(line.dest, line.item))) continue;
      const req = byId.get(line.requisition_id)!;
      const untouchedSuggestion = req.status === 'AUTO_DRAFT' && req.requisition_type === 'FEED_FORECAST'
        && !wasEdited({ quantityKg: Number(line.quantity), recommendedQtyKg: line.recommended == null ? null : Number(line.recommended), quantityEdited: !!line.edited });
      if (!untouchedSuggestion) {
        throw new ConflictException(
          `${destinations.get(line.dest)?.code ?? line.dest} already has ${nameOf.get(line.item) ?? line.item} on requisition ${req.req_no} (${req.status}) this cycle — change that line instead.`,
        );
      }
      superseded.push(line);
    }
    if (!superseded.length) return;
    await this.db.delete(schema.requisitionLine).where(inArray(schema.requisitionLine.line_id, superseded.map((l) => l.line_id)));
    for (const draftId of new Set(superseded.map((l) => l.requisition_id))) {
      const left = existing.filter((l) => l.requisition_id === draftId && !superseded.includes(l));
      if (!left.length) {
        await this.db.update(schema.requisition).set({ deleted_at: nowTs(), updated_by: user?.userId ?? null })
          .where(eq(schema.requisition.requisition_id, draftId));
      }
    }
  }

  async findAll(query: QueryFeedRequisitionDto, tenantId: string, user: UserCtx) {
    const { farmId, companyId } = await this.forecast.resolveFarm(query.farmId, tenantId, user?.userType);
    return this.forecast.withFarmScope(farmId, companyId, () => {
      const conditions = [
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.farm_id, farmId),
        eq(schema.requisition.company_id, companyId),
        eq(schema.requisition.doc_type, FEED_DOC_TYPE),
        isNull(schema.requisition.deleted_at),
        ...this.scopeConditions(),
      ];
      if (query.status) conditions.push(eq(schema.requisition.status, query.status));
      return this.db
        .select({
          requisition_id: schema.requisition.requisition_id,
          req_no: schema.requisition.req_no,
          requisition_type: schema.requisition.requisition_type,
          status: schema.requisition.status,
          priority: schema.requisition.priority,
          required_date: schema.requisition.required_date,
          submission_deadline: schema.requisition.submission_deadline,
          created_at: schema.requisition.created_at,
          line_count: sql<number>`(SELECT COUNT(*) FROM requisition_line rl WHERE rl.requisition_id = ${schema.requisition.requisition_id})`,
          requested_kg: sql<string>`(SELECT COALESCE(SUM(rl.quantity), 0) FROM requisition_line rl WHERE rl.requisition_id = ${schema.requisition.requisition_id})`,
        })
        .from(schema.requisition)
        .where(and(...conditions))
        .orderBy(desc(schema.requisition.created_at))
        .limit(200);
    });
  }

  /**
   * Ruling H3: the row is loaded first, then its own farm is resolved for this
   * caller exactly as a query farmId would be (company-bound, LOB-bound for a
   * restricted user, the pinned farm for a STANDARD_USER), and the read runs
   * under that farm. A requisition of a farm or company the caller may not see
   * is not found — the same answer as an id that does not exist — and an
   * admin who switched farms on the page opens the chosen farm's requisition
   * without re-pinning the header.
   */
  async findOne(requisitionId: string, tenantId: string, user: UserCtx) {
    const { farmId, companyId } = await this.resolveOwnFarm(requisitionId, tenantId, user);
    return this.forecast.withFarmScope(farmId, companyId, () => this.readView(requisitionId, tenantId));
  }

  /** For every by-id path (findOne, update, approve, reject): the row's farm and company, once the caller is proven to see them. */
  protected async resolveOwnFarm(requisitionId: string, tenantId: string, user: UserCtx): Promise<{ farmId: string; companyId: string }> {
    const notFound = () => new NotFoundException(`Requisition '${requisitionId}' not found.`);
    const [row] = await this.db
      .select({ farm_id: schema.requisition.farm_id, company_id: schema.requisition.company_id })
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.requisition_id, requisitionId),
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.doc_type, FEED_DOC_TYPE),
        isNull(schema.requisition.deleted_at),
      ))
      .limit(1);
    if (!row?.farm_id) throw notFound();
    let resolved: { farmId: string; companyId: string };
    try {
      resolved = await this.forecast.resolveFarm(row.farm_id, tenantId, user?.userType);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw notFound();
      throw error;
    }
    if (resolved.farmId !== row.farm_id || resolved.companyId !== row.company_id) throw notFound();
    return resolved;
  }

  /**
   * Checked here as well as by the route's @RequirePermission: approving is
   * the one act on this document that commits the mill to produce, so a
   * future internal caller must not reach it on a create grant alone.
   */
  private async assertMayDecide(user: UserCtx) {
    const may = await userHasPermission(this.db, user, { moduleCode: 'PROCUREMENT', resource: 'REQUISITION', action: 'approve' });
    if (!may) throw new ForbiddenException('You are not allowed to decide requisitions.');
  }

  /**
   * The open feed requisition, locked for the decision. Called only after
   * resolveOwnFarm and inside withFarmScope for that farm (Ruling H3), and the
   * lock re-applies the farm, the company and the scope conditions — so
   * checkpoint 19 ("cross-farm approval not allowed") holds even if one of the
   * two layers is dropped by a refactor. The status is read under the lock,
   * so two approvers racing each other cannot both decide it.
   */
  private async lockOpen(requisitionId: string, tenantId: string, farmId: string, companyId: string) {
    const [row] = await this.db
      .select()
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.requisition_id, requisitionId),
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.doc_type, FEED_DOC_TYPE),
        eq(schema.requisition.farm_id, farmId),
        eq(schema.requisition.company_id, companyId),
        isNull(schema.requisition.deleted_at),
        ...this.scopeConditions(),
      ))
      .limit(1)
      .for('update');
    if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
    if (!OPEN_FEED_STATUSES.includes(row.status)) {
      throw new BadRequestException(`Requisition ${row.req_no} is ${row.status} and can no longer be changed.`);
    }
    return row;
  }

  /**
   * Requisition §4 step 3: the farm changes Requested Qty and the delivery
   * date. A changed quantity sets quantity_edited (Ruling M9), which is what
   * keeps it through the next auto-draft rerun; the bag count follows the new
   * quantity (§2 row 54) and the header's required date follows the earliest
   * line (§1 row 29).
   */
  private async applyLineEdits(requisitionId: string, edits: FeedLineEditInput[] | undefined, farmId: string, tenantId: string) {
    if (!edits?.length) return;
    const settings = (await this.loadFarm(farmId, tenantId)).settings;
    let datesChanged = false;
    for (const edit of edits) {
      const [line] = await this.db
        .select({ line_id: schema.requisitionLine.line_id, feed_type: schema.requisitionLine.feed_type, quantity: schema.requisitionLine.quantity })
        .from(schema.requisitionLine)
        .where(and(eq(schema.requisitionLine.line_id, edit.line_id), eq(schema.requisitionLine.requisition_id, requisitionId)))
        .limit(1);
      if (!line) throw new BadRequestException(`Line ${edit.line_id} is not on this requisition.`);
      const prior = Number(line.quantity);
      const quantityChanged = edit.quantity_kg != null && Math.abs(edit.quantity_kg - prior) > 1e-6;
      const quantity = quantityChanged ? edit.quantity_kg! : prior;
      if (edit.proposed_delivery_date) datesChanged = true;
      await this.db.update(schema.requisitionLine).set({
        ...(quantityChanged ? { quantity: String(quantity), quantity_edited: true } : {}),
        bag_count: bagCountFor(quantity, (line.feed_type ?? 'BULK') as FeedType, settings),
        ...(edit.proposed_delivery_date ? { proposed_delivery_date: edit.proposed_delivery_date } : {}),
      }).where(eq(schema.requisitionLine.line_id, edit.line_id));
    }
    if (datesChanged) {
      await this.db.update(schema.requisition).set({
        required_date: sql`(SELECT MIN(rl.proposed_delivery_date) FROM requisition_line rl WHERE rl.requisition_id = ${requisitionId})`,
      }).where(eq(schema.requisition.requisition_id, requisitionId));
    }
  }

  /** PUT: edit quantities, delivery dates and remarks of an open requisition of the caller's own farm. */
  async update(id: string, dto: UpdateFeedRequisitionDto, tenantId: string, user: UserCtx) {
    const { farmId, companyId } = await this.resolveOwnFarm(id, tenantId, user);
    return this.forecast.withFarmScope(farmId, companyId, async () => {
      await withTenantTransaction(this.cls, async () => {
        await this.lockOpen(id, tenantId, farmId, companyId);
        await this.applyLineEdits(id, dto.lines, farmId, tenantId);
        await this.db.update(schema.requisition).set({
          ...(dto.remarks !== undefined ? { remarks: dto.remarks?.trim() || null } : {}),
          updated_by: user?.userId ?? null,
        }).where(eq(schema.requisition.requisition_id, id));
      });
      return this.readView(id, tenantId);
    });
  }

  /**
   * Requisition §4 step 4. Q3: one action from AUTO_DRAFT, DRAFT or
   * PENDING_APPROVAL, with any last edits applied first so the 20 % check
   * (checkpoint 18) sees the quantities being approved. Remarks — the ones
   * sent now, or the ones already saved — answer both that and a late
   * approval (checkpoint 22, Q5). The decision is recorded in the approval
   * engine in the same transaction (Ruling C1), and only after it commits
   * are the farm's alerts re-evaluated, so the REQ_DEADLINE reminder on this
   * requisition resolves at once rather than at the next posting.
   */
  async approve(id: string, dto: DecideFeedRequisitionDto, tenantId: string, user: UserCtx) {
    await this.assertMayDecide(user);
    const { farmId, companyId } = await this.resolveOwnFarm(id, tenantId, user);
    await this.forecast.withFarmScope(farmId, companyId, () => withTenantTransaction(this.cls, async () => {
      const row = await this.lockOpen(id, tenantId, farmId, companyId);
      await this.applyLineEdits(id, dto.lines, farmId, tenantId);
      const lines = await this.db
        .select({
          line_seq: schema.requisitionLine.line_seq,
          description: schema.requisitionLine.description,
          quantity: schema.requisitionLine.quantity,
          recommended: schema.requisitionLine.recommended_qty_kg,
        })
        .from(schema.requisitionLine)
        .where(eq(schema.requisitionLine.requisition_id, id))
        .orderBy(schema.requisitionLine.line_seq);
      const remarks = dto.remarks?.trim() || row.remarks?.trim() || null;
      // D16: the deadline is checked against the farm's day, the same one the forecast plans from.
      const { today: approveToday } = await this.forecast.farmToday(companyId, tenantId);
      const problems = approvalProblems({
        lines: lines.map((l) => ({
          lineSeq: l.line_seq, itemName: l.description ?? '', quantityKg: Number(l.quantity),
          recommendedQtyKg: l.recommended == null ? null : Number(l.recommended),
        })),
        remarks,
        today: approveToday,
        submissionDeadline: row.submission_deadline,
      });
      if (problems.length) throw new BadRequestException(problems.join(' '));

      const requestId = await this.approvals.decideFarmDocument({
        documentType: 'FEED_REQUISITION',
        documentId: id,
        documentNo: row.req_no,
        farmId,
        companyId,
        title: `Feed requisition ${row.req_no}`,
        urgency: row.priority === 'CRITICAL_FIRST_PRIORITY' || row.priority === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
        itemOrStage: 'FEED',
        requestId: row.approval_request_id,
      }, 'APPROVED', remarks, tenantId, user);
      await this.db.update(schema.requisition).set({
        status: 'APPROVED',
        approval_request_id: requestId,
        remarks,
        approved_by: user?.userId ?? null,
        approved_at: nowTs(),
        updated_by: user?.userId ?? null,
      }).where(eq(schema.requisition.requisition_id, id));
    }));
    await this.feedAlerts.evaluateFarmSafely(farmId, companyId, tenantId);
    return this.forecast.withFarmScope(farmId, companyId, () => this.readView(id, tenantId));
  }

  /** Reject with a reason, recorded in the approval engine like an approval (L15), then the farm's alerts re-evaluated. */
  async reject(id: string, dto: DecideFeedRequisitionDto, tenantId: string, user: UserCtx) {
    await this.assertMayDecide(user);
    const reason = dto.rejection_reason?.trim();
    if (!reason) throw new BadRequestException('A rejection reason is required.');
    const { farmId, companyId } = await this.resolveOwnFarm(id, tenantId, user);
    await this.forecast.withFarmScope(farmId, companyId, () => withTenantTransaction(this.cls, async () => {
      const row = await this.lockOpen(id, tenantId, farmId, companyId);
      const requestId = await this.approvals.decideFarmDocument({
        documentType: 'FEED_REQUISITION',
        documentId: id,
        documentNo: row.req_no,
        farmId,
        companyId,
        title: `Feed requisition ${row.req_no}`,
        itemOrStage: 'FEED',
        requestId: row.approval_request_id,
      }, 'REJECTED', reason, tenantId, user);
      await this.db.update(schema.requisition).set({
        status: 'REJECTED',
        approval_request_id: requestId,
        remarks: row.remarks ? `${row.remarks}\nRejected: ${reason}` : `Rejected: ${reason}`,
        updated_by: user?.userId ?? null,
      }).where(eq(schema.requisition.requisition_id, id));
    }));
    await this.feedAlerts.evaluateFarmSafely(farmId, companyId, tenantId);
    return this.forecast.withFarmScope(farmId, companyId, () => this.readView(id, tenantId));
  }

  /** The requisition view, read under the farm scope the caller already set (withFarmScope). */
  private async readView(requisitionId: string, tenantId: string) {
    const [row] = await this.db
      .select({ req: schema.requisition, farm_code: schema.locationMaster.location_code, truck_target_kg: schema.locationMaster.feed_truck_target_kg })
      .from(schema.requisition)
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.requisition.farm_id))
      .where(and(
        eq(schema.requisition.requisition_id, requisitionId),
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.doc_type, FEED_DOC_TYPE),
        isNull(schema.requisition.deleted_at),
        ...this.scopeConditions(),
      ))
      .limit(1);
    if (!row) throw new NotFoundException(`Requisition '${requisitionId}' not found.`);
    const destination = schema.locationMaster;
    const lines = await this.db
      .select({
        line: schema.requisitionLine,
        item_code: schema.itemMaster.item_code,
        item_name: schema.itemMaster.item_name,
        destination_code: destination.location_code,
      })
      .from(schema.requisitionLine)
      .leftJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.requisitionLine.item_id))
      .leftJoin(destination, eq(destination.location_id, schema.requisitionLine.destination_location_id))
      .where(eq(schema.requisitionLine.requisition_id, requisitionId))
      .orderBy(schema.requisitionLine.line_seq);
    // Requisition §1 row 26: "Sum of requested bulk quantities this cycle", shown against the 30,000 kg truck target (row 27) — trips, not a cap (checkpoint 17).
    const farmTotal = lines.filter((l) => l.line.feed_type === 'BULK').reduce((sum, l) => sum + Number(l.line.quantity), 0);
    const truckTarget = row.truck_target_kg ?? 30000;
    return {
      ...row.req,
      farm_code: row.farm_code,
      lines: lines.map((l) => ({ ...l.line, item_code: l.item_code, item_name: l.item_name, destination_code: l.destination_code })),
      farm_total_requested_kg: farmTotal,
      truck_target_kg: truckTarget,
      truck_trips: farmTotal > 0 ? Math.ceil(farmTotal / truckTarget) : 0,
    };
  }
}
