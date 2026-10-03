"use client";

/**
 * Inventory -> Feed Forecast: the report grid and the stage table (Feed
 * Forecast Plan R, the client's field specification of 26 Sep, spec
 * D16–D19; laid out for the fixed-height page in Plan S, review C).
 * Presentational only — feed-forecast-panel.tsx fetches, these render.
 * Dates are DD/MM/YY (D16). Current Inventory is the System Balance
 * (checkpoint 37), never "physical stock".
 *
 * One line per row; numbers right-aligned with two decimals; Batch No and
 * Item held while the grid scrolls sideways; a batch + item's consecutive
 * dates grouped (a separator where a group starts, every second group
 * shaded) so eight near-identical rows do not read as a wall.
 */
import type { CSSProperties, ReactNode } from "react";
import { Inbox, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollTable } from "@/components/ui/scroll-table";
import { cn } from "@/lib/utils";
import { formatDateShort } from "./feed-format";

/** One grid line as GET /feed-forecast sends it (apps/api …/feed-forecast.view.ts ReportRow). */
export interface ReportRow {
  key: string;
  batchId: string;
  batchNo: string;
  shedCode: string;
  stageCode: string;
  itemId: string;
  itemNo: string;
  itemName: string;
  sourceType: "SILO" | "STORE" | "NONE";
  sourceCode: string | null;
  date: string;
  dateTo: string;
  days: number;
  currentInventoryKg: number;
  heads: number;
  perDayIntakeKg: number;
  intakeKg: number;
  daysOfStock: number | null;
  sharedBatchCount: number;
  indicative: boolean;
  /** First forecast day demand exceeds the available opening stock (the API still names it runDownDate). */
  runDownDate: string | null;
}

/** The current / next stage of one batch (apps/api …/feed-forecast.service.ts StageBlock). */
export interface StageBlock {
  batchId: string;
  batchNo: string;
  shedCode: string;
  currentStageCode: string;
  currentFrom: string;
  currentTo: string | null;
  nextStageCode: string | null;
  nextFrom: string | null;
  nextTo: string | null;
  /** D36: the earliest day the change could happen, on an event-based stage with a range. */
  stageChangeEarliest: string | null;
  stageChangeDate: string | null;
  stageChangeOverdue: boolean;
}

// `any` for the key, as Plan R's Task 9 brief specified: useLanguage's t is
// typed to TranslationKeys and the specs hand in a string-keyed mock.
type Translate = (key: any, vars?: any) => string;

/**
 * The field specification's Report Grid in its order, with two of ours: Source
 * after Planning Date (D6) and the feed that leaves the silo, wastage
 * included, last (D17).
 */
// D33 (Rishi, 28 Sep): exactly the field specification's twelve columns, in its
// order. "Source" and "Feed incl. Wastage (Kg)" were ours, not the client's, and
// "Shared by N" went with Source — it was a badge inside that cell.
export const GRID_COLUMNS = [
  "ffColBatchNo", "ffColItemName", "ffColItemNo", "ffColShedNo",
  "ffColCurrentInventoryKg", "ffColCurrentPigs", "ffColPerDayIntakeKg",
  // Dynamic date columns are inserted here at render time (one per day or week)
  "ffColDaysOfStock", "ffColFirstShortage",
] as const;

export const STAGE_COLUMNS = ["ffStgBatch", "ffStgShed", "ffStgCurrent", "ffStgFrom", "ffStgTo", "ffStgNext", "ffStgChange"] as const;


/** Kilograms, grouped, always two decimals (review C: consistent decimals). */
export function fmtKg(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Days of stock to one decimal (3 Oct ruling); callers leave a null blank. */
export function fmtDays(n: number): string {
  return n.toFixed(1);
}

export function fmtRound(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export interface PivotedFeedRow {
  key: string;
  batchId: string;
  batchNo: string;
  shedCode: string;
  stageCode: string;
  itemId: string;
  itemNo: string;
  itemName: string;
  heads: number;
  perDayIntakeKg: number;
  openingInventoryKg: number;
  dateMap: Record<string, { currentInventoryKg: number; intakeKg: number }>;
  daysOfStock: number | null;
  runDownDate: string | null;
  indicative: boolean;
}

export interface ColumnSlot {
  key: string;
  label: string;
  dateStart: string;
  dateEnd: string;
}

export function diffDaysIso(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  const utca = Date.UTC(ya, ma - 1, da);
  const utcb = Date.UTC(yb, mb - 1, db);
  return Math.round((utcb - utca) / 86400000);
}

/** Add n calendar days to an ISO date string (YYYY-MM-DD). */
export function addDaysIso(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function pivotForecastRows(
  rows: ReportRow[],
  view?: string,
  from?: string
): { pivoted: PivotedFeedRow[]; columns: ColumnSlot[] } {
  const map = new Map<string, PivotedFeedRow>();
  const slotsMap = new Map<string, ColumnSlot>();

  // Determine latest run-down date across all rows to cap the horizon
  let maxRunDown: string | null = null;
  for (const r of rows) {
    if (r.runDownDate && (!maxRunDown || r.runDownDate > maxRunDown)) {
      maxRunDown = r.runDownDate;
    }
  }

  const baseFrom = from || (rows.length > 0 ? rows[0].date : "");

  for (const r of rows) {
    const groupKey = `${r.batchId}|${r.itemId}|${r.shedCode || ""}`;
    let p = map.get(groupKey);
    if (!p) {
      p = {
        key: groupKey,
        batchId: r.batchId,
        batchNo: r.batchNo,
        shedCode: r.shedCode,
        stageCode: r.stageCode,
        itemId: r.itemId,
        itemNo: r.itemNo,
        itemName: r.itemName,
        heads: r.heads,
        perDayIntakeKg: r.perDayIntakeKg,
        openingInventoryKg: r.currentInventoryKg,
        dateMap: {},
        daysOfStock: r.daysOfStock,
        runDownDate: r.runDownDate,
        indicative: r.indicative,
      };
      map.set(groupKey, p);
    }

    let slotKey = r.date;
    let slotStart = r.date;
    let slotEnd = r.dateTo || r.date;
    let label = formatDateShort(r.date);

    if (view === "WEEKLY" && baseFrom) {
      const diff = diffDaysIso(baseFrom, r.date);
      const weekIdx = Math.max(0, Math.floor(diff / 7));
      slotStart = addDaysIso(baseFrom, weekIdx * 7);
      slotEnd = addDaysIso(slotStart, 6);
      slotKey = slotStart;
      label = `${formatDateShort(slotStart)} – ${formatDateShort(slotEnd)}`;
    }

    if (!slotsMap.has(slotKey)) {
      slotsMap.set(slotKey, {
        key: slotKey,
        label,
        dateStart: slotStart,
        dateEnd: slotEnd,
      });
    }

    if (!p.dateMap[slotKey]) {
      p.dateMap[slotKey] = {
        currentInventoryKg: r.currentInventoryKg,
        intakeKg: r.intakeKg,
      };
    } else {
      p.dateMap[slotKey].intakeKg += r.intakeKg;
    }

    if (r.runDownDate && !p.runDownDate) p.runDownDate = r.runDownDate;
    if (r.daysOfStock !== null && (p.daysOfStock === null || r.daysOfStock < p.daysOfStock)) {
      p.daysOfStock = r.daysOfStock;
    }
  }

  let sortedSlots = Array.from(slotsMap.values()).sort((a, b) => (a.dateStart < b.dateStart ? -1 : 1));
  if (maxRunDown) {
    const capped = sortedSlots.filter((s) => s.dateStart <= maxRunDown);
    if (capped.length > 0) {
      sortedSlots = capped;
    }
  }

  return { pivoted: Array.from(map.values()), columns: sortedSlots };
}

/** Consecutive rows of one batch + item + source + stage form a group. */
export function groupRows(rows: ReportRow[]): Array<{ row: ReportRow; start: boolean; alt: boolean }> {
  let group = -1;
  let previous = "";
  return rows.map((row) => {
    const key = `${row.batchId}|${row.itemId}|${row.sourceCode ?? ""}|${row.stageCode}`;
    const start = key !== previous;
    if (start) {
      group += 1;
      previous = key;
    }
    return { row, start, alt: group % 2 === 1 };
  });
}

const BATCH_COL = { "--sticky-left": "0px" } as CSSProperties;
const ITEM_COL = { "--sticky-left": "12.5rem" } as CSSProperties;
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const MUTED = "text-[var(--text-muted)]";
const SMALL_BADGE = "px-1.5 py-0 text-[10px]";

function StateRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-xs text-[var(--text-secondary)]">{children}</td>
    </tr>
  );
}

export function FeedForecastGrid({
  rows,
  view,
  from,
  loading,
  t,
}: {
  rows: ReportRow[];
  view?: string;
  from?: string;
  loading: boolean;
  horizonTo: string | null;
  t: Translate;
}) {
  const { pivoted, columns } = pivotForecastRows(rows, view, from);
  const totalCols = 7 + columns.length + 2;

  return (
    <ScrollTable label={t("ffGridLabel")} className="w-full">
      <thead>
        <tr>
          <th scope="col" data-sticky-col="true" style={BATCH_COL} className={cn(TH, "w-[12.5rem] min-w-[12.5rem] max-w-[12.5rem]")}>
            {t("ffColBatchNo")}
          </th>
          <th scope="col" data-sticky-col="last" style={ITEM_COL} className={cn(TH, "min-w-[13rem]")}>
            {t("ffColItemName")}
          </th>
          <th scope="col" className={TH}>{t("ffColItemNo")}</th>
          <th scope="col" className={TH}>{t("ffColShedNo")}</th>
          <th scope="col" className={cn(TH, "text-right")}>{t("ffColCurrentInventoryKg")}</th>
          <th scope="col" className={cn(TH, "text-right")}>{t("ffColCurrentPigs")}</th>
          <th scope="col" className={cn(TH, "text-right")}>{t("ffColPerDayIntakeKg")}</th>

          {/* Dynamic Columns: Weekly or Daily */}
          {columns.map((c) => (
            <th key={c.key} scope="col" className={cn(TH, "text-right min-w-[7.5rem] bg-[var(--table-header-alt)]")}>
              {c.label}
            </th>
          ))}

          <th scope="col" title={t("ffDaysOfStockHint")} className={cn(TH, "text-right")}>
            {t("ffColDaysOfStock")}
          </th>
          <th scope="col" title={t("ffFirstShortageHint")} className={TH}>
            {t("ffColFirstShortage")}
          </th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <StateRow colSpan={totalCols}>
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={{ color: "var(--accent)" }} /> {t("ffLoading")}
          </StateRow>
        ) : pivoted.length === 0 ? (
          <StateRow colSpan={totalCols}>
            <Inbox className="mx-auto mb-2 h-6 w-6" style={{ color: "var(--text-muted)" }} /> {t("ffNoRows")}
          </StateRow>
        ) : (
          pivoted.map((p, idx) => {
            const isAlt = idx % 2 === 1;
            return (
              <tr key={p.key} data-group-alt={isAlt ? "true" : undefined} className={isAlt ? "bg-[var(--table-row-alt)]" : undefined}>
                <td data-sticky-col="true" style={BATCH_COL} title={p.batchNo} className={cn(TD, "w-[12.5rem] min-w-[12.5rem] max-w-[12.5rem] truncate font-medium")}>
                  {p.batchNo}
                </td>
                <td data-sticky-col="last" style={ITEM_COL} title={p.itemName} className={cn(TD, "min-w-[13rem] max-w-[14rem] truncate font-medium")}>
                  {p.itemName}
                </td>
                <td className={cn(TD, MUTED)}>{p.itemNo}</td>
                <td className={cn(TD, MUTED)}>{p.shedCode}</td>
                <td className={cn(TD, NUM, "font-medium")}>{fmtRound(p.openingInventoryKg)}</td>
                <td className={cn(TD, NUM)}>{p.heads.toLocaleString("en-US")}</td>
                <td className={cn(TD, NUM)}>{fmtRound(p.perDayIntakeKg)}</td>

                {/* Day-by-Day or Week-by-Week Run-down columns */}
                {columns.map((c) => {
                  const entry = p.dateMap[c.key];
                  const isDepleted = p.runDownDate && c.dateStart >= p.runDownDate;
                  if (!entry) {
                    if (isDepleted) {
                      return (
                        <td key={c.key} className={cn(TD, NUM, "text-[var(--danger)] font-medium")}>
                          0
                        </td>
                      );
                    }
                    return <td key={c.key} className={cn(TD, NUM, MUTED)} />;
                  }
                  const stock = entry.currentInventoryKg;
                  const isEmpty = stock <= 0 || isDepleted;
                  return (
                    <td key={c.key} className={cn(TD, NUM, isEmpty && "text-[var(--danger)] font-medium")}>
                      {fmtRound(isEmpty && stock <= 0 ? 0 : stock)}
                    </td>
                  );
                })}

                <td className={cn(TD, NUM)}>
                  <span className="inline-flex items-center justify-end gap-1.5">
                    {p.indicative && <Badge variant="warning" className={SMALL_BADGE}>{t("ffIndicative")}</Badge>}
                    <span>{p.daysOfStock === null ? "" : fmtDays(p.daysOfStock)}</span>
                  </span>
                </td>
                <td className={cn(TD, p.runDownDate && "font-semibold text-[var(--danger)]")}>
                  {p.runDownDate ? formatDateShort(p.runDownDate) : ""}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </ScrollTable>
  );
}

/** The current / next stage of each batch (field spec supporting block), one table row per batch and stage. */
export function FeedForecastStages({ stages, t }: { stages: StageBlock[]; t: Translate }) {
  return (
    <ScrollTable label={t("ffStagesTitle")}>
      <thead>
        <tr>
          {STAGE_COLUMNS.map((c, i) => (
            <th key={c} scope="col" data-sticky-col={i === 0 ? "last" : undefined} style={i === 0 ? BATCH_COL : undefined} className={cn(TH, i === 0 && "min-w-[8.5rem]")}>
              {t(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {stages.length === 0 ? (
          <StateRow colSpan={STAGE_COLUMNS.length}>{t("ffNoStages")}</StateRow>
        ) : (
          stages.map((s) => (
            // A batch with concurrent stages (a registered breeding batch) has one row per stage.
            <tr key={`${s.batchId}|${s.currentStageCode}`}>
              <td data-sticky-col="last" style={BATCH_COL} className={cn(TD, "min-w-[8.5rem] font-medium")}>{s.batchNo}</td>
              <td className={cn(TD, MUTED)}>{s.shedCode || "—"}</td>
              <td className={TD}>{s.currentStageCode}</td>
              <td className={TD}>{formatDateShort(s.currentFrom)}</td>
              <td className={TD}>{formatDateShort(s.currentTo)}</td>
              <td className={TD}>{s.nextStageCode ?? "—"}</td>
              <td className={TD}>
                {/* D36: an event-based stage's change is a window — "earliest – latest (expected)";
                    a dated stage's change is a day. Either can still be overdue (not posted). */}
                {s.stageChangeEarliest
                  ? `${formatDateShort(s.stageChangeEarliest)} – ${formatDateShort(s.stageChangeDate)} (${t("ffChangeExpected")})`
                  : formatDateShort(s.stageChangeDate)}
                {s.stageChangeOverdue && <Badge variant="warning" className={cn("ml-1.5", SMALL_BADGE)}>{t("ffStageChangeNotPosted")}</Badge>}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </ScrollTable>
  );
}
