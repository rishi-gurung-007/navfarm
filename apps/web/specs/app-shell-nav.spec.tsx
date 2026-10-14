import React from 'react';
import { render, screen } from '@testing-library/react';
import { Layers } from 'lucide-react';
import { AppShell, type AppShellNavItem } from '../src/components/shell/AppShell';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

let mockPathname = '/batches';

// jsdom has no matchMedia; the shell uses it to collapse the mobile drawer.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
});

const NAV: AppShellNavItem[] = [
  {
    label: 'Batches',
    href: '/batches',
    icon: Layers,
    children: [
      { label: 'Batch List', href: '/batches' },
      { label: 'Batch Stages', href: '/batches/stages' },
    ],
  },
  { label: 'Schedulers', href: '/schedulers', icon: Layers },
  // Deep-links into its module. Every other page of the module is a sibling of
  // the href, not a descendant of it.
  { label: 'Inventory & Stock', href: '/inventory/balance', icon: Layers, activePrefix: '/inventory' },
  { label: 'Feed Forecast', href: '/inventory/feed-forecast', icon: Layers, activePrefix: '/inventory/feed-forecast' },
];

const ACTIVE_BG = 'bg-[var(--sidebar-active-bg)]';

function renderShell(pathname: string) {
  mockPathname = pathname;
  return render(
    <AppShell
      brandHref="/dashboard"
      brandSubtitle="Management console"
      navSectionLabel="Organization"
      navItems={NAV}
      pathname={pathname}
      userInitials="RV"
      onLogout={() => undefined}
      signOutLabel="Sign out"
      profileItems={[]}
      profileMenuLabel="Account menu"
      breadcrumbRoot="NAVFarm"
      breadcrumbCurrent="Piggery Area"
    >
      <div />
    </AppShell>
  );
}

describe('AppShell primary navigation', () => {
  it('gives a parent with children the active highlight when you are on its own page', () => {
    renderShell('/batches');
    const parents = screen.getAllByRole('button', { name: /Batches/ });
    expect(parents.some((b) => b.className.includes(ACTIVE_BG))).toBe(true);
  });

  it('keeps a module item active on a sibling page inside its module', () => {
    // /inventory/goods-receipt is not under /inventory/balance, so matching on
    // the href alone left the whole sidebar with nothing highlighted.
    renderShell('/inventory/goods-receipt');
    const links = screen.getAllByRole('link', { name: /Inventory & Stock/ });
    expect(links.some((a) => a.className.includes(ACTIVE_BG))).toBe(true);
  });

  it('still highlights a module item on its own landing page', () => {
    renderShell('/inventory/balance');
    const links = screen.getAllByRole('link', { name: /Inventory & Stock/ });
    expect(links.some((a) => a.className.includes(ACTIVE_BG))).toBe(true);
  });

  it('does not highlight a module item from an unrelated page', () => {
    renderShell('/schedulers');
    const links = screen.getAllByRole('link', { name: /Inventory & Stock/ });
    expect(links.some((a) => a.className.includes(ACTIVE_BG))).toBe(false);
  });

  it('still highlights a childless item on its own page', () => {
    renderShell('/schedulers');
    const links = screen.getAllByRole('link', { name: /Schedulers/ });
    expect(links.some((a) => a.className.includes(ACTIVE_BG))).toBe(true);
  });

  it('highlights a more specific sibling nav item without activating the broader prefix', () => {
    renderShell('/inventory/feed-forecast');
    const feedLinks = screen.getAllByRole('link', { name: /Feed Forecast/ });
    expect(feedLinks.some((a) => a.className.includes(ACTIVE_BG))).toBe(true);
    const invLinks = screen.getAllByRole('link', { name: /Inventory & Stock/ });
    expect(invLinks.some((a) => a.className.includes(ACTIVE_BG))).toBe(false);
  });
});
