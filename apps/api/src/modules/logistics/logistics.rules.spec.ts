import {
  datesOverlap, driverProblems, freightRateProblems, routeProblems, servicePlanProblems, settingProblems,
  routeStopProblems, vehicleDocumentProblems, vehicleProblems, zoneProblems,
} from './logistics.rules';

describe('Logistics Phase 1 master rules', () => {
  it('a vehicle needs its registration, type and ownership', () => {
    expect(vehicleProblems({ registration_no: 'ABC 123', vehicle_type: 'BULK_FEED', ownership: 'OWN', capacity_kg: 30000 })).toEqual([]);
    expect(vehicleProblems({ vehicle_type: 'CAR', ownership: 'OWN' })).toEqual([
      'Registration No. is required.',
      'Vehicle Type must be one of LIVESTOCK, BULK_FEED, BAGGED_FEED.',
    ]);
  });

  // Rishi, 5 Nov: each type is measured in its own unit, so that is the one asked for and the one required.
  it('a vehicle is required the capacity its type is measured in, and no other', () => {
    expect(vehicleProblems({ registration_no: 'L1', vehicle_type: 'LIVESTOCK', ownership: 'OWN', capacity_head: 120 })).toEqual([]);
    expect(vehicleProblems({ registration_no: 'B1', vehicle_type: 'BAGGED_FEED', ownership: 'OWN', capacity_bags: 400 })).toEqual([]);
    expect(vehicleProblems({ registration_no: 'L2', vehicle_type: 'LIVESTOCK', ownership: 'OWN', capacity_kg: 30000 }))
      .toEqual(['Capacity Head is required for this vehicle type.']);
    expect(vehicleProblems({ registration_no: 'B2', vehicle_type: 'BULK_FEED', ownership: 'OWN', capacity_bags: 400 }))
      .toEqual(['Capacity KG is required for this vehicle type.']);
  });

  // Tonnes is offered on every type but never required — a truck's tonnage is not always on its papers.
  it('tonnes alone does not satisfy the type capacity, and does not block when left empty', () => {
    expect(vehicleProblems({ registration_no: 'T1', vehicle_type: 'BULK_FEED', ownership: 'OWN', capacity_tonnes: 30 }))
      .toEqual(['Capacity KG is required for this vehicle type.']);
    expect(vehicleProblems({ registration_no: 'T2', vehicle_type: 'BULK_FEED', ownership: 'OWN', capacity_kg: 30000, capacity_tonnes: 30 })).toEqual([]);
  });

  it('a hired vehicle names its carrier, and nothing is negative', () => {
    expect(vehicleProblems({ registration_no: 'X', vehicle_type: 'LIVESTOCK', ownership: 'HIRED', capacity_head: -1 })).toEqual([
      'A hired vehicle needs its carrier.', 'Capacity Head cannot be negative.', 'Capacity Head is required for this vehicle type.',
    ]);
  });

  it('a vehicle paper expires on or after it was issued', () => {
    expect(vehicleDocumentProblems({ vehicle_id: 'v', document_type: 'INSURANCE', issue_date: '2026-11-02', expiry_date: '2026-11-01' }))
      .toEqual(['Expiry Date cannot be before Issue Date.']);
    expect(vehicleDocumentProblems({ vehicle_id: 'v', document_type: 'INSURANCE', expiry_date: '2027-11-01' })).toEqual([]);
  });

  it('a driver needs a licence number, class and expiry', () => {
    expect(driverProblems({ driver_name: 'T. Moyo' })).toEqual(['Licence No. is required.', 'Licence Class is required.', 'Licence Expiry is required.']);
  });

  it('a zone has a valid map point when one is given', () => {
    expect(zoneProblems({ zone_code: 'Z1', zone_name: 'Mill', zone_type: 'MILL', latitude: 91 })).toEqual(['Latitude must be between -90 and 90.']);
  });

  // Rishi, 5 Nov: the route code says which zone the route runs in, so a stop carries its own name and point.
  it('a route stop needs its route, name and number, not a zone', () => {
    expect(routeStopProblems({ route_id: 'r', stop_name: 'Nyabira turn-off', stop_seq: 1, latitude: -17.7215, longitude: 30.821 })).toEqual([]);
    expect(routeStopProblems({ route_id: 'r', stop_seq: 1 })).toEqual(['Stop Name is required.']);
    expect(routeStopProblems({ route_id: 'r', stop_name: 'Gate 2', stop_seq: 0, latitude: -91 }))
      .toEqual(['Stop No. must be more than 0.', 'Latitude must be between -90 and 90.']);
  });

  it('a route goes somewhere else, over a real distance and speed', () => {
    expect(routeProblems({ route_code: 'R1', from_zone_id: 'a', to_zone_id: 'a', distance_km: 0, speed_kmh: 60 }))
      .toEqual(['From Zone and To Zone must differ.', 'Distance KM must be more than 0.']);
  });

  it('a freight rate has a basis, a rate and a date range that runs forwards', () => {
    expect(freightRateProblems({ carrier_supplier_id: 'c', rate_basis: 'KM', rate: 2.5, valid_from: '2026-11-01', valid_to: '2026-10-01' }))
      .toEqual(['Valid To cannot be before Valid From.']);
    expect(freightRateProblems({ carrier_supplier_id: 'c', rate_basis: 'KM', rate: 2.5, fuel_surcharge_pct: 120, valid_from: '2026-11-01' }))
      .toEqual(['Fuel Surcharge % must be between 0 and 100.']);
  });

  it('two rates overlap when they share a day, an open end running on for ever', () => {
    expect(datesOverlap({ valid_from: '2026-01-01', valid_to: '2026-06-30' }, { valid_from: '2026-06-30', valid_to: null })).toBe(true);
    expect(datesOverlap({ valid_from: '2026-01-01', valid_to: '2026-06-29' }, { valid_from: '2026-06-30', valid_to: null })).toBe(false);
    expect(datesOverlap({ valid_from: '2026-07-01', valid_to: null }, { valid_from: '2026-01-01', valid_to: null })).toBe(true);
  });

  // Choosing a vehicle fills its own type in, so both arriving together is normal, not a contradiction.
  it('a service plan takes a vehicle and its type together', () => {
    expect(servicePlanProblems({ plan_name: 'Tanker 15k', vehicle_id: 'v1', vehicle_type: 'BULK_FEED', interval_km: 15000 })).toEqual([]);
    expect(servicePlanProblems({ plan_name: 'All tankers', vehicle_type: 'BULK_FEED', interval_km: 15000 })).toEqual([]);
    expect(servicePlanProblems({ plan_name: 'One truck', vehicle_id: 'v1', interval_km: 15000 })).toEqual([]);
  });

  it('a service plan is for a vehicle or a type, every so many km or days', () => {
    expect(servicePlanProblems({ plan_name: 'A' })).toEqual(['Choose a vehicle or a vehicle type.', 'Give a service interval in km, days or both.']);
    expect(servicePlanProblems({ plan_name: 'A', vehicle_type: 'BULK_FEED', interval_days: 90 })).toEqual([]);
  });

  it('settings percentages stay between 0 and 100', () => {
    expect(settingProblems({ capacity_warning_pct: 95, cost_variance_pct: 110 })).toEqual(['Cost Variance % must be between 0 and 100.']);
  });
});
