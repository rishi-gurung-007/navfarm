"use client";

import { useEffect, useState } from "react";
import { Loader2, Inbox } from "lucide-react";
import { Toast } from "@/components/ui/toast";
import { api } from "@/services/api-client";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

const inputCls = "nf-input-sm";

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}


/**
 * A variance is unfavourable when actual cost came in above standard. Positive
 * amounts are unfavourable throughout the costing engine, so the sign carries
 * the meaning and the colour follows it — never the other way round.
 */
function varianceStyle(amount: number) {
  if (Math.abs(amount) < 0.005) return S.sub;
  return { color: amount > 0 ? "var(--danger)" : "var(--success)" };
}

export default function BatchCostVariancePanel() {
  const { formatMoney } = useCompanyCurrency();
  const money = (v: unknown) => formatMoney(Number(v || 0));
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [batchFilter, setBatchFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const companyId = getActiveCompanyId();

  const load = async () => {
    if (!companyId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/financial-reports/batch-cost-variance?companyId=${companyId}`);
      setRows(unwrap<Row[]>(res) ?? []);
    } catch (err: any) {
      setError(err?.message || t("bcvFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  // Reload when the active company changes; `load` is stable for that company.
  useEffect(() => {
    load();
  }, [companyId]);

  const term = batchFilter.trim().toLowerCase();
  const visible = term ? rows.filter((r) => String(r.batch_no || "").toLowerCase().includes(term)) : rows;

  const totals = visible.reduce(
    (acc, r) => ({
      standard: acc.standard + Number(r.standard_cost || 0),
      actual: acc.actual + Number(r.actual_cost || 0),
      variance: acc.variance + Number(r.total_variance || 0),
    }),
    { standard: 0, actual: 0, variance: 0 },
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>{t("bcvTitle")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>{t("bcvSubtitle")}</p>
        </div>
        <input
          type="search"
          value={batchFilter}
          onChange={(e) => setBatchFilter(e.target.value)}
          placeholder={t("bcvSearchPlaceholder")}
          className={inputCls}
          style={S.input}
          aria-label={t("bcvSearchPlaceholder")}
        />
      </div>

      <Toast variant="danger" message={error} onClose={() => setError("")} />

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                <TableHead className="whitespace-nowrap">{t("bcvBatch")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("bcvMethod")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("bcvStandardCost")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("bcvActualCost")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("bcvPrice")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("bcvUsage")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("bcvOutput")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("bcvOverhead")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("bcvTotalVariance")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr>
                  <TableCell colSpan={9} className="py-10 text-center" style={S.sub}>
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("bcvLoading")}
                  </TableCell>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <TableCell colSpan={9} className="py-10 text-center" style={S.sub}>
                    <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} />
                    {/* Variances are written by batch close, so "no rows" means
                        no standard-costed batch has closed yet — not a failure. */}
                    {rows.length === 0 ? t("bcvNoClosedBatches") : t("bcvNoMatch")}
                  </TableCell>
                </tr>
              ) : (
                visible.map((r) => (
                  <TableRow key={r.batch_id}>
                    <TableCell className="whitespace-nowrap font-medium" style={S.primary}>{r.batch_no}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{r.costing_method}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{money(r.standard_cost)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{money(r.actual_cost)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={varianceStyle(Number(r.price_variance))}>{money(r.price_variance)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={varianceStyle(Number(r.usage_variance))}>{money(r.usage_variance)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={varianceStyle(Number(r.output_variance))}>{money(r.output_variance)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={varianceStyle(Number(r.overhead_variance))}>{money(r.overhead_variance)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold" style={varianceStyle(Number(r.total_variance))}>
                      {money(r.total_variance)}
                      <span className="ml-1.5 text-[11px] font-normal">
                        {r.is_favorable ? t("bcvFavorable", { pct: Math.abs(Number(r.variance_pct || 0)).toFixed(2) })
                                        : t("bcvUnfavorable", { pct: Math.abs(Number(r.variance_pct || 0)).toFixed(2) })}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {visible.length > 0 && (
              <TableFooter>
                <tr>
                  <TableCell colSpan={2} style={S.sub}>{t("bcvTotal", { count: visible.length })}</TableCell>
                  <TableCell className="text-right" style={S.primary}>{money(totals.standard)}</TableCell>
                  <TableCell className="text-right" style={S.primary}>{money(totals.actual)}</TableCell>
                  <TableCell colSpan={4} />
                  <TableCell className="text-right font-semibold" style={varianceStyle(totals.variance)}>{money(totals.variance)}</TableCell>
                </tr>
              </TableFooter>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
