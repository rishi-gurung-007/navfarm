/**
 * Department as a shared master identity (decisions.md, 1 Oct 2026):
 *
 *   "Department matching uses shared master identities rather than text
 *    comparison: Department is represented by a company Cost Center Master
 *    row of type `DEPARTMENT`, and both users and locations reference that
 *    identity."
 *
 * So a department is never a string comparison — it is a lookup of one
 * `cost_center_master` row and a check that the row may act as the department
 * of the given tenant/company. `usableDepartment` is the pure half (unit
 * tested by Task 8's requisition rules spec); `assertDepartmentIdentity` adds
 * the lookup and raises the shared refusal.
 */
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';

export const DEPARTMENT_COST_CENTER_TYPE = 'DEPARTMENT';

/** Exactly the columns the rule needs; callers pass whatever row they hold. */
export interface DepartmentIdentityRow {
  tenant_id?: string | null;
  company_id?: string | null;
  cost_center_type?: string | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
}

/**
 * May this Cost Center row serve as the department identity of
 * (tenantId, companyId)?
 *
 * - the row must be a DEPARTMENT, active and not soft-deleted;
 * - the row must belong to the same tenant;
 * - a row scoped to a company is usable only in that company; a row with a
 *   null company is tenant-shared (the same convention location/scope
 *   matching uses) and usable anywhere in the tenant.
 */
export function usableDepartment(row: DepartmentIdentityRow | null | undefined, tenantId: string, companyId: string | null): boolean {
  if (!row) return false;
  if (row.cost_center_type !== DEPARTMENT_COST_CENTER_TYPE) return false;
  if (row.is_active === false) return false;
  if (row.deleted_at) return false;
  if (row.tenant_id !== tenantId) return false;
  if (row.company_id && companyId && row.company_id !== companyId) return false;
  return true;
}

/**
 * Look the identity up and refuse anything that is not a usable DEPARTMENT
 * row. One query, thrown before any write so a rejected document never
 * partially lands.
 */
export async function assertDepartmentIdentity(
  db: MySql2Database<typeof schema>,
  opts: { tenantId: string; companyId?: string | null; departmentId: string; label?: string },
): Promise<void> {
  const [row] = await db
    .select({
      cost_center_id: schema.costCenterMaster.cost_center_id,
      tenant_id: schema.costCenterMaster.tenant_id,
      company_id: schema.costCenterMaster.company_id,
      cost_center_type: schema.costCenterMaster.cost_center_type,
      is_active: schema.costCenterMaster.is_active,
      deleted_at: schema.costCenterMaster.deleted_at,
    })
    .from(schema.costCenterMaster)
    .where(eq(schema.costCenterMaster.cost_center_id, opts.departmentId))
    .limit(1);
  if (!usableDepartment(row, opts.tenantId, opts.companyId ?? null)) {
    throw new BadRequestException(`${opts.label ?? 'Department'} must be an active DEPARTMENT cost center of this company.`);
  }
}
