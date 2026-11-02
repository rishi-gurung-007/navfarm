import type { Alert, MetricRow } from './gm-dashboard.metrics';

export interface QueryPiggeryGmDashboardDto {
  companyId?: string;
  /** A Reporting Period; the one holding today when left out. */
  periodId?: string;
  /** One farm; every farm the user may see when left out. */
  farmId?: string;
}

export interface GmDashboardPeriod {
  period_id: string;
  period_code: string;
  business_year: string;
  start_date: string;
  end_date: string;
}

export interface PiggeryGmDashboardData {
  /** The chosen period, the first day of its business year (YTD), and the last day counted (its end, or today). */
  period: (GmDashboardPeriod & { ytd_from: string; to: string }) | null;
  periods: GmDashboardPeriod[];
  farms: Array<{ farm_id: string; farm_code: string; farm_name: string }>;
  /** Per farm and for all farms together; null where there are no sows. */
  kg_sold_per_sow_year: {
    month: Record<string, number | null>;
    ytd: Record<string, number | null>;
  };
  breeding: MetricRow[];
  weaner_grower: MetricRow[];
  alerts: Alert[];
}
