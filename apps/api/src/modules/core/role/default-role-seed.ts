import * as crypto from 'crypto';
import * as schema from '../../../core/database/schema';

/**
 * Seeds the four starter roles (SUPER_ADMIN, MANAGER, ACCOUNTANT, OPERATOR)
 * for a company. Called from every path that can make a company "real" —
 * CompanyService.create() and the setup wizard's step 1 (which often
 * updates the tenant's placeholder company in place rather than inserting
 * a new row, so a create()-only hook would miss it). Idempotent: callers
 * check roleMaster is empty for the company before invoking this.
 *
 * tx is typed loosely because Drizzle's MySqlTransaction generic differs
 * slightly by call site; both callers only need insert(), which both the
 * transaction and the base db connection expose identically.
 *
 * Returns the seeded role ids so a caller can, e.g., assign the company's
 * creating user to SUPER_ADMIN.
 *
 * The module_code/resource pairs below are the ones PermissionGuard actually
 * enforces, taken from the @RequirePermission decorators on the controllers.
 * They previously described a poultry pilot (POULTRY/BATCH_CONTROL,
 * ACCOUNTING/LEDGER, FINANCE/VALUATION) that no controller has ever guarded
 * on, so every role except SUPER_ADMIN — which passes on the ALL/ALL wildcard —
 * was granted nothing the API recognised. A Manager, Accountant or Operator
 * signing in got 403 on batches, animals and operational areas, and the
 * console's onboarding check misread those 403s as "company not set up" and
 * dropped them into the setup wizard.
 */

type Grant = {
  module: string;
  resource: string;
  view?: boolean;
  create?: boolean;
  edit?: boolean;
  del?: boolean;
  approve?: boolean;
};



/** Every master-data resource a data-entry or list screen resolves against. */
const MASTER_DATA_RESOURCES = [
  'ACTIVITY', 'BREED', 'BREED_LIFECYCLE_STAGE', 'COST_CENTER', 'CUSTOMER', 'DISEASE', 'FARM',
  'FEED_FORMULA', 'GL_ACCOUNT', 'GL_MAPPING', 'ITEM', 'ITEM_ATTRIBUTE',
  'ITEM_CATEGORY', 'ITEM_TYPE', 'LOCATION', 'MEDICINE', 'OPERATIONAL_AREA', 'RESOURCE',
  'SHED', 'SPECIES', 'SUPPLIER', 'UOM', 'WAREHOUSE',
];

const INVENTORY_RESOURCES = [
  'BIO_ASSET_LEDGER', 'GOODS_ISSUE', 'GOODS_RECEIPT', 'LEDGER',
  'STOCK_ADJUSTMENT', 'STOCK_TRANSFER',
];

const PRODUCTION_RESOURCES = [
  'APPROVAL', 'BATCH', 'BATCH_SCHEDULE', 'PARAMETER', 'QC', 'QC_PARAMETER', 'QR_CODE', 'STAGE',
];

const row = (roleId: string, g: Grant) => ({
  role_id: roleId,
  module_code: g.module,
  resource: g.resource,
  can_view: g.view ?? false,
  can_create: g.create ?? false,
  can_edit: g.edit ?? false,
  can_delete: g.del ?? false,
  can_approve: g.approve ?? false,
  can_export: g.view ?? false,
  can_print: g.view ?? false,
});

export async function seedDefaultCompanyRoles(
  tx: any,
  companyId: string,
): Promise<{ superAdminRoleId: string; managerRoleId: string; accountantRoleId: string; operatorRoleId: string }> {
  const superAdminRoleId = crypto.randomUUID();
  await tx.insert(schema.roleMaster).values({
    role_id: superAdminRoleId,
    company_id: companyId,
    role_code: 'SUPER_ADMIN',
    role_name: 'Super Administrator',
    role_description: 'Full administrative control over all company scopes',
    is_system_role: true,
  });
  await tx.insert(schema.rolePermissions).values({
    role_id: superAdminRoleId,
    module_code: 'ALL',
    resource: 'ALL',
    can_view: true,
    can_create: true,
    can_edit: true,
    can_delete: true,
    can_approve: true,
    can_export: true,
    can_print: true,
  });

  /* ── Manager: runs the farm end to end, cannot delete or administer RBAC ── */
  const managerRoleId = crypto.randomUUID();
  await tx.insert(schema.roleMaster).values({
    role_id: managerRoleId,
    company_id: companyId,
    role_code: 'MANAGER',
    role_name: 'Manager',
    role_description: 'General operational management and supervisor permissions',
    is_system_role: true,
  });
  await tx.insert(schema.rolePermissions).values([
    ...PRODUCTION_RESOURCES.map((r) => row(managerRoleId, { module: 'PRODUCTION', resource: r, view: true, create: true, edit: true, approve: true })),
    row(managerRoleId, { module: 'PIGGERY', resource: 'ANIMAL', view: true, create: true, edit: true, approve: true }),
    ...INVENTORY_RESOURCES.map((r) => row(managerRoleId, { module: 'INVENTORY', resource: r, view: true, create: true, edit: true, approve: true })),
    ...MASTER_DATA_RESOURCES.map((r) => row(managerRoleId, { module: 'MASTER_DATA', resource: r, view: true, create: true, edit: true })),
    row(managerRoleId, { module: 'FINANCE', resource: 'JOURNAL', view: true }),
    row(managerRoleId, { module: 'FINANCE', resource: 'REPORTS', view: true }),
    row(managerRoleId, { module: 'SYSTEM', resource: 'NUMBER_SERIES', view: true }),
    row(managerRoleId, { module: 'NOTIFICATION', resource: 'SETTINGS', view: true }),
    row(managerRoleId, { module: 'AUDIT', resource: 'LOGS', view: true }),
    row(managerRoleId, { module: 'COMPANY', resource: 'SETTINGS', view: true }),
  ]);

  /* ── Accountant: the money, plus read-only sight of what produced it ────── */
  const accountantRoleId = crypto.randomUUID();
  await tx.insert(schema.roleMaster).values({
    role_id: accountantRoleId,
    company_id: companyId,
    role_code: 'ACCOUNTANT',
    role_name: 'Accountant',
    role_description: 'Accounting, ledgers, and financial valuation reports',
    is_system_role: true,
  });
  await tx.insert(schema.rolePermissions).values([
    row(accountantRoleId, { module: 'FINANCE', resource: 'JOURNAL', view: true, create: true, edit: true, approve: true }),
    row(accountantRoleId, { module: 'FINANCE', resource: 'REPORTS', view: true }),
    ...INVENTORY_RESOURCES.map((r) => row(accountantRoleId, { module: 'INVENTORY', resource: r, view: true })),
    ...['GL_ACCOUNT', 'GL_MAPPING', 'COST_CENTER', 'ITEM', 'ITEM_CATEGORY', 'ITEM_TYPE', 'UOM', 'SUPPLIER', 'CUSTOMER', 'WAREHOUSE']
      .map((r) => row(accountantRoleId, { module: 'MASTER_DATA', resource: r, view: true, create: true, edit: true })),
    row(accountantRoleId, { module: 'PRODUCTION', resource: 'BATCH', view: true }),
    row(accountantRoleId, { module: 'AUDIT', resource: 'LOGS', view: true }),
    row(accountantRoleId, { module: 'COMPANY', resource: 'SETTINGS', view: true }),
  ]);

  /* ── Operator: daily entry on the floor. Records work, approves nothing. ── */
  const operatorRoleId = crypto.randomUUID();
  await tx.insert(schema.roleMaster).values({
    role_id: operatorRoleId,
    company_id: companyId,
    role_code: 'OPERATOR',
    role_name: 'Operator',
    role_description: 'Daily operational tasks and farming log entry submissions',
    is_system_role: true,
  });
  await tx.insert(schema.rolePermissions).values([
    row(operatorRoleId, { module: 'PRODUCTION', resource: 'BATCH', view: true, create: true, edit: true }),
    row(operatorRoleId, { module: 'PRODUCTION', resource: 'STAGE', view: true }),
    row(operatorRoleId, { module: 'PRODUCTION', resource: 'BATCH_SCHEDULE', view: true }),
    row(operatorRoleId, { module: 'PRODUCTION', resource: 'PARAMETER', view: true }),
    row(operatorRoleId, { module: 'PRODUCTION', resource: 'QC', view: true, create: true }),
    row(operatorRoleId, { module: 'PRODUCTION', resource: 'QR_CODE', view: true }),
    row(operatorRoleId, { module: 'PRODUCTION', resource: 'APPROVAL', view: true, create: true }),
    row(operatorRoleId, { module: 'PIGGERY', resource: 'ANIMAL', view: true, create: true, edit: true }),
    row(operatorRoleId, { module: 'INVENTORY', resource: 'GOODS_ISSUE', view: true, create: true }),
    row(operatorRoleId, { module: 'INVENTORY', resource: 'GOODS_RECEIPT', view: true, create: true }),
    row(operatorRoleId, { module: 'INVENTORY', resource: 'LEDGER', view: true }),
    row(operatorRoleId, { module: 'INVENTORY', resource: 'STOCK_TRANSFER', view: true, create: true }),
    row(operatorRoleId, { module: 'INVENTORY', resource: 'BIO_ASSET_LEDGER', view: true }),
    // Read-only master data: the data-entry screens resolve items, sheds, pens,
    // breeds, medicines and feed formulas by id and render blank without them.
    ...MASTER_DATA_RESOURCES.map((r) => row(operatorRoleId, { module: 'MASTER_DATA', resource: r, view: true })),
    row(operatorRoleId, { module: 'COMPANY', resource: 'SETTINGS', view: true }),
  ]);

  return { superAdminRoleId, managerRoleId, accountantRoleId, operatorRoleId };
}
