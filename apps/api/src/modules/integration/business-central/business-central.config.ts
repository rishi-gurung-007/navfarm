import { registerAs } from '@nestjs/config';

/**
 * Business Central connection settings, read from the environment (apps/api/.env, gitignored).
 *
 * The client secret is a credential: it is only ever read here and handed to the token request. It is never
 * logged, returned by an endpoint, or written to the database.
 *
 * BC_ENABLED=false (the default) means NAVFarm makes no call to Business Central at all — the IN_HOUSE mode
 * AGENTS.md describes. There are no fake BC calls or success states.
 */
export interface BcVendorSyncConfig {
  /** ODataV4 web service publishing the BC Vendor Card (BC developer's name: VendorCardApi). */
  service: string;
  /** FLAGGED = only vendors with "NavFarm Sync" ticked (normal); ALL = every vendor (UAT rehearsal only). */
  scope: 'FLAGGED' | 'ALL';
  /** BC = suppliers are created/edited in BC only (NAVFarm refuses new suppliers); NAVFARM = both allowed. */
  masterSource: 'BC' | 'NAVFARM';
  /** Hourly scheduled sync (off unless 'true'). */
  scheduleEnabled: boolean;
  /** Write the sync result back onto the BC vendor (Navfarm_Sync_Error / Navfarm_Error_Message / Sync_Status). */
  writeBack: boolean;
  /** Sync_Status option values to write; empty = leave Sync_Status alone (values are the BC developer's enum). */
  syncStatusSynced: string;
  syncStatusError: string;
  /** Refuse to deactivate more than this share of BC-sourced suppliers in one run (guards against a bad read). */
  maxDeactivateRatio: number;
}

export interface BusinessCentralConfig {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  environment: string;
  companyId: string;
  /** Company NAME, for ODataV4 web services (they address the company by name). */
  companyName: string;
  apiBaseUrl: string;
  authorityUrl: string;
  scope: string;
  requestTimeoutMs: number;
  maxRetries: number;
  pageSize: number;
  /** Which NAVFarm tenant and company the BC company maps to (codes, stable across reseeds). */
  navfarmTenantCode: string;
  navfarmCompanyCode: string;
  vendor: BcVendorSyncConfig;
}

const int = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

export function readBusinessCentralConfig(env: NodeJS.ProcessEnv = process.env): BusinessCentralConfig {
  return {
    enabled: env.BC_ENABLED === 'true',
    tenantId: (env.BC_TENANT_ID ?? '').trim(),
    clientId: (env.BC_CLIENT_ID ?? '').trim(),
    clientSecret: env.BC_CLIENT_SECRET ?? '',
    environment: (env.BC_ENVIRONMENT ?? '').trim(),
    companyId: (env.BC_COMPANY_ID ?? '').trim(),
    companyName: (env.BC_COMPANY_NAME ?? '').trim(),
    apiBaseUrl: trimSlash(env.BC_API_BASE_URL || 'https://api.businesscentral.dynamics.com'),
    authorityUrl: trimSlash(env.BC_AUTHORITY_URL || 'https://login.microsoftonline.com'),
    scope: env.BC_SCOPE || 'https://api.businesscentral.dynamics.com/.default',
    requestTimeoutMs: int(env.BC_REQUEST_TIMEOUT_MS, 30_000, 1_000, 300_000),
    maxRetries: int(env.BC_MAX_RETRIES, 3, 0, 6),
    pageSize: int(env.BC_PAGE_SIZE, 1_000, 1, 20_000),
    navfarmTenantCode: (env.BC_NAVFARM_TENANT_CODE ?? '').trim(),
    navfarmCompanyCode: (env.BC_NAVFARM_COMPANY_CODE ?? '').trim(),
    vendor: {
      service: (env.BC_VENDOR_SERVICE || 'VendorCardApi').trim(),
      scope: env.BC_VENDOR_SYNC_SCOPE === 'ALL' ? 'ALL' : 'FLAGGED',
      masterSource: env.BC_VENDOR_MASTER_SOURCE === 'BC' ? 'BC' : 'NAVFARM',
      scheduleEnabled: env.BC_VENDOR_SYNC_SCHEDULE_ENABLED === 'true',
      writeBack: env.BC_VENDOR_WRITEBACK_ENABLED === 'true',
      syncStatusSynced: env.BC_VENDOR_SYNC_STATUS_SYNCED ?? '',
      syncStatusError: env.BC_VENDOR_SYNC_STATUS_ERROR ?? '',
      maxDeactivateRatio: Math.min(1, Math.max(0, Number(env.BC_VENDOR_MAX_DEACTIVATE_RATIO ?? '0.5') || 0.5)),
    },
  };
}

/** The settings that must be present before any call is attempted. Empty list = complete. */
export function missingBusinessCentralSettings(config: BusinessCentralConfig): string[] {
  const missing: string[] = [];
  if (!config.tenantId) missing.push('BC_TENANT_ID');
  if (!config.clientId) missing.push('BC_CLIENT_ID');
  if (!config.clientSecret) missing.push('BC_CLIENT_SECRET');
  if (!config.environment) missing.push('BC_ENVIRONMENT');
  return missing;
}

export const BUSINESS_CENTRAL_CONFIG = 'businessCentral';

export default registerAs(BUSINESS_CENTRAL_CONFIG, () => readBusinessCentralConfig());
