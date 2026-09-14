import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { RoleService, RoleRequester } from './role.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';

const COMPANY = '22222222-2222-4222-8222-222222222222';
const OTHER_COMPANY = '33333333-3333-4333-8333-333333333333';

describe('RoleService assignment authority', () => {
  // Every select resolves the next queued row set; writes resolve nothing.
  let selectResults: unknown[][];
  const selectChain: any = {};
  for (const m of ['from', 'where', 'limit', 'leftJoin', 'innerJoin']) selectChain[m] = () => selectChain;
  selectChain.then = (resolve: any, reject: any) => Promise.resolve(selectResults.shift() ?? []).then(resolve, reject);
  const writeChain: any = {
    set: () => writeChain,
    values: () => writeChain,
    where: () => writeChain,
    then: (resolve: any, reject: any) => Promise.resolve(undefined).then(resolve, reject),
  };
  const db: any = {
    select: jest.fn(() => selectChain),
    insert: jest.fn(() => writeChain),
    update: jest.fn(() => writeChain),
    delete: jest.fn(() => writeChain),
    transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };

  let service: RoleService;
  const as = (userType: string, userId = 'requester-1'): RoleRequester => ({ userId, userType });
  const role = (role_code: string, company_id: string | null = COMPANY) => ({ role_id: 'role-1', role_code, company_id, is_system_role: true });
  const user = (user_type: string, company_id: string | null = COMPANY, user_id = 'target-1') => ({ user_id, user_type, company_id });

  beforeEach(() => {
    selectResults = [];
    db.insert.mockClear();
    db.update.mockClear();
    db.delete.mockClear();
    service = new RoleService(
      { get: () => db } as unknown as ClsService,
      { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService,
    );
  });

  describe('assignRoleToUser', () => {
    it('refuses a company admin handing a standard user SUPER_ADMIN', async () => {
      selectResults.push([role('SUPER_ADMIN')], [user('STANDARD_USER')]);
      await expect(service.assignRoleToUser('target-1', 'role-1', as('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('refuses a custom role that grants ALL, even under another name', async () => {
      selectResults.push([role('BACKDOOR')], [user('STANDARD_USER')], [{ id: 'perm-all' }]);
      await expect(service.assignRoleToUser('target-1', 'role-1', as('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('lets a company admin give a standard user a bounded role', async () => {
      selectResults.push([role('MANAGER')], [user('STANDARD_USER')], [], [{ assign_id: 'a-1' }]);
      await expect(service.assignRoleToUser('target-1', 'role-1', as('COMPANY_ADMIN'))).resolves.toEqual({ assign_id: 'a-1' });
      expect(db.insert).toHaveBeenCalled();
    });

    it('lets a tenant admin assign SUPER_ADMIN', async () => {
      selectResults.push([role('SUPER_ADMIN')], [user('COMPANY_ADMIN')], [{ assign_id: 'a-2' }]);
      await expect(service.assignRoleToUser('target-1', 'role-1', as('TENANT_ADMIN'))).resolves.toEqual({ assign_id: 'a-2' });
    });

    it('refuses changing your own role', async () => {
      selectResults.push([role('MANAGER')], [user('OPERATIONAL_ADMIN', COMPANY, 'requester-1')]);
      await expect(service.assignRoleToUser('requester-1', 'role-1', as('OPERATIONAL_ADMIN'))).rejects.toThrow(ForbiddenException);
    });

    it('refuses a peer or a higher admin as the target', async () => {
      selectResults.push([role('MANAGER')], [user('COMPANY_ADMIN')]);
      await expect(service.assignRoleToUser('target-1', 'role-1', as('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
      selectResults.push([role('MANAGER')], [user('TENANT_ADMIN')]);
      await expect(service.assignRoleToUser('target-1', 'role-1', as('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
    });

    it("refuses a role from a company the user is not part of", async () => {
      // role, target, no ALL grant, no assignment to the role's company
      selectResults.push([role('MANAGER', OTHER_COMPANY)], [user('STANDARD_USER')], [], []);
      await expect(service.assignRoleToUser('target-1', 'role-1', as('COMPANY_ADMIN'))).rejects.toThrow(BadRequestException);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('unassignRole', () => {
    it("refuses removing a tenant admin's role", async () => {
      selectResults.push([{ assign_id: 'a-1', user_id: 'target-1' }], [user('TENANT_ADMIN')]);
      await expect(service.unassignRole('a-1', as('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
      expect(db.update).not.toHaveBeenCalled();
    });

    it("allows removing a standard user's role", async () => {
      selectResults.push([{ assign_id: 'a-1', user_id: 'target-1' }], [user('STANDARD_USER')]);
      await expect(service.unassignRole('a-1', as('COMPANY_ADMIN'))).resolves.toMatchObject({ success: true });
    });
  });

  describe('updateRolePermissions', () => {
    const customRole = { role_id: 'role-9', role_code: 'FARM_SUPERVISOR', company_id: COMPANY, is_system_role: false };

    it('refuses a company admin writing an ALL wildcard onto a custom role', async () => {
      selectResults.push([customRole]);
      await expect(service.updateRolePermissions('role-9', as('COMPANY_ADMIN'), [{ module_code: 'ALL', resource: 'ALL', can_view: true }]))
        .rejects.toThrow(ForbiddenException);
      expect(db.delete).not.toHaveBeenCalled();
    });

    it('lets a company admin set bounded permissions', async () => {
      selectResults.push([customRole]);
      await expect(service.updateRolePermissions('role-9', as('COMPANY_ADMIN'), [{ module_code: 'PIGGERY', resource: 'ANIMAL', can_view: true }]))
        .resolves.toMatchObject({ success: true });
    });
  });
});
