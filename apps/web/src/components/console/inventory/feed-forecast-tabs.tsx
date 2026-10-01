"use client";

/**
 * Inventory -> Feed Forecast is one page with three tabs (spec, UI structure):
 * Forecast, Feed Requisition and Physical Count — all three work on the same
 * selected farm.
 *
 * The chosen tab lives in `?tab=`, so a bookmark, a refresh and the redirect
 * from the old /inventory/feed-requisitions URL all land on the same tab. The
 * panels are mounted once and then kept in the DOM: unmounting the forecast
 * when you look at the count and mounting it again on the way back threw away
 * the view, the dates and the loaded grid, which is exactly what "preserved
 * forecast state" means in the plan.
 *
 * Each panel owns its own `useFeedFarm()` selection rather than receiving a
 * farm as a prop — that hook is one localStorage key and one cached farm list,
 * so the three tabs cannot disagree about which farm they are showing.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Tabs } from "@/components/ui/tabs";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import FeedForecastPanel from "./feed-forecast-panel";
import { FeedRequisitionPanel } from "./requisitions-panel";
import FeedStockCountPanel from "./feed-stock-count-panel";

export const FEED_FORECAST_TABS = ["forecast", "feed-requisition", "physical-count"] as const;
export type FeedForecastTab = (typeof FEED_FORECAST_TABS)[number];

const TAB_LABEL: Record<FeedForecastTab, TranslationKeys> = {
  forecast: "fftTabForecast",
  "feed-requisition": "fftTabFeedRequisition",
  "physical-count": "fftTabPhysicalCount",
};

/** Unknown or missing `?tab=` falls back to the forecast rather than to nothing. */
export function readFeedForecastTab(value: string | null | undefined): FeedForecastTab {
  return (FEED_FORECAST_TABS as readonly string[]).includes(String(value ?? ""))
    ? (value as FeedForecastTab)
    : "forecast";
}

/** The query string that carries a chosen tab through a reload or a redirect. */
export function feedForecastTabQuery(tab: FeedForecastTab): string {
  return `tab=${encodeURIComponent(tab)}`;
}

const PANELS: Record<FeedForecastTab, () => ReactNode> = {
  forecast: () => <FeedForecastPanel />,
  "feed-requisition": () => <FeedRequisitionPanel />,
  "physical-count": () => <FeedStockCountPanel />,
};

interface FeedForecastTabsProps {
  tab: FeedForecastTab;
  onTabChange: (tab: FeedForecastTab) => void;
}

export default function FeedForecastTabs({ tab, onTabChange }: FeedForecastTabsProps) {
  const { t } = useLanguage();
  // Mount-once: a tab is rendered the first time it is opened and stays
  // mounted afterwards, so its state survives every later switch.
  const [visited, setVisited] = useState<FeedForecastTab[]>([tab]);

  useEffect(() => {
    setVisited((list) => (list.includes(tab) ? list : [...list, tab]));
  }, [tab]);

  return (
    <div data-fill-body className="w-full">
      <Tabs
        items={FEED_FORECAST_TABS.map((key) => ({ value: key, label: t(TAB_LABEL[key]) }))}
        value={tab}
        onChange={(value) => onTabChange(value as FeedForecastTab)}
      />
      {FEED_FORECAST_TABS.filter((key) => visited.includes(key)).map((key) => (
        <div
          key={key}
          data-feed-tab={key}
          className="w-full flex min-h-0 flex-1 flex-col"
          // Inline, not the `hidden` attribute: Tailwind's `.flex` would win
          // over the UA `[hidden]` rule and the inactive panel would show.
          style={{ display: key === tab ? undefined : "none" }}
        >
          {PANELS[key]()}
        </div>
      ))}
    </div>
  );
}
