"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Inbox, Loader2 } from "lucide-react";
import { ScrollTable } from "@/components/ui/scroll-table";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
  openTransferMovementKg?: number;
  plannedIncomingKg?: number;
  incomingReferences?: Array<{ kind: string; referenceId?: string; referenceNo?: string; relatedReferenceNo?: string; expectedDate?: string; overdue?: boolean }>;
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
  openTransferMovementKg?: number;
  plannedIncomingKg?: number;
  incomingReferences?: Array<{ kind: string; referenceId?: string; referenceNo?: string; relatedReferenceNo?: string; expectedDate?: string; overdue?: boolean }>;
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
  "ffColHeadCount", "ffColFeedRate", "ffColOpeningSystemBalance", "ffColConfirmedReceipts", "ffColOpenTransfers", "ffColPlannedFeedAdded", "ffColPlannedFeedReference", "ffColDailyUse",
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
  balanceBySlot: Record<string, BalanceCell>;
}

export interface BalanceCell {
  openingKg: number;
  confirmedReceiptKg: number;
  openTransferKg: number;
  plannedIncomingKg: number;
  dailyUseKg: number;
  closingKg: number;
  incomingReferences: Array<{ kind: string; referenceId?: string; referenceNo?: string; relatedReferenceNo?: string; expectedDate?: string; overdue?: boolean }>;
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

  for (
    const row of [...rows].sort((left, right) =>
      left.date.localeCompare(right.date),
    )
  ) {
    const key = forecastLineKey(row);
    const line = lines.get(key);

    if (!line) {
      // First chronological row becomes the base line.
      // Its runDownDate and deliveryDate are based on the
      // displayed Opening Balance + Daily Use.
      lines.set(key, { ...row, key });
      continue;
    }

    line.dateTo =
      row.dateTo > line.dateTo
        ? row.dateTo
        : line.dateTo;

    line.days += row.days;
    line.intakeKg += row.intakeKg;
    line.confirmedReceiptsKg += row.confirmedReceiptsKg;
    line.openTransferMovementKg = (line.openTransferMovementKg ?? 0) + (row.openTransferMovementKg ?? 0);
    line.plannedIncomingKg = (line.plannedIncomingKg ?? 0) + (row.plannedIncomingKg ?? 0);
    line.incomingReferences = [...(line.incomingReferences ?? []), ...(row.incomingReferences ?? [])];

    line.recommendedQtyKg = Math.max(
      line.recommendedQtyKg,
      row.recommendedQtyKg,
    );

    line.sharedBatchCount = Math.max(
      line.sharedBatchCount,
      row.sharedBatchCount,
    );

    line.indicative =
      line.indicative || row.indicative;

    // Keep earliest physical shortage evidence if needed internally.
    if (
      row.firstShortageDate &&
      (!line.firstShortageDate ||
        row.firstShortageDate < line.firstShortageDate)
    ) {
      line.firstShortageDate =
        row.firstShortageDate;
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
  const baseFrom =
    from ||
    sourceBalances[0]?.date ||
    rows[0]?.date ||
    "";

  const pointsBySource =
    new Map<string, SourceBalancePoint[]>();

  for (
    const point of [...sourceBalances].sort(
      (left, right) =>
        left.date.localeCompare(right.date),
    )
  ) {
    const key = sourceKey(
      point.locationId,
      point.sourceCode,
      point.itemId,
    );

    pointsBySource.set(
      key,
      [
        ...(pointsBySource.get(key) ?? []),
        point,
      ],
    );
  }

  const slots = new Map<string, ColumnSlot>();

  const pivoted =
    collapseForecastLines(rows).map((row) => {
      const closingBySlot:
        Record<string, number> = {};
      const balanceBySlot: Record<string, BalanceCell> = {};

      const points =
        pointsBySource.get(
          sourceKey(
            row.sourceLocationId,
            row.sourceCode,
            row.itemId,
          ),
        ) ?? [];

      if (points.length) {
        for (const point of points) {
          // A source balance is physical and shared, but a calculation line
          // displays it only while that batch/stage/item has applicable demand.
          if (point.date < row.date || point.date > row.dateTo) continue;

          const slot = slotFor(
            point.date,
            view,
            baseFrom,
          );

          slots.set(slot.key, slot);

          // For WEEKLY, chronological traversal means
          // the final day in the week becomes the
          // displayed weekly closing balance.
          closingBySlot[slot.key] = point.projectedClosingBalanceKg;
          const previous = balanceBySlot[slot.key];
          balanceBySlot[slot.key] = previous
            ? {
                ...previous,
                confirmedReceiptKg: previous.confirmedReceiptKg + point.confirmedReceiptKg,
                openTransferKg: previous.openTransferKg + (point.openTransferMovementKg ?? 0),
                plannedIncomingKg: previous.plannedIncomingKg + (point.plannedIncomingKg ?? 0),
                dailyUseKg: previous.dailyUseKg + point.dailyUseKg,
                closingKg: point.projectedClosingBalanceKg,
                incomingReferences: [...previous.incomingReferences, ...(point.incomingReferences ?? [])],
              }
            : {
                openingKg: point.openingSystemBalanceKg,
                confirmedReceiptKg: point.confirmedReceiptKg,
                openTransferKg: point.openTransferMovementKg ?? 0,
                plannedIncomingKg: point.plannedIncomingKg ?? 0,
                dailyUseKg: point.dailyUseKg,
                closingKg: point.projectedClosingBalanceKg,
                incomingReferences: [...(point.incomingReferences ?? [])],
              };
        }
      } else {
        const slot = slotFor(
          row.dateTo || row.date,
          view,
          baseFrom,
        );

        slots.set(slot.key, slot);

        closingBySlot[slot.key] =
          row.projectedClosingBalanceKg;
        balanceBySlot[slot.key] = {
          openingKg: row.openingSystemBalanceKg,
          confirmedReceiptKg: row.confirmedReceiptsKg,
          openTransferKg: row.openTransferMovementKg ?? 0,
          plannedIncomingKg: row.plannedIncomingKg ?? 0,
          dailyUseKg: row.dailyUseKg,
          closingKg: row.projectedClosingBalanceKg,
          incomingReferences: [...(row.incomingReferences ?? [])],
        };
      }

      const inWindow = (date: string | null) =>
        !!date && date >= row.date && date <= row.dateTo;

      return {
        ...row,
        closingBySlot,
        balanceBySlot,
        firstShortageDate: inWindow(row.firstShortageDate) ? row.firstShortageDate : null,
        deliveryDate: inWindow(row.firstShortageDate) ? row.deliveryDate : null,
      };
    });

  return {
    pivoted,
    columns: [...slots.values()].sort(
      (left, right) =>
        left.dateStart.localeCompare(
          right.dateStart,
        ),
    ),
  };
}

export function fmtKg(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (!Number.isFinite(value)) return "Not available";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const [selectedBalance, setSelectedBalance] = useState<{
    row: PivotedFeedRow;
    column: ColumnSlot;
    balance: BalanceCell;
  } | null>(null);
  // One silo/item/date is one physical movement. Shared batch rows still show
  // the same balance, but the planned-incoming badge is shown only once.
  const shownIncoming = new Set<string>();
  return (
    <>
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
          <th scope="col" className={cn(TH, NUM)}>{t("ffColOpenTransfers")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColPlannedFeedAdded")}</th>
          <th scope="col" className={TH}>{t("ffColPlannedFeedReference")}</th>
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
            <td className={cn(TD, MUTED)}>{row.sourceCode ?? t("ffNoSource")}</td>
            <td className={cn(TD, MUTED)}>{row.sourceName ?? t("ffNoSourceName")}</td>
            <td className={TD}>{row.itemName ?? ""}</td>
            <td className={TD}>{row.currentItemName ?? t("ffNoCurrentSiloItem")}</td>
            <td className={cn(TD, NUM)}>{row.heads.toLocaleString("en-US")}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.feedRateKg)}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.openingSystemBalanceKg)}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.confirmedReceiptsKg)}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.openTransferMovementKg ?? 0)}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.plannedIncomingKg ?? 0)}</td>
            <td className={TD}>{(row.incomingReferences ?? []).filter((reference) => reference.kind === "PLANNED_REQUISITION").map((reference) => reference.referenceNo).filter(Boolean).join(", ") || t("ffNoPlannedFeed")}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.dailyUseKg)}</td>
            {columns.map((column) => {
              const value = row.closingBySlot[column.key];
              const balance = row.balanceBySlot[column.key];
              const sourceKey = `${row.sourceLocationId ?? row.sourceCode ?? "NONE"}|${row.itemId}|${column.key}`;
              const hasExpectedIncoming = !!balance && (balance.plannedIncomingKg > 0 || balance.openTransferKg > 0);
              const showIncoming = hasExpectedIncoming && !shownIncoming.has(sourceKey);
              if (showIncoming) shownIncoming.add(sourceKey);
              return <td key={column.key} className={cn(TD, NUM, value === 0 && "font-medium text-[var(--danger)]")}>
                <button
                  type="button"
                  className="group w-full text-right hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  aria-label={t("ffBalanceExplainAria", { date: column.label })}
                  onClick={() => balance && setSelectedBalance({ row, column, balance })}
                >
                  <span className="block">{fmtKg(value)}</span>
                  {showIncoming && <>
                    {balance.plannedIncomingKg > 0 && <span className="mt-0.5 block whitespace-nowrap text-[10px] font-semibold text-[var(--accent)]">+{fmtKg(balance.plannedIncomingKg)} KG {t("ffPlannedShort")}</span>}
                    {balance.openTransferKg > 0 && <span className="mt-0.5 block whitespace-nowrap text-[10px] font-semibold text-[var(--accent)]">+{fmtKg(balance.openTransferKg)} KG {t("ffExpectedTransferShort")}</span>}
                  </>}
                </button>
              </td>;
            })}
            <td className={cn(TD, row.firstShortageDate && "font-semibold text-[var(--danger)]")}>{row.firstShortageDate ? formatDateShort(row.firstShortageDate) : t("ffNoShortageProjected")}</td>
            <td className={cn(TD, NUM)}>{fmtKg(row.recommendedQtyKg)}</td>
            <td className={TD}>{row.deliveryDate ? formatDateShort(row.deliveryDate) : t("ffNoDeliveryRequired")}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
    <Dialog
      open={!!selectedBalance}
      onClose={() => setSelectedBalance(null)}
      title={selectedBalance ? t("ffBalanceExplainTitle", { date: selectedBalance.column.label }) : ""}
      description={selectedBalance ? `${selectedBalance.row.sourceCode ?? t("ffNoSource")} · ${selectedBalance.row.itemName}` : undefined}
      maxWidth="sm"
      footer={<Button type="button" onClick={() => setSelectedBalance(null)}>{t("close")}</Button>}
    >
      {selectedBalance && <div className="space-y-4 text-sm">
        <p className="text-[var(--text-secondary)]">{t("ffBalanceExplainBody")}</p>
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4 font-mono text-sm">
          <div>{t("ffBalanceOpening", { kg: fmtKg(selectedBalance.balance.openingKg) })}</div>
          {selectedBalance.balance.plannedIncomingKg > 0 && <div className="text-[var(--accent)]">+ {fmtKg(selectedBalance.balance.plannedIncomingKg)} KG {t("ffPlannedShort")}</div>}
          {selectedBalance.balance.openTransferKg > 0 && <div className="text-[var(--accent)]">+ {fmtKg(selectedBalance.balance.openTransferKg)} KG {t("ffExpectedTransferShort")}</div>}
          {selectedBalance.balance.confirmedReceiptKg > 0 && <div>+ {fmtKg(selectedBalance.balance.confirmedReceiptKg)} KG {t("ffConfirmedReceiptShort")}</div>}
          {selectedBalance.balance.openTransferKg > 0 && <div>+ {fmtKg(selectedBalance.balance.openTransferKg)} KG {t("ffOpenTransferShort")}</div>}
          <div>− {fmtKg(selectedBalance.balance.dailyUseKg)} KG {t("ffDailyUseShort")}</div>
          <div className="mt-2 border-t border-[var(--border)] pt-2 font-semibold">= {fmtKg(selectedBalance.balance.closingKg)} KG {t("ffClosingBalanceShort")}</div>
        </div>
        {selectedBalance.balance.incomingReferences.some((reference) => reference.referenceNo || reference.relatedReferenceNo) && <div className="space-y-1 text-xs text-[var(--text-secondary)]">
          {selectedBalance.balance.incomingReferences.filter((reference) => reference.referenceNo || reference.relatedReferenceNo).map((reference, index) => <div key={`${reference.kind}-${reference.referenceNo ?? reference.relatedReferenceNo}-${index}`}>
            {reference.kind === "PLANNED_REQUISITION" ? t("ffPlannedIncomingReference", { references: reference.referenceNo }) : t("ffExpectedTransferReference", { transfer: reference.referenceNo, requisition: reference.relatedReferenceNo ?? t("ffNoSource") })}
            {reference.expectedDate && <> · {t("ffExpectedDate", { date: formatDateShort(reference.expectedDate) })}</>}
          </div>)}
        </div>}
      </div>}
    </Dialog>
    </>
  );
}
