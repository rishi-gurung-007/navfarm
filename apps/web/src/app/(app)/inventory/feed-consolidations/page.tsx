"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { InventoryPageShell } from "@/components/console/inventory/inventory-page-shell";
import { FeedForecastSubTabs, type FeedForecastTab } from "@/components/console/inventory/feed-forecast-tabs";
import { FeedConsolidationsPanel } from "@/components/console/inventory/feed-consolidations-panel";

export default function FeedConsolidationsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectTab = useCallback((next: FeedForecastTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(next === "mill-consolidation" ? `${pathname}?${params.toString()}` : `/inventory/feed-forecast?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);
  return <InventoryPageShell activeKey="feed-forecast"><div className="space-y-4 p-6"><FeedForecastSubTabs tab="mill-consolidation" onTabChange={selectTab} /><FeedConsolidationsPanel /></div></InventoryPageShell>;
}
