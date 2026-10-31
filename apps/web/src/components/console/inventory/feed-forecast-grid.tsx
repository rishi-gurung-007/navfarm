"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Inbox, Loader2 } from "lucide-react";
import { ScrollTable } from "@/components/ui/scroll-table";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { NA } from "@/utils/na";
import { HoverHint } from "@/components/ui/hover-hint";
import { formatDateShort, todayIso } from "./feed-format";
import { RecordLink, batchHref, itemHref, locationHref } from "./feed-requisition-header";

/** W2D W7: a planned feed requisition opens in the Feed Forecast requisition tab. */
export const feedRequisitionHref = (id: string) => `/inventory/feed-forecast?tab=feed-requisition&id=${encodeURIComponent(id)}`;

export interface ReportRow {
  key: string;
  farmId: string;
  batchId: string;
  batchGroupId: string;
  /** Composite "BATCH · STAGE" label for a stage group; kept for older responses. */
  batchNo: string;
  /** The batch number alone (Rishi, 10 Oct: the stage has its own column). Absent on responses saved before it. */
  plainBatchNo?: string;
  shedId: string | null;
  shedCode: string;
  stageCode: string;
  stageName?: string | null;
  /** The line's stage is a projected change from the stage the group is in today. */
  stageProjected?: boolean;
  itemId: string;
  itemNo: string;
  itemName: string;
  sourceType: "SILO" | "STORE" | "NONE";
  feedType: "BULK" | "BAGGED";
  sourceCode: string | null;
  sourceName: string | null;
  /** The source silo's capacity; null for the store, no source, or an unset capacity. */
  sourceCapacityKg?: number | null;
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
  otherOutflowKg?: number;
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
  /** Stock that left other than by feeding (negative adjustment, transfer out): 0 or more, shown only in the balance dialog. */
  otherOutflowKg?: number;
  /** Part of otherOutflowKg: a negative ledger opening recovered from this day's stock. */
  usedBeforeReceivedKg?: number;
  incomingReferences?: Array<{ kind: string; referenceId?: string; referenceNo?: string; relatedReferenceNo?: string; expectedDate?: string; overdue?: boolean }>;
  dailyUseKg: number;
  projectedClosingBalanceKg: number;
  recommendedQtyKg: number;
  firstShortageDate: string | null;
  deliveryDate: string | null;
  runDownDate: string | null;
}

/** A batch whose feed changes in the window, as the API's dietChanges sends it. */
export interface DietChange {
  /** The batch group the forecast lines carry as batchGroupId. */
  batchId: string;
  fromItemId: string;
  fromItemName: string;
  toItemId: string;
  toItemName: string;
  changeDate: string;
  nextSourceType: "SILO" | "STORE" | "NONE";
  nextSourceCode: string | null;
}

type Translate = (key: any, vars?: any) => string;

export const GRID_COLUMNS = [
  "ffColBatch", "ffColStage", "ffColHouse", "ffColSiloCode", "ffColSiloName", "ffColSiloCapacity", "ffColRequiredFeedItem", "ffColDietChangeDate", "ffColCurrentSiloItem",
  "ffColHeadCount", "ffColUom", "ffColFeedRate", "ffColOpeningSystemBalance", "ffColConfirmedReceipts", "ffColOpenTransfers", "ffColPlannedFeedAdded", "ffColPlannedFeedReference", "ffColDailyUse",
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
  /** Position of the line's batch among the batches shown, for banding. */
  batchIndex: number;
  /** The first line of its batch: only this one shows the batch number. */
  batchStart: boolean;
  /** The diet change that starts this line's feed, if one does. */
  dietChange: DietChange | null;
  /**
   * Rishi, 31 Oct: the day this line's feed would start when its batch has no feed in the forecast before then —
   * the forecast reports no diet change there (nothing earlier to change from), yet the batch's feed does change.
   */
  feedStart: string | null;
}

export interface BalanceCell {
  openingKg: number;
  confirmedReceiptKg: number;
  openTransferKg: number;
  plannedIncomingKg: number;
  otherOutflowKg: number;
  usedBeforeReceivedKg: number;
  dailyUseKg: number;
  closingKg: number;
  incomingReferences: Array<{ kind: string; referenceId?: string; referenceNo?: string; relatedReferenceNo?: string; expectedDate?: string; overdue?: boolean }>;
}

/** Rishi, 12 Oct: no quantity in the calculation is negative. The API sends none; this also keeps an older saved run honest. */
function nonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : 0;
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
    line.otherOutflowKg = (line.otherOutflowKg ?? 0) + (row.otherOutflowKg ?? 0);
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

function batchKey(row: ReportRow): string {
  return row.batchId || batchNoOnly(row);
}

/**
 * Rishi, 30 Oct: one batch's lines sit together whatever stage, feed or silo
 * each is on. Batches keep the API's order (house, then batch) by their first
 * line; inside a batch the lines run by start date, so a diet change follows
 * the feed it replaces.
 */
function groupBatchLines(lines: ReportRow[], rows: ReportRow[]): ReportRow[] {
  const rank = new Map<string, number>();
  rows.forEach((row) => {
    if (!rank.has(batchKey(row))) rank.set(batchKey(row), rank.size);
  });
  return [...lines].sort((left, right) =>
    (rank.get(batchKey(left)) ?? 0) - (rank.get(batchKey(right)) ?? 0)
    || left.date.localeCompare(right.date)
    || left.itemName.localeCompare(right.itemName)
    || (left.sourceCode ?? "").localeCompare(right.sourceCode ?? ""));
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
  dietChanges: DietChange[] = [],
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

  let batchIndex = -1;
  let previousBatch: string | null = null;

  const pivoted =
    groupBatchLines(collapseForecastLines(rows), rows).map((row) => {
      const batchStart = batchKey(row) !== previousBatch;
      if (batchStart) batchIndex += 1;
      previousBatch = batchKey(row);
      const dietChange = dietChanges.find((change) =>
        change.batchId === row.batchGroupId
        && change.toItemId === row.itemId
        && change.changeDate >= row.date
        && change.changeDate <= row.dateTo) ?? null;
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
                confirmedReceiptKg: previous.confirmedReceiptKg + nonNegative(point.confirmedReceiptKg),
                openTransferKg: previous.openTransferKg + nonNegative(point.openTransferMovementKg),
                plannedIncomingKg: previous.plannedIncomingKg + nonNegative(point.plannedIncomingKg),
                otherOutflowKg: previous.otherOutflowKg + nonNegative(point.otherOutflowKg),
                usedBeforeReceivedKg: previous.usedBeforeReceivedKg + nonNegative(point.usedBeforeReceivedKg),
                dailyUseKg: previous.dailyUseKg + point.dailyUseKg,
                closingKg: point.projectedClosingBalanceKg,
                incomingReferences: [...previous.incomingReferences, ...(point.incomingReferences ?? [])],
              }
            : {
                openingKg: nonNegative(point.openingSystemBalanceKg),
                confirmedReceiptKg: nonNegative(point.confirmedReceiptKg),
                openTransferKg: nonNegative(point.openTransferMovementKg),
                plannedIncomingKg: nonNegative(point.plannedIncomingKg),
                otherOutflowKg: nonNegative(point.otherOutflowKg),
                usedBeforeReceivedKg: nonNegative(point.usedBeforeReceivedKg),
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
          openingKg: nonNegative(row.openingSystemBalanceKg),
          confirmedReceiptKg: nonNegative(row.confirmedReceiptsKg),
          openTransferKg: nonNegative(row.openTransferMovementKg),
          plannedIncomingKg: nonNegative(row.plannedIncomingKg),
          otherOutflowKg: nonNegative(row.otherOutflowKg),
          usedBeforeReceivedKg: 0,
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
        batchIndex,
        batchStart,
        dietChange,
        feedStart: null as string | null,
        firstShortageDate: inWindow(row.firstShortageDate) ? row.firstShortageDate : null,
        deliveryDate: inWindow(row.firstShortageDate) ? row.deliveryDate : null,
      };
    });

  // A batch's line that starts after the forecast's first day, with no earlier line of the same batch.
  const firstDay = baseFrom;
  const earliestByBatch = new Map<string, string>();
  for (const line of pivoted) {
    const at = earliestByBatch.get(batchKey(line));
    if (!at || line.date < at) earliestByBatch.set(batchKey(line), line.date);
  }
  for (const line of pivoted) {
    line.feedStart = !line.dietChange && firstDay && line.date > firstDay && earliestByBatch.get(batchKey(line)) === line.date
      ? line.date
      : null;
  }

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

// Batch, Stage and House stay pinned; the offsets are the widths of the pinned columns before each.
// Silo Capacity, then UOM, pin beside them once scrolled to (Rishi, 31 Oct), so House and Silo Capacity
// need fixed widths for the offsets after them.
const BATCH_COL = { "--sticky-left": "0px" } as CSSProperties;
const STAGE_COL = { "--sticky-left": "8.5rem" } as CSSProperties;
const HOUSE_COL = { "--sticky-left": "19.5rem" } as CSSProperties;
const CAPACITY_COL = { "--sticky-left": "28rem" } as CSSProperties;
const UOM_COL = { "--sticky-left": "37rem" } as CSSProperties;

/** The batch number alone — a stage group's composite label is cut back when an older response has no plainBatchNo. */
function batchNoOnly(row: ReportRow): string {
  if (row.plainBatchNo) return row.plainBatchNo;
  const at = row.batchNo.lastIndexOf(" · ");
  return at === -1 || row.batchGroupId === row.batchId ? row.batchNo : row.batchNo.slice(0, at);
}

function stageLabel(row: ReportRow, t: Translate): string {
  const stage = row.stageName || row.stageCode;
  return row.stageProjected ? t("ffStageProjected", { stage }) : stage;
}
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const MUTED = "text-[var(--text-muted)]";

/** Planned requisition refs, each linked to its feed requisition; explanatory text when none. */
function PlannedReferences({ references, empty }: { references: ReportRow["incomingReferences"]; empty: string }) {
  const planned = (references ?? []).filter((reference) => reference.kind === "PLANNED_REQUISITION" && reference.referenceNo);
  if (!planned.length) return <>{empty}</>;
  return <>{planned.map((reference, index) => <span key={`${reference.referenceId ?? reference.referenceNo}-${index}`}>
    {index > 0 && ", "}
    <RecordLink code={reference.referenceNo} href={reference.referenceId ? feedRequisitionHref(reference.referenceId) : null} />
  </span>)}</>;
}

function StateRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return <tr><td colSpan={colSpan} className="px-3 py-10 text-center text-xs text-[var(--text-secondary)]">{children}</td></tr>;
}

export function FeedForecastGrid({
  rows,
  sourceBalances = [],
  view,
  from,
  dietChanges = [],
  loading,
  t,
}: {
  rows: ReportRow[];
  sourceBalances?: SourceBalancePoint[];
  view?: string;
  from?: string;
  dietChanges?: DietChange[];
  loading: boolean;
  t: Translate;
}) {
  const { pivoted, columns } = pivotForecastRows(rows, sourceBalances, view, from, dietChanges);
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
          <th scope="col" data-sticky-col="true" style={BATCH_COL} className={cn(TH, "w-[8.5rem] min-w-[8.5rem] max-w-[8.5rem]")}>{t("ffColBatch")}</th>
          <th scope="col" data-sticky-col="true" style={STAGE_COL} className={cn(TH, "w-[11rem] min-w-[11rem] max-w-[11rem]")}>{t("ffColStage")}</th>
          <th scope="col" data-sticky-col="last" style={HOUSE_COL} className={cn(TH, "w-[8.5rem] min-w-[8.5rem] max-w-[8.5rem]")}>{t("ffColHouse")}</th>
          <th scope="col" className={TH}>{t("ffColSiloCode")}</th>
          <th scope="col" className={TH}>{t("ffColSiloName")}</th>
          <th scope="col" data-sticky-col="true" style={CAPACITY_COL} className={cn(TH, NUM, "w-[9rem] min-w-[9rem] max-w-[9rem]")}>{t("ffColSiloCapacity")}</th>
          <th scope="col" className={TH}>{t("ffColRequiredFeedItem")}</th>
          <th scope="col" className={TH}>{t("ffColDietChangeDate")}</th>
          <th scope="col" className={TH}>{t("ffColCurrentSiloItem")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColHeadCount")}</th>
          <th scope="col" data-sticky-col="last" style={UOM_COL} className={TH}>{t("ffColUom")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColFeedRate")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColOpeningSystemBalance")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColConfirmedReceipts")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColOpenTransfers")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColPlannedFeedAdded")}</th>
          <th scope="col" className={TH}>{t("ffColPlannedFeedReference")}</th>
          <th scope="col" className={cn(TH, NUM)}>{t("ffColDailyUse")}</th>
          {columns.map((column) => <th key={column.key} scope="col" className={cn(TH, NUM, "min-w-[8rem] bg-[var(--table-header-alt)]")} title={t(view === "WEEKLY" ? "ffProjectedClosingWeek" : "ffProjectedClosingOn", { date: column.label })}>{column.label}</th>)}
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
        ) : pivoted.map((row) => (
          <tr key={row.key} data-batch-start={row.batchStart ? "true" : undefined} data-group-alt={row.batchIndex % 2 ? "true" : undefined} className={cn(row.batchIndex % 2 && "bg-[var(--table-row-alt)]")}>
            <td data-sticky-col="true" style={BATCH_COL} className={cn(TD, "w-[8.5rem] max-w-[8.5rem] truncate font-medium")} title={batchNoOnly(row)}>{row.batchStart && <RecordLink code={batchNoOnly(row)} href={row.batchId ? batchHref(row.batchId) : null} />}</td>
            <td data-sticky-col="true" style={STAGE_COL} className={cn(TD, "w-[11rem] max-w-[11rem] truncate")}><HoverHint hint={t(row.stageProjected ? "ffHintStageProjected" : "ffHintStage", { batch: batchNoOnly(row), stage: row.stageName || row.stageCode, from: formatDateShort(row.date), to: formatDateShort(row.dateTo) })}>{stageLabel(row, t)}</HoverHint></td>
            <td data-sticky-col="last" style={HOUSE_COL} className={cn(TD, MUTED, "w-[8.5rem] max-w-[8.5rem] truncate")} title={row.shedCode}><RecordLink code={row.shedCode} href={row.shedId ? locationHref(row.shedId) : null} /></td>
            <td className={cn(TD, MUTED)}>{row.sourceCode ? <RecordLink code={row.sourceCode} href={row.sourceLocationId ? locationHref(row.sourceLocationId) : null} /> : t("ffNoSource")}</td>
            <td className={cn(TD, MUTED)}>{row.sourceName ?? t("ffNoSourceName")}</td>
            <td data-sticky-col="true" style={CAPACITY_COL} className={cn(TD, NUM, "w-[9rem] max-w-[9rem]")}>{row.sourceType === "SILO" && row.sourceCapacityKg != null
              ? <HoverHint hint={t("ffHintCapacity", { silo: row.sourceCode ?? "", kg: fmtKg(row.sourceCapacityKg) })}>{fmtKg(row.sourceCapacityKg)}</HoverHint>
              : <HoverHint hint={t(row.sourceType === "SILO" ? "ffNaNoSiloCapacity" : row.sourceType === "STORE" ? "ffNaStoreNoCapacity" : "ffNaNoSource")}>{NA}</HoverHint>}</td>
            <td className={TD}><RecordLink code={row.itemName} href={row.itemId ? itemHref(row.itemId) : null} /></td>
            {/* Rishi, 30 Oct: the diet change has its own column, the date the line's new feed starts. */}
            <td className={cn(TD, !row.dietChange && MUTED)}>{row.dietChange
              ? <HoverHint hint={t("ffDietChangeHint", {
                  from: row.dietChange.fromItemName,
                  to: row.dietChange.toItemName,
                  date: formatDateShort(row.dietChange.changeDate),
                  source: row.sourceCode ?? t("ffNoSource"),
                })}>{formatDateShort(row.dietChange.changeDate)}</HoverHint>
              : row.feedStart
                ? <HoverHint hint={t("ffFeedStartHint", { item: row.itemName, date: formatDateShort(row.feedStart), batch: batchNoOnly(row) })}>{formatDateShort(row.feedStart)}</HoverHint>
                : <HoverHint hint={t("ffNaNoDietChange")}>{NA}</HoverHint>}</td>
            <td className={TD}>{row.currentItemName ? <RecordLink code={row.currentItemName} href={row.currentItemId ? itemHref(row.currentItemId) : null} /> : <HoverHint hint={t("ffHintNoCurrentItem", { silo: row.sourceCode ?? t("ffNoSource") })}>{t("ffNoCurrentSiloItem")}</HoverHint>}</td>
            {/* Rishi, 31 Oct: every figure says on hover what it is; what lies ahead is worded as what would happen. */}
            <td className={cn(TD, NUM)}><HoverHint hint={t("ffHintHeads", { heads: row.heads.toLocaleString("en-US"), batch: batchNoOnly(row), stage: row.stageName || row.stageCode })}>{row.heads.toLocaleString("en-US")}</HoverHint></td>
            <td data-sticky-col="last" style={UOM_COL} className={TD}>KG</td>
            <td className={cn(TD, NUM)}><HoverHint hint={t("ffHintRate", { kg: fmtKg(row.feedRateKg), item: row.itemName })}>{fmtKg(row.feedRateKg)}</HoverHint></td>
            <td className={cn(TD, NUM)}><HoverHint hint={t(row.date > todayIso() ? "ffHintOpeningFuture" : "ffHintOpening", { kg: fmtKg(nonNegative(row.openingSystemBalanceKg)), item: row.itemName, silo: row.sourceCode ?? t("ffNoSource"), date: formatDateShort(row.date) })}>{fmtKg(nonNegative(row.openingSystemBalanceKg))}</HoverHint></td>
            <td className={cn(TD, NUM)}><HoverHint hint={t("ffHintConfirmed", { kg: fmtKg(nonNegative(row.confirmedReceiptsKg)), silo: row.sourceCode ?? t("ffNoSource") })}>{fmtKg(nonNegative(row.confirmedReceiptsKg))}</HoverHint></td>
            <td className={cn(TD, NUM)}><HoverHint hint={t("ffHintOpenTransfer", { kg: fmtKg(row.openTransferMovementKg ?? 0), silo: row.sourceCode ?? t("ffNoSource") })}>{fmtKg(row.openTransferMovementKg ?? 0)}</HoverHint></td>
            <td className={cn(TD, NUM)}><HoverHint hint={t("ffHintPlanned", { kg: fmtKg(row.plannedIncomingKg ?? 0), silo: row.sourceCode ?? t("ffNoSource") })}>{fmtKg(row.plannedIncomingKg ?? 0)}</HoverHint></td>
            <td className={TD}><PlannedReferences references={row.incomingReferences} empty={t("ffNoPlannedFeed")} /></td>
            <td className={cn(TD, NUM)}><HoverHint hint={t("ffHintDailyUse", { kg: fmtKg(row.dailyUseKg), heads: row.heads.toLocaleString("en-US"), rate: fmtKg(row.feedRateKg) })}>{fmtKg(row.dailyUseKg)}</HoverHint></td>
            {columns.map((column) => {
              const value = row.closingBySlot[column.key];
              const balance = row.balanceBySlot[column.key];
              const sourceKey = `${row.sourceLocationId ?? row.sourceCode ?? "NONE"}|${row.itemId}|${column.key}`;
              const hasExpectedIncoming = !!balance && (balance.plannedIncomingKg > 0 || balance.openTransferKg > 0);
              const showIncoming = hasExpectedIncoming && !shownIncoming.has(sourceKey);
              if (showIncoming) shownIncoming.add(sourceKey);
              // Rishi, 30 Oct: a date this line's feed is not required on reads N/A, not blank.
              if (value === undefined) {
                return <td key={column.key} className={cn(TD, NUM, MUTED)} data-not-required="true"><HoverHint hint={t("ffFeedNotRequiredOnDate")}>{NA}</HoverHint></td>;
              }
              return <td key={column.key} className={cn(TD, NUM, value === 0 && "font-medium text-[var(--danger)]")}>
                <button
                  type="button"
                  className="group w-full text-right hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  aria-label={t("ffBalanceExplainAria", { date: column.label })}
                  onClick={() => balance && setSelectedBalance({ row, column, balance })}
                >
                  {/* Rishi, 11 Oct: no second line in the cell. The balance on a
                      day feed arrives is coloured; clicking it opens the dialog
                      that itemises the planned feed and expected transfer. */}
                  <span
                    data-incoming={showIncoming ? "true" : undefined}
                    className={cn("block", showIncoming && "font-semibold text-[var(--accent)]")}
                  ><HoverHint focusable={false} hint={[
                    t(view === "WEEKLY" ? "ffHintClosingWeek" : "ffHintClosing", { kg: fmtKg(value), silo: row.sourceCode ?? t("ffNoSource"), date: column.label }),
                    showIncoming ? t("ffIncomingCellHint") : t("ffHintClickBreakdown"),
                  ].join(" ")}>{fmtKg(value)}</HoverHint></span>
                </button>
              </td>;
            })}
            <td className={cn(TD, row.firstShortageDate && "font-semibold text-[var(--danger)]")}><HoverHint hint={row.firstShortageDate
              ? t("ffHintShortage", { silo: row.sourceCode ?? t("ffNoSource"), item: row.itemName, date: formatDateShort(row.firstShortageDate) })
              : t("ffHintNoShortage", { silo: row.sourceCode ?? t("ffNoSource"), item: row.itemName, date: formatDateShort(row.dateTo) })}>{row.firstShortageDate ? formatDateShort(row.firstShortageDate) : t("ffNoShortageProjected")}</HoverHint></td>
            <td className={cn(TD, NUM)}><HoverHint hint={row.recommendedQtyKg > 0
              ? t("ffHintRecommended", { kg: fmtKg(row.recommendedQtyKg), silo: row.sourceCode ?? t("ffNoSource") })
              : t("ffHintNoRecommended")}>{fmtKg(row.recommendedQtyKg)}</HoverHint></td>
            <td className={TD}><HoverHint hint={row.deliveryDate
              ? t("ffHintDelivery", { date: formatDateShort(row.deliveryDate) })
              : t("ffHintNoDelivery")}>{row.deliveryDate ? formatDateShort(row.deliveryDate) : t("ffNoDeliveryRequired")}</HoverHint></td>
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
    >
      {selectedBalance && <div className="space-y-4 text-sm">
        <p className="text-[var(--text-secondary)]">{t("ffBalanceExplainBody")}</p>
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4 font-mono text-sm">
          <div>{t("ffBalanceOpening", { kg: fmtKg(selectedBalance.balance.openingKg) })}</div>
          {selectedBalance.balance.plannedIncomingKg > 0 && <div className="text-[var(--accent)]">+ {fmtKg(selectedBalance.balance.plannedIncomingKg)} KG {t("ffPlannedShort")}</div>}
          {selectedBalance.balance.openTransferKg > 0 && <div className="text-[var(--accent)]">+ {fmtKg(selectedBalance.balance.openTransferKg)} KG {t("ffExpectedTransferShort")}</div>}
          {selectedBalance.balance.confirmedReceiptKg > 0 && <div>+ {fmtKg(selectedBalance.balance.confirmedReceiptKg)} KG {t("ffConfirmedReceiptShort")}</div>}
          {selectedBalance.balance.usedBeforeReceivedKg > 0 && <div>− {fmtKg(selectedBalance.balance.usedBeforeReceivedKg)} KG {t("ffUsedBeforeReceivedShort")}</div>}
          {selectedBalance.balance.otherOutflowKg - selectedBalance.balance.usedBeforeReceivedKg > 0.0001 && <div>− {fmtKg(selectedBalance.balance.otherOutflowKg - selectedBalance.balance.usedBeforeReceivedKg)} KG {t("ffOtherMovementsShort")}</div>}
          <div>− {fmtKg(selectedBalance.balance.dailyUseKg)} KG {t(view === "WEEKLY" ? "ffWeekUseShort" : "ffDailyUseShort")}</div>
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
