"use client";

/**
 * Inventory -> Feed Forecast (Plans A, R; laid out in Plan S). The farm
 * comes from the shared feed-farm hook (one request, one choice across the
 * feed screens — review A3, A4); the query per view is feed-forecast-query.ts;
 * the workbook grid and the notes are their own components. The page
 * is fixed-height (ConsolePage fill): the filters stay put and only the table
 * scrolls (review C). The planning date and range are shown before the first
 * answer (A11) but only sent once the user changes them — the farm's own
 * today is the API's to decide (D16).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { getActiveWorkspaceScope, getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { formatDateShort, todayIso, unwrap } from "./feed-format";
import { FeedForecastGrid, ReportRow, SourceBalancePoint } from "./feed-forecast-grid";
import { FeedForecastNotes, type ForecastFlag } from "./feed-forecast-notes";
import { businessYearStartOf, forecastQueryString, FORECAST_VIEWS, ForecastView } from "./feed-forecast-query";
import { FeedFarmSelect, feedFarmLabel } from "./feed-farm-select";
import { FeedForecastRunHistory } from "./feed-forecast-run-history";
import { FeedRequisitionDetail } from "./feed-requisition-detail";
import { FeedRequisitionFromRunDialog } from "./feed-requisition-from-run-dialog";
import type { RequisitionView } from "./feed-requisition-document";
import { setForecastWindow } from "./feed-forecast-window";
import {
  FeedForecastProvider,
  useFeedForecastContext,
  useOptionalFeedForecastContext,
} from "./feed-forecast-context";

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
  sourceBalances: SourceBalancePoint[];
  flags: ForecastFlag[];
}

type CalculationState = "EMPTY" | "CALCULATED" | "SAVED";

interface CurrentForecastRun {
  run_id?: string;
  runId?: string;
  run_code?: string;
  runCode?: string;
  version: number;
  existingRequisitionId?: string | null;
  canCreateRequisition?: boolean;
  output_snapshot?: { display?: SavedForecastDisplay };
}

type SavedForecastDisplay = Partial<ForecastData> & {
  filters?: {
    planningDate: string;
    from: string;
    to: string;
    view: ForecastView;
    periodId: string | null;
  };
};

interface ResultFilters {
  shedId: string;
  siloId: string;
  batchId: string;
  itemId: string;
  feedType: string;
}

const EMPTY_FILTERS: ResultFilters = { shedId: "", siloId: "", batchId: "", itemId: "", feedType: "" };

const VIEW_LABEL: Record<ForecastView, TranslationKeys> = { DAILY: "ffViewDaily", WEEKLY: "ffViewWeekly", PERIOD: "ffViewPeriod", CUSTOM: "ffViewCustom" };
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const labelCls = "nf-text-label block text-(--text-secondary)";

function FeedForecastPanelContent() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;

  const forecast = useFeedForecastContext();
  const {
    farm,
    farmId,
    setFarmId,
    view,
    setView,
    planningDate,
    setPlanningDate,
    from: dateFrom,
    setFrom: setDateFrom,
    to: dateTo,
    setTo: setDateTo,
    periodId,
    setPeriodId,
    hydrateWindow,
  } = forecast;
  const [periods, setPeriods] = useState<PeriodOption[] | null>(null);
  const [periodsFailed, setPeriodsFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [data, setData] = useState<ForecastData | null>(null);
  const [calculationState, setCalculationState] = useState<CalculationState>("EMPTY");
  const [currentRun, setCurrentRun] = useState<CurrentForecastRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<ResultFilters>(EMPTY_FILTERS);
  const [savingRun, setSavingRun] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const [runError, setRunError] = useState("");
  const [runHistoryReload, setRunHistoryReload] = useState(0);
  const [fromRunOpen, setFromRunOpen] = useState(false);
  const [createdRequisition, setCreatedRequisition] = useState<RequisitionView | null>(null);

  useEffect(() => setFilters(EMPTY_FILTERS), [farmId]);

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
      setCurrentRun(null);
      setCalculationState("EMPTY");
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .get(`/feed-forecast/runs/current?${new URLSearchParams({ farmId }).toString()}`)
      .then(async (response) => {
        if (cancelled) return;
        const run = (response && typeof response === "object" && "data" in response ? response.data : response) as CurrentForecastRun | null;
        const display = run?.output_snapshot?.display;
        const filters = display?.filters;
        if (!run || !display || !filters) {
          setCurrentRun(null);
          setCalculationState("EMPTY");
          setData(null);
          return;
        }
        const resolved = {
          ...display,
          planningDate: filters.planningDate,
          from: filters.from,
          to: filters.to,
          view: filters.view,
          period: display.period ?? null,
          rows: Array.isArray(display.rows) ? display.rows : [],
          sourceBalances: Array.isArray(display.sourceBalances) ? display.sourceBalances : [],
          flags: Array.isArray(display.flags) ? display.flags : [],
        } as ForecastData;
        const runId = run.run_id ?? run.runId;
        let existingRequisitionId: string | null = null;
        let canCreateRequisition = false;
        if (runId) {
          try {
            const preview = unwrap<{ existingRequisitionId?: string | null; lines?: unknown[] }>(await api.get(`/feed-requisition/from-run/${runId}/preview`));
            existingRequisitionId = preview.existingRequisitionId ?? null;
            canCreateRequisition = !!existingRequisitionId || (Array.isArray(preview.lines) && preview.lines.length > 0);
          } catch {
            // A saved calculation with no material shortage remains viewable,
            // but it must not offer a requisition that the API will refuse.
          }
        }
        if (cancelled) return;
        setCurrentRun({ ...run, existingRequisitionId, canCreateRequisition });
        setCalculationState("SAVED");
        setData(resolved);
        hydrateWindow({
          planningDate: resolved.planningDate,
          view: resolved.view,
          from: resolved.from,
          to: resolved.to,
          periodId: resolved.period?.periodId ?? "",
        });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || tRef.current("ffFailedToLoad"));
        setData(null);
        setCurrentRun(null);
        setCalculationState("EMPTY");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [farmId, hydrateWindow]);

  // Share the window on screen with the Feed Requisition tab's "Draft from forecast".
  useEffect(() => {
    if (farmId && data && data.farm.id === farmId) setForecastWindow({ farmId, from: data.from, to: data.to });
  }, [farmId, data]);

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

  async function saveRun() {
    if (!farmId || !data) return;
    setSavingRun(true);
    setRunMessage("");
    setRunError("");
    try {
      const response = await api.post("/feed-forecast/runs", {
        farmId,
        planningDate: planningDate || data.planningDate,
        view,
        from: dateFrom || data.from,
        to: dateTo || data.to,
        ...(view === "PERIOD" && (periodId || data.period?.periodId) ? { periodId: periodId || data.period!.periodId } : {}),
      });
      const saved = unwrap<{ runCode: string; version: number }>(response);
      let canCreateRequisition = false;
      let existingRequisitionId: string | null = null;
      const savedRunId = (saved as CurrentForecastRun).run_id ?? (saved as CurrentForecastRun).runId;
      if (savedRunId) {
        try {
          const preview = unwrap<{ existingRequisitionId?: string | null; lines?: unknown[] }>(await api.get(`/feed-requisition/from-run/${savedRunId}/preview`));
          existingRequisitionId = preview.existingRequisitionId ?? null;
          canCreateRequisition = !!existingRequisitionId || (Array.isArray(preview.lines) && preview.lines.length > 0);
        } catch {
          canCreateRequisition = false;
        }
      }
      setCurrentRun({ ...saved, existingRequisitionId, canCreateRequisition });
      setCalculationState("SAVED");
      setRunMessage(tRef.current("ffRunSaved", { code: saved.runCode, version: saved.version }));
      setRunHistoryReload((value) => value + 1);
    } catch (err: any) {
      setRunError(err?.message || tRef.current("ffSaveRunFailed"));
    } finally {
      setSavingRun(false);
    }
  }

  async function calculate() {
    if (!farmId || currentRun) return;
    setLoading(true);
    setError("");
    setRunMessage("");
    setRunError("");
    try {
      const response = await api.get(`/feed-forecast?${forecastQueryString({ farmId, view, planningDate, from: dateFrom, to: dateTo, periodId })}`);
      const resolved = unwrap<ForecastData>(response);
      setData(resolved);
      setCalculationState("CALCULATED");
      hydrateWindow({
        planningDate: resolved.planningDate,
        view: resolved.view,
        from: resolved.from,
        to: resolved.to,
        periodId: resolved.period?.periodId ?? "",
      });
    } catch (err: any) {
      setError(err?.message || tRef.current("ffFailedToLoad"));
    } finally {
      setLoading(false);
    }
  }

  async function deleteCalculation() {
    const runId = currentRun?.run_id ?? currentRun?.runId;
    if (!runId) return;
    setRunError("");
    try {
      await api.delete(`/feed-forecast/runs/${runId}`);
      setCurrentRun(null);
      setData(null);
      setCalculationState("EMPTY");
      setRunMessage(tRef.current("ffCalculationDeleted"));
      setRunHistoryReload((value) => value + 1);
    } catch (err: any) {
      setRunError(err?.message || tRef.current("ffDeleteCalculationFailed"));
    }
  }

  const rows = Array.isArray(data?.rows) ? data!.rows : [];
  const sourceBalances = Array.isArray(data?.sourceBalances) ? data!.sourceBalances : [];
  const flags = Array.isArray(data?.flags) ? data!.flags : [];
  const resultOptions = useMemo(() => {
    const selected = (row: ReportRow, through: keyof ResultFilters) => {
      if (through !== "shedId" && filters.shedId && row.shedId !== filters.shedId) return false;
      if (!(["shedId", "siloId"] as Array<keyof ResultFilters>).includes(through) && filters.siloId && row.sourceLocationId !== filters.siloId) return false;
      if (!(["shedId", "siloId", "batchId"] as Array<keyof ResultFilters>).includes(through) && filters.batchId && row.batchId !== filters.batchId) return false;
      if (through === "feedType" && filters.itemId && row.itemId !== filters.itemId) return false;
      return true;
    };
    const unique = (candidates: ReportRow[], id: (row: ReportRow) => string | null, label: (row: ReportRow) => string) => {
      const values = new Map<string, string>();
      for (const row of candidates) {
        const key = id(row);
        if (key && !values.has(key)) values.set(key, label(row));
      }
      return [...values].map(([value, text]) => ({ value, text })).sort((left, right) => left.text.localeCompare(right.text));
    };
    return {
      sheds: unique(rows, (row) => row.shedId, (row) => row.shedCode),
      silos: unique(rows.filter((row) => selected(row, "siloId")), (row) => row.sourceLocationId, (row) => [row.sourceCode, row.sourceName].filter(Boolean).join(" — ")),
      batches: unique(rows.filter((row) => selected(row, "batchId")), (row) => row.batchId, (row) => row.batchNo),
      items: unique(rows.filter((row) => selected(row, "itemId")), (row) => row.itemId, (row) => [row.itemNo, row.itemName].filter(Boolean).join(" — ")),
      feedTypes: unique(rows.filter((row) => selected(row, "feedType")), (row) => row.feedType, (row) => row.feedType),
    };
  }, [filters, rows]);
  const filteredRows = rows.filter((row) =>
    (!filters.shedId || row.shedId === filters.shedId)
    && (!filters.siloId || row.sourceLocationId === filters.siloId)
    && (!filters.batchId || row.batchId === filters.batchId)
    && (!filters.itemId || row.itemId === filters.itemId)
    && (!filters.feedType || row.feedType === filters.feedType),
  );
  const visibleSources = new Set(filteredRows.map((row) => `${row.sourceLocationId ?? row.sourceCode ?? "NONE"}|${row.itemId}`));
  const filteredSourceBalances = sourceBalances.filter((point) => visibleSources.has(`${point.locationId}|${point.itemId}`));
  const periodList = Array.isArray(periods) ? periods : [];
  const rangeBeforePlanning = !!data && data.forecastFrom === null;
  const rangeStartsAtPlanning = !!data && data.forecastFrom !== null && data.forecastFrom > data.from;
  // The API resolves the farm-local day. Showing the browser's local date while
  // that request is pending would put a false planning context on screen.
  const shownPlanning = planningDate || data?.planningDate || "";
  const shownFrom = dateFrom || data?.from || "";
  const shownTo = dateTo || data?.to || "";
  const businessYear = businessYearStartOf(shownPlanning);
  const isTenantWorkspace = getActiveWorkspaceScope() === "TENANT";
  const canSaveRun = hasPermission(getStoredUser(), "INVENTORY", "LEDGER", "can_create");
  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code
      ? feedFarmLabel({ code: farm.fixedFarm.location_code, name: farm.fixedFarm.location_name ?? "" })
      : data?.farm
        ? feedFarmLabel(data.farm)
        : null
    : undefined;
  const noFarms = !farm.isFixed && farm.loaded && farm.farms.length === 0;

  return (
    <div data-fill-body className="w-full">
      {/* One row at >=1024px (review, 27 Sep): a wrapped filter row left
          "Date To" alone on a second line and took a third of the table's
          height. The date pair shares a container so it never splits. */}
      <div className="flex shrink-0 flex-wrap items-end gap-3 lg:flex-nowrap">
        <FeedFarmSelect id="ff-farm" label={t("ffFarm")} farms={farm.farms} farmId={farmId} onChange={setFarmId} fixedLabel={fixedLabel} />
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

      {!!data && (
        <div className="mt-3 flex shrink-0 flex-wrap items-end gap-3" aria-label={t("ffResultFilters")}>
          <ResultFilter id="ff-filter-shed" label={t("ffFilterShed")} value={filters.shedId} options={resultOptions.sheds} allLabel={t("ffFilterAll")}
            onChange={(shedId) => setFilters({ ...EMPTY_FILTERS, shedId })} />
          <ResultFilter id="ff-filter-silo" label={t("ffFilterSilo")} value={filters.siloId} options={resultOptions.silos} allLabel={t("ffFilterAll")}
            onChange={(siloId) => setFilters((current) => ({ ...EMPTY_FILTERS, shedId: current.shedId, siloId }))} />
          <ResultFilter id="ff-filter-batch" label={t("ffFilterBatch")} value={filters.batchId} options={resultOptions.batches} allLabel={t("ffFilterAll")}
            onChange={(batchId) => setFilters((current) => ({ ...EMPTY_FILTERS, shedId: current.shedId, siloId: current.siloId, batchId }))} />
          <ResultFilter id="ff-filter-item" label={t("ffFilterFeedItem")} value={filters.itemId} options={resultOptions.items} allLabel={t("ffFilterAll")}
            onChange={(itemId) => setFilters((current) => ({ ...current, itemId, feedType: "" }))} />
          <ResultFilter id="ff-filter-type" label={t("ffFilterFeedType")} value={filters.feedType}
            options={resultOptions.feedTypes.map((option) => ({ ...option, text: option.value === "BAGGED" ? t("ffFeedTypeBagged") : t("ffFeedTypeBulk") }))}
            allLabel={t("ffFilterAll")} onChange={(feedType) => setFilters((current) => ({ ...current, feedType }))} />
        </div>
      )}

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
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-2">
              {runMessage && <span className="text-xs text-[var(--success)]">{runMessage}</span>}
              {runError && <span className="text-xs text-[var(--danger)]">{runError}</span>}
              {calculationState === "EMPTY" && (
                <Button size="sm" onClick={calculate} disabled={!farmId || loading || (view === "PERIOD" && !periodId)}>
                  {loading ? t("ffCalculating") : t("ffCalculate")}
                </Button>
              )}
              {canSaveRun && calculationState === "CALCULATED" && (
                <Button size="sm" onClick={saveRun} disabled={!data || loading || savingRun}>
                  {savingRun ? t("ffSavingRun") : t("ffSaveRun")}
                </Button>
              )}
              {canSaveRun && calculationState === "SAVED" && (
                <>
                  {(currentRun?.existingRequisitionId || currentRun?.canCreateRequisition) && (
                    <Button size="sm" onClick={() => setFromRunOpen(true)}>
                      {t(currentRun?.existingRequisitionId ? "rqViewRequisition" : "rqCreateFromSaved")}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={deleteCalculation}>{t("ffDeleteCalculation")}</Button>
                </>
              )}
            </div>
          </div>
          {data ? (
            <>
              <FeedForecastGrid rows={filteredRows} sourceBalances={filteredSourceBalances} view={data.view} from={data.from} loading={loading} t={t} />
              <FeedForecastNotes flags={flags} t={t} />
            </>
          ) : loading ? <LoadingState label={t("ffLoading")} /> : <EmptyState title={t("ffCalculatePrompt")} />}
          {!!farmId && <FeedForecastRunHistory farmId={farmId} reloadToken={runHistoryReload} />}
          <FeedRequisitionFromRunDialog
            open={fromRunOpen}
            runId={currentRun?.run_id ?? currentRun?.runId ?? null}
            onClose={() => setFromRunOpen(false)}
            onView={(view) => {
              setFromRunOpen(false);
              setCreatedRequisition(view);
              setCurrentRun((run) => run ? { ...run, existingRequisitionId: view.requisition_id } : run);
            }}
          />
          {createdRequisition && (
            <Dialog open onClose={() => setCreatedRequisition(null)} title={createdRequisition.req_no}>
              <FeedRequisitionDetail embedded view={createdRequisition} onView={setCreatedRequisition} onBack={() => setCreatedRequisition(null)} />
            </Dialog>
          )}
        </>
      )}
    </div>
  );
}

function ResultFilter({ id, label, value, options, allLabel, onChange }: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; text: string }>;
  allLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className={labelCls} htmlFor={id}>{label}</label>
      <select id={id} className="nf-input-sm nf-select mt-1.5 min-w-[10rem]" style={inputStyle} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.text}</option>)}
      </select>
    </div>
  );
}

export default function FeedForecastPanel() {
  const context = useOptionalFeedForecastContext();
  if (context) return <FeedForecastPanelContent />;
  return (
    <FeedForecastProvider>
      <FeedForecastPanelContent />
    </FeedForecastProvider>
  );
}
