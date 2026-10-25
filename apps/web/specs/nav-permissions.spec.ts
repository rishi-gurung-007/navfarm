import {
  canOpen,
  filterNavByPermission,
  grantsFor,
} from '../src/utils/nav-permissions';

const user = (perms: Array<[string, string]>, userType = 'STANDARD_USER') =>
  ({
    userType,
    permissions: perms.map(([moduleCode, resource]) => ({
      moduleCode,
      resource,
      canView: true,
      canCreate: false,
      canEdit: false,
      canApprove: false,
    })),
  }) as any;

describe('menu by permission (20 Oct)', () => {
  it("maps a link to the grant its page's API reads, the longest path first and tabs exactly", () => {
    expect(grantsFor('/batches')).toEqual([['PRODUCTION', 'BATCH']]);
    expect(grantsFor('/batches/entry')).toEqual([
      ['PRODUCTION', 'BATCH_ENTRY'],
    ]);
    expect(grantsFor('/finance/journal')).toEqual([['FINANCE', 'JOURNAL']]);
    expect(grantsFor('/finance/trial-balance')).toEqual([
      ['FINANCE', 'REPORTS'],
    ]);
    expect(grantsFor('/inventory/feed-forecast?tab=mill-production')).toEqual([
      ['INVENTORY', 'MILL_OUTPUT'],
    ]);
    expect(grantsFor('/inventory/feed-forecast?tab=forecast')).toEqual([
      ['INVENTORY', 'LEDGER'],
    ]);
    expect(grantsFor('/master-data/kpi-metric')).toEqual([
      ['MASTER_DATA', 'KPI_METRIC'],
    ]);
    expect(grantsFor('/master-data/stage')).toEqual([['PRODUCTION', 'STAGE']]);
    expect(grantsFor('/dashboard')).toBeNull();
  });

  it('shows a storekeeper only the stores, and admins everything', () => {
    const storekeeper = user([
      ['INVENTORY', 'LEDGER'],
      ['INVENTORY', 'GOODS_RECEIPT'],
      ['MASTER_DATA', 'LOCATION'],
    ]);
    const nav = [
      { label: 'Dashboard', href: '/dashboard' },
      {
        label: 'Batches',
        href: '/batches',
        children: [{ href: '/batches' }, { href: '/batches/entry' }],
      },
      {
        label: 'Inventory',
        href: '/inventory/balance',
        children: [
          { href: '/inventory/balance' },
          { href: '/inventory/goods-receipt' },
          { href: '/inventory/bio-asset-ledger' },
        ],
      },
      {
        label: 'Finance',
        href: '/finance/journal',
        children: [
          { href: '/finance/journal' },
          { href: '/finance/trial-balance' },
        ],
      },
      {
        label: 'Master Data',
        href: '/master-data',
        children: [
          { href: '/master-data/location' },
          { href: '/master-data/breed' },
        ],
      },
    ];
    const shown = filterNavByPermission(nav, storekeeper);
    expect(shown.map((item) => item.label)).toEqual([
      'Dashboard',
      'Inventory',
      'Master Data',
    ]);
    expect(shown[1].children!.map((child) => child.href)).toEqual([
      '/inventory/balance',
      '/inventory/goods-receipt',
    ]);
    expect(shown[2].children!.map((child) => child.href)).toEqual([
      '/master-data/location',
    ]);
    expect(filterNavByPermission(nav, user([], 'TENANT_ADMIN'))).toHaveLength(
      nav.length,
    );
  });

  it('leads a group whose own page is closed to its first open child', () => {
    const accountant = user([['FINANCE', 'REPORTS']]);
    const [finance] = filterNavByPermission(
      [
        {
          href: '/finance/journal',
          children: [
            { href: '/finance/journal' },
            { href: '/finance/trial-balance' },
          ],
        },
      ],
      accountant,
    );
    expect(finance.href).toBe('/finance/trial-balance');
  });

  it('opens Approvals with either the approval or the requisition grant, as the API does', () => {
    expect(canOpen(user([['PROCUREMENT', 'REQUISITION']]), '/approvals')).toBe(
      true,
    );
    expect(canOpen(user([['PRODUCTION', 'APPROVAL']]), '/approvals')).toBe(
      true,
    );
    expect(canOpen(user([['INVENTORY', 'LEDGER']]), '/approvals')).toBe(false);
  });
});
