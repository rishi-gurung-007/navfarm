"use client";

/**
 * The farm a feed screen shows (spec D13), shared by Feed Forecast and
 * Requisitions. A STANDARD_USER's farm is their own and never a choice; every
 * other user type picks from GET /feed-forecast/farms (review A2: the farms
 * resolveFarm lets them open, so a tenant admin in the tenant-wide workspace
 * finally gets a list).
 *
 * One request per workspace (A3): the list is a module-level promise every
 * screen and every StrictMode double effect shares; a failed read is dropped
 * so the next screen asks again. One selection across the feed screens (A4,
 * S2): stored under its own key, so choosing a farm here does not pin it for
 * the rest of the app; it starts from the pinned farm, else the first by code.
 */
import { useEffect, useState } from "react";
import { api } from "@/services/api-client";
import { getActiveCompanyId, getActiveFarmId, getActiveWorkspaceScope, getStoredUser } from "@/hooks/useAuth";

export interface FeedFarm {
  farmId: string;
  code: string;
  name: string;
  companyId: string;
  companyName: string | null;
}

export const FEED_FARM_STORAGE_KEY = "nf_feed_farm_id";

let cache: { key: string; promise: Promise<FeedFarm[]> } | null = null;

/** For tests: forget the shared list. */
export function resetFeedFarmCache(): void {
  cache = null;
}

export function loadFeedFarms(user: { userId?: string } | null): Promise<FeedFarm[]> {
  const key = [user?.userId ?? "", getActiveWorkspaceScope(), getActiveCompanyId() ?? ""].join("|");
  if (!cache || cache.key !== key) {
    const promise = api.get("/feed-forecast/farms").then((res: any) => {
      // A proxy error page or a contract change can hand back a non-array body.
      const raw = res?.data ?? res;
      return Array.isArray(raw)
        ? [...(raw as FeedFarm[])].sort((a, b) =>
            a.code.localeCompare(b.code) || a.name.localeCompare(b.name) || a.farmId.localeCompare(b.farmId))
        : [];
    });
    promise.catch(() => {
      if (cache?.promise === promise) cache = null;
    });
    cache = { key, promise };
  }
  return cache.promise;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(FEED_FARM_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(farmId: string | null): void {
  try {
    if (farmId) localStorage.setItem(FEED_FARM_STORAGE_KEY, farmId);
    else localStorage.removeItem(FEED_FARM_STORAGE_KEY);
  } catch {
    // Private window or blocked storage: the choice lasts for this page only.
  }
}

export function useFeedFarm() {
  const user = getStoredUser() as any;
  const isFixed = user?.userType === "STANDARD_USER";
  const fixedFarmId: string | null = isFixed ? user?.farmId ?? user?.farm_id ?? null : null;
  const [farmId, setFarmIdState] = useState<string | null>(() => fixedFarmId ?? readStored() ?? getActiveFarmId());
  const [farms, setFarms] = useState<FeedFarm[]>([]);
  const [loaded, setLoaded] = useState(isFixed);
  const [failed, setFailed] = useState(false);
  // Bumped by retry(): a failed read is not cached, so asking again is enough.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isFixed) return;
    let alive = true;
    loadFeedFarms(getStoredUser() as any)
      .then((list) => {
        if (!alive) return;
        setFarms(list);
        setFarmIdState((current) => {
          if (current && list.some((f) => f.farmId === current)) return current;
          const pinned = getActiveFarmId();
          if (pinned && list.some((f) => f.farmId === pinned)) return pinned;
          return list[0]?.farmId ?? null;
        });
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setFarmIdState(null);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [isFixed, attempt]);

  /**
   * Ask for the farm list again after a failed read (Plan S follow-up: the
   * screens showed "No farms to show." when the request itself had failed,
   * which reads as "this user has no farms" — a different fact entirely).
   */
  const retry = () => {
    resetFeedFarmCache();
    setFailed(false);
    setLoaded(false);
    setAttempt((n) => n + 1);
  };

  const setFarmId = (id: string | null) => {
    setFarmIdState(id);
    writeStored(id);
  };

  return { farmId, setFarmId, retry, farms, loaded, failed, isFixed, fixedFarm: isFixed ? (user?.farm ?? null) : null };
}
