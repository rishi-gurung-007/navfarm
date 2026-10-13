"use client";

import { useEffect, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { EntityLookupField } from "@/modules/master-data/EntityLookupField";
import { Toast } from "@/components/ui/toast";
import { useLanguage } from "@/hooks/useLanguage";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import AnimalDetailsModal from "./animal-details-modal";
import { formatQuantity } from "@/lib/utils";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

/** An animal code that opens that animal's details, the same card the Batch Animals page opens. */
function AnimalCodeLink({ animalId, code, onOpen, style }: { animalId?: string | null; code?: string | null; onOpen: (id: string) => void; style?: React.CSSProperties }) {
  if (!animalId || !code) return <>{code || "--"}</>;
  return (
    <button
      type="button"
      onClick={() => onOpen(animalId)}
      className="font-mono font-bold text-[var(--accent)] hover:underline text-left cursor-pointer"
      style={style}
      title="View animal details"
    >
      {code}
    </button>
  );
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

// breeding_record.conception_result (15 Sep correction 6).
const CONCEPTION_RESULTS = ["CONFIRMED", "REPEAT", "FAILED", "PENDING"] as const;

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
  const [batches, setBatches] = useState<Row[]>([]);
  // The piglet item is picked where the farrowing is recorded (any bio-asset item the farm uses for piglets), and the
  // weaned piglets are sent on to a batch or a stage: nothing about either is fixed.
  const [pigletItems, setPigletItems] = useState<Row[]>([]);
  const [stages, setStages] = useState<Row[]>([]);
  // Any item the farm uses for semen: nothing is fixed.
  const [semenItems, setSemenItems] = useState<Row[]>([]);

  // Modals
  const [showMatingModal, setShowMatingModal] = useState(false);
  const [showFarrowModal, setShowFarrowModal] = useState(false);
  const [showWeanModal, setShowWeanModal] = useState(false);
  const [showSemenModal, setShowSemenModal] = useState(false);
  const [showPregCheckModal, setShowPregCheckModal] = useState(false);
  const [selectedMating, setSelectedMating] = useState<Row | null>(null);
  const [selectedFarrow, setSelectedFarrow] = useState<Row | null>(null);
  const [detailsAnimalId, setDetailsAnimalId] = useState<string | null>(null);

  // Forms
  const emptyMatingForm = () => ({
    sow_animal_id: "",
    mating_type: "AI",
    boar_animal_id: "",
    semen_lot_id: "",
    semen_dose_qty: "1.00",
    mating_date: new Date().toISOString().slice(0, 10),
    second_mating_date: "",
    batch_id: "",
    expected_farrowing_date: "",
    preg_check_date: "",
    conception_result: "PENDING",
    parity_number: "",
    boar_parity_number: "",
    notes: "",
  });
  const [matingForm, setMatingForm] = useState(emptyMatingForm);
  // Fields the user has typed over. The API's defaults refill only the rest, so
  // changing the sow or the date does not wipe an edited farrowing date.
  const editedMatingFields = useRef<Set<string>>(new Set());
  const [gestationDays, setGestationDays] = useState<number | null>(null);
  const editMating = (field: string, value: string) => {
    editedMatingFields.current.add(field);
    setMatingForm((form) => ({ ...form, [field]: value }));
  };

  const [pregCheckForm, setPregCheckForm] = useState({
    conception_result: "CONFIRMED",
    preg_check_method: "ULTRASOUND",
    preg_check_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const [farrowForm, setFarrowForm] = useState({
    sow_animal_id: "",
    breeding_id: "",
    farrowing_date: new Date().toISOString().slice(0, 10),
    piglets_born_live: "",
    piglets_stillborn: "",
    piglets_mummified: "",
    avg_birth_weight_kg: "",
    total_litter_weight_kg: "",
    farrowing_status: "NORMAL",
    foster_received: "",
    fostered_out: "",
    piglet_item_id: "",
    piglet_stage_id: "",
    notes: "",
  });

  const [weanForm, setWeanForm] = useState({
    weaning_date: new Date().toISOString().slice(0, 10),
    piglets_weaned: "",
    avg_weaning_weight_kg: "",
    cost_per_piglet: "",
    move_to_batch_id: "",
    move_to_stage_code: "",
    notes: "",
  });

  // No pre-filled figures: doses and costs are whatever was collected and spent, entered by whoever knows.
  const [semenForm, setSemenForm] = useState({
    // The boars the lot is collected from, in the order chosen: the first is its main boar, and with more than one the
    // semen is pooled — mixed into one lot.
    boar_animal_ids: [] as string[],
    collection_date: new Date().toISOString().slice(0, 10),
    doses_collected: "",
    output_item_id: "",
    amortisation_period: "",
    feed_cost_period: "",
    drug_cost_period: "",
    overhead_cost_period: "",
    volume_ml: "",
    motility_pct: "",
    concentration_m_per_ml: "",
    notes: "",
  });

  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mRes, fRes, sRes, aRes, bRes] = await Promise.all([
        api.get("/piggery/breeding/mating").catch(() => []),
        api.get("/piggery/breeding/farrowing").catch(() => []),
        api.get("/piggery/breeding/semen-collection").catch(() => []),
        api.get("/animal").catch(() => []),
        // The API bounds this to the active farm; the service write checks
        // again that the batch is on the sow's own farm.
        api.get("/batch?limit=100").catch(() => []),
      ]);
      setMatings(unwrap<Row[]>(mRes) || []);
      setFarrowings(unwrap<Row[]>(fRes) || []);
      setSemenBatches(unwrap<Row[]>(sRes) || []);
      setAnimals(unwrap<Row[]>(aRes) || []);
      setBatches((unwrap<Row[]>(bRes) || []).filter((b) => b.status !== "CLOSED" && b.status !== "CANCELLED"));
      api.get("/item?itemType=LIVESTOCK&isActive=true&limit=100").then((r) => setPigletItems((unwrap<Row[]>(r) || []).filter((i) => i.is_biological_asset))).catch(() => setPigletItems([]));
      api.get("/stage?limit=100").then((r) => setStages(unwrap<Row[]>(r) || [])).catch(() => setStages([]));
      api.get("/item?isActive=true&limit=200").then((r) => setSemenItems(unwrap<Row[]>(r) || [])).catch(() => setSemenItems([]));
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

  // Prefill from the API, which owns the rules: the sow's breed gestation
  // days (116 when the breed has none), check at +28, sow parity from her
  // completed parities, boar parity from his prior services, her own batch.
  useEffect(() => {
    if (!showMatingModal || !matingForm.sow_animal_id || !matingForm.mating_date) return;
    let cancelled = false;
    const params = new URLSearchParams({ sow_animal_id: matingForm.sow_animal_id, mating_date: matingForm.mating_date });
    if (matingForm.boar_animal_id) params.set("boar_animal_id", matingForm.boar_animal_id);
    if (matingForm.semen_lot_id) params.set("semen_lot_id", matingForm.semen_lot_id);
    api.get(`/piggery/breeding/mating/defaults?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        const d = unwrap<Row>(res) || {};
        setGestationDays(d.gestation_days ?? null);
        const edited = editedMatingFields.current;
        setMatingForm((form) => ({
          ...form,
          expected_farrowing_date: edited.has("expected_farrowing_date") ? form.expected_farrowing_date : (d.expected_farrowing_date ?? ""),
          preg_check_date: edited.has("preg_check_date") ? form.preg_check_date : (d.preg_check_date ?? ""),
          parity_number: edited.has("parity_number") ? form.parity_number : (d.parity_number != null ? String(d.parity_number) : ""),
          boar_parity_number: edited.has("boar_parity_number") ? form.boar_parity_number : (d.boar_parity_number != null ? String(d.boar_parity_number) : ""),
          batch_id: edited.has("batch_id") ? form.batch_id : (d.batch_id ?? ""),
        }));
      })
      .catch((err: any) => { if (!cancelled) setError(err?.message || t("brpErrorMatingFailed")); });
    return () => { cancelled = true; };
  }, [showMatingModal, matingForm.sow_animal_id, matingForm.mating_date, matingForm.boar_animal_id, matingForm.semen_lot_id]);

  const openMatingModal = () => {
    editedMatingFields.current = new Set();
    setGestationDays(null);
    setMatingForm(emptyMatingForm());
    setShowMatingModal(true);
  };

  // Handlers
  const handleCreateMating = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Blank optionals are left out rather than sent as "": the API validates
      // ids as UUIDs, and "" is not a missing value to it.
      const body: Row = Object.fromEntries(Object.entries(matingForm).filter(([, v]) => v !== ""));
      await api.post("/piggery/breeding/mating", {
        ...body,
        semen_dose_qty: Number(matingForm.semen_dose_qty) || 1,
        parity_number: matingForm.parity_number !== "" ? Number(matingForm.parity_number) : undefined,
        boar_parity_number: matingForm.boar_parity_number !== "" ? Number(matingForm.boar_parity_number) : undefined,
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
        {
          conception_result: pregCheckForm.conception_result,
          preg_check_method: pregCheckForm.preg_check_method,
          preg_check_date: pregCheckForm.preg_check_date || undefined,
          notes: pregCheckForm.notes || undefined,
        }
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
      const num = (v: string) => (v === "" ? undefined : Number(v));
      const res: any = await api.post("/piggery/breeding/farrowing", {
        sow_animal_id: farrowForm.sow_animal_id,
        breeding_id: farrowForm.breeding_id || undefined,
        farrowing_date: farrowForm.farrowing_date,
        farrowing_status: farrowForm.farrowing_status,
        piglets_born_live: Number(farrowForm.piglets_born_live) || 0,
        piglets_stillborn: num(farrowForm.piglets_stillborn),
        piglets_mummified: num(farrowForm.piglets_mummified),
        // A weight is sent only when someone measured it; a blank used to become 1.4 kg.
        avg_birth_weight_kg: num(farrowForm.avg_birth_weight_kg),
        total_litter_weight_kg: num(farrowForm.total_litter_weight_kg),
        foster_received: num(farrowForm.foster_received),
        fostered_out: num(farrowForm.fostered_out),
        piglet_item_id: farrowForm.piglet_item_id || undefined,
        piglet_stage_id: farrowForm.piglet_stage_id || undefined,
        notes: farrowForm.notes || undefined,
      });
      setSuccess(res?.data?.message || res?.message || t("brpSuccessFarrowingRecorded"));
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
      const res: any = await api.patch(
        `/piggery/breeding/farrowing/${selectedFarrow.farrow_id}/weaning`,
        {
          weaning_date: weanForm.weaning_date,
          piglets_weaned: Number(weanForm.piglets_weaned) || 0,
          // Sent only when weighed; a blank used to become 7 kg.
          avg_weaning_weight_kg: weanForm.avg_weaning_weight_kg === "" ? undefined : Number(weanForm.avg_weaning_weight_kg),
          cost_per_piglet: weanForm.cost_per_piglet ? Number(weanForm.cost_per_piglet) : undefined,
          move_to_batch_id: weanForm.move_to_batch_id || undefined,
          move_to_stage_code: weanForm.move_to_stage_code || undefined,
          notes: weanForm.notes || undefined,
        }
      );
      setSuccess(res?.data?.message || res?.message || t("brpSuccessWeaningRecorded"));
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
    if (!semenForm.boar_animal_ids.length) {
      setError("Choose at least one boar.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const num = (v: string) => (v === "" ? undefined : Number(v));
      const [mainBoar, ...pooled] = semenForm.boar_animal_ids;
      const res: any = await api.post("/piggery/breeding/semen-collection", {
        boar_animal_id: mainBoar,
        ...(pooled.length ? { pool_boar_animal_ids: pooled } : {}),
        collection_date: semenForm.collection_date,
        doses_collected: Number(semenForm.doses_collected) || 1,
        output_item_id: semenForm.output_item_id || undefined,
        amortisation_period: num(semenForm.amortisation_period),
        feed_cost_period: num(semenForm.feed_cost_period),
        drug_cost_period: num(semenForm.drug_cost_period),
        overhead_cost_period: num(semenForm.overhead_cost_period),
        volume_ml: num(semenForm.volume_ml),
        motility_pct: num(semenForm.motility_pct),
        concentration_m_per_ml: num(semenForm.concentration_m_per_ml),
        notes: semenForm.notes || undefined,
      });
      setSuccess(res?.data?.message || res?.message || t("brpSuccessSemenLogged"));
      setShowSemenModal(false);
      setSemenForm((f) => ({ ...f, boar_animal_ids: [] }));
      await loadData();
    } catch (err: any) {
      setError(err.message || t("brpErrorSemenFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  // KPIs
  const activeInseminations = matings.filter(
    (m) => (m.conception_result === "CONFIRMED" || m.conception_result === "PENDING") && m.days_until_farrowing >= 0
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
              if (subTab === "mating") openMatingModal();
              else if (subTab === "farrowing") setShowFarrowModal(true);
              else setShowSemenModal(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {subTab === "mating" ? t("brpRecordMatingAi") : subTab === "farrowing" ? t("brpRecordFarrowing") : t("brpLogSemenCollection")}
          </Button>
        </div>
      </div>

      <Toast variant="danger" message={error} onClose={() => setError(null)} />
      <Toast variant="success" message={success} onClose={() => setSuccess(null)} />

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
                    <th className="py-3 px-4">{t("brpColBoar")}</th>
                    <th className="py-3 px-4">{t("brpColBatch")}</th>
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
                      <td colSpan={9} className="py-12 text-center" style={S.muted}>
                        {t("brpEmptyMatings")}
                      </td>
                    </tr>
                  ) : (
                    matings.map((m) => (
                      <tr key={m.breeding_id} className="hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold" style={S.primary}><AnimalCodeLink animalId={m.sow_id} code={m.sow_code} onOpen={setDetailsAnimalId} /></div>
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
                        <td className="py-3.5 px-4">
                          <div className="text-xs font-semibold" style={m.boar_code ? S.primary : S.muted}><AnimalCodeLink animalId={m.boar_id} code={m.boar_code} onOpen={setDetailsAnimalId} /></div>
                          {m.boar_parity_number != null && (
                            <div className="text-[11px]" style={S.sub}>{t("brpBoarParity", { parity: m.boar_parity_number })}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs" style={m.batch_no ? S.sub : S.muted}>
                          {m.batch_no || "--"}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs" style={S.sub}>
                          {m.mating_date}
                          {m.second_mating_date && (
                            <span className="block text-[11px]" style={S.muted}>{t("brpSecondMatingDate", { date: m.second_mating_date })}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {/* conception_result is the field of record; REPEAT (back
                              on heat) and FAILED are both not-pregnant but not
                              the same outcome, which the boolean could not say. */}
                          {m.conception_result === "CONFIRMED" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium" style={S.success}>
                              <CheckCircle2 className="w-3.5 h-3.5" /> {t("brpStatusConfirmed")}
                            </span>
                          ) : m.conception_result === "FAILED" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium" style={S.danger}>
                              <XCircle className="w-3.5 h-3.5" /> {t("brpStatusFailed")}
                            </span>
                          ) : m.conception_result === "REPEAT" ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium" style={S.warning}>
                              <XCircle className="w-3.5 h-3.5" /> {t("brpStatusRepeat")}
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
                              setPregCheckForm({
                                conception_result: m.conception_result && m.conception_result !== "PENDING" ? m.conception_result : "CONFIRMED",
                                preg_check_method: m.preg_check_method || "ULTRASOUND",
                                preg_check_date: m.preg_check_date || new Date().toISOString().slice(0, 10),
                                notes: "",
                              });
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
                          <div className="font-semibold" style={S.primary}><AnimalCodeLink animalId={f.sow_id} code={f.sow_code} onOpen={setDetailsAnimalId} /></div>
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
                          {f.total_litter_weight_kg ? `${formatQuantity(f.total_litter_weight_kg)} kg` : "--"}
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
                          {s.pooled
                            ? (s.boars || []).map((b: Row, i: number) => (
                                <span key={b.boar_id ?? b.boar_code}>
                                  {i > 0 && " + "}
                                  <AnimalCodeLink animalId={b.boar_id} code={b.boar_code} onOpen={setDetailsAnimalId} />
                                </span>
                              ))
                            : <AnimalCodeLink animalId={s.boar_id} code={s.boar_code} onOpen={setDetailsAnimalId} />}
                          {s.pooled ? (
                            <span className="block text-xs font-normal" style={S.sub}>
                              Pooled lot · {(s.boars || []).length} boars mixed
                            </span>
                          ) : (
                            <span className="block text-xs font-normal" style={S.sub}>{t("brpTagOnly", { tag: s.boar_tag || "--" })}</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-xs" style={S.sub}>
                          {s.collection_date}
                          {s.lot_no && (
                            <span className="block" style={S.primary}>
                              {s.lot_no}{s.expiry_date ? ` · exp ${String(s.expiry_date).slice(0, 10)}` : ""}
                            </span>
                          )}
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
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2" style={S.primary}>
                <Heart className="w-5 h-5" style={S.accent} /> {t("brpModalMatingTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setShowMatingModal(false)}
                className="p-1 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer"
                aria-label={t("close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
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
                      {t("brpAnimalOptionLabel", { code: s.animal_code, tag: s.rfid_tag || t("brpNa"), parity: s.parity_count })}
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

              {/* The boar is asked for AI too, and optional there: his parity on
                  this service needs him. An AI dose picked from a semen lot
                  names its boar by itself. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>
                    {matingForm.mating_type === "NATURAL_MATING" ? t("brpLabelBoarAnimal") : t("brpLabelBoarOptional")}
                  </label>
                  <select
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={matingForm.boar_animal_id}
                    onChange={(e) => setMatingForm({ ...matingForm, boar_animal_id: e.target.value })}
                    required={matingForm.mating_type === "NATURAL_MATING"}
                  >
                    <option value="">{t("brpSelectBoar")}</option>
                    {boars.map((b) => (
                      <option key={b.animal_id} value={b.animal_id}>
                        {t("brpBoarOptionLabel", { code: b.animal_code, tag: b.rfid_tag || t("brpNa") })}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelBatch")}</label>
                  <select
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={matingForm.batch_id}
                    onChange={(e) => editMating("batch_id", e.target.value)}
                  >
                    <option value="">{t("brpSelectBatch")}</option>
                    {batches.map((b) => (
                      <option key={b.batch_id} value={b.batch_id}>{b.batch_no}</option>
                    ))}
                  </select>
                </div>
              </div>

              {matingForm.mating_type === "AI" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelSemenLotId")}</label>
                    {/* A select of logged collections, not free text: the API
                        accepts only a semen_batch id, so a typed lot name was
                        always refused. */}
                    <select
                      className="nf-input w-full text-sm"
                      style={S.input}
                      value={matingForm.semen_lot_id}
                      onChange={(e) => setMatingForm({ ...matingForm, semen_lot_id: e.target.value })}
                    >
                      <option value="">{t("brpSelectSemenLot")}</option>
                      {semenBatches.map((sb) => {
                        const left = Number(sb.doses_collected) - Number(sb.doses_used_internal || 0) - Number(sb.doses_sold || 0);
                        return (
                          <option key={sb.semen_batch_id} value={sb.semen_batch_id} disabled={left <= 0}>
                            {t("brpSemenLotOptionLabel", { boar: sb.pooled ? (sb.boars || []).map((b: Row) => b.boar_code).join(" + ") : sb.boar_code, date: sb.collection_date })}{sb.pooled ? " · pooled" : ""} · {sb.lot_no ?? "no lot"} · {left} doses left
                          </option>
                        );
                      })}
                    </select>
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelExpectedFarrowingDate")}</label>
                  <input
                    type="date"
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={matingForm.expected_farrowing_date}
                    min={matingForm.mating_date}
                    onChange={(e) => editMating("expected_farrowing_date", e.target.value)}
                  />
                  {gestationDays != null && (
                    <p className="text-[11px] mt-1" style={S.muted}>{t("brpHintGestationDays", { days: gestationDays })}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelPregCheckDate")}</label>
                  <input
                    type="date"
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={matingForm.preg_check_date}
                    min={matingForm.mating_date}
                    onChange={(e) => editMating("preg_check_date", e.target.value)}
                  />
                  <p className="text-[11px] mt-1" style={S.muted}>{t("brpValue28DaysPostMating")}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelResultShort")}</label>
                  <select
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={matingForm.conception_result}
                    onChange={(e) => editMating("conception_result", e.target.value)}
                  >
                    {CONCEPTION_RESULTS.map((r) => (
                      <option key={r} value={r}>{t(`brpResult${r}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelSowParity")}</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={matingForm.parity_number}
                    onChange={(e) => editMating("parity_number", e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelBoarParity")}</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="nf-input w-full text-sm"
                    style={S.input}
                    value={matingForm.boar_parity_number}
                    disabled={!matingForm.boar_animal_id && !matingForm.semen_lot_id}
                    onChange={(e) => editMating("boar_parity_number", e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
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
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2" style={S.primary}>
                <CheckCircle2 className="w-5 h-5" style={S.success} /> {t("brpModalPregCheckTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setShowPregCheckModal(false)}
                className="p-1 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer"
                aria-label={t("close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs" style={S.sub}>
              {t("brpLabelSowColon")} <span className="font-semibold" style={S.primary}>{selectedMating.sow_code}</span> {t("brpMatedOn", { date: selectedMating.mating_date })}
            </p>
            <form onSubmit={handlePregCheck} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={S.sub}>{t("brpLabelResult")}</label>
                <div className="grid grid-cols-2 gap-2">
                  {CONCEPTION_RESULTS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setPregCheckForm({ ...pregCheckForm, conception_result: r })}
                      className="py-2 px-3 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                      style={pregCheckForm.conception_result === r
                        ? (r === "CONFIRMED" ? S.success : r === "PENDING" ? S.raised : r === "REPEAT" ? S.warning : S.danger)
                        : S.surface}
                    >
                      {r === "CONFIRMED" ? <CheckCircle2 className="w-4 h-4" /> : r === "PENDING" ? <Clock className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      {t(`brpResult${r}`)}
                    </button>
                  ))}
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

              <div className="flex justify-end pt-2">
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
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2" style={S.primary}>
                <Baby className="w-5 h-5" style={S.accent} /> {t("brpModalFarrowingTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setShowFarrowModal(false)}
                className="p-1 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer"
                aria-label={t("close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
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
                      {t("brpAnimalOptionLabel", { code: s.animal_code, tag: s.rfid_tag || t("brpNa"), parity: s.parity_count })}
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

              <div className="rounded-[var(--radius-md)] border p-3 space-y-2" style={S.surface}>
                <p className="text-xs font-semibold" style={S.primary}>Piglet lot</p>
                <p className="text-[11px]" style={S.sub}>
                  The live piglets are held as a lot of a bio-asset item in a batch of their own, which you can move on to any stage or batch. Leave the item empty to record the litter only.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={S.sub} htmlFor="piglet-item">Piglet item</label>
                    <select
                      id="piglet-item"
                      className="nf-input w-full text-sm"
                      style={S.input}
                      value={farrowForm.piglet_item_id}
                      onChange={(e) => setFarrowForm({ ...farrowForm, piglet_item_id: e.target.value })}
                    >
                      <option value="">No piglet lot</option>
                      {pigletItems.map((i) => (
                        <option key={i.item_id} value={i.item_id}>{i.item_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={S.sub} htmlFor="piglet-stage">Piglets start in stage</label>
                    <select
                      id="piglet-stage"
                      className="nf-input w-full text-sm"
                      style={S.input}
                      value={farrowForm.piglet_stage_id}
                      onChange={(e) => setFarrowForm({ ...farrowForm, piglet_stage_id: e.target.value })}
                      disabled={!farrowForm.piglet_item_id}
                    >
                      <option value="">The sow’s own stage</option>
                      {stages.map((st) => (
                        <option key={st.stage_id} value={st.stage_id}>{st.stage_name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
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
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2" style={S.primary}>
                <CheckCircle2 className="w-5 h-5" style={S.accent} /> {t("brpModalWeaningTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setShowWeanModal(false)}
                className="p-1 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer"
                aria-label={t("close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
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

              {selectedFarrow.piglet_batch_id && (
                <div className="rounded-[var(--radius-md)] border p-3 space-y-2" style={S.surface}>
                  <p className="text-xs font-semibold" style={S.primary}>
                    Piglet lot {selectedFarrow.piglet_lot_no}
                  </p>
                  <p className="text-[11px]" style={S.sub}>
                    Piglets of the lot not weaned are recorded as lost before weaning. Send the weaned piglets to a batch, or on to a stage, or leave them where they are and transfer them later.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={S.sub} htmlFor="wean-batch">Move to batch</label>
                      <select
                        id="wean-batch"
                        className="nf-input w-full text-sm"
                        style={S.input}
                        value={weanForm.move_to_batch_id}
                        onChange={(e) => setWeanForm({ ...weanForm, move_to_batch_id: e.target.value, move_to_stage_code: "" })}
                      >
                        <option value="">Stay in the lot’s batch</option>
                        {batches
                          .filter((b) => b.tracking_mode === "BATCH_WISE" && b.costing_method === "BIO_ASSET" && b.batch_id !== selectedFarrow.piglet_batch_id)
                          .map((b) => (
                            <option key={b.batch_id} value={b.batch_id}>{b.batch_no}</option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={S.sub} htmlFor="wean-stage">Or move the lot to stage</label>
                      <select
                        id="wean-stage"
                        className="nf-input w-full text-sm"
                        style={S.input}
                        value={weanForm.move_to_stage_code}
                        onChange={(e) => setWeanForm({ ...weanForm, move_to_stage_code: e.target.value, move_to_batch_id: "" })}
                      >
                        <option value="">No stage change</option>
                        {stages.map((st) => (
                          <option key={st.stage_id} value={st.stage_code}>{st.stage_name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-2">
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
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold flex items-center gap-2" style={S.primary}>
                <FlaskConical className="w-5 h-5" style={S.accent} /> {t("brpModalSemenTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setShowSemenModal(false)}
                className="p-1 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors cursor-pointer"
                aria-label={t("close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateSemen} className="space-y-3">
              {/* One or several boars, picked like any master: several pool their semen into one lot. */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={S.sub} htmlFor="semen-boars">{t("brpLabelBoarAnimal")}</label>
                <EntityLookupField
                  id="semen-boars"
                  label="Boars"
                  options={boars.map((b) => ({
                    animal_id: b.animal_id,
                    code: b.animal_code,
                    name: t("brpBoarOptionLabel", { code: b.animal_code, tag: b.rfid_tag || t("brpNa") }),
                  }))}
                  value={semenForm.boar_animal_ids}
                  valueKey="animal_id"
                  labelKeys={["code", "name"]}
                  onChange={(next) => setSemenForm({ ...semenForm, boar_animal_ids: Array.isArray(next) ? next : next ? [next] : [] })}
                  multiple
                  placeholder={t("brpSelectBoar")}
                />
                <p className="text-[11px] mt-1" style={S.muted}>
                  {semenForm.boar_animal_ids.length > 1
                    ? `One pooled lot from ${semenForm.boar_animal_ids.length} boars: the doses entered below are the whole mix, and the cost is what every one of them cost. The first boar chosen is the lot's main boar.`
                    : "Choose one boar, or several to mix their semen into one lot."}
                </p>
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

              <div>
                <label className="block text-xs font-semibold mb-1" style={S.sub} htmlFor="semen-item">Semen item</label>
                <select
                  id="semen-item"
                  className="nf-input w-full text-sm"
                  style={S.input}
                  value={semenForm.output_item_id}
                  onChange={(e) => setSemenForm({ ...semenForm, output_item_id: e.target.value })}
                >
                  <option value="">Record the collection only</option>
                  {semenItems.map((i) => (
                    <option key={i.item_id} value={i.item_id}>{i.item_name}</option>
                  ))}
                </select>
                <p className="text-[11px] mt-1" style={S.muted}>
                  Choosing an item posts the doses to the boar’s farm store as a lot of it, with a QR for the lot (boar, batch, lot number, collection date, doses and expiry).
                </p>
              </div>

              {/* Quality read at collection (G8): kept on the lot and printed on its QR. */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px]" style={S.muted} htmlFor="semen-volume">Volume (ml)</label>
                  <input id="semen-volume" type="number" min="0" step="0.1" className="nf-input w-full text-xs" style={S.input} value={semenForm.volume_ml} onChange={(e) => setSemenForm({ ...semenForm, volume_ml: e.target.value })} />
                </div>
                <div>
                  <label className="block text-[11px]" style={S.muted} htmlFor="semen-motility">Motility (%)</label>
                  <input id="semen-motility" type="number" min="0" max="100" step="0.1" className="nf-input w-full text-xs" style={S.input} value={semenForm.motility_pct} onChange={(e) => setSemenForm({ ...semenForm, motility_pct: e.target.value })} />
                </div>
                <div>
                  <label className="block text-[11px]" style={S.muted} htmlFor="semen-concentration">Concentration (M/ml)</label>
                  <input id="semen-concentration" type="number" min="0" step="1" className="nf-input w-full text-xs" style={S.input} value={semenForm.concentration_m_per_ml} onChange={(e) => setSemenForm({ ...semenForm, concentration_m_per_ml: e.target.value })} />
                </div>
              </div>

              <div className="p-3 rounded-[var(--radius-md)] border space-y-2" style={S.raised}>
                <div className="text-xs font-semibold" style={S.primary}>{t("brpLabelPeriodRunningCosts")}</div>
                <p className="text-[11px]" style={S.muted}>
                  Leave these empty to have them worked out from what was posted for the boar since his last collection: his own feed and medicine, his overheads and his share of his batch's, and his amortisation.
                </p>
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

              <div className="flex justify-end pt-2">
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? t("brpBtnCalculatingSaving") : t("brpBtnSaveCollectionBatch")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── ANIMAL DETAILS POPUP ── */}
      <AnimalDetailsModal animalId={detailsAnimalId} onClose={() => setDetailsAnimalId(null)} />
    </div>
  );
}
