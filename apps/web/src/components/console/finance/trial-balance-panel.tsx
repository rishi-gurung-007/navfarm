"use client";

import { useEffect, useState } from "react";
import { Loader2, Inbox } from "lucide-react";
import { Toast } from "@/components/ui/toast";
import { api } from "@/services/api-client";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from "@/components/ui/table";

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

export default function TrialBalancePanel() {
  const { t } = useLanguage();
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const companyId = getActiveCompanyId();

  const load = async () => {
    if (!companyId || !asOfDate) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ companyId, asOfDate });
      const res = await api.get(`/financial-reports/trial-balance?${params.toString()}`);
      setReport(unwrap<Row>(res));
    } catch (err: any) {
      setError(err?.message || t("tbFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOfDate]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>{t("tbTitle")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>{t("tbSubtitle")}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium" style={S.muted}>{t("tbAsOf")}</span>
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className={inputCls} style={S.input} />
        </div>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError("")} />

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                <TableHead className="whitespace-nowrap">{t("tbCode")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("tbAccount")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("tbType")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("tbDebit")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("tbCredit")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr><TableCell colSpan={5} className="py-10 text-center" style={S.sub}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("tbLoading")}</TableCell></tr>
              ) : !report || report.accounts.length === 0 ? (
                <tr><TableCell colSpan={5} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("tbNoActivity")}</TableCell></tr>
              ) : (
                report.accounts.map((a: Row) => (
                  <TableRow key={a.gl_account_id}>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{a.account_code}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{a.account_name}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{a.account_type}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{a.total_debit.toFixed(2)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{a.total_credit.toFixed(2)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {report && report.accounts.length > 0 && (
              <TableFooter>
                <tr>
                  <TableCell colSpan={3} style={S.sub}>
                    {t("tbTotal")}{" "}
                    <span style={{ color: report.isBalanced ? "var(--success)" : "var(--danger)" }}>
                      ({report.isBalanced ? t("tbBalanced") : t("tbNotBalanced")})
                    </span>
                  </TableCell>
                  <TableCell className="text-right" style={S.primary}>{report.totalDebit.toFixed(2)}</TableCell>
                  <TableCell className="text-right" style={S.primary}>{report.totalCredit.toFixed(2)}</TableCell>
                </tr>
              </TableFooter>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
