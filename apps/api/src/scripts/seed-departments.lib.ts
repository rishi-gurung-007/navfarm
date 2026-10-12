/**
 * Pure planning for seed-departments.ts (Rishi, 12 Oct): the three standard
 * departments per company, and a department for every existing user who has
 * none. No database access here; the script reads rows, calls this, writes.
 */
export const STANDARD_DEPARTMENTS = [
  { code: 'STORES', name: 'Stores' },
  { code: 'FARM-OPS', name: 'Farm Operations' },
  { code: 'FEED-MILL', name: 'Feed Mill' },
] as const;
export type StandardCode = (typeof STANDARD_DEPARTMENTS)[number]['code'];

export const MILL_MANAGER_ROLE_CODE = 'MILL_MANAGER';
const FARM_USER_TYPES = ['FARM_MANAGER', 'STANDARD_USER'];
const TENANT_LEVEL_TYPE = 'TENANT_ADMIN';

export interface CompanyRow { company_id: string }
/** A DEPARTMENT cost centre, inactive and soft-deleted rows included. */
export interface DepartmentRow {
  cost_center_id: string; company_id: string | null; cost_center_code: string; cost_center_name: string;
  is_active: number | boolean; deleted_at: unknown;
}
export interface UserRow { user_id: string; email: string; user_type: string; company_id: string | null; department_id: string | null }
export interface MillRoleHolder { user_id: string; company_id: string }

export interface DepartmentPlan {
  company_id: string;
  code: StandardCode;
  name: string;
  /** create: nothing equivalent exists; exists: reuse the row; unusable: an equivalent row is inactive or deleted, so nothing is created and nobody is assigned to it */
  action: 'create' | 'exists' | 'unusable';
  existing_id?: string;
  existing_code?: string;
  note?: string;
}
export interface UserPlan {
  user_id: string;
  email: string;
  company_id: string | null;
  department: StandardCode | null;
  action: 'assign' | 'skip';
  reason: string;
}
export interface DepartmentSeedPlan { departments: DepartmentPlan[]; users: UserPlan[] }

const codeKey = (c: string) => c.trim().toLowerCase().replace(/^dept-/, '');
const nameKey = (n: string) => n.trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').trim();

/** An existing department is the same as a standard one by code (ignoring case and a DEPT- prefix) or by name (ignoring case and a trailing "(note)"). */
export function findEquivalent(rows: DepartmentRow[], std: { code: string; name: string }): DepartmentRow | undefined {
  const matches = rows.filter((r) => codeKey(r.cost_center_code) === codeKey(std.code) || nameKey(r.cost_center_name) === nameKey(std.name));
  // prefer a live, active row when more than one is equivalent
  return matches.find((r) => !r.deleted_at && r.is_active) ?? matches.find((r) => !r.deleted_at) ?? matches[0];
}

export function planDepartmentSeed(
  companies: CompanyRow[], departments: DepartmentRow[], users: UserRow[], millRoleHolders: MillRoleHolder[],
): DepartmentSeedPlan {
  const deptPlans: DepartmentPlan[] = [];
  const usable = new Map<string, boolean>(); // `${company}|${code}` -> assignable
  for (const c of companies) {
    const own = departments.filter((d) => d.company_id === c.company_id);
    for (const std of STANDARD_DEPARTMENTS) {
      const hit = findEquivalent(own, std);
      if (!hit) {
        deptPlans.push({ company_id: c.company_id, code: std.code, name: std.name, action: 'create' });
        usable.set(`${c.company_id}|${std.code}`, true);
      } else if (hit.deleted_at || !hit.is_active) {
        deptPlans.push({ company_id: c.company_id, code: std.code, name: std.name, action: 'unusable', existing_id: hit.cost_center_id, existing_code: hit.cost_center_code, note: hit.deleted_at ? 'equivalent department is deleted' : 'equivalent department is inactive' });
        usable.set(`${c.company_id}|${std.code}`, false);
      } else {
        deptPlans.push({ company_id: c.company_id, code: std.code, name: std.name, action: 'exists', existing_id: hit.cost_center_id, existing_code: hit.cost_center_code });
        usable.set(`${c.company_id}|${std.code}`, true);
      }
    }
  }

  const single = companies.length === 1 ? companies[0].company_id : null;
  const mill = new Set(millRoleHolders.map((m) => `${m.company_id}|${m.user_id}`));
  const userPlans: UserPlan[] = [];
  for (const u of users) {
    if (u.department_id) continue; // never overwrite
    const skip = (reason: string, company_id: string | null): UserPlan => ({ user_id: u.user_id, email: u.email, company_id, department: null, action: 'skip', reason });
    // a Tenant Admin is tenant-level: department is per company, so it only resolves when there is one company
    const company_id = u.user_type === TENANT_LEVEL_TYPE ? single : (u.company_id ?? single);
    if (!company_id) {
      userPlans.push(skip(u.user_type === TENANT_LEVEL_TYPE ? 'tenant-level user and the tenant has several companies' : 'user has no company', null));
      continue;
    }
    if (!companies.some((c) => c.company_id === company_id)) { userPlans.push(skip('company not found or inactive', company_id)); continue; }
    let dept: StandardCode;
    let reason: string;
    if (mill.has(`${company_id}|${u.user_id}`)) { dept = 'FEED-MILL'; reason = 'holds the Mill Manager role'; }
    else if (FARM_USER_TYPES.includes(u.user_type)) { dept = 'FARM-OPS'; reason = `user type ${u.user_type}`; }
    else { dept = 'STORES'; reason = u.user_type === TENANT_LEVEL_TYPE ? "tenant admin of the tenant's only company" : `admin user type ${u.user_type}`; }
    if (!usable.get(`${company_id}|${dept}`)) { userPlans.push(skip(`${dept} department is inactive or deleted`, company_id)); continue; }
    userPlans.push({ user_id: u.user_id, email: u.email, company_id, department: dept, action: 'assign', reason });
  }
  return { departments: deptPlans, users: userPlans };
}

/** True when the plan would change nothing (skipped users are only listed). */
export function isEmptyPlan(p: DepartmentSeedPlan): boolean {
  return p.departments.every((d) => d.action !== 'create') && p.users.every((u) => u.action !== 'assign');
}
