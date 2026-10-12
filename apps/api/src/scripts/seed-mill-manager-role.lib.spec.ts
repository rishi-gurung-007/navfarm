import { planMillManagerRole } from './seed-mill-manager-role.lib';
import { MILL_MANAGER_GRANTS } from '../modules/core/role/mill-manager-role';

const all = MILL_MANAGER_GRANTS.map((g) => ({ module_code: g.module, resource: g.resource }));

describe('planMillManagerRole', () => {
  it('plans the role and every grant for a company without it', () => {
    const plan = planMillManagerRole([{ company_id: 'c1' }], [{ role_id: 'r1', company_id: 'c1', role_code: 'MANAGER' }], []);
    expect(plan).toEqual([{ company_id: 'c1', createRole: true, missingGrants: MILL_MANAGER_GRANTS.map((g) => `${g.module}/${g.resource}`) }]);
  });

  it('plans nothing once the role holds every grant (idempotent)', () => {
    const roles = [{ role_id: 'rm', company_id: 'c1', role_code: 'MILL_MANAGER' }];
    expect(planMillManagerRole([{ company_id: 'c1' }], roles, all.map((a) => ({ role_id: 'rm', ...a })))).toEqual([]);
  });

  it('inserts only the missing grants and never recreates an existing role', () => {
    const roles = [{ role_id: 'rm', company_id: 'c1', role_code: 'MILL_MANAGER' }];
    const held = all.slice(1).map((a) => ({ role_id: 'rm', ...a }));
    const plan = planMillManagerRole([{ company_id: 'c1' }], roles, held);
    expect(plan).toEqual([{ company_id: 'c1', createRole: false, missingGrants: [`${MILL_MANAGER_GRANTS[0].module}/${MILL_MANAGER_GRANTS[0].resource}`] }]);
  });

  it('treats each company separately', () => {
    const roles = [{ role_id: 'rm', company_id: 'c1', role_code: 'MILL_MANAGER' }];
    const plan = planMillManagerRole([{ company_id: 'c1' }, { company_id: 'c2' }], roles, all.map((a) => ({ role_id: 'rm', ...a })));
    expect(plan.map((p) => p.company_id)).toEqual(['c2']);
  });
});
