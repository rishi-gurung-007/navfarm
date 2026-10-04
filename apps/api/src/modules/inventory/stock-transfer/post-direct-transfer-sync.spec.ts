/**
 * Part E Task 7, fix round 1 (Important 1 verification).
 *
 * The review claimed postDirectTransfer bypasses syncRequisitionFulfilment
 * entirely. Reading the source shows otherwise: postDirectTransfer's own doc
 * comment says "It calls the same posting pieces as the staged path — it is
 * not a second implementation", and its body literally calls
 * `this.postShipment(id, ...)` then `this.postReceipt(id, ...)` — the exact
 * two methods Task 7 already instrumented with `await
 * syncRequisitionFulfilment(this.db, id);` at the end of their own
 * transaction body. Since postDirectTransfer runs inside one outer
 * `withTenantTransaction`, the nested calls to postShipment/postReceipt hit
 * the "already in a posting transaction" branch and just run their callback
 * directly — including the sync call at its end.
 *
 * This is a standalone file (not added to transfer-execution.service.spec.ts)
 * because it needs `jest.mock` on requisition-fulfilment to count calls
 * without running the real DB-shaped queries that module issues — mocking it
 * inside the shared spec file would have silently changed what all of that
 * file's other tests exercise.
 */
jest.mock('../../procurement/requisition/requisition-fulfilment', () => ({
  syncRequisitionFulfilment: jest.fn().mockResolvedValue(undefined),
}));

import type { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { UomService } from '../../master-data/uom/uom.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { StockTransferService } from './stock-transfer.service';
import { syncRequisitionFulfilment } from '../../procurement/requisition/requisition-fulfilment';

const SCOPE: FarmScope = { farmId: null, companyId: 'co-1', restricted: false, lobId: null };
const ADMIN = { userId: 'u-admin', userType: 'COMPANY_ADMIN' };

const TRANSFER = {
  transfer_id: 'tr-1', tenant_id: 'tenant-1', company_id: 'co-1', transfer_no: 'TR-2026-0001',
  posting_date: '2026-10-02', from_warehouse_id: 'wh-store', to_warehouse_id: 'wh-farm',
  remarks: null, status: 'DRAFT', posted_at: null, posted_by: null,
  created_by: 'u-admin', updated_by: null, created_at: '2026-10-01 08:00:00', updated_at: '2026-10-01 08:00:00', deleted_at: null,
};
const LINE = {
  line_id: 'line-1', transfer_id: 'tr-1', line_no: 1, item_id: 'item-1',
  quantity: '10', uom: 'EA', lot_no: 'LOT-9', serial_no: null, remarks: null,
};
const LOCATIONS = [
  [{ location_id: 'wh-store', location_type: 'STORE', company_id: 'co-1', lob_id: null, parent: 'farm-a', farm_id: 'farm-a' }],
  [{ location_id: 'wh-farm', location_type: 'FARM', company_id: 'co-1', lob_id: null, parent: null, farm_id: null }],
  [{ location_id: 'wh-farm', location_name: 'Farm store', location_type: 'FARM', silo_capacity_kg: null }],
];
const SHIPMENT_LINE = {
  shipment_line_id: 'sl-1', shipment_id: 'sh-1', line_id: 'line-1',
  quantity: '10', uom: 'EA', lot_no: 'LOT-9', serial_no: null,
};

function recordingDb(queues: Map<unknown, unknown[][]>) {
  const log: Array<{ op: string; table: unknown }> = [];
  const db: any = {
    select: jest.fn(() => {
      const entry: { op: string; table: unknown } = { op: 'select', table: undefined };
      log.push(entry);
      const self: any = {
        from: (t: unknown) => { entry.table = t; return self; },
        innerJoin: () => self, leftJoin: () => self, where: () => self, orderBy: () => self,
        limit: () => self, offset: () => self, for: () => self, groupBy: () => self,
        then: (ok: any, err: any) => Promise.resolve().then(() => queues.get(entry.table)?.shift() ?? []).then(ok, err),
      };
      return self;
    }),
    insert: jest.fn((table: unknown) => ({
      values: jest.fn(async (v: any) => {
        const bucket = queues.get(table);
        if (bucket && v && typeof v === 'object' && ('shipment_id' in v || 'receipt_id' in v || 'line_id' in v)) {
          bucket.push([{ ...v, qty: v.quantity }]);
        }
      }),
    })),
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => [{ affectedRows: 1 }]) })) })),
  };
  return { db, log };
}

/** The legacy whole-order post (dto.lines = []), full quantity on the one line. */
function directQueues(): Map<unknown, unknown[][]> {
  const queues = new Map<unknown, unknown[][]>([
    [schema.stockTransfer, [[{ ...TRANSFER }], [{ ...TRANSFER }], [{ ...TRANSFER }], [{ ...TRANSFER }]]],
    [schema.stockTransferLine, [[{ ...LINE }], [{ ...LINE }], [{ ...LINE }], [{ ...LINE }]]],
    [schema.locationMaster, [...LOCATIONS.map((l) => [...l]), ...LOCATIONS.map((l) => [...l]), LOCATIONS[0], LOCATIONS[1]]],
    [schema.transferShipment, [[]]],
    [schema.transferShipmentLine, [
      [],                                       // outer shippedQuantities
      [],                                       // postShipment's shippedQuantities
      [{ line_id: 'line-1', qty: '10' }],       // postReceipt's shippedQuantities
      [{ ...SHIPMENT_LINE }],                    // the shipment's own lines
    ]],
    [schema.transferReceipt, [[]]],
    [schema.transferReceiptLine, [
      [],                                       // outer receivedQuantities
      [],                                       // postReceipt's receivedQuantities
    ]],
  ]);
  return queues;
}

function setup(queues: Map<unknown, unknown[][]>) {
  const ref = {} as { cls: ClsService };
  const { db } = recordingDb(queues);
  const cls = (ref.cls = transactionCls(db));
  const ledger = {
    writeTransferEntries: jest.fn().mockResolvedValue({ shipment: {}, receipt: {} }),
    writeTransferShipment: jest.fn().mockResolvedValue({ ledger_id: 'led-sh' }),
    writeTransferReceipt: jest.fn().mockResolvedValue({ ledger_id: 'led-rc' }),
    transferShipmentRate: jest.fn().mockResolvedValue(2.5),
    transferShipmentRemainingValue: jest.fn().mockResolvedValue(15),
  };
  const service = new StockTransferService(
    cls,
    { log: jest.fn().mockResolvedValue({}) } as unknown as AuditLogService,
    ledger as unknown as InventoryLedgerService,
    { postInventoryLedgerEntry: jest.fn() } as unknown as GlPostingService,
    { resolveConversionFactor: jest.fn().mockResolvedValue(1) } as unknown as UomService,
    { assertCanReceive: jest.fn().mockResolvedValue(undefined) } as unknown as SiloFeedService,
  );
  const as = <T>(work: () => Promise<T>) => cls.run(async () => { cls.set(FARM_SCOPE_KEY, SCOPE); return work(); });
  return { service, as };
}

describe('postDirectTransfer — does the sync actually run (fix round 1, Important 1)', () => {
  it('calls syncRequisitionFulfilment once per nested postShipment/postReceipt call (twice total), not never', async () => {
    const mockedSync = syncRequisitionFulfilment as jest.MockedFunction<typeof syncRequisitionFulfilment>;
    mockedSync.mockClear();
    const { service, as } = setup(directQueues());
    await as(() => service.postDirectTransfer('tr-1', { posting_date: '2026-10-02', lines: [] }, 'tenant-1', ADMIN));
    expect(mockedSync).toHaveBeenCalledTimes(2);
    expect(mockedSync.mock.calls[0][1]).toBe('tr-1');
    expect(mockedSync.mock.calls[1][1]).toBe('tr-1');
  });
});
