"use client";

import { useState, useEffect, useRef } from "react";
import {
  HeartPulse,
  Skull,
  ShieldCheck,
  Plus,
  Stethoscope,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Field, ReadField } from "@/components/ui/field";
import { EntityLookupField } from "@/modules/master-data/EntityLookupField";
import { Button } from "@/components/ui/button";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatRow, StatCard } from "@/components/ui/stat-row";
import { api } from "@/services/api-client";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";

type MortalityRecord = {
  id: string;
  record_date: string;
  batch_no: string;
  ear_tag?: string;
  animal_id?: string;
  pen_location: string;
  head_count: number;
  cause_of_death: string;
  post_mortem_notes: string;
  disposal_method: string;
  recorded_by: string;
};

type TreatmentRecord = {
  id: string;
  treatment_date: string;
  ear_tag: string;
  animal_id?: string;
  batch_no: string;
  diagnosis: string;
  medicine_name: string;
  dosage: string;
  route: string;
  withdrawal_days: number | null;
  status: "ACTIVE" | "RECOVERED" | "UNDER_OBSERVATION";
  veterinarian: string;
};

type VaccinationItem = {
  id: string;
  vaccine_name: string;
  target_disease: string;
  scheduled_date: string;
  target_stage: string;
  coverage_pct: number;
  status: "COMPLETED" | "SCHEDULED" | "OVERDUE";
};

// Clinical detail now lives in batch_mortality_detail / batch_treatment_detail
// and arrives on the transaction as real fields. These parsers remain only for
// rows recorded before those tables existed, where the detail was formatted into
// `remarks` — new entries never take this path.
function parseMortalityRemarks(remarks?: string | null) {
  const text = (remarks || "").trim();
  const pm = text.match(/\[PM:\s*([^\]]*)\]/i)?.[1]?.trim() || "";
  const disposal = text.match(/\[DISPOSAL:\s*([^\]]*)\]/i)?.[1]?.trim() || "";
  const head = text.replace(/\[(PM|DISPOSAL):[^\]]*\]/gi, "").trim();
  const withPen = head.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  return {
    cause: (withPen ? withPen[1] : head) || "—",
    pen: withPen?.[2]?.trim() || "",
    postMortem: pm,
    disposal,
  };
}

function parseTreatmentRemarks(remarks?: string | null) {
  const text = (remarks || "").trim();
  const m = text.match(/^(.*?)\s+—\s+(.*?)\s*\(([^()]*)\)\s*$/);
  if (!m) return { medicine: "", diagnosis: text, dosage: "", route: "", vet: "", withdrawalDays: null as number | null };
  const parts = m[3].split(",").map((part) => part.trim());
  const vetPart = parts.find((part) => /^vet:/i.test(part));
  const withdrawalPart = parts.find((part) => /^withdrawal\b/i.test(part));
  const routePart = parts.find((part, i) => i > 0 && !/^(vet:|withdrawal\b)/i.test(part));
  return {
    medicine: m[1].trim(),
    diagnosis: m[2].trim(),
    dosage: parts[0] || "",
    route: routePart || "",
    vet: vetPart ? vetPart.replace(/^vet:\s*/i, "") : "",
    withdrawalDays: withdrawalPart ? Number(withdrawalPart.replace(/[^\d.]/g, "")) || null : null,
  };
}

// The dialog offers readable route labels; batch_treatment_detail stores the code.
const VALID_ROUTE_CODES = new Set([
  "IM", "IV", "SUBCUTANEOUS", "ORAL", "ORAL_IN_FEED", "ORAL_IN_WATER",
  "TOPICAL", "INTRAMAMMARY", "INTRAUTERINE",
]);

const ROUTE_TO_CODE: Record<string, string> = {
  "Intramuscular (IM)": "IM",
  "Intravenous (IV)": "IV",
  "Subcutaneous": "SUBCUTANEOUS",
  "Oral": "ORAL",
  "Oral (in feed)": "ORAL_IN_FEED",
  "Oral (in water)": "ORAL_IN_WATER",
  "Topical": "TOPICAL",
  "Intramammary": "INTRAMAMMARY",
  "Intrauterine": "INTRAUTERINE",
};

function daysBetween(fromIso: string, toIso: string) {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

export default function MortalityHealthPanel() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<"mortality" | "treatments" | "vaccines">("mortality");
  const [loading, setLoading] = useState(true);

  // ── Live Data State ──
  const [mortalityList, setMortalityList] = useState<MortalityRecord[]>([]);
  const [treatmentList, setTreatmentList] = useState<TreatmentRecord[]>([]);
  // Was a const empty array with no setter — the Vaccination Protocols tab was
  // hardcoded to show nothing. The plan lives on breed_lifecycle_stages
  // (vaccination_protocol / medication_protocol), keyed by breed and stage.
  const [vaccineList, setVaccineList] = useState<VaccinationItem[]>([]);
  const [batches, setBatches] = useState<{ id: string; no: string }[]>([]);
  // Denominator for the mortality rate, and the pen hygiene dates behind the
  // biosecurity card — both were fixed strings before.
  const [openingHead, setOpeningHead] = useState(0);
  const [pens, setPens] = useState<{ last_disinfected_date?: string | null }[]>([]);

  // ── Animal-scope filters/pickers ──
  const [mortalityAnimalFilter, setMortalityAnimalFilter] = useState("");
  const [treatmentAnimalFilter, setTreatmentAnimalFilter] = useState("");
  const [modalAnimals, setModalAnimals] = useState<{ animal_id: string; label: string }[]>([]);
  const [modalAnimalsLoading, setModalAnimalsLoading] = useState(false);
  const [mortalityAnimalIds, setMortalityAnimalIds] = useState<Set<string>>(new Set());
  const [treatmentAnimalIds, setTreatmentAnimalIds] = useState<Set<string>>(new Set());

  // ── Dialogs ──
  const [mortalityDialogOpen, setMortalityDialogOpen] = useState(false);
  const [newMortality, setNewMortality] = useState<Partial<MortalityRecord>>({
    record_date: new Date().toISOString().slice(0, 10),
    head_count: 1,
    cause_of_death: "Respiratory Distress / Pneumonia",
    disposal_method: "Incineration (Biosecure)",
    batch_no: "",
    pen_location: "Main Shed / Pen 1",
  });

  const [treatmentDialogOpen, setTreatmentDialogOpen] = useState(false);
  const [newTreatment, setNewTreatment] = useState<Partial<TreatmentRecord>>({
    treatment_date: new Date().toISOString().slice(0, 10),
    batch_no: "",
    status: "ACTIVE",

  });

  const [healthItems, setHealthItems] = useState<Record<string, unknown>[]>([]);
  const [healthItemsLoading, setHealthItemsLoading] = useState(false);
  const [treatmentItemId, setTreatmentItemId] = useState("");
  const [treatmentQuantity, setTreatmentQuantity] = useState("");
  const [treatmentLot, setTreatmentLot] = useState("");
  const [treatmentError, setTreatmentError] = useState("");
  const [savingTreatment, setSavingTreatment] = useState(false);
  const [uncertainTreatment, setUncertainTreatment] = useState(false);
  const selectedHealthItem = healthItems.find((item) => item.item_id === treatmentItemId);

  useEffect(() => {
    if (!treatmentDialogOpen) return;
    let cancelled = false;
    const load = async () => {
      setHealthItemsLoading(true);
      setTreatmentError("");
      try {
        const companyId = getActiveCompanyId();
        if (!companyId) throw new Error("Select a company before recording treatment.");
        const items: Record<string, unknown>[] = [];
        for (const itemType of ["MEDICINE", "VACCINE"]) {
          let offset = 0;
          while (true) {
            const res = await api.get(`/item?companyId=${companyId}&itemType=${itemType}&isActive=true&limit=100&offset=${offset}`);
            const rows = res?.data ?? [];
            items.push(...rows);
            offset += rows.length;
            if (!rows.length || offset >= Number(res.total ?? rows.length)) break;
          }
        }
        if (!cancelled) setHealthItems(items);
      } catch (error) {
        if (!cancelled) {
          setHealthItems([]);
          setTreatmentError(error instanceof Error ? error.message : "Could not load medicines and vaccines.");
        }
      } finally {
        if (!cancelled) setHealthItemsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [treatmentDialogOpen]);

  useEffect(() => {
    const companyId = getActiveCompanyId();
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // Vaccination plan for this company's breeds, flattened out of the
    // per-breed/per-stage protocol JSON.
    api.get(`/breed-lifecycle-stage?companyId=${companyId}&limit=200`)
      .then(async (res: any) => {
        const rows: any[] = Array.isArray(res) ? res : (res?.data?.data ?? res?.data ?? []);
        const [breeds, stages] = await Promise.all([
          api.get(`/breed?companyId=${companyId}&limit=200`).catch(() => []),
          api.get(`/stage?companyId=${companyId}&limit=200`).catch(() => []),
        ]);
        const breedName = new Map<string, string>(
          (Array.isArray(breeds) ? breeds : (breeds as any)?.data ?? []).map((b: any) => [b.breed_id, b.breed_name || b.breed_code]),
        );
        const stageName = new Map<string, string>(
          (Array.isArray(stages) ? stages : (stages as any)?.data ?? []).map((st: any) => [st.stage_id, st.stage_name || st.stage_code]),
        );
        const items: VaccinationItem[] = [];
        for (const row of rows) {
          const plan = row.vaccination_protocol;
          const entries = Array.isArray(plan) ? plan : [];
          for (const [i, e] of entries.entries()) {
            items.push({
              id: `${row.lifecycle_id}-${i}`,
              vaccine_name: e.vaccine ?? "—",
              target_disease: e.route ?? "—",
              scheduled_date: e.day != null ? `Day ${e.day}` : "—",
              target_stage: `${breedName.get(row.breed_id) ?? "—"} · ${stageName.get(row.stage_id) ?? "—"}`,
              coverage_pct: 100,
              status: "SCHEDULED",
            });
          }
        }
        setVaccineList(items);
      })
      .catch(() => setVaccineList([]));

    api.get(`/location/occupancy?companyId=${companyId}`)
      .then((res: any) => {
        const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        setPens(list);
      })
      .catch(() => setPens([]));

    api.get(`/batch?companyId=${companyId}&limit=50`)
      .then(async (res) => {
        const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        const bList = list.map((b: any) => ({ id: b.batch_id, no: b.batch_no }));
        setBatches(bList);
        setOpeningHead(list.reduce((sum: number, b: any) => sum + Number(b.opening_quantity || 0), 0));
        if (bList.length > 0) {
          setNewMortality((prev) => ({ ...prev, batch_no: bList[0].no }));
          setNewTreatment((prev) => ({ ...prev, batch_no: bList[0].no }));
        }

        // Aggregate mortality transactions from all active batches
        const mortalities: MortalityRecord[] = [];
        const treatments: TreatmentRecord[] = [];

        await Promise.all(
          list.slice(0, 10).map(async (b: any) => {
            try {
              const bDetails = await api.get(`/batch/${b.batch_id}`).catch(() => null);
              const txs: any[] = bDetails?.transactions || bDetails?.data?.transactions || [];
              txs.forEach((t: any) => {
                if (t.transaction_type === "MORTALITY") {
                  // Structured columns win; the remarks parse only covers rows
                  // written before batch_mortality_detail existed.
                  const legacy = parseMortalityRemarks(t.remarks);
                  mortalities.push({
                    id: t.transaction_id || `m-${Date.now()}`,
                    record_date: t.transaction_date || "",
                    batch_no: b.batch_no,
                    ear_tag: t.animal_ear_tag || t.animal_code || undefined,
                    animal_id: t.animal_id || undefined,
                    pen_location: t.pen_location_name || legacy.pen || "—",
                    head_count: Number(t.quantity || 1),
                    cause_of_death: t.cause_of_death || legacy.cause,
                    post_mortem_notes: t.post_mortem_notes || legacy.postMortem || "—",
                    disposal_method: t.disposal_method || legacy.disposal || "—",
                    recorded_by: t.created_by_name || "—",
                  });
                } else if (
                  t.transaction_type === "CONSUMPTION" &&
                  (t.route != null || t.withdrawal_days != null || t.diagnosis != null || t.veterinarian != null ||
                    t.uom === "ML" ||
                    t.uom === "DOSES" ||
                    (t.remarks && (
                      t.remarks.toLowerCase().includes("vaccine") ||
                      t.remarks.toLowerCase().includes("pcv2") ||
                      t.remarks.toLowerCase().includes("dewormer") ||
                      t.remarks.toLowerCase().includes("iron") ||
                      t.remarks.toLowerCase().includes("antibiotic") ||
                      t.remarks.toLowerCase().includes("dextran") ||
                      t.remarks.toLowerCase().includes("ivermectin")
                    )))
                ) {
                  const legacy = parseTreatmentRemarks(t.remarks);
                  const withdrawalDays = t.withdrawal_days ?? legacy.withdrawalDays;
                  const today = new Date().toISOString().slice(0, 10);
                  const elapsed = t.transaction_date ? daysBetween(t.transaction_date, today) : null;
                  // A case is only "active" while the recorded withdrawal period
                  // is still running — it used to be hardcoded ACTIVE forever.
                  const stillWithdrawing =
                    withdrawalDays != null && elapsed != null && elapsed < withdrawalDays;
                  treatments.push({
                    id: t.transaction_id || `t-${Date.now()}`,
                    treatment_date: t.transaction_date || "",
                    ear_tag: t.animal_ear_tag || t.animal_code || "Batch Herd Cohort",
                    animal_id: t.animal_id || undefined,
                    batch_no: b.batch_no,
                    diagnosis: t.diagnosis || legacy.diagnosis || t.remarks || "—",
                    medicine_name: t.item_name || t.item_code || legacy.medicine || "—",
                    dosage: legacy.dosage || (t.item_name && t.remarks?.startsWith(`${t.item_name} — `)
                      ? t.remarks.slice(`${t.item_name} — `.length)
                      : `${t.quantity} ${t.uom || ""}`.trim()),
                    route: t.route || legacy.route || "—",
                    withdrawal_days: withdrawalDays ?? null,
                    status: withdrawalDays == null ? "UNDER_OBSERVATION" : stillWithdrawing ? "ACTIVE" : "RECOVERED",
                    veterinarian: t.veterinarian || legacy.vet || "—",
                  });
                }
              });
            } catch {}
          })
        );

        setMortalityList(mortalities);
        setTreatmentList(treatments);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const animalLoadSequence = useRef(0);
  const loadModalAnimals = async (batchNo: string) => {
    const sequence = ++animalLoadSequence.current;
    setModalAnimals([]);
    const companyId = getActiveCompanyId();
    const batchObj = batches.find((b) => b.no === batchNo);
    if (!companyId || !batchObj) {
      setModalAnimals([]);
      return;
    }
    setModalAnimalsLoading(true);
    try {
      const res = await api.get(`/animal?companyId=${companyId}&currentBatchId=${batchObj.id}&limit=500`);
      const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
      if (sequence === animalLoadSequence.current) setModalAnimals(list.map((a) => ({ animal_id: a.animal_id, label: a.ear_tag || a.animal_code })));
    } catch {
      if (sequence === animalLoadSequence.current) setModalAnimals([]);
    } finally {
      if (sequence === animalLoadSequence.current) setModalAnimalsLoading(false);
    }
  };

  const toggleMortalityAnimal = (animalId: string) => {
    setMortalityAnimalIds((prev) => {
      const next = new Set(prev);
      if (next.has(animalId)) next.delete(animalId);
      else next.add(animalId);
      return next;
    });
  };

  const toggleTreatmentAnimal = (animalId: string) => {
    setTreatmentAnimalIds((prev) => {
      const next = new Set(prev);
      if (next.has(animalId)) next.delete(animalId);
      else next.add(animalId);
      return next;
    });
  };

  const handleSaveMortality = async () => {
    if (!newMortality.cause_of_death) return;
    const batchObj = batches.find((b) => b.no === newMortality.batch_no) || batches[0];
    const selectedAnimals = Array.from(mortalityAnimalIds);
    // When specific animals are selected, they ARE the mortality count (one
    // dead animal per row) — the manually entered head_count is only used
    // for a whole-batch (unattributed) entry.
    const qty = selectedAnimals.length > 0 ? selectedAnimals.length : Number(newMortality.head_count) || 1;

    // Cause, findings and disposal go to batch_mortality_detail as real fields;
    // `remarks` stays a plain note.
    const mortalityDetail = () => ({
      cause_of_death: newMortality.cause_of_death?.trim() || undefined,
      post_mortem_notes: newMortality.post_mortem_notes?.trim() || undefined,
      disposal_method: newMortality.disposal_method?.trim() || undefined,
    });
    const penNote = newMortality.pen_location?.trim();

    if (batchObj) {
      try {
        if (selectedAnimals.length > 0) {
          for (const animalId of selectedAnimals) {
            await api.post(`/batch/${batchObj.id}/transaction`, {
              transaction_date: newMortality.record_date || new Date().toISOString().slice(0, 10),
              transaction_type: "MORTALITY",
              quantity: 1,
              amount: 0,
              remarks: penNote ? `Recorded in ${penNote}` : null,
              mortality_detail: mortalityDetail(),
              animal_id: animalId,
            });
          }
        } else {
          await api.post(`/batch/${batchObj.id}/transaction`, {
            transaction_date: newMortality.record_date || new Date().toISOString().slice(0, 10),
            transaction_type: "MORTALITY",
            quantity: qty,
            amount: 0,
            remarks: penNote ? `Recorded in ${penNote}` : null,
            mortality_detail: mortalityDetail(),
          });
        }
      } catch {}
    }

    const earTagLabel = selectedAnimals.length > 0
      ? selectedAnimals.map((id) => modalAnimals.find((a) => a.animal_id === id)?.label || id).join(", ")
      : "Unidentified / Litter";

    const record: MortalityRecord = {
      id: `m-${Date.now()}`,
      record_date: newMortality.record_date || new Date().toISOString().slice(0, 10),
      batch_no: newMortality.batch_no || (batchObj?.no ?? "BATCH-01"),
      ear_tag: earTagLabel,
      animal_id: selectedAnimals.length === 1 ? selectedAnimals[0] : undefined,
      pen_location: newMortality.pen_location || "—",
      head_count: qty,
      cause_of_death: newMortality.cause_of_death || "—",
      post_mortem_notes: newMortality.post_mortem_notes || "—",
      disposal_method: newMortality.disposal_method || "—",
      recorded_by: "—",
    };
    setMortalityList([record, ...mortalityList]);
    setMortalityAnimalIds(new Set());
    setMortalityDialogOpen(false);
  };

  const handleSaveTreatment = async () => {
    if (savingTreatment || uncertainTreatment) return;
    setTreatmentError("");
    const selectedAnimals = Array.from(treatmentAnimalIds);
    const batchObj = batches.find((b) => b.no === newTreatment.batch_no);
    const quantity = Number(treatmentQuantity);
    if (!batchObj || !selectedAnimals.length || !selectedHealthItem || !selectedHealthItem.uom_primary || !newTreatment.treatment_date || !Number.isFinite(quantity) || quantity <= 0) {
      setTreatmentError("Select a batch, animals, medicine or vaccine, treatment date and a positive stock quantity per animal.");
      return;
    }
    const route = newTreatment.route || "";
    const treatmentDetail = {
      diagnosis: newTreatment.diagnosis?.trim() || undefined,
      route: ROUTE_TO_CODE[route] ?? (VALID_ROUTE_CODES.has(route) ? route : undefined),
      withdrawal_days: newTreatment.withdrawal_days,
      veterinarian: newTreatment.veterinarian?.trim() || undefined,
    };
    setSavingTreatment(true);
    let saved = 0;
    try {
      for (const animalId of selectedAnimals) {
        const result = await api.post(`/batch/${batchObj.id}/transaction`, {
          transaction_date: newTreatment.treatment_date,
          transaction_type: "CONSUMPTION",
          item_id: treatmentItemId,
          quantity,
          uom: selectedHealthItem.uom_primary,
          lot_no: treatmentLot.trim() || undefined,
          remarks: [selectedHealthItem.item_name, newTreatment.dosage?.trim()].filter(Boolean).join(" — "),
          treatment_detail: treatmentDetail,
          animal_id: animalId,
        });
        const transactionId = result?.posting_transaction_id ?? result?.data?.posting_transaction_id;
        if (!transactionId) {
          setUncertainTreatment(true);
          throw new Error("The server did not return a posting reference. Reload and check the register before retrying.");
        }
        saved++;
        setTreatmentAnimalIds((current) => {
          const remaining = new Set(current);
          remaining.delete(animalId);
          return remaining;
        });
        setTreatmentList((current) => [{
          id: transactionId,
          treatment_date: newTreatment.treatment_date!,
          ear_tag: modalAnimals.find((animal) => animal.animal_id === animalId)?.label || animalId,
          animal_id: animalId,
          batch_no: batchObj.no,
          diagnosis: treatmentDetail.diagnosis || "—",
          medicine_name: String(selectedHealthItem.item_name),
          dosage: newTreatment.dosage?.trim() || `${quantity} ${selectedHealthItem.uom_primary}`,
          route: treatmentDetail.route || "—",
          withdrawal_days: newTreatment.withdrawal_days ?? null,
          status: newTreatment.withdrawal_days == null ? "UNDER_OBSERVATION" : "ACTIVE",
          veterinarian: treatmentDetail.veterinarian || "—",
        }, ...current]);
      }
      setTreatmentDialogOpen(false);
    } catch (error) {
      setTreatmentError(`${saved ? `${saved} animal treatment(s) saved; only remaining animals are selected. ` : ""}${error instanceof Error ? error.message : "Treatment could not be saved."}`);
    } finally {
      setSavingTreatment(false);
    }
  };

  const totalMortalityHeads = mortalityList.reduce((acc, m) => acc + m.head_count, 0);
  const activeTreatmentsCount = treatmentList.filter((t) => t.status === "ACTIVE").length;

  // Every figure below used to be a constant in the markup.
  const MORTALITY_STANDARD_PCT = 2;
  const mortalityPct = openingHead > 0 ? (totalMortalityHeads / openingHead) * 100 : 0;
  const mortalityWithinStandard = mortalityPct <= MORTALITY_STANDARD_PCT;
  const protocolStepCount = vaccineList.length;
  const BIOSECURITY_WINDOW_DAYS = 30;
  const todayIso = new Date().toISOString().slice(0, 10);
  const pensDisinfected = pens.filter((pen) => {
    if (!pen.last_disinfected_date) return false;
    const age = daysBetween(pen.last_disinfected_date, todayIso);
    return age != null && age <= BIOSECURITY_WINDOW_DAYS;
  }).length;
  const biosecurityPct = pens.length > 0 ? Math.round((pensDisinfected / pens.length) * 100) : 0;

  const mortalityAnimalOptions = Array.from(
    new Map(mortalityList.filter((m) => m.animal_id).map((m) => [m.animal_id as string, m.ear_tag || (m.animal_id as string)])).entries()
  );
  const treatmentAnimalOptions = Array.from(
    new Map(treatmentList.filter((t) => t.animal_id).map((t) => [t.animal_id as string, t.ear_tag])).entries()
  );
  const filteredMortalityList = mortalityAnimalFilter ? mortalityList.filter((m) => m.animal_id === mortalityAnimalFilter) : mortalityList;
  const filteredTreatmentList = treatmentAnimalFilter ? treatmentList.filter((t) => t.animal_id === treatmentAnimalFilter) : treatmentList;

  if (loading) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <p className="text-sm font-medium text-[var(--text-muted)]">{t("mhLoadingRegisters")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-[var(--text-primary)]">
      {/* ── Top Header and Summary Metrics ── */}
      <StatRow>
        <StatCard
          icon={Skull}
          label={t("mhCumulativeMortality")}
          value={totalMortalityHeads}
          unit={t("mhHeadPercent", { pct: mortalityPct.toFixed(2) })}
          sub={
            <span className={mortalityWithinStandard ? "text-(--success)" : "text-(--danger)"}>
              {mortalityWithinStandard
                ? t("mhBelowStandardThreshold", { std: MORTALITY_STANDARD_PCT.toFixed(1) })
                : t("mhAboveStandardThreshold", { std: MORTALITY_STANDARD_PCT.toFixed(1) })}
            </span>
          }
        />
        <StatCard
          icon={HeartPulse}
          label={t("mhActiveClinicalCases")}
          value={activeTreatmentsCount}
          unit={t("mhInIsolation")}
          sub={t("mhUnderActiveVeterinaryWithdrawal")}
        />
        <StatCard
          icon={ShieldCheck}
          label={t("mhVaccinationProtocols")}
          value={protocolStepCount}
          sub={t("mhProtocolStepsConfigured", { count: protocolStepCount })}
        />
        <StatCard
          icon={Stethoscope}
          label={t("mhBiosecurityStandard")}
          value={`${biosecurityPct}%`}
          sub={t("mhPensDisinfectedRecently", { done: pensDisinfected, total: pens.length, days: BIOSECURITY_WINDOW_DAYS })}
        />
      </StatRow>

      {/* ── Sub-Navigation & Actions ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-1" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center gap-1 text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveTab("mortality")}
            className={`nf-press flex items-center gap-1.5 px-3.5 py-2.5 border-b-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === "mortality"
                ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Skull className="h-3.5 w-3.5" />
            <span>{t("mhMortalityPostMortemRegister")}</span>
          </button>
          <button
            onClick={() => setActiveTab("treatments")}
            className={`nf-press flex items-center gap-1.5 px-3.5 py-2.5 border-b-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === "treatments"
                ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Stethoscope className="h-3.5 w-3.5" />
            <span>{t("mhVeterinaryTreatmentsCare")}</span>
          </button>
          <button
            onClick={() => setActiveTab("vaccines")}
            className={`nf-press flex items-center gap-1.5 px-3.5 py-2.5 border-b-2 font-medium transition-colors whitespace-nowrap ${
              activeTab === "vaccines"
                ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{t("mhVaccinationProtocols")}</span>
          </button>
        </div>

        <div className="pb-1">
          {activeTab === "mortality" && (
            <button
              onClick={() => { setMortalityAnimalIds(new Set()); loadModalAnimals(newMortality.batch_no || batches[0]?.no || ""); setMortalityDialogOpen(true); }}
              className="nf-press flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--accent)" }}
            >
              <Plus className="h-4 w-4" /> {t("mhLogMortalityRecord")}
            </button>
          )}
          {activeTab === "treatments" && (
            <button
              onClick={() => { setTreatmentAnimalIds(new Set()); loadModalAnimals(newTreatment.batch_no || batches[0]?.no || ""); setTreatmentDialogOpen(true); }}
              className="nf-press flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3.5 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--accent)" }}
            >
              <Plus className="h-4 w-4" /> {t("mhRecordTreatment")}
            </button>
          )}
        </div>
      </div>

      {/* ── TAB 1: MORTALITY REGISTER ── */}
      {activeTab === "mortality" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{t("mhHistoricalPostMortemLog")}</span>
            <div className="flex items-center gap-3">
              {mortalityAnimalOptions.length > 0 && (
                <select
                  value={mortalityAnimalFilter}
                  onChange={(e) => setMortalityAnimalFilter(e.target.value)}
                  className="nf-input h-7 text-[11px]"
                >
                  <option value="">{t("bulkScopeWholeBatch")}</option>
                  {mortalityAnimalOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              )}
              <span>{t("mhTotalDeathsLogged", { count: filteredMortalityList.length })}</span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-left text-xs border-collapse">
              <TableHeader>
                <TableRow className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhDate")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhBatchPen")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhEarTagId")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold text-center">{t("mhHeadCount")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhCauseOfDeath")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhPostMortemFindings")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhDisposalMethod")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhRecordedBy")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMortalityList.map((m) => (
                  <TableRow key={m.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)] transition-colors">
                    <TableCell className="py-2.5 px-3 font-mono">{m.record_date}</TableCell>
                    <TableCell className="py-2.5 px-3 font-semibold text-[var(--text-primary)]">
                      {m.batch_no}
                      <span className="block text-[10px] font-normal text-[var(--text-secondary)]">{m.pen_location}</span>
                    </TableCell>
                    <TableCell className="py-2.5 px-3 font-mono">{m.ear_tag || "—"}</TableCell>
                    <TableCell className="py-2.5 px-3 text-center font-bold text-[var(--danger)]">{m.head_count}</TableCell>
                    <TableCell className="py-2.5 px-3 font-medium text-[var(--text-primary)]">{m.cause_of_death}</TableCell>
                    <TableCell className="py-2.5 px-3 text-[var(--text-secondary)] max-w-xs truncate" title={m.post_mortem_notes}>
                      {m.post_mortem_notes}
                    </TableCell>
                    <TableCell className="py-2.5 px-3">
                      <span
                        className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold border"
                        style={{
                          backgroundColor: "var(--success-muted)",
                          color: "var(--success)",
                          borderColor: "rgba(47, 125, 91, 0.2)",
                        }}
                      >
                        {m.disposal_method}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5 px-3 text-[var(--text-secondary)]">{m.recorded_by}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 2: VETERINARY TREATMENTS ── */}
      {activeTab === "treatments" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{t("mhPrescriptionVeterinaryInterventionsLog")}</span>
            <div className="flex items-center gap-3">
              {treatmentAnimalOptions.length > 0 && (
                <select
                  value={treatmentAnimalFilter}
                  onChange={(e) => setTreatmentAnimalFilter(e.target.value)}
                  className="nf-input h-7 text-[11px]"
                >
                  <option value="">{t("bulkScopeWholeBatch")}</option>
                  {treatmentAnimalOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              )}
              <span>{t("mhActiveCases", { count: activeTreatmentsCount })}</span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full text-left text-xs border-collapse">
              <TableHeader>
                <TableRow className="border-b border-[var(--border)] bg-[var(--surface-raised)]">
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhTreatmentDate")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhEarTag")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhDiagnosis")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhPrescriptionDose")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhRoute")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold text-center">{t("mhWithdrawalDays")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhStatus")}</TableHead>
                  <TableHead className="py-2.5 px-3 font-semibold">{t("mhAttendingVet")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTreatmentList.map((tr) => (
                  <TableRow key={tr.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-raised)] transition-colors">
                    <TableCell className="py-2.5 px-3 font-mono">{tr.treatment_date}</TableCell>
                    <TableCell className="py-2.5 px-3 font-mono font-bold text-[var(--accent)]">{tr.ear_tag}</TableCell>
                    <TableCell className="py-2.5 px-3 font-medium text-[var(--text-primary)]">{tr.diagnosis}</TableCell>
                    <TableCell className="py-2.5 px-3">
                      <span className="font-semibold text-[var(--text-primary)]">{tr.medicine_name}</span>
                      <span className="block text-[10px] text-[var(--text-secondary)]">{tr.dosage}</span>
                    </TableCell>
                    <TableCell className="py-2.5 px-3 text-[var(--text-secondary)]">{tr.route}</TableCell>
                    <TableCell className="py-2.5 px-3 text-center font-semibold" style={{ color: "var(--warning)" }}>{tr.withdrawal_days == null ? "Not recorded" : t("mhDaysValue", { count: tr.withdrawal_days })}</TableCell>
                    <TableCell className="py-2.5 px-3">
                      <span
                        className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold border"
                        style={{
                          backgroundColor: tr.status === "ACTIVE" ? "var(--warning-muted)" : "var(--success-muted)",
                          color: tr.status === "ACTIVE" ? "var(--warning)" : "var(--success)",
                          borderColor: tr.status === "ACTIVE" ? "rgba(183, 121, 31, 0.2)" : "rgba(47, 125, 91, 0.2)",
                        }}
                      >
                        {tr.status === "UNDER_OBSERVATION" ? "Withdrawal not recorded" : tr.status === "ACTIVE" ? t("mhUnderTreatment") : t("mhRecovered")}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5 px-3 text-[var(--text-secondary)]">{tr.veterinarian}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 3: VACCINATIONS ── */}
      {activeTab === "vaccines" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{t("mhHerdImmunizationDewormingSchedule")}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {vaccineList.map((v) => (
              <div key={v.id} className="rounded-[var(--radius-md)] border p-4 bg-[var(--surface)] space-y-2.5" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-[var(--text-primary)]">{v.vaccine_name}</span>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-[var(--radius-pill)] border"
                    style={{
                      backgroundColor: v.status === "COMPLETED" ? "var(--success-muted)" : "var(--accent-muted)",
                      color: v.status === "COMPLETED" ? "var(--success)" : "var(--accent)",
                      borderColor: v.status === "COMPLETED" ? "rgba(47, 125, 91, 0.2)" : "rgba(194, 67, 50, 0.2)",
                    }}
                  >
                    {v.status}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)]">{t("mhTargetLabel", { target: v.target_disease })}</p>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between text-[11px] text-[var(--text-secondary)]">
                    <span>{t("mhTargetStage")}</span>
                    <span className="font-medium text-[var(--text-primary)]">{v.target_stage}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-[var(--text-secondary)]">
                    <span>{t("mhDueDate")}</span>
                    <span className="font-mono text-[var(--text-primary)]">{v.scheduled_date}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-[var(--text-secondary)]">
                    <span>{t("mhHerdCoverage")}</span>
                    <span className="font-bold text-[var(--accent)]">{v.coverage_pct}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MODAL: LOG MORTALITY ── */}
      <Dialog
        open={mortalityDialogOpen}
        onClose={() => setMortalityDialogOpen(false)}
        title={t("mhLogMortalityPostMortemEvent")}
        maxWidth="md"
      >
        <div className="space-y-4 text-xs pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">{t("mhDateOfDeath")}</label>
              <input
                type="date"
                value={newMortality.record_date}
                onChange={(e) => setNewMortality({ ...newMortality, record_date: e.target.value })}
                className="nf-input w-full"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">{t("mhHeadCount")}</label>
              <input
                type="number"
                min="1"
                value={newMortality.head_count}
                onChange={(e) => setNewMortality({ ...newMortality, head_count: Number(e.target.value) })}
                className="nf-input w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold block mb-1">{t("mhBatchBarnLocation")}</label>
              <input
                type="text"
                value={newMortality.pen_location}
                onChange={(e) => setNewMortality({ ...newMortality, pen_location: e.target.value })}
                placeholder={t("mhGestationBarn1Placeholder")}
                className="nf-input w-full"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">{t("mhBatchPen")}</label>
              <select
                value={newMortality.batch_no}
                onChange={(e) => { setNewMortality({ ...newMortality, batch_no: e.target.value }); setMortalityAnimalIds(new Set()); loadModalAnimals(e.target.value); }}
                className="nf-input w-full"
              >
                {batches.map((b) => <option key={b.id} value={b.no}>{b.no}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="font-semibold block mb-1">{t("mhEarTagIdOptional")}</label>
            {modalAnimalsLoading ? (
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("bulkScopeLoading")}</p>
            ) : modalAnimals.length === 0 ? (
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("bulkScopeNoAnimals")}</p>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border)" }}>
                {modalAnimals.map((a) => (
                  <label key={a.animal_id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <input type="checkbox" checked={mortalityAnimalIds.has(a.animal_id)} onChange={() => toggleMortalityAnimal(a.animal_id)} className="h-3.5 w-3.5 rounded-[var(--radius-xs)] accent-(--accent)" />
                    <span className="font-mono font-semibold" style={{ color: "var(--accent)" }}>{a.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="font-semibold block mb-1">{t("mhPrimaryCauseOfDeath")}</label>
            <select
              value={newMortality.cause_of_death}
              onChange={(e) => setNewMortality({ ...newMortality, cause_of_death: e.target.value })}
              className="nf-input w-full"
            >
              <option value="Respiratory Distress / Pneumonia">{t("mhCauseRespiratoryDistress")}</option>
              <option value="Overlay / Crushing">{t("mhCauseOverlayCrushing")}</option>
              <option value="Gastric Ulcer / Hemorrhage">{t("mhCauseGastricUlcer")}</option>
              <option value="Colibacillosis / Enteritis">{t("mhCauseColibacillosis")}</option>
              <option value="Uterine / Rectal Prolapse">{t("mhCauseUterineProlapse")}</option>
              <option value="Sudden Heart Failure / Stress">{t("mhCauseSuddenHeartFailure")}</option>
              <option value="Other Non-Infectious">{t("mhCauseOtherNonInfectious")}</option>
            </select>
          </div>

          <div>
            <label className="font-semibold block mb-1">{t("mhPostMortemExaminationNotes")}</label>
            <textarea
              rows={2}
              value={newMortality.post_mortem_notes}
              onChange={(e) => setNewMortality({ ...newMortality, post_mortem_notes: e.target.value })}
              placeholder={t("mhPostMortemNotesPlaceholder")}
              className="nf-input w-full"
            />
          </div>

          <div>
            <label className="font-semibold block mb-1">{t("mhBiosecureDisposalMethod")}</label>
            <select
              value={newMortality.disposal_method}
              onChange={(e) => setNewMortality({ ...newMortality, disposal_method: e.target.value })}
              className="nf-input w-full"
            >
              <option value="Incineration (Biosecure)">{t("mhDisposalIncineration")}</option>
              <option value="Deep Burial with Lime">{t("mhDisposalDeepBurial")}</option>
              <option value="Certified Carcass Rendering">{t("mhDisposalCertifiedRendering")}</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <Button variant="outline" onClick={() => setMortalityDialogOpen(false)}>
              {t("mhCancel")}
            </Button>
            <Button onClick={handleSaveMortality} className="nf-btn-primary">
              {t("mhSaveMortalityEntry")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* ── MODAL: RECORD TREATMENT ── */}
      <Dialog
        open={treatmentDialogOpen}
        onClose={() => { if (!savingTreatment) setTreatmentDialogOpen(false); }}
        title={t("mhRecordVeterinaryTreatment")}
        maxWidth="md"
      >
        <fieldset disabled={savingTreatment} className="space-y-4 text-xs pt-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("mhTreatmentDate")} htmlFor="treatment-date" required>
              <input
                id="treatment-date" type="date"
                value={newTreatment.treatment_date}
                onChange={(e) => setNewTreatment({ ...newTreatment, treatment_date: e.target.value })}
                className="nf-input w-full"
              />
            </Field>
            <Field label={t("mhBatchPen")} htmlFor="treatment-batch" required>
              <select id="treatment-batch"
                value={newTreatment.batch_no}
                onChange={(e) => { setNewTreatment({ ...newTreatment, batch_no: e.target.value }); setTreatmentAnimalIds(new Set()); loadModalAnimals(e.target.value); }}
                className="nf-input w-full"
              >
                {batches.map((b) => <option key={b.id} value={b.no}>{b.no}</option>)}
              </select>
            </Field>
          </div>

          <div>
            <label className="font-semibold block mb-1">{t("mhAnimalEarTagId")}</label>
            {modalAnimalsLoading ? (
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("bulkScopeLoading")}</p>
            ) : modalAnimals.length === 0 ? (
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{t("bulkScopeNoAnimals")}</p>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--border)" }}>
                {modalAnimals.map((a) => (
                  <label key={a.animal_id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <input type="checkbox" checked={treatmentAnimalIds.has(a.animal_id)} onChange={() => toggleTreatmentAnimal(a.animal_id)} className="h-3.5 w-3.5 rounded-[var(--radius-xs)] accent-(--accent)" />
                    <span className="font-mono font-semibold" style={{ color: "var(--accent)" }}>{a.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <Field label={t("mhClinicalDiagnosis")} htmlFor="treatment-diagnosis">
            <input id="treatment-diagnosis" value={newTreatment.diagnosis ?? ""} onChange={(e) => setNewTreatment({ ...newTreatment, diagnosis: e.target.value })} className="nf-input w-full" />
          </Field>
          <Field label={t("mhMedicineVaccineAdministered")} htmlFor="treatment-item" required>
            <EntityLookupField id="treatment-item" label={t("mhMedicineVaccineAdministered")} options={healthItems} value={treatmentItemId} valueKey="item_id" labelKeys={["item_code", "item_name"]} onChange={(value) => setTreatmentItemId(String(value))} loading={healthItemsLoading} placeholder="Select medicine or vaccine" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stock quantity per animal" htmlFor="treatment-quantity" required hint="Enter stock issued for each selected animal, in the item's stock unit.">
              <input id="treatment-quantity" type="number" min="0" step="any" value={treatmentQuantity} onChange={(e) => setTreatmentQuantity(e.target.value)} className="nf-input w-full" />
            </Field>
            <ReadField label="Stock unit" value={selectedHealthItem?.uom_primary as string | undefined} />
            <Field label="Lot number" htmlFor="treatment-lot" hint="Leave blank to use the oldest available stock.">
              <input id="treatment-lot" value={treatmentLot} onChange={(e) => setTreatmentLot(e.target.value)} className="nf-input w-full" />
            </Field>
            <Field label="Dosage notes" htmlFor="treatment-dosage">
              <input id="treatment-dosage" value={newTreatment.dosage ?? ""} onChange={(e) => setNewTreatment({ ...newTreatment, dosage: e.target.value })} className="nf-input w-full" />
            </Field>
            <Field label="Route" htmlFor="treatment-route">
              <select id="treatment-route" value={newTreatment.route ?? ""} onChange={(e) => setNewTreatment({ ...newTreatment, route: e.target.value })} className="nf-input w-full">
                <option value="">Not recorded</option>
                {Object.entries(ROUTE_TO_CODE).map(([label, code]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </Field>
            <Field label={t("mhMeatWithdrawalPeriodDays")} htmlFor="treatment-withdrawal">
              <input id="treatment-withdrawal" type="number" min="0" value={newTreatment.withdrawal_days ?? ""} onChange={(e) => setNewTreatment({ ...newTreatment, withdrawal_days: e.target.value === "" ? undefined : Number(e.target.value) })} className="nf-input w-full" />
            </Field>
            <Field label={t("mhAttendingVeterinarian")} htmlFor="treatment-vet">
              <input id="treatment-vet" value={newTreatment.veterinarian ?? ""} onChange={(e) => setNewTreatment({ ...newTreatment, veterinarian: e.target.value })} className="nf-input w-full" />
            </Field>
          </div>
          {treatmentError && <p role="alert" className="text-sm text-(--danger)">{treatmentError}</p>}

          <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
            <Button variant="outline" disabled={savingTreatment} onClick={() => setTreatmentDialogOpen(false)}>
              {t("mhCancel")}
            </Button>
            <Button onClick={handleSaveTreatment} disabled={savingTreatment || healthItemsLoading || uncertainTreatment} className="nf-btn-primary">
              {t("mhSaveTreatmentRecord")}
            </Button>
          </div>
        </fieldset>
      </Dialog>
    </div>
  );
}
