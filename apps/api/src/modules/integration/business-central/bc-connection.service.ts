import { Inject, Injectable } from '@nestjs/common';
import { BUSINESS_CENTRAL_CONFIG, type BusinessCentralConfig, missingBusinessCentralSettings } from './business-central.config';
import { BcApiError } from './bc-errors';
import { BcODataClient, STANDARD_API } from './bc-odata.client';
import { BcTokenService } from './bc-token.service';

export interface BcCompany {
  id: string;
  name: string;
  displayName: string;
  businessProfileId?: string;
  systemVersion?: string;
}

export interface BcCheckStep {
  step: 'configuration' | 'token' | 'environment' | 'company';
  ok: boolean;
  message: string;
  hint?: string;
  correlationId?: string;
}

export interface BcConnectionStatus {
  enabled: boolean;
  environment: string;
  tenantId: string;
  clientId: string;
  companyId: string | null;
  connected: boolean;
  checkedAt: string;
  tokenExpiresAt: string | null;
  steps: BcCheckStep[];
  companies: BcCompany[];
}

/**
 * Answers "can NAVFarm talk to Business Central, and if not, why?" in plain steps an administrator can act on.
 * Read-only: it requests a token and lists companies. It never writes to BC.
 */
@Injectable()
export class BcConnectionService {
  constructor(
    @Inject(BUSINESS_CENTRAL_CONFIG) private readonly config: BusinessCentralConfig,
    private readonly tokens: BcTokenService,
    private readonly client: BcODataClient,
  ) {}

  listCompanies(): Promise<BcCompany[]> {
    return this.client.getAll<BcCompany>('companies', {
      endpoint: STANDARD_API,
      companyId: null,
      query: { select: ['id', 'name', 'displayName', 'businessProfileId', 'systemVersion'] },
    });
  }

  async check(): Promise<BcConnectionStatus> {
    const status: BcConnectionStatus = {
      enabled: this.config.enabled,
      environment: this.config.environment,
      tenantId: this.config.tenantId,
      clientId: this.config.clientId,
      companyId: this.config.companyId || null,
      connected: false,
      checkedAt: new Date().toISOString(),
      tokenExpiresAt: null,
      steps: [],
      companies: [],
    };

    const missing = missingBusinessCentralSettings(this.config);
    if (!this.config.enabled || missing.length) {
      const error = new BcApiError(
        'NOT_CONFIGURED',
        !this.config.enabled ? 'Integration is disabled (BC_ENABLED is not true).' : `Missing settings: ${missing.join(', ')}.`,
      );
      status.steps.push({ step: 'configuration', ok: false, message: error.message, hint: error.hint });
      return status;
    }
    status.steps.push({ step: 'configuration', ok: true, message: 'All required settings are present.' });

    try {
      await this.tokens.getAccessToken(true);
      status.tokenExpiresAt = this.tokens.cachedTokenExpiresAt?.toISOString() ?? null;
      status.steps.push({ step: 'token', ok: true, message: 'Entra ID issued an access token for Business Central.' });
    } catch (error) {
      status.steps.push(this.failed('token', error));
      return status;
    }

    try {
      status.companies = await this.listCompanies();
      status.steps.push({
        step: 'environment',
        ok: true,
        message: `Environment "${this.config.environment}" answered with ${status.companies.length} compan${status.companies.length === 1 ? 'y' : 'ies'}.`,
      });
    } catch (error) {
      status.steps.push(this.failed('environment', error));
      return status;
    }

    if (!this.config.companyId) {
      status.steps.push({
        step: 'company',
        ok: false,
        message: 'BC_COMPANY_ID is not set.',
        hint: 'Copy the id of the Triple C company from the list below into BC_COMPANY_ID and restart the API.',
      });
      return status;
    }
    const company = status.companies.find((c) => c.id.toLowerCase() === this.config.companyId.toLowerCase());
    if (!company) {
      status.steps.push({
        step: 'company',
        ok: false,
        message: `BC_COMPANY_ID ${this.config.companyId} is not a company in "${this.config.environment}".`,
        hint: 'Use one of the company ids listed below.',
      });
      return status;
    }
    status.steps.push({ step: 'company', ok: true, message: `Company "${company.displayName || company.name}" selected.` });
    status.connected = true;
    return status;
  }

  private failed(step: BcCheckStep['step'], error: unknown): BcCheckStep {
    if (error instanceof BcApiError) {
      return { step, ok: false, message: error.message, hint: error.hint, correlationId: error.details.correlationId };
    }
    return { step, ok: false, message: (error as Error)?.message ?? String(error) };
  }
}
