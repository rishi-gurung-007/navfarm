"use client";

/**
 * Inventory -> Feed Forecast: the report grid and the stage block (Feed
 * Forecast Plan R; the client's field specification of 26 Sep; spec
 * D16–D19). Presentational only — feed-forecast-panel.tsx fetches, these
 * render — so the column rules can be tested without the panel's farm and
 * fetch plumbing. Dates are DD/MM/YY (D16). Current Inventory is the System
 * Balance (checkpoint 37), never "physical stock".
 */
import { Inbox, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/**
 * The field specification's Report Grid in its order, with two of ours: Source
 * after Planning Date (D6 — a shed without a silo draws on the store, and the
 * user must see which), and the feed that leaves the silo, wastage included,
 * last (D17 — what run-down and the requisition use).
 */
export const GRID_COLUMNS = [
  "ffColBatchNo", "ffColItemName", "ffColItemNo", "ffColShedNo", "ffColPlanningDate", "ffColSource",
  "ffColCurrentInventoryKg", "ffColCurrentPigs", "ffColPerDayIntakeKg", "ffColDaysOfStock",
  "ffColRunDown", "ffColDateToRefill", "ffColRequiredOn", "ffColFeedOutKg",
] as const;

const RIGHT_ALIGNED = new Set<string>(["ffColCurrentInventoryKg", "ffColCurrentPigs", "ffColPerDayIntakeKg", "ffColDaysOfStock", "ffColFeedOutKg"]);

export function fmtKg(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** D17: "The screen states the wastage allowance used." */
export function wastageNote(rows: ReportRow[], t: Translate): string {
  const pcts = [...new Set(rows.map((r) => r.wastagePct).filter((p) => p > 0))].sort((a, b) => a - b);
  return pcts.length ? t("ffWastageUsed", { pcts: pcts.map((p) => `${p}%`).join(", ") }) : t("ffWastageNone");
}

const primary = { color: "var(--text-primary)" };
const secondary = { color: "var(--text-secondary)" };

export function FeedForecastGrid({ rows, loading, horizonTo, t }: { rows: ReportRow[]; loading: boolean; horizonTo: string | null; t: Translate }) {
  return (
    <Table>
      <TableHeader>
        <tr>
          {GRID_COLUMNS.map((c) => (
            <TableHead key={c} className={RIGHT_ALIGNED.has(c) ? "text-right" : undefined}>{t(c)}</TableHead>
          ))}
        </tr>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow>
            <TableCell colSpan={GRID_COLUMNS.length} className="py-10 text-center" style={secondary}>
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={{ color: "var(--accent)" }} /> {t("ffLoading")}
            </TableCell>
          </TableRow>
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={GRID_COLUMNS.length} className="py-10 text-center" style={secondary}>
              <Inbox className="mx-auto mb-2 h-6 w-6" style={{ color: "var(--text-muted)" }} /> {t("ffNoRows")}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="whitespace-nowrap" style={primary}>{row.batchNo}</TableCell>
              <TableCell className="whitespace-nowrap" style={primary}>{row.itemName}</TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>{row.itemNo || "—"}</TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>{row.shedCode || "—"}</TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>
                {row.days > 1 ? `${formatDateShort(row.date)} – ${formatDateShort(row.dateTo)}` : formatDateShort(row.date)}
              </TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>
                {row.sourceType === "NONE" ? t("ffNoSource") : row.sourceCode ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right" style={primary}>{fmtKg(row.currentInventoryKg)}</TableCell>
              <TableCell className="whitespace-nowrap text-right" style={primary}>{row.heads}</TableCell>
              <TableCell className="whitespace-nowrap text-right" style={primary}>{fmtKg(row.perDayIntakeKg)}</TableCell>
              <TableCell className="whitespace-nowrap text-right" style={primary}>
                <div className="flex items-center justify-end gap-1.5">
                  <span>{row.daysOfStock ?? "—"}</span>
                  {row.indicative && <Badge variant="warning">{t("ffIndicative")}</Badge>}
                </div>
                {row.sharedBatchCount > 1 && (
                  <p className="text-xs" style={secondary}>{t("ffSharedSilo", { count: row.sharedBatchCount })}</p>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>
                {row.runDownDate
                  ? formatDateShort(row.runDownDate)
                  : horizonTo
                    ? t("ffBeyondHorizon", { date: formatDateShort(horizonTo) })
                    : "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>{formatDateShort(row.refillDate)}</TableCell>
              <TableCell className="whitespace-nowrap">
                <div className="flex items-center gap-1.5">
                  <span style={secondary}>{formatDateShort(row.requiredOn)}</span>
                  {row.overdue && <Badge variant="danger">{t("ffOverdue")}</Badge>}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-right" style={primary}>{fmtKg(row.demandKg)}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export function FeedForecastStages({ stages, t }: { stages: StageBlock[]; t: Translate }) {
  if (!stages.length) return null;
  return (
    <section aria-label={t("ffStagesTitle")} className="flex flex-col gap-2">
      <p className="nf-text-caption">{t("ffStagesTitle")}</p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stages.map((s) => (
          <li
            key={s.batchId}
            className="rounded-[var(--radius-md)] border p-3 text-xs"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text-secondary)" }}
          >
            <p className="text-sm font-medium" style={primary}>{s.shedCode ? `${s.batchNo} · ${s.shedCode}` : s.batchNo}</p>
            <p>{t("ffStageCurrent")}: {s.currentStageCode} ({formatDateShort(s.currentFrom)} – {formatDateShort(s.currentTo)})</p>
            <p>
              {t("ffStageNext")}: {s.nextStageCode ?? "—"}
              {s.nextStageCode ? ` (${formatDateShort(s.nextFrom)} – ${formatDateShort(s.nextTo)})` : ""}
            </p>
            <div className="flex items-center gap-1.5">
              <span>{t("ffStageChangeDate")}: {formatDateShort(s.stageChangeDate)}</span>
              {s.stageChangeOverdue && <Badge variant="warning">{t("ffStageChangeNotPosted")}</Badge>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
