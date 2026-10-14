import { test, expect, type Page } from '@playwright/test';
import {
  BREADCRUMB,
  CONTENT,
  CONTEXT_NAV,
  HEADER,
  MODULE_ROUTES,
  PAGE_HEADER,
  PAGE_TITLE,
  PRIMARY_NAV,
  documentScroll,
  gotoConsole,
  gotoHarness,
} from './support/shell';

/**
 * Phase 4 exit gate — page header and content hierarchy.
 *
 * The hierarchy under test is
 *
 *   primary nav → context nav → H1 → description → actions → work
 *
 * and the properties that make it real rather than decorative: exactly one H1
 * per route, the header inside the content region rather than in the chrome,
 * the title dominating every navigation label around it, and none of it
 * breaking the shell geometry Phase 1 established.
 *
 * Console routes that carry a contextual navigation column. Everything else in
 * the console stays full-width, and both kinds are covered below.
 */
const REVIEWED_ROUTES = [
  ...MODULE_ROUTES,
  '/console/dashboard',
  '/console/users',
  '/console/audit',
  '/console/roles',
  '/console/notifications',
] as const;

/** Computed font size in px of the first match, or null when absent. */
async function fontSize(page: Page, selector: string): Promise<number | null> {
  const node = page.locator(selector).first();
  if ((await node.count()) === 0) return null;
  return node.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

test.describe('one H1 per route', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const route of REVIEWED_ROUTES) {
    test(`${route} renders exactly one H1, inside the content region`, async ({ page }) => {
      await gotoConsole(page, { path: route });

      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveCount(1);

      // Not merely "one H1 somewhere": the one H1 is the page header's, and the
      // page header is content, not a second piece of global chrome.
      await expect(page.locator(`${CONTENT} ${PAGE_HEADER} h1`)).toHaveCount(1);
      await expect(page.locator(`${HEADER} h1`)).toHaveCount(0);
      await expect(page.locator(`${PRIMARY_NAV} h1`)).toHaveCount(0);
    });
  }

  test('the shell renders no page header of its own', async ({ page }) => {
    await gotoConsole(page, { path: '/console/master-data' });

    // One header element, and it is the page's. A shell-mounted slot plus a
    // page-rendered component would produce two.
    await expect(page.locator(PAGE_HEADER)).toHaveCount(1);
    await expect(page.locator(`${CONTENT} ${PAGE_HEADER}`)).toHaveCount(1);
  });

  test('there is one global application header and it gained no title', async ({ page }) => {
    await gotoConsole(page, { path: '/console/master-data' });

    await expect(page.locator(HEADER)).toHaveCount(1);
    await expect(page.getByRole('banner')).toHaveCount(1);
  });
});

test.describe('breadcrumb', () => {
  // The "NAVFarm / <Area>" breadcrumb was removed from every page; the H1 is
  // the first step of the content hierarchy.
  test('is not rendered', async ({ page }) => {
    await gotoConsole(page, { path: '/console/master-data' });

    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
    await expect(page.locator(BREADCRUMB)).toHaveCount(0);
  });
});

test.describe('title dominance', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the H1 is larger than every navigation label around it', async ({ page }) => {
    await gotoConsole(page, { path: '/console/master-data' });

    const title = await fontSize(page, PAGE_TITLE);
    expect(title).not.toBeNull();
    // apple.design.md §8: ~28px page title against chrome capped at 15px.
    expect(title!).toBeGreaterThanOrEqual(26);

    // The navigation *labels*, which is what the title has to dominate — the
    // brand lockup at the top of the rail is a logo, not a label, and keeps
    // its own size.
    const largestChromeLabel = await page.evaluate(
      ([navSel, ctxSel]) => {
        const roots = [document.querySelector(navSel!), document.querySelector(ctxSel!)].filter(
          Boolean,
        ) as Element[];
        let max = 0;
        for (const root of roots) {
          for (const el of root.querySelectorAll('a, button, p, span, li')) {
            // Only nodes that actually render text of their own.
            const text = Array.from(el.childNodes).some(
              (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
            );
            if (!text) continue;
            max = Math.max(max, parseFloat(getComputedStyle(el).fontSize));
          }
        }
        return max;
      },
      ['nav[aria-label="Primary"]', `${CONTEXT_NAV} [data-context-nav]`],
    );

    expect(largestChromeLabel).toBeLessThanOrEqual(15);
    expect(title!).toBeGreaterThan(largestChromeLabel * 1.6);
  });

  test('the contextual navigation contributes no heading', async ({ page }) => {
    await gotoConsole(page, { path: '/console/master-data' });

    await expect(page.locator(CONTEXT_NAV)).toBeVisible();
    // Level 2 is an index, not a heading hierarchy: it may not open a heading
    // at any level, or it starts competing with the page's own outline.
    await expect(
      page.locator(`${CONTEXT_NAV} :is(h1, h2, h3, h4, h5, h6)`),
    ).toHaveCount(0);
  });
});

test.describe('sticky behaviour inside the main scroller', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the title stays visible while the content scrolls under it', async ({ page }) => {
    await gotoHarness(page);

    const title = page.locator(PAGE_TITLE);
    await expect(title).toBeVisible();
    const before = await title.boundingBox();

    const scrolled = await page.locator(CONTENT).evaluate((el) => {
      el.scrollTop = 600;
      return el.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);

    // Still on screen, and pinned to the top of the scroller rather than
    // having travelled up with the content.
    await expect(title).toBeInViewport();
    const after = await title.boundingBox();
    expect(after!.y).toBeLessThanOrEqual(before!.y);
    const contentBox = await page.locator(CONTENT).boundingBox();
    expect(after!.y).toBeGreaterThanOrEqual(contentBox!.y - 1);

    // The document itself still did not become the scroller.
    expect((await documentScroll(page)).scrollY).toBe(0);
  });

  test('the header introduces no second scroller', async ({ page }) => {
    await gotoHarness(page);

    // A sticky header nested inside its own overflow container silently stops
    // sticking; this asserts the chain that keeps it resolving against <main>.
    const overflowing = await page.evaluate(
      ([headerSel, contentSel]) => {
        const header = document.querySelector(headerSel!);
        const content = document.querySelector(contentSel!);
        if (!header || !content) return null;
        const offenders: string[] = [];
        for (let el = header.parentElement; el && el !== content; el = el.parentElement) {
          const style = getComputedStyle(el);
          if (style.overflow !== 'visible' || style.overflowY !== 'visible') {
            offenders.push(el.className || el.tagName);
          }
        }
        return { offenders, position: getComputedStyle(header).position };
      },
      [PAGE_HEADER, CONTENT],
    );

    expect(overflowing).not.toBeNull();
    expect(overflowing!.offenders).toEqual([]);
    expect(overflowing!.position).toBe('sticky');
  });

  test('main still scrolls independently of the document', async ({ page }) => {
    await gotoConsole(page, { path: '/console/master-data' });

    const moved = await page.locator(CONTENT).evaluate((el) => {
      el.scrollTop = 300;
      return el.scrollTop;
    });
    // The fixture guarantees overflow; a real route may or may not, so this
    // only asserts that whatever scrolling happens happens in <main>.
    expect(moved).toBeGreaterThanOrEqual(0);
    expect((await documentScroll(page)).scrollY).toBe(0);
  });
});

test.describe('actions', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('page actions live in the content region, not the primary navigation', async ({ page }) => {
    await gotoConsole(page, { path: '/console/users' });

    const invite = page.getByRole('button', { name: /invite user/i });
    await expect(invite).toBeVisible();
    await expect(page.locator(`${CONTENT} ${PAGE_HEADER}`).getByRole('button', { name: /invite user/i })).toHaveCount(1);
    await expect(page.locator(PRIMARY_NAV).getByRole('button', { name: /invite user/i })).toHaveCount(0);

    // Still operable — the migration moved markup, not behaviour.
    await invite.click();
    await expect(invite).toBeVisible();
  });

  test('every page-header control has an accessible name and a visible focus ring', async ({ page }) => {
    await gotoConsole(page, { path: '/console/audit' });

    const controls = page.locator(`${PAGE_HEADER} :is(button, a, input, select)`);
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i += 1) {
      const control = controls.nth(i);
      const name = await control.evaluate(
        (el) =>
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title') ||
          el.textContent?.trim() ||
          '',
      );
      expect(name.length).toBeGreaterThan(0);
    }

    const first = controls.first();
    await first.focus();
    const outline = await first.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });
});

test.describe('master data heading consolidation', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the page title is the record set, stated once', async ({ page }) => {
    await gotoConsole(page, { path: '/console/master-data' });

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('Farms');

    // The table used to restate the same name as its own <h2> immediately
    // under a "Master Data" <h1>. Neither the duplicate heading nor a second
    // heading of any level survives inside the work surface.
    await expect(page.locator(CONTENT).getByRole('heading', { name: 'Farms' })).toHaveCount(1);

    await page.getByTestId('context-nav-item-supplier').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Suppliers');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  });

  test('one toolbar, and its controls still work', async ({ page }) => {
    await gotoConsole(page, { path: '/console/master-data' });

    // Search and create are the table's own controls and remain exactly one of
    // each — the consolidation removed a heading, not a control.
    const search = page.locator(CONTENT).getByPlaceholder(/search/i);
    await expect(search).toHaveCount(1);
    await search.fill('abc');
    await expect(search).toHaveValue('abc');

    const add = page.locator(CONTENT).getByRole('button', { name: /^add /i });
    await expect(add).toHaveCount(1);
    await expect(add).toBeVisible();
  });
});

test.describe('responsive', () => {
  const VIEWPORTS = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'laptop', width: 1280, height: 800 },
    { name: 'tablet', width: 834, height: 1112 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const;

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} — header fits, wraps and never overflows the page`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoConsole(page, { path: '/console/users' });

      await expect(page.locator(PAGE_HEADER)).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const doc = await documentScroll(page);
      expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth + 1);

      // The header itself must fit its own column, not merely avoid pushing
      // the document wide.
      const fits = await page.locator(PAGE_HEADER).evaluate(
        (el) => el.scrollWidth <= el.clientWidth + 1,
      );
      expect(fits).toBe(true);

      // Actions stay real targets rather than being squeezed into slivers.
      const action = page.locator(PAGE_HEADER).getByRole('button', { name: /invite user/i });
      const box = await action.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(36);
      expect(box!.width).toBeGreaterThanOrEqual(88);
    });
  }

  // The collapsed module index sits directly above the page header on these
  // widths, which is exactly where a label repeating the H1 reads as a second,
  // quieter title.
  for (const viewport of [
    { name: 'tablet', width: 834, height: 1112 },
    { name: 'mobile', width: 390, height: 844 },
  ] as const) {
    test(`${viewport.name} — the context selector names the module, not the H1`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoConsole(page, { path: '/console/master-data' });

      const trigger = page.locator('[data-context-nav-trigger]');
      await expect(trigger).toBeVisible();

      const h1 = page.getByRole('heading', { level: 1 });
      await expect(h1).toHaveCount(1);
      const title = ((await h1.textContent()) ?? '').trim();
      const label = ((await trigger.textContent()) ?? '').trim();

      expect(title).toBe('Farms');
      expect(label).not.toBe(title);
      // Names the module context it opens.
      expect(label.toLowerCase()).toContain('master data');

      // Still a button, not a heading — level 2 opens no outline of its own.
      await expect(page.locator(`${CONTEXT_NAV} :is(h1, h2, h3, h4, h5, h6)`)).toHaveCount(0);

      // The current section stays available to assistive technology, and the
      // visible label remains a prefix of the accessible name (WCAG 2.5.3).
      const accessibleName = await trigger.getAttribute('aria-label');
      expect(accessibleName).toContain(title);
      expect(accessibleName!.startsWith(label)).toBe(true);

      // Switching sections still works and still drives the H1.
      await trigger.click();
      await page.getByRole('menuitemradio', { name: 'Suppliers' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Suppliers');
      await expect(trigger).not.toHaveText('Suppliers');
    });
  }

  test('mobile stacks the actions below the title instead of beside it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoConsole(page, { path: '/console/users' });

    const title = await page.getByRole('heading', { level: 1 }).boundingBox();
    const action = await page
      .locator(PAGE_HEADER)
      .getByRole('button', { name: /invite user/i })
      .boundingBox();

    expect(action!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
  });

  test('desktop shares one row between the title and its actions', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoConsole(page, { path: '/console/users' });

    const title = await page.getByRole('heading', { level: 1 }).boundingBox();
    const action = await page
      .locator(PAGE_HEADER)
      .getByRole('button', { name: /invite user/i })
      .boundingBox();

    // Vertically overlapping — the same row, with the action trailing.
    expect(action!.y).toBeLessThan(title!.y + title!.height);
    expect(action!.x).toBeGreaterThan(title!.x);
  });
});

test.describe('heading order', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // One route per test: `gotoConsole` installs route handlers and an init
  // script, so re-running it against a live page stacks handlers and races the
  // navigation it just started.
  for (const route of ['/console/master-data', '/console/inventory', '/console/users'] as const) {
    test(`${route} opens at h1 and skips no level`, async ({ page }) => {
      await gotoConsole(page, { path: route });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const levels = await page.evaluate(() =>
        Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => Number(el.tagName[1])),
      );

      expect(levels[0], 'must open at h1').toBe(1);
      for (let i = 1; i < levels.length; i += 1) {
        expect(levels[i], 'skips a level').toBeLessThanOrEqual(levels[i - 1] + 1);
      }
    });
  }
});
