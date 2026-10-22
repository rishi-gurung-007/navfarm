"use client";

import { useEffect, useState } from "react";
import { FileDown, Loader2, Play } from "lucide-react";
import { api } from "@/services/api-client";
import { getActiveCompanyId, getActiveFarmId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ScrollTable } from "@/components/ui/scroll-table";
import { EmptyState } from "@/components/ui/states";
import { Toast } from "@/components/ui/toast";
import { changeTone, columnGroups, FARROWING_COLUMNS, groupStarts, NA, type FarrowingReport } from "./farrowing-report-columns";
import { exportFarrowingPdf } from "./farrowing-report-pdf";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const S = {
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
  // A tinted header: --surface-raised is the rows' white in the light theme, so the header did not stand apart.
  head: { backgroundColor: "var(--surface-secondary)", color: "var(--text-secondary)", borderColor: "var(--border)" },
  cell: { borderColor: "var(--border)" },
  // Each group of columns (Actual · Target · Prior YR · Change · YoY %) is set off from the next by a light, wider line.
  groupEdge: { borderLeft: "2px solid var(--border-strong)" },
  // The header's last line, a shade darker than the row lines, so the header reads apart from the rows under it.
  headEnd: { borderBottom: "1px solid var(--border-strong)" },
  up: { color: "var(--success)" },
  down: { color: "var(--danger)" },
};

// The first column of every group after the first.
const STARTS = groupStarts(FARROWING_COLUMNS);

// Both header rows stay in view. Every header cell sticks at top 0 by default (global.css), which left the sub-header
// row lying over the group row; the group row has a fixed height and the sub-header row sticks just below it.
const GROUP_ROW_PX = 34;



const PARITIES = Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

export default function FarrowingReportPanel() {
  const { t } = useLanguage();
  const [farms, setFarms] = useState<Row[]>([]);
  const [farmId, setFarmId] = useState<string>(() => getActiveFarmId() || "");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [batchId, setBatchId] = useState("");
  const [parity, setParity] = useState("");
  const [sowId, setSowId] = useState("");
  const [options, setOptions] = useState<{ batches: Row[]; sows: Row[] }>({ batches: [], sows: [] });
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [report, setReport] = useState<FarrowingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  // The report's own farm list: in the tenant-wide workspace the location master holds no company farms.
  useEffect(() => {
    api
      .get(`/reports/farrowing/farms`)
      .then((res: any) => setFarms(unwrap<Row[]>(res) || []))
      .catch(() => setFarms([]));
  }, []);
  // The chosen farm's company: a tenant administrator may pick a farm of any company.
  const companyId = farms.find((f) => f.farm_id === farmId)?.company_id ?? getActiveCompanyId();

  // A farm's own batches and sows feed the two pickers below it; a new farm starts the other filters over.
  useEffect(() => {
    setBatchId("");
    setSowId("");
    setReport(null);
    if (!farmId) {
      setOptions({ batches: [], sows: [] });
      return;
    }
    setOptionsLoading(true);
    const qs = new URLSearchParams({ farmId });
    if (companyId) qs.set("companyId", companyId);
    api
      .get(`/reports/farrowing/filters?${qs.toString()}`)
      .then((res: any) => setOptions(unwrap(res) || { batches: [], sows: [] }))
      .catch(() => setOptions({ batches: [], sows: [] }))
      .finally(() => setOptionsLoading(false));
  }, [farmId, companyId]);

  const ready = Boolean(farmId && dateFrom && dateTo);

  const generate = async () => {
    if (!ready) return;
    if (dateFrom > dateTo) {
      setError(t("rptDatesInvalid"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ farmId, dateFrom, dateTo });
      if (companyId) qs.set("companyId", companyId);
      if (batchId) qs.set("batchId", batchId);
      if (parity) qs.set("parity", parity);
      if (sowId) qs.set("sowId", sowId);
      const res = await api.get(`/reports/farrowing?${qs.toString()}`);
      setReport(unwrap<FarrowingReport>(res));
    } catch (err: any) {
      setReport(null);
      setError(err?.message || t("rptLoadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const exportPdf = async () => {
    if (!report) return;
    setExporting(true);
    try {
      await exportFarrowingPdf(report, t);
    } catch (err: any) {
      setError(err?.message || t("rptLoadFailed"));
    } finally {
      setExporting(false);
    }
  };

  const groups = columnGroups(FARROWING_COLUMNS);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-md)] border p-4 sm:grid-cols-2 lg:grid-cols-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <Field label={t("rptFarm")} required>
          <SearchableSelect
            ariaLabel={t("rptFarm")}
            ariaRequired
            value={farmId}
            onChange={setFarmId}
            options={farms}
            valueKey="farm_id"
            getLabel={(r) => String(r.farm_name ?? "")}
            placeholder={t("rptSelectFarm")}
          />
        </Field>
        <Field label={t("rptDateFrom")} htmlFor="rpt-date-from" required>
          <input id="rpt-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="nf-input-sm w-full" style={S.input} />
        </Field>
        <Field label={t("rptDateTo")} htmlFor="rpt-date-to" required>
          <input id="rpt-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="nf-input-sm w-full" style={S.input} />
        </Field>
        <Field label={t("rptBatch")}>
          <SearchableSelect
            ariaLabel={t("rptBatch")}
            value={batchId}
            onChange={setBatchId}
            onClear={() => setBatchId("")}
            options={options.batches}
            valueKey="batch_id"
            getLabel={(r) => String(r.batch_no ?? "")}
            placeholder={t("rptAll")}
            loading={optionsLoading}
            disabled={!farmId}
          />
        </Field>
        <Field label={t("rptParity")} hint={t("rptParityHint")}>
          <SearchableSelect
            ariaLabel={t("rptParity")}
            value={parity}
            onChange={setParity}
            onClear={() => setParity("")}
            options={PARITIES}
            valueKey="value"
            labelKey="label"
            placeholder={t("rptAll")}
          />
        </Field>
        <Field label={t("rptSow")}>
          <SearchableSelect
            ariaLabel={t("rptSow")}
            value={sowId}
            onChange={setSowId}
            onClear={() => setSowId("")}
            options={options.sows}
            valueKey="animal_id"
            getLabel={(r) => String(r.animal_code ?? "")}
            placeholder={t("rptAll")}
            loading={optionsLoading}
            disabled={!farmId}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-6">
          <Button onClick={generate} disabled={!ready || loading} size="sm">
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
            {t("rptGenerate")}
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={!report || report.rows.length === 0 || exporting}>
            {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileDown className="mr-1.5 h-4 w-4" />}
            {t("rptExportPdf")}
          </Button>
        </div>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError("")} />

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin" style={{ color: "var(--accent)" }} /></div>
      ) : !report ? (
        <EmptyState title={t("rptFarrowingReport")} description={t("rptEmptyPrompt")} />
      ) : report.rows.length === 0 ? (
        <EmptyState title={t("rptNoRecords")} />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs" style={S.sub}>
            <span>
              <strong style={S.primary}>{report.farm.farm_name}</strong> · {report.filters.date_from} – {report.filters.date_to}
              {report.filters.batch_no ? ` · ${t("rptBatch")} ${report.filters.batch_no}` : ""}
              {report.filters.parity ? ` · ${t("rptParity")} ${report.filters.parity}` : ""}
              {report.filters.sow_code ? ` · ${t("rptSow")} ${report.filters.sow_code}` : ""}
            </span>
            <span style={S.muted}>{t("rptGeneratedAt", { at: new Date(report.generated_at).toLocaleString() })}</span>
          </div>
          <ScrollTable label={t("rptFarrowingReport")}>
            <thead>
              <tr>
                <th rowSpan={2} data-sticky-col className="border-b border-r px-3 py-2 font-semibold" style={{ ...S.head, ...S.headEnd, color: "var(--text-primary)" }}>{t("rptSowBatch")}</th>
                {groups.map((g, i) => (
                  <th key={`${g.group}-${i}`} colSpan={g.span} className="border-b border-r px-3 text-center font-semibold whitespace-nowrap" style={{ ...S.head, color: "var(--text-primary)", height: GROUP_ROW_PX, ...(i > 0 ? S.groupEdge : {}) }}>{t(g.group)}</th>
                ))}
              </tr>
              <tr>
                {FARROWING_COLUMNS.map((c, i) => (
                  <th key={i} className="border-b border-r px-3 py-1.5 text-center text-[11px] font-medium whitespace-nowrap" style={{ ...S.head, ...S.headEnd, top: GROUP_ROW_PX, ...(STARTS.has(i) ? S.groupEdge : {}) }}>{t(c.sub)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.batch_id ?? "total"} style={row.is_total ? { backgroundColor: "var(--surface-raised)", fontWeight: 600 } : undefined}>
                  <td data-sticky-col className="border-b border-r px-3 py-2 whitespace-nowrap" style={{ ...S.cell, ...S.primary, backgroundColor: row.is_total ? "var(--surface-raised)" : "var(--surface)" }}>
                    {row.is_total ? t("rptFarmTotal") : row.batch_no}
                    {!row.is_total && (
                      <div className="text-[10px]" style={S.muted}>{t("rptPriorBatch", { batch: row.prior_batch_no ?? NA })}</div>
                    )}
                  </td>
                  {FARROWING_COLUMNS.map((c, i) => {
                    const text = c.cell(row, t);
                    const faint = text === t("rptNotAvailable") || text === NA;
                    const change = changeTone(c, text);
                    const tone = faint ? S.muted : change === "good" ? S.up : change === "bad" ? S.down : S.primary;
                    return (
                      <td key={i} className="border-b border-r px-3 py-2 text-right whitespace-nowrap tabular-nums" style={{ ...S.cell, ...tone, ...(STARTS.has(i) ? S.groupEdge : {}) }}>{text}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </ScrollTable>
          <p className="text-[11px]" style={S.muted}>{t("rptPriorYearNote")}</p>
        </div>
      )}
    </div>
  );
}
