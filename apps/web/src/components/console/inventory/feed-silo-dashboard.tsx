"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { cn } from "@/lib/utils";
import { unwrap } from "./feed-format";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import { FORECAST_VIEWS, type ForecastView } from "./feed-forecast-query";
import {
  FeedForecastProvider,
  useFeedForecastContext,
  useOptionalFeedForecastContext,
} from "./feed-forecast-context";
import { FeedSiloDashboardCards, type SelectedSiloDashboard } from "./feed-silo-dashboard-cards";
import {
  FeedSiloDashboardCharts,
  type BalanceSeriesPoint,
  type DemandSeriesPoint,
} from "./feed-silo-dashboard-charts";

interface Option {
  id: string;
  code: string;
  name: string;
}

interface SiloStatusResponse {
  planningDate: string;
  today: string;
  timeZone: string | null;
  view: ForecastView;
  from: string;
  to: string;
  period: { periodId: string } | null;
  farm: { id: string; code: string; name: string };
  selection: { shedId: string | null; siloId: string | null; sheds: Option[]; silos: Option[] };
  submissionDeadline: string | null;
  silo: SelectedSiloDashboard | null;
  balanceSeries: BalanceSeriesPoint[];
  demandSeries: DemandSeriesPoint[];
  farmTotalOrderKg: number;
}

const VIEW_LABEL: Record<ForecastView, TranslationKeys> = {
  DAILY: "ffViewDaily",
  WEEKLY: "ffViewWeekly",
  PERIOD: "ffViewPeriod",
  CUSTOM: "ffViewCustom",
};
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

function FeedSiloDashboardContent() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const forecast = useFeedForecastContext();
  const {
    farm,
    farmId,
    setFarmId,
    planningDate,
    setPlanningDate,
    view,
    setView,
    from,
    setFrom,
    to,
    setTo,
    periodId,
    hydrateWindow,
  } = forecast;
  const [selection, setSelection] = useState({ farmId, shedId: null as string | null, siloId: null as string | null });
  const [sheds, setSheds] = useState<Option[]>([]);
  const [silos, setSilos] = useState<Option[]>([]);
  const [data, setData] = useState<SiloStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (selection.farmId === farmId) return;
    requestIdRef.current += 1;
    setSelection({ farmId, shedId: null, siloId: null });
    setSheds([]);
    setSilos([]);
    setData(null);
    setError("");
  }, [farmId, selection.farmId]);

  const load = useCallback(async () => {
    if (!farmId || selection.farmId !== farmId) return;
    const requestId = ++requestIdRef.current;
    const requested = { farmId, shedId: selection.shedId, siloId: selection.siloId };
    const params = new URLSearchParams({ farmId, view });
    if (planningDate) params.set("planningDate", planningDate);
    if (from) params.set("from", from);
    if (to && view === "CUSTOM") params.set("to", to);
    if (periodId && view === "PERIOD") params.set("periodId", periodId);
    if (requested.shedId) params.set("shedId", requested.shedId);
    if (requested.siloId) params.set("siloId", requested.siloId);
    setLoading(true);
    setError("");
    try {
      const resolved = unwrap<SiloStatusResponse>(await api.get(`/feed-forecast/silo-status?${params.toString()}`));
      if (requestId !== requestIdRef.current) return;
      setSheds(resolved.selection.sheds ?? []);
      setSilos(resolved.selection.silos ?? []);
      hydrateWindow({
        planningDate: resolved.planningDate,
        view: resolved.view,
        from: resolved.from,
        to: resolved.to,
        periodId: resolved.period?.periodId ?? "",
      });
      if (!requested.shedId) {
        const first = resolved.selection.sheds?.[0]?.id ?? null;
        setSelection({ farmId, shedId: first, siloId: null });
        setData(null);
        return;
      }
      if (!requested.siloId) {
        const first = resolved.selection.silos?.[0]?.id ?? null;
        setSelection({ farmId, shedId: requested.shedId, siloId: first });
        setData(null);
        return;
      }
      if (resolved.selection.shedId === requested.shedId && resolved.selection.siloId === requested.siloId) {
        setData(resolved);
      }
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;
      setError((err instanceof Error && err.message) || tRef.current("fsdLoadFailed"));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [farmId, from, hydrateWindow, periodId, planningDate, reload, selection.farmId, selection.shedId, selection.siloId, to, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const chooseShed = (shedId: string) => {
    requestIdRef.current += 1;
    setSelection({ farmId, shedId: shedId || null, siloId: null });
    setSilos([]);
    setData(null);
    setError("");
  };
  const chooseSilo = (siloId: string) => {
    requestIdRef.current += 1;
    setSelection((current) => ({ ...current, siloId: siloId || null }));
    setData(null);
    setError("");
  };
  const changeView = (next: ForecastView) => {
    setView(next);
    setFrom("");
    setTo("");
  };

  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code
      ? feedFarmLabel({ code: farm.fixedFarm.location_code, name: farm.fixedFarm.location_name ?? "" })
      : data?.farm ? feedFarmLabel(data.farm) : null
    : undefined;
  const noFarms = !farm.isFixed && farm.loaded && farm.farms.length === 0;
  const noSheds = farmId && !loading && sheds.length === 0 && selection.shedId === null;
  const noSilos = selection.shedId && !loading && silos.length === 0 && selection.siloId === null;

  return (
    <div data-fill-body className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain pb-4">
      <div className="shrink-0">
        <h2 className="text-sm font-semibold text-(--text-primary)">{t("fsdTitle")}</h2>
        <p className="mt-0.5 text-xs text-(--text-secondary)">{t("fsdDescription")}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-end gap-3 [&_.nf-input-sm]:h-9">
        <FeedFarmSelect id="sd-farm" label={t("ffFarm")} farms={farm.farms} farmId={farmId} fixedLabel={fixedLabel} onChange={setFarmId} />
        <Field label={t("fsdShed")} htmlFor="sd-shed">
          <select id="sd-shed" className="nf-input-sm nf-select min-w-44" style={inputStyle} value={selection.shedId ?? ""} onChange={(event) => chooseShed(event.target.value)} disabled={!sheds.length}>
            {!selection.shedId && <option value="">{t("fsdSelectShed")}</option>}
            {sheds.map((option) => <option key={option.id} value={option.id}>{option.code} — {option.name}</option>)}
          </select>
        </Field>
        <Field label={t("fsdSilo")} htmlFor="sd-silo">
          <select id="sd-silo" className="nf-input-sm nf-select min-w-44" style={inputStyle} value={selection.siloId ?? ""} onChange={(event) => chooseSilo(event.target.value)} disabled={!selection.shedId || !silos.length}>
            {!selection.siloId && <option value="">{t("fsdSelectSilo")}</option>}
            {silos.map((option) => <option key={option.id} value={option.id}>{option.code} — {option.name}</option>)}
          </select>
        </Field>
        <Field label={t("fsdPlanningDate")} htmlFor="sd-planning-date">
          <input id="sd-planning-date" type="date" className="nf-input-sm" style={inputStyle} value={planningDate} onChange={(event) => setPlanningDate(event.target.value)} />
        </Field>
        <Field label={t("ffView")} htmlFor="sd-view">
          <select id="sd-view" className="nf-input-sm nf-select" style={inputStyle} value={view} onChange={(event) => changeView(event.target.value as ForecastView)}>
            {FORECAST_VIEWS.map((option) => <option key={option} value={option}>{t(VIEW_LABEL[option])}</option>)}
          </select>
        </Field>
        {view !== "PERIOD" && (
          <Field label={t(view === "DAILY" ? "ffDate" : view === "WEEKLY" ? "ffWeekStart" : "ffDateFrom")} htmlFor="sd-from">
            <input id="sd-from" type="date" className="nf-input-sm" style={inputStyle} value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
        )}
        {view === "CUSTOM" && (
          <Field label={t("ffDateTo")} htmlFor="sd-to">
            <input id="sd-to" type="date" className="nf-input-sm" style={inputStyle} value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
        )}
      </div>

      {error && <InlineAlert><span className="mr-3">{error}</span><Button size="sm" variant="outline" onClick={() => setReload((value) => value + 1)}>{t("ffRetry")}</Button></InlineAlert>}
      {farm.failed ? (
        <InlineAlert><span className="mr-3">{t("ffFarmsLoadFailed")}</span><Button size="sm" variant="outline" onClick={farm.retry}>{t("ffRetry")}</Button></InlineAlert>
      ) : !farm.loaded ? (
        <LoadingState label={t("fsdLoading")} />
      ) : noFarms || !farmId ? (
        <EmptyState title={t("ffNoFarms")} />
      ) : noSheds ? (
        <EmptyState title={t("fsdNoSheds")} />
      ) : noSilos ? (
        <EmptyState title={t("fsdNoLinkedSilos")} />
      ) : data?.silo ? (
        <div data-dashboard-content className={cn("transition-opacity", loading && "opacity-50")}>
          <div className="flex min-h-0 flex-col gap-4">
            <FeedSiloDashboardCards silo={data.silo} farmTotalOrderKg={data.farmTotalOrderKg} t={t} />
            <FeedSiloDashboardCharts
              balanceSeries={data.balanceSeries}
              demandSeries={data.demandSeries}
              belowFeedLevelKg={data.silo.belowFeedLevelKg}
              aboveThresholdKg={data.silo.aboveThresholdKg}
              capacityKg={data.silo.capacityKg}
            />
          </div>
        </div>
      ) : loading ? (
        <LoadingState label={t("fsdLoading")} />
      ) : null}
    </div>
  );
}

export default function FeedSiloDashboard() {
  const context = useOptionalFeedForecastContext();
  if (context) return <FeedSiloDashboardContent />;
  return <FeedForecastProvider><FeedSiloDashboardContent /></FeedForecastProvider>;
}
