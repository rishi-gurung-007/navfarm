"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Search,
  Plus,
  CheckCircle,
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/alert";
import { useLanguage } from "@/hooks/useLanguage";

export interface AnimalAssignmentRow {
  id: string;
  earTag: string;
  animalId: string;
  rfid?: string;
  sex: "Female (Gilt)" | "Female (Sow)" | "Male (Boar)" | "Piglet";
  breed: string;
  dob: string;
  ageDays: number;
  entryDate: string;
  penLocation: string;
  locationId: string;
  weightKg: number;
  source: string;
  status: "Active" | "Transferred" | "Isolated" | "Culled";
}

import { api } from "@/services/api-client";
import { getActiveCompanyId } from "@/hooks/useAuth";

type Row = Record<string, any>;

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

interface BatchOption {
  id: string;
  code: string;
  breed: string;
  stage: string;
  period: string;
  // Raw reference IDs off the real batch record — used to default/scope the
  // "register a new animal into this batch" form (nob_id/breed_id on
  // batch_header are nullable, so these can legitimately be undefined).
  lobId?: string;
  nobId?: string;
  breedId?: string;
  locationId?: string;
  stageId?: string;
  animalTracking?: "REGISTERED" | "COUNT_ONLY";
}

const ANIMAL_TYPES = ["SOW", "BOAR", "GILT", "PIGLET", "COMMERCIAL_PIG"];
const GENDERS = [{ value: "F", label: "Female" }, { value: "M", label: "Male" }];
const ENTRY_TYPES = ["PURCHASED_IMPORTED", "PURCHASED_LOCAL", "BORN_ON_FARM", "TRANSFERRED_IN"];

export default function BatchAnimalAssignmentPanel() {
  const { t } = useLanguage();
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBatchId, setSelectedBatchId] = useState<string>("");

  const currentBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) || batches[0],
    [batches, selectedBatchId]
  );
  const isRegisteredBatch = currentBatch?.animalTracking === "REGISTERED";

  const [animals, setAnimals] = useState<AnimalAssignmentRow[]>([]);
  const [search, setSearch] = useState("");
  const [selectedSex, setSelectedSex] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [activeTab, setActiveTab] = useState<"assigned" | "add" | "transfer" | "removal">("assigned");

  // Reference data for the real "assign existing" / "register new" flows
  const [nobs, setNobs] = useState<Row[]>([]);
  const [lobs, setLobs] = useState<Row[]>([]);
  const [breeds, setBreeds] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);
  const [stages, setStages] = useState<Row[]>([]);

  // Multi-select over the assigned list. A batch that is due to move on usually
  // has a handful of animals that are not ready — the group actions below act
  // on exactly that selection rather than one animal at a time.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState("");

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveStageId, setMoveStageId] = useState("");
  const [moveLocationId, setMoveLocationId] = useState("");
  const [moveReason, setMoveReason] = useState("");

  const [splitOpen, setSplitOpen] = useState(false);
  const [splitStageCode, setSplitStageCode] = useState("");
  const [splitLocationId, setSplitLocationId] = useState("");
  const [splitReason, setSplitReason] = useState("PREGNANCY_FAILED");
  // Register New Animal (directly into this batch)
  const [regNobId, setRegNobId] = useState("");
  const [regForm, setRegForm] = useState<Row>({
    lob_id: "", animal_type: "", gender: "", entry_type: "", entry_date: new Date().toISOString().slice(0, 10),
    breed_id: "", item_id: "", acquisition_cost: "", dob: "", ear_tag: "", rfid_tag: "",
    source_receipt_id: "", source_batch_id: "", notes: "", status: "ACTIVE",
  });
  const [regSaving, setRegSaving] = useState(false);
  const [regError, setRegError] = useState("");

  // Transfer Animal Modal — real pen relocation via PUT /animal/:id { current_location_id }
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [selectedAnimalForTransfer, setSelectedAnimalForTransfer] = useState<AnimalAssignmentRow | null>(null);
  const [targetLocationId, setTargetLocationId] = useState("");
  const [transferReason, setTransferReason] = useState("Stage Progression to Farrowing");
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferError, setTransferError] = useState("");

  // Removal — real unassign via PUT /animal/:id { current_batch_id: null }
  const [removingAnimalId, setRemovingAnimalId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState("");

  // CSV Import Modal (unchanged — bulk import UI is out of scope for this fix)
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvTagsText, setCsvTagsText] = useState("");

  const [toastMsg, setToastMsg] = useState("");

  // 1. Fetch live batches
  useEffect(() => {
    const companyId = getActiveCompanyId();
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.get(`/batch?companyId=${companyId}&status=ACTIVE&limit=50`)
      .then((res) => {
        const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
        const mapped: BatchOption[] = list.map((b: any) => ({
          id: b.batch_id,
          code: b.batch_no,
          breed: b.breed_name || b.breed_code || "—",
          stage: b.current_stage_code || "ACTIVE",
          period: b.start_date ? `${b.start_date} to ${b.expected_end_date || "ongoing"}` : "",
          lobId: b.lob_id || undefined,
          nobId: b.nob_id || undefined,
          breedId: b.breed_id || undefined,
          locationId: b.location_id || b.shed_id || undefined,
          stageId: b.stage_id || undefined,
          animalTracking: b.animal_tracking || "COUNT_ONLY",
        }));
        setBatches(mapped);
        if (mapped.length > 0) {
          setSelectedBatchId(mapped.find((batch) => batch.animalTracking === "REGISTERED")?.id || mapped[0].id);
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  // 2. Fetch animals actually assigned to the selected batch (real filter, real fields)
  const loadAssignedAnimals = () => {
    const companyId = getActiveCompanyId();
    if (!companyId || !selectedBatchId) { setAnimals([]); return; }
    api.get(`/animal?companyId=${companyId}&currentBatchId=${selectedBatchId}&limit=200`)
      .then((res) => {
        const list: any[] = unwrap<any[]>(res) || [];
        const mapped: AnimalAssignmentRow[] = list.map((a: any) => {
          const dob = a.dob || "";
          const ageDays = dob ? Math.max(0, Math.floor((Date.now() - new Date(dob).getTime()) / 86400000)) : 0;
          const loc = locations.find((l) => l.location_id === a.current_location_id);
          const breedRow = breeds.find((b) => b.breed_id === a.breed_id);
          const statusRaw = a.status || "ACTIVE";
          const status: AnimalAssignmentRow["status"] =
            ["CULLED", "DEAD", "SOLD", "SLAUGHTERED"].includes(statusRaw) ? "Culled" :
            ["QUARANTINE", "SICK"].includes(statusRaw) ? "Isolated" : "Active";
          return {
            id: a.animal_id,
            earTag: a.ear_tag || a.animal_code,
            animalId: a.animal_code,
            rfid: a.rfid_tag || undefined,
            sex: a.gender === "M" ? "Male (Boar)" : a.animal_type === "PIGLET" ? "Piglet" : a.animal_type === "GILT" ? "Female (Gilt)" : "Female (Sow)",
            breed: breedRow?.breed_name || breedRow?.breed_code || "—",
            dob: dob || "—",
            ageDays,
            entryDate: a.entry_date || "—",
            penLocation: loc?.location_name || loc?.location_code || "—",
            locationId: a.current_location_id || "",
            weightKg: Number(a.current_weight_kg) || 0,
            source: a.entry_type || "—",
            status,
          };
        });
        setAnimals(mapped);
      })
      .catch(() => setAnimals([]));
  };

  useEffect(loadAssignedAnimals, [selectedBatchId, locations, breeds]);

  // Reference data — loaded once on mount
  useEffect(() => {
    const companyId = getActiveCompanyId();
    const qs = companyId ? `?companyId=${companyId}&limit=500` : "?limit=500";
    api.get(`/setup/wizard/nobs${qs}`).then((r) => setNobs(unwrap<Row[]>(r) || [])).catch(() => undefined);
    api.get(`/location${qs}`).then((r) => setLocations(unwrap<Row[]>(r) || [])).catch(() => undefined);
    api.get(`/stage${qs}`).then((r) => setStages(unwrap<Row[]>(r) || [])).catch(() => undefined);
    api.get(`/item${qs}`).then((r) => setItems(unwrap<Row[]>(r) || [])).catch(() => undefined);
  }, []);

  // LOBs depend on the selected NOB in the "register new animal" form
  useEffect(() => {
    if (!regNobId) { setLobs([]); return; }
    api.get(`/setup/wizard/lobs/${regNobId}`).then((r) => setLobs(unwrap<Row[]>(r) || [])).catch(() => setLobs([]));
  }, [regNobId]);

  // Breeds depend on NOB + LOB in the "register new animal" form
  useEffect(() => {
    if (!regForm.lob_id) { setBreeds([]); return; }
    const qs = new URLSearchParams();
    const companyId = getActiveCompanyId();
    if (companyId) qs.set("companyId", companyId);
    if (regNobId) qs.set("nobId", regNobId);
    qs.set("lobId", regForm.lob_id);
    qs.set("limit", "200");
    api.get(`/breed?${qs.toString()}`).then((r) => setBreeds(unwrap<Row[]>(r) || [])).catch(() => undefined);
  }, [regForm.lob_id, regNobId]);

  // Default the "register new animal" form's NOB/LOB/Breed from the selected batch
  useEffect(() => {
    if (!currentBatch) return;
    setRegNobId(currentBatch.nobId || "");
    setRegForm((f) => ({ ...f, lob_id: currentBatch.lobId || "", breed_id: currentBatch.breedId || "" }));
  }, [currentBatch?.id]);

  const handleRegisterNew = async () => {
    setRegSaving(true);
    setRegError("");
    try {
      const companyId = getActiveCompanyId();
      if (!regNobId) throw new Error(t("anpErrNobRequired"));
      if (!regForm.lob_id) throw new Error(t("anpErrLobRequired"));
      if (!regForm.animal_type) throw new Error(t("anpErrAnimalTypeRequired"));
      if (!regForm.gender) throw new Error(t("anpErrGenderRequired"));
      if (!regForm.entry_type) throw new Error(t("anpErrEntryTypeRequired"));
      if (!regForm.entry_date) throw new Error(t("anpErrEntryDateRequired"));
      if (!regForm.breed_id) throw new Error(t("anpErrBreedRequired"));
      if (!regForm.item_id) throw new Error(t("anpErrItemRequired"));
      if (!regForm.acquisition_cost) throw new Error(t("anpErrAcquisitionCostRequired"));

      const res = await api.post("/animal", {
        company_id: companyId,
        nob_id: regNobId,
        lob_id: regForm.lob_id,
        animal_type: regForm.animal_type,
        gender: regForm.gender,
        entry_type: regForm.entry_type,
        entry_date: regForm.entry_date,
        breed_id: regForm.breed_id,
        item_id: regForm.item_id,
        acquisition_cost: Number(regForm.acquisition_cost),
        dob: regForm.dob || undefined,
        ear_tag: regForm.ear_tag || undefined,
        rfid_tag: regForm.rfid_tag || undefined,
        source_receipt_id: regForm.source_receipt_id || undefined,
        source_batch_id: regForm.source_batch_id || undefined,
        notes: regForm.notes || undefined,
        status: regForm.status || "ACTIVE",
        current_batch_id: selectedBatchId || undefined,
        current_location_id: currentBatch?.locationId || undefined,
        current_stage_id: currentBatch?.stageId || undefined,
      });
      const created = unwrap<Row>(res);

      setRegForm({
        lob_id: currentBatch?.lobId || "", animal_type: "", gender: "", entry_type: "", entry_date: new Date().toISOString().slice(0, 10),
        breed_id: currentBatch?.breedId || "", item_id: "", acquisition_cost: "", dob: "", ear_tag: "", rfid_tag: "",
        source_receipt_id: "", source_batch_id: "", notes: "", status: "ACTIVE",
      });
      setToastMsg(t("baapAnimalRegisteredToast", { tag: regForm.ear_tag || created?.ear_tag || "—", id: created?.animal_code || "" }));
      setTimeout(() => setToastMsg(""), 3500);
      loadAssignedAnimals();
    } catch (err: any) {
      setRegError(err?.message || t("anpErrRegisterAnimal"));
    } finally {
      setRegSaving(false);
    }
  };

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  /** Advance the selected animals to a stage — the tail-enders a batch-level
      move deliberately left behind, moved together instead of one at a time. */
  const handleBulkMove = async () => {
    if (selectedIds.size === 0 || !moveStageId) return;
    setGroupBusy(true);
    setGroupError("");
    try {
      const res: any = await api.post("/animal/bulk-transition-stage", {
        animal_ids: [...selectedIds],
        to_stage_id: moveStageId,
        to_location_id: moveLocationId || undefined,
        transition_date: new Date().toISOString().slice(0, 10),
        reason: moveReason || undefined,
      });
      const data = res?.data ?? res;
      setToastMsg(
        data?.failed?.length
          ? `${data.moved} moved · ${data.failed.length} could not move`
          : `${data?.moved ?? selectedIds.size} animal(s) moved.`,
      );
      setMoveOpen(false);
      setSelectedIds(new Set());
      loadAssignedAnimals();
    } catch (err: any) {
      setGroupError(err?.message || "Could not move the selected animals.");
    } finally {
      setGroupBusy(false);
    }
  };

  /** Hold the selected animals back as their own batch while the rest of the
      cohort moves on. The child keeps the parent's scheduler and records its
      own stage, so data entry and records work against it unchanged. */
  const handleSplit = async () => {
    if (selectedIds.size === 0 || !currentBatch?.id) return;
    setGroupBusy(true);
    setGroupError("");
    try {
      const res: any = await api.post(`/batch-transfer/split/${currentBatch.id}`, {
        animal_ids: [...selectedIds],
        transfer_date: new Date().toISOString().slice(0, 10),
        hold_stage_code: splitStageCode || undefined,
        to_location_id: splitLocationId || undefined,
        reason: splitReason || undefined,
      });
      const data = res?.data ?? res;
      setToastMsg(`Split into ${data?.child?.batch_no ?? "a new group"}.`);
      setSplitOpen(false);
      setSelectedIds(new Set());
      loadAssignedAnimals();
    } catch (err: any) {
      setGroupError(err?.message || "Could not split the selected animals.");
    } finally {
      setGroupBusy(false);
    }
  };

  const handleConfirmTransfer = async () => {
    if (!selectedAnimalForTransfer || !targetLocationId) return;
    setTransferSaving(true);
    setTransferError("");
    try {
      await api.put(`/animal/${selectedAnimalForTransfer.id}`, { current_location_id: targetLocationId });
      const destLabel = locations.find((l) => l.location_id === targetLocationId)?.location_name
        || locations.find((l) => l.location_id === targetLocationId)?.location_code
        || targetLocationId;
      setToastMsg(t("baapAnimalMovedToast", { tag: selectedAnimalForTransfer.earTag, pen: destLabel, reason: transferReason }));
      setTimeout(() => setToastMsg(""), 3500);
      setTransferModalOpen(false);
      setSelectedAnimalForTransfer(null);
      setTargetLocationId("");
      loadAssignedAnimals();
    } catch (err: any) {
      setTransferError(err?.message || t("baapErrMoveAnimal"));
    } finally {
      setTransferSaving(false);
    }
  };

  const handleRemoveAnimal = async (animal: AnimalAssignmentRow) => {
    if (!confirm(t("baapConfirmRemoveAnimal", { tag: animal.earTag }))) return;
    setRemovingAnimalId(animal.id);
    setRemoveError("");
    try {
      await api.put(`/animal/${animal.id}`, { current_batch_id: null });
      setToastMsg(t("baapAnimalRemovedToast", { tag: animal.earTag }));
      setTimeout(() => setToastMsg(""), 3500);
      loadAssignedAnimals();
    } catch (err: any) {
      setRemoveError(err?.message || t("baapErrRemoveAnimal"));
      setTimeout(() => setRemoveError(""), 4000);
    } finally {
      setRemovingAnimalId(null);
    }
  };

  const handleImportCsv = () => {
    if (!csvTagsText.trim()) return;
    const lines = csvTagsText.split("\n").filter((l) => l.trim().length > 0);
    const newRows: AnimalAssignmentRow[] = lines.map((line, idx) => {
      const parts = line.split(",").map((p) => p.trim());
      const tag = parts[0] || `ET-IMPORT-${idx + 1}`;
      const anId = parts[1] || `ANM-${tag}`;
      const pen = parts[2] || "Gestation Barn 1 / Row B";
      return {
        id: `csv-${Date.now()}-${idx}`,
        earTag: tag,
        animalId: anId,
        sex: "Female (Sow)",
        breed: currentBatch?.breed || "Large White",
        dob: "2024-05-01",
        ageDays: 290,
        entryDate: new Date().toISOString().slice(0, 10),
        penLocation: pen,
        locationId: "",
        weightKg: 195.0,
        source: "Batch Importer CSV",
        status: "Active",
      };
    });

    const updated = [...newRows, ...animals];
    setAnimals(updated);
    setCsvModalOpen(false);
    setCsvTagsText("");
    setToastMsg(t("baapImportedTagsToast", { count: String(newRows.length), code: currentBatch.code }));
    setTimeout(() => setToastMsg(""), 4000);
  };

  const filtered = animals.filter((a) => {
    const matchSearch =
      a.earTag.toLowerCase().includes(search.toLowerCase()) ||
      a.animalId.toLowerCase().includes(search.toLowerCase()) ||
      a.penLocation.toLowerCase().includes(search.toLowerCase()) ||
      (a.rfid && a.rfid.toLowerCase().includes(search.toLowerCase()));

    const matchSex = selectedSex === "All" || a.sex.includes(selectedSex);
    const matchStatus = selectedStatus === "All" || a.status === selectedStatus;
    return matchSearch && matchSex && matchStatus;
  });


  const activeCount = animals.filter((a) => a.status === "Active").length;
  const isolatedCount = animals.filter((a) => a.status === "Isolated").length;
  const transferredCount = animals.filter((a) => a.status === "Transferred").length;

  if (loading) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <p className="text-sm font-medium text-[var(--text-muted)]">{t("baapLoadingBatchesAnimals")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in text-[var(--text-primary)]">
      {/* ── Top Header Strip with Batch Selector ── */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4 shadow-2xs">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] shrink-0">
              {t("baapTargetBatch")}
            </span>
            <select
              value={selectedBatchId}
              onChange={(e) => {
                setSelectedBatchId(e.target.value);
                setActiveTab("assigned");
                setSelectedIds(new Set());
              }}
              className="max-w-[240px] sm:max-w-[320px] truncate rounded-[var(--radius-xs)] border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] focus:outline-none"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} ({b.breed})
                </option>
              ))}
            </select>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0"
              style={{
                backgroundColor: "var(--accent-muted)",
                color: "var(--accent)",
                borderColor: "rgba(194, 67, 50, 0.2)",
              }}
            >
              {t("baapActiveAssignment")}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1.5 truncate">
            {t("baapStageLabel")} <strong className="text-[var(--accent)]">{currentBatch?.stage || "—"}</strong> · {t("baapTimelineLabel")} <strong>{currentBatch?.period || "—"}</strong> · {t("baapAssignedLabel")} <strong className="text-[var(--text-primary)]">{t("baapHeadCount", { count: String(animals.length) })}</strong>
          </p>
        </div>

        {/* Quick Assignment KPI Strip & Actions */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="flex items-center gap-1 p-1.5 rounded-[var(--radius-sm)] border text-xs" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
            <div className="text-center px-2.5 border-r" style={{ borderColor: "var(--border)" }}>
              <span className="text-[9px] uppercase font-semibold block" style={{ color: "var(--text-secondary)" }}>{t("baapKpiTotal")}</span>
              <span className="font-mono font-bold" style={{ color: "var(--text-primary)" }}>{animals.length}</span>
            </div>
            <div className="text-center px-2.5 border-r" style={{ borderColor: "var(--border)" }}>
              <span className="text-[9px] uppercase font-semibold block" style={{ color: "var(--text-secondary)" }}>{t("baapKpiActive")}</span>
              <span className="font-mono font-bold" style={{ color: "var(--success)" }}>{activeCount}</span>
            </div>
            <div className="text-center px-2.5 border-r" style={{ borderColor: "var(--border)" }}>
              <span className="text-[9px] uppercase font-semibold block" style={{ color: "var(--text-secondary)" }}>{t("baapKpiIsolated")}</span>
              <span className="font-mono font-bold" style={{ color: "var(--warning)" }}>{isolatedCount}</span>
            </div>
            <div className="text-center px-2.5">
              <span className="text-[9px] uppercase font-semibold block" style={{ color: "var(--text-secondary)" }}>{t("baapKpiTransferred")}</span>
              <span className="font-mono font-bold" style={{ color: "var(--text-primary)" }}>{transferredCount}</span>
            </div>
          </div>

        </div>
      </div>

      {!isRegisteredBatch && (
        <InlineAlert variant="info">
          This is a Count Only batch. Its headcount is maintained on the Batch record; individual Animal Register rows are not assigned here.
        </InlineAlert>
      )}

      {toastMsg && (
        <div
          className="p-3 text-xs font-semibold rounded-[var(--radius-sm)] border flex items-center gap-2 animate-in fade-in"
          style={{
            backgroundColor: "var(--success-muted)",
            color: "var(--success)",
            borderColor: "rgba(47, 125, 91, 0.2)",
          }}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ── Action Tabs ── */}
      <div className="flex items-center gap-1 border-b border-[var(--border)] text-xs font-semibold overflow-x-auto">
        <button
          onClick={() => setActiveTab("assigned")}
          className={`px-4 py-2.5 border-b-2 font-medium transition-colors whitespace-nowrap ${
            activeTab === "assigned"
              ? "border-[var(--accent)] text-[var(--accent)] font-bold"
              : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {t("baapAssignedHerdAnimalsTab", { count: String(animals.length) })}
        </button>
      </div>

      {/* ── TAB 1: ASSIGNED ANIMALS TABLE ── */}
      {activeTab === "assigned" && (
        <div className="space-y-4">
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3.5 py-2.5">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                {selectedIds.size} selected
              </span>
              <Button size="sm" variant="outline" onClick={() => { setGroupError(""); setMoveOpen(true); }}>
                Move to stage…
              </Button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Clear
              </button>
            </div>
          )}
          {/* Filter Bar */}
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-3 flex-wrap flex-1">
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">{t("baapSexLabel")}</span>
                <select
                  value={selectedSex}
                  onChange={(e) => setSelectedSex(e.target.value)}
                  className="rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
                >
                  <option value="All">{t("baapAllGenders")}</option>
                  <option value="Sow">{t("baapFemaleSow")}</option>
                  <option value="Gilt">{t("baapFemaleGilt")}</option>
                  <option value="Boar">{t("baapMaleBoar")}</option>
                  <option value="Piglet">{t("baapPiglet")}</option>
                </select>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">{t("baapStatusLabel")}</span>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-1 text-xs text-[var(--text-primary)]"
                >
                  <option value="All">{t("baapAllStatuses")}</option>
                  <option value="Active">{t("baapStatusActive")}</option>
                  <option value="Isolated">{t("baapStatusIsolated")}</option>
                  <option value="Transferred">{t("baapStatusTransferred")}</option>
                  <option value="Culled">{t("baapStatusCulled")}</option>
                </select>
              </div>
            </div>

            {/* Search */}
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder={t("baapSearchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="nf-input pl-8 w-full text-xs"
              />
            </div>
          </div>

          {/* Table */}
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-raised)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                    <th className="px-3 py-2.5 font-bold">
                      <input
                        type="checkbox"
                        aria-label="Select all animals"
                        checked={filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id))}
                        onChange={(e) =>
                          setSelectedIds(e.target.checked ? new Set(filtered.map((a) => a.id)) : new Set())
                        }
                      />
                    </th>
                    <th className="px-4 py-2.5 font-bold">{t("baapColHash")}</th>
                    <th className="px-4 py-2.5 font-bold">{t("baapColEarTagRfid")}</th>
                    <th className="px-4 py-2.5 font-bold">{t("baapColAnimalId")}</th>
                    <th className="px-4 py-2.5 font-bold">{t("baapColGenderBreed")}</th>
                    <th className="px-4 py-2.5 font-bold">{t("baapColDobAge")}</th>
                    <th className="px-4 py-2.5 font-bold">{t("baapColCurrentPen")}</th>
                    <th className="px-4 py-2.5 font-bold text-right">{t("baapColWeightKg")}</th>
                    <th className="px-4 py-2.5 font-bold">{t("baapColSource")}</th>
                    <th className="px-4 py-2.5 font-bold">{t("baapColStatus")}</th>
                    <th className="px-4 py-2.5 font-bold text-right">{t("baapColActions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-[var(--text-muted)]">
                        {t("baapNoAnimalsFound", { code: currentBatch?.code || "" })}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((animal, idx) => (
                      <tr key={animal.id} className="hover:bg-[var(--surface-raised)]/80 transition-colors">
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            aria-label={`Select ${animal.earTag}`}
                            checked={selectedIds.has(animal.id)}
                            onChange={() => toggleSelected(animal.id)}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-[var(--text-muted)]">{idx + 1}</td>
                        <td className="px-4 py-2.5">
                          <span className="font-mono font-bold text-[var(--accent)] block">{animal.earTag}</span>
                          {animal.rfid && <span className="text-[10px] text-[var(--text-muted)] font-mono">{animal.rfid}</span>}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)]">{animal.animalId}</td>
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-[var(--text-primary)] block">{animal.sex}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">{animal.breed}</span>
                        </td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                          <span>{animal.dob}</span>
                          <span className="block text-[10px] font-semibold text-[var(--text-muted)] font-mono">{t("baapDaysCount", { count: String(animal.ageDays) })}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                            <Warehouse className="w-3 h-3 text-[var(--text-muted)]" />
                            {animal.penLocation}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-[var(--text-primary)]">
                          {animal.weightKg ? `${animal.weightKg.toFixed(1)} kg` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{animal.source}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              animal.status === "Active"
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                : animal.status === "Isolated"
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                                : "bg-slate-500/10 text-[var(--text-muted)]"
                            }`}
                          >
                            <CheckCircle className="w-3 h-3" /> {animal.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="text-[10px] text-[var(--text-muted)]">Use Batch Transfer</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 bg-[var(--surface-raised)] border-t border-[var(--border)] flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span>{t("baapShowingAssignedAnimals", { filtered: String(filtered.length), total: String(animals.length) })}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: ADD / ASSIGN ANIMALS ── */}
      {activeTab === "add" && (
        <div className="space-y-4">
          {/* ── Register a new animal directly into this batch ── */}
          <div className="p-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-4 shadow-2xs">
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--border)" }}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
                <Plus className="w-4 h-4 text-[var(--accent)]" /> {t("baapAddIndividualAnimalTitle", { code: currentBatch?.code || "" })}
              </h3>
            </div>

            {regError && <InlineAlert variant="danger">{regError}</InlineAlert>}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
              <div>
                <label className="font-semibold block mb-1">{t("anpNatureOfBusiness")}</label>
                <select className="nf-input w-full" value={regNobId} onChange={(e) => { setRegNobId(e.target.value); setRegForm((f) => ({ ...f, lob_id: "" })); }}>
                  <option value="">{t("anpSelectPlaceholder")}</option>
                  {nobs.map((n) => <option key={n.nob_id} value={n.nob_id}>{n.nob_name}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("anpLineOfBusiness")}</label>
                <select className="nf-input w-full" value={regForm.lob_id} onChange={(e) => setRegForm((f) => ({ ...f, lob_id: e.target.value }))}>
                  <option value="">{t("anpSelectNobFirst")}</option>
                  {lobs.map((l) => <option key={l.lob_id} value={l.lob_id}>{l.lob_name}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("anpAnimalType")}</label>
                <select className="nf-input w-full" value={regForm.animal_type} onChange={(e) => setRegForm((f) => ({ ...f, animal_type: e.target.value }))}>
                  <option value="">{t("anpSelectPlaceholder")}</option>
                  {ANIMAL_TYPES.map((tp) => <option key={tp} value={tp}>{tp.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("anpGender")}</label>
                <select className="nf-input w-full" value={regForm.gender} onChange={(e) => setRegForm((f) => ({ ...f, gender: e.target.value }))}>
                  <option value="">{t("anpSelectPlaceholder")}</option>
                  {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("anpEntryType")}</label>
                <select className="nf-input w-full" value={regForm.entry_type} onChange={(e) => setRegForm((f) => ({ ...f, entry_type: e.target.value }))}>
                  <option value="">{t("anpSelectPlaceholder")}</option>
                  {ENTRY_TYPES.map((tp) => <option key={tp} value={tp}>{tp.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("anpEntryDate")}</label>
                <input type="date" className="nf-input w-full" value={regForm.entry_date} onChange={(e) => setRegForm((f) => ({ ...f, entry_date: e.target.value }))} />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("anpBreed")}</label>
                <select className="nf-input w-full" value={regForm.breed_id} onChange={(e) => setRegForm((f) => ({ ...f, breed_id: e.target.value }))}>
                  <option value="">{t("anpSelectLobFirst")}</option>
                  {breeds.map((b) => <option key={b.breed_id} value={b.breed_id}>{b.breed_name}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("anpItemLivingAsset")}</label>
                <select className="nf-input w-full" value={regForm.item_id} onChange={(e) => setRegForm((f) => ({ ...f, item_id: e.target.value }))}>
                  <option value="">{t("anpSelectPlaceholder")}</option>
                  {items.filter((i) => i.item_type === "LIVING_ASSET" || !i.item_type).map((i) => <option key={i.item_id} value={i.item_id}>{i.item_name}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("anpAcquisitionCost")}</label>
                <input type="number" min="0" step="0.01" className="nf-input w-full font-mono" placeholder="0.00" value={regForm.acquisition_cost} onChange={(e) => setRegForm((f) => ({ ...f, acquisition_cost: e.target.value }))} />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("anpDateOfBirth")}</label>
                <input type="date" className="nf-input w-full" value={regForm.dob} onChange={(e) => setRegForm((f) => ({ ...f, dob: e.target.value }))} />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("baapEarTagNumberLabel")}</label>
                <input type="text" className="nf-input w-full font-mono font-bold" placeholder={t("baapEarTagPlaceholder1")} value={regForm.ear_tag} onChange={(e) => setRegForm((f) => ({ ...f, ear_tag: e.target.value }))} />
              </div>
              <div>
                <label className="font-semibold block mb-1">{t("anpRfidTag")}</label>
                <input type="text" className="nf-input w-full font-mono" placeholder={t("baapRfidPlaceholder")} value={regForm.rfid_tag} onChange={(e) => setRegForm((f) => ({ ...f, rfid_tag: e.target.value }))} />
              </div>

              {["PURCHASED_IMPORTED", "PURCHASED_LOCAL"].includes(regForm.entry_type) && (
                <div>
                  <label className="font-semibold block mb-1">{t("anpSourceReceiptId")}</label>
                  <input type="text" className="nf-input w-full" value={regForm.source_receipt_id} onChange={(e) => setRegForm((f) => ({ ...f, source_receipt_id: e.target.value }))} />
                </div>
              )}

              <div className="sm:col-span-3">
                <label className="font-semibold block mb-1">{t("anpNotes")}</label>
                <textarea className="nf-input w-full" rows={2} value={regForm.notes} onChange={(e) => setRegForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
              <Button onClick={handleRegisterNew} disabled={regSaving} className="nf-btn-primary text-xs">
                {regSaving ? t("anpSaving") : t("baapAssignAnimalToBatchButton")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: PEN MOVEMENTS ── */}
      {activeTab === "transfer" && (
        <div className="p-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-4 shadow-2xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-indigo-500" /> {t("baapInternalPenRelocationTitle")}
          </h3>
          <p className="text-xs text-[var(--text-secondary)]">
            {t("baapSelectAnimalTransferDesc")}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
            {animals.slice(0, 6).map((a) => (
              <div key={a.id} className="p-3 rounded-[var(--radius-xs)] bg-[var(--surface-raised)] border border-[var(--border)] text-xs flex justify-between items-center">
                <div>
                  <span className="font-mono font-bold text-[var(--accent)]">{a.earTag}</span>
                  <span className="text-[11px] text-[var(--text-secondary)] block">{a.penLocation}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedAnimalForTransfer(a);
                    setTargetLocationId(a.locationId);
                    setTransferError("");
                    setTransferModalOpen(true);
                  }}
                  className="h-6 text-[10px] px-2"
                >
                  {t("baapRelocateButton")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 4: REMOVALS & CULLS ── */}
      {activeTab === "removal" && (
        <div className="p-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] space-y-4 shadow-2xs">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500" /> {t("baapAnimalRemovalsTitle")}
          </h3>
          <p className="text-xs text-[var(--text-secondary)]">
            {t("baapRemovalsDesc")}
          </p>

          {removeError && <InlineAlert variant="danger">{removeError}</InlineAlert>}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
            {animals.map((a) => (
              <div key={a.id} className="p-3 rounded-[var(--radius-xs)] bg-[var(--surface-raised)] border border-[var(--border)] text-xs flex justify-between items-center">
                <div>
                  <span className="font-mono font-bold text-[var(--text-primary)]">{a.earTag}</span>
                  <span className="text-[11px] text-[var(--text-secondary)] block">{a.sex} · {a.penLocation}</span>
                </div>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleRemoveAnimal(a)}
                  disabled={removingAnimalId === a.id}
                  className="h-6 text-[10px] px-2"
                >
                  {removingAnimalId === a.id ? t("anpSaving") : t("baapRemoveCullButton")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MODAL: TRANSFER PEN ── */}
      {transferModalOpen && selectedAnimalForTransfer && (
        <Dialog
          open={transferModalOpen}
          onClose={() => setTransferModalOpen(false)}
          title={t("baapRelocateAnimalTitle", { tag: selectedAnimalForTransfer.earTag })}
          maxWidth="sm"
          footer={
            <Button size="sm" onClick={handleConfirmTransfer} disabled={transferSaving || !targetLocationId} className="nf-btn-primary">
              {transferSaving ? t("anpSaving") : t("baapRecordPenMovementButton")}
            </Button>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            {transferError && <InlineAlert variant="danger">{transferError}</InlineAlert>}

            <p className="text-[var(--text-secondary)]">
              {t("baapCurrentLocationLabel")} <strong className="text-[var(--text-primary)]">{selectedAnimalForTransfer.penLocation}</strong>
            </p>

            <div>
              <label className="font-semibold block mb-1">{t("baapNewDestinationPenLabel")}</label>
              <select
                value={targetLocationId}
                onChange={(e) => setTargetLocationId(e.target.value)}
                className="nf-input w-full"
              >
                <option value="">{t("baapDestinationPenPlaceholder")}</option>
                {locations.map((l) => (
                  <option key={l.location_id} value={l.location_id}>
                    {l.location_name || l.location_code}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-semibold block mb-1">{t("baapTransferPurposeLabel")}</label>
              <input
                type="text"
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                placeholder={t("baapTransferPurposePlaceholder")}
                className="nf-input w-full"
              />
            </div>
          </div>
        </Dialog>
      )}

      {/* Advance a selected group to a stage — the tail-enders a batch-level
          move left behind, moved together rather than one modal each. */}
      <Dialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title={`Move ${selectedIds.size} animal(s) to a stage`}
        maxWidth="sm"
        footer={
          <Button size="sm" className="nf-btn-primary" onClick={handleBulkMove} disabled={groupBusy || !moveStageId}>
            {groupBusy ? "Moving…" : "Move animals"}
          </Button>
        }
      >
        <div className="space-y-3">
          {groupError && <p className="text-xs text-[var(--danger)]">{groupError}</p>}
          <label className="block">
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">Destination stage</span>
            <select value={moveStageId} onChange={(e) => setMoveStageId(e.target.value)} className="nf-input-sm nf-select w-full">
              <option value="">Select a stage…</option>
              {stages.map((st: any) => (
                <option key={st.stage_id} value={st.stage_id}>{st.stage_code} — {st.stage_name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">Destination pen (optional)</span>
            <select value={moveLocationId} onChange={(e) => setMoveLocationId(e.target.value)} className="nf-input-sm nf-select w-full">
              <option value="">Leave where they are</option>
              {locations.map((l: any) => (
                <option key={l.location_id} value={l.location_id}>{l.location_code} — {l.location_name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">Reason (overrides the minimum-days check)</span>
            <input value={moveReason} onChange={(e) => setMoveReason(e.target.value)} className="nf-input-sm w-full" placeholder="e.g. Re-served and confirmed pregnant" />
          </label>
          <p className="text-[11px] text-[var(--text-muted)]">
            Animals short of their stage minimum are reported back and skipped; the rest still move.
          </p>
        </div>
      </Dialog>

      {/* Hold a group back as its own batch while the cohort moves on. */}
      <Dialog
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        title={`Hold ${selectedIds.size} animal(s) back as a split group`}
        maxWidth="sm"
        footer={
          <Button size="sm" className="nf-btn-primary" onClick={handleSplit} disabled={groupBusy}>
            {groupBusy ? "Splitting…" : "Create split group"}
          </Button>
        }
      >
        <div className="space-y-3">
          {groupError && <p className="text-xs text-[var(--danger)]">{groupError}</p>}
          <p className="text-[11px] text-[var(--text-muted)]">
            These animals become their own batch, keeping {currentBatch?.code || "the batch"}&rsquo;s schedule.
            The rest of the cohort moves on without them. Merge them back from the batch list when they are ready.
          </p>
          <label className="block">
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">Stage the group holds at</span>
            <select value={splitStageCode} onChange={(e) => setSplitStageCode(e.target.value)} className="nf-input-sm nf-select w-full">
              <option value="">Keep the batch&rsquo;s current stage</option>
              {stages.map((st: any) => (
                <option key={st.stage_id} value={st.stage_code}>{st.stage_code} — {st.stage_name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">Pen (optional)</span>
            <select value={splitLocationId} onChange={(e) => setSplitLocationId(e.target.value)} className="nf-input-sm nf-select w-full">
              <option value="">Keep the batch&rsquo;s pen</option>
              {locations.map((l: any) => (
                <option key={l.location_id} value={l.location_id}>{l.location_code} — {l.location_name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block mb-1">Reason</span>
            <input value={splitReason} onChange={(e) => setSplitReason(e.target.value)} className="nf-input-sm w-full" placeholder="e.g. PREGNANCY_FAILED" />
          </label>
        </div>
      </Dialog>

      {/* ── MODAL: CSV EAR TAG IMPORT ── */}
      {csvModalOpen && (
        <Dialog
          open={csvModalOpen}
          onClose={() => setCsvModalOpen(false)}
          title={t("baapImportEarTagsCsvTitle")}
          maxWidth="md"
          footer={
            <Button size="sm" onClick={handleImportCsv} className="nf-btn-primary">
              {t("baapImportAnimalsButton")}
            </Button>
          }
        >
          <div className="space-y-3 text-xs pt-1">
            <p className="text-[var(--text-secondary)]">
              {t("baapPasteLinesDesc")} <code className="text-[var(--accent)] font-mono">{t("gCsvHeaderHint")}</code>:
            </p>
            <textarea
              rows={5}
              value={csvTagsText}
              onChange={(e) => setCsvTagsText(e.target.value)}
              placeholder="ET-25-0010, SOW-LW-010, Gestation Barn 1 / Pen B-10&#10;ET-25-0011, SOW-LW-011, Gestation Barn 1 / Pen B-11"
              className="nf-input w-full font-mono text-xs"
            />
          </div>
        </Dialog>
      )}
    </div>
  );
}
