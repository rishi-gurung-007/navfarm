import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import type { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { ApprovalService } from '../../production/approval/approval.service';
import { FeedForecastService } from '../../inventory/feed-forecast/feed-forecast.service';
import { addDaysIso, serverToday } from './feed-requisition.rules';
import { FeedRequisitionService } from './feed-requisition.service';

/**
 * Requisition §4 steps 3–4 and checkpoints 18, 19 and 22, run through the
 * REAL FeedForecastService (resolveFarm, withFarmScope), ApprovalService and
 * AuditLogService over a recording database (Ruling C1): the decision must be
 * recorded for a company admin under a company scope and for a farm user
 * pinned to their own farm — the two callers the batch-scoped approval paths
 * refused — and another farm's requisition must be not found before anything
 * is written.
 */

interface Entry { op: string; table: unknown; where?: unknown; lock?: string; values?: any; set?: any; inTx?: boolean }

function recordingDb(queues: Map<unknown, unknown[][]>, cls: () => ClsService) {
  const log: Entry[] = [];
  const inTx = () => cls().get('tenantPostingTransaction') === true;
  const db: any = {
    select: jest.fn(() => {
      const entry: Entry = { op: 'select', table: undefined, inTx: inTx() };
      log.push(entry);
      const self: any = {
        from: (t: unknown) => { entry.table = t; return self; },
        leftJoin: () => self,
        innerJoin: () => self,
        where: (c: unknown) => { entry.where = c; return self; },
        orderBy: () => self,
        limit: () => self,
        for: (mode: string) => { entry.lock = mode; return self; },
        then: (ok: any, err: any) => Promise.resolve().then(() => queues.get(entry.table)?.shift() ?? []).then(ok, err),
      };
      return self;
    }),
    insert: jest.fn((t: unknown) => ({ values: jest.fn(async (v: unknown) => { log.push({ op: 'insert', table: t, values: v, inTx: inTx() }); }) })),
    update: jest.fn((t: unknown) => ({ set: (v: unknown) => ({ where: async (c: unknown) => { log.push({ op: 'update', table: t, set: v, where: c, inTx: inTx() }); } }) })),
    delete: jest.fn((t: unknown) => ({ where: async (c: unknown) => { log.push({ op: 'delete', table: t, where: c, inTx: inTx() }); } })),
  };
  return { db, log };
}
const render = (c: unknown) => new MySqlDialect().sqlToQuery(c as any);

const TODAY = serverToday();
const REQ_ROW = {
  requisition_id: 'req-1', tenant_id: 'tenant-1', company_id: 'co-1', farm_id: 'farm-grs', req_no: 'REQ-GRS-2026-00041', doc_type: 'FEED',
  status: 'AUTO_DRAFT', priority: 'CRITICAL', remarks: null, submission_deadline: addDaysIso(TODAY, 1), approval_request_id: null,
};
const FARM = { code: 'GRS', name: 'Green Ridge' };
const LINE_6000 = { line_seq: 1, description: 'Weaner Diet R1', quantity: '6000.0000', recommended: '6000.0000' };
const VIEW = [{ req: { ...REQ_ROW, status: 'APPROVED' }, farm_code: 'GRS', truck_target_kg: 30000 }];

const COMPANY_ADMIN_SCOPE: FarmScope = { farmId: 'farm-x', companyId: 'co-1', restricted: false, lobId: null };
const OWN_FARM_SCOPE: FarmScope = { farmId: 'farm-grs', companyId: 'co-1', restricted: true, lobId: 'lob-pig' };
const APPROVE_GRANT = {
  moduleCode: 'PROCUREMENT', resource: 'REQUISITION', canView: true, canCreate: true, canEdit: false, canDelete: false, canApprove: true, canExport: false, canPrint: false,
};

function setup(queues: Map<unknown, unknown[][]>) {
  const ref = {} as { cls: ClsService };
  const { db, log } = recordingDb(queues, () => ref.cls);
  const cls = (ref.cls = transactionCls(db));
  const forecast = new FeedForecastService(cls, {} as any, {} as any);
  const approvals = new ApprovalService(cls, new AuditLogService(cls), {} as any);
  const evaluated: Array<{ args: unknown[]; inTx: boolean }> = [];
  const alerts: any = {
    evaluateFarmSafely: jest.fn(async (...args: unknown[]) => { evaluated.push({ args, inTx: cls.get('tenantPostingTransaction') === true }); }),
  };
  const service = new FeedRequisitionService(cls, forecast, approvals, alerts);
  /** Runs `work` as a request whose guard resolved `scope`. */
  const as = <T>(scope: FarmScope, work: () => Promise<T>) => cls.run(async () => { cls.set(FARM_SCOPE_KEY, scope); return work(); });
  const writes = () => log.filter((e) => e.op !== 'select');
  return { service, log, evaluated, as, writes };
}

describe('FeedRequisitionService.approve — own farm only (checkpoint 19, Ruling C1)', () => {
  it('a COMPANY_ADMIN under a company scope (another farm pinned) approves, and the decision lands in the approval engine', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [REQ_ROW], VIEW]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }], [FARM]]],
      [schema.requisitionLine, [[{ ...LINE_6000, quantity: '9000.0000' }], []]],
    ]);
    const { service, log, evaluated, as, writes } = setup(queues);
    const view = await as(COMPANY_ADMIN_SCOPE, () =>
      service.approve('req-1', { remarks: 'Extra pigs arriving' }, 'tenant-1', { userId: 'u-admin', userType: 'COMPANY_ADMIN', email: 'admin@x' }));
    expect(view).toMatchObject({ status: 'APPROVED', farm_code: 'GRS' });

    // The lock re-applies the row's own farm and company, not the pinned farm-x.
    const lock = log.find((e) => e.op === 'select' && e.table === schema.requisition && e.lock === 'update')!;
    expect(render(lock.where).params).toEqual(expect.arrayContaining(['req-1', 'farm-grs', 'co-1']));
    expect(render(lock.where).params).not.toContain('farm-x');

    const request = writes().find((e) => e.op === 'insert' && e.table === schema.approvalRequest)!;
    expect(request.values).toMatchObject({
      tenant_id: 'tenant-1', company_id: 'co-1', doc_type: 'FEED_REQUISITION', doc_no: 'REQ-GRS-2026-00041', status: 'APPROVED',
      decided_by: 'u-admin', requested_by: 'u-admin', justification: 'Extra pigs arriving', urgency: 'HIGH', location_label: 'GRS — Green Ridge',
      rejection_reason: null,
    });
    expect(request.values.batch_id).toBeUndefined();
    const history = writes().filter((e) => e.op === 'insert' && e.table === schema.auditLog).map((e) => e.values);
    expect(history).toEqual([
      expect.objectContaining({ action: 'CREATE', entity_name: 'approval_request', entity_id: request.values.request_id }),
      expect.objectContaining({
        action: 'APPROVE', entity_id: request.values.request_id,
        new_values: expect.objectContaining({ status: 'APPROVED', document_id: 'req-1', farm_id: 'farm-grs', remarks: 'Extra pigs arriving' }),
      }),
    ]);
    const header = writes().find((e) => e.op === 'update' && e.table === schema.requisition)!;
    expect(header.set).toMatchObject({
      status: 'APPROVED', approval_request_id: request.values.request_id, approved_by: 'u-admin', remarks: 'Extra pigs arriving',
    });
    expect(writes().every((e) => e.inTx)).toBe(true);
    // The REQ_DEADLINE alert is re-evaluated once, after the decision committed.
    expect(evaluated).toEqual([{ args: ['farm-grs', 'co-1', 'tenant-1'], inTx: false }]);
  });

  it('a STANDARD_USER pinned to their own farm approves it with the approve grant', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.userRoleAssignment, [[APPROVE_GRANT]]],
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [REQ_ROW], VIEW]],
      [schema.locationMaster, [[FARM]]],
      [schema.requisitionLine, [[LINE_6000], []]],
    ]);
    const { service, writes, evaluated, as } = setup(queues);
    await as(OWN_FARM_SCOPE, () => service.approve('req-1', {}, 'tenant-1', { userId: 'u-farm', userType: 'STANDARD_USER' }));
    expect(writes().find((e) => e.table === schema.approvalRequest)!.values).toMatchObject({ status: 'APPROVED', company_id: 'co-1', decided_by: 'u-farm' });
    expect(writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ status: 'APPROVED', remarks: null });
    expect(evaluated).toHaveLength(1);
  });

  it('a STANDARD_USER pinned to another farm is answered not found, and nothing is written', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.userRoleAssignment, [[APPROVE_GRANT]]],
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [REQ_ROW]]],
    ]);
    const { service, writes, evaluated, as } = setup(queues);
    await expect(as({ ...OWN_FARM_SCOPE, farmId: 'farm-porta' }, () =>
      service.approve('req-1', { remarks: 'x' }, 'tenant-1', { userId: 'u-porta', userType: 'STANDARD_USER' }))).rejects.toThrow(NotFoundException);
    expect(writes()).toEqual([]);
    expect(evaluated).toEqual([]);
  });

  it("a COMPANY_ADMIN of another company is answered not found (the farm is not one of the scope's company)", async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-other', company_id: 'co-2' }], [REQ_ROW]]],
      [schema.locationMaster, [[/* farm-other is not a farm of co-1 */]]],
    ]);
    const { service, writes, as } = setup(queues);
    await expect(as(COMPANY_ADMIN_SCOPE, () =>
      service.approve('req-1', { remarks: 'x' }, 'tenant-1', { userId: 'u-admin', userType: 'COMPANY_ADMIN' }))).rejects.toThrow(NotFoundException);
    expect(writes()).toEqual([]);
  });

  it('refuses a caller without the requisition approve grant before reading anything', async () => {
    const queues = new Map<unknown, unknown[][]>([[schema.userRoleAssignment, [[{ ...APPROVE_GRANT, canApprove: false }]]]]);
    const { service, log, as } = setup(queues);
    await expect(as(OWN_FARM_SCOPE, () => service.approve('req-1', {}, 'tenant-1', { userId: 'u-farm', userType: 'STANDARD_USER' })))
      .rejects.toThrow(ForbiddenException);
    expect(log.some((e) => e.table === schema.requisition)).toBe(false);
  });
});

describe('FeedRequisitionService.approve — checkpoints 18 and 22, Q3', () => {
  const base = (row: object, lines: object[]) => new Map<unknown, unknown[][]>([
    [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [row], VIEW]],
    [schema.locationMaster, [[{ location_id: 'farm-grs' }], [FARM]]],
    [schema.requisitionLine, [lines, []]],
  ]);
  const admin = { userId: 'u-admin', userType: 'COMPANY_ADMIN' };

  it('refuses more than 20 % from the recommendation without remarks, writing nothing', async () => {
    const { service, writes, as } = setup(base(REQ_ROW, [{ ...LINE_6000, quantity: '9000.0000' }]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => service.approve('req-1', {}, 'tenant-1', admin)))
      .rejects.toThrow(new BadRequestException('Line 1 (Weaner Diet R1): requested 9,000 kg is more than 20% from the recommended 6,000 kg — remarks are required.'));
    expect(writes()).toEqual([]);
  });

  it('refuses a late approval without remarks (Q5), and accepts the remarks already saved on the requisition', async () => {
    const late = { ...REQ_ROW, submission_deadline: addDaysIso(TODAY, -1) };
    const refused = setup(base(late, [LINE_6000]));
    await expect(refused.as(COMPANY_ADMIN_SCOPE, () => refused.service.approve('req-1', {}, 'tenant-1', admin))).rejects.toThrow(/has passed/);
    expect(refused.writes()).toEqual([]);

    const accepted = setup(base({ ...late, remarks: 'Mill confirmed a late slot' }, [LINE_6000]));
    await accepted.as(COMPANY_ADMIN_SCOPE, () => accepted.service.approve('req-1', {}, 'tenant-1', admin));
    expect(accepted.writes().find((e) => e.table === schema.approvalRequest)!.values).toMatchObject({ justification: 'Mill confirmed a late slot' });
  });

  it.each(['DRAFT', 'PENDING_APPROVAL'])('approves from %s in one step', async (status) => {
    const { service, writes, as } = setup(base({ ...REQ_ROW, status }, [LINE_6000]));
    await as(COMPANY_ADMIN_SCOPE, () => service.approve('req-1', {}, 'tenant-1', admin));
    expect(writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ status: 'APPROVED' });
  });

  it('decides an approval request raised earlier in place, rather than raising a second', async () => {
    const queues = base({ ...REQ_ROW, status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' }, [LINE_6000]);
    queues.set(schema.approvalRequest, [[{ request_id: 'ar-1', status: 'PENDING', company_id: 'co-1' }]]);
    const { service, writes, as } = setup(queues);
    await as(COMPANY_ADMIN_SCOPE, () => service.approve('req-1', {}, 'tenant-1', admin));
    expect(writes().filter((e) => e.op === 'insert' && e.table === schema.approvalRequest)).toEqual([]);
    const decided = writes().find((e) => e.op === 'update' && e.table === schema.approvalRequest)!;
    expect(decided.set).toMatchObject({ status: 'APPROVED', decided_by: 'u-admin' });
    expect(render(decided.where).params).toEqual(['ar-1']);
    expect(writes().filter((e) => e.table === schema.auditLog).map((e) => e.values.action)).toEqual(['APPROVE']);
    expect(writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({ approval_request_id: 'ar-1' });
  });

  it('will not decide a requisition that is already approved', async () => {
    const { service, writes, as } = setup(base({ ...REQ_ROW, status: 'APPROVED' }, [LINE_6000]));
    await expect(as(COMPANY_ADMIN_SCOPE, () => service.approve('req-1', { remarks: 'x' }, 'tenant-1', admin))).rejects.toThrow(/APPROVED and can no longer be changed/);
    expect(writes()).toEqual([]);
  });

  it('applies line edits sent with the approval before checking them, marking the quantity edited (M9)', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [REQ_ROW], VIEW]],
      [schema.locationMaster, [
        [{ location_id: 'farm-grs' }],
        [{ location_code: 'GRS', feed_bulk_multiple_kg: 3000, feed_bag_size_kg: 50, feed_truck_target_kg: 30000, feed_production_weekday: 0 }],
        [FARM],
      ]],
      [schema.requisitionLine, [[{ line_id: 'L1', feed_type: 'BULK', quantity: '6000.0000' }], [{ ...LINE_6000, quantity: '9000.0000' }], []]],
    ]);
    const { service, writes, as } = setup(queues);
    await expect(as(COMPANY_ADMIN_SCOPE, () =>
      service.approve('req-1', { lines: [{ line_id: '00000000-0000-4000-8000-000000000001', quantity_kg: 9000 }] }, 'tenant-1', admin)))
      .rejects.toThrow(/more than 20%/);
    // The edit was attempted inside the transaction the refusal rolls back.
    const edit = writes().find((e) => e.table === schema.requisitionLine)!;
    expect(edit).toMatchObject({ inTx: true, set: { quantity: '9000', quantity_edited: true } });
    expect(writes().some((e) => e.table === schema.approvalRequest)).toBe(false);
  });
});

describe('FeedRequisitionService.update — Requisition §4 step 3', () => {
  const FARM_SETTINGS = { location_code: 'GRS', feed_bulk_multiple_kg: 3000, feed_bag_size_kg: 50, feed_truck_target_kg: 30000, feed_production_weekday: 0 };

  it('a changed quantity sets quantity_edited (M9); an unchanged one and a date-only edit do not', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [REQ_ROW], VIEW]],
      [schema.locationMaster, [[{ location_id: 'farm-grs' }], [FARM_SETTINGS]]],
      [schema.requisitionLine, [
        [{ line_id: 'L1', feed_type: 'BAGGED', quantity: '50.0000' }],
        [{ line_id: 'L2', feed_type: 'BULK', quantity: '3000.0000' }],
        [],
      ]],
    ]);
    const { service, writes, as } = setup(queues);
    await as(COMPANY_ADMIN_SCOPE, () => service.update('req-1', {
      remarks: '  Silo 2 cleaned Tuesday ',
      lines: [
        { line_id: 'L1', quantity_kg: 100 },
        { line_id: 'L2', quantity_kg: 3000, proposed_delivery_date: '2026-10-01' },
      ],
    }, 'tenant-1', { userId: 'u-admin', userType: 'COMPANY_ADMIN' }));
    const lineWrites = writes().filter((e) => e.table === schema.requisitionLine).map((e) => e.set);
    expect(lineWrites[0]).toEqual({ quantity: '100', quantity_edited: true, bag_count: 2 });
    expect(lineWrites[1]).toEqual({ bag_count: null, proposed_delivery_date: '2026-10-01' });
    const headers = writes().filter((e) => e.table === schema.requisition).map((e) => e.set);
    expect(headers[0]).toHaveProperty('required_date');
    expect(headers[1]).toEqual({ remarks: 'Silo 2 cleaned Tuesday', updated_by: 'u-admin' });
    expect(writes().every((e) => e.inTx)).toBe(true);
  });

  it('a STANDARD_USER of another farm cannot edit it', async () => {
    const queues = new Map<unknown, unknown[][]>([[schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }]]]]);
    const { service, writes, as } = setup(queues);
    await expect(as({ ...OWN_FARM_SCOPE, farmId: 'farm-porta' }, () =>
      service.update('req-1', { remarks: 'x' }, 'tenant-1', { userId: 'u', userType: 'STANDARD_USER' }))).rejects.toThrow(NotFoundException);
    expect(writes()).toEqual([]);
  });
});

describe('FeedRequisitionService.reject', () => {
  it('needs a reason', async () => {
    const { service, log, as } = setup(new Map());
    await expect(as(COMPANY_ADMIN_SCOPE, () => service.reject('req-1', { rejection_reason: ' ' }, 'tenant-1', { userId: 'u', userType: 'COMPANY_ADMIN' })))
      .rejects.toThrow('A rejection reason is required.');
    expect(log).toEqual([]);
  });

  it('records the rejection in the approval engine with its history row (L15), then re-evaluates the alerts after commit', async () => {
    const queues = new Map<unknown, unknown[][]>([
      [schema.userRoleAssignment, [[APPROVE_GRANT]]],
      [schema.requisition, [[{ farm_id: 'farm-grs', company_id: 'co-1' }], [REQ_ROW], [{ req: { ...REQ_ROW, status: 'REJECTED' }, farm_code: 'GRS', truck_target_kg: 30000 }]]],
      [schema.locationMaster, [[FARM]]],
    ]);
    const { service, writes, evaluated, as } = setup(queues);
    const view = await as(OWN_FARM_SCOPE, () => service.reject('req-1', { rejection_reason: 'Diet change moved a week' }, 'tenant-1', { userId: 'u-farm', userType: 'STANDARD_USER' }));
    expect(view).toMatchObject({ status: 'REJECTED' });
    const request = writes().find((e) => e.table === schema.approvalRequest)!;
    expect(request.values).toMatchObject({ status: 'REJECTED', rejection_reason: 'Diet change moved a week', doc_type: 'FEED_REQUISITION' });
    expect(writes().filter((e) => e.table === schema.auditLog).map((e) => e.values.action)).toEqual(['CREATE', 'REJECT']);
    expect(writes().find((e) => e.table === schema.requisition)!.set).toMatchObject({
      status: 'REJECTED', approval_request_id: request.values.request_id, remarks: 'Rejected: Diet change moved a week',
    });
    expect(evaluated).toEqual([{ args: ['farm-grs', 'co-1', 'tenant-1'], inTx: false }]);
  });
});
