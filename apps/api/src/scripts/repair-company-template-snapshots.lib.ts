export interface TemplateCoverage {
  table: string;
  tenantRows: number;
  companyRows: number;
}

export type CompanyRepairAction = 'FULL_TEMPLATE_SNAPSHOT' | 'ADD_NUMBER_SERIES_ONLY' | 'AUDIT_ONLY' | 'SKIP_PLACEHOLDER';

export interface CompanyTemplateRepairPlan {
  action: CompanyRepairAction;
  missingNumberSeries: string[];
  partiallyOwnedTables: string[];
}

export function missingNumberSeriesTemplates<T extends { code: string }>(templates: T[], existing: Array<{ code: string }>): T[] {
  const ownedCodes = new Set(existing.map((row) => row.code.toUpperCase()));
  return templates.filter((row) => !ownedCodes.has(row.code.toUpperCase()));
}

export function planCompanyTemplateRepair(
  companyCode: string,
  coverage: TemplateCoverage[],
  missingNumberSeries: string[],
): CompanyTemplateRepairPlan {
  const partiallyOwnedTables = coverage.filter((row) => row.companyRows > 0).map((row) => row.table);
  if (companyCode === 'PLACEHOLDER') {
    return { action: 'SKIP_PLACEHOLDER', missingNumberSeries, partiallyOwnedTables };
  }
  if (partiallyOwnedTables.length === 0) {
    return { action: 'FULL_TEMPLATE_SNAPSHOT', missingNumberSeries, partiallyOwnedTables };
  }
  if (missingNumberSeries.length > 0) {
    return { action: 'ADD_NUMBER_SERIES_ONLY', missingNumberSeries, partiallyOwnedTables };
  }
  return { action: 'AUDIT_ONLY', missingNumberSeries, partiallyOwnedTables };
}
