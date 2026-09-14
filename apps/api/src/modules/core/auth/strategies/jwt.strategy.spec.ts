import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const dialect = new MySqlDialect();
  const user = { user_id: 'user-1', email: 'person@example.test', full_name: 'Test Person', tenant_id: 'tenant-1', company_id: 'company-1', user_type: 'STANDARD_USER', is_active: true, deleted_at: null as string | null };
  let where: jest.Mock;
  let strategy: JwtStrategy;

  beforeEach(() => {
    user.is_active = true;
    user.deleted_at = null;
    // Returns the row only when the query itself excludes deleted users, so the
    // spec fails if the `deleted_at IS NULL` filter is dropped.
    where = jest.fn((condition) => ({
      limit: async () => {
        const { sql } = dialect.sqlToQuery(condition);
        return sql.includes('`deleted_at` is null') && user.deleted_at !== null ? [] : [user];
      },
    }));
    const db = { select: () => ({ from: () => ({ where }) }) };
    strategy = new JwtStrategy(
      { get: () => undefined } as unknown as ConfigService,
      { get: () => db } as unknown as ClsService,
    );
  });

  it('accepts an active, undeleted user', async () => {
    await expect(strategy.validate({ sub: 'user-1', type: 'access' })).resolves.toMatchObject({ userId: 'user-1' });
    expect(dialect.sqlToQuery(where.mock.calls[0][0]).sql).toContain('`deleted_at` is null');
  });

  it('rejects a soft-deleted user holding a still-valid access token', async () => {
    user.deleted_at = '2026-09-01 00:00:00';
    await expect(strategy.validate({ sub: 'user-1', type: 'access' })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an inactive user and a refresh token', async () => {
    await expect(strategy.validate({ sub: 'user-1', type: 'refresh' })).rejects.toThrow(UnauthorizedException);
    user.is_active = false;
    await expect(strategy.validate({ sub: 'user-1', type: 'access' })).rejects.toThrow(UnauthorizedException);
  });
});
