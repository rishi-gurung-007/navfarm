import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../test-utils/transaction-cls';
import * as schema from '../../core/database/schema';
import { AuditLogService } from '../system/audit-log/audit-log.service';
import { UomService } from '../master-data/uom/uom.service';
import { LogisticsTripService } from './logistics-trip.service';

/**
 * Logistics Phase 2, Task 4. The db double answers by table (like stock-transfer.service.spec.ts), not by call order,
 * and records every insert and update so a test can read what the service wrote.
 */
describe('LogisticsTripService', () => {
  let service: LogisticsTripService;
  const rows = new Map<unknown, any[]>();
  const inserts: { table: unknown; values: any }[] = [];
  const updates: { table: unknown; set: any }[] = [];
  const audit = { log: jest.fn().mockResolvedValue({}) };
  const resolveConversionFactor = jest.fn();

  const chain = (result: unknown[]) => {
    const self: any = {
      from: () => self, innerJoin: () => self, leftJoin: () => self, where: () => self, orderBy: () => self,
      limit: () => self, offset: () => self, for: () => self, groupBy: () => self,
      then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
    };
    return self;
  };
  const db: any = {
    select: jest.fn(() => ({ from: (t: unknown) => chain(rows.get(t) ?? []) })),
    insert: jest.fn((table: unknown) => ({
      values: jest.fn(async (v: any) => {
        inserts.push({ table, values: v });
        // Readable afterwards, so the service can read back what it wrote.
        rows.get(table)?.push(...(Array.isArray(v) ? v : [v]));
      }),
    })),
    update: jest.fn((table: unknown) => ({
      set: jest.fn((set: any) => {
        updates.push({ table, set });
        return { where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) };
      }),
    })),
  };

  const company = 'co-1';
  const route = {
    route_id: 'rt-1', tenant_id: 't1', company_id: company, route_code: 'MILL-F1', from_zone_id: 'z-mill', to_zone_id: 'z-farm',
    distance_km: '100.0', speed_kmh: '50.0', loading_minutes: 60, offloading_minutes: 60, break_minutes: 0, tolls: '0.00',
    return_leg_charged: false, is_active: true,
  };
  const farmZone = { zone_id: 'z-farm', company_id: company, zone_type: 'FARM', zone_name: 'Farm 1' };
  const colcomZone = { zone_id: 'z-farm', company_id: company, zone_type: 'COLCOM', zone_name: 'Colcom' };
  const to = (over: any = {}) => ({
    transfer_id: 'to-1', tenant_id: 't1', company_id: company, transfer_no: 'TR-000001', status: 'DRAFT', trip_id: null,
    from_warehouse_id: 'bin-1', to_warehouse_id: 'silo-1', deleted_at: null, ...over,
  });
  const trip = (over: any = {}) => ({
    trip_id: 'trip-1', tenant_id: 't1', company_id: company, trip_no: 'TRP-000001', status: 'DRAFT', vehicle_id: null,
    driver_id: null, route_id: 'rt-1', carrier_supplier_id: null, planned_departure: '2026-11-20 06:00:00',
    estimated_arrival: '2026-11-20 10:00:00', load_value: '30001.00', load_unit: 'KG', estimate_note: null,
    hq_approval_ref: null, deleted_at: null, ...over,
  });
  const truck = (over: any = {}) => ({
    vehicle_id: 'v-1', tenant_id: 't1', company_id: company, registration_no: 'ABC 123', vehicle_type: 'BULK_FEED',
    ownership: 'OWN', carrier_supplier_id: null, capacity_kg: '30000.00', capacity_head: null, capacity_bags: null,
    status: 'AVAILABLE', is_active: true, deleted_at: null, ...over,
  });
  const insurance = { document_id: 'd-1', vehicle_id: 'v-1', document_type: 'INSURANCE', expiry_date: '2027-12-31', is_active: true };
  const driver = (over: any = {}) => ({
    driver_id: 'dr-1', tenant_id: 't1', company_id: company, driver_name: 'Tendai', licence_class: 'EC',
    licence_expiry: '2028-01-01', is_active: true, deleted_at: null, ...over,
  });

  const planBody = (over: any = {}) => ({
    transfer_ids: ['to-1'], planned_departure: '2026-11-20T06:00', route_id: 'rt-1', vehicle_type: 'BULK_FEED', ...over,
  });

  beforeEach(async () => {
    rows.clear();
    inserts.length = 0;
    updates.length = 0;
    audit.log.mockClear();
    db.select.mockClear();
    resolveConversionFactor.mockReset().mockImplementation(async (from: string) => {
      if (from === 'KG') return 1;
      if (from === 'BAG') return 50;
      throw new Error('no conversion');
    });
    rows.set(schema.logisticsRoute, [route]);
    rows.set(schema.logisticsDeliveryZone, [farmZone]);
    rows.set(schema.stockTransfer, [to()]);
    rows.set(schema.stockTransferLine, [{ line_id: 'l-1', transfer_id: 'to-1', line_no: 1, item_id: 'feed-1', quantity: '30001.0000', uom: 'KG' }]);
    rows.set(schema.locationMaster, [{ location_id: 'silo-1', parent: 'farm-1', farm_id: 'farm-1', location_name: 'Silo 1' }]);
    rows.set(schema.feedPlanningSetting, []);
    rows.set(schema.logisticsTrip, [trip()]);
    rows.set(schema.logisticsTripLine, [{ trip_line_id: 'tl-1', trip_id: 'trip-1', transfer_id: 'to-1', weight_kg: '30001.00', head_count: null, bag_count: null }]);
    rows.set(schema.logisticsTripCost, []);
    rows.set(schema.logisticsVehicle, [truck()]);
    rows.set(schema.logisticsVehicleDocument, [insurance]);
    rows.set(schema.logisticsDriver, [driver()]);
    rows.set(schema.logisticsSetting, []);
    rows.set(schema.logisticsFreightRate, []);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LogisticsTripService,
        { provide: ClsService, useValue: transactionCls(db) },
        { provide: AuditLogService, useValue: audit },
        { provide: UomService, useValue: { resolveConversionFactor } },
      ],
    }).compile();
    service = module.get(LogisticsTripService);
  });

  describe('plan', () => {
    it('rejects a Transfer Order already on an open trip', async () => {
      rows.set(schema.stockTransfer, [to({ trip_id: 'trip-9' })]);
      rows.set(schema.logisticsTrip, [trip({ trip_id: 'trip-9', trip_no: 'TRP-000009', status: 'PLANNED' })]);
      await expect(service.plan(planBody(), 't1')).rejects.toThrow('TR-000001 is already on trip TRP-000009.');
      expect(inserts).toHaveLength(0);
    });

    it('rejects Transfer Orders of different companies', async () => {
      rows.set(schema.stockTransfer, [to(), to({ transfer_id: 'to-2', transfer_no: 'TR-000002', company_id: 'co-2' })]);
      await expect(service.plan(planBody({ transfer_ids: ['to-1', 'to-2'] }), 't1')).rejects.toThrow(
        'Transfer Orders of different companies cannot share a trip.',
      );
      expect(inserts).toHaveLength(0);
    });

    it('requires the truck type', async () => {
      await expect(service.plan(planBody({ vehicle_type: undefined }), 't1')).rejects.toThrow(/Vehicle Type must be one of/);
    });

    it('creates a DRAFT trip numbered TRP-, one line per TO line, and puts the TO on it', async () => {
      rows.set(schema.logisticsTrip, []);
      await service.plan(planBody(), 't1', { userId: 'u1' });
      const tripRow = inserts.find((i) => i.table === schema.logisticsTrip)!.values;
      expect(tripRow).toMatchObject({
        trip_no: 'TRP-000001', status: 'DRAFT', company_id: company, load_unit: 'KG', load_value: '30001.00',
        planned_departure: '2026-11-20 06:00:00', estimated_arrival: '2026-11-20 10:00:00',
        estimated_cost: null, estimate_note: 'Assign a vehicle to estimate cost.',
      });
      const lines = inserts.filter((i) => i.table === schema.logisticsTripLine).flatMap((i) => i.values);
      expect(lines).toEqual([expect.objectContaining({ transfer_id: 'to-1', transfer_line_id: 'l-1', weight_kg: '30001.00', head_count: null, bag_count: null })]);
      expect(updates.find((u) => u.table === schema.stockTransfer)!.set).toMatchObject({ trip_id: tripRow.trip_id });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entityName: 'logistics_trip' }));
    });

    it('counts bags from the bag size, and warns instead of blocking when there is none', async () => {
      rows.set(schema.logisticsTrip, []);
      rows.set(schema.stockTransferLine, [{ line_id: 'l-1', transfer_id: 'to-1', line_no: 1, item_id: 'feed-1', quantity: '1000.0000', uom: 'KG' }]);
      await service.plan(planBody({ vehicle_type: 'BAGGED_FEED' }), 't1');
      let tripRow = inserts.find((i) => i.table === schema.logisticsTrip)!.values;
      expect(tripRow.load_unit).toBe('BAGS');
      expect(tripRow.load_value).toBeNull();
      expect(tripRow.estimate_note).toMatch(/bag size/i);

      inserts.length = 0;
      rows.set(schema.feedPlanningSetting, [{ farm_id: null, bag_size_kg: '50.00' }]);
      await service.plan(planBody({ vehicle_type: 'BAGGED_FEED' }), 't1');
      tripRow = inserts.find((i) => i.table === schema.logisticsTrip)!.values;
      expect(tripRow.load_value).toBe('20.00');
      expect(inserts.find((i) => i.table === schema.logisticsTripLine)!.values[0].bag_count).toBe(20);
    });
  });

  describe('assign', () => {
    it('refuses a 30,001 KG load on a 30,000 KG truck as over the limit', async () => {
      await expect(service.assign('trip-1', { vehicle_id: 'v-1', driver_id: 'dr-1' }, 't1')).rejects.toThrow(/over the limit/);
      expect(updates.filter((u) => u.table === schema.logisticsTrip)).toHaveLength(0);
    });

    it('refuses an excluded vehicle, listing every reason', async () => {
      rows.set(schema.logisticsTrip, [trip({ load_value: '1000.00' })]);
      rows.set(schema.logisticsVehicle, [truck({ is_active: false, vehicle_type: 'LIVESTOCK' })]);
      rows.set(schema.logisticsVehicleDocument, []);
      const err = await service.assign('trip-1', { vehicle_id: 'v-1', driver_id: 'dr-1' }, 't1').catch((e) => e);
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('Vehicle is inactive.');
      expect(err.message).toContain('this load needs a Bulk feed truck.');
      expect(err.message).toContain('No insurance on file.');
    });

    it('sets the trip PLANNED and writes the freight estimate split by weight', async () => {
      rows.set(schema.logisticsTrip, [trip({ load_value: '20000.00' })]);
      rows.set(schema.logisticsTripLine, [
        { trip_line_id: 'tl-1', trip_id: 'trip-1', transfer_id: 'to-1', weight_kg: '15000.00' },
        { trip_line_id: 'tl-2', trip_id: 'trip-1', transfer_id: 'to-1', weight_kg: '5000.00' },
      ]);
      rows.set(schema.logisticsVehicle, [truck({ ownership: 'HIRED', carrier_supplier_id: 'sup-1' })]);
      rows.set(schema.logisticsFreightRate, [{
        rate_id: 'r-1', carrier_supplier_id: 'sup-1', route_id: 'rt-1', rate_basis: 'KM', rate: '10.0000', minimum_charge: null,
        fuel_surcharge_pct: null, valid_from: '2026-01-01', valid_to: null, approval_status: 'APPROVED',
      }]);
      await service.assign('trip-1', { vehicle_id: 'v-1', driver_id: 'dr-1' }, 't1', { userId: 'u1' });
      const set = updates.find((u) => u.table === schema.logisticsTrip)!.set;
      expect(set).toMatchObject({ status: 'PLANNED', vehicle_id: 'v-1', driver_id: 'dr-1', carrier_supplier_id: 'sup-1', estimated_cost: '1000.00' });
      const shares = updates.filter((u) => u.table === schema.logisticsTripLine).map((u) => u.set);
      expect(shares).toEqual([
        expect.objectContaining({ estimated_cost_share: '750.00', share_pct: '75.00' }),
        expect.objectContaining({ estimated_cost_share: '250.00', share_pct: '25.00' }),
      ]);
      expect(inserts.find((i) => i.table === schema.logisticsTripCost)!.values).toMatchObject({ cost_type: 'FREIGHT', amount: '1000.00', is_estimate: true });
    });

    it('never estimates 0 when there is no approved rate', async () => {
      rows.set(schema.logisticsTrip, [trip({ load_value: '20000.00' })]);
      await service.assign('trip-1', { vehicle_id: 'v-1', driver_id: 'dr-1' }, 't1');
      const set = updates.find((u) => u.table === schema.logisticsTrip)!.set;
      expect(set.estimated_cost).toBeNull();
      expect(set.estimate_note).toContain('No approved freight rate.');
    });
  });

  describe('move and cancel', () => {
    it('refuses DRAFT to CONFIRMED', async () => {
      await expect(service.move('trip-1', { to: 'CONFIRMED' }, 't1')).rejects.toThrow('A trip cannot go from DRAFT to CONFIRMED.');
    });

    it('refuses to cancel without a reason', async () => {
      await expect(service.cancel('trip-1', { reason: '  ' }, 't1')).rejects.toThrow('A reason is required to cancel a trip.');
    });

    it('cancelling frees the Transfer Orders', async () => {
      await service.cancel('trip-1', { reason: 'Truck broke down' }, 't1');
      expect(updates.find((u) => u.table === schema.logisticsTrip)!.set).toMatchObject({ status: 'CANCELLED', cancel_reason: 'Truck broke down' });
      expect(updates.find((u) => u.table === schema.stockTransfer)!.set).toEqual(expect.objectContaining({ trip_id: null }));
    });

    it('a CLOSED trip refuses assign, move and cancel', async () => {
      rows.set(schema.logisticsTrip, [trip({ status: 'CLOSED' })]);
      const locked = 'This trip is closed and locked.';
      await expect(service.assign('trip-1', { vehicle_id: 'v-1', driver_id: 'dr-1' }, 't1')).rejects.toThrow(locked);
      await expect(service.move('trip-1', { to: 'CANCELLED', reason: 'x' }, 't1')).rejects.toThrow(locked);
      await expect(service.move('trip-1', { to: 'PLANNED' }, 't1')).rejects.toThrow(locked);
      await expect(service.cancel('trip-1', { reason: 'x' }, 't1')).rejects.toThrow(locked);
      expect(updates).toHaveLength(0);
    });

    it('a trip to Colcom needs the HQ approval reference before CONFIRMED', async () => {
      rows.set(schema.logisticsTrip, [trip({ status: 'PLANNED', vehicle_id: 'v-1', driver_id: 'dr-1' })]);
      rows.set(schema.logisticsDeliveryZone, [colcomZone]);
      await expect(service.move('trip-1', { to: 'CONFIRMED' }, 't1')).rejects.toThrow(/HQ approval reference/);
      expect(updates).toHaveLength(0);
      await service.move('trip-1', { to: 'CONFIRMED', hq_approval_ref: 'HQ-77' }, 't1');
      expect(updates.find((u) => u.table === schema.logisticsTrip)!.set).toMatchObject({ status: 'CONFIRMED', hq_approval_ref: 'HQ-77' });
    });

    it('records the manual timestamp on IN_TRANSIT', async () => {
      rows.set(schema.logisticsTrip, [trip({ status: 'CONFIRMED', vehicle_id: 'v-1', driver_id: 'dr-1' })]);
      await service.move('trip-1', { to: 'IN_TRANSIT', at: '2026-11-20T06:15' }, 't1');
      expect(updates.find((u) => u.table === schema.logisticsTrip)!.set).toMatchObject({ status: 'IN_TRANSIT', actual_departure: '2026-11-20 06:15:00' });
    });
  });

  describe('for the Transfer Order (Task 5)', () => {
    it('onShipped takes a PLANNED trip through CONFIRMED to IN_TRANSIT', async () => {
      rows.set(schema.logisticsTrip, [trip({ status: 'PLANNED', vehicle_id: 'v-1', driver_id: 'dr-1' })]);
      await service.onShipped('trip-1', 't1');
      expect(updates.filter((u) => u.table === schema.logisticsTrip).map((u) => u.set.status)).toEqual(['CONFIRMED', 'IN_TRANSIT']);
    });

    it('onShipped refuses a closed trip', async () => {
      rows.set(schema.logisticsTrip, [trip({ status: 'CLOSED' })]);
      await expect(service.onShipped('trip-1', 't1')).rejects.toThrow('This trip is closed and locked.');
    });

    it('onArrived moves IN_TRANSIT to ARRIVED', async () => {
      rows.set(schema.logisticsTrip, [trip({ status: 'IN_TRANSIT', vehicle_id: 'v-1' })]);
      await service.onArrived('trip-1', 't1');
      expect(updates.find((u) => u.table === schema.logisticsTrip)!.set).toMatchObject({ status: 'ARRIVED' });
    });

    it('assertTripFor gives the trip and its truck, or null', async () => {
      rows.set(schema.stockTransfer, [to({ trip_id: 'trip-1' })]);
      rows.set(schema.logisticsTrip, [trip({ status: 'PLANNED', vehicle_id: 'v-1' })]);
      await expect(service.assertTripFor('to-1', 't1')).resolves.toMatchObject({ trip_id: 'trip-1', trip_no: 'TRP-000001', status: 'PLANNED', vehicle_no: 'ABC 123' });
      rows.set(schema.stockTransfer, [to()]);
      await expect(service.assertTripFor('to-1', 't1')).resolves.toBeNull();
    });
  });
});
