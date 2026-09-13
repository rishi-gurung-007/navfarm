"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Save,
  CloudSun,
  Copy,
  Plus,
  CheckCircle2,
  Scale,
  RefreshCw,
  AlertTriangle,
  Wheat,
  Pill,
  DollarSign,
  Users,
  Trash2,
  Camera,
  FileText,
  Layers,
} from "lucide-react";
import PiggeryLifecycleStepper, { type PiggeryStage } from "../piggery/piggery-lifecycle-stepper";
import { buildLifecycleStages } from "../piggery/build-lifecycle-stages";
import { resolvePiggeryStageId, computeStageDay } from "../piggery/resolve-piggery-stage";
import { api } from "@/services/api-client";
import { API_ORIGIN } from "@/lib/api-client";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useLanguage } from "@/hooks/useLanguage";
import { AnimalMultiSelect, splitEvenly, truncateRemarks } from "./animal-multi-select";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

// file_url from the API is server-relative (e.g. "/uploads/xyz.jpg"). Next.js
// proxies that same-origin path to the API alongside /api/v1.

interface FeedItem {
  id: string;
  item: string;
  uom: string;
  opening: number;
  issued: number;
  consumed: number;
  wastage: number;
  rate: number;
  item_id?: string;
  animalIds?: string[];
  animalLabels?: string[];
  lotRequired?: boolean;
}

interface MedItem {
  id: string;
  item: string;
  uom: string;
  issued: number;
  consumed: number;
  cost: number;
  item_id?: string;
  animalIds?: string[];
  animalLabels?: string[];
  lotRequired?: boolean;
}

interface MortalityItem {
  id: string;
  reason: string;
  count: number;
  remarks: string;
  animalIds?: string[];
  animalLabels?: string[];
}

interface LabourItem {
  id: string;
  resource: string;
  persons: number;
  hours: number;
  rate: number;
}

interface OverheadItem {
  id: string;
  type: string;
  amount: number;
  remarks: string;
}

interface BatchAttachment {
  attachment_id: string;
  file_name: string;
  file_url: string;
  mime_type: string | null;
  attachment_type: string;
  created_at: string;
}

interface BatchMeta {
  id: string;
  /** Set when this batch was split out of another — a group held back while
      the rest of the cohort moved on. Entry is per batch, and a split group
      genuinely eats a different ration, so it is picked here like any other. */
  parentBatchId?: string | null;
  code: string;
  name: string;
  breed: string;
  type: string;
  startDate: string;
  currentStage: string;
  currentStageId: number;
  stageDay: number;
  stageTotalDays: number;
  stageDates: string;
  assignedCount: number;
  currentCount: number;
  mortalityCount: number;
  transferredCount: number;
}

// No static batch data — all data is fetched live from the database.

export default function OperationalBatchDataEntry() {
  const { formatMoney } = useCompanyCurrency();
  const { t } = useLanguage();
  // ── Live data state ──
  const [batches, setBatches] = useState<BatchMeta[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState("");
  const [dataEntryLoading, setDataEntryLoading] = useState(false);
  const [noScheduler, setNoScheduler] = useState(false);

  const [selectedBatchId, setSelectedBatchId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));

  // Real lifecycle for the selected batch, built from stage_master + this
  // batch's stage_log. Without it the stepper fell back to a hardcoded eight
  // stages with fixed 2025 dates that were identical for every batch.
  const [lifecycle, setLifecycle] = useState<{ stages: PiggeryStage[]; currentStageId: number }>({ stages: [], currentStageId: 0 });

  // Barn climate read from the batch's own OBSERVATION rows. It used to be the
  // literal string "22.4 °C · 58% Humidity · 0.15 m/s Airflow" in the markup —
  // the same reading on every batch, on every day, forever. Airflow is dropped
  // rather than invented: nothing records it.
  const [climate, setClimate] = useState<{ tempC?: number; humidityPct?: number; on?: string }>({});

  const currentBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) || batches[0],
    [batches, selectedBatchId]
  );

  // ── Entry section rows — all populated from API, never hardcoded ──
  const [feedRows, setFeedRows] = useState<FeedItem[]>([]);
  const [medicineRows, setMedicineRows] = useState<MedItem[]>([]);
  const [mortalityRows, setMortalityRows] = useState<MortalityItem[]>([]);
  const [labourRows, setLabourRows] = useState<LabourItem[]>([]);
  const [overheadRows, setOverheadRows] = useState<OverheadItem[]>([]);
  // line_ids of the currently-loaded schedule's due lines — a row whose id is in
  // here is schedule-sourced (id === ln.line_id, see loadBatchDailyData below),
  // as opposed to a client-added ad hoc row (f-/m-/mo-/l-/o- prefixed id) or a
  // "copy previous day" row (copy-${line_id}, deliberately excluded so a copy
  // reposts as a fresh manual entry, not a silent repost against another day).
  const [scheduledLineIds, setScheduledLineIds] = useState<Set<string>>(new Set());

  const [avgWeight, setAvgWeight] = useState(0);
  const [weightGain, setWeightGain] = useState(0);
  const [bcsScore, setBcsScore] = useState("");
  const [weightNotes, setWeightNotes] = useState("");
  const [generalNotes, setGeneralNotes] = useState("");
  const [attachments, setAttachments] = useState<BatchAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");

  // Modals for Adding Items
  const [addFeedModalOpen, setAddFeedModalOpen] = useState(false);
  const [newFeedItem, setNewFeedItem] = useState("");
  const [newFeedUom, setNewFeedUom] = useState("KG");
  const [newFeedOpening, setNewFeedOpening] = useState("500");
  const [newFeedIssued, setNewFeedIssued] = useState("50");
  const [newFeedConsumed, setNewFeedConsumed] = useState("45");
  const [newFeedWastage, setNewFeedWastage] = useState("5");
  const [newFeedRate, setNewFeedRate] = useState("35.0");
  const [newFeedAnimalIds, setNewFeedAnimalIds] = useState<Set<string>>(new Set());
  const [feedAnimalSearch, setFeedAnimalSearch] = useState("");

  const [addMedModalOpen, setAddMedModalOpen] = useState(false);
  const [newMedItem, setNewMedItem] = useState("");
  const [newMedUom, setNewMedUom] = useState("ML");
  const [newMedIssued, setNewMedIssued] = useState("10");
  const [newMedConsumed, setNewMedConsumed] = useState("10");
  const [newMedCost, setNewMedCost] = useState("100");
  const [newMedAnimalIds, setNewMedAnimalIds] = useState<Set<string>>(new Set());
  const [medAnimalSearch, setMedAnimalSearch] = useState("");

  const [addMortalityModalOpen, setAddMortalityModalOpen] = useState(false);
  const [newMortalityReason, setNewMortalityReason] = useState("");
  const [newMortalityCount, setNewMortalityCount] = useState("1");
  const [newMortalityRemarks, setNewMortalityRemarks] = useState("");
  const [newMortalityAnimalIds, setNewMortalityAnimalIds] = useState<Set<string>>(new Set());
  const [mortalityAnimalSearch, setMortalityAnimalSearch] = useState("");

  // Shared per-batch animal roster used by the Feed / Medicine / Mortality
  // "add row" modals' multi-select pickers.
  const [batchAnimalOptions, setBatchAnimalOptions] = useState<{ animal_id: string; label: string }[]>([]);
  const [batchAnimalOptionsLoading, setBatchAnimalOptionsLoading] = useState(false);

  // Top-level "which animals is today's entry for" selector — sits next to
  // the batch selector, defaults every new Feed/Medicine/Mortality row to
  // this scope (still overridable per row inside each Add modal).
  const [topAnimalIds, setTopAnimalIds] = useState<Set<string>>(new Set());
  const [topAnimalSearch, setTopAnimalSearch] = useState("");
  const [topAnimalPanelOpen, setTopAnimalPanelOpen] = useState(false);

  const [addLabourModalOpen, setAddLabourModalOpen] = useState(false);
  const [newLabourRole, setNewLabourRole] = useState("");
  const [newLabourPersons, setNewLabourPersons] = useState("1");
  const [newLabourHours, setNewLabourHours] = useState("4.0");
  const [newLabourRate, setNewLabourRate] = useState("75");

  const [addOverheadModalOpen, setAddOverheadModalOpen] = useState(false);
  const [newOverheadType, setNewOverheadType] = useState("");
  const [newOverheadAmount, setNewOverheadAmount] = useState("100");
  const [newOverheadRemarks, setNewOverheadRemarks] = useState("");

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [newAttachmentType, setNewAttachmentType] = useState("IMAGE");

  const [saving, setSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState("");
  const [saveErrorMsg, setSaveErrorMsg] = useState("");

  // Helper to map a batch to a specific lifecycle stage
  const resolvePiggeryStage = (b: any) => {
    const resolved = resolvePiggeryStageId(b.current_stage_code || b.stage_code || b.stage_name);
    // Day-in-stage counts from the transfer that put the batch in this stage.
    // Falling back to the batch start (as this used to) counted the cohort's
    // whole life against the stage's standard length.
    const log: any[] = Array.isArray(b.stage_log) ? b.stage_log : [];
    const enteredCurrentStage = log
      .filter((l) => l.to_stage_code === (b.current_stage_code || ''))
      .map((l) => String(l.transferred_at || ''))
      .sort()
      .pop();
    return {
      id: resolved.id,
      name: resolved.name,
      day: computeStageDay(enteredCurrentStage || b.start_date, resolved.standardDays),
      totalDays: resolved.standardDays,
    };
  };


  // Load the batch's real animal roster once per batch, shared by every
  // "scope this row to specific animals" picker below.
  useEffect(() => {
    setTopAnimalIds(new Set());
    setTopAnimalSearch("");
    setTopAnimalPanelOpen(false);
    if (!currentBatch?.id) { setBatchAnimalOptions([]); return; }
    const companyId = getActiveCompanyId();
    setBatchAnimalOptionsLoading(true);
    api.get(`/animal?companyId=${companyId}&currentBatchId=${currentBatch.id}&limit=500`)
      .then((res) => {
        const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        setBatchAnimalOptions(list.map((a) => ({ animal_id: a.animal_id, label: a.ear_tag || a.animal_code })));
      })
      .catch(() => setBatchAnimalOptions([]))
      .finally(() => setBatchAnimalOptionsLoading(false));
  }, [currentBatch?.id]);

  // ── Step 1: Fetch active batch list from DB ──
  useEffect(() => {
    const companyId = getActiveCompanyId();
    if (!companyId) {
      setBatchesLoading(false);
      setBatchesError("No active company — please select a company workspace first.");
      return;
    }
    setBatchesLoading(true);
    setBatchesError("");
    api.get(`/batch?companyId=${companyId}&status=ACTIVE&limit=50`)
      .then(async (res) => {
        let list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        if (list.length === 0) {
          const fallbackRes = await api.get(`/batch?companyId=${companyId}&limit=50`).catch(() => []);
          list = Array.isArray(fallbackRes) ? fallbackRes : (fallbackRes?.data ?? []);
        }
        // /batch returns breed_id but not breed_name, so resolve it here. The
        // old fallback hardcoded "Large White", which showed every batch as
        // that breed no matter what was actually recorded against it.
        const breedRes = await api.get(`/breed?companyId=${companyId}&limit=500`).catch(() => []);
        const breedList: any[] = Array.isArray(breedRes) ? breedRes : (breedRes?.data ?? []);
        const breedNameById = new Map<string, string>(breedList.map((br: any) => [br.breed_id, br.breed_name]));
        const mapped: BatchMeta[] = list.map((b: any) => {
          const st = resolvePiggeryStage(b);
          return {
            id: b.batch_id,
            parentBatchId: b.parent_batch_id ?? null,
            code: b.batch_no,
            name: b.remarks || b.batch_no,
            breed: b.breed_name || breedNameById.get(b.breed_id) || b.breed_code || "—",
            type: b.lob_name || b.nob_name || "Piggery Production Batch",
            startDate: b.start_date || "",
            currentStage: st.name,
            currentStageId: st.id,
            stageDay: st.day,
            stageTotalDays: st.totalDays,
            stageDates: b.start_date ? `${b.start_date} – ${b.expected_end_date || "ongoing"}` : "",
            assignedCount: Number(b.opening_quantity) || 80,
            // closing_quantity is only set once a batch closes; until then the
            // live count is the opening quantity. Number() never yields
            // null/undefined, so `??` here silently pinned this to 0.
            currentCount: Number(b.closing_quantity ?? b.opening_quantity ?? 0) || 0,
            mortalityCount: 0,
            transferredCount: 0,
          };
        });
        setBatches(mapped);
        if (mapped.length > 0) {
          setSelectedBatchId(mapped[0].id);
        }
        setBatchesLoading(false);
      })
      .catch((err) => {
        setBatchesLoading(false);
        setBatchesError(`Failed to load batches: ${err?.message || "API unavailable"}`);
      });
  }, []);

  // ── Step 2: Fetch scheduled entry lines and actual recorded transactions for selected batch + date ──
  const loadBatchDailyData = () => {
    if (!selectedBatchId) return;
    setDataEntryLoading(true);
    setNoScheduler(false);

    Promise.all([
      // No longer errors when the batch has no current-stage schedule — it
      // returns an empty lines array instead, so "no scheduler" is read from
      // that rather than a caught error.
      api.get(`/batch/${selectedBatchId}/data-entry?date=${selectedDate}`).catch(() => ({ lines: [] })),
      api.get(`/batch/${selectedBatchId}`).catch(() => null),
      api.get(`/stage`).catch(() => []),
    ])
      .then(([schedRes, batchRes, stageRes]) => {
        const schedData = schedRes?.data ?? schedRes;
        const lines: any[] = schedData?.lines ?? [];
        setNoScheduler(lines.length === 0);
        setScheduledLineIds(new Set(lines.map((ln: any) => ln.line_id)));
        const batchData = batchRes?.data ?? batchRes;

        // Dynamically update the batch stage from latest database record
        if (batchData?.batch_id) {
          const st = resolvePiggeryStage(batchData);
          setBatches((prev) =>
            prev.map((b) =>
              b.id === batchData.batch_id
                ? {
                  ...b,
                  currentStage: st.name,
                  currentStageId: st.id,
                  stageDay: st.day,
                  stageTotalDays: st.totalDays,
                  currentCount: Number(batchData.closing_quantity ?? batchData.opening_quantity ?? b.currentCount) || b.currentCount,
                }
                : b
            )
          );
        }

        // Latest temperature / humidity observation recorded against this batch.
        const climateRows: any[] = (batchData?.transactions ?? [])
          .filter((t: any) => t.transaction_type === "OBSERVATION" && (t.uom === "\u00b0C" || t.uom === "%"))
          .sort((a: any, b: any) => String(b.transaction_date).localeCompare(String(a.transaction_date)));
        const latestTemp = climateRows.find((t: any) => t.uom === "\u00b0C");
        const latestHumidity = climateRows.find((t: any) => t.uom === "%");
        setClimate({
          tempC: latestTemp ? Number(latestTemp.quantity) : undefined,
          humidityPct: latestHumidity ? Number(latestHumidity.quantity) : undefined,
          on: latestTemp?.transaction_date || latestHumidity?.transaction_date,
        });

        const stageMaster: any[] = (stageRes as any)?.data ?? stageRes ?? [];
        if (batchData?.batch_id && Array.isArray(stageMaster)) {
          setLifecycle(
            buildLifecycleStages({
              stageMaster,
              stageLog: Array.isArray(batchData.stage_log) ? batchData.stage_log : [],
              batchStartDate: batchData.start_date,
              currentStageCode: batchData.current_stage_code ?? null,
            })
          );
        }

        const txs: any[] = batchData?.transactions ?? [];
        const sameDayTxs = txs.filter((t: any) => t.transaction_date === selectedDate || t.transaction_date?.startsWith(selectedDate));

        // The summary strip reports batch-level totals, so mortality there has
        // to be every mortality ever recorded against the batch — not just the
        // selected day's, which read as 0 on any batch whose losses happened
        // earlier.
        const cumulativeMortality = txs
          .filter((t: any) => t.transaction_type === "MORTALITY")
          .reduce((sum: number, t: any) => sum + Number(t.quantity || 0), 0);
        // Stage/pen movements recorded against this batch. `transferredCount`
        // was hardcoded to 0, so the summary strip always read TRANSFERRED 0
        // no matter how many times the batch had actually moved.
        const stageMoves = Array.isArray(batchData?.stage_log) ? batchData.stage_log.length : 0;
        setBatches((prev) => prev.map((bm) => (bm.id === selectedBatchId
          ? { ...bm, mortalityCount: cumulativeMortality, transferredCount: stageMoves }
          : bm)));

        const feeds: FeedItem[] = [];
        const meds: MedItem[] = [];
        const overheads: OverheadItem[] = [];
        const mortalities: MortalityItem[] = [];

        lines.forEach((ln: any) => {
          // line_type replaces the old parameter_type (CONSUMPTION/OUTPUT/DESCRIPTIVE/
          // OVERHEAD/RESOURCE/TRANSFER) — mortality and body-weight, which used to be
          // their own MORTALITY/OBSERVATION types, are now DESCRIPTIVE lines
          // distinguished by kpi_metric.
          const type = ln.line_type;
          const itype = (ln.item_type || "").toUpperCase();

          if (type === "CONSUMPTION" && (itype === "FEED" || itype === "RAW_MATERIAL" || itype.includes("FEED"))) {
            feeds.push({
              id: ln.line_id,
              item: ln.item_label || ln.activity_name,
              uom: ln.uom || "KG",
              opening: 0,
              issued: ln.expected_qty,
              consumed: ln.already_entered_qty,
              wastage: Math.max(0, ln.expected_qty - ln.already_entered_qty),
              rate: ln.std_rate ?? 0,
              item_id: ln.item_id,
              lotRequired: !!ln.lot_required,
            });
          } else if (type === "CONSUMPTION" && (itype === "MEDICINE" || itype === "CHEMICAL" || itype.includes("MED"))) {
            meds.push({
              id: ln.line_id,
              item: ln.item_label || ln.activity_name,
              uom: ln.uom || "ML",
              issued: ln.expected_qty,
              consumed: ln.already_entered_qty,
              cost: (ln.std_rate ?? 0) * ln.expected_qty,
              item_id: ln.item_id,
              lotRequired: !!ln.lot_required,
            });
          } else if (type === "OVERHEAD") {
            overheads.push({
              id: ln.line_id,
              type: ln.activity_name,
              amount: ln.expected_qty,
              remarks: "",
            });
          } else if (type === "DESCRIPTIVE" && ln.kpi_metric === "MORTALITY_COUNT") {
            mortalities.push({
              id: ln.line_id,
              reason: ln.activity_name,
              count: ln.already_entered_qty,
              remarks: "",
            });
          }
          // DESCRIPTIVE body-weight lines → weight/BCS
          if (type === "DESCRIPTIVE" && ln.kpi_metric === "BODY_WEIGHT") {
            setAvgWeight(ln.already_entered_qty > 0 ? ln.already_entered_qty : 0);
          }
        });

        // Overlay actual recorded same-day transactions from DB
        sameDayTxs.forEach((t: any) => {
          if (t.transaction_type === "MORTALITY") {
            const existing = mortalities.find((m) => m.reason === t.remarks || m.id === t.transaction_id);
            if (existing) {
              existing.count = Number(t.quantity || 0);
            } else {
              // `t.remarks` is the FULL previously-saved "reason — remarks"
              // string — put it all in `reason` and leave `remarks` blank,
              // otherwise re-saving this loaded row would concatenate the
              // same text into itself again (doubling on every save).
              mortalities.push({
                id: t.transaction_id || `mo-${Date.now()}`,
                reason: t.remarks || "Recorded Mortality",
                count: Number(t.quantity || 0),
                remarks: "",
              });
            }
          } else if (t.transaction_type === "OVERHEAD") {
            const existing = overheads.find((o) => o.type === t.remarks || o.id === t.transaction_id);
            if (existing) {
              existing.amount = Math.abs(Number(t.amount || t.quantity || 0));
            } else {
              overheads.push({
                id: t.transaction_id || `o-${Date.now()}`,
                type: t.remarks || "Overhead Expense",
                amount: Math.abs(Number(t.amount || t.quantity || 0)),
                remarks: "",
              });
            }
          }
        });

        setFeedRows(feeds);
        setMedicineRows(meds);
        setMortalityRows(mortalities);
        setOverheadRows(overheads);
        setDataEntryLoading(false);
      })
      .catch(() => {
        setDataEntryLoading(false);
      });
  };

  useEffect(() => {
    loadBatchDailyData();
  }, [selectedBatchId, selectedDate]);

  const loadAttachments = () => {
    if (!selectedBatchId) return;
    api
      .get(`/batch/${selectedBatchId}/attachment?date=${selectedDate}`)
      .then((res: any) => setAttachments(res?.data ?? res ?? []))
      .catch(() => setAttachments([]));
  };

  useEffect(() => {
    loadAttachments();
  }, [selectedBatchId, selectedDate]);

  // Calculated Dynamic Metrics
  const totalFeedConsumed = feedRows.reduce((sum, r) => sum + Number(r.consumed || 0), 0);
  const totalFeedCost = feedRows.reduce((sum, r) => sum + Number(r.consumed || 0) * (r.rate || 35), 0);
  const totalMedicineCost = medicineRows.reduce((sum, r) => sum + Number(r.cost || 0), 0);
  const totalMortality = mortalityRows.reduce((sum, r) => sum + Number(r.count || 0), 0);
  const totalLabourHours = labourRows.reduce((sum, r) => sum + Number(r.hours || 0) * Number(r.persons || 1), 0);
  const totalLabourCost = labourRows.reduce((sum, r) => sum + Number(r.hours || 0) * Number(r.persons || 1) * (r.rate || 75), 0);
  const totalOverheads = overheadRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const totalDailyCost = totalFeedCost + totalMedicineCost + totalLabourCost + totalOverheads;
  // Batch-level mortality (all dates) drives the summary strip; `totalMortality`
  // stays the selected day's figure that the entry form below edits.
  const batchMortality = Math.max(currentBatch?.mortalityCount ?? 0, totalMortality);
  const currentHeadCount = currentBatch ? Math.max(0, currentBatch.currentCount - batchMortality) : 0;
  const estCostPerAnimalDay = currentHeadCount > 0 ? (totalDailyCost / currentHeadCount).toFixed(2) : "0.00";

  // Item Removal Handlers
  const handleRemoveFeed = (id: string) => {
    setFeedRows(feedRows.filter((f) => f.id !== id));
  };
  const handleRemoveMed = (id: string) => {
    setMedicineRows(medicineRows.filter((m) => m.id !== id));
  };
  const handleRemoveMortality = (id: string) => {
    setMortalityRows(mortalityRows.filter((m) => m.id !== id));
  };
  const handleRemoveLabour = (id: string) => {
    setLabourRows(labourRows.filter((l) => l.id !== id));
  };
  const handleRemoveOverhead = (id: string) => {
    setOverheadRows(overheadRows.filter((o) => o.id !== id));
  };

  // Add Item Handlers
  const handleAddFeedSubmit = () => {
    if (!newFeedItem) return;
    const selectedAnimalIds = Array.from(newFeedAnimalIds);
    const newItem: FeedItem = {
      id: `f-${Date.now()}`,
      item: newFeedItem,
      uom: newFeedUom,
      opening: parseFloat(newFeedOpening) || 0,
      issued: parseFloat(newFeedIssued) || 0,
      consumed: parseFloat(newFeedConsumed) || 0,
      wastage: parseFloat(newFeedWastage) || 0,
      rate: parseFloat(newFeedRate) || 35.0,
      animalIds: selectedAnimalIds.length > 0 ? selectedAnimalIds : undefined,
      animalLabels: selectedAnimalIds.length > 0
        ? selectedAnimalIds.map((id) => batchAnimalOptions.find((a) => a.animal_id === id)?.label || id)
        : undefined,
    };
    setFeedRows([...feedRows, newItem]);
    setAddFeedModalOpen(false);
    setNewFeedItem("");
    setNewFeedAnimalIds(new Set());
    setFeedAnimalSearch("");
  };

  const handleAddMedSubmit = () => {
    if (!newMedItem) return;
    const selectedAnimalIds = Array.from(newMedAnimalIds);
    const newItem: MedItem = {
      id: `m-${Date.now()}`,
      item: newMedItem,
      uom: newMedUom,
      issued: parseFloat(newMedIssued) || 0,
      consumed: parseFloat(newMedConsumed) || 0,
      cost: parseFloat(newMedCost) || 0,
      animalIds: selectedAnimalIds.length > 0 ? selectedAnimalIds : undefined,
      animalLabels: selectedAnimalIds.length > 0
        ? selectedAnimalIds.map((id) => batchAnimalOptions.find((a) => a.animal_id === id)?.label || id)
        : undefined,
    };
    setMedicineRows([...medicineRows, newItem]);
    setAddMedModalOpen(false);
    setNewMedItem("");
    setNewMedAnimalIds(new Set());
    setMedAnimalSearch("");
  };

  const handleAddMortalitySubmit = () => {
    if (!newMortalityReason) return;
    const selectedAnimalIds = Array.from(newMortalityAnimalIds);
    const newItem: MortalityItem = {
      id: `mo-${Date.now()}`,
      reason: newMortalityReason,
      // Selecting specific animals overrides the manual count — the number
      // of animals picked IS the number that died.
      count: selectedAnimalIds.length > 0 ? selectedAnimalIds.length : (parseInt(newMortalityCount, 10) || 1),
      remarks: newMortalityRemarks || "Logged during morning round",
      animalIds: selectedAnimalIds.length > 0 ? selectedAnimalIds : undefined,
      animalLabels: selectedAnimalIds.length > 0
        ? selectedAnimalIds.map((id) => batchAnimalOptions.find((a) => a.animal_id === id)?.label || id)
        : undefined,
    };
    setMortalityRows([...mortalityRows, newItem]);
    setAddMortalityModalOpen(false);
    setNewMortalityReason("");
    setNewMortalityRemarks("");
    setNewMortalityAnimalIds(new Set());
    setMortalityAnimalSearch("");
  };

  const handleAddLabourSubmit = () => {
    if (!newLabourRole) return;
    const newItem: LabourItem = {
      id: `l-${Date.now()}`,
      resource: newLabourRole,
      persons: parseInt(newLabourPersons, 10) || 1,
      hours: parseFloat(newLabourHours) || 4.0,
      rate: parseFloat(newLabourRate) || 75.0,
    };
    setLabourRows([...labourRows, newItem]);
    setAddLabourModalOpen(false);
    setNewLabourRole("");
  };

  const handleAddOverheadSubmit = () => {
    if (!newOverheadType) return;
    const newItem: OverheadItem = {
      id: `o-${Date.now()}`,
      type: newOverheadType,
      amount: parseFloat(newOverheadAmount) || 0,
      remarks: newOverheadRemarks || "Operational allocation",
    };
    setOverheadRows([...overheadRows, newItem]);
    setAddOverheadModalOpen(false);
    setNewOverheadType("");
    setNewOverheadRemarks("");
  };

  const handleCopyPreviousDay = () => {
    // Re-trigger the data-entry fetch for the previous day then copy into today's fields
    const prevDate = new Date(selectedDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().slice(0, 10);
    if (!selectedBatchId) return;
    api.get(`/batch/${selectedBatchId}/data-entry?date=${prevDateStr}`)
      .then((res) => {
        const lines: any[] = res?.data?.lines ?? res?.lines ?? [];
        const feeds: FeedItem[] = lines
          .filter((ln) => ln.line_type === "CONSUMPTION" && (ln.item_type || "").toUpperCase().includes("FEED"))
          .map((ln) => ({
            id: `copy-${ln.line_id}`,
            item: ln.item_label || ln.activity_name,
            uom: ln.uom || "KG",
            opening: 0,
            issued: ln.expected_qty,
            consumed: ln.already_entered_qty || ln.expected_qty,
            wastage: 0,
            rate: ln.std_rate ?? 0,
            item_id: ln.item_id,
          }));
        if (feeds.length > 0) setFeedRows(feeds);
        setSaveSuccessMsg("✓ Copied previous day's scheduler feed rations.");
        setTimeout(() => setSaveSuccessMsg(""), 3500);
      })
      .catch(() => {
        setSaveSuccessMsg("Could not load previous day data.");
        setTimeout(() => setSaveSuccessMsg(""), 3000);
      });
  };

  const handleSaveAll = async () => {
    if (!currentBatch) return;
    const companyId = getActiveCompanyId();
    if (!companyId) {
      setSaveErrorMsg("No active company selected. Please select a company workspace first.");
      return;
    }

    setSaving(true);
    setSaveSuccessMsg("");
    setSaveErrorMsg("");

    const activeFeedItem = feedRows.find((f) => f.consumed > 0 && f.item_id);

    const payload = {
      company_id: companyId,
      entry_date: selectedDate,
      entries: [
        {
          batch_id: currentBatch.id,
          // Only pass summary feed/mortality if no granular rows are being posted
          feed_qty: (!activeFeedItem && totalFeedConsumed > 0) ? totalFeedConsumed : undefined,
          mortality_count: (mortalityRows.length === 0 && totalMortality > 0) ? totalMortality : undefined,
          water_qty: currentHeadCount > 0 ? currentHeadCount * 15 : undefined,
          temperature: 22.5,
          remarks: generalNotes || undefined,
        },
      ],
    };

    try {
      await api.post("/batch/bulk-daily-entry", payload);

      // Post individual feed consumption transactions (one per feed formula row)
      // so they appear in Feed Management with proper item names — split
      // evenly across selected animals when the row was scoped to specific
      // animals, so the sum posted still matches the entered Consumed qty.
      for (const feed of feedRows) {
        if (Number(feed.consumed) > 0) {
          if (feed.animalIds && feed.animalIds.length > 0) {
            const shares = splitEvenly(Number(feed.consumed), feed.animalIds.length);
            for (let i = 0; i < feed.animalIds.length; i++) {
              const txPayload: any = {
                transaction_date: selectedDate,
                transaction_type: "CONSUMPTION",
                quantity: shares[i],
                rate: feed.rate || 0,
                uom: feed.uom || "KG",
                remarks: feed.item || "Feed Ration",
                animal_id: feed.animalIds[i],
              };
              if (feed.item_id) txPayload.item_id = feed.item_id;
              await api.post(`/batch/${currentBatch.id}/transaction`, txPayload);
            }
          } else if (scheduledLineIds.has(feed.id) && !feed.lotRequired) {
            // Whole-batch, schedule-sourced row — post through the scheduler-
            // aware engine so it's recorded against this exact line and shows
            // up in batch_daily_data, instead of the old fuzzy item-match path.
            // Lot-required lines stay on /transaction below — this screen has
            // no lot-number input, and /daily-data rejects them without one.
            await api.post(`/batch/${currentBatch.id}/daily-data`, {
              line_id: feed.id,
              entry_date: selectedDate,
              entered_value: Number(feed.consumed),
              rate: feed.rate || undefined,
            });
          } else {
            const txPayload: any = {
              transaction_date: selectedDate,
              transaction_type: "CONSUMPTION",
              quantity: Number(feed.consumed),
              rate: feed.rate || 0,
              uom: feed.uom || "KG",
              remarks: feed.item || "Feed Ration",
            };
            if (feed.item_id) txPayload.item_id = feed.item_id;
            await api.post(`/batch/${currentBatch.id}/transaction`, txPayload);
          }
        }
      }

      // Post granular transactions for medicines administered — same
      // even-split-across-selected-animals rule as feed.
      for (const med of medicineRows) {
        if (Number(med.consumed) > 0) {
          const rate = (med.cost && Number(med.consumed) > 0)
            ? Math.round((Number(med.cost) / Number(med.consumed)) * 100) / 100
            : 0;
          if (med.animalIds && med.animalIds.length > 0) {
            const shares = splitEvenly(Number(med.consumed), med.animalIds.length);
            for (let i = 0; i < med.animalIds.length; i++) {
              const txPayload: any = {
                transaction_date: selectedDate,
                transaction_type: "CONSUMPTION",
                quantity: shares[i],
                rate,
                uom: med.uom || "ML",
                remarks: med.item || "Clinical medication",
                animal_id: med.animalIds[i],
              };
              if (med.item_id) txPayload.item_id = med.item_id;
              await api.post(`/batch/${currentBatch.id}/transaction`, txPayload);
            }
          } else if (scheduledLineIds.has(med.id) && !med.lotRequired) {
            await api.post(`/batch/${currentBatch.id}/daily-data`, {
              line_id: med.id,
              entry_date: selectedDate,
              entered_value: Number(med.consumed),
              rate: rate || undefined,
            });
          } else {
            const txPayload: any = {
              transaction_date: selectedDate,
              transaction_type: "CONSUMPTION",
              quantity: Number(med.consumed),
              rate,
              uom: med.uom || "ML",
              remarks: med.item || "Clinical medication",
            };
            if (med.item_id) txPayload.item_id = med.item_id;
            await api.post(`/batch/${currentBatch.id}/transaction`, txPayload);
          }
        }
      }

      // Post granular transactions for mortality with specific causes — one
      // row per animal when specific animals were selected, so each death is
      // attributed to a real animal_id; otherwise a single whole-batch row.
      for (const mort of mortalityRows) {
        if (mort.animalIds && mort.animalIds.length > 0) {
          for (const animalId of mort.animalIds) {
            await api.post(`/batch/${currentBatch.id}/transaction`, {
              transaction_date: selectedDate,
              transaction_type: "MORTALITY",
              quantity: 1,
              uom: "HEAD",
              remarks: truncateRemarks(`${mort.reason}${mort.remarks ? ` — ${mort.remarks}` : ""}`),
              animal_id: animalId,
            });
          }
        } else if (Number(mort.count) > 0 && scheduledLineIds.has(mort.id)) {
          // DESCRIPTIVE MORTALITY_COUNT line — posting here also keeps
          // scheduler_header.animal_count live (see batch-daily-data.service.ts).
          await api.post(`/batch/${currentBatch.id}/daily-data`, {
            line_id: mort.id,
            entry_date: selectedDate,
            entered_value: Number(mort.count),
            remarks: `${mort.reason}${mort.remarks ? ` — ${mort.remarks}` : ""}`,
          });
        } else if (Number(mort.count) > 0) {
          await api.post(`/batch/${currentBatch.id}/transaction`, {
            transaction_date: selectedDate,
            transaction_type: "MORTALITY",
            quantity: Number(mort.count),
            uom: "HEAD",
            remarks: `${mort.reason}${mort.remarks ? ` — ${mort.remarks}` : ""}`,
          });
        }
      }

      // Post labour hours
      for (const l of labourRows) {
        const totalHrs = Number(l.persons || 1) * Number(l.hours || 0);
        if (totalHrs > 0) {
          await api.post(`/batch/${currentBatch.id}/transaction`, {
            transaction_date: selectedDate,
            transaction_type: "OVERHEAD",
            quantity: totalHrs,
            rate: Number(l.rate || 0),
            uom: "HRS",
            persons: Number(l.persons || 0) || undefined,
            hours: Number(l.hours || 0) || undefined,
            remarks: `Labour: ${l.resource} (${l.persons} persons × ${l.hours} hrs @ ${formatMoney(l.rate)}/hr)`,
          });
        }
      }

      // Post weight and body condition sampling
      if (avgWeight > 0) {
        await api.post(`/batch/${currentBatch.id}/transaction`, {
          transaction_date: selectedDate,
          transaction_type: "OBSERVATION",
          quantity: avgWeight,
          uom: "KG",
          adg: weightGain || undefined,
          bcs_score: bcsScore ? Number(bcsScore) || undefined : undefined,
          remarks: `Weight Sample: ${avgWeight} kg (ADG: +${weightGain} kg/day, BCS: ${bcsScore || "3.0"})${weightNotes ? ` — ${weightNotes}` : ""}`,
        });
      }

      // Post supervisor daily observations & notes
      if (generalNotes && generalNotes.trim() !== "") {
        await api.post(`/batch/${currentBatch.id}/transaction`, {
          transaction_date: selectedDate,
          transaction_type: "OBSERVATION",
          quantity: 1,
          uom: "LOG",
          remarks: `Daily Observation: ${generalNotes}`,
        });
      }

      // Post overhead allocations — do NOT send 'amount' field (not in DTO)
      for (const ov of overheadRows) {
        if (Number(ov.amount) > 0 && scheduledLineIds.has(ov.id)) {
          await api.post(`/batch/${currentBatch.id}/daily-data`, {
            line_id: ov.id,
            entry_date: selectedDate,
            entered_value: Number(ov.amount),
            remarks: ov.remarks || ov.type || "Operational Overhead",
          });
        } else if (Number(ov.amount) > 0) {
          await api.post(`/batch/${currentBatch.id}/transaction`, {
            transaction_date: selectedDate,
            transaction_type: "OVERHEAD",
            quantity: 1,
            rate: Number(ov.amount),
            uom: "UNIT",
            remarks: ov.type || "Operational Overhead",
          });
        }
      }

      setSaving(false);
      setSaveSuccessMsg(`✓ Daily operational entries for batch ${currentBatch.code} (${selectedDate}) saved to database.`);
      loadBatchDailyData();
      setTimeout(() => setSaveSuccessMsg(""), 5000);
    } catch (err: any) {
      setSaving(false);
      const errMsg = err?.message || err?.error || "Failed to save daily entries to database.";
      setSaveErrorMsg(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
    }
  };

  const handleAddAttachment = async () => {
    if (!uploadingFile || !currentBatch) return;
    setUploadError("");
    const formData = new FormData();
    formData.append("file", uploadingFile);
    formData.append("log_date", selectedDate);
    formData.append("attachment_type", newAttachmentType);
    try {
      await api.post(`/batch/${currentBatch.id}/attachment`, formData);
      setUploadModalOpen(false);
      setUploadingFile(null);
      loadAttachments();
    } catch (err: any) {
      setUploadError(err?.message || "Failed to upload attachment.");
    }
  };

  const handleRemoveAttachment = async (attachmentId: string) => {
    if (!currentBatch) return;
    await api.delete(`/batch/${currentBatch.id}/attachment/${attachmentId}`).catch(() => void 0);
    loadAttachments();
  };

  if (batchesLoading) {
    return (
      <div className="space-y-6 animate-fade-in text-[var(--text-primary)]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-3 text-[var(--accent)]" />
          <p className="text-sm font-medium text-[var(--text-muted)]">{t("bdeLoadingBatches")}</p>
        </div>
      </div>
    );
  }

  if (batchesError) {
    return (
      <div className="space-y-6 animate-fade-in text-[var(--text-primary)]">
        <div
          className="rounded-[var(--radius-lg)] border p-6 text-center"
          style={{ backgroundColor: "var(--danger-muted)", borderColor: "rgba(194, 67, 50, 0.2)" }}
        >
          <AlertTriangle className="h-6 w-6 mx-auto mb-2" style={{ color: "var(--danger)" }} />
          <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>{batchesError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text-primary)]">
      {/* ── Top Batch Selector & Header Strip ── */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
              <Layers className="h-5 w-5" style={{ color: "var(--accent)" }} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {t("activeProductionBatch")}
                </span>
                <select
                  value={selectedBatchId}
                  onChange={(e) => setSelectedBatchId(e.target.value)}
                  className="max-w-[280px] sm:max-w-[360px] truncate rounded-[var(--radius-xs)] border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] focus:outline-none"
                >
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code}{b.parentBatchId ? " ↳ split group" : ""} — {b.name} ({b.breed})
                    </option>
                  ))}
                </select>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                  style={{
                    backgroundColor: "var(--success-muted)",
                    color: "var(--success)",
                    borderColor: "rgba(47, 125, 91, 0.2)",
                  }}
                >
                  {t("liveActive")}
                </span>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setTopAnimalPanelOpen((o) => !o)}
                    className="flex items-center gap-1.5 rounded-[var(--radius-xs)] border px-3 py-1.5 text-xs font-bold"
                    style={topAnimalIds.size > 0
                      ? { color: "var(--accent)", borderColor: "var(--accent)", backgroundColor: "var(--surface-raised)" }
                      : { color: "var(--text-primary)", borderColor: "var(--input-border)", backgroundColor: "var(--input-bg)" }}
                  >
                    <Users className="h-3.5 w-3.5" />
                    {topAnimalIds.size > 0 ? `${topAnimalIds.size} Animal(s)` : "All Animals"}
                  </button>
                  {topAnimalPanelOpen && (
                    <div
                      className="absolute z-20 mt-1 w-72 rounded-[var(--radius-md)] border p-3 shadow-lg"
                      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
                    >
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{t("obScopeEntryTo")}</p>
                      <AnimalMultiSelect
                        options={batchAnimalOptions}
                        loading={batchAnimalOptionsLoading}
                        selected={topAnimalIds}
                        onToggle={(id) => setTopAnimalIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id); else next.add(id);
                          return next;
                        })}
                        search={topAnimalSearch}
                        onSearchChange={setTopAnimalSearch}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        {topAnimalIds.size > 0 && (
                          <button
                            type="button"
                            onClick={() => setTopAnimalIds(new Set())}
                            className="text-[11px] font-semibold text-[var(--text-muted)] hover:underline"
                          >{t("bdeClearAllAnimals")}</button>
                        )}
                        <button
                          type="button"
                          onClick={() => setTopAnimalPanelOpen(false)}
                          className="text-[11px] font-semibold text-[var(--accent)] hover:underline"
                        >{t("plsDone")}</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs">
                <div>
                  <span className="text-[var(--text-muted)]">{t("bdeBreed")} </span>
                  <span className="font-semibold text-[var(--text-primary)]">{currentBatch?.breed || "—"}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">{t("bdeType")} </span>
                  <span className="font-semibold text-[var(--text-primary)]">{currentBatch?.type || "—"}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">{t("bdeStartDate")} </span>
                  <span className="font-semibold text-[var(--text-primary)]">{currentBatch?.startDate || "—"}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">{t("bdeCurrentStage")} </span>
                  <span className="font-semibold text-[var(--accent)]">{currentBatch?.currentStage || "—"}</span>
                  {currentBatch?.stageTotalDays ? (
                    <span className="text-[11px] text-[var(--text-muted)] ml-1">
                      {t("bdeDayOf", { day: currentBatch.stageDay, total: currentBatch.stageTotalDays })}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Animal Summary KPI Strip */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3 bg-[var(--surface-raised)] p-3 rounded-[var(--radius-md)] border border-[var(--border)]">
            <div className="text-center px-3 sm:border-r sm:border-[var(--border)]">
              <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">{t("bdeAssigned")}</p>
              <p className="text-base font-bold text-[var(--text-primary)]">{currentBatch?.assignedCount ?? 0}</p>
            </div>
            <div className="text-center px-3 sm:border-r sm:border-[var(--border)]">
              <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">{t("bdeCurrent")}</p>
              <p className="text-base font-bold" style={{ color: "var(--success)" }}>{currentHeadCount}</p>
            </div>
            <div className="text-center px-3 sm:border-r sm:border-[var(--border)]">
              <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">{t("bdeMortality")}</p>
              <p className="text-base font-bold" style={{ color: "var(--danger)" }}>{batchMortality}</p>
            </div>
            <div className="text-center px-3">
              <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">{t("bdeTransferred")}</p>
              <p className="text-base font-bold text-[var(--text-primary)]">{currentBatch?.transferredCount ?? 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Notice if No Scheduler Attached ── */}
      {noScheduler && (
        <div
          className="p-3 text-xs rounded-[var(--radius-sm)] border flex items-center gap-2"
          style={{
            backgroundColor: "var(--warning-muted)",
            color: "var(--warning)",
            borderColor: "rgba(183, 121, 31, 0.2)",
          }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{t("obNoSchedulerLinked")}<strong>+ Add</strong> buttons below.</span>
        </div>
      )}

      {/* 8-Stage Lifecycle Stepper — read-only here, reflecting the batch's real
          current stage. Advancing a batch's actual stage is a deliberate action
          done from the Batch Stages screen (real POST /batch/:id/transfer-stage
          call), not from clicking a stage while logging daily data. */}
      {lifecycle.stages.length > 0 ? (
        <PiggeryLifecycleStepper stages={lifecycle.stages} currentStageId={lifecycle.currentStageId} />
      ) : (
        <PiggeryLifecycleStepper currentStageId={currentBatch?.currentStageId || 0} />
      )}

      {/* ── Date, Weather & Quick Action Bar ── */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <label className="nf-text-label mb-1 block text-[var(--text-muted)]">
              {t("logEntryDate")}
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2.5 bg-[var(--surface-raised)] border border-[var(--border)] px-3 py-1.5 rounded-[var(--radius-xs)] text-xs">
            <CloudSun className="w-4 h-4 text-amber-400" />
            <div>
              <span className="text-[10px] text-[var(--text-muted)]">{t("barnClimate")} </span>
              {climate.tempC == null && climate.humidityPct == null ? (
                <span className="text-[var(--text-muted)]">No climate reading recorded</span>
              ) : (
                <>
                  {climate.tempC != null && (
                    <span className="font-semibold text-[var(--text-primary)]">{climate.tempC} °C</span>
                  )}
                  {climate.humidityPct != null && <> · {climate.humidityPct}% Humidity</>}
                  {climate.on && (
                    <span className="text-[10px] text-[var(--text-muted)]"> · {String(climate.on).slice(0, 10)}</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopyPreviousDay}
            className="text-xs h-8 gap-1.5 font-medium"
          >
            <Copy className="w-3.5 h-3.5" /> {t("copyPreviousDay")}
          </Button>

          <Button
            size="sm"
            onClick={handleSaveAll}
            disabled={saving}
            className="nf-btn-primary text-xs h-8 gap-1.5 font-semibold"
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? t("savingLogs") : t("saveDailyBatchEntry")}
          </Button>
        </div>
      </div>

      {saveSuccessMsg && (
        <div className="p-3 text-xs font-semibold rounded-[var(--radius-sm)] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {saveErrorMsg && (
        <div className="p-3 text-xs font-semibold rounded-[var(--radius-sm)] bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 flex items-center gap-2 animate-in fade-in">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{saveErrorMsg}</span>
        </div>
      )}

      {/* ── Modular Daily Panels Grid (Full Add / Edit / Remove) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 1. Feed Consumption */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col justify-between shadow-2xs">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-1.5">
                <Wheat className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>{t("feedConsumptionNutrition")}</span>
              </h3>
              <span className="text-xs font-bold text-[var(--text-primary)]">
                {t("bdeTotal")} {totalFeedConsumed.toFixed(1)} KG ({formatMoney(totalFeedCost.toFixed(2))})
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] table-fixed text-left text-xs border-collapse">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[8%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[13%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[7%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-3 pb-1.5 font-bold">{t("colFeedItem")}</th>
                    <th className="px-3 pb-1.5 font-bold whitespace-nowrap">{t("colUom")}</th>
                    <th className="px-3 pb-1.5 font-bold text-right whitespace-nowrap">{t("colOpening")}</th>
                    <th className="px-3 pb-1.5 font-bold text-right whitespace-nowrap">{t("colIssued")}</th>
                    <th className="px-3 pb-1.5 font-bold text-right whitespace-nowrap text-[var(--text-primary)]">{t("colConsumed")}</th>
                    <th className="px-3 pb-1.5 font-bold text-right whitespace-nowrap">{t("colWastage")}</th>
                    <th className="px-3 pb-1.5 font-bold text-right whitespace-nowrap">{t("colClosing")}</th>
                    <th className="px-3 pb-1.5 font-bold text-right whitespace-nowrap">{t("colAction")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {feedRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-4 text-center text-xs text-[var(--text-muted)] italic">
                        {dataEntryLoading ? "Loading scheduled feed lines from database..." : "No scheduled feed rations for today. Click '+ Add Feed Line' to enter manually."}
                      </td>
                    </tr>
                  ) : (
                    feedRows.map((r, i) => {
                      const closingQty = r.opening + r.issued - r.consumed - r.wastage;
                      return (
                        <tr key={r.id} className="hover:bg-[var(--surface-raised)] transition-colors">
                          <td className="px-3 py-2 align-top font-medium text-[var(--text-primary)]">
                            {r.item}
                            {r.animalLabels && r.animalLabels.length > 0 && (
                              <span className="block text-[10px] font-mono font-semibold text-[var(--accent)]">{r.animalLabels.join(", ")}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top whitespace-nowrap text-[var(--text-secondary)] font-mono">{r.uom}</td>
                          <td className="px-3 py-2 align-top text-right whitespace-nowrap font-mono">{r.opening}</td>
                          <td className="px-3 py-2 align-top text-right whitespace-nowrap font-mono">{r.issued}</td>
                          <td className="px-3 py-2 align-top text-right whitespace-nowrap font-mono">
                            <input
                              type="number"
                              step="0.1"
                              value={r.consumed}
                              onChange={(e) => {
                                const updated = [...feedRows];
                                updated[i].consumed = Number(e.target.value);
                                setFeedRows(updated);
                              }}
                              className="w-16 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-right text-xs font-bold text-[var(--text-primary)]"
                            />
                          </td>
                          <td className="px-3 py-2 align-top text-right whitespace-nowrap font-mono text-[var(--text-muted)]">{r.wastage}</td>
                          <td className="px-3 py-2 align-top text-right whitespace-nowrap font-mono font-semibold">{closingQty.toFixed(1)}</td>
                          <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                            <button
                              onClick={() => handleRemoveFeed(r.id)}
                              className="text-[var(--text-muted)] hover:text-rose-500 p-1 transition-colors"
                              title={t("obRemoveLine")}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <button
            onClick={() => { setNewFeedAnimalIds(new Set(topAnimalIds)); setFeedAnimalSearch(""); setAddFeedModalOpen(true); }}
            className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
          >
            <Plus className="w-3 h-3" /> {t("bdeAddFeedLine")}
          </button>
        </div>

        {/* 2. Medicine / Vaccine Consumption */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col justify-between shadow-2xs">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-1.5">
                <Pill className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>{t("medicineClinicalTreatment")}</span>
              </h3>
              <span className="text-xs font-bold text-[var(--text-primary)]">
                {t("bdeTotal")} {formatMoney(totalMedicineCost)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] table-fixed text-left text-xs border-collapse">
                <colgroup>
                  <col className="w-[40%]" />
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                  <col className="w-[16%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-[var(--border)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-3 pb-1.5 font-bold">{t("colMedicineVaccine")}</th>
                    <th className="px-3 pb-1.5 font-bold whitespace-nowrap">{t("colUom")}</th>
                    <th className="px-3 pb-1.5 font-bold text-right whitespace-nowrap">{t("colIssued")}</th>
                    <th className="px-3 pb-1.5 font-bold text-right whitespace-nowrap text-[var(--text-primary)]">{t("colConsumed")}</th>
                    <th className="px-3 pb-1.5 font-bold text-right whitespace-nowrap">{t("colCost")}</th>
                    <th className="px-3 pb-1.5 font-bold text-right whitespace-nowrap">{t("colAction")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {medicineRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-xs text-[var(--text-muted)] italic">
                        {dataEntryLoading ? "Loading clinical schedule from database..." : t("noScheduledMedications")}
                      </td>
                    </tr>
                  ) : (
                    medicineRows.map((r, i) => (
                      <tr key={r.id} className="hover:bg-[var(--surface-raised)] transition-colors">
                        <td className="px-3 py-2 align-top font-medium text-[var(--text-primary)]">
                          {r.item}
                          {r.animalLabels && r.animalLabels.length > 0 && (
                            <span className="block text-[10px] font-mono font-semibold text-[var(--accent)]">{r.animalLabels.join(", ")}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top whitespace-nowrap text-[var(--text-secondary)] font-mono">{r.uom}</td>
                        <td className="px-3 py-2 align-top text-right whitespace-nowrap font-mono">{r.issued}</td>
                        <td className="px-3 py-2 align-top text-right whitespace-nowrap font-mono">
                          <input
                            type="number"
                            value={r.consumed}
                            onChange={(e) => {
                              const updated = [...medicineRows];
                              updated[i].consumed = Number(e.target.value);
                              setMedicineRows(updated);
                            }}
                            className="w-16 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 text-right text-xs font-bold text-[var(--text-primary)]"
                          />
                        </td>
                        <td className="px-3 py-2 align-top text-right whitespace-nowrap font-mono font-bold">{formatMoney(r.cost)}</td>
                        <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                          <button
                            onClick={() => handleRemoveMed(r.id)}
                            className="text-[var(--text-muted)] hover:text-rose-500 p-1 transition-colors"
                            title={t("obRemoveMedication")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <button
            onClick={() => { setNewMedAnimalIds(new Set(topAnimalIds)); setMedAnimalSearch(""); setAddMedModalOpen(true); }}
            className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
          >
            <Plus className="w-3 h-3" /> {t("bdeAddClinicalMed")}
          </button>
        </div>

        {/* 3. Weight & Body Condition */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            <span>{t("bdeSecWeightBcs")}</span>
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="nf-text-label mb-1 block text-[var(--text-muted)]">
                {t("bdeAvgWeightKg")}
              </label>
              <input
                type="number"
                step="0.1"
                value={avgWeight}
                onChange={(e) => setAvgWeight(Number(e.target.value))}
                className="w-full rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs font-bold text-[var(--text-primary)] font-mono"
              />
            </div>
            <div>
              <label className="nf-text-label mb-1 block text-[var(--text-muted)]">
                {t("bdeAdg")}
              </label>
              <input
                type="number"
                step="0.01"
                value={weightGain}
                onChange={(e) => setWeightGain(Number(e.target.value))}
                className="w-full rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs font-bold text-[var(--text-primary)] font-mono"
              />
            </div>
            <div>
              <label className="nf-text-label mb-1 block text-[var(--text-muted)]">
                {t("bdeBcsRange")}
              </label>
              <input
                type="text"
                value={bcsScore}
                onChange={(e) => setBcsScore(e.target.value)}
                className="w-full rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] p-2 text-xs font-bold text-[var(--text-primary)] font-mono"
              />
            </div>
          </div>
          <div className="mt-3">
            <input
              type="text"
              value={weightNotes}
              onChange={(e) => setWeightNotes(e.target.value)}
              placeholder={t("bdeConditionObs")}
              className="w-full rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]"
            />
          </div>
        </div>

        {/* 4. Mortality & Incidents (with Add & Delete) */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col justify-between shadow-2xs">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>{t("bdeSecMortality")}</span>
              </h3>
              <span className={totalMortality > 0 ? "text-xs font-bold text-rose-500 font-mono" : "text-xs font-bold text-emerald-500 font-mono"}>
                Total: {totalMortality} Head
              </span>
            </div>

            <div className="space-y-2">
              {mortalityRows.length === 0 ? (
                <p className="py-3 text-center text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  ✓ Zero mortalities reported for this date.
                </p>
              ) : (
                mortalityRows.map((m, idx) => (
                  <div key={m.id} className="flex items-center gap-2 p-2 rounded-[var(--radius-xs)] bg-[var(--surface-raised)] text-xs">
                    <div className="flex-1">
                      <span className="font-semibold text-[var(--text-primary)]">{m.reason}</span>
                      <span className="block text-[10px] text-[var(--text-muted)]">{m.remarks}</span>
                      {m.animalLabels && m.animalLabels.length > 0 && (
                        <span className="block text-[10px] font-mono font-semibold text-[var(--accent)]">{m.animalLabels.join(", ")}</span>
                      )}
                    </div>
                    <input
                      type="number"
                      min="0"
                      value={m.count}
                      onChange={(e) => {
                        const updated = [...mortalityRows];
                        updated[idx].count = Number(e.target.value);
                        setMortalityRows(updated);
                      }}
                      className="w-14 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface)] p-1 text-xs font-bold text-right text-[var(--text-primary)] font-mono"
                    />
                    <button
                      onClick={() => handleRemoveMortality(m.id)}
                      className="text-[var(--text-muted)] hover:text-rose-500 p-1"
                      title={t("obRemoveCause")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <button
            onClick={() => {
              setNewMortalityAnimalIds(new Set(topAnimalIds));
              setMortalityAnimalSearch("");
              setAddMortalityModalOpen(true);
            }}
            className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
          >
            <Plus className="w-3 h-3" /> {t("bdeAddMortalityCause")}
          </button>
        </div>

        {/* 5. Labour & Direct Farm Hours (with Add & Delete) */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col justify-between shadow-2xs">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>{t("bdeSecLabour")}</span>
              </h3>
              <span className="text-xs font-bold text-[var(--text-primary)] font-mono">
                {formatMoney(totalLabourCost.toFixed(2))} ({totalLabourHours} hrs)
              </span>
            </div>

            <div className="space-y-2">
              {labourRows.length === 0 ? (
                <p className="py-3 text-center text-xs text-[var(--text-muted)] italic">{t("bdeNoLabourToday")}</p>
              ) : (
                labourRows.map((l) => (
                  <div key={l.id} className="flex items-center justify-between p-2 rounded-[var(--radius-xs)] bg-[var(--surface-raised)] text-xs">
                    <div>
                      <span className="font-semibold text-[var(--text-primary)]">{l.resource}</span>
                      <span className="text-[11px] text-[var(--text-secondary)] block font-mono">
                        {l.persons} Persons · {l.hours} Hours ({formatMoney(l.rate)}/hr)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[var(--text-primary)]">{formatMoney((l.persons * l.hours * l.rate).toFixed(2))}</span>
                      <button
                        onClick={() => handleRemoveLabour(l.id)}
                        className="text-[var(--text-muted)] hover:text-rose-500 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <button
            onClick={() => setAddLabourModalOpen(true)}
            className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
          >
            <Plus className="w-3 h-3" /> {t("bdeAddLabourResource")}
          </button>
        </div>

        {/* 6. Overheads & Utilities (with Add & Delete) */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 flex flex-col justify-between shadow-2xs">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                <span>{t("bdeSecOverheads")}</span>
              </h3>
              <span className="text-xs font-bold text-[var(--text-primary)] font-mono">
                Total: {formatMoney(totalOverheads.toFixed(2))}
              </span>
            </div>

            <div className="space-y-1.5">
              {overheadRows.length === 0 ? (
                <p className="py-3 text-center text-xs text-[var(--text-muted)] italic">{t("bdeNoOverheadsToday")}</p>
              ) : (
                overheadRows.map((o) => (
                  <div key={o.id} className="flex items-center justify-between p-2 rounded-[var(--radius-xs)] bg-[var(--surface-raised)] text-xs">
                    <div>
                      <span className="font-semibold text-[var(--text-primary)]">{o.type}</span>
                      <span className="block text-[10px] text-[var(--text-muted)]">{o.remarks}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[var(--text-primary)]">{formatMoney(o.amount.toFixed(2))}</span>
                      <button
                        onClick={() => handleRemoveOverhead(o.id)}
                        className="text-[var(--text-muted)] hover:text-rose-500 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <button
            onClick={() => setAddOverheadModalOpen(true)}
            className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] hover:underline"
          >
            <Plus className="w-3 h-3" /> {t("bdeAddOverheadExpense")}
          </button>
        </div>

        {/* 7. Notes & Observations */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            <span>{t("bdeSecNotes")}</span>
          </h3>
          <textarea
            rows={3}
            value={generalNotes}
            onChange={(e) => setGeneralNotes(e.target.value)}
            className="w-full rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] p-2.5 text-xs text-[var(--text-primary)] focus:outline-none"
          />
        </div>

        {/* 8. Attachments & Inspection Photos */}
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <span>{t("bdeSecPhotosDocs")}</span>
            </h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setUploadError(""); setUploadingFile(null); setUploadModalOpen(true); }}
              className="h-6 text-[10px] px-2 gap-1 font-medium"
            >
              <Plus className="w-3 h-3" /> {t("bdeUploadMedia")}
            </Button>
          </div>

          <div className="space-y-2">
            {attachments.length === 0 ? (
              <p className="py-3 text-center text-xs text-[var(--text-muted)] italic">{t("obNoInspectionMedia")}</p>
            ) : (
              attachments.map((att) => (
                <div key={att.attachment_id} className="p-2 rounded-[var(--radius-xs)] bg-[var(--surface-raised)] border border-[var(--border)] text-xs flex items-center justify-between gap-2">
                  <a
                    href={`${API_ORIGIN}${att.file_url}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[var(--text-primary)] flex items-center gap-1.5 hover:underline truncate"
                  >
                    <Camera className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    <span className="truncate">{att.file_name}</span>
                  </a>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">
                      {new Date(att.created_at).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => handleRemoveAttachment(att.attachment_id)}
                      className="text-[var(--text-muted)] hover:text-rose-500 p-1"
                      title={t("obRemoveAttachment")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── 9. Summary & General Ledger Posting Strip ── */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--accent)]/30 bg-[var(--surface)] p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
              <Scale className="w-4 h-4 text-[var(--accent)]" />{t("bdeWipSummaryTitle")}</h4>
            <p className="text-xs text-[var(--text-secondary)] mt-1">{t("obFeedLabel")}<strong className="text-[var(--text-primary)]">{formatMoney(totalFeedCost.toFixed(2))}</strong> ({totalFeedConsumed.toFixed(1)} KG) ·
              Meds: <strong className="text-[var(--text-primary)]">{formatMoney(totalMedicineCost.toFixed(2))}</strong> ·
              Labour: <strong className="text-[var(--text-primary)]">{formatMoney(totalLabourCost.toFixed(2))}</strong> ·
              Overheads: <strong className="text-[var(--text-primary)]">{formatMoney(totalOverheads.toFixed(2))}</strong> ·
              Mortality: <strong className="text-[var(--text-primary)]">{totalMortality} Head</strong>
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[10px] uppercase font-bold text-[var(--text-muted)]">{t("bdeEstCostPerAnimalDay")}</p>
              <p className="text-lg font-bold text-[var(--accent)] font-mono">{formatMoney(estCostPerAnimalDay)}</p>
            </div>
            <Button
              onClick={handleSaveAll}
              disabled={saving}
              className="nf-btn-primary text-xs h-9 px-4 gap-2 font-semibold"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? t("postingDailyWip") : t("saveDailyBatchEntry")}
            </Button>
          </div>
        </div>
      </div>

      {/* ── MODAL: ADD FEED ── */}
      {addFeedModalOpen && (
        <Dialog
          open={addFeedModalOpen}
          onClose={() => setAddFeedModalOpen(false)}
          title={t("obAddFeedLine")}
          maxWidth="sm"
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => setAddFeedModalOpen(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={handleAddFeedSubmit} className="nf-btn-primary">{t("obAddFeed")}</Button>
            </>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            <div>
              <label className="font-semibold block mb-1">{t("obFeedItemDesc")}</label>
              <input
                type="text"
                value={newFeedItem}
                onChange={(e) => setNewFeedItem(e.target.value)}
                placeholder={t("obPhFeedItem")}
                className="nf-input w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="font-semibold block mb-1">UOM</label>
                <input
                  type="text"
                  value={newFeedUom}
                  onChange={(e) => setNewFeedUom(e.target.value)}
                  className="nf-input w-full font-mono"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("obStandardRateUom")}</label>
                <input
                  type="number"
                  value={newFeedRate}
                  onChange={(e) => setNewFeedRate(e.target.value)}
                  className="nf-input w-full font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="font-semibold block mb-1">{t("bdeColOpening")}</label>
                <input
                  type="number"
                  value={newFeedOpening}
                  onChange={(e) => setNewFeedOpening(e.target.value)}
                  className="nf-input w-full font-mono"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("bdeColIssued")}</label>
                <input
                  type="number"
                  value={newFeedIssued}
                  onChange={(e) => setNewFeedIssued(e.target.value)}
                  className="nf-input w-full font-mono"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("obConsumed")}</label>
                <input
                  type="number"
                  value={newFeedConsumed}
                  onChange={(e) => setNewFeedConsumed(e.target.value)}
                  className="nf-input w-full font-mono font-bold text-emerald-600"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("bdeColWastage")}</label>
                <input
                  type="number"
                  value={newFeedWastage}
                  onChange={(e) => setNewFeedWastage(e.target.value)}
                  className="nf-input w-full font-mono text-[var(--text-muted)]"
                />
              </div>
            </div>
            <div>
              <label className="font-semibold block mb-1">{t("obSpecificAnimalsSplit")}</label>
              <AnimalMultiSelect
                options={batchAnimalOptions}
                loading={batchAnimalOptionsLoading}
                selected={newFeedAnimalIds}
                onToggle={(id) => setNewFeedAnimalIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
                search={feedAnimalSearch}
                onSearchChange={setFeedAnimalSearch}
              />
            </div>
          </div>
        </Dialog>
      )}

      {/* ── MODAL: ADD MEDICINE ── */}
      {addMedModalOpen && (
        <Dialog
          open={addMedModalOpen}
          onClose={() => setAddMedModalOpen(false)}
          title={t("obAddClinicalMed")}
          maxWidth="sm"
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => setAddMedModalOpen(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={handleAddMedSubmit} className="nf-btn-primary">{t("obAddMedication")}</Button>
            </>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            <div>
              <label className="font-semibold block mb-1">{t("obMedicineName")}</label>
              <input
                type="text"
                value={newMedItem}
                onChange={(e) => setNewMedItem(e.target.value)}
                placeholder={t("obPhMedicine")}
                className="nf-input w-full"
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="font-semibold block mb-1">UOM</label>
                <input
                  type="text"
                  value={newMedUom}
                  onChange={(e) => setNewMedUom(e.target.value)}
                  className="nf-input w-full font-mono"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("bdeColIssued")}</label>
                <input
                  type="number"
                  value={newMedIssued}
                  onChange={(e) => setNewMedIssued(e.target.value)}
                  className="nf-input w-full font-mono"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("bdeColConsumed")}</label>
                <input
                  type="number"
                  value={newMedConsumed}
                  onChange={(e) => setNewMedConsumed(e.target.value)}
                  className="nf-input w-full font-mono font-bold"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("bdeColCostRs")}</label>
                <input
                  type="number"
                  value={newMedCost}
                  onChange={(e) => setNewMedCost(e.target.value)}
                  className="nf-input w-full font-mono font-bold"
                />
              </div>
            </div>
            <div>
              <label className="font-semibold block mb-1">{t("obSpecificAnimalsSplit")}</label>
              <AnimalMultiSelect
                options={batchAnimalOptions}
                loading={batchAnimalOptionsLoading}
                selected={newMedAnimalIds}
                onToggle={(id) => setNewMedAnimalIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
                search={medAnimalSearch}
                onSearchChange={setMedAnimalSearch}
              />
            </div>
          </div>
        </Dialog>
      )}

      {/* ── MODAL: ADD MORTALITY ── */}
      {addMortalityModalOpen && (
        <Dialog
          open={addMortalityModalOpen}
          onClose={() => setAddMortalityModalOpen(false)}
          title={t("obAddMortalityCause")}
          maxWidth="sm"
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => setAddMortalityModalOpen(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={handleAddMortalitySubmit} className="nf-btn-primary">{t("obAddMortality")}</Button>
            </>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            <div>
              <label className="font-semibold block mb-1">{t("obCauseOfDeath")}</label>
              <input
                type="text"
                value={newMortalityReason}
                onChange={(e) => setNewMortalityReason(e.target.value)}
                placeholder={t("obPhCause")}
                className="nf-input w-full"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">{t("bdeColHeadCount")}</label>
              <input
                type="number"
                value={newMortalityCount}
                onChange={(e) => setNewMortalityCount(e.target.value)}
                className="nf-input w-full font-mono"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">{t("obRemarksVetPm")}</label>
              <input
                type="text"
                value={newMortalityRemarks}
                onChange={(e) => setNewMortalityRemarks(e.target.value)}
                placeholder={t("obPhMortalityRemarks")}
                className="nf-input w-full"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">{t("obSpecificAnimalsOverride")}</label>
              <AnimalMultiSelect
                options={batchAnimalOptions}
                loading={batchAnimalOptionsLoading}
                selected={newMortalityAnimalIds}
                onToggle={(id) => setNewMortalityAnimalIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
                search={mortalityAnimalSearch}
                onSearchChange={setMortalityAnimalSearch}
              />
            </div>
          </div>
        </Dialog>
      )}

      {/* ── MODAL: ADD LABOUR ── */}
      {addLabourModalOpen && (
        <Dialog
          open={addLabourModalOpen}
          onClose={() => setAddLabourModalOpen(false)}
          title={t("obAddLabourResource")}
          maxWidth="sm"
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => setAddLabourModalOpen(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={handleAddLabourSubmit} className="nf-btn-primary">{t("obAddLabour")}</Button>
            </>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            <div>
              <label className="font-semibold block mb-1">{t("obResourceWorkerRole")}</label>
              <input
                type="text"
                value={newLabourRole}
                onChange={(e) => setNewLabourRole(e.target.value)}
                placeholder={t("obPhLabour")}
                className="nf-input w-full"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="font-semibold block mb-1">{t("bdeColPersons")}</label>
                <input
                  type="number"
                  value={newLabourPersons}
                  onChange={(e) => setNewLabourPersons(e.target.value)}
                  className="nf-input w-full font-mono"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("bdeColHours")}</label>
                <input
                  type="number"
                  step="0.5"
                  value={newLabourHours}
                  onChange={(e) => setNewLabourHours(e.target.value)}
                  className="nf-input w-full font-mono"
                />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("obHourlyRate")}</label>
                <input
                  type="number"
                  value={newLabourRate}
                  onChange={(e) => setNewLabourRate(e.target.value)}
                  className="nf-input w-full font-mono"
                />
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {/* ── MODAL: ADD OVERHEAD ── */}
      {addOverheadModalOpen && (
        <Dialog
          open={addOverheadModalOpen}
          onClose={() => setAddOverheadModalOpen(false)}
          title={t("obAddOverheadExpense")}
          maxWidth="sm"
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => setAddOverheadModalOpen(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={handleAddOverheadSubmit} className="nf-btn-primary">{t("obAddOverhead")}</Button>
            </>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            <div>
              <label className="font-semibold block mb-1">{t("obOverheadType")}</label>
              <input
                type="text"
                value={newOverheadType}
                onChange={(e) => setNewOverheadType(e.target.value)}
                placeholder={t("obPhOverhead")}
                className="nf-input w-full"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">{t("obAllocatedAmount")}</label>
              <input
                type="number"
                value={newOverheadAmount}
                onChange={(e) => setNewOverheadAmount(e.target.value)}
                className="nf-input w-full font-mono font-bold"
              />
            </div>
            <div>
              <label className="font-semibold block mb-1">{t("bdeColRemarks")}</label>
              <input
                type="text"
                value={newOverheadRemarks}
                onChange={(e) => setNewOverheadRemarks(e.target.value)}
                placeholder={t("obAllocationJustification")}
                className="nf-input w-full"
              />
            </div>
          </div>
        </Dialog>
      )}

      {/* ── MODAL: UPLOAD INSPECTION MEDIA ── */}
      {uploadModalOpen && (
        <Dialog
          open={uploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
          title={t("obUploadInspectionMedia")}
          maxWidth="sm"
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => { setUploadModalOpen(false); setUploadingFile(null); setUploadError(""); }}>{t("cancel")}</Button>
              <Button size="sm" onClick={handleAddAttachment} disabled={!uploadingFile} className="nf-btn-primary">{t("obAttachToDailyLog")}</Button>
            </>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            <div>
              <label className="font-semibold block mb-1">{t("obFileRequired")}</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
                onChange={(e) => setUploadingFile(e.target.files?.[0] || null)}
                className="nf-input w-full"
              />
            </div>

            <div>
              <label className="font-semibold block mb-1">{t("obMediaType")}</label>
              <select
                value={newAttachmentType}
                onChange={(e) => setNewAttachmentType(e.target.value)}
                className="nf-input w-full"
              >
                <option value="IMAGE">{t("obMediaSiteImage")}</option>
                <option value="PDF">{t("obMediaVetReport")}</option>
              </select>
            </div>

            {uploadError && (
              <p className="text-rose-500 font-medium">{uploadError}</p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
