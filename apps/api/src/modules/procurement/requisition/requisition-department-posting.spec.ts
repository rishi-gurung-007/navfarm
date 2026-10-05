/**
 * WP1c — the department checks on the requisition's Transfer Shipment and
 * Transfer Receipt buttons (Rishi's 4 Oct field and button list, kept verbatim
 * in docs/superpowers/plans/feed-completion/common-requisition-spec.md):
 *
 *   Transfer Shipment Button: Done by sender department user.
 *     Validation: user dept (from User Setup) must match From Sub-Location dimension.
 *   Transfer Receipt Button: Done by requester user at To Sub-Location.
 *     Validation: user dept must match To Sub-Location dimension.
 *
 * The department is a Cost Center identity (never free text) read from
 * user_master.department_id and location_master.department_id. Rishi's bound
 * (decisions.md 2026-10-04, last entry) is that admins get NO bypass here:
 * their extra power is approval only. A location with no department has no
 * dimension to match — the same NULL-belongs-to-everybody carve-out the LOB
 * scope uses — and legacy rows without from/to locations have nothing to
 * check, so both pass through.
 *
 * The recording-database pattern is requisition.release.spec.ts's.
 */
import { ForbiddenException } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { ApprovalService } from '../../production/approval/approval.service';
import { RequisitionService } from './requisition.service';
import { RequisitionController } from './requisition.controller';
import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';

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
        leftJoin: () => self, innerJoin: () => self, where: () => self, orderBy: () => self, groupBy: () => self, limit: () => self, for: () => self,
        then: (ok: any, err: any) => Promise.resolve().then(() => queues.get(entry.table)?.shift() ?? []).then(ok, err),
      };
      return self;
    }),
    insert: jest.fn((t: unknown) => ({ values: jest.fn(async (v: unknown) => { log.push({ op: 'insert', table: t, values: v, inTx: inTx() }); }) })),
    update: jest.fn((t: unknown) => ({ set: (v: unknown) => ({ where: async () => { log.push({ op: 'update', table: t, set: v, inTx: inTx() }); } }) })),
  };
  return { db, log };
}

const SENDER = { userId: 'u-sender', userType: 'STANDARD_USER', email: 'sender@x' };

/** A RELEASED Store requisition with its linked transfer, as release() left it. */
const RELEASED_STORE_ROW = {
  requisition_id: 'req-1', tenant_id: 'tenant-1', company_id: 'co-1', farm_id: null,
  req_no: 'REQ-2026-0001', doc_type: 'ITEM', status: 'APPROVED', required_date: null,
  justification: null, approval_request_id: 'ar-1', linked_po_no: null,
  requisition_type: null, source: 'MANUAL_ENTRY', purpose: 'STORE', supply_source: null,
  priority: null, forecast_run_key: null, feed_forecast_run_id: null,
  production_date: null, submission_deadline: null, remarks: null,
  approved_by: 'u-approver', approved_at: '2026-10-01 09:00:00', created_by: 'u-req',
  updated_by: 'u-approver', created_at: '2026-10-01 08:00:00', updated_at: '2026-10-01 10:00:00', deleted_at: null,
  requisition_date: '2026-10-01', main_location_id: null,
  requester_user_id: 'u-req', requester_name: 'Requester', requester_department_id: 'cc-1',
  sender_department_id: 'cc-1',
  approval_status: 'APPROVED', document_status: 'RELEASED',
  fulfilment_status: 'TRANSFER_OPEN', integration_status: 'NOT_APPLICABLE',
  from_location_id: 'loc-store', to_location_id: 'loc-farm',
  direct_transfer: false, linked_transfer_id: 'tr-1', released_by: 'u-sender', released_at: '2026-10-01 10:00:00',
};
const LINES = [{ line_id: 'l1', line_seq: 1, item_id: 'i1', resource_id: null, description: null, quantity: '10', uom: 'EA', est_rate: null, from_location_id: 'loc-store', to_location_id: 'loc-farm', qty_to_ship: '10', qty_shipped: null, qty_to_receive: '10', qty_received: null, item_code: 'IT-1', item_name: 'Item' }];
const TRANSFER_LINES = [{ line_id: 'tl-1', requisition_line_id: 'l1' }];
const SHIP_DTO = { posting_date: '2026-10-02', lines: [{ line_id: 'l1', quantity: 6 }] };
const SHIPMENT_VIEW = { ...RELEASED_STORE_ROW, lines: LINES.map((l) => ({ ...l, balance_to_ship: 4, remaining_to_receive: 10, qty_shipped: 0, qty_received: 0, from_location_code: null, to_location_code: null, resource_code: null, resource_name: null })) };
const STORE_SCOPE: FarmScope = { farmId: null, companyId: 'co-1', restricted: false, lobId: null };

type Queues = Map<unknown, unknown[][]>;

/** Queues for a ship() call: the lock row, the dept-check reads, the posting read-back. */
function shipQueues(over: {
  fromDepartmentId?: string | null; userDepartmentId?: string | null;
} = {}): Queues {
  return new Map<unknown, unknown[][]>([
    [schema.requisition, [[{ ...RELEASED_STORE_ROW }], [SHIPMENT_VIEW]]],
    [schema.stockTransferLine, [TRANSFER_LINES]],
    [schema.locationMaster, [[{ location_id: 'loc-store', department_id: over.fromDepartmentId ?? 'cc-1' }], []]],
    [schema.userMaster, [[{ user_id: 'u-sender', department_id: over.userDepartmentId ?? 'cc-1' }], []]],
    [schema.requisitionLine, [LINES]],
    [schema.costCenterMaster, [[]]],
    [schema.stockTransfer, [[{ transfer_id: 'tr-1', transfer_no: 'TR-000001' }]]],
    [schema.transferShipment, [[]]],
    [schema.transferReceiptLine, [[]]],
  ]);
}

/** Queues for a receive() call: the same shape, checked against the To location. */
function receiveQueues(over: {
  toDepartmentId?: string | null; userDepartmentId?: string | null;
} = {}): Queues {
  return new Map<unknown, unknown[][]>([
    [schema.requisition, [[{ ...RELEASED_STORE_ROW }], [SHIPMENT_VIEW]]],
    [schema.stockTransferLine, [TRANSFER_LINES]],
    [schema.locationMaster, [[{ location_id: 'loc-farm', department_id: over.toDepartmentId ?? 'cc-1' }], []]],
    [schema.userMaster, [[{ user_id: 'u-sender', department_id: over.userDepartmentId ?? 'cc-1' }], []]],
    [schema.requisitionLine, [LINES]],
    [schema.costCenterMaster, [[]]],
    [schema.stockTransfer, [[{ transfer_id: 'tr-1', transfer_no: 'TR-000001' }]]],
    [schema.transferShipment, [[{ shipment_id: 'sh-1', shipment_no: 'SH-1', shipment_date: '2026-10-02', shipment_line_id: 'sl-1', requisition_line_id: 'l1', qty: '6' }]]],
    [schema.transferReceiptLine, [[]]],
  ]);
}

function setup(queues: Queues) {
  const ref = {} as { cls: ClsService };
  const { db } = recordingDb(queues, () => ref.cls);
  const cls = (ref.cls = transactionCls(db));
  const approvals = new ApprovalService(cls, new AuditLogService(cls), {} as any);
  const stockTransfers = {
    postShipment: jest.fn().mockResolvedValue({ shipment_id: 'sh-1', shipment_no: 'SH-1' }),
    postReceipt: jest.fn().mockResolvedValue({ receipt_id: 'rc-1', receipt_no: 'RC-1' }),
    postDirectTransfer: jest.fn().mockResolvedValue({ transfer_id: 'tr-1' }),
  };
  const service = new RequisitionService(cls, approvals, stockTransfers as any, {} as any);
  const as = <T>(scope: FarmScope, work: () => Promise<T>) => cls.run(async () => { cls.set(FARM_SCOPE_KEY, scope); return work(); });
  return { service, as, stockTransfers };
}

describe('WP1c — the Transfer Shipment button is the From sub-location department\'s', () => {
  it('refuses a user whose department differs from the From sub-location\'s', async () => {
    const { service, as, stockTransfers } = setup(shipQueues({ fromDepartmentId: 'cc-store', userDepartmentId: 'cc-other' }));
    await expect(as(STORE_SCOPE, () => service.ship('req-1', SHIP_DTO, 'tenant-1', SENDER)))
      .rejects.toThrow(new ForbiddenException("Only the From sub-location's department may post this Transfer Shipment."));
    expect(stockTransfers.postShipment).not.toHaveBeenCalled();
  });

  it('refuses a user with no department (User Setup) when the From sub-location carries one', async () => {
    const { service, as, stockTransfers } = setup(shipQueues({ fromDepartmentId: 'cc-store', userDepartmentId: null }));
    await expect(as(STORE_SCOPE, () => service.ship('req-1', SHIP_DTO, 'tenant-1', SENDER)))
      .rejects.toThrow(ForbiddenException);
    expect(stockTransfers.postShipment).not.toHaveBeenCalled();
  });

  it('posts the shipment for a user of the From sub-location\'s department', async () => {
    const { service, as, stockTransfers } = setup(shipQueues({ fromDepartmentId: 'cc-store', userDepartmentId: 'cc-store' }));
    const result = await as(STORE_SCOPE, () => service.ship('req-1', SHIP_DTO, 'tenant-1', SENDER));
    expect(stockTransfers.postShipment).toHaveBeenCalledWith('tr-1', { posting_date: '2026-10-02', lines: [{ line_id: 'tl-1', quantity: 6 }] }, 'tenant-1', SENDER);
    expect(result.req_no).toBe('REQ-2026-0001');
  });

  it('passes when the From sub-location has no department (no dimension to match)', async () => {
    const { service, as, stockTransfers } = setup(shipQueues({ fromDepartmentId: null, userDepartmentId: null }));
    await as(STORE_SCOPE, () => service.ship('req-1', SHIP_DTO, 'tenant-1', SENDER));
    expect(stockTransfers.postShipment).toHaveBeenCalledTimes(1);
  });

  it('checks nothing on a legacy row without locations', async () => {
    const queues = shipQueues();
    queues.set(schema.requisition, [[{ ...RELEASED_STORE_ROW, from_location_id: null, to_location_id: null }], [SHIPMENT_VIEW]]);
    const { service, as, stockTransfers } = setup(queues);
    await as(STORE_SCOPE, () => service.ship('req-1', SHIP_DTO, 'tenant-1', SENDER));
    expect(stockTransfers.postShipment).toHaveBeenCalledTimes(1);
  });
});

/**
 * P1 follow-up item 3 — Rishi, 5 Oct (decisions.md "Common requisition:
 * requester, Service lines, receipt and release", point 3): "The one
 * requesting is the one who would be receiving." The Transfer Receipt is
 * posted by the requisition's requester (requester_user_id); the list's
 * department check still applies (the requester's department must match the
 * To Sub-Location); no separate receive permission is needed — which is why
 * the route is guarded by the requisition's own view grant, not the stock
 * transfer's edit grant.
 */
describe('Transfer Receipt — posted by the requester, at the To sub-location\'s department', () => {
  const RECV_DTO = { posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'l1', quantity: 6 }] };
  const REQUESTER = { userId: 'u-req', userType: 'STANDARD_USER', email: 'req@x' };

  it('posts the receipt for the requester whose department matches the To sub-location', async () => {
    const { service, as, stockTransfers } = setup(receiveQueues({ toDepartmentId: 'cc-farm', userDepartmentId: 'cc-farm' }));
    await as(STORE_SCOPE, () => service.receive('req-1', RECV_DTO, 'tenant-1', REQUESTER));
    expect(stockTransfers.postReceipt).toHaveBeenCalledWith('tr-1', { posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'tl-1', quantity: 6 }] }, 'tenant-1', REQUESTER);
  });

  it('refuses any other user, even one of the To sub-location\'s department', async () => {
    const { service, as, stockTransfers } = setup(receiveQueues({ toDepartmentId: 'cc-farm', userDepartmentId: 'cc-farm' }));
    await expect(as(STORE_SCOPE, () => service.receive('req-1', RECV_DTO, 'tenant-1', SENDER)))
      .rejects.toThrow(new ForbiddenException('Only the requester of REQ-2026-0001 may post its Transfer Receipt.'));
    expect(stockTransfers.postReceipt).not.toHaveBeenCalled();
  });

  it('refuses an admin who is not the requester — admins get no bypass here (decisions, 4 Oct)', async () => {
    const { service, as, stockTransfers } = setup(receiveQueues({ toDepartmentId: 'cc-farm', userDepartmentId: 'cc-farm' }));
    await expect(as(STORE_SCOPE, () => service.receive('req-1', RECV_DTO, 'tenant-1', { userId: 'u-admin', userType: 'COMPANY_ADMIN', email: 'ca@x' })))
      .rejects.toThrow('Only the requester of REQ-2026-0001 may post its Transfer Receipt.');
    expect(stockTransfers.postReceipt).not.toHaveBeenCalled();
  });

  it('refuses the requester when their department differs from the To sub-location\'s', async () => {
    const { service, as, stockTransfers } = setup(receiveQueues({ toDepartmentId: 'cc-farm', userDepartmentId: 'cc-other' }));
    await expect(as(STORE_SCOPE, () => service.receive('req-1', RECV_DTO, 'tenant-1', REQUESTER)))
      .rejects.toThrow(new ForbiddenException("Only the To sub-location's department may post this Transfer Receipt."));
    expect(stockTransfers.postReceipt).not.toHaveBeenCalled();
  });

  it('the receipt route asks the requisition view grant, not INVENTORY/STOCK_TRANSFER edit', () => {
    const receive = Object.getOwnPropertyDescriptor(RequisitionController.prototype, 'receive')?.value;
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, receive)).toEqual({ moduleCode: 'PROCUREMENT', resource: 'REQUISITION', action: 'view' });
  });

  it('leaves the shipment route on INVENTORY/STOCK_TRANSFER edit (the sender department ships)', () => {
    const ship = Object.getOwnPropertyDescriptor(RequisitionController.prototype, 'ship')?.value;
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, ship)).toEqual({ moduleCode: 'INVENTORY', resource: 'STOCK_TRANSFER', action: 'edit' });
  });
});
