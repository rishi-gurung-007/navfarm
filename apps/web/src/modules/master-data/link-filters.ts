import type { MasterDataConfig } from './types';

/** The `filter[<column>]` values a link arrived with, for the columns this master can filter by; anything else is ignored. */
export function linkColumnFilters(
  params: URLSearchParams,
  config: MasterDataConfig,
): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const column of config.columns ?? []) {
    const value = column.noFilter ? null : params.get(`filter[${column.key}]`);
    if (value) filters[column.key] = value;
  }
  return filters;
}
