"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ForecastView } from "./feed-forecast-query";
import { useFeedFarm } from "./use-feed-farm";

export interface ForecastWindowValue {
  planningDate: string;
  view: ForecastView;
  from: string;
  to: string;
  periodId: string;
}

export interface FeedForecastContextValue {
  farm: ReturnType<typeof useFeedFarm>;
  farmId: string | null;
  setFarmId: (farmId: string | null) => void;
  planningDate: string;
  setPlanningDate: Dispatch<SetStateAction<string>>;
  view: ForecastView;
  setView: Dispatch<SetStateAction<ForecastView>>;
  from: string;
  setFrom: Dispatch<SetStateAction<string>>;
  to: string;
  setTo: Dispatch<SetStateAction<string>>;
  periodId: string;
  setPeriodId: Dispatch<SetStateAction<string>>;
  hydrateWindow: (window: ForecastWindowValue) => void;
}

const FeedForecastContext = createContext<FeedForecastContextValue | null>(null);

export function FeedForecastProvider({ children }: { children: ReactNode }) {
  const farm = useFeedFarm();
  const [planningDate, setPlanningDate] = useState("");
  const [view, setView] = useState<ForecastView>("CUSTOM");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [periodId, setPeriodId] = useState("");

  const setFarmId = useCallback((nextFarmId: string | null) => {
    if (nextFarmId === farm.farmId) return;
    farm.setFarmId(nextFarmId);
    // The next response owns the next farm's local day. Keeping the former
    // farm's dates here would silently plan in the wrong time-zone context.
    setPlanningDate("");
    setFrom("");
    setTo("");
    setPeriodId("");
  }, [farm]);

  const hydrateWindow = useCallback((resolved: ForecastWindowValue) => {
    // Hydration fills only values the user has not chosen. A late request may
    // never overwrite a selection made while it was in flight.
    setPlanningDate((current) => current || resolved.planningDate);
    setFrom((current) => current || resolved.from);
    setTo((current) => current || resolved.to);
    setPeriodId((current) => current || resolved.periodId);
  }, []);

  const value = useMemo<FeedForecastContextValue>(() => ({
    farm,
    farmId: farm.farmId,
    setFarmId,
    planningDate,
    setPlanningDate,
    view,
    setView,
    from,
    setFrom,
    to,
    setTo,
    periodId,
    setPeriodId,
    hydrateWindow,
  }), [farm, from, hydrateWindow, periodId, planningDate, setFarmId, to, view]);

  return <FeedForecastContext.Provider value={value}>{children}</FeedForecastContext.Provider>;
}

export function useFeedForecastContext(): FeedForecastContextValue {
  const context = useContext(FeedForecastContext);
  if (!context) throw new Error("useFeedForecastContext must be used inside FeedForecastProvider.");
  return context;
}

export function useOptionalFeedForecastContext(): FeedForecastContextValue | null {
  return useContext(FeedForecastContext);
}
