import React from 'react';
import { render, screen } from '@testing-library/react';
import { hasPermission, NavUser } from '../src/hooks/useAuth';
import { InventoryPageShell } from '../src/components/console/inventory/inventory-page-shell';
import FeedForecastTabs from '../src/components/console/inventory/feed-forecast-tabs';

// Mock next/navigation
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockRouter = {
  replace: mockReplace,
  push: mockPush,
};
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

// Mock translations
jest.mock('../src/hooks/useLanguage', () => {
  const { translations } = jest.requireActual('../src/utils/translations');
  return {
    useLanguage: () => ({
      t: (key: string, params?: Record<string, string>) => {
        let val = (translations.en as any)[key] ?? key;
        if (params) {
          for (const [k, v] of Object.entries(params)) {
            val = val.replace(`{{${k}}}`, v);
          }
        }
        return val;
      },
      tLob: (lob: string) => lob,
    }),
  };
});

// Mock panel components mounted by FeedForecastTabs
jest.mock('../src/components/console/inventory/feed-forecast-panel', () => ({
  __esModule: true,
  default: () => <div data-testid="panel-forecast" />,
}));
jest.mock('../src/components/console/inventory/requisitions-panel', () => ({
  __esModule: true,
  FeedRequisitionPanel: () => <div data-testid="panel-requisition" />,
  default: () => <div data-testid="panel-requisition" />,
}));
jest.mock('../src/components/console/inventory/feed-stock-count-panel', () => ({
  __esModule: true,
  default: () => <div data-testid="panel-count" />,
}));

describe('hasPermission persona rules and constraints', () => {
  it('gives STANDARD_USER none of the privileged actions by user type alone', () => {
    const standardUser: NavUser = {
      userId: 'user-1',
      email: 'worker@farm.com',
      fullName: 'Farm Worker',
      userType: 'STANDARD_USER',
      permissions: [],
    };

    expect(hasPermission(standardUser, 'INVENTORY', 'STOCK_COUNT', 'can_view')).toBe(false);
    expect(hasPermission(standardUser, 'INVENTORY', 'STOCK_COUNT', 'can_create')).toBe(false);
    expect(hasPermission(standardUser, 'INVENTORY', 'STOCK_COUNT', 'can_edit')).toBe(false);
    expect(hasPermission(standardUser, 'INVENTORY', 'STOCK_COUNT', 'can_approve')).toBe(false);
    expect(hasPermission(standardUser, 'PROCUREMENT', 'REQUISITION', 'can_approve')).toBe(false);
    expect(hasPermission(standardUser, 'INVENTORY', 'STOCK_TRANSFER', 'can_edit')).toBe(false);
    expect(hasPermission(standardUser, 'FINANCE', 'STOCK_VARIANCE', 'can_approve')).toBe(false);
  });

  it('honours role grants assigned to a STANDARD_USER', () => {
    const operatorUser: NavUser = {
      userId: 'user-2',
      email: 'operator@farm.com',
      fullName: 'Feed Operator',
      userType: 'STANDARD_USER',
      permissions: [
        { moduleCode: 'INVENTORY', resource: 'STOCK_COUNT', canView: true, canCreate: true, canEdit: true },
        { moduleCode: 'INVENTORY', resource: 'STOCK_TRANSFER', canView: true, canCreate: true, canEdit: true },
        { moduleCode: 'PROCUREMENT', resource: 'REQUISITION', canView: true, canCreate: true, canEdit: false },
      ],
    };

    expect(hasPermission(operatorUser, 'INVENTORY', 'STOCK_COUNT', 'can_view')).toBe(true);
    expect(hasPermission(operatorUser, 'INVENTORY', 'STOCK_COUNT', 'can_create')).toBe(true);
    expect(hasPermission(operatorUser, 'INVENTORY', 'STOCK_COUNT', 'can_edit')).toBe(true);
    expect(hasPermission(operatorUser, 'INVENTORY', 'STOCK_COUNT', 'can_approve')).toBe(false);
    expect(hasPermission(operatorUser, 'INVENTORY', 'STOCK_TRANSFER', 'can_edit')).toBe(true);
    expect(hasPermission(operatorUser, 'PROCUREMENT', 'REQUISITION', 'can_approve')).toBe(false);
  });

  it('Head of Farms (OPERATIONAL_ADMIN) does not receive can_approve outside role permissions', () => {
    const headOfFarms: NavUser = {
      userId: 'user-3',
      email: 'hof@farm.com',
      fullName: 'Head of Farms',
      userType: 'OPERATIONAL_ADMIN',
      permissions: [],
    };

    // Receives operational edit/view by user type
    expect(hasPermission(headOfFarms, 'INVENTORY', 'STOCK_COUNT', 'can_view')).toBe(true);
    expect(hasPermission(headOfFarms, 'INVENTORY', 'STOCK_COUNT', 'can_edit')).toBe(true);
    // But approval stays an explicit role grant
    expect(hasPermission(headOfFarms, 'INVENTORY', 'STOCK_COUNT', 'can_approve')).toBe(false);
    expect(hasPermission(headOfFarms, 'PROCUREMENT', 'REQUISITION', 'can_approve')).toBe(false);
    expect(hasPermission(headOfFarms, 'FINANCE', 'STOCK_VARIANCE', 'can_approve')).toBe(false);
  });

  it('admin user types bypass permissions unconditionally', () => {
    for (const adminType of ['COMPANY_ADMIN', 'TENANT_ADMIN', 'SYSTEM_ADMIN'] as const) {
      const admin: NavUser = {
        userId: 'admin-1',
        email: 'admin@farm.com',
        fullName: 'Admin User',
        userType: adminType,
        permissions: [],
      };
      expect(hasPermission(admin, 'INVENTORY', 'STOCK_COUNT', 'can_approve')).toBe(true);
      expect(hasPermission(admin, 'PROCUREMENT', 'REQUISITION', 'can_approve')).toBe(true);
      expect(hasPermission(admin, 'FINANCE', 'STOCK_VARIANCE', 'can_approve')).toBe(true);
    }
  });
});

describe('InventoryPageShell persona visibility', () => {
  beforeEach(() => {
    localStorage.clear();
    mockReplace.mockReset();
    mockPush.mockReset();
  });

  it('renders Access Denied for a STANDARD_USER with no inventory permissions', () => {
    const user: NavUser = {
      userId: 'u1',
      email: 'nobody@farm.com',
      fullName: 'No Perms',
      userType: 'STANDARD_USER',
      permissions: [],
    };
    localStorage.setItem('navfarm_auth_user', JSON.stringify(user));

    render(
      <InventoryPageShell activeKey="feed-forecast">
        <div data-testid="inventory-content">Secret Content</div>
      </InventoryPageShell>,
    );

    expect(screen.queryByTestId('inventory-content')).toBeNull();
    expect(screen.getByText("You don't have access to Inventory")).toBeTruthy();
  });

  it('allows access to InventoryPageShell for a user with INVENTORY/STOCK_COUNT permission', () => {
    const user: NavUser = {
      userId: 'u2',
      email: 'feed@farm.com',
      fullName: 'Feed Guy',
      userType: 'STANDARD_USER',
      permissions: [
        { moduleCode: 'INVENTORY', resource: 'STOCK_COUNT', canView: true, canCreate: true, canEdit: true },
      ],
    };
    localStorage.setItem('navfarm_auth_user', JSON.stringify(user));

    render(
      <InventoryPageShell activeKey="feed-forecast">
        <div data-testid="inventory-content">Feed Content</div>
      </InventoryPageShell>,
    );

    expect(screen.getByTestId('inventory-content')).toBeTruthy();
  });
});

describe('FeedForecastTabs navigation copy', () => {
  it('displays the Feed Requisition tab as Internal Feed Transfer', () => {
    render(<FeedForecastTabs tab="feed-requisition" onTabChange={() => undefined} />);
    const tabList = screen.getByRole('tablist');
    const tabTexts = Array.from(tabList.querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabTexts).toContain('Internal Feed Transfer');
  });
});
