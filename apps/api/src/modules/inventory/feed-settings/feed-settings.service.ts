import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { farmScope } from '../../../common/farm-scope';
import { UpdateCompanyFeedSettingsDto } from './dto/feed-settings.dto';
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

    let farm: { location_id: string; company_id: string | null; feed_lead_time_days: number | null } | undefined;
    if (effectiveFarmId) {
      [farm] = await this.db.select({
        location_id: schema.locationMaster.location_id,
        company_id: schema.locationMaster.company_id,
        feed_lead_time_days: schema.locationMaster.feed_lead_time_days,
      }).from(schema.locationMaster).where(and(
        eq(schema.locationMaster.location_id, effectiveFarmId),
        eq(schema.locationMaster.location_type, 'FARM'),
      )).limit(1);
      if (!farm || farm.company_id !== companyId) throw new NotFoundException(`Farm '${effectiveFarmId}' is not part of company '${companyId}'.`);
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

    return {
      companyId,
      farmId: effectiveFarmId ?? null,
      timezoneId: company.default_timezone_id,
      ...effective,
      leadTimeDays: farm?.feed_lead_time_days ?? null,
      sources: {
        leadTime: farm?.feed_lead_time_days !== null && farm?.feed_lead_time_days !== undefined ? 'FARM' as const : 'SYSTEM' as const,
        submissionSchedule: hasFarmSubmission ? 'FARM' as const : companySetting ? 'COMPANY' as const : 'SYSTEM' as const,
        companySetting: companySetting ? 'COMPANY' as const : 'SYSTEM' as const,
      },
    };
  }

  async saveCompany(companyId: string, dto: UpdateCompanyFeedSettingsDto, tenantId: string, actorId?: string) {
    if (farmScope(this.cls).farmId) throw new ForbiddenException('Farm-bound users cannot change company feed settings.');
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
      capacity_warning_pct: dto.capacityWarningPct ?? current.capacityWarningPct,
      bag_tolerance_pct: dto.bagTolerancePct === undefined ? current.bagTolerancePct : dto.bagTolerancePct,
      finance_variance_pct: dto.financeVariancePct ?? current.financeVariancePct,
      finance_variance_amount: dto.financeVarianceAmount === undefined ? current.financeVarianceAmount : dto.financeVarianceAmount,
    };
    resolvePlanningRules(candidate);
    if (!tenantId) throw new BadRequestException('Tenant context is required to save feed settings.');

    const [existing] = await this.db.select({ setting_id: schema.feedPlanningSetting.setting_id })
      .from(schema.feedPlanningSetting)
      .where(and(eq(schema.feedPlanningSetting.company_id, companyId), isNull(schema.feedPlanningSetting.farm_id), eq(schema.feedPlanningSetting.is_active, true)))
      .limit(1);
    const databaseValues = {
      ...candidate,
      truck_target_kg: candidate.truck_target_kg === null ? null : String(candidate.truck_target_kg),
      bulk_multiple_kg: candidate.bulk_multiple_kg === null ? null : String(candidate.bulk_multiple_kg),
      capacity_warning_pct: String(candidate.capacity_warning_pct),
      bag_tolerance_pct: candidate.bag_tolerance_pct === null ? null : String(candidate.bag_tolerance_pct),
      finance_variance_pct: String(candidate.finance_variance_pct),
      finance_variance_amount: candidate.finance_variance_amount === null ? null : String(candidate.finance_variance_amount),
      updated_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
      updated_by: actorId ?? null,
    };
    if (existing) {
      await this.db.update(schema.feedPlanningSetting).set(databaseValues).where(eq(schema.feedPlanningSetting.setting_id, existing.setting_id));
    } else {
      await this.db.insert(schema.feedPlanningSetting).values({
        setting_id: randomUUID(), tenant_id: tenantId, company_id: companyId, farm_id: null,
        ...databaseValues, created_by: actorId ?? null,
      });
    }
    return this.resolve(companyId);
  }
}
