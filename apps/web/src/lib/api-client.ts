// The browser always talks to the Next.js origin. next.config.js proxies this
// boundary to the private API process, so API port 2877 never needs to be
// reachable from a tester's machine.
export const API_BASE_URL = '/api/v1';
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

export const AUTH_STORAGE = {
  user: 'navfarm_auth_user',
  accessToken: 'navfarm_access_token',
  refreshToken: 'navfarm_refresh_token',
  tenantId: 'navfarm_tenant_id',
} as const;

// A cookie, not localStorage, because middleware.ts runs server-side and
// can't read localStorage — this only signals "a session exists" so the
// edge can redirect unauthenticated requests before any protected UI is
// served. It carries no token material; real auth/authorization is still
// enforced by the API on every request.
const SESSION_COOKIE = 'navfarm_session';

function setSessionCookie() {
  if (typeof document === 'undefined') return;
  document.cookie = `${SESSION_COOKIE}=1; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
}

function clearSessionCookie() {
  if (typeof document === 'undefined') return;
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  tenantId?: string | null;
  retry?: boolean;
};

function stored(key: string): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem(key);
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const obj = payload as { message?: unknown; error?: unknown };
  let candidate: unknown = obj.message ?? obj.error;
  // The API's HttpExceptionFilter nests the real message as `error.message`
  // (e.g. { error: { message: "...", error: "Bad Request", statusCode } }).
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    candidate = (candidate as { message?: unknown }).message ?? candidate;
  }
  if (Array.isArray(candidate)) return candidate.join(', ');
  return typeof candidate === 'string' ? candidate : fallback;
}

// Single canonical list of every localStorage key a session touches.
const SESSION_KEYS = [
  AUTH_STORAGE.user,
  AUTH_STORAGE.accessToken,
  AUTH_STORAGE.refreshToken,
  AUTH_STORAGE.tenantId,
  'active_company_id',
  'active_workspace_scope',
  'active_operational_area_id',
  'active_lob',
  'tenant_company_mode',
] as const;

function clearSession() {
  if (typeof window === 'undefined') return;

  // Best-effort server-side revocation so the refresh token can't mint new
  // access tokens after logout — fire-and-forget, since callers of
  // clearAuthSession() expect it to clear local state synchronously.
  const token = localStorage.getItem(AUTH_STORAGE.accessToken);
  const refreshToken = localStorage.getItem(AUTH_STORAGE.refreshToken);
  const tenantId = localStorage.getItem(AUTH_STORAGE.tenantId);
  if (token && refreshToken) {
    const headers = new Headers({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
    if (tenantId) headers.set('x-tenant-id', tenantId);
    fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ refresh_token: refreshToken }),
      keepalive: true,
    }).catch(() => void 0);
  }

  for (const key of SESSION_KEYS) localStorage.removeItem(key);
  clearSessionCookie();
}

// A hard navigation is the right default for a session that just died — it
// drops every cached client-side store along with it. Exposed as an
// overridable hook so a host that would rather route in-app can swap it.
export const sessionNavigation = {
  toLogin: () => window.location.replace('/login'),
};

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  sessionNavigation.toLogin();
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const refreshToken = stored(AUTH_STORAGE.refreshToken);
    if (!refreshToken) {
      clearSession();
      redirectToLogin();
      throw new ApiError('Your session has expired.', 401);
    }
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const tenantId = stored(AUTH_STORAGE.tenantId);
    if (tenantId) headers.set('x-tenant-id', tenantId);
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.access_token) {
      clearSession();
      // The session is gone, so every page behind it can only render empty
      // state. Send the browser to login instead of leaving a signed-out user
      // looking at a dashboard of zeroes.
      redirectToLogin();
      throw new ApiError(errorMessage(payload, 'Your session has expired.'), response.status, payload);
    }
    localStorage.setItem(AUTH_STORAGE.accessToken, payload.access_token);
    if (payload.refresh_token) {
      localStorage.setItem(AUTH_STORAGE.refreshToken, payload.refresh_token);
    }
    return payload.access_token as string;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, tenantId = stored(AUTH_STORAGE.tenantId), retry = true, ...init } = options;
  const headers = new Headers(init.headers);
  const isFormData = body instanceof FormData || (body && typeof (body as any).append === 'function');
  if (!isFormData) headers.set('Content-Type', 'application/json');
  const token = stored(AUTH_STORAGE.accessToken);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (tenantId) headers.set('x-tenant-id', tenantId);
  const activeCompanyId = stored('active_company_id');
  let userType: string | undefined;
  try { userType = JSON.parse(stored(AUTH_STORAGE.user) || '{}').userType; } catch { /* Authentication handles an invalid stored session. */ }
  const workspaceScope = stored('active_workspace_scope') || (userType === 'TENANT_ADMIN' ? 'TENANT' : ['OPERATIONAL_ADMIN', 'STANDARD_USER'].includes(userType || '') ? 'OPERATIONAL' : 'COMPANY');
  if (workspaceScope) headers.set('x-workspace-scope', workspaceScope);
  if (activeCompanyId && workspaceScope !== 'TENANT') headers.set('x-active-company-id', activeCompanyId);
  else headers.delete('x-active-company-id');
  const activeAreaId = stored('active_operational_area_id');
  if (activeAreaId && (!workspaceScope || workspaceScope === 'OPERATIONAL')) headers.set('x-active-operational-area-id', activeAreaId);
  else headers.delete('x-active-operational-area-id');

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    body: isFormData ? (body as any) : body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && token && retry && path !== '/auth/refresh') {
    const refreshed = await refreshAccessToken();
    headers.set('Authorization', `Bearer ${refreshed}`);
    return apiRequest<T>(path, { ...options, headers, retry: false });
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(errorMessage(payload, `Request failed (${response.status}).`), response.status, payload);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: ApiOptions) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: ApiOptions) => apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: ApiOptions) => apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: ApiOptions) => apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: ApiOptions) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};

export function persistAuthSession(session: {
  access_token: string;
  refresh_token: string;
  user: unknown;
}) {
  localStorage.setItem(AUTH_STORAGE.accessToken, session.access_token);
  localStorage.setItem(AUTH_STORAGE.refreshToken, session.refresh_token);
  localStorage.setItem(AUTH_STORAGE.user, JSON.stringify(session.user));
  const uiLanguage = (session.user as { uiLanguage?: string }).uiLanguage;
  if (uiLanguage) {
    localStorage.setItem('navfarm_lang', uiLanguage);
    window.dispatchEvent(new CustomEvent('navfarm:lang-sync', { detail: uiLanguage }));
  }
  const tenantId = (session.user as { tenantId?: string }).tenantId;
  if (tenantId) {
    localStorage.setItem(AUTH_STORAGE.tenantId, tenantId);
  } else {
    localStorage.removeItem(AUTH_STORAGE.tenantId);
  }
  // Active company/operational-area/workspace-scope are initialized by the
  // caller (AuthContext.login) via the setters in hooks/useAuth, once — not here.
  setSessionCookie();
}

export function clearAuthSession() {
  clearSession();
}
