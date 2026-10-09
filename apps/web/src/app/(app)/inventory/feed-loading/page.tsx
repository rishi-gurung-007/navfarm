"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import { FeedForecastSubTabs, type FeedForecastTab } from "@/components/console/inventory/feed-forecast-tabs";
import { FeedLoadingPanel } from "@/components/console/inventory/feed-loading-panel";

export default function FeedLoadingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectTab = useCallback((next: FeedForecastTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(next === "loading-instructions" ? `${pathname}?${params.toString()}` : `/inventory/feed-forecast?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);
  return <InventoryPageShell activeKey="feed-forecast"><div className="space-y-4 p-6"><FeedForecastSubTabs tab="loading-instructions" onTabChange={selectTab} /><FeedLoadingPanel /></div></InventoryPageShell>;
}
