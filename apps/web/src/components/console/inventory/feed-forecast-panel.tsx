"use client";

/**
 * Inventory -> Feed Forecast. Plan A built it (docx Section 3, D1–D6, D13,
 * D14); Plan R aligns it with the client's field specification of 26 Sep
 * (spec D16–D20): an as-of Planning Date (blank = today in the farm's time
 * zone, which only the API knows), Daily / Weekly / Reporting Period / Custom
 * views, a row per batch + item + date (grouped for Weekly and Reporting
 * Period), Item No, DD/MM/YY dates and the current / next stage block. The
 * grid and the stage block are feed-forecast-grid.tsx; the query per view is
 * feed-forecast-query.ts.
 *
 * Farm scope follows the same STANDARD_USER-is-fixed rule as
 * WorkspaceScopeSwitcher (D13): a STANDARD_USER's farm is
 * user_master.farm_id and is never a choice; every other user type picks
 * from the active tenant/company's farms, defaulting to whatever is already
 * pinned (getActiveFarmId()). The shared api client only sends
 * x-active-farm-id when a farm is pinned, so `farmId` is also sent as an
 * explicit query param — otherwise an admin with no farm pinned ("All
 * farms") gets the API's 400 "Select a farm." with no way to pick one here.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getActiveFarmId, getActiveWorkspaceScope, getStoredUser } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { formatDateShort, todayIso, unwrap } from "./feed-format";
import { FeedForecastGrid, FeedForecastStages, ReportRow, StageBlock, wastageNote } from "./feed-forecast-grid";
import { businessYearStartOf, forecastQueryString, FORECAST_VIEWS, ForecastView } from "./feed-forecast-query";

type ForecastFlag =
  | { kind: "NO_FEED_ROW"; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: "OVERLAPPING_FEED_ROWS"; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: "NO_SILO_HOLDS_ITEM"; shedCode: string; itemName: string }
  | { kind: "STAGE_CHANGE_PROJECTED"; batchNo: string; stageCode: string; date: string }
  | { kind: "HEADS_ASSUMED_FLAT"; batchNo: string }
  | { kind: "BATCH_SHED_UNKNOWN"; batchNo: string }
  | { kind: "AS_OF_PAST"; planningDate: string; today: string };

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

interface FarmItem {
  location_id: string;
  location_code: string;
  location_name: string;
}

const VIEW_LABEL: Record<ForecastView, TranslationKeys> = { DAILY: "ffViewDaily", WEEKLY: "ffViewWeekly", PERIOD: "ffViewPeriod", CUSTOM: "ffViewCustom" };

const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

/**
 * Groups consecutive/duplicate NO_FEED_ROW / OVERLAPPING_FEED_ROWS flags for
 * the same batch+stage into one range sentence, so a gap spanning several
 * days reads as one line instead of one per day.
 */
function groupDayFlags(
  flags: Array<{ batchNo: string; stageCode: string; day: number; date: string }>
): Array<{ batchNo: string; stageCode: string; dayFrom: number; dayTo: number; dateFrom: string; dateTo: string }> {
  const seen = new Set<string>();
  const deduped = flags.filter((f) => {
    const key = `${f.batchNo}:${f.stageCode}:${f.day}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sorted = [...deduped].sort((a, b) =>
    a.batchNo !== b.batchNo ? a.batchNo.localeCompare(b.batchNo) :
    a.stageCode !== b.stageCode ? a.stageCode.localeCompare(b.stageCode) :
    a.day - b.day
  );
  const groups: Array<{ batchNo: string; stageCode: string; dayFrom: number; dayTo: number; dateFrom: string; dateTo: string }> = [];
  for (const f of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.batchNo === f.batchNo && last.stageCode === f.stageCode && f.day === last.dayTo + 1) {
      last.dayTo = f.day;
      last.dateTo = f.date;
    } else {
      groups.push({ batchNo: f.batchNo, stageCode: f.stageCode, dayFrom: f.day, dayTo: f.day, dateFrom: f.date, dateTo: f.date });
    }
  }
  return groups;
}

/** Turns the flags the engine and the service emit into the plain-English sentences shown below the grid. */
function buildFlagSentences(flags: ForecastFlag[], t: (key: any, vars?: any) => string): string[] {
  const sentences: string[] = [];

  const asOf = flags.find((f): f is Extract<ForecastFlag, { kind: "AS_OF_PAST" }> => f.kind === "AS_OF_PAST");
  if (asOf) sentences.push(t("ffFlagAsOfPast", { date: formatDateShort(asOf.planningDate), today: formatDateShort(asOf.today) }));

  const noFeedRow = flags.filter((f): f is Extract<ForecastFlag, { kind: "NO_FEED_ROW" }> => f.kind === "NO_FEED_ROW");
  for (const g of groupDayFlags(noFeedRow)) {
    sentences.push(
      g.dayFrom === g.dayTo
        ? t("ffFlagNoFeedRowSingle", { stageCode: g.stageCode, day: g.dayFrom, batchNo: g.batchNo, date: formatDateShort(g.dateFrom) })
        : t("ffFlagNoFeedRowRange", { stageCode: g.stageCode, dayFrom: g.dayFrom, dayTo: g.dayTo, batchNo: g.batchNo, dateFrom: formatDateShort(g.dateFrom), dateTo: formatDateShort(g.dateTo) })
    );
  }

  const overlapping = flags.filter((f): f is Extract<ForecastFlag, { kind: "OVERLAPPING_FEED_ROWS" }> => f.kind === "OVERLAPPING_FEED_ROWS");
  for (const g of groupDayFlags(overlapping)) {
    sentences.push(
      g.dayFrom === g.dayTo
        ? t("ffFlagOverlappingSingle", { stageCode: g.stageCode, day: g.dayFrom, batchNo: g.batchNo, date: formatDateShort(g.dateFrom) })
        : t("ffFlagOverlappingRange", { stageCode: g.stageCode, dayFrom: g.dayFrom, dayTo: g.dayTo, batchNo: g.batchNo, dateFrom: formatDateShort(g.dateFrom), dateTo: formatDateShort(g.dateTo) })
    );
  }

  const noSilo = new Map<string, { shedCode: string; itemName: string }>();
  for (const f of flags) if (f.kind === "NO_SILO_HOLDS_ITEM") noSilo.set(`${f.shedCode}:${f.itemName}`, f);
  for (const f of noSilo.values()) sentences.push(t("ffFlagNoSiloHoldsItem", { shedCode: f.shedCode, itemName: f.itemName }));

  const stageChanges = new Map<string, { batchNo: string; stageCode: string; date: string }>();
  for (const f of flags) if (f.kind === "STAGE_CHANGE_PROJECTED") stageChanges.set(`${f.batchNo}:${f.stageCode}:${f.date}`, f);
  for (const f of stageChanges.values()) sentences.push(t("ffFlagStageChangeProjected", { batchNo: f.batchNo, stageCode: f.stageCode, date: formatDateShort(f.date) }));

  const shedUnknownBatches = new Set(flags.filter((f) => f.kind === "BATCH_SHED_UNKNOWN").map((f) => (f as any).batchNo));
  for (const batchNo of shedUnknownBatches) sentences.push(t("ffFlagBatchShedUnknown", { batchNo }));

  // HEADS_ASSUMED_FLAT is raised for every batch unconditionally (D11) — one sentence covers all of them.
  if (flags.some((f) => f.kind === "HEADS_ASSUMED_FLAT")) sentences.push(t("ffFlagHeadsAssumedFlat"));

  return sentences;
}

export default function FeedForecastPanel() {
  const { t } = useLanguage();
  // t() is read inside effects and handlers, but the effects must not re-run
  // just because the translation function's identity changed (the test mock
  // and some callers hand back a new `t` on every render) — the tRef pattern.
  const tRef = useRef(t);
  tRef.current = t;

  const user = getStoredUser();
  const isStandardUser = user?.userType === "STANDARD_USER";

  const [farms, setFarms] = useState<FarmItem[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState<string>(() => getActiveFarmId() || "");
  // "" = the API's default for each: planning date = the farm's today (D16), from/to = the view's own range.
  const [view, setView] = useState<ForecastView>("CUSTOM");
  const [planningDate, setPlanningDate] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [periods, setPeriods] = useState<PeriodOption[] | null>(null);
  // Distinguishes "the company has no periods yet" (periods === [], read OK)
  // from "the periods read itself failed" — final review minor 5: the old
  // code folded both into an empty array and showed "No periods" + the
  // generate button either way, which reads as an offer to fix a failure a
  // retry (not a generate) is what actually fixes.
  const [periodsFailed, setPeriodsFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [generating, setGenerating] = useState(false);
  // Separate from `error` (final review minor 5): `error` hides the grid
  // (see the `error ? null : …` render below), and a refused generate must
  // not take the grid down with it — it is shown beside the button instead.
  const [generateError, setGenerateError] = useState("");
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Non-STANDARD_USER types pick a farm; a STANDARD_USER's farm is fixed (D13).
  // farmsLoaded/farmsFailed distinguish "still loading" from "loaded, and
  // either empty or the request itself failed" (Plan A fix round 2).
  const [farmsLoaded, setFarmsLoaded] = useState(false);
  const [farmsFailed, setFarmsFailed] = useState(false);
  useEffect(() => {
    if (isStandardUser) return;
    let cancelled = false;
    api
      .get(`/location?locationType=FARM&rootOnly=true&isActive=true`)
      .then((res) => {
        if (cancelled) return;
        const rows = unwrap<FarmItem[]>(res);
        if (Array.isArray(rows)) setFarms(rows);
        else setFarmsFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFarmsFailed(true);
      })
      .finally(() => {
        if (!cancelled) setFarmsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isStandardUser]);

  // A failed or empty farm list, or a stale pin, falls back to no selection
  // rather than a select showing a value that matches none of its options.
  useEffect(() => {
    if (isStandardUser || !selectedFarmId || !farmsLoaded) return;
    if (farmsFailed || !farms.some((f) => f.location_id === selectedFarmId)) setSelectedFarmId("");
  }, [farms, farmsLoaded, farmsFailed]);

  const farmId = isStandardUser ? getActiveFarmId() : selectedFarmId;

  // The Reporting Period view's choices, read under the report's own grant (a farm login has no Master Data grant).
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
        if (Array.isArray(list)) setPeriods(list);
        else {
          // An envelope that failed to unwrap into a list is as much a
          // failed read as a rejected promise (minor 5).
          setPeriods([]);
          setPeriodsFailed(true);
        }
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
        if (cancelled) return;
        setData(unwrap<ForecastData>(res));
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

  // Open question Q9: an admin drafts the July–June year from the month-end-Saturday rule, then edits it in the master.
  async function generatePeriods() {
    const year = businessYearStartOf(planningDate || data?.planningDate || todayIso());
    setGenerating(true);
    setGenerateError("");
    try {
      await api.post("/reporting-period/generate", { business_year_start: year });
      setReload((n) => n + 1);
    } catch (err: any) {
      // Beside the button, never through `error` — a refused generate must not hide the grid (minor 5).
      setGenerateError(err?.message || tRef.current("ffGenerateFailed"));
    } finally {
      setGenerating(false);
    }
  }

  // Guard every list read off the response: an envelope that failed to
  // unwrap, or a payload missing a list, renders empty rather than crashing.
  const rows = Array.isArray(data?.rows) ? data!.rows : [];
  const stages = Array.isArray(data?.stages) ? data!.stages : [];
  const flagSentences = data ? buildFlagSentences(Array.isArray(data.flags) ? data.flags : [], t) : [];
  const periodList = Array.isArray(periods) ? periods : [];
  // Q7: nothing is forecast before the planning date.
  const rangeBeforePlanning = !!data && data.forecastFrom === null;
  // Final review fix 3 (Important, ruling): the range can instead only
  // PARTLY precede the planning date (e.g. the PERIOD view, whose period
  // start is earlier than the date) — forecastFrom is then the planning
  // date itself, later than `from`, rather than null.
  const rangeStartsAtPlanning = !!data && data.forecastFrom !== null && data.forecastFrom > data.from;
  const businessYear = businessYearStartOf(planningDate || data?.planningDate || todayIso());
  // Final review fix 2 (Important, ruling): api-client only sends
  // x-active-company-id outside TENANT scope (apps/web/src/lib/api-client.ts)
  // — a TENANT_ADMIN who has not switched into a company workspace has no
  // active company, and generating periods there writes NULL-company
  // template rows rather than the farm's own.
  const isTenantWorkspace = getActiveWorkspaceScope() === "TENANT";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="nf-text-caption block" htmlFor="ff-farm">{t("ffPrimaryLocation")}</label>
          {isStandardUser ? (
            <p className="mt-0.5 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {user?.farm
                ? `${user.farm.location_code} — ${user.farm.location_name}`
                : data?.farm
                  ? `${data.farm.code} — ${data.farm.name}`
                  : "—"}
            </p>
          ) : (
            <select
              id="ff-farm"
              aria-label={t("ffPrimaryLocation")}
              value={selectedFarmId}
              onChange={(e) => setSelectedFarmId(e.target.value)}
              className="nf-input-sm nf-select"
              style={inputStyle}
            >
              <option value="">{t("ffSelectFarm")}</option>
              {farms.map((f) => (
                <option key={f.location_id} value={f.location_id}>
                  {f.location_code} — {f.location_name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="nf-text-caption block" htmlFor="ff-planning">{t("ffPlanningDate")}</label>
          <input
            id="ff-planning"
            type="date"
            value={planningDate || data?.planningDate || ""}
            onChange={(e) => setPlanningDate(e.target.value)}
            className="nf-input-sm"
            style={inputStyle}
          />
          {data && (
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              {data.timeZone ? t("ffTimeZone", { zone: data.timeZone }) : t("ffServerDay")}
            </p>
          )}
        </div>

        <div>
          <label className="nf-text-caption block" htmlFor="ff-view">{t("ffView")}</label>
          <select id="ff-view" value={view} onChange={(e) => changeView(e.target.value as ForecastView)} className="nf-input-sm nf-select" style={inputStyle}>
            {FORECAST_VIEWS.map((v) => (
              <option key={v} value={v}>{t(VIEW_LABEL[v])}</option>
            ))}
          </select>
        </div>

        {view === "PERIOD" ? (
          <div>
            <label className="nf-text-caption block" htmlFor="ff-period">{t("ffReportingPeriod")}</label>
            <select id="ff-period" value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="nf-input-sm nf-select" style={inputStyle}>
              <option value="">{t("ffPeriodCovering")}</option>
              {periodList.map((p) => (
                <option key={p.periodId} value={p.periodId}>
                  {t("ffPeriodOption", { code: p.periodCode, from: formatDateShort(p.startDate), to: formatDateShort(p.endDate) })}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="nf-text-caption block" htmlFor="ff-from">
              {t(view === "DAILY" ? "ffDate" : view === "WEEKLY" ? "ffWeekStart" : "ffDateFrom")}
            </label>
            <input
              id="ff-from"
              type="date"
              value={dateFrom || data?.from || ""}
              onChange={(e) => setDateFrom(e.target.value)}
              className="nf-input-sm"
              style={inputStyle}
            />
          </div>
        )}

        {view === "CUSTOM" && (
          <div>
            <label className="nf-text-caption block" htmlFor="ff-to">{t("ffDateTo")}</label>
            <input
              id="ff-to"
              type="date"
              value={dateTo || data?.to || ""}
              onChange={(e) => setDateTo(e.target.value)}
              className="nf-input-sm"
              style={inputStyle}
            />
          </div>
        )}
      </div>

      {view === "PERIOD" && !!farmId && periodsFailed && (
        <InlineAlert>{t("ffPeriodsLoadFailed")}</InlineAlert>
      )}

      {view === "PERIOD" && !!farmId && !periodsFailed && periods !== null && periodList.length === 0 && (
        <InlineAlert variant="info">
          <span className="mr-3">{t("ffNoPeriods")}</span>
          <Button variant="outline" onClick={generatePeriods} disabled={generating || isTenantWorkspace}>
            {t("ffGeneratePeriods", { year: businessYear })}
          </Button>
          {isTenantWorkspace && (
            <span className="ml-3 text-xs" style={{ color: "var(--text-secondary)" }}>{t("ffGenerateNeedsCompany")}</span>
          )}
          {generateError && (
            <span className="ml-3 text-xs" style={{ color: "var(--danger)" }}>{generateError}</span>
          )}
        </InlineAlert>
      )}

      {error && <InlineAlert>{error}</InlineAlert>}

      {rangeBeforePlanning && !error && (
        <InlineAlert variant="info">{t("ffNoteRangeBeforePlanning", { date: formatDateShort(data!.planningDate) })}</InlineAlert>
      )}

      {rangeStartsAtPlanning && !error && (
        <InlineAlert variant="info">{t("ffNoteRangeStartsAtPlanning", { date: formatDateShort(data!.forecastFrom!) })}</InlineAlert>
      )}

      {error ? null : !farmId ? (
        <InlineAlert variant="info">{t("ffPickFarmPrompt")}</InlineAlert>
      ) : (
        <>
          <FeedForecastGrid rows={rows} loading={loading} horizonTo={data?.horizonTo ?? null} t={t} />
          {rows.length > 0 && !loading && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{wastageNote(rows, t)}</p>
          )}
          {!loading && <FeedForecastStages stages={stages} t={t} />}
        </>
      )}

      {flagSentences.length > 0 && (
        <div className="rounded-[var(--radius-md)] border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
          <p className="nf-text-caption mb-2">{t("ffNotesTitle")}</p>
          <ul className="list-disc space-y-1 pl-4 text-xs" style={{ color: "var(--text-secondary)" }}>
            {flagSentences.map((sentence, idx) => (
              <li key={idx}>{sentence}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
