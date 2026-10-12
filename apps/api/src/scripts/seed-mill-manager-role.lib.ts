import { MILL_MANAGER_GRANTS, MILL_MANAGER_ROLE } from '../modules/core/role/mill-manager-role';

export interface CompanyRow { company_id: string }
export interface RoleRow { role_id: string; company_id: string; role_code: string }
export interface PermRow { role_id: string; module_code: string; resource: string }

export interface MillManagerPlan {
  company_id: string;
  /** true when the company has no MILL_MANAGER role yet */
  createRole: boolean;
  /** module/resource pairs to insert; empty when the role is already complete */
  missingGrants: string[];
}

/**
 * Pure planning step: per company, create the role only if absent and insert
 * only the grant rows it does not already hold. An existing row is never
 * altered, so a hand-tuned MILL_MANAGER role survives a re-run.
 */
export function planMillManagerRole(companies: CompanyRow[], roles: RoleRow[], perms: PermRow[]): MillManagerPlan[] {
  return companies.map((c) => {
    const role = roles.find((r) => r.company_id === c.company_id && r.role_code === MILL_MANAGER_ROLE.role_code);
    const held = new Set(role ? perms.filter((p) => p.role_id === role.role_id).map((p) => `${p.module_code}/${p.resource}`) : []);
    const missingGrants = MILL_MANAGER_GRANTS.map((g) => `${g.module}/${g.resource}`).filter((k) => !held.has(k));
    return { company_id: c.company_id, createRole: !role, missingGrants };
  }).filter((p) => p.createRole || p.missingGrants.length > 0);
}
