"use client";

import { useEffect } from "react";
import { api } from "@/services/api-client";

/**
 * Suppliers ↔ Business Central vendors (docs/bbp/BBP-BC-01-Vendor-Master-Integration.md).
 *
 * Renders nothing. When the Suppliers screen opens and the BC integration is on, it asks the API to refresh the
 * supplier list from BC if the last sync is older than 15 minutes, and reloads the table only when something
 * changed. The visible BC bar ("Linked to Business Central …", Browse BC vendors, Sync from BC) was removed from
 * the screen on request (18 Nov 2026); the API endpoints behind it remain for administrators.
 */

type Settings = { enabled: boolean };
type RefreshResult = { refreshed: boolean; result?: { counts: { create: number; update: number; deactivate: number } } };

const unwrap = <T,>(res: unknown): T => ((res as { data?: T })?.data ?? res) as T;

export function BcVendorAutoRefresh({ onChanged }: { onChanged: () => void }) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = unwrap<Settings>(await api.get("/integration/business-central/vendors/settings"));
        if (cancelled || !settings?.enabled) return;
        const r = unwrap<RefreshResult>(await api.post("/integration/business-central/vendors/refresh-if-stale"));
        const c = r.result?.counts;
        if (!cancelled && r.refreshed && c && c.create + c.update + c.deactivate > 0) onChanged();
      } catch {
        // No BC access or BC unavailable: the table keeps showing the last synced list.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per screen open (onChanged is the table's reload).
  }, []);

  return null;
}
