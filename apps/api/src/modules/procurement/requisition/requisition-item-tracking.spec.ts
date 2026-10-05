/**
 * WP4a live-check defect — Item Tracking on a RELEASED Store requisition.
 *
 * Rishi's 4 Oct list (common-requisition-spec.md):
 *   ITEM TRACKING BUTTON (on Sub-Form Line): Opens Lot/Serial assignment page.
 *   If Lot or Serial tracked: MANDATORY before Transfer Shipment post.
 *
 * Found live on nf_devco, 5 Oct (RQ-00021, lot-tracked ILL-LOT-001): a
 * requisition submitted without its lot is approved and released, then the
 * shipment is refused ("Item is lot-tracked; assign a lot before shipment.")
 * — and nothing can assign the lot any more: PUT /requisition refuses
 * anything but an Open document, and the release copied the empty assignment
 * onto the transfer. The document is stuck. The rule says the assignment is
 * mandatory BEFORE SHIPMENT, so it must still be assignable after release
 * while the line has not shipped. The store that ships picks the lot, so the
 * same From-department check as the shipment applies.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { ApprovalService } from '../../production/approval/approval.service';
import { RequisitionService } from './requisition.service';
import { resolveTrackingAssignment } from './requisition.rules';

const LOT = { isLotTracked: true, isSerialTracked: false };
const SERIAL = { isLotTracked: false, isSerialTracked: true };

describe('resolveTrackingAssignment — what may be assigned to one released line', () => {
  const line = { line_seq: 1, item_code: 'ILL-LOT-001', qty_shipped: 0 };

  it('takes a lot for a lot-tracked item, trimmed', () => {
    expect(resolveTrackingAssignment(line, LOT, { lot_no: ' LOT00001 ' })).toEqual({ lot_no: 'LOT00001', serial_no: null });
  });

  it('takes serials for a serial-tracked item, one comma-separated list without blanks', () => {
    expect(resolveTrackingAssignment(line, SERIAL, { serial_no: 'SN1, SN2,,' })).toEqual({ lot_no: null, serial_no: 'SN1,SN2' });
  });

  it('refuses a lot-tracked line without a lot, and a serial-tracked line without serials', () => {
    expect(() => resolveTrackingAssignment(line, LOT, { lot_no: '  ' })).toThrow(new BadRequestException('Line 1: ILL-LOT-001 is lot-tracked; assign a lot.'));
    expect(() => resolveTrackingAssignment(line, SERIAL, {})).toThrow(new BadRequestException('Line 1: ILL-LOT-001 is serial-tracked; assign its serial numbers.'));
  });

  it('refuses the identity the item does not track', () => {
    expect(() => resolveTrackingAssignment(line, LOT, { lot_no: 'L1', serial_no: 'S1' })).toThrow('is not serial-tracked');
    expect(() => resolveTrackingAssignment(line, SERIAL, { lot_no: 'L1', serial_no: 'S1' })).toThrow('is not lot-tracked');
  });

  it('refuses an untracked item — there is nothing to assign', () => {
    expect(() => resolveTrackingAssignment(line, { isLotTracked: false, isSerialTracked: false }, { lot_no: 'L1' }))
      .toThrow(new BadRequestException('Line 1: ILL-LOT-001 is not lot- or serial-tracked; it has no Item Tracking.'));
  });

  it('refuses a line that has already shipped — the shipment carried its identity', () => {
    expect(() => resolveTrackingAssignment({ ...line, qty_shipped: '2.0000' }, LOT, { lot_no: 'L1' }))
      .toThrow(new BadRequestException('Line 1 has shipped; its Item Tracking can no longer change.'));
  });
});

interface Entry { op: string; table: unknown; set?: any; inTx?: boolean }

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
    insert: jest.fn((t: unknown) => ({ values: jest.fn(async () => { log.push({ op: 'insert', table: t, inTx: inTx() }); }) })),
    update: jest.fn((t: unknown) => ({ set: (v: unknown) => ({ where: async () => { log.push({ op: 'update', table: t, set: v, inTx: inTx() }); } }) })),
  };
  return { db, log };
}

const SHIPPER = { userId: 'u-store', userType: 'COMPANY_ADMIN', email: 'store@x' };
const RELEASED = {
  requisition_id: 'req-1', tenant_id: 'tenant-1', company_id: 'co-1', farm_id: null, req_no: 'RQ-00021', doc_type: 'ITEM',
  status: 'APPROVED', approval_status: 'APPROVED', document_status: 'RELEASED', fulfilment_status: 'TRANSFER_OPEN',
  integration_status: 'NOT_APPLICABLE', purpose: 'STORE', from_location_id: 'loc-store', to_location_id: 'loc-shed',
  direct_transfer: false, linked_transfer_id: 'tr-1', deleted_at: null,
};
const REQ_LINE = { line_id: 'l1', line_seq: 1, item_id: 'i-lot', qty_shipped: null, item_code: 'ILL-LOT-001' };
const DTO = { lines: [{ line_id: 'l1', lot_no: 'LOT00001' }] };
const SCOPE: FarmScope = { farmId: null, companyId: 'co-1', restricted: false, lobId: null };

function queues(over: { userDepartmentId?: string | null; line?: object } = {}) {
  return new Map<unknown, unknown[][]>([
    [schema.requisition, [[{ ...RELEASED }], [{ ...RELEASED }]]],
    [schema.stockTransferLine, [[{ line_id: 'tl-1', requisition_line_id: 'l1' }]]],
    [schema.locationMaster, [[{ department_id: 'cc-store' }], []]],
    [schema.userMaster, [[{ department_id: over.userDepartmentId === undefined ? 'cc-store' : over.userDepartmentId }], []]],
    [schema.requisitionLine, [[{ ...REQ_LINE, ...over.line }], []]],
    [schema.itemMaster, [[{ item_id: 'i-lot', is_lot_tracked: 1, is_serial_tracked: 0 }]]],
  ]);
}

function setup(q: Map<unknown, unknown[][]>) {
  const ref = {} as { cls: ClsService };
  const { db, log } = recordingDb(q, () => ref.cls);
  const cls = (ref.cls = transactionCls(db));
  const approvals = new ApprovalService(cls, new AuditLogService(cls), {} as any);
  const service = new RequisitionService(cls, approvals, {} as any, {} as any);
  const as = <T>(work: () => Promise<T>) => cls.run(async () => { cls.set(FARM_SCOPE_KEY, SCOPE); return work(); });
  const updates = () => log.filter((e) => e.op === 'update');
  return { service, as, updates };
}

describe('RequisitionService.assignTracking — Item Tracking after release, before shipment', () => {
  it('writes the lot to the requisition line and to its transfer line, in one transaction', async () => {
    const { service, as, updates } = setup(queues());
    await as(() => service.assignTracking('req-1', DTO, 'tenant-1', SHIPPER));
    expect(updates().map((u) => [u.table, u.set, u.inTx])).toEqual([
      [schema.requisitionLine, expect.objectContaining({ lot_no: 'LOT00001', serial_no: null }), true],
      [schema.stockTransferLine, { lot_no: 'LOT00001', serial_no: null }, true],
    ]);
  });

  it('is the From department\'s: a user of another department writes nothing', async () => {
    const { service, as, updates } = setup(queues({ userDepartmentId: 'cc-farm' }));
    await expect(as(() => service.assignTracking('req-1', DTO, 'tenant-1', SHIPPER)))
      .rejects.toThrow(new ForbiddenException("Only the From sub-location's department may post this Transfer Shipment."));
    expect(updates()).toEqual([]);
  });

  it('refuses a line that has shipped and writes nothing', async () => {
    const { service, as, updates } = setup(queues({ line: { qty_shipped: '5.0000' } }));
    await expect(as(() => service.assignTracking('req-1', DTO, 'tenant-1', SHIPPER))).rejects.toThrow('has shipped');
    expect(updates()).toEqual([]);
  });

  it('refuses a line id that is not on the requisition', async () => {
    const { service, as, updates } = setup(queues());
    await expect(as(() => service.assignTracking('req-1', { lines: [{ line_id: 'nope', lot_no: 'L' }] }, 'tenant-1', SHIPPER)))
      .rejects.toThrow("Line 'nope' is not on RQ-00021.");
    expect(updates()).toEqual([]);
  });
});
