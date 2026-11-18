/**
 * Logistics Phase 2, Task 5 — the Inventory Transfer Order carries a Logistics trip.
 *
 * The recording database of transfer-execution.service.spec.ts: every db.select() pops the next row-set queued for
 * its FROM table, inserts and updates are logged. The trip side is the real LogisticsTripService over the same
 * database (so a trip's status move is an update the test can read), with its public methods spied on so a test can
 * also say what was NOT asked.
 *
 * Read order per call, as in transfer-execution.service.spec.ts, plus the trip's:
 *   tripRequiredToShip (untripped TO only) → logisticsSetting ×1 (then cached)
 *   assertTripFor                         → stockTransfer, logisticsTrip, logisticsVehicle, logisticsDriver
 *   onShipped                             → logisticsTrip (by tenant and id), logisticsRoute (Colcom check, on CONFIRMED)
 *   onArrived                             → logisticsTrip (by tenant and id), stockTransfer (every TO on the trip)
 */
import { BadRequestException } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { UomService } from '../../master-data/uom/uom.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { LogisticsTripService } from '../../logistics/logistics-trip.service';
import { StockTransferService } from './stock-transfer.service';

const SCOPE: FarmScope = { farmId: null, companyId: 'co-1', restricted: false, lobId: null };
const ADMIN = { userId: 'u-admin', userType: 'COMPANY_ADMIN' };
const REFUSAL = 'This transfer needs a planned trip before it can ship.';
/** A trip is attached but its status does not allow shipping: the refusal names the trip (final review I1). */
const tripRefusal = (status: string) => `Trip TRP-000001 is ${status}; a transfer can only ship on a planned, confirmed or in-transit trip.`;

const TRANSFER = {
  transfer_id: 'tr-1', tenant_id: 'tenant-1', company_id: 'co-1', transfer_no: 'TR-2026-0001',
  posting_date: '2026-10-02', from_warehouse_id: 'wh-store', to_warehouse_id: 'wh-farm', vehicle_no: null, trip_id: null,
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
const SHIPMENT = {
  shipment_id: 'sh-1', tenant_id: 'tenant-1', transfer_id: 'tr-1', shipment_no: 'SH-2026-0001',
  shipment_date: '2026-10-02', status: 'POSTED', created_by: 'u-admin', created_at: '2026-10-01 09:00:00', deleted_at: null,
};
const SHIPMENT_LINE = { shipment_line_id: 'sl-1', shipment_id: 'sh-1', line_id: 'line-1', quantity: '10', uom: 'EA', lot_no: 'LOT-9', serial_no: null };
const TRIP = {
  trip_id: 'trip-1', tenant_id: 'tenant-1', company_id: 'co-1', trip_no: 'TRP-000001', status: 'PLANNED',
  vehicle_id: 'v-1', driver_id: 'dr-1', route_id: 'rt-1', hq_approval_ref: null,
  estimated_arrival: '2026-10-02 12:00:00', deleted_at: null,
};
const VEHICLE = { registration_no: 'ABC 123' };
const DRIVER = { driver_name: 'Tendai' };
const ROUTE = { to_zone_id: 'z-farm' };
const ZONE = { zone_type: 'FARM' };

const LOGISTICS_TABLES = [schema.logisticsTrip, schema.logisticsVehicle, schema.logisticsDriver, schema.logisticsRoute, schema.logisticsTripLine];

function recordingDb(queues: Map<unknown, unknown[][]>) {
  const log: Array<{ op: string; table: unknown; values?: any; set?: any }> = [];
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
        log.push({ op: 'insert', table, values: v });
        const bucket = queues.get(table);
        if (bucket && v && typeof v === 'object' && ('shipment_id' in v || 'receipt_id' in v || 'line_id' in v)) {
          bucket.push([{ ...v, qty: v.quantity }]);
        }
      }),
    })),
    update: jest.fn((table: unknown) => ({
      set: jest.fn((v: any) => {
        log.push({ op: 'update', table, set: v });
        return { where: jest.fn(async () => [{ affectedRows: 1 }]) };
      }),
    })),
    transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(db)),
  };
  return { db, log };
}

function setup(queues: Map<unknown, unknown[][]>, opts: { withLogistics?: boolean } = {}) {
  const { db, log } = recordingDb(queues);
  const cls: ClsService = transactionCls(db);
  const ledger = {
    writeTransferShipment: jest.fn().mockResolvedValue({ ledger_id: 'led-sh' }),
    writeTransferReceipt: jest.fn().mockResolvedValue({ ledger_id: 'led-rc' }),
    transferShipmentRate: jest.fn().mockResolvedValue(2.5),
    transferShipmentRemainingValue: jest.fn().mockResolvedValue(25),
    getStockBalance: jest.fn().mockResolvedValue([{ item_id: 'item-1', uom: 'EA', on_hand_qty: 100 }]),
    writeNegativeEntry: jest.fn().mockResolvedValue({ ledger_id: 'led-neg' }),
    writePositiveEntry: jest.fn().mockResolvedValue({ ledger_id: 'led-pos' }),
  };
  const trips = new LogisticsTripService(cls, { log: jest.fn().mockResolvedValue({}) } as unknown as AuditLogService, {} as UomService);
  jest.spyOn(trips, 'tripRequiredToShip');
  jest.spyOn(trips, 'assertTripFor');
  jest.spyOn(trips, 'onShipped');
  jest.spyOn(trips, 'onArrived');
  const args = [
    cls,
    { log: jest.fn().mockResolvedValue({}) } as unknown as AuditLogService,
    ledger as unknown as InventoryLedgerService,
    { postInventoryLedgerEntry: jest.fn() } as unknown as GlPostingService,
    {} as unknown as NumberSeriesService, // origin's 5th constructor argument; no shipment or receipt path numbers anything
    { resolveConversionFactor: jest.fn().mockResolvedValue(1) } as unknown as UomService,
    { assertCanReceive: jest.fn().mockResolvedValue(undefined) } as unknown as SiloFeedService,
  ] as const;
  const service = opts.withLogistics === false
    ? new StockTransferService(...args)
    : new StockTransferService(...args, undefined, undefined, undefined, trips);
  const as = <T>(work: () => Promise<T>) => cls.run(async () => { cls.set(FARM_SCOPE_KEY, SCOPE); return work(); });
  const selects = (table: unknown) => log.filter((e) => e.op === 'select' && e.table === table).length;
  const updatesOf = (table: unknown) => log.filter((e) => e.op === 'update' && e.table === table).map((e) => e.set);
  const writes = () => log.filter((e) => e.op !== 'select');
  return { service, trips, as, log, selects, updatesOf, writes, ledger, db };
}

/** One postShipment call's reads (transfer-execution.service.spec.ts's baseQueues). */
function shipmentQueues(transfer: Record<string, unknown> = TRANSFER): Map<unknown, unknown[][]> {
  return new Map<unknown, unknown[][]>([
    [schema.stockTransfer, [[{ ...transfer }]]],
    [schema.stockTransferLine, [[{ ...LINE }]]],
    [schema.locationMaster, LOCATIONS.map((l) => [...l])],
    [schema.transferShipment, []],
    [schema.transferShipmentLine, []],
    [schema.transferReceipt, []],
    [schema.transferReceiptLine, []],
    [schema.requisition, [[]]],
    [schema.logisticsSetting, []],
  ]);
}

/** The trip's reads: assertTripFor, then onShipped/onArrived's loadTrip and the Colcom check. */
function withTrip(queues: Map<unknown, unknown[][]>, trip: Record<string, unknown>, transfer: Record<string, unknown>) {
  queues.get(schema.stockTransfer)!.push([{ ...transfer }]); // assertTripFor's own read of the TO
  queues.set(schema.logisticsTrip, [[{ ...trip }], [{ ...trip }], [{ ...trip }]]);
  queues.set(schema.logisticsVehicle, [[{ ...VEHICLE }]]);
  queues.set(schema.logisticsDriver, [[{ ...DRIVER }]]);
  queues.set(schema.logisticsRoute, [[{ ...ROUTE }]]);
  queues.set(schema.logisticsDeliveryZone, [[{ ...ZONE }]]);
  return queues;
}

const TRIPPED = { ...TRANSFER, trip_id: 'trip-1' };
const shipBody = { posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 10 }] };

describe('Task 5 — (a) no trip and the setting off: the shipment is exactly as before', () => {
  it('postShipment reads the setting once and nothing of Logistics else', async () => {
    const { service, trips, as, selects, updatesOf } = setup(shipmentQueues());
    const result = await as(() => service.postShipment('tr-1', shipBody, 'tenant-1', ADMIN));
    expect(result.shipment_no).toMatch(/^SH-/);
    expect(trips.tripRequiredToShip).toHaveBeenCalledTimes(1);
    expect(trips.tripRequiredToShip).toHaveBeenCalledWith('co-1', 'tenant-1');
    expect(trips.assertTripFor).not.toHaveBeenCalled();
    expect(trips.onShipped).not.toHaveBeenCalled();
    expect(selects(schema.logisticsSetting)).toBe(1);
    for (const t of LOGISTICS_TABLES) expect(selects(t)).toBe(0);
    // The TO's own write is unchanged: only its status, no vehicle_no.
    expect(updatesOf(schema.stockTransfer)).toHaveLength(1);
    expect(updatesOf(schema.stockTransfer)[0]).not.toHaveProperty('vehicle_no');
    expect(updatesOf(schema.logisticsTrip)).toHaveLength(0);
  });

  it('a second shipment within the minute does not read the setting again', async () => {
    const queues = shipmentQueues();
    queues.get(schema.stockTransfer)!.push([{ ...TRANSFER, status: 'IN_TRANSIT' }]);
    queues.get(schema.stockTransferLine)!.push([{ ...LINE }]);
    queues.set(schema.locationMaster, [...LOCATIONS, ...LOCATIONS].map((l) => [...l]));
    queues.get(schema.requisition)!.push([]);
    const { service, as, selects } = setup(queues);
    await as(() => service.postShipment('tr-1', { posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 4 }] }, 'tenant-1', ADMIN));
    await as(() => service.postShipment('tr-1', { posting_date: '2026-10-03', lines: [{ line_id: 'line-1', quantity: 2 }] }, 'tenant-1', ADMIN));
    expect(selects(schema.logisticsSetting)).toBe(1);
  });

  it('ship() keeps the free-text vehicle number and asks Logistics for nothing but the setting', async () => {
    const { service, trips, as, selects, updatesOf } = setup(shipmentQueues());
    jest.spyOn(service, 'findOne').mockResolvedValue({ ...TRANSFER, status: 'IN_TRANSIT' } as any);
    await as(() => service.ship('tr-1', { vehicle_no: ' TRK-9901 ' }, 'tenant-1', ADMIN));
    expect(trips.tripRequiredToShip).toHaveBeenCalledTimes(1);
    expect(trips.assertTripFor).not.toHaveBeenCalled();
    expect(trips.onShipped).not.toHaveBeenCalled();
    for (const t of LOGISTICS_TABLES) expect(selects(t)).toBe(0);
    expect(updatesOf(schema.stockTransfer)[0]).toMatchObject({ status: 'IN_TRANSIT', vehicle_no: 'TRK-9901' });
  });

  it('without the Logistics service (the old constructor) every guard is a no-op', async () => {
    const { service, as, selects } = setup(shipmentQueues(), { withLogistics: false });
    await as(() => service.postShipment('tr-1', shipBody, 'tenant-1', ADMIN));
    expect(selects(schema.logisticsSetting)).toBe(0);
  });
});

describe('Task 5 — (b) the setting on and no trip: refused before anything is written', () => {
  const on = () => {
    const queues = shipmentQueues();
    queues.set(schema.logisticsSetting, [[{ trip_required_to_ship: true }]]);
    return queues;
  };

  it('postShipment', async () => {
    const { service, as, writes } = setup(on());
    const err = await as(() => service.postShipment('tr-1', shipBody, 'tenant-1', ADMIN)).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(REFUSAL);
    expect(writes()).toHaveLength(0);
  });

  it('ship()', async () => {
    const { service, as, writes } = setup(on());
    await expect(as(() => service.ship('tr-1', {}, 'tenant-1', ADMIN))).rejects.toThrow(REFUSAL);
    expect(writes()).toHaveLength(0);
  });
});

describe('Task 5 — (c) a trip that is not planned: refused, naming the trip and its status', () => {
  for (const status of ['DRAFT', 'CANCELLED', 'CLOSED', 'ARRIVED']) {
    it(`a ${status} trip`, async () => {
      const { service, trips, as, writes } = setup(withTrip(shipmentQueues(TRIPPED), { ...TRIP, status }, TRIPPED));
      const err = await as(() => service.postShipment('tr-1', shipBody, 'tenant-1', ADMIN)).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe(tripRefusal(status));
      expect(trips.tripRequiredToShip).not.toHaveBeenCalled();
      expect(writes()).toHaveLength(0);
    });
  }

  it('ship() refuses a CANCELLED trip too', async () => {
    const { service, as, writes } = setup(withTrip(shipmentQueues(TRIPPED), { ...TRIP, status: 'CANCELLED' }, TRIPPED));
    await expect(as(() => service.ship('tr-1', {}, 'tenant-1', ADMIN))).rejects.toThrow(tripRefusal('CANCELLED'));
    expect(writes()).toHaveLength(0);
  });
});

describe('Task 5 — (d) a PLANNED or CONFIRMED trip: the TO ships, takes the truck, and the trip leaves', () => {
  for (const status of ['PLANNED', 'CONFIRMED']) {
    it(`postShipment on a ${status} trip`, async () => {
      const { service, trips, as, updatesOf } = setup(withTrip(shipmentQueues(TRIPPED), { ...TRIP, status }, TRIPPED));
      await as(() => service.postShipment('tr-1', shipBody, 'tenant-1', ADMIN));
      expect(trips.tripRequiredToShip).not.toHaveBeenCalled();
      expect(trips.onShipped).toHaveBeenCalledWith('trip-1', 'tenant-1', ADMIN);
      const tripMoves = updatesOf(schema.logisticsTrip).map((u) => u.status);
      expect(tripMoves).toEqual(status === 'PLANNED' ? ['CONFIRMED', 'IN_TRANSIT'] : ['IN_TRANSIT']);
      expect(updatesOf(schema.stockTransfer)).toContainEqual({ vehicle_no: 'ABC 123' });
    });
  }

  it('ship() writes the trip vehicle over the free-text one and moves the trip to IN_TRANSIT', async () => {
    const { service, trips, as, updatesOf } = setup(withTrip(shipmentQueues(TRIPPED), TRIP, TRIPPED));
    jest.spyOn(service, 'findOne').mockResolvedValue({ ...TRIPPED, status: 'IN_TRANSIT' } as any);
    await as(() => service.ship('tr-1', { vehicle_no: 'TYPED-1' }, 'tenant-1', ADMIN));
    expect(updatesOf(schema.stockTransfer)[0]).toMatchObject({ status: 'IN_TRANSIT', vehicle_no: 'ABC 123' });
    expect(trips.onShipped).toHaveBeenCalledWith('trip-1', 'tenant-1', ADMIN);
    expect(updatesOf(schema.logisticsTrip).map((u) => u.status)).toEqual(['CONFIRMED', 'IN_TRANSIT']);
  });

  it('a further shipment on a trip already IN_TRANSIT ships and leaves the trip as it is', async () => {
    const queues = withTrip(shipmentQueues({ ...TRIPPED, status: 'IN_TRANSIT' }), { ...TRIP, status: 'IN_TRANSIT' }, TRIPPED);
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '6' }]]);
    const { service, as, updatesOf } = setup(queues);
    await as(() => service.postShipment('tr-1', { posting_date: '2026-10-03', lines: [{ line_id: 'line-1', quantity: 4 }] }, 'tenant-1', ADMIN));
    expect(updatesOf(schema.logisticsTrip)).toHaveLength(0);
  });

  it('the trip moves inside the shipment\'s one transaction, so its refusal (Colcom without HQ approval) fails the shipment', async () => {
    const queues = withTrip(shipmentQueues(TRIPPED), TRIP, TRIPPED);
    queues.set(schema.logisticsDeliveryZone, [[{ zone_type: 'COLCOM' }]]);
    const { service, as, db } = setup(queues);
    await expect(as(() => service.postShipment('tr-1', shipBody, 'tenant-1', ADMIN))).rejects.toThrow('HQ approval reference');
    // One transaction opened, never a second: onShipped joins the shipment's, so MySQL rolls both back together.
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});

describe('Task 5 — (e) the receipt that completes the TO: the trip has arrived', () => {
  function receiptQueues() {
    const transfer = { ...TRIPPED, status: 'IN_TRANSIT' };
    const queues = shipmentQueues(transfer);
    queues.set(schema.transferShipment, [[{ ...SHIPMENT }]]);
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '10' }], [{ ...SHIPMENT_LINE }]]);
    queues.set(schema.transferReceiptLine, [[], []]);
    queues.set(schema.logisticsTrip, [[{ ...TRIP, status: 'IN_TRANSIT' }]]);
    return { queues };
  }

  it('postReceipt in full moves the trip to ARRIVED, without the shipment guard', async () => {
    const { queues } = receiptQueues();
    const { service, trips, as, updatesOf } = setup(queues);
    await as(() => service.postReceipt('tr-1', { posting_date: '2026-10-04', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 10 }] }, 'tenant-1', ADMIN));
    expect(updatesOf(schema.stockTransfer).map((u) => u.status)).toEqual(['POSTED']);
    expect(trips.tripRequiredToShip).not.toHaveBeenCalled();
    expect(trips.assertTripFor).not.toHaveBeenCalled();
    expect(trips.onArrived).toHaveBeenCalledWith('trip-1', 'tenant-1', ADMIN);
    expect(updatesOf(schema.logisticsTrip).map((u) => u.status)).toEqual(['ARRIVED']);
  });

  it('a partial receipt leaves the trip IN_TRANSIT', async () => {
    const { queues } = receiptQueues();
    const { service, trips, as, updatesOf } = setup(queues);
    await as(() => service.postReceipt('tr-1', { posting_date: '2026-10-04', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 4 }] }, 'tenant-1', ADMIN));
    expect(updatesOf(schema.stockTransfer).map((u) => u.status)).toEqual(['PARTIALLY_RECEIVED']);
    expect(trips.onArrived).not.toHaveBeenCalled();
    expect(updatesOf(schema.logisticsTrip)).toHaveLength(0);
  });

  it('an untripped receipt asks Logistics for nothing', async () => {
    const queues = receiptQueues().queues;
    queues.set(schema.stockTransfer, [[{ ...TRANSFER, status: 'IN_TRANSIT' }]]);
    const { service, trips, as, selects } = setup(queues);
    await as(() => service.postReceipt('tr-1', { posting_date: '2026-10-04', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 10 }] }, 'tenant-1', ADMIN));
    expect(trips.onArrived).not.toHaveBeenCalled();
    expect(selects(schema.logisticsSetting)).toBe(0);
    for (const t of LOGISTICS_TABLES) expect(selects(t)).toBe(0);
  });

  it('receive() in full moves the trip to ARRIVED; a partial receive() does not', async () => {
    const transfer = { ...TRIPPED, status: 'IN_TRANSIT' };
    const ledgerRows = [{ document_line_id: 'line-1', item_id: 'item-1', transaction_type: 'TRANSFER_SHIPMENT', quantity: '-10', rate: '2.5', created_by: null }];
    for (const [qty, arrives] of [[10, true], [4, false]] as const) {
      const queues = shipmentQueues(transfer);
      queues.set(schema.logisticsTrip, [[{ ...TRIP, status: 'IN_TRANSIT' }]]);
      const { service, trips, as, updatesOf } = setup(queues);
      jest.spyOn(service as any, 'getLedgerHistory').mockResolvedValue(ledgerRows);
      jest.spyOn(service as any, 'assertSiloDestination').mockResolvedValue(undefined);
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...transfer } as any);
      await as(() => service.receive('tr-1', { lines: [{ line_id: 'line-1', received_quantity: qty }] } as any, 'tenant-1', ADMIN));
      expect(updatesOf(schema.stockTransfer)[0].status).toBe(arrives ? 'RECEIVED' : 'IN_TRANSIT');
      if (arrives) expect(trips.onArrived).toHaveBeenCalledWith('trip-1', 'tenant-1', ADMIN);
      else expect(trips.onArrived).not.toHaveBeenCalled();
    }
  });
});

describe('Task 5 fix — a trip never blocks a receipt, and arrives only with all its TOs', () => {
  const TO2 = { ...TRANSFER, transfer_id: 'tr-2', transfer_no: 'TR-2026-0002', trip_id: 'trip-1' };
  /** postReceipt of the whole of tr-1 against SH-1; `onTrip` is what the arrival check finds on the trip. */
  function fullReceipt(tripStatus: string, onTrip: Record<string, unknown>[] = []) {
    const queues = shipmentQueues({ ...TRIPPED, status: 'IN_TRANSIT' });
    queues.get(schema.stockTransfer)!.push(onTrip.map((t) => ({ ...t })));
    queues.set(schema.transferShipment, [[{ ...SHIPMENT }]]);
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '10' }], [{ ...SHIPMENT_LINE }]]);
    queues.set(schema.transferReceiptLine, [[], []]);
    queues.set(schema.logisticsTrip, [[{ ...TRIP, status: tripStatus }]]);
    return queues;
  }
  const receiveAll = { posting_date: '2026-10-04', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 10 }] };

  for (const status of ['CLOSED', 'CANCELLED', 'ARRIVED']) {
    it(`postReceipt posts when the trip is ${status}, and leaves the trip as it is`, async () => {
      const { service, as, updatesOf } = setup(fullReceipt(status));
      const result = await as(() => service.postReceipt('tr-1', receiveAll, 'tenant-1', ADMIN));
      expect(result.receipt_no).toMatch(/^RC-/);
      expect(updatesOf(schema.stockTransfer).map((u) => u.status)).toEqual(['POSTED']);
      expect(updatesOf(schema.logisticsTrip)).toHaveLength(0);
    });

    it(`receive() posts when the trip is ${status}`, async () => {
      const transfer = { ...TRIPPED, status: 'IN_TRANSIT' };
      const queues = shipmentQueues(transfer);
      queues.set(schema.logisticsTrip, [[{ ...TRIP, status }]]);
      const { service, as, updatesOf } = setup(queues);
      jest.spyOn(service as any, 'getLedgerHistory').mockResolvedValue([
        { document_line_id: 'line-1', item_id: 'item-1', transaction_type: 'TRANSFER_SHIPMENT', quantity: '-10', rate: '2.5', created_by: null },
      ]);
      jest.spyOn(service as any, 'assertSiloDestination').mockResolvedValue(undefined);
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...transfer } as any);
      await as(() => service.receive('tr-1', { lines: [{ line_id: 'line-1', received_quantity: 10 }] } as any, 'tenant-1', ADMIN));
      expect(updatesOf(schema.stockTransfer)[0].status).toBe('RECEIVED');
      expect(updatesOf(schema.logisticsTrip)).toHaveLength(0);
    });
  }

  it('two TOs on one trip: TO1 received leaves the trip IN_TRANSIT, TO2 still ships, and TO2 received makes it ARRIVED', async () => {
    // 1. TO1 received in full while TO2 has not shipped: the trip stays on the road.
    const first = setup(fullReceipt('IN_TRANSIT', [{ ...TRIPPED, status: 'POSTED' }, { ...TO2, status: 'DRAFT' }]));
    await first.as(() => first.service.postReceipt('tr-1', receiveAll, 'tenant-1', ADMIN));
    expect(first.updatesOf(schema.logisticsTrip)).toHaveLength(0);

    // 2. TO2 ships on the trip, which is IN_TRANSIT: accepted, and the trip is left as it is.
    const shipQueues = withTrip(shipmentQueues(TO2), { ...TRIP, status: 'IN_TRANSIT' }, TO2);
    shipQueues.get(schema.stockTransferLine)![0] = [{ ...LINE, transfer_id: 'tr-2' }];
    const second = setup(shipQueues);
    const shipped = await second.as(() => second.service.postShipment('tr-2', shipBody, 'tenant-1', ADMIN));
    expect(shipped.shipment_no).toMatch(/^SH-/);
    expect(second.updatesOf(schema.logisticsTrip)).toHaveLength(0);
    expect(second.updatesOf(schema.stockTransfer)).toContainEqual({ vehicle_no: 'ABC 123' });

    // 3. TO2 received in full: every TO on the trip is received, so the trip has arrived.
    const third = setup(fullReceipt('IN_TRANSIT', [{ ...TRIPPED, status: 'POSTED' }, { ...TO2, status: 'POSTED' }]));
    await third.as(() => third.service.postReceipt('tr-1', receiveAll, 'tenant-1', ADMIN));
    expect(third.updatesOf(schema.logisticsTrip).map((u) => u.status)).toEqual(['ARRIVED']);
  });
});

describe('Task 5 — (f) postDirectTransfer follows the same rule', () => {
  /** transfer-execution.service.spec.ts's directQueues, for the whole order in one step. */
  function directQueues(transfer: Record<string, unknown>) {
    const queues = shipmentQueues(transfer);
    queues.set(schema.stockTransfer, [[{ ...transfer }], [{ ...transfer }], [{ ...transfer }], [{ ...transfer }]]);
    queues.set(schema.stockTransferLine, [[{ ...LINE }], [{ ...LINE }], [{ ...LINE }], [{ ...LINE }]]);
    queues.set(schema.locationMaster, [...LOCATIONS.map((l) => [...l]), ...LOCATIONS.map((l) => [...l]), LOCATIONS[0], LOCATIONS[1]]);
    queues.set(schema.transferShipment, [[]]);
    queues.set(schema.transferShipmentLine, [[], [], [{ line_id: 'line-1', qty: '10' }], [{ ...SHIPMENT_LINE }]]);
    queues.set(schema.transferReceipt, [[]]);
    queues.set(schema.transferReceiptLine, [[], []]);
    queues.set(schema.requisition, [[], []]);
    return queues;
  }

  it('the setting on and no trip: refused before anything is written', async () => {
    const queues = directQueues(TRANSFER);
    queues.set(schema.logisticsSetting, [[{ trip_required_to_ship: true }]]);
    const { service, as, writes } = setup(queues);
    await expect(as(() => service.postDirectTransfer('tr-1', { posting_date: '2026-10-02', lines: [] }, 'tenant-1', ADMIN))).rejects.toThrow(REFUSAL);
    expect(writes()).toHaveLength(0);
  });

  it('a CANCELLED trip: refused', async () => {
    const queues = directQueues(TRIPPED);
    queues.get(schema.stockTransfer)!.splice(2, 0, [{ ...TRIPPED }]); // assertTripFor reads the TO after postShipment's load
    queues.set(schema.logisticsTrip, [[{ ...TRIP, status: 'CANCELLED' }]]);
    const { service, as, writes } = setup(queues);
    await expect(as(() => service.postDirectTransfer('tr-1', { posting_date: '2026-10-02', lines: [] }, 'tenant-1', ADMIN))).rejects.toThrow(tripRefusal('CANCELLED'));
    expect(writes()).toHaveLength(0);
  });

  it('the setting off and no trip: posts as before, reading the setting once', async () => {
    const { service, trips, as, selects, updatesOf } = setup(directQueues(TRANSFER));
    await as(() => service.postDirectTransfer('tr-1', { posting_date: '2026-10-02', lines: [] }, 'tenant-1', ADMIN));
    expect(updatesOf(schema.stockTransfer).map((u) => u.status)).toEqual(['IN_TRANSIT', 'POSTED']);
    expect(trips.tripRequiredToShip).toHaveBeenCalledTimes(1);
    expect(selects(schema.logisticsSetting)).toBe(1);
    for (const t of LOGISTICS_TABLES) expect(selects(t)).toBe(0);
  });

  it('a PLANNED trip: ships, takes the truck, and the trip goes IN_TRANSIT then ARRIVED', async () => {
    const queues = directQueues(TRIPPED);
    // Reads of the TO: outer load, postShipment's load, assertTripFor, postReceipt's load, onArrived's check of every
    // TO on the trip (this one, now POSTED), findOne (+ its trip).
    queues.set(schema.stockTransfer, [
      [{ ...TRIPPED }], [{ ...TRIPPED }], [{ ...TRIPPED }], [{ ...TRIPPED }], [{ ...TRIPPED, status: 'POSTED' }], [{ ...TRIPPED }], [{ ...TRIPPED }],
    ]);
    queues.set(schema.logisticsTrip, [
      [{ ...TRIP }],                            // assertTripFor
      [{ ...TRIP }],                            // onShipped's loadTrip
      [{ ...TRIP, status: 'IN_TRANSIT' }],      // onArrived's loadTrip
      [{ ...TRIP, status: 'ARRIVED' }],         // findOne's trip summary
    ]);
    queues.set(schema.logisticsVehicle, [[{ ...VEHICLE }], [{ ...VEHICLE }]]);
    queues.set(schema.logisticsDriver, [[{ ...DRIVER }], [{ ...DRIVER }]]);
    queues.set(schema.logisticsRoute, [[{ ...ROUTE }]]);
    queues.set(schema.logisticsDeliveryZone, [[{ ...ZONE }]]);
    const { service, trips, as, updatesOf } = setup(queues);
    const result = await as(() => service.postDirectTransfer('tr-1', { posting_date: '2026-10-02', lines: [] }, 'tenant-1', ADMIN));
    expect(trips.onShipped).toHaveBeenCalledWith('trip-1', 'tenant-1', ADMIN);
    expect(trips.onArrived).toHaveBeenCalledWith('trip-1', 'tenant-1', ADMIN);
    expect(updatesOf(schema.logisticsTrip).map((u) => u.status)).toEqual(['CONFIRMED', 'IN_TRANSIT', 'ARRIVED']);
    expect(updatesOf(schema.stockTransfer)).toContainEqual({ vehicle_no: 'ABC 123' });
    expect(result.trip).toMatchObject({ trip_id: 'trip-1', status: 'ARRIVED', vehicle_no: 'ABC 123' });
  });
});

describe('Task 5 — findOne carries the trip summary', () => {
  function findQueues(transfer: Record<string, unknown>) {
    return new Map<unknown, unknown[][]>([
      [schema.stockTransfer, [[{ ...transfer }], [{ ...transfer }]]],
      [schema.stockTransferLine, [[{ ...LINE }]]],
      [schema.logisticsTrip, [[{ ...TRIP }]]],
      [schema.logisticsVehicle, [[{ ...VEHICLE }]]],
      [schema.logisticsDriver, [[{ ...DRIVER }]]],
    ]);
  }

  it('a TO on a trip', async () => {
    const { service, as } = setup(findQueues(TRIPPED));
    const result = await as(() => service.findOne('tr-1'));
    expect(result.trip).toEqual({
      trip_id: 'trip-1', trip_no: 'TRP-000001', status: 'PLANNED', vehicle_no: 'ABC 123', driver_name: 'Tendai',
      estimated_arrival: '2026-10-02 12:00:00',
    });
    expect(result.transfer_no).toBe('TR-2026-0001');
  });

  it('a TO on no trip is null, with no Logistics read', async () => {
    const { service, trips, as, selects } = setup(findQueues(TRANSFER));
    const result = await as(() => service.findOne('tr-1'));
    expect(result.trip).toBeNull();
    expect(trips.assertTripFor).not.toHaveBeenCalled();
    for (const t of LOGISTICS_TABLES) expect(selects(t)).toBe(0);
  });
});
