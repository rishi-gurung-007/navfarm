"use client";

import { useEffect, useState } from "react";
import {
  Loader2, Download, RefreshCw, CheckCircle2, AlertTriangle, ArrowRight,
  Layers,
} from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { StatRow, StatCard } from "@/components/ui/stat-row";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised:  { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub:     { color: "var(--text-secondary)" },
  muted:   { color: "var(--text-muted)" },
  accent:  { color: "var(--accent)" },
  danger:  { color: "var(--danger)", borderColor: "var(--danger)", backgroundColor: "var(--danger-muted)" },
  warning: { color: "var(--warning)", borderColor: "var(--warning)", backgroundColor: "var(--warning-muted)" },
  success: { color: "var(--success)", borderColor: "var(--success)", backgroundColor: "var(--success-muted)" },
};

export default function BioAssetRollForwardPanel() {
  const { formatMoney } = useCompanyCurrency();
  const formatCurrency = (val?: number | string | null) => formatMoney(val == null ? 0 : Number(val));
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();

  const currentYear = new Date().getFullYear();
  const [dateFrom, setDateFrom] = useState(`${currentYear}-01-01`);
  const [dateTo, setDateTo]     = useState(new Date().toISOString().slice(0, 10));

  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [data, setData]         = useState<Row | null>(null);
  const glReconciliationUnavailable = data?.glReconciliation?.available === false
    || data?.glReconciliation?.status === "UNAVAILABLE";
  const glReconciliationUnavailableReason = data?.glReconciliation?.reason
    || "GL reconciliation is unavailable for a farm-filtered report.";

  const loadStatement = async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.get(
        `/financial-reports/bio-asset-roll-forward?companyId=${companyId}&dateFrom=${dateFrom}&dateTo=${dateTo}`
      );
      setData(unwrap<Row>(res));
    } catch (err: any) {
      setError(err?.message || t("barfLoadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatement();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => {
    if (!data) return;
    const lines: Array<Array<string | number | null | undefined>> = [
      [t("barfCsvTitle")],
      [t("barfCsvPeriod", { dateFrom, dateTo })],
      [],
      [t("barfCsvMovementLine"), t("barfCsvAmountInr")],
      [t("barfOpeningCarryingValue"), data.openingCarryingValue],
      [t("barfCsvAcquisitions"), data.movements.acquisitions],
      [t("barfCsvGrowthCapitalization"), data.movements.growthCapitalization],
      [t("barfCsvAmortization"), data.movements.amortization],
      [t("barfCsvFairValueAdjustments"), data.movements.fairValueAdjustments],
      [t("barfCsvHarvestTransfers"), data.movements.harvestTransfers],
      [t("barfCsvDisposals"), data.movements.disposals],
      [t("barfNetPeriodMovements"), data.movements.netMovement],
      [t("barfClosingCarryingValue"), data.closingCarryingValue],
      [],
      [t("barfCsvGlReconciliation")],
    ];

    if (glReconciliationUnavailable) {
      lines.push(
        [t("barfCsvReconciledStatus"), "UNAVAILABLE"],
        ["Reason", glReconciliationUnavailableReason],
      );
    } else {
      lines.push(
        [t("barfCsvTotalGlBalance"), data.glReconciliation.totalGlBalance],
        [t("barfCsvGlVariance"), data.glReconciliation.variance],
        [t("barfCsvReconciledStatus"), data.glReconciliation.isReconciled ? t("barfCsvReconciled") : t("barfCsvVarianceDetected")],
      );
    }

    const csvContent = "data:text/csv;charset=utf-8," + lines.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `IAS41_Bio_Asset_RollForward_${dateFrom}_${dateTo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* ── Filters Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-lg)] border p-4" style={S.surface}>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="nf-text-label block mb-1" style={S.muted}>
              {t("barfFromDate")}
            </label>
            <input
              type="date"
              className="nf-input text-xs"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="nf-text-label block mb-1" style={S.muted}>
              {t("barfToDate")}
            </label>
            <input
              type="date"
              className="nf-input text-xs"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="flex items-end self-end">
            <Button size="sm" onClick={loadStatement} disabled={loading}>
              {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              {t("barfGenerateStatement")}
            </Button>
          </div>
        </div>

        {data && (
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> {t("barfExportCsv")}
          </Button>
        )}
      </div>

      <Toast variant="danger" message={error} onClose={() => setError("")} />

      {loading && (
        <div className="py-16 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin" style={S.accent} />
          <p className="mt-3 text-sm" style={S.sub}>{t("barfCalculating")}</p>
        </div>
      )}

      {!loading && data && (
        <div className="space-y-6">
          {/* ── Top Executive KPI Cards ── */}
          <StatRow>
            <StatCard
              label={t("barfOpeningCarryingValue")}
              value={formatCurrency(data.openingCarryingValue)}
              sub={t("barfAsOf", { date: dateFrom })}
            />
            <StatCard
              label={t("barfNetPeriodMovement")}
              tone={Number(data.movements.netMovement) >= 0 ? "default" : "danger"}
              value={formatCurrency(data.movements.netMovement)}
              sub={t("barfTransactionsRecorded", { count: data.transactionCount })}
            />
            <StatCard
              label={t("barfClosingCarryingValue")}
              value={formatCurrency(data.closingCarryingValue)}
              sub={t("barfAsOf", { date: dateTo })}
            />
            <StatCard
              icon={glReconciliationUnavailable ? Layers : data.glReconciliation.isReconciled ? CheckCircle2 : AlertTriangle}
              tone={glReconciliationUnavailable ? "default" : data.glReconciliation.isReconciled ? "success" : "warning"}
              emphasis={!glReconciliationUnavailable}
              label={t("barfGlReconciliation")}
              value={glReconciliationUnavailable
                ? "Unavailable"
                : data.glReconciliation.isReconciled
                  ? t("barfReconciled")
                  : formatCurrency(data.glReconciliation.variance)}
              sub={glReconciliationUnavailable
                ? glReconciliationUnavailableReason
                : t("barfGlNet", { amount: formatCurrency(data.glReconciliation.totalGlBalance) })}
            />
          </StatRow>

          {/* ── Main Roll-Forward Statement Table ── */}
          <div className="overflow-hidden rounded-[var(--radius-lg)] border shadow-sm" style={S.surface}>
            <div className="border-b px-5 py-4 flex items-center justify-between" style={S.raised}>
              <div>
                <h3 className="text-base font-semibold" style={S.primary}>{t("barfStatementTitle")}</h3>
                <p className="text-xs" style={S.muted}>{t("barfStatementSubtitle")}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold" style={S.surface}>
                <Layers className="h-3 w-3" style={S.accent} /> {t("barfStandardLabel")}
              </span>
            </div>

            <table className="w-full text-sm">
              <tbody className="divide-y divide-[var(--row-border)]">
                {/* 1. Opening Carrying Value */}
                <tr style={S.surface}>
                  <td className="px-5 py-3 font-semibold" style={S.primary}>
                    {t("barfOpeningCarryingAmount")}
                  </td>
                  <td className="px-5 py-3 text-right font-mono font-bold" style={S.primary}>
                    {formatCurrency(data.openingCarryingValue)}
                  </td>
                </tr>

                {/* 2. Additions */}
                <tr style={S.raised}>
                  <td colSpan={2} className="px-5 py-2 text-xs font-semibold uppercase tracking-wider" style={S.muted}>
                    {t("barfPeriodAdditions")}
                  </td>
                </tr>
                <tr className="hover:bg-[var(--row-hover)] transition-colors">
                  <td className="px-8 py-2.5" style={S.sub}>
                    {t("barfAcquisitionsLine")}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono" style={S.primary}>
                    {formatCurrency(data.movements.acquisitions)}
                  </td>
                </tr>
                <tr className="hover:bg-[var(--row-hover)] transition-colors">
                  <td className="px-8 py-2.5" style={S.sub}>
                    {t("barfGrowthCapitalizationLine")}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono" style={S.primary}>
                    {formatCurrency(data.movements.growthCapitalization)}
                  </td>
                </tr>

                {/* 3. Deductions & Adjustments */}
                <tr style={S.raised}>
                  <td colSpan={2} className="px-5 py-2 text-xs font-semibold uppercase tracking-wider" style={S.muted}>
                    {t("barfPeriodReductions")}
                  </td>
                </tr>
                <tr className="hover:bg-[var(--row-hover)] transition-colors">
                  <td className="px-8 py-2.5" style={S.sub}>
                    {t("barfAmortizationLine")}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono" style={data.movements.amortization < 0 ? S.danger : S.primary}>
                    {formatCurrency(data.movements.amortization)}
                  </td>
                </tr>
                <tr className="hover:bg-[var(--row-hover)] transition-colors">
                  <td className="px-8 py-2.5" style={S.sub}>
                    {t("barfFairValueAdjustmentsLine")}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono" style={data.movements.fairValueAdjustments < 0 ? S.danger : S.primary}>
                    {formatCurrency(data.movements.fairValueAdjustments)}
                  </td>
                </tr>
                <tr className="hover:bg-[var(--row-hover)] transition-colors">
                  <td className="px-8 py-2.5" style={S.sub}>
                    {t("barfHarvestTransfersLine")}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono" style={data.movements.harvestTransfers < 0 ? S.danger : S.primary}>
                    {formatCurrency(data.movements.harvestTransfers)}
                  </td>
                </tr>
                <tr className="hover:bg-[var(--row-hover)] transition-colors">
                  <td className="px-8 py-2.5" style={S.sub}>
                    {t("barfDisposalsLine")}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono" style={data.movements.disposals < 0 ? S.danger : S.primary}>
                    {formatCurrency(data.movements.disposals)}
                  </td>
                </tr>

                {/* 4. Total Movements Subtotal */}
                <tr style={S.raised}>
                  <td className="px-5 py-3 font-semibold" style={S.primary}>
                    {t("barfNetPeriodMovements")}
                  </td>
                  <td className="px-5 py-3 text-right font-mono font-bold" style={S.primary}>
                    {formatCurrency(data.movements.netMovement)}
                  </td>
                </tr>

                {/* 5. Closing Carrying Value */}
                <tr className="border-t-2" style={{ ...S.raised, borderTopColor: "var(--border)" }}>
                  <td className="px-5 py-4 text-base font-bold" style={S.primary}>
                    {t("barfClosingCarryingNbv")}
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-lg font-bold" style={S.primary}>
                    {formatCurrency(data.closingCarryingValue)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Asset Dimension Breakdown ── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-[var(--radius-lg)] border p-4 shadow-sm" style={S.surface}>
              <div className="flex items-center gap-2 mb-3">
                <Layers className="h-4 w-4" style={S.accent} />
                <h4 className="text-sm font-semibold" style={S.primary}>{t("barfAssetTrackingBreakdown")}</h4>
              </div>
              <div className="space-y-2 text-sm divide-y divide-[var(--row-border)]">
                <div className="flex justify-between py-1.5">
                  <span style={S.sub}>{t("barfBatchCohortAssets")}</span>
                  <span className="font-mono font-medium" style={S.primary}>
                    {formatCurrency(data.assetTypeBreakdown.batchCarryingValue)}
                  </span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span style={S.sub}>{t("barfIndividualTaggedAnimals")}</span>
                  <span className="font-mono font-medium" style={S.primary}>
                    {formatCurrency(data.assetTypeBreakdown.animalCarryingValue)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-[var(--radius-lg)] border p-4 shadow-sm" style={S.surface}>
              <div className="flex items-center gap-2 mb-3">
                <ArrowRight className="h-4 w-4" style={S.accent} />
                <h4 className="text-sm font-semibold" style={S.primary}>{t("barfGeneralLedgerAccounts")}</h4>
              </div>
              <div className="space-y-2 text-sm divide-y divide-[var(--row-border)]">
                {glReconciliationUnavailable ? (
                  <p className="text-xs py-2" style={S.muted}>{glReconciliationUnavailableReason}</p>
                ) : (
                  <>
                    {data.glReconciliation.glAccounts.map((a: Row) => (
                      <div key={a.account_code} className="flex justify-between py-1.5">
                        <span style={S.sub}>{a.account_name || a.account_code}</span>
                        <span className="font-mono font-medium" style={S.primary}>
                          {formatCurrency(a.balance)}
                        </span>
                      </div>
                    ))}
                    {data.glReconciliation.glAccounts.length === 0 && (
                      <p className="text-xs py-2" style={S.muted}>{t("barfNoGlPostings")}</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Bio-asset costing: the roll-forward by profile, and the runs tied to the GL ── */}
          {Array.isArray(data.byProfile) && data.byProfile.length > 0 && (
            <div className="overflow-hidden rounded-[var(--radius-lg)] border shadow-sm" style={S.surface} aria-label={t("barfByProfileTitle")}>
              <div className="border-b px-5 py-4" style={S.raised}>
                <h3 className="text-base font-semibold" style={S.primary}>{t("barfByProfileTitle")}</h3>
                <p className="text-xs" style={S.muted}>{t("barfByProfileSubtitle")}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right text-xs uppercase tracking-wider" style={{ ...S.muted, borderColor: "var(--row-border)" }}>
                      <th className="px-5 py-2 text-left">{t("barfProfileColumn")}</th>
                      <th className="px-3 py-2">{t("barfOpeningColumn")}</th>
                      <th className="px-3 py-2">{t("barfAcquisitionsColumn")}</th>
                      <th className="px-3 py-2">{t("barfCapitalisedColumn")}</th>
                      <th className="px-3 py-2">{t("barfAmortisationColumn")}</th>
                      <th className="px-3 py-2">{t("barfFairValueColumn")}</th>
                      <th className="px-3 py-2">{t("barfExitsColumn")}</th>
                      <th className="px-5 py-2">{t("barfClosingColumn")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--row-border)]">
                    {data.byProfile.map((r: Row) => (
                      <tr key={r.key} className="text-right">
                        <td className="px-5 py-2.5 text-left font-semibold" style={S.primary}>
                          {r.label === "PROFILE" ? r.profile_code : r.label === "NO_PROFILE" ? t("barfNoProfileRow") : t("barfBatchLevelRow")}
                        </td>
                        {["opening", "acquisitions", "capitalised", "amortisation", "fairValue", "exits"].map((k) => (
                          <td key={k} className="px-3 py-2.5 font-mono" style={Number(r[k]) < 0 ? S.danger : S.primary}>{formatCurrency(r[k])}</td>
                        ))}
                        <td className="px-5 py-2.5 font-mono font-bold" style={S.primary}>{formatCurrency(r.closing)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.costingTieOut && (
            <div className="overflow-hidden rounded-[var(--radius-lg)] border shadow-sm" style={S.surface} aria-label={t("barfTieOutTitle")}>
              <div className="border-b px-5 py-4" style={S.raised}>
                <h3 className="text-base font-semibold" style={S.primary}>{t("barfTieOutTitle")}</h3>
                <p className="text-xs" style={S.muted}>{t("barfTieOutSubtitle")}</p>
              </div>
              {data.costingTieOut.available === false ? (
                <p className="px-5 py-4 text-xs" style={S.muted}>{data.costingTieOut.reason}</p>
              ) : data.costingTieOut.rows.length === 0 ? (
                <p className="px-5 py-4 text-xs" style={S.muted}>{t("barfTieOutNone")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-right text-xs uppercase tracking-wider" style={{ ...S.muted, borderColor: "var(--row-border)" }}>
                        <th className="px-5 py-2 text-left">{t("barfTieOutAccount")}</th>
                        <th className="px-3 py-2 text-left">{t("barfTieOutBasis")}</th>
                        <th className="px-3 py-2">{t("barfTieOutLedger")}</th>
                        <th className="px-3 py-2">{t("barfTieOutGl")}</th>
                        <th className="px-3 py-2">{t("barfTieOutDifference")}</th>
                        <th className="px-5 py-2">{t("barfTieOutStatus")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--row-border)]">
                      {data.costingTieOut.rows.map((r: Row) => (
                        <tr key={`${r.role}-${r.account_code}`} className="text-right">
                          <td className="px-5 py-2.5 text-left" style={S.primary}>
                            <span className="font-semibold">{r.account_code}</span> <span style={S.sub}>{t(`barfRole_${r.role}` as any)}</span>
                          </td>
                          <td className="px-3 py-2.5 text-left" style={S.sub}>{r.basis === "PERIOD" ? t("barfBasisPeriod") : t("barfBasisToDate")}</td>
                          <td className="px-3 py-2.5 font-mono" style={S.primary}>{formatCurrency(r.ledger)}</td>
                          <td className="px-3 py-2.5 font-mono" style={S.primary}>{formatCurrency(r.gl)}</td>
                          <td className="px-3 py-2.5 font-mono" style={r.reconciled ? S.primary : S.danger}>{formatCurrency(r.difference)}</td>
                          <td className="px-5 py-2.5">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold" style={r.reconciled ? { color: "var(--success)" } : { color: "var(--warning)" }}>
                              {r.reconciled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                              {r.reconciled ? t("barfReconciled") : t("barfTieOutVariance")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
