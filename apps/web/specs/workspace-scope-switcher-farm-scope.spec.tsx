import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import WorkspaceScopeSwitcher from '../src/components/console/workspace-scope-switcher';
import { AUTH_STORAGE, api } from '../src/lib/api-client';

/**
 * I3: switching company (or operational area) left `active_farm_id` pinned
 * to whatever farm was selected under the previous company. apiRequest keeps
 * sending that stale value as x-active-farm-id on every request regardless
 * of company, and resolveFarmScope 403s the instant the farm no longer
 * belongs to the active company — so every farm-scoped screen breaks after a
 * company switch, with nothing on screen pointing at the farm as the cause.
 *
 * Before the fix, handleSelectCompany/handleSelectOperationalArea never
 * touched active_farm_id, so this test fails against the unfixed component:
 * 'farm-1' survives the switch to Company Two in localStorage.
 */
jest.mock('../src/lib/api-client', () => {
  const actual = jest.requireActual('../src/lib/api-client');
  return { ...actual, api: { get: jest.fn() } };
});
jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));

const get = api.get as jest.Mock;

describe('WorkspaceScopeSwitcher — switching company clears the pinned farm', () => {
  const originalLocation = window.location;

  beforeAll(() => {
    // The switcher navigates via `window.location.href = "/dashboard"` on
    // every selection; jsdom's real Location throws "not implemented:
    // navigation" for that, so it is replaced with a plain assignable stub.
    // @ts-expect-error - deliberately replacing jsdom's Location for the test
    delete window.location;
    // @ts-expect-error
    window.location = { href: '' };
  });

  afterAll(() => {
    window.location = originalLocation;
  });

  beforeEach(() => {
    localStorage.clear();
    get.mockReset();

    const user = {
      userId: 'u-1',
      email: 'admin@example.com',
      fullName: 'Company Admin',
      userType: 'COMPANY_ADMIN',
      companyId: 'co-1',
      tenantId: 'tenant-1',
      companies: [
        { company_id: 'co-1', company_name: 'Company One', is_primary: true },
        { company_id: 'co-2', company_name: 'Company Two', is_primary: false },
      ],
    };
    localStorage.setItem(AUTH_STORAGE.user, JSON.stringify(user));
    localStorage.setItem(AUTH_STORAGE.tenantId, 'tenant-1');
    localStorage.setItem('active_company_id', 'co-1');
    // The farm the user pinned while working under Company One.
    localStorage.setItem('active_farm_id', 'farm-1');

    get.mockImplementation(async (path: string) => {
      if (path.startsWith('/company/tenant/')) {
        return [
          { company_id: 'co-1', company_name: 'Company One' },
          { company_id: 'co-2', company_name: 'Company Two' },
        ];
      }
      if (path.startsWith('/operational-area')) return [];
      if (path.startsWith('/location?locationType=FARM')) {
        return { data: [{ location_id: 'farm-1', location_code: 'F1', location_name: 'Farm One' }] };
      }
      return [];
    });
  });

  it('clears active_farm_id when switching to a different company', async () => {
    render(<WorkspaceScopeSwitcher />);

    const trigger = await screen.findByRole('button', { name: 'wsSwitchScope' });
    fireEvent.click(trigger);

    const companyTwoButton = (await screen.findByText('Company Two')).closest('button')!;
    fireEvent.click(companyTwoButton);

    expect(localStorage.getItem('active_farm_id')).toBeNull();
    expect(localStorage.getItem('active_company_id')).toBe('co-2');
  });

  // F1: the picker fetched every farm regardless of state, so a retired farm
  // (FARM-001 sits at is_active=0) was offered as a choice, and pinning it
  // 403'd every farm-scoped request — which the screens then rendered as an
  // empty farm. The fetch must ask the API for active farms only.
  it('fetches only active farms for the picker', async () => {
    render(<WorkspaceScopeSwitcher />);

    await screen.findByRole('button', { name: 'wsSwitchScope' });

    const farmCall = get.mock.calls.map((c) => c[0] as string).find((p) => p.startsWith('/location?locationType=FARM'));
    expect(farmCall).toBeDefined();
    expect(farmCall).toContain('isActive=true');
  });

  // F3: the collapsed trigger never named the pinned farm, so a farm-filtered
  // screen read as "my data is gone" and there was no visible scope to leave.
  it('names the pinned farm on the collapsed trigger', async () => {
    render(<WorkspaceScopeSwitcher />);

    await screen.findByText('F1 — Farm One');
  });
});
