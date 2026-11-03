"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Inbox, Loader2 } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActiveCompanyId, getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { formatAmount } from "@/lib/utils";

type Row = Record<string, any>;
type Action = { kind: "approve" | "reject" | "post"; row: Row } | null;

const unwrap = <T = any,>(res: any): T => (Array.isArray(res) ? res : res?.data ?? res) as T;
const S = { surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" }, primary: { color: "var(--text-primary)" }, sub: { color: "var(--text-secondary)" }, muted: { color: "var(--text-muted)" } };
const STATUS_VARIANT: Record<string, "neutral" | "success" | "warning" | "danger"> = { REQUESTED: "warning", APPROVED: "warning", POSTED: "success", REJECTED: "danger", CANCELLED: "neutral" };
const FILTERS: Array<{ key: string; label: TranslationKeys; statuses: string[] | null }> = [
  { key: "open", label: "facShowOpen", statuses: ["REQUESTED", "APPROVED"] },
  { key: "posted", label: "facShowPosted", statuses: ["POSTED"] },
  { key: "closed", label: "facShowClosed", statuses: ["REJECTED", "CANCELLED"] },
  { key: "all", label: "facShowAll", statuses: null },
];
const day = (v: unknown) => String(v ?? "").slice(0, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Finance > FA to Inventory Conversions (TDD row 11). A culled breeding animal becomes inventory in three steps: the farm requests (on the animal), Finance approves
 * with a market value and then posts. Not by the person who raised it. The rules and every figure are the API's; this screen shows what it answers.
 */
export default function FaConversionsPanel() {
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();
  const user = getStoredUser();
  const canAct = hasPermission(user, "FINANCE", "JOURNAL", "can_create");

  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState("open");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action>(null);
  const [marketValue, setMarketValue] = useState("");
  const [reason, setReason] = useState("");
  const [convDate, setConvDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      setRows(unwrap<Row[]>(await api.get("/fa-conversions")) || []);
    } catch (e: any) {
      setError(e?.message || t("facLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [companyId, t]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const wanted = FILTERS.find((f) => f.key === filter)?.statuses;
    return wanted ? rows.filter((r) => wanted.includes(r.status)) : rows;
  }, [rows, filter]);

  const openAction = (kind: "approve" | "reject" | "post", row: Row) => {
    setMarketValue(row.market_value != null ? String(Number(row.market_value)) : "");
    setReason("");
    setConvDate(todayStr() < day(row.out_of_production_date) ? day(row.out_of_production_date) : todayStr());
    setError("");
    setAction({ kind, row });
  };

  const submit = async () => {
    if (!action) return;
    const { kind, row } = action;
    setBusy(true);
    setError("");
    try {
      if (kind === "approve") await api.patch(`/fa-conversions/${row.conversion_id}/approve`, { market_value: Number(marketValue) });
      else if (kind === "reject") await api.patch(`/fa-conversions/${row.conversion_id}/reject`, { reason: reason.trim() });
      else await api.post(`/fa-conversions/${row.conversion_id}/post`, { conversion_date: convDate });
      setMessage(t(kind === "approve" ? "facApproved" : kind === "reject" ? "facRejected" : "facPosted", { no: row.conversion_no }));
      setAction(null);
      await load();
    } catch (e: any) {
      setError(e?.message || t("facActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const valid = action?.kind === "approve" ? marketValue !== "" && Number(marketValue) >= 0 : action?.kind === "reject" ? reason.trim().length > 0 : !!convDate;
  const gainLoss = (r: Row) => (r.gain_loss == null ? "" : formatAmount(r.gain_loss));

  return (
    <div className="space-y-5">
      <p className="text-sm" style={S.sub}>{t("facIntro")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[14rem]">
          <Select aria-label={t("facColStatus")} value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 text-[13px]">
            {FILTERS.map((f) => <option key={f.key} value={f.key}>{t(f.label)}</option>)}
          </Select>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin" style={S.muted} />}
      </div>

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                <TableHead className="whitespace-nowrap">{t("facColRequest")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("facColAnimal")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("facColOutOfProduction")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("facColStatus")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("facColMarketValue")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("facColBookValue")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("facColGainLoss")}</TableHead>
                <TableHead />
              </tr>
            </TableHeader>
            <TableBody>
              {shown.length === 0 ? (
                <tr><TableCell colSpan={8} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("facEmpty")}</TableCell></tr>
              ) : shown.map((r) => {
                const own = !!user?.userId && r.requested_by === user.userId;
                return (
                  <TableRow key={r.conversion_id}>
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{r.conversion_no}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{r.animal_code}{r.rfid_tag ? <span className="ml-1 text-xs" style={S.muted}>({r.rfid_tag})</span> : null}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{day(r.out_of_production_date)}</TableCell>
                    <TableCell className="whitespace-nowrap"><Badge variant={STATUS_VARIANT[r.status] || "neutral"}>{t(`facStatus_${r.status}` as TranslationKeys)}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{r.market_value == null ? "" : formatAmount(r.market_value)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.sub}>{r.nbv_at_conversion == null ? "" : formatAmount(r.nbv_at_conversion)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold" style={Number(r.gain_loss) < 0 ? { color: "var(--danger)" } : S.primary}>{gainLoss(r)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-2">
                        {r.status === "REQUESTED" && (
                          <span title={own ? t("facOwnRequest") : undefined}>
                            <Button size="sm" onClick={() => openAction("approve", r)} disabled={!canAct || own}>{t("facApprove")}</Button>
                          </span>
                        )}
                        {r.status === "APPROVED" && (
                          <Button size="sm" onClick={() => openAction("post", r)} disabled={!canAct}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />{t("facPost")}</Button>
                        )}
                        {(r.status === "REQUESTED" || r.status === "APPROVED") && (
                          <Button size="sm" variant="outline" onClick={() => openAction("reject", r)} disabled={!canAct}>{t("facReject")}</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </table>
        </div>
      </div>

      <Toast variant="danger" message={action ? "" : error} onClose={() => setError("")} />
      <Toast variant="success" message={message} onClose={() => setMessage("")} />

      <Dialog
        open={!!action}
        onClose={() => !busy && setAction(null)}
        title={action ? t(action.kind === "approve" ? "facApproveTitle" : action.kind === "reject" ? "facRejectTitle" : "facPostTitle", { no: action.row.conversion_no }) : ""}
        description={action
          ? action.kind === "approve" ? t("facApproveHelp", { animal: action.row.animal_code })
          : action.kind === "reject" ? t("facRejectHelp")
          : t("facPostHelp", { animal: action.row.animal_code, value: formatAmount(action.row.market_value ?? 0) })
          : ""}
        maxWidth="sm"
        footer={
          <Button onClick={submit} disabled={!valid || busy} variant={action?.kind === "reject" ? "destructive" : "default"}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {action ? t(action.kind === "approve" ? "facApprove" : action.kind === "reject" ? "facReject" : "facPost") : ""}
          </Button>
        }
      >
        <Toast variant="danger" message={action ? error : ""} onClose={() => setError("")} />
        {action?.kind === "approve" && (
          <>
            <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="fac-value">{t("facMarketValue")}</label>
            <Input id="fac-value" type="number" min={0} step="0.01" value={marketValue} onChange={(e) => setMarketValue(e.target.value)} autoFocus />
          </>
        )}
        {action?.kind === "reject" && (
          <>
            <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="fac-reason">{t("facReason")}</label>
            <Input id="fac-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} autoFocus />
          </>
        )}
        {action?.kind === "post" && (
          <>
            <label className="nf-text-label mb-1 block" style={S.muted} htmlFor="fac-date">{t("facConversionDate")}</label>
            <input id="fac-date" type="date" className="nf-input text-xs" value={convDate} min={day(action.row.out_of_production_date)} max={todayStr()} onChange={(e) => setConvDate(e.target.value)} />
          </>
        )}
      </Dialog>
    </div>
  );
}
