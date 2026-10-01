"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import FeedForecastTabs, { readFeedForecastTab, type FeedForecastTab } from "@/components/console/inventory/feed-forecast-tabs";

export default function InventoryFeedForecastPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = readFeedForecastTab(searchParams.get("tab"));

  // The tab is always written to the URL, so the address bar, a refresh and
  // the redirect from the old feed-requisitions route all name the same tab.
  // No `key` on the tabs: a key would remount them and throw away the panel
  // state the mount-once tabs exist to preserve.
  const selectTab = useCallback(
    (next: FeedForecastTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <InventoryPageShell activeKey="feed-forecast" fill>
      <FeedForecastTabs tab={tab} onTabChange={selectTab} />
    </InventoryPageShell>
  );
}
