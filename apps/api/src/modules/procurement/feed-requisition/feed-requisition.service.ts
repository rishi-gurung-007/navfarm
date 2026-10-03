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
import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, like, notInArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { FARM_SCOPE_KEY, farmScope } from '../../../common/farm-scope';
import { userHasPermission } from '../../../common/permissions';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { isDuplicateEntry } from '../../../common/filters/http-exception.filter';
import { FeedForecastService, MAX_SPAN_DAYS, type FeedForecastResponse } from '../../inventory/feed-forecast/feed-forecast.service';
import { utcTimestamp, type ForecastSource } from '../../inventory/feed-forecast/feed-forecast.engine';
import {
  buildOutputSnapshot, buildRunLineSnapshots, FORECAST_RUN_OUTPUT_HASH_VERSION,
  type ForecastRunLineSnapshot, type ForecastRunOutputSnapshot,
} from '../../inventory/feed-forecast/feed-forecast-run.rules';
import { FeedAlertService } from '../../inventory/feed-alert/feed-alert.service';
import { SiloFeedService } from '../../inventory/silo-feed/silo-feed.service';
import { itemKindCondition } from '../../master-data/item/item-kind-filter';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { ApprovalService } from '../../production/approval/approval.service';
import type { ApprovalRequestRow } from '../../production/approval/approval.service';
import { FeedSettingsService } from '../../inventory/feed-settings/feed-settings.service';
import { toFarmFeedSettings } from '../../inventory/feed-settings/feed-settings.rules';
import {
  ApprovalLine, DestinationInfo, DraftLine, FarmFeedSettings, FeedType, approvalProblems, bagCountFor, diffDaysIso, feedTypeOf, lineKey, planDraftUpsert,
  productionCycle, recommendLines, requisitionPriority, runKeyFor, serverToday, wasEdited,
} from './feed-requisition.rules';
import {
  AutoDraftFeedRequisitionDto, CreateManualFeedRequisitionDto, FeedLineEditInput, QueryFeedRequisitionDto,
  UpdateFeedRequisitionDto,
} from './dto/feed-requisition.dto';

/** The caller as the JWT carries it. userType is required by resolveFarm, which fails closed without it. */
export type UserCtx = { userId?: string; userType?: string; email?: string };

export const FEED_DOC_TYPE = 'FEED';
/** Statuses Plan B treated as open. Kept for the REQ_DEADLINE facts and the auto-draft cycle, which still count a requisition waiting for approval as "not approved". */
export const OPEN_FEED_STATUSES = ['AUTO_DRAFT', 'DRAFT', 'PENDING_APPROVAL'];
/** D25: the approval_request doc_type a feed requisition is submitted as. */
export const FEED_APPROVAL_DOC_TYPE = 'FEED_REQUISITION';
const STATUS_WORDS: Record<string, string> = {
  PENDING_APPROVAL: 'waiting for approval', APPROVED: 'approved', REJECTED: 'rejected', CANCELLED: 'cancelled',
};

/**
 * D25: a requisition the farm may still change and submit — a draft, or a
 * PENDING_APPROVAL one Plan B left with no approval request (nothing in the
 * inbox can decide it, so the farm submits it again). Once submitted it is
 * the approver's, and changes wait for a rejection or a withdrawal.
 */
export function isEditableFeedRequisition(row: { status: string; approval_request_id: string | null }): boolean {
  return row.status === 'AUTO_DRAFT' || row.status === 'DRAFT' || (row.status === 'PENDING_APPROVAL' && !row.approval_request_id);
}
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

/**
 * The feed requisition list's columns (review A1, 27 Sep). The two totals are
 * correlated subqueries, and the outer reference is written as raw SQL on
 * purpose: in a single-table select Drizzle renders a column interpolated
 * into sql`` without its table, so `${schema.requisition.requisition_id}`
 * came out as a bare `requisition_id` that MySQL bound to requisition_line
 * itself — every row counted every line of the farm. Exported so the
 * rendered SQL is pinned by feed-requisition.list-sql.spec.ts.
 */
export function requisitionListFields() {
  const R = schema.requisition;
  const outer = sql.raw('`requisition`.`requisition_id`');
  return {
    requisition_id: R.requisition_id,
    req_no: R.req_no,
    requisition_type: R.requisition_type,
    status: R.status,
    priority: R.priority,
    required_date: R.required_date,
    submission_deadline: R.submission_deadline,
    created_at: R.created_at,
    approval_request_id: R.approval_request_id,
    line_count: sql<number>`(SELECT COUNT(*) FROM requisition_line rl WHERE rl.requisition_id = ${outer})`,
    requested_kg: sql<string>`(SELECT COALESCE(SUM(rl.quantity), 0) FROM requisition_line rl WHERE rl.requisition_id = ${outer})`,
  };
}

@Injectable()
export class FeedRequisitionService implements OnModuleInit {
  constructor(
    private readonly cls: ClsService,
    private readonly forecast: FeedForecastService,
    // Approve/reject record their decision through its document-scoped path (Ruling C1).
    private readonly approvals: ApprovalService,
    private readonly feedAlerts: FeedAlertService,
    // Ruling I4: the balance a line snapshots is the one FEED_BELOW_L1 alerts on — read the same way.
    private readonly siloFeed: SiloFeedService,
    private readonly ledger: InventoryLedgerService,
    // Task 5: the farm's draft-rounding settings (bulk multiple, bag size, truck target, production weekday,
    // safety stock) come from Feed Planning Settings now, not location_master's own feed_* columns.
    private readonly feedSettings: FeedSettingsService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /** D25: tells the approval engine what approving, rejecting and withdrawing a feed requisition does. */
  onModuleInit(): void {
    this.approvals.registerDocumentHandler(FEED_APPROVAL_DOC_TYPE, {
      decide: (request, decision, remarks, tenantId, user) => this.decideFromApproval(request, decision, remarks, tenantId, user),
      withdraw: (request, tenantId, user) => this.withdrawFromApproval(request, tenantId, user),
      afterDecide: (request, tenantId) => this.feedAlerts.evaluateFarmSafely(request.farm_id, request.company_id, tenantId),
    });
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

  private async loadFarm(farmId: string, companyId: string, tenantId: string): Promise<FarmRow> {
    const [row] = await this.db
      .select({ location_code: schema.locationMaster.location_code })
      .from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.location_id, farmId), eq(schema.locationMaster.tenant_id, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Farm not found.');
    return { code: row.location_code, settings: toFarmFeedSettings(await this.resolveFeedSettings(companyId, farmId)) };
  }

  /**
   * Task 4's fix round 2 (Important 4, Rishi's ruling), re-applied here: feed
   * settings are company/farm-level configuration, not LOB-scoped data, but
   * FeedSettingsService.resolve() calls assertLobInScope(scope, farm.lob_id)
   * unconditionally once a farmId is passed — strict `lobId !== scope.lobId`
   * with no NULL-lob_id carve-out, unlike every LOB check this module's own
   * destination/source reads apply. A restricted (OPERATIONAL_ADMIN) caller
   * acting on a farm whose lob_id is NULL (location_master.lob_id is
   * nullable, and NULL does occur) would get ForbiddenException for the
   * whole draft before any computation. Reading outside that one assertion
   * (restricted: false, lobId: null, just for this nested call) does not
   * widen access: resolve() still enforces the company boundary and the
   * farm-company match.
   */
  private async resolveFeedSettings(companyId: string, farmId: string) {
    const scope = farmScope(this.cls);
    return this.cls.run(async () => {
      this.cls.set(FARM_SCOPE_KEY, { ...scope, restricted: false, lobId: null });
      return this.feedSettings.resolve(companyId, farmId);
    });
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
        silo_capacity_kg: schema.locationMaster.silo_capacity_kg,
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
        // Always canonical KG (schema.ts): the service converts TON to KG on write, silo_capacity_uom is display only.
        capacityKg: r.silo_capacity_kg == null ? null : Number(r.silo_capacity_kg),
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
  private lineValues(line: DraftLine, forecastRunLineIds?: string[] | null) {
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
      // days_remaining is an INT column; daysRemaining is one decimal (Task 3) — rounded here, deliberately, not
      // left to MySQL's own silent truncation. Whether the sub-form wants one decimal is still open with the client.
      days_remaining: line.daysRemaining === null ? null : Math.round(line.daysRemaining),
      first_shortage_date: line.firstShortageDate,
      unrounded_need_kg: dec(line.unroundedNeedKg),
      recommended_qty_kg: dec(line.recommendedQtyKg),
      bag_count: line.bagCount,
      recommended_delivery_date: line.recommendedDeliveryDate,
      proposed_delivery_date: line.proposedDeliveryDate,
      exceeds_silo_capacity: line.exceedsSiloCapacity,
      needs_silo_changeover: line.needsSiloChangeover,
      feed_forecast_run_line_ids: forecastRunLineIds?.length ? forecastRunLineIds : null,
    };
  }

  /**
   * A persisted run may explain a system draft only when it contains the
   * exact engine inputs, material engine output and requisition settings used
   * for this calculation. Both the live run lines and the fresh calculation
   * must reproduce the immutable header's versioned output hash.
   * A requisition line aggregates every dated run line for its destination +
   * item; retaining all IDs avoids falsely presenting an arbitrary first day
   * as the sole origin of an aggregate quantity.
   */
  private async matchingPersistedRun(
    forecast: {
      planningDate: string;
      from?: string;
      to: string;
      sourceSnapshot?: { hash?: string };
      sources: ForecastSource[];
      daily: FeedForecastResponse['daily'];
    },
    settings: FarmFeedSettings,
    wanted: DraftLine[],
    farmId: string,
    companyId: string,
    tenantId: string,
  ): Promise<{ runId: string; runCode: string; linesBySource: Map<string, string[]> } | null> {
    const [run] = await this.db.select({
      run_id: schema.feedForecastRun.run_id,
      run_code: schema.feedForecastRun.run_code,
      version: schema.feedForecastRun.version,
      source_snapshot: schema.feedForecastRun.source_snapshot,
      output_snapshot: schema.feedForecastRun.output_snapshot,
      config_snapshot: schema.feedForecastRun.config_snapshot,
    }).from(schema.feedForecastRun).where(and(
      eq(schema.feedForecastRun.tenant_id, tenantId),
      eq(schema.feedForecastRun.company_id, companyId),
      eq(schema.feedForecastRun.farm_id, farmId),
      eq(schema.feedForecastRun.planning_date, forecast.planningDate),
      eq(schema.feedForecastRun.view, 'CUSTOM'),
      eq(schema.feedForecastRun.from_date, forecast.from ?? forecast.planningDate),
      eq(schema.feedForecastRun.to_date, forecast.to),
      isNull(schema.feedForecastRun.period_id),
    )).orderBy(desc(schema.feedForecastRun.version)).limit(1);
    if (!run) return null;
    const runSource = run.source_snapshot as { hash?: unknown } | null;
    const runOutput = run.output_snapshot as Partial<ForecastRunOutputSnapshot> | null;
    const runConfig = run.config_snapshot as { values?: { requisitionDraftSettings?: Partial<FarmFeedSettings> } } | null;
    const savedSettings = runConfig?.values?.requisitionDraftSettings;
    if (!forecast.sourceSnapshot?.hash || runSource?.hash !== forecast.sourceSnapshot.hash || !savedSettings) return null;
    const settingKeys: Array<keyof FarmFeedSettings> = ['bulkMultipleKg', 'bagSizeKg', 'truckTargetKg', 'productionWeekday'];
    if (settingKeys.some((key) => savedSettings[key] !== settings[key])) return null;
    // System Balance is read from the live ledger after the forecast because
    // it includes postings made today. Such a posting can leave the engine's
    // start-of-day input hash unchanged, so it is an additional equality
    // boundary: do not label a changed draft as evidence from the old run.
    const sourceByKey = new Map(forecast.sources.map((source) => [lineKey(source.locationId, source.itemId), source]));
    if (wanted.some((line) => {
      const source = sourceByKey.get(line.key);
      return !source || Math.abs(line.systemBalanceKg - source.balanceKg) > 1e-6;
    })) return null;
    const lines = await this.db.select({
      run_line_id: schema.feedForecastRunLine.run_line_id,
      forecast_date: schema.feedForecastRunLine.forecast_date,
      batch_id: schema.feedForecastRunLine.batch_id,
      shed_id: schema.feedForecastRunLine.shed_id,
      destination_location_id: schema.feedForecastRunLine.destination_location_id,
      required_item_id: schema.feedForecastRunLine.required_item_id,
      current_item_id: schema.feedForecastRunLine.current_item_id,
      head_count: schema.feedForecastRunLine.head_count,
      feed_rate_kg: schema.feedForecastRunLine.feed_rate_kg,
      opening_stock_kg: schema.feedForecastRunLine.opening_stock_kg,
      confirmed_receipt_kg: schema.feedForecastRunLine.confirmed_receipt_kg,
      daily_demand_kg: schema.feedForecastRunLine.daily_demand_kg,
      projected_closing_kg: schema.feedForecastRunLine.projected_closing_kg,
      shortage_date: schema.feedForecastRunLine.shortage_date,
      recommended_qty_kg: schema.feedForecastRunLine.recommended_qty_kg,
      provenance_snapshot: schema.feedForecastRunLine.provenance_snapshot,
    }).from(schema.feedForecastRunLine).where(eq(schema.feedForecastRunLine.run_id, run.run_id))
      .orderBy(schema.feedForecastRunLine.forecast_date, schema.feedForecastRunLine.run_line_id);
    const persistedMaterial: ForecastRunLineSnapshot[] = lines.map((line) => ({
      forecastDate: line.forecast_date,
      batchId: line.batch_id,
      shedId: line.shed_id,
      destinationLocationId: line.destination_location_id,
      requiredItemId: line.required_item_id,
      currentItemId: line.current_item_id,
      headCount: line.head_count,
      feedRateKg: Number(line.feed_rate_kg),
      openingStockKg: Number(line.opening_stock_kg),
      confirmedReceiptKg: Number(line.confirmed_receipt_kg),
      dailyDemandKg: Number(line.daily_demand_kg),
      projectedClosingKg: Number(line.projected_closing_kg),
      shortageDate: line.shortage_date,
      recommendedQtyKg: Number(line.recommended_qty_kg),
      provenanceSnapshot: line.provenance_snapshot,
    }));
    const freshOutput = buildOutputSnapshot(buildRunLineSnapshots(forecast));
    const persistedOutput = buildOutputSnapshot(persistedMaterial);
    if (
      runOutput?.version !== FORECAST_RUN_OUTPUT_HASH_VERSION
      || runOutput.hash !== freshOutput.hash
      || runOutput.lineCount !== freshOutput.lineCount
      || runOutput.hash !== persistedOutput.hash
      || runOutput.lineCount !== persistedOutput.lineCount
    ) return null;
    const linesBySource = new Map<string, string[]>();
    for (const line of lines) {
      if (!line.destination_location_id) continue;
      const key = lineKey(line.destination_location_id, line.required_item_id);
      const ids = linesBySource.get(key) ?? [];
      ids.push(line.run_line_id);
      linesBySource.set(key, ids);
    }
    // A header link is all-or-nothing. If even one aggregate draft line has
    // no dated contributors in this run, leave the header and every line
    // detached instead of creating partial/misleading provenance.
    if (wanted.some((line) => !linesBySource.get(line.key)?.length)) return null;
    return { runId: run.run_id, runCode: run.run_code, linesBySource };
  }

  /**
   * Ruling I4: every source's ledger balance as it stands now, keyed by
   * lineKey — what a drafted line snapshots as System Balance and tests
   * against the silo's low level (and so what CRITICAL_FIRST_PRIORITY rests
   * on). The forecast's `balanceKg` is the start of the planning day, which
   * leaves out feed already posted today (VIL100/SILO-004: 2,700 against a
   * ledger of 2,684); FEED_BELOW_L1 reads the ledger now, and a requisition
   * that disagreed with the alert about one silo's stock would help no one.
   * So a silo is read exactly as the alert reads it (SiloFeedService.currentItems:
   * the resident item's on-hand), and a store — which can hold several items —
   * from the same getStockBalance, its item's KG rows (the forecast refuses a
   * source held in any other unit before this runs). Called inside
   * withFarmScope, so the ledger read carries the farm bound the alert's does.
   */
  private async currentBalances(sources: ForecastSource[], companyId: string, tenantId: string): Promise<Map<string, number>> {
    const balances = new Map<string, number>();
    const siloIds = [...new Set(sources.filter((s) => s.sourceType === 'SILO').map((s) => s.locationId))];
    const storeIds = [...new Set(sources.filter((s) => s.sourceType === 'STORE').map((s) => s.locationId))];
    if (siloIds.length) {
      const residents = await this.siloFeed.currentItems(siloIds, companyId, tenantId);
      for (const [siloId, resident] of residents) if (resident) balances.set(lineKey(siloId, resident.item_id), resident.on_hand_qty);
    }
    for (const storeId of storeIds) {
      const rows = await this.ledger.getStockBalance({ companyId, warehouseId: storeId } as any, tenantId);
      for (const r of rows) {
        if (r.uom !== 'KG') continue;
        const key = lineKey(storeId, r.item_id);
        balances.set(key, (balances.get(key) ?? 0) + r.on_hand_qty);
      }
    }
    return balances;
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
      const farm = await this.loadFarm(farmId, companyId, tenantId);
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
      // Plan R (Ruling I4) — intended changes to Plan B's drafts: the need is the forecast's shortfall to the
      // low level with booked transfers counted (D19/Q3), the line is dated Required On (Q4), priority follows
      // D19's run-down, and System Balance / the low-level test read the ledger now, as FEED_BELOW_L1 does.
      const currentBalanceKg = await this.currentBalances(forecast.sources, companyId, tenantId);
      const wanted = recommendLines({
        planningDate: forecast.planningDate, to: forecast.to, sources: forecast.sources, destinations, settings: farm.settings, currentBalanceKg,
      });
      const cycle = productionCycle(forecast.planningDate, farm.settings.productionWeekday);
      const persistedRun = await this.matchingPersistedRun(forecast, farm.settings, wanted, farmId, companyId, tenantId);

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

        // A farm-edited line retained outside the current forecast cannot be
        // explained by the current run. In that mixed case detach the entire
        // editable document rather than link only some lines to its header.
        const draftRun = plan.keep.length ? null : persistedRun;
        const runKey = draftRun?.runCode ?? runKeyFor(farm.code);
        const runLinesFor = (line: DraftLine) => draftRun?.linesBySource.get(lineKey(line.destinationLocationId, line.itemId)) ?? null;

        const drafted = [...plan.insert, ...plan.update.map((u) => u.line)];
        const header = {
          // A rerun that drafts nothing new but keeps the farm's own lines leaves
          // priority and required date as they were rather than blanking them.
          ...(drafted.length ? {
            priority: requisitionPriority(forecast.planningDate, drafted),
            required_date: drafted.map((l) => l.proposedDeliveryDate).sort()[0] ?? null,
          } : {}),
          forecast_run_key: runKey,
          feed_forecast_run_id: draftRun?.runId ?? null,
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
            plan.insert.map((line) => ({
              requisition_id: requisitionId, line_seq: line.lineNo, quantity: String(line.recommendedQtyKg), quantity_edited: false, ...this.lineValues(line, runLinesFor(line)),
            })),
          );
          return { requisitionId, created: true, linesDrafted: plan.insert.length };
        }

        if (plan.remove.length) {
          await this.db.delete(schema.requisitionLine).where(inArray(schema.requisitionLine.line_id, plan.remove));
        }
        for (const u of plan.update) {
          await this.db.update(schema.requisitionLine).set({
            ...this.lineValues(u.line, runLinesFor(u.line)),
            // line_seq is deliberately NOT written here. It is user-visible (requisitions-panel.tsx,
            // requisition-approval-detail.tsx) and requisition_line carries no unique index on it, so
            // renumbering an already-drafted matched line to its current draft-order position on every
            // rerun would both move a number someone already saw and risk two live lines sharing one once
            // an insert below picks a number a concurrent-looking update also claims. Sparse 10000-stepping
            // exists precisely so an existing line's identity is stable and new lines slot in between
            // (Requisition §1 row 42) — a matched line keeps the line_seq it already has.
            // M9: an edited line keeps the farm's quantity (and its flag); only
            // the snapshot and the recommendation beside it are refreshed.
            ...(u.keepQuantity
              ? { bag_count: bagCountFor(u.priorQuantityKg, u.line.feedType, farm.settings) }
              : { quantity: String(u.line.recommendedQtyKg) }),
          }).where(eq(schema.requisitionLine.line_id, u.lineId));
        }
        if (plan.insert.length) {
          // Three feed writers of line_seq (this one, the fresh draft above, and manual createManual) share the
          // same 10000-step convention (Requisition §1 row 42). `existing` already carries every currently
          // persisted line's real line_seq (matched, kept and about-to-be-removed alike — the update loop above
          // never changes it), so a plain max over it is enough to place an appended line after everything
          // already on the requisition. Without the *10000 step a second append after a 10000/20000 first draft
          // landed on 20001, 20002 — in sequence, but off the NAV-style convention every other line follows.
          const maxSeq = Math.max(0, ...existing.map((l) => l.line_seq));
          await this.db.insert(schema.requisitionLine).values(
            plan.insert.map((line, i) => ({
              requisition_id: draft.requisition_id, line_seq: maxSeq + (i + 1) * 10000, quantity: String(line.recommendedQtyKg), quantity_edited: false, ...this.lineValues(line, runLinesFor(line)),
            })),
          );
        }
        // A kept edited line has no current forecast source. Once the header
        // advances (or detaches) it must not retain provenance from an older
        // run, which would make the header and line contradict one another.
        for (const keptLineId of plan.keep) {
          await this.db.update(schema.requisitionLine)
            .set({ feed_forecast_run_line_ids: null })
            .where(eq(schema.requisitionLine.line_id, keptLineId));
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

  /**
   * What the New requisition dialog offers (F3, review I3). It used to read
   * GET /location and GET /item, which are Master Data routes under the
   * master scope: in the tenant-wide workspace those answer with the tenant
   * templates or with nothing, and a farm login holds no Master Data grant at
   * all — while the same screen lists the farm quite happily. These options
   * follow the module's own rule instead: resolveFarm decides the farm, and
   * what comes back is that farm's active silos and stores and its company's
   * active feed items.
   */
  async options(farmIdIn: string | undefined, tenantId: string, user: UserCtx) {
    const { farmId, companyId } = await this.forecast.resolveFarm(farmIdIn, tenantId, user?.userType);
    return this.forecast.withFarmScope(farmId, companyId, async () => {
      const destinations = await this.db
        .select({
          location_id: schema.locationMaster.location_id,
          location_code: schema.locationMaster.location_code,
          location_type: schema.locationMaster.location_type,
        })
        .from(schema.locationMaster)
        .where(and(
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.company_id, companyId),
          eq(schema.locationMaster.farm_id, farmId),
          inArray(schema.locationMaster.location_type, ['SILO', 'STORE']),
          eq(schema.locationMaster.is_active, true),
          isNull(schema.locationMaster.deleted_at),
        ));
      const items = await this.db
        .select({
          item_id: schema.itemMaster.item_id,
          item_code: schema.itemMaster.item_code,
          item_name: schema.itemMaster.item_name,
          uom_primary: schema.itemMaster.uom_primary,
        })
        .from(schema.itemMaster)
        .where(this.feedItemConditions(tenantId, companyId));
      const byCode = (a: { location_code: string }, b: { location_code: string }) => a.location_code.localeCompare(b.location_code);
      return {
        farmId,
        companyId,
        destinations: [...destinations].sort(byCode),
        items: [...items].sort((a, b) => a.item_code.localeCompare(b.item_code)),
      };
    });
  }

  /**
   * An item a feed requisition may name: this company's own, of a FEED kind,
   * live. "Of a FEED kind" rather than item_type = 'FEED' because a tenant
   * names its own item types — Porta Farm's is "FEED-001" (item kinds, 29 Sep),
   * and on that tenant this condition matched nothing at all.
   */
  private feedItemConditions(tenantId: string, companyId: string): SQL {
    return and(
      eq(schema.itemMaster.tenant_id, tenantId),
      eq(schema.itemMaster.company_id, companyId),
      itemKindCondition('FEED', tenantId, companyId), // this path already knows its company
      eq(schema.itemMaster.is_active, true),
      isNull(schema.itemMaster.deleted_at),
    )!;
  }

  async createManual(dto: CreateManualFeedRequisitionDto, tenantId: string, user: UserCtx) {
    const { farmId, companyId } = await this.forecast.resolveFarm(dto.farmId, tenantId, user?.userType);
    const requisitionId = await this.forecast.withFarmScope(farmId, companyId, async () => {
      const farm = await this.loadFarm(farmId, companyId, tenantId);
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
      // F3: the tenant alone is not a boundary — another company's item, a
      // tenant template, a medicine or a blocked item was accepted here, and
      // its name copied onto the line. The options endpoint offers exactly
      // this set.
      const items = await this.db
        .select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name })
        .from(schema.itemMaster)
        .where(and(this.feedItemConditions(tenantId, companyId), inArray(schema.itemMaster.item_id, itemIds)));
      const nameOf = new Map(items.map((i) => [i.item_id, i.item_name]));
      const missing = itemIds.find((id) => !nameOf.has(id));
      if (missing) throw new BadRequestException(`Feed item ${missing} is not an active feed item of this company.`);

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
            // Requisition §1 row 42: the same NAV-style 10000-step convention the auto-drafted lines use.
            line_seq: (i + 1) * 10000,
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
        .select(requisitionListFields())
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
    if (!isEditableFeedRequisition(row)) {
      throw new BadRequestException(`Requisition ${row.req_no} is ${STATUS_WORDS[row.status] ?? row.status.toLowerCase()} and can no longer be changed.`);
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
  private async applyLineEdits(requisitionId: string, edits: FeedLineEditInput[] | undefined, farmId: string, companyId: string, tenantId: string) {
    if (!edits?.length) return;
    const settings = (await this.loadFarm(farmId, companyId, tenantId)).settings;
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
        await this.applyLineEdits(id, dto.lines, farmId, companyId, tenantId);
        await this.db.update(schema.requisition).set({
          ...(dto.remarks !== undefined ? { remarks: dto.remarks?.trim() || null } : {}),
          updated_by: user?.userId ?? null,
        }).where(eq(schema.requisition.requisition_id, id));
      });
      return this.readView(id, tenantId);
    });
  }

  /** The lines as approvalProblems reads them (checkpoint 18). */
  private async linesForCheck(requisitionId: string): Promise<ApprovalLine[]> {
    const lines = await this.db
      .select({
        line_seq: schema.requisitionLine.line_seq,
        description: schema.requisitionLine.description,
        quantity: schema.requisitionLine.quantity,
        recommended: schema.requisitionLine.recommended_qty_kg,
        recommended_delivery_date: schema.requisitionLine.recommended_delivery_date,
        proposed_delivery_date: schema.requisitionLine.proposed_delivery_date,
      })
      .from(schema.requisitionLine)
      .where(eq(schema.requisitionLine.requisition_id, requisitionId))
      .orderBy(schema.requisitionLine.line_seq);
    return lines.map((l) => ({
      lineSeq: l.line_seq, itemName: l.description ?? '', quantityKg: Number(l.quantity),
      recommendedQtyKg: l.recommended == null ? null : Number(l.recommended),
      recommendedDeliveryDate: l.recommended_delivery_date ?? null,
      proposedDeliveryDate: l.proposed_delivery_date ?? '',
    }));
  }

  /**
   * D25 (Rishi, 27 Sep): the farm submits its requisition to the Approvals
   * inbox. Own farm only (resolveOwnFarm, checkpoint 19); last edits are
   * applied first, then the remarks rule is checked (S8: a requisition that
   * needs remarks — more than 20 % off, checkpoint 18, or past its deadline,
   * checkpoint 22 — never reaches an approver without them). The request and
   * the status change commit together; the farm's alerts are re-evaluated
   * after, so the REQ_DEADLINE reminder reads "waiting for approval" at once.
   */
  async submit(id: string, dto: UpdateFeedRequisitionDto, tenantId: string, user: UserCtx) {
    const { farmId, companyId } = await this.resolveOwnFarm(id, tenantId, user);
    await this.forecast.withFarmScope(farmId, companyId, () => withTenantTransaction(this.cls, async () => {
      const row = await this.lockOpen(id, tenantId, farmId, companyId);
      await this.applyLineEdits(id, dto.lines, farmId, companyId, tenantId);
      const lines = await this.linesForCheck(id);
      const remarks = dto.remarks !== undefined ? dto.remarks?.trim() || null : row.remarks?.trim() || null;
      const { today } = await this.forecast.farmToday(companyId, tenantId);
      const problems = approvalProblems({ lines, remarks, today, submissionDeadline: row.submission_deadline });
      if (problems.length) throw new BadRequestException(problems.join(' '));
      const totalKg = lines.reduce((sum, l) => sum + l.quantityKg, 0);
      const requestId = await this.approvals.submitFarmDocument({
        documentType: FEED_APPROVAL_DOC_TYPE,
        documentId: id,
        documentNo: row.req_no,
        farmId,
        companyId,
        title: `Feed requisition ${row.req_no}`,
        urgency: row.priority === 'CRITICAL_FIRST_PRIORITY' || row.priority === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
        itemOrStage: 'Feed',
        requestedQty: totalKg.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        uom: 'KG',
        justification: remarks,
      }, tenantId, user);
      await this.db.update(schema.requisition).set({
        status: 'PENDING_APPROVAL',
        approval_request_id: requestId,
        remarks,
        updated_by: user?.userId ?? null,
      }).where(eq(schema.requisition.requisition_id, id));
    }));
    await this.feedAlerts.evaluateFarmSafely(farmId, companyId, tenantId);
    return this.forecast.withFarmScope(farmId, companyId, () => this.readView(id, tenantId));
  }

  /**
   * The requisition an approval request decides, locked. The request row has
   * already passed the inbox's farm scope for this approver (farmConditions),
   * so the requisition is found by the request's own document, company and
   * farm — never by the caller's pin — and must still be waiting on exactly
   * this request: a withdrawn-and-resubmitted requisition answers only to its
   * newest request.
   */
  private async lockForApproval(request: ApprovalRequestRow, tenantId: string) {
    const [row] = await this.db
      .select()
      .from(schema.requisition)
      .where(and(
        eq(schema.requisition.requisition_id, request.document_id ?? ''),
        eq(schema.requisition.tenant_id, tenantId),
        eq(schema.requisition.doc_type, FEED_DOC_TYPE),
        eq(schema.requisition.company_id, request.company_id),
        isNull(schema.requisition.deleted_at),
      ))
      .limit(1)
      .for('update');
    if (!row || row.farm_id !== request.farm_id) throw new NotFoundException('Requisition not found.');
    if (row.status !== 'PENDING_APPROVAL' || row.approval_request_id !== request.request_id) {
      throw new BadRequestException(`Requisition ${row.req_no} is not waiting for this approval.`);
    }
    return row;
  }

  /**
   * D25: the inbox's decision, inside its transaction. Approval needs the
   * requisition approve grant as well as the inbox's (S5: approving commits
   * the mill), and re-checks the remarks rule on the approval day with the
   * approver's remarks or the saved ones — D25 keeps checkpoints 18 and 22 at
   * approval. Either decision appends what the approver wrote to the farm's
   * own remarks; neither replaces them (F6).
   */
  private async decideFromApproval(request: ApprovalRequestRow, decision: 'APPROVED' | 'REJECTED', remarks: string | null, tenantId: string, user: UserCtx) {
    await this.assertMayDecide(user);
    const row = await this.lockForApproval(request, tenantId);
    // D25 (Rishi, 1 Oct): a person may not approve a requisition they created;
    // a Farm Manager *may* approve a system-generated forecast draft for their
    // farm, which is the path an auto-drafted cycle takes. So the refusal keys
    // on how the document was raised, not on the user type.
    if (
      decision === 'APPROVED'
      && user?.userId
      && row.source === 'MANUAL_ENTRY'
      && (request.requested_by === user.userId || row.created_by === user.userId)
    ) {
      throw new ForbiddenException('You may not approve a requisition you created. Another authorized approver must decide it.');
    }
    if (decision === 'REJECTED') {
      if (!remarks) throw new BadRequestException('A rejection reason is required.');
      await this.db.update(schema.requisition).set({
        status: 'REJECTED',
        remarks: row.remarks ? `${row.remarks}\nRejected: ${remarks}` : `Rejected: ${remarks}`,
        updated_by: user?.userId ?? null,
      }).where(eq(schema.requisition.requisition_id, row.requisition_id));
      return;
    }
    const finalRemarks = remarks || row.remarks?.trim() || null;
    const { today } = await this.forecast.farmToday(row.company_id, tenantId);
    const problems = approvalProblems({ lines: await this.linesForCheck(row.requisition_id), remarks: finalRemarks, today, submissionDeadline: row.submission_deadline });
    if (problems.length) throw new BadRequestException(problems.join(' '));
    // F6: append, as a rejection does. Replacing threw away the farm's own
    // justification — the very thing checkpoints 18 and 22 asked it for.
    const storedRemarks = remarks
      ? (row.remarks?.trim() ? `${row.remarks.trim()}\nApproved: ${remarks}` : `Approved: ${remarks}`)
      : row.remarks ?? null;
    await this.db.update(schema.requisition).set({
      status: 'APPROVED',
      remarks: storedRemarks,
      approved_by: user?.userId ?? null,
      approved_at: nowTs(),
      updated_by: user?.userId ?? null,
    }).where(eq(schema.requisition.requisition_id, row.requisition_id));
  }

  /** S9: a withdrawn request hands the requisition back to the farm as a draft. */
  private async withdrawFromApproval(request: ApprovalRequestRow, tenantId: string, user: UserCtx) {
    const row = await this.lockForApproval(request, tenantId);
    await this.db.update(schema.requisition).set({
      status: 'DRAFT',
      approval_request_id: null,
      updated_by: user?.userId ?? null,
    }).where(eq(schema.requisition.requisition_id, row.requisition_id));
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
