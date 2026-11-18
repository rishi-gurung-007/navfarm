import { Inject, Injectable, Logger } from '@nestjs/common';
import { BUSINESS_CENTRAL_CONFIG, type BusinessCentralConfig } from './business-central.config';
import { BcApiError, type BcErrorKind } from './bc-errors';
import { BC_FETCH, BcTokenService, type FetchFn } from './bc-token.service';

/**
 * Which Business Central OData endpoint family a call goes to.
 *
 *  standard  /api/v2.0/…                         Microsoft's API v2.0 (companies, accounts, items, vendors, …)
 *  custom    /api/{publisher}/{group}/{version}/… PTL's API pages from the NAVFarm extension (ptl/navfarm/v1.0)
 *  odataV4   /ODataV4/Company('{name}')/…         Pages/queries published as web services in BC
 *
 * Prefer API pages (standard or custom): they are versioned, keyed by SystemId, support webhooks and are faster.
 * Use ODataV4 web services only for a page or query that has no API page.
 */
export type BcEndpoint =
  | { kind: 'standard' }
  | { kind: 'custom'; publisher: string; group: string; version: string }
  | { kind: 'odataV4' };

export const STANDARD_API: BcEndpoint = { kind: 'standard' };
export const NAVFARM_API: BcEndpoint = { kind: 'custom', publisher: 'ptl', group: 'navfarm', version: 'v1.0' };

export interface BcQuery {
  filter?: string;
  select?: string[];
  expand?: string[];
  orderBy?: string;
  top?: number;
  skip?: number;
}

export interface BcRequestOptions {
  endpoint?: BcEndpoint;
  /** Company GUID for API endpoints. Defaults to BC_COMPANY_ID. Pass null for environment-level calls (GET /companies). */
  companyId?: string | null;
  /** Company NAME for ODataV4 web services (they address companies by name). */
  companyName?: string;
  query?: BcQuery;
  body?: unknown;
  /** ETag for PATCH/DELETE (`@odata.etag` from the last GET). Required for updates — use '*' only deliberately. */
  etag?: string;
  /** Safe to repeat after a timeout/5xx (true for GET; set it for POSTs that carry an idempotency key BC enforces). */
  idempotent?: boolean;
  /** Extra headers, e.g. `Prefer`. */
  headers?: Record<string, string>;
}

export interface BcPage<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 30_000;

/** OData string literal: `'O''Brien'`. Use for every user- or data-supplied value in $filter. */
export function odataString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** OData date literal for $filter on Edm.Date: 2026-11-16. */
export function odataDate(value: string | Date): string {
  const d = typeof value === 'string' ? value : value.toISOString();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(d);
  if (!m) throw new BcApiError('VALIDATION', `Not a date: ${value}`);
  return m[1];
}

/** OData DateTimeOffset literal for lastModifiedDateTime filters. */
export function odataDateTime(value: Date): string {
  return value.toISOString();
}

/**
 * Thin, safe client for Business Central's OData APIs.
 *
 * Best practices built in:
 *  - OAuth bearer token from BcTokenService, refreshed once automatically when BC answers 401.
 *  - GETs carry `Data-Access-Intent: ReadOnly`, so BC can serve them from its read-only replica.
 *  - Retries 429/5xx and network errors with exponential back-off + jitter, honouring `Retry-After`.
 *    Non-idempotent writes are NOT retried after an ambiguous failure (timeout/5xx), so nothing can post twice.
 *  - Paging follows `@odata.nextLink` with `Prefer: odata.maxpagesize`.
 *  - Updates require an ETag (`If-Match`), so a concurrent change in BC is never overwritten silently.
 *  - Errors become BcApiError with a kind, BC error code and correlation id; tokens and secrets are never logged.
 */
@Injectable()
export class BcODataClient {
  private readonly logger = new Logger(BcODataClient.name);
  /** Back-off sleep; replaced in tests. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  constructor(
    @Inject(BUSINESS_CENTRAL_CONFIG) private readonly config: BusinessCentralConfig,
    @Inject(BC_FETCH) private readonly fetchFn: FetchFn,
    private readonly tokens: BcTokenService,
  ) {}

  // ---------- URL building ----------

  /** Environment root: https://api.businesscentral.dynamics.com/v2.0/{tenant}/{environment} */
  environmentUrl(): string {
    return `${this.config.apiBaseUrl}/v2.0/${encodeURIComponent(this.config.tenantId)}/${encodeURIComponent(this.config.environment)}`;
  }

  buildUrl(resource: string, options: BcRequestOptions = {}): string {
    const endpoint = options.endpoint ?? STANDARD_API;
    const path = resource.replace(/^\/+/, '');
    let base: string;

    if (endpoint.kind === 'odataV4') {
      const name = options.companyName;
      if (!name) throw new BcApiError('VALIDATION', 'ODataV4 web services need a company name.');
      base = `${this.environmentUrl()}/ODataV4/Company(${encodeURIComponent(odataString(name))})`;
    } else {
      const apiRoot =
        endpoint.kind === 'standard'
          ? `${this.environmentUrl()}/api/v2.0`
          : `${this.environmentUrl()}/api/${endpoint.publisher}/${endpoint.group}/${endpoint.version}`;
      const companyId = options.companyId === undefined ? this.config.companyId : options.companyId;
      if (companyId === null) {
        base = apiRoot;
      } else {
        if (!companyId) throw new BcApiError('NOT_CONFIGURED', 'BC_COMPANY_ID is not set; read GET /companies first.');
        base = `${apiRoot}/companies(${encodeURIComponent(companyId)})`;
      }
    }

    const qs = this.buildQueryString(options.query);
    return `${base}/${path}${qs ? `?${qs}` : ''}`;
  }

  private buildQueryString(query?: BcQuery): string {
    if (!query) return '';
    const parts: string[] = [];
    if (query.filter) parts.push(`$filter=${encodeURIComponent(query.filter)}`);
    if (query.select?.length) parts.push(`$select=${encodeURIComponent(query.select.join(','))}`);
    if (query.expand?.length) parts.push(`$expand=${encodeURIComponent(query.expand.join(','))}`);
    if (query.orderBy) parts.push(`$orderby=${encodeURIComponent(query.orderBy)}`);
    if (query.top != null) parts.push(`$top=${Math.max(0, Math.trunc(query.top))}`);
    if (query.skip != null) parts.push(`$skip=${Math.max(0, Math.trunc(query.skip))}`);
    return parts.join('&');
  }

  // ---------- verbs ----------

  get<T>(resource: string, options: BcRequestOptions = {}): Promise<T> {
    return this.send<T>('GET', this.buildUrl(resource, options), { ...options, idempotent: true });
  }

  /** Every row of a collection, following @odata.nextLink. `maxRows` guards against runaway reads. */
  async getAll<T>(resource: string, options: BcRequestOptions = {}, maxRows = 200_000): Promise<T[]> {
    const rows: T[] = [];
    const prefer = { Prefer: `odata.maxpagesize=${this.config.pageSize}`, ...(options.headers ?? {}) };
    let url: string | undefined = this.buildUrl(resource, options);
    while (url) {
      const page: BcPage<T> = await this.send<BcPage<T>>('GET', url, { ...options, headers: prefer, idempotent: true });
      rows.push(...(page.value ?? []));
      if (rows.length > maxRows) {
        throw new BcApiError('UNEXPECTED', `More than ${maxRows} rows returned for ${resource}; narrow the $filter.`);
      }
      url = page['@odata.nextLink'];
    }
    return rows;
  }

  post<T>(resource: string, body: unknown, options: BcRequestOptions = {}): Promise<T> {
    return this.send<T>('POST', this.buildUrl(resource, options), { ...options, body });
  }

  patch<T>(resource: string, body: unknown, etag: string, options: BcRequestOptions = {}): Promise<T> {
    if (!etag) throw new BcApiError('VALIDATION', 'PATCH needs the record ETag (If-Match).');
    return this.send<T>('PATCH', this.buildUrl(resource, options), { ...options, body, etag, idempotent: true });
  }

  delete(resource: string, etag: string, options: BcRequestOptions = {}): Promise<void> {
    if (!etag) throw new BcApiError('VALIDATION', 'DELETE needs the record ETag (If-Match).');
    return this.send<void>('DELETE', this.buildUrl(resource, options), { ...options, etag, idempotent: true });
  }

  /** Bound action, e.g. postingRequests({id})/Microsoft.NAV.post. Not retried after an ambiguous failure. */
  action<T = unknown>(resource: string, actionName: string, body: unknown = {}, options: BcRequestOptions = {}): Promise<T> {
    return this.post<T>(`${resource.replace(/\/+$/, '')}/Microsoft.NAV.${actionName}`, body, options);
  }

  // ---------- transport ----------

  private async send<T>(method: string, url: string, options: BcRequestOptions & { body?: unknown }): Promise<T> {
    const path = this.safePath(url);
    const maxAttempts = this.config.maxRetries + 1;
    let refreshedAfter401 = false;

    for (let attempt = 1; ; attempt++) {
      const token = await this.tokens.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(options.headers ?? {}),
      };
      if (method === 'GET') headers['Data-Access-Intent'] = 'ReadOnly';
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      if (options.etag) headers['If-Match'] = options.etag;

      const started = Date.now();
      let response: Response;
      try {
        response = await this.fetchFn(url, {
          method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });
      } catch (error) {
        const reason = (error as Error).name === 'TimeoutError' ? 'timed out' : (error as Error).message;
        // A write that timed out may have been applied: only repeat it when it is idempotent.
        if (options.idempotent && attempt < maxAttempts) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw new BcApiError('UNAVAILABLE', `Business Central ${method} ${path} ${reason}.`, { method, path, attempts: attempt });
      }

      this.logger.debug(`BC ${method} ${path} → ${response.status} in ${Date.now() - started} ms (attempt ${attempt})`);

      if (response.ok) {
        if (response.status === 204 || method === 'DELETE') return undefined as T;
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      if (response.status === 401 && !refreshedAfter401) {
        refreshedAfter401 = true;
        await this.tokens.getAccessToken(true);
        continue;
      }

      // 429 and 503 mean BC did not process the request, so even a write may be retried.
      const notProcessed = response.status === 429 || response.status === 503;
      if (RETRYABLE_STATUS.has(response.status) && (options.idempotent || notProcessed) && attempt < maxAttempts) {
        await this.sleep(this.backoff(attempt, response.headers.get('retry-after')));
        continue;
      }

      throw await this.toError(response, method, path, attempt);
    }
  }

  private backoff(attempt: number, retryAfter?: string | null): number {
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return Math.min(MAX_BACKOFF_MS, seconds * 1000);
      const at = Date.parse(retryAfter);
      if (Number.isFinite(at)) return Math.min(MAX_BACKOFF_MS, Math.max(0, at - Date.now()));
    }
    const exp = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1));
    return Math.round(exp / 2 + Math.random() * (exp / 2)); // "equal jitter"
  }

  private async toError(response: Response, method: string, path: string, attempts: number): Promise<BcApiError> {
    const text = await response.text().catch(() => '');
    let bcCode: string | undefined;
    let message = text.slice(0, 500);
    try {
      const json = JSON.parse(text);
      bcCode = json?.error?.code;
      message = json?.error?.message ?? message;
    } catch {
      const code = /<code>([^<]*)<\/code>/.exec(text)?.[1];
      const msg = /<message>([^<]*)<\/message>/.exec(text)?.[1];
      if (code) bcCode = code;
      if (msg) message = msg;
    }
    // Prefer the id BC prints in its message: it is the one BC support asks for.
    const correlationId =
      /CorrelationId:\s*([0-9a-f-]{36})/i.exec(message)?.[1] ??
      response.headers.get('ms-correlation-x') ??
      response.headers.get('request-id') ??
      undefined;

    const kind: BcErrorKind =
      response.status === 401
        ? 'NOT_AUTHORISED'
        : response.status === 403
          ? 'FORBIDDEN'
          : response.status === 404
            ? 'NOT_FOUND'
            : response.status === 409 || response.status === 412
              ? 'CONFLICT'
              : response.status === 400
                ? 'VALIDATION'
                : response.status === 429
                  ? 'THROTTLED'
                  : response.status >= 500
                    ? 'UNAVAILABLE'
                    : 'UNEXPECTED';

    this.logger.warn(`BC ${method} ${path} failed: ${response.status} ${bcCode ?? ''} ${message}`.trim());
    return new BcApiError(kind, `Business Central ${method} ${path} failed (${response.status}${bcCode ? ` ${bcCode}` : ''}): ${message}`, {
      status: response.status,
      bcCode,
      correlationId,
      method,
      path,
      attempts,
    });
  }

  /** Path without host/tenant and without query values, for logs. */
  private safePath(url: string): string {
    try {
      const u = new URL(url);
      const afterEnv = u.pathname.split('/').slice(4).join('/'); // drop /v2.0/{tenant}/{environment}
      return `/${decodeURIComponent(afterEnv)}`;
    } catch {
      return '(invalid url)';
    }
  }
}
