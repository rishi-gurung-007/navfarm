"use client";

import { useState } from "react";
import { Boxes, Database, Landmark, LayoutDashboard, Sprout, Users } from "lucide-react";
import { AppShell } from "../../../components/shell/AppShell";
import { Dialog } from "../../../components/ui/dialog";
import { Drawer } from "../../../components/ui/drawer";
import { Popover } from "../../../components/ui/popover";
import { Menu, MenuItem } from "../../../components/ui/menu";
import { PageHeader } from "../../../components/ui/PageHeader";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dev/shell-harness", icon: LayoutDashboard },
  { label: "Master Data", href: "/dev/shell-harness/master-data", icon: Database },
  { label: "Inventory", href: "/dev/shell-harness/inventory", icon: Boxes },
  { label: "Finance", href: "/dev/shell-harness/finance", icon: Landmark },
  { label: "Production", href: "/dev/shell-harness/production", icon: Sprout },
  { label: "Team Management", href: "/dev/shell-harness/users", icon: Users },
];

/** Long enough that the column must scroll on its own at every test viewport. */
const CONTEXT_ITEMS = Array.from({ length: 40 }, (_, i) => `Context entry ${i + 1}`);

/** Long enough that the content region must scroll on its own. */
const CONTENT_ROWS = Array.from({ length: 60 }, (_, i) => i + 1);

export function ShellHarness({ withContextNav }: { withContextNav: boolean }) {
  // The other half of the overlay taxonomy. The fixture carries a Dialog so the
  // browser suite can prove the distinction Phase 2 rests on: a popover leaves
  // the page live, a dialog blocks it and takes the shared scroll lock.
  const [dialogOpen, setDialogOpen] = useState(false);

  // Phase 5. The fixture carries the drawer at both width tiers, plus the three
  // nesting cases the taxonomy rules on: a Dialog inside a Drawer (allowed), a
  // Popover inside a Drawer (allowed), and a second Drawer inside a Drawer
  // (forbidden, and refused by the component rather than by convention).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [largeDrawerOpen, setLargeDrawerOpen] = useState(false);
  const [drawerDialogOpen, setDrawerDialogOpen] = useState(false);
  const [drawerPopoverOpen, setDrawerPopoverOpen] = useState(false);
  const [nestedDrawerOpen, setNestedDrawerOpen] = useState(false);

  const contextNav = (
    <div className="p-3" data-testid="harness-context-nav">
      <p className="px-2 pb-2 text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">Section</p>
      <ul className="space-y-0.5">
        {CONTEXT_ITEMS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              data-testid={index === CONTEXT_ITEMS.length - 1 ? "harness-context-last" : undefined}
              className="w-full rounded-[var(--radius-sm)] px-2 py-2 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
            >
              {label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <AppShell
      brandHref="/dev/shell-harness"
      brandSubtitle="Shell harness"
      navSectionLabel="Organization"
      navItems={NAV_ITEMS}
      pathname="/dev/shell-harness"
      userInitials="SH"
      userName="Shell Harness"
      userEmail="harness@navfarm.test"
      onLogout={() => undefined}
      signOutLabel="Sign out"
      profileItems={[{ label: "Account" }, { label: "Preferences" }, { label: "Settings" }]}
      profileMenuLabel="Account menu"
      contextNav={withContextNav ? contextNav : undefined}
    >
      {/* The page header is page content now, so the fixture renders it the
          way a real route does: inside the page container, above the work
          surface. Same gutter as the content below it. */}
      <div className="mx-auto max-w-7xl px-4 pb-4 sm:px-6 sm:pb-6 lg:px-7 lg:pb-7">
        <PageHeader
          title="Shell geometry"
          description="Fixture route for shell layout tests."
          actions={
            <button
              type="button"
              data-testid="harness-page-action"
              className="nf-press min-h-11 rounded-[var(--radius-sm)] border border-[var(--border)] px-4 text-sm text-[var(--text-primary)]"
            >
              Page action
            </button>
          }
        />

        <div data-testid="harness-content">
          <button
            type="button"
            data-testid="harness-dialog-trigger"
            onClick={() => setDialogOpen(true)}
            className="nf-press mb-4 min-h-11 rounded-[var(--radius-sm)] border border-[var(--border)] px-4 text-sm text-[var(--text-primary)]"
          >
            Open dialog
          </button>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="Harness dialog"
            description="Fixture dialog for overlay taxonomy tests."
          >
            <button type="button" data-testid="harness-dialog-body-action" className="min-h-11">
              Dialog action
            </button>
          </Dialog>

          <button
            type="button"
            data-testid="harness-drawer-trigger"
            onClick={() => setDrawerOpen(true)}
            className="nf-press mb-4 ml-3 min-h-11 rounded-[var(--radius-sm)] border border-[var(--border)] px-4 text-sm text-[var(--text-primary)]"
          >
            Open drawer
          </button>
          <button
            type="button"
            data-testid="harness-drawer-lg-trigger"
            onClick={() => setLargeDrawerOpen(true)}
            className="nf-press mb-4 ml-3 min-h-11 rounded-[var(--radius-sm)] border border-[var(--border)] px-4 text-sm text-[var(--text-primary)]"
          >
            Open large drawer
          </button>

          <Drawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            title="Harness drawer"
            description="Fixture drawer for overlay taxonomy tests."
            footer={
              <button type="button" data-testid="harness-drawer-footer-action" className="min-h-11">
                Save
              </button>
            }
          >
            <button type="button" data-testid="harness-drawer-body-action" className="min-h-11">
              Drawer action
            </button>

            {/* Allowed: a drawer may raise a dialog for a confirmation. */}
            <button
              type="button"
              data-testid="harness-drawer-dialog-trigger"
              onClick={() => setDrawerDialogOpen(true)}
              className="ml-3 min-h-11"
            >
              Confirm inside drawer
            </button>
            <Dialog
              open={drawerDialogOpen}
              onClose={() => setDrawerDialogOpen(false)}
              title="Nested dialog"
              description="A drawer may contain a dialog."
            >
              <button type="button" data-testid="harness-drawer-dialog-action" className="min-h-11">
                Nested dialog action
              </button>
            </Dialog>

            {/* Allowed: a lightweight anchored choice inside the drawer. */}
            <div className="mt-3">
              <Popover
                open={drawerPopoverOpen}
                onOpenChange={setDrawerPopoverOpen}
                align="start"
                haspopup="menu"
                trigger={(props) => (
                  <button {...props} data-testid="harness-drawer-popover-trigger" className="min-h-11">
                    Choices
                  </button>
                )}
              >
                <Menu label="Drawer choices">
                  <MenuItem onSelect={() => setDrawerPopoverOpen(false)}>First choice</MenuItem>
                  <MenuItem onSelect={() => setDrawerPopoverOpen(false)}>Second choice</MenuItem>
                </Menu>
              </Popover>
            </div>

            {/* Forbidden: the component refuses to stack, so this renders
                nothing however hard the fixture tries. */}
            <button
              type="button"
              data-testid="harness-nested-drawer-trigger"
              onClick={() => setNestedDrawerOpen(true)}
              className="mt-3 min-h-11"
            >
              Attempt nested drawer
            </button>
            <Drawer
              open={nestedDrawerOpen}
              onClose={() => setNestedDrawerOpen(false)}
              title="Nested drawer"
            >
              <button type="button" data-testid="harness-nested-drawer-body">Should never render</button>
            </Drawer>

            {/* Long enough that the drawer body must scroll on its own. */}
            {CONTENT_ROWS.map((row) => (
              <p
                key={row}
                data-testid={row === CONTENT_ROWS.length ? "harness-drawer-last" : undefined}
                className="border-b border-[var(--border-subtle)] py-6 text-sm text-[var(--text-secondary)]"
              >
                Drawer row {row}
              </p>
            ))}
          </Drawer>

          <Drawer
            open={largeDrawerOpen}
            onClose={() => setLargeDrawerOpen(false)}
            title="Harness large drawer"
            size="lg"
          >
            <button type="button" data-testid="harness-drawer-lg-body-action" className="min-h-11">
              Large drawer action
            </button>
          </Drawer>

          {CONTENT_ROWS.map((row) => (
            <p
              key={row}
              data-testid={row === CONTENT_ROWS.length ? "harness-content-last" : undefined}
              className="border-b border-[var(--border-subtle)] py-6 text-sm text-[var(--text-secondary)]"
            >
              Content row {row}
            </p>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
