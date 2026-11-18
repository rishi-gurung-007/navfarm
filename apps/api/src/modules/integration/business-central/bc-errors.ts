/**
 * One error type for everything that can go wrong talking to Business Central, so callers (the future sync queue,
 * the status endpoint) can decide on retry and alerting from `kind` instead of parsing messages.
 */
export type BcErrorKind =
  | 'NOT_CONFIGURED' // BC_ENABLED=false or a required setting is empty
  | 'AUTH_FAILED' // Entra ID refused the token request (bad client id/secret, expired secret, wrong tenant)
  | 'NOT_AUTHORISED' // BC refused the token: app not added/enabled in BC "Microsoft Entra Applications", or no permission set
  | 'FORBIDDEN' // authenticated, but the permission sets do not allow this object
  | 'NOT_FOUND' // environment, company or entity does not exist
  | 'CONFLICT' // ETag mismatch / duplicate key
  | 'VALIDATION' // BC rejected the payload (400)
  | 'THROTTLED' // 429 after all retries
  | 'UNAVAILABLE' // 5xx / timeout / network after all retries
  | 'UNEXPECTED';

export class BcApiError extends Error {
  constructor(
    public readonly kind: BcErrorKind,
    message: string,
    public readonly details: {
      status?: number;
      bcCode?: string;
      correlationId?: string;
      method?: string;
      path?: string;
      attempts?: number;
    } = {},
  ) {
    super(message);
    this.name = 'BcApiError';
  }

  /** Retrying can help only for these. */
  get retryable(): boolean {
    return this.kind === 'THROTTLED' || this.kind === 'UNAVAILABLE';
  }

  /** A short, safe explanation for an administrator — never contains credentials or tokens. */
  get hint(): string {
    switch (this.kind) {
      case 'NOT_CONFIGURED':
        return 'Set BC_ENABLED=true and the BC_* values in apps/api/.env, then restart the API.';
      case 'AUTH_FAILED':
        return 'Entra ID rejected the client credentials. Check BC_TENANT_ID, BC_CLIENT_ID and BC_CLIENT_SECRET, and whether the secret has expired.';
      case 'NOT_AUTHORISED':
        return 'Business Central rejected the app. In BC open "Microsoft Entra Applications", add this Client ID, set State = Enabled, assign permission sets, and use "Grant Consent".';
      case 'FORBIDDEN':
        return 'The app is connected but its BC permission sets do not cover this data. Add the needed permission set to the Entra application in BC.';
      case 'NOT_FOUND':
        return 'Check BC_ENVIRONMENT (name is case-sensitive, e.g. "Production" or a sandbox name) and BC_COMPANY_ID.';
      case 'THROTTLED':
        return 'Business Central is throttling requests. Retry later; reduce request volume or batch reads.';
      case 'UNAVAILABLE':
        return 'Business Central did not respond. Retry later.';
      default:
        return 'See the error message and correlation id; Business Central support can trace the correlation id.';
    }
  }
}
