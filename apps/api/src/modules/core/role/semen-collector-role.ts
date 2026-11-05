/**
 * The Semen Collector starter role: the AI Station technician who is named on a collection plan and records a collection.
 * Collectors are users who hold this role (decisions, 4 Nov 2026). The grants are a starting point: a company opens
 * Roles and adds or removes what it wants; nothing here is enforced beyond the permission the screens already check.
 *
 *  - PIGGERY/ANIMAL view + create + edit: the AI Station screens (Boar Selection, plans, Semen Collection) read on 'view',
 *    record a collection on 'create' and change a plan on 'edit'. No delete.
 *  - MASTER_DATA/BREEDING_LINE_SETUP, GENETIC_LEVEL_BAND, BCS_SCALE  view: the line rules those screens apply.
 *  - MASTER_DATA/<lookups> view: breeds, items, farms, sheds and the like, which the forms resolve by id.
 *  - PRODUCTION/BATCH view and INVENTORY/LEDGER view: the batch picker and the semen stock a collection posts to.
 *  - COMPANY/SETTINGS view, as the other starter roles.
 * Deliberately absent: any master-data write, FINANCE, user and role administration.
 */
export const SEMEN_COLLECTOR_ROLE = {
  role_code: 'SEMEN_COLLECTOR',
  role_name: 'Semen Collector',
  role_description: 'Collects semen at the AI Station; can be named on a collection plan and record a collection',
} as const;

export interface SemenCollectorGrant {
  module: string;
  resource: string;
  view?: boolean;
  create?: boolean;
  edit?: boolean;
}

const LOOKUPS = ['BREED', 'ITEM', 'ITEM_CATEGORY', 'ITEM_TYPE', 'FARM', 'LOCATION', 'SHED', 'SPECIES', 'UOM', 'WAREHOUSE'];

export const SEMEN_COLLECTOR_GRANTS: SemenCollectorGrant[] = [
  { module: 'PIGGERY', resource: 'ANIMAL', view: true, create: true, edit: true },
  { module: 'MASTER_DATA', resource: 'BREEDING_LINE_SETUP', view: true },
  { module: 'MASTER_DATA', resource: 'GENETIC_LEVEL_BAND', view: true },
  { module: 'MASTER_DATA', resource: 'BCS_SCALE', view: true },
  ...LOOKUPS.map((resource) => ({ module: 'MASTER_DATA', resource, view: true })),
  { module: 'PRODUCTION', resource: 'BATCH', view: true },
  { module: 'INVENTORY', resource: 'LEDGER', view: true },
  { module: 'COMPANY', resource: 'SETTINGS', view: true },
];
