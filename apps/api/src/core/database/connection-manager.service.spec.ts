import { ConnectionManagerService } from './connection-manager.service';
import * as mysql from 'mysql2/promise';

jest.mock('mysql2/promise', () => ({ createPool: jest.fn() }));

const RETAINED = {
  tenant_id: 'e6329a9e-8915-4600-982e-d11313de12b0',
  db_host: '127.0.0.1',
  db_port: 3306,
  db_name: 'nf_devco',
  db_user: 'root',
};

/**
 * The tenant pool is opened from whatever db_name the master registry row
 * carries, so a retained registry routes the API into retained data. Under
 * NAVFARM_DB_ALLOWLIST the refusal has to land before the pool exists —
 * mysql.createPool must never be reached for a database that is not allowed.
 */
describe('ConnectionManagerService under NAVFARM_DB_ALLOWLIST', () => {
  const createPool = mysql.createPool as jest.Mock;
  let service: ConnectionManagerService;

  beforeEach(() => {
    createPool.mockReset();
    process.env.NAVFARM_DB_ALLOWLIST = 'nf_uat_tenant_20261010';
    service = new ConnectionManagerService();
  });

  afterEach(() => {
    delete process.env.NAVFARM_DB_ALLOWLIST;
  });

  it('refuses a tenant database that is not on the allowlist', async () => {
    await expect(service.getTenantConnection(RETAINED)).rejects.toThrow(
      "Refusing to connect to database 'nf_devco'",
    );
  });

  it('does not open a pool for a database that is not on the allowlist', async () => {
    await service.getTenantConnection(RETAINED).catch(() => undefined);

    expect(createPool).not.toHaveBeenCalled();
  });
});
