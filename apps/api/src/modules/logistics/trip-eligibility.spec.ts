import { driverExclusions, vehicleExclusions, DriverFacts, VehicleFacts } from './trip-eligibility';

const vehicle = (o: Partial<VehicleFacts> = {}): VehicleFacts => ({
  registration_no: 'ABC-123',
  status: 'AVAILABLE',
  is_active: true,
  vehicle_type: 'LIVESTOCK',
  capacity_kg: 0,
  capacity_head: 100,
  capacity_bags: 0,
  documents: [{ document_type: 'INSURANCE', expiry_date: '2027-01-01' }],
  ...o,
});
const trip = { type: 'LIVESTOCK' as const, load: 50, departure: '2026-11-12T08:00:00', returnDate: '2026-11-14' };
const driver = (o: Partial<DriverFacts> = {}): DriverFacts => ({
  driver_name: 'Sam',
  is_active: true,
  licence_class: 'C',
  licence_expiry: '2027-01-01',
  ...o,
});
const dtrip = { departure: '2026-11-12T08:00:00', returnDate: '2026-11-14' };

describe('vehicleExclusions', () => {
  it('returns nothing for an eligible vehicle', () => {
    expect(vehicleExclusions(vehicle(), trip, [])).toEqual([]);
  });
  it('inactive', () => {
    expect(vehicleExclusions(vehicle({ is_active: false }), trip, [])).toEqual(['Vehicle is inactive.']);
  });
  it('status not available', () => {
    expect(vehicleExclusions(vehicle({ status: 'IN_MAINTENANCE' }), trip, [])).toEqual(['Vehicle is In maintenance.']);
  });
  it('wrong type, skipping the capacity reason', () => {
    expect(
      vehicleExclusions(vehicle({ vehicle_type: 'BULK_FEED', capacity_kg: 10 }), { ...trip, load: 99999 }, []),
    ).toEqual(['Vehicle is a Bulk feed truck; this load needs a Livestock truck.']);
  });
  it('no insurance on file', () => {
    expect(vehicleExclusions(vehicle({ documents: [] }), trip, [])).toEqual(['No insurance on file.']);
  });
  it('insurance expiring before the return', () => {
    const v = vehicle({ documents: [{ document_type: 'INSURANCE', expiry_date: '2026-11-13' }] });
    expect(vehicleExclusions(v, trip, [])).toEqual(['Insurance expires 2026-11-13, before the return on 2026-11-14.']);
  });
  it('licence and fitness expiring before the return', () => {
    const v = vehicle({
      documents: [
        { document_type: 'INSURANCE', expiry_date: '2027-01-01' },
        { document_type: 'LICENCE', expiry_date: '2026-11-13' },
        { document_type: 'FITNESS', expiry_date: '2026-11-01' },
      ],
    });
    expect(vehicleExclusions(v, trip, [])).toEqual([
      'Licence expires 2026-11-13, before the return on 2026-11-14.',
      'Fitness expires 2026-11-01, before the return on 2026-11-14.',
    ]);
  });
  it('missing licence/fitness and OTHER documents are not reasons', () => {
    const v = vehicle({
      documents: [
        { document_type: 'INSURANCE', expiry_date: '2027-01-01' },
        { document_type: 'OTHER', expiry_date: '2020-01-01' },
      ],
    });
    expect(vehicleExclusions(v, trip, [])).toEqual([]);
  });
  it('a document expiring on the return date is still valid', () => {
    const v = vehicle({ documents: [{ document_type: 'INSURANCE', expiry_date: '2026-11-14' }] });
    expect(vehicleExclusions(v, trip, [])).toEqual([]);
  });
  it('judges the latest of two insurance documents', () => {
    const v = vehicle({
      documents: [
        { document_type: 'INSURANCE', expiry_date: '2026-11-01' },
        { document_type: 'INSURANCE', expiry_date: '2027-06-01' },
      ],
    });
    expect(vehicleExclusions(v, trip, [])).toEqual([]);
  });
  it('load over capacity', () => {
    const v = vehicle({ vehicle_type: 'BULK_FEED', capacity_kg: 30000, capacity_head: 0 });
    expect(vehicleExclusions(v, { ...trip, type: 'BULK_FEED', load: 30001 }, [])).toEqual([
      'Load 30,001 KG is over the 30,000 KG capacity.',
    ]);
  });
  it('load over capacity in head and bags', () => {
    expect(vehicleExclusions(vehicle(), { ...trip, load: 101 }, [])).toEqual([
      'Load 101 head is over the 100 head capacity.',
    ]);
    const v = vehicle({ vehicle_type: 'BAGGED_FEED', capacity_bags: 500, capacity_head: 0 });
    expect(vehicleExclusions(v, { ...trip, type: 'BAGGED_FEED', load: 501 }, [])).toEqual([
      'Load 501 bags is over the 500 bags capacity.',
    ]);
  });
  it('load at the capacity is allowed, a warning is not an exclusion', () => {
    expect(vehicleExclusions(vehicle(), { ...trip, load: 100 }, [])).toEqual([]);
    expect(vehicleExclusions(vehicle(), { ...trip, load: 99 }, [])).toEqual([]);
  });
  it('no capacity recorded', () => {
    expect(vehicleExclusions(vehicle({ capacity_head: 0 }), trip, [])).toEqual(['Vehicle has no capacity recorded.']);
  });
  it('overlapping trip', () => {
    const busy = [{ trip_no: 'TRP-000007', start: '2026-11-12T06:00:00', end: '2026-11-12T14:00:00' }];
    expect(vehicleExclusions(vehicle(), trip, busy)).toEqual(['Already on trip TRP-000007 until 2026-11-12 14:00.']);
  });
  it('back-to-back trips do not clash', () => {
    const before = [{ trip_no: 'TRP-1', start: '2026-11-11T08:00:00', end: '2026-11-12T08:00:00' }];
    const after = [{ trip_no: 'TRP-2', start: '2026-11-14T23:59:59.999', end: '2026-11-15T10:00:00' }];
    expect(vehicleExclusions(vehicle(), trip, [...before, ...after])).toEqual([]);
  });
  it('returns every reason, in order', () => {
    const v = vehicle({ is_active: false, status: 'BLOCKED', documents: [] });
    expect(vehicleExclusions(v, trip, [])).toEqual([
      'Vehicle is inactive.',
      'Vehicle is Blocked.',
      'No insurance on file.',
    ]);
  });
});

describe('driverExclusions', () => {
  it('returns nothing for an eligible driver', () => {
    expect(driverExclusions(driver(), dtrip, [])).toEqual([]);
  });
  it('inactive', () => {
    expect(driverExclusions(driver({ is_active: false }), dtrip, [])).toEqual(['Driver is inactive.']);
  });
  it('licence expiring before the return, but not on it', () => {
    expect(driverExclusions(driver({ licence_expiry: '2026-11-13' }), dtrip, [])).toEqual([
      'Licence expires 2026-11-13, before the return on 2026-11-14.',
    ]);
    expect(driverExclusions(driver({ licence_expiry: '2026-11-14' }), dtrip, [])).toEqual([]);
  });
  it('licence class not covering the trip', () => {
    expect(driverExclusions(driver(), { ...dtrip, licenceClass: 'EC' }, [])).toEqual([
      'Licence class C does not cover class EC.',
    ]);
    expect(driverExclusions(driver({ licence_class: ' ec ' }), { ...dtrip, licenceClass: 'EC' }, [])).toEqual([]);
  });
  it('overlapping trip, and two reasons at once', () => {
    const busy = [{ trip_no: 'TRP-000007', start: '2026-11-12T06:00:00', end: '2026-11-12T14:00:00' }];
    expect(driverExclusions(driver({ is_active: false }), dtrip, busy)).toEqual([
      'Driver is inactive.',
      'Already on trip TRP-000007 until 2026-11-12 14:00.',
    ]);
  });
});
