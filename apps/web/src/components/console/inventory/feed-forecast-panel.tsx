'use client';

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
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '@/services/api-client';
import { InlineAlert } from '@/components/ui/alert';
import { showToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, LoadingState } from '@/components/ui/states';
import {
  getActiveWorkspaceScope,
  getStoredUser,
  hasPermission,
} from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { formatDateShort, todayIso, unwrap } from './feed-format';
import {
  DietChange,
  FeedForecastGrid,
  ReportRow,
  SourceBalancePoint,
} from './feed-forecast-grid';
import { FeedForecastNotes, type ForecastFlag } from './feed-forecast-notes';
import {
  businessYearStartOf,
  clampToPlanning,
  forecastQueryString,
  FORECAST_VIEWS,
  FORECAST_VIEW_LABEL,
  ForecastView,
} from './feed-forecast-query';
import { FeedFarmSelect, feedFarmLabel } from './feed-farm-select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { FeedForecastRunHistory } from './feed-forecast-run-history';
import { FeedRequisitionDetail } from './feed-requisition-detail';
import { FeedRequisitionFromRunDialog } from './feed-requisition-from-run-dialog';
import type { RequisitionView } from './feed-requisition-document';
import { setForecastWindow } from './feed-forecast-window';
import { countedRequisitions, requisitionCover, type OpenRequisitionLine, type ShortSource } from './requisition-cover';
import {
  FeedForecastProvider,
  useFeedForecastContext,
  useOptionalFeedForecastContext,
} from './feed-forecast-context';

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
  dietChanges?: DietChange[];
  /** The sources the forecast ran short, with their need and first shortage (requisitionCover). */
  sources?: ShortSource[];
}

type CalculationState = 'EMPTY' | 'CALCULATED' | 'SAVED';

interface CoveredLine {
  destination_code: string;
  item_name: string;
  covered_by: string[];
}

interface CurrentForecastRun {
  run_id?: string;
  runId?: string;
  run_code?: string;
  runCode?: string;
  version: number;
  existingRequisitionId?: string | null;
  canCreateRequisition?: boolean;
  /** Rishi, 31 Oct: run-downs another open requisition already solves, so they are not offered again. */
  coveredLines?: CoveredLine[];
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

const inputStyle = {
  backgroundColor: 'var(--input-bg)',
  color: 'var(--input-text)',
  borderColor: 'var(--input-border)',
};
const labelCls = 'nf-text-label block text-(--text-secondary)';

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
  const [savedRunFailed, setSavedRunFailed] = useState(false);
  const [savedRunReload, setSavedRunReload] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [data, setData] = useState<ForecastData | null>(null);
  const [calculationState, setCalculationState] =
    useState<CalculationState>('EMPTY');
  const [currentRun, setCurrentRun] = useState<CurrentForecastRun | null>(null);
  const [historicalRun, setHistoricalRun] = useState(false);
  const [loading, setLoading] = useState(false);
  // Rishi, 31 Oct: true only while Calculate runs — loading the saved calculation is not calculating.
  const [calculating, setCalculating] = useState(false);
  const [openLines, setOpenLines] = useState<OpenRequisitionLine[]>([]);
  const viewToken = useRef(0);
  const [savingRun, setSavingRun] = useState(false);
  const [runHistoryReload, setRunHistoryReload] = useState(0);
  const [fromRunOpen, setFromRunOpen] = useState(false);
  const [createdRequisition, setCreatedRequisition] =
    useState<RequisitionView | null>(null);

  useEffect(() => {
    if (view !== 'PERIOD' || !farmId) {
      setPeriods(null);
      setPeriodsFailed(false);
      return;
    }
    let cancelled = false;
    setPeriodsFailed(false);
    api
      .get(
        `/feed-forecast/periods?${new URLSearchParams({ farmId }).toString()}`,
      )
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
      setCalculationState('EMPTY');
      return;
    }
    let cancelled = false;
    // A run opened by id (`?runId=` or the history list) bumps the token; a
    // current-run response that lands after it is stale and is discarded.
    const token = viewToken.current;
    const superseded = () => cancelled || token !== viewToken.current;
    setLoading(true);
    setSavedRunFailed(false);
    api
      .get(
        `/feed-forecast/runs/current?${new URLSearchParams({ farmId }).toString()}`,
      )
      .then(async (response) => {
        if (superseded()) return;
        const run = (
          response && typeof response === 'object' && 'data' in response
            ? response.data
            : response
        ) as CurrentForecastRun | null;
        const display = run?.output_snapshot?.display;
        const filters = display?.filters;
        if (!run || !display || !filters) {
          setCurrentRun(null);
          setCalculationState('EMPTY');
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
          sourceBalances: Array.isArray(display.sourceBalances)
            ? display.sourceBalances
            : [],
          flags: Array.isArray(display.flags) ? display.flags : [],
          dietChanges: Array.isArray(display.dietChanges) ? display.dietChanges : [],
        } as ForecastData;
        const runId = run.run_id ?? run.runId;
        let existingRequisitionId: string | null = null;
        let canCreateRequisition = false;
        let coveredLines: CoveredLine[] = [];
        if (runId) {
          try {
            const preview = unwrap<{
              existingRequisitionId?: string | null;
              lines?: unknown[];
              covered_lines?: CoveredLine[];
            }>(await api.get(`/feed-requisition/from-run/${runId}/preview`));
            existingRequisitionId = preview.existingRequisitionId ?? null;
            coveredLines = Array.isArray(preview.covered_lines) ? preview.covered_lines : [];
            canCreateRequisition =
              !!existingRequisitionId ||
              (Array.isArray(preview.lines) && preview.lines.length > 0);
          } catch {
            // A saved calculation with no material shortage remains viewable,
            // but it must not offer a requisition that the API will refuse.
          }
        }
        if (superseded()) return;
        setCurrentRun({ ...run, existingRequisitionId, canCreateRequisition, coveredLines });
        setCalculationState('SAVED');
        setData(resolved);
        hydrateWindow({
          planningDate: resolved.planningDate,
          view: resolved.view,
          from: resolved.from,
          to: resolved.to,
          periodId: resolved.period?.periodId ?? '',
        });
      })
      .catch((err: any) => {
        if (superseded()) return;
        showToast.error(err?.message || tRef.current('ffFailedToLoad'));
        setSavedRunFailed(true);
        setData(null);
        setCurrentRun(null);
        setCalculationState('EMPTY');
      })
      .finally(() => {
        if (!superseded()) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [farmId, hydrateWindow, savedRunReload]);

  // The farm's open feed requisitions, read when a calculation is on screen unsaved, for its cover check.
  useEffect(() => {
    if (!farmId || calculationState !== 'CALCULATED') return;
    let alive = true;
    api
      .get(`/feed-requisition/open-lines?${new URLSearchParams({ farmId }).toString()}`)
      .then((res) => {
        const list = unwrap<OpenRequisitionLine[]>(res);
        if (alive) setOpenLines(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        // Without the list nothing is taken as covered: Save & Create stays offered.
        if (alive) setOpenLines([]);
      });
    return () => {
      alive = false;
    };
  }, [farmId, calculationState, data]);

  // Share the window on screen with the Feed Requisition tab's "Draft from forecast".
  useEffect(() => {
    if (farmId && data && data.farm.id === farmId)
      setForecastWindow({ farmId, from: data.from, to: data.to });
  }, [farmId, data]);

  function changeView(next: ForecastView) {
    setView(next);
    setDateFrom('');
    setDateTo('');
    setPeriodId('');
  }

  // Open question Q9: an admin drafts the July–June year, then edits it in the master.
  async function generatePeriods() {
    const year = businessYearStartOf(
      planningDate || data?.planningDate || todayIso(),
    );
    setGenerating(true);
    try {
      await api.post('/reporting-period/generate', {
        business_year_start: year,
      });
      setReload((n) => n + 1);
    } catch (err: any) {
      showToast.error(err?.message || tRef.current('ffGenerateFailed'));
    } finally {
      setGenerating(false);
    }
  }

  // Save & Create Requisition passes true. Read from state, the flag would still be false in this call.
  async function saveRun(thenCreateRequisition = false) {
    if (!farmId || !data) return;
    setSavingRun(true);
    try {
      const response = await api.post('/feed-forecast/runs', {
        farmId,
        planningDate: planningDate || data.planningDate,
        view,
        from: dateFrom || data.from,
        to: dateTo || data.to,
        ...(view === 'PERIOD' && (periodId || data.period?.periodId)
          ? { periodId: periodId || data.period!.periodId }
          : {}),
      });
      const saved = unwrap<{ runCode: string; version: number }>(response);
      let canCreateRequisition = false;
      let existingRequisitionId: string | null = null;
      let coveredLines: CoveredLine[] = [];
      const savedRunId =
        (saved as CurrentForecastRun).run_id ??
        (saved as CurrentForecastRun).runId;
      if (savedRunId) {
        try {
          const preview = unwrap<{
            existingRequisitionId?: string | null;
            lines?: unknown[];
            covered_lines?: CoveredLine[];
          }>(await api.get(`/feed-requisition/from-run/${savedRunId}/preview`));
          existingRequisitionId = preview.existingRequisitionId ?? null;
          coveredLines = Array.isArray(preview.covered_lines) ? preview.covered_lines : [];
          canCreateRequisition =
            !!existingRequisitionId ||
            (Array.isArray(preview.lines) && preview.lines.length > 0);
        } catch {
          canCreateRequisition = false;
        }
      }
      setCurrentRun({ ...saved, existingRequisitionId, canCreateRequisition, coveredLines });
      setCalculationState('SAVED');
      if (thenCreateRequisition && canCreateRequisition && !existingRequisitionId) {
        setFromRunOpen(true);
      }
      showToast.success(
        tRef.current('ffRunSaved', {
          code: saved.runCode,
          version: saved.version,
        }),
      );
      setRunHistoryReload((value) => value + 1);
    } catch (err: any) {
      showToast.error(err?.message || tRef.current('ffSaveRunFailed'));
    } finally {
      setSavingRun(false);
    }
  }

  async function calculate() {
    if (!farmId || currentRun) return;
    setLoading(true);
    setCalculating(true);
    try {
      const response = await api.get(
        `/feed-forecast?${forecastQueryString({ farmId, view, planningDate, from: dateFrom, to: dateTo, periodId })}`,
      );
      const resolved = unwrap<ForecastData>(response);
      setData(resolved);
      setCalculationState('CALCULATED');
      hydrateWindow({
        planningDate: resolved.planningDate,
        view: resolved.view,
        from: resolved.from,
        to: resolved.to,
        periodId: resolved.period?.periodId ?? '',
      });
    } catch (err: any) {
      showToast.error(err?.message || tRef.current('ffFailedToLoad'));
    } finally {
      setLoading(false);
      setCalculating(false);
    }
  }

  // A saved calculation's dates were copied into the filters when it loaded. Once it is gone, the next
  // calculation plans from today (the API's farm day) — not from the deleted run's planning date.
  function resetWindowToToday() {
    setPlanningDate('');
    setDateFrom('');
    setDateTo('');
    setPeriodId('');
  }

  async function deleteCalculation() {
    const runId = currentRun?.run_id ?? currentRun?.runId;
    if (!runId) return;
    try {
      await api.delete(`/feed-forecast/runs/${runId}`);
      setCurrentRun(null);
      setData(null);
      setCalculationState('EMPTY');
      resetWindowToToday();
      showToast.success(tRef.current('ffCalculationDeleted'));
      setRunHistoryReload((value) => value + 1);
    } catch (err: any) {
      showToast.error(
        err?.message || tRef.current('ffDeleteCalculationFailed'),
      );
    }
  }

  // A6: `?runId=` opens a saved run through the same endpoint "View calculation" uses.
  // Opening a run bumps `viewToken`, so a current-run load still in flight cannot overwrite it.
  const pendingRunId = useRef<string | null>(null);
  if (pendingRunId.current === null && typeof window !== 'undefined') {
    pendingRunId.current =
      new URLSearchParams(window.location.search).get('runId') ?? '';
  }
  useEffect(() => {
    const runId = pendingRunId.current;
    if (!runId || !farmId) return;
    pendingRunId.current = '';
    void viewHistoricalRun(runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmId]);

  async function viewHistoricalRun(runId: string) {
    viewToken.current += 1;
    const token = viewToken.current;
    setLoading(false);
    try {
      const run = unwrap<any>(await api.get(`/feed-forecast/runs/${runId}`));
      if (token !== viewToken.current) return;
      const display = run?.output_snapshot?.display;
      if (!display?.rows || !display?.filters)
        throw new Error(
          'This saved run has no restorable calculation snapshot.',
        );
      setData({
        ...display,
        planningDate: display.filters.planningDate,
        view: display.filters.view,
        from: display.filters.from,
        to: display.filters.to,
        period: display.period ?? null,
        farm: display.farm,
      } as ForecastData);
      hydrateWindow(display.filters);
      setCurrentRun({
        run_id: run.run_id,
        run_code: run.run_code,
        version: run.version,
        existingRequisitionId: null,
        canCreateRequisition: false,
      });
      setHistoricalRun(true);
      setCalculationState('SAVED');
    } catch (err: any) {
      showToast.error(err?.message || tRef.current('ffRestoreFailed'));
    }
  }

  const rows = Array.isArray(data?.rows) ? data!.rows : [];
  const sourceBalances = Array.isArray(data?.sourceBalances)
    ? data!.sourceBalances
    : [];
  const flags = Array.isArray(data?.flags) ? data!.flags : [];
  // Rishi, 31 Oct: an unsaved calculation's run-downs that open requisitions it did not count already solve.
  const shortSources = (Array.isArray(data?.sources) ? data!.sources : []).filter((x) => Number(x.shortfallKg) > 0);
  const counted = countedRequisitions(sourceBalances);
  const calculatedCover = shortSources.map((x) => ({ source: x, ...requisitionCover(x, openLines, counted) }));
  const uncoveredShortages = calculatedCover.filter((c) => !c.covered).length;
  const coveredNotes: CoveredLine[] = calculationState === 'SAVED'
    ? (currentRun?.coveredLines ?? [])
    : calculationState === 'CALCULATED'
      ? calculatedCover.filter((c) => c.covered).map((c) => ({ destination_code: c.source.sourceCode ?? '', item_name: c.source.itemName ?? '', covered_by: c.by }))
      : [];
  const dietChanges = Array.isArray(data?.dietChanges) ? data!.dietChanges : [];
  const periodList = Array.isArray(periods) ? periods : [];
  const rangeBeforePlanning = !!data && data.forecastFrom === null;
  const rangeStartsAtPlanning =
    !!data && data.forecastFrom !== null && data.forecastFrom > data.from;
  // The API resolves the farm-local day. Showing the browser's local date while
  // that request is pending would put a false planning context on screen.
  const shownPlanning = planningDate || data?.planningDate || '';
  const shownFrom = dateFrom || data?.from || '';
  const shownTo = dateTo || data?.to || '';
  const businessYear = businessYearStartOf(shownPlanning);
  // Rishi, 30 Oct: the filters on screen are no longer the ones the unsaved
  // calculation on screen was made with, so it must be recalculated, not saved.
  const filtersChanged =
    !!data &&
    (view !== data.view ||
      shownPlanning !== data.planningDate ||
      (view === 'PERIOD'
        ? (periodId || data.period?.periodId || '') !==
          (data.period?.periodId ?? '')
        : shownFrom !== data.from || (view === 'CUSTOM' && shownTo !== data.to)));
  // Nothing is forecast before the planning date, so a later planning date
  // pulls any earlier From / To forward with it.
  function changePlanningDate(value: string) {
    setPlanningDate(value);
    if (dateFrom && value && dateFrom < value) setDateFrom(value);
    if (dateTo && value && dateTo < value) setDateTo(value);
  }
  const isTenantWorkspace = getActiveWorkspaceScope() === 'TENANT';
  const canSaveRun = hasPermission(
    getStoredUser(),
    'INVENTORY',
    'LEDGER',
    'can_create',
  );
  const fixedLabel = farm.isFixed
    ? farm.fixedFarm?.location_code
      ? feedFarmLabel({
          code: farm.fixedFarm.location_code,
          name: farm.fixedFarm.location_name ?? '',
        })
      : data?.farm
        ? feedFarmLabel(data.farm)
        : null
    : undefined;
  const noFarms = !farm.isFixed && farm.loaded && farm.farms.length === 0;

  return (
    <div data-fill-body className="w-full">
      {/* The filters stay on one row (review, 27 Sep: a wrapped row left
          "Date To" alone on a second line); the date pair shares a container
          so it never splits. Rishi, 30 Oct: the actions wrap to their own
          row, right-aligned, instead of running off the page's edge. */}
      <div data-forecast-controls className="flex shrink-0 flex-wrap items-end gap-3">
        <div data-forecast-filters className="flex min-w-0 flex-wrap items-end gap-3 xl:flex-nowrap">
        <div className="w-56 shrink-0">
          <FeedFarmSelect
            id="ff-farm"
            label={t('ffFarm')}
            farms={farm.farms}
            farmId={farmId}
            onChange={setFarmId}
            fixedLabel={fixedLabel}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="ff-planning">
            {t('ffPlanningDate')}
          </label>
          <input
            id="ff-planning"
            type="date"
            value={shownPlanning}
            onChange={(e) => changePlanningDate(e.target.value)}
            className="nf-input-sm mt-1.5"
            style={inputStyle}
            title={
              data
                ? data.timeZone
                  ? t('ffTimeZone', { zone: data.timeZone })
                  : t('ffServerDay')
                : undefined
            }
          />
        </div>
        <div className="w-36 shrink-0">
          <label className={labelCls} htmlFor="ff-view">
            {t('ffView')}
          </label>
          <div className="relative mt-1.5">
            <SearchableSelect
              value={view}
              onChange={(val) => changeView(val as ForecastView)}
              options={FORECAST_VIEWS.map((v) => ({
                value: v,
                label: t(FORECAST_VIEW_LABEL[v]),
              }))}
              columnHeaders={false}
              searchPlaceholder="Search view…"
              triggerClassName="nf-input-sm w-full h-9"
            />
            <select
              id="ff-view"
              value={view}
              onChange={(e) => changeView(e.target.value as ForecastView)}
              tabIndex={-1}
              className="absolute inset-0 h-full w-full opacity-0 pointer-events-none"
            >
              {FORECAST_VIEWS.map((v) => (
                <option key={v} value={v}>
                  {t(FORECAST_VIEW_LABEL[v])}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex shrink-0 items-end gap-3">
          {view === 'PERIOD' ? (
            <div className="w-56 shrink-0">
              <label className={labelCls} htmlFor="ff-period">
                {t('ffReportingPeriod')}
              </label>
              <div className="relative mt-1.5">
                <SearchableSelect
                  value={periodId}
                  onChange={setPeriodId}
                  options={periodList.map((p) => ({
                    value: p.periodId,
                    code: p.periodCode,
                    name: `${formatDateShort(p.startDate)} – ${formatDateShort(p.endDate)}`,
                    label: t('ffPeriodOption', {
                      code: p.periodCode,
                      from: formatDateShort(p.startDate),
                      to: formatDateShort(p.endDate),
                    }),
                  }))}
                  columnHeaders={['Period', 'Dates']}
                  columns={[
                    { key: 'code', label: 'Period' },
                    { key: 'name', label: 'Dates' },
                  ]}
                  placeholder={t('ffPeriodCovering')}
                  searchPlaceholder="Search period…"
                  triggerClassName="nf-input-sm w-full h-9"
                />
                <select
                  id="ff-period"
                  value={periodId}
                  onChange={(e) => setPeriodId(e.target.value)}
                  tabIndex={-1}
                  className="absolute inset-0 h-full w-full opacity-0 pointer-events-none"
                >
                  <option value="">{t('ffPeriodCovering')}</option>
                  {periodList.map((p) => (
                    <option key={p.periodId} value={p.periodId}>
                      {t('ffPeriodOption', {
                        code: p.periodCode,
                        from: formatDateShort(p.startDate),
                        to: formatDateShort(p.endDate),
                      })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label className={labelCls} htmlFor="ff-from">
                {t(
                  view === 'DAILY'
                    ? 'ffStartDate'
                    : view === 'WEEKLY'
                      ? 'ffFirstWeekStarts'
                      : 'ffDateFrom',
                )}
              </label>
              <input
                id="ff-from"
                type="date"
                value={shownFrom}
                min={shownPlanning || undefined}
                onChange={(e) =>
                  setDateFrom(clampToPlanning(e.target.value, shownPlanning))
                }
                className="nf-input-sm mt-1.5"
                style={inputStyle}
              />
            </div>
          )}
          {view === 'CUSTOM' && (
            <div>
              <label className={labelCls} htmlFor="ff-to">
                {t('ffDateTo')}
              </label>
              <input
                id="ff-to"
                type="date"
                value={shownTo}
                min={shownPlanning || undefined}
                onChange={(e) =>
                  setDateTo(clampToPlanning(e.target.value, shownPlanning))
                }
                className="nf-input-sm mt-1.5"
                style={inputStyle}
              />
            </div>
          )}
        </div>
        </div>
        {farm.loaded &&
          !farm.failed &&
          !noFarms &&
          (farmId || farm.isFixed) && (
            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
              {calculationState === 'EMPTY' && !savedRunFailed && (!loading || calculating) && (
                <Button
                  size="sm"
                  onClick={calculate}
                  disabled={
                    !farmId || loading || (view === 'PERIOD' && !periodId)
                  }
                >
                  {calculating ? t('ffCalculating') : t('ffCalculate')}
                </Button>
              )}
              {calculationState === 'CALCULATED' && filtersChanged && (
                <Button
                  size="sm"
                  onClick={calculate}
                  disabled={
                    !farmId || loading || (view === 'PERIOD' && !periodId)
                  }
                >
                  {calculating ? t('ffCalculating') : t('ffRecalculate')}
                </Button>
              )}
              {canSaveRun && calculationState === 'CALCULATED' && !filtersChanged && (
                <>
                  <Button
                    size="sm"
                    onClick={() => void saveRun()}
                    disabled={!data || loading || savingRun}
                  >
                    {savingRun ? t('ffSavingRun') : t('ffSaveRun')}
                  </Button>
                  {uncoveredShortages > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void saveRun(true)}
                      disabled={!data || loading || savingRun}
                    >
                      {t('ffSaveAndCreateRequisition')}
                    </Button>
                  )}
                </>
              )}
              {calculationState === 'SAVED' && !historicalRun && (
                <>
                  {currentRun?.existingRequisitionId && (
                    <Button size="sm" onClick={() => setFromRunOpen(true)}>
                      {t('rqViewRequisition')}
                    </Button>
                  )}
                  {canSaveRun &&
                    !currentRun?.existingRequisitionId &&
                    currentRun?.canCreateRequisition && (
                      <Button size="sm" onClick={() => setFromRunOpen(true)}>
                        {t('rqCreateFromSaved')}
                      </Button>
                    )}
                  {canSaveRun && (
                    // Rishi, 30 Oct: an icon, so the actions stay on the filters' row.
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={deleteCalculation}
                      aria-label={t('ffDeleteCalculation')}
                      title={t('ffDeleteCalculation')}
                      className="w-9 px-0 text-[var(--danger)]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )}
              {historicalRun && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setHistoricalRun(false);
                    setCurrentRun(null);
                    setData(null);
                    setCalculationState('EMPTY');
                    resetWindowToToday();
                    // Reload the farm's current saved calculation, as on first load, rather than leave the page empty.
                    viewToken.current += 1;
                    setSavedRunReload((value) => value + 1);
                  }}
                >
                  {t('ffReturnToCurrent')}
                </Button>
              )}
            </div>
          )}
      </div>

      {view === 'PERIOD' && !!farmId && periodsFailed && (
        <InlineAlert>{t('ffPeriodsLoadFailed')}</InlineAlert>
      )}
      {view === 'PERIOD' &&
        !!farmId &&
        !periodsFailed &&
        periods !== null &&
        periodList.length === 0 && (
          <InlineAlert variant="info">
            <span className="mr-3">{t('ffNoPeriods')}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={generatePeriods}
              disabled={generating || isTenantWorkspace}
            >
              {t('ffGenerateDraftPeriods', { year: businessYear })}
            </Button>
            {isTenantWorkspace && (
              <span
                className="ml-3 text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {t('ffGenerateNeedsCompany')}
              </span>
            )}
          </InlineAlert>
        )}
      {rangeBeforePlanning && (
        <InlineAlert variant="info">
          {t('ffNoteRangeBeforePlanning', {
            date: formatDateShort(data!.planningDate),
          })}
        </InlineAlert>
      )}
      {rangeStartsAtPlanning && (
        <InlineAlert variant="info">
          {t('ffNoteRangeStartsAtPlanning', {
            date: formatDateShort(data!.forecastFrom!),
          })}
        </InlineAlert>
      )}

      {farm.failed ? (
        // The request failed: say so and offer to try again. "No farms to show."
        // would claim this user has none, which is a different fact.
        <InlineAlert>
          <span className="mr-3">{t('ffFarmsLoadFailed')}</span>
          <Button size="sm" variant="outline" onClick={farm.retry}>
            {t('ffRetry')}
          </Button>
        </InlineAlert>
      ) : !farm.loaded ? (
        <LoadingState label={t('ffLoading')} />
      ) : noFarms || (!farmId && !farm.isFixed) ? (
        <EmptyState title={t('ffNoFarms')} />
      ) : (
        <>
          {data ? (
            <>
              {coveredNotes.length > 0 && !currentRun?.existingRequisitionId && (
                <InlineAlert variant="info">
                  {t('ffCoveredByRequisition', {
                    lines: coveredNotes.map((c) => t('ffCoveredLine', { silo: c.destination_code, item: c.item_name, by: c.covered_by.join(', ') })).join('; '),
                  })}
                </InlineAlert>
              )}
              {calculationState === 'SAVED' && !historicalRun && data.planningDate < todayIso() && (
                <InlineAlert variant="info">{t('ffSavedRunPast', { date: formatDateShort(data.planningDate) })}</InlineAlert>
              )}
              <FeedForecastGrid
                rows={rows}
                sourceBalances={sourceBalances}
                view={data.view}
                from={data.from}
                dietChanges={dietChanges}
                loading={loading}
                t={t}
              />
              <FeedForecastNotes flags={flags} t={t} compact />
            </>
          ) : loading ? (
            <LoadingState label={t('ffLoading')} />
          ) : savedRunFailed ? (
            <InlineAlert>
              <span className="mr-3">{t('ffSavedRunLoadFailed')}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSavedRunReload((n) => n + 1)}
              >
                {t('ffRetry')}
              </Button>
            </InlineAlert>
          ) : (
            <EmptyState title={t('ffCalculatePrompt')} />
          )}
          {!!farmId && (
            <FeedForecastRunHistory
              farmId={farmId}
              reloadToken={runHistoryReload}
              compact
            />
          )}
          <FeedRequisitionFromRunDialog
            open={fromRunOpen}
            runId={currentRun?.run_id ?? currentRun?.runId ?? null}
            farm={data?.farm ?? null}
            onClose={() => setFromRunOpen(false)}
            onView={(view) => {
              setFromRunOpen(false);
              setCreatedRequisition(view);
              setCurrentRun((run) =>
                run
                  ? { ...run, existingRequisitionId: view.requisition_id }
                  : run,
              );
            }}
          />
          {createdRequisition && (
            <Dialog
              open
              onClose={() => setCreatedRequisition(null)}
              title={createdRequisition.req_no}
            >
              <FeedRequisitionDetail
                embedded
                view={createdRequisition}
                onView={setCreatedRequisition}
                onBack={() => setCreatedRequisition(null)}
              />
            </Dialog>
          )}
        </>
      )}
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
