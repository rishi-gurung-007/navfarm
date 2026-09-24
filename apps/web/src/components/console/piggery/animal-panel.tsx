"use client";

import { useEffect, useState } from "react";
import {
  Plus, Search, Loader2, Inbox, Eye, Trash2, Pill, AlertCircle, ChevronRight, Scan, ArrowRight,
} from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { StatusBadge } from "@/components/ui/status-badge";
import RfidScannerModal from "@/components/console/piggery/rfid-scanner-modal";
import AnimalStageTransitionModal from "@/components/console/piggery/animal-stage-transition-modal";
import {
  TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;
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

const inputCls = "nf-input";

const STATUS_LABEL_KEY: Record<string, TranslationKeys> = {
  ACTIVE: "anpStatusActive",
  QUARANTINE: "anpStatusQuarantine",
  SICK: "anpStatusSick",
  PREGNANT: "anpStatusPregnant",
  LACTATING: "anpStatusLactating",
  DRY: "anpStatusDry",
  CULLED: "anpStatusCulled",
  DEAD: "anpStatusDead",
  SOLD: "anpStatusSold",
  SLAUGHTERED: "anpStatusSlaughtered",
};

const ANIMAL_TYPES = ["SOW", "BOAR", "GILT", "PIGLET", "COMMERCIAL_PIG"];
const ANIMAL_TYPE_LABEL_KEY: Record<string, TranslationKeys> = {
  SOW: "anpTypeSow",
  BOAR: "anpTypeBoar",
  GILT: "anpTypeGilt",
  PIGLET: "anpTypePiglet",
  COMMERCIAL_PIG: "anpTypeCommercialPig",
};

const GENDERS = [{ value: "F", label: "Female" }, { value: "M", label: "Male" }];

const ENTRY_TYPES = ["PURCHASED_IMPORTED", "PURCHASED_LOCAL", "BORN_ON_FARM", "TRANSFERRED_IN"];
const ENTRY_TYPE_LABEL_KEY: Record<string, TranslationKeys> = {
  PURCHASED_IMPORTED: "anpEntryPurchasedImported",
  PURCHASED_LOCAL: "anpEntryPurchasedLocal",
  BORN_ON_FARM: "anpEntryBornOnFarm",
  TRANSFERRED_IN: "anpEntryTransferredIn",
};

const DISPOSAL_TYPES = ["SOLD", "SLAUGHTERED", "DIED", "TRANSFERRED"] as const;
const DISPOSAL_TYPE_LABEL_KEY: Record<string, TranslationKeys> = {
  SOLD: "anpDisposalSold",
  SLAUGHTERED: "anpDisposalSlaughtered",
  DIED: "anpDisposalDied",
  TRANSFERRED: "anpDisposalTransferred",
};

const LEDGER_ENTRY_TYPE_LABEL_KEY: Record<string, TranslationKeys> = {
  ACQUISITION: "anpLedgerAcquisition",
  AMORTIZATION: "anpLedgerAmortization",
  TRANSFORMATION: "anpLedgerTransformation",
  DISPOSAL: "anpLedgerDisposal",
};

function formatDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

// ── Withdrawal warning banner ─────────────────────────────────────────────────
// The API returns a 400 with a message like:
//   "Cannot slaughter — withdrawal period not elapsed for: Ivermectin (3 day(s) remaining, last dose 2026-08-15); Oxytetracycline (1 day(s) remaining, last dose 2026-08-18)"
// We parse and render that as structured rows rather than a raw toast.

function WithdrawalWarning({ message, t }: { message: string; t: (key: TranslationKeys, vars?: any) => string }) {
  // Strip the prefix up to the colon after "for:", then split on ";"
  const afterColon = message.replace(/^Cannot slaughter[^:]*:\s*/, "");
  const items = afterColon.split(";").map((s) => s.trim()).filter(Boolean);
  return (
    <div
      className="rounded-[var(--radius-md)] border p-4"
      style={S.danger}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t("anpCannotSlaughterHeading")}</p>
          {items.length > 0 && (
            <ul className="mt-2 space-y-1">
              {items.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnimalPanel() {
  const { formatMoney } = useCompanyCurrency();
  const { t } = useLanguage();
  const companyId = getActiveCompanyId();

  const genderLabel = (g?: string) => (g === "F" ? t("anpGenderFemale") : g === "M" ? t("anpGenderMale") : g || "");
  const statusLabel = (s?: string) => (s && STATUS_LABEL_KEY[s] ? t(STATUS_LABEL_KEY[s]) : (s || "").replace(/_/g, " "));
  const animalTypeLabel = (v?: string) => (v && ANIMAL_TYPE_LABEL_KEY[v] ? t(ANIMAL_TYPE_LABEL_KEY[v]) : (v || "").replace(/_/g, " "));
  const entryTypeLabel = (v?: string) => (v && ENTRY_TYPE_LABEL_KEY[v] ? t(ENTRY_TYPE_LABEL_KEY[v]) : (v || "").replace(/_/g, " "));
  const disposalTypeLabel = (v?: string) => (v && DISPOSAL_TYPE_LABEL_KEY[v] ? t(DISPOSAL_TYPE_LABEL_KEY[v]) : (v || ""));
  const ledgerEntryTypeLabel = (v?: string) => (v && LEDGER_ENTRY_TYPE_LABEL_KEY[v] ? t(LEDGER_ENTRY_TYPE_LABEL_KEY[v]) : (v || "").replace(/_/g, " "));

  // ── List state ──────────────────────────────────────────────────────────────
  const [rows, setRows]         = useState<Row[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [search, setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [includeDisposed, setIncludeDisposed] = useState(false);
  const [page, setPage]         = useState(1);
  const [pageSize]              = useState(PAGE_SIZE);

  // ── Reference data ──────────────────────────────────────────────────────────
  const [nobs, setNobs]       = useState<Row[]>([]);
  const [lobs, setLobs]       = useState<Row[]>([]);
  const [breeds, setBreeds]   = useState<Row[]>([]);
  // `breeds` above is LOB-scoped and only populated inside the Register-Animal
  // form, so the list table could never resolve a name from it — the raw
  // breed_id UUID leaked into the Breed column. This is the table's own
  // company-wide lookup, loaded once on mount.
  const [breedLookup, setBreedLookup] = useState<Record<string, string>>({});
  const breedName = (id?: string | null) => (id && breedLookup[id]) || id || "—";
  const [items, setItems]     = useState<Row[]>([]);
  const [medItems, setMedItems] = useState<Row[]>([]); // MEDICINE + VACCINE filtered
  const [uoms, setUoms]       = useState<Row[]>([]);
  const [batches, setBatches] = useState<Row[]>([]);
  const [stages, setStages]   = useState<Row[]>([]);
  const [locations, setLocations] = useState<Row[]>([]);
  const [reasons, setReasons] = useState<Row[]>([]);

  // ── Fast Scanner Modal ──────────────────────────────────────────────────
  const [scannerOpen, setScannerOpen] = useState(false);

  // ── Stage Transition Modal ──────────────────────────────────────────────
  const [transitionOpen, setTransitionOpen]     = useState(false);
  const [transitionAnimal, setTransitionAnimal] = useState<Row | null>(null);

  // ── Create animal modal ─────────────────────────────────────────────────────
  const [createOpen, setCreateOpen]   = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError]   = useState("");
  const [createNobId, setCreateNobId]   = useState("");
  const [createForm, setCreateForm]     = useState<Row>({
    animal_type: "", gender: "", entry_type: "", entry_date: new Date().toISOString().slice(0, 10),
    breed_id: "", item_id: "", acquisition_cost: "", dob: "", ear_tag: "", rfid_tag: "",
    source_receipt_id: "", source_batch_id: "", notes: "", status: "ACTIVE",
  });

  // ── Detail modal ────────────────────────────────────────────────────────────
  const [viewing, setViewing]     = useState<Row | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "medications" | "valuation">("overview");

  // ── Medication log ──────────────────────────────────────────────────────────
  const [medLogs, setMedLogs]         = useState<Row[]>([]);
  const [medLoading, setMedLoading]   = useState(false);
  const [medError, setMedError]       = useState("");

  // ── Bio-Asset Ledger ────────────────────────────────────────────────────────
  const [ledgerEntries, setLedgerEntries] = useState<Row[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError]     = useState("");

  // ── Log dose modal ──────────────────────────────────────────────────────────
  const [doseOpen, setDoseOpen]       = useState(false);
  const [doseSaving, setDoseSaving]   = useState(false);
  const [doseError, setDoseError]     = useState("");
  const [doseForm, setDoseForm]       = useState<Row>({
    item_id: "", administered_date: new Date().toISOString().slice(0, 10),
    dose_qty: "", uom: "", administered_by: "", notes: "",
  });

  // ── Dispose modal ───────────────────────────────────────────────────────────
  const [disposeOpen, setDisposeOpen]   = useState(false);
  const [disposeSaving, setDisposeSaving] = useState(false);
  const [disposeError, setDisposeError]   = useState("");
  const [disposeIsWithdrawal, setDisposeIsWithdrawal] = useState(false);
  const [disposeForm, setDisposeForm]   = useState<Row>({
    disposal_type: "SOLD", disposal_date: new Date().toISOString().slice(0, 10),
    disposal_value: "", disposal_reason_id: "", notes: "",
  });

  // ── Data loading ────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (includeDisposed) params.set("includeDisposed", "true");
      params.set("limit", "200");
      const res = await api.get(`/animal?${params.toString()}`);
      setRows(unwrap<Row[]>(res) || []);
      setPage(1);
    } catch (err: any) {
      setError(err?.message || t("anpErrLoadAnimals"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [search, statusFilter, includeDisposed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reference data — loaded once on mount
  useEffect(() => {
    const qs = companyId ? `?companyId=${companyId}&limit=500` : "?limit=500";
    api.get(`/setup/wizard/nobs${qs}`).then((r) => setNobs(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/uom${qs}`).then((r) => setUoms(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/batch${qs}`).then((r) => setBatches(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/stage?limit=100`).then((r) => setStages(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/location${qs}`).then((r) => setLocations(unwrap<Row[]>(r) || [])).catch(() => {});
    // Reason Master Template (Master Templates/, added 2026-09-21) — MORTALITY
    // and CULL reasons belong on this same Dispose action; isActive filters to
    // rows the admin hasn't blocked.
    api.get(`/reason?${qs.replace(/^\?/, "?isActive=true&")}`).then((r) => setReasons(unwrap<Row[]>(r) || [])).catch(() => {});
    // Items — scoped for medicine/vaccine picker separately from living-asset picker
    api.get(`/item${qs}`).then((r) => {
      const all = unwrap<Row[]>(r) || [];
      setItems(all);
      setMedItems(all.filter((i: Row) => ["MEDICINE", "VACCINE"].includes(i.item_type)));
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // LOBs depend on selected NOB (create form)
  useEffect(() => {
    if (!createNobId) { setLobs([]); return; }
    api.get(`/setup/wizard/lobs/${createNobId}`).then((r) => setLobs(unwrap<Row[]>(r) || [])).catch(() => setLobs([]));
  }, [createNobId]);

  // Company-wide breed names for the list table (see breedLookup above).
  useEffect(() => {
    const qs = new URLSearchParams();
    if (companyId) qs.set("companyId", companyId);
    qs.set("limit", "500");
    api.get(`/breed?${qs.toString()}`)
      .then((r) => {
        const list = unwrap<Row[]>(r) || [];
        setBreedLookup(Object.fromEntries(list.map((b) => [b.breed_id, b.breed_name])));
      })
      .catch(() => setBreedLookup({}));
  }, [companyId]);

  // Breeds depend on LOB
  useEffect(() => {
    if (!createForm.lob_id) { setBreeds([]); return; }
    const qs = new URLSearchParams();
    if (companyId) qs.set("companyId", companyId);
    if (createNobId) qs.set("nobId", createNobId);
    if (createForm.lob_id) qs.set("lobId", createForm.lob_id);
    qs.set("limit", "200");
    api.get(`/breed?${qs.toString()}`).then((r) => setBreeds(unwrap<Row[]>(r) || [])).catch(() => {});
  }, [createForm.lob_id, createNobId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Medication logs — loaded when opening the medications tab
  const loadMedLogs = async (animalId: string) => {
    setMedLoading(true);
    setMedError("");
    try {
      const res = await api.get(`/animal/${animalId}/medications`);
      setMedLogs(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setMedError(err?.message || t("anpErrLoadMedications"));
    } finally {
      setMedLoading(false);
    }
  };

  // Bio-Asset Ledger entries — loaded when opening the valuation tab
  const loadBioAssetLedger = async (animalId: string) => {
    setLedgerLoading(true);
    setLedgerError("");
    try {
      const res = await api.get(`/animal/${animalId}/bio-asset-ledger`);
      setLedgerEntries(unwrap<Row[]>(res) || []);
    } catch (err: any) {
      setLedgerError(err?.message || t("anpErrLoadLedger"));
    } finally {
      setLedgerLoading(false);
    }
  };

  // ── Handlers ────────────────────────────────────────────────────────────────

  const openView = async (row: Row) => {
    const res = await api.get(`/animal/${row.animal_id}`);
    setViewing(unwrap<Row>(res));
    setDetailTab("overview");
    setMedLogs([]);
    setLedgerEntries([]);
  };

  const handleDetailTabChange = (tab: "overview" | "medications" | "valuation") => {
    setDetailTab(tab);
    if (tab === "medications" && viewing) loadMedLogs(viewing.animal_id);
    if (tab === "valuation" && viewing) loadBioAssetLedger(viewing.animal_id);
  };


  const handleCreate = async () => {
    setCreateSaving(true);
    setCreateError("");
    try {
      if (!createNobId) throw new Error(t("anpErrNobRequired"));
      if (!createForm.lob_id) throw new Error(t("anpErrLobRequired"));
      if (!createForm.animal_type) throw new Error(t("anpErrAnimalTypeRequired"));
      if (!createForm.gender) throw new Error(t("anpErrGenderRequired"));
      if (!createForm.entry_type) throw new Error(t("anpErrEntryTypeRequired"));
      if (!createForm.entry_date) throw new Error(t("anpErrEntryDateRequired"));
      if (!createForm.breed_id) throw new Error(t("anpErrBreedRequired"));
      if (!createForm.item_id) throw new Error(t("anpErrItemRequired"));
      if (!createForm.acquisition_cost) throw new Error(t("anpErrAcquisitionCostRequired"));

      await api.post("/animal", {
        company_id: companyId,
        nob_id: createNobId,
        lob_id: createForm.lob_id,
        animal_type: createForm.animal_type,
        gender: createForm.gender,
        entry_type: createForm.entry_type,
        entry_date: createForm.entry_date,
        breed_id: createForm.breed_id,
        item_id: createForm.item_id,
        acquisition_cost: Number(createForm.acquisition_cost),
        dob: createForm.dob || undefined,
        ear_tag: createForm.ear_tag || undefined,
        rfid_tag: createForm.rfid_tag || undefined,
        source_receipt_id: createForm.source_receipt_id || undefined,
        source_batch_id: createForm.source_batch_id || undefined,
        notes: createForm.notes || undefined,
        status: createForm.status || "ACTIVE",
      });
      setCreateOpen(false);
      load();
    } catch (err: any) {
      setCreateError(err?.message || t("anpErrRegisterAnimal"));
    } finally {
      setCreateSaving(false);
    }
  };

  const handleLogDose = async () => {
    if (!viewing) return;
    setDoseSaving(true);
    setDoseError("");
    try {
      if (!doseForm.item_id) throw new Error(t("anpErrSelectMedicine"));
      if (!doseForm.administered_date) throw new Error(t("anpErrAdministeredDateRequired"));
      await api.post(`/animal/${viewing.animal_id}/medications`, {
        item_id: doseForm.item_id,
        administered_date: doseForm.administered_date,
        dose_qty: doseForm.dose_qty ? Number(doseForm.dose_qty) : undefined,
        uom: doseForm.uom || undefined,
        administered_by: doseForm.administered_by || undefined,
        notes: doseForm.notes || undefined,
      });
      setDoseOpen(false);
      setDoseForm({ item_id: "", administered_date: new Date().toISOString().slice(0, 10), dose_qty: "", uom: "", administered_by: "", notes: "" });
      loadMedLogs(viewing.animal_id);
    } catch (err: any) {
      setDoseError(err?.message || t("anpErrLogDose"));
    } finally {
      setDoseSaving(false);
    }
  };

  const handleDispose = async () => {
    if (!viewing) return;
    setDisposeSaving(true);
    setDisposeError("");
    setDisposeIsWithdrawal(false);
    try {
      if (!disposeForm.disposal_type) throw new Error(t("anpErrDisposalTypeRequired"));
      if (!disposeForm.disposal_date) throw new Error(t("anpErrDisposalDateRequired"));
      await api.patch(`/animal/${viewing.animal_id}/dispose`, {
        disposal_type: disposeForm.disposal_type,
        disposal_date: disposeForm.disposal_date,
        disposal_reason_id: disposeForm.disposal_reason_id || undefined,
        disposal_value: disposeForm.disposal_value ? Number(disposeForm.disposal_value) : undefined,
        notes: disposeForm.notes || undefined,
      });
      setDisposeOpen(false);
      setViewing(null);
      load();
    } catch (err: any) {
      const msg: string = err?.message || t("anpErrDisposeAnimal");
      // Withdrawal-period errors have a specific prefix — surface them structured
      if (msg.includes("Cannot slaughter")) {
        setDisposeIsWithdrawal(true);
      }
      setDisposeError(msg);
    } finally {
      setDisposeSaving(false);
    }
  };

  // ── Pagination ───────────────────────────────────────────────────────────────
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
          <input
            id="animal-search"
            className={inputCls}
            style={{ paddingLeft: "2rem" }}
            placeholder={t("anpSearchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <select
          id="animal-status-filter"
          className={inputCls}
          style={{ width: "auto" }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">{t("anpAllStatuses")}</option>
          {Object.keys(STATUS_LABEL_KEY).map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm cursor-pointer" style={S.sub}>
          <input
            type="checkbox"
            checked={includeDisposed}
            onChange={(e) => setIncludeDisposed(e.target.checked)}
            className="rounded-[var(--radius-xs)]"
          />
          {t("anpIncludeDisposed")}
        </label>

        <Button variant="outline" size="sm" onClick={() => setScannerOpen(true)}>
          <Scan className="mr-1.5 h-3.5 w-3.5" /> {t("anpRfidFastScanner")}
        </Button>

        <Button id="animal-create-btn" size="sm" onClick={() => {
          setCreateNobId("");
          setCreateForm({ animal_type: "", gender: "", entry_type: "", entry_date: new Date().toISOString().slice(0, 10), breed_id: "", item_id: "", acquisition_cost: "", dob: "", ear_tag: "", rfid_tag: "", source_receipt_id: "", source_batch_id: "", notes: "", status: "ACTIVE", lob_id: "" });
          setCreateError("");
          setCreateOpen(true);
        }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> {t("anpRegisterAnimal")}
        </Button>
      </div>

      {error && <div className="mb-4"><InlineAlert variant="danger">{error}</InlineAlert></div>}

      {/* ── List table ── */}
      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <table className="w-full text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>{t("anpColCode")}</TableHead>
              <TableHead>{t("anpColType")}</TableHead>
              <TableHead>{t("anpColGender")}</TableHead>
              <TableHead>{t("anpColBreed")}</TableHead>
              <TableHead>{t("anpColStatus")}</TableHead>
              <TableHead>{t("anpColEntryDate")}</TableHead>
              <TableHead>{t("anpColEarTag")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" style={S.muted} />
                </TableCell>
              </TableRow>
            )}
            {!loading && pagedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-16 text-center">
                  <Inbox className="mx-auto h-8 w-8 mb-3" style={S.muted} />
                  <p className="text-sm" style={S.sub}>{t("anpNoAnimalsFound")}</p>
                </TableCell>
              </TableRow>
            )}
            {!loading && pagedRows.map((row) => (
              <TableRow key={row.animal_id} className="cursor-pointer hover:bg-[var(--surface-raised)]" onClick={() => openView(row)}>
                <TableCell className="font-mono text-xs font-semibold" style={S.accent}>{row.animal_code}</TableCell>
                <TableCell style={S.sub}>{animalTypeLabel(row.animal_type)}</TableCell>
                <TableCell style={S.sub}>{genderLabel(row.gender)}</TableCell>
                <TableCell style={S.sub}>{breedName(row.breed_id)}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status || "ACTIVE"} label={statusLabel(row.status || "ACTIVE")} />
                </TableCell>
                <TableCell style={S.muted}>{formatDate(row.entry_date)}</TableCell>
                <TableCell style={S.muted}>{row.ear_tag || "—"}</TableCell>
                <TableCell>
                  <button
                    aria-label={t("anpViewAnimal")}
                    className="p-1 rounded-[var(--radius-xs)] hover:bg-[var(--surface-secondary)]"
                    style={S.muted}
                    onClick={(e) => { e.stopPropagation(); openView(row); }}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>

      {rows.length > pageSize && (
        <div className="mt-4">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={rows.length}
            onPageChange={setPage}
          />
        </div>
      )}

      {/* ═══ Create Animal Modal ═══════════════════════════════════════════════ */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("anpRegisterAnimal")}
        description={t("anpRegisterAnimalDesc")}
        maxWidth="lg"
        footer={
          <Button id="animal-create-save-btn" onClick={handleCreate} disabled={createSaving}>
            {createSaving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{t("anpSaving")}</> : t("anpRegister")}
          </Button>
        }
      >
        {createError && <div className="mb-4"><InlineAlert variant="danger">{createError}</InlineAlert></div>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* NOB */}
          <div>
            <label className="nf-label" htmlFor="ca-nob">{t("anpNatureOfBusiness")}</label>
            <select id="ca-nob" className={inputCls} value={createNobId} onChange={(e) => { setCreateNobId(e.target.value); setCreateForm((f) => ({ ...f, lob_id: "" })); }}>
              <option value="">{t("anpSelectPlaceholder")}</option>
              {nobs.map((n) => <option key={n.nob_id} value={n.nob_id}>{n.nob_name}</option>)}
            </select>
          </div>

          {/* LOB */}
          <div>
            <label className="nf-label" htmlFor="ca-lob">{t("anpLineOfBusiness")}</label>
            <select id="ca-lob" className={inputCls} value={createForm.lob_id} onChange={(e) => setCreateForm((f) => ({ ...f, lob_id: e.target.value }))}>
              <option value="">{t("anpSelectNobFirst")}</option>
              {lobs.map((l) => <option key={l.lob_id} value={l.lob_id}>{l.lob_name}</option>)}
            </select>
          </div>

          {/* Animal type */}
          <div>
            <label className="nf-label" htmlFor="ca-type">{t("anpAnimalType")}</label>
            <select id="ca-type" className={inputCls} value={createForm.animal_type} onChange={(e) => setCreateForm((f) => ({ ...f, animal_type: e.target.value }))}>
              <option value="">{t("anpSelectPlaceholder")}</option>
              {ANIMAL_TYPES.map((tp) => <option key={tp} value={tp}>{animalTypeLabel(tp)}</option>)}
            </select>
          </div>

          {/* Gender */}
          <div>
            <label className="nf-label" htmlFor="ca-gender">{t("anpGender")}</label>
            <select id="ca-gender" className={inputCls} value={createForm.gender} onChange={(e) => setCreateForm((f) => ({ ...f, gender: e.target.value }))}>
              <option value="">{t("anpSelectPlaceholder")}</option>
              {GENDERS.map((g) => <option key={g.value} value={g.value}>{genderLabel(g.value)}</option>)}
            </select>
          </div>

          {/* Entry type */}
          <div>
            <label className="nf-label" htmlFor="ca-entry-type">{t("anpEntryType")}</label>
            <select id="ca-entry-type" className={inputCls} value={createForm.entry_type} onChange={(e) => setCreateForm((f) => ({ ...f, entry_type: e.target.value }))}>
              <option value="">{t("anpSelectPlaceholder")}</option>
              {ENTRY_TYPES.map((tp) => <option key={tp} value={tp}>{entryTypeLabel(tp)}</option>)}
            </select>
          </div>

          {/* Entry date */}
          <div>
            <label className="nf-label" htmlFor="ca-entry-date">{t("anpEntryDate")}</label>
            <input id="ca-entry-date" type="date" className={inputCls} value={createForm.entry_date} onChange={(e) => setCreateForm((f) => ({ ...f, entry_date: e.target.value }))} />
          </div>

          {/* Breed */}
          <div>
            <label className="nf-label" htmlFor="ca-breed">{t("anpBreed")}</label>
            <select id="ca-breed" className={inputCls} value={createForm.breed_id} onChange={(e) => setCreateForm((f) => ({ ...f, breed_id: e.target.value }))}>
              <option value="">{t("anpSelectLobFirst")}</option>
              {breeds.map((b) => <option key={b.breed_id} value={b.breed_id}>{b.breed_name}</option>)}
            </select>
          </div>

          {/* Item (living asset) */}
          <div>
            <label className="nf-label" htmlFor="ca-item">{t("anpItemLivingAsset")}</label>
            <select id="ca-item" className={inputCls} value={createForm.item_id} onChange={(e) => setCreateForm((f) => ({ ...f, item_id: e.target.value }))}>
              <option value="">{t("anpSelectPlaceholder")}</option>
              {items.filter((i) => i.item_type === "LIVING_ASSET" || !i.item_type).map((i) => <option key={i.item_id} value={i.item_id}>{i.item_name}</option>)}
            </select>
          </div>

          {/* Acquisition cost */}
          <div>
            <label className="nf-label" htmlFor="ca-cost">{t("anpAcquisitionCost")}</label>
            <input id="ca-cost" type="number" min="0" step="0.01" className={inputCls} placeholder="0.00" value={createForm.acquisition_cost} onChange={(e) => setCreateForm((f) => ({ ...f, acquisition_cost: e.target.value }))} />
          </div>

          {/* DOB */}
          <div>
            <label className="nf-label" htmlFor="ca-dob">{t("anpDateOfBirth")}</label>
            <input id="ca-dob" type="date" className={inputCls} value={createForm.dob} onChange={(e) => setCreateForm((f) => ({ ...f, dob: e.target.value }))} />
          </div>

          {/* Ear tag */}
          <div>
            <label className="nf-label" htmlFor="ca-ear-tag">{t("anpEarTag")}</label>
            <input id="ca-ear-tag" type="text" className={inputCls} placeholder={t("anpEarTagPlaceholder")} value={createForm.ear_tag} onChange={(e) => setCreateForm((f) => ({ ...f, ear_tag: e.target.value }))} />
          </div>

          {/* RFID */}
          <div>
            <label className="nf-label" htmlFor="ca-rfid">{t("anpRfidTag")}</label>
            <input id="ca-rfid" type="text" className={inputCls} placeholder={t("anpRfidTagPlaceholder")} value={createForm.rfid_tag} onChange={(e) => setCreateForm((f) => ({ ...f, rfid_tag: e.target.value }))} />
          </div>

          {/* Source receipt — shown when PURCHASED */}
          {["PURCHASED_IMPORTED", "PURCHASED_LOCAL"].includes(createForm.entry_type) && (
            <div>
              <label className="nf-label" htmlFor="ca-receipt">{t("anpSourceReceiptId")}</label>
              <input id="ca-receipt" type="text" className={inputCls} placeholder={t("anpSourceReceiptPlaceholder")} value={createForm.source_receipt_id} onChange={(e) => setCreateForm((f) => ({ ...f, source_receipt_id: e.target.value }))} />
            </div>
          )}

          {/* Source batch — shown when BORN_ON_FARM */}
          {createForm.entry_type === "BORN_ON_FARM" && (
            <div>
              <label className="nf-label" htmlFor="ca-batch">{t("anpSourceBatch")}</label>
              <select id="ca-batch" className={inputCls} value={createForm.source_batch_id} onChange={(e) => setCreateForm((f) => ({ ...f, source_batch_id: e.target.value }))}>
                <option value="">{t("anpSelectBatch")}</option>
                {batches.map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_no || b.batch_id}</option>)}
              </select>
            </div>
          )}

          {/* Notes — full width */}
          <div className="sm:col-span-2">
            <label className="nf-label" htmlFor="ca-notes">{t("anpNotes")}</label>
            <textarea id="ca-notes" className={inputCls} rows={2} value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Dialog>

      {/* ═══ Detail modal ═════════════════════════════════════════════════════ */}
      {viewing && (
        <Dialog
          open={!!viewing}
          onClose={() => setViewing(null)}
          title={t("anpAnimalDetailTitle", { code: viewing.animal_code })}
          description={`${animalTypeLabel(viewing.animal_type)} · ${genderLabel(viewing.gender)}`}
          maxWidth="xl"
          footer={
            <div className="flex w-full items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  id="animal-dispose-btn"
                  variant="destructive"
                  size="sm"
                  disabled={!viewing.is_active}
                  onClick={() => {
                    setDisposeForm({ disposal_type: "SOLD", disposal_date: new Date().toISOString().slice(0, 10), disposal_value: "", disposal_reason_id: "", notes: "" });
                    setDisposeError("");
                    setDisposeIsWithdrawal(false);
                    setDisposeOpen(true);
                  }}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {viewing.is_active ? t("anpDispose") : t("anpDisposed")}
                </Button>

                {viewing.is_active && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTransitionAnimal(viewing);
                      setTransitionOpen(true);
                    }}
                  >
                    <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                    {t("anpTransferStagePen")}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          {/* Tabs */}
          <div className="mb-5 flex gap-1 rounded-[var(--radius-sm)] p-1 text-sm" style={{ backgroundColor: "var(--surface-raised)" }}>
            {(["overview", "medications", "valuation"] as const).map((tab) => (
              <button
                key={tab}
                id={`animal-detail-tab-${tab}`}
                onClick={() => handleDetailTabChange(tab)}
                className="flex-1 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold transition-colors"
                style={detailTab === tab
                  ? { backgroundColor: "var(--surface)", color: "var(--text-primary)", boxShadow: "var(--shadow-sm)" }
                  : { color: "var(--text-secondary)" }}
              >
                {tab === "overview" ? t("anpTabOverview") : tab === "medications" ? t("anpTabMedicationLog") : t("anpTabValuationLedger")}
              </button>
            ))}
          </div>

          {/* ── Overview tab ── */}
          {detailTab === "overview" && (
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm sm:grid-cols-3">
              {[
                [t("anpFieldAnimalCode"), viewing.animal_code],
                [t("anpFieldType"), animalTypeLabel(viewing.animal_type)],
                [t("anpFieldGender"), genderLabel(viewing.gender)],
                [t("anpFieldStatus"), statusLabel(viewing.status)],
                [t("anpFieldEntryType"), entryTypeLabel(viewing.entry_type)],
                [t("anpFieldEntryDate"), formatDate(viewing.entry_date)],
                [t("anpFieldDateOfBirth"), formatDate(viewing.dob)],
                [t("anpFieldEarTag"), viewing.ear_tag || "—"],
                [t("anpFieldRfidTag"), viewing.rfid_tag || "—"],
                [t("anpFieldAcquisitionCost"), viewing.acquisition_cost ? formatMoney(Number(viewing.acquisition_cost)) : "—"],
                [t("anpFieldBookValue"), viewing.book_value ? formatMoney(Number(viewing.book_value)) : "—"],
                [t("anpFieldDisposalDate"), viewing.is_active ? "—" : formatDate(viewing.disposal_date)],
                [t("anpFieldDisposalType"), viewing.disposal_type ? disposalTypeLabel(viewing.disposal_type) : "—"],
                [t("anpFieldDisposalValue"), viewing.disposal_value ? formatMoney(Number(viewing.disposal_value)) : "—"],
                [t("anpFieldGainLossOnDisposal"), viewing.gain_loss_on_disposal ? formatMoney(Number(viewing.gain_loss_on_disposal)) : "—"],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <p className="text-xs uppercase tracking-wide" style={S.muted}>{label as string}</p>
                  <p className="mt-0.5 font-medium" style={S.primary}>{val as string}</p>
                </div>
              ))}
              {viewing.notes && (
                <div className="col-span-2 sm:col-span-3">
                  <p className="text-xs uppercase tracking-wide" style={S.muted}>{t("anpNotes")}</p>
                  <p className="mt-0.5 text-sm" style={S.sub}>{viewing.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Medications tab ── */}
          {detailTab === "medications" && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-semibold" style={S.primary}>{t("anpMedicationHistory")}</p>
                {viewing.is_active && (
                  <Button
                    id="animal-log-dose-btn"
                    size="sm"
                    onClick={() => {
                      setDoseForm({ item_id: "", administered_date: new Date().toISOString().slice(0, 10), dose_qty: "", uom: "", administered_by: "", notes: "" });
                      setDoseError("");
                      setDoseOpen(true);
                    }}
                  >
                    <Pill className="mr-1.5 h-3.5 w-3.5" /> {t("anpLogDose")}
                  </Button>
                )}
              </div>

              {medError && <div className="mb-4"><InlineAlert variant="danger">{medError}</InlineAlert></div>}

              {medLoading ? (
                <div className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" style={S.muted} />
                </div>
              ) : medLogs.length === 0 ? (
                <div className="py-12 text-center">
                  <Pill className="mx-auto h-7 w-7 mb-2" style={S.muted} />
                  <p className="text-sm" style={S.sub}>{t("anpNoDosesRecorded")}</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
                  <table className="w-full text-sm">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("anpColDate")}</TableHead>
                        <TableHead>{t("anpColItem")}</TableHead>
                        <TableHead>{t("anpColQty")}</TableHead>
                        <TableHead>{t("anpColAdministeredBy")}</TableHead>
                        <TableHead>{t("anpColNotes")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {medLogs.map((log) => (
                        <TableRow key={log.log_id}>
                          <TableCell style={S.sub}>{formatDate(log.administered_date)}</TableCell>
                          <TableCell style={S.primary} className="font-medium">{
                            items.find((i) => i.item_id === log.item_id)?.item_name || log.item_id
                          }</TableCell>
                          <TableCell style={S.muted}>
                            {log.dose_qty ? `${log.dose_qty}${log.uom ? " " + log.uom : ""}` : "—"}
                          </TableCell>
                          <TableCell style={S.muted}>{log.administered_by || "—"}</TableCell>
                          <TableCell style={S.muted}>{log.notes || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Valuation & Bio-Asset Ledger tab ── */}
          {detailTab === "valuation" && (
            <div>
              {/* Valuation KPIs */}
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-[var(--radius-md)] border p-3" style={S.raised}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={S.muted}>{t("anpKpiNbv")}</p>
                  <p className="mt-1 text-lg font-bold" style={S.primary}>
                    {formatMoney(viewing.book_value ? Number(viewing.book_value) : viewing.acquisition_cost ? Number(viewing.acquisition_cost) : "0")}
                  </p>
                </div>
                <div className="rounded-[var(--radius-md)] border p-3" style={S.raised}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={S.muted}>{t("anpKpiOpeningAssetValue")}</p>
                  <p className="mt-1 text-lg font-bold" style={S.primary}>
                    {formatMoney(viewing.total_opening_asset_value ? Number(viewing.total_opening_asset_value) : viewing.acquisition_cost ? Number(viewing.acquisition_cost) : "0")}
                  </p>
                </div>
                <div className="rounded-[var(--radius-md)] border p-3" style={S.raised}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={S.muted}>{t("anpKpiTotalAmortized")}</p>
                  <p className="mt-1 text-lg font-bold" style={S.primary}>
                    {formatMoney(viewing.total_amortised ? Number(viewing.total_amortised) : "0")}
                  </p>
                </div>
                <div className="rounded-[var(--radius-md)] border p-3" style={S.raised}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide" style={S.muted}>{t("anpKpiMonthlyAmortization")}</p>
                  <p className="mt-1 text-lg font-bold" style={S.primary}>
                    {viewing.amortisation_monthly ? formatMoney(Number(viewing.amortisation_monthly)) : "—"}
                  </p>
                </div>
              </div>

              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold" style={S.primary}>{t("anpIas41Ledger")}</p>
                <span className="text-xs" style={S.muted}>{t("anpTransactionCount", { count: ledgerEntries.length })}</span>
              </div>

              {ledgerError && <div className="mb-4"><InlineAlert variant="danger">{ledgerError}</InlineAlert></div>}

              {ledgerLoading ? (
                <div className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" style={S.muted} />
                </div>
              ) : ledgerEntries.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm" style={S.sub}>{t("anpNoLedgerEntries")}</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
                  <table className="w-full text-sm">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("anpColPostingDate")}</TableHead>
                        <TableHead>{t("anpColEntryType")}</TableHead>
                        <TableHead>{t("anpColDocNo")}</TableHead>
                        <TableHead>{t("anpColHeadcount")}</TableHead>
                        <TableHead className="text-right">{t("anpColCostAmount")}</TableHead>
                        <TableHead>{t("anpColStatus")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledgerEntries.map((entry) => (
                        <TableRow key={entry.entry_id}>
                          <TableCell style={S.sub}>{formatDate(entry.posting_date)}</TableCell>
                          <TableCell>
                            <StatusBadge
                              status={entry.entry_type}
                              label={ledgerEntryTypeLabel(entry.entry_type)}
                            />
                          </TableCell>
                          <TableCell style={S.primary} className="font-mono text-xs">{entry.document_no || "—"}</TableCell>
                          <TableCell style={S.muted}>{entry.quantity ? Number(entry.quantity).toFixed(0) : "1"}</TableCell>
                          <TableCell className="text-right font-medium" style={Number(entry.cost_amount) < 0 ? S.danger : S.primary}>
                            {formatMoney(Number(entry.cost_amount))}
                          </TableCell>
                          <TableCell style={S.muted}>{entry.status ? statusLabel(entry.status) : t("anpStatusActive")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Dialog>
      )}


      {/* ═══ Log Dose Modal ════════════════════════════════════════════════════ */}
      <Dialog
        open={doseOpen}
        onClose={() => setDoseOpen(false)}
        title={t("anpLogDoseTitle")}
        description={t("anpLogDoseDesc")}
        maxWidth="sm"
        footer={
          <Button id="animal-dose-save-btn" onClick={handleLogDose} disabled={doseSaving}>
            {doseSaving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{t("anpSaving")}</> : t("anpLogDose")}
          </Button>
        }
      >
        {doseError && <div className="mb-4"><InlineAlert variant="danger">{doseError}</InlineAlert></div>}

        <div className="space-y-4">
          <div>
            <label className="nf-label" htmlFor="dose-item">{t("anpMedicineVaccine")}</label>
            <select id="dose-item" className={inputCls} value={doseForm.item_id} onChange={(e) => setDoseForm((f) => ({ ...f, item_id: e.target.value }))}>
              <option value="">{t("anpSelectPlaceholder")}</option>
              {medItems.map((i) => (
                <option key={i.item_id} value={i.item_id}>
                  {i.item_name}{i.withdrawal_days != null ? t("anpWithdrawalDaysSuffix", { days: i.withdrawal_days }) : ""}
                </option>
              ))}
            </select>
            {medItems.length === 0 && (
              <p className="mt-1 text-xs" style={S.muted}>{t("anpNoMedItemsHint")}</p>
            )}
          </div>

          <div>
            <label className="nf-label" htmlFor="dose-date">{t("anpDateAdministered")}</label>
            <input id="dose-date" type="date" className={inputCls} value={doseForm.administered_date} onChange={(e) => setDoseForm((f) => ({ ...f, administered_date: e.target.value }))} />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="nf-label" htmlFor="dose-qty">{t("anpQuantity")}</label>
              <input id="dose-qty" type="number" min="0" step="0.001" className={inputCls} placeholder={t("anpQuantityPlaceholder")} value={doseForm.dose_qty} onChange={(e) => setDoseForm((f) => ({ ...f, dose_qty: e.target.value }))} />
            </div>
            <div className="w-28">
              <label className="nf-label" htmlFor="dose-uom">{t("anpUom")}</label>
              <select id="dose-uom" className={inputCls} value={doseForm.uom} onChange={(e) => setDoseForm((f) => ({ ...f, uom: e.target.value }))}>
                <option value="">—</option>
                {uoms.map((u) => <option key={u.uom_id || u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="nf-label" htmlFor="dose-by">{t("anpAdministeredBy")}</label>
            <input id="dose-by" type="text" className={inputCls} placeholder={t("anpAdministeredByPlaceholder")} value={doseForm.administered_by} onChange={(e) => setDoseForm((f) => ({ ...f, administered_by: e.target.value }))} />
          </div>

          <div>
            <label className="nf-label" htmlFor="dose-notes">{t("anpNotes")}</label>
            <textarea id="dose-notes" className={inputCls} rows={2} value={doseForm.notes} onChange={(e) => setDoseForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Dialog>

      {/* ═══ Dispose Modal ═════════════════════════════════════════════════════ */}
      <Dialog
        open={disposeOpen}
        onClose={() => setDisposeOpen(false)}
        title={viewing ? t("anpDisposeAnimalTitleWithCode", { code: viewing.animal_code }) : t("anpDisposeAnimalTitle")}
        description={t("anpDisposeAnimalDesc")}
        maxWidth="sm"
        footer={
          <Button id="animal-dispose-confirm-btn" variant="destructive" onClick={handleDispose} disabled={disposeSaving}>
            {disposeSaving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{t("anpSaving")}</> : t("anpConfirmDisposal")}
          </Button>
        }
      >
        {/* Structured withdrawal warning — shown instead of generic error when it's that specific error */}
        {disposeError && disposeIsWithdrawal
          ? <WithdrawalWarning message={disposeError} t={t} />
          : disposeError
            ? <div className="mb-4"><InlineAlert variant="danger">{disposeError}</InlineAlert></div>
            : null
        }

        {/* Show a proactive hint when slaughter is selected, before the user submits */}
        {disposeForm.disposal_type === "SLAUGHTERED" && !disposeError && (
          <div className="mb-4 rounded-[var(--radius-md)] border p-3 text-xs" style={S.warning}>
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("anpSlaughterWithdrawalHint")}</span>
            </div>
          </div>
        )}

        <div className="space-y-4 mt-1">
          <div>
            <label className="nf-label" htmlFor="dispose-type">{t("anpDisposalType")}</label>
            <select id="dispose-type" className={inputCls} value={disposeForm.disposal_type} onChange={(e) => { setDisposeForm((f) => ({ ...f, disposal_type: e.target.value, disposal_reason_id: "" })); setDisposeError(""); setDisposeIsWithdrawal(false); }}>
              {DISPOSAL_TYPES.map((tp) => <option key={tp} value={tp}>{disposalTypeLabel(tp)}</option>)}
            </select>
          </div>

          <div>
            <label className="nf-label" htmlFor="dispose-date">{t("anpDate")}</label>
            <input id="dispose-date" type="date" className={inputCls} value={disposeForm.disposal_date} onChange={(e) => setDisposeForm((f) => ({ ...f, disposal_date: e.target.value }))} />
          </div>

          {/* Reason Master Template (Master Templates/, 2026-09-21): a DIED
              disposal must pick a MORTALITY reason (enforced server-side);
              other disposal types offer the DISPOSAL/TRANSFER destinations
              the template gives for them (e.g. "Colcom Abattoir"). Optional —
              SOLD/TRANSFERRED commonly has no catalog reason behind it. */}
          <div>
            <label className="nf-label" htmlFor="dispose-reason">{t("anpDisposalReason")}</label>
            <select id="dispose-reason" className={inputCls} value={disposeForm.disposal_reason_id} onChange={(e) => setDisposeForm((f) => ({ ...f, disposal_reason_id: e.target.value }))}>
              <option value="">{t("anpDisposalReasonNone")}</option>
              {reasons
                .filter((r) => disposeForm.disposal_type === "DIED" ? r.category === "MORTALITY" : ["DISPOSAL", "TRANSFER"].includes(r.category))
                .map((r) => <option key={r.reason_id} value={r.reason_id}>{r.reason_code} — {r.reason_name}</option>)}
            </select>
          </div>

          <div>
            <label className="nf-label" htmlFor="dispose-value">{t("anpDisposalValue")}</label>
            <input id="dispose-value" type="number" min="0" step="0.01" className={inputCls} placeholder="0.00" value={disposeForm.disposal_value} onChange={(e) => setDisposeForm((f) => ({ ...f, disposal_value: e.target.value }))} />
          </div>

          <div>
            <label className="nf-label" htmlFor="dispose-notes">{t("anpNotes")}</label>
            <textarea id="dispose-notes" className={inputCls} rows={2} value={disposeForm.notes} onChange={(e) => setDisposeForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Dialog>

      {/* ── RFID / Barcode Fast Scanner Modal ── */}
      <RfidScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onAnimalUpdated={load}
        medItems={medItems}
      />

      {/* ── Animal Stage & Pen Transition Modal ── */}
      <AnimalStageTransitionModal
        open={transitionOpen}
        onClose={() => setTransitionOpen(false)}
        animal={transitionAnimal}
        onSuccess={() => {
          load();
          setViewing(null);
        }}
        stages={stages}
        locations={locations}
        batches={batches}
      />
    </div>
  );
}
