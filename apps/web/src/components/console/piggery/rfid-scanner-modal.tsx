"use client";

import { useState, useRef, useEffect } from "react";
import {
  Scan, Search, Loader2, CheckCircle2, Pill, HeartPulse,
  RefreshCw, ShieldAlert,
} from "lucide-react";

import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
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

interface RfidScannerModalProps {
  open: boolean;
  onClose: () => void;
  onAnimalUpdated?: () => void;
  medItems: Row[];
}

export default function RfidScannerModal({
  open,
  onClose,
  onAnimalUpdated,
  medItems,
}: RfidScannerModalProps) {
  const { formatMoney } = useCompanyCurrency();
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);

  const [tagInput, setTagInput]     = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [animal, setAnimal]         = useState<Row | null>(null);

  // Quick Action form states
  const [actionTab, setActionTab]   = useState<"none" | "dose" | "status">("none");
  const [savingAction, setSavingAction] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");

  // Dose form
  const [doseItemId, setDoseItemId] = useState("");
  const [doseQty, setDoseQty]       = useState("");
  const [doseUom, setDoseUom]       = useState("ML");
  const [doseNotes, setDoseNotes]   = useState("");

  // Status form
  const [newStatus, setNewStatus]   = useState("ACTIVE");

  // Auto-focus input when opened or when re-arming scan
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [open, actionTab]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const tag = tagInput.trim();
    if (!tag) return;

    setLoading(true);
    setError("");
    setActionSuccess("");
    setActionTab("none");
    try {
      const res = await api.get(`/animal/lookup/tag?tag=${encodeURIComponent(tag)}`);
      const matched = unwrap<Row>(res);
      setAnimal(matched);
      setNewStatus(matched.status || "ACTIVE");
    } catch (err: any) {
      setAnimal(null);
      setError(err?.message || t("rfmNoAnimalFoundForTag", { tag }));
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDose = async () => {
    if (!animal || !doseItemId) return;
    setSavingAction(true);
    setError("");
    try {
      await api.post(`/animal/${animal.animal_id}/medications`, {
        item_id: doseItemId,
        administered_date: new Date().toISOString().slice(0, 10),
        dose_qty: doseQty ? Number(doseQty) : undefined,
        uom: doseUom || undefined,
        notes: doseNotes || "Quick dose via RFID Scanner",
      });
      setActionSuccess(t("rfmDoseLoggedSuccess", { code: animal.animal_code }));
      setActionTab("none");
      setDoseItemId("");
      setDoseQty("");
      setDoseNotes("");
      if (onAnimalUpdated) onAnimalUpdated();
      // Re-query animal to refresh withdrawal warnings
      handleSearch();
    } catch (err: any) {
      setError(err?.message || t("rfmFailedToLogDose"));
    } finally {
      setSavingAction(false);
    }
  };

  const handleQuickStatus = async () => {
    if (!animal) return;
    setSavingAction(true);
    setError("");
    try {
      await api.put(`/animal/${animal.animal_id}`, {
        status: newStatus,
      });
      setActionSuccess(t("rfmStatusUpdatedSuccess", { status: newStatus, code: animal.animal_code }));
      setActionTab("none");
      if (onAnimalUpdated) onAnimalUpdated();
      handleSearch();
    } catch (err: any) {
      setError(err?.message || t("rfmFailedToUpdateStatus"));
    } finally {
      setSavingAction(false);
    }
  };

  const handleNextScan = () => {
    setTagInput("");
    setAnimal(null);
    setError("");
    setActionSuccess("");
    setActionTab("none");
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("rfmScannerTitle")}
      description={t("rfmScannerDescription")}
      maxWidth="lg"
      footer={
        <div className="flex w-full items-center justify-start">
          <Button variant="outline" size="sm" onClick={handleNextScan}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {t("rfmNextScanClear")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* ── Scanner Search Bar ── */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Scan className="absolute left-3 top-2.5 h-5 w-5" style={S.accent} />
            <input
              ref={inputRef}
              type="text"
              className="nf-input pl-10 text-base font-mono tracking-wider font-semibold"
              placeholder={t("rfmScanPlaceholder")}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>
          <Button type="submit" disabled={loading || !tagInput.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </form>

        {error && <InlineAlert variant="danger">{error}</InlineAlert>}
        {actionSuccess && <InlineAlert variant="success">{actionSuccess}</InlineAlert>}

        {/* ── Animal Resolved Profile ── */}
        {animal && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            {/* Top Identity Card */}
            <div className="rounded-[var(--radius-lg)] border p-4 shadow-sm" style={S.raised}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold font-mono" style={S.primary}>
                      {animal.animal_code}
                    </span>
                    <span
                      className="rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase"
                      style={animal.is_active ? S.success : S.muted}
                    >
                      {animal.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs" style={S.sub}>
                    {animal.animal_type} · {animal.gender === "F" ? t("rfmFemale") : t("rfmMale")} · {animal.breed_name || t("rfmUnknownBreed")}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{t("rfmNetBookValue")}</p>
                  <p className="text-lg font-bold font-mono" style={S.primary}>
                    {formatMoney(animal.book_value ? Number(animal.book_value) : animal.acquisition_cost ? Number(animal.acquisition_cost) : "0")}
                  </p>
                </div>
              </div>

              {/* Tag & Stage Details */}
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 pt-3 border-t">
                <div>
                  <span className="block text-[10px] uppercase font-semibold" style={S.muted}>{t("rfmRfidTag")}</span>
                  <span className="font-mono font-medium" style={S.primary}>{animal.rfid_tag || "—"}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-semibold" style={S.muted}>{t("rfmCurrentStage")}</span>
                  <span className="font-medium" style={S.primary}>{animal.stage_name || t("rfmQuarantine")}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-semibold" style={S.muted}>{t("rfmParityCount")}</span>
                  <span className="font-medium" style={S.primary}>{t("rfmLitters", { count: String(animal.parity_count || 0) })}</span>
                </div>
              </div>
            </div>

            {/* Withdrawal Safety Alert Banner */}
            {animal.hasActiveWithdrawal && (
              <div className="rounded-[var(--radius-md)] border p-3.5" style={S.danger}>
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 shrink-0" />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider">{t("rfmActiveWithdrawalWarning")}</p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {animal.activeWithdrawals.map((w: Row, i: number) => (
                        <li key={i}>
                          • <span className="font-semibold">{w.item_name}</span>: {t("rfmDaysRemainingLastGiven", { days: String(w.daysRemaining), lastDose: w.lastDose })}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* 1-Click Quick Actions Toolbar */}
            <div className="rounded-[var(--radius-lg)] border p-4" style={S.surface}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={S.muted}>
                {t("rfmQuickActions")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={actionTab === "dose" ? "default" : "outline"}
                  onClick={() => setActionTab(actionTab === "dose" ? "none" : "dose")}
                >
                  <Pill className="mr-1.5 h-3.5 w-3.5" /> {t("rfmLogDose")}
                </Button>
                <Button
                  size="sm"
                  variant={actionTab === "status" ? "default" : "outline"}
                  onClick={() => setActionTab(actionTab === "status" ? "none" : "status")}
                >
                  <HeartPulse className="mr-1.5 h-3.5 w-3.5" /> {t("rfmChangeHealthStatus")}
                </Button>
              </div>

              {/* ── Quick Dose Form ── */}
              {actionTab === "dose" && (
                <div className="mt-4 rounded-[var(--radius-md)] border p-4 space-y-3" style={S.raised}>
                  <h4 className="text-xs font-semibold" style={S.primary}>{t("rfmRecordDoseTitle")}</h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="nf-label text-xs">{t("rfmMedicineVaccine")}</label>
                      <select
                        className="nf-input text-xs"
                        value={doseItemId}
                        onChange={(e) => setDoseItemId(e.target.value)}
                      >
                        <option value="">{t("rfmSelectMedicine")}</option>
                        {medItems.map((m) => (
                          <option key={m.item_id} value={m.item_id}>
                            {m.item_name} ({m.item_type}) {m.withdrawal_days ? t("rfmWithdrawalDaysSuffix", { days: String(m.withdrawal_days) }) : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="nf-label text-xs">{t("rfmDoseQty")}</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="0.01"
                          className="nf-input text-xs"
                          placeholder={t("rfmDoseQtyPlaceholder")}
                          value={doseQty}
                          onChange={(e) => setDoseQty(e.target.value)}
                        />
                        <select
                          className="nf-input text-xs w-20"
                          value={doseUom}
                          onChange={(e) => setDoseUom(e.target.value)}
                        >
                          <option value="ML">ML</option>
                          <option value="DOSE">DOSE</option>
                          <option value="MG">MG</option>
                          <option value="GM">GM</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" size="sm" onClick={() => setActionTab("none")}>{t("rfmCancel")}</Button>
                    <Button size="sm" onClick={handleQuickDose} disabled={savingAction || !doseItemId}>
                      {savingAction ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                      {t("rfmSaveDose")}
                    </Button>
                  </div>
                </div>
              )}

              {/* ── Quick Health Status Form ── */}
              {actionTab === "status" && (
                <div className="mt-4 rounded-[var(--radius-md)] border p-4 space-y-3" style={S.raised}>
                  <h4 className="text-xs font-semibold" style={S.primary}>{t("rfmUpdateHealthStatusTitle")}</h4>
                  <div className="flex flex-wrap gap-2">
                    {["ACTIVE", "SICK", "QUARANTINE", "PREGNANT", "LACTATING", "DRY"].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setNewStatus(st)}
                        className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold transition-all"
                        style={newStatus === st ? S.accent : S.surface}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" size="sm" onClick={() => setActionTab("none")}>{t("rfmCancel")}</Button>
                    <Button size="sm" onClick={handleQuickStatus} disabled={savingAction}>
                      {savingAction ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                      {t("rfmSaveStatus")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
