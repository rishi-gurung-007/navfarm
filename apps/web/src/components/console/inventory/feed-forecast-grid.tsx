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
  wastagePct: number;
  intakeKg: number;
  demandKg: number;
  daysOfStock: number | null;
  sharedBatchCount: number;
  indicative: boolean;
  runDownDate: string | null;
  refillDate: string | null;
  requiredOn: string | null;
  overdue: boolean;
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
export const GRID_COLUMNS = [
  "ffColBatchNo", "ffColItemName", "ffColItemNo", "ffColShedNo", "ffColPlanningDate", "ffColSource",
  "ffColCurrentInventoryKg", "ffColCurrentPigs", "ffColPerDayIntakeKg", "ffColDaysOfStock",
  "ffColRunDown", "ffColDateToRefill", "ffColRequiredOn", "ffColFeedOutKg",
] as const;

export const STAGE_COLUMNS = ["ffStgBatch", "ffStgShed", "ffStgCurrent", "ffStgFrom", "ffStgTo", "ffStgNext", "ffStgChange"] as const;

const RIGHT_ALIGNED = new Set<string>(["ffColCurrentInventoryKg", "ffColCurrentPigs", "ffColPerDayIntakeKg", "ffColDaysOfStock", "ffColFeedOutKg"]);

/** Days of Stock and Run-Down count to two different things; the header title says which. */
const HEADER_HINT: Partial<Record<(typeof GRID_COLUMNS)[number], string>> = {
  ffColDaysOfStock: "ffDaysOfStockHint",
  ffColRunDown: "ffRunDownHint",
};

/** Kilograms, grouped, always two decimals (review C: consistent decimals). */
export function fmtKg(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** D17: "The screen states the wastage allowance used." */
export function wastageNote(rows: ReportRow[], t: Translate): string {
  const pcts = [...new Set(rows.map((r) => r.wastagePct).filter((p) => p > 0))].sort((a, b) => a - b);
  return pcts.length ? t("ffWastageUsed", { pcts: pcts.map((p) => `${p}%`).join(", ") }) : t("ffWastageNone");
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

export function FeedForecastGrid({ rows, loading, horizonTo, t }: { rows: ReportRow[]; loading: boolean; horizonTo: string | null; t: Translate }) {
  return (
    <ScrollTable label={t("ffGridLabel")}>
      <thead>
        <tr>
          {GRID_COLUMNS.map((c, i) => (
            <th
              key={c}
              scope="col"
              title={HEADER_HINT[c] ? t(HEADER_HINT[c]) : undefined}
              data-sticky-col={i === 0 ? "true" : i === 1 ? "last" : undefined}
              style={i === 0 ? BATCH_COL : i === 1 ? ITEM_COL : undefined}
              className={cn(TH, i === 0 && "w-[12.5rem] min-w-[12.5rem] max-w-[12.5rem]", i === 1 && "min-w-[13rem]", RIGHT_ALIGNED.has(c) && "text-right")}
            >
              {t(c)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <StateRow colSpan={GRID_COLUMNS.length}>
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={{ color: "var(--accent)" }} /> {t("ffLoading")}
          </StateRow>
        ) : rows.length === 0 ? (
          <StateRow colSpan={GRID_COLUMNS.length}>
            <Inbox className="mx-auto mb-2 h-6 w-6" style={{ color: "var(--text-muted)" }} /> {t("ffNoRows")}
          </StateRow>
        ) : (
          groupRows(rows).map(({ row, start, alt }) => (
            <tr key={row.key} data-group-start={start ? "true" : undefined} data-group-alt={alt ? "true" : undefined}>
              <td data-sticky-col="true" style={BATCH_COL} title={row.batchNo} className={cn(TD, "w-[12.5rem] min-w-[12.5rem] max-w-[12.5rem] truncate font-medium", !start && MUTED)}>{row.batchNo}</td>
              <td data-sticky-col="last" style={ITEM_COL} title={row.itemName} className={cn(TD, "min-w-[13rem] max-w-[14rem] truncate", !start && MUTED)}>{row.itemName}</td>
              <td className={cn(TD, MUTED)}>{row.itemNo || "—"}</td>
              <td className={cn(TD, MUTED)}>{row.shedCode || "—"}</td>
              <td className={TD}>{row.days > 1 ? `${formatDateShort(row.date)} – ${formatDateShort(row.dateTo)}` : formatDateShort(row.date)}</td>
              <td className={TD}>
                {row.sourceType === "NONE" ? t("ffNoSource") : row.sourceCode ?? "—"}
                {row.sharedBatchCount > 1 && (
                  <Badge variant="neutral" className={cn("ml-1.5", SMALL_BADGE)} title={t("ffSharedTitle", { count: row.sharedBatchCount })}>
                    {t("ffSharedBy", { count: row.sharedBatchCount })}
                  </Badge>
                )}
              </td>
              <td className={cn(TD, NUM)}>{fmtKg(row.currentInventoryKg)}</td>
              <td className={cn(TD, NUM)}>{row.heads.toLocaleString("en-US")}</td>
              <td className={cn(TD, NUM)}>{fmtKg(row.perDayIntakeKg)}</td>
              <td className={cn(TD, NUM)}>
                <span>{row.daysOfStock ?? "—"}</span>
                {row.indicative && <Badge variant="warning" className={cn("ml-1.5", SMALL_BADGE)}>{t("ffIndicative")}</Badge>}
              </td>
              <td className={TD}>
                {row.runDownDate ? formatDateShort(row.runDownDate) : horizonTo ? t("ffBeyondHorizon", { date: formatDateShort(horizonTo) }) : "—"}
              </td>
              <td className={TD}>{formatDateShort(row.refillDate)}</td>
              <td className={TD}>
                <span>{formatDateShort(row.requiredOn)}</span>
                {row.overdue && <Badge variant="danger" className={cn("ml-1.5", SMALL_BADGE)}>{t("ffOverdue")}</Badge>}
              </td>
              <td className={cn(TD, NUM)}>{fmtKg(row.demandKg)}</td>
            </tr>
          ))
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
                {formatDateShort(s.stageChangeDate)}
                {s.stageChangeOverdue && <Badge variant="warning" className={cn("ml-1.5", SMALL_BADGE)}>{t("ffStageChangeNotPosted")}</Badge>}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </ScrollTable>
  );
}
