"use client";

import { useState, useRef, useEffect } from "react";
import {
  Scan, Search, Loader2, CheckCircle2, Pill, HeartPulse,
  RefreshCw, ShieldAlert, Layers, Dna, Calendar, FileText, ChevronRight,
} from "lucide-react";

import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useLanguage } from "@/hooks/useLanguage";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import { formatQuantity } from "@/lib/utils";
import AnimalDetailsModal from "@/components/console/piggery/animal-details-modal";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

function formatDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
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
  onOpenAnimalDetails?: (animalId: string) => void;
}

export default function RfidScannerModal({
  open,
  onClose,
  onAnimalUpdated,
  medItems,
  onOpenAnimalDetails,
}: RfidScannerModalProps) {
  const { formatMoney } = useCompanyCurrency();
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);

  const [tagInput, setTagInput]     = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [animal, setAnimal]         = useState<Row | null>(null);

  // Breeding & Reproductive Lifecycle state
  const [breeding, setBreeding]             = useState<Row | null>(null);
  const [loadingBreeding, setLoadingBreeding] = useState(false);
  const [internalDetailsId, setInternalDetailsId] = useState<string | null>(null);

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

      // Fetch breeding, insemination and farrowing details
      setLoadingBreeding(true);
      api.get(`/animal/${matched.animal_id}/breeding`)
        .then((bRes) => setBreeding(unwrap<Row>(bRes)))
        .catch(() => setBreeding(null))
        .finally(() => setLoadingBreeding(false));
    } catch (err: any) {
      setAnimal(null);
      setBreeding(null);
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
    setBreeding(null);
    setError("");
    setActionSuccess("");
    setActionTab("none");
    setInternalDetailsId(null);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleOpenDetails = (animalId: string) => {
    if (onOpenAnimalDetails) {
      onOpenAnimalDetails(animalId);
    } else {
      setInternalDetailsId(animalId);
    }
  };

  return (
    <>
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

        <Toast variant="danger" message={error} onClose={() => setError("")} />
        <Toast variant="success" message={actionSuccess} onClose={() => setActionSuccess("")} />

        {/* ── Animal Resolved Profile ── */}
        {animal && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            {/* Top Identity Card */}
            <div className="rounded-[var(--radius-lg)] border p-4 shadow-sm" style={S.raised}>
              <div className="flex flex-wrap items-start justify-between gap-3">
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

                <div className="flex flex-col items-end gap-2">
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={S.muted}>{t("rfmNetBookValue")}</p>
                    <p className="text-lg font-bold font-mono" style={S.primary}>
                      {formatMoney(animal.book_value ? Number(animal.book_value) : animal.acquisition_cost ? Number(animal.acquisition_cost) : "0")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs font-semibold shadow-2xs"
                    onClick={() => handleOpenDetails(animal.animal_id)}
                  >
                    <FileText className="h-3.5 w-3.5" style={S.accent} />
                    View Full Animal Card
                    <ChevronRight className="h-3 w-3" style={S.muted} />
                  </Button>
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

            {/* ── Breeding, Insemination & Farrowing Details ── */}
            <div className="rounded-[var(--radius-lg)] border p-4 shadow-sm" style={S.surface}>
              <div className="flex items-center justify-between pb-3 border-b mb-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4" style={S.accent} />
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={S.primary}>
                    Breeding, Insemination & Farrowing
                  </h3>
                </div>
                {loadingBreeding ? (
                  <span className="flex items-center gap-1 text-[11px]" style={S.muted}>
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading breeding data…
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold" style={S.muted}>
                    {animal.gender === "M" || animal.animal_type === "BOAR" ? "Sire Performance" : "Sow Lifetime Profile"}
                  </span>
                )}
              </div>

              {/* KPI Grid */}
              {animal.gender === "M" || animal.animal_type === "BOAR" ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 mb-4">
                  <div className="rounded-[var(--radius-md)] border p-2.5 text-center" style={S.raised}>
                    <span className="text-[10px] uppercase font-bold block" style={S.muted}>Services Done</span>
                    <span className="font-mono text-base font-bold mt-0.5 block" style={S.accent}>
                      {breeding?.matings?.filter((m: any) => !m.pooled).length ?? 0}
                    </span>
                  </div>
                  <div className="rounded-[var(--radius-md)] border p-2.5 text-center" style={S.raised}>
                    <span className="text-[10px] uppercase font-bold block" style={S.muted}>Litters Sired</span>
                    <span className="font-mono text-base font-bold mt-0.5 block" style={S.primary}>
                      {breeding?.farrowings?.length ?? 0}
                    </span>
                  </div>
                  <div className="rounded-[var(--radius-md)] border p-2.5 text-center" style={S.raised}>
                    <span className="text-[10px] uppercase font-bold block" style={S.muted}>Sired Born Live</span>
                    <span className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                      {breeding?.farrowings?.reduce((sum: number, f: any) => sum + (Number(f.piglets_born_live) || 0), 0) ?? 0}
                    </span>
                  </div>
                  <div className="rounded-[var(--radius-md)] border p-2.5 text-center" style={S.raised}>
                    <span className="text-[10px] uppercase font-bold block" style={S.muted}>Sired Weaned</span>
                    <span className="font-mono text-base font-bold mt-0.5 block" style={S.primary}>
                      {breeding?.farrowings?.reduce((sum: number, f: any) => sum + (Number(f.piglets_weaned) || 0), 0) ?? 0}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 mb-4">
                  <div className="rounded-[var(--radius-md)] border p-2 text-center" style={S.raised}>
                    <span className="text-[10px] uppercase font-bold block" style={S.muted}>Parity</span>
                    <span className="font-mono text-base font-bold mt-0.5 block" style={S.primary}>
                      {animal.parity_count ?? 0}
                    </span>
                  </div>
                  <div className="rounded-[var(--radius-md)] border p-2 text-center" style={S.raised}>
                    <span className="text-[10px] uppercase font-bold block" style={S.muted}>Born Live</span>
                    <span className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 block">
                      {breeding?.sow_summary?.total_born_live ?? animal.total_piglets_born_live ?? 0}
                    </span>
                  </div>
                  <div className="rounded-[var(--radius-md)] border p-2 text-center" style={S.raised}>
                    <span className="text-[10px] uppercase font-bold block" style={S.muted}>Stillborn</span>
                    <span className="font-mono text-base font-bold text-amber-600 dark:text-amber-400 mt-0.5 block">
                      {breeding?.sow_summary?.born_dead_count ?? 0}
                    </span>
                  </div>
                  <div className="rounded-[var(--radius-md)] border p-2 text-center" style={S.raised}>
                    <span className="text-[10px] uppercase font-bold block" style={S.muted}>Mummified</span>
                    <span className="font-mono text-base font-bold mt-0.5 block" style={S.sub}>
                      {breeding?.sow_summary?.mummified_count ?? 0}
                    </span>
                  </div>
                  <div className="rounded-[var(--radius-md)] border p-2 text-center" style={S.raised}>
                    <span className="text-[10px] uppercase font-bold block" style={S.muted}>Weaned</span>
                    <span className="font-mono text-base font-bold mt-0.5 block" style={S.accent}>
                      {breeding?.sow_summary?.total_weaned ?? animal.total_piglets_weaned ?? 0}
                    </span>
                  </div>
                  <div className="rounded-[var(--radius-md)] border p-2 text-center" style={S.raised}>
                    <span className="text-[10px] uppercase font-bold block" style={S.muted}>Pre-Wean Mort</span>
                    <span className="font-mono text-base font-bold text-red-500 mt-0.5 block">
                      {breeding?.sow_summary?.mortality_pct != null ? `${breeding.sow_summary.mortality_pct}%` : "0.0%"}
                    </span>
                  </div>
                </div>
              )}

              {/* Inseminations & Matings List (Most Recent) */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5" style={S.primary}>
                      <Dna className="h-3.5 w-3.5" style={S.accent} />
                      Inseminations & Matings
                    </span>
                    {breeding?.matings?.length ? (
                      <span className="text-[10px] font-mono" style={S.muted}>
                        {breeding.matings.length} total
                      </span>
                    ) : null}
                  </div>
                  {breeding?.matings && breeding.matings.length > 0 ? (
                    <div className="overflow-hidden rounded-[var(--radius-sm)] border" style={S.raised}>
                      <table className="w-full text-left text-[11px] border-collapse">
                        <thead>
                          <tr className="border-b text-[9px] uppercase font-bold" style={{ ...S.surface, color: "var(--text-muted)" }}>
                            <th className="px-2.5 py-1.5">Date</th>
                            <th className="px-2.5 py-1.5">Type</th>
                            <th className="px-2.5 py-1.5">{animal.gender === "M" || animal.animal_type === "BOAR" ? "Sow" : "Boar / Semen"}</th>
                            <th className="px-2.5 py-1.5">Conception</th>
                            <th className="px-2.5 py-1.5">Expected Due</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {breeding.matings.slice(0, 3).map((m: any) => (
                            <tr key={m.breeding_id} className="hover:bg-[var(--surface)]/50">
                              <td className="px-2.5 py-1.5 font-mono" style={S.primary}>{formatDate(m.mating_date)}</td>
                              <td className="px-2.5 py-1.5" style={S.sub}>{m.mating_type || "AI"}</td>
                              <td className="px-2.5 py-1.5 font-mono font-bold" style={S.accent}>
                                {animal.gender === "M" || animal.animal_type === "BOAR" ? m.sow_code || "—" : m.boar_code || m.semen_lot_no || "—"}
                              </td>
                              <td className="px-2.5 py-1.5">
                                <span
                                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                                    m.conception_result === "PREGNANT"
                                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                      : m.conception_result === "OPEN" || m.conception_result === "NOT_PREGNANT"
                                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                      : "bg-slate-500/10 text-[var(--text-muted)]"
                                  }`}
                                >
                                  {m.conception_result || "PENDING"}
                                </span>
                              </td>
                              <td className="px-2.5 py-1.5 font-mono" style={S.sub}>{formatDate(m.expected_farrowing_date)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-[11px] py-1.5 italic" style={S.muted}>No insemination or mating records found.</p>
                  )}
                </div>

                {/* Farrowings & Litters List (Most Recent) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5" style={S.primary}>
                      <Calendar className="h-3.5 w-3.5" style={S.accent} />
                      Farrowings & Weanings
                    </span>
                    {breeding?.farrowings?.length ? (
                      <span className="text-[10px] font-mono" style={S.muted}>
                        {breeding.farrowings.length} litters
                      </span>
                    ) : null}
                  </div>
                  {breeding?.farrowings && breeding.farrowings.length > 0 ? (
                    <div className="overflow-hidden rounded-[var(--radius-sm)] border" style={S.raised}>
                      <table className="w-full text-left text-[11px] border-collapse">
                        <thead>
                          <tr className="border-b text-[9px] uppercase font-bold" style={{ ...S.surface, color: "var(--text-muted)" }}>
                            <th className="px-2.5 py-1.5">Farrow Date</th>
                            <th className="px-2.5 py-1.5">Parity</th>
                            <th className="px-2.5 py-1.5">Born Live</th>
                            <th className="px-2.5 py-1.5">Stillborn</th>
                            <th className="px-2.5 py-1.5">Weaned</th>
                            <th className="px-2.5 py-1.5">Avg Wean Wt</th>
                            <th className="px-2.5 py-1.5">Piglet Batch</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {breeding.farrowings.slice(0, 3).map((f: any) => (
                            <tr key={f.farrow_id} className="hover:bg-[var(--surface)]/50">
                              <td className="px-2.5 py-1.5 font-mono" style={S.primary}>{formatDate(f.farrowing_date)}</td>
                              <td className="px-2.5 py-1.5 font-mono font-bold" style={S.primary}>#{f.parity_number || "1"}</td>
                              <td className="px-2.5 py-1.5 font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                {f.piglets_born_live || 0}
                              </td>
                              <td className="px-2.5 py-1.5 font-mono text-amber-600 dark:text-amber-400">
                                {f.piglets_stillborn || 0}
                              </td>
                              <td className="px-2.5 py-1.5 font-mono font-bold" style={S.accent}>
                                {f.piglets_weaned || 0}
                              </td>
                              <td className="px-2.5 py-1.5 font-mono" style={S.sub}>
                                {f.avg_weaning_weight_kg ? `${formatQuantity(f.avg_weaning_weight_kg)} kg` : "—"}
                              </td>
                              <td className="px-2.5 py-1.5 font-mono text-[10px]" style={S.sub}>
                                {f.piglet_batch_no || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-[11px] py-1.5 italic" style={S.muted}>No farrowing litters recorded.</p>
                  )}
                </div>
              </div>
            </div>

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
                      <SearchableSelect
                        ariaLabel={t("rfmMedicineVaccine")}
                        value={doseItemId}
                        onChange={(val) => setDoseItemId(val)}
                        options={[
                          { value: "", label: t("rfmSelectMedicine") },
                          ...medItems.map((m) => ({
                            value: m.item_id,
                            label: `${m.item_name} (${m.item_type})${m.withdrawal_days ? ` ${t("rfmWithdrawalDaysSuffix", { days: String(m.withdrawal_days) })}` : ""}`,
                          })),
                        ]}
                        columnHeaders={false}
                        placeholder={t("rfmSelectMedicine")}
                      />
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
                        <div className="w-24">
                          <SearchableSelect
                            ariaLabel="UOM"
                            value={doseUom}
                            onChange={(val) => setDoseUom(val)}
                            options={[
                              { value: "ML", label: "ML" },
                              { value: "DOSE", label: "DOSE" },
                              { value: "MG", label: "MG" },
                              { value: "GM", label: "GM" },
                            ]}
                            columnHeaders={false}
                          />
                        </div>
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

    {internalDetailsId && (
      <AnimalDetailsModal
        animalId={internalDetailsId}
        onClose={() => setInternalDetailsId(null)}
      />
    )}
    </>
  );
}
