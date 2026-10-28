/**
 * Which permission each sidebar link needs, so the menu shows a user only what their role can open (Rishi, 20 Oct:
 * the menu offered every page of the workspace and the page then refused). Each entry names the grant the page's
 * own API reads (@RequirePermission on its controller); "any of" where the API accepts any of several.
 */
import { hasPermission } from '@/hooks/useAuth';

type Grant = readonly [moduleCode: string, resource: string];

/** Longest matching path wins; a query (?tab=) is matched exactly. A link with no entry needs no grant. */
const ROUTE_GRANTS: Array<[path: string, anyOf: Grant[]]> = [
  ['/batches', [['PRODUCTION', 'BATCH']]],
  ['/batches/animals', [['PIGGERY', 'ANIMAL']]],
  ['/batches/entry', [['PRODUCTION', 'BATCH_ENTRY']]],
  ['/batches/stages', [['PRODUCTION', 'STAGE']]],
  ['/schedulers', [['PRODUCTION', 'BATCH_SCHEDULE']]],
  ['/livestock', [['PIGGERY', 'ANIMAL']]],
  ['/inventory/balance', [['INVENTORY', 'LEDGER']]],
  ['/inventory/goods-receipt', [['INVENTORY', 'GOODS_RECEIPT']]],
  ['/inventory/transfers', [['INVENTORY', 'STOCK_TRANSFER']]],
  ['/inventory/stock-adjustment', [['INVENTORY', 'STOCK_ADJUSTMENT']]],
  ['/inventory/ledger', [['INVENTORY', 'LEDGER']]],
  ['/inventory/bio-asset-ledger', [['INVENTORY', 'BIO_ASSET_LEDGER']]],
  ['/inventory/feed-forecast', [['INVENTORY', 'LEDGER']]],
  [
    '/inventory/feed-forecast?tab=feed-requisition',
    [['PROCUREMENT', 'REQUISITION']],
  ],
  [
    '/inventory/feed-forecast?tab=mill-consolidation',
    [['PROCUREMENT', 'REQUISITION']],
  ],
  [
    '/inventory/feed-forecast?tab=loading-instructions',
    [['PROCUREMENT', 'REQUISITION']],
  ],
  [
    '/inventory/feed-forecast?tab=mill-production',
    [['INVENTORY', 'MILL_OUTPUT']],
  ],
  [
    '/inventory/feed-forecast?tab=physical-count',
    [['INVENTORY', 'STOCK_COUNT']],
  ],
  ['/requisitions', [['PROCUREMENT', 'REQUISITION']]],
  ['/finance', [['FINANCE', 'REPORTS']]],
  ['/finance/journal', [['FINANCE', 'JOURNAL']]],
  ['/expenses', [['FINANCE', 'EXPENSE']]],
  ['/reports/farrowing', [['REPORTS', 'FARROWING']]],
  [
    '/alerts',
    [
      ['PRODUCTION', 'BATCH'],
      ['INVENTORY', 'LEDGER'],
    ],
  ],
  [
    '/approvals',
    [
      ['PRODUCTION', 'APPROVAL'],
      ['PROCUREMENT', 'REQUISITION'],
    ],
  ],
  ['/traceability', [['PRODUCTION', 'QR_CODE']]],
  ['/operational-areas', [['MASTER_DATA', 'OPERATIONAL_AREA']]],
  ['/users', [['RBAC', 'USER']]],
  ['/roles', [['RBAC', 'ROLE']]],
  ['/notifications', [['NOTIFICATION', 'SETTINGS']]],
  ['/company/settings', [['COMPANY', 'SETTINGS']]],
  ['/settings/inventory-setup', [['MASTER_DATA', 'ITEM']]],
  ['/settings/parameters', [['PRODUCTION', 'PARAMETER']]],
  ['/settings/qc', [['PRODUCTION', 'QC_PARAMETER']]],
  ['/audit', [['AUDIT', 'LOGS']]],
];

/** Master-data screens whose grant is not MASTER_DATA/<KEY IN CAPITALS>. */
const MASTER_DATA_GRANTS: Record<string, Grant> = {
  stage: ['PRODUCTION', 'STAGE'],
  'number-series': ['SYSTEM', 'NUMBER_SERIES'],
  animal: ['PIGGERY', 'ANIMAL'],
  'alert-rule': ['NOTIFICATION', 'ALERT_RULE'],
};

export function grantsFor(href: string): Grant[] | null {
  const [path, query] = href.split('?');
  const master = /^\/master-data\/([^/?]+)/.exec(path);
  if (master) {
    const key = master[1];
    return [
      MASTER_DATA_GRANTS[key] ?? [
        'MASTER_DATA',
        key.toUpperCase().replace(/-/g, '_'),
      ],
    ];
  }
  if (query) {
    const exact = ROUTE_GRANTS.find(([route]) => route === href);
    if (exact) return exact[1];
  }
  let best: [string, Grant[]] | null = null;
  for (const entry of ROUTE_GRANTS) {
    const route = entry[0];
    if (route.includes('?')) continue;
    if (
      (path === route || path.startsWith(`${route}/`)) &&
      (!best || route.length > best[0].length)
    )
      best = entry;
  }
  return best ? best[1] : null;
}

type NavUser = Parameters<typeof hasPermission>[0];

export function canOpen(user: NavUser, href: string): boolean {
  const grants = grantsFor(href);
  return (
    !grants ||
    grants.some(([moduleCode, resource]) =>
      hasPermission(user, moduleCode, resource, 'can_view'),
    )
  );
}

interface NavChildLike {
  href: string;
}
interface NavItemLike {
  href: string;
  children?: NavChildLike[];
}

/**
 * The menu a user may open: children they cannot view are dropped; a group with none left is dropped; a group whose
 * own page they cannot open leads to its first child they can.
 */
export function filterNavByPermission<T extends NavItemLike>(
  items: T[],
  user: NavUser,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (!item.children?.length) {
      if (canOpen(user, item.href)) out.push(item);
      continue;
    }
    const children = item.children.filter((child) => canOpen(user, child.href));
    if (!children.length) continue;
    out.push({
      ...item,
      children,
      href: canOpen(user, item.href) ? item.href : children[0].href,
    });
  }
  return out;
}
