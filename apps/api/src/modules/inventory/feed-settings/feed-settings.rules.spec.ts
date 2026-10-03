import { BadRequestException } from '@nestjs/common';
import {
  capacityBand,
  financeEscalation,
  resolvePlanningRules,
  toFarmFeedSettings,
} from './feed-settings.rules';

describe('feed settings rules', () => {
  it('uses only the documented system fallbacks when a company has no settings row', () => {
    expect(resolvePlanningRules(null)).toEqual(expect.objectContaining({
      defaultForecastDays: 7,
      maxForecastDays: 45,
      capacityWarningPct: 90,
      capacityCriticalPct: 100,
      financeVariancePct: 5,
      financeVarianceAmount: null,
      productionWeekday: null,
      productionShift: null,
      submissionWeekday: null,
      submissionTime: null,
      reminderWeekday: null,
      reminderTime: null,
      physicalCountWeekday: null,
      physicalCountTime: null,
    }));
  });

  it('returns configured Triple C schedule values without making them fallbacks', () => {
    expect(resolvePlanningRules({
      default_forecast_days: 7,
      max_forecast_days: 45,
      production_weekday: 0,
      production_shift: 'AM',
      submission_weekday: 6,
      submission_time: '12:00',
      reminder_weekday: 5,
      reminder_time: '18:00',
      physical_count_weekday: 0,
      physical_count_time: '08:00',
      capacity_warning_pct: '90.00',
      finance_variance_pct: '5.00',
      finance_variance_amount: null,
    })).toEqual(expect.objectContaining({
      productionWeekday: 0,
      productionShift: 'AM',
      submissionWeekday: 6,
      submissionTime: '12:00',
      reminderWeekday: 5,
      reminderTime: '18:00',
      physicalCountWeekday: 0,
      physicalCountTime: '08:00',
    }));
    expect(resolvePlanningRules(null).submissionWeekday).toBeNull();
  });

  it('rejects a default horizon beyond the company maximum or the 45-day system maximum', () => {
    expect(() => resolvePlanningRules({ default_forecast_days: 8, max_forecast_days: 7 })).toThrow(BadRequestException);
    expect(() => resolvePlanningRules({ default_forecast_days: 7, max_forecast_days: 46 })).toThrow(BadRequestException);
  });

  it.each([
    [89.999, 'GREEN'],
    [90, 'AMBER'],
    [100, 'AMBER'],
    [100.001, 'RED'],
  ] as const)('classifies %s percent capacity as %s', (percentage, expected) => {
    expect(capacityBand(percentage, 90)).toBe(expected);
  });

  it('escalates absolute variance at 5 percent and treats a null amount threshold as unconfigured', () => {
    expect(financeEscalation({ variancePct: -5, varianceAmount: 999, percentageThreshold: 5, amountThreshold: null })).toEqual({ required: true, percentage: true, amount: false });
    expect(financeEscalation({ variancePct: 4.999, varianceAmount: 999, percentageThreshold: 5, amountThreshold: null })).toEqual({ required: false, percentage: false, amount: false });
    expect(financeEscalation({ variancePct: 1, varianceAmount: -100, percentageThreshold: 5, amountThreshold: 100 })).toEqual({ required: true, percentage: false, amount: true });
  });
});

describe('resolvePlanningRules — logistics and safety stock (TDD Engine Step 8)', () => {
  it('defaults to the workbook defaults with zero safety stock', () => {
    expect(resolvePlanningRules(null)).toMatchObject({ safetyStockKg: 0, bagSizeKg: 50, bulkMultipleKg: 3000, truckTargetKg: 30000 });
  });

  it('reads stored decimals as numbers', () => {
    expect(resolvePlanningRules({ safety_stock_kg: '500.00', bag_size_kg: '25.00', bulk_multiple_kg: '6000.00' }))
      .toMatchObject({ safetyStockKg: 500, bagSizeKg: 25, bulkMultipleKg: 6000 });
  });

  it('refuses negative safety stock and non-positive multiples', () => {
    expect(() => resolvePlanningRules({ safety_stock_kg: -1 })).toThrow('Safety stock cannot be negative.');
    expect(() => resolvePlanningRules({ bag_size_kg: 0 })).toThrow('Bag size must be greater than zero.');
    expect(() => resolvePlanningRules({ bulk_multiple_kg: 0 })).toThrow('Bulk multiple must be greater than zero.');
  });

  it('gives the requisition its settings, an unset production day being Sunday', () => {
    expect(toFarmFeedSettings(resolvePlanningRules({ safety_stock_kg: '250.00' })))
      .toEqual({ bulkMultipleKg: 3000, bagSizeKg: 50, truckTargetKg: 30000, productionWeekday: 0, safetyStockKg: 250 });
  });
});
