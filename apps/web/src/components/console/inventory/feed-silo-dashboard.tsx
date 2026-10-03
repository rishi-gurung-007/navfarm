"use client";

/**
 * Inventory -> Feed Forecast, Dashboard tab (TDD Engine §4 rows 47–64, Master
 * Setup §1): one row per silo with the client workbook's dashboard fields,
 * from GET /feed-forecast/silo-status. Everything is derived server-side from
 * the forecast engine; this screen only lays it out. The Mill Loading Bin
 * column waits for Part B. The silo balance is always labelled "System
 * Balance" (cp. 37).
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatDateShort, unwrap } from "./feed-format";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import { useFeedFarm } from "./use-feed-farm";

export interface SiloStatusRow {
  siloId: string;
  siloCode: string;
  houseCodes: string[];
  capacityKg: number | null;
  belowFeedLevelKg: number | null;
  aboveThresholdKg: number | null;
  feedInSiloItemId: string | null;
  feedInSiloItemName: string | null;
  feedType: "BULK" | "BAGGED";
  systemBalanceKg: number;
  lastApprovedCountKg: number | null;
  lastApprovedCountAt: string | null;
  lastFeedReceiptDate: string | null;
  blocked: boolean;
  currentDietItemId: string | null;
  dailyRequirementKg: number;
  daysRemaining: number | null;
  firstShortageDate: string | null;
  projectedNeedKg: number;
  nextDietItemId: string | null;
  nextDietDate: string | null;
  siloAvailableForNextDiet: boolean | null;
  projectedShortfallKg: number;
  recommendedOrderKg: number;
  requisitionStatus: string | null;
  submissionDeadline: string | null;
  alert: "CRITICAL_FIRST_PRIORITY" | "INFO" | null;
}

interface SiloStatusResponse {
  planningDate: string;
  submissionDeadline: string;
  itemNames: Record<string, string>;
  rows: SiloStatusRow[];
}

const COLUMNS = [
  "fsdColSilo", "fsdColHouses", "fsdColFeedType", "fsdColFeedInSilo", "fsdColCapacity", "fsdColBelow", "fsdColAbove",
  "fsdColBalance", "fsdColCount", "fsdColReceipt", "fsdColCurrentDiet", "fsdColDaily", "fsdColDaysLeft", "fsdColShortage",
  "fsdColNeed", "fsdColNextDiet", "fsdColNextAvail", "fsdColShortfall", "fsdColOrder", "fsdColReqStatus", "fsdColDeadline", "fsdColAlert",
] as const;
const RIGHT = new Set<string>(["fsdColCapacity", "fsdColBelow", "fsdColAbove", "fsdColBalance", "fsdColCount", "fsdColDaily", "fsdColDaysLeft", "fsdColNeed", "fsdColShortfall", "fsdColOrder"]);

const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

const kg = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const day = (value: string | null | undefined): string => (value ? formatDateShort(value) : "—");

export default function FeedSiloDashboard() {
  const { t } = useLanguage();
  const farm = useFeedFarm();
  const farmId = farm.farmId;
  const [planningDate, setPlanningDate] = useState("");
  const [data, setData] = useState<SiloStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!farmId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    setData(null);
    try {
      const params = new URLSearchParams({ farmId });
      if (planningDate) params.set("planningDate", planningDate);
      setData(unwrap<SiloStatusResponse>(await api.get(`/feed-forecast/silo-status?${params.toString()}`)));
    } catch (err: any) {
      setError(err?.message || t("fsdLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [farmId, planningDate, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code
      ? feedFarmLabel({ code: farm.fixedFarm.location_code, name: farm.fixedFarm.location_name ?? "" })
      : null
    : undefined;
  const noFarms = !farm.isFixed && farm.loaded && farm.farms.length === 0;
  const rows = Array.isArray(data?.rows) ? data!.rows : [];
  const nameOf = (id: string | null) => (id ? data?.itemNames?.[id] ?? "—" : "—");

  return (
    <div data-fill-body>
      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <FeedFarmSelect id="sd-farm" label={t("ffFarm")} farms={farm.farms} farmId={farmId} fixedLabel={fixedLabel} onChange={farm.setFarmId} />
        <Field label={t("fsdPlanningDate")} htmlFor="sd-planning-date">
          <input
            id="sd-planning-date"
            type="date"
            className="nf-input-sm"
            style={inputStyle}
            value={planningDate || data?.planningDate || ""}
            onChange={(e) => setPlanningDate(e.target.value)}
          />
        </Field>
      </div>

      {error && (
        <InlineAlert>
          <span className="mr-3">{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>{t("ffRetry")}</Button>
        </InlineAlert>
      )}

      {farm.failed ? (
        <InlineAlert>
          <span className="mr-3">{t("ffFarmsLoadFailed")}</span>
          <Button size="sm" variant="outline" onClick={farm.retry}>{t("ffRetry")}</Button>
        </InlineAlert>
      ) : !farm.loaded || loading ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}>
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("fsdLoading")}
        </div>
      ) : noFarms || !farmId ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}>{t("ffNoFarms")}</div>
      ) : data && rows.length === 0 ? (
        <div className="p-10 text-center text-xs" style={{ color: "var(--text-secondary)" }}>{t("fsdEmpty")}</div>
      ) : data ? (
        <ScrollTable label={t("fsdLabel")}>
          <thead>
            <tr>
              {COLUMNS.map((key) => (
                <th key={key} scope="col" className={cn(TH, RIGHT.has(key) && NUM)}>{t(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.siloId} data-silo-row={row.siloCode}>
                <td className={cn(TD, "font-medium")}>
                  {row.siloCode}
                  {row.blocked && <Badge variant="danger" className="ml-2 px-1.5 py-0 text-[10px]">{t("fsdBlocked")}</Badge>}
                </td>
                <td className={TD}>{row.houseCodes.length ? row.houseCodes.join(", ") : "—"}</td>
                <td className={TD}>{row.feedType === "BAGGED" ? t("fsdBagged") : t("fsdBulk")}</td>
                <td className={TD}>{row.feedInSiloItemName ?? "—"}</td>
                <td className={cn(TD, NUM)}>{kg(row.capacityKg)}</td>
                <td className={cn(TD, NUM)}>{kg(row.belowFeedLevelKg)}</td>
                <td className={cn(TD, NUM)}>{kg(row.aboveThresholdKg)}</td>
                <td className={cn(TD, NUM)}>{kg(row.systemBalanceKg)}</td>
                <td className={cn(TD, NUM)} title={row.lastApprovedCountAt ?? undefined}>{kg(row.lastApprovedCountKg)}</td>
                <td className={TD}>{day(row.lastFeedReceiptDate)}</td>
                <td className={TD}>{nameOf(row.currentDietItemId)}</td>
                <td className={cn(TD, NUM)}>{kg(row.dailyRequirementKg)}</td>
                <td className={cn(TD, NUM)}>{row.daysRemaining === null ? "—" : row.daysRemaining.toFixed(1)}</td>
                <td className={TD}>{day(row.firstShortageDate)}</td>
                <td className={cn(TD, NUM)}>{kg(row.projectedNeedKg)}</td>
                <td className={TD}>{row.nextDietItemId ? `${nameOf(row.nextDietItemId)} · ${day(row.nextDietDate)}` : "—"}</td>
                <td className={TD}>{row.siloAvailableForNextDiet === null ? "—" : row.siloAvailableForNextDiet ? t("fsdYes") : t("fsdNo")}</td>
                <td className={cn(TD, NUM)}>{kg(row.projectedShortfallKg)}</td>
                <td className={cn(TD, NUM)}>{kg(row.recommendedOrderKg)}</td>
                <td className={TD}>{row.requisitionStatus ?? "—"}</td>
                <td className={TD}>{day(row.submissionDeadline)}</td>
                <td className={TD}>
                  {row.alert === "CRITICAL_FIRST_PRIORITY" ? (
                    <Badge variant="danger" className="px-1.5 py-0 text-[10px]">{t("fsdAlertCritical")}</Badge>
                  ) : row.alert === "INFO" ? (
                    <Badge variant="info" className="px-1.5 py-0 text-[10px]">{t("fsdAlertInfo")}</Badge>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      ) : null}
    </div>
  );
}
