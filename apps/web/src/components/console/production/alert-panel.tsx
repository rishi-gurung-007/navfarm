"use client";

/**
 * The Alerts page (D24, Rishi 27 Sep): batch KPI alerts and feed alerts in
 * one list, with a type and farm filter. Opening the page evaluates the feed
 * rules of every farm the user may open, once — there is still no scheduler,
 * so diet-change and deadline alerts are only as fresh as the last
 * evaluation. The two lists are read independently (F1, review I1): a role
 * that holds one grant and not the other keeps the half it may read, and the
 * Type filter stops offering the half it may not.
 * Fixed-height page: the table is the one thing that scrolls (review C).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Inbox, Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { getActiveCompanyId, getStoredUser } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatStampShort } from "@/utils/date-short";
import type { TranslationKeys } from "@/utils/translations";
import { loadFeedFarms, type FeedFarm } from "@/components/console/inventory/use-feed-farm";
import { PRIORITY_LABEL, labelOf, variantOf } from "@/components/console/inventory/requisition-labels";
import { AlertRow, AlertState, fromBatchAlert, fromFeedAlert, mergeAlerts } from "./alerts-list";

type TypeFilter = "ALL" | "BATCH" | "FEED";
type ShowFilter = "OPEN" | "ALL";

const STATE_KEY: Record<AlertState, TranslationKeys> = {
  OPEN: "alrtStatusOpen", READ: "alrtStatusRead", ACKNOWLEDGED: "alrtStatusAcknowledged", RESOLVED: "alrtStatusResolved",
};
const COLUMNS = ["alrtColPriority", "alrtColType", "alrtColAlert", "alrtColFarm", "alrtColRaised", "alrtColStatus", "alrtColAction"] as const;
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const SMALL_BADGE = "px-1.5 py-0 text-[10px]";
const unwrapList = (res: any): any[] => {
  const raw = res?.data ?? res;
  return Array.isArray(raw) ? raw : [];
};

export default function AlertPanel() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const [farms, setFarms] = useState<FeedFarm[]>([]);
  const [type, setType] = useState<TypeFilter>("ALL");
  const [farmId, setFarmId] = useState("");
  const [show, setShow] = useState<ShowFilter>("OPEN");
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  // Which halves the user may read. A list starts offered and is withdrawn
  // when its own read is refused, so nothing flickers on a slow first load.
  const [mayReadBatch, setMayReadBatch] = useState(true);
  const [mayReadFeed, setMayReadFeed] = useState(true);
  const evaluated = useRef(false);
  const farmsRef = useRef<FeedFarm[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    if (!evaluated.current) {
      evaluated.current = true;
      try {
        farmsRef.current = await loadFeedFarms(getStoredUser() as any);
      } catch {
        farmsRef.current = [];
      }
      setFarms(farmsRef.current);
      try {
        const res: any = await api.post("/feed-alert/evaluate-scope", {});
        const result = res?.data ?? res;
        const short = [...(result?.failed ?? []), ...(result?.forecastErrors ?? [])].map((f: any) => f.farmCode);
        if (short.length) setNotice(tRef.current("alrtFeedPartly", { farms: [...new Set(short)].sort().join(", ") }));
      } catch {
        // No feed grant, or the evaluation failed: the batch alerts still show.
        setNotice(tRef.current("alrtFeedCheckFailed"));
      }
    }
    const codeOf = (id: string | null) => farmsRef.current.find((f) => f.farmId === id)?.code ?? null;
    try {
      const batchParams = new URLSearchParams();
      const companyId = getActiveCompanyId();
      if (companyId) batchParams.set("companyId", companyId);
      if (farmId) batchParams.set("farmId", farmId);
      if (show === "OPEN") batchParams.set("isRead", "false");
      batchParams.set("limit", "200");
      const feedParams = new URLSearchParams({ status: show === "OPEN" ? "ACTIVE" : "ALL" });
      if (farmId) feedParams.set("farmId", farmId);
      // allSettled, not all: one refused list must not throw the other away.
      const [batch, feed] = await Promise.allSettled([
        type === "FEED" ? Promise.resolve([]) : api.get(`/alert?${batchParams.toString()}`).then(unwrapList),
        type === "BATCH" ? Promise.resolve([]) : api.get(`/feed-alert/scope?${feedParams.toString()}`).then(unwrapList),
      ]);
      if (type !== "FEED") setMayReadBatch(batch.status === "fulfilled");
      if (type !== "BATCH") setMayReadFeed(feed.status === "fulfilled");
      const rowsOf = <T,>(r: PromiseSettledResult<any[]>, map: (a: any) => T): T[] =>
        r.status === "fulfilled" ? r.value.map(map) : [];
      setRows(mergeAlerts(rowsOf(batch, (a) => fromBatchAlert(a, codeOf)), rowsOf(feed, fromFeedAlert)));
      // Only a user who may read neither half is told the load failed.
      setError(batch.status === "rejected" && feed.status === "rejected"
        ? (batch.reason as any)?.message || tRef.current("alrtLoadFailed")
        : "");
    } catch (err: any) {
      setError(err?.message || tRef.current("alrtLoadFailed"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [type, farmId, show]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (row: AlertRow) => {
    setActing(row.key);
    try {
      if (row.kind === "FEED") await api.post(`/feed-alert/${row.id}/acknowledge`, {});
      else await api.post(`/alert/${row.id}/read`, { companyId: row.companyId });
      await load();
    } catch (err: any) {
      setError(err?.message || tRef.current(row.kind === "FEED" ? "alrtAckFailed" : "alrtMarkReadFailed"));
    } finally {
      setActing(null);
    }
  };

  return (
    <div data-fill-body>
      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <Field label={t("alrtType")} htmlFor="alrt-type">
          <select id="alrt-type" className="nf-input-sm nf-select" style={inputStyle} value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
            {mayReadBatch && mayReadFeed && <option value="ALL">{t("alrtTypeAll")}</option>}
            {mayReadBatch && <option value="BATCH">{t("alrtTypeBatch")}</option>}
            {mayReadFeed && <option value="FEED">{t("alrtTypeFeed")}</option>}
          </select>
        </Field>
        <Field label={t("alrtFarm")} htmlFor="alrt-farm">
          <select id="alrt-farm" className="nf-input-sm nf-select" style={inputStyle} value={farmId} onChange={(e) => setFarmId(e.target.value)}>
            <option value="">{t("alrtFarmAll")}</option>
            {farms.map((f) => <option key={f.farmId} value={f.farmId}>{f.code} — {f.name}</option>)}
          </select>
        </Field>
        <Field label={t("alrtShow")} htmlFor="alrt-show">
          <select id="alrt-show" className="nf-input-sm nf-select" style={inputStyle} value={show} onChange={(e) => setShow(e.target.value as ShowFilter)}>
            <option value="OPEN">{t("alrtShowOpen")}</option>
            <option value="ALL">{t("alrtShowAll")}</option>
          </select>
        </Field>
      </div>

      {notice && <InlineAlert variant="warning">{notice}</InlineAlert>}
      {error && <InlineAlert>{error}</InlineAlert>}

      <ScrollTable label={t("alrtTableLabel")}>
        <thead>
          <tr>{COLUMNS.map((c) => <th key={c} scope="col" className={TH}>{t(c)}</th>)}</tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-xs text-[var(--text-secondary)]"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("alrtLoading")}</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-xs text-[var(--text-secondary)]"><Inbox className="mx-auto mb-2 h-6 w-6" /> {t("alrtNoAlerts")}</td></tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key} className={row.state === "OPEN" ? undefined : "opacity-70"}>
                <td className={TD}><Badge variant={variantOf(PRIORITY_LABEL, row.priority)} className={SMALL_BADGE}>{labelOf(PRIORITY_LABEL, row.priority, t)}</Badge></td>
                <td className={cn(TD, "text-[var(--text-secondary)]")}>{t(row.kind === "FEED" ? "alrtTypeFeed" : "alrtTypeBatch")}</td>
                <td className={cn(TD, "max-w-[36rem]")}>
                  <span className="font-medium">{row.title}</span>
                  <span className="ml-2 inline-block max-w-[24rem] truncate align-bottom text-[var(--text-secondary)]" title={row.message}>{row.message}</span>
                </td>
                <td className={TD}>{row.farmCode ?? "—"}</td>
                <td className={cn(TD, "tabular-nums")}>{formatStampShort(row.raisedAt, row.raisedUtc)}</td>
                <td className={TD}>{t(STATE_KEY[row.state])}</td>
                <td className={TD}>
                  {row.state === "OPEN" && (
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" onClick={() => act(row)} disabled={acting === row.key}>
                      <CheckCircle2 className="h-3 w-3" /> {t(row.kind === "FEED" ? "alrtAcknowledge" : "alrtMarkRead")}
                    </Button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </ScrollTable>
    </div>
  );
}
