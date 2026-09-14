import { BadRequestException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ClsService } from 'nestjs-cls';
import { getTableName, SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

// The invitation email is sent in the background after a registration; keep it
// off the network.
jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: jest.fn().mockResolvedValue({}) }),
}));

const SECRET = 'auth-spec-secret';
const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const COMPANY = 'company-1';
const PLACEHOLDER_COMPANY = '00000000-0000-0000-0000-000000000000';
const PASSWORD = 'Correct-Horse-1';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

const dialect = new MySqlDialect();

// Evaluates the AND-of-equals / IS NULL conditions the auth queries use against
// in-memory rows, so dropping `deleted_at IS NULL` from a query fails a test
// instead of passing on a mock that returns whatever it was told to.
function rowMatches(row: Record<string, any>, condition: SQL | undefined): boolean {
  if (!condition) return true;
  const { sql, params } = dialect.sqlToQuery(condition);
  if (/ or /i.test(sql)) throw new Error(`Fake database cannot evaluate: ${sql}`);
  let param = 0;
  for (const [, column, op] of sql.matchAll(/`(\w+)` (= \?|is null)/g)) {
    const ok = op === 'is null' ? row[column] == null : row[column] === params[param++];
    if (!ok) return false;
  }
  return true;
}

function fakeDb(tables: Record<string, Record<string, any>[]>) {
  const rowsOf = (table: any) => (tables[getTableName(table)] ??= []);
  const db: any = {
    select: () => {
      let table: any;
      let condition: SQL | undefined;
      let joined = false;
      let max = Infinity;
      const query: any = {
        from: (t: any) => ((table = t), query),
        innerJoin: () => ((joined = true), query),
        leftJoin: () => ((joined = true), query),
        where: (c: SQL) => ((condition = c), query),
        limit: (n: number) => ((max = n), query),
        // Joined reads (permissions, companies, areas) are not what these specs test.
        then: (resolve: any, reject: any) =>
          Promise.resolve()
            .then(() => (joined ? [] : rowsOf(table).filter((r) => rowMatches(r, condition)).slice(0, max)))
            .then(resolve, reject),
      };
      return query;
    },
    insert: (t: any) => ({
      values: (v: any) => {
        const pending: any = Promise.resolve().then(() => {
          rowsOf(t).push(...(Array.isArray(v) ? v : [v]));
        });
        pending.onDuplicateKeyUpdate = () => pending;
        return pending;
      },
    }),
    update: (t: any) => ({
      set: (changes: any) => ({
        where: (c: SQL) =>
          Promise.resolve().then(() => {
            for (const row of rowsOf(t)) if (rowMatches(row, c)) Object.assign(row, changes);
          }),
      }),
    }),
    transaction: (work: (tx: any) => any) => work(db),
  };
  return db;
}

// Same shape toMysqlTimestamp writes: UTC wall-clock time, no zone marker.
const utcTimestampIn = (ms: number) => new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' ');
const parseUtcTimestamp = (value: string) => Date.parse(`${value.replace(' ', 'T')}Z`);

const userRow = (overrides: Record<string, any> = {}) => ({
  user_id: 'user-1',
  tenant_id: TENANT,
  company_id: PLACEHOLDER_COMPANY,
  email: 'person@example.test',
  full_name: 'Test Person',
  password_hash: PASSWORD_HASH,
  user_type: 'STANDARD_USER',
  is_active: true,
  deleted_at: null,
  failed_login_count: 0,
  locked_until: null,
  mfa_enabled: false,
  mfa_secret: null,
  ...overrides,
});

describe('AuthService', () => {
  let tables: Record<string, Record<string, any>[]>;
  let tenantDb: any;
  let masterDb: any;
  let store: Record<string, any>;
  let jwt: JwtService;
  let userDirectory: { lookupTenantId: jest.Mock; index: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    tables = { user_master: [], company_master: [{ company_id: COMPANY, tenant_id: TENANT }] };
    tenantDb = fakeDb(tables);
    masterDb = fakeDb({ tenant_master: [{ tenant_id: TENANT, tenant_name: 'Tenant one', is_active: true, max_users: 10 }] });
    store = { tenantId: TENANT, tenantDb };
    jwt = new JwtService({ secret: SECRET });
    userDirectory = {
      lookupTenantId: jest.fn().mockResolvedValue(TENANT),
      index: jest.fn().mockResolvedValue(undefined),
    };
    service = new AuthService(
      jwt,
      { get: (key: string) => store[key], set: (key: string, value: any) => (store[key] = value) } as unknown as ClsService,
      masterDb,
      { log: jest.fn().mockResolvedValue({}) } as any,
      { getTenantConnection: jest.fn().mockResolvedValue(tenantDb) } as any,
      { decrypt: jest.fn() } as any,
      userDirectory as any,
    );
  });

  describe('registerAdmin', () => {
    const inviteDto = (overrides: Record<string, any> = {}) => ({
      email: 'invitee@example.test',
      password_hash: 'Temporary-Pass-1',
      full_name: 'Invited Person',
      tenant_id: TENANT,
      company_id: COMPANY,
      timezone_pref_id: 'UTC',
      user_type: 'COMPANY_ADMIN',
      ...overrides,
    });
    const bearer = (payload: Record<string, any>, secret = SECRET) =>
      `Bearer ${jwt.sign(payload, { secret })}`;
    const adminAccess = { sub: 'admin-1', tenantId: TENANT, userType: 'TENANT_ADMIN', type: 'access' };
    const invitee = () => tables.user_master.find((u) => u.email === 'invitee@example.test');

    beforeEach(() => {
      tables.user_master.push(userRow({ user_id: 'admin-1', email: 'admin@example.test', user_type: 'TENANT_ADMIN', company_id: COMPANY }));
    });

    it('registers a user for a tenant admin presenting a valid access token', async () => {
      const result = await service.registerAdmin(inviteDto() as any, bearer(adminAccess));
      expect(result).toMatchObject({ email: 'invitee@example.test', user_type: 'COMPANY_ADMIN' });
      expect(invitee()).toMatchObject({ tenant_id: TENANT, user_type: 'COMPANY_ADMIN' });
    });

    it('rejects a token signed with another secret that claims TENANT_ADMIN', async () => {
      await expect(service.registerAdmin(inviteDto() as any, bearer(adminAccess, 'forged-secret'))).rejects.toThrow(UnauthorizedException);
      expect(invitee()).toBeUndefined();
    });

    it('rejects an unsigned (alg none) token', async () => {
      const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
      const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode(adminAccess)}.`;
      await expect(service.registerAdmin(inviteDto() as any, `Bearer ${unsigned}`)).rejects.toThrow(UnauthorizedException);
      expect(invitee()).toBeUndefined();
    });

    it('rejects an expired token and a refresh token', async () => {
      const expired = bearer({ ...adminAccess, exp: Math.floor(Date.now() / 1000) - 60 });
      await expect(service.registerAdmin(inviteDto() as any, expired)).rejects.toThrow(UnauthorizedException);
      await expect(service.registerAdmin(inviteDto() as any, bearer({ ...adminAccess, type: 'refresh' }))).rejects.toThrow(UnauthorizedException);
      expect(invitee()).toBeUndefined();
    });

    it('requires a token once the tenant has users', async () => {
      await expect(service.registerAdmin(inviteDto() as any)).rejects.toThrow(UnauthorizedException);
    });

    it('uses the requester type from user_master, not the token claim', async () => {
      tables.user_master.push(userRow({ user_id: 'operator-1', email: 'operator@example.test', user_type: 'STANDARD_USER' }));
      const claimsAdmin = bearer({ ...adminAccess, sub: 'operator-1' });
      await expect(service.registerAdmin(inviteDto() as any, claimsAdmin)).rejects.toThrow(ForbiddenException);
      expect(invitee()).toBeUndefined();
    });

    it('rejects a deleted or inactive requester', async () => {
      tables.user_master[0].deleted_at = utcTimestampIn(-60_000);
      await expect(service.registerAdmin(inviteDto() as any, bearer(adminAccess))).rejects.toThrow(UnauthorizedException);
      tables.user_master[0].deleted_at = null;
      tables.user_master[0].is_active = false;
      await expect(service.registerAdmin(inviteDto() as any, bearer(adminAccess))).rejects.toThrow(UnauthorizedException);
      expect(invitee()).toBeUndefined();
    });

    it('rejects a requester who belongs to another tenant', async () => {
      tables.user_master.push(userRow({ user_id: 'outsider-1', email: 'outsider@example.test', tenant_id: OTHER_TENANT, user_type: 'TENANT_ADMIN' }));
      const outsider = bearer({ ...adminAccess, sub: 'outsider-1', tenantId: TENANT });
      await expect(service.registerAdmin(inviteDto() as any, outsider)).rejects.toThrow(ForbiddenException);
      expect(invitee()).toBeUndefined();
    });

    it('rejects a body tenant_id that differs from the active tenant workspace', async () => {
      await expect(service.registerAdmin(inviteDto({ tenant_id: OTHER_TENANT }) as any)).rejects.toThrow(BadRequestException);
      expect(invitee()).toBeUndefined();
    });

    it('still enforces the registration hierarchy for a valid requester', async () => {
      tables.user_master.push(userRow({ user_id: 'company-admin-1', email: 'company.admin@example.test', user_type: 'COMPANY_ADMIN' }));
      const companyAdmin = bearer({ ...adminAccess, sub: 'company-admin-1', userType: 'COMPANY_ADMIN' });
      await expect(service.registerAdmin(inviteDto({ user_type: 'COMPANY_ADMIN' }) as any, companyAdmin)).rejects.toThrow(BadRequestException);
    });

    it('bootstraps the first user of an empty tenant without a token, as TENANT_ADMIN', async () => {
      tables.user_master.length = 0;
      const result = await service.registerAdmin(inviteDto({ user_type: 'STANDARD_USER' }) as any);
      expect(result).toMatchObject({ email: 'invitee@example.test', user_type: 'TENANT_ADMIN' });
      expect(invitee()).toMatchObject({ tenant_id: TENANT, user_type: 'TENANT_ADMIN' });
    });
  });

  describe('login', () => {
    const attempt = async (password: string, email = 'person@example.test'): Promise<any> => {
      try {
        return await service.login({ email, password } as any);
      } catch (err) {
        return err;
      }
    };
    const row = () => tables.user_master[0];

    beforeEach(() => {
      tables.user_master.push(userRow());
    });

    it('signs in with the right password and resets the failure count', async () => {
      row().failed_login_count = 3;
      const result = await attempt(PASSWORD);
      expect(result.access_token).toEqual(expect.any(String));
      expect(row()).toMatchObject({ failed_login_count: 0, locked_until: null });
    });

    it('answers an unknown email and a wrong password identically', async () => {
      userDirectory.lookupTenantId.mockResolvedValueOnce(null);
      const unknown = await attempt(PASSWORD, 'nobody@example.test');
      const wrong = await attempt('Wrong-Password-1');
      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect((unknown as HttpException).getStatus()).toBe((wrong as HttpException).getStatus());
      expect(unknown.message).toBe(wrong.message);
    });

    it('locks the account after 5 failures and honours the lock', async () => {
      for (let i = 0; i < 5; i++) {
        expect(await attempt('Wrong-Password-1')).toBeInstanceOf(UnauthorizedException);
      }
      expect(row().failed_login_count).toBe(5);
      // Written in UTC: read back as UTC it lies about 15 minutes ahead.
      const msAhead = parseUtcTimestamp(row().locked_until) - Date.now();
      expect(msAhead).toBeGreaterThan(14 * 60_000);
      expect(msAhead).toBeLessThanOrEqual(15 * 60_000);

      const whileLocked = await attempt(PASSWORD);
      expect(whileLocked).toBeInstanceOf(UnauthorizedException);
      expect(tables.user_session ?? []).toHaveLength(0);
    });

    it('honours a lock stored as a UTC timestamp, whatever the server time zone', async () => {
      row().failed_login_count = 5;
      row().locked_until = utcTimestampIn(10 * 60_000);
      const lockedUntil = row().locked_until;

      const right = await attempt(PASSWORD);
      const wrong = await attempt('Wrong-Password-1');
      // A correct password during the lock must not be distinguishable from a wrong one.
      expect(right).toBeInstanceOf(UnauthorizedException);
      expect(right.message).toBe(wrong.message);
      // Attempts during the lock neither count nor extend it.
      expect(row()).toMatchObject({ failed_login_count: 5, locked_until: lockedUntil });
    });

    it('starts a fresh count once a lock has expired', async () => {
      row().failed_login_count = 5;
      row().locked_until = utcTimestampIn(-60_000);
      expect(await attempt('Wrong-Password-1')).toBeInstanceOf(UnauthorizedException);
      expect(row()).toMatchObject({ failed_login_count: 1, locked_until: null });
    });

    it('does not let a soft-deleted user sign in', async () => {
      row().deleted_at = utcTimestampIn(-60_000);
      userDirectory.lookupTenantId.mockResolvedValueOnce(null);
      const deleted = await attempt(PASSWORD);
      userDirectory.lookupTenantId.mockResolvedValueOnce(null);
      const unknown = await attempt(PASSWORD, 'nobody@example.test');
      expect(deleted).toBeInstanceOf(UnauthorizedException);
      expect(deleted.message).toBe(unknown.message);
    });

    it('reveals an inactive account only after the correct password', async () => {
      row().is_active = false;
      const wrong = await attempt('Wrong-Password-1');
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect(wrong.message).not.toMatch(/inactive|disabled/i);

      const right = await attempt(PASSWORD);
      expect(right).toBeInstanceOf(ForbiddenException);
      expect(right.message).toMatch(/inactive or disabled/);
    });

    it('reveals a suspended tenant only after the correct password', async () => {
      masterDb.select = fakeDb({ tenant_master: [{ tenant_id: TENANT, tenant_name: 'Tenant one', is_active: false }] }).select;
      const wrong = await attempt('Wrong-Password-1');
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect(wrong.message).not.toMatch(/suspended/i);

      const right = await attempt(PASSWORD);
      expect(right).toBeInstanceOf(ForbiddenException);
      expect(right.message).toMatch(/suspended/);
    });
  });

  describe('verifyMfa', () => {
    it('gives one answer for an unknown account and one without MFA', async () => {
      tables.user_master.push(userRow({ mfa_enabled: false }));
      const unknown = await service.verifyMfa({ email: 'nobody@example.test', code: '123456' } as any).catch((e) => e);
      const noMfa = await service.verifyMfa({ email: 'person@example.test', code: '123456' } as any).catch((e) => e);
      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect(noMfa).toBeInstanceOf(UnauthorizedException);
      expect(unknown.message).toBe(noMfa.message);
    });
  });

  describe('refreshToken', () => {
    const issueRefresh = async () => {
      // login() can also answer with the MFA-required shape, which has no tokens; this account has no MFA.
      const { refresh_token } = (await service.login({ email: 'person@example.test', password: PASSWORD } as any)) as { refresh_token: string };
      // The fake database does not generate keys; rotation revokes by session_id.
      tables.user_session[0].session_id = 'session-1';
      return refresh_token as string;
    };

    beforeEach(() => {
      tables.user_master.push(userRow());
    });

    it('accepts a session whose UTC expiry is still ahead', async () => {
      const token = await issueRefresh();
      // Two hours ahead in UTC is already past if misread as Asia/Calcutta local time.
      tables.user_session[0].expires_at = utcTimestampIn(2 * 60 * 60_000);
      await expect(service.refreshToken(token)).resolves.toMatchObject({ access_token: expect.any(String) });
    });

    it('rejects a soft-deleted user', async () => {
      const token = await issueRefresh();
      tables.user_master[0].deleted_at = utcTimestampIn(-60_000);
      await expect(service.refreshToken(token)).rejects.toThrow(UnauthorizedException);
    });
  });
});
