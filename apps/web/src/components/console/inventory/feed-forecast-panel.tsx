"use client";

/**
 * Inventory -> Feed Forecast (Plans A, R; laid out in Plan S). The farm
 * comes from the shared feed-farm hook (one request, one choice across the
 * feed screens — review A3, A4); the query per view is feed-forecast-query.ts;
 * the grid, the stage table and the notes are their own components. The page
 * is fixed-height (ConsolePage fill): the filters stay put and only the table
 * scrolls (review C). The planning date and range are shown before the first
 * answer (A11) but only sent once the user changes them — the farm's own
 * today is the API's to decide (D16).
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { Tabs } from "@/components/ui/tabs";
import { getActiveWorkspaceScope } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { addDaysIso, formatDateShort, todayIso, unwrap } from "./feed-format";
import { FeedForecastGrid, FeedForecastStages, ReportRow, StageBlock } from "./feed-forecast-grid";
import { FeedForecastNotes, type ForecastFlag } from "./feed-forecast-notes";
import { businessYearStartOf, forecastQueryString, FORECAST_VIEWS, ForecastView } from "./feed-forecast-query";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import { useFeedFarm } from "./use-feed-farm";

interface PeriodOption {
  periodId: string;
  periodCode: string;
  startDate: string;
  endDate: string;
  stockTakeDate: string;
  productionStartDate: string;
}

interface ForecastData {
  planningDate: string;
  today: string;
  timeZone: string | null;
  view: ForecastView;
  from: string;
  to: string;
  forecastFrom: string | null;
  horizonTo: string;
  period: PeriodOption | null;
  farm: { id: string; code: string; name: string };
  rows: ReportRow[];
  stages: StageBlock[];
  flags: ForecastFlag[];
}

const VIEW_LABEL: Record<ForecastView, TranslationKeys> = { DAILY: "ffViewDaily", WEEKLY: "ffViewWeekly", PERIOD: "ffViewPeriod", CUSTOM: "ffViewCustom" };
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const labelCls = "nf-text-label block text-(--text-secondary)";

export default function FeedForecastPanel() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const farm = useFeedFarm();
  const farmId = farm.farmId;

  const [view, setView] = useState<ForecastView>("CUSTOM");
  // "" = the API's default: planning date = the farm's today (D16), from/to = the view's own range.
  const [planningDate, setPlanningDate] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [periods, setPeriods] = useState<PeriodOption[] | null>(null);
  const [periodsFailed, setPeriodsFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"forecast" | "stages">("forecast");

  useEffect(() => {
    if (view !== "PERIOD" || !farmId) {
      setPeriods(null);
      setPeriodsFailed(false);
      return;
    }
    let cancelled = false;
    setPeriodsFailed(false);
    api
      .get(`/feed-forecast/periods?${new URLSearchParams({ farmId }).toString()}`)
      .then((res) => {
        if (cancelled) return;
        const list = unwrap<PeriodOption[]>(res);
        setPeriods(Array.isArray(list) ? list : []);
        setPeriodsFailed(!Array.isArray(list));
      })
      .catch(() => {
        if (cancelled) return;
        setPeriods([]);
        setPeriodsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [farmId, view, reload]);

  useEffect(() => {
    if (!farmId) {
      setData(null);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .get(`/feed-forecast?${forecastQueryString({ farmId, view, planningDate, from: dateFrom, to: dateTo, periodId })}`)
      .then((res) => {
        if (!cancelled) setData(unwrap<ForecastData>(res));
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || tRef.current("ffFailedToLoad"));
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [farmId, view, planningDate, dateFrom, dateTo, periodId, reload]);

  function changeView(next: ForecastView) {
    setView(next);
    setDateFrom("");
    setDateTo("");
    setPeriodId("");
  }

  // Open question Q9: an admin drafts the July–June year, then edits it in the master.
  async function generatePeriods() {
    const year = businessYearStartOf(planningDate || data?.planningDate || todayIso());
    setGenerating(true);
    setGenerateError("");
    try {
      await api.post("/reporting-period/generate", { business_year_start: year });
      setReload((n) => n + 1);
    } catch (err: any) {
      setGenerateError(err?.message || tRef.current("ffGenerateFailed"));
    } finally {
      setGenerating(false);
    }
  }

  const rows = Array.isArray(data?.rows) ? data!.rows : [];
  const stages = Array.isArray(data?.stages) ? data!.stages : [];
  const flags = Array.isArray(data?.flags) ? data!.flags : [];
  const periodList = Array.isArray(periods) ? periods : [];
  const rangeBeforePlanning = !!data && data.forecastFrom === null;
  const rangeStartsAtPlanning = !!data && data.forecastFrom !== null && data.forecastFrom > data.from;
  // A11: what the inputs show before (and between) answers — displayed, not sent.
  const shownPlanning = planningDate || data?.planningDate || todayIso();
  const shownFrom = dateFrom || data?.from || shownPlanning;
  const shownTo = dateTo || data?.to || addDaysIso(shownFrom, 7);
  const businessYear = businessYearStartOf(shownPlanning);
  const isTenantWorkspace = getActiveWorkspaceScope() === "TENANT";
  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code
      ? feedFarmLabel({ code: farm.fixedFarm.location_code, name: farm.fixedFarm.location_name ?? "" })
      : data?.farm
        ? feedFarmLabel(data.farm)
        : null
    : undefined;
  const noFarms = !farm.isFixed && farm.loaded && farm.farms.length === 0;

  return (
    <div data-fill-body>
      {/* One row at >=1024px (review, 27 Sep): a wrapped filter row left
          "Date To" alone on a second line and took a third of the table's
          height. The date pair shares a container so it never splits. */}
      <div className="flex shrink-0 flex-wrap items-end gap-3 lg:flex-nowrap">
        <FeedFarmSelect id="ff-farm" label={t("ffFarm")} farms={farm.farms} farmId={farmId} onChange={farm.setFarmId} fixedLabel={fixedLabel} />
        <div>
          <label className={labelCls} htmlFor="ff-planning">{t("ffPlanningDate")}</label>
          <input id="ff-planning" type="date" value={shownPlanning} onChange={(e) => setPlanningDate(e.target.value)} className="nf-input-sm mt-1.5" style={inputStyle}
            title={data ? (data.timeZone ? t("ffTimeZone", { zone: data.timeZone }) : t("ffServerDay")) : undefined} />
        </div>
        <div>
          <label className={labelCls} htmlFor="ff-view">{t("ffView")}</label>
          <select id="ff-view" value={view} onChange={(e) => changeView(e.target.value as ForecastView)} className="nf-input-sm nf-select mt-1.5" style={inputStyle}>
            {FORECAST_VIEWS.map((v) => <option key={v} value={v}>{t(VIEW_LABEL[v])}</option>)}
          </select>
        </div>
        <div className="flex min-w-0 items-end gap-3">
        {view === "PERIOD" ? (
          <div>
            <label className={labelCls} htmlFor="ff-period">{t("ffReportingPeriod")}</label>
            <select id="ff-period" value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="nf-input-sm nf-select mt-1.5" style={inputStyle}>
              <option value="">{t("ffPeriodCovering")}</option>
              {periodList.map((p) => (
                <option key={p.periodId} value={p.periodId}>{t("ffPeriodOption", { code: p.periodCode, from: formatDateShort(p.startDate), to: formatDateShort(p.endDate) })}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className={labelCls} htmlFor="ff-from">{t(view === "DAILY" ? "ffDate" : view === "WEEKLY" ? "ffWeekStart" : "ffDateFrom")}</label>
            <input id="ff-from" type="date" value={shownFrom} onChange={(e) => setDateFrom(e.target.value)} className="nf-input-sm mt-1.5" style={inputStyle} />
          </div>
        )}
        {view === "CUSTOM" && (
          <div>
            <label className={labelCls} htmlFor="ff-to">{t("ffDateTo")}</label>
            <input id="ff-to" type="date" value={shownTo} onChange={(e) => setDateTo(e.target.value)} className="nf-input-sm mt-1.5" style={inputStyle} />
          </div>
        )}
        </div>
      </div>

      {view === "PERIOD" && !!farmId && periodsFailed && <InlineAlert>{t("ffPeriodsLoadFailed")}</InlineAlert>}
      {view === "PERIOD" && !!farmId && !periodsFailed && periods !== null && periodList.length === 0 && (
        <InlineAlert variant="info">
          <span className="mr-3">{t("ffNoPeriods")}</span>
          <Button size="sm" variant="outline" onClick={generatePeriods} disabled={generating || isTenantWorkspace}>
            {t("ffGenerateDraftPeriods", { year: businessYear })}
          </Button>
          {isTenantWorkspace && <span className="ml-3 text-xs" style={{ color: "var(--text-secondary)" }}>{t("ffGenerateNeedsCompany")}</span>}
          {generateError && <span className="ml-3 text-xs" style={{ color: "var(--danger)" }}>{generateError}</span>}
        </InlineAlert>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
      {rangeBeforePlanning && !error && <InlineAlert variant="info">{t("ffNoteRangeBeforePlanning", { date: formatDateShort(data!.planningDate) })}</InlineAlert>}
      {rangeStartsAtPlanning && !error && <InlineAlert variant="info">{t("ffNoteRangeStartsAtPlanning", { date: formatDateShort(data!.forecastFrom!) })}</InlineAlert>}

      {farm.failed ? (
        // The request failed: say so and offer to try again. "No farms to show."
        // would claim this user has none, which is a different fact.
        <InlineAlert>
          <span className="mr-3">{t("ffFarmsLoadFailed")}</span>
          <Button size="sm" variant="outline" onClick={farm.retry}>{t("ffRetry")}</Button>
        </InlineAlert>
      ) : !farm.loaded ? (
        <LoadingState label={t("ffLoading")} />
      ) : noFarms || (!farmId && !farm.isFixed) ? (
        <EmptyState title={t("ffNoFarms")} />
      ) : error ? null : (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <Tabs
              items={[
                { value: "forecast", label: t("ffTabForecast") },
                { value: "stages", label: t("ffTabStages", { count: stages.length }) },
              ]}
              value={tab}
              onChange={(v) => setTab(v as "forecast" | "stages")}
            />
          </div>
          {tab === "forecast"
            ? <FeedForecastGrid rows={rows} loading={loading} horizonTo={data?.horizonTo ?? null} t={t} />
            : <FeedForecastStages stages={stages} t={t} />}
          <FeedForecastNotes flags={flags} t={t} />
        </>
      )}
    </div>
  );
}
