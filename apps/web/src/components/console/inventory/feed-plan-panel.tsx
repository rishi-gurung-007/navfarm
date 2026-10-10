"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { showToast } from "@/components/ui/toast";
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
import { MillCapacityBadge, millCapacityText, formatKg, type DietCapacity } from "./mill-capacity-view";

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
  /** Engine r42–r43 for the selected production date; null when it cannot be computed. */
  capacity?: DietCapacity | null;
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

  useEffect(() => {
    if (!farmId) {
      setRows([]);
      setVersions([]);
      setHasSavedRun(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const params = new URLSearchParams({ farmId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (planningDate) params.set("productionDate", planningDate);
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
        if (alive) showToast.error(err?.message || tRef.current("feedPlanLoadFailed"));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [farmId, from, planningDate, reload, to]);

  async function generateVersion() {
    if (!farmId || !planningDate) return;
    setGenerating(true);
    try {
      await api.post("/feed-forecast/feed-plan/versions", { farmId, productionDate: planningDate });
      showToast.success(tRef.current("feedPlanGenerated"));
      setReload((value) => value + 1);
    } catch (err: any) {
      showToast.error(err?.message || tRef.current("feedPlanGenerateFailed"));
    } finally {
      setGenerating(false);
    }
  }

  async function viewVersion(version: FeedPlanVersion) {
    try {
      setViewing(unwrap<FeedPlanVersion>(await api.get(`/feed-forecast/feed-plan/versions/${version.plan_id}`)));
    } catch (err: any) {
      showToast.error(err?.message || tRef.current("feedPlanLoadFailed"));
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
            {(["feedPlanColFarm", "feedPlanColPeriod", "feedPlanColItemNo", "feedPlanColItemName", "feedPlanColTentative", "feedPlanColApproved", "feedPlanColShipped", "feedPlanColReceived", "feedPlanColRemaining", "feedPlanColVariance", "feedPlanColCapacity", "feedPlanColCapacityStatus"] as const).map((key) => <th key={key}>{t(key)}</th>)}
          </tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={`${row.period}:${row.item.id}`}>
              <td>{row.farm.code}</td><td>{formatDateShort(row.period)}</td><td>{row.item.code}</td><td>{row.item.name}</td>
              <td>{kg(row.tentativeKg, t("feedPlanUnavailable"))}</td><td>{kg(row.approvedRequisitionKg, t("feedPlanUnavailable"))}</td>
              <td>{kg(row.shippedKg, t("feedPlanUnavailable"))}</td><td>{kg(row.receivedKg, t("feedPlanUnavailable"))}</td>
              <td>{kg(row.remainingKg, t("feedPlanUnavailable"))}</td><td>{kg(row.varianceKg, t("feedPlanUnavailable"))}</td>
              <td>{millCapacityText(row.capacity?.state ?? "NOT_CONFIGURED", row.capacity?.availableKg ?? null, t)}</td>
              <td>
                <MillCapacityBadge
                  status={row.capacity?.status}
                  t={t}
                  title={row.capacity?.status ? t("millCapDemandOf", { demand: formatKg(row.capacity.demandKg), available: formatKg(row.capacity.availableKg) }) : undefined}
                />
              </td>
            </tr>
          ))}</tbody>
        </ScrollTable>
      )}
      <Dialog
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.plan_code ?? t("feedPlanTableLabel")}
        description={viewing ? `${viewing.plan_type === "ACTUAL" ? t("feedPlanActual") : t("feedPlanTentative")} · ${formatDateShort(viewing.production_date)}` : undefined}
        presentation="compact"
        maxWidth="xl"
        className="max-h-[85vh] w-[95vw] max-w-5xl"
        footer={<Button type="button" variant="outline" onClick={() => setViewing(null)}>{t("close")}</Button>}
      >
        {viewing && (() => {
          const lines = viewing.lines ?? [];
          const na = t("feedPlanUnavailable");
          const sum = (pick: (l: NonNullable<FeedPlanVersion["lines"]>[number]) => string) =>
            lines.reduce((acc, l) => acc + (Number.isFinite(Number(pick(l))) ? Number(pick(l)) : 0), 0);
          const farmOption = farm.farms?.find((f: any) => f.id === farmId);
          const farmText = fixedLabel ?? (farmOption ? feedFarmLabel(farmOption) : null);
          const num = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
          const head = "px-3 py-2 text-left font-medium whitespace-nowrap";
          const headNum = "px-3 py-2 text-right font-medium whitespace-nowrap";
          const cell = (v: number | null) => kg(v, na);
          const optional = (v: string | null) => (v === null ? na : cell(Number(v)));
          const summary: Array<[string, string, boolean?]> = [
            [t("feedPlanTableLabel"), viewing.plan_code],
            ...(farmText ? [[t("feedPlanColFarm"), farmText] as [string, string]] : []),
            [t("feedPlanProductionDate"), `${formatDateShort(viewing.production_date)} · ${viewing.plan_week}`],
            ["Status", viewing.plan_type === "ACTUAL" ? t("feedPlanActual") : t("feedPlanTentative")],
            [t("feedPlanProjected"), cell(sum((l) => l.projected_target_kg)), true],
            [t("feedPlanColTentative"), cell(sum((l) => l.tentative_qty_kg)), true],
          ];
          return (
            <div className="space-y-6">
              <dl className="grid grid-cols-2 gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 sm:grid-cols-3 lg:grid-cols-6">
                {summary.map(([label, value, numeric]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-[var(--text-secondary)]">{label}</dt>
                    <dd className={`mt-1 break-words text-sm font-medium text-[var(--text-primary)] ${numeric ? "tabular-nums" : ""}`} title={value}>{value}</dd>
                  </div>
                ))}
              </dl>
              <section className="space-y-2">
                <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                  <table className="w-full min-w-[56rem] border-collapse text-sm" aria-label={t("feedPlanVersionLines")}>
                    <thead className="bg-[var(--surface-raised)] text-xs text-[var(--text-secondary)]"><tr>
                      <th className={`${head} min-w-[6rem]`}>{t("feedPlanColItemNo")}</th>
                      <th className={`${head} min-w-[12rem]`}>{t("feedPlanColItemName")}</th>
                      <th className={`${headNum} min-w-[7rem]`}>{t("feedPlanProjected")}</th>
                      <th className={`${headNum} min-w-[6rem]`}>{t("feedPlanFactor")} (×)</th>
                      <th className={`${headNum} min-w-[7rem]`}>{t("feedPlanColTentative")}</th>
                      <th className={`${headNum} min-w-[7rem]`}>{t("feedPlanRequested")}</th>
                      <th className={`${headNum} min-w-[7rem]`}>{t("feedPlanMillApproved")}</th>
                      <th className={`${headNum} min-w-[7rem]`}>{t("feedPlanColVariance")}</th>
                    </tr></thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">{lines.map((line) => <tr key={line.plan_line_id}>
                      <td className="px-3 py-2 align-top whitespace-nowrap" title={line.item_code}>{line.item_code}</td>
                      <td className="px-3 py-2 align-top break-words" title={line.item_name}>{line.item_name}</td>
                      <td className={num}>{cell(Number(line.projected_target_kg))}</td>
                      <td className={num}>×{Number(line.adjustment_factor).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                      <td className={num}>{cell(Number(line.tentative_qty_kg))}</td>
                      <td className={num}>{optional(line.requested_qty_kg)}</td>
                      <td className={num}>{optional(line.mill_approved_qty_kg)}</td>
                      <td className={num}>{cell(Number(line.variance_qty_kg))}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </section>
              <section className="space-y-2" aria-labelledby="feed-plan-evidence-heading">
                <h3 id="feed-plan-evidence-heading" className="nf-text-body-strong text-base text-[var(--text-primary)]">
                  {t("feedPlanHistory")}
                </h3>
                <p className="text-sm text-[var(--text-secondary)]">
                  {t("feedPlanEvidenceRange")}: {formatDateShort(viewing.source_from)} – {formatDateShort(viewing.source_to)}
                </p>
                <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                  <table className="w-full min-w-[32rem] border-collapse text-sm" aria-label={t("feedPlanHistory")}>
                    <thead className="bg-[var(--surface-raised)] text-xs text-[var(--text-secondary)]"><tr>
                      <th className={`${head} min-w-[8rem]`}>{t("feedPlanHistoryWeek")}</th>
                      <th className={`${headNum} min-w-[8rem]`}>{t("feedPlanHistoryActual")}</th>
                      <th className={`${headNum} min-w-[8rem]`}>{t("feedPlanHistoryExpected")}</th>
                    </tr></thead>
                    {lines.map((line) => (
                      <tbody key={line.plan_line_id} className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
                        <tr className="bg-[var(--surface-raised)]"><th scope="colgroup" colSpan={3} className="px-3 py-2 text-left font-medium break-words" title={`${line.item_code} ${line.item_name}`}>{line.item_code} · {line.item_name}</th></tr>
                        {line.history_snapshot.map((week) => <tr key={`${line.plan_line_id}:${week.from}`}>
                          <td className="px-3 py-2 whitespace-nowrap">{formatDateShort(week.from)} – {formatDateShort(week.to)}</td>
                          <td className={num}>{cell(Number(week.actualKg))}</td>
                          <td className={num}>{cell(Number(week.expectedKg))}</td>
                        </tr>)}
                      </tbody>
                    ))}
                  </table>
                </div>
              </section>
            </div>
          );
        })()}
      </Dialog>
    </div>
  );
}
