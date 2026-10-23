"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, CheckCircle2, Inbox, Loader2, Undo2 } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { StatCard, StatRow } from "@/components/ui/stat-row";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActiveCompanyId, getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { formatAmount } from "@/lib/utils";

type Row = Record<string, any>;

const unwrap = <T = any,>(res: any): T => (Array.isArray(res) ? res : res?.data ?? res) as T;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
};

const STATUS_VARIANT: Record<string, "neutral" | "success" | "warning" | "danger"> = { CALCULATED: "warning", POSTED: "success", REVERSED: "neutral", FAILED: "danger" };

/** The last day of last month: the latest period a monthly profile can run (a period must have ended). */
function lastDayOfPreviousMonth(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth(), 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? "" : formatAmount(v as number | string));

/**
 * Finance > Bio-Asset Costing Runs. Calculate a profile's period (a preview that posts nothing), read every animal's line and
 * why any was skipped, then Post it, or Reverse a posted run. The arithmetic and every control are the API's; this screen only
 * shows what it answers.
 */
export default function BioCostingRunsPanel() {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();
  const canRun = hasPermission(getStoredUser(), "FINANCE", "JOURNAL", "can_create");

  const [profiles, setProfiles] = useState<Row[]>([]);
  const [runs, setRuns] = useState<Row[]>([]);
  const [due, setDue] = useState<Row[]>([]);
  const [run, setRun] = useState<Row | null>(null);
  const [batches, setBatches] = useState<Row[]>([]);
  const [batchId, setBatchId] = useState(""); // "" = every batch (the whole herd)
  const [runSet, setRunSet] = useState<string[]>([]); // the runs the last Calculate made, so they can be posted together
  const [periodDate, setPeriodDate] = useState(lastDayOfPreviousMonth());
  const [daysEnforced, setDaysEnforced] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<"" | "calculate" | "post" | "reverse" | "open">("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");

  const profileCode = (id?: string | null) => profiles.find((p) => p.profile_id === id)?.profile_code ?? "";
  const batchLabel = (id?: string | null) => (id ? batches.find((b) => b.batch_id === id)?.batch_no ?? "" : t("bcrWholeHerd"));
  const pendingInSet = useMemo(() => runSet.filter((id) => runs.find((r) => r.run_id === id)?.status === "CALCULATED"), [runSet, runs]);

  const loadRuns = useCallback(async () => {
    if (!companyId) return;
    try {
      setRuns(unwrap<Row[]>(await api.get(`/bio-costing/runs?companyId=${companyId}`)) || []);
    } catch (e: any) {
      setError(e?.message || t("bcrLoadFailed"));
    }
  }, [companyId, t]);

  const loadDue = useCallback(async () => {
    if (!companyId) return;
    try {
      setDue(unwrap<Row[]>(await api.get("/bio-costing/runs/due")) || []);
    } catch {
      setDue([]); // the notice is a convenience; the screen works without it
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    loadDue();
    api.get(`/bio-costing/profiles?companyId=${companyId}`)
      .then((r) => setProfiles(unwrap<Row[]>(r) || []))
      .catch((e: any) => setError(e?.message || t("bcrLoadFailed")));
    api.get(`/batch?companyId=${companyId}&status=ACTIVE&limit=100`)
      .then((r) => setBatches(unwrap<Row[]>(r) || []))
      .catch(() => setBatches([])); // the batch picker is a filter; the screen still runs the whole herd without it
    loadRuns();
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (id: string) => {
    setBusy("open");
    setError("");
    try {
      setRun(unwrap<Row>(await api.get(`/bio-costing/runs/${id}`)));
    } catch (e: any) {
      setError(e?.message || t("bcrLoadFailed"));
    } finally {
      setBusy("");
    }
  };

  const calculate = async () => {
    setBusy("calculate");
    setError("");
    setMessage("");
    try {
      const body: Row = { period_date: periodDate };
      if (batchId) body.batch_id = batchId;
      if (daysEnforced) body.days_enforced = Number(daysEnforced);
      if (description.trim()) body.description = description.trim();
      const made = unwrap<{ runs: Row[]; failed: Array<{ profile_code: string; error: string }> }>(await api.post("/bio-costing/runs/calculate-batch", body));
      setRun(made.runs[0] ?? null);
      setRunSet(made.runs.map((r) => r.run_id));
      if (made.failed?.length) setError(made.failed.map((f) => `${f.profile_code}: ${f.error}`).join("; "));
      else if (made.runs.length > 1) setMessage(t("bcrBatchRunsMade", { count: made.runs.length }));
      await Promise.all([loadRuns(), loadDue()]);
    } catch (e: any) {
      setError(e?.message || t("bcrCalculateFailed"));
    } finally {
      setBusy("");
    }
  };

  const post = async () => {
    if (!run) return;
    const ok = await confirmAction({
      title: t("bcrPostConfirmTitle"),
      message: t("bcrPostConfirmMessage", { runNo: run.run_no, period: run.period_key }),
      confirmLabel: t("bcrPost"),
      cancelLabel: t("bcrCancel"),
    });
    if (!ok) return;
    setBusy("post");
    setError("");
    try {
      setRun(unwrap<Row>(await api.post(`/bio-costing/runs/${run.run_id}/post`, {})));
      setMessage(t("bcrPosted", { runNo: run.run_no }));
      await Promise.all([loadRuns(), loadDue()]);
    } catch (e: any) {
      setError(e?.message || t("bcrPostFailed"));
    } finally {
      setBusy("");
    }
  };

  const postAll = async () => {
    const ok = await confirmAction({
      title: t("bcrPostAllConfirmTitle"),
      message: t("bcrPostAllConfirmMessage", { count: pendingInSet.length }),
      confirmLabel: t("bcrPost"),
      cancelLabel: t("bcrCancel"),
    });
    if (!ok) return;
    setBusy("post");
    setError("");
    const problems: string[] = [];
    for (const id of pendingInSet) {
      try {
        await api.post(`/bio-costing/runs/${id}/post`, {});
      } catch (e: any) {
        problems.push(e?.message || t("bcrPostFailed"));
      }
    }
    if (problems.length) setError(problems.join("; "));
    else setMessage(t("bcrPostedAll", { count: pendingInSet.length }));
    await Promise.all([loadRuns(), loadDue()]);
    if (run) await open(run.run_id);
    setBusy("");
  };

  const reverse = async () => {
    if (!run || !reason.trim()) return;
    setBusy("reverse");
    setError("");
    try {
      setRun(unwrap<Row>(await api.post(`/bio-costing/runs/${run.run_id}/reverse`, { reason: reason.trim() })));
      setMessage(t("bcrReversed", { runNo: run.run_no }));
      setReversing(false);
      setReason("");
      await Promise.all([loadRuns(), loadDue()]);
    } catch (e: any) {
      setError(e?.message || t("bcrReverseFailed"));
    } finally {
      setBusy("");
    }
  };

  const runDueNow = async () => {
    setBusy("calculate");
    setError("");
    try {
      const results = unwrap<Row[]>(await api.post("/bio-costing/runs/run-due", {})) || [];
      const done = results.filter((r) => r.outcome === "CALCULATED" || r.outcome === "POSTED").length;
      const failed = results.filter((r) => r.outcome === "FAILED");
      if (failed.length) setError(failed.map((f) => `${f.profile_code} ${f.period_key}: ${f.error}`).join("; "));
      else setMessage(t("bcrRunDueDone", { count: done }));
      await Promise.all([loadRuns(), loadDue()]);
    } catch (e: any) {
      setError(e?.message || t("bcrCalculateFailed"));
    } finally {
      setBusy("");
    }
  };

  const openByRunNo = (runNo?: string | null) => {
    const found = runs.find((r) => r.run_no === runNo);
    if (found) open(found.run_id);
  };

  const isAmortisation = run?.method === "AMORTIZATION";
  const lines: Row[] = run?.lines ?? [];
  const skipLabel = (reason?: string | null) => (reason ? t(`bcrSkip_${reason}` as TranslationKeys) : "");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-lg)] border p-4" style={S.surface}>
        <div className="min-w-[14rem]">
          <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcr-batch">{t("bcrBatch")}</label>
          <Select id="bcr-batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} className="h-9 text-[13px]">
            <option value="">{t("bcrAllBatches")}</option>
            {batches.map((b) => (
              <option key={b.batch_id} value={b.batch_id}>
                {b.batch_no}{b.remarks ? ` · ${b.remarks}` : ""} · {b.tracking_mode}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcr-date">{t("bcrPeriodDate")}</label>
          <input id="bcr-date" type="date" className="nf-input text-xs" value={periodDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPeriodDate(e.target.value)} />
        </div>
        <div>
          <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcr-days">{t("bcrDaysEnforced")}</label>
          <Input id="bcr-days" type="number" min={1} value={daysEnforced} onChange={(e) => setDaysEnforced(e.target.value)} className="h-9 w-28 text-[13px]" placeholder={t("bcrDaysEnforcedHint")} />
        </div>
        <div className="min-w-[12rem] flex-1">
          <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcr-desc">{t("bcrDescription")}</label>
          <Input id="bcr-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="h-9 text-[13px]" maxLength={300} />
        </div>
        <Button size="sm" onClick={calculate} disabled={!periodDate || busy !== "" || !canRun}>
          {busy === "calculate" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Calculator className="mr-1.5 h-3.5 w-3.5" />}
          {t("bcrCalculate")}
        </Button>
      </div>
      <p className="-mt-3 text-xs" style={S.muted}>{t("bcrBatchHint")}</p>

      {due.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border p-4" style={{ ...S.surface, borderColor: "var(--warning)" }} role="status" aria-label={t("bcrDueHeading")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold" style={S.primary}>{t("bcrDueHeading")}</h3>
            <Button size="sm" variant="outline" onClick={runDueNow} disabled={busy !== "" || !canRun || !due.some((d) => d.due_periods?.length || d.blocked?.reason === "TOO_MANY_FAILURES")}>
              {t("bcrRunDue")}
            </Button>
          </div>
          <ul className="mt-2 space-y-1 text-sm" style={S.sub}>
            {due.map((d) => (
              <li key={d.profile_id}>
                {d.blocked?.reason === "WAITING_TO_POST" && (
                  <button type="button" className="text-left underline" onClick={() => openByRunNo(d.blocked.run_no)}>
                    {t("bcrWaiting", { profile: d.profile_code, runNo: d.blocked.run_no || "", period: d.blocked.period_key })}
                  </button>
                )}
                {d.blocked?.reason === "TOO_MANY_FAILURES" && (
                  <span style={{ color: "var(--danger)" }}>{t("bcrFailedRepeatedly", { profile: d.profile_code, period: d.blocked.period_key, count: d.blocked.attempts, error: d.blocked.error || "" })}</span>
                )}
                {!d.blocked && (
                  <span>{t("bcrDuePeriods", { profile: d.profile_code, periods: (d.due_periods || []).join(", ") })}{d.auto_post ? ` ${t("bcrDueAuto")}` : ""}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Toast variant="danger" message={error} onClose={() => setError("")} />
      <Toast variant="success" message={message} onClose={() => setMessage("")} />

      {run && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-semibold" style={S.primary}>{run.run_no}</h3>
              <Badge variant={STATUS_VARIANT[run.status] || "neutral"}>{t(`bcrStatus_${run.status}` as TranslationKeys)}</Badge>
              <span className="text-xs" style={S.sub}>{t("bcrPeriodLine", { period: run.period_key, start: run.period_start, end: run.period_end })}</span>
              <span className="text-xs" style={S.sub}>{profileCode(run.profile_id)} · {batchLabel(run.batch_id)}</span>
            </div>
            <div className="flex items-center gap-2">
              {pendingInSet.length > 1 && (
                <Button size="sm" variant="outline" onClick={postAll} disabled={busy !== "" || !canRun}>
                  {t("bcrPostAll", { count: pendingInSet.length })}
                </Button>
              )}
              {run.status === "CALCULATED" && (
                <Button size="sm" onClick={post} disabled={busy !== "" || !canRun}>
                  {busy === "post" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                  {t("bcrPost")}
                </Button>
              )}
              {run.status === "POSTED" && (
                <Button size="sm" variant="outline" onClick={() => setReversing(true)} disabled={busy !== "" || !canRun}>
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" /> {t("bcrReverse")}
                </Button>
              )}
            </div>
          </div>

          <StatRow>
            <StatCard label={t("bcrAnimals")} value={String(run.animal_count)} />
            <StatCard label={t("bcrCharged")} value={String(run.charged_count)} />
            <StatCard label={t("bcrSkipped")} value={String(run.skipped_count)} tone={run.skipped_count > 0 ? "warning" : "default"} />
            <StatCard label={isAmortisation ? t("bcrTotalAmortisation") : t("bcrNetAdjustment")} value={formatAmount(run.total_charge)} tone={Number(run.total_charge) < 0 ? "danger" : "default"} />
          </StatRow>
          {run.status === "CALCULATED" && <p className="text-xs" style={S.muted}>{t("bcrPreviewNote")}</p>}
          {run.status === "FAILED" && <p className="text-xs" style={{ color: "var(--danger)" }}>{t("bcrFailedNote", { error: run.error_message || "" })}</p>}
          {run.status === "REVERSED" && <p className="text-xs" style={S.muted}>{t("bcrReversedNote", { reason: run.reverse_reason || "" })}</p>}

          <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <TableHeader>
                  <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                    <TableHead className="whitespace-nowrap">{t("bcrAnimal")}</TableHead>
                    <TableHead className="whitespace-nowrap">{t("bcrLineStatus")}</TableHead>
                    {isAmortisation && <TableHead className="whitespace-nowrap text-right">{t("bcrDays")}</TableHead>}
                    {isAmortisation && <TableHead className="whitespace-nowrap text-right">{t("bcrRemainingDays")}</TableHead>}
                    <TableHead className="whitespace-nowrap text-right">{t("bcrBookValueBefore")}</TableHead>
                    {isAmortisation && <TableHead className="whitespace-nowrap text-right">{t("bcrResidual")}</TableHead>}
                    <TableHead className="whitespace-nowrap text-right">{isAmortisation ? t("bcrCharge") : t("bcrAdjustment")}</TableHead>
                    <TableHead className="whitespace-nowrap text-right">{t("bcrBookValueAfter")}</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {lines.length === 0 ? (
                    <tr><TableCell colSpan={8} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("bcrNoLines")}</TableCell></tr>
                  ) : lines.map((l) => (
                    <TableRow key={l.line_id}>
                      <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{l.animal_code}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {l.status === "CHARGED"
                          ? <Badge variant="success">{t("bcrLineCharged")}</Badge>
                          : <span title={skipLabel(l.skip_reason)}><Badge variant="warning">{skipLabel(l.skip_reason)}</Badge></span>}
                      </TableCell>
                      {isAmortisation && <TableCell className="whitespace-nowrap text-right" style={S.sub}>{l.days == null ? "" : Number(l.days).toFixed(2)}</TableCell>}
                      {isAmortisation && <TableCell className="whitespace-nowrap text-right" style={S.sub}>{l.remaining_days ?? ""}</TableCell>}
                      <TableCell className="whitespace-nowrap text-right" style={S.primary}>{num(l.book_value_before)}</TableCell>
                      {isAmortisation && <TableCell className="whitespace-nowrap text-right" style={S.sub}>{num(l.residual)}</TableCell>}
                      <TableCell className="whitespace-nowrap text-right font-semibold" style={Number(l.charge) < 0 ? { color: "var(--danger)" } : S.primary}>{l.status === "CHARGED" ? num(l.charge) : ""}</TableCell>
                      <TableCell className="whitespace-nowrap text-right" style={S.primary}>{num(l.book_value_after)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold" style={S.primary}>{t("bcrRunsHeading")}</h3>
        <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <TableHeader>
                <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                  <TableHead className="whitespace-nowrap">{t("bcrRunNo")}</TableHead>
                  <TableHead className="whitespace-nowrap">{t("bcrPeriod")}</TableHead>
                  <TableHead className="whitespace-nowrap">{t("bcrProfileCol")}</TableHead>
                  <TableHead className="whitespace-nowrap">{t("bcrBatch")}</TableHead>
                  <TableHead className="whitespace-nowrap">{t("bcrMethod")}</TableHead>
                  <TableHead className="whitespace-nowrap text-right">{t("bcrCharged")}</TableHead>
                  <TableHead className="whitespace-nowrap text-right">{t("bcrSkipped")}</TableHead>
                  <TableHead className="whitespace-nowrap text-right">{t("bcrTotal")}</TableHead>
                  <TableHead className="text-right">{t("bcrLineStatus")}</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {runs.length === 0 ? (
                  <tr><TableCell colSpan={9} className="py-8 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("bcrNoRuns")}</TableCell></tr>
                ) : runs.map((r) => (
                  <TableRow key={r.run_id} onClick={() => open(r.run_id)} className="cursor-pointer">
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{r.run_no}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{r.period_key}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{profileCode(r.profile_id)}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{batchLabel(r.batch_id)}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{r.method === "AMORTIZATION" ? t("bcrAmortisation") : t("bcrFairValue")}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{r.charged_count}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.sub}>{r.skipped_count}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{formatAmount(r.total_charge)}</TableCell>
                    <TableCell className="text-right"><Badge variant={STATUS_VARIANT[r.status] || "neutral"}>{t(`bcrStatus_${r.status}` as TranslationKeys)}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </div>
      </div>

      <Dialog
        open={reversing}
        onClose={() => busy !== "reverse" && setReversing(false)}
        title={t("bcrReverseTitle", { runNo: run?.run_no || "" })}
        description={t("bcrReverseDescription")}
        maxWidth="sm"
        footer={
          <Button onClick={reverse} disabled={!reason.trim() || busy === "reverse"}>
            {busy === "reverse" ? t("bcrReversing") : t("bcrReverse")}
          </Button>
        }
      >
        <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="bcr-reason">{t("bcrReason")}</label>
        <Input id="bcr-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus />
      </Dialog>
    </div>
  );
}
