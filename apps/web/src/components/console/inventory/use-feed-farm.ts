"use client";

/**
 * The farm a feed screen shows (spec D13), shared by Feed Requisitions and
 * Feed Alerts: a STANDARD_USER's farm is their own and never a choice; every
 * other user type picks from the active company's farms, defaulting to the
 * pinned one. farmId is always sent explicitly, as the Feed Forecast page
 * does, because the API client only sends x-active-farm-id when one is pinned.
 */
import { useEffect, useState } from "react";
import { api } from "@/services/api-client";
import { getActiveFarmId, getStoredUser } from "@/hooks/useAuth";

export interface FarmItem {
  location_id: string;
  location_code: string;
  location_name: string;
}

export function useFeedFarm() {
  const user = getStoredUser() as any;
  const isFixed = user?.userType === "STANDARD_USER";
  const fixedFarmId: string | null = isFixed ? user?.farmId ?? user?.farm_id ?? null : null;
  const [farmId, setFarmId] = useState<string | null>(() => fixedFarmId ?? getActiveFarmId());
  const [farms, setFarms] = useState<FarmItem[]>([]);

  useEffect(() => {
    if (isFixed) return;
    let alive = true;
    api
      .get("/location?locationType=FARM&rootOnly=true&isActive=true")
      .then((res: any) => {
        if (!alive) return;
        // A proxy error page or contract change can hand back a non-array
        // body — guarded like the sibling inventory panels so it renders an
        // empty farm list instead of crashing on .map/[0].
        const raw = res?.data ?? res;
        const list: FarmItem[] = Array.isArray(raw) ? raw : [];
        setFarms(list);
        setFarmId((current) => current ?? list[0]?.location_id ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isFixed]);

  return { farmId, setFarmId, farms, isFixed, fixedFarm: isFixed ? (user?.farm ?? null) : null };
}
