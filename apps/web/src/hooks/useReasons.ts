"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api-client";
import { getActiveCompanyId } from "@/hooks/useAuth";

export interface ReasonRow {
  reason_id: string;
  reason_code: string;
  reason_name: string;
  category: string;
  sub_category?: string | null;
  applicable_stages?: string[] | null;
  stage_filter_note?: string | null;
  mandatory_comment?: boolean;
  mandatory_weight?: boolean;
  is_active?: boolean;
}

let cachedReasons: ReasonRow[] | null = null;
let activeFetchPromise: Promise<ReasonRow[]> | null = null;

export function fetchActiveReasons(companyId?: string | null): Promise<ReasonRow[]> {
  if (cachedReasons && cachedReasons.length > 0) {
    return Promise.resolve(cachedReasons);
  }
  if (activeFetchPromise) {
    return activeFetchPromise;
  }

  const qs = companyId
    ? `?companyId=${companyId}&limit=500&isActive=true`
    : "?limit=500&isActive=true";

  activeFetchPromise = api
    .get(`/reason${qs}`)
    .then((res: unknown) => {
      const data = (Array.isArray(res) ? res : (res as { data?: unknown })?.data ?? res) || [];
      cachedReasons = data as ReasonRow[];
      activeFetchPromise = null;
      return cachedReasons;
    })
    .catch((err) => {
      console.warn("Could not fetch reasons from Reason Master:", err);
      activeFetchPromise = null;
      return [] as ReasonRow[];
    });

  return activeFetchPromise;
}

/** Clear reason cache if reasons are modified */
export function invalidateReasonsCache() {
  cachedReasons = null;
  activeFetchPromise = null;
}

export function useReasons(categoryFilter?: string | string[]) {
  const [reasons, setReasons] = useState<ReasonRow[]>(cachedReasons || []);
  const [loading, setLoading] = useState(!cachedReasons || cachedReasons.length === 0);

  useEffect(() => {
    let cancelled = false;
    const companyId = getActiveCompanyId();
    fetchActiveReasons(companyId).then((all) => {
      if (cancelled) return;
      setReasons(all);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = reasons.filter((r) => {
    if (!categoryFilter) return true;
    if (Array.isArray(categoryFilter)) return categoryFilter.includes(r.category);
    return r.category === categoryFilter;
  });

  return { reasons: filtered, allReasons: reasons, loading };
}
