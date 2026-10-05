/**
 * WP4a live-check defect — a transfer receipt kept several serials in ONE
 * ledger layer.
 *
 * Found on nf_devco, 5 Oct (RQ-00022, serial-tracked ILL-SER-001): the
 * shipment of SN00001 and SN00002 was received at GRA100/SHED-001 as one
 * POSITIVE row, quantity 2, serial_no "SN00001,SN00002". A serial is one
 * physical unit (the Goods Receipt writes one row per serial), and every
 * consumer matches a serial exactly: applyFifo narrows by serial_no = 'SN00001'
 * and finds nothing, and GET /inventory-ledger/available-serials offered a
 * single "serial" named "SN00001,SN00002". Units received through a transfer
 * could not be issued, adjusted or transferred on one by one.
 *
 * Rishi's 4 Oct list: "On Transfer Receipt: Serial/Lot auto-populated from
 * Shipment automatically" — so the receipt still copies the shipment's
 * serials, but as one layer per serial, quantity 1 each, at the shipment's
 * unit cost; a partial receipt takes the next serials not yet received on
 * that shipment line. Value still closes In Transit to zero.
 */
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
import { serialsForReceipt, splitAmount } from './transfer-execution.rules';

describe('serialsForReceipt — which serials this receipt carries', () => {
  it('takes the next serials not yet received on the shipment line, in shipment order', () => {
    expect(serialsForReceipt('SN1, SN2,SN3', 0, 2)).toEqual(['SN1', 'SN2']);
    expect(serialsForReceipt('SN1, SN2,SN3', 2, 1)).toEqual(['SN3']);
  });

  it('refuses a fractional quantity of a serial-tracked line', () => {
    expect(() => serialsForReceipt('SN1,SN2', 0, 1.5)).toThrow('Serial-tracked receipts are whole units (got 1.5).');
  });

  it('refuses more serials than the shipment line has left', () => {
    expect(() => serialsForReceipt('SN1,SN2', 1, 2)).toThrow('The shipment line has 1 serial(s) left to receive; 2 requested.');
  });
});

describe('splitAmount — one value per serial layer that sums back exactly', () => {
  it('shares to four places and gives the rounding remainder to the last', () => {
    expect(splitAmount(10, 3)).toEqual([3.3333, 3.3333, 3.3334]);
    expect(splitAmount(360, 2)).toEqual([180, 180]);
  });
});

function recordingDb(queues: Map<unknown, unknown[][]>) {
  const log: Array<{ op: string; table: unknown; values?: any }> = [];
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
    insert: jest.fn((table: unknown) => ({ values: jest.fn(async (v: any) => { log.push({ op: 'insert', table, values: v }); }) })),
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => [{ affectedRows: 1 }]) })) })),
  };
  return { db, log };
}

const SCOPE: FarmScope = { farmId: null, companyId: 'co-1', restricted: false, lobId: null };
const ADMIN = { userId: 'u-admin', userType: 'COMPANY_ADMIN' };
const TRANSFER = {
  transfer_id: 'tr-1', tenant_id: 'tenant-1', company_id: 'co-1', transfer_no: 'TR-2026-0001', posting_date: '2026-10-02',
  from_warehouse_id: 'wh-store', to_warehouse_id: 'wh-shed', remarks: null, status: 'IN_TRANSIT', deleted_at: null,
};
const LINE = { line_id: 'line-1', transfer_id: 'tr-1', line_no: 1, item_id: 'item-sn', quantity: '2', uom: 'PCS', lot_no: null, serial_no: 'SN1,SN2' };
const SHIPMENT = { shipment_id: 'sh-1', tenant_id: 'tenant-1', transfer_id: 'tr-1', shipment_no: 'SH-2026-0001', shipment_date: '2026-10-02', status: 'POSTED', deleted_at: null };
const SHIPMENT_LINE = { shipment_line_id: 'sl-1', shipment_id: 'sh-1', line_id: 'line-1', quantity: '2', uom: 'PCS', lot_no: null, serial_no: 'SN1, SN2' };
const LOCATIONS = [
  [{ location_id: 'wh-store', location_type: 'STORE', company_id: 'co-1', lob_id: null, parent: 'farm-a', farm_id: 'farm-a' }],
  [{ location_id: 'wh-shed', location_type: 'SHED', company_id: 'co-1', lob_id: null, parent: 'farm-a', farm_id: 'farm-a' }],
];

function receiptQueues(prior: Array<{ shipment_line_id: string; qty: string; receipt_no: string }> = []) {
  return new Map<unknown, unknown[][]>([
    [schema.stockTransfer, [[{ ...TRANSFER }]]],
    [schema.stockTransferLine, [[{ ...LINE }]]],
    [schema.locationMaster, LOCATIONS.map((l) => [...l])],
    [schema.transferShipment, [[{ ...SHIPMENT }]]],
    [schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '2' }], [{ ...SHIPMENT_LINE }]]],
    [schema.transferReceiptLine, [prior.map((p) => ({ line_id: 'line-1', qty: p.qty })), prior]],
    [schema.transferReceipt, []],
    [schema.requisition, [[]]],
  ]);
}

function setup(queues: Map<unknown, unknown[][]>) {
  const { db, log } = recordingDb(queues);
  const cls: ClsService = transactionCls(db);
  let n = 0;
  const ledger = {
    writeTransferReceipt: jest.fn().mockImplementation(async () => ({ ledger_id: `led-rc-${++n}` })),
    transferShipmentRate: jest.fn().mockResolvedValue(180),
    transferShipmentRemainingValue: jest.fn().mockResolvedValue(360),
  };
  const gl = { postInventoryLedgerEntry: jest.fn() };
  const service = new StockTransferService(
    cls,
    { log: jest.fn().mockResolvedValue({}) } as unknown as AuditLogService,
    ledger as unknown as InventoryLedgerService,
    gl as unknown as GlPostingService,
    { resolveConversionFactor: jest.fn().mockResolvedValue(1) } as unknown as UomService,
    { assertCanReceive: jest.fn().mockResolvedValue(undefined) } as unknown as SiloFeedService,
  );
  const as = <T>(work: () => Promise<T>) => cls.run(async () => { cls.set(FARM_SCOPE_KEY, SCOPE); return work(); });
  const inserts = (table: unknown) => log.filter((e) => e.op === 'insert' && e.table === table).map((e) => e.values);
  return { service, as, ledger, gl, inserts };
}

describe('postReceipt — a multi-serial shipment line is received as one layer per serial', () => {
  it('writes one ledger layer and one GL posting per serial, quantity 1 each, splitting the closing value', async () => {
    const { service, as, ledger, gl, inserts } = setup(receiptQueues());
    await as(() => service.postReceipt('tr-1', { posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 2 }] }, 'tenant-1', ADMIN));
    expect(ledger.writeTransferReceipt.mock.calls.map(([p]) => [p.serialNo, p.quantity, p.rate, p.amount])).toEqual([
      ['SN1', 1, 180, 180],
      ['SN2', 1, 180, 180],
    ]);
    expect(gl.postInventoryLedgerEntry).toHaveBeenCalledTimes(2);
    expect(inserts(schema.transferReceiptLine)).toEqual([expect.objectContaining({ quantity: '2', serial_no: 'SN1,SN2' })]);
  });

  it('a partial receipt takes the next serial not yet received on that shipment line', async () => {
    const { service, as, ledger, inserts } = setup(receiptQueues([{ shipment_line_id: 'sl-1', qty: '1', receipt_no: 'RC-2026-0001' }]));
    await as(() => service.postReceipt('tr-1', { posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 1 }] }, 'tenant-1', ADMIN));
    expect(ledger.writeTransferReceipt.mock.calls.map(([p]) => [p.serialNo, p.quantity])).toEqual([['SN2', 1]]);
    expect(inserts(schema.transferReceiptLine)).toEqual([expect.objectContaining({ quantity: '1', serial_no: 'SN2' })]);
  });

  it('leaves a single-serial or lot line exactly as before: one layer with the shipment identity', async () => {
    const queues = receiptQueues();
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '2' }], [{ ...SHIPMENT_LINE, serial_no: null, lot_no: 'LOT-1' }]]);
    const { service, as, ledger } = setup(queues);
    await as(() => service.postReceipt('tr-1', { posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 2 }] }, 'tenant-1', ADMIN));
    expect(ledger.writeTransferReceipt).toHaveBeenCalledTimes(1);
    expect(ledger.writeTransferReceipt).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2, lotNo: 'LOT-1', serialNo: undefined, amount: 360 }));
  });
});
