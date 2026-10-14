export interface QueryPiggeryGmDashboardDto {
  companyId?: string;
  periodId?: string;
  dateFrom?: string;
  dateTo?: string;
  businessYear?: string;
}

export interface PiggeryGmDashboardData {
  metadata: {
    tenantName: string;
    companyName: string;
    nobCode: string;
    periodCode: string;
    businessYear: string;
    periodStartDate: string;
    periodEndDate: string;
    isPeriodActive: boolean;
    availablePeriods: Array<{
      periodId: string;
      periodCode: string;
      businessYear: string;
      startDate: string;
      endDate: string;
      isActive: boolean;
    }>;
  };
  activeHerdSummary: {
    totalHeadcount: number;
    sowsCount: number;
    giltsCount: number;
    boarsCount: number;
    parityDistribution: {
      p0Gilts: { count: number; pct: number };
      p1: { count: number; pct: number };
      p2: { count: number; pct: number };
      p3: { count: number; pct: number };
      p4Plus: { count: number; pct: number };
    };
    stagesDistribution: Array<{
      stageName: string;
      count: number;
    }>;
  };
  reproductiveIntelligence: {
    totalLittersRecorded: number;
    totalPigletsBornLive: number;
    avgBornAlivePerLitter: number;
    totalPigletsWeaned: number;
    weaningSurvivalRatePct: number;
    preWeanMortalityPct: number;
    conceptionPipeline: {
      totalMatings: number;
      confirmedPregnant: number;
      repeatFailed: number;
      completedWeaned: number;
      aiInseminationCount: number;
      naturalMatingCount: number;
    };
    recentLitters: Array<{
      farrowId: string;
      sowCode: string;
      farrowingDate: string;
      pigletsBornLive: number;
      pigletsStillborn: number;
      pigletsWeaned: number;
      weaningDate: string | null;
      avgBirthWeightKg: number | null;
      avgWeaningWeightKg: number | null;
    }>;
  };
  productionBatchesSummary: {
    activeBatchesCount: number;
    totalBatchHeadcount: number;
    totalBatchWipValuation: number;
    batchesByStage: Array<{
      stageName: string;
      count: number;
      totalHeads: number;
    }>;
  };
  facilityLocations: Array<{
    locationId: string;
    locationCode: string;
    locationName: string;
    headcount: number;
    sowsCount: number;
    giltsCount: number;
    batchesCount: number;
    wipValuation: number;
    status: 'Active Operations' | 'Standby';
  }>;
}
