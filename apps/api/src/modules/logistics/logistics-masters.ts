import type { AnyMySqlTable } from 'drizzle-orm/mysql-core';
import * as schema from '../../core/database/schema';
import {
  driverProblems, freightRateProblems, routeProblems, routeStopProblems, servicePlanProblems, settingProblems,
  vehicleDocumentProblems, vehicleProblems, zoneProblems,
} from './logistics.rules';

type Kind = 'text' | 'decimal' | 'int' | 'bool' | 'date' | 'id';

/** A column a record points at, checked to exist in the same company before a save. */
export interface Reference {
  field: string;
  table: AnyMySqlTable;
  idColumn: string;
  label: string;
  /** Column → value the referenced row must have (e.g. a farm location). */
  where?: Record<string, string>;
}

/** A name shown beside an id in the list, read from the referenced table. */
export interface Display {
  field: string;
  table: AnyMySqlTable;
  idColumn: string;
  /** Output key → column of the referenced table. */
  columns: Record<string, string>;
}

export interface LogisticsMaster {
  /** URL segment under /logistics, and the audit entity name. */
  path: string;
  /** The grant every route of this master checks (module LOGISTICS), written out so the roles screen's coverage spec reads it. */
  permission: { moduleCode: 'LOGISTICS'; resource: string };
  label: string;
  table: AnyMySqlTable;
  idKey: string;
  /** Writable columns and how each is stored. Anything else in a request is ignored. */
  fields: Record<string, Kind>;
  problems: (values: Record<string, unknown>) => string[];
  /** Columns unique within a company, and the message when a second record repeats them. */
  unique?: { columns: string[]; message: string };
  references?: Reference[];
  display?: Display[];
  defaultSort: string;
  /** The record's own code, fixed once created (common/master-code.ts). */
  code?: string;
  /** Columns a list's ?search= matches (contains); a master with none ignores it. */
  search?: string[];
  /** Filters a list accepts as plain query parameters (e.g. ?vehicleId=). */
  filters?: Record<string, string>;
}

const S = schema;
const supplierName = (field: string, out: string): Display => ({ field, table: S.supplierMaster, idColumn: 'supplier_id', columns: { [`${out}_code`]: 'supplier_code', [`${out}_name`]: 'supplier_name' } });
const zoneName = (field: string, out: string): Display => ({ field, table: S.logisticsDeliveryZone, idColumn: 'zone_id', columns: { [`${out}_code`]: 'zone_code', [`${out}_name`]: 'zone_name' } });
const supplierRef = (field: string, label: string): Reference => ({ field, table: S.supplierMaster, idColumn: 'supplier_id', label });
const zoneRef = (field: string, label: string): Reference => ({ field, table: S.logisticsDeliveryZone, idColumn: 'zone_id', label });

export const LOGISTICS_MASTERS: LogisticsMaster[] = [
  {
    path: 'vehicle', permission: { moduleCode: 'LOGISTICS', resource: 'VEHICLE' }, label: 'Vehicle', table: S.logisticsVehicle, idKey: 'vehicle_id',
    fields: {
      registration_no: 'text', vehicle_type: 'text', ownership: 'text', carrier_supplier_id: 'id', home_farm_id: 'id',
      capacity_kg: 'decimal', capacity_head: 'int', capacity_bags: 'int', capacity_tonnes: 'decimal', compartments: 'int',
      odometer_km: 'decimal', remarks: 'text',
    },
    problems: vehicleProblems,
    unique: { columns: ['registration_no'], message: 'A vehicle with this registration already exists.' },
    references: [
      supplierRef('carrier_supplier_id', 'Carrier'),
      { field: 'home_farm_id', table: S.locationMaster, idColumn: 'location_id', label: 'Home Farm', where: { location_type: 'FARM' } },
    ],
    display: [
      supplierName('carrier_supplier_id', 'carrier'),
      { field: 'home_farm_id', table: S.locationMaster, idColumn: 'location_id', columns: { home_farm_code: 'location_code', home_farm_name: 'location_name' } },
    ],
    defaultSort: 'registration_no',
    search: ['registration_no'],
  },
  {
    path: 'vehicle-document', permission: { moduleCode: 'LOGISTICS', resource: 'VEHICLE' }, label: 'Vehicle Document', table: S.logisticsVehicleDocument, idKey: 'document_id',
    fields: { vehicle_id: 'id', document_type: 'text', document_no: 'text', issue_date: 'date', expiry_date: 'date', remarks: 'text' },
    problems: vehicleDocumentProblems,
    references: [{ field: 'vehicle_id', table: S.logisticsVehicle, idColumn: 'vehicle_id', label: 'Vehicle' }],
    display: [{ field: 'vehicle_id', table: S.logisticsVehicle, idColumn: 'vehicle_id', columns: { registration_no: 'registration_no' } }],
    defaultSort: 'expiry_date',
    search: ['document_no', 'document_type'],
    filters: { vehicleId: 'vehicle_id' },
  },
  {
    path: 'driver', permission: { moduleCode: 'LOGISTICS', resource: 'DRIVER' }, label: 'Driver', table: S.logisticsDriver, idKey: 'driver_id',
    fields: { driver_name: 'text', licence_no: 'text', licence_class: 'text', licence_expiry: 'date', mobile: 'text', remarks: 'text' },
    problems: driverProblems,
    unique: { columns: ['licence_no'], message: 'A driver with this licence number already exists.' },
    defaultSort: 'driver_name',
    search: ['driver_name', 'licence_no'],
  },
  {
    path: 'delivery-zone', permission: { moduleCode: 'LOGISTICS', resource: 'DELIVERY_ZONE' }, label: 'Delivery Zone', table: S.logisticsDeliveryZone, idKey: 'zone_id',
    fields: { zone_code: 'text', zone_name: 'text', zone_type: 'text', location_id: 'id', address: 'text', latitude: 'decimal', longitude: 'decimal', arrival_radius_m: 'int' },
    problems: zoneProblems,
    unique: { columns: ['zone_code'], message: 'A delivery zone with this code already exists.' },
    references: [{ field: 'location_id', table: S.locationMaster, idColumn: 'location_id', label: 'Location' }],
    display: [{ field: 'location_id', table: S.locationMaster, idColumn: 'location_id', columns: { location_code: 'location_code', location_name: 'location_name' } }],
    defaultSort: 'zone_code',
    code: 'zone_code',
    search: ['zone_code', 'zone_name'],
  },
  {
    path: 'route', permission: { moduleCode: 'LOGISTICS', resource: 'ROUTE' }, label: 'Route', table: S.logisticsRoute, idKey: 'route_id',
    fields: {
      route_code: 'text', from_zone_id: 'id', to_zone_id: 'id', distance_km: 'decimal', speed_kmh: 'decimal',
      loading_minutes: 'int', offloading_minutes: 'int', break_minutes: 'int', tolls: 'decimal', return_leg_charged: 'bool',
    },
    problems: routeProblems,
    unique: { columns: ['route_code'], message: 'A route with this code already exists.' },
    references: [zoneRef('from_zone_id', 'From Zone'), zoneRef('to_zone_id', 'To Zone')],
    display: [zoneName('from_zone_id', 'from_zone'), zoneName('to_zone_id', 'to_zone')],
    defaultSort: 'route_code',
    code: 'route_code',
    search: ['route_code'],
  },
  {
    path: 'route-stop', permission: { moduleCode: 'LOGISTICS', resource: 'ROUTE' }, label: 'Route Stop', table: S.logisticsRouteStop, idKey: 'stop_id',
    fields: { route_id: 'id', stop_seq: 'int', zone_id: 'id', distance_from_previous_km: 'decimal', stop_minutes: 'int' },
    problems: routeStopProblems,
    unique: { columns: ['route_id', 'stop_seq'], message: 'This route already has a stop with that number.' },
    references: [{ field: 'route_id', table: S.logisticsRoute, idColumn: 'route_id', label: 'Route' }, zoneRef('zone_id', 'Zone')],
    display: [{ field: 'route_id', table: S.logisticsRoute, idColumn: 'route_id', columns: { route_code: 'route_code' } }, zoneName('zone_id', 'zone')],
    defaultSort: 'stop_seq',
    filters: { routeId: 'route_id' },
  },
  {
    path: 'freight-rate', permission: { moduleCode: 'LOGISTICS', resource: 'FREIGHT_RATE' }, label: 'Freight Rate', table: S.logisticsFreightRate, idKey: 'rate_id',
    fields: {
      carrier_supplier_id: 'id', route_id: 'id', rate_basis: 'text', rate: 'decimal', minimum_charge: 'decimal',
      fuel_surcharge_pct: 'decimal', waiting_rate_per_hour: 'decimal', valid_from: 'date', valid_to: 'date',
    },
    problems: freightRateProblems,
    references: [supplierRef('carrier_supplier_id', 'Carrier'), { field: 'route_id', table: S.logisticsRoute, idColumn: 'route_id', label: 'Route' }],
    display: [supplierName('carrier_supplier_id', 'carrier'), { field: 'route_id', table: S.logisticsRoute, idColumn: 'route_id', columns: { route_code: 'route_code' } }],
    defaultSort: 'valid_from',
  },
  {
    path: 'service-plan', permission: { moduleCode: 'LOGISTICS', resource: 'SERVICE_PLAN' }, label: 'Service Plan', table: S.logisticsServicePlan, idKey: 'plan_id',
    fields: {
      plan_name: 'text', vehicle_id: 'id', vehicle_type: 'text', interval_km: 'decimal', interval_days: 'int',
      grace_km: 'decimal', grace_days: 'int', workshop_supplier_id: 'id',
    },
    problems: servicePlanProblems,
    references: [{ field: 'vehicle_id', table: S.logisticsVehicle, idColumn: 'vehicle_id', label: 'Vehicle' }, supplierRef('workshop_supplier_id', 'Workshop')],
    display: [{ field: 'vehicle_id', table: S.logisticsVehicle, idColumn: 'vehicle_id', columns: { registration_no: 'registration_no' } }, supplierName('workshop_supplier_id', 'workshop')],
    defaultSort: 'plan_name',
    search: ['plan_name'],
  },
  {
    path: 'setting', permission: { moduleCode: 'LOGISTICS', resource: 'SETTINGS' }, label: 'Logistics Settings', table: S.logisticsSetting, idKey: 'setting_id',
    fields: {
      capacity_warning_pct: 'decimal', cost_variance_pct: 'decimal', service_grace_days: 'int', pod_reminder_hours: 'int',
      freight_expense_account_id: 'id', maintenance_expense_account_id: 'id', paid_from_account_id: 'id', trip_required_to_ship: 'bool',
    },
    problems: settingProblems,
    unique: { columns: [], message: 'This company already has its Logistics Settings; edit them instead.' },
    references: [
      { field: 'freight_expense_account_id', table: S.glAccountMaster, idColumn: 'gl_account_id', label: 'Freight Expense Account' },
      { field: 'maintenance_expense_account_id', table: S.glAccountMaster, idColumn: 'gl_account_id', label: 'Maintenance Expense Account' },
      { field: 'paid_from_account_id', table: S.glAccountMaster, idColumn: 'gl_account_id', label: 'Paid From Account' },
    ],
    display: [
      { field: 'freight_expense_account_id', table: S.glAccountMaster, idColumn: 'gl_account_id', columns: { freight_expense_account: 'account_name' } },
      { field: 'maintenance_expense_account_id', table: S.glAccountMaster, idColumn: 'gl_account_id', columns: { maintenance_expense_account: 'account_name' } },
      { field: 'paid_from_account_id', table: S.glAccountMaster, idColumn: 'gl_account_id', columns: { paid_from_account: 'account_name' } },
    ],
    defaultSort: 'created_at',
  },
];

export const masterByPath = new Map(LOGISTICS_MASTERS.map((m) => [m.path, m]));
