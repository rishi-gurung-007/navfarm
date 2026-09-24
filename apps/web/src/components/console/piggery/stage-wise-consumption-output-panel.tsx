"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  RotateCcw,
  Download,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Wheat,
  Pill,
  DollarSign,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useLanguage } from "@/hooks/useLanguage";

import { api } from "@/services/api-client";
import { stageWindows } from "./build-lifecycle-stages";
import { apportionToAnimal } from "./apportion-to-animal";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { AnimalMultiSelect, splitEvenly, type AnimalOption } from "../production/animal-multi-select";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

interface BatchProfile {
  id: string;
  code: string;
  name: string;
  breed: string;
  batchType: string;
  startCount: number;
  stages: StageProfile[];
}

interface StageProfile {
  id: string;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  standardDays: number;
  startAnimals: number;
  endAnimals: number;
  mortality: number;
  avgAgeDays: number;
  feedData: {
    item: string;
    uom: string;
    opening: number;
    issued: number;
    consumed: number;
    wastage: number;
    rate: number;
  }[];
  medData: {
    item: string;
    uom: string;
    issued: number;
    consumed: number;
    wastage: number;
    cost: number;
  }[];
  labourData: {
    resource: string;
    date: string;
    hours: number;
    rate: number;
    cost: number;
    remarks: string;
  }[];
  overheadData: {
    item: string;
    basis: string;
    rate: number;
    qty: number;
    cost: number;
  }[];
  mortalityLogs: {
    date: string;
    count: number;
    reason: string;
    pen: string;
    vetAction: string;
  }[];
  weightLogs: {
    date: string;
    avgWeightKg: number;
    remarks: string;
  }[];
  observationLogs: {
    date: string;
    type: string;
    value: string;
    notes: string;
  }[];
  // Real stage/pen movements from batch_stage_log. The previous shape carried
  // headCount / avgWeightKg / wipValue, none of which that table records — the
  // array was hardcoded empty, so the columns never had a source.
  transferLogs: {
    date: string;
    fromStage: string;
    toStage: string;
    remarks: string;
  }[];
  attachments: {
    date: string;
    fileName: string;
    fileType: string;
    url: string;
  }[];
  outputHead: number;
}

const TAB_KEYS = ["feed", "medicine", "labour", "overheads", "mortality", "weight", "observations", "transfers", "attachments", "summary"] as const;
type TabKey = (typeof TAB_KEYS)[number];

// Aggregates a batch's raw transactions into a StageProfile. Pure w.r.t. its
// inputs — called once unfiltered at fetch time to build the default view,
// and again (with `txs` pre-filtered to one animal_id) to derive the
// per-animal view, so per-animal filtering needs no backend round-trip.
/**
 * One profile per stage the batch actually occupied.
 *
 * The panel previously wrapped a single whole-life profile in an array, so its
 * Stage filter offered exactly one option even for a batch that had moved
 * through several — the screen disagreed with the lifecycle stepper beside it.
 * Transactions are partitioned by the stage's date window, so each stage
 * reports only its own feed, medication, mortality and output.
 */
function buildStageProfiles(b: any, txs: any[], stageLog: any[] = [], attachments: any[] = []): StageProfile[] {
  const windows = stageWindows({
    stageLog: (stageLog || []).map((l: any) => ({
      from_stage_code: l.from_stage_code ?? null,
      to_stage_code: l.to_stage_code,
      transferred_at: String(l.transferred_at || ''),
    })),
    batchStartDate: String(b.start_date || '').slice(0, 10),
    currentStageCode: b.current_stage_code ?? null,
    batchEndDate: b.actual_end_date ? String(b.actual_end_date).slice(0, 10) : null,
  });

  if (windows.length <= 1) return [buildStageProfile(b, txs, stageLog, attachments)];

  return windows.map((w, i) => {
    const inWindow = (txs || []).filter((t: any) => {
      const d = String(t.transaction_date || '').slice(0, 10);
      return d >= w.from && d <= w.to;
    });
    const profile = buildStageProfile(
      { ...b, current_stage_code: w.code, start_date: w.from, expected_end_date: w.to },
      inWindow,
      stageLog,
      attachments,
    );
    return { ...profile, id: `st-${b.batch_id}-${i}` };
  });
}

function buildStageProfile(b: any, txs: any[], stageLog: any[] = [], attachments: any[] = []): StageProfile {
  // Helper to detect medicine transactions vs feed
  const isMedicine = (t: any) => {
    if (t.item_type === "MEDICINE" || t.item_category_code === "MEDICINE") return true;
    const uom = (t.uom || "").toUpperCase();
    if (["ML", "DOSES", "VIAL", "BOTTLE", "TAB", "AMPOULE", "SYRINGE", "MG"].includes(uom)) return true;
    const text = `${t.item_name || ""} ${t.item_code || ""} ${t.remarks || ""}`.toLowerCase();
    return (
      text.includes("med") ||
      text.includes("vaccin") ||
      text.includes("deworm") ||
      text.includes("iron") ||
      text.includes("antibiotic") ||
      text.includes("dextran") ||
      text.includes("ivermectin") ||
      text.includes("vitamin") ||
      text.includes("electrolyt") ||
      text.includes("inject") ||
      text.includes("dose") ||
      text.includes("treatment") ||
      text.includes("clinical") ||
      text.includes("parvovirus") ||
      text.includes("circovirus") ||
      text.includes("amoxicillin") ||
      text.includes("oxytetracycline")
    );
  };

  const feedTxs = txs.filter((t: any) => t.transaction_type === "CONSUMPTION" && !isMedicine(t));
  const medTxs = txs.filter((t: any) => t.transaction_type === "CONSUMPTION" && isMedicine(t));
  const overheadTxs = txs.filter((t: any) => t.transaction_type === "OVERHEAD");
  const mortalityTxs = txs.filter((t: any) => t.transaction_type === "MORTALITY");

  // Aggregate feed consumption by formula / item name
  const feedMap = new Map<string, {
    item: string;
    uom: string;
    opening: number;
    issued: number;
    consumed: number;
    wastage: number;
    rate: number;
  }>();

  feedTxs.forEach((t: any) => {
    // Key by remarks first (which holds the exact user input from Batch Data Entry), then item_name
    const itemName = t.remarks || t.item_name || t.item_code || "Standard Feed Ration";
    const qty = Number(t.quantity || 0);
    const rate = Number(t.rate || 35.0);
    const uom = t.uom || "KG";

    if (feedMap.has(itemName)) {
      const existing = feedMap.get(itemName)!;
      existing.issued += qty;
      existing.consumed += qty;
    } else {
      feedMap.set(itemName, {
        item: itemName,
        uom,
        opening: 0,
        issued: qty,
        consumed: qty,
        wastage: 0,
        rate,
      });
    }
  });

  const feedData = Array.from(feedMap.values());

  // Map medical and vaccine consumption
  const medMap = new Map<string, {
    item: string;
    uom: string;
    issued: number;
    consumed: number;
    wastage: number;
    cost: number;
  }>();

  medTxs.forEach((t: any) => {
    // Key by remarks first (which holds the exact user input from Batch Data Entry), then item_name
    const itemName = t.remarks || t.item_name || t.item_code || "Clinical Medication";
    const qty = Number(t.quantity || 0);
    const rate = Number(t.rate || 20.0);
    // amount is stored negative in DB — always use Math.abs with null-coalescing
    const cost = Math.abs(Number(t.amount ?? (qty * rate)));
    const uom = t.uom || "ML";

    if (medMap.has(itemName)) {
      const existing = medMap.get(itemName)!;
      existing.issued += qty;
      existing.consumed += qty;
      existing.cost += cost;
    } else {
      medMap.set(itemName, {
        item: itemName,
        uom,
        issued: qty,
        consumed: qty,
        wastage: 0,
        cost,
      });
    }
  });

  const medData = Array.from(medMap.values());

  const labourTxs = overheadTxs.filter((t: any) =>
    (t.remarks || "").toLowerCase().includes("labour") || t.uom === "HRS"
  );
  const generalOverheadTxs = overheadTxs.filter((t: any) =>
    !((t.remarks || "").toLowerCase().includes("labour") || t.uom === "HRS")
  );

  const labourData = labourTxs.map((t: any) => {
    const qty = Number(t.quantity ?? 1);
    const rate = Number(t.rate ?? 0);
    const cost = Math.abs(Number(t.amount ?? (qty * rate)));
    return {
      resource: t.remarks || "Farm Operations Labour",
      date: t.transaction_date || "",
      hours: qty,
      rate,
      cost,
      remarks: t.remarks || "Daily Farm Operations",
    };
  });

  const overheadData = generalOverheadTxs.map((t: any) => {
    const qty = Number(t.quantity ?? 1);
    const rate = Number(t.rate ?? 0);
    // amount is stored as negative in DB — use null-coalescing (not ||) to handle negatives
    const cost = Math.abs(Number(t.amount ?? (qty * rate)));
    return {
      item: t.remarks || "Operational Overhead",
      basis: t.uom || "Units",
      rate,
      qty,
      cost,
    };
  });

  const mortalityLogs = mortalityTxs.map((t: any) => ({
    date: t.transaction_date || "",
    count: Number(t.quantity || 1),
    reason: t.remarks || "Mortality Recorded",
    pen: "Main Shed",
    vetAction: "Recorded in clinical register",
  }));

  const weightTxs = txs.filter((t: any) =>
    t.transaction_type === "WEIGHT_ENTRY" ||
    (t.transaction_type === "OBSERVATION" &&
      ((t.remarks || "").toLowerCase().includes("weight") || t.uom === "KG"))
  );
  const weightLogs = weightTxs.map((t: any) => ({
    date: t.transaction_date || "",
    avgWeightKg: Number(t.quantity || 0),
    remarks: t.remarks || "Body Weight Sampling Recorded",
  }));

  const obsTxs = txs.filter((t: any) =>
    t.transaction_type === "OBSERVATION" &&
    !((t.remarks || "").toLowerCase().includes("weight") && t.uom === "KG")
  );
  const observationLogs = obsTxs.map((t: any) => ({
    date: t.transaction_date || "",
    type: t.uom === "°C" ? "Temperature" : t.uom === "L" ? "Water Intake" : t.uom === "%" ? "Humidity" : "Daily Observation",
    value: `${t.quantity ?? ""} ${t.uom || ""}`.trim(),
    notes: t.remarks || "Observation Logged",
  }));

  const opening = Number(b.opening_quantity) || 20;
  const recordedMortality = mortalityLogs.reduce((sum: number, m: any) => sum + m.count, 0);
  // Number() never returns null/undefined, so `??` never reached the fallback —
  // an open batch (closing_quantity NULL) reported a closing count of 0.
  const closing = b.closing_quantity != null ? Number(b.closing_quantity) : opening - recordedMortality;
  const totalMortality = Math.max(0, opening - closing);

  return {
    id: `st-${b.batch_id}`,
    code: b.current_stage_code || "ACTIVE",
    name: `${(b.current_stage_code || "Production").replace(/_/g, " ")} Stage`,
    startDate: b.start_date || new Date().toISOString().slice(0, 10),
    endDate: b.expected_end_date || new Date().toISOString().slice(0, 10),
    standardDays: 60,
    startAnimals: opening,
    endAnimals: closing,
    mortality: totalMortality,
    avgAgeDays: 45,
    feedData,
    medData,
    labourData,
    overheadData,
    mortalityLogs,
    weightLogs,
    observationLogs,
    transferLogs: (stageLog || []).map((l: any) => ({
      date: (l.transferred_at || "").toString().slice(0, 10),
      fromStage: l.from_stage_code || "—",
      toStage: l.to_stage_code || "—",
      remarks: l.remarks || "",
    })),
    attachments: (attachments || []).map((a: any) => ({
      date: (a.uploaded_at || a.created_at || "").toString().slice(0, 10),
      fileName: a.file_name || a.original_name || "Attachment",
      fileType: a.file_type || a.mime_type || "",
      url: a.file_url || a.file_path || "",
    })),
    outputHead: closing,
  };
}

export default function StageWiseConsumptionOutputPanel() {
  const { formatMoney } = useCompanyCurrency();
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [batches, setBatches] = useState<BatchProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");

  const currentBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) || batches[0] || {
      id: "",
      code: "—",
      name: t("bpNoBatches"),
      breed: "—",
      batchType: "—",
      startCount: 0,
      stages: [],
    },
    [batches, selectedBatchId]
  );

  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const currentStage = useMemo(() => {
    return currentBatch?.stages?.find((s) => s.id === selectedStageId) || currentBatch?.stages?.[0] || {
      id: "st-default",
      code: "ST-01",
      name: t("swActiveStageFallback"),
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
      standardDays: 30,
      startAnimals: currentBatch?.startCount || 0,
      endAnimals: currentBatch?.startCount || 0,
      mortality: 0,
      avgAgeDays: 30,
      feedData: [],
      medData: [],
      labourData: [],
      overheadData: [],
      mortalityLogs: [],
      weightLogs: [],
      observationLogs: [],
      transferLogs: [],
      attachments: [],
      outputHead: 0,
    };
  }, [currentBatch, selectedStageId]);

  // Raw per-batch transactions/metadata, cached at fetch time so an animal
  // filter can re-derive the stage profile client-side (no refetch needed).
  const [rawTxsByBatch, setRawTxsByBatch] = useState<Record<string, any[]>>({});
  const [rawBatchMeta, setRawBatchMeta] = useState<Record<string, any>>({});

  // Animal filter — narrows every tab below to one animal's own transactions.
  const [selectedAnimalId, setSelectedAnimalId] = useState("");
  // A cohort that was split has part of its history sitting on child batches.
  // Reading the parent alone under-reports the original group, so this rolls the
  // children back in for the whole-cohort view.
  const [includeChildren, setIncludeChildren] = useState(false);
  const [batchAnimalOptions, setBatchAnimalOptions] = useState<AnimalOption[]>([]);
  const [batchAnimalOptionsLoading, setBatchAnimalOptionsLoading] = useState(false);

  useEffect(() => {
    setSelectedAnimalId("");
    if (!selectedBatchId) { setBatchAnimalOptions([]); return; }
    const companyId = getActiveCompanyId();
    setBatchAnimalOptionsLoading(true);
    api.get(`/animal?companyId=${companyId}&currentBatchId=${selectedBatchId}&limit=500`)
      .then((res) => {
        const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        setBatchAnimalOptions(list.map((a) => ({ animal_id: a.animal_id, label: a.ear_tag || a.animal_code })));
      })
      .catch(() => setBatchAnimalOptions([]))
      .finally(() => setBatchAnimalOptionsLoading(false));
  }, [selectedBatchId]);

  // Transactions of every batch split out of the selected one, keyed for the
  // whole-cohort view. Children are found through parent_batch_id, which
  // splitBatch() sets when it holds a group back.
  const childBatchIds = useMemo(
    () => Object.values(rawBatchMeta)
      .filter((m: any) => m?.parent_batch_id === selectedBatchId)
      .map((m: any) => m.batch_id),
    [rawBatchMeta, selectedBatchId],
  );

  const cohortStage = useMemo(() => {
    if (!includeChildren || childBatchIds.length === 0) return currentStage;
    const rawB = rawBatchMeta[selectedBatchId];
    if (!rawB) return currentStage;
    const txs = [
      ...(rawTxsByBatch[selectedBatchId] || []),
      ...childBatchIds.flatMap((id) => rawTxsByBatch[id] || []),
    ];
    const profiles = buildStageProfiles(rawB, txs, rawB.stage_log || [], rawB.attachments || []);
    return profiles[profiles.length - 1] ?? currentStage;
  }, [includeChildren, childBatchIds, rawBatchMeta, rawTxsByBatch, selectedBatchId, currentStage]);

  const displayStage = useMemo(() => {
    if (!selectedAnimalId) return cohortStage;
    const rawB = rawBatchMeta[selectedBatchId];
    const rawTxs = rawTxsByBatch[selectedBatchId] || [];
    if (!rawB) return cohortStage;
    // An animal's record is its own rows plus its share of the batch's. Keeping
    // only explicitly-attributed rows showed nothing for an animal in a batch
    // whose entry is recorded at batch level, which is almost all of it.
    const headCount = batchAnimalOptions.length || Number(rawB.closing_quantity ?? rawB.opening_quantity) || 0;
    const filteredTxs = apportionToAnimal(rawTxs as any[], selectedAnimalId, headCount);
    return buildStageProfile(rawB, filteredTxs, rawB.stage_log || [], rawB.attachments || []);
  }, [selectedAnimalId, rawBatchMeta, rawTxsByBatch, selectedBatchId, cohortStage, batchAnimalOptions]);

  const sectionParam = searchParams.get("section");
  const activeTab: TabKey = (TAB_KEYS as readonly string[]).includes(sectionParam || "") ? (sectionParam as TabKey) : "feed";
  const setActiveTab = (tab: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));

  // Recalculate Toast / State
  const [recalculating, setRecalculating] = useState(false);
  const [toastMsg, setToastMsg] = useState("");

  // Add Manual Entry Modal State
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [logType, setLogType] = useState<"FEED" | "MEDICINE">("FEED");
  const [logItem, setLogItem] = useState("");
  const [logQty, setLogQty] = useState("");
  const [logRate, setLogRate] = useState("");
  const [logAnimalIds, setLogAnimalIds] = useState<Set<string>>(new Set());
  const [logAnimalSearch, setLogAnimalSearch] = useState("");
  const [logSaving, setLogSaving] = useState(false);
  const [logError, setLogError] = useState("");

  const loadBatches = (preserveSelection?: boolean) => {
    const companyId = getActiveCompanyId();
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.get(`/batch?companyId=${companyId}&limit=50`)
      .then(async (res) => {
        const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        if (list.length === 0) {
          setBatches([]);
          setLoading(false);
          return;
        }

        const rawTxs: Record<string, any[]> = {};
        const rawMeta: Record<string, any> = {};

        const detailedBatches: BatchProfile[] = await Promise.all(
          list.slice(0, 10).map(async (b: any) => {
            try {
              const detailsRes = await api.get(`/batch/${b.batch_id}`).catch(() => null);
              const details = detailsRes?.data ?? detailsRes ?? b;
              const txs: any[] = details.transactions || [];
              const stageLog: any[] = details.stage_log || [];
              const atts: any[] = details.attachments || [];
              rawTxs[b.batch_id] = txs;
              // stage_log/attachments only come back on the detail call, so keep
              // them on the cached meta — the animal-filter recompute reads it.
              rawMeta[b.batch_id] = { ...b, stage_log: stageLog, attachments: atts };

              const stageProfiles = buildStageProfiles(b, txs, stageLog, atts);

              return {
                id: b.batch_id,
                code: b.batch_no,
                name: b.remarks || b.batch_no,
                breed: b.breed_name || b.breed_code || "—",
                batchType: b.lob_name || "Piggery Production Batch",
                startCount: stageProfiles[0]?.startAnimals ?? 0,
                stages: stageProfiles,
              };
            } catch {
              return {
                id: b.batch_id,
                code: b.batch_no,
                name: b.remarks || b.batch_no,
                breed: b.breed_name || b.breed_code || "—",
                batchType: b.lob_name || "Piggery Production Batch",
                startCount: Number(b.opening_quantity) || 20,
                stages: [],
              };
            }
          })
        );

        setRawTxsByBatch(rawTxs);
        setRawBatchMeta(rawMeta);
        setBatches(detailedBatches);
        if (detailedBatches.length > 0) {
          const existingMatch = preserveSelection ? detailedBatches.find((b) => b.id === selectedBatchId) : undefined;
          const keepExisting = !!existingMatch;
          const target = existingMatch || detailedBatches[0];
          if (!keepExisting) setSelectedBatchId(target.id);
          if (target.stages.length > 0) {
            // The stage the batch is in now is the one an operator wants first;
            // the earlier stages are history they opt into.
            const current = target.stages[target.stages.length - 1];
            setSelectedStageId(current.id);
            if (!keepExisting) {
              setDateFrom(current.startDate);
              setDateTo(current.endDate);
            }
          }
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  };

  useEffect(() => { loadBatches(); }, []);

  // Dynamic calculations
  const totalFeedKg = useMemo(
    () => displayStage.feedData.reduce((sum, f) => sum + f.consumed, 0),
    [displayStage]
  );
  const totalFeedCost = useMemo(
    () => displayStage.feedData.reduce((sum, f) => sum + f.consumed * f.rate, 0),
    [displayStage]
  );
  const totalMedCost = useMemo(
    () => displayStage.medData.reduce((sum, m) => sum + m.cost, 0),
    [displayStage]
  );
  const totalLabourCost = useMemo(
    () => (displayStage.labourData || []).reduce((sum, l) => sum + l.cost, 0),
    [displayStage]
  );
  const totalOverheadCost = useMemo(
    () => displayStage.overheadData.reduce((sum, o) => sum + o.cost, 0),
    [displayStage]
  );
  const totalStageWipCost = totalFeedCost + totalMedCost + totalLabourCost + totalOverheadCost;

  const durationDays = displayStage.standardDays;
  const avgAnimals = (displayStage.startAnimals + displayStage.endAnimals) / 2;
  const costPerHeadDay = avgAnimals > 0 && durationDays > 0 ? (totalStageWipCost / (avgAnimals * durationDays)).toFixed(2) : "0.00";
  const mortalityPct = displayStage.startAnimals > 0 ? ((displayStage.mortality / displayStage.startAnimals) * 100).toFixed(1) : "0.0";

  const handleBatchChange = (batchId: string) => {
    setSelectedBatchId(batchId);
    const b = batches.find((item) => item.id === batchId);
    if (b && b.stages.length > 0) {
      setSelectedStageId(b.stages[0].id);
      setDateFrom(b.stages[0].startDate);
      setDateTo(b.stages[0].endDate);
    }
  };

  const handleStageChange = (stageId: string) => {
    setSelectedStageId(stageId);
    const s = currentBatch?.stages?.find((item) => item.id === stageId);
    if (s) {
      setDateFrom(s.startDate);
      setDateTo(s.endDate);
    }
  };

  const handleRecalculate = () => {
    setRecalculating(true);
    setToastMsg("");
    setTimeout(() => {
      setRecalculating(false);
      setToastMsg(`✓ Recomputed WIP: ${formatMoney(totalStageWipCost)} across ${durationDays} stage days (${avgAnimals} avg head).`);
      setTimeout(() => setToastMsg(""), 4500);
    }, 600);
  };

  const handleExportCSV = () => {
    const csvContent =
      "data:text/csv;charset=utf-8," +
      `Batch,${currentBatch.code} (${currentBatch.name})\n` +
      `Stage,${displayStage.code} - ${displayStage.name}\n` +
      `Date Range,${dateFrom} to ${dateTo}\n` +
      `Animals Start,${displayStage.startAnimals}\n` +
      `Animals End,${displayStage.endAnimals}\n` +
      `Total Feed Consumed (KG),${totalFeedKg}\n` +
      `Total Feed Cost (INR),${totalFeedCost}\n` +
      `Total Medicine Cost (INR),${totalMedCost}\n` +
      `Total Overheads (INR),${totalOverheadCost}\n` +
      `Total Stage WIP (INR),${totalStageWipCost}\n` +
      `Cost per Animal Day (INR),${costPerHeadDay}\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Stage_Consumption_${currentBatch.code}_${displayStage.code}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setToastMsg("✓ Stage consumption dataset exported successfully.");
    setTimeout(() => setToastMsg(""), 3000);
  };

  const handleAddConsumption = async () => {
    if (!logItem || !logQty || !selectedBatchId) return;
    const qty = parseFloat(logQty) || 0;
    const rate = parseFloat(logRate) || 0;
    const animalIds = Array.from(logAnimalIds);

    setLogSaving(true);
    setLogError("");
    try {
      const basePayload =
        logType === "FEED"
          ? { transaction_type: "CONSUMPTION", uom: "KG", rate: rate || 35.0, remarks: logItem }
          : { transaction_type: "CONSUMPTION", uom: "ML", rate: rate || 250, remarks: logItem };

      if (animalIds.length > 0) {
        const shares = splitEvenly(qty, animalIds.length);
        for (let i = 0; i < animalIds.length; i++) {
          await api.post(`/batch/${selectedBatchId}/transaction`, {
            transaction_date: new Date().toISOString().slice(0, 10),
            ...basePayload,
            quantity: shares[i],
            animal_id: animalIds[i],
          });
        }
      } else {
        await api.post(`/batch/${selectedBatchId}/transaction`, {
          transaction_date: new Date().toISOString().slice(0, 10),
          ...basePayload,
          quantity: qty,
        });
      }
    } catch (err: any) {
      setLogSaving(false);
      setLogError(err?.message || "Failed to save consumption entry.");
      return;
    }

    setLogSaving(false);
    setLogModalOpen(false);
    setLogItem("");
    setLogQty("");
    setLogRate("");
    setLogAnimalIds(new Set());
    setLogAnimalSearch("");
    loadBatches(true);
    setToastMsg(`✓ Added ${logType === "FEED" ? "feed" : "medicine"} record: ${logItem} (${qty})`);
    setTimeout(() => setToastMsg(""), 3500);
  };

  if (loading) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <p className="text-sm font-medium text-[var(--text-muted)]">{t("swLoadingStageData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text-primary)]">
      {/* ── Top Filter Bar ── */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">{t("swBatch")}</span>
            <select
              value={selectedBatchId}
              onChange={(e) => handleBatchChange(e.target.value)}
              className="nf-input-sm nf-select max-w-[240px] sm:max-w-[300px] truncate font-semibold"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}{(rawBatchMeta as any)[b.id]?.parent_batch_id ? " ↳ split group" : ""} — {b.name} ({b.breed})
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">{t("swStage")}</span>
            <select
              value={selectedStageId}
              onChange={(e) => handleStageChange(e.target.value)}
              className="nf-input-sm nf-select max-w-[240px] sm:max-w-[300px] truncate font-semibold"
            >
              {currentBatch.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name} ({s.startDate} to {s.endDate})
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">{t("swDateRange")}</span>
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="nf-input-sm font-medium"
              />
              <span className="text-[var(--text-muted)]">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="nf-input-sm font-medium"
              />
            </div>
          </div>

          {childBatchIds.length > 0 && (
            <div>
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">Cohort</span>
              <label className="nf-input-sm flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap px-3 text-xs">
                <input
                  type="checkbox"
                  checked={includeChildren}
                  onChange={(e) => setIncludeChildren(e.target.checked)}
                />
                <span className="text-[var(--text-secondary)]">
                  Include {childBatchIds.length} split group{childBatchIds.length === 1 ? "" : "s"}
                </span>
              </label>
            </div>
          )}
          {batchAnimalOptions.length > 0 && (
            <div>
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">{t("swAnimal")}</span>
              <select
                value={selectedAnimalId}
                onChange={(e) => setSelectedAnimalId(e.target.value)}
                className="nf-input-sm nf-select max-w-[200px] truncate font-semibold"
              >
                <option value="">{t("schedWholeBatch")}</option>
                {batchAnimalOptions.map((a) => (
                  <option key={a.animal_id} value={a.animal_id}>{a.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setLogAnimalIds(new Set()); setLogAnimalSearch(""); setLogModalOpen(true); }}
            className="text-xs h-8 gap-1.5 font-medium"
          >
            <Plus className="h-3.5 w-3.5" /> {t("swLogConsumption")}
          </Button>

          <Button
            size="sm"
            onClick={handleRecalculate}
            disabled={recalculating}
            className="text-xs h-8 gap-1.5 font-semibold text-white shadow-2xs hover:opacity-90"
            style={{ backgroundColor: "var(--accent)" }}
          >
            <RotateCcw className={`h-3.5 w-3.5 ${recalculating ? "animate-spin" : ""}`} />
            {recalculating ? "Recalculating…" : t("swRecalculate")}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCSV}
            className="text-xs h-8 gap-1.5 font-medium"
          >
            <Download className="h-3.5 w-3.5" /> {t("swExport")}
          </Button>
        </div>
      </div>

      {toastMsg && (
        <div className="p-3 text-xs font-semibold rounded-[var(--radius-sm)] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ── Summary Statistics Strip (Live Reactive) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <div
          className="rounded-[var(--radius-md)] border p-3.5 text-center transition-all hover:bg-[var(--surface-raised)]"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("swAnimalsStart")}</p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: "var(--text-primary)" }}>{displayStage.startAnimals}</p>
        </div>
        <div
          className="rounded-[var(--radius-md)] border p-3.5 text-center transition-all hover:bg-[var(--surface-raised)]"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("swAnimalsEnd")}</p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: "var(--text-primary)" }}>{displayStage.endAnimals}</p>
        </div>
        <div
          className="rounded-[var(--radius-md)] border p-3.5 text-center transition-all hover:bg-[var(--surface-raised)]"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("swAvgAge")}</p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: "var(--text-primary)" }}>
            {displayStage.avgAgeDays} <span className="text-xs font-normal" style={{ color: "var(--text-secondary)" }}>d</span>
          </p>
        </div>
        <div
          className="rounded-[var(--radius-md)] border p-3.5 text-center transition-all hover:bg-[var(--surface-raised)]"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("swDuration")}</p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: "var(--text-primary)" }}>
            {durationDays} <span className="text-xs font-normal" style={{ color: "var(--text-secondary)" }}>d</span>
          </p>
        </div>
        <div
          className="rounded-[var(--radius-md)] border p-3.5 text-center transition-all hover:bg-[var(--surface-raised)]"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("swFeedConsumed")}</p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: "var(--text-primary)" }}>
            {totalFeedKg.toLocaleString(undefined, { minimumFractionDigits: 1 })} <span className="text-xs font-normal" style={{ color: "var(--text-secondary)" }}>KG</span>
          </p>
        </div>
        <div
          className="rounded-[var(--radius-md)] border p-3.5 text-center transition-all hover:bg-[var(--surface-raised)]"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("swMedCost")}</p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: "var(--text-primary)" }}>
            {formatMoney(totalMedCost)}
          </p>
        </div>
        <div
          className="rounded-[var(--radius-md)] border p-3.5 text-center transition-all hover:bg-[var(--surface-raised)]"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("bdeMortality")}</p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: displayStage.mortality > 0 ? "var(--danger)" : "var(--text-primary)" }}>
            {displayStage.mortality} <span className="text-xs font-normal" style={{ color: "var(--text-secondary)" }}>({mortalityPct}%)</span>
          </p>
        </div>
        <div
          className="rounded-[var(--radius-md)] border p-3.5 text-center transition-all hover:bg-[var(--surface-raised)]"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>{t("swStageOutput")}</p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: "var(--text-primary)" }}>{displayStage.outputHead} <span className="text-xs font-normal" style={{ color: "var(--text-secondary)" }}>{t("head")}</span></p>
        </div>
      </div>

      {/* ── Sub-Tabs & Detailed Tables ── */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-2xs">
        <div className="flex items-center gap-1 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 pt-2 text-xs font-semibold overflow-x-auto">
          {[
            { key: "feed", label: t("swTabFeedConsumption", { n: displayStage.feedData.length }) },
            { key: "medicine", label: t("swTabMedicineClinical", { n: displayStage.medData.length }) },
            { key: "labour", label: t("swTabLabourManpower", { n: displayStage.labourData?.length || 0 }) },
            { key: "overheads", label: t("swTabOverheadsUtilities", { n: displayStage.overheadData.length }) },
            { key: "mortality", label: t("swTabMortalityIncidents", { n: displayStage.mortalityLogs.length }) },
            { key: "weight", label: t("swTabWeightGrowth", { n: displayStage.weightLogs?.length || 0 }) },
            { key: "observations", label: t("swTabNotesLogs", { n: displayStage.observationLogs?.length || 0 }) },
            { key: "transfers", label: t("swTabStageTransfers", { n: displayStage.transferLogs.length }) },
            { key: "attachments", label: t("swTabAttachments", { n: displayStage.attachments.length }) },
            { key: "summary", label: t("swTabSummary") },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-3.5 py-2.5 border-b-2 font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? "border-[var(--accent)] text-[var(--accent)] font-bold"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {/* TAB 1: FEED CONSUMPTION */}
          {activeTab === "feed" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-3 pb-2 font-bold">#</th>
                    <th className="px-3 pb-2 font-bold">{t("swFeedItemFormula")}</th>
                    <th className="px-3 pb-2 font-bold">{t("colUom")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("swOpeningStock")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("colIssued")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("colConsumed")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("colWastage")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("swClosingStock")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("swStdRate")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("swTotalCost")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {displayStage.feedData.map((f, index) => {
                    const closing = f.opening + f.issued - f.consumed - f.wastage;
                    const cost = f.consumed * f.rate;
                    return (
                      <tr key={f.item} className="hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="px-3 py-2.5 text-[var(--text-muted)]">{index + 1}</td>
                        <td className="px-3 py-2.5 font-semibold text-[var(--text-primary)]">{f.item}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)] font-mono">{f.uom}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{f.opening.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{f.issued.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-500">{f.consumed.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-[var(--text-muted)]">{f.wastage.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{closing.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{formatMoney(f.rate.toFixed(2))}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-[var(--text-primary)]">{formatMoney(cost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] font-bold text-xs bg-[var(--surface-raised)]/60">
                    <td colSpan={5} className="py-2.5 px-2">{t("swStageFeedTotals")}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-500 font-mono">{totalFeedKg.toFixed(2)} KG</td>
                    <td colSpan={3} className="py-2.5"></td>
                    <td className="px-3 py-2.5 text-right font-mono text-[var(--accent)]">{formatMoney(totalFeedCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* TAB 2: MEDICINE CONSUMPTION */}
          {activeTab === "medicine" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-3 pb-2 font-bold">#</th>
                    <th className="px-3 pb-2 font-bold">{t("swMedicineVaccineItem")}</th>
                    <th className="px-3 pb-2 font-bold">{t("colUom")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("colIssued")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("colConsumed")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("colWastage")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("swTotalCost")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {displayStage.medData.map((m, index) => (
                    <tr key={m.item} className="hover:bg-[var(--surface-raised)] transition-colors">
                      <td className="px-3 py-2.5 text-[var(--text-muted)]">{index + 1}</td>
                      <td className="px-3 py-2.5 font-semibold text-[var(--text-primary)]">{m.item}</td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)] font-mono">{m.uom}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{m.issued}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-blue-500">{m.consumed}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[var(--text-muted)]">{m.wastage}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-[var(--text-primary)]">{formatMoney(m.cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] font-bold text-xs bg-[var(--surface-raised)]/60">
                    <td colSpan={6} className="py-2.5 px-2">{t("swStageClinicalVaccineTotal")}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[var(--accent)]">{formatMoney(totalMedCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* TAB 3: LABOUR & MANPOWER */}
          {activeTab === "labour" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-3 pb-2 font-bold">#</th>
                    <th className="px-3 pb-2 font-bold">{t("btColDate")}</th>
                    <th className="px-3 pb-2 font-bold">{t("swLabourResourceActivity")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("swHoursLogged")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("obHourlyRate")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("swTotalCost")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {(displayStage.labourData || []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-xs text-[var(--text-muted)]">{t("swNoLabourLogged")}</td>
                    </tr>
                  ) : (
                    (displayStage.labourData || []).map((l, index) => (
                      <tr key={index} className="hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="px-3 py-2.5 text-[var(--text-muted)]">{index + 1}</td>
                        <td className="px-3 py-2.5 font-mono text-[var(--text-secondary)]">{l.date || "—"}</td>
                        <td className="px-3 py-2.5 font-semibold text-[var(--text-primary)]">{l.resource}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold">{l.hours} hrs</td>
                        <td className="px-3 py-2.5 text-right font-mono">{formatMoney(l.rate.toFixed(2))}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-[var(--text-primary)]">
                          {formatMoney(l.cost)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] font-bold text-xs bg-[var(--surface-raised)]/60">
                    <td colSpan={5} className="py-2.5 px-2">{t("swTotalStageLabourCost")}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[var(--accent)]">
                      {formatMoney(totalLabourCost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* TAB 4: OVERHEADS & UTILITIES */}
          {activeTab === "overheads" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-3 pb-2 font-bold">#</th>
                    <th className="px-3 pb-2 font-bold">{t("swOverheadActivityDesc")}</th>
                    <th className="px-3 pb-2 font-bold">{t("swAllocationBasis")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("swStandardRateInr")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("swAppliedQty")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("swAllocatedCostInr")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {displayStage.overheadData.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-xs text-[var(--text-muted)]">{t("swNoOverheadAllocations")}</td>
                    </tr>
                  ) : (
                    displayStage.overheadData.map((o, index) => (
                      <tr key={index} className="hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="px-3 py-2.5 text-[var(--text-muted)]">{index + 1}</td>
                        <td className="px-3 py-2.5 font-semibold text-[var(--text-primary)]">{o.item}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">{o.basis}</td>
                        <td className="px-3 py-2.5 text-right font-mono">{formatMoney(o.rate.toFixed(2))}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold">{o.qty}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-[var(--text-primary)]">{formatMoney(o.cost)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] font-bold text-xs bg-[var(--surface-raised)]/60">
                    <td colSpan={5} className="py-2.5 px-2">{t("swTotalStageOverheads")}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-[var(--accent)]">{formatMoney(totalOverheadCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* TAB 5: MORTALITY */}
          {activeTab === "mortality" && (
            <div className="space-y-3">
              {displayStage.mortalityLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)]">
                  ✓ Zero mortality logged during this stage. Herd health condition is optimal.
                </div>
              ) : (
                <div className="space-y-2">
                  {displayStage.mortalityLogs.map((m, idx) => (
                    <div key={idx} className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--surface-raised)] border border-[var(--border)] text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-rose-500 flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5" /> {m.count} Head Mortality
                          </span>
                          <span className="text-[var(--text-muted)] font-mono text-[11px]">({m.date})</span>
                          <span className="px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-semibold bg-rose-500/10 text-rose-600 border border-rose-500/20">{m.pen}</span>
                        </div>
                        <p className="mt-1 font-semibold text-[var(--text-primary)]">{m.reason}</p>
                        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{m.vetAction}</p>
                      </div>
                      <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] shrink-0 bg-[var(--surface)] px-2 py-1 rounded-[var(--radius-xs)] border border-[var(--border)]">{t("swNecropsyRecorded")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 6: WEIGHT & GROWTH SAMPLING */}
          {activeTab === "weight" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-3 pb-2 font-bold">#</th>
                    <th className="px-3 pb-2 font-bold">{t("swSamplingDate")}</th>
                    <th className="px-3 pb-2 font-bold text-right">{t("swAvgBodyWeightKg")}</th>
                    <th className="px-3 pb-2 font-bold">{t("swSamplingRemarks")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {(displayStage.weightLogs || []).length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-xs text-[var(--text-muted)]">{t("swNoWeightSampling")}</td>
                    </tr>
                  ) : (
                    (displayStage.weightLogs || []).map((w, index) => (
                      <tr key={index} className="hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="px-3 py-2.5 text-[var(--text-muted)]">{index + 1}</td>
                        <td className="px-3 py-2.5 font-mono text-[var(--text-secondary)]">{w.date || "—"}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-500">
                          {w.avgWeightKg > 0 ? `${w.avgWeightKg.toFixed(2)} KG` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-[var(--text-primary)]">{w.remarks}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 7: NOTES & OBSERVATIONS */}
          {activeTab === "observations" && (
            <div className="space-y-3">
              {(displayStage.observationLogs || []).length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)]">{t("swNoObservationsLogged")}</div>
              ) : (
                <div className="space-y-2">
                  {(displayStage.observationLogs || []).map((obs, idx) => (
                    <div key={idx} className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--surface-raised)] border border-[var(--border)] text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[var(--accent)]">{obs.type}</span>
                          {obs.value && (
                            <span className="px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-bold bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20">
                              {obs.value}
                            </span>
                          )}
                          <span className="text-[var(--text-muted)] font-mono text-[11px]">({obs.date})</span>
                        </div>
                        <p className="mt-1 font-semibold text-[var(--text-primary)]">{obs.notes}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 8: STAGE & PEN TRANSFERS (batch_stage_log) */}
          {activeTab === "transfers" && (
            <div className="space-y-3">
              {displayStage.transferLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)]">
                  {t("swNoStageTransfers")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] table-fixed text-left text-xs border-collapse">
                    <colgroup>
                      <col className="w-[16%]" /><col className="w-[22%]" /><col className="w-[22%]" /><col className="w-[40%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        <th className="px-3 pb-2 font-bold">{t("swColTransferDate")}</th>
                        <th className="px-3 pb-2 font-bold">{t("swColFromStage")}</th>
                        <th className="px-3 pb-2 font-bold">{t("swColToStage")}</th>
                        <th className="px-3 pb-2 font-bold">{t("swColRemarks")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {displayStage.transferLogs.map((tr, idx) => (
                        <tr key={idx} className="hover:bg-[var(--surface-raised)]">
                          <td className="px-3 py-2.5 align-top whitespace-nowrap font-mono text-[var(--text-secondary)]">{tr.date}</td>
                          <td className="px-3 py-2.5 align-top font-mono text-[var(--text-secondary)]">{tr.fromStage}</td>
                          <td className="px-3 py-2.5 align-top font-mono font-semibold text-[var(--text-primary)]">{tr.toStage}</td>
                          <td className="px-3 py-2.5 align-top text-[var(--text-secondary)]">{tr.remarks || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 9: ATTACHMENTS & INSPECTION MEDIA (batch_attachment) */}
          {activeTab === "attachments" && (
            <div className="space-y-3">
              {displayStage.attachments.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)]">
                  {t("swNoAttachments")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] table-fixed text-left text-xs border-collapse">
                    <colgroup><col className="w-[18%]" /><col className="w-[46%]" /><col className="w-[20%]" /><col className="w-[16%]" /></colgroup>
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        <th className="px-3 pb-2 font-bold">{t("swColUploaded")}</th>
                        <th className="px-3 pb-2 font-bold">{t("swColFileName")}</th>
                        <th className="px-3 pb-2 font-bold">{t("swColFileType")}</th>
                        <th className="px-3 pb-2 font-bold text-right">{t("swColAction")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {displayStage.attachments.map((a, idx) => (
                        <tr key={idx} className="hover:bg-[var(--surface-raised)]">
                          <td className="px-3 py-2.5 align-top whitespace-nowrap font-mono text-[var(--text-secondary)]">{a.date || "—"}</td>
                          <td className="px-3 py-2.5 align-top font-semibold text-[var(--text-primary)]">{a.fileName}</td>
                          <td className="px-3 py-2.5 align-top font-mono text-[var(--text-secondary)]">{a.fileType || "—"}</td>
                          <td className="px-3 py-2.5 align-top text-right">
                            {a.url ? (
                              <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--accent)] hover:underline">
                                {t("swOpenFile")}
                              </a>
                            ) : <span className="text-[var(--text-muted)]">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 9: IAS 41 SUMMARY */}
          {activeTab === "summary" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-[var(--radius-md)] bg-[var(--surface-raised)] border border-[var(--border)] space-y-3">
                <div className="flex items-center gap-2 font-bold text-sm text-[var(--text-primary)] border-b pb-2" style={{ borderColor: "var(--border)" }}>
                  <DollarSign className="h-4 w-4 text-[var(--accent)]" />
                  <span>{t("swCostElementBreakdown")}</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">{t("swFeedNutrition")}</span>
                    <span className="font-mono font-bold">{formatMoney(totalFeedCost)} ({((totalFeedCost / (totalStageWipCost || 1)) * 100).toFixed(1)}%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">{t("swMedicineVaccine")}</span>
                    <span className="font-mono font-bold">{formatMoney(totalMedCost)} ({((totalMedCost / (totalStageWipCost || 1)) * 100).toFixed(1)}%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">{t("swDirectFarmLabour")}</span>
                    <span className="font-mono font-bold">{formatMoney(totalLabourCost)} ({((totalLabourCost / (totalStageWipCost || 1)) * 100).toFixed(1)}%)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">{t("swDirectOverheads")}</span>
                    <span className="font-mono font-bold">{formatMoney(totalOverheadCost)} ({((totalOverheadCost / (totalStageWipCost || 1)) * 100).toFixed(1)}%)</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between font-bold text-sm" style={{ borderColor: "var(--border)" }}>
                    <span>{t("swTotalStageWip")}</span>
                    <span className="text-[var(--accent)] font-mono">{formatMoney(totalStageWipCost)}</span>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-[var(--radius-md)] bg-[var(--surface-raised)] border border-[var(--border)] space-y-3">
                <div className="flex items-center gap-2 font-bold text-sm text-[var(--text-primary)] border-b pb-2" style={{ borderColor: "var(--border)" }}>
                  <Activity className="h-4 w-4 text-emerald-500" />
                  <span>{t("swBioAssetUnitMetrics")}</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">{t("swAvgHeadMaintained")}</span>
                    <span className="font-mono font-bold">{avgAnimals} Head</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">{t("swTotalActiveDays")}</span>
                    <span className="font-mono font-bold">{durationDays} Days</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">{t("swAvgFeedPerHeadDay")}</span>
                    <span className="font-mono font-bold">{avgAnimals > 0 && durationDays > 0 ? (totalFeedKg / (avgAnimals * durationDays)).toFixed(2) : "0.00"} KG</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between font-bold text-sm text-emerald-600 dark:text-emerald-400" style={{ borderColor: "var(--border)" }}>
                    <span>{t("swCostPerAnimalDay")}</span>
                    <span className="font-mono">{formatMoney(costPerHeadDay)} / head-day</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── MODAL: LOG MANUAL CONSUMPTION ── */}
      {logModalOpen && (
        <Dialog
          open={logModalOpen}
          onClose={() => setLogModalOpen(false)}
          title={t("swLogStageConsumption")}
          maxWidth="sm"
          footer={
            <Button size="sm" onClick={handleAddConsumption} className="nf-btn-primary" disabled={logSaving}>
              {logSaving ? "Saving…" : "Add to Stage WIP"}
            </Button>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            {logError && (
              <p className="rounded-[var(--radius-xs)] border px-3 py-2 text-xs" style={{ color: "var(--danger)", borderColor: "var(--danger)", backgroundColor: "var(--danger-muted)" }}>{logError}</p>
            )}
            <div>
              <label className="font-semibold block mb-1">{t("swEntryCategory")}</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setLogType("FEED")}
                  className={`px-3 py-2 rounded-[var(--radius-xs)] text-xs font-semibold border ${
                    logType === "FEED" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-[var(--surface-raised)] border-[var(--border)] text-[var(--text-secondary)]"
                  }`}
                >
                  <Wheat className="inline-block h-3.5 w-3.5 mr-1" />{t("swFeedConsumption")}</button>
                <button
                  type="button"
                  onClick={() => setLogType("MEDICINE")}
                  className={`px-3 py-2 rounded-[var(--radius-xs)] text-xs font-semibold border ${
                    logType === "MEDICINE" ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-[var(--surface-raised)] border-[var(--border)] text-[var(--text-secondary)]"
                  }`}
                >
                  <Pill className="inline-block h-3.5 w-3.5 mr-1" />{t("colMedicineVaccine")}</button>
              </div>
            </div>

            <div>
              <label className="font-semibold block mb-1">{t("swItemDescFormula")}</label>
              <input
                type="text"
                value={logItem}
                onChange={(e) => setLogItem(e.target.value)}
                placeholder={logType === "FEED" ? "e.g. Grower Feed Starter (GF-101)" : "e.g. Iron Dextran 200mg / Multivitamin"}
                className="nf-input w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold block mb-1">Quantity Consumed ({logType === "FEED" ? "KG" : "Units"})</label>
                <input
                  type="number"
                  step="0.1"
                  value={logQty}
                  onChange={(e) => setLogQty(e.target.value)}
                  placeholder={t("swPhFifty")}
                  className="nf-input w-full font-mono"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">{t("swStandardRateCost")}</label>
                <input
                  type="number"
                  step="0.5"
                  value={logRate}
                  onChange={(e) => setLogRate(e.target.value)}
                  placeholder={t("swPhThirtyFive")}
                  className="nf-input w-full font-mono"
                />
              </div>
            </div>

            <div>
              <label className="font-semibold block mb-1">{t("swSpecificAnimalsSplitQty")}</label>
              <AnimalMultiSelect
                options={batchAnimalOptions}
                loading={batchAnimalOptionsLoading}
                selected={logAnimalIds}
                onToggle={(id) => setLogAnimalIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
                search={logAnimalSearch}
                onSearchChange={setLogAnimalSearch}
              />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
