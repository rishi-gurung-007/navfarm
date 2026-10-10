"use client";

/**
 * Compare Report — workbook "Feed Forecast" r11: "all farm demand vs mill
 * capacity per diet". Per production date and diet of one MILL: every farm's
 * approved requisition KG, the mill-approved KG from consolidation, and Mill
 * Capacity Available KG with its GREEN / AMBER / RED status (Engine r42–r43).
 * The API does the arithmetic (mill-capacity.rules.ts); this page only shows
 * and exports it.
 */
import { useRef, useState } from "react";
import { api } from "@/services/api-client";
import { showToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { StatCard, StatRow } from "@/components/ui/stat-row";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDateShort } from "@/utils/date-short";
import { downloadCsvFile, escapeCsvCell } from "@/modules/master-data/utils/master-csv";
import { unwrap } from "./feed-format";
import { useFeedForecastContext } from "./feed-forecast-context";
import { millCapacityText, formatKg, type MillCapacityState, type MillCapacityStatus } from "./mill-capacity-view";

interface CompareRow {
  productionDate: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  dietNo: number | null;
  farmCount: number;
  requestedKg: number;
  millApprovedKg: number | null;
  availableKg: number | null;
  state: MillCapacityState;
  status: MillCapacityStatus | null;
  priority: number | null;
  binCode: string | null;
  feedForm: "BULK" | "BAGGED" | null;
}

interface CompareResult {
  mills: Array<{ millId: string; millCode: string; millName: string }>;
  report: null | {
    mill: { millId: string; millCode: string; dailyKg: number | null; bulkKg: number | null; baggedKg: number | null };
    from: string;
    to: string;
    rows: CompareRow[];
    total: { requestedKg: number; millApprovedKg: number; capacityKg: number | null; status: MillCapacityStatus | null };
  };
}

const DOT: Record<MillCapacityStatus, string> = { GREEN: "bg-(--success)", AMBER: "bg-(--warning)", RED: "bg-(--danger)" };
const LABEL: Record<MillCapacityStatus, "millCapGreen" | "millCapAmber" | "millCapRed"> = { GREEN: "millCapGreen", AMBER: "millCapAmber", RED: "millCapRed" };
const TONE: Record<MillCapacityStatus, "success" | "warning" | "danger"> = { GREEN: "success", AMBER: "warning", RED: "danger" };

function StatusDot({ status, t, title }: { status: MillCapacityStatus | null | undefined; t: (key: any, vars?: any) => string; title?: string }) {
  if (!status) return <span className="text-(--text-secondary)">{t("millCapNoStatus")}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-(--text-secondary)" title={title}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      {t(LABEL[status])}
    </span>
  );
}

const TH = "sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)";
const TD = "border-b border-(--border) px-3 py-2 align-top";
const NUM = "whitespace-nowrap text-right tabular-nums";

export default function MillComparePanel() {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const { planningDate } = useFeedForecastContext();
  const [date, setDate] = useState(planningDate);
  const [period, setPeriod] = useState<"DAY" | "WEEK">("WEEK");
  const [millId, setMillId] = useState("");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!date) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ date, period });
      if (millId) params.set("millId", millId);
      const data = unwrap<CompareResult>(await api.get(`/feed-forecast/mill-compare?${params.toString()}`));
      setResult(data);
      if (!millId && data?.report) setMillId(data.report.mill.millId);
    } catch (err: any) {
      showToast.error(err?.message || tRef.current("mcrLoadFailed"));
    } finally {
      setLoading(false);
    }
  }

  const report = result?.report ?? null;
  const days = report ? Math.round((Date.parse(report.to) - Date.parse(report.from)) / 86_400_000) + 1 : 0;

  function exportCsv() {
    if (!report) return;
    const header = [t("mcrColDate"), t("mcrColPriority"), t("mcrColDietNo"), t("mcrColItemNo"), t("mcrColItemName"), t("mcrColBin"), t("mcrColForm"), t("mcrColFarms"), t("mcrColRequested"), t("mcrColApproved"), t("mcrColAvailable"), t("mcrColStatus")];
    const lines = report.rows.map((row) => [
      row.productionDate, row.priority ?? "", row.dietNo ?? "", row.itemCode, row.itemName, row.binCode ?? "", row.feedForm ?? "", row.farmCount,
      row.requestedKg, row.millApprovedKg ?? "", row.state === "AVAILABLE" ? row.availableKg ?? "" : millCapacityText(row.state, null, t), row.status ?? "",
    ]);
    lines.push([t("mcrTotal"), "", "", "", "", "", "", "", report.total.requestedKg, report.total.millApprovedKg, report.total.capacityKg ?? "", report.total.status ?? ""]);
    downloadCsvFile(`compare-report-${report.mill.millCode}-${report.from}-${report.to}`, [header, ...lines].map((line) => line.map(escapeCsvCell).join(",")).join("\n"));
  }

  const nc = (v: number | null) => (v === null ? t("millCapNotConfigured") : formatKg(v));
  return (
    <div data-fill-body className="min-h-0 overflow-y-auto">
      <div className="flex shrink-0 flex-wrap items-end gap-3 [&_.nf-input-sm]:h-9 [&>button]:h-9">
        {(result?.mills.length ?? 0) > 0 && (
          <Field label={t("mcrMill")} htmlFor="mill-compare-mill">
            <select id="mill-compare-mill" className="nf-input-sm nf-select" value={millId} onChange={(event) => setMillId(event.target.value)}>
              {result!.mills.map((mill) => <option key={mill.millId} value={mill.millId}>{mill.millCode} — {mill.millName}</option>)}
            </select>
          </Field>
        )}
        <Field label={t("mcrPeriod")} htmlFor="mill-compare-period">
          <select id="mill-compare-period" className="nf-input-sm nf-select" value={period} onChange={(event) => setPeriod(event.target.value as "DAY" | "WEEK")}>
            <option value="DAY">{t("mcrPeriodDay")}</option>
            <option value="WEEK">{t("mcrPeriodWeek")}</option>
          </select>
        </Field>
        <Field label={t("mcrDate")} htmlFor="mill-compare-date">
          <input id="mill-compare-date" type="date" className="nf-input-sm" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Button onClick={load} disabled={!date || loading}>{t("mcrLoad")}</Button>
        <Button className="ml-auto" variant="outline" onClick={exportCsv} disabled={!report || report.rows.length === 0}>{t("mcrExport")}</Button>
      </div>
      {report && !loading && (
        <div className="mt-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-(--text-primary)">
              {report.mill.millCode} · {formatDateShort(report.from)}{report.to !== report.from ? ` – ${formatDateShort(report.to)}` : ""}
            </h2>
            <p className="mt-0.5 text-xs text-(--text-secondary)">
              {t("mcrCapacityLine", { mill: report.mill.millCode, daily: nc(report.mill.dailyKg), bulk: nc(report.mill.bulkKg), bagged: nc(report.mill.baggedKg) })}
            </p>
          </div>
          <StatRow columns={4}>
            <StatCard label={t("mcrSumCapacity")} value={nc(report.mill.dailyKg)} unit="KG" sub={t("mcrSumSplit", { bulk: nc(report.mill.bulkKg), bagged: nc(report.mill.baggedKg) })} />
            <StatCard label={t("mcrSumRequested")} value={formatKg(report.total.requestedKg)} unit="KG" />
            <StatCard label={t("mcrSumApproved")} value={formatKg(report.total.millApprovedKg)} unit="KG" />
            <StatCard label={t("mcrColStatus")} value={report.total.status ? t(LABEL[report.total.status]) : t("millCapNoStatus")} tone={report.total.status ? TONE[report.total.status] : "default"} sub={t("mcrTotalHint", { days })} />
          </StatRow>
        </div>
      )}
      {loading ? <LoadingState label={t("mcrLoading")} /> : !result ? (
        <EmptyState title={t("mcrPrompt")} />
      ) : !report ? (
        <EmptyState title={t("mcrNoMill")} />
      ) : report.rows.length === 0 ? (
        <EmptyState title={t("mcrEmpty")} />
      ) : (
        <div className="mt-4 max-h-[60vh] shrink-0 overflow-x-auto overflow-y-auto rounded-md border border-(--border) bg-(--surface)">
          <table aria-label={t("mcrTableLabel")} className="w-max min-w-full border-separate border-spacing-0 text-left text-xs">
            <thead><tr>
              {([["mcrColDate", "min-w-24"], ["mcrColPriority", "min-w-20"], ["mcrColDietNo", "min-w-16"], ["mcrColItemNo", "min-w-36"], ["mcrColItemName", "min-w-56"], ["mcrColBin", "min-w-36"], ["mcrColFarms", "min-w-16 text-right"], ["mcrColRequested", "min-w-32 text-right"], ["mcrColApproved", "min-w-32 text-right"], ["mcrColAvailable", "min-w-36 text-right"], ["mcrColStatus", "min-w-32"]] as const).map(([key, cls]) => <th key={key} className={`${TH} ${cls}`}>{t(key)}</th>)}
            </tr></thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={`${row.productionDate}:${row.itemId}`}>
                  <td className={`${TD} whitespace-nowrap`}>{formatDateShort(row.productionDate)}</td>
                  <td className={`${TD} whitespace-nowrap`}>{row.priority ?? t("millCapNotScheduled")}</td>
                  <td className={`${TD} whitespace-nowrap`}>{row.dietNo ?? t("feedPlanUnavailable")}</td>
                  <td className={`${TD} whitespace-nowrap`}>{row.itemCode}</td>
                  <td className={`${TD} min-w-56 whitespace-normal break-words text-(--text-primary)`}>{row.itemName}</td>
                  <td className={`${TD} whitespace-nowrap`}>{row.binCode ?? t("millCapNotScheduled")}</td>
                  <td className={`${TD} ${NUM}`}>{row.farmCount}</td>
                  <td className={`${TD} ${NUM}`}>{formatKg(row.requestedKg)}</td>
                  <td className={`${TD} ${NUM}`}>{row.millApprovedKg === null ? t("mcrNotConsolidated") : formatKg(row.millApprovedKg)}</td>
                  <td className={`${TD} ${NUM}`}>{millCapacityText(row.state, row.availableKg, t)}</td>
                  <td className={TD}><StatusDot status={row.status} t={t} /></td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={`${TD} bg-(--surface-raised)`} colSpan={7}>{t("mcrTotal")}</td>
                <td className={`${TD} ${NUM} bg-(--surface-raised)`}>{formatKg(report.total.requestedKg)}</td>
                <td className={`${TD} ${NUM} bg-(--surface-raised)`}>{formatKg(report.total.millApprovedKg)}</td>
                <td className={`${TD} ${NUM} bg-(--surface-raised)`}>{nc(report.total.capacityKg)}</td>
                <td className={`${TD} bg-(--surface-raised)`}><StatusDot status={report.total.status} t={t} title={t("mcrTotalHint", { days })} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
