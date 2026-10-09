"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
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

interface FeedPlanResult {
  run: { runId: string; runCode: string; from: string; to: string } | null;
  rows: FeedPlanRow[];
}

interface FeedPlanVersion {
  plan_id: string;
  plan_code: string;
  production_date: string;
  plan_week: string;
  plan_type: "TENTATIVE" | "ACTUAL";
  version: number;
  source_from: string;
  source_to: string;
  lines?: Array<{
    plan_line_id: string;
    item_code: string;
    item_name: string;
    projected_target_kg: string;
    adjustment_factor: string;
    tentative_qty_kg: string;
    requested_qty_kg: string | null;
    mill_approved_qty_kg: string | null;
    variance_qty_kg: string;
    history_snapshot: Array<{ from: string; to: string; actualKg: number; expectedKg: number }>;
  }>;
}

const kg = (value: number | null, unavailable: string) => value === null || !Number.isFinite(value)
  ? unavailable
  : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function FeedPlanPanel() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const { farm, farmId, setFarmId, planningDate, setPlanningDate, from, to } = useFeedForecastContext();
  const [rows, setRows] = useState<FeedPlanRow[]>([]);
  const [versions, setVersions] = useState<FeedPlanVersion[]>([]);
  const [viewing, setViewing] = useState<FeedPlanVersion | null>(null);
  const [hasSavedRun, setHasSavedRun] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!farmId) {
      setRows([]);
      setVersions([]);
      setHasSavedRun(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ farmId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    Promise.all([
      api.get(`/feed-forecast/feed-plan?${params.toString()}`),
      api.get(`/feed-forecast/feed-plan/versions?farmId=${encodeURIComponent(farmId)}`),
    ]).then(([response, versionResponse]) => {
        if (!alive) return;
        const result = unwrap<FeedPlanResult>(response);
        const retained = unwrap<FeedPlanVersion[]>(versionResponse);
        setHasSavedRun(Boolean(result?.run));
        setRows(Array.isArray(result?.rows) ? result.rows : []);
        setVersions(Array.isArray(retained) ? retained : []);
      })
      .catch((err: any) => {
        if (alive) setError(err?.message || tRef.current("feedPlanLoadFailed"));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [farmId, from, reload, to]);

  async function generateVersion() {
    if (!farmId || !planningDate) return;
    setGenerating(true);
    setError("");
    try {
      await api.post("/feed-forecast/feed-plan/versions", { farmId, productionDate: planningDate });
      setReload((value) => value + 1);
    } catch (err: any) {
      setError(err?.message || tRef.current("feedPlanGenerateFailed"));
    } finally {
      setGenerating(false);
    }
  }

  async function viewVersion(version: FeedPlanVersion) {
    setError("");
    try {
      setViewing(unwrap<FeedPlanVersion>(await api.get(`/feed-forecast/feed-plan/versions/${version.plan_id}`)));
    } catch (err: any) {
      setError(err?.message || tRef.current("feedPlanLoadFailed"));
    }
  }

  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code ? feedFarmLabel({ code: farm.fixedFarm.location_code, name: farm.fixedFarm.location_name ?? "" }) : null
    : undefined;

  return (
    <div data-fill-body>
      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <FeedFarmSelect id="feed-plan-farm" label={t("rqFarm")} farms={farm.farms} farmId={farmId} onChange={setFarmId} fixedLabel={fixedLabel} />
        <Field label={t("feedPlanProductionDate")} htmlFor="feed-plan-production-date">
          <input id="feed-plan-production-date" type="date" value={planningDate} onChange={(event) => setPlanningDate(event.target.value)} className="nf-input-sm" />
        </Field>
        <Button className="ml-auto" onClick={generateVersion} disabled={!farmId || !planningDate || !hasSavedRun || generating}>
          {generating ? t("feedPlanGenerating") : t("feedPlanGenerate")}
        </Button>
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {versions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2" aria-label={t("feedPlanVersions")}>
          {versions.map((version) => (
            <Button key={version.plan_id} type="button" variant="outline" size="sm" onClick={() => viewVersion(version)}>
              {version.plan_code} · {version.plan_type === "ACTUAL" ? t("feedPlanActual") : t("feedPlanTentative")}
            </Button>
          ))}
        </div>
      )}
      {loading ? <LoadingState label={t("feedPlanLoading")} /> : rows.length === 0 ? (
        <EmptyState title={t(hasSavedRun ? "feedPlanNoOrder" : "feedPlanEmpty")} />
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
      <Dialog
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.plan_code ?? t("feedPlanTableLabel")}
        description={viewing ? `${viewing.plan_type === "ACTUAL" ? t("feedPlanActual") : t("feedPlanTentative")} · ${formatDateShort(viewing.production_date)}` : undefined}
        presentation="page"
        footer={<Button type="button" variant="outline" onClick={() => setViewing(null)}>{t("close")}</Button>}
      >
        {viewing && (
          <div className="space-y-5">
            <p className="text-sm text-[var(--text-secondary)]">
              {t("feedPlanEvidenceRange")}: {formatDateShort(viewing.source_from)} – {formatDateShort(viewing.source_to)}
            </p>
            <ScrollTable label={t("feedPlanVersionLines")}>
              <thead><tr><th>{t("feedPlanColItemNo")}</th><th>{t("feedPlanColItemName")}</th><th>{t("feedPlanProjected")}</th><th>{t("feedPlanFactor")}</th><th>{t("feedPlanColTentative")}</th><th>{t("feedPlanRequested")}</th><th>{t("feedPlanMillApproved")}</th><th>{t("feedPlanColVariance")}</th></tr></thead>
              <tbody>{(viewing.lines ?? []).map((line) => <tr key={line.plan_line_id}>
                <td>{line.item_code}</td><td>{line.item_name}</td><td>{kg(Number(line.projected_target_kg), t("feedPlanUnavailable"))}</td>
                <td>{Number(line.adjustment_factor).toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                <td>{kg(Number(line.tentative_qty_kg), t("feedPlanUnavailable"))}</td><td>{line.requested_qty_kg === null ? t("feedPlanUnavailable") : kg(Number(line.requested_qty_kg), t("feedPlanUnavailable"))}</td>
                <td>{line.mill_approved_qty_kg === null ? t("feedPlanUnavailable") : kg(Number(line.mill_approved_qty_kg), t("feedPlanUnavailable"))}</td><td>{kg(Number(line.variance_qty_kg), t("feedPlanUnavailable"))}</td>
              </tr>)}</tbody>
            </ScrollTable>
            <ScrollTable label={t("feedPlanHistory")}>
              <thead><tr><th>{t("feedPlanColItemNo")}</th><th>{t("feedPlanHistoryWeek")}</th><th>{t("feedPlanHistoryActual")}</th><th>{t("feedPlanHistoryExpected")}</th></tr></thead>
              <tbody>{(viewing.lines ?? []).flatMap((line) => line.history_snapshot.map((week) => <tr key={`${line.plan_line_id}:${week.from}`}>
                <td>{line.item_code}</td><td>{formatDateShort(week.from)} – {formatDateShort(week.to)}</td>
                <td>{kg(Number(week.actualKg), t("feedPlanUnavailable"))}</td><td>{kg(Number(week.expectedKg), t("feedPlanUnavailable"))}</td>
              </tr>))}</tbody>
            </ScrollTable>
          </div>
        )}
      </Dialog>
    </div>
  );
}
