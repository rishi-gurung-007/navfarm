import { BadRequestException } from '@nestjs/common';

type PersistedPlanningSetting = Partial<{
  default_forecast_days: number | null;
  max_forecast_days: number | null;
  production_weekday: number | null;
  production_shift: string | null;
  submission_weekday: number | null;
  submission_time: string | null;
  reminder_weekday: number | null;
  reminder_time: string | null;
  physical_count_weekday: number | null;
  physical_count_time: string | null;
  truck_target_kg: string | number | null;
  bulk_multiple_kg: string | number | null;
  safety_stock_kg: string | number | null;
  bag_size_kg: string | number | null;
  capacity_warning_pct: string | number | null;
  bag_tolerance_pct: string | number | null;
  finance_variance_pct: string | number | null;
  finance_variance_amount: string | number | null;
}>;

const numberOrNull = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);

const weekday = (value: number | null, label: string): number | null => {
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 6)) {
    throw new BadRequestException(`${label} must be a weekday from 0 (Sunday) to 6 (Saturday).`);
  }
  return value;
};

const time = (value: string | null, label: string): string | null => {
  if (value !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new BadRequestException(`${label} must use 24-hour HH:mm format.`);
  }
  return value;
};

const positive = (value: number | null, fallback: number, label: string): number => {
  const v = value ?? fallback;
  if (!(v > 0)) throw new BadRequestException(`${label} must be greater than zero.`);
  return v;
};

export function resolvePlanningRules(row: PersistedPlanningSetting | null) {
  const defaultForecastDays = row?.default_forecast_days ?? 7;
  const maxForecastDays = row?.max_forecast_days ?? 45;
  if (!Number.isInteger(defaultForecastDays) || defaultForecastDays < 1 || defaultForecastDays > maxForecastDays) {
    throw new BadRequestException('Default forecast days must be between 1 and the configured maximum.');
  }
  if (!Number.isInteger(maxForecastDays) || maxForecastDays < 1 || maxForecastDays > 45) {
    throw new BadRequestException('Maximum forecast days must be between 1 and 45.');
  }

  const capacityWarningPct = numberOrNull(row?.capacity_warning_pct) ?? 90;
  const financeVariancePct = numberOrNull(row?.finance_variance_pct) ?? 5;
  if (capacityWarningPct < 0 || capacityWarningPct > 100) {
    throw new BadRequestException('Capacity warning percentage must be between 0 and 100.');
  }
  if (financeVariancePct < 0) {
    throw new BadRequestException('Finance variance percentage cannot be negative.');
  }

  // TDD Engine Step 8 / Dashboard row 60: safety stock is its own setting; the Worked Example's buffer is zero.
  const safetyStockKg = numberOrNull(row?.safety_stock_kg) ?? 0;
  if (safetyStockKg < 0) throw new BadRequestException('Safety stock cannot be negative.');

  return {
    defaultForecastDays,
    maxForecastDays,
    productionWeekday: weekday(row?.production_weekday ?? null, 'Production weekday'),
    productionShift: row?.production_shift ?? null,
    submissionWeekday: weekday(row?.submission_weekday ?? null, 'Submission weekday'),
    submissionTime: time(row?.submission_time ?? null, 'Submission time'),
    reminderWeekday: weekday(row?.reminder_weekday ?? null, 'Reminder weekday'),
    reminderTime: time(row?.reminder_time ?? null, 'Reminder time'),
    physicalCountWeekday: weekday(row?.physical_count_weekday ?? null, 'Physical-count weekday'),
    physicalCountTime: time(row?.physical_count_time ?? null, 'Physical-count time'),
    // Requisition rows 27–28, Engine Step 8: 30,000 KG truck target (never a block), 3,000 KG compartment, 50 KG bag.
    truckTargetKg: positive(numberOrNull(row?.truck_target_kg), 30000, 'Truck target'),
    bulkMultipleKg: positive(numberOrNull(row?.bulk_multiple_kg), 3000, 'Bulk multiple'),
    bagSizeKg: positive(numberOrNull(row?.bag_size_kg), 50, 'Bag size'),
    safetyStockKg,
    capacityWarningPct,
    capacityCriticalPct: 100,
    bagTolerancePct: numberOrNull(row?.bag_tolerance_pct),
    financeVariancePct,
    financeVarianceAmount: numberOrNull(row?.finance_variance_amount),
  };
}

/** What the feed requisition and forecast need from the resolved settings; an unset production day is Sunday. */
export function toFarmFeedSettings(r: Pick<ReturnType<typeof resolvePlanningRules>, 'bulkMultipleKg' | 'bagSizeKg' | 'truckTargetKg' | 'productionWeekday' | 'safetyStockKg'>) {
  return { bulkMultipleKg: r.bulkMultipleKg, bagSizeKg: r.bagSizeKg, truckTargetKg: r.truckTargetKg, productionWeekday: r.productionWeekday ?? 0, safetyStockKg: r.safetyStockKg };
}

export type CapacityBand = 'GREEN' | 'AMBER' | 'RED';

export function capacityBand(percentage: number, warningPercentage: number): CapacityBand {
  if (percentage > 100) return 'RED';
  if (percentage >= warningPercentage) return 'AMBER';
  return 'GREEN';
}

export function financeEscalation(input: {
  variancePct: number;
  varianceAmount: number | null;
  percentageThreshold: number;
  amountThreshold: number | null;
}) {
  const percentage = Math.abs(input.variancePct) >= input.percentageThreshold;
  const amount = input.amountThreshold !== null && input.varianceAmount !== null
    ? Math.abs(input.varianceAmount) >= input.amountThreshold
    : false;
  return { required: percentage || amount, percentage, amount };
}
