import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as mysql from 'mysql2/promise';
import { DatabaseModule, MASTER_CONNECTION } from './database.module';
import databaseConfig from '../../config/database.config';

jest.mock('mysql2/promise', () => ({ createPool: jest.fn(() => ({ end: jest.fn() })) }));

/**
 * The master connection is the registry the tenant middleware reads to decide
 * which tenant database to open, so it is the first place isolation can be
 * lost: database.config.ts falls back to root@localhost with no password and
 * a 'navfarm_db' database name. Under NAVFARM_DB_ALLOWLIST the master
 * database must be named explicitly or the API must refuse to start.
 */
describe('MASTER_CONNECTION under NAVFARM_DB_ALLOWLIST', () => {
  const createPool = mysql.createPool as jest.Mock;

  beforeEach(() => createPool.mockClear());
  afterEach(() => {
    delete process.env.NAVFARM_DB_ALLOWLIST;
    delete process.env.DATABASE_NAME;
  });

  const build = () =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [databaseConfig] }),
        DatabaseModule,
      ],
    })
      .compile()
      .then((m) => m.get(MASTER_CONNECTION));

  it('refuses a master database that is not on the allowlist', async () => {
    process.env.NAVFARM_DB_ALLOWLIST = 'nf_uat_master_20261010';
    process.env.DATABASE_NAME = 'nf_master';

    await expect(build()).rejects.toThrow("Refusing to connect to database 'nf_master'");
  });

  it('does not open a pool for a master database that is not on the allowlist', async () => {
    process.env.NAVFARM_DB_ALLOWLIST = 'nf_uat_master_20261010';
    process.env.DATABASE_NAME = 'nf_master';

    await build().catch(() => undefined);

    expect(createPool).not.toHaveBeenCalled();
  });

  it('opens the master pool when the database is on the allowlist', async () => {
    process.env.NAVFARM_DB_ALLOWLIST = 'nf_uat_master_20261010';
    process.env.DATABASE_NAME = 'nf_uat_master_20261010';

    await build();

    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({ database: 'nf_uat_master_20261010' }),
    );
  });
});
