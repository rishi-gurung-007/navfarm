import type { ReactNode } from "react";

/**
 * The page header — level 3 of the three navigation levels in apple.design.md
 * §10, and the single implementation of the content hierarchy in §9:
 *
 *   breadcrumb → title → description → actions → toolbar → work surface
 *
 * The breadcrumb is not a prop. It belongs to the same reading order but it is
 * derived from where the user is, not from what the page renders, so the shell
 * emits it once directly above this element (see `AppShell`). Keeping it there
 * means every route has exactly one breadcrumb landmark whether or not it has
 * been migrated, and no page can accidentally render a second one.
 *
 * This header lives inside `<main>`, not in the global chrome. It carries
 * `data-shell-region="page-header"`, so on desktop it pins to the top of the
 * main scroller under the Phase 1 geometry — the scroller is `<main>` itself
 * and nothing between them establishes a new overflow context, so
 * `position: sticky` resolves against the real scroller. Below the desktop
 * breakpoint the document scrolls and the global header and module index are
 * already pinned; a third pinned band there would eat the work surface, so the
 * header scrolls with the page instead.
 *
 * The API is deliberately small. Everything variable is a slot, so pages
 * compose rather than reach for another styling flag:
 *
 *   <PageHeader
 *     title={t("gSuppliers")}
 *     description={t("gSuppliersDesc")}
 *     actions={<Button>{t("gAddSupplier")}</Button>}
 *   />
 */
export interface PageHeaderProps {
  /** The page's H1. Exactly one per route — the shell renders no other. */
  title: ReactNode;
  /**
   * Accepted for compatibility and not shown: the app shows no description line under
   * a page title (13 Oct 2026). Callers may still pass one; it is ignored.
   */
  description?: ReactNode;
  /**
   * Primary page actions — Add, Create, Export. Shares the title row on
   * desktop and wraps below it when the row runs out of width.
   */
  actions?: ReactNode;
  /** Secondary metadata — counts, status, last-updated. Sits under the description. */
  meta?: ReactNode;
  /**
   * Optional controls row — search, filters, view options — below the heading
   * block. Use it when the controls belong to the page rather than to one
   * region inside it; controls that belong to a work surface stay with it.
   */
  toolbar?: ReactNode;
  /**
   * Pins the header to the top of the main scroller on desktop. Default. Turn
   * it off for pages whose first screen is short enough that pinning only
   * costs vertical space.
   */
  sticky?: boolean;
}

export function PageHeader({
  title,
  actions,
  meta,
  toolbar,
  sticky = true,
}: PageHeaderProps) {
  return (
    <header
      data-shell-region="page-header"
      data-sticky={sticky ? "true" : "false"}
      data-page-header
    >
      <div data-page-header-row>
        <div data-page-header-heading>
          <h1 className="nf-text-page-title" data-page-title>
            {title}
          </h1>
          {meta && <div data-page-header-meta>{meta}</div>}
        </div>
        {actions && <div data-page-header-actions>{actions}</div>}
      </div>
      {toolbar && <div data-page-header-toolbar>{toolbar}</div>}
    </header>
  );
}

export default PageHeader;
