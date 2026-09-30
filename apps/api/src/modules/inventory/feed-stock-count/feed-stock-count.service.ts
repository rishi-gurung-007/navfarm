import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { randomUUID } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import { farmScope } from '../../../common/farm-scope';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import * as schema from '../../../core/database/schema';
import { ReasonService } from '../../master-data/reason/reason.service';
import { CurrencyService } from '../../system/currency/currency.service';
import { FeedSettingsService } from '../feed-settings/feed-settings.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import {
  CreateFeedStockCountDto, QueryFeedStockCountDto, UpdateFeedStockCountDto,
} from './dto/feed-stock-count.dto';
import { assertVarianceReason, RateEvidence, varianceFact, VarianceFact } from './feed-stock-count.rules';

type Actor = { userId?: string; userType?: string } | undefined;

const mysqlTimestamp = (value: string): string => new Date(value).toISOString().slice(0, 19).replace('T', ' ');
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

@Injectable()
export class FeedStockCountService {
  constructor(
    private readonly cls: ClsService,
    private readonly ledger: InventoryLedgerService,
    private readonly settings: FeedSettingsService,
    private readonly currency: CurrencyService,
    private readonly reasons: ReasonService,
  ) {}

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

  private async loadFarm(farmId: string, companyId: string, tenantId: string, lock = false) {
    this.assertRequestedScope(companyId, farmId);
    const scope = farmScope(this.cls);
    const query = this.db.select({
      location_id: schema.locationMaster.location_id,
      company_id: schema.locationMaster.company_id,
      lob_id: schema.locationMaster.lob_id,
    }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.location_id, farmId),
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.company_id, companyId),
      eq(schema.locationMaster.location_type, 'FARM'),
      isNull(schema.locationMaster.parent_location_id),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
      ...(scope.restricted && scope.lobId ? [eq(schema.locationMaster.lob_id, scope.lobId)] : []),
    )).limit(1);
    const [farm] = lock ? await query.for('update') : await query;
    if (!farm || farm.company_id !== companyId || (scope.restricted && scope.lobId && farm.lob_id !== scope.lobId)) {
      throw new NotFoundException('Farm not found.');
    }
    return farm;
  }

  private async loadSilo(siloId: string, farmId: string, companyId: string, tenantId: string) {
    const scope = farmScope(this.cls);
    const [silo] = await this.db.select({
      location_id: schema.locationMaster.location_id,
      company_id: schema.locationMaster.company_id,
      lob_id: schema.locationMaster.lob_id,
      farm_id: schema.locationMaster.farm_id,
      parent_location_id: schema.locationMaster.parent_location_id,
      location_type: schema.locationMaster.location_type,
      is_active: schema.locationMaster.is_active,
      deleted_at: schema.locationMaster.deleted_at,
    }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.location_id, siloId),
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.company_id, companyId),
      eq(schema.locationMaster.farm_id, farmId),
      eq(schema.locationMaster.parent_location_id, farmId),
      eq(schema.locationMaster.location_type, 'SILO'),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
      ...(scope.restricted && scope.lobId ? [eq(schema.locationMaster.lob_id, scope.lobId)] : []),
    )).limit(1);
    if (!silo || silo.company_id !== companyId || silo.farm_id !== farmId || silo.parent_location_id !== farmId || silo.location_type !== 'SILO'
      || !silo.is_active || silo.deleted_at || (scope.restricted && scope.lobId && silo.lob_id !== scope.lobId)) {
      throw new BadRequestException('Select an active SILO belonging to the authorized farm.');
    }
    return silo;
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
    if (!local?.currency_id) return {
      baseCurrencyId: company.base_currency_id,
      localCurrencyId: null,
      rate: { status: 'MISSING_LOCAL_CURRENCY' as const, companyId, baseCurrencyId: company.base_currency_id },
    };
    const rate = await this.currency.currentRate(companyId, company.base_currency_id, local.currency_id);
    return { baseCurrencyId: company.base_currency_id, localCurrencyId: local.currency_id, rate };
  }

  private async assertReason(fact: VarianceFact, reasonId: string | null | undefined, tenantId: string): Promise<string | null> {
    assertVarianceReason(fact, reasonId);
    if (!fact.reasonRequired) return null;
    if (!reasonId) throw new BadRequestException('A Reason Master row is required for this variance.');
    const reason = await this.reasons.findOne(reasonId, tenantId);
    if (!reason.is_active) throw new BadRequestException('Select an active Reason Master row visible in this workspace.');
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

  private countNo(farmId: string, countedAt: string): string {
    return `FSC-${farmId}-${countedAt.replace(/[-: ]/g, '')}`;
  }

  async create(dto: CreateFeedStockCountDto, tenantId: string, actor?: Actor) {
    if (!actor?.userId) throw new UnauthorizedException('An authenticated creator is required.');
    const creatorId = actor.userId;
    this.assertRequestedScope(dto.companyId, dto.farmId);
    const countedAt = mysqlTimestamp(dto.countedAt);
    const duplicateKeys = new Set<string>();
    for (const line of dto.lines) {
      const key = `${line.siloId}:${line.itemId}`;
      if (duplicateKeys.has(key)) throw new ConflictException('A silo/item may appear only once in a physical count.');
      duplicateKeys.add(key);
    }
    const effective = await this.settings.resolve(dto.companyId, dto.farmId);
    if (dto.scheduleSource === 'SCHEDULED') this.assertScheduledOccurrence(dto.countedAt, effective);

    return withTenantTransaction(this.cls, async () => {
      await this.loadFarm(dto.farmId, dto.companyId, tenantId, true);
      const [duplicate] = await this.db.select({ count_id: schema.feedStockCount.count_id })
        .from(schema.feedStockCount).where(and(
          eq(schema.feedStockCount.tenant_id, tenantId),
          eq(schema.feedStockCount.company_id, dto.companyId),
          eq(schema.feedStockCount.farm_id, dto.farmId),
          eq(schema.feedStockCount.counted_at, countedAt),
        )).limit(1).for('update');
      if (duplicate) throw new ConflictException('A physical count already exists for this farm occurrence.');

      const currency = await this.currencyEvidence(dto.companyId);
      const countId = randomUUID();
      const lineValues: Array<typeof schema.feedStockCountLine.$inferInsert> = [];
      for (const line of dto.lines) {
        await this.loadSilo(line.siloId, dto.farmId, dto.companyId, tenantId);
        const evidence = await this.ledger.getSiloStockEvidenceAsOf({
          companyId: dto.companyId, siloId: line.siloId, countedAt,
        }, tenantId);
        const item = evidence.find((entry) => entry.item_id === line.itemId);
        if (!item) throw new BadRequestException('The selected item has no ledger evidence in this silo at the count timestamp.');
        const fact = varianceFact(item.system_qty_kg, line.countedQtyKg, item.unit_cost_base, currency);
        const reasonId = await this.assertReason(fact, line.reasonId, tenantId);
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

      const count_no = this.countNo(dto.farmId, countedAt);
      await this.db.insert(schema.feedStockCount).values({
        count_id: countId, count_no, tenant_id: tenantId, company_id: dto.companyId, farm_id: dto.farmId,
        counted_at: countedAt, schedule_source: dto.scheduleSource, status: 'DRAFT', created_by: creatorId,
      });
      await this.db.insert(schema.feedStockCountLine).values(lineValues);
      return { count_id: countId, count_no, status: 'DRAFT' as const };
    });
  }

  async list(query: QueryFeedStockCountDto, tenantId: string) {
    await this.loadFarm(query.farmId, query.companyId, tenantId);
    const conditions = [
      eq(schema.feedStockCount.tenant_id, tenantId), eq(schema.feedStockCount.company_id, query.companyId),
      eq(schema.feedStockCount.farm_id, query.farmId),
    ];
    if (query.status) conditions.push(eq(schema.feedStockCount.status, query.status));
    return this.db.select().from(schema.feedStockCount).where(and(...conditions)).orderBy(desc(schema.feedStockCount.counted_at));
  }

  async findOne(countId: string, tenantId: string) {
    const [count] = await this.db.select().from(schema.feedStockCount).where(and(
      eq(schema.feedStockCount.count_id, countId), eq(schema.feedStockCount.tenant_id, tenantId),
    )).limit(1);
    if (!count) throw new NotFoundException('Feed stock count not found.');
    await this.loadFarm(count.farm_id, count.company_id, tenantId);
    const lines = await this.db.select().from(schema.feedStockCountLine)
      .where(eq(schema.feedStockCountLine.count_id, countId))
      .orderBy(schema.feedStockCountLine.silo_id, schema.feedStockCountLine.item_id);
    return { ...count, lines };
  }

  private async mutableCount(countId: string, tenantId: string) {
    const [count] = await this.db.select().from(schema.feedStockCount).where(and(
      eq(schema.feedStockCount.count_id, countId), eq(schema.feedStockCount.tenant_id, tenantId),
    )).limit(1).for('update');
    if (!count) throw new NotFoundException('Feed stock count not found.');
    await this.loadFarm(count.farm_id, count.company_id, tenantId);
    if (count.status !== 'DRAFT') throw new BadRequestException('Only a draft physical count may be edited or submitted.');
    return count;
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
      const count = await this.mutableCount(countId, tenantId);
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
        const reasonId = await this.assertReason(fact, change.reasonId, tenantId);
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
      const count = await this.mutableCount(countId, tenantId);
      const lines = await this.db.select().from(schema.feedStockCountLine)
        .where(eq(schema.feedStockCountLine.count_id, countId));
      if (!lines.length) throw new BadRequestException('A physical count requires at least one line.');
      for (const line of lines) {
        if (Number(line.variance_qty_kg) !== 0) {
          if (!line.reason_id) throw new BadRequestException('Every nonzero variance requires a Reason Master row before submission.');
          const reason = await this.reasons.findOne(line.reason_id, tenantId);
          if (!reason.is_active) throw new BadRequestException('Every variance reason must remain active and visible at submission.');
        }
      }
      const submittedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await this.db.update(schema.feedStockCount).set({
        status: 'PENDING_APPROVAL', submitted_by: submitterId, submitted_at: submittedAt,
        updated_by: submitterId, updated_at: submittedAt,
      }).where(and(eq(schema.feedStockCount.count_id, countId), eq(schema.feedStockCount.status, 'DRAFT')));
      return { count_id: count.count_id, status: 'PENDING_APPROVAL' as const, submitted_at: submittedAt };
    });
  }
}
