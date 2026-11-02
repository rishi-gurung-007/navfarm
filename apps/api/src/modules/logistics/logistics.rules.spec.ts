import {
  datesOverlap, driverProblems, freightRateProblems, routeProblems, servicePlanProblems, settingProblems,
  vehicleDocumentProblems, vehicleProblems, zoneProblems,
} from './logistics.rules';

describe('Logistics Phase 1 master rules', () => {
  it('a vehicle needs its registration, type, ownership and at least one capacity', () => {
    expect(vehicleProblems({ registration_no: 'ABC 123', vehicle_type: 'BULK_FEED', ownership: 'OWN', capacity_kg: 30000 })).toEqual([]);
    expect(vehicleProblems({ vehicle_type: 'CAR', ownership: 'OWN' })).toEqual([
      'Registration No. is required.',
      'Vehicle Type must be one of LIVESTOCK, BULK_FEED, BAGGED_FEED.',
      'Give at least one load capacity (KG, head, bags or tonnes).',
    ]);
  });

  it('a hired vehicle names its carrier, and nothing is negative', () => {
    expect(vehicleProblems({ registration_no: 'X', vehicle_type: 'LIVESTOCK', ownership: 'HIRED', capacity_head: -1 })).toEqual([
      'A hired vehicle needs its carrier.', 'Capacity Head cannot be negative.', 'Give at least one load capacity (KG, head, bags or tonnes).',
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

  it('a service plan is for a vehicle or a type, every so many km or days', () => {
    expect(servicePlanProblems({ plan_name: 'A' })).toEqual(['Choose a vehicle or a vehicle type.', 'Give a service interval in km, days or both.']);
    expect(servicePlanProblems({ plan_name: 'A', vehicle_type: 'BULK_FEED', interval_days: 90 })).toEqual([]);
  });

  it('settings percentages stay between 0 and 100', () => {
    expect(settingProblems({ capacity_warning_pct: 95, cost_variance_pct: 110 })).toEqual(['Cost Variance % must be between 0 and 100.']);
  });
});
