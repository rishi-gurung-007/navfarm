"use client";

import { DateInput } from "@/components/ui/date-input";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, Inbox, Loader2, Plus, Trash2, Truck } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldGroup, ReadField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toast } from "@/components/ui/toast";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { formatAmount } from "@/lib/utils";
import { formatDate } from "@/utils/date-short";

type Row = Record<string, any>;
type Lot = { batch_id: string; batch_no: string; stage: string | null; lot_no: string | null; head: number; carrying_value: number; value_per_head: number; withdrawals: Array<{ item_name: string; clear_date: string }> };
type Step = "dispatch" | "pod" | "kill" | "close" | "cancel";

const unwrap = <T = any,>(res: any): T => (Array.isArray(res) ? res : res?.data ?? res) as T;
const S = { surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" }, primary: { color: "var(--text-primary)" }, sub: { color: "var(--text-secondary)" }, muted: { color: "var(--text-muted)" } };
const STATUS_VARIANT: Record<string, "neutral" | "success" | "warning" | "danger"> = { DRAFT: "neutral", CONFIRMED: "warning", RECEIVED: "warning", RECONCILED: "success", CLOSED: "success", CANCELLED: "danger" };
const FILTERS: Array<{ key: string; label: TranslationKeys; statuses: string[] | null }> = [
  { key: "open", label: "stoShowOpen", statuses: ["DRAFT", "CONFIRMED", "RECEIVED", "RECONCILED"] },
  { key: "closed", label: "stoShowClosed", statuses: ["CLOSED"] },
  { key: "cancelled", label: "stoShowCancelled", statuses: ["CANCELLED"] },
  { key: "all", label: "stoShowAll", statuses: null },
];
const day = (v: unknown) => String(v ?? "").slice(0, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const NEXT: Record<string, Step | null> = { DRAFT: "dispatch", CONFIRMED: "pod", RECEIVED: "kill", RECONCILED: "close", CLOSED: null, CANCELLED: null };

/**
 * Livestock > Slaughter Transfer Orders (BBP-1 S.10.1: Transfer Order -> Slaughter -> Invoice). A farm sends weaner, grower or finisher lots to the abattoir:
 * draft (one farm, one line per lot) -> dispatch (the head leave their lots for Inventory in Transit) -> POD (dead on arrival per line) -> kill sheet (average
 * carcass weight and price per kg; invoice = delivered x carcass x price) -> close. Every rule and figure is the API's; this screen shows what it answers.
 */
export default function SlaughterTransferPanel() {
  const { t } = useLanguage();
  const user = getStoredUser();
  const canCreate = hasPermission(user, "PRODUCTION", "SLAUGHTER_TRANSFER", "can_create");
  const canEdit = hasPermission(user, "PRODUCTION", "SLAUGHTER_TRANSFER", "can_edit");

  const [rows, setRows] = useState<Row[]>([]);
  const [farms, setFarms] = useState<Row[]>([]);
  const [filter, setFilter] = useState("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // the open order and the step being taken on it
  const [viewing, setViewing] = useState<Row | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [stepDate, setStepDate] = useState(todayStr());
  const [receivedBy, setReceivedBy] = useState("");
  const [doa, setDoa] = useState<Record<string, string>>({});
  const [killRef, setKillRef] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [carcass, setCarcass] = useState<Record<string, string>>({});
  const [price, setPrice] = useState<Record<string, string>>({});

  // the new order form
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ to_date: todayStr(), farm_id: "", ho_approval_ref: "", destination: "", vehicle_no: "", driver_name: "", remarks: "" });
  const [lots, setLots] = useState<Lot[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lines, setLines] = useState<Array<{ batch_id: string; head_count: string; avg_live_weight_kg: string }>>([]);

  const farmName = useCallback((id: string, row?: Row) => {
    const f = farms.find((x) => x.location_id === id);
    const code = f?.location_code ?? row?.farm_code;
    const name = f?.location_name ?? row?.farm_name;
    return code ? `${code}${name && name !== code ? ` · ${name}` : ""}` : id;
  }, [farms]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(unwrap<Row[]>(await api.get("/slaughter-transfer-order")) || []);
    } catch (e: any) {
      setError(e?.message || t("stoLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/location?locationType=FARM&rootOnly=true&isActive=true&farmPicker=true")
      .then((res) => setFarms(unwrap<Row[]>(res) || []))
      .catch(() => setFarms([]));
  }, []);

  const shown = useMemo(() => {
    const wanted = FILTERS.find((f) => f.key === filter)?.statuses;
    return wanted ? rows.filter((r) => wanted.includes(r.status)) : rows;
  }, [rows, filter]);

  // ---- new order ---------------------------------------------------------------------------------------------------------
  const loadLots = useCallback(async (farmId: string, asOf: string) => {
    if (!farmId) { setLots([]); return; }
    setLotsLoading(true);
    try {
      setLots(unwrap<Lot[]>(await api.get(`/slaughter-transfer-order/eligible-lots?farm_id=${farmId}&as_of=${asOf}`)) || []);
    } catch (e: any) {
      setLots([]);
      setError(e?.message || t("stoLoadFailed"));
    } finally {
      setLotsLoading(false);
    }
  }, [t]);

  const openCreate = () => {
    const farm = farms.length === 1 ? farms[0].location_id : "";
    setForm({ to_date: todayStr(), farm_id: farm, ho_approval_ref: "", destination: "", vehicle_no: "", driver_name: "", remarks: "" });
    setLines([{ batch_id: "", head_count: "", avg_live_weight_kg: "" }]);
    setError("");
    setCreating(true);
    loadLots(farm, todayStr());
  };

  const lotOf = (id: string) => lots.find((l) => l.batch_id === id);
  const lineIssues = (l: { batch_id: string; head_count: string }) => {
    const lot = lotOf(l.batch_id);
    if (!lot) return "";
    if (lot.withdrawals.length) return t("stoWithdrawalBlock", { items: lot.withdrawals.map((w) => `${w.item_name} (${w.clear_date})`).join(", ") });
    const asked = lines.filter((x) => x.batch_id === l.batch_id).reduce((n, x) => n + (Number(x.head_count) || 0), 0);
    if (asked > lot.head) return t("stoTooManyHead", { head: lot.head });
    return "";
  };
  const createValid = !!form.farm_id && !!form.to_date && form.ho_approval_ref.trim().length > 0 && lines.length > 0
    && lines.every((l) => l.batch_id && Number.isInteger(Number(l.head_count)) && Number(l.head_count) >= 1 && !lineIssues(l));

  const submitCreate = async () => {
    setBusy(true);
    setError("");
    try {
      const created = unwrap<Row>(await api.post("/slaughter-transfer-order", {
        to_date: form.to_date, farm_id: form.farm_id, ho_approval_ref: form.ho_approval_ref.trim(),
        ...(form.destination.trim() ? { destination: form.destination.trim() } : {}),
        ...(form.vehicle_no.trim() ? { vehicle_no: form.vehicle_no.trim() } : {}),
        ...(form.driver_name.trim() ? { driver_name: form.driver_name.trim() } : {}),
        ...(form.remarks.trim() ? { remarks: form.remarks.trim() } : {}),
        lines: lines.map((l) => ({ batch_id: l.batch_id, head_count: Number(l.head_count), ...(l.avg_live_weight_kg ? { avg_live_weight_kg: Number(l.avg_live_weight_kg) } : {}) })),
      }));
      setCreating(false);
      setMessage(t("stoCreated", { no: created.to_no }));
      await load();
      setViewing(created);
    } catch (e: any) {
      setError(e?.message || t("stoActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  // ---- the steps on an order --------------------------------------------------------------------------------------------
  const openStep = (s: Step) => {
    if (!viewing) return;
    setStepDate(s === "pod" || s === "kill" ? todayStr() : day(viewing.to_date));
    setReceivedBy("");
    setDoa(Object.fromEntries(viewing.lines.map((l: Row) => [l.line_id, "0"])));
    setKillRef("");
    setInvoiceNo("");
    setCarcass(Object.fromEntries(viewing.lines.map((l: Row) => [l.line_id, ""])));
    setPrice(Object.fromEntries(viewing.lines.map((l: Row) => [l.line_id, ""])));
    setError("");
    setStep(s);
  };

  const invoicePreview = useMemo(() => {
    if (!viewing || step !== "kill") return 0;
    return r4(viewing.lines.reduce((n: number, l: Row) => n + num(l.received_head) * (Number(carcass[l.line_id]) || 0) * (Number(price[l.line_id]) || 0), 0));
  }, [viewing, step, carcass, price]);

  const stepValid = (() => {
    if (!viewing || !step) return false;
    if (step === "pod") return !!stepDate && viewing.lines.every((l: Row) => { const v = Number(doa[l.line_id]); return Number.isInteger(v) && v >= 0 && v <= num(l.head_count); });
    if (step === "kill") return !!stepDate && killRef.trim().length > 0 && viewing.lines.every((l: Row) => Number(carcass[l.line_id]) >= 0 && carcass[l.line_id] !== "" && Number(price[l.line_id]) >= 0 && price[l.line_id] !== "");
    return true;
  })();

  const submitStep = async () => {
    if (!viewing || !step) return;
    setBusy(true);
    setError("");
    const id = viewing.to_id;
    try {
      let res: Row;
      if (step === "dispatch") res = unwrap<Row>(await api.post(`/slaughter-transfer-order/${id}/confirm`, {}));
      else if (step === "pod") res = unwrap<Row>(await api.post(`/slaughter-transfer-order/${id}/pod`, {
        pod_date: stepDate, ...(receivedBy.trim() ? { received_by: receivedBy.trim() } : {}),
        lines: viewing.lines.map((l: Row) => ({ line_id: l.line_id, doa_head: Number(doa[l.line_id]) })),
      }));
      else if (step === "kill") res = unwrap<Row>(await api.post(`/slaughter-transfer-order/${id}/kill-sheet`, {
        kill_sheet_ref: killRef.trim(), kill_sheet_date: stepDate, ...(invoiceNo.trim() ? { invoice_no: invoiceNo.trim() } : {}),
        lines: viewing.lines.map((l: Row) => ({ line_id: l.line_id, avg_carcass_weight_kg: Number(carcass[l.line_id]), price_per_kg: Number(price[l.line_id]) })),
      }));
      else if (step === "close") res = unwrap<Row>(await api.post(`/slaughter-transfer-order/${id}/close`, {}));
      else res = unwrap<Row>(await api.post(`/slaughter-transfer-order/${id}/cancel`, {}));
      setMessage(res.doa_alert ? t("stoDoaAlert", { no: res.to_no }) : t("stoStepDone", { no: res.to_no, status: t(`stoStatus_${res.status}` as TranslationKeys) }));
      setStep(null);
      setViewing(res);
      await load();
    } catch (e: any) {
      setError(e?.message || t("stoActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const openView = async (r: Row) => {
    setError("");
    try {
      setViewing(unwrap<Row>(await api.get(`/slaughter-transfer-order/${r.to_id}`)));
    } catch (e: any) {
      setError(e?.message || t("stoLoadFailed"));
    }
  };

  const headOf = (r: Row) => (r.lines ? r.lines.reduce((n: number, l: Row) => n + num(l.head_count), 0) : null);
  const stepLabel: Record<Step, TranslationKeys> = { dispatch: "stoDispatch", pod: "stoRecordPod", kill: "stoKillSheet", close: "stoClose", cancel: "stoCancel" };
  const stepHelp: Record<Step, TranslationKeys> = { dispatch: "stoDispatchHelp", pod: "stoPodHelp", kill: "stoKillHelp", close: "stoCloseHelp", cancel: "stoCancelHelp" };

  return (
    <div className="space-y-5">
      <p className="text-sm" style={S.sub}>{t("stoIntro")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[14rem]">
          <Select aria-label={t("stoColStatus")} value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 text-[13px]">
            {FILTERS.map((f) => <option key={f.key} value={f.key}>{t(f.label)}</option>)}
          </Select>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin" style={S.muted} />}
        <div className="ml-auto">
          <Button onClick={openCreate} disabled={!canCreate} className="nf-btn-primary"><Plus className="mr-1.5 h-4 w-4" />{t("stoNew")}</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                <TableHead className="whitespace-nowrap">{t("stoColNo")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("stoColDate")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("stoColFarm")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("stoColHoRef")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("stoColStatus")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("stoColInvoice")}</TableHead>
                <TableHead />
              </tr>
            </TableHeader>
            <TableBody>
              {shown.length === 0 ? (
                <tr><TableCell colSpan={7} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("stoEmpty")}</TableCell></tr>
              ) : shown.map((r) => (
                <TableRow key={r.to_id}>
                  <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{r.to_no}</TableCell>
                  <TableCell className="whitespace-nowrap" style={S.sub}>{formatDate(day(r.to_date))}</TableCell>
                  <TableCell className="whitespace-nowrap" style={S.sub}>{farmName(r.farm_id, r)}</TableCell>
                  <TableCell className="whitespace-nowrap" style={S.sub}>{r.ho_approval_ref}</TableCell>
                  <TableCell className="whitespace-nowrap"><Badge variant={STATUS_VARIANT[r.status] || "neutral"}>{t(`stoStatus_${r.status}` as TranslationKeys)}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap text-right" style={S.primary}>{r.invoice_amount == null ? "" : formatAmount(r.invoice_amount)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button size="sm" variant="outline" onClick={() => openView(r)}><Eye className="mr-1.5 h-3.5 w-3.5" />{t("stoOpen")}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      </div>

      <Toast variant="danger" message={creating || viewing ? "" : error} onClose={() => setError("")} />
      <Toast variant="success" message={message} onClose={() => setMessage("")} />

      {/* ---- the order ---- */}
      <Dialog
        open={!!viewing && !step}
        onClose={() => !busy && setViewing(null)}
        title={viewing ? `${viewing.to_no}` : ""}
        description={viewing ? t("stoViewHelp") : ""}
        maxWidth="xl"
        footer={viewing ? (
          <div className="flex flex-wrap justify-end gap-2">
            {viewing.status === "DRAFT" && <Button variant="outline" onClick={() => openStep("cancel")} disabled={!canEdit}>{t("stoCancel")}</Button>}
            {NEXT[viewing.status] && (
              <Button onClick={() => openStep(NEXT[viewing.status]!)} disabled={!canEdit}>
                {NEXT[viewing.status] === "dispatch" ? <Truck className="mr-1.5 h-3.5 w-3.5" /> : null}{t(stepLabel[NEXT[viewing.status]!])}
              </Button>
            )}
          </div>
        ) : null}
      >
        <Toast variant="danger" message={viewing && !step ? error : ""} onClose={() => setError("")} />
        {viewing && (
          <div className="space-y-5">
            <FieldGroup title={t("stoHeader")}>
              <div className="grid grid-cols-2 gap-3 sm:col-span-12 sm:grid-cols-4">
                <ReadField label={t("stoColStatus")} value={t(`stoStatus_${viewing.status}` as TranslationKeys)} />
                <ReadField label={t("stoColDate")} value={formatDate(day(viewing.to_date))} />
                <ReadField label={t("stoColFarm")} value={farmName(viewing.farm_id, viewing)} />
                <ReadField label={t("stoColHoRef")} value={viewing.ho_approval_ref} />
                <ReadField label={t("stoDestination")} value={viewing.destination ?? ""} />
                <ReadField label={t("stoVehicle")} value={viewing.vehicle_no ?? ""} />
                <ReadField label={t("stoDriver")} value={viewing.driver_name ?? ""} />
                <ReadField label={t("stoHeadSent")} value={String(headOf(viewing) ?? "")} />
                <ReadField label={t("stoPodDate")} value={viewing.pod_date ? formatDate(day(viewing.pod_date)) : ""} />
                <ReadField label={t("stoKillRef")} value={viewing.kill_sheet_ref ?? ""} />
                <ReadField label={t("stoInvoiceNo")} value={viewing.invoice_no ?? ""} />
                <ReadField label={t("stoColInvoice")} value={viewing.invoice_amount == null ? "" : formatAmount(viewing.invoice_amount)} />
              </div>
            </FieldGroup>
            <FieldGroup title={t("stoLines")}>
              <div className="overflow-x-auto sm:col-span-12">
                <table className="w-full border-collapse text-left text-sm">
                  <TableHeader>
                    <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                      <TableHead>{t("stoColLine")}</TableHead>
                      <TableHead>{t("stoColBatch")}</TableHead>
                      <TableHead>{t("stoColSlapMark")}</TableHead>
                      <TableHead className="text-right">{t("stoColHead")}</TableHead>
                      <TableHead className="text-right">{t("stoColLiveWeight")}</TableHead>
                      <TableHead className="text-right">{t("stoColValue")}</TableHead>
                      <TableHead className="text-right">{t("stoColDoa")}</TableHead>
                      <TableHead className="text-right">{t("stoColReceived")}</TableHead>
                      <TableHead className="text-right">{t("stoColCarcass")}</TableHead>
                      <TableHead className="text-right">{t("stoColPrice")}</TableHead>
                      <TableHead className="text-right">{t("stoColAmount")}</TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {viewing.lines.map((l: Row) => (
                      <TableRow key={l.line_id}>
                        <TableCell style={S.sub}>{l.line_no}</TableCell>
                        <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>{l.batch_no}</TableCell>
                        <TableCell className="whitespace-nowrap" style={S.sub}>{l.slap_mark}</TableCell>
                        <TableCell className="text-right" style={S.primary}>{l.head_count}</TableCell>
                        <TableCell className="text-right" style={S.sub}>{l.avg_live_weight_kg == null ? "" : num(l.avg_live_weight_kg)}</TableCell>
                        <TableCell className="text-right" style={S.primary}>{l.carrying_value == null ? "" : formatAmount(l.carrying_value)}</TableCell>
                        <TableCell className="text-right" style={num(l.doa_head) > 0 ? { color: "var(--danger)" } : S.sub}>{l.doa_head ?? ""}</TableCell>
                        <TableCell className="text-right" style={S.sub}>{l.received_head ?? ""}</TableCell>
                        <TableCell className="text-right" style={S.sub}>{l.carcass_weight_kg == null ? "" : num(l.carcass_weight_kg)}</TableCell>
                        <TableCell className="text-right" style={S.sub}>{l.price_per_kg == null ? "" : num(l.price_per_kg)}</TableCell>
                        <TableCell className="text-right font-semibold" style={S.primary}>{l.line_amount == null ? "" : formatAmount(l.line_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            </FieldGroup>
          </div>
        )}
      </Dialog>

      {/* ---- a step on the order ---- */}
      <Dialog
        open={!!viewing && !!step}
        onClose={() => !busy && setStep(null)}
        title={viewing && step ? `${t(stepLabel[step])} · ${viewing.to_no}` : ""}
        description={step ? t(stepHelp[step]) : ""}
        maxWidth={step === "pod" || step === "kill" ? "xl" : "sm"}
        presentation={step === "pod" || step === "kill" ? "modal" : "compact"}
        footer={
          <Button onClick={submitStep} disabled={!stepValid || busy} variant={step === "cancel" ? "destructive" : "default"}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {step ? t(stepLabel[step]) : ""}
          </Button>
        }
      >
        <Toast variant="danger" message={step ? error : ""} onClose={() => setError("")} />
        {viewing && step === "dispatch" && (
          <p className="text-sm" style={S.sub}>{t("stoDispatchSummary", { head: headOf(viewing) ?? 0, lines: viewing.lines.length })}</p>
        )}
        {viewing && step === "pod" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("stoPodDate")} htmlFor="sto-pod-date" required><DateInput id="sto-pod-date" className="nf-input" value={stepDate} min={day(viewing.to_date)} max={todayStr()} onChange={(e) => setStepDate(e.target.value)} /></Field>
              <Field label={t("stoReceivedBy")} htmlFor="sto-pod-by"><Input id="sto-pod-by" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} maxLength={100} /></Field>
            </div>
            <table className="w-full border-collapse text-left text-sm">
              <TableHeader><tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                <TableHead>{t("stoColBatch")}</TableHead><TableHead className="text-right">{t("stoColHead")}</TableHead><TableHead className="text-right">{t("stoColDoa")}</TableHead><TableHead className="text-right">{t("stoColReceived")}</TableHead>
              </tr></TableHeader>
              <TableBody>
                {viewing.lines.map((l: Row) => {
                  const d = Number(doa[l.line_id]);
                  return (
                    <TableRow key={l.line_id}>
                      <TableCell style={S.primary}>{l.batch_no} <span className="text-xs" style={S.muted}>{l.slap_mark}</span></TableCell>
                      <TableCell className="text-right" style={S.sub}>{l.head_count}</TableCell>
                      <TableCell className="text-right"><Input aria-label={`${t("stoColDoa")} ${l.batch_no}`} type="number" min={0} max={num(l.head_count)} step="1" value={doa[l.line_id] ?? ""} onChange={(e) => setDoa({ ...doa, [l.line_id]: e.target.value })} className="ml-auto w-24 text-right" /></TableCell>
                      <TableCell className="text-right" style={S.primary}>{Number.isFinite(d) ? num(l.head_count) - d : ""}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
          </div>
        )}
        {viewing && step === "kill" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label={t("stoKillRef")} htmlFor="sto-ks-ref" required><Input id="sto-ks-ref" value={killRef} onChange={(e) => setKillRef(e.target.value)} maxLength={60} /></Field>
              <Field label={t("stoKillDate")} htmlFor="sto-ks-date" required><DateInput id="sto-ks-date" className="nf-input" value={stepDate} min={day(viewing.pod_date ?? viewing.to_date)} max={todayStr()} onChange={(e) => setStepDate(e.target.value)} /></Field>
              <Field label={t("stoInvoiceNo")} htmlFor="sto-ks-inv" hint={t("stoInvoiceNoHint")}><Input id="sto-ks-inv" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={30} /></Field>
            </div>
            <table className="w-full border-collapse text-left text-sm">
              <TableHeader><tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                <TableHead>{t("stoColBatch")}</TableHead><TableHead className="text-right">{t("stoColReceived")}</TableHead><TableHead className="text-right">{t("stoColAvgCarcass")}</TableHead><TableHead className="text-right">{t("stoColPrice")}</TableHead><TableHead className="text-right">{t("stoColAmount")}</TableHead>
              </tr></TableHeader>
              <TableBody>
                {viewing.lines.map((l: Row) => (
                  <TableRow key={l.line_id}>
                    <TableCell style={S.primary}>{l.batch_no} <span className="text-xs" style={S.muted}>{l.slap_mark}</span></TableCell>
                    <TableCell className="text-right" style={S.sub}>{l.received_head}</TableCell>
                    <TableCell className="text-right"><Input aria-label={`${t("stoColAvgCarcass")} ${l.batch_no}`} type="number" min={0} step="0.001" value={carcass[l.line_id] ?? ""} onChange={(e) => setCarcass({ ...carcass, [l.line_id]: e.target.value })} className="ml-auto w-28 text-right" /></TableCell>
                    <TableCell className="text-right"><Input aria-label={`${t("stoColPrice")} ${l.batch_no}`} type="number" min={0} step="0.01" value={price[l.line_id] ?? ""} onChange={(e) => setPrice({ ...price, [l.line_id]: e.target.value })} className="ml-auto w-28 text-right" /></TableCell>
                    <TableCell className="text-right font-semibold" style={S.primary}>{formatAmount(r4(num(l.received_head) * (Number(carcass[l.line_id]) || 0) * (Number(price[l.line_id]) || 0)))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
            <p className="text-right text-sm font-semibold" style={S.primary}>{t("stoInvoiceTotal", { amount: formatAmount(invoicePreview) })}</p>
          </div>
        )}
      </Dialog>

      {/* ---- a new order ---- */}
      <Dialog
        open={creating}
        onClose={() => !busy && setCreating(false)}
        title={t("stoNew")}
        description={t("stoNewHelp")}
        maxWidth="xl"
        footer={<Button onClick={submitCreate} disabled={!createValid || busy}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}{t("stoCreate")}</Button>}
      >
        <Toast variant="danger" message={creating ? error : ""} onClose={() => setError("")} />
        <div className="space-y-5">
          <FieldGroup title={t("stoHeader")}>
            <div className="grid grid-cols-1 gap-3 sm:col-span-12 sm:grid-cols-3">
              <Field label={t("stoColFarm")} htmlFor="sto-farm" required>
                <Select id="sto-farm" value={form.farm_id} onChange={(e) => { setForm({ ...form, farm_id: e.target.value }); setLines([{ batch_id: "", head_count: "", avg_live_weight_kg: "" }]); loadLots(e.target.value, form.to_date); }}>
                  <option value="">{t("stoChooseFarm")}</option>
                  {farms.map((f) => <option key={f.location_id} value={f.location_id}>{farmName(f.location_id)}</option>)}
                </Select>
              </Field>
              <Field label={t("stoColDate")} htmlFor="sto-date" required><DateInput id="sto-date" className="nf-input" value={form.to_date} max={todayStr()} onChange={(e) => { setForm({ ...form, to_date: e.target.value }); loadLots(form.farm_id, e.target.value); }} /></Field>
              <Field label={t("stoColHoRef")} htmlFor="sto-ho" required hint={t("stoHoRefHint")}><Input id="sto-ho" value={form.ho_approval_ref} onChange={(e) => setForm({ ...form, ho_approval_ref: e.target.value })} maxLength={60} /></Field>
              <Field label={t("stoDestination")} htmlFor="sto-dest"><Input id="sto-dest" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} maxLength={150} /></Field>
              <Field label={t("stoVehicle")} htmlFor="sto-veh"><Input id="sto-veh" value={form.vehicle_no} onChange={(e) => setForm({ ...form, vehicle_no: e.target.value })} maxLength={30} /></Field>
              <Field label={t("stoDriver")} htmlFor="sto-drv"><Input id="sto-drv" value={form.driver_name} onChange={(e) => setForm({ ...form, driver_name: e.target.value })} maxLength={100} /></Field>
            </div>
          </FieldGroup>
          <FieldGroup title={t("stoLines")} description={form.farm_id ? (lotsLoading ? t("stoLoadingLots") : lots.length ? t("stoLinesHelp") : t("stoNoLots")) : t("stoChooseFarmFirst")}>
            <div className="space-y-3 sm:col-span-12">
              {lines.map((l, i) => {
                const lot = lotOf(l.batch_id);
                const issue = lineIssues(l);
                return (
                  <div key={i} className="grid grid-cols-1 items-start gap-3 rounded-[var(--radius-sm)] border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]" style={S.surface}>
                    <Field label={t("stoColBatch")} htmlFor={`sto-lot-${i}`} required error={issue || undefined}
                      hint={lot ? t("stoLotHint", { head: lot.head, value: formatAmount(lot.carrying_value), each: formatAmount(lot.value_per_head) }) : undefined}>
                      <Select id={`sto-lot-${i}`} value={l.batch_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, batch_id: e.target.value } : x)))} disabled={!form.farm_id || lotsLoading}>
                        <option value="">{t("stoChooseLot")}</option>
                        {lots.map((x) => (
                          <option key={x.batch_id} value={x.batch_id}>{`${x.batch_no}${x.stage ? ` · ${x.stage}` : ""} · ${x.head} ${t("stoHeadUnit")}${x.withdrawals.length ? ` · ${t("stoInWithdrawal")}` : ""}`}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t("stoColHead")} htmlFor={`sto-head-${i}`} required>
                      <Input id={`sto-head-${i}`} type="number" min={1} max={lot?.head} step="1" value={l.head_count} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, head_count: e.target.value } : x)))} />
                    </Field>
                    <Field label={t("stoColLiveWeight")} htmlFor={`sto-lw-${i}`}>
                      <Input id={`sto-lw-${i}`} type="number" min={0} step="0.1" value={l.avg_live_weight_kg} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, avg_live_weight_kg: e.target.value } : x)))} />
                    </Field>
                    <div className="pt-6">
                      <Button variant="outline" size="sm" aria-label={t("stoRemoveLine")} onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                );
              })}
              <Button variant="outline" size="sm" onClick={() => setLines([...lines, { batch_id: "", head_count: "", avg_live_weight_kg: "" }])} disabled={!form.farm_id}><Plus className="mr-1.5 h-3.5 w-3.5" />{t("stoAddLine")}</Button>
              {lots.some((x) => x.withdrawals.length) && (
                <p className="flex items-center gap-1.5 text-xs" style={{ color: "var(--warning)" }}><AlertTriangle className="h-3.5 w-3.5" />{t("stoWithdrawalNote")}</p>
              )}
            </div>
          </FieldGroup>
        </div>
      </Dialog>
    </div>
  );
}
