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
import { assertTrackingFieldsMatchItem, resolveTrackingAssignment } from './requisition.rules';

const LOT = { isLotTracked: true, isSerialTracked: false };
const SERIAL = { isLotTracked: false, isSerialTracked: true };

describe('resolveTrackingAssignment — only the local refusals; the rest is the shipment\'s own rule', () => {
  const line = { line_seq: 1, item_code: 'ILL-LOT-001' };

  it('normalizes: a trimmed lot; serials as one comma list without blanks', () => {
    expect(resolveTrackingAssignment(line, 5, LOT, { lot_no: ' LOT00001 ' })).toEqual({ lot_no: 'LOT00001', serial_no: null });
    expect(resolveTrackingAssignment(line, 2, SERIAL, { serial_no: 'SN1, SN2,,' })).toEqual({ lot_no: null, serial_no: 'SN1,SN2' });
  });

  it('leaves coverage to the shipment rule (an empty lot passes here and is refused by assertTrackingForShipment)', () => {
    expect(resolveTrackingAssignment(line, 5, LOT, { lot_no: '  ' })).toEqual({ lot_no: null, serial_no: null });
  });

  it('refuses the identity the item does not track — the same rule PUT applies', () => {
    expect(() => resolveTrackingAssignment(line, 5, LOT, { lot_no: 'L1', serial_no: 'S1' })).toThrow('Line 1: ILL-LOT-001 is not serial-tracked; it cannot carry a serial number.');
    expect(() => resolveTrackingAssignment(line, 5, SERIAL, { lot_no: 'L1', serial_no: 'S1' })).toThrow('Line 1: ILL-LOT-001 is not lot-tracked; it cannot carry a lot.');
  });

  it('refuses an untracked item — there is nothing to assign', () => {
    expect(() => resolveTrackingAssignment(line, 5, { isLotTracked: false, isSerialTracked: false }, { lot_no: 'L1' }))
      .toThrow(new BadRequestException('Line 1: ILL-LOT-001 is not lot- or serial-tracked; it has no Item Tracking.'));
  });

  it('refuses a line with nothing left to ship; a partly shipped line keeps its balance assignable', () => {
    expect(() => resolveTrackingAssignment(line, 0, LOT, { lot_no: 'L1' }))
      .toThrow(new BadRequestException('Line 1 has nothing left to ship; its Item Tracking can no longer change.'));
    expect(resolveTrackingAssignment(line, 3, LOT, { lot_no: 'L2' })).toEqual({ lot_no: 'L2', serial_no: null });
  });
});

describe('assertTrackingFieldsMatchItem — PUT (Open) and the route (Released) agree on untracked identities', () => {
  it('refuses a lot or a serial on an untracked item, and passes a matching identity', () => {
    const none = { isLotTracked: false, isSerialTracked: false };
    expect(() => assertTrackingFieldsMatchItem('Line 2', 'IT-1', none, { lot_no: 'L1' })).toThrow('Line 2: IT-1 is not lot-tracked; it cannot carry a lot.');
    expect(() => assertTrackingFieldsMatchItem('Line 2', 'IT-1', none, { serial_no: 'S1' })).toThrow('Line 2: IT-1 is not serial-tracked; it cannot carry a serial number.');
    expect(() => assertTrackingFieldsMatchItem('Line 2', 'IT-1', none, {})).not.toThrow();
    expect(() => assertTrackingFieldsMatchItem('Line 2', 'IT-1', LOT, { lot_no: 'L1' })).not.toThrow();
  });
});

interface Entry { op: string; table: unknown; set?: any; inTx?: boolean; locked?: boolean }

function recordingDb(queues: Map<unknown, unknown[][]>, cls: () => ClsService) {
  const log: Entry[] = [];
  const inTx = () => cls().get('tenantPostingTransaction') === true;
  const db: any = {
    select: jest.fn(() => {
      const entry: Entry = { op: 'select', table: undefined, inTx: inTx() };
      log.push(entry);
      const self: any = {
        from: (t: unknown) => { entry.table = t; return self; },
        leftJoin: () => self, innerJoin: () => self, where: () => self, orderBy: () => self, groupBy: () => self, limit: () => self, for: () => { entry.locked = true; return self; },
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
const REQ_LINE = { line_id: 'l1', line_seq: 1, item_id: 'i-lot', item_code: 'ILL-LOT-001' };
const DTO = { lines: [{ line_id: 'l1', lot_no: 'LOT00001' }] };
const SCOPE: FarmScope = { farmId: null, companyId: 'co-1', restricted: false, lobId: null };

/** Read order: releasedStore (requisition, transfer lines), department (location, user), the transfer lock,
 *  the transfer lines, the shipped events, the requisition lines (locked), the item flags; then findOne. */
function queues(over: { userDepartmentId?: string | null; shipped?: Array<{ line_id: string; qty: string }>; flags?: object; reqLine?: object } = {}) {
  return new Map<unknown, unknown[][]>([
    [schema.requisition, [[{ ...RELEASED }], [{ ...RELEASED }]]],
    [schema.stockTransferLine, [[{ line_id: 'tl-1', requisition_line_id: 'l1' }], [{ line_id: 'tl-1', requisition_line_id: 'l1', quantity: '5' }]]],
    [schema.locationMaster, [[{ department_id: 'cc-store' }], []]],
    [schema.userMaster, [[{ department_id: over.userDepartmentId === undefined ? 'cc-store' : over.userDepartmentId }], []]],
    [schema.stockTransfer, [[{ transfer_id: 'tr-1' }]]],
    [schema.transferShipmentLine, [over.shipped ?? []]],
    [schema.requisitionLine, [[{ ...REQ_LINE, ...over.reqLine }], []]],
    [schema.itemMaster, [[{ item_id: 'i-lot', is_lot_tracked: 1, is_serial_tracked: 0, ...over.flags }]]],
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
  return { service, as, updates, log };
}

describe('RequisitionService.assignTracking — Item Tracking after release, before shipment', () => {
  it('writes the lot to the requisition line and to its transfer line, in one transaction', async () => {
    const { service, as, updates } = setup(queues());
    await as(() => service.assignTracking('req-1', DTO, 'tenant-1', SHIPPER));
    expect(updates().map((u) => [u.table, u.set, u.inTx])).toEqual([
      [schema.requisitionLine, { lot_no: 'LOT00001', serial_no: null }, true],
      [schema.stockTransferLine, { lot_no: 'LOT00001', serial_no: null }, true],
    ]);
  });

  it('takes the shipment\'s lock first: stock_transfer FOR UPDATE before the requisition lines (no deadlock, no race)', async () => {
    const { service, as, log } = setup(queues());
    await as(() => service.assignTracking('req-1', DTO, 'tenant-1', SHIPPER));
    const locks = log.filter((e) => e.op === 'select' && e.locked).map((e) => e.table);
    expect(locks).toEqual([schema.stockTransfer, schema.requisitionLine]);
    const firstLock = log.findIndex((e) => e.locked);
    const shippedRead = log.findIndex((e) => e.table === schema.transferShipmentLine);
    expect(shippedRead).toBeGreaterThan(firstLock);
  });

  it('decides "shipped" from the shipment events, not the synced requisition_line.qty_shipped', async () => {
    // The requisition line still says nothing shipped (the copy is synced at the END of a shipment);
    // the events say all 5 have.
    const { service, as, updates } = setup(queues({ shipped: [{ line_id: 'tl-1', qty: '5' }], reqLine: { qty_shipped: null } }));
    await expect(as(() => service.assignTracking('req-1', DTO, 'tenant-1', SHIPPER))).rejects.toThrow('Line 1 has nothing left to ship');
    expect(updates()).toEqual([]);
  });

  it('keeps the unshipped balance of a partly shipped lot line assignable', async () => {
    const { service, as, updates } = setup(queues({ shipped: [{ line_id: 'tl-1', qty: '2' }] }));
    await as(() => service.assignTracking('req-1', { lines: [{ line_id: 'l1', lot_no: 'LOT00002' }] }, 'tenant-1', SHIPPER));
    expect(updates()[1].set).toEqual({ lot_no: 'LOT00002', serial_no: null });
  });

  it('validates with the shipment\'s own rule: serials must cover the balance and be unique', async () => {
    const serialFlags = { is_lot_tracked: 0, is_serial_tracked: 1 };
    const short = setup(queues({ flags: serialFlags }));
    await expect(short.as(() => short.service.assignTracking('req-1', { lines: [{ line_id: 'l1', serial_no: 'SN1' }] }, 'tenant-1', SHIPPER)))
      .rejects.toThrow('do not cover the shipped quantity (5)');
    const dup = setup(queues({ flags: serialFlags }));
    await expect(dup.as(() => dup.service.assignTracking('req-1', { lines: [{ line_id: 'l1', serial_no: 'S1,S1,S2,S3,S4' }] }, 'tenant-1', SHIPPER)))
      .rejects.toThrow('Serial numbers must be unique on one transfer line.');
    expect([...short.updates(), ...dup.updates()]).toEqual([]);
  });

  it('is the From department\'s, and says so in Item Tracking terms', async () => {
    const { service, as, updates } = setup(queues({ userDepartmentId: 'cc-farm' }));
    await expect(as(() => service.assignTracking('req-1', DTO, 'tenant-1', SHIPPER)))
      .rejects.toThrow(new ForbiddenException("Only the From sub-location's department may assign Item Tracking."));
    expect(updates()).toEqual([]);
  });

  it('refuses a line id that is not on the requisition, and a line named twice', async () => {
    const a = setup(queues());
    await expect(a.as(() => a.service.assignTracking('req-1', { lines: [{ line_id: 'nope', lot_no: 'L' }] }, 'tenant-1', SHIPPER)))
      .rejects.toThrow("Line 'nope' is not on RQ-00021.");
    const b = setup(queues());
    await expect(b.as(() => b.service.assignTracking('req-1', { lines: [{ line_id: 'l1', lot_no: 'A' }, { line_id: 'l1', lot_no: 'B' }] }, 'tenant-1', SHIPPER)))
      .rejects.toThrow(new BadRequestException('Line l1 is named twice; name each line once.'));
    expect([...a.updates(), ...b.updates()]).toEqual([]);
  });
});
