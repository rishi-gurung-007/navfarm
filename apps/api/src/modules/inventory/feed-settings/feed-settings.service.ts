import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { assertLobInScope, farmScope } from '../../../common/farm-scope';
import { UpdateCompanyFeedSettingsDto, UpdateFarmFeedSettingsDto } from './dto/feed-settings.dto';
import { resolvePlanningRules } from './feed-settings.rules';

@Injectable()
export class FeedSettingsService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  async resolve(companyId: string, farmId?: string) {
    const scope = farmScope(this.cls);
    if (scope.companyId && scope.companyId !== companyId) throw new ForbiddenException('Not authorized for this company.');
    if (scope.farmId && farmId && scope.farmId !== farmId) throw new ForbiddenException('Not authorized for this farm.');
    const effectiveFarmId = farmId ?? scope.farmId ?? undefined;
    const [company] = await this.db.select({
      company_id: schema.companyMaster.company_id,
      default_timezone_id: schema.companyMaster.default_timezone_id,
    }).from(schema.companyMaster).where(eq(schema.companyMaster.company_id, companyId)).limit(1);
    if (!company) throw new NotFoundException(`Company '${companyId}' not found.`);

    const settings = await this.db.select().from(schema.feedPlanningSetting).where(and(
      eq(schema.feedPlanningSetting.company_id, companyId),
      eq(schema.feedPlanningSetting.is_active, true),
    ));
    const companySetting = settings.find((row) => row.farm_id === null) ?? null;
    const farmSetting = effectiveFarmId ? settings.find((row) => row.farm_id === effectiveFarmId) ?? null : null;

    let farm: { location_id: string; company_id: string | null; lob_id: string | null } | undefined;
    if (effectiveFarmId) {
      [farm] = await this.db.select({
        location_id: schema.locationMaster.location_id,
        company_id: schema.locationMaster.company_id,
        lob_id: schema.locationMaster.lob_id,
      }).from(schema.locationMaster).where(and(
        eq(schema.locationMaster.location_id, effectiveFarmId),
        eq(schema.locationMaster.location_type, 'FARM'),
      )).limit(1);
      if (!farm || farm.company_id !== companyId) throw new NotFoundException(`Farm '${effectiveFarmId}' is not part of company '${companyId}'.`);
      assertLobInScope(scope, farm.lob_id);
    }

    const effective = resolvePlanningRules(companySetting);
    const hasFarmSubmission = farmSetting?.submission_weekday !== null && farmSetting?.submission_weekday !== undefined
      || farmSetting?.submission_time !== null && farmSetting?.submission_time !== undefined;
    if (farmSetting?.submission_weekday !== null && farmSetting?.submission_weekday !== undefined) {
      effective.submissionWeekday = resolvePlanningRules({ submission_weekday: farmSetting.submission_weekday }).submissionWeekday;
    }
    if (farmSetting?.submission_time !== null && farmSetting?.submission_time !== undefined) {
      effective.submissionTime = resolvePlanningRules({ submission_time: farmSetting.submission_time }).submissionTime;
    }

    // A farm row may override the logistics values (spec 2026-10-03 §3.2); a null field inherits the company's.
    const LOGISTICS = ['safety_stock_kg', 'bag_size_kg', 'bulk_multiple_kg', 'truck_target_kg', 'production_weekday'] as const;
    const farmLogistics = farmSetting
      ? Object.fromEntries(LOGISTICS.filter((k) => farmSetting[k] !== null && farmSetting[k] !== undefined).map((k) => [k, farmSetting[k]]))
      : {};
    const hasFarmLogistics = Object.keys(farmLogistics).length > 0;
    if (hasFarmLogistics) {
      const merged = resolvePlanningRules({ ...(companySetting ?? {}), ...farmLogistics });
      effective.safetyStockKg = merged.safetyStockKg;
      effective.bagSizeKg = merged.bagSizeKg;
      effective.bulkMultipleKg = merged.bulkMultipleKg;
      effective.truckTargetKg = merged.truckTargetKg;
      effective.productionWeekday = merged.productionWeekday;
    }

    return {
      companyId,
      farmId: effectiveFarmId ?? null,
      timezoneId: company.default_timezone_id,
      ...effective,
      sources: {
        logistics: hasFarmLogistics ? 'FARM' as const : companySetting ? 'COMPANY' as const : 'SYSTEM' as const,
        submissionSchedule: hasFarmSubmission ? 'FARM' as const : companySetting ? 'COMPANY' as const : 'SYSTEM' as const,
        companySetting: companySetting ? 'COMPANY' as const : 'SYSTEM' as const,
      },
    };
  }

  async saveCompany(companyId: string, dto: UpdateCompanyFeedSettingsDto, tenantId: string, actorId?: string) {
    const scope = farmScope(this.cls);
    if (scope.restricted || scope.farmId) throw new ForbiddenException('Operationally scoped users cannot change company feed settings.');
    const current = await this.resolve(companyId);
    const candidate = {
      default_forecast_days: dto.defaultForecastDays ?? current.defaultForecastDays,
      max_forecast_days: dto.maxForecastDays ?? current.maxForecastDays,
      production_weekday: dto.productionWeekday === undefined ? current.productionWeekday : dto.productionWeekday,
      production_shift: dto.productionShift === undefined ? current.productionShift : dto.productionShift,
      submission_weekday: dto.submissionWeekday === undefined ? current.submissionWeekday : dto.submissionWeekday,
      submission_time: dto.submissionTime === undefined ? current.submissionTime : dto.submissionTime,
      reminder_weekday: dto.reminderWeekday === undefined ? current.reminderWeekday : dto.reminderWeekday,
      reminder_time: dto.reminderTime === undefined ? current.reminderTime : dto.reminderTime,
      physical_count_weekday: dto.physicalCountWeekday === undefined ? current.physicalCountWeekday : dto.physicalCountWeekday,
      physical_count_time: dto.physicalCountTime === undefined ? current.physicalCountTime : dto.physicalCountTime,
      truck_target_kg: dto.truckTargetKg === undefined ? current.truckTargetKg : dto.truckTargetKg,
      bulk_multiple_kg: dto.bulkMultipleKg === undefined ? current.bulkMultipleKg : dto.bulkMultipleKg,
      safety_stock_kg: dto.safetyStockKg ?? current.safetyStockKg,
      bag_size_kg: dto.bagSizeKg === undefined ? current.bagSizeKg : dto.bagSizeKg,
      capacity_warning_pct: dto.capacityWarningPct ?? current.capacityWarningPct,
      bag_tolerance_pct: dto.bagTolerancePct === undefined ? current.bagTolerancePct : dto.bagTolerancePct,
      finance_variance_pct: dto.financeVariancePct ?? current.financeVariancePct,
      finance_variance_amount: dto.financeVarianceAmount === undefined ? current.financeVarianceAmount : dto.financeVarianceAmount,
    };
    resolvePlanningRules(candidate);
    if (!tenantId) throw new BadRequestException('Tenant context is required to save feed settings.');

    const databaseValues = {
      ...candidate,
      truck_target_kg: candidate.truck_target_kg === null ? null : String(candidate.truck_target_kg),
      bulk_multiple_kg: candidate.bulk_multiple_kg === null ? null : String(candidate.bulk_multiple_kg),
      safety_stock_kg: String(candidate.safety_stock_kg),
      bag_size_kg: candidate.bag_size_kg === null ? null : String(candidate.bag_size_kg),
      capacity_warning_pct: String(candidate.capacity_warning_pct),
      bag_tolerance_pct: candidate.bag_tolerance_pct === null ? null : String(candidate.bag_tolerance_pct),
      finance_variance_pct: String(candidate.finance_variance_pct),
      finance_variance_amount: candidate.finance_variance_amount === null ? null : String(candidate.finance_variance_amount),
      updated_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
      updated_by: actorId ?? null,
    };
    await this.db.insert(schema.feedPlanningSetting).values({
      setting_id: randomUUID(), tenant_id: tenantId, company_id: companyId, farm_id: null,
      ...databaseValues, created_by: actorId ?? null,
    }).onDuplicateKeyUpdate({ set: databaseValues });
    return this.resolve(companyId);
  }

  /** A farm's override row: only what the farm sets is stored; null fields inherit the company row. */
  async saveFarm(companyId: string, farmId: string, dto: Omit<UpdateFarmFeedSettingsDto, 'farmId' | 'companyId'>, tenantId: string, actorId?: string) {
    const scope = farmScope(this.cls);
    if (scope.restricted || scope.farmId) throw new ForbiddenException('Operationally scoped users cannot change farm feed settings.');
    if (!tenantId) throw new BadRequestException('Tenant context is required to save feed settings.');
    await this.resolve(companyId, farmId); // the farm must belong to the company
    const [existing] = await this.db.select().from(schema.feedPlanningSetting).where(and(
      eq(schema.feedPlanningSetting.company_id, companyId),
      eq(schema.feedPlanningSetting.farm_id, farmId),
      eq(schema.feedPlanningSetting.is_active, true),
    )).limit(1);
    // undefined keeps the farm's current override; null clears it (the farm inherits the company value).
    const num = (value: number | null | undefined, current: string | number | null | undefined): number | null =>
      value !== undefined ? value : current === null || current === undefined ? null : Number(current);
    const candidate = {
      safety_stock_kg: num(dto.safetyStockKg, existing?.safety_stock_kg),
      bag_size_kg: num(dto.bagSizeKg, existing?.bag_size_kg),
      bulk_multiple_kg: num(dto.bulkMultipleKg, existing?.bulk_multiple_kg),
      truck_target_kg: num(dto.truckTargetKg, existing?.truck_target_kg),
      production_weekday: num(dto.productionWeekday, existing?.production_weekday),
      submission_weekday: num(dto.submissionWeekday, existing?.submission_weekday),
      submission_time: dto.submissionTime !== undefined ? dto.submissionTime : existing?.submission_time ?? null,
    };
    resolvePlanningRules(candidate);
    const decimal = (v: number | null) => (v === null ? null : String(v));
    const databaseValues = {
      ...candidate,
      safety_stock_kg: decimal(candidate.safety_stock_kg),
      bag_size_kg: decimal(candidate.bag_size_kg),
      bulk_multiple_kg: decimal(candidate.bulk_multiple_kg),
      truck_target_kg: decimal(candidate.truck_target_kg),
      updated_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
      updated_by: actorId ?? null,
    };
    await this.db.insert(schema.feedPlanningSetting).values({
      setting_id: randomUUID(), tenant_id: tenantId, company_id: companyId, farm_id: farmId,
      ...databaseValues, created_by: actorId ?? null,
    }).onDuplicateKeyUpdate({ set: databaseValues });
    return this.resolve(companyId, farmId);
  }
}
