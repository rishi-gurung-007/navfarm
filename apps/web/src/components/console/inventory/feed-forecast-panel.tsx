"use client";

/**
 * Inventory -> Feed Forecast (Task 8, Feed Forecast Plan A). Renders the
 * report served by GET /feed-forecast (Task 7's engine, Task 6's math) —
 * docx Section 3's columns plus Source and Demand in Range, D1-D3/D6/D13/D14
 * of docs/superpowers/specs/2026-09-25-feed-forecast-design.md.
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
import { Loader2, Inbox } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getActiveFarmId, getStoredUser } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

interface ForecastRow {
  batchNo: string;
  itemId: string;
  itemName: string;
  shedCode: string;
  planningDate: string;
  sourceType: "SILO" | "STORE" | "NONE";
  sourceCode: string | null;
  currentInventoryKg: number;
  heads: number;
  perDayIntakeKg: number | null;
  sourceDailyDemandKg: number | null;
  daysLeft: number | null;
  runDownDate: string | null;
  refillDate: string | null;
  requiredOn: string | null;
  overdue: boolean;
  rangeDemandKg: number;
}

type ForecastFlag =
  | { kind: "NO_FEED_ROW"; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: "OVERLAPPING_FEED_ROWS"; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: "NO_SILO_HOLDS_ITEM"; shedCode: string; itemName: string }
  | { kind: "STAGE_CHANGE_PROJECTED"; batchNo: string; stageCode: string; date: string }
  | { kind: "HEADS_ASSUMED_FLAT"; batchNo: string }
  | { kind: "BATCH_SHED_UNKNOWN"; batchNo: string };

interface ForecastData {
  planningDate: string;
  from: string;
  to: string;
  farm: { id: string; code: string; name: string };
  rows: ForecastRow[];
  flags: ForecastFlag[];
}

interface FarmItem {
  location_id: string;
  location_code: string;
  location_name: string;
}

function unwrap<T = any>(res: any): T {
  return (res?.data ?? res) as T;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "YYYY-MM-DD" -> "dd-MMM-yyyy"; null/undefined -> "—" (interfaces note). */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
}

function fmtKg(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Groups consecutive/duplicate NO_FEED_ROW / OVERLAPPING_FEED_ROWS flags for
 * the same batch+stage into one range sentence, so a gap spanning several
 * days reads as one line instead of one per day — the interfaces note asks
 * for this because the API repeats the same flag per affected day.
 */
function groupDayFlags(
  flags: Array<{ batchNo: string; stageCode: string; day: number; date: string }>
): Array<{ batchNo: string; stageCode: string; dayFrom: number; dayTo: number; dateFrom: string; dateTo: string }> {
  // De-duplicate identical (batchNo, stageCode, day) flags first — the engine
  // can raise the same day more than once (e.g. once per overlapping feed
  // row candidate), which would otherwise inflate a grouped range.
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

/** Turns the flags the engine emits into the plain-English sentences shown below the table. */
function buildFlagSentences(flags: ForecastFlag[], t: (key: any, vars?: any) => string): string[] {
  const sentences: string[] = [];

  const noFeedRow = flags.filter((f): f is Extract<ForecastFlag, { kind: "NO_FEED_ROW" }> => f.kind === "NO_FEED_ROW");
  for (const g of groupDayFlags(noFeedRow)) {
    sentences.push(
      g.dayFrom === g.dayTo
        ? t("ffFlagNoFeedRowSingle", { stageCode: g.stageCode, day: g.dayFrom, batchNo: g.batchNo, date: formatDate(g.dateFrom) })
        : t("ffFlagNoFeedRowRange", { stageCode: g.stageCode, dayFrom: g.dayFrom, dayTo: g.dayTo, batchNo: g.batchNo, dateFrom: formatDate(g.dateFrom), dateTo: formatDate(g.dateTo) })
    );
  }

  const overlapping = flags.filter((f): f is Extract<ForecastFlag, { kind: "OVERLAPPING_FEED_ROWS" }> => f.kind === "OVERLAPPING_FEED_ROWS");
  for (const g of groupDayFlags(overlapping)) {
    sentences.push(
      g.dayFrom === g.dayTo
        ? t("ffFlagOverlappingSingle", { stageCode: g.stageCode, day: g.dayFrom, batchNo: g.batchNo, date: formatDate(g.dateFrom) })
        : t("ffFlagOverlappingRange", { stageCode: g.stageCode, dayFrom: g.dayFrom, dayTo: g.dayTo, batchNo: g.batchNo, dateFrom: formatDate(g.dateFrom), dateTo: formatDate(g.dateTo) })
    );
  }

  // Distinct (shedCode, itemName) pairs only — the engine can raise this once per batch that hits the gap.
  const noSilo = new Map<string, { shedCode: string; itemName: string }>();
  for (const f of flags) if (f.kind === "NO_SILO_HOLDS_ITEM") noSilo.set(`${f.shedCode}:${f.itemName}`, f);
  for (const f of noSilo.values()) sentences.push(t("ffFlagNoSiloHoldsItem", { shedCode: f.shedCode, itemName: f.itemName }));

  // Distinct (batchNo, stageCode, date) — one sentence per projected stage change.
  const stageChanges = new Map<string, { batchNo: string; stageCode: string; date: string }>();
  for (const f of flags) if (f.kind === "STAGE_CHANGE_PROJECTED") stageChanges.set(`${f.batchNo}:${f.stageCode}:${f.date}`, f);
  for (const f of stageChanges.values()) sentences.push(t("ffFlagStageChangeProjected", { batchNo: f.batchNo, stageCode: f.stageCode, date: formatDate(f.date) }));

  // Distinct batches with no shed on record.
  const shedUnknownBatches = new Set(flags.filter((f) => f.kind === "BATCH_SHED_UNKNOWN").map((f) => (f as any).batchNo));
  for (const batchNo of shedUnknownBatches) sentences.push(t("ffFlagBatchShedUnknown", { batchNo }));

  // HEADS_ASSUMED_FLAT is raised for every batch unconditionally (D11) and its
  // wording carries no batch-specific detail — one sentence covers all of them.
  if (flags.some((f) => f.kind === "HEADS_ASSUMED_FLAT")) sentences.push(t("ffFlagHeadsAssumedFlat"));

  return sentences;
}

export default function FeedForecastPanel() {
  const { t } = useLanguage();
  // t() is read inside the fetch effect's error handler, but the effect must
  // not re-run just because the translation function's identity changed
  // (some callers, including the test mock, hand back a new `t` on every
  // render) — a ref keeps the effect's own dependency list to the request's
  // actual inputs (farmId/dateFrom/dateTo) instead of looping on renders.
  const tRef = useRef(t);
  tRef.current = t;

  const user = getStoredUser();
  const isStandardUser = user?.userType === "STANDARD_USER";

  const [farms, setFarms] = useState<FarmItem[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState<string>(() => getActiveFarmId() || "");
  const [dateFrom, setDateFrom] = useState<string>(() => todayIso());
  const [dateTo, setDateTo] = useState<string>(() => addDaysIso(todayIso(), 7));
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Non-STANDARD_USER types pick a farm; a STANDARD_USER's farm is fixed (D13).
  useEffect(() => {
    if (isStandardUser) return;
    api
      .get(`/location?locationType=FARM&rootOnly=true&isActive=true`)
      .then((res) => {
        const rows = unwrap<FarmItem[]>(res);
        if (Array.isArray(rows)) setFarms(rows);
      })
      .catch(() => undefined);
  }, [isStandardUser]);

  // If the farm pinned by the workspace switcher isn't one of this user's
  // selectable farms (a stale pin, or a farm outside the current company),
  // fall back to no selection rather than leaving the select showing a value
  // that matches none of its options.
  useEffect(() => {
    if (isStandardUser || !selectedFarmId || farms.length === 0) return;
    if (!farms.some((f) => f.location_id === selectedFarmId)) setSelectedFarmId("");
  }, [farms]);

  const farmId = isStandardUser ? getActiveFarmId() : selectedFarmId;

  useEffect(() => {
    if (!farmId) {
      setData(null);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ farmId, from: dateFrom, to: dateTo });
    api
      .get(`/feed-forecast?${params.toString()}`)
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
  }, [farmId, dateFrom, dateTo]);

  // Guard every list read off the response: an envelope that failed to
  // unwrap, or a payload missing `flags`, must render an empty state, not
  // crash on .map/.find (interfaces note — a prior production crash came
  // from exactly this).
  const rows = Array.isArray(data?.rows) ? (data!.rows as ForecastRow[]) : [];
  const flagSentences = data ? buildFlagSentences(Array.isArray(data.flags) ? data.flags : [], t) : [];

  // D2: runDownDate is null both when the silo/store lasts the whole range
  // and when the range ends before the planning date (nothing was walked
  // yet, so there is nothing to report as "lasts"). The second case needs
  // its own wording so it isn't read as good news.
  const rangeBeforePlanning = !!data && data.to < data.planningDate;

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
              style={{ backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" }}
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
          <span className="nf-text-caption block">{t("ffPlanningDate")}</span>
          <p className="mt-0.5 text-sm font-medium" style={{ color: "var(--text-primary)" }}>{formatDate(data?.planningDate)}</p>
        </div>

        <div>
          <label className="nf-text-caption block" htmlFor="ff-from">{t("ffDateFrom")}</label>
          <input
            id="ff-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="nf-input-sm"
            style={{ backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" }}
          />
        </div>
        <div>
          <label className="nf-text-caption block" htmlFor="ff-to">{t("ffDateTo")}</label>
          <input
            id="ff-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="nf-input-sm"
            style={{ backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" }}
          />
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {rangeBeforePlanning && !error && (
        <InlineAlert variant="info">{t("ffNoteRangeBeforePlanning", { date: formatDate(data!.planningDate) })}</InlineAlert>
      )}

      {error ? null : !farmId ? (
        <InlineAlert variant="info">{t("ffPickFarmPrompt")}</InlineAlert>
      ) : (
        <Table>
          <TableHeader>
            <tr>
              <TableHead>{t("ffColBatchNo")}</TableHead>
              <TableHead>{t("ffColItemName")}</TableHead>
              <TableHead>{t("ffColShedNo")}</TableHead>
              <TableHead>{t("ffColPlanningDate")}</TableHead>
              <TableHead>{t("ffColSource")}</TableHead>
              <TableHead className="text-right">{t("ffColCurrentInventoryKg")}</TableHead>
              <TableHead className="text-right">{t("ffColCurrentPigs")}</TableHead>
              <TableHead className="text-right">{t("ffColPerDayIntakeKg")}</TableHead>
              <TableHead className="text-right">{t("ffColDaysLeft")}</TableHead>
              <TableHead>{t("ffColRunDown")}</TableHead>
              <TableHead>{t("ffColDateToRefill")}</TableHead>
              <TableHead>{t("ffColRequiredOn")}</TableHead>
              <TableHead className="text-right">{t("ffColDemandInRangeKg")}</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={13} className="py-10 text-center" style={{ color: "var(--text-secondary)" }}>
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={{ color: "var(--accent)" }} /> {t("ffLoading")}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="py-10 text-center" style={{ color: "var(--text-secondary)" }}>
                  <Inbox className="mx-auto mb-2 h-6 w-6" style={{ color: "var(--text-muted)" }} /> {t("ffNoRows")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={`${row.batchNo}-${row.itemId}`}>
                  <TableCell className="whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{row.batchNo}</TableCell>
                  <TableCell className="whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{row.itemName}</TableCell>
                  <TableCell className="whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{row.shedCode || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{formatDate(row.planningDate)}</TableCell>
                  <TableCell className="whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                    {row.sourceType === "NONE" ? t("ffNoSource") : row.sourceCode ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={{ color: "var(--text-primary)" }}>{fmtKg(row.currentInventoryKg)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={{ color: "var(--text-primary)" }}>{row.heads}</TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={{ color: "var(--text-primary)" }}>{fmtKg(row.perDayIntakeKg)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={{ color: "var(--text-primary)" }}>{row.daysLeft ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                    {row.runDownDate !== null
                      ? formatDate(row.runDownDate)
                      : rangeBeforePlanning
                        ? "—"
                        : t("ffLastsRange")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{formatDate(row.refillDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span style={{ color: "var(--text-secondary)" }}>{formatDate(row.requiredOn)}</span>
                      {row.overdue && <Badge variant="danger">{t("ffOverdue")}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={{ color: "var(--text-primary)" }}>{fmtKg(row.rangeDemandKg)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
