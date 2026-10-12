import { seedDefaultCompanyRoles } from './default-role-seed';
import * as schema from '../../../core/database/schema';

describe('seedDefaultCompanyRoles', () => {
  const companyId = '11111111-1111-4111-8111-111111111111';
  let insertedRoles: any[] = [];
  let insertedPermissions: any[] = [];

  const fakeTx = {
    insert: (table: any) => ({
      values: (val: any) => {
        const rows = Array.isArray(val) ? val : [val];
        if (table === schema.roleMaster) {
          insertedRoles.push(...rows);
        } else if (table === schema.rolePermissions) {
          insertedPermissions.push(...rows);
        }
        return Promise.resolve();
      },
    }),
  };

  beforeEach(() => {
    insertedRoles = [];
    insertedPermissions = [];
  });

  it('seeds default starter roles with explicit document, count, transfer and finance grants', async () => {
    const roleIds = await seedDefaultCompanyRoles(fakeTx as any, companyId);

    expect(roleIds).toHaveProperty('superAdminRoleId');
    expect(roleIds).toHaveProperty('managerRoleId');
    expect(roleIds).toHaveProperty('accountantRoleId');
    expect(roleIds).toHaveProperty('operatorRoleId');

    const permsForRole = (roleId: string) =>
      insertedPermissions.filter((p) => p.role_id === roleId);

    // ── SUPER_ADMIN: wildcard ALL/ALL ──
    const superAdminPerms = permsForRole(roleIds.superAdminRoleId);
    expect(superAdminPerms).toEqual([
      expect.objectContaining({
        module_code: 'ALL',
        resource: 'ALL',
        can_view: true,
        can_create: true,
        can_edit: true,
        can_delete: true,
        can_approve: true,
      }),
    ]);

    // ── MANAGER: runs the farm end to end ──
    const managerPerms = permsForRole(roleIds.managerRoleId);
    const managerStockCount = managerPerms.find(
      (p) => p.module_code === 'INVENTORY' && p.resource === 'STOCK_COUNT',
    );
    expect(managerStockCount).toMatchObject({
      can_view: true,
      can_create: true,
      can_edit: true,
      can_approve: true,
    });

    const managerRequisition = managerPerms.find(
      (p) => p.module_code === 'PROCUREMENT' && p.resource === 'REQUISITION',
    );
    expect(managerRequisition).toMatchObject({
      can_view: true,
      can_create: true,
      can_edit: true,
      can_approve: true,
    });

    const managerTransfer = managerPerms.find(
      (p) => p.module_code === 'INVENTORY' && p.resource === 'STOCK_TRANSFER',
    );
    expect(managerTransfer).toMatchObject({
      can_view: true,
      can_create: true,
      can_edit: true,
      can_approve: true,
    });

    // ── ACCOUNTANT: ledger, variance escalation, financial reports ──
    const accountantPerms = permsForRole(roleIds.accountantRoleId);
    const accountantVariance = accountantPerms.find(
      (p) => p.module_code === 'FINANCE' && p.resource === 'STOCK_VARIANCE',
    );
    expect(accountantVariance).toMatchObject({
      can_view: true,
      can_approve: true,
    });

    const accountantStockCount = accountantPerms.find(
      (p) => p.module_code === 'INVENTORY' && p.resource === 'STOCK_COUNT',
    );
    expect(accountantStockCount).toMatchObject({
      can_view: true,
      can_approve: false,
    });

    const accountantRequisition = accountantPerms.find(
      (p) => p.module_code === 'PROCUREMENT' && p.resource === 'REQUISITION',
    );
    expect(accountantRequisition).toMatchObject({
      can_view: true,
      can_approve: true,
    });

    // ── OPERATOR: floor data entry; records work, approves nothing ──
    const operatorPerms = permsForRole(roleIds.operatorRoleId);
    const operatorStockCount = operatorPerms.find(
      (p) => p.module_code === 'INVENTORY' && p.resource === 'STOCK_COUNT',
    );
    expect(operatorStockCount).toMatchObject({
      can_view: true,
      can_create: true,
      can_edit: true,
      can_approve: false,
    });

    const operatorRequisition = operatorPerms.find(
      (p) => p.module_code === 'PROCUREMENT' && p.resource === 'REQUISITION',
    );
    expect(operatorRequisition).toMatchObject({
      can_view: true,
      can_create: true,
      can_approve: false,
    });

    const operatorTransfer = operatorPerms.find(
      (p) => p.module_code === 'INVENTORY' && p.resource === 'STOCK_TRANSFER',
    );
    expect(operatorTransfer).toMatchObject({
      can_view: true,
      can_create: true,
      can_edit: true,
      can_approve: false,
    });

    // Operator receives zero approval grants across all assigned resources
    const operatorApprovals = operatorPerms.filter((p) => p.can_approve);
    expect(operatorApprovals).toEqual([]);
  });

  it('seeds MILL_MANAGER (Feed Mill Manager) with mill-side grants and nothing destructive or financial', async () => {
    const roleIds = await seedDefaultCompanyRoles(fakeTx as any, companyId);
    expect(roleIds).toHaveProperty('millManagerRoleId');
    expect(insertedRoles.find((r) => r.role_id === roleIds.millManagerRoleId)).toMatchObject({
      company_id: companyId, role_code: 'MILL_MANAGER', role_name: 'Feed Mill Manager', is_system_role: true,
    });
    // the existing four are still seeded
    expect(insertedRoles.map((r) => r.role_code)).toEqual(['SUPER_ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATOR', 'MILL_MANAGER']);

    const perms = insertedPermissions.filter((p) => p.role_id === roleIds.millManagerRoleId);
    const find = (m: string, r: string) => perms.find((p) => p.module_code === m && p.resource === r);
    expect(find('PROCUREMENT', 'REQUISITION')).toMatchObject({ can_view: true, can_approve: true, can_create: false });
    expect(find('INVENTORY', 'STOCK_TRANSFER')).toMatchObject({ can_view: true, can_create: true, can_edit: true, can_delete: false });
    expect(find('INVENTORY', 'STOCK_COUNT')).toMatchObject({ can_view: true, can_create: true, can_edit: true, can_approve: true });
    expect(find('INVENTORY', 'LEDGER')).toMatchObject({ can_view: true, can_create: false });
    expect(find('MASTER_DATA', 'BIN_DIET_ASSIGNMENT')).toMatchObject({ can_view: true, can_create: true, can_edit: true, can_delete: false });
    expect(perms.filter((p) => p.can_delete)).toEqual([]);
    expect(perms.some((p) => p.module_code === 'FINANCE' || p.module_code === 'ALL' || p.module_code === 'PRODUCTION')).toBe(false);
  });
});
