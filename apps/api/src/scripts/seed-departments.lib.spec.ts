import { planDepartmentSeed, isEmptyPlan, type DepartmentRow, type UserRow } from './seed-departments.lib';

const dept = (id: string, code: string, name: string, extra: Partial<DepartmentRow> = {}): DepartmentRow =>
  ({ cost_center_id: id, company_id: 'c1', cost_center_code: code, cost_center_name: name, is_active: 1, deleted_at: null, ...extra });
const user = (id: string, type: string, extra: Partial<UserRow> = {}): UserRow =>
  ({ user_id: id, email: `${id}@x.test`, user_type: type, company_id: 'c1', department_id: null, ...extra });
const full = [dept('s', 'STORES', 'Stores'), dept('f', 'FARM-OPS', 'Farm Operations'), dept('m', 'FEED-MILL', 'Feed Mill')];
const C1 = [{ company_id: 'c1' }];

describe('planDepartmentSeed', () => {
  it('creates the three departments for a company that has none', () => {
    const p = planDepartmentSeed(C1, [], [], []);
    expect(p.departments.map((d) => [d.code, d.action])).toEqual([['STORES', 'create'], ['FARM-OPS', 'create'], ['FEED-MILL', 'create']]);
  });

  it('creates only what is missing and reuses equivalents (DEPT- prefix, "(note)" suffix, case)', () => {
    const rows = [dept('s', 'DEPT-STORES', 'Stores (illustrative)'), dept('f', 'farm-ops', 'x')];
    const p = planDepartmentSeed(C1, rows, [], []);
    expect(p.departments.map((d) => [d.code, d.action, d.existing_id])).toEqual([['STORES', 'exists', 's'], ['FARM-OPS', 'exists', 'f'], ['FEED-MILL', 'create', undefined]]);
  });

  it('reports an inactive equivalent without duplicating it or assigning users to it', () => {
    const rows = [dept('s', 'STORES', 'Stores', { is_active: 0 }), dept('f', 'FARM-OPS', 'Farm Operations'), dept('m', 'FEED-MILL', 'Feed Mill')];
    const p = planDepartmentSeed(C1, rows, [user('a', 'COMPANY_ADMIN')], []);
    expect(p.departments[0].action).toBe('unusable');
    expect(p.users[0]).toMatchObject({ action: 'skip' });
  });

  it('never overwrites a user department', () => {
    const p = planDepartmentSeed(C1, full, [user('a', 'STANDARD_USER', { department_id: 'zzz' })], []);
    expect(p.users).toEqual([]);
  });

  it('Farm Manager / Standard User -> Farm Operations; admins -> Stores', () => {
    const us = [user('a', 'FARM_MANAGER'), user('b', 'STANDARD_USER'), user('c', 'COMPANY_ADMIN'), user('d', 'OPERATIONAL_ADMIN')];
    const p = planDepartmentSeed(C1, full, us, []);
    expect(p.users.map((u) => u.department)).toEqual(['FARM-OPS', 'FARM-OPS', 'STORES', 'STORES']);
  });

  it('the Mill Manager role wins over the user type', () => {
    const p = planDepartmentSeed(C1, full, [user('a', 'STANDARD_USER'), user('b', 'COMPANY_ADMIN')], [{ user_id: 'a', company_id: 'c1' }, { user_id: 'b', company_id: 'other' }]);
    expect(p.users.map((u) => u.department)).toEqual(['FEED-MILL', 'STORES']);
  });

  it('a tenant admin belongs to the only company, and is skipped when there are several', () => {
    const t = user('t', 'TENANT_ADMIN', { company_id: null });
    expect(planDepartmentSeed(C1, full, [t], []).users[0]).toMatchObject({ action: 'assign', company_id: 'c1', department: 'STORES' });
    const two = planDepartmentSeed([{ company_id: 'c1' }, { company_id: 'c2' }], full, [t], []).users[0];
    expect(two).toMatchObject({ action: 'skip', department: null });
  });

  it('skips a non-admin user with no company when there are several companies', () => {
    const p = planDepartmentSeed([{ company_id: 'c1' }, { company_id: 'c2' }], full, [user('a', 'STANDARD_USER', { company_id: null })], []);
    expect(p.users[0]).toMatchObject({ action: 'skip', reason: 'user has no company' });
  });

  it('is empty once departments exist and users are assigned', () => {
    expect(isEmptyPlan(planDepartmentSeed(C1, full, [user('a', 'STANDARD_USER', { department_id: 'f' })], []))).toBe(true);
    expect(isEmptyPlan(planDepartmentSeed(C1, [], [], []))).toBe(false);
  });
});
