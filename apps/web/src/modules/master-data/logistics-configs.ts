import type { MasterDataConfig, SelectOption } from './types';

/**
 * Logistics Phase 1 masters (NAVFarm TDD: Logistics Module): the vehicles, drivers, zones, routes, rates and service
 * plans a trip is planned from. The API serves them at /logistics/<path>; they are listed in Farm Master (Rishi, 3 Nov).
 */

const opts = (values: string[]): SelectOption[] =>
  values.map((v) => ({ value: v, label: v.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }));
const VEHICLE_TYPES = opts(['LIVESTOCK', 'BULK_FEED', 'BAGGED_FEED']);
const OWNERSHIP = [
  { value: 'OWN', label: 'Own' },
  { value: 'HIRED', label: 'Hired' },
  { value: 'COLCOM_POOL', label: 'Colcom Pool' },
];
const labelsOf = (options: SelectOption[]): Record<string, string> => Object.fromEntries(options.map((o) => [o.value, o.label]));
const DOCUMENT_TYPES = opts(['INSURANCE', 'LICENCE', 'FITNESS', 'OTHER']);
const ZONE_TYPES = opts(['FARM', 'MILL', 'QUARANTINE', 'COLCOM', 'OTHER']);
const RATE_BASES = [
  { value: 'KM', label: 'Per KM' },
  { value: 'TONNE', label: 'Per Tonne' },
  { value: 'TONNE_KM', label: 'Per Tonne-KM' },
  { value: 'TRIP', label: 'Per Trip' },
  { value: 'HEAD', label: 'Per Head' },
];
const supplierLookup = { type: 'select-entity' as const, entityEndpoint: '/supplier?isActive=true', entityValueKey: 'supplier_id', entityLabelKeys: ['supplier_code', 'supplier_name'] };
const zoneLookup = { type: 'select-entity' as const, entityEndpoint: '/logistics/delivery-zone?isActive=true', entityValueKey: 'zone_id', entityLabelKeys: ['zone_code', 'zone_name'] };
const vehicleLookup = { type: 'select-entity' as const, entityEndpoint: '/logistics/vehicle?isActive=true', entityValueKey: 'vehicle_id', entityLabelKeys: ['registration_no'] };
const routeLookup = { type: 'select-entity' as const, entityEndpoint: '/logistics/route?isActive=true', entityValueKey: 'route_id', entityLabelKeys: ['route_code'] };
const glLookup = { type: 'select-entity' as const, entityEndpoint: '/gl-account', entityValueKey: 'gl_account_id', entityLabelKeys: ['account_code', 'account_name'] };
const company = { key: 'company_id', label: 'Company', type: 'text' as const, hideInForm: true };

const vehicle: MasterDataConfig = {
  key: 'vehicle',
  label: 'Vehicles',
  singular: 'Vehicle',
  apiBase: '/logistics/vehicle',
  idKey: 'vehicle_id',
  group: 'Logistics',
  isPrimary: true,
  businessAdminOnly: true,
  supportsRestore: true,
  description: 'Trucks a trip can use. The status is set by trips and maintenance, never by hand.',
  columns: [
    { key: 'registration_no', label: 'Registration No.' },
    { key: 'vehicle_type', label: 'Type', labels: labelsOf(VEHICLE_TYPES) },
    { key: 'ownership', label: 'Ownership', labels: labelsOf(OWNERSHIP) },
    { key: 'carrier_name', label: 'Carrier' },
    { key: 'home_farm_name', label: 'Home Farm' },
    { key: 'capacity_kg', label: 'Capacity KG' },
    { key: 'capacity_head', label: 'Capacity Head' },
    { key: 'status', label: 'Status', labels: labelsOf(opts(['AVAILABLE', 'RESERVED', 'IN_USE', 'IN_MAINTENANCE', 'BLOCKED'])) },
  ],
  fields: [
    company,
    { key: 'registration_no', label: 'Registration No.', type: 'text', required: true, maxLength: 30 },
    { key: 'vehicle_type', label: 'Vehicle Type', type: 'select', required: true, options: VEHICLE_TYPES },
    { key: 'ownership', label: 'Ownership', type: 'select', required: true, options: OWNERSHIP },
    { key: 'carrier_supplier_id', label: 'Carrier', ...supplierLookup, requiredWhen: { anyOf: [{ key: 'ownership', equals: 'HIRED' }] }, helpText: 'The haulier, from the Supplier master. Needed for a hired vehicle.' },
    { key: 'home_farm_id', label: 'Home Farm', type: 'select-entity', entityEndpoint: '/location?locationType=FARM&rootOnly=true&isActive=true', entityValueKey: 'location_id', entityLabelKeys: ['location_code', 'location_name'] },
    { key: 'capacity_kg', label: 'Capacity KG', type: 'number', helpText: 'Give at least one capacity: KG, head, bags or tonnes.' },
    { key: 'capacity_head', label: 'Capacity Head', type: 'number' },
    { key: 'capacity_bags', label: 'Capacity Bags', type: 'number' },
    { key: 'capacity_tonnes', label: 'Capacity Tonnes', type: 'number' },
    { key: 'compartments', label: 'Compartments', type: 'number' },
    { key: 'odometer_km', label: 'Odometer KM', type: 'number' },
    { key: 'remarks', label: 'Remarks', type: 'textarea' },
  ],
};

const vehicleDocument: MasterDataConfig = {
  key: 'vehicle-document',
  label: 'Vehicle Documents',
  singular: 'Vehicle Document',
  apiBase: '/logistics/vehicle-document',
  idKey: 'document_id',
  group: 'Logistics',
  tabOf: 'vehicle',
  tabLabel: 'Documents',
  businessAdminOnly: true,
  supportsRestore: true,
  description: 'Insurance, licence and fitness papers with their expiry. Expired insurance will block dispatch.',
  columns: [
    { key: 'registration_no', label: 'Vehicle' },
    { key: 'document_type', label: 'Document', labels: labelsOf(DOCUMENT_TYPES) },
    { key: 'document_no', label: 'Document No.' },
    { key: 'issue_date', label: 'Issue Date', format: 'date' },
    { key: 'expiry_date', label: 'Expiry Date', format: 'date' },
  ],
  fields: [
    company,
    { key: 'vehicle_id', label: 'Vehicle', required: true, ...vehicleLookup },
    { key: 'document_type', label: 'Document Type', type: 'select', required: true, options: DOCUMENT_TYPES },
    { key: 'document_no', label: 'Document No.', type: 'text', maxLength: 60 },
    { key: 'issue_date', label: 'Issue Date', type: 'date' },
    { key: 'expiry_date', label: 'Expiry Date', type: 'date', required: true },
    { key: 'remarks', label: 'Remarks', type: 'textarea' },
  ],
};

const driver: MasterDataConfig = {
  key: 'driver',
  label: 'Drivers',
  singular: 'Driver',
  apiBase: '/logistics/driver',
  idKey: 'driver_id',
  group: 'Logistics',
  isPrimary: true,
  businessAdminOnly: true,
  supportsRestore: true,
  description: 'Drivers a trip can be assigned. An expired licence or the wrong class will block assignment.',
  columns: [
    { key: 'driver_name', label: 'Name' },
    { key: 'licence_no', label: 'Licence No.' },
    { key: 'licence_class', label: 'Class' },
    { key: 'licence_expiry', label: 'Licence Expiry', format: 'date' },
    { key: 'mobile', label: 'Mobile' },
  ],
  fields: [
    company,
    { key: 'driver_name', label: 'Name', type: 'text', required: true, maxLength: 120 },
    { key: 'licence_no', label: 'Licence No.', type: 'text', required: true, maxLength: 40 },
    { key: 'licence_class', label: 'Licence Class', type: 'text', required: true, maxLength: 20 },
    { key: 'licence_expiry', label: 'Licence Expiry', type: 'date', required: true },
    { key: 'mobile', label: 'Mobile', type: 'text', maxLength: 30 },
    { key: 'remarks', label: 'Remarks', type: 'textarea' },
  ],
};

const deliveryZone: MasterDataConfig = {
  key: 'delivery-zone',
  label: 'Delivery Zones',
  singular: 'Delivery Zone',
  apiBase: '/logistics/delivery-zone',
  idKey: 'zone_id',
  group: 'Logistics',
  isPrimary: true,
  businessAdminOnly: true,
  supportsRestore: true,
  description: 'Every place a truck goes: farms, the feed mill, quarantine, Colcom.',
  columns: [
    { key: 'zone_code', label: 'Code' },
    { key: 'zone_name', label: 'Name' },
    { key: 'zone_type', label: 'Type', labels: labelsOf(ZONE_TYPES) },
    { key: 'location_name', label: 'Location' },
  ],
  fields: [
    company,
    { key: 'zone_code', label: 'Code', type: 'text', required: true, maxLength: 30, createOnly: true },
    { key: 'zone_name', label: 'Name', type: 'text', required: true, maxLength: 120 },
    { key: 'zone_type', label: 'Type', type: 'select', required: true, options: ZONE_TYPES },
    { key: 'location_id', label: 'Location', type: 'select-entity', entityEndpoint: '/location?isActive=true', entityValueKey: 'location_id', entityLabelKeys: ['location_code', 'location_name'], helpText: 'The farm, mill or quarantine location this zone is. Leave blank for a place outside NAVFarm, such as Colcom.' },
    { key: 'address', label: 'Address', type: 'textarea' },
    { key: 'latitude', label: 'Latitude', type: 'number' },
    { key: 'longitude', label: 'Longitude', type: 'number' },
    { key: 'arrival_radius_m', label: 'Arrival Radius (m)', type: 'number' },
  ],
};

const route: MasterDataConfig = {
  key: 'route',
  label: 'Routes',
  singular: 'Route',
  apiBase: '/logistics/route',
  idKey: 'route_id',
  group: 'Logistics',
  isPrimary: true,
  businessAdminOnly: true,
  supportsRestore: true,
  description: 'From one zone to another: the distance, speed and times a trip\'s ETA is worked out from.',
  columns: [
    { key: 'route_code', label: 'Code' },
    { key: 'from_zone_name', label: 'From' },
    { key: 'to_zone_name', label: 'To' },
    { key: 'distance_km', label: 'Distance KM' },
    { key: 'speed_kmh', label: 'Speed KM/H' },
    { key: 'tolls', label: 'Tolls' },
  ],
  fields: [
    company,
    { key: 'route_code', label: 'Code', type: 'text', required: true, maxLength: 30, createOnly: true },
    { key: 'from_zone_id', label: 'From Zone', required: true, ...zoneLookup },
    { key: 'to_zone_id', label: 'To Zone', required: true, ...zoneLookup },
    { key: 'distance_km', label: 'Distance KM', type: 'number', required: true },
    { key: 'speed_kmh', label: 'Standard Speed KM/H', type: 'number', required: true },
    { key: 'loading_minutes', label: 'Loading Minutes', type: 'number' },
    { key: 'offloading_minutes', label: 'Offloading Minutes', type: 'number' },
    { key: 'break_minutes', label: 'Break Minutes', type: 'number' },
    { key: 'tolls', label: 'Tolls', type: 'number' },
    { key: 'return_leg_charged', label: 'Return Leg Charged', type: 'boolean' },
  ],
};

const routeStop: MasterDataConfig = {
  key: 'route-stop',
  label: 'Route Stops',
  singular: 'Route Stop',
  apiBase: '/logistics/route-stop',
  idKey: 'stop_id',
  group: 'Logistics',
  tabOf: 'route',
  tabLabel: 'Stops',
  businessAdminOnly: true,
  supportsRestore: true,
  description: 'Extra drops on a multi-stop route, in order.',
  columns: [
    { key: 'route_code', label: 'Route' },
    { key: 'stop_seq', label: 'Stop No.' },
    { key: 'zone_name', label: 'Zone' },
    { key: 'distance_from_previous_km', label: 'KM from Previous' },
    { key: 'stop_minutes', label: 'Stop Minutes' },
  ],
  fields: [
    company,
    { key: 'route_id', label: 'Route', required: true, ...routeLookup },
    { key: 'stop_seq', label: 'Stop No.', type: 'number', required: true },
    { key: 'zone_id', label: 'Zone', required: true, ...zoneLookup },
    { key: 'distance_from_previous_km', label: 'KM from Previous Stop', type: 'number' },
    { key: 'stop_minutes', label: 'Stop Minutes', type: 'number' },
  ],
};

const freightRate: MasterDataConfig = {
  key: 'freight-rate',
  label: 'Freight Rates',
  singular: 'Freight Rate',
  apiBase: '/logistics/freight-rate',
  idKey: 'rate_id',
  group: 'Logistics',
  isPrimary: true,
  businessAdminOnly: true,
  supportsRestore: true,
  description: "A carrier's rate. Rates of one carrier, route and basis may not overlap in dates; Finance will approve them.",
  columns: [
    { key: 'carrier_name', label: 'Carrier' },
    { key: 'route_code', label: 'Route' },
    { key: 'rate_basis', label: 'Basis', labels: labelsOf(RATE_BASES) },
    { key: 'rate', label: 'Rate' },
    { key: 'valid_from', label: 'Valid From', format: 'date' },
    { key: 'valid_to', label: 'Valid To', format: 'date' },
    { key: 'approval_status', label: 'Approval', labels: labelsOf(opts(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'])) },
  ],
  fields: [
    company,
    { key: 'carrier_supplier_id', label: 'Carrier', required: true, ...supplierLookup },
    { key: 'route_id', label: 'Route', ...routeLookup, helpText: 'Leave blank for a rate that applies on any route.' },
    { key: 'rate_basis', label: 'Rate Basis', type: 'select', required: true, options: RATE_BASES },
    { key: 'rate', label: 'Rate', type: 'number', required: true },
    { key: 'minimum_charge', label: 'Minimum Charge', type: 'number' },
    { key: 'fuel_surcharge_pct', label: 'Fuel Surcharge %', type: 'number' },
    { key: 'waiting_rate_per_hour', label: 'Waiting Rate per Hour', type: 'number' },
    { key: 'valid_from', label: 'Valid From', type: 'date', required: true },
    { key: 'valid_to', label: 'Valid To', type: 'date', helpText: 'Leave blank for no end date.' },
  ],
};

const servicePlan: MasterDataConfig = {
  key: 'service-plan',
  label: 'Service Plans',
  singular: 'Service Plan',
  apiBase: '/logistics/service-plan',
  idKey: 'plan_id',
  group: 'Logistics',
  isPrimary: true,
  businessAdminOnly: true,
  supportsRestore: true,
  description: 'When a truck is due a service: every so many km and/or days, for one vehicle or a whole type.',
  columns: [
    { key: 'plan_name', label: 'Plan' },
    { key: 'registration_no', label: 'Vehicle' },
    { key: 'vehicle_type', label: 'Vehicle Type', labels: labelsOf(VEHICLE_TYPES) },
    { key: 'interval_km', label: 'Every KM' },
    { key: 'interval_days', label: 'Every Days' },
    { key: 'workshop_name', label: 'Workshop' },
  ],
  fields: [
    company,
    { key: 'plan_name', label: 'Plan Name', type: 'text', required: true, maxLength: 120 },
    { key: 'vehicle_id', label: 'Vehicle', ...vehicleLookup, helpText: 'Choose a vehicle, or a vehicle type for every truck of that type.' },
    { key: 'vehicle_type', label: 'Vehicle Type', type: 'select', options: VEHICLE_TYPES },
    { key: 'interval_km', label: 'Every KM', type: 'number' },
    { key: 'interval_days', label: 'Every Days', type: 'number' },
    { key: 'grace_km', label: 'Grace KM', type: 'number' },
    { key: 'grace_days', label: 'Grace Days', type: 'number' },
    { key: 'workshop_supplier_id', label: 'Workshop', ...supplierLookup },
  ],
};

const logisticsSetting: MasterDataConfig = {
  key: 'logistics-setting',
  label: 'Logistics Settings',
  singular: 'Logistics Settings',
  apiBase: '/logistics/setting',
  idKey: 'setting_id',
  group: 'Logistics',
  isPrimary: true,
  businessAdminOnly: true,
  supportsRestore: true,
  description: 'One record per company: the thresholds, the accounts trip and maintenance costs post to, and whether shipping needs a trip.',
  columns: [
    { key: 'capacity_warning_pct', label: 'Capacity Warning %' },
    { key: 'cost_variance_pct', label: 'Cost Variance %' },
    { key: 'service_grace_days', label: 'Service Grace Days' },
    { key: 'pod_reminder_hours', label: 'POD Reminder Hours' },
    { key: 'freight_expense_account', label: 'Freight Expense Account' },
    { key: 'trip_required_to_ship', label: 'Trip Required to Ship' },
  ],
  fields: [
    company,
    { key: 'capacity_warning_pct', label: 'Capacity Warning %', type: 'number', helpText: 'A load above this share of the truck warns; above 100 % is blocked. Default 95.' },
    { key: 'cost_variance_pct', label: 'Cost Variance %', type: 'number', helpText: 'A trip whose actual cost differs from its estimate by more goes to Finance before it closes. Default 10.' },
    { key: 'service_grace_days', label: 'Service Grace Days', type: 'number' },
    { key: 'pod_reminder_hours', label: 'POD Reminder Hours', type: 'number', helpText: 'Alert when a delivery has no proof of delivery after this many hours. Default 24.' },
    { key: 'freight_expense_account_id', label: 'Freight Expense Account', ...glLookup },
    { key: 'maintenance_expense_account_id', label: 'Maintenance Expense Account', ...glLookup },
    { key: 'paid_from_account_id', label: 'Paid From Account', ...glLookup },
    { key: 'trip_required_to_ship', label: 'Trip Required to Ship', type: 'boolean', helpText: 'Off until trips are in use: transfers ship as they do today.' },
  ],
};

export const LOGISTICS_CONFIGS: MasterDataConfig[] = [
  vehicle, vehicleDocument, driver, deliveryZone, route, routeStop, freightRate, servicePlan, logisticsSetting,
];

/** Each logistics master's grant: module LOGISTICS, the API controller's resource. */
export const LOGISTICS_GRANTS: Record<string, ['LOGISTICS', string]> = {
  vehicle: ['LOGISTICS', 'VEHICLE'],
  'vehicle-document': ['LOGISTICS', 'VEHICLE'],
  driver: ['LOGISTICS', 'DRIVER'],
  'delivery-zone': ['LOGISTICS', 'DELIVERY_ZONE'],
  route: ['LOGISTICS', 'ROUTE'],
  'route-stop': ['LOGISTICS', 'ROUTE'],
  'freight-rate': ['LOGISTICS', 'FREIGHT_RATE'],
  'service-plan': ['LOGISTICS', 'SERVICE_PLAN'],
  'logistics-setting': ['LOGISTICS', 'SETTINGS'],
};
