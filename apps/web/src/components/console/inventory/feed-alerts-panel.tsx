"use client";

/**
 * Inventory → Feed Alerts (Feed Forecast Plan B, Task 11). NAVFarm's in-app
 * channel for the Alerts and Notifications Master (Master Setup §4). The API
 * has no scheduler, so opening this page evaluates the farm's rules first
 * (POST /feed-alert/evaluate) — that is when diet-change and deadline alerts
 * and escalations advance — and then lists the alerts this user may see.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Inbox, Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import { useFeedFarm } from "./use-feed-farm";

interface FeedAlert {
  alert_id: string;
  notification_code: string;
  event_type: string;
  priority_level: string;
  status: string;
  title: string;
  message: string;
  raised_at: string;
  last_notified_at: string;
  escalation_role: string | null;
  escalated_at: string | null;
  acknowledged_at: string | null;
}

const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  CRITICAL_FIRST_PRIORITY: "danger", CRITICAL: "danger", WARNING: "warning", INFO: "info",
};

/** Stored UTC "YYYY-MM-DD HH:MM:SS" shown in the viewer's local time. */
const when = (ts: string) => new Date(`${ts.replace(" ", "T")}Z`).toLocaleString();

export default function FeedAlertsPanel() {
  const { t } = useLanguage();
  // t() is only read inside the catch branch below, but its identity is not
  // stable across renders (some callers, including the test mock, hand back
  // a new `t` each time) — a ref keeps `load`'s own dependency list to the
  // request's actual inputs (farmId/status) instead of looping on renders,
  // the same fix feed-forecast-panel.tsx uses for the same reason.
  const tRef = useRef(t);
  tRef.current = t;

  const { farmId, setFarmId, farms, isFixed } = useFeedFarm();
  const [alerts, setAlerts] = useState<FeedAlert[]>([]);
  const [status, setStatus] = useState<"ACTIVE" | "ALL">("ACTIVE");
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Why the last evaluation fell short, if it did: the forecast could not be
  // built (diet-change alerts skipped, the rest evaluated) or the call failed.
  const [evalNotice, setEvalNotice] = useState("");

  const load = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    setError("");
    setEvalNotice("");
    try {
      // Evaluation failing must not hide the alerts already raised — but the
      // user is told, since what they see may then be out of date.
      try {
        const evalRes: any = await api.post("/feed-alert/evaluate", { farmId });
        const forecastError = (evalRes?.data ?? evalRes)?.forecastError;
        if (forecastError) setEvalNotice(tRef.current("falForecastFailed", { reason: forecastError }));
      } catch {
        setEvalNotice(tRef.current("falEvaluateFailed"));
      }
      const res = await api.get(`/feed-alert?farmId=${farmId}&status=${status}`);
      // Guarded like the sibling inventory panels: a non-array body (proxy
      // error page, contract change) shows the empty state instead of crashing.
      const list = (res as any)?.data ?? res;
      setAlerts(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setError(err?.message || tRef.current("falLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [farmId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const acknowledge = async (id: string) => {
    setActing(id);
    try {
      await api.post(`/feed-alert/${id}/acknowledge`, {});
      await load();
    } catch (err: any) {
      setError(err?.message || t("falAckFailed"));
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {!isFixed && (
          <Field label={t("falFarm")} htmlFor="fal-farm">
            <select id="fal-farm" className="nf-input-sm px-2" value={farmId ?? ""} onChange={(e) => setFarmId(e.target.value)}>
              {farms.map((f) => (
                <option key={f.farmId} value={f.farmId}>{f.code} — {f.name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t("falShow")} htmlFor="fal-status">
          <select id="fal-status" className="nf-input-sm px-2" value={status} onChange={(e) => setStatus(e.target.value as "ACTIVE" | "ALL")}>
            <option value="ACTIVE">{t("falActiveOnly")}</option>
            <option value="ALL">{t("falIncludingResolved")}</option>
          </select>
        </Field>
      </div>

      {/* No scheduler exists (Task 7): date-driven alerts (diet change, requisition
          deadline) and escalations only advance when this screen is opened, or when
          stock is posted. */}
      <InlineAlert variant="info">{t("falNoScheduler")}</InlineAlert>

      {evalNotice && <InlineAlert variant="warning">{evalNotice}</InlineAlert>}
      {error && <InlineAlert>{error}</InlineAlert>}

      {loading ? (
        <div className="p-10 text-center text-xs"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("falLoading")}</div>
      ) : alerts.length === 0 ? (
        <div className="p-10 text-center text-xs"><Inbox className="mx-auto mb-2 h-6 w-6" /> {t("falNone")}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map((a) => (
            <div key={a.alert_id} className="flex items-start justify-between gap-3 rounded-[var(--radius-md)] border p-4"
              style={{ borderColor: "var(--border)", opacity: a.status === "RESOLVED" || a.acknowledged_at ? 0.65 : 1 }}>
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={PRIORITY_VARIANT[a.priority_level] ?? "neutral"}>{a.priority_level}</Badge>
                    <p className="text-sm font-semibold">{a.title}</p>
                    {a.status === "RESOLVED" && <Badge variant="success">{t("falResolved")}</Badge>}
                  </div>
                  <p className="mt-1 text-xs">{a.message}</p>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {a.notification_code} · {t("falRaised", { at: when(a.raised_at) })}
                    {a.escalated_at && a.escalation_role ? ` · ${t("falEscalated", { role: a.escalation_role })}` : ""}
                  </p>
                </div>
              </div>
              {a.status === "ACTIVE" && !a.acknowledged_at && (
                <Button size="sm" variant="outline" onClick={() => acknowledge(a.alert_id)} disabled={acting === a.alert_id}>
                  <CheckCircle2 className="h-3 w-3" /> {t("falAcknowledge")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
