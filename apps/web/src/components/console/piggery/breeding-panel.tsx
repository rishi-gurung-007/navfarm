"use client";

import { useEffect, useState } from "react";
import {
  Heart,
  Baby,
  FlaskConical,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
} from "lucide-react";
import { api } from "@/services/api-client";
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
  input:   { backgroundColor: "var(--surface)", borderColor: "var(--border)", color: "var(--text-primary)" },
};

export function BreedingPanel() {
  const { formatMoney } = useCompanyCurrency();
  const { t } = useLanguage();
  const [subTab, setSubTab] = useState<"mating" | "farrowing" | "semen">("mating");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Data
  const [matings, setMatings] = useState<Row[]>([]);
  const [farrowings, setFarrowings] = useState<Row[]>([]);
  const [semenBatches, setSemenBatches] = useState<Row[]>([]);
  const [animals, setAnimals] = useState<Row[]>([]);

  // Modals
  const [showMatingModal, setShowMatingModal] = useState(false);
  const [showFarrowModal, setShowFarrowModal] = useState(false);
  const [showWeanModal, setShowWeanModal] = useState(false);
  const [showSemenModal, setShowSemenModal] = useState(false);
  const [showPregCheckModal, setShowPregCheckModal] = useState(false);
  const [selectedMating, setSelectedMating] = useState<Row | null>(null);
  const [selectedFarrow, setSelectedFarrow] = useState<Row | null>(null);

  // Forms
  const [matingForm, setMatingForm] = useState({
    sow_animal_id: "",
    mating_type: "AI",
    boar_animal_id: "",
    semen_lot_id: "",
    semen_dose_qty: "1.00",
    mating_date: new Date().toISOString().slice(0, 10),
    second_mating_date: "",
    notes: "",
  });

  const [pregCheckForm, setPregCheckForm] = useState({
    pregnancy_confirmed: true,
    preg_check_method: "ULTRASOUND",
    preg_check_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const [farrowForm, setFarrowForm] = useState({
    sow_animal_id: "",
    breeding_id: "",
    farrowing_date: new Date().toISOString().slice(0, 10),
    piglets_born_live: "12",
    piglets_stillborn: "1",
    piglets_mummified: "0",
    avg_birth_weight_kg: "1.45",
    total_litter_weight_kg: "",
    farrowing_status: "NORMAL",
    foster_received: "0",
    fostered_out: "0",
    notes: "",
  });

  const [weanForm, setWeanForm] = useState({
    weaning_date: new Date().toISOString().slice(0, 10),
    piglets_weaned: "11",
    avg_weaning_weight_kg: "7.50",
    cost_per_piglet: "",
    notes: "",
  });

  const [semenForm, setSemenForm] = useState({
    boar_animal_id: "",
    collection_date: new Date().toISOString().slice(0, 10),
    doses_collected: "40",
    amortisation_period: "150",
    feed_cost_period: "200",
    drug_cost_period: "50",
    overhead_cost_period: "100",
    doses_used_internal: "30",
    doses_sold: "10",
    notes: "",
  });

  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mRes, fRes, sRes, aRes] = await Promise.all([
        api.get("/piggery/breeding/mating").catch(() => []),
        api.get("/piggery/breeding/farrowing").catch(() => []),
        api.get("/piggery/breeding/semen-collection").catch(() => []),
        api.get("/animal").catch(() => []),
      ]);
      setMatings(unwrap<Row[]>(mRes) || []);
      setFarrowings(unwrap<Row[]>(fRes) || []);
      setSemenBatches(unwrap<Row[]>(sRes) || []);
      setAnimals(unwrap<Row[]>(aRes) || []);
    } catch (e: any) {
      setError(e.message || t("brpErrorLoadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const sows = animals.filter(
    (a) => a.animal_type === "SOW" || a.animal_type === "GILT" || a.gender === "F"
  );
  const boars = animals.filter(
    (a) => a.animal_type === "BOAR" || a.gender === "M"
  );

  // Handlers
  const handleCreateMating = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/piggery/breeding/mating", {
        ...matingForm,
        semen_dose_qty: Number(matingForm.semen_dose_qty) || 1,
      });
      setSuccess(t("brpSuccessMatingRecorded"));
      setShowMatingModal(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || t("brpErrorMatingFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePregCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMating) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.patch(
        `/piggery/breeding/mating/${selectedMating.breeding_id}/preg-check`,
        pregCheckForm
      );
      setSuccess(t("brpSuccessPregCheckUpdated"));
      setShowPregCheckModal(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || t("brpErrorPregCheckFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateFarrowing = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/piggery/breeding/farrowing", {
        ...farrowForm,
        piglets_born_live: Number(farrowForm.piglets_born_live) || 0,
        piglets_stillborn: Number(farrowForm.piglets_stillborn) || 0,
        piglets_mummified: Number(farrowForm.piglets_mummified) || 0,
        avg_birth_weight_kg: Number(farrowForm.avg_birth_weight_kg) || 1.4,
        total_litter_weight_kg: farrowForm.total_litter_weight_kg
          ? Number(farrowForm.total_litter_weight_kg)
          : undefined,
        foster_received: Number(farrowForm.foster_received) || 0,
        fostered_out: Number(farrowForm.fostered_out) || 0,
      });
      setSuccess(t("brpSuccessFarrowingRecorded"));
      setShowFarrowModal(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || t("brpErrorFarrowingFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleWeaning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFarrow) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.patch(
        `/piggery/breeding/farrowing/${selectedFarrow.farrow_id}/weaning`,
        {
          ...weanForm,
          piglets_weaned: Number(weanForm.piglets_weaned) || 0,
          avg_weaning_weight_kg: Number(weanForm.avg_weaning_weight_kg) || 7,
          cost_per_piglet: weanForm.cost_per_piglet
            ? Number(weanForm.cost_per_piglet)
            : undefined,
        }
      );
      setSuccess(t("brpSuccessWeaningRecorded"));
      setShowWeanModal(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || t("brpErrorWeaningFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSemen = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/piggery/breeding/semen-collection", {
        ...semenForm,
        doses_collected: Number(semenForm.doses_collected) || 1,
        amortisation_period: Number(semenForm.amortisation_period) || 0,
        feed_cost_period: Number(semenForm.feed_cost_period) || 0,
        drug_cost_period: Number(semenForm.drug_cost_period) || 0,
        overhead_cost_period: Number(semenForm.overhead_cost_period) || 0,
        doses_used_internal: Number(semenForm.doses_used_internal) || 0,
        doses_sold: Number(semenForm.doses_sold) || 0,
      });
      setSuccess(t("brpSuccessSemenLogged"));
      setShowSemenModal(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || t("brpErrorSemenFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  // KPIs
  const activeInseminations = matings.filter(
    (m) => m.pregnancy_confirmed !== false && m.days_until_farrowing >= 0
  ).length;
  const totalLitters = farrowings.length;
  const totalBornLive = farrowings.reduce(
    (sum, f) => sum + (Number(f.piglets_born_live) || 0),
    0
  );
  const totalWeaned = farrowings.reduce(
    (sum, f) => sum + (Number(f.piglets_weaned) || 0),
    0
  );
  const avgSurvivalRate =
    totalBornLive > 0 && totalWeaned > 0
      ? ((totalWeaned / totalBornLive) * 100).toFixed(1)
      : "--";
  const totalDoses = semenBatches.reduce(
    (sum, s) => sum + (Number(s.doses_collected) || 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* ── Top Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2" style={S.primary}>
            <Heart className="w-5 h-5" style={S.accent} />
            {t("brpTitle")}
          </h2>
          <p className="text-sm mt-0.5" style={S.sub}>
            {t("brpSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              if (subTab === "mating") setShowMatingModal(true);
              else if (subTab === "farrowing") setShowFarrowModal(true);
              else setShowSemenModal(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {subTab === "mating" ? t("brpRecordMatingAi") : subTab === "farrowing" ? t("brpRecordFarrowing") : t("brpLogSemenCollection")}
          </Button>
        </div>
      </div>

      {error && <InlineAlert variant="danger">{error}</InlineAlert>}
      {success && <InlineAlert variant="success">{success}</InlineAlert>}

      {/* ── KPI Stat Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-[var(--radius-md)] border p-4 transition-all hover:bg-[var(--surface-raised)]" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between" style={S.muted}>
            <span>{t("brpKpiActiveGestations")}</span>
            <Heart className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
          </div>
          <div className="text-2xl font-bold font-mono mt-1.5" style={S.primary}>{activeInseminations}</div>
          <div className="text-[11px] mt-0.5" style={S.muted}>{t("brpKpiActiveGestationsDesc")}</div>
        </div>

        <div className="rounded-[var(--radius-md)] border p-4 transition-all hover:bg-[var(--surface-raised)]" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between" style={S.muted}>
            <span>{t("brpKpiTotalLitters")}</span>
            <Baby className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
          </div>
          <div className="text-2xl font-bold font-mono mt-1.5" style={S.primary}>{totalLitters}</div>
          <div className="text-[11px] mt-0.5" style={S.muted}>{t("brpKpiTotalLittersDesc")}</div>
        </div>

        <div className="rounded-[var(--radius-md)] border p-4 transition-all hover:bg-[var(--surface-raised)]" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between" style={S.muted}>
            <span>{t("brpKpiBornLive")}</span>
            <Activity className="w-3.5 h-3.5" style={{ color: "var(--success)" }} />
          </div>
          <div className="text-2xl font-bold font-mono mt-1.5" style={S.primary}>{totalBornLive}</div>
          <div className="text-[11px] mt-0.5" style={S.muted}>{t("brpKpiBornLiveDesc")}</div>
        </div>

        <div className="rounded-[var(--radius-md)] border p-4 transition-all hover:bg-[var(--surface-raised)]" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between" style={S.muted}>
            <span>{t("brpKpiWeaningSurvival")}</span>
            <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
          </div>
          <div className="text-2xl font-bold font-mono mt-1.5" style={{ color: "var(--accent)" }}>{avgSurvivalRate}%</div>
          <div className="text-[11px] mt-0.5" style={S.muted}>{t("brpKpiWeanedPigletsCount", { count: totalWeaned })}</div>
        </div>

        <div className="rounded-[var(--radius-md)] border p-4 transition-all hover:bg-[var(--surface-raised)]" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center justify-between" style={S.muted}>
            <span>{t("brpKpiSemenDoses")}</span>
            <FlaskConical className="w-3.5 h-3.5" style={{ color: "var(--text-secondary)" }} />
          </div>
          <div className="text-2xl font-bold font-mono mt-1.5" style={S.primary}>{totalDoses}</div>
          <div className="text-[11px] mt-0.5" style={S.muted}>{t("brpKpiSemenDosesDesc")}</div>
        </div>
      </div>

      {/* ── Sub Navigation Tabs ── */}
      <div className="flex border-b gap-6" style={{ borderColor: "var(--border)" }}>
        <button
          onClick={() => setSubTab("mating")}
          className="pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors cursor-pointer"
          style={{
            borderColor: subTab === "mating" ? "var(--accent)" : "transparent",
            color: subTab === "mating" ? "var(--accent)" : "var(--text-secondary)",
          }}
        >
          <Heart className="w-4 h-4" />
          {t("brpTabMating", { count: matings.length })}
        </button>

        <button
          onClick={() => setSubTab("farrowing")}
          className="pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors cursor-pointer"
          style={{
            borderColor: subTab === "farrowing" ? "var(--accent)" : "transparent",
            color: subTab === "farrowing" ? "var(--accent)" : "var(--text-secondary)",
          }}
        >
          <Baby className="w-4 h-4" />
          {t("brpTabFarrowing", { count: farrowings.length })}
        </button>

        <button
          onClick={() => setSubTab("semen")}
          className="pb-3 text-sm font-semibold flex items-center gap-2 border-b-2 transition-colors cursor-pointer"
          style={{
            borderColor: subTab === "semen" ? "var(--accent)" : "transparent",
            color: subTab === "semen" ? "var(--accent)" : "var(--text-secondary)",
          }}
        >
          <FlaskConical className="w-4 h-4" />
          {t("brpTabSemen", { count: semenBatches.length })}
        </button>
      </div>

      {/* ── Tab Content ── */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin" style={S.accent} />
          <p className="text-sm" style={S.sub}>{t("brpLoading")}</p>
        </div>
      ) : (
        <>
          {/* TAB 1: MATING & GESTATION */}
          {subTab === "mating" && (
            <div className="rounded-[var(--radius-lg)] border overflow-hidden" style={S.surface}>
              <table className="w-full text-left text-sm border-collapse">
                <thead className="text-xs uppercase font-semibold border-b" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                  <tr>
                    <th className="py-3 px-4">{t("brpColSow")}</th>
                    <th className="py-3 px-4">{t("brpColType")}</th>
                    <th className="py-3 px-4">{t("brpColMatingDate")}</th>
                    <th className="py-3 px-4">{t("brpColPregCheck")}</th>
                    <th className="py-3 px-4">{t("brpColExpectedFarrowing")}</th>
                    <th className="py-3 px-4">{t("brpColStatusCountdown")}</th>
                    <th className="py-3 px-4 text-right">{t("brpColActions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {matings.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center" style={S.muted}>
                        {t("brpEmptyMatings")}
                      </td>
                    </tr>
                  ) : (
                    matings.map((m) => (
                      <tr key={m.breeding_id} className="hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold" style={S.primary}>{m.sow_code}</div>
                          <div className="text-xs" style={S.sub}>{t("brpTagParity", { tag: m.sow_tag || "--", parity: m.parity_number })}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className="px-2 py-0.5 rounded-[var(--radius-xs)] text-xs font-semibold border"
                            style={{
                              backgroundColor: "var(--surface-raised)",
                              borderColor: "var(--border)",
                              color: "var(--text-primary)",
                            }}
                          >
                            {m.mating_type}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs" style={S.sub}>
                          {m.mating_date}
                          {m.second_mating_date && (
                            <span className="block text-[11px]" style={S.muted}>{t("brpSecondMatingDate", { date: m.second_mating_date })}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {m.pregnancy_confirmed === true ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium" style={S.success}>
                              <CheckCircle2 className="w-3.5 h-3.5" /> {t("brpStatusConfirmed")}
                            </span>
                          ) : m.pregnancy_confirmed === false ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium" style={S.danger}>
                              <XCircle className="w-3.5 h-3.5" /> {t("brpStatusFailed")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium" style={S.warning}>
                              <Clock className="w-3.5 h-3.5" /> {t("brpStatusDue", { date: m.preg_check_date })}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs" style={S.primary}>
                          {m.expected_farrowing_date}
                        </td>
                        <td className="py-3.5 px-4">
                          {m.days_until_farrowing < 0 ? (
                            <span className="px-2 py-0.5 rounded-[var(--radius-xs)] text-xs border font-medium" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--text-muted)" }}>
                              {t("brpStatusPastDue")}
                            </span>
                          ) : m.days_until_farrowing <= 7 ? (
                            <span className="px-2 py-0.5 rounded-[var(--radius-xs)] text-xs border font-bold animate-pulse" style={S.warning}>
                              {t("brpStatusDueInDays", { days: m.days_until_farrowing })}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-[var(--radius-xs)] text-xs border font-medium" style={S.success}>
                              {t("brpStatusDueInDays", { days: m.days_until_farrowing })}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedMating(m);
                              setShowPregCheckModal(true);
                            }}
                          >
                            {t("brpBtnUpdateCheck")}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: FARROWING & LITTERS */}
          {subTab === "farrowing" && (
            <div className="rounded-[var(--radius-lg)] border overflow-hidden" style={S.surface}>
              <table className="w-full text-left text-sm border-collapse">
                <thead className="text-xs uppercase font-semibold border-b" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                  <tr>
                    <th className="py-3 px-4">{t("brpColSow")}</th>
                    <th className="py-3 px-4">{t("brpColFarrowDate")}</th>
                    <th className="py-3 px-4">{t("brpColLiveTotal")}</th>
                    <th className="py-3 px-4">{t("brpColStillbornMummies")}</th>
                    <th className="py-3 px-4">{t("brpColLitterWeight")}</th>
                    <th className="py-3 px-4">{t("brpColWeanedSurvival")}</th>
                    <th className="py-3 px-4 text-right">{t("brpColActions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {farrowings.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center" style={S.muted}>
                        {t("brpEmptyFarrowings")}
                      </td>
                    </tr>
                  ) : (
                    farrowings.map((f) => (
                      <tr key={f.farrow_id} className="hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold" style={S.primary}>{f.sow_code}</div>
                          <div className="text-xs" style={S.sub}>{t("brpTagParity", { tag: f.sow_tag || "--", parity: f.parity_number })}</div>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs" style={S.sub}>
                          {f.farrowing_date}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-bold" style={S.success}>{f.piglets_born_live}</span>
                          <span className="text-xs" style={S.muted}> / {f.piglets_born_total}</span>
                        </td>
                        <td className="py-3.5 px-4 text-xs">
                          <span style={S.danger}>{t("brpStillbornCount", { count: f.piglets_stillborn })}</span>
                          <span className="mx-1" style={S.muted}>•</span>
                          <span style={S.sub}>{t("brpMummifiedCount", { count: f.piglets_mummified })}</span>
                        </td>
                        <td className="py-3.5 px-4 text-xs font-mono" style={S.sub}>
                          {f.total_litter_weight_kg ? `${f.total_litter_weight_kg} kg` : "--"}
                          {f.avg_birth_weight_kg && (
                            <span className="block text-[11px]" style={S.muted}>{t("brpAvgWeight", { weight: f.avg_birth_weight_kg })}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {f.piglets_weaned > 0 ? (
                            <div>
                              <span className="font-bold" style={S.accent}>{t("brpWeanedCount", { count: f.piglets_weaned })}</span>
                              {f.weaning_survival_rate_pct && (
                                <span className="text-xs block" style={S.muted}>{t("brpSurvivalPct", { pct: f.weaning_survival_rate_pct })}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs font-medium" style={S.warning}>{t("brpLactatingDue", { date: f.weaning_date })}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedFarrow(f);
                              setShowWeanModal(true);
                            }}
                          >
                            {t("brpBtnRecordWeaning")}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 3: BOAR SEMEN AI STATION */}
          {subTab === "semen" && (
            <div className="rounded-[var(--radius-lg)] border overflow-hidden" style={S.surface}>
              <table className="w-full text-left text-sm border-collapse">
                <thead className="text-xs uppercase font-semibold border-b" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                  <tr>
                    <th className="py-3 px-4">{t("brpColBoar")}</th>
                    <th className="py-3 px-4">{t("brpColCollectionDate")}</th>
                    <th className="py-3 px-4">{t("brpColDosesCollected")}</th>
                    <th className="py-3 px-4">{t("brpColRunningCost")}</th>
                    <th className="py-3 px-4">{t("brpColUnitCostDose")}</th>
                    <th className="py-3 px-4">{t("brpColInternalSold")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {semenBatches.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center" style={S.muted}>
                        {t("brpEmptySemen")}
                      </td>
                    </tr>
                  ) : (
                    semenBatches.map((s) => (
                      <tr key={s.semen_batch_id} className="hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="py-3.5 px-4 font-semibold" style={S.primary}>
                          {s.boar_code}
                          <span className="block text-xs font-normal" style={S.sub}>{t("brpTagOnly", { tag: s.boar_tag || "--" })}</span>
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs" style={S.sub}>
                          {s.collection_date}
                        </td>
                        <td className="py-3.5 px-4 font-bold" style={S.accent}>
                          {t("brpDosesCount", { count: s.doses_collected })}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs" style={S.sub}>
                          {formatMoney(Number(s.running_cost_period || 0).toLocaleString())}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs font-bold" style={S.success}>
                          {t("brpUnitCostPerDose", { cost: Number(s.unit_cost_per_dose || 0).toFixed(2) })}
                        </td>
                        <td className="py-3.5 px-4 text-xs" style={S.sub}>
                          {t("brpInternalSoldCount", { internal: s.doses_used_internal || 0, sold: s.doses_sold || 0 })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RECORD MATING */}
      {/* ========================================================================= */}
      {showMatingModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="rounded-[var(--radius-lg)] border max-w-lg w-full p-6 space-y-4 shadow-2xl" style={S.surface}>
            <h3 className="text-lg font-bold flex items-center gap-2" style={S.primary}>
              <Heart className="w-5 h-5" style={S.accent} /> {t("brpModalMatingTitle")}
            </h3>
            <form onSubmit={handleCreateMating} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelSowGilt")}</label>
                <select
                  className="nf-input w-full text-sm"
                  style={S.input}
                  value={matingForm.sow_animal_id}
                  onChange={(e) => setMatingForm({ ...matingForm, sow_animal_id: e.target.value })}
                  required
                >
                  <option value="">{t("brpSelectSow")}</option>
                  {sows.map((s) => (
                    <option key={s.animal_id} value={s.animal_id}>
                      {t("brpAnimalOptionLabel", { code: s.animal_code, tag: s.ear_tag || t("brpNa"), parity: s.parity_count })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelMatingType")}</label>
                  <select
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={matingForm.mating_type}
                    onChange={(e) => setMatingForm({ ...matingForm, mating_type: e.target.value })}
                  >
                    <option value="AI">{t("brpOptionAi")}</option>
                    <option value="NATURAL_MATING">{t("brpOptionNaturalMating")}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelMatingDate")}</label>
                  <input
                    type="date"
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={matingForm.mating_date}
                    onChange={(e) => setMatingForm({ ...matingForm, mating_date: e.target.value })}
                    required
                  />
                </div>
              </div>

              {matingForm.mating_type === "NATURAL_MATING" ? (
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelBoarAnimal")}</label>
                  <select
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={matingForm.boar_animal_id}
                    onChange={(e) => setMatingForm({ ...matingForm, boar_animal_id: e.target.value })}
                    required
                  >
                    <option value="">{t("brpSelectBoar")}</option>
                    {boars.map((b) => (
                      <option key={b.animal_id} value={b.animal_id}>
                        {t("brpBoarOptionLabel", { code: b.animal_code, tag: b.ear_tag || t("brpNa") })}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelSemenLotId")}</label>
                    <input
                      type="text"
                      placeholder={t("brpPlaceholderSemenLot")}
                      className="nf-input w-full text-sm"
                      style={S.input}
                      value={matingForm.semen_lot_id}
                      onChange={(e) => setMatingForm({ ...matingForm, semen_lot_id: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelDoseQuantity")}</label>
                    <input
                      type="number"
                      step="0.1"
                      className="nf-input w-full text-sm"
                      style={S.input}
                      value={matingForm.semen_dose_qty}
                      onChange={(e) => setMatingForm({ ...matingForm, semen_dose_qty: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelSecondInsemination")}</label>
                <input
                  type="date"
                  className="nf-input w-full text-sm"
                  style={S.input}
                  value={matingForm.second_mating_date}
                  onChange={(e) => setMatingForm({ ...matingForm, second_mating_date: e.target.value })}
                />
              </div>

              <div className="p-3 rounded-[var(--radius-md)] border text-xs space-y-1" style={S.raised}>
                <div className="flex justify-between">
                  <span style={S.sub}>{t("brpLabelScheduledGestation")}</span>
                  <span className="font-semibold" style={S.primary}>{t("brpValueGestationDays")}</span>
                </div>
                <div className="flex justify-between">
                  <span style={S.sub}>{t("brpLabelUltrasoundCheck")}</span>
                  <span className="font-semibold" style={S.primary}>{t("brpValue28DaysPostMating")}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowMatingModal(false)}>
                  {t("brpBtnCancel")}
                </Button>
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? t("brpBtnRecording") : t("brpBtnSaveMating")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: PREGNANCY CHECK */}
      {/* ========================================================================= */}
      {showPregCheckModal && selectedMating && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="rounded-[var(--radius-lg)] border max-w-md w-full p-6 space-y-4 shadow-2xl" style={S.surface}>
            <h3 className="text-lg font-bold flex items-center gap-2" style={S.primary}>
              <CheckCircle2 className="w-5 h-5" style={S.success} /> {t("brpModalPregCheckTitle")}
            </h3>
            <p className="text-xs" style={S.sub}>
              {t("brpLabelSowColon")} <span className="font-semibold" style={S.primary}>{selectedMating.sow_code}</span> {t("brpMatedOn", { date: selectedMating.mating_date })}
            </p>
            <form onSubmit={handlePregCheck} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelResult")}</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPregCheckForm({ ...pregCheckForm, pregnancy_confirmed: true })}
                    className="py-2 px-3 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    style={pregCheckForm.pregnancy_confirmed ? S.success : S.surface}
                  >
                    <CheckCircle2 className="w-4 h-4" /> {t("brpOptionConfirmedPregnant")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPregCheckForm({ ...pregCheckForm, pregnancy_confirmed: false })}
                    className="py-2 px-3 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    style={!pregCheckForm.pregnancy_confirmed ? S.danger : S.surface}
                  >
                    <XCircle className="w-4 h-4" /> {t("brpOptionFailedNotPregnant")}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelCheckMethod")}</label>
                <select
                  className="nf-input w-full text-sm"
                  style={S.input}
                  value={pregCheckForm.preg_check_method}
                  onChange={(e) => setPregCheckForm({ ...pregCheckForm, preg_check_method: e.target.value })}
                >
                  <option value="ULTRASOUND">{t("brpOptionUltrasoundScan")}</option>
                  <option value="RECTAL">{t("brpOptionRectalPalpation")}</option>
                  <option value="VISUAL">{t("brpOptionVisualHeatCheck")}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelCheckDate")}</label>
                <input
                  type="date"
                  className="nf-input w-full text-sm"
                  style={S.input}
                  value={pregCheckForm.preg_check_date}
                  onChange={(e) => setPregCheckForm({ ...pregCheckForm, preg_check_date: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowPregCheckModal(false)}>
                  {t("brpBtnCancel")}
                </Button>
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? t("brpBtnSaving") : t("brpBtnUpdatePregStatus")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RECORD FARROWING */}
      {/* ========================================================================= */}
      {showFarrowModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="rounded-[var(--radius-lg)] border max-w-lg w-full p-6 space-y-4 shadow-2xl" style={S.surface}>
            <h3 className="text-lg font-bold flex items-center gap-2" style={S.primary}>
              <Baby className="w-5 h-5" style={S.accent} /> {t("brpModalFarrowingTitle")}
            </h3>
            <form onSubmit={handleCreateFarrowing} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelSowRequired")}</label>
                <select
                  className="nf-input w-full text-sm"
                  style={S.input}
                  value={farrowForm.sow_animal_id}
                  onChange={(e) => setFarrowForm({ ...farrowForm, sow_animal_id: e.target.value })}
                  required
                >
                  <option value="">{t("brpSelectSow")}</option>
                  {sows.map((s) => (
                    <option key={s.animal_id} value={s.animal_id}>
                      {t("brpAnimalOptionLabel", { code: s.animal_code, tag: s.ear_tag || t("brpNa"), parity: s.parity_count })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelFarrowingDate")}</label>
                  <input
                    type="date"
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={farrowForm.farrowing_date}
                    onChange={(e) => setFarrowForm({ ...farrowForm, farrowing_date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelFarrowingStatus")}</label>
                  <select
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={farrowForm.farrowing_status}
                    onChange={(e) => setFarrowForm({ ...farrowForm, farrowing_status: e.target.value })}
                  >
                    <option value="NORMAL">{t("brpOptionNormalUnassisted")}</option>
                    <option value="ASSISTED">{t("brpOptionAssistedDelivery")}</option>
                    <option value="C_SECTION">{t("brpOptionCaesareanSection")}</option>
                    <option value="COMPLICATIONS">{t("brpOptionComplications")}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.success}>{t("brpLabelBornLive")}</label>
                  <input
                    type="number"
                    min="0"
                    className="nf-input w-full text-sm font-bold"
                    style={S.input}
                    value={farrowForm.piglets_born_live}
                    onChange={(e) => setFarrowForm({ ...farrowForm, piglets_born_live: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.danger}>{t("brpLabelStillborn")}</label>
                  <input
                    type="number"
                    min="0"
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={farrowForm.piglets_stillborn}
                    onChange={(e) => setFarrowForm({ ...farrowForm, piglets_stillborn: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelMummified")}</label>
                  <input
                    type="number"
                    min="0"
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={farrowForm.piglets_mummified}
                    onChange={(e) => setFarrowForm({ ...farrowForm, piglets_mummified: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelAvgBirthWeight")}</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={t("brpPlaceholderAvgBirthWeight")}
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={farrowForm.avg_birth_weight_kg}
                    onChange={(e) => setFarrowForm({ ...farrowForm, avg_birth_weight_kg: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelTotalLitterWeight")}</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={t("brpPlaceholderAutoCalc")}
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={farrowForm.total_litter_weight_kg}
                    onChange={(e) => setFarrowForm({ ...farrowForm, total_litter_weight_kg: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowFarrowModal(false)}>
                  {t("brpBtnCancel")}
                </Button>
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? t("brpBtnSaving") : t("brpBtnSaveFarrowing")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RECORD WEANING */}
      {/* ========================================================================= */}
      {showWeanModal && selectedFarrow && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="rounded-[var(--radius-lg)] border max-w-md w-full p-6 space-y-4 shadow-2xl" style={S.surface}>
            <h3 className="text-lg font-bold flex items-center gap-2" style={S.primary}>
              <CheckCircle2 className="w-5 h-5" style={S.accent} /> {t("brpModalWeaningTitle")}
            </h3>
            <p className="text-xs" style={S.sub}>
              {t("brpLabelSowColon")} <span className="font-semibold" style={S.primary}>{selectedFarrow.sow_code}</span> {t("brpFarrowedOn", { date: selectedFarrow.farrowing_date })}
            </p>
            <form onSubmit={handleWeaning} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelWeaningDate")}</label>
                <input
                  type="date"
                  className="nf-input w-full text-sm"
                  style={S.input}
                  value={weanForm.weaning_date}
                  onChange={(e) => setWeanForm({ ...weanForm, weaning_date: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.accent}>{t("brpLabelPigletsWeaned")}</label>
                  <input
                    type="number"
                    min="0"
                    className="nf-input w-full text-sm font-bold"
                    style={S.input}
                    value={weanForm.piglets_weaned}
                    onChange={(e) => setWeanForm({ ...weanForm, piglets_weaned: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelAvgWeanWeight")}</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={t("brpPlaceholderAvgWeanWeight")}
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={weanForm.avg_weaning_weight_kg}
                    onChange={(e) => setWeanForm({ ...weanForm, avg_weaning_weight_kg: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowWeanModal(false)}>
                  {t("brpBtnCancel")}
                </Button>
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? t("brpBtnSaving") : t("brpBtnSaveWeaning")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: LOG SEMEN COLLECTION */}
      {/* ========================================================================= */}
      {showSemenModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="rounded-[var(--radius-lg)] border max-w-lg w-full p-6 space-y-4 shadow-2xl" style={S.surface}>
            <h3 className="text-lg font-bold flex items-center gap-2" style={S.primary}>
              <FlaskConical className="w-5 h-5" style={S.accent} /> {t("brpModalSemenTitle")}
            </h3>
            <form onSubmit={handleCreateSemen} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelBoarAnimal")}</label>
                <select
                  className="nf-input w-full text-sm"
                  style={S.input}
                  value={semenForm.boar_animal_id}
                  onChange={(e) => setSemenForm({ ...semenForm, boar_animal_id: e.target.value })}
                  required
                >
                  <option value="">{t("brpSelectBoar")}</option>
                  {boars.map((b) => (
                    <option key={b.animal_id} value={b.animal_id}>
                      {t("brpBoarOptionLabel", { code: b.animal_code, tag: b.ear_tag || t("brpNa") })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelCollectionDate")}</label>
                  <input
                    type="date"
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={semenForm.collection_date}
                    onChange={(e) => setSemenForm({ ...semenForm, collection_date: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.accent}>{t("brpLabelDosesCollected")}</label>
                  <input
                    type="number"
                    min="1"
                    className="nf-input w-full text-sm font-bold"
                    style={S.input}
                    value={semenForm.doses_collected}
                    onChange={(e) => setSemenForm({ ...semenForm, doses_collected: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="p-3 rounded-[var(--radius-md)] border space-y-2" style={S.raised}>
                <div className="text-xs font-semibold" style={S.primary}>{t("brpLabelPeriodRunningCosts")}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px]" style={S.muted}>{t("brpLabelAmortisation")}</label>
                    <input
                      type="number"
                      className="nf-input w-full text-xs"
                      style={S.input}
                      value={semenForm.amortisation_period}
                      onChange={(e) => setSemenForm({ ...semenForm, amortisation_period: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px]" style={S.muted}>{t("brpLabelFeedCost")}</label>
                    <input
                      type="number"
                      className="nf-input w-full text-xs"
                      style={S.input}
                      value={semenForm.feed_cost_period}
                      onChange={(e) => setSemenForm({ ...semenForm, feed_cost_period: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px]" style={S.muted}>{t("brpLabelDrugsMed")}</label>
                    <input
                      type="number"
                      className="nf-input w-full text-xs"
                      style={S.input}
                      value={semenForm.drug_cost_period}
                      onChange={(e) => setSemenForm({ ...semenForm, drug_cost_period: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px]" style={S.muted}>{t("brpLabelLabOverhead")}</label>
                    <input
                      type="number"
                      className="nf-input w-full text-xs"
                      style={S.input}
                      value={semenForm.overhead_cost_period}
                      onChange={(e) => setSemenForm({ ...semenForm, overhead_cost_period: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowSemenModal(false)}>
                  {t("brpBtnCancel")}
                </Button>
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? t("brpBtnCalculatingSaving") : t("brpBtnSaveCollectionBatch")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
