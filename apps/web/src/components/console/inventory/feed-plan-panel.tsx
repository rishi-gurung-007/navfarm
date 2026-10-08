"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { ScrollTable } from "@/components/ui/scroll-table";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDateShort } from "@/utils/date-short";
import { unwrap } from "./feed-format";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import { useFeedForecastContext } from "./feed-forecast-context";

interface FeedPlanRow {
  farm: { id: string; code: string; name: string };
  period: string;
  item: { id: string; code: string; name: string };
  tentativeKg: number;
  approvedRequisitionKg: number;
  shippedKg: number;
  receivedKg: number;
  remainingKg: number;
  varianceKg: number;
  capacityKg: number | null;
}

const kg = (value: number | null, unavailable: string) => value === null || !Number.isFinite(value)
  ? unavailable
  : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function FeedPlanPanel() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const { farm, farmId, setFarmId, from, to } = useFeedForecastContext();
  const [rows, setRows] = useState<FeedPlanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!farmId) {
      setRows([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ farmId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    api.get(`/feed-forecast/feed-plan?${params.toString()}`)
      .then((response) => {
        if (!alive) return;
        const result = unwrap<{ rows?: FeedPlanRow[] }>(response);
        setRows(Array.isArray(result?.rows) ? result.rows : []);
      })
      .catch((err: any) => {
        if (alive) setError(err?.message || tRef.current("feedPlanLoadFailed"));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [farmId, from, to]);

  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code ? feedFarmLabel({ code: farm.fixedFarm.location_code, name: farm.fixedFarm.location_name ?? "" }) : null
    : undefined;

  return (
    <div data-fill-body>
      <div className="flex shrink-0 items-end gap-3">
        <FeedFarmSelect id="feed-plan-farm" label={t("rqFarm")} farms={farm.farms} farmId={farmId} onChange={setFarmId} fixedLabel={fixedLabel} />
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {loading ? <LoadingState label={t("feedPlanLoading")} /> : rows.length === 0 ? (
        <EmptyState title={t("feedPlanEmpty")} />
      ) : (
        <ScrollTable label={t("feedPlanTableLabel")}>
          <thead><tr>
            {(["feedPlanColFarm", "feedPlanColPeriod", "feedPlanColItemNo", "feedPlanColItemName", "feedPlanColTentative", "feedPlanColApproved", "feedPlanColShipped", "feedPlanColReceived", "feedPlanColRemaining", "feedPlanColVariance", "feedPlanColCapacity"] as const).map((key) => <th key={key}>{t(key)}</th>)}
          </tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={`${row.period}:${row.item.id}`}>
              <td>{row.farm.code}</td><td>{formatDateShort(row.period)}</td><td>{row.item.code}</td><td>{row.item.name}</td>
              <td>{kg(row.tentativeKg, t("feedPlanUnavailable"))}</td><td>{kg(row.approvedRequisitionKg, t("feedPlanUnavailable"))}</td>
              <td>{kg(row.shippedKg, t("feedPlanUnavailable"))}</td><td>{kg(row.receivedKg, t("feedPlanUnavailable"))}</td>
              <td>{kg(row.remainingKg, t("feedPlanUnavailable"))}</td><td>{kg(row.varianceKg, t("feedPlanUnavailable"))}</td>
              <td>{kg(row.capacityKg, t("feedPlanUnavailable"))}</td>
            </tr>
          ))}</tbody>
        </ScrollTable>
      )}
    </div>
  );
}
