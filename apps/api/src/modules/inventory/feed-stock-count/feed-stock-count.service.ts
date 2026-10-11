import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, Optional, UnauthorizedException,
} from '@nestjs/common';
import { alias } from 'drizzle-orm/mysql-core';
import { and, desc, eq, getTableColumns, inArray, isNull, like, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { randomUUID } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import { farmScope } from '../../../common/farm-scope';
import { mysqlTimestampFromEpoch, parseOffsetInstant } from '../../../common/mysql-utc-instant';
import { RequiredPermission } from '../../../common/decorators/require-permission.decorator';
import { userHasPermission } from '../../../common/permissions';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import * as schema from '../../../core/database/schema';
import { ApprovalRequestRow, ApprovalService } from '../../production/approval/approval.service';
import { FeedAlertService } from '../feed-alert/feed-alert.service';
import { ReasonService } from '../../master-data/reason/reason.service';
import { StockAdjustmentService } from '../stock-adjustment/stock-adjustment.service';
import { CurrencyService } from '../../system/currency/currency.service';
import { FeedSettingsService } from '../feed-settings/feed-settings.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { FeedForecastService } from '../feed-forecast/feed-forecast.service';
import {
  CreateFeedStockCountDto, QueryFeedStockCountDto, UpdateFeedStockCountDto,
} from './dto/feed-stock-count.dto';
import { approvalRoute, assertVarianceReason, RateEvidence, varianceFact, VarianceFact } from './feed-stock-count.rules';
import { assertStockTakeDate, assertStockTakePeriod, stockTakeNo } from './monthly-stock-take.rules';

/** The approval_request.doc_type the count module registers with the engine. */
export const FEED_STOCK_COUNT_APPROVAL_DOC_TYPE = 'FEED_STOCK_VARIANCE';

type Actor = {
  userId?: string;
  userType?: string;
  fullName?: string;
  email?: string;
} | undefined;

type UserCtx = { userId?: string; userType?: string } | undefined;

/** MySQL holds UTC wall-clock strings; this is the instant they represent. */
const utcInstant = (mysqlUtc: string): Date => new Date(`${mysqlUtc.replace(' ', 'T')}Z`);
const nowTs = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** A rejected count stays correctable rather than becoming a dead document. */
type EditableStatus = 'DRAFT' | 'REJECTED';
const EDITABLE_STATUSES: EditableStatus[] = ['DRAFT', 'REJECTED'];

const routeEvidence = (line: { variance_pct_absolute: string | number; variance_value_base?: string | number | null }) => ({
  variancePctAbsolute: Number(line.variance_pct_absolute),
  varianceValueBase: line.variance_value_base === null || line.variance_value_base === undefined
    ? null
    : Number(line.variance_value_base),
});

/** Whole days from one calendar date to another (UTC midnights). */
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** W2D A7 (Engine §1 rows 15–17): a silo's forecast facts beside its count line; all null when no forecast ran. */
export interface SiloPlanningFacts {
  projectedShortfallKg: number | null;
  nextDietItemId: string | null;
  nextDietItemCode: string | null;
  nextDietItemName: string | null;
  nextDietDate: string | null;
  nextDietInDays: number | null;
}
const NO_PLANNING: SiloPlanningFacts = {
  projectedShortfallKg: null, nextDietItemId: null, nextDietItemCode: null, nextDietItemName: null, nextDietDate: null, nextDietInDays: null,
};

/** A weekly count is always a FARM's silos; a FEED_MILL monthly take counts a MILL's bins. */
type LocKind = 'FARM' | 'MILL';
const kindOfCount = (count: { stock_take_type: string | null }): LocKind => (count.stock_take_type === 'FEED_MILL' ? 'MILL' : 'FARM');
const COUNTED_CHILD: Record<LocKind, 'SILO' | 'BIN'> = { FARM: 'SILO', MILL: 'BIN' };
const NO_UNIQUE_KEY = 'uq_feed_stock_count_company_no';

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

@Injectable()
export class FeedStockCountService implements OnModuleInit {
  constructor(
    private readonly cls: ClsService,
    private readonly ledger: InventoryLedgerService,
    private readonly settings: FeedSettingsService,
    private readonly currency: CurrencyService,
    private readonly reasons: ReasonService,
    private readonly approvals: ApprovalService,
    private readonly adjustments: StockAdjustmentService,
    private readonly feedAlerts: FeedAlertService,
    @Optional() private readonly forecast?: FeedForecastService,
  ) {}

  private readonly logger = new Logger(FeedStockCountService.name);

  /** D25: tells the approval engine what approving, rejecting and withdrawing a count does. */
  onModuleInit(): void {
    this.approvals.registerDocumentHandler(FEED_STOCK_COUNT_APPROVAL_DOC_TYPE, {
      decide: (request, decision, remarks, tenantId, user) => this.decideFromApproval(request, decision, remarks, tenantId, user),
      withdraw: (request, tenantId, user) => this.withdrawFromApproval(request, tenantId, user),
    });
  }

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private assertRequestedScope(companyId: string, farmId: string): void {
    const scope = farmScope(this.cls);
    if (scope.companyId && scope.companyId !== companyId) throw new ForbiddenException('Not authorized for this company.');
    if (scope.farmId && scope.farmId !== farmId) throw new ForbiddenException('Not authorized for this farm.');
  }

  /** The farm, or (kind MILL) the feed mill, that a count is taken at. EITHER is for read-only listing. */
  private async loadFarm(farmId: string, companyId: string, tenantId: string, lock = false, kind: LocKind | 'EITHER' = 'FARM') {
    this.assertRequestedScope(companyId, farmId);
    const scope = farmScope(this.cls);
    const query = this.db.select({
      location_id: schema.locationMaster.location_id,
      location_code: schema.locationMaster.location_code,
      company_id: schema.locationMaster.company_id,
      nob_id: schema.locationMaster.nob_id,
      lob_id: schema.locationMaster.lob_id,
    }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.location_id, farmId),
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.company_id, companyId),
      kind === 'EITHER' ? inArray(schema.locationMaster.location_type, ['FARM', 'MILL']) : eq(schema.locationMaster.location_type, kind),
      isNull(schema.locationMaster.parent_location_id),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
      ...(scope.restricted && scope.lobId ? [eq(schema.locationMaster.lob_id, scope.lobId)] : []),
    )).limit(1);
    const [farm] = lock ? await query.for('update') : await query;
    if (!farm || farm.company_id !== companyId || (scope.restricted && scope.lobId && farm.lob_id !== scope.lobId)) {
      throw new NotFoundException(kind === 'MILL' ? 'Mill not found.' : 'Farm not found.');
    }
    return farm;
  }

  private async loadActiveSilos(farmId: string, companyId: string, tenantId: string, kind: LocKind = 'FARM') {
    const scope = farmScope(this.cls);
    const childType = COUNTED_CHILD[kind];
    const place = kind === 'MILL' ? 'mill' : 'farm';
    const silos = await this.db.select({
      location_id: schema.locationMaster.location_id,
      company_id: schema.locationMaster.company_id,
      location_code: schema.locationMaster.location_code,
      location_name: schema.locationMaster.location_name,
      silo_capacity_kg: schema.locationMaster.silo_capacity_kg,
      lob_id: schema.locationMaster.lob_id,
      farm_id: schema.locationMaster.farm_id,
      parent_location_id: schema.locationMaster.parent_location_id,
      location_type: schema.locationMaster.location_type,
      is_active: schema.locationMaster.is_active,
      deleted_at: schema.locationMaster.deleted_at,
    }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.company_id, companyId),
      eq(schema.locationMaster.farm_id, farmId),
      eq(schema.locationMaster.parent_location_id, farmId),
      eq(schema.locationMaster.location_type, childType),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
      ...(scope.restricted && scope.lobId ? [eq(schema.locationMaster.lob_id, scope.lobId)] : []),
    ));
    if (!silos.length) throw new BadRequestException(`The authorized ${place} has no active ${childType} locations to count.`);
    if (silos.some((silo) => silo.company_id !== companyId || silo.farm_id !== farmId || silo.parent_location_id !== farmId
      || silo.location_type !== childType || !silo.is_active || silo.deleted_at
      || (scope.restricted && scope.lobId && silo.lob_id !== scope.lobId))) {
      throw new BadRequestException(`Physical counts may use only active ${childType}s belonging to the authorized ${place}.`);
    }
    return silos;
  }

  /**
   * W2D A7: what a count shows beside each silo that the count itself does not store — the linked House
   * Shed(s) (Engine §1 row 10) and, from the farm's silo status, projected shortfall, next diet and the days
   * until it (rows 15–17). A forecast that cannot run (no feed settings, no lifecycle) must not stop a count,
   * so its facts are then empty and `planningDate` is null.
   */
  private async siloContext(farmId: string, companyId: string, tenantId: string, siloIds: string[], kind: LocKind = 'FARM') {
    const houses = new Map<string, Array<{ id: string; code: string; name: string }>>();
    if (siloIds.length) {
      const Shed = alias(schema.locationMaster, 'count_shed') as unknown as typeof schema.locationMaster;
      const links = await this.db.select({
        silo_id: schema.siloShedLink.silo_id, shed_id: Shed.location_id, shed_code: Shed.location_code, shed_name: Shed.location_name,
      }).from(schema.siloShedLink)
        .innerJoin(Shed, eq(Shed.location_id, schema.siloShedLink.shed_id))
        .where(and(eq(schema.siloShedLink.tenant_id, tenantId), inArray(schema.siloShedLink.silo_id, siloIds), isNull(Shed.deleted_at)))
        .orderBy(Shed.location_code);
      for (const link of links) {
        houses.set(link.silo_id, [...(houses.get(link.silo_id) ?? []), { id: link.shed_id, code: link.shed_code, name: link.shed_name }]);
      }
    }
    const planning = new Map<string, SiloPlanningFacts>();
    let planningDate: string | null = null;
    if (this.forecast && kind === 'FARM') {
      try {
        const current = await this.forecast.currentSiloStatuses(farmId, companyId, tenantId);
        planningDate = current.planningDate;
        for (const status of current.statuses) {
          planning.set(status.siloId, {
            projectedShortfallKg: status.projectedShortfallKg,
            nextDietItemId: status.nextDietItemId,
            nextDietItemCode: status.nextDietItemCode,
            nextDietItemName: status.nextDietItemName,
            nextDietDate: status.nextDietDate,
            nextDietInDays: status.nextDietDate ? daysBetween(current.planningDate, status.nextDietDate) : null,
          });
        }
      } catch (error) {
        this.logger.warn(`Silo planning facts unavailable for farm ${farmId}: ${(error as Error)?.message ?? error}`);
      }
    }
    return {
      planningDate,
      housesOf: (siloId: string) => houses.get(siloId) ?? [],
      planningOf: (siloId: string) => planning.get(siloId) ?? NO_PLANNING,
    };
  }

  private async currencyEvidence(companyId: string) {
    const [company] = await this.db.select({ base_currency_id: schema.companyMaster.base_currency_id })
      .from(schema.companyMaster).where(eq(schema.companyMaster.company_id, companyId)).limit(1);
    if (!company?.base_currency_id) throw new BadRequestException('The company base currency must be configured before recording a count.');
    const [local] = await this.db.select({ currency_id: schema.companyCurrencyConfig.currency_id })
      .from(schema.companyCurrencyConfig).where(and(
        eq(schema.companyCurrencyConfig.company_id, companyId),
        eq(schema.companyCurrencyConfig.is_local, true),
      )).limit(1);
    // Base Currency is the authoritative NAVFarm currency. Local Currency is
    // optional future configuration; its absence must not block a valid base
    // currency valuation. Use an identity rate and retain the explicit null
    // local currency in the snapshot for auditability.
    if (!local?.currency_id) return {
      baseCurrencyId: company.base_currency_id,
      localCurrencyId: null,
      rate: { status: 'RESOLVED' as const, rateId: null, rate: 1, rateDate: null, createdAt: null, scope: 'IDENTITY' as const },
    };
    const rate = await this.currency.currentRate(companyId, company.base_currency_id, local.currency_id);
    return { baseCurrencyId: company.base_currency_id, localCurrencyId: local.currency_id, rate };
  }

  private async assertReason(
    fact: VarianceFact,
    reasonId: string | null | undefined,
    tenantId: string,
    scope: { companyId: string; nobId: string | null; lobId: string | null },
  ): Promise<string | null> {
    assertVarianceReason(fact, reasonId);
    if (!fact.reasonRequired) return null;
    if (!reasonId) throw new BadRequestException('A Reason Master row is required for this variance.');
    const reason = await this.reasons.findActiveForOperationalScope(reasonId, tenantId, scope);
    return reason.reason_id;
  }

  private assertScheduledOccurrence(countedAt: string, effective: {
    timezoneId: string; physicalCountWeekday: number | null; physicalCountTime: string | null;
  }): void {
    if (effective.physicalCountWeekday === null || !effective.physicalCountTime) {
      throw new BadRequestException('The physical-count schedule is not configured for this farm.');
    }
    const instant = new Date(countedAt);
    if (instant.getUTCSeconds() !== 0 || instant.getUTCMilliseconds() !== 0) {
      throw new BadRequestException('Scheduled counts must use the configured minute exactly.');
    }
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: effective.timezoneId, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    const weekday = WEEKDAYS[get('weekday') || ''];
    const time = `${get('hour')}:${get('minute')}`;
    if (weekday !== effective.physicalCountWeekday || time !== effective.physicalCountTime) {
      throw new BadRequestException('Scheduled counts must use the effective farm physical-count weekday and time.');
    }
  }

  private postingDate(instant: Date, timezoneId: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezoneId, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(instant);
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  private resolveSettings(companyId: string, locationId: string, kind: LocKind) {
    return kind === 'MILL' ? this.settings.resolve(companyId, locationId, 'MILL') : this.settings.resolve(companyId, locationId);
  }

  private countNo(farmId: string, countedAtEpochSeconds: number): string {
    return `FSC-${farmId}-${countedAtEpochSeconds}`;
  }

  /**
   * What a new count may cover: exactly the silo/item ledger pairs `create`
   * will demand, read through the same cutoff so the screen cannot offer a row
   * the transaction then rejects. Read-only — it creates nothing.
   */
  async evidence(
    query: { companyId: string; farmId: string; countedAt?: string; stockTakeType?: 'FARM' | 'FEED_MILL' },
    tenantId: string,
  ) {
    const kind: LocKind = query.stockTakeType === 'FEED_MILL' ? 'MILL' : 'FARM';
    const instant = parseOffsetInstant(query.countedAt ?? new Date(Math.floor(Date.now() / 1000) * 1000).toISOString());
    await this.loadFarm(query.farmId, query.companyId, tenantId, false, kind);
    const effective = await this.resolveSettings(query.companyId, query.farmId, kind);
    const postingDate = this.postingDate(new Date(instant.utcIso), effective.timezoneId);
    const silos = await this.loadActiveSilos(query.farmId, query.companyId, tenantId, kind);
    const rows = await this.ledger.getSiloStockEvidenceAsOf({
      companyId: query.companyId,
      siloIds: silos.map((silo) => silo.location_id),
      postingDate,
      countedAtEpochSeconds: instant.epochSeconds,
    }, tenantId);
    const siloOf = new Map(silos.map((silo) => [silo.location_id, silo]));
    const itemIds = [...new Set(rows.map((row) => row.item_id))];
    const items = itemIds.length
      ? await this.db.select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name })
        .from(schema.itemMaster).where(and(eq(schema.itemMaster.tenant_id, tenantId), inArray(schema.itemMaster.item_id, itemIds)))
      : [];
    const nameOf = new Map(items.map((item) => [item.item_id, item.item_name]));
    const context = await this.siloContext(query.farmId, query.companyId, tenantId, silos.map((silo) => silo.location_id), kind);
    return {
      farmId: query.farmId,
      companyId: query.companyId,
      countedAt: instant.utcIso,
      postingDate,
      planningDate: context.planningDate,
      silos: silos.map((silo) => ({ siloId: silo.location_id, siloCode: silo.location_code })),
      pairs: rows.map((row) => {
        const silo = siloOf.get(row.warehouse_id);
        return {
          siloId: row.warehouse_id,
          siloCode: silo?.location_code ?? null,
          siloName: silo?.location_name ?? null,
          capacityKg: silo?.silo_capacity_kg == null ? null : Number(silo.silo_capacity_kg),
          houses: context.housesOf(row.warehouse_id),
          itemId: row.item_id,
          itemCode: row.item_code,
          itemName: nameOf.get(row.item_id) ?? null,
          uom: row.uom,
          systemQtyKg: row.system_qty_kg,
          costAvailable: row.unit_cost_base !== null,
          ...context.planningOf(row.warehouse_id),
        };
      }),
    };
  }

  async create(dto: CreateFeedStockCountDto, tenantId: string, actor?: Actor) {
    if (!actor?.userId) throw new UnauthorizedException('An authenticated creator is required.');
    const creatorId = actor.userId;
    this.assertRequestedScope(dto.companyId, dto.farmId);
    const instant = parseOffsetInstant(dto.countedAt);
    const countedAt = mysqlTimestampFromEpoch(instant.epochSeconds);
    const duplicateKeys = new Set<string>();
    for (const line of dto.lines) {
      const key = `${line.siloId}:${line.itemId}`;
      if (duplicateKeys.has(key)) throw new ConflictException('A silo/item may appear only once in a physical count.');
      duplicateKeys.add(key);
    }
    const kind: LocKind = dto.stockTakeType === 'FEED_MILL' ? 'MILL' : 'FARM';
    if (kind === 'MILL' && dto.countType !== 'MONTHLY') {
      throw new BadRequestException('A feed mill is counted only by the Monthly Stock Take; choose count type MONTHLY.');
    }
    const effective = await this.resolveSettings(dto.companyId, dto.farmId, kind);
    if (dto.scheduleSource === 'SCHEDULED') this.assertScheduledOccurrence(dto.countedAt, effective);
    const postingDate = this.postingDate(new Date(instant.utcIso), effective.timezoneId);

    return withTenantTransaction(this.cls, async () => {
      const farm = await this.loadFarm(dto.farmId, dto.companyId, tenantId, true, kind);
      const [duplicate] = await this.db.select({ count_id: schema.feedStockCount.count_id })
        .from(schema.feedStockCount).where(and(
          eq(schema.feedStockCount.tenant_id, tenantId),
          eq(schema.feedStockCount.company_id, dto.companyId),
          eq(schema.feedStockCount.farm_id, dto.farmId),
          eq(schema.feedStockCount.counted_at, countedAt),
        )).limit(1).for('update');
      if (duplicate) throw new ConflictException('A physical count already exists for this farm occurrence.');

      // Monthly Stock Take (Brief C): the same count, tied to an existing, open Reporting Period.
      const monthly = dto.countType === 'MONTHLY';
      let period: typeof schema.reportingPeriod.$inferSelect | undefined;
      if (monthly) {
        [period] = dto.reportingPeriodId ? await this.db.select().from(schema.reportingPeriod).where(and(
          eq(schema.reportingPeriod.period_id, dto.reportingPeriodId),
          eq(schema.reportingPeriod.tenant_id, tenantId),
        )).limit(1) : [];
        if (period?.company_id && period.company_id !== dto.companyId) period = undefined;
        assertStockTakePeriod(period);
        assertStockTakeDate(period!, postingDate); // r35
      }

      const silos = await this.loadActiveSilos(dto.farmId, dto.companyId, tenantId, kind);
      const evidence = await this.ledger.getSiloStockEvidenceAsOf({
        companyId: dto.companyId,
        siloIds: silos.map((silo) => silo.location_id),
        postingDate,
        countedAtEpochSeconds: instant.epochSeconds,
      }, tenantId);
      const evidenceByPair = new Map(evidence.map((item) => [`${item.warehouse_id}:${item.item_id}`, item]));
      if (evidenceByPair.size !== evidence.length || evidenceByPair.size !== dto.lines.length
        || dto.lines.some((line) => !evidenceByPair.has(`${line.siloId}:${line.itemId}`))) {
        throw new BadRequestException('Provide exactly one counted quantity for every active silo/item ledger pair in this occurrence.');
      }

      const currency = await this.currencyEvidence(dto.companyId);
      const countId = randomUUID();
      const lineValues: Array<typeof schema.feedStockCountLine.$inferInsert> = [];
      for (const line of dto.lines) {
        const item = evidenceByPair.get(`${line.siloId}:${line.itemId}`)!;
        const fact = varianceFact(item.system_qty_kg, line.countedQtyKg, item.unit_cost_base, currency);
        const reasonId = await this.assertReason(fact, line.reasonId, tenantId, {
          companyId: dto.companyId, nobId: farm.nob_id, lobId: farm.lob_id,
        });
        lineValues.push({
          count_line_id: randomUUID(), count_id: countId, silo_id: line.siloId, item_id: line.itemId,
          system_qty_kg: String(fact.systemQty), counted_qty_kg: String(fact.countedQty),
          variance_qty_kg: String(fact.varianceQty), variance_pct_absolute: String(fact.variancePctAbsolute),
          reason_id: reasonId, unit_cost_base: fact.monetary.unitCostBase === null ? null : String(fact.monetary.unitCostBase),
          variance_value_base: fact.monetary.varianceValueBase === null ? null : String(fact.monetary.varianceValueBase),
          base_currency_id: fact.monetary.baseCurrencyId, local_currency_id: fact.monetary.localCurrencyId,
          rate_id: fact.monetary.rateId, rate_snapshot: fact.monetary.rateSnapshot,
          variance_value_local: fact.monetary.varianceValueLocal === null ? null : String(fact.monetary.varianceValueLocal),
          monetary_status: fact.monetary.status,
        });
      }

      const year = monthly ? Number(String(period!.stock_take_date ?? period!.end_date).slice(0, 4)) : 0;
      const prefix = monthly
        ? `ST-${kind === 'MILL' ? 'MILL' : (farm as { location_code?: string }).location_code ?? dto.farmId}-${year}-`
        : '';
      let count_no = this.countNo(dto.farmId, instant.epochSeconds);
      for (let attempt = 1; ; attempt += 1) {
        if (monthly) {
          // MAX of the sequence already issued under this prefix, not COUNT(*)+1: a deleted or concurrent take must not
          // hand out a number twice. The company-wide unique key on count_no is the backstop; a clash retries.
          const [{ n }] = await this.db.select({ n: sql<number | null>`MAX(CAST(SUBSTRING_INDEX(${schema.feedStockCount.count_no}, '-', -1) AS UNSIGNED))` })
            .from(schema.feedStockCount).where(and(
              eq(schema.feedStockCount.tenant_id, tenantId),
              eq(schema.feedStockCount.company_id, dto.companyId),
              eq(schema.feedStockCount.count_type, 'MONTHLY'),
              like(schema.feedStockCount.count_no, `${prefix}%`),
            ));
          count_no = stockTakeNo(kind === 'MILL' ? 'FEED_MILL' : 'FARM', (farm as { location_code?: string }).location_code ?? dto.farmId, year, Number(n ?? 0) + 1);
        }
        try {
          await this.db.insert(schema.feedStockCount).values({
            count_id: countId, count_no, tenant_id: tenantId, company_id: dto.companyId, farm_id: dto.farmId,
            counted_at: countedAt, schedule_source: dto.scheduleSource, status: 'DRAFT', created_by: creatorId,
            ...(monthly ? { count_type: 'MONTHLY', stock_take_type: kind === 'MILL' ? 'FEED_MILL' : 'FARM', reporting_period_id: period!.period_id } : {}),
          });
          break;
        } catch (error) {
          const clash = (error as { code?: string })?.code === 'ER_DUP_ENTRY';
          if (clash && monthly && attempt < 5 && String((error as { message?: string }).message).includes(NO_UNIQUE_KEY)) continue;
          if (clash) throw new ConflictException('A physical count already exists for this farm occurrence.');
          throw error;
        }
      }
      try {
        await this.db.insert(schema.feedStockCountLine).values(lineValues);
      } catch (error) {
        if ((error as { code?: string })?.code === 'ER_DUP_ENTRY') {
          throw new ConflictException('A physical count already exists for this farm occurrence.');
        }
        throw error;
      }
      return { count_id: countId, count_no, status: 'DRAFT' as const };
    });
  }

  async list(query: QueryFeedStockCountDto, tenantId: string) {
    await this.loadFarm(query.farmId, query.companyId, tenantId, false, 'EITHER');
    const conditions = [
      eq(schema.feedStockCount.tenant_id, tenantId), eq(schema.feedStockCount.company_id, query.companyId),
      eq(schema.feedStockCount.farm_id, query.farmId),
    ];
    if (query.status) conditions.push(eq(schema.feedStockCount.status, query.status));
    // count_type, stock_take_type and count_no are on the row itself; the period code comes from the Reporting Period.
    return this.db.select({ ...getTableColumns(schema.feedStockCount), period_code: schema.reportingPeriod.period_code })
      .from(schema.feedStockCount)
      .leftJoin(schema.reportingPeriod, eq(schema.reportingPeriod.period_id, schema.feedStockCount.reporting_period_id))
      .where(and(...conditions)).orderBy(desc(schema.feedStockCount.counted_at));
  }

  async findOne(countId: string, tenantId: string) {
    const [count] = await this.db.select().from(schema.feedStockCount).where(and(
      eq(schema.feedStockCount.count_id, countId), eq(schema.feedStockCount.tenant_id, tenantId),
    )).limit(1);
    if (!count) throw new NotFoundException('Feed stock count not found.');
    const place = await this.loadFarm(count.farm_id, count.company_id, tenantId, false, kindOfCount(count));
    const lines = await this.db.select({
      ...getTableColumns(schema.feedStockCountLine),
      silo_code: schema.locationMaster.location_code,
      silo_name: schema.locationMaster.location_name,
      silo_capacity_kg: schema.locationMaster.silo_capacity_kg,
      item_code: schema.itemMaster.item_code,
      item_name: schema.itemMaster.item_name,
      reason_name: schema.reasonMaster.reason_name,
    }).from(schema.feedStockCountLine)
      .innerJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.feedStockCountLine.silo_id))
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, schema.feedStockCountLine.item_id))
      .leftJoin(schema.reasonMaster, eq(schema.reasonMaster.reason_id, schema.feedStockCountLine.reason_id))
      .where(eq(schema.feedStockCountLine.count_id, countId))
      .orderBy(schema.feedStockCountLine.silo_id, schema.feedStockCountLine.item_id);
    const context = await this.siloContext(count.farm_id, count.company_id, tenantId, [...new Set(lines.map((line) => line.silo_id))], kindOfCount(count));
    return {
      ...count,
      ...(await this.reconciliationEvidence(count)),
      farm_code: place.location_code,
      planningDate: context.planningDate,
      lines: lines.map((line) => ({
        ...line,
        capacityKg: line.silo_capacity_kg == null ? null : Number(line.silo_capacity_kg),
        houses: context.housesOf(line.silo_id),
        ...context.planningOf(line.silo_id),
      })),
    };
  }

  /**
   * Workbook r35, r47-r49: the Stock Take Date and the period it reconciles, the period's status after
   * reconciliation, the next production start, and the journal(s) the posting created. The count keeps only
   * its first adjustment id, so the journals are found the way the adjustments are named: by the count's
   * remarks on each stock adjustment, then by the adjustment number each journal was posted for.
   */
  private async reconciliationEvidence(count: typeof schema.feedStockCount.$inferSelect) {
    let periodFacts: Record<string, string | null> = {};
    if (count.reporting_period_id) {
      const [period] = await this.db.select({
        period_code: schema.reportingPeriod.period_code, period_status: schema.reportingPeriod.period_status,
        stock_take_date: schema.reportingPeriod.stock_take_date, production_start_date: schema.reportingPeriod.production_start_date,
      }).from(schema.reportingPeriod).where(eq(schema.reportingPeriod.period_id, count.reporting_period_id)).limit(1);
      if (period) {
        periodFacts = {
          period_code: period.period_code, period_status_after: period.period_status,
          stock_take_date: period.stock_take_date, production_start_date_next: period.production_start_date,
        };
      }
    }
    let glRefs: string[] | null = null;
    if (count.status === 'POSTED') {
      const adjustments = await this.db.select({ adjustment_no: schema.stockAdjustment.adjustment_no })
        .from(schema.stockAdjustment).where(and(
          eq(schema.stockAdjustment.tenant_id, count.tenant_id),
          eq(schema.stockAdjustment.company_id, count.company_id),
          like(schema.stockAdjustment.remarks, `Physical count ${count.count_no} (${count.count_id})%`),
        ));
      if (adjustments.length) {
        const journals = await this.db.select({ journal_no: schema.journalHeader.journal_no })
          .from(schema.journalHeader).where(and(
            eq(schema.journalHeader.tenant_id, count.tenant_id),
            eq(schema.journalHeader.source_document_type, 'STOCK_ADJUSTMENT'),
            inArray(schema.journalHeader.source_document_no, adjustments.map((a) => a.adjustment_no)),
          ));
        glRefs = [...new Set(journals.map((j) => j.journal_no))];
      }
    }
    return { ...periodFacts, gl_entry_refs: glRefs && glRefs.length ? glRefs : null };
  }

  private async mutableCount(countId: string, tenantId: string) {
    const [count] = await this.db.select().from(schema.feedStockCount).where(and(
      eq(schema.feedStockCount.count_id, countId), eq(schema.feedStockCount.tenant_id, tenantId),
    )).limit(1).for('update');
    if (!count) throw new NotFoundException('Feed stock count not found.');
    const farm = await this.loadFarm(count.farm_id, count.company_id, tenantId, false, kindOfCount(count));
    if (!EDITABLE_STATUSES.includes(count.status as EditableStatus)) {
      throw new BadRequestException('Only a draft or rejected physical count may be corrected or submitted.');
    }
    return { count, farm };
  }

  async update(countId: string, dto: UpdateFeedStockCountDto, tenantId: string, actor?: Actor) {
    if (!actor?.userId) throw new UnauthorizedException('An authenticated editor is required.');
    const editorId = actor.userId;
    const ids = new Set<string>();
    for (const line of dto.lines) {
      if (ids.has(line.countLineId)) throw new ConflictException('A count line may be edited only once per request.');
      ids.add(line.countLineId);
    }
    return withTenantTransaction(this.cls, async () => {
      const { count, farm } = await this.mutableCount(countId, tenantId);
      const updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const stored = await this.db.select().from(schema.feedStockCountLine)
        .where(eq(schema.feedStockCountLine.count_id, countId));
      for (const change of dto.lines) {
        const line = stored.find((entry) => entry.count_line_id === change.countLineId);
        if (!line) throw new BadRequestException('The selected line does not belong to this count.');
        const rate = line.rate_snapshot as RateEvidence | null;
        if (!rate) throw new BadRequestException('The count line is missing its rate evidence snapshot.');
        const fact = varianceFact(Number(line.system_qty_kg), change.countedQtyKg,
          line.unit_cost_base === null ? null : Number(line.unit_cost_base), {
            baseCurrencyId: line.base_currency_id, localCurrencyId: line.local_currency_id, rate,
          });
        const reasonId = await this.assertReason(fact, change.reasonId, tenantId, {
          companyId: count.company_id, nobId: farm.nob_id, lobId: farm.lob_id,
        });
        await this.db.update(schema.feedStockCountLine).set({
          counted_qty_kg: String(fact.countedQty), variance_qty_kg: String(fact.varianceQty),
          variance_pct_absolute: String(fact.variancePctAbsolute), reason_id: reasonId,
          unit_cost_base: fact.monetary.unitCostBase === null ? null : String(fact.monetary.unitCostBase),
          variance_value_base: fact.monetary.varianceValueBase === null ? null : String(fact.monetary.varianceValueBase),
          rate_id: fact.monetary.rateId, rate_snapshot: fact.monetary.rateSnapshot,
          variance_value_local: fact.monetary.varianceValueLocal === null ? null : String(fact.monetary.varianceValueLocal),
          monetary_status: fact.monetary.status,
          updated_at: updatedAt,
        }).where(and(
          eq(schema.feedStockCountLine.count_line_id, change.countLineId),
          eq(schema.feedStockCountLine.count_id, countId),
        ));
      }
      await this.db.update(schema.feedStockCount).set({ updated_by: editorId, updated_at: updatedAt })
        .where(eq(schema.feedStockCount.count_id, countId));
      return { count_id: count.count_id, status: 'DRAFT' as const };
    });
  }

  async submit(countId: string, tenantId: string, actor?: Actor) {
    if (!actor?.userId) throw new UnauthorizedException('An authenticated submitter is required.');
    const submitterId = actor.userId;
    return withTenantTransaction(this.cls, async () => {
      const { count, farm } = await this.mutableCount(countId, tenantId);
      const lines = await this.db.select().from(schema.feedStockCountLine)
        .where(eq(schema.feedStockCountLine.count_id, countId));
      if (!lines.length) throw new BadRequestException('A physical count requires at least one line.');
      for (const line of lines) {
        if (Number(line.variance_qty_kg) !== 0) {
          if (!line.reason_id) throw new BadRequestException('Every nonzero variance requires a Reason Master row before submission.');
          await this.reasons.findActiveForOperationalScope(line.reason_id, tenantId, {
            companyId: count.company_id, nobId: farm.nob_id, lobId: farm.lob_id,
          });
        } else if (line.reason_id) {
          throw new BadRequestException('Zero variance must not carry a reason.');
        }
      }
      const effective = await this.resolveSettings(count.company_id, count.farm_id, kindOfCount(count));
      // Surfaces whether Finance escalation is even evaluable *before* the count
      // reaches an approver, rather than leaving the decision to fail later.
      approvalRoute(lines.map((line) => routeEvidence(line)), {
        percentageThreshold: effective.financeVariancePct,
        amountThreshold: effective.financeVarianceAmount,
      });
      const requestId = await this.approvals.submitFarmDocument({
        documentType: FEED_STOCK_COUNT_APPROVAL_DOC_TYPE,
        documentId: count.count_id,
        documentNo: count.count_no,
        farmId: count.farm_id,
        companyId: count.company_id,
        title: `Physical count ${count.count_no}`,
        itemOrStage: 'Feed stock count',
        uom: 'KG',
      }, tenantId, actor);
      const submittedAt = nowTs();
      await this.db.update(schema.feedStockCount).set({
        status: 'PENDING_APPROVAL', approval_request_id: requestId,
        submitted_by: submitterId, submitted_at: submittedAt,
        updated_by: submitterId, updated_at: submittedAt,
      }).where(and(
        eq(schema.feedStockCount.count_id, countId),
        inArray(schema.feedStockCount.status, ['DRAFT', 'REJECTED']),
      ));
      return { count_id: count.count_id, status: 'PENDING_APPROVAL' as const, approval_request_id: requestId, submitted_at: submittedAt };
    });
  }

  private async routeFor(count: typeof schema.feedStockCount.$inferSelect, tenantId: string): Promise<'FINANCE' | 'FARM_MANAGER'> {
    const lines = await this.db.select().from(schema.feedStockCountLine)
      .where(eq(schema.feedStockCountLine.count_id, count.count_id));
    const effective = await this.resolveSettings(count.company_id, count.farm_id, kindOfCount(count));
    return approvalRoute(lines.map((line) => routeEvidence(line)), {
      percentageThreshold: effective.financeVariancePct,
      amountThreshold: effective.financeVarianceAmount,
    });
  }

  /** D25: the count, locked, still waiting on this exact request. */
  private async lockForDecision(countId: string, tenantId: string) {
    const [count] = await this.db.select().from(schema.feedStockCount).where(and(
      eq(schema.feedStockCount.count_id, countId), eq(schema.feedStockCount.tenant_id, tenantId),
    )).limit(1).for('update');
    if (!count) throw new NotFoundException('Feed stock count not found.');
    if (count.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Physical count ${count.count_no} is ${count.status.toLowerCase()} and is not waiting for a decision.`);
    }
    return count;
  }

  private async assertMayDecide(user: UserCtx, route: 'FINANCE' | 'FARM_MANAGER'): Promise<void> {
    const required: RequiredPermission = route === 'FINANCE'
      ? { moduleCode: 'FINANCE', resource: 'STOCK_VARIANCE', action: 'approve' }
      : { moduleCode: 'INVENTORY', resource: 'STOCK_COUNT', action: 'approve' };
    const may = await userHasPermission(this.db, user, required);
    if (!may) throw new ForbiddenException(route === 'FINANCE'
      ? 'This physical count carries a stock variance that requires Finance approval.'
      : 'You are not allowed to approve physical counts.');
  }

  private async decideFromApproval(
    request: ApprovalRequestRow,
    decision: 'APPROVED' | 'REJECTED',
    remarks: string | null,
    tenantId: string,
    user: UserCtx,
  ) {
    if (!request.document_id) throw new BadRequestException('This approval request does not name a physical count.');
    const count = await this.lockForDecision(request.document_id, tenantId);
    // Rishi, 7 Oct: Tenant Admin may approve anything in their tenant,
    // including a physical count they submitted. Other user types retain the
    // maker/checker rule; the route-specific permission check below still
    // applies to everyone and the approval engine still enforces scope.
    if (request.requested_by && user?.userId === request.requested_by && user?.userType !== 'TENANT_ADMIN') {
      throw new ForbiddenException('You may not decide your own physical count. Withdraw it instead.');
    }
    const route = await this.routeFor(count, tenantId);
    await this.assertMayDecide(user, route);
    if (decision === 'REJECTED') {
      if (!remarks?.trim()) throw new BadRequestException('A rejection reason is required.');
      await this.db.update(schema.feedStockCount).set({
        status: 'REJECTED', updated_by: user?.userId ?? null, updated_at: nowTs(),
      }).where(eq(schema.feedStockCount.count_id, count.count_id));
      return;
    }
    const approvedAt = nowTs();
    await this.db.update(schema.feedStockCount).set({
      status: 'APPROVED', approved_by: user?.userId ?? null, approved_at: approvedAt,
      updated_by: user?.userId ?? null, updated_at: approvedAt,
    }).where(eq(schema.feedStockCount.count_id, count.count_id));
  }

  /** A withdrawn request hands the count back to the farm as a draft. */
  private async withdrawFromApproval(request: ApprovalRequestRow, tenantId: string, user: UserCtx) {
    if (!request.document_id) return;
    const [count] = await this.db.select().from(schema.feedStockCount).where(and(
      eq(schema.feedStockCount.count_id, request.document_id), eq(schema.feedStockCount.tenant_id, tenantId),
    )).limit(1).for('update');
    if (!count || count.status !== 'PENDING_APPROVAL') return;
    await this.db.update(schema.feedStockCount).set({
      status: 'DRAFT', approval_request_id: null, updated_by: user?.userId ?? null, updated_at: nowTs(),
    }).where(eq(schema.feedStockCount.count_id, count.count_id));
  }

  /**
   * Task 6: the approved count becomes real stock. One stock adjustment per
   * silo, because `stock_adjustment` carries a single non-null warehouse and
   * every line of an adjustment posts to that warehouse — a multi-silo count
   * written as one document would put all of it in one silo. All adjustments
   * are created and posted inside one tenant transaction, so an inventory or GL
   * failure leaves the count APPROVED with nothing posted, and the successful
   * call is idempotent.
   */
  async postApprovedCount(countId: string, tenantId: string, actor?: Actor) {
    if (!actor?.userId) throw new UnauthorizedException('An authenticated poster is required.');
    const posterId = actor.userId;
    const result = await withTenantTransaction(this.cls, async () => {
      const [count] = await this.db.select().from(schema.feedStockCount).where(and(
        eq(schema.feedStockCount.count_id, countId), eq(schema.feedStockCount.tenant_id, tenantId),
      )).limit(1).for('update');
      if (!count) throw new NotFoundException('Feed stock count not found.');
      await this.loadFarm(count.farm_id, count.company_id, tenantId, false, kindOfCount(count));
      if (count.status === 'POSTED') {
        return {
          count_id: count.count_id, status: 'POSTED' as const, already_posted: true,
          stock_adjustment_id: count.stock_adjustment_id, stock_adjustment_ids: [] as string[],
          farm_id: count.farm_id, company_id: count.company_id, kind: kindOfCount(count),
        };
      }
      if (count.status !== 'APPROVED') {
        throw new BadRequestException('Only an approved physical count may be posted.');
      }
      const lines = await this.db.select().from(schema.feedStockCountLine)
        .where(eq(schema.feedStockCountLine.count_id, countId));
      const variance = lines.filter((line) => Number(line.variance_qty_kg) !== 0);
      for (const line of variance) {
        if (Number(line.variance_qty_kg) > 0 && line.unit_cost_base === null) {
          throw new BadRequestException(
            `Silo ${line.silo_id} holds item ${line.item_id} with no cost evidence in the count snapshot, so found stock cannot be valued. `
            + 'Configure the item cost before posting this count.',
          );
        }
      }
      const effective = await this.resolveSettings(count.company_id, count.farm_id, kindOfCount(count));
      const postingDate = this.postingDate(utcInstant(count.counted_at), effective.timezoneId);
      const bySilo = new Map<string, typeof variance>();
      for (const line of variance) {
        bySilo.set(line.silo_id, [...(bySilo.get(line.silo_id) ?? []), line]);
      }
      const created: string[] = [];
      for (const siloId of [...bySilo.keys()].sort()) {
        const group = bySilo.get(siloId)!;
        const adjustment = await this.adjustments.create({
          company_id: count.company_id,
          warehouse_id: siloId,
          posting_date: postingDate,
          reason: `Physical count variance ${count.count_no}`,
          // Ruling (Task 6): a count spans every active farm silo but
          // feed_stock_count carries one adjustment FK, so each document names
          // the count and the whole set stays recoverable from any of them.
          remarks: `Physical count ${count.count_no} (${count.count_id})`,
          lines: group.map((line) => ({
            item_id: line.item_id,
            quantity: Number(line.variance_qty_kg),
            uom: 'KG',
            rate: Number(line.unit_cost_base),
            remarks: line.reason_id ?? undefined,
          })),
        }, tenantId, actor);
        await this.adjustments.post(adjustment.adjustment_id, tenantId, actor);
        created.push(adjustment.adjustment_id);
      }
      const postedAt = nowTs();
      await this.db.update(schema.feedStockCount).set({
        status: 'POSTED', stock_adjustment_id: created[0] ?? null,
        posted_by: posterId, posted_at: postedAt, updated_by: posterId, updated_at: postedAt,
      }).where(and(
        eq(schema.feedStockCount.count_id, countId),
        eq(schema.feedStockCount.status, 'APPROVED'),
      ));
      return {
        count_id: count.count_id, status: 'POSTED' as const, already_posted: false,
        stock_adjustment_id: created[0] ?? null, stock_adjustment_ids: created,
        farm_id: count.farm_id, company_id: count.company_id, kind: kindOfCount(count),
      };
    });
    // After the transaction commits, and never able to fail it: the posted
    // variance changed silo stock, so the feed alerts and any forecast the
    // farm is looking at must be re-read. Existing runs stay immutable — the
    // farm raises a new run version rather than us rewriting one.
    if (!result.already_posted && result.kind === 'FARM') {
      await this.feedAlerts.evaluateFarmSafely(result.farm_id, result.company_id, tenantId);
    }
    return result;
  }
}
