import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planRequisitionPermissionGrants, type RoleRow, type PermRow } from './align-requisition-permissions';

/**
 * WP1f (decisions.md 2026-10-05 — "Demo roles get requisition permissions"):
 * the seeded MANAGER and OPERATOR roles hold no PROCUREMENT/REQUISITION rows,
 * so a realistic restricted user is refused on every requisition route before
 * any scope logic runs. Rishi's grant:
 *
 *   Farm Manager and Head of Farms (OPERATIONAL_ADMIN) roles:
 *     view, create, edit, submit, approve.
 *   Standard User / Operator roles: view, create, edit, submit — NOT approve.
 *   Release, shipment, receipt and Direct Transfer stay as configured.
 *
 * There is no can_submit column: submit is guarded by the SAME 'create' action
 * as drafting (requisition.controller.ts), so "submit" rides on canCreate.
 * Release/shipment/receipt/Direct Transfer read PROCUREMENT/REQUISITION
 * 'approve' and INVENTORY/STOCK_TRANSFER 'edit' — nothing this grant adds.
 */
const role = (role_id: string, role_code: string): RoleRow => ({ role_id, role_code, is_active: 1 });
const perm = (role_id: string, over: Partial<PermRow> = {}): PermRow => ({
  role_id, module_code: 'PROCUREMENT', resource: 'REQUISITION',
  can_view: 0, can_create: 0, can_edit: 0, can_delete: 0, can_approve: 0, ...over,
});

describe('WP1f — requisition permission grants for the demo roles', () => {
  it('Farm Manager (MANAGER): view, create, edit, submit, approve', () => {
    const plan = planRequisitionPermissionGrants([role('r-mgr', 'MANAGER')], []);
    expect(plan.grants).toEqual([
      { role_id: 'r-mgr', role_code: 'MANAGER', view: 1, create: 1, edit: 1, approve: 1, submitNote: 'submit rides on create' },
    ]);
  });

  it('Standard User / Operator (OPERATOR): view, create, edit, submit — approve stays refused', () => {
    const plan = planRequisitionPermissionGrants([role('r-op', 'OPERATOR')], []);
    expect(plan.grants).toEqual([
      { role_id: 'r-op', role_code: 'OPERATOR', view: 1, create: 1, edit: 1, approve: 0, submitNote: 'submit rides on create' },
    ]);
  });

  it('a role already holding the resource is skipped, never duplicated', () => {
    const plan = planRequisitionPermissionGrants(
      [role('r-mgr', 'MANAGER')],
      [perm('r-mgr', { can_view: 1 })],
    );
    expect(plan.grants).toEqual([]);
    expect(plan.skipped).toEqual([{ role_code: 'MANAGER', why: 'already holds PROCUREMENT/REQUISITION' }]);
  });

  it('a role holding ALL/ALL is skipped — it already reaches everything', () => {
    const plan = planRequisitionPermissionGrants(
      [role('r-mgr', 'MANAGER')],
      [{ ...perm('r-mgr'), module_code: 'ALL', resource: 'ALL' }],
    );
    expect(plan.grants).toEqual([]);
  });

  it('roles the decision does not name are left untouched', () => {
    const plan = planRequisitionPermissionGrants([role('r-acc', 'ACCOUNTANT'), role('r-x', 'AUDITOR')], []);
    expect(plan.grants).toEqual([]);
    expect(plan.skipped.map((s) => s.role_code)).toEqual(['ACCOUNTANT', 'AUDITOR']);
  });

  it('inactive roles are not granted', () => {
    const plan = planRequisitionPermissionGrants([{ role_id: 'r-old', role_code: 'MANAGER', is_active: 0 }], []);
    expect(plan.grants).toEqual([]);
  });

  it('the script keeps the §4 shape: host guard, verify-rollback, and a registered db-* target', () => {
    const source = readFileSync(join(__dirname, 'align-requisition-permissions.ts'), 'utf8');
    expect(source).toContain('--verify');
    expect(source).toContain('--apply');
    expect(source).toMatch(/127\.0\.0\.1|localhost/);
    expect(source).toContain('beginTransaction');
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { nx?: { targets?: Record<string, unknown> } };
    expect(Object.keys(pkg.nx?.targets ?? {})).toContain('db-align-requisition-permissions');
  });
});
