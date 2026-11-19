import type {
  Alert,
  FarmAlert,
  FarmRow,
  MetricRow,
  SalesFigures,
} from './gm-dashboard.metrics';
import type { GmBudgetSection } from './gm-budget.dashboard';

export type { BudgetCell, GmBudgetSection } from './gm-budget.dashboard';

export interface QueryPiggeryGmDashboardDto {
  companyId?: string;
  /** A Reporting Period; the one holding today when left out. Ignored when fromDate/toDate are both given. */
  periodId?: string;
  /** One farm; every farm the user may see when left out. */
  farmId?: string;
  /**
   * A custom date range (19 Nov), given together: Month and YTD both become
   * this one window, clamped to today, and carry no budget — a reporting
   * Period is the only thing a budget line is set against.
   */
  fromDate?: string;
  toDate?: string;
}

export interface GmDashboardPeriod {
  period_id: string;
  period_code: string;
  business_year: string;
  start_date: string;
  end_date: string;
}

export interface GmSlaughterMetrics {
  total_animals: number;
  warm_mass_kg: number;
  cold_mass_kg: number;
  average_carcass_weight_kg: number | null;
  reported_product_value: number;
  grades: Array<{
    grade: string;
    count: number;
    percentage: number;
    warm_mass_kg: number;
    cold_mass_kg: number;
  }>;
  sexes: Array<{
    sex: string;
    count: number;
    percentage: number;
  }>;
  sick_codes: Array<{
    sick_code: string;
    count: number;
  }>;
  by_company: Array<{
    company_id: string;
    company_name: string;
    animals: number;
    warm_mass_kg: number;
    cold_mass_kg: number;
  }>;
  by_farm: Array<{
    farm_id: string;
    farm_name: string;
    animals: number;
    warm_mass_kg: number;
    cold_mass_kg: number;
  }>;
  trends: Array<{
    date: string;
    animals: number;
    warm_mass_kg: number;
    cold_mass_kg: number;
  }>;
  product_categories: Array<{
    category: string;
    quantity: number;
    warm_mass_kg: number;
    cold_mass_kg: number;
    average_mass_kg: number;
    reported_value: number;
  }>;
}

export interface PiggeryGmDashboardData {
  /** The chosen period, the first day of its business year (YTD), and the last day counted (its end, or today). */
  period:
    | (GmDashboardPeriod & {
        ytd_from: string;
        to: string;
        /** Set when the dashboard stepped back from the current period, which has no records yet: that period's code. */
        fallback_from?: string | null;
      })
    | null;
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
    /** The business year's running PBT (gross margin less the overheads), for the PBT chart. */
    pbt_by_period: Array<{ period_code: string; pbt: number | null }>;
  };
  /** Month and YTD budget, actual, Var and colour of each budget metric, per farm and for all ("all"), by dashboardKey. */
  budget: GmBudgetSection;
  breeding: MetricRow[];
  weaner_grower: MetricRow[];
  /** The Slaughter & Financial rows: each farm's Month actual against its Month budget. */
  financial_rows: MetricRow[];
  alerts: Alert[];
  /** With one farm chosen: its figures over This Week, the 4-week average, This Month, Prev. Month and 3 Months. */
  farm_view: GmFarmView | null;
  /** The farms (of those shown) with a farrowing, weaning or sale in the period; the rest have no records to show. */
  farms_reporting: { reporting: number; total: number; farm_ids: string[] };
  slaughter?: GmSlaughterMetrics;
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
