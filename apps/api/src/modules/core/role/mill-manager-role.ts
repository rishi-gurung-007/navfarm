/**
 * The Feed Mill Manager starter role (Rishi, 11 Oct; workbook Requisition sheet
 * r118: the Feed Mill Manager reviews and consolidates; the mill side also runs
 * loading, dispatch, production output and mill capacity).
 *
 * One definition shared by the new-company seed (default-role-seed.ts) and the
 * existing-company data script (scripts/seed-mill-manager-role.ts), so the two
 * cannot drift. Dependency-free on purpose: the script imports it under tsx.
 *
 * Every pair is one a @RequirePermission decorator enforces:
 *  - PROCUREMENT/REQUISITION  view + approve: feed-requisition.controller guards
 *    consolidations (eligible/create/review/finalize) and loading sheets
 *    (create/update) on 'approve', and lists/reads them on 'view'. No 'create':
 *    drafting and submitting a requisition is the farm's job. Note 'approve' on
 *    this resource is also what the farm-side approve/release routes read; those
 *    stay fenced by farm scope, not by this grant.
 *  - INVENTORY/STOCK_TRANSFER  view + create + edit: loading-sheet dispatch and
 *    the transfer shipment for feed are 'edit'. No delete.
 *  - INVENTORY/STOCK_COUNT     view + create + edit + approve: the mill's monthly
 *    stock take (feed-stock-count.controller; finalize is 'approve').
 *  - INVENTORY/MILL_OUTPUT     view + create: Mill Production Output — the feed the mill produced into a BIN
 *    (mill-output.controller; 20 Oct). No edit or delete: a posted output is corrected by a stock adjustment.
 *  - INVENTORY/LEDGER          view: feed forecast, feed plan, mill comparison and
 *    the in-app feed alerts all read INVENTORY/LEDGER 'view'.
 *  - MASTER_DATA/BIN_DIET_ASSIGNMENT view + create + edit: which feed each BIN takes on a
 *    production date, and so the mill's capacity per diet. No delete.
 *  - MASTER_DATA/<lookups>     view only, so the screens resolve items, warehouses,
 *    farms, UOMs and feed formulas by id.
 *  - COMPANY/SETTINGS          view, as the other starter roles.
 * Deliberately absent: master-data delete, user/role administration, FINANCE,
 * PROCUREMENT create, MASTER_DATA/LOCATION edit (feed-settings), ALERT_RULE.
 */
export const MILL_MANAGER_ROLE = {
  role_code: 'MILL_MANAGER',
  role_name: 'Feed Mill Manager',
  role_description:
    'Feed mill: consolidates approved demand, loading sheets and dispatch, production output, mill capacity and the mill stock take',
} as const;

export interface MillManagerGrant {
  module: string;
  resource: string;
  view?: boolean;
  create?: boolean;
  edit?: boolean;
  del?: boolean;
  approve?: boolean;
}

export const MILL_MANAGER_GRANTS: MillManagerGrant[] = [
  { module: 'PROCUREMENT', resource: 'REQUISITION', view: true, approve: true },
  {
    module: 'INVENTORY',
    resource: 'STOCK_TRANSFER',
    view: true,
    create: true,
    edit: true,
  },
  {
    module: 'INVENTORY',
    resource: 'STOCK_COUNT',
    view: true,
    create: true,
    edit: true,
    approve: true,
  },
  { module: 'INVENTORY', resource: 'MILL_OUTPUT', view: true, create: true },
  { module: 'INVENTORY', resource: 'LEDGER', view: true },
  {
    module: 'MASTER_DATA',
    resource: 'BIN_DIET_ASSIGNMENT',
    view: true,
    create: true,
    edit: true,
  },
  ...[
    'FARM',
    'FEED_FORMULA',
    'ITEM',
    'ITEM_CATEGORY',
    'ITEM_TYPE',
    'LOCATION',
    'UOM',
    'WAREHOUSE',
  ].map((resource): MillManagerGrant => ({
    module: 'MASTER_DATA',
    resource,
    view: true,
  })),
  { module: 'COMPANY', resource: 'SETTINGS', view: true },
];
