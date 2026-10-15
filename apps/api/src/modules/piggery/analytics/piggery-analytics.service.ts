import { Injectable, ForbiddenException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, desc, asc, gte, lte, inArray, isNull, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { farmScope, FarmScope, animalScopeConditions, batchScopeConditions, animalOnFarm } from '../../../common/farm-scope';
import { PiggeryGmDashboardData, QueryPiggeryGmDashboardDto } from './piggery-analytics.dto';

@Injectable()
export class PiggeryAnalyticsService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  private resolveCompanyId(scope: FarmScope, queryCompanyId?: string): string {
    if (scope.companyId) {
      if (queryCompanyId && queryCompanyId !== scope.companyId) {
        throw new ForbiddenException('Report company must match the workspace.');
      }
      return scope.companyId;
    }
    return queryCompanyId || '';
  }

  async getGmDashboard(tenantId: string, query: QueryPiggeryGmDashboardDto): Promise<PiggeryGmDashboardData> {
    const scope = farmScope(this.cls);
    const companyId = this.resolveCompanyId(scope, query.companyId);

    // 1. Resolve Company Details
    const [company] = companyId
      ? await this.db.select().from(schema.companyMaster).where(eq(schema.companyMaster.company_id, companyId)).limit(1)
      : await this.db.select().from(schema.companyMaster).where(eq(schema.companyMaster.tenant_id, tenantId)).limit(1);

    const activeCompanyId = company?.company_id || companyId;
    // A litter and a mating belong to the sow's line of business. A restricted user may hold a LOB and no farm
    // (OPERATIONAL_ADMIN is restricted but not farm-bound), and animalOnFarm below only covers the farm half —
    // without this the dashboard's litters and matings would be the whole company's. The herd and batch sections
    // get both halves from animalScopeConditions / batchScopeConditions.
    // Written as a subquery in SQL, the way animalOnFarm and batchOnFarm in common/farm-scope.ts are.
    const sowOfLob = (column: typeof schema.breedingRecord.sow_animal_id | typeof schema.farrowingRecord.sow_animal_id) =>
      scope.restricted && scope.lobId
        ? sql`${column} IN (SELECT al.animal_id FROM animal_register al WHERE al.tenant_id = ${tenantId} AND al.lob_id = ${scope.lobId})`
        : undefined;
    const companyName = company?.company_name || 'Triple C Piggery Division';

    // 2. Resolve Reporting Periods
    const periods = await this.db
      .select({
        period_id: schema.reportingPeriod.period_id,
        period_code: schema.reportingPeriod.period_code,
        business_year: schema.reportingPeriod.business_year,
        start_date: schema.reportingPeriod.start_date,
        end_date: schema.reportingPeriod.end_date,
        is_active: schema.reportingPeriod.is_active,
      })
      .from(schema.reportingPeriod)
      .where(
        and(
          eq(schema.reportingPeriod.tenant_id, tenantId),
          activeCompanyId ? eq(schema.reportingPeriod.company_id, activeCompanyId) : undefined,
        )
      )
      .orderBy(asc(schema.reportingPeriod.start_date));
    const today = new Date().toISOString().slice(0, 10);
    const currentPeriod = periods.find((p) => p.start_date <= today && today <= p.end_date);
    const activeCurrentYearPeriod = periods.find(
      (p) => p.is_active && p.start_date.startsWith(today.slice(0, 4))
    );

    const selectedPeriod = query.periodId
      ? periods.find((p) => p.period_id === query.periodId)
      : currentPeriod || activeCurrentYearPeriod || periods[0];

    const currentYear = new Date().getFullYear().toString();
    const periodCode = selectedPeriod?.period_code || 'P1';
    const businessYear = query.businessYear || selectedPeriod?.business_year || currentYear;
    const periodStartDate = query.dateFrom || selectedPeriod?.start_date || `${businessYear}-01-01`;
    const periodEndDate = query.dateTo || selectedPeriod?.end_date || `${businessYear}-12-31`;
    const isPeriodActive = selectedPeriod?.is_active ?? true;

    // 3. Query Real Registered Animals (100% Live)
    const animalConditions = [
      eq(schema.animalRegister.tenant_id, tenantId),
      activeCompanyId ? eq(schema.animalRegister.company_id, activeCompanyId) : undefined,
      ...animalScopeConditions(scope),
    ].filter(Boolean) as any[];

    const animals = await this.db
      .select({
        animal_id: schema.animalRegister.animal_id,
        animal_code: schema.animalRegister.animal_code,
        animal_type: schema.animalRegister.animal_type,
        gender: schema.animalRegister.gender,
        is_active: schema.animalRegister.is_active,
        status: schema.animalRegister.status,
        parity_count: schema.animalRegister.parity_count,
        current_location_id: schema.animalRegister.current_location_id,
        current_stage_id: schema.animalRegister.current_stage_id,
        total_piglets_born_live: schema.animalRegister.total_piglets_born_live,
        total_piglets_weaned: schema.animalRegister.total_piglets_weaned,
      })
      .from(schema.animalRegister)
      .where(and(...animalConditions));

    // Active breeding stock
    const activeAnimals = animals.filter((a) => a.is_active);
    const sows = activeAnimals.filter((a) => a.animal_type === 'SOW');
    const gilts = activeAnimals.filter((a) => a.animal_type === 'GILT');
    const boars = activeAnimals.filter((a) => a.animal_type === 'BOAR');

    // Real Parity distribution from actual animal rows
    const parityBuckets = { p0: gilts.length, p1: 0, p2: 0, p3: 0, p4Plus: 0 };
    for (const s of sows) {
      const p = s.parity_count || 1;
      if (p === 1) parityBuckets.p1++;
      else if (p === 2) parityBuckets.p2++;
      else if (p === 3) parityBuckets.p3++;
      else parityBuckets.p4Plus++;
    }

    const totalFemales = Math.max(sows.length + gilts.length, 1);
    const p0Pct = Math.round((parityBuckets.p0 / totalFemales) * 100);
    const p1Pct = Math.round((parityBuckets.p1 / totalFemales) * 100);
    const p2Pct = Math.round((parityBuckets.p2 / totalFemales) * 100);
    const p3Pct = Math.round((parityBuckets.p3 / totalFemales) * 100);
    const p4PlusPct = Math.round((parityBuckets.p4Plus / totalFemales) * 100);

    // Stages lookup
    const stages = await this.db.select().from(schema.stageMaster).where(eq(schema.stageMaster.tenant_id, tenantId));
    const stageMap = new Map(stages.map((st) => [st.stage_id, st.stage_name]));

    const stageCountMap = new Map<string, number>();
    for (const a of activeAnimals) {
      const stageName = (a.current_stage_id && stageMap.get(a.current_stage_id)) || a.status || 'Active Herd';
      stageCountMap.set(stageName, (stageCountMap.get(stageName) || 0) + 1);
    }
    const stagesDistribution = Array.from(stageCountMap.entries()).map(([stageName, count]) => ({
      stageName,
      count,
    }));

    // 4. Query Real Farrowing Records
    const farrowConditions = [
      eq(schema.farrowingRecord.tenant_id, tenantId),
      activeCompanyId ? eq(schema.farrowingRecord.company_id, activeCompanyId) : undefined,
      scope.farmId ? animalOnFarm(schema.farrowingRecord.sow_animal_id, scope.farmId) : undefined,
      sowOfLob(schema.farrowingRecord.sow_animal_id),
    ].filter(Boolean) as any[];

    if (query.dateFrom && query.dateTo) {
      farrowConditions.push(gte(schema.farrowingRecord.farrowing_date, query.dateFrom));
      farrowConditions.push(lte(schema.farrowingRecord.farrowing_date, query.dateTo));
    }

    const farrowings = await this.db
      .select({
        farrow_id: schema.farrowingRecord.farrow_id,
        sow_animal_id: schema.farrowingRecord.sow_animal_id,
        farrowing_date: schema.farrowingRecord.farrowing_date,
        piglets_born_live: schema.farrowingRecord.piglets_born_live,
        piglets_stillborn: schema.farrowingRecord.piglets_stillborn,
        piglets_weaned: schema.farrowingRecord.piglets_weaned,
        weaning_date: schema.farrowingRecord.weaning_date,
        avg_birth_weight_kg: schema.farrowingRecord.avg_birth_weight_kg,
        avg_weaning_weight_kg: schema.farrowingRecord.avg_weaning_weight_kg,
      })
      .from(schema.farrowingRecord)
      .where(and(...farrowConditions))
      .orderBy(desc(schema.farrowingRecord.farrowing_date));

    const totalLitters = farrowings.length;
    const totalPigletsBornLive = farrowings.reduce((sum, f) => sum + (f.piglets_born_live || 0), 0);
    const totalPigletsWeaned = farrowings.reduce((sum, f) => sum + (f.piglets_weaned || 0), 0);
    const avgBornAlive = totalLitters > 0 ? Number((totalPigletsBornLive / totalLitters).toFixed(1)) : 0;
    const weaningSurvivalRatePct = totalPigletsBornLive > 0 ? Number(((totalPigletsWeaned / totalPigletsBornLive) * 100).toFixed(1)) : 0;
    const preWeanMortalityPct = totalPigletsBornLive > 0 ? Number((100 - weaningSurvivalRatePct).toFixed(1)) : 0;

    const animalCodeMap = new Map(animals.map((a) => [a.animal_id, a.animal_code]));
    const recentLitters = farrowings.slice(0, 5).map((f) => ({
      farrowId: f.farrow_id,
      sowCode: animalCodeMap.get(f.sow_animal_id) || 'SOW',
      farrowingDate: f.farrowing_date,
      pigletsBornLive: f.piglets_born_live || 0,
      pigletsStillborn: f.piglets_stillborn || 0,
      pigletsWeaned: f.piglets_weaned || 0,
      weaningDate: f.weaning_date || null,
      avgBirthWeightKg: f.avg_birth_weight_kg ? Number(f.avg_birth_weight_kg) : null,
      avgWeaningWeightKg: f.avg_weaning_weight_kg ? Number(f.avg_weaning_weight_kg) : null,
    }));

    // 5. Query Real Breeding / Mating Pipeline
    const breedingConditions = [
      eq(schema.breedingRecord.tenant_id, tenantId),
      activeCompanyId ? eq(schema.breedingRecord.company_id, activeCompanyId) : undefined,
      scope.farmId ? animalOnFarm(schema.breedingRecord.sow_animal_id, scope.farmId) : undefined,
      sowOfLob(schema.breedingRecord.sow_animal_id),
    ].filter(Boolean) as any[];

    if (query.dateFrom && query.dateTo) {
      breedingConditions.push(gte(schema.breedingRecord.mating_date, query.dateFrom));
      breedingConditions.push(lte(schema.breedingRecord.mating_date, query.dateTo));
    }

    const matings = await this.db
      .select({
        breeding_id: schema.breedingRecord.breeding_id,
        mating_type: schema.breedingRecord.mating_type,
        conception_result: schema.breedingRecord.conception_result,
        pregnancy_confirmed: schema.breedingRecord.pregnancy_confirmed,
      })
      .from(schema.breedingRecord)
      .where(and(...breedingConditions));

    const totalMatings = matings.length;
    let confirmedPregnant = 0;
    let repeatFailed = 0;
    let aiInseminationCount = 0;
    let naturalMatingCount = 0;

    for (const m of matings) {
      if (m.mating_type === 'AI') aiInseminationCount++;
      else naturalMatingCount++;

      if (m.pregnancy_confirmed || m.conception_result === 'CONFIRMED') confirmedPregnant++;
      else if (m.conception_result === 'FAILED' || m.conception_result === 'REPEAT') repeatFailed++;
    }

    // 6. Query Real Production Batches
    const batchConditions = [
      eq(schema.batchHeader.tenant_id, tenantId),
      activeCompanyId ? eq(schema.batchHeader.company_id, activeCompanyId) : undefined,
      eq(schema.batchHeader.status, 'ACTIVE'),
      ...batchScopeConditions(scope),
    ].filter(Boolean) as any[];

    const batches = await this.db
      .select({
        batch_id: schema.batchHeader.batch_id,
        batch_no: schema.batchHeader.batch_no,
        current_stage_code: schema.batchHeader.current_stage_code,
        closing_quantity: schema.batchHeader.closing_quantity,
        opening_quantity: schema.batchHeader.opening_quantity,
        total_cost: schema.batchHeader.total_cost,
        farm_id: schema.batchHeader.farm_id,
      })
      .from(schema.batchHeader)
      .where(and(...batchConditions));

    const activeBatchesCount = batches.length;
    const totalBatchHeadcount = batches.reduce((sum, b) => sum + (Number(b.closing_quantity) || Number(b.opening_quantity) || 0), 0);

    // Compute live WIP valuation from batch_transaction (accumulated consumption & overhead)
    const batchIds = batches.map((b) => b.batch_id);
    const batchWipMap = new Map<string, number>();
    if (batchIds.length > 0) {
      const costTx = await this.db
        .select({
          batch_id: schema.batchTransaction.batch_id,
          amount: schema.batchTransaction.amount,
        })
        .from(schema.batchTransaction)
        .where(
          and(
            inArray(schema.batchTransaction.batch_id, batchIds),
            inArray(schema.batchTransaction.transaction_type, ['CONSUMPTION', 'OVERHEAD']),
            isNull(schema.batchTransaction.reversed_at),
          )
        );

      for (const tx of costTx) {
        batchWipMap.set(
          tx.batch_id,
          (batchWipMap.get(tx.batch_id) || 0) + Math.abs(Number(tx.amount || 0)),
        );
      }
    }

    const totalBatchWipValuation = batches.reduce(
      (sum, b) => sum + (batchWipMap.get(b.batch_id) || Number(b.total_cost) || 0),
      0,
    );

    const batchStageMap = new Map<string, { count: number; totalHeads: number }>();
    for (const b of batches) {
      const stageCode = b.current_stage_code || 'UNSTAGED';
      const heads = Number(b.closing_quantity) || Number(b.opening_quantity) || 0;
      const prev = batchStageMap.get(stageCode) || { count: 0, totalHeads: 0 };
      batchStageMap.set(stageCode, { count: prev.count + 1, totalHeads: prev.totalHeads + heads });
    }
    const batchesByStage = Array.from(batchStageMap.entries()).map(([stageName, val]) => ({
      stageName,
      count: val.count,
      totalHeads: val.totalHeads,
    }));

    // 7. Query Real Farm Locations
    const farmLocations = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_code: schema.locationMaster.location_code,
        location_name: schema.locationMaster.location_name,
      })
      .from(schema.locationMaster)
      .where(
        and(
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.location_type, 'FARM'),
          activeCompanyId ? eq(schema.locationMaster.company_id, activeCompanyId) : undefined,
          scope.farmId ? eq(schema.locationMaster.location_id, scope.farmId) : undefined,
          scope.restricted && scope.lobId ? eq(schema.locationMaster.lob_id, scope.lobId) : undefined,
        )
      );

    // Map pens/sheds to their parent farm
    const allLocations = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        farm_id: schema.locationMaster.farm_id,
      })
      .from(schema.locationMaster)
      .where(eq(schema.locationMaster.tenant_id, tenantId));

    const locToFarmMap = new Map<string, string>();
    for (const loc of allLocations) {
      if (loc.farm_id) locToFarmMap.set(loc.location_id, loc.farm_id);
    }

    const facilityLocations = farmLocations.map((fl) => {
      const farmAnimals = activeAnimals.filter((a) => {
        const resolvedFarm = locToFarmMap.get(a.current_location_id || '') || a.current_location_id;
        return resolvedFarm === fl.location_id;
      });
      const farmSows = farmAnimals.filter((a) => a.animal_type === 'SOW').length;
      const farmGilts = farmAnimals.filter((a) => a.animal_type === 'GILT').length;
      const farmBatches = batches.filter((b) => b.farm_id === fl.location_id);
      const farmWip = farmBatches.reduce(
        (sum, b) => sum + (batchWipMap.get(b.batch_id) || Number(b.total_cost) || 0),
        0,
      );

      const isActive = farmAnimals.length > 0 || farmBatches.length > 0;

      return {
        locationId: fl.location_id,
        locationCode: fl.location_code,
        locationName: fl.location_name,
        headcount: farmAnimals.length,
        sowsCount: farmSows,
        giltsCount: farmGilts,
        batchesCount: farmBatches.length,
        wipValuation: farmWip,
        status: isActive ? ('Active Operations' as const) : ('Standby' as const),
      };
    });

    return {
      metadata: {
        tenantName: 'NAVFarm Enterprise',
        companyName,
        nobCode: 'LVS_PIGGERY',
        periodCode,
        businessYear,
        periodStartDate,
        periodEndDate,
        isPeriodActive,
        availablePeriods: (periods || []).map((p) => ({
          periodId: p.period_id,
          periodCode: p.period_code,
          businessYear: p.business_year,
          startDate: p.start_date,
          endDate: p.end_date,
          isActive: p.is_active,
        })),
      },
      activeHerdSummary: {
        totalHeadcount: activeAnimals.length,
        sowsCount: sows.length,
        giltsCount: gilts.length,
        boarsCount: boars.length,
        parityDistribution: {
          p0Gilts: { count: parityBuckets.p0, pct: p0Pct },
          p1: { count: parityBuckets.p1, pct: p1Pct },
          p2: { count: parityBuckets.p2, pct: p2Pct },
          p3: { count: parityBuckets.p3, pct: p3Pct },
          p4Plus: { count: parityBuckets.p4Plus, pct: p4PlusPct },
        },
        stagesDistribution,
      },
      reproductiveIntelligence: {
        totalLittersRecorded: totalLitters,
        totalPigletsBornLive,
        avgBornAlivePerLitter: avgBornAlive,
        totalPigletsWeaned,
        weaningSurvivalRatePct,
        preWeanMortalityPct,
        conceptionPipeline: {
          totalMatings,
          confirmedPregnant,
          repeatFailed,
          completedWeaned: totalLitters,
          aiInseminationCount,
          naturalMatingCount,
        },
        recentLitters,
      },
      productionBatchesSummary: {
        activeBatchesCount,
        totalBatchHeadcount,
        totalBatchWipValuation,
        batchesByStage,
      },
      facilityLocations,
    };
  }
}
