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
import { ScrollTable } from "@/components/ui/scroll-table";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDateShort } from "@/utils/date-short";
import { downloadCsvFile, escapeCsvCell } from "@/modules/master-data/utils/master-csv";
import { unwrap } from "./feed-format";
import { useFeedForecastContext } from "./feed-forecast-context";
import { MillCapacityBadge, millCapacityText, formatKg, type MillCapacityState, type MillCapacityStatus } from "./mill-capacity-view";

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

  return (
    <div data-fill-body>
      <div className="flex shrink-0 flex-wrap items-end gap-3">
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
      {report && (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {formatDateShort(report.from)}{report.to !== report.from ? ` – ${formatDateShort(report.to)}` : ""} · {t("mcrCapacityLine", {
            mill: report.mill.millCode,
            daily: report.mill.dailyKg === null ? t("millCapNotConfigured") : formatKg(report.mill.dailyKg),
            bulk: report.mill.bulkKg === null ? t("millCapNotConfigured") : formatKg(report.mill.bulkKg),
            bagged: report.mill.baggedKg === null ? t("millCapNotConfigured") : formatKg(report.mill.baggedKg),
          })}
        </p>
      )}
      {loading ? <LoadingState label={t("mcrLoading")} /> : !result ? (
        <EmptyState title={t("mcrPrompt")} />
      ) : !report ? (
        <EmptyState title={t("mcrNoMill")} />
      ) : report.rows.length === 0 ? (
        <EmptyState title={t("mcrEmpty")} />
      ) : (
        <ScrollTable label={t("mcrTableLabel")}>
          <thead><tr>
            {(["mcrColDate", "mcrColPriority", "mcrColDietNo", "mcrColItemNo", "mcrColItemName", "mcrColBin", "mcrColFarms", "mcrColRequested", "mcrColApproved", "mcrColAvailable", "mcrColStatus"] as const).map((key) => <th key={key}>{t(key)}</th>)}
          </tr></thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={`${row.productionDate}:${row.itemId}`}>
                <td>{formatDateShort(row.productionDate)}</td>
                <td>{row.priority ?? t("millCapNotScheduled")}</td>
                <td>{row.dietNo ?? t("feedPlanUnavailable")}</td>
                <td>{row.itemCode}</td>
                <td>{row.itemName}</td>
                <td>{row.binCode ?? t("millCapNotScheduled")}</td>
                <td>{row.farmCount}</td>
                <td>{formatKg(row.requestedKg)}</td>
                <td>{row.millApprovedKg === null ? t("mcrNotConsolidated") : formatKg(row.millApprovedKg)}</td>
                <td>{millCapacityText(row.state, row.availableKg, t)}</td>
                <td><MillCapacityBadge status={row.status} t={t} /></td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td colSpan={7}>{t("mcrTotal")}</td>
              <td>{formatKg(report.total.requestedKg)}</td>
              <td>{formatKg(report.total.millApprovedKg)}</td>
              <td>{report.total.capacityKg === null ? t("millCapNotConfigured") : formatKg(report.total.capacityKg)}</td>
              <td><MillCapacityBadge status={report.total.status} t={t} title={t("mcrTotalHint", { days })} /></td>
            </tr>
          </tbody>
        </ScrollTable>
      )}
    </div>
  );
}
