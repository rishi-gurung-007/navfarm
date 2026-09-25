"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Download,
  CheckCircle2,
  AlertTriangle,
  Wheat,
  Pill,
  DollarSign,
  Activity,
  Camera,
  Upload,
  Trash2,
  ExternalLink,
  ImageIcon,
  ArrowRightLeft,
  Users,
  TrendingUp,
  Layers,
  Scale,
  FileText,
  X,
  Calendar,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/useLanguage";
import { api } from "@/services/api-client";
import { stageWindows } from "./build-lifecycle-stages";
import { apportionToAnimal } from "./apportion-to-animal";
import { getActiveCompanyId } from "@/hooks/useAuth";
import type { AnimalOption } from "../production/animal-multi-select";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import { SearchableSelect } from "@/components/ui/searchable-select";

interface BatchProfile {
  id: string;
  code: string;
  name: string;
  breed: string;
  batchType: string;
  startCount: number;
  stages: StageProfile[];
}

export interface DataEntryStageOption {
  id: string;
  code: string;
  name: string;
  sequence: number;
  animalCount?: number;
  startDate?: string;
  endDate?: string;
}

interface BatchAttachmentItem {
  attachment_id: string;
  file_name: string;
  file_type: string;
  file_url: string;
  log_date: string;
  attachment_type?: string;
  created_at?: string;
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
  transferLogs: {
    date: string;
    fromStage: string;
    toStage: string;
    remarks: string;
  }[];
  attachments: {
    id?: string;
    date: string;
    fileName: string;
    fileType: string;
    url: string;
    type?: string;
  }[];
  outputHead: number;
}

// Activity line types as per NAVFarm scheduler and data entry model, plus photo uploader
export const TAB_KEYS = [
  "CONSUMPTION",
  "OUTPUT",
  "DESCRIPTIVE",
  "RESOURCE",
  "OVERHEAD",
  "TRANSFER",
  "PHOTO_UPLOADER",
] as const;
export type TabKey = (typeof TAB_KEYS)[number];

function buildStageProfiles(
  b: any,
  txs: any[],
  stageLog: any[] = [],
  attachments: any[] = []
): StageProfile[] {
  const windows = stageWindows({
    stageLog: (stageLog || []).map((l: any) => ({
      from_stage_code: l.from_stage_code ?? null,
      to_stage_code: l.to_stage_code,
      transferred_at: String(l.transferred_at || ""),
    })),
    batchStartDate: String(b.start_date || "").slice(0, 10),
    currentStageCode: b.current_stage_code ?? null,
    batchEndDate: b.actual_end_date ? String(b.actual_end_date).slice(0, 10) : null,
  });

  if (windows.length <= 1) return [buildStageProfile(b, txs, stageLog, attachments)];

  return windows.map((w, i) => {
    const inWindow = (txs || []).filter((t: any) => {
      const d = String(t.transaction_date || "").slice(0, 10);
      return d >= w.from && d <= w.to;
    });
    const profile = buildStageProfile(
      { ...b, current_stage_code: w.code, start_date: w.from, expected_end_date: w.to },
      inWindow,
      stageLog,
      attachments
    );
    return { ...profile, id: `st-${b.batch_id}-${i}` };
  });
}

function buildStageProfile(
  b: any,
  txs: any[],
  stageLog: any[] = [],
  attachments: any[] = []
): StageProfile {
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

  const medMap = new Map<string, {
    item: string;
    uom: string;
    issued: number;
    consumed: number;
    wastage: number;
    cost: number;
  }>();

  medTxs.forEach((t: any) => {
    const itemName = t.remarks || t.item_name || t.item_code || "Clinical Medication";
    const qty = Number(t.quantity || 0);
    const rate = Number(t.rate || 20.0);
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
      id: a.attachment_id || a.id,
      date: (a.log_date || a.uploaded_at || a.created_at || "").toString().slice(0, 10),
      fileName: a.file_name || a.original_name || "Attachment",
      fileType: a.file_type || a.mime_type || "",
      url: a.file_url || a.file_path || "",
      type: a.attachment_type || "IMAGE",
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [batches, setBatches] = useState<BatchProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");

  // Data entry stages for the currently selected batch
  const [batchDataEntryStages, setBatchDataEntryStages] = useState<DataEntryStageOption[]>([]);
  const [stagesLoading, setStagesLoading] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<string>("ALL");

  // Raw per-batch transactions/metadata, cached at fetch time
  const [rawTxsByBatch, setRawTxsByBatch] = useState<Record<string, any[]>>({});
  const [rawBatchMeta, setRawBatchMeta] = useState<Record<string, any>>({});

  // Animal filter — narrows every tab below to one animal's own transactions
  const [selectedAnimalId, setSelectedAnimalId] = useState("");
  const [includeChildren, setIncludeChildren] = useState(false);
  const [batchAnimalOptions, setBatchAnimalOptions] = useState<AnimalOption[]>([]);

  // Sub-filters inside tabs
  const [consumptionFilter, setConsumptionFilter] = useState<"ALL" | "FEED" | "MEDICINE">("ALL");
  const [descriptiveFilter, setDescriptiveFilter] = useState<"ALL" | "WEIGHT" | "MORTALITY" | "OBSERVATION">("ALL");

  // Date range filters
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));

  // Toast / feedback message
  const [toastMsg, setToastMsg] = useState("");

  // Photo Uploader state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoDate, setPhotoDate] = useState(new Date().toISOString().slice(0, 10));
  const [photoType, setPhotoType] = useState<string>("IMAGE");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [uploadedPhotos, setUploadedPhotos] = useState<BatchAttachmentItem[]>([]);
  const [selectedGalleryImage, setSelectedGalleryImage] = useState<string | null>(null);

  // Active tab management with query param synchronization and backward-compat mapping
  const sectionParam = searchParams.get("section")?.toUpperCase() || "";
  const initialTab: TabKey = useMemo(() => {
    if (sectionParam === "FEED" || sectionParam === "MEDICINE" || sectionParam === "CONSUMPTION") return "CONSUMPTION";
    if (sectionParam === "OUTPUT") return "OUTPUT";
    if (sectionParam === "WEIGHT" || sectionParam === "MORTALITY" || sectionParam === "OBSERVATIONS" || sectionParam === "DESCRIPTIVE") return "DESCRIPTIVE";
    if (sectionParam === "LABOUR" || sectionParam === "RESOURCE") return "RESOURCE";
    if (sectionParam === "OVERHEAD" || sectionParam === "OVERHEADS") return "OVERHEAD";
    if (sectionParam === "TRANSFER" || sectionParam === "TRANSFERS") return "TRANSFER";
    if (sectionParam === "ATTACHMENTS" || sectionParam === "PHOTO_UPLOADER") return "PHOTO_UPLOADER";
    return "CONSUMPTION";
  }, [sectionParam]);

  const [activeTab, setActiveTabState] = useState<TabKey>(initialTab);

  const setActiveTab = (tab: TabKey) => {
    setActiveTabState(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", tab.toLowerCase());
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

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
    [batches, selectedBatchId, t]
  );

  // Load batch list and initial metadata
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
          list.map(async (b: any) => {
            try {
              const detailsRes = await api.get(`/batch/${b.batch_id}`).catch(() => null);
              const details = detailsRes?.data ?? detailsRes ?? b;
              const txs: any[] = details.transactions || [];
              const stageLog: any[] = details.stage_log || [];
              const atts: any[] = details.attachments || [];
              rawTxs[b.batch_id] = txs;
              rawMeta[b.batch_id] = { ...b, stage_log: stageLog, attachments: atts };

              const stageProfiles = buildStageProfiles(b, txs, stageLog, atts);

              return {
                id: b.batch_id,
                code: b.batch_no,
                name: b.remarks || b.batch_no,
                breed: b.breed_name || b.breed_code || "—",
                batchType: b.lob_name || "Piggery Production Batch",
                startCount: stageProfiles[0]?.startAnimals ?? (b.opening_quantity != null ? Number(b.opening_quantity) : 0),
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
          const target = existingMatch || detailedBatches[0];
          if (!preserveSelection || !existingMatch) {
            setSelectedBatchId(target.id);
          }
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    loadBatches();
  }, []);

  // When a batch is selected, load its stages as per data entry on that batch
  useEffect(() => {
    if (!selectedBatchId) {
      setBatchDataEntryStages([]);
      return;
    }

    setStagesLoading(true);
    Promise.all([
      api.get(`/batch/${selectedBatchId}/data-entry`).catch(() => null),
      api.get(`/batch/${selectedBatchId}`).catch(() => null),
      api.get(`/stage`).catch(() => []),
    ])
      .then(([dataEntryRes, batchRes, stageMasterRes]) => {
        const schedData = dataEntryRes?.data ?? dataEntryRes;
        const batchData = batchRes?.data ?? batchRes;
        const stageMasters: any[] = Array.isArray(stageMasterRes) ? stageMasterRes : (stageMasterRes?.data ?? []);

        const progress: any[] = schedData?.progress || [];
        const schedStages: any[] = schedData?.stages || [];

        let resolvedStages: DataEntryStageOption[] = [];

        if (progress.length > 0) {
          // Exactly as per Data Entry on that batch!
          resolvedStages = progress.map((p: any, idx: number) => ({
            id: p.stage_id || p.stage_code,
            code: p.stage_code || p.stage_name,
            name: p.stage_name || p.stage_code,
            sequence: p.stage_sequence ?? idx + 1,
            animalCount: p.animal_count,
          }));
        } else if (schedStages.length > 0) {
          resolvedStages = schedStages.map((s: any, idx: number) => ({
            id: s.stage_id || s.stage_code,
            code: s.stage_code || s.stage_name,
            name: s.stage_name || s.stage_code,
            sequence: s.stage_sequence ?? idx + 1,
            animalCount: s.animal_count,
          }));
        } else {
          // Fallback to batch stage log windows and current stage
          const stageLog = batchData?.stage_log || [];
          const windows = stageWindows({
            stageLog: stageLog.map((l: any) => ({
              from_stage_code: l.from_stage_code ?? null,
              to_stage_code: l.to_stage_code,
              transferred_at: String(l.transferred_at || ""),
            })),
            batchStartDate: String(batchData?.start_date || "").slice(0, 10),
            currentStageCode: batchData?.current_stage_code ?? null,
            batchEndDate: batchData?.actual_end_date ? String(batchData.actual_end_date).slice(0, 10) : null,
          });

          resolvedStages = windows.map((w, idx) => {
            const master = stageMasters.find((sm) => sm.stage_code === w.code);
            return {
              id: master?.stage_id || w.code,
              code: w.code,
              name: master?.stage_name || `${w.code.replace(/_/g, " ")} Stage`,
              sequence: master?.stage_sequence ?? idx + 1,
              startDate: w.from,
              endDate: w.to,
            };
          });
        }

        // Deduplicate stages by code
        const seen = new Set<string>();
        const uniqueStages = resolvedStages.filter((s) => {
          const key = s.code.toUpperCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        setBatchDataEntryStages(uniqueStages);

        // Keep current selected stage if present in resolved stages, else default to ALL
        setSelectedStageId((prev) => {
          if (prev === "ALL") return "ALL";
          const exists = uniqueStages.some((s) => s.id === prev || s.code === prev);
          return exists ? prev : "ALL";
        });
      })
      .catch(() => {
        setBatchDataEntryStages([]);
      })
      .finally(() => {
        setStagesLoading(false);
      });
  }, [selectedBatchId]);

  // Load animals belonging to this batch
  useEffect(() => {
    setSelectedAnimalId("");
    if (!selectedBatchId) {
      setBatchAnimalOptions([]);
      return;
    }
    const companyId = getActiveCompanyId();
    api.get(`/animal?companyId=${companyId}&currentBatchId=${selectedBatchId}&limit=500`)
      .then((res) => {
        const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        setBatchAnimalOptions(
          list.map((a) => {
            const stg = a.current_stage_code || a.stage_code || a.current_stage_name;
            return {
              animal_id: a.animal_id,
              label: `${a.ear_tag || a.animal_code}${stg ? ` [${stg}]` : ""}`,
            };
          })
        );
      })
      .catch(() => setBatchAnimalOptions([]));
  }, [selectedBatchId]);

  // Load attachments / photos for this batch
  const reloadAttachments = async (batchId: string) => {
    if (!batchId) return;
    try {
      const res: any = await api.get(`/batch/${batchId}/attachment`);
      const list = Array.isArray(res) ? res : (res?.data ?? []);
      setUploadedPhotos(list);
    } catch {
      // Fallback to meta attachments
      const fallback = rawBatchMeta[batchId]?.attachments || [];
      setUploadedPhotos(fallback);
    }
  };

  useEffect(() => {
    if (selectedBatchId) {
      reloadAttachments(selectedBatchId);
    }
  }, [selectedBatchId, rawBatchMeta]);

  // Child batches from split cohort
  const childBatchIds = useMemo(
    () =>
      Object.values(rawBatchMeta)
        .filter((m: any) => m?.parent_batch_id === selectedBatchId)
        .map((m: any) => m.batch_id),
    [rawBatchMeta, selectedBatchId]
  );

  // Selected stage details
  const activeStageInfo = useMemo(() => {
    if (selectedStageId === "ALL") return null;
    return batchDataEntryStages.find((s) => s.id === selectedStageId || s.code === selectedStageId) || null;
  }, [selectedStageId, batchDataEntryStages]);

  // Filter transactions by selected stage and animal
  const displayStage = useMemo(() => {
    const rawB = rawBatchMeta[selectedBatchId];
    if (!rawB) {
      return {
        id: "st-empty",
        code: "—",
        name: "No Stage Data",
        startDate: dateFrom,
        endDate: dateTo,
        standardDays: 30,
        startAnimals: 0,
        endAnimals: 0,
        mortality: 0,
        avgAgeDays: 0,
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
    }

    let txs: any[] = rawTxsByBatch[selectedBatchId] || [];

    // Include child batches if requested
    if (includeChildren && childBatchIds.length > 0) {
      txs = [
        ...txs,
        ...childBatchIds.flatMap((id) => rawTxsByBatch[id] || []),
      ];
    }

    // 1. Stage Filtering
    if (activeStageInfo) {
      const codeUpper = (activeStageInfo.code || "").toUpperCase();
      const nameUpper = (activeStageInfo.name || "").toUpperCase();

      txs = txs.filter((t: any) => {
        // Direct stage_id match
        if (t.stage_id && (t.stage_id === activeStageInfo.id || t.stage_id === activeStageInfo.code)) {
          return true;
        }

        // Remarks or item_name containing stage code or stage name
        const text = `${t.remarks || ""} ${t.item_name || ""} ${t.item_code || ""}`.toUpperCase();
        if (codeUpper && text.includes(codeUpper)) return true;
        if (nameUpper && text.includes(nameUpper)) return true;

        // Date window match
        if (activeStageInfo.startDate && activeStageInfo.endDate) {
          const d = String(t.transaction_date || "").slice(0, 10);
          if (d && d >= activeStageInfo.startDate && d <= activeStageInfo.endDate) return true;
        }

        return false;
      });
    }

    // 2. Animal Filtering (per-animal view)
    if (selectedAnimalId) {
      const headCount = batchAnimalOptions.length || Number(rawB.closing_quantity ?? rawB.opening_quantity) || 1;
      txs = apportionToAnimal(txs, selectedAnimalId, headCount);
    }

    const attachmentsList = uploadedPhotos.length > 0 ? uploadedPhotos : (rawB.attachments || []);
    const profile = buildStageProfile(
      {
        ...rawB,
        current_stage_code: activeStageInfo ? activeStageInfo.code : rawB.current_stage_code,
        start_date: activeStageInfo?.startDate || rawB.start_date,
        expected_end_date: activeStageInfo?.endDate || rawB.expected_end_date,
      },
      txs,
      rawB.stage_log || [],
      attachmentsList
    );

    // If an active stage with animal count is selected, adjust start/end animals
    if (activeStageInfo && activeStageInfo.animalCount != null) {
      profile.startAnimals = activeStageInfo.animalCount;
      profile.endAnimals = Math.max(0, activeStageInfo.animalCount - profile.mortality);
      profile.outputHead = profile.endAnimals;
    }

    return profile;
  }, [
    selectedBatchId,
    rawBatchMeta,
    rawTxsByBatch,
    includeChildren,
    childBatchIds,
    activeStageInfo,
    selectedAnimalId,
    batchAnimalOptions,
    uploadedPhotos,
    dateFrom,
    dateTo,
  ]);

  // Derived financial & KPI figures
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
  const durationDays = displayStage.standardDays || 30;
  const avgAnimals = (displayStage.startAnimals + displayStage.endAnimals) / 2 || 1;
  const costPerHeadDay = avgAnimals > 0 && durationDays > 0 ? (totalStageWipCost / (avgAnimals * durationDays)).toFixed(2) : "0.00";
  const mortalityPct = displayStage.startAnimals > 0 ? ((displayStage.mortality / displayStage.startAnimals) * 100).toFixed(1) : "0.0";

  // Handlers
  const handleBatchChange = (batchId: string) => {
    setSelectedBatchId(batchId);
    setSelectedStageId("ALL");
    setSelectedAnimalId("");
  };

  const handleStageChange = (stageId: string) => {
    setSelectedStageId(stageId);
    const stage = batchDataEntryStages.find((s) => s.id === stageId || s.code === stageId);
    if (stage?.startDate && stage?.endDate) {
      setDateFrom(stage.startDate);
      setDateTo(stage.endDate);
    }
  };

  const handleExportCSV = () => {
    const stageLabel = activeStageInfo ? `${activeStageInfo.code} - ${activeStageInfo.name}` : "All Stages (Batch Total)";
    const animalLabel = selectedAnimalId
      ? batchAnimalOptions.find((a) => a.animal_id === selectedAnimalId)?.label || selectedAnimalId
      : "Whole Batch";

    const csvContent =
      "data:text/csv;charset=utf-8," +
      `Batch,${currentBatch.code} (${currentBatch.name})\n` +
      `Stage,${stageLabel}\n` +
      `Animal,${animalLabel}\n` +
      `Date Range,${dateFrom} to ${dateTo}\n` +
      `Animals Start,${displayStage.startAnimals}\n` +
      `Animals End,${displayStage.endAnimals}\n` +
      `Total Feed Consumed (KG),${totalFeedKg}\n` +
      `Total Feed Cost,${totalFeedCost}\n` +
      `Total Medicine Cost,${totalMedCost}\n` +
      `Total Labour Cost,${totalLabourCost}\n` +
      `Total Overheads Cost,${totalOverheadCost}\n` +
      `Total Stage WIP,${totalStageWipCost}\n` +
      `Cost per Animal Day,${costPerHeadDay}\n`;

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Batch_History_${currentBatch.code}_${activeStageInfo?.code || "ALL"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setToastMsg("✓ Batch history dataset exported successfully.");
    setTimeout(() => setToastMsg(""), 3000);
  };

  // Photo Uploader handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoError("");

    const reader = new FileReader();
    reader.onload = (event) => {
      setPhotoPreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoUpload = async () => {
    if (!photoFile || !selectedBatchId) return;
    setPhotoUploading(true);
    setPhotoError("");
    try {
      const formData = new FormData();
      formData.append("file", photoFile);
      formData.append("log_date", photoDate);
      formData.append("attachment_type", photoType);

      await api.upload(`/batch/${selectedBatchId}/attachment`, formData);

      // Refresh attachments list
      await reloadAttachments(selectedBatchId);

      setPhotoFile(null);
      setPhotoPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setToastMsg("✓ Photo uploaded successfully.");
      setTimeout(() => setToastMsg(""), 3500);
    } catch (err: any) {
      setPhotoError(err?.message || "Failed to upload photo. Please check image format and size.");
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleDeletePhoto = async (attachmentId: string) => {
    if (!selectedBatchId || !attachmentId) return;
    if (!window.confirm("Are you sure you want to remove this photo attachment?")) return;

    try {
      await api.delete(`/batch/${selectedBatchId}/attachment/${attachmentId}`);
      await reloadAttachments(selectedBatchId);
      setToastMsg("✓ Photo deleted successfully.");
      setTimeout(() => setToastMsg(""), 3000);
    } catch (err: any) {
      setToastMsg(`Failed to delete photo: ${err?.message || "Error"}`);
      setTimeout(() => setToastMsg(""), 3500);
    }
  };

  // Counts for tab badges
  const totalConsumptionCount = displayStage.feedData.length + displayStage.medData.length;
  const totalDescriptiveCount = displayStage.weightLogs.length + displayStage.mortalityLogs.length + displayStage.observationLogs.length;
  const totalLabourCount = (displayStage.labourData || []).length;
  const totalOverheadCount = displayStage.overheadData.length;
  const totalTransferCount = displayStage.transferLogs.length;
  const totalPhotosCount = uploadedPhotos.length || displayStage.attachments.length;

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
          {/* Batch Selector */}
          <div>
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">{t("swBatch")}</span>
            <div className="w-72 sm:w-80">
              <SearchableSelect
                ariaLabel={t("swBatch")}
                value={selectedBatchId}
                onChange={(val) => handleBatchChange(val)}
                options={batches.map((b) => ({
                  value: b.id,
                  label: `${b.code}${(rawBatchMeta as any)[b.id]?.parent_batch_id ? " ↳ split group" : ""} — ${b.name} (${b.breed})`,
                }))}
                placeholder={t("swBatch")}
                searchPlaceholder="Search batches…"
              />
            </div>
          </div>

          {/* Stages as per Data Entry on that Batch */}
          <div>
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">
              {t("swStage")} {stagesLoading && <span className="text-[9px] text-[var(--text-muted)]">(loading…)</span>}
            </span>
            <div className="w-72 sm:w-80">
              <SearchableSelect
                ariaLabel={t("swStage")}
                value={selectedStageId}
                onChange={(val) => handleStageChange(val)}
                options={[
                  { value: "ALL", label: "All Stages (Batch Total)" },
                  ...batchDataEntryStages.map((s) => ({
                    value: s.id,
                    label: `${s.code} · ${s.name}${s.animalCount != null ? ` (${s.animalCount} animals)` : ""}`,
                  })),
                ]}
                placeholder={t("swStage")}
                searchPlaceholder="Search stages…"
              />
            </div>
          </div>

          {/* Animal Selector (Per-Animal View) */}
          {batchAnimalOptions.length > 0 && (
            <div>
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">
                {t("swAnimal")} ({batchAnimalOptions.length})
              </span>
              <div className="w-56 sm:w-64">
                <SearchableSelect
                  ariaLabel={t("swAnimal")}
                  value={selectedAnimalId}
                  onChange={(val) => setSelectedAnimalId(val)}
                  options={[
                    { value: "", label: t("schedWholeBatch") },
                    ...batchAnimalOptions.map((a) => ({
                      value: a.animal_id,
                      label: a.label,
                    })),
                  ]}
                  placeholder={t("schedWholeBatch")}
                  searchPlaceholder="Search animals…"
                  onClear={selectedAnimalId ? () => setSelectedAnimalId("") : undefined}
                />
              </div>
            </div>
          )}

          {/* Date Range */}
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

          {/* Cohort Split Groups Checkbox */}
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
        </div>

        {/* Action Buttons: Log Consumption and Recalculate removed, Export kept */}
        <div className="flex items-center gap-2">
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

      {/* ── Interactive Stage Stepper / Pills Bar (as per Data Entry) ── */}
      {batchDataEntryStages.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-2xs">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] shrink-0 mr-1 flex items-center gap-1">
              <Layers className="h-3 w-3" /> Stages:
            </span>
            <button
              type="button"
              onClick={() => setSelectedStageId("ALL")}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all flex items-center gap-1.5 ${
                selectedStageId === "ALL"
                  ? "bg-[var(--accent)] text-white shadow-xs"
                  : "bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span>All Stages</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/10 dark:bg-white/10">
                {currentBatch.startCount}
              </span>
            </button>
            {batchDataEntryStages.map((stg) => {
              const isSelected = selectedStageId === stg.id || selectedStageId === stg.code;
              return (
                <button
                  key={stg.id}
                  type="button"
                  onClick={() => handleStageChange(stg.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all flex items-center gap-1.5 ${
                    isSelected
                      ? "bg-[var(--accent)] text-white shadow-xs scale-102"
                      : "bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <span>{stg.name}</span>
                  {stg.animalCount != null && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                        isSelected
                          ? "bg-black/20 text-white"
                          : stg.animalCount > 0
                          ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                          : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500"
                      }`}
                    >
                      {stg.animalCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {toastMsg && (
        <div className="p-3 text-xs font-semibold rounded-[var(--radius-sm)] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ── Summary Statistics Strip ── */}
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
          <p className="text-xl font-bold font-mono mt-1" style={{ color: "var(--text-primary)" }}>
            {displayStage.outputHead} <span className="text-xs font-normal" style={{ color: "var(--text-secondary)" }}>{t("head")}</span>
          </p>
        </div>
      </div>

      {/* ── Tabs Navigation: ONLY Activity Line Types + Photo Uploader ── */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-2xs">
        <div className="flex items-center gap-1 border-b border-[var(--border)] bg-[var(--surface-raised)] px-4 pt-2 text-xs font-semibold overflow-x-auto">
          {[
            {
              key: "CONSUMPTION" as const,
              label: "Consumption",
              count: totalConsumptionCount,
              icon: Wheat,
            },
            {
              key: "OUTPUT" as const,
              label: "Output",
              count: displayStage.outputHead,
              icon: TrendingUp,
            },
            {
              key: "DESCRIPTIVE" as const,
              label: "Descriptive",
              count: totalDescriptiveCount,
              icon: Activity,
            },
            {
              key: "RESOURCE" as const,
              label: "Resource",
              count: totalLabourCount,
              icon: Users,
            },
            {
              key: "OVERHEAD" as const,
              label: "Overhead",
              count: totalOverheadCount,
              icon: DollarSign,
            },
            {
              key: "TRANSFER" as const,
              label: "Transfer",
              count: totalTransferCount,
              icon: ArrowRightLeft,
            },
            {
              key: "PHOTO_UPLOADER" as const,
              label: "Photo Uploader",
              count: totalPhotosCount,
              icon: Camera,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const isTabActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-3.5 py-2.5 border-b-2 font-medium transition-colors whitespace-nowrap ${
                  isTabActive
                    ? "border-[var(--accent)] text-[var(--accent)] font-bold"
                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono ${
                    isTabActive
                      ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                      : "bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)]"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="p-4">
          {/* ══════════════════════════════════════════════════════════════════
              TAB 1: CONSUMPTION (Feed & Medicine)
              ══════════════════════════════════════════════════════════════════ */}
          {activeTab === "CONSUMPTION" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Category:</span>
                  <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-0.5 text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setConsumptionFilter("ALL")}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        consumptionFilter === "ALL" ? "bg-[var(--surface)] shadow-2xs font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                      }`}
                    >
                      All Consumption ({totalConsumptionCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setConsumptionFilter("FEED")}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        consumptionFilter === "FEED" ? "bg-[var(--surface)] shadow-2xs font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                      }`}
                    >
                      Feed Rations ({displayStage.feedData.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setConsumptionFilter("MEDICINE")}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        consumptionFilter === "MEDICINE" ? "bg-[var(--surface)] shadow-2xs font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                      }`}
                    >
                      Clinical & Medicine ({displayStage.medData.length})
                    </button>
                  </div>
                </div>

                <div className="text-xs text-[var(--text-secondary)] font-mono">
                  Total Consumption Cost: <strong className="text-[var(--text-primary)]">{formatMoney(totalFeedCost + totalMedCost)}</strong>
                </div>
              </div>

              {/* Feed Consumption Section */}
              {(consumptionFilter === "ALL" || consumptionFilter === "FEED") && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    <Wheat className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Feed Consumption</span>
                  </div>
                  {displayStage.feedData.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                      No feed consumption records for this selection.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                            <th className="px-3 py-2 font-bold">#</th>
                            <th className="px-3 py-2 font-bold">{t("swFeedItemFormula")}</th>
                            <th className="px-3 py-2 font-bold">{t("colUom")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("swOpeningStock")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("colIssued")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("colConsumed")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("colWastage")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("swClosingStock")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("swStdRate")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("swTotalCost")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {displayStage.feedData.map((f, index) => {
                            const closing = f.opening + f.issued - f.consumed - f.wastage;
                            const cost = f.consumed * f.rate;
                            return (
                              <tr key={f.item} className="hover:bg-[var(--surface-raised)] transition-colors">
                                <td className="px-3 py-2 text-[var(--text-muted)]">{index + 1}</td>
                                <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">{f.item}</td>
                                <td className="px-3 py-2 text-[var(--text-secondary)] font-mono">{f.uom}</td>
                                <td className="px-3 py-2 text-right font-mono">{f.opening.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right font-mono">{f.issued.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{f.consumed.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right font-mono text-[var(--text-muted)]">{f.wastage.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right font-mono">{closing.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right font-mono">{formatMoney(f.rate.toFixed(2))}</td>
                                <td className="px-3 py-2 text-right font-mono font-bold text-[var(--text-primary)]">{formatMoney(cost)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-[var(--border)] font-bold text-xs bg-[var(--surface-raised)]">
                            <td colSpan={5} className="py-2.5 px-3">Feed Totals</td>
                            <td className="px-3 py-2.5 text-right text-emerald-600 dark:text-emerald-400 font-mono">{totalFeedKg.toFixed(2)} KG</td>
                            <td colSpan={3} className="py-2.5"></td>
                            <td className="px-3 py-2.5 text-right font-mono text-[var(--accent)]">{formatMoney(totalFeedCost)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Medicine & Clinical Section */}
              {(consumptionFilter === "ALL" || consumptionFilter === "MEDICINE") && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    <Pill className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Medicine & Clinical Consumption</span>
                  </div>
                  {displayStage.medData.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                      No clinical medication or vaccines logged for this selection.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                            <th className="px-3 py-2 font-bold">#</th>
                            <th className="px-3 py-2 font-bold">{t("swMedicineVaccineItem")}</th>
                            <th className="px-3 py-2 font-bold">{t("colUom")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("colIssued")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("colConsumed")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("colWastage")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("swTotalCost")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {displayStage.medData.map((m, index) => (
                            <tr key={m.item} className="hover:bg-[var(--surface-raised)] transition-colors">
                              <td className="px-3 py-2 text-[var(--text-muted)]">{index + 1}</td>
                              <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">{m.item}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)] font-mono">{m.uom}</td>
                              <td className="px-3 py-2 text-right font-mono">{m.issued}</td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-blue-600 dark:text-blue-400">{m.consumed}</td>
                              <td className="px-3 py-2 text-right font-mono text-[var(--text-muted)]">{m.wastage}</td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-[var(--text-primary)]">{formatMoney(m.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-[var(--border)] font-bold text-xs bg-[var(--surface-raised)]">
                            <td colSpan={6} className="py-2.5 px-3">Clinical & Medicine Totals</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[var(--accent)]">{formatMoney(totalMedCost)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TAB 2: OUTPUT (Stage Output & Harvested Yield)
              ══════════════════════════════════════════════════════════════════ */}
          {activeTab === "OUTPUT" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)]">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Stage Output Head Count</span>
                  <div className="text-2xl font-bold font-mono mt-1 text-[var(--text-primary)]">
                    {displayStage.outputHead} <span className="text-xs font-normal text-[var(--text-secondary)]">Head</span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                    Closing animals eligible for transfer or weaning
                  </p>
                </div>

                <div className="p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)]">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Survival Rate</span>
                  <div className="text-2xl font-bold font-mono mt-1 text-emerald-600 dark:text-emerald-400">
                    {displayStage.startAnimals > 0
                      ? (((displayStage.startAnimals - displayStage.mortality) / displayStage.startAnimals) * 100).toFixed(1)
                      : "100.0"}%
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                    {displayStage.mortality} mortality recorded during this period
                  </p>
                </div>

                <div className="p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)]">
                  <span className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Accumulated Stage WIP</span>
                  <div className="text-2xl font-bold font-mono mt-1 text-[var(--accent)]">
                    {formatMoney(totalStageWipCost)}
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-1">
                    {formatMoney(costPerHeadDay)} / head-day across {durationDays} days
                  </p>
                </div>
              </div>

              <div className="rounded-[var(--radius-sm)] border border-[var(--border)] p-4 bg-[var(--surface-raised)]/50">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                  Output & Yield Summary
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-[var(--border)]">
                    <span className="text-[var(--text-secondary)]">Batch Number</span>
                    <span className="font-mono font-bold text-[var(--text-primary)]">{currentBatch.code}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[var(--border)]">
                    <span className="text-[var(--text-secondary)]">Target Stage</span>
                    <span className="font-semibold text-[var(--text-primary)]">{activeStageInfo?.name || displayStage.name}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[var(--border)]">
                    <span className="text-[var(--text-secondary)]">Opening Head Count</span>
                    <span className="font-mono">{displayStage.startAnimals} Head</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[var(--border)]">
                    <span className="text-[var(--text-secondary)]">Recorded Mortality</span>
                    <span className="font-mono text-rose-500">{displayStage.mortality} Head</span>
                  </div>
                  <div className="flex justify-between py-1 font-bold text-sm">
                    <span>Net Output Quantity</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">{displayStage.outputHead} Head</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TAB 3: DESCRIPTIVE (Weight, Mortality & Observations)
              ══════════════════════════════════════════════════════════════════ */}
          {activeTab === "DESCRIPTIVE" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Type:</span>
                <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-0.5 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setDescriptiveFilter("ALL")}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      descriptiveFilter === "ALL" ? "bg-[var(--surface)] shadow-2xs font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                    }`}
                  >
                    All Descriptive ({totalDescriptiveCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDescriptiveFilter("WEIGHT")}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      descriptiveFilter === "WEIGHT" ? "bg-[var(--surface)] shadow-2xs font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                    }`}
                  >
                    Weight Sampling ({displayStage.weightLogs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDescriptiveFilter("MORTALITY")}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      descriptiveFilter === "MORTALITY" ? "bg-[var(--surface)] shadow-2xs font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                    }`}
                  >
                    Mortality ({displayStage.mortalityLogs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDescriptiveFilter("OBSERVATION")}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      descriptiveFilter === "OBSERVATION" ? "bg-[var(--surface)] shadow-2xs font-bold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                    }`}
                  >
                    Observations ({displayStage.observationLogs.length})
                  </button>
                </div>
              </div>

              {/* Weight Sampling */}
              {(descriptiveFilter === "ALL" || descriptiveFilter === "WEIGHT") && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    <Scale className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Weight & Growth Sampling</span>
                  </div>
                  {displayStage.weightLogs.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                      {t("swNoWeightSampling")}
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)]">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                            <th className="px-3 py-2 font-bold">#</th>
                            <th className="px-3 py-2 font-bold">{t("swSamplingDate")}</th>
                            <th className="px-3 py-2 font-bold text-right">{t("swAvgBodyWeightKg")}</th>
                            <th className="px-3 py-2 font-bold">{t("swSamplingRemarks")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {displayStage.weightLogs.map((w, index) => (
                            <tr key={index} className="hover:bg-[var(--surface-raised)] transition-colors">
                              <td className="px-3 py-2 text-[var(--text-muted)]">{index + 1}</td>
                              <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{w.date || "—"}</td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                {w.avgWeightKg > 0 ? `${w.avgWeightKg.toFixed(2)} KG` : "—"}
                              </td>
                              <td className="px-3 py-2 text-[var(--text-primary)]">{w.remarks}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Mortality Logs */}
              {(descriptiveFilter === "ALL" || descriptiveFilter === "MORTALITY") && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                    <span>Mortality Incidents</span>
                  </div>
                  {displayStage.mortalityLogs.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                      Zero mortality logged for this selection. Herd condition is optimal.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {displayStage.mortalityLogs.map((m, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--surface-raised)] border border-[var(--border)] text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-rose-500 flex items-center gap-1">
                                <AlertTriangle className="h-3.5 w-3.5" /> {m.count} Head Mortality
                              </span>
                              <span className="text-[var(--text-muted)] font-mono text-[11px]">({m.date})</span>
                              <span className="px-2 py-0.5 rounded-[var(--radius-xs)] text-[10px] font-semibold bg-rose-500/10 text-rose-600 border border-rose-500/20">
                                {m.pen}
                              </span>
                            </div>
                            <p className="mt-1 font-semibold text-[var(--text-primary)]">{m.reason}</p>
                            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{m.vetAction}</p>
                          </div>
                          <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] shrink-0 bg-[var(--surface)] px-2 py-1 rounded-[var(--radius-xs)] border border-[var(--border)]">
                            {t("swNecropsyRecorded")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Observation & KPI Logs */}
              {(descriptiveFilter === "ALL" || descriptiveFilter === "OBSERVATION") && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    <Activity className="h-3.5 w-3.5 text-[var(--accent)]" />
                    <span>Observations & Environmental Logs</span>
                  </div>
                  {displayStage.observationLogs.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                      {t("swNoObservationsLogged")}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {displayStage.observationLogs.map((obs, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--surface-raised)] border border-[var(--border)] text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
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
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TAB 4: RESOURCE (Labour & Manpower)
              ══════════════════════════════════════════════════════════════════ */}
          {activeTab === "RESOURCE" && (
            <div className="space-y-3">
              {(displayStage.labourData || []).length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                  {t("swNoLabourLogged")}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        <th className="px-3 py-2 font-bold">#</th>
                        <th className="px-3 py-2 font-bold">{t("btColDate")}</th>
                        <th className="px-3 py-2 font-bold">{t("swLabourResourceActivity")}</th>
                        <th className="px-3 py-2 font-bold text-right">{t("swHoursLogged")}</th>
                        <th className="px-3 py-2 font-bold text-right">{t("obHourlyRate")}</th>
                        <th className="px-3 py-2 font-bold text-right">{t("swTotalCost")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {(displayStage.labourData || []).map((l, index) => (
                        <tr key={index} className="hover:bg-[var(--surface-raised)] transition-colors">
                          <td className="px-3 py-2 text-[var(--text-muted)]">{index + 1}</td>
                          <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{l.date || "—"}</td>
                          <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">{l.resource}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold">{l.hours} hrs</td>
                          <td className="px-3 py-2 text-right font-mono">{formatMoney(l.rate.toFixed(2))}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-[var(--text-primary)]">
                            {formatMoney(l.cost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[var(--border)] font-bold text-xs bg-[var(--surface-raised)]">
                        <td colSpan={5} className="py-2.5 px-3">{t("swTotalStageLabourCost")}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-[var(--accent)]">
                          {formatMoney(totalLabourCost)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TAB 5: OVERHEAD (Utilities & Indirect Costs)
              ══════════════════════════════════════════════════════════════════ */}
          {activeTab === "OVERHEAD" && (
            <div className="space-y-3">
              {displayStage.overheadData.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                  {t("swNoOverheadAllocations")}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        <th className="px-3 py-2 font-bold">#</th>
                        <th className="px-3 py-2 font-bold">{t("swOverheadActivityDesc")}</th>
                        <th className="px-3 py-2 font-bold">{t("swAllocationBasis")}</th>
                        <th className="px-3 py-2 font-bold text-right">Standard Rate</th>
                        <th className="px-3 py-2 font-bold text-right">{t("swAppliedQty")}</th>
                        <th className="px-3 py-2 font-bold text-right">Allocated Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {displayStage.overheadData.map((o, index) => (
                        <tr key={index} className="hover:bg-[var(--surface-raised)] transition-colors">
                          <td className="px-3 py-2 text-[var(--text-muted)]">{index + 1}</td>
                          <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">{o.item}</td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{o.basis}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatMoney(o.rate.toFixed(2))}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold">{o.qty}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-[var(--text-primary)]">
                            {formatMoney(o.cost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[var(--border)] font-bold text-xs bg-[var(--surface-raised)]">
                        <td colSpan={5} className="py-2.5 px-3">{t("swTotalStageOverheads")}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-[var(--accent)]">
                          {formatMoney(totalOverheadCost)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TAB 6: TRANSFER (Stage & Pen Movements)
              ══════════════════════════════════════════════════════════════════ */}
          {activeTab === "TRANSFER" && (
            <div className="space-y-3">
              {displayStage.transferLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                  {t("swNoStageTransfers")}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)]">
                  <table className="w-full min-w-[560px] table-fixed text-left text-xs border-collapse">
                    <colgroup>
                      <col className="w-[18%]" />
                      <col className="w-[24%]" />
                      <col className="w-[24%]" />
                      <col className="w-[34%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                        <th className="px-3 py-2 font-bold">{t("swColTransferDate")}</th>
                        <th className="px-3 py-2 font-bold">{t("swColFromStage")}</th>
                        <th className="px-3 py-2 font-bold">{t("swColToStage")}</th>
                        <th className="px-3 py-2 font-bold">{t("swColRemarks")}</th>
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

          {/* ══════════════════════════════════════════════════════════════════
              TAB 7: PHOTO UPLOADER (Interactive Uploader + Attached Media)
              ══════════════════════════════════════════════════════════════════ */}
          {activeTab === "PHOTO_UPLOADER" && (
            <div className="space-y-6">
              {/* Photo Upload Card */}
              <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Camera className="h-4 w-4 text-[var(--accent)]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
                    Upload Batch Inspection / Clinical Photo
                  </h3>
                </div>

                {photoError && (
                  <div className="mb-3 p-3 text-xs font-medium rounded-[var(--radius-xs)] bg-rose-500/10 text-rose-600 border border-rose-500/20">
                    {photoError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* File Selector & Drag Area */}
                  <div className="md:col-span-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      onChange={handleFileSelect}
                      className="hidden"
                      id="batch-photo-file-input"
                    />

                    {!photoFile ? (
                      <label
                        htmlFor="batch-photo-file-input"
                        className="flex flex-col items-center justify-center border-2 border-dashed border-[var(--border)] rounded-[var(--radius-md)] p-6 bg-[var(--surface)] hover:bg-[var(--surface-raised)] hover:border-[var(--accent)] transition-all cursor-pointer text-center group"
                      >
                        <div className="p-3 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] mb-2 group-hover:scale-110 transition-transform">
                          <Upload className="h-5 w-5" />
                        </div>
                        <p className="text-xs font-bold text-[var(--text-primary)]">
                          Click to select a photo or drag & drop here
                        </p>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">
                          PNG, JPG, WEBP, or PDF up to 10MB
                        </p>
                      </label>
                    ) : (
                      <div className="flex items-center gap-4 p-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
                        {photoPreview ? (
                          <img
                            src={photoPreview}
                            alt="Upload preview"
                            className="h-20 w-20 object-cover rounded-md border border-[var(--border)]"
                          />
                        ) : (
                          <div className="h-20 w-20 rounded-md bg-[var(--surface-raised)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)]">
                            <FileText className="h-8 w-8" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-[var(--text-primary)] truncate">
                            {photoFile.name}
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                            {(photoFile.size / 1024).toFixed(1)} KB
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setPhotoFile(null);
                              setPhotoPreview(null);
                              if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                            className="text-[11px] font-semibold text-rose-500 hover:underline mt-1 flex items-center gap-1"
                          >
                            <X className="h-3 w-3" /> Change File
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Metadata and Upload Action */}
                  <div className="space-y-3 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">
                          Log Date
                        </label>
                        <input
                          type="date"
                          value={photoDate}
                          onChange={(e) => setPhotoDate(e.target.value)}
                          className="nf-input-sm w-full font-medium"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">
                          Photo / Attachment Type
                        </label>
                        <SearchableSelect
                          ariaLabel="Photo / Attachment Type"
                          value={photoType}
                          onChange={(val) => setPhotoType(val)}
                          options={[
                            { value: "IMAGE", label: "Stage Inspection Photo" },
                            { value: "CLINICAL", label: "Clinical / Post-Mortem" },
                            { value: "VACCINATION", label: "Vaccination Record" },
                            { value: "GENERAL", label: "General Attachment" },
                          ]}
                          placeholder="Select photo type…"
                          searchPlaceholder="Search types…"
                        />
                      </div>
                    </div>

                    <Button
                      size="sm"
                      onClick={handlePhotoUpload}
                      disabled={!photoFile || photoUploading}
                      className="w-full text-xs font-semibold gap-2 nf-btn-primary"
                    >
                      <Upload className={`h-3.5 w-3.5 ${photoUploading ? "animate-spin" : ""}`} />
                      {photoUploading ? "Uploading Photo…" : "Upload Photo"}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Photo Gallery Grid */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Batch Photo & Media Gallery ({uploadedPhotos.length})
                  </h4>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Photos linked to batch {currentBatch.code}
                  </span>
                </div>

                {uploadedPhotos.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-[var(--radius-sm)] border border-[var(--border)]">
                    No photos or attachments uploaded for this batch yet. Use the uploader above to attach inspection photos.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {uploadedPhotos.map((att: any, idx: number) => {
                      const attId = att.attachment_id || att.id || String(idx);
                      const isImage = (att.file_type || att.mime_type || "").toLowerCase().includes("image") ||
                        /\.(png|jpe?g|webp|gif|bmp)$/i.test(att.file_name || att.url || "");

                      return (
                        <div
                          key={attId}
                          className="group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-2xs hover:shadow-sm transition-all flex flex-col"
                        >
                          {/* Image preview area */}
                          <div className="relative h-40 bg-zinc-950 flex items-center justify-center overflow-hidden">
                            {isImage && att.file_url ? (
                              <img
                                src={att.file_url}
                                alt={att.file_name}
                                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                onError={(e) => {
                                  // Fallback to placeholder icon
                                  (e.target as any).style.display = "none";
                                }}
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center text-zinc-500">
                                <ImageIcon className="h-10 w-10 mb-1" />
                                <span className="text-[10px] font-mono uppercase">{att.file_type || "DOCUMENT"}</span>
                              </div>
                            )}

                            {/* View Fullscreen overlay button */}
                            {att.file_url && (
                              <button
                                type="button"
                                onClick={() => setSelectedGalleryImage(att.file_url)}
                                className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white gap-1.5 text-xs font-semibold"
                              >
                                <Eye className="h-4 w-4" /> View Full
                              </button>
                            )}

                            {/* Type badge */}
                            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-[var(--radius-xs)] text-[9px] font-bold uppercase tracking-wider bg-black/60 text-white backdrop-blur-xs">
                              {att.attachment_type || "PHOTO"}
                            </span>
                          </div>

                          {/* Details & Actions footer */}
                          <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                            <div>
                              <p className="text-xs font-semibold text-[var(--text-primary)] truncate" title={att.file_name}>
                                {att.file_name}
                              </p>
                              <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5 flex items-center gap-1">
                                <Calendar className="h-2.5 w-2.5" />
                                {att.log_date || (att.created_at ? String(att.created_at).slice(0, 10) : "—")}
                              </p>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-[var(--border)] text-xs">
                              {att.file_url ? (
                                <a
                                  href={att.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] font-semibold text-[var(--accent)] hover:underline flex items-center gap-1"
                                >
                                  <ExternalLink className="h-3 w-3" /> Open
                                </a>
                              ) : (
                                <span className="text-[10px] text-[var(--text-muted)]">—</span>
                              )}

                              <button
                                type="button"
                                onClick={() => handleDeletePhoto(attId)}
                                className="text-rose-500 hover:text-rose-600 p-1 rounded-md hover:bg-rose-500/10 transition-colors"
                                title="Delete Photo"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Fullscreen Photo Modal */}
              {selectedGalleryImage && (
                <div
                  className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
                  onClick={() => setSelectedGalleryImage(null)}
                >
                  <div
                    className="relative max-w-4xl max-h-[90vh] bg-[var(--surface)] rounded-[var(--radius-lg)] overflow-hidden shadow-2xl p-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedGalleryImage(null)}
                      className="absolute top-4 right-4 z-10 p-1.5 rounded-full bg-black/60 text-white hover:bg-black transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <img
                      src={selectedGalleryImage}
                      alt="Full Inspection Photo"
                      className="max-h-[82vh] w-auto mx-auto object-contain rounded-md"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
