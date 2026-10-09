import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { ApprovalService } from '../../production/approval/approval.service';
import { FeedForecastService } from '../../inventory/feed-forecast/feed-forecast.service';
import { addDaysIso, serverToday } from './feed-requisition.rules';
import { FeedRequisitionService, isEditableFeedRequisition } from './feed-requisition.service';

const FEED_SETTINGS_STUB = { resolveForFeedPlanning: jest.fn(async () => ({ safetyStockKg: 0, bulkMultipleKg: 3000, bagSizeKg: 50 })) } as any;

/**
 * D25 (Rishi, 27 Sep): the farm drafts, edits and submits a feed requisition;
 * the farm's own approvers approve or reject it in the Approvals inbox. Run
 * through the REAL FeedForecastService, ApprovalService and AuditLogService
 * over a recording database, like the Plan B approve spec this replaces.
 */

interface Entry { op: string; table: unknown; values?: any; set?: any; inTx?: boolean }

function recordingDb(queues: Map<unknown, unknown[][]>, cls: () => ClsService) {
  const log: Entry[] = [];
  const inTx = () => cls().get('tenantPostingTransaction') === true;
  const db: any = {
    select: jest.fn(() => {
      const entry: Entry = { op: 'select', table: undefined, inTx: inTx() };
      log.push(entry);
      const self: any = {
        from: (t: unknown) => { entry.table = t; return self; },
        leftJoin: () => self, innerJoin: () => self, where: () => self, orderBy: () => self, limit: () => self, for: () => self,
        then: (ok: any, err: any) => Promise.resolve().then(() => queues.get(entry.table)?.shift() ?? []).then(ok, err),
      };
      return self;
    }),
    insert: jest.fn((t: unknown) => ({ values: jest.fn(async (v: unknown) => { log.push({ op: 'insert', table: t, values: v, inTx: inTx() }); }) })),
    update: jest.fn((t: unknown) => ({ set: (v: unknown) => ({ where: async () => { log.push({ op: 'update', table: t, set: v, inTx: inTx() }); } }) })),
    delete: jest.fn((t: unknown) => ({ where: async () => { log.push({ op: 'delete', table: t, inTx: inTx() }); } })),
  };
  return { db, log };
}

const TODAY = serverToday();
const REQ_ROW = {
  requisition_id: 'req-1', tenant_id: 'tenant-1', company_id: 'co-1', farm_id: 'farm-grs', req_no: 'REQ-GRS-2026-00041', doc_type: 'FEED',
  status: 'AUTO_DRAFT', priority: 'CRITICAL', remarks: null, submission_deadline: addDaysIso(TODAY, 1), approval_request_id: null,
};
const PENDING_ROW = { ...REQ_ROW, status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' };
const FARM = { code: 'GRS', name: 'Green Ridge' };
const LINE_6000 = { line_seq: 1, description: 'Weaner Diet R1', quantity: '6000.0000', recommended: '6000.0000' };
const VIEW = [{ req: { ...REQ_ROW, status: 'PENDING_APPROVAL', approval_request_id: 'ar-new' }, farm_code: 'GRS', truck_target_kg: 30000 }];
const REQUEST = {
  request_id: 'ar-1', tenant_id: 'tenant-1', company_id: 'co-1', doc_type: 'FEED_REQUISITION', doc_no: 'REQ-GRS-2026-00041',
  status: 'PENDING', batch_id: null, farm_id: 'farm-grs', document_id: 'req-1', deleted_at: null,
};

const COMPANY_ADMIN_SCOPE: FarmScope = { farmId: 'farm-x', companyId: 'co-1', restricted: false, lobId: null };
const OWN_FARM_SCOPE: FarmScope = { farmId: 'farm-grs', companyId: 'co-1', restricted: true, lobId: 'lob-pig' };
const ADMIN = { userId: 'u-admin', userType: 'COMPANY_ADMIN', email: 'admin@x' };
const FARM_USER = { userId: 'u-farm', userType: 'STANDARD_USER' };

function setup(queues: Map<unknown, unknown[][]>) {
  const ref = {} as { cls: ClsService };
  const { db, log } = recordingDb(queues, () => ref.cls);
  const cls = (ref.cls = transactionCls(db));
  const forecast = new FeedForecastService(cls, {} as any, { log: jest.fn() } as any, { currentItems: jest.fn(async () => new Map()) } as any, FEED_SETTINGS_STUB);
  const approvals = new ApprovalService(cls, new AuditLogService(cls), {} as any);
  const evaluated: Array<{ args: unknown[]; inTx: boolean }> = [];
  const alerts: any = {
    evaluateFarmSafely: jest.fn(async (...args: unknown[]) => { evaluated.push({ args, inTx: cls.get('tenantPostingTransaction') === true }); }),
  };
  const service = new FeedRequisitionService(cls, forecast, approvals, alerts, {} as any, {} as any, FEED_SETTINGS_STUB);
  service.onModuleInit();
  const as = <T>(scope: FarmScope, work: () => Promise<T>) => cls.run(async () => { cls.set(FARM_SCOPE_KEY, scope); return work(); });
  const writes = () => log.filter((e) => e.op !== 'select');
  /** The audit rows the decision wrote, with their JSON columns read back. */
  const audits = () => log
    .filter((e) => e.op === 'insert' && e.table === schema.auditLog)
    .flatMap((e) => (Array.isArray(e.values) ? e.values : [e.values]))
    .map((v: any) => ({ action: v.action, newValues: v.new_values, oldValues: v.old_values }));
  return { service, approvals, forecast, evaluated, as, writes, audits };
}

describe('isEditableFeedRequisition (D25)', () => {
  it('is true for drafts and for a Plan B PENDING_APPROVAL row that never got a request', () => {
    expect(isEditableFeedRequisition({ status: 'AUTO_DRAFT', approval_request_id: null })).toBe(true);
    expect(isEditableFeedRequisition({ status: 'DRAFT', approval_request_id: null })).toBe(true);
    expect(isEditableFeedRequisition({ status: 'PENDING_APPROVAL', approval_request_id: null })).toBe(true);
    expect(isEditableFeedRequisition({ status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' })).toBe(false);
    expect(isEditableFeedRequisition({ status: 'APPROVED', approval_request_id: 'ar-1' })).toBe(false);
  });
});

describe('Feed requisition approval authority (Task 7)', () => {
  const FARM_MANAGER = { userId: 'u-manager', userType: 'FARM_MANAGER' };
  const MANAGER_GRANT = {
    moduleCode: 'PROCUREMENT', resource: 'REQUISITION',
    canView: true, canCreate: true, canEdit: true, canDelete: false, canApprove: true, canExport: false, canPrint: false,
  };
  const REQUESTED_BY_MANAGER = { ...REQUEST, requested_by: 'u-manager' };

  it('refuses a Farm Manager approving the manual requisition they submitted', async () => {
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUESTED_BY_MANAGER], [{ ...REQUESTED_BY_MANAGER, status: 'APPROVED' }]]],
      [schema.requisition, [[{ ...PENDING_ROW, source: 'MANUAL_ENTRY', created_by: 'u-manager' }]]],
      [schema.requisitionLine, [[LINE_6000]]],
      [schema.userRoleAssignment, [[MANAGER_GRANT]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', FARM_MANAGER)))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(writes()).toEqual([]);
  });

  /**
   * decisions.md 2026-10-04: "Tenant and Company admins may approve their own
   * requisitions" supersedes the refusal above for exactly these two types,
   * common and feed requisitions alike. The point under test is
   * feed-requisition.service.ts's own inline check (enforcement point 3 of
   * three — it is not the shared requisition.rules.ts isSelfApproval, because
   * it also keys on the approval request's requested_by, which the common
   * row does not carry) — this proves it agrees with the common path's rule
   * on exactly which user types are exempt.
   */
  it.each(['TENANT_ADMIN', 'COMPANY_ADMIN', 'OPERATIONAL_ADMIN'] as const)(
    'lets a %s approve the manual feed requisition they submitted themselves, and still records them as the approver',
    async (userType) => {
      const admin = { userId: 'u-manager', userType };
      const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
        [schema.approvalRequest, [[REQUESTED_BY_MANAGER], [{ ...REQUESTED_BY_MANAGER, status: 'APPROVED' }]]],
        [schema.requisition, [[{ ...PENDING_ROW, source: 'MANUAL_ENTRY', created_by: 'u-manager' }]]],
        [schema.requisitionLine, [[LINE_6000]]],
        [schema.userRoleAssignment, [[MANAGER_GRANT]]],
      ]));
      await expect(as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', admin)))
        .resolves.toMatchObject({ status: 'APPROVED' });
      const requisitionWrite = writes().find((e) => e.table === schema.requisition)!;
      expect(requisitionWrite.set).toMatchObject({ status: 'APPROVED', approved_by: 'u-manager' });
    },
  );

  it.each(['STANDARD_USER'] as const)(
    'still refuses a %s approving the manual feed requisition they submitted',
    async (userType) => {
      const nonExempt = { userId: 'u-manager', userType };
      const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
        [schema.approvalRequest, [[REQUESTED_BY_MANAGER], [{ ...REQUESTED_BY_MANAGER, status: 'APPROVED' }]]],
        [schema.requisition, [[{ ...PENDING_ROW, source: 'MANUAL_ENTRY', created_by: 'u-manager' }]]],
        [schema.requisitionLine, [[LINE_6000]]],
        [schema.userRoleAssignment, [[MANAGER_GRANT]]],
      ]));
      await expect(as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', nonExempt)))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(writes()).toEqual([]);
    },
  );

  it('still refuses a SYSTEM_ADMIN approving their own manual feed requisition — not decided; follows the old rule until Rishi confirms it', async () => {
    const systemAdmin = { userId: 'u-manager', userType: 'SYSTEM_ADMIN' };
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUESTED_BY_MANAGER], [{ ...REQUESTED_BY_MANAGER, status: 'APPROVED' }]]],
      [schema.requisition, [[{ ...PENDING_ROW, source: 'MANUAL_ENTRY', created_by: 'u-manager' }]]],
      [schema.requisitionLine, [[LINE_6000]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', systemAdmin)))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(writes()).toEqual([]);
  });

  it('lets a Farm Manager approve their own farm system forecast draft (D25)', async () => {
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUESTED_BY_MANAGER], [{ ...REQUESTED_BY_MANAGER, status: 'APPROVED' }]]],
      [schema.requisition, [[{ ...PENDING_ROW, source: 'AUTO_FORECAST', created_by: 'u-manager' }]]],
      [schema.requisitionLine, [[LINE_6000]]],
      [schema.userRoleAssignment, [[MANAGER_GRANT]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', FARM_MANAGER)))
      .resolves.toMatchObject({ status: 'APPROVED' });
    expect(writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ status: 'APPROVED' });
  });

  it('treats a stock-take or diet-change trigger as a system document too', async () => {
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUESTED_BY_MANAGER], [{ ...REQUESTED_BY_MANAGER, status: 'APPROVED' }]]],
      [schema.requisition, [[{ ...PENDING_ROW, source: 'STOCK_TAKE_TRIGGERED', created_by: 'u-manager' }]]],
      [schema.requisitionLine, [[LINE_6000]]],
      [schema.userRoleAssignment, [[MANAGER_GRANT]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', FARM_MANAGER)))
      .resolves.toMatchObject({ status: 'APPROVED' });
    expect(writes().some((e) => e.table === schema.requisition)).toBe(true);
  });

  it('keeps an approved requisition immutable: neither an edit nor a resubmit writes anything', async () => {
    const approved = { ...PENDING_ROW, status: 'APPROVED', source: 'MANUAL_ENTRY' };
    const editor = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [approved]]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }]]],
    ]));
    await expect(editor.as(COMPANY_ADMIN_SCOPE, () => editor.service.update('req-1', { remarks: 'changed' }, 'tenant-1', ADMIN)))
      .rejects.toThrow(/can no longer be changed/);
    expect(editor.writes()).toEqual([]);

    const resubmit = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [approved]]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }]]],
      [schema.requisitionLine, [[LINE_6000]]],
    ]));
    await expect(resubmit.as(COMPANY_ADMIN_SCOPE, () => resubmit.service.submit('req-1', {}, 'tenant-1', ADMIN)))
      .rejects.toThrow(/can no longer be changed/);
    expect(resubmit.writes()).toEqual([]);
  });
});

describe('FeedRequisitionService.submit (D25)', () => {
  it('raises a PENDING request for the farm and sets the requisition waiting, in one transaction, then re-evaluates alerts', async () => {
    const { service, as, writes, evaluated } = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [REQ_ROW], VIEW]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }], [FARM]]],
      [schema.requisitionLine, [[LINE_6000], []]],
      [schema.approvalRequest, [[]]],
    ]));
    const view = await as(COMPANY_ADMIN_SCOPE, () => service.submit('req-1', {}, 'tenant-1', ADMIN));
    expect(view).toMatchObject({ status: 'PENDING_APPROVAL' });
    const request = writes().find((e) => e.op === 'insert' && e.table === schema.approvalRequest)!;
    expect(request.values).toMatchObject({
      doc_type: 'FEED_REQUISITION', doc_no: 'REQ-GRS-2026-00041', status: 'PENDING', farm_id: 'farm-grs', document_id: 'req-1',
      company_id: 'co-1', urgency: 'HIGH', requested_qty: '6,000', uom: 'KG', location_label: 'GRS — Green Ridge', justification: null,
    });
    const header = writes().find((e) => e.op === 'update' && e.table === schema.requisition)!;
    expect(header.set).toMatchObject({ status: 'PENDING_APPROVAL', approval_request_id: request.values.request_id, remarks: null });
    expect(writes().every((e) => e.inTx)).toBe(true);
    expect(evaluated).toEqual([{ args: ['farm-grs', 'co-1', 'tenant-1'], inTx: false }]);
  });

  it('refuses more than 20 % from the recommendation without remarks, writing nothing', async () => {
    const { service, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [REQ_ROW]]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }]]],
      [schema.requisitionLine, [[{ ...LINE_6000, quantity: '9000.0000' }]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => service.submit('req-1', {}, 'tenant-1', ADMIN)))
      .rejects.toThrow(new BadRequestException('Line 1 (Weaner Diet R1): 9,000 kg is more than 20% off the recommended 6,000 kg. Add remarks to explain.'));
    expect(writes()).toEqual([]);
  });

  it('refuses a late submission without remarks, and takes the remarks sent with it', async () => {
    const late = { ...REQ_ROW, submission_deadline: addDaysIso(TODAY, -1) };
    const refused = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [late]]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }]]],
      [schema.requisitionLine, [[LINE_6000]]],
    ]));
    await expect(refused.as(COMPANY_ADMIN_SCOPE, () => refused.service.submit('req-1', {}, 'tenant-1', ADMIN))).rejects.toThrow(/has passed/);
    const ok = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [late], VIEW]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }], [FARM]]],
      [schema.requisitionLine, [[LINE_6000], []]],
      [schema.approvalRequest, [[]]],
    ]));
    await ok.as(COMPANY_ADMIN_SCOPE, () => ok.service.submit('req-1', { remarks: 'Mill closed Friday' }, 'tenant-1', ADMIN));
    expect(ok.writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ remarks: 'Mill closed Friday' });
  });

  it('names the exception reason, not blank parens, when an item-exception line has no joined item name (M7)', async () => {
    // linesForCheck's item_master LEFT JOIN can fail to resolve a name (the item was later removed);
    // before M7 that fell back to '' specifically for an exception line, so this read "Line 1 ()".
    const exceptionLine = { line_seq: 1, description: 'Exception: Vet instruction', quantity: '6000.0000', recommended: '6000.0000' };
    const { service, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [REQ_ROW]]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }]]],
      [schema.requisitionLine, [[exceptionLine]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => service.submit('req-1', {}, 'tenant-1', ADMIN)))
      .rejects.toThrow(new BadRequestException('Line 1 (Exception: Vet instruction): feed item differs from the lifecycle requirement (exception). Remarks are required (Requisition row 36).'));
    expect(writes()).toEqual([]);
  });

  it('answers not found to a farm user of another farm, before anything is written', async () => {
    const { service, as, writes } = setup(new Map<unknown, unknown[][]>([[schema.requisition, [[{ farm_id: 'farm-other', company_id: 'co-1' }]]]]));
    await expect(as(OWN_FARM_SCOPE, () => service.submit('req-1', {}, 'tenant-1', FARM_USER))).rejects.toBeInstanceOf(NotFoundException);
    expect(writes()).toEqual([]);
  });

  it('will not edit a requisition that is waiting for approval', async () => {
    const { service, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [PENDING_ROW]]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => service.update('req-1', { remarks: 'x' }, 'tenant-1', ADMIN)))
      .rejects.toThrow('Requisition REQ-GRS-2026-00041 is waiting for approval and can no longer be changed.');
    expect(writes()).toEqual([]);
  });
});

describe('Feed requisition decided in the Approvals inbox (D25)', () => {
  it('refreshes an Actual Feed Plan after an approved run-linked requisition commits', async () => {
    const { approvals, forecast, as } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST], [{ ...REQUEST, status: 'APPROVED' }]]],
      [schema.requisition, [[{ ...PENDING_ROW, production_date: '2026-10-08', feed_forecast_run_id: 'run-1' }], [{ productionDate: '2026-10-08', feedForecastRunId: 'run-1' }]]],
      [schema.requisitionLine, [[LINE_6000]]],
    ]));
    const refresh = jest.spyOn(forecast, 'generateFeedPlanVersion').mockResolvedValue({} as any);
    await as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN));
    expect(refresh).toHaveBeenCalledWith('farm-grs', '2026-10-08', 'tenant-1', { userId: 'u-admin', userType: 'COMPANY_ADMIN' });
  });

  it('approving updates the requisition and the request together, then re-evaluates alerts after commit', async () => {
    const { approvals, as, writes, evaluated } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST], [{ ...REQUEST, status: 'APPROVED' }]]],
      [schema.requisition, [[PENDING_ROW]]],
      [schema.requisitionLine, [[LINE_6000]]],
    ]));
    await as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN));
    expect(writes().find((e) => e.op === 'update' && e.table === schema.requisition)!.set)
      .toMatchObject({ status: 'APPROVED', approved_by: 'u-admin', remarks: null });
    expect(writes().find((e) => e.op === 'update' && e.table === schema.approvalRequest)!.set).toMatchObject({ status: 'APPROVED' });
    expect(writes().every((e) => e.inTx)).toBe(true);
    expect(evaluated).toEqual([{ args: ['farm-grs', 'co-1', 'tenant-1'], inTx: false }]);
  });

  it('refuses without remarks and leaves both documents pending (Review Focus 4)', async () => {
    const { approvals, as, writes, evaluated } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST]]],
      [schema.requisition, [[PENDING_ROW]]],
      [schema.requisitionLine, [[{ ...LINE_6000, quantity: '9000.0000' }]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN))).rejects.toThrow(/more than 20% off/);
    expect(writes()).toEqual([]);
    expect(evaluated).toEqual([]);
  });

  it('accepts the approver\'s remarks for a deviating line', async () => {
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST], [REQUEST]]],
      [schema.requisition, [[PENDING_ROW]]],
      [schema.requisitionLine, [[{ ...LINE_6000, quantity: '9000.0000' }]]],
    ]));
    await as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN, 'Extra pigs arriving'));
    expect(writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ status: 'APPROVED', remarks: 'Approved: Extra pigs arriving' });
  });

  /**
   * F6 (final review M3). The approval replaced the requisition's remarks
   * with the approver's, so the farm's justification — the thing checkpoints
   * 18 and 22 asked for — vanished from the document that carries it. A
   * rejection already appends; an approval does now too.
   */
  it('appends the approver\'s remarks and keeps the farm\'s (F6)', async () => {
    const withFarmRemarks = { ...PENDING_ROW, remarks: 'Extra pigs arriving Tuesday' };
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST], [REQUEST]]],
      [schema.requisition, [[withFarmRemarks]]],
      [schema.requisitionLine, [[{ ...LINE_6000, quantity: '9000.0000' }]]],
    ]));
    await as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN, 'Checked with the mill'));
    expect(writes().find((e) => e.table === schema.requisition)!.set)
      .toMatchObject({ status: 'APPROVED', remarks: 'Extra pigs arriving Tuesday\nApproved: Checked with the mill' });
  });

  it('leaves the farm\'s remarks alone when the approver adds none (F6)', async () => {
    const withFarmRemarks = { ...PENDING_ROW, remarks: 'Extra pigs arriving Tuesday' };
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST], [REQUEST]]],
      [schema.requisition, [[withFarmRemarks]]],
      [schema.requisitionLine, [[LINE_6000]]],
    ]));
    await as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN));
    expect(writes().find((e) => e.table === schema.requisition)!.set)
      .toMatchObject({ status: 'APPROVED', remarks: 'Extra pigs arriving Tuesday' });
  });

  it('files an approval\'s remarks as remarks in the audit, not as a rejection reason (F6)', async () => {
    const { approvals, as, audits } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST], [REQUEST]]],
      [schema.requisition, [[PENDING_ROW]]],
      [schema.requisitionLine, [[LINE_6000]]],
    ]));
    await as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN, 'Checked with the mill'));
    const entry = audits().find((a: any) => a.action === 'APPROVE')!;
    expect(entry.newValues).toEqual({ status: 'APPROVED', remarks: 'Checked with the mill' });
    expect((entry.newValues as any).rejection_reason).toBeUndefined();
  });

  it('rejecting needs a reason and records it on the requisition', async () => {
    const none = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[REQUEST]]], [schema.requisition, [[PENDING_ROW]]]]));
    await expect(none.as(COMPANY_ADMIN_SCOPE, () => none.approvals.reject('ar-1', {}, 'tenant-1', ADMIN))).rejects.toThrow('A rejection reason is required.');
    expect(none.writes()).toEqual([]);
    const withReason = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[REQUEST], [REQUEST]]], [schema.requisition, [[PENDING_ROW]]]]));
    await withReason.as(COMPANY_ADMIN_SCOPE, () => withReason.approvals.reject('ar-1', { rejection_reason: 'Silo being cleaned' }, 'tenant-1', ADMIN));
    expect(withReason.writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ status: 'REJECTED', remarks: 'Rejected: Silo being cleaned' });
  });

  it('a withdrawal puts the requisition back to draft (S9)', async () => {
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([[schema.approvalRequest, [[REQUEST]]], [schema.requisition, [[PENDING_ROW]]]]));
    await as(COMPANY_ADMIN_SCOPE, () => approvals.remove('ar-1', 'tenant-1', ADMIN));
    expect(writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ status: 'DRAFT', approval_request_id: null });
  });

  it('refuses a farm approver without the requisition approve grant (S5), writing nothing', async () => {
    const { approvals, as, writes } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST]]],
      [schema.userRoleAssignment, [[]]],
    ]));
    await expect(as(OWN_FARM_SCOPE, () => approvals.approve('ar-1', 'tenant-1', FARM_USER))).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes()).toEqual([]);
  });

  it('will not decide a request whose requisition moved on', async () => {
    const { approvals, as } = setup(new Map<unknown, unknown[][]>([
      [schema.approvalRequest, [[REQUEST]]],
      [schema.requisition, [[{ ...PENDING_ROW, status: 'APPROVED' }]]],
    ]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => approvals.approve('ar-1', 'tenant-1', ADMIN)))
      .rejects.toThrow('Requisition REQ-GRS-2026-00041 is not waiting for this approval.');
  });
});
