export interface PiggeryGmDashboardData {
  metadata: {
    tenantName: string;
    companyName: string;
    nobCode: string;
    periodCode: string;
    periodStartDate: string;
    periodEndDate: string;
    isPeriodActive: boolean;
  };
  impactSummary: {
    pigletsWeanedPerSowPerYear: number;
    divisionLiveBirths: number;
    preWeanLossCount: number;
    preWeanLossPct: number;
    mortalitySavingsExtraPigs: number;
    cycleIndexGapExtraPigs: number;
    activeBreedingFemales: number;
  };
  coreKpis: {
    avgSowsPresent: { value: number; delta: string; target: number; sparkline: number[] };
    avgGiltsPresent: { value: number; delta: string; totalBreeding: number; sparkline: number[] };
    cycleIndex: { value: number; delta: string; target: number; sparkline: number[] };
    bornAlivePerLitter: { value: number; delta: string; benchmark: number; sparkline: number[] };
    farrowingRatePct: { value: number; delta: string; target: number; sparkline: number[] };
    preWeanMortalityPct: { value: number; delta: string; target: number; sparkline: number[] };
    femaleMortalityPct: { value: number; delta: string; target: number; sparkline: number[] };
    avgCycleLengthDays: { value: number; delta: string; gestationDays: number; sparkline: number[] };
  };
  cycleAnatomy: {
    gestationDays: number;
    lactationDays: number;
    weanToServiceDays: number;
    emptyDays: number;
    totalCycleDays: number;
    metrics: {
      weanToService: { value: number; target: number; status: 'GOOD' | 'WARN' | 'ALERT' };
      lactationDays: { value: number; target: number; status: 'GOOD' | 'WARN' | 'ALERT' };
      cullRatePct: { value: number; target: number; status: 'GOOD' | 'WARN' | 'ALERT' };
      firstLittersPct: { value: number; target: number; status: 'GOOD' | 'WARN' | 'ALERT' };
    };
  };
  parityDistribution: {
    p1: { count: number; pct: number };
    p2: { count: number; pct: number };
    p3: { count: number; pct: number };
    p4: { count: number; pct: number };
    p5: { count: number; pct: number };
    p6: { count: number; pct: number };
    p7Plus: { count: number; pct: number };
    firstLitterPct: number;
  };
  farmScorecard: Array<{
    farmId: string;
    farmCode: string;
    farmName: string;
    sowsCount: number;
    giltsCount: number;
    cycleIndex: number;
    bornAlivePerLitter: number;
    farrowingRatePct: number;
    weanToServiceDays: number;
    preWeanMortalityPct: number;
    femaleMortalityPct: number;
    aiStatus: 'Active' | 'Partial' | 'Inactive';
    status: 'On Track' | 'Watch' | 'Critical';
  }>;
  divisionTotals: {
    sowsCount: number;
    giltsCount: number;
    cycleIndex: number;
    bornAlivePerLitter: number;
    farrowingRatePct: number;
    weanToServiceDays: number;
    preWeanMortalityPct: number;
    femaleMortalityPct: number;
    status: string;
  };
}
