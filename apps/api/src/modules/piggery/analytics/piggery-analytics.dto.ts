import type {
  Alert,
  FarmAlert,
  FarmRow,
  MetricRow,
  SalesFigures,
} from './gm-dashboard.metrics';

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
    /** The month figure of each farm with its target and status, as a matrix cell. */
    cells: Record<string, { value: number | null; target: number | null; status: 'GREEN' | 'AMBER' | 'RED' | null }>;
  };
  /** Pigs sold, cost of sales and gross margin from the ledgers, per farm and for all ("all"); null with no sale in the window. */
  financial: {
    month: Record<string, SalesFigures | null>;
    ytd: Record<string, SalesFigures | null>;
    /** The business year's running total of pigs sold by period, for the chosen farm or all farms. */
    heads_by_period: Array<{ period_code: string; heads: number | null }>;
  };
  breeding: MetricRow[];
  weaner_grower: MetricRow[];
  alerts: Alert[];
  /** With one farm chosen: its figures over This Week, the 4-week average, This Month, Prev. Month and 3 Months. */
  farm_view: GmFarmView | null;
}

export interface GmFarmView {
  farm: { farm_id: string; farm_code: string; farm_name: string };
  /** Sows on the farm on the period's last day (or today). */
  sows: number;
  windows: Array<{ key: string; start_date: string; end_date: string }>;
  kg_sold_per_sow_year_ytd: number | null;
  breeding: FarmRow[];
  weaner_grower: FarmRow[];
  alerts: FarmAlert[];
}
