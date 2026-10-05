"use client";

import type { CSSProperties, ReactNode } from "react";
import { Inbox, Loader2 } from "lucide-react";
import { ScrollTable } from "@/components/ui/scroll-table";
import { cn } from "@/lib/utils";
import { formatDateShort } from "./feed-format";

export interface ReportRow {
  key: string;
  farmId: string;
  batchId: string;
  batchGroupId: string;
  batchNo: string;
  shedId: string | null;
  shedCode: string;
  stageCode: string;
  itemId: string;
  itemNo: string;
  itemName: string;
  sourceType: "SILO" | "STORE" | "NONE";
  feedType: "BULK" | "BAGGED";
  sourceCode: string | null;
  sourceName: string | null;
  sourceLocationId: string | null;
  currentItemId: string | null;
  currentItemNo: string | null;
  currentItemName: string | null;
  date: string;
  dateTo: string;
  days: number;
  currentInventoryKg: number;
  openingSystemBalanceKg: number;
  confirmedReceiptsKg: number;
  heads: number;
  feedRateKg: number;
  perDayIntakeKg: number;
  intakeKg: number;
  dailyUseKg: number;
  projectedClosingBalanceKg: number;
  recommendedQtyKg: number;
  firstShortageDate: string | null;
  deliveryDate: string | null;
  daysOfStock: number | null;
  sharedBatchCount: number;
  indicative: boolean;
  runDownDate: string | null;
}

export interface SourceBalancePoint {
  date: string;
  sourceType: "SILO" | "STORE";
  sourceCode: string;
  sourceName: string | null;
  locationId: string;
  itemId: string;
  itemNo: string;
  itemName: string;
  currentItemId: string | null;
  currentItemNo: string | null;
  currentItemName: string | null;
  openingSystemBalanceKg: number;
  confirmedReceiptKg: number;
  dailyUseKg: number;
  projectedClosingBalanceKg: number;
  recommendedQtyKg: number;
  firstShortageDate: string | null;
  deliveryDate: string | null;
  runDownDate: string | null;
}

type Translate = (key: any, vars?: any) => string;

export const GRID_COLUMNS = [
  "ffColBatch", "ffColHouse", "ffColSiloCode", "ffColSiloName", "ffColRequiredFeedItem", "ffColCurrentSiloItem",
  "ffColHeadCount", "ffColFeedRate", "ffColOpeningSystemBalance", "ffColConfirmedReceipts", "ffColDailyUse",
  "ffColFirstShortage", "ffColRecommendedQty", "ffColDeliveryDate",
] as const;

export interface ColumnSlot {
  key: string;
  label: string;
  dateStart: string;
  dateEnd: string;
}

export interface PivotedFeedRow extends ReportRow {
  closingBySlot: Record<string, number>;
}

export function diffDaysIso(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

export function addDaysIso(isoDate: string, n: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + n)).toISOString().slice(0, 10);
}

function sourceKey(locationId: string | null, sourceCode: string | null, itemId: string): string {
  return `${locationId ?? sourceCode ?? "NONE"}|${itemId}`;
}

function forecastLineKey(row: ReportRow): string {
  return [
    row.batchGroupId,
    row.shedId ?? row.shedCode,
    row.stageCode,
    row.itemId,
    row.sourceType,
    row.sourceLocationId ?? row.sourceCode ?? "NONE",
  ].join("|");
}

/**
 * DAILY and CUSTOM API results contain one record per date. The grid puts
 * dates across columns, so those records must first become one logical line.
 * Stage and item remain in the identity so a diet/stage change is still shown
 * as a separate line rather than being hidden inside the date columns.
 */
function collapseForecastLines(rows: ReportRow[]): ReportRow[] {
  const lines = new Map<string, ReportRow>();
  for (const row of [...rows].sort((left, right) => left.date.localeCompare(right.date))) {
    const key = forecastLineKey(row);
    const line = lines.get(key);
    if (!line) {
      lines.set(key, { ...row, key });
      continue;
    }
    line.dateTo = row.dateTo > line.dateTo ? row.dateTo : line.dateTo;
    line.days += row.days;
    line.intakeKg += row.intakeKg;
    line.confirmedReceiptsKg += row.confirmedReceiptsKg;
    line.recommendedQtyKg = Math.max(line.recommendedQtyKg, row.recommendedQtyKg);
    line.sharedBatchCount = Math.max(line.sharedBatchCount, row.sharedBatchCount);
    line.indicative = line.indicative || row.indicative;
    if (row.firstShortageDate && (!line.firstShortageDate || row.firstShortageDate < line.firstShortageDate)) {
      line.firstShortageDate = row.firstShortageDate;
    }
    if (row.deliveryDate && (!line.deliveryDate || row.deliveryDate < line.deliveryDate)) {
      line.deliveryDate = row.deliveryDate;
    }
    if (row.runDownDate && (!line.runDownDate || row.runDownDate < line.runDownDate)) {
      line.runDownDate = row.runDownDate;
    }
  }
  return [...lines.values()];
}

function slotFor(date: string, view: string | undefined, from: string): ColumnSlot {
  if (view === "WEEKLY") {
    const start = addDaysIso(from, Math.max(0, Math.floor(diffDaysIso(from, date) / 7)) * 7);
    const end = addDaysIso(start, 6);
    return { key: start, label: `${formatDateShort(start)} – ${formatDateShort(end)}`, dateStart: start, dateEnd: end };
  }
  return { key: date, label: formatDateShort(date), dateStart: date, dateEnd: date };
}

/**
 * Batch facts stay on report rows; dated stock comes only from the one-per-
 * source balance series. A shared silo therefore appears on each consuming
 * batch line without its closing balance ever being summed.
 */
export function pivotForecastRows(
  rows: ReportRow[],
  sourceBalances: SourceBalancePoint[] = [],
  view?: string,
  from?: string,
): { pivoted: PivotedFeedRow[]; columns: ColumnSlot[] } {
  const baseFrom = from || sourceBalances[0]?.date || rows[0]?.date || "";
  const pointsBySource = new Map<string, SourceBalancePoint[]>();
  for (const point of [...sourceBalances].sort((left, right) => left.date.localeCompare(right.date))) {
    const key = sourceKey(point.locationId, point.sourceCode, point.itemId);
    pointsBySource.set(key, [...(pointsBySource.get(key) ?? []), point]);
  }

  const slots = new Map<string, ColumnSlot>();
  const pivoted = collapseForecastLines(rows).map((row) => {
    const closingBySlot: Record<string, number> = {};
    const points = pointsBySource.get(sourceKey(row.sourceLocationId, row.sourceCode, row.itemId)) ?? [];
    if (points.length) {
      for (const point of points) {
        const slot = slotFor(point.date, view, baseFrom);
        slots.set(slot.key, slot);
        // Chronological traversal means the last point in a weekly bucket is
        // its closing balance, including zero in the run-down bucket.
        closingBySlot[slot.key] = point.projectedClosingBalanceKg;
      }
    } else {
      const slot = slotFor(row.dateTo || row.date, view, baseFrom);
      slots.set(slot.key, slot);
      closingBySlot[slot.key] = row.projectedClosingBalanceKg;
    }
    return { ...row, closingBySlot };
  });

  return {
    pivoted,
    columns: [...slots.values()].sort((left, right) => left.dateStart.localeCompare(right.dateStart)),
  };
}

export function fmtKg(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function itemLabel(no: string | null | undefined, name: string | null | undefined): string {
  if (no && name) return `${no} — ${name}`;
  return no || name || "";
}

const BATCH_COL = { "--sticky-left": "0px" } as CSSProperties;
const HOUSE_COL = { "--sticky-left": "12.5rem" } as CSSProperties;
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const MUTED = "text-[var(--text-muted)]";

function StateRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return <tr><td colSpan={colSpan} className="px-3 py-10 text-center text-xs text-[var(--text-secondary)]">{children}</td></tr>;
}

export function FeedForecastGrid({
  rows,
  sourceBalances = [],
  view,
  from,
  loading,
  t,
}: {
  rows: ReportRow[];
  sourceBalances?: SourceBalancePoint[];
  view?: string;
  from?: string;
  loading: boolean;
  t: Translate;
}) {
  const { pivoted, columns } = pivotForecastRows(rows, sourceBalances, view, from);
  const totalCols = GRID_COLUMNS.length + columns.length;
  return (
    <ScrollTable label={t("ffGridLabel")} className="w-full">
      <thead>
        <tr>
          <th scope="col" data-sticky-col="true" style={BATCH_COL} className={cn(TH, "w-[12.5rem] min-w-[12.5rem] max-w-[12.5rem]")}>{t("ffColBatch")}</th>
          <th scope="col" data-sticky-col="last" style={HOUSE_COL} className={cn(TH, "min-w-[11rem]")}>{t("ffColHouse")}</th>
          <th scope="col" className={TH}>{t("ffColSiloCode")}</th>
          <th scope="col" className={TH}>{t("ffColSiloName")}</th>
          <th scope="col" className={TH}>{t("ffColRequiredFeedItem")}</th>
          <th scope="col" className={TH}>{t("ffColCurrentSiloItem")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColHeadCount")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColFeedRate")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColOpeningSystemBalance")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColConfirmedReceipts")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColDailyUse")}</th>
          {columns.map((column) => <th key={column.key} scope="col" className={cn(TH, NUM, "min-w-[8rem] bg-[var(--table-header-alt)]")} title={t("ffProjectedClosingOn", { date: column.label })}>{column.label}</th>)}
          <th scope="col" className={TH}>{t("ffColFirstShortage")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColRecommendedQty")}</th>
          <th scope="col" className={TH}>{t("ffColDeliveryDate")}</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <StateRow colSpan={totalCols}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={{ color: "var(--accent)" }} />{t("ffLoading")}</StateRow>
        ) : pivoted.length === 0 ? (
          <StateRow colSpan={totalCols}><Inbox className="mx-auto mb-2 h-6 w-6" style={{ color: "var(--text-muted)" }} />{t("ffNoRows")}</StateRow>
        ) : pivoted.map((row, index) => (
          <tr key={row.key} data-group-alt={index % 2 ? "true" : undefined} className={index % 2 ? "bg-[var(--table-row-alt)]" : undefined}>
            <td data-sticky-col="true" style={BATCH_COL} className={cn(TD, "w-[12.5rem] max-w-[12.5rem] truncate font-medium")}>{row.batchNo}</td>
            <td data-sticky-col="last" style={HOUSE_COL} className={cn(TD, MUTED)}>{row.shedCode}</td>
            <td className={cn(TD, MUTED)}>{row.sourceCode ?? ""}</td>
            <td className={cn(TD, MUTED)}>{row.sourceName ?? ""}</td>
            <td className={TD}>{itemLabel(row.itemNo, row.itemName)}</td>
            <td className={TD}>{itemLabel(row.currentItemNo, row.currentItemName)}</td>
            <td className={cn(TD, NUM)}>{row.heads.toLocaleString("en-US")}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.feedRateKg)}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.openingSystemBalanceKg)}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.confirmedReceiptsKg)}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.dailyUseKg)}</td>
            {columns.map((column) => {
              const value = row.closingBySlot[column.key];
              return <td key={column.key} className={cn(TD, NUM, value === 0 && "font-medium text-[var(--danger)]")}>{fmtKg(value)}</td>;
            })}
            <td className={cn(TD, row.firstShortageDate && "font-semibold text-[var(--danger)]")}>{row.firstShortageDate ? formatDateShort(row.firstShortageDate) : ""}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.recommendedQtyKg)}</td>
            <td className={TD}>{row.deliveryDate ? formatDateShort(row.deliveryDate) : ""}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}
