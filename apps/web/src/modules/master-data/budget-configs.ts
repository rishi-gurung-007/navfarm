import type { MasterDataConfig } from './types';

/**
 * The GM Dashboard Budget master (design: 2026-11-16-gm-dashboard-budget-master): one line per reporting period, farm
 * and metric. The API serves it at /piggery/budget; it is listed in Farm Master.
 *
 * Period, farm and metric identify a line, so they are asked for on create and fixed afterwards (`createOnly`); only
 * the amount, tolerance and notes change. Every field key is the API's body and row field name, so create posts what
 * the service reads and edit prefills from the row. Access is the role matrix's PIGGERY/BUDGET grant, not admins-only. The metric list is read from the API's catalogue, so a metric added there
 * appears here without a change to this file.
 */

const budget: MasterDataConfig = {
  key: 'budget',
  label: 'Budget',
  singular: 'Budget line',
  apiBase: '/piggery/budget',
  idKey: 'budget_id',
  group: 'Budget',
  isPrimary: true,
  supportsRestore: true,
  description: 'The budget each farm is measured against on the GM Dashboard, by reporting period and metric.',
  columns: [
    { key: 'period_code', label: 'Period' },
    { key: 'farm_name', label: 'Farm' },
    { key: 'metric_label', label: 'Metric' },
    { key: 'amount', label: 'Amount' },
    { key: 'tolerance_pct', label: 'Tolerance %' },
  ],
  fields: [
    { key: 'company_id', label: 'Company', type: 'text', hideInForm: true },
    {
      key: 'period_id',
      label: 'Reporting Period',
      type: 'select-entity',
      required: true,
      createOnly: true,
      entityEndpoint: '/reporting-period',
      // Only one period is "active" (the one open for posting); a budget may be set for any past or future period.
      entityIncludeInactive: true,
      entityValueKey: 'period_id',
      entityLabelKeys: ['period_code'],
    },
    {
      // The API's create body and the list row both name it farm_id; the option's value is the farm's location_id.
      key: 'farm_id',
      label: 'Farm',
      type: 'select-entity',
      required: true,
      createOnly: true,
      entityEndpoint: '/location?locationType=FARM&rootOnly=true&isActive=true',
      entityValueKey: 'location_id',
      entityLabelKeys: ['location_code', 'location_name'],
    },
    {
      key: 'metric_code',
      label: 'Metric',
      type: 'select-entity',
      required: true,
      createOnly: true,
      entityEndpoint: '/piggery/budget/metrics',
      entityValueKey: 'code',
      entityLabelKeys: ['label'],
    },
    {
      key: 'amount',
      label: 'Amount',
      type: 'number',
      step: '0.01',
      required: true,
      helpText: "In the chosen metric's unit: a plain number, or a percentage for Gross Margin %.",
    },
    {
      key: 'tolerance_pct',
      label: 'Tolerance %',
      type: 'number',
      step: '0.01',
      min: 0,
      max: 100,
      helpText: 'Blank means 10 %',
    },
    { key: 'notes', label: 'Notes', type: 'text', maxLength: 500 },
  ],
};

export const BUDGET_CONFIGS: MasterDataConfig[] = [budget];

/** The budget master's grant: module PIGGERY, the API controller's resource. */
export const BUDGET_GRANTS: Record<string, ['PIGGERY', string]> = {
  budget: ['PIGGERY', 'BUDGET'],
};
