import { isHrefActive } from './AppShell';
import { MASTER_DATA_CONFIGS, masterTabRoutes } from '@/modules/master-data/configs';

/**
 * Opening a master's tab left the whole Farm Master flyout unhighlighted: a tab is a master of its own at its
 * own path (Vehicle Documents is /master-data/vehicle-document), only primary masters are listed in the menu,
 * and /master-data/vehicle-document is not a path *under* /master-data/vehicle, so nothing matched. The menu
 * could not say which master you were inside.
 *
 * Driven off the real configs, so a tab master added later is covered without touching this file.
 */

const href = (key: string) => `/master-data/${key}`;
const tabMasters = MASTER_DATA_CONFIGS.filter((c) => c.tabOf);
const navHrefs = MASTER_DATA_CONFIGS.filter((c) => c.isPrimary).map((c) => href(c.key));

describe('Sidebar highlighting inside a master', () => {
  it('has tab masters to speak of, and each names a primary parent', () => {
    expect(tabMasters.length).toBeGreaterThan(0);
    for (const tab of tabMasters) {
      const parent = MASTER_DATA_CONFIGS.find((c) => c.key === tab.tabOf);
      expect(parent).toBeDefined();
      expect(parent!.isPrimary).toBe(true);
    }
  });

  it('highlights the parent master while any of its tabs is open', () => {
    for (const tab of tabMasters) {
      const parentHref = href(tab.tabOf!);
      expect(
        isHrefActive(parentHref, href(tab.key), null, navHrefs, masterTabRoutes(tab.tabOf!)),
      ).toBe(true);
    }
  });

  // The bug itself: without the parent being told which paths are its own, nothing in the menu matched.
  it('would highlight nothing without those paths — the defect being guarded', () => {
    for (const tab of tabMasters) {
      const onThisTab = MASTER_DATA_CONFIGS.filter((c) => c.isPrimary).filter((c) =>
        isHrefActive(href(c.key), href(tab.key), null, navHrefs),
      );
      expect(onThisTab).toEqual([]);
    }
  });

  it('still highlights a master on its own page, and only that one', () => {
    for (const parent of MASTER_DATA_CONFIGS.filter((c) => c.isPrimary)) {
      const lit = MASTER_DATA_CONFIGS.filter((c) => c.isPrimary).filter((c) =>
        isHrefActive(href(c.key), href(parent.key), null, navHrefs, masterTabRoutes(c.key)),
      );
      expect(lit.map((c) => c.key)).toEqual([parent.key]);
    }
  });

  it('does not light a master up for an unrelated page', () => {
    for (const parent of MASTER_DATA_CONFIGS.filter((c) => c.isPrimary)) {
      expect(
        isHrefActive(href(parent.key), '/inventory/balance', null, navHrefs, masterTabRoutes(parent.key)),
      ).toBe(false);
    }
  });
});
