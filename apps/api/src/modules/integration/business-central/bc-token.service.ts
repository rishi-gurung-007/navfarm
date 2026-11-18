import { Inject, Injectable, Logger } from '@nestjs/common';
import { BUSINESS_CENTRAL_CONFIG, type BusinessCentralConfig, missingBusinessCentralSettings } from './business-central.config';
import { BcApiError } from './bc-errors';

export const BC_FETCH = Symbol('BC_FETCH');
export type FetchFn = typeof fetch;

/** Refresh this long before Entra's expiry so a token never expires mid-request. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * OAuth 2.0 client-credentials tokens for Business Central.
 *
 * - One token is cached in memory and reused until 5 minutes before it expires (Entra issues ~60-minute tokens).
 * - Concurrent callers share one in-flight request ("single flight"), so a burst of calls never fetches N tokens.
 * - The secret is sent in the request body (Entra's "client credentials in body") over HTTPS and is never logged.
 */
@Injectable()
export class BcTokenService {
  private readonly logger = new Logger(BcTokenService.name);
  private cached: CachedToken | null = null;
  private inFlight: Promise<CachedToken> | null = null;
  /** Clock; replaced in tests. */
  now: () => number = () => Date.now();

  constructor(
    @Inject(BUSINESS_CENTRAL_CONFIG) private readonly config: BusinessCentralConfig,
    @Inject(BC_FETCH) private readonly fetchFn: FetchFn,
  ) {}

  assertConfigured(): void {
    if (!this.config.enabled) {
      throw new BcApiError('NOT_CONFIGURED', 'Business Central integration is disabled (BC_ENABLED is not true).');
    }
    const missing = missingBusinessCentralSettings(this.config);
    if (missing.length) {
      throw new BcApiError('NOT_CONFIGURED', `Business Central settings missing: ${missing.join(', ')}.`);
    }
  }

  /** A valid access token. `forceRefresh` drops the cache (used once after BC answers 401). */
  async getAccessToken(forceRefresh = false): Promise<string> {
    this.assertConfigured();
    if (forceRefresh) this.cached = null;
    if (this.cached && this.cached.expiresAt - EXPIRY_SKEW_MS > this.now()) return this.cached.accessToken;
    if (!this.inFlight) {
      this.inFlight = this.requestToken().finally(() => {
        this.inFlight = null;
      });
    }
    this.cached = await this.inFlight;
    return this.cached.accessToken;
  }

  /** Forget the cached token (e.g. after the secret is rotated). */
  invalidate(): void {
    this.cached = null;
  }

  /** When the cached token expires, for the status page. Null when nothing is cached. */
  get cachedTokenExpiresAt(): Date | null {
    return this.cached ? new Date(this.cached.expiresAt) : null;
  }

  private async requestToken(): Promise<CachedToken> {
    const url = `${this.config.authorityUrl}/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scope,
    });

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      throw new BcApiError('UNAVAILABLE', `Token endpoint unreachable: ${(error as Error).message}`, { path: 'oauth2/v2.0/token' });
    }

    const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok || typeof payload.access_token !== 'string') {
      // Entra's error_description is safe to surface (it names the AADSTS code, not the secret).
      const code = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
      const description = typeof payload.error_description === 'string' ? payload.error_description.split('\r\n')[0] : '';
      this.logger.warn(`Entra token request failed: ${code} ${description}`);
      const kind = response.status >= 500 ? 'UNAVAILABLE' : 'AUTH_FAILED';
      throw new BcApiError(kind, `Entra ID token request failed: ${code}${description ? ` — ${description}` : ''}`, {
        status: response.status,
        bcCode: code,
        correlationId: payload.correlation_id,
        path: 'oauth2/v2.0/token',
      });
    }

    const expiresInSec = Number(payload.expires_in) || 3600;
    return { accessToken: payload.access_token, expiresAt: this.now() + expiresInSec * 1000 };
  }
}
