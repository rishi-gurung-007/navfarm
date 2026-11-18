import { readBusinessCentralConfig, type BusinessCentralConfig } from './business-central.config';
import { BcApiError } from './bc-errors';
import { BcODataClient, NAVFARM_API, odataDate, odataString } from './bc-odata.client';
import { BcTokenService } from './bc-token.service';

const config = (over: Partial<BusinessCentralConfig> = {}): BusinessCentralConfig => ({
  ...readBusinessCentralConfig({
    BC_ENABLED: 'true',
    BC_TENANT_ID: 'tenant-1',
    BC_CLIENT_ID: 'client-1',
    BC_CLIENT_SECRET: 'secret-1',
    BC_ENVIRONMENT: 'Sandbox',
    BC_COMPANY_ID: 'c0ffee00-0000-0000-0000-000000000001',
  }),
  ...over,
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const tokenResponse = (token = 'tok-1', expiresIn = 3600) => json(200, { access_token: token, expires_in: expiresIn, token_type: 'Bearer' });

const isTokenCall = (url: string) => url.includes('/oauth2/v2.0/token');

function setup(responses: Array<(url: string, init: RequestInit) => Response>, cfg = config()) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetchFn = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (isTokenCall(url)) return tokenResponse(`tok-${calls.filter((c) => isTokenCall(c.url)).length}`);
    const next = responses[i++];
    if (!next) throw new Error(`unexpected call ${url}`);
    return next(url, init ?? {});
  }) as unknown as typeof fetch;
  const tokens = new BcTokenService(cfg, fetchFn);
  const client = new BcODataClient(cfg, fetchFn, tokens);
  client.sleep = jest.fn(async () => undefined);
  const apiCalls = () => calls.filter((c) => !isTokenCall(c.url));
  const tokenCalls = () => calls.filter((c) => isTokenCall(c.url));
  return { client, tokens, apiCalls, tokenCalls, fetchFn };
}

describe('Business Central config', () => {
  it('is disabled unless BC_ENABLED is exactly "true", and trims URLs', () => {
    expect(readBusinessCentralConfig({}).enabled).toBe(false);
    expect(readBusinessCentralConfig({ BC_ENABLED: 'yes' }).enabled).toBe(false);
    expect(readBusinessCentralConfig({ BC_API_BASE_URL: 'https://x.example/' }).apiBaseUrl).toBe('https://x.example');
    expect(readBusinessCentralConfig({ BC_MAX_RETRIES: '99' }).maxRetries).toBe(6);
  });
});

describe('BcTokenService', () => {
  it('sends client credentials in the body and caches the token', async () => {
    const { tokens, tokenCalls } = setup([]);
    expect(await tokens.getAccessToken()).toBe('tok-1');
    expect(await tokens.getAccessToken()).toBe('tok-1');
    expect(tokenCalls()).toHaveLength(1);
    const body = String(tokenCalls()[0].init.body);
    expect(tokenCalls()[0].url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain('client_secret=secret-1');
    expect(body).toContain('scope=https%3A%2F%2Fapi.businesscentral.dynamics.com%2F.default');
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const { tokens, tokenCalls } = setup([]);
    await Promise.all([tokens.getAccessToken(), tokens.getAccessToken(), tokens.getAccessToken()]);
    expect(tokenCalls()).toHaveLength(1);
  });

  it('refreshes 5 minutes before expiry', async () => {
    const { tokens, tokenCalls } = setup([]);
    let now = 1_000_000;
    tokens.now = () => now;
    await tokens.getAccessToken();
    now += (3600 - 299) * 1000; // inside the 5-minute skew
    expect(await tokens.getAccessToken()).toBe('tok-2');
    expect(tokenCalls()).toHaveLength(2);
  });

  it('reports Entra rejection as AUTH_FAILED without leaking the secret', async () => {
    const fetchFn = jest.fn(async () =>
      json(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x' }),
    ) as unknown as typeof fetch;
    const tokens = new BcTokenService(config(), fetchFn);
    const error = await tokens.getAccessToken().catch((e) => e);
    expect(error).toBeInstanceOf(BcApiError);
    expect(error.kind).toBe('AUTH_FAILED');
    expect(error.message).toContain('AADSTS7000215');
    expect(error.message).not.toContain('secret-1');
  });

  it('refuses to call anything when disabled', async () => {
    const fetchFn = jest.fn() as unknown as typeof fetch;
    const tokens = new BcTokenService(config({ enabled: false }), fetchFn);
    await expect(tokens.getAccessToken()).rejects.toMatchObject({ kind: 'NOT_CONFIGURED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('BcODataClient URLs and literals', () => {
  const { client } = setup([]);
  const env = 'https://api.businesscentral.dynamics.com/v2.0/tenant-1/Sandbox';

  it('builds standard, custom, environment-level and ODataV4 URLs', () => {
    expect(client.buildUrl('items')).toBe(`${env}/api/v2.0/companies(c0ffee00-0000-0000-0000-000000000001)/items`);
    expect(client.buildUrl('companies', { companyId: null })).toBe(`${env}/api/v2.0/companies`);
    expect(client.buildUrl('farmItems', { endpoint: NAVFARM_API })).toBe(
      `${env}/api/ptl/navfarm/v1.0/companies(c0ffee00-0000-0000-0000-000000000001)/farmItems`,
    );
    expect(client.buildUrl('Chart_of_Accounts', { endpoint: { kind: 'odataV4' }, companyName: "Triple C's" })).toBe(
      `${env}/ODataV4/Company('Triple%20C''s')/Chart_of_Accounts`,
    );
  });

  it('encodes query options', () => {
    const url = client.buildUrl('accounts', {
      query: { filter: `number eq ${odataString("O'Neil")}`, select: ['id', 'number'], top: 5 },
    });
    expect(url).toContain(`$filter=${encodeURIComponent("number eq 'O''Neil'")}`);
    expect(url).toContain('$select=id%2Cnumber');
    expect(url).toContain('$top=5');
  });

  it('formats dates and rejects junk', () => {
    expect(odataDate('2026-11-16T10:00:00Z')).toBe('2026-11-16');
    expect(() => odataDate('nope')).toThrow(BcApiError);
  });
});

describe('BcODataClient transport', () => {
  it('sends bearer token and ReadOnly intent on GET', async () => {
    const { client, apiCalls } = setup([() => json(200, { value: [] })]);
    await client.get('items');
    const headers = apiCalls()[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-1');
    expect(headers['Data-Access-Intent']).toBe('ReadOnly');
  });

  it('retries 429 honouring Retry-After, then succeeds', async () => {
    const { client, apiCalls } = setup([
      () => json(429, { error: { code: 'TooManyRequests', message: 'slow down' } }, { 'retry-after': '2' }),
      () => json(200, { value: [1] }),
    ]);
    await expect(client.get('items')).resolves.toEqual({ value: [1] });
    expect(apiCalls()).toHaveLength(2);
    expect(client.sleep).toHaveBeenCalledWith(2000);
  });

  it('does not repeat a POST after an ambiguous 502, so nothing posts twice', async () => {
    const { client, apiCalls } = setup([() => json(502, { error: { code: 'BadGateway', message: 'gateway' } })]);
    await expect(client.post('postingRequests', { a: 1 }, { endpoint: NAVFARM_API })).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    expect(apiCalls()).toHaveLength(1);
  });

  it('does repeat a POST after 429 (BC did not process it)', async () => {
    const { client, apiCalls } = setup([() => json(429, {}), () => json(201, { id: 'x' })]);
    await expect(client.post('postingRequests', {}, { endpoint: NAVFARM_API })).resolves.toEqual({ id: 'x' });
    expect(apiCalls()).toHaveLength(2);
  });

  it('refreshes the token once on 401, then reports NOT_AUTHORISED with the correlation id', async () => {
    const rejected = () =>
      json(401, {
        error: {
          code: 'Authentication_InvalidCredentials',
          message: 'The server has rejected the client credentials.  CorrelationId:  c1bb5981-5ec5-4abf-91eb-cb2907d11531.',
        },
      });
    const { client, tokenCalls, apiCalls } = setup([rejected, rejected]);
    const error = await client.get('companies', { companyId: null }).catch((e) => e);
    expect(tokenCalls()).toHaveLength(2);
    expect(apiCalls()).toHaveLength(2);
    expect(error.kind).toBe('NOT_AUTHORISED');
    expect(error.details.bcCode).toBe('Authentication_InvalidCredentials');
    expect(error.details.correlationId).toBe('c1bb5981-5ec5-4abf-91eb-cb2907d11531');
    expect(error.hint).toContain('Microsoft Entra Applications');
  });

  it('parses the XML error BC returns for an unknown environment', async () => {
    const { client } = setup([
      () =>
        new Response('<error xmlns="http://docs.oasis-open.org/odata/ns/metadata"><code>NoEnvironment</code><message>Environment does not exist.</message></error>', {
          status: 404,
        }),
    ]);
    await expect(client.get('companies', { companyId: null })).rejects.toMatchObject({
      kind: 'NOT_FOUND',
      details: expect.objectContaining({ bcCode: 'NoEnvironment' }),
    });
  });

  it('follows @odata.nextLink and asks for the configured page size', async () => {
    const { client, apiCalls } = setup([
      () => json(200, { value: [{ n: 1 }, { n: 2 }], '@odata.nextLink': 'https://api.businesscentral.dynamics.com/v2.0/tenant-1/Sandbox/api/v2.0/items?$skiptoken=abc' }),
      () => json(200, { value: [{ n: 3 }] }),
    ]);
    await expect(client.getAll('items')).resolves.toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(apiCalls()[1].url).toContain('$skiptoken=abc');
    expect((apiCalls()[0].init.headers as Record<string, string>).Prefer).toBe('odata.maxpagesize=1000');
  });

  it('requires an ETag to update and sends If-Match', async () => {
    const { client, apiCalls } = setup([() => json(200, { id: 'x' })]);
    expect(() => client.patch('items(x)', {}, '')).toThrow(BcApiError);
    await client.patch('items(x)', { description: 'd' }, 'W/"abc"');
    expect((apiCalls()[0].init.headers as Record<string, string>)['If-Match']).toBe('W/"abc"');
  });

  it('calls bound actions under Microsoft.NAV', async () => {
    const { client, apiCalls } = setup([() => new Response(null, { status: 204 })]);
    await client.action('postingRequests(abc)', 'post', {}, { endpoint: NAVFARM_API });
    expect(apiCalls()[0].url).toMatch(/postingRequests\(abc\)\/Microsoft\.NAV\.post$/);
  });
});
