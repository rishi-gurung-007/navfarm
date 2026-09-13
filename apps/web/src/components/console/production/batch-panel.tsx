"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Search, Loader2, Inbox, Eye, PlayCircle, CheckCircle2, ClipboardCheck, QrCode as QrCodeIcon, RefreshCw, CalendarClock } from "lucide-react";
import QRCode from "react-qr-code";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { getActiveCompanyId, getActiveOperationalAreaId } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import BatchPerformanceCurvesPanel from "@/components/console/production/batch-performance-curves-panel";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

const PAGE_SIZE = 25;

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

const inputCls = "nf-input";

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

const emptyInputLine = () => ({ item_id: "", source_batch_id: "", quantity: "", uom: "", rate: "" });
const emptyOutputLine = () => ({ item_id: "", output_type: "MAIN", cost_split_pct: "100", quantity: "", uom: "", warehouse_id: "" });
const emptyTxForm = () => ({ transaction_date: new Date().toISOString().slice(0, 10), transaction_type: "CONSUMPTION", item_id: "", resource_id: "", quantity: "", uom: "", rate: "", remarks: "", output_type: "", nrv_rate: "" });
const emptyStdConsumptionLine = () => ({ item_id: "", std_qty_per_unit_per_day: "", std_rate: "" });

export default function BatchPanel() {
  const { formatMoney } = useCompanyCurrency();
  const { t } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [nobs, setNobs] = useState<Row[]>([]);
  const [lobs, setLobs] = useState<Row[]>([]);
  const [breeds, setBreeds] = useState<Row[]>([]);
  const [sheds, setSheds] = useState<Row[]>([]);
  const [items, setItems] = useState<Row[]>([]);
  const [uoms, setUoms] = useState<Row[]>([]);
  const [warehouses, setWarehouses] = useState<Row[]>([]);
  const [resources, setResources] = useState<Row[]>([]);
  const [batches, setBatches] = useState<Row[]>([]);
  const [stages, setStages] = useState<Row[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [nobId, setNobId] = useState("");
  const [header, setHeader] = useState<Row>({ lob_id: "", costing_method: "STANDARD", breed_id: "", stage_id: "", shed_id: "", start_date: "", expected_end_date: "", opening_quantity: "", uom: "", remarks: "" });
  const [inputLines, setInputLines] = useState<Row[]>([emptyInputLine()]);
  const [stdForm, setStdForm] = useState<Row>({ std_output_quantity: "", std_output_cost_per_unit: "", std_overhead_rate_per_unit: "" });
  const [stdConsumptionLines, setStdConsumptionLines] = useState<Row[]>([emptyStdConsumptionLine()]);

  const [viewing, setViewing] = useState<Row | null>(null);
  const [acting, setActing] = useState(false);
  const [txForm, setTxForm] = useState<Row>(emptyTxForm());

  const [detailTab, setDetailTab] = useState<"overview" | "transactions" | "data-entry" | "curves">("overview");

  // A batch split out of another can be merged back once the group is ready —
  // every live animal returns to the parent and this child closes.
  const [mergeTarget, setMergeTarget] = useState<any>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState("");

  const confirmMerge = async () => {
    if (!mergeTarget) return;
    setMergeBusy(true);
    setMergeError("");
    try {
      await api.post(`/batch-transfer/merge/${mergeTarget.batch_id}`, {
        transfer_date: new Date().toISOString().slice(0, 10),
      });
      setMergeTarget(null);
      load();
    } catch (err: any) {
      setMergeError(err?.message || "Could not merge the group back.");
    } finally {
      setMergeBusy(false);
    }
  };
  const [dataEntryDate, setDataEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [dataEntryLoading, setDataEntryLoading] = useState(false);
  const [dataEntryError, setDataEntryError] = useState("");
  const [dataEntryLines, setDataEntryLines] = useState<Row[]>([]);
  const [dataEntryValues, setDataEntryValues] = useState<Record<string, string>>({});
  const [dataEntryLotNos, setDataEntryLotNos] = useState<Record<string, string>>({});
  const [dataEntryDestBatches, setDataEntryDestBatches] = useState<Record<string, string>>({});
  const [dataEntryTexts, setDataEntryTexts] = useState<Record<string, string>>({});

  // A DESCRIPTIVE line's kpi_uom is normally a numeric unit (KG, SCORE, HEAD...);
  // a "/"-separated one (e.g. YES/NO) is the template's own convention for a
  // non-numeric capture — those lines need a text field, not a number input.
  const isTextCapture = (line: Row) => line.line_type === "DESCRIPTIVE" && !!line.kpi_uom && line.kpi_uom.includes("/");
  const [dataEntrySavingId, setDataEntrySavingId] = useState<string | null>(null);

  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [closeDate, setCloseDate] = useState(new Date().toISOString().slice(0, 10));
  const [closeQty, setCloseQty] = useState("");
  const [outputLines, setOutputLines] = useState<Row[]>([emptyOutputLine()]);

  const [bioActionOpen, setBioActionOpen] = useState<null | "mature" | "amortize" | "fair-value" | "dispose">(null);
  const [bioActing, setBioActing] = useState(false);
  const [bioError, setBioError] = useState("");
  const [bioForm, setBioForm] = useState<Row>({});

  const [qcModalOpen, setQcModalOpen] = useState(false);
  const [qcLine, setQcLine] = useState<Row | null>(null);
  const [qcParameters, setQcParameters] = useState<Row[]>([]);
  const [qcForm, setQcForm] = useState<Row>({});
  const [qcResultValues, setQcResultValues] = useState<Record<string, Row>>({});
  const [qcSaving, setQcSaving] = useState(false);
  const [qcError, setQcError] = useState("");
  const [qcSubmitted, setQcSubmitted] = useState<Row | null>(null);

  const [packModalOpen, setPackModalOpen] = useState(false);
  const [packLine, setPackLine] = useState<Row | null>(null);
  const [packForm, setPackForm] = useState<Row>({});
  const [packQcRecords, setPackQcRecords] = useState<Row[]>([]);
  const [packSaving, setPackSaving] = useState(false);
  const [packError, setPackError] = useState("");
  const [generatedPack, setGeneratedPack] = useState<Row | null>(null);

  const [renewModalOpen, setRenewModalOpen] = useState(false);
  const [renewForm, setRenewForm] = useState<Row>({});
  const [renewSaving, setRenewSaving] = useState(false);
  const [renewError, setRenewError] = useState("");

  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [stageForm, setStageForm] = useState<Row>({});
  const [stageSaving, setStageSaving] = useState(false);
  const [stageError, setStageError] = useState("");
  const [stageOptions, setStageOptions] = useState<string[]>([]);
  const [stageOptionsLoading, setStageOptionsLoading] = useState(false);

  const companyId = getActiveCompanyId();
  const scope = typeof window !== "undefined" ? localStorage.getItem("active_workspace_scope") : "COMPANY";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      params.set("limit", "200");
      const res = await api.get(`/batch?${params.toString()}`);
      const list = unwrap<Row[]>(res) || [];

      let finalRows = Array.isArray(list) ? list : [];

      if (scope === "OPERATIONAL") {
        // Scope to the area the user is actually working in. This used to
        // substring-match the batch number for "PIG"/"SOW"/"COW", which only
        // worked while batch codes happened to be named that way — a batch
        // numbered e.g. GSG-BAT-2026-0001 vanished from its own area's list.
        const areaId = getActiveOperationalAreaId();
        if (areaId) {
          finalRows = finalRows.filter((b) => !b.operational_area_id || b.operational_area_id === areaId);
        }
      }

      setRows(finalRows);
    } catch (err: any) {
      setError(err?.message || t("blErrLoadBatches"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  useEffect(() => { setPage(1); }, [search, statusFilter, pageSize]);
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    const qs = params.toString();
    api.get(`/setup/wizard/nobs?${qs}`).then((r) => setNobs(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/uom?${qs}`).then((r) => setUoms(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/warehouse?${qs}`).then((r) => setWarehouses(unwrap<Row[]>(r) || [])).catch(() => {});
    api.get(`/batch?${qs}`).then((r) => setBatches(unwrap<Row[]>(r) || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyed on activeNobId (declared below) rather than the create-form's own
  // nobId, so the batch-detail modal's QC-gate check (which needs this
  // batch's own LOB, not whatever's left selected in the create form) can
  // find the right LOB entry too.
  const activeNobIdForLobs = viewing?.nob_id || nobId;
  useEffect(() => {
    if (!activeNobIdForLobs) { setLobs([]); return; }
    api.get(`/setup/wizard/lobs/${activeNobIdForLobs}`).then((r) => setLobs(unwrap<Row[]>(r) || [])).catch(() => setLobs([]));
  }, [activeNobIdForLobs]);

  // Breed/Item/Shed/Resource are all scoped by Nature of Business and Line of
  // Business — re-fetched whenever either selection changes, instead of once
  // on mount, so e.g. a Poultry LOB never shows Livestock breeds. The "active"
  // scope prefers whichever batch is currently open for viewing (so labels in
  // the detail modal resolve correctly for that batch's own LOB) and falls
  // back to the create form's current selection otherwise.
  const activeNobId = viewing?.nob_id || nobId;
  const activeLobId = viewing?.lob_id || header.lob_id;
  useEffect(() => {
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    if (activeNobId) params.set("nobId", activeNobId);
    if (activeLobId) params.set("lobId", activeLobId);
    params.set("limit", "500");
    const qs = params.toString();
    api.get(`/breed?${qs}`).then((r) => setBreeds(unwrap<Row[]>(r) || [])).catch(() => setBreeds([]));
    api.get(`/shed?${qs}`).then((r) => setSheds(unwrap<Row[]>(r) || [])).catch(() => setSheds([]));
    api.get(`/item?${qs}`).then((r) => setItems(unwrap<Row[]>(r) || [])).catch(() => setItems([]));
    api.get(`/resource?${qs}`).then((r) => setResources(unwrap<Row[]>(r) || [])).catch(() => setResources([]));
    if (activeLobId) {
      api.get(`/stage?lobId=${activeLobId}&isActive=true&limit=200`).then((r) => setStages(unwrap<Row[]>(r) || [])).catch(() => setStages([]));
    } else {
      setStages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNobId, activeLobId]);

  const openCreate = () => {
    setNobId("");
    setHeader({ lob_id: "", costing_method: "STANDARD", breed_id: "", stage_id: "", shed_id: "", start_date: new Date().toISOString().slice(0, 10), expected_end_date: "", opening_quantity: "", uom: "", remarks: "" });
    setInputLines([emptyInputLine()]);
    setStdForm({ std_output_quantity: "", std_output_cost_per_unit: "", std_overhead_rate_per_unit: "" });
    setStdConsumptionLines([emptyStdConsumptionLine()]);
    setFormError("");
    setModalOpen(true);
  };

  const setInputLineField = (idx: number, key: string, value: any) => {
    setInputLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));
  };
  const addInputLine = () => setInputLines((prev) => [...prev, emptyInputLine()]);
  const removeInputLine = (idx: number) => setInputLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const setStdConsumptionLineField = (idx: number, key: string, value: any) => {
    setStdConsumptionLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));
  };
  const addStdConsumptionLine = () => setStdConsumptionLines((prev) => [...prev, emptyStdConsumptionLine()]);
  const removeStdConsumptionLine = (idx: number) => setStdConsumptionLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const handleSave = async () => {
    setSaving(true);
    setFormError("");
    try {
      if (!header.lob_id) throw new Error(t("blErrLobRequired"));
      if (!header.start_date) throw new Error(t("blErrStartDateRequired"));
      if (!header.opening_quantity || !header.uom) throw new Error(t("blErrOpeningQtyUomRequired"));
      const cleanLines = inputLines
        .filter((l) => l.item_id && l.quantity && l.uom)
        .map((l) => ({
          item_id: l.item_id,
          source_batch_id: l.source_batch_id || undefined,
          quantity: Number(l.quantity),
          uom: l.uom,
          rate: l.rate ? Number(l.rate) : undefined,
        }));
      if (cleanLines.length === 0) throw new Error(t("blErrAddInputLine"));

      let standard: Row | undefined;
      if (header.costing_method === "STANDARD") {
        const cleanStdLines = stdConsumptionLines
          .filter((l) => l.item_id && l.std_qty_per_unit_per_day)
          .map((l) => ({
            item_id: l.item_id,
            std_qty_per_unit_per_day: Number(l.std_qty_per_unit_per_day),
            std_rate: l.std_rate ? Number(l.std_rate) : undefined,
          }));
        const hasAnyStdInput = stdForm.std_output_quantity || stdForm.std_output_cost_per_unit || stdForm.std_overhead_rate_per_unit || cleanStdLines.length > 0;
        if (hasAnyStdInput) {
          standard = {
            std_output_quantity: stdForm.std_output_quantity ? Number(stdForm.std_output_quantity) : undefined,
            std_output_cost_per_unit: stdForm.std_output_cost_per_unit ? Number(stdForm.std_output_cost_per_unit) : undefined,
            std_overhead_rate_per_unit: stdForm.std_overhead_rate_per_unit ? Number(stdForm.std_overhead_rate_per_unit) : undefined,
            consumption_lines: cleanStdLines.length > 0 ? cleanStdLines : undefined,
          };
        }
      }

      await api.post("/batch", {
        company_id: companyId,
        lob_id: header.lob_id,
        costing_method: header.costing_method,
        breed_id: header.breed_id || undefined,
        stage_id: header.stage_id || undefined,
        shed_id: header.shed_id || undefined,
        start_date: header.start_date,
        expected_end_date: header.expected_end_date || undefined,
        opening_quantity: Number(header.opening_quantity),
        uom: header.uom,
        remarks: header.remarks || undefined,
        input_lines: cleanLines,
        standard,
      });
      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || t("blErrSaveBatch"));
    } finally {
      setSaving(false);
    }
  };

  const openView = async (row: Row) => {
    try {
      const res = await api.get(`/batch/${row.batch_id}`);
      setViewing(unwrap<Row>(res));
      setTxForm(emptyTxForm());
      setDetailTab("overview");
      setDataEntryDate(new Date().toISOString().slice(0, 10));
      setDataEntryLines([]);
      setDataEntryValues({});
      setDataEntryError("");
    } catch (err: any) {
      setError(err?.message || t("blErrLoadBatchDetails"));
    }
  };

  const refreshViewing = async () => {
    if (!viewing) return;
    const res = await api.get(`/batch/${viewing.batch_id}`);
    setViewing(unwrap<Row>(res));
  };

  const loadDataEntry = async () => {
    if (!viewing) return;
    setDataEntryLoading(true);
    setDataEntryError("");
    try {
      const res = await api.get(`/batch/${viewing.batch_id}/data-entry?date=${dataEntryDate}`);
      const data = unwrap<Row>(res);
      const dueLines = data.lines || [];
      setDataEntryLines(dueLines);
      setDataEntryValues(
        Object.fromEntries(dueLines.map((l: Row) => [l.line_id, l.already_entered_qty ? String(l.already_entered_qty) : ""]))
      );
      setDataEntryLotNos({});
      setDataEntryDestBatches({});
      setDataEntryTexts({});
    } catch (err: any) {
      setDataEntryError(err?.message || t("blErrLoadDataEntryLines"));
      setDataEntryLines([]);
    } finally {
      setDataEntryLoading(false);
    }
  };

  useEffect(() => {
    if (viewing && detailTab === "data-entry") loadDataEntry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing?.batch_id, detailTab, dataEntryDate]);

  const dataEntryCanSave = (line: Row) => {
    if (isTextCapture(line)) return !!dataEntryTexts[line.line_id];
    const rawValue = dataEntryValues[line.line_id];
    if (rawValue === undefined || rawValue === "") return false;
    if (line.lot_required && !dataEntryLotNos[line.line_id]) return false;
    if (line.line_type === "TRANSFER" && !dataEntryDestBatches[line.line_id]) return false;
    return true;
  };

  const handleDataEntrySave = async (line: Row) => {
    if (!viewing) return;
    if (!dataEntryCanSave(line)) return;
    setDataEntrySavingId(line.line_id);
    setDataEntryError("");
    try {
      // Dispatch (inventory/GL/alert/transfer) happens server-side, keyed off
      // this line's own line_type — the form only needs to say what was entered.
      const payload: Row = { line_id: line.line_id, entry_date: dataEntryDate };
      if (isTextCapture(line)) {
        payload.entered_text = dataEntryTexts[line.line_id];
      } else {
        payload.entered_value = Number(dataEntryValues[line.line_id]);
      }
      if (line.lot_required) payload.lot_no = dataEntryLotNos[line.line_id];
      if (line.line_type === "TRANSFER") payload.destination_batch_id = dataEntryDestBatches[line.line_id];
      await api.post(`/batch/${viewing.batch_id}/daily-data`, payload);
      await loadDataEntry();
      await refreshViewing();
    } catch (err: any) {
      setDataEntryError(err?.message || t("blErrRecordEntry"));
    } finally {
      setDataEntrySavingId(null);
    }
  };

  const handleActivate = async () => {
    if (!viewing) return;
    setActing(true);
    try {
      await api.post(`/batch/${viewing.batch_id}/activate`, {});
      await refreshViewing();
      load();
    } catch (err: any) {
      setError(err?.message || t("blErrActivateBatch"));
    } finally {
      setActing(false);
    }
  };

  const handleAddTransaction = async () => {
    if (!viewing) return;
    setActing(true);
    setError("");
    try {
      if (!txForm.transaction_date) throw new Error(t("blErrTransactionDateRequired"));
      const payload: Row = {
        transaction_date: txForm.transaction_date,
        transaction_type: txForm.transaction_type,
        remarks: txForm.remarks || undefined,
      };
      if (["CONSUMPTION", "OUTPUT"].includes(txForm.transaction_type)) {
        if (!txForm.item_id || !txForm.quantity || !txForm.uom) throw new Error(t("blErrItemQtyUomRequired"));
        payload.item_id = txForm.item_id;
        payload.quantity = Number(txForm.quantity);
        payload.uom = txForm.uom;
        if (txForm.rate) payload.rate = Number(txForm.rate);
        if (txForm.transaction_type === "OUTPUT" && txForm.output_type) {
          if (!txForm.nrv_rate) throw new Error(t("blErrNrvRateRequired"));
          payload.output_type = txForm.output_type;
          payload.nrv_rate = Number(txForm.nrv_rate);
        }
      } else if (txForm.transaction_type === "MORTALITY") {
        if (!txForm.quantity) throw new Error(t("blErrQtyRequiredMortality"));
        payload.quantity = Number(txForm.quantity);
      } else if (txForm.transaction_type === "OVERHEAD") {
        if (!txForm.quantity || !txForm.rate) throw new Error(t("blErrQtyRateRequiredOverhead"));
        payload.quantity = Number(txForm.quantity);
        payload.rate = Number(txForm.rate);
        if (txForm.resource_id) payload.resource_id = txForm.resource_id;
      }
      await api.post(`/batch/${viewing.batch_id}/transaction`, payload);
      setTxForm(emptyTxForm());
      await refreshViewing();
    } catch (err: any) {
      setError(err?.message || t("blErrRecordTransaction"));
    } finally {
      setActing(false);
    }
  };

  const openClose = () => {
    setCloseDate(new Date().toISOString().slice(0, 10));
    setCloseQty(viewing ? String(viewing.opening_quantity) : "");
    setOutputLines([emptyOutputLine()]);
    setCloseError("");
    setCloseModalOpen(true);
  };

  const setOutputLineField = (idx: number, key: string, value: any) => {
    setOutputLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));
  };
  const addOutputLine = () => setOutputLines((prev) => [...prev, emptyOutputLine()]);
  const removeOutputLine = (idx: number) => setOutputLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  const splitTotal = outputLines.reduce((sum, l) => sum + (Number(l.cost_split_pct) || 0), 0);

  const handleClose = async () => {
    if (!viewing) return;
    setActing(true);
    setCloseError("");
    try {
      const cleanLines = outputLines
        .filter((l) => l.item_id && l.quantity && l.uom && l.warehouse_id)
        .map((l) => ({
          item_id: l.item_id,
          output_type: l.output_type,
          cost_split_pct: Number(l.cost_split_pct),
          quantity: Number(l.quantity),
          uom: l.uom,
          warehouse_id: l.warehouse_id,
        }));
      if (cleanLines.length === 0) throw new Error(t("blErrAddOutputLine"));
      await api.post(`/batch/${viewing.batch_id}/close`, {
        actual_end_date: closeDate,
        closing_quantity: closeQty ? Number(closeQty) : undefined,
        output_lines: cleanLines,
      });
      setCloseModalOpen(false);
      await refreshViewing();
      load();
    } catch (err: any) {
      setCloseError(err?.message || t("blErrCloseBatch"));
    } finally {
      setActing(false);
    }
  };

  const openBioAction = (type: "mature" | "amortize" | "fair-value" | "dispose") => {
    setBioForm({
      posting_date: new Date().toISOString().slice(0, 10),
      residual_value_per_unit: "",
      productive_life_months: "",
      fair_value_per_unit: "",
      disposal_type: "HARVEST",
      quantity: "1",
      output_item_id: "",
      output_uom: "",
      output_quantity: "",
      warehouse_id: "",
      sale_proceeds: "",
    });
    setBioError("");
    setBioActionOpen(type);
  };

  const handleBioAction = async () => {
    if (!viewing || !bioActionOpen) return;
    setBioActing(true);
    setBioError("");
    try {
      let path = "";
      let payload: Row = {};
      if (bioActionOpen === "mature") {
        if (!bioForm.residual_value_per_unit) throw new Error(t("blErrResidualValueRequired"));
        path = `/batch/${viewing.batch_id}/mature`;
        payload = {
          residual_value_per_unit: Number(bioForm.residual_value_per_unit),
          productive_life_months: bioForm.productive_life_months ? Number(bioForm.productive_life_months) : undefined,
        };
      } else if (bioActionOpen === "amortize") {
        path = `/batch/${viewing.batch_id}/amortize`;
        payload = { posting_date: bioForm.posting_date };
      } else if (bioActionOpen === "fair-value") {
        if (!bioForm.fair_value_per_unit) throw new Error(t("blErrFairValueRequired"));
        path = `/batch/${viewing.batch_id}/fair-value`;
        payload = { posting_date: bioForm.posting_date, fair_value_per_unit: Number(bioForm.fair_value_per_unit) };
      } else if (bioActionOpen === "dispose") {
        if (!bioForm.quantity) throw new Error(t("blErrQuantityRequired"));
        path = `/batch/${viewing.batch_id}/dispose`;
        payload = { disposal_type: bioForm.disposal_type, quantity: Number(bioForm.quantity), posting_date: bioForm.posting_date };
        if (bioForm.disposal_type === "HARVEST") {
          if (!bioForm.output_item_id || !bioForm.output_uom || !bioForm.output_quantity || !bioForm.warehouse_id) {
            throw new Error(t("blErrHarvestFieldsRequired"));
          }
          payload.output_item_id = bioForm.output_item_id;
          payload.output_uom = bioForm.output_uom;
          payload.output_quantity = Number(bioForm.output_quantity);
          payload.warehouse_id = bioForm.warehouse_id;
        } else {
          if (!bioForm.sale_proceeds) throw new Error(t("blErrSaleProceedsRequired"));
          payload.sale_proceeds = Number(bioForm.sale_proceeds);
        }
      }
      await api.post(path, payload);
      setBioActionOpen(null);
      await refreshViewing();
      load();
    } catch (err: any) {
      setBioError(err?.message || t("blErrActionFailed"));
    } finally {
      setBioActing(false);
    }
  };

  const itemLabel = (id: string) => {
    const it = items.find((i) => i.item_id === id);
    return it ? `${it.item_code} — ${it.item_name}` : "—";
  };
  const batchLabel = (id: string) => {
    const b = batches.find((x) => x.batch_id === id);
    return b ? b.batch_no : "—";
  };

  // This LOB may require a passing QC record before a pack can be generated
  // (mirrors the server-side gate in qr-code.service.ts) — checked against
  // whichever QC record is currently selected in the Generate Pack form.
  const packQcRequired = lobs.find((l) => l.lob_id === viewing?.lob_id)?.qc_required === "YES";
  const packSelectedQc = packQcRecords.find((q) => q.qc_id === packForm.qc_id);
  const packQcGateBlocked = packQcRequired && packSelectedQc?.overall_result !== "PASS";

  // Batch renewal (copy config forward for a new cycle) is only offered for
  // LOBs configured to allow it — matches the server-side gate in renew().
  const renewAllowed = lobs.find((l) => l.lob_id === viewing?.lob_id)?.batch_copy_allowed === "YES";

  const openRecordQc = (line: Row) => {
    if (!viewing) return;
    setQcLine(line);
    setQcForm({
      qc_date: new Date().toISOString().slice(0, 10),
      total_qty_received: String(line.quantity ?? ""),
      pass_qty: "",
      fail_qty: "",
      hold_qty: "",
      grade_a_qty: "",
      grade_b_qty: "",
      grade_c_qty: "",
      disposition: "ACCEPT",
      qc_notes: "",
    });
    setQcResultValues({});
    setQcError("");
    setQcSubmitted(null);
    setQcModalOpen(true);
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("lobId", viewing.lob_id);
    params.set("limit", "200");
    api.get(`/qc-parameter?${params.toString()}`).then((r) => setQcParameters(unwrap<Row[]>(r) || [])).catch(() => setQcParameters([]));
  };

  const setQcResultField = (paramId: string, key: string, value: any) => {
    setQcResultValues((prev) => ({ ...prev, [paramId]: { ...prev[paramId], [key]: value } }));
  };

  const handleSaveQc = async () => {
    if (!viewing || !qcLine) return;
    setQcSaving(true);
    setQcError("");
    try {
      if (!qcForm.total_qty_received) throw new Error(t("blErrTotalQtyReceivedRequired"));
      const results = qcParameters
        .filter((p) => qcResultValues[p.param_id]?.actual_value !== undefined && qcResultValues[p.param_id]?.actual_value !== "")
        .map((p) => ({
          param_id: p.param_id,
          actual_value: String(qcResultValues[p.param_id].actual_value),
          grade_assigned: qcResultValues[p.param_id].grade_assigned || undefined,
          notes: qcResultValues[p.param_id].notes || undefined,
        }));
      if (results.length === 0) throw new Error(t("blErrRecordParamResult"));
      const result = await api.post("/qc", {
        company_id: companyId,
        source_batch_id: viewing.batch_id,
        output_line_id: qcLine.line_id,
        qc_date: qcForm.qc_date,
        total_qty_received: Number(qcForm.total_qty_received),
        pass_qty: qcForm.pass_qty ? Number(qcForm.pass_qty) : undefined,
        fail_qty: qcForm.fail_qty ? Number(qcForm.fail_qty) : undefined,
        hold_qty: qcForm.hold_qty ? Number(qcForm.hold_qty) : undefined,
        grade_a_qty: qcForm.grade_a_qty ? Number(qcForm.grade_a_qty) : undefined,
        grade_b_qty: qcForm.grade_b_qty ? Number(qcForm.grade_b_qty) : undefined,
        grade_c_qty: qcForm.grade_c_qty ? Number(qcForm.grade_c_qty) : undefined,
        disposition: qcForm.disposition,
        qc_notes: qcForm.qc_notes || undefined,
        results,
      });
      setQcSubmitted(unwrap<Row>(result));
    } catch (err: any) {
      setQcError(err?.message || t("blErrRecordQc"));
    } finally {
      setQcSaving(false);
    }
  };

  const openGeneratePack = (line: Row) => {
    if (!viewing) return;
    setPackLine(line);
    setPackForm({
      net_weight: String(line.quantity ?? ""),
      gross_weight: "",
      pack_uom: line.uom || "",
      warehouse_id: line.warehouse_id || "",
      lot_no: "",
      qc_id: "",
    });
    setGeneratedPack(null);
    setPackError("");
    setPackModalOpen(true);
    const params = new URLSearchParams();
    params.set("sourceBatchId", viewing.batch_id);
    params.set("outputLineId", line.line_id);
    params.set("limit", "50");
    api.get(`/qc?${params.toString()}`).then((r) => setPackQcRecords(unwrap<Row[]>(r) || [])).catch(() => setPackQcRecords([]));
  };

  const handleGeneratePack = async () => {
    if (!viewing || !packLine) return;
    setPackSaving(true);
    setPackError("");
    try {
      if (!packForm.net_weight || !packForm.pack_uom) throw new Error(t("blErrNetWeightUomRequired"));
      const result = await api.post("/qr-code", {
        company_id: companyId,
        batch_id: viewing.batch_id,
        output_line_id: packLine.line_id,
        qc_id: packForm.qc_id || undefined,
        item_id: packLine.item_id,
        lot_no: packForm.lot_no || undefined,
        production_date: viewing.actual_end_date || new Date().toISOString().slice(0, 10),
        net_weight: Number(packForm.net_weight),
        gross_weight: packForm.gross_weight ? Number(packForm.gross_weight) : undefined,
        pack_uom: packForm.pack_uom,
        warehouse_id: packForm.warehouse_id || undefined,
      });
      setGeneratedPack(unwrap<Row>(result));
    } catch (err: any) {
      setPackError(err?.message || t("blErrGeneratePack"));
    } finally {
      setPackSaving(false);
    }
  };

  const generateAnotherPack = () => {
    setGeneratedPack(null);
    setPackForm((f: Row) => ({ ...f, lot_no: "" }));
  };

  const openRenew = () => {
    if (!viewing) return;
    setRenewForm({
      start_date: new Date().toISOString().slice(0, 10),
      expected_end_date: "",
      opening_quantity: viewing.opening_quantity ?? "",
      uom: viewing.uom || "",
      remarks: "",
      item_id: viewing.input_lines?.[0]?.item_id || "",
      quantity: viewing.opening_quantity ?? "",
      line_uom: viewing.input_lines?.[0]?.uom || "",
      rate: "",
    });
    setRenewError("");
    setRenewModalOpen(true);
  };

  const handleRenew = async () => {
    if (!viewing) return;
    setRenewSaving(true);
    setRenewError("");
    try {
      if (!renewForm.start_date || !renewForm.opening_quantity || !renewForm.uom) throw new Error(t("blErrRenewHeaderFieldsRequired"));
      if (!renewForm.item_id || !renewForm.quantity || !renewForm.line_uom) throw new Error(t("blErrRenewInputLineRequired"));
      const result = await api.post(`/batch/${viewing.batch_id}/renew`, {
        start_date: renewForm.start_date,
        expected_end_date: renewForm.expected_end_date || undefined,
        opening_quantity: Number(renewForm.opening_quantity),
        uom: renewForm.uom,
        remarks: renewForm.remarks || undefined,
        input_lines: [{
          item_id: renewForm.item_id,
          quantity: Number(renewForm.quantity),
          uom: renewForm.line_uom,
          rate: renewForm.rate ? Number(renewForm.rate) : undefined,
        }],
      });
      setRenewModalOpen(false);
      await load();
      setViewing(unwrap<Row>(result));
    } catch (err: any) {
      setRenewError(err?.message || t("blErrRenewBatch"));
    } finally {
      setRenewSaving(false);
    }
  };

  const openTransferStage = async () => {
    if (!viewing) return;
    setStageForm({ to_stage_code: "", remarks: "" });
    setStageError("");
    setStageOptions([]);
    setStageModalOpen(true);
    // Stages aren't a fixed enum — they're whatever Stage Master defines for
    // this batch's LOB (the same source transferStage() itself validates
    // against server-side), minus the stage the batch is already in.
    if (!viewing.lob_id) return;
    setStageOptionsLoading(true);
    try {
      const stages = unwrap<Row[]>(await api.get(`/stage?lobId=${viewing.lob_id}&isActive=true&limit=200`)) || [];
      const codes = Array.from(
        new Set(
          stages
            .map((s: Row) => s.stage_code)
            .filter((c: string | null) => !!c && c !== viewing.current_stage_code)
        )
      ) as string[];
      setStageOptions(codes.sort());
    } catch {
      setStageOptions([]);
    } finally {
      setStageOptionsLoading(false);
    }
  };

  const handleTransferStage = async () => {
    if (!viewing) return;
    setStageSaving(true);
    setStageError("");
    try {
      if (!stageForm.to_stage_code) throw new Error(t("blErrDestStageRequired"));
      const result = await api.post(`/batch/${viewing.batch_id}/transfer-stage`, {
        to_stage_code: stageForm.to_stage_code,
        remarks: stageForm.remarks || undefined,
      });
      setStageModalOpen(false);
      setViewing(unwrap<Row>(result));
    } catch (err: any) {
      setStageError(err?.message || t("blErrTransferStage"));
    } finally {
      setStageSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={S.primary}>{t("blPageTitle")}</h2>
          <p className="mt-0.5 text-xs" style={S.sub}>{t("blPageSubtitle")}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="nf-input-sm nf-select" style={S.input}>
            <option value="">{t("blFilterAllStatuses")}</option>
            <option value="DRAFT">{t("blStatusDraft")}</option>
            <option value="ACTIVE">{t("blStatusActive")}</option>
            <option value="CLOSED">{t("blStatusClosed")}</option>
            <option value="CANCELLED">{t("blStatusCancelled")}</option>
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("blSearchPlaceholder")} className="nf-input-sm pl-8" style={S.input} />
          </div>
          <Button size="sm" onClick={openCreate} >
            <Plus className="h-3.5 w-3.5" /> {t("blNewBatch")}
          </Button>
        </div>
      </div>

      {error && (
        <InlineAlert>{error}</InlineAlert>
      )}

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="whitespace-nowrap">{t("blColBatchNo")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("blColStartDate")}</TableHead>
                <TableHead className="whitespace-nowrap">{t("blColMethod")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("blColOpeningQty")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{t("blColUnitCost")}</TableHead>
                <TableHead className="text-right">{t("blColStatus")}</TableHead>
                <TableHead className="text-right">{t("blColActions")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr><TableCell colSpan={7} className="py-10 text-center" style={S.sub}><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("blLoading")}</TableCell></tr>
              ) : rows.length === 0 ? (
                <tr><TableCell colSpan={7} className="py-10 text-center" style={S.sub}><Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} /> {t("blNoBatches")}</TableCell></tr>
              ) : (
                pagedRows.map((row) => (
                  <TableRow key={row.batch_id}>
                    <TableCell className="whitespace-nowrap font-semibold" style={S.primary}>
                      {row.batch_no}
                      {row.parent_batch_id && (
                        <span className="ml-1.5 text-[10px] font-medium" style={S.muted}>↳ split group</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap" style={S.primary}>{row.start_date}</TableCell>
                    <TableCell className="whitespace-nowrap" style={S.sub}>{row.costing_method}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{row.opening_quantity} {row.uom}</TableCell>
                    <TableCell className="whitespace-nowrap text-right" style={S.primary}>{row.unit_cost ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {row.parent_batch_id && row.status === "ACTIVE" && (
                        <button
                          onClick={() => { setMergeTarget(row); setMergeError(""); }}
                          title="Merge this group back into the batch it was split from"
                          className="mr-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition hover:bg-(--surface-raised)"
                          style={S.accent}
                        >
                          Merge back
                        </button>
                      )}
                      <button onClick={() => openView(row)} title={t("blViewTitle")} className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)" style={S.sub}>
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </table>
        </div>
        {!loading && rows.length > 0 && (
          <div className="border-t px-2" style={{ borderColor: "var(--border)" }}>
            <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </div>

      {/* Create modal */}
      <Dialog
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={t("blNewBatch")}
        maxWidth="xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)} disabled={saving}>{t("blCancel")}</Button>
            <Button size="sm" onClick={handleSave} disabled={saving} className="nf-btn-primary">
              {saving ? t("blSaving") : t("blSaveDraft")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && (
            <InlineAlert>{formError}</InlineAlert>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelNob")} <span className="text-(--danger)">*</span></label>
              <select value={nobId} onChange={(e) => { setNobId(e.target.value); setHeader((h) => ({ ...h, lob_id: "" })); }} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("blSelectEllipsis")}</option>
                {nobs.map((n) => <option key={n.nob_id} value={n.nob_id}>{n.nob_code} — {n.nob_name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelLob")} <span className="text-(--danger)">*</span></label>
              <select value={header.lob_id} onChange={(e) => setHeader((h) => ({ ...h, lob_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input} disabled={!nobId}>
                <option value="">{nobId ? t("blSelectEllipsis") : t("blSelectNobFirst")}</option>
                {lobs.map((l) => <option key={l.lob_id} value={l.lob_id}>{l.lob_code} — {l.lob_name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelCostingMethod")} <span className="text-(--danger)">*</span></label>
              <select value={header.costing_method} onChange={(e) => setHeader((h) => ({ ...h, costing_method: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="STANDARD">{t("blCostingStandard")}</option>
                <option value="FIFO">{t("blCostingFifo")}</option>
                <option value="BIO_ASSET">{t("blCostingBioAsset")}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelBreed")}</label>
              <select value={header.breed_id} onChange={(e) => setHeader((h) => ({ ...h, breed_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("blSelectEllipsis")}</option>
                {breeds.map((b) => <option key={b.breed_id} value={b.breed_id}>{b.breed_code} — {b.breed_name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>Initial Stage <span className="text-(--danger)">*</span></label>
              <select
                value={header.stage_id}
                onChange={(e) => {
                  const sId = e.target.value;
                  const st = stages.find((s) => s.stage_id === sId);
                  setHeader((h) => {
                    let end = h.expected_end_date;
                    if (st?.typical_duration_days && h.start_date) {
                      const d = new Date(h.start_date);
                      d.setDate(d.getDate() + Number(st.typical_duration_days));
                      end = d.toISOString().slice(0, 10);
                    }
                    return { ...h, stage_id: sId, expected_end_date: end };
                  });
                }}
                className={`${inputCls} nf-select`}
                style={S.input}
                disabled={!header.lob_id}
              >
                <option value="">{header.lob_id ? t("blSelectEllipsis") : t("blSelectNobFirst")}</option>
                {stages.map((s) => (
                  <option key={s.stage_id} value={s.stage_id}>
                    {s.stage_code} — {s.stage_name} ({s.typical_duration_days ? `${s.typical_duration_days} days` : "Open duration"})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelShed")}</label>
              <select value={header.shed_id} onChange={(e) => setHeader((h) => ({ ...h, shed_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("blSelectEllipsis")}</option>
                {sheds.map((s) => <option key={s.shed_id} value={s.shed_id}>{s.shed_code} — {s.shed_name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelStartDate")} <span className="text-(--danger)">*</span></label>
              <input type="date" value={header.start_date} onChange={(e) => setHeader((h) => ({ ...h, start_date: e.target.value }))} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelExpectedEndDate")}</label>
              <input type="date" value={header.expected_end_date} onChange={(e) => setHeader((h) => ({ ...h, expected_end_date: e.target.value }))} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelOpeningQty")} <span className="text-(--danger)">*</span></label>
              <input type="number" value={header.opening_quantity} onChange={(e) => setHeader((h) => ({ ...h, opening_quantity: e.target.value }))} placeholder="5000" className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelUom")} <span className="text-(--danger)">*</span></label>
              <select value={header.uom} onChange={(e) => setHeader((h) => ({ ...h, uom: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("blSelectEllipsis")}</option>
                {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="nf-text-label" style={S.sub}>{t("blLabelRemarks")}</label>
              <input value={header.remarks} onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))} className={inputCls} style={S.input} />
            </div>
            {header.stage_id && (
              <div className="sm:col-span-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs flex items-start gap-2.5">
                <CalendarClock className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-primary">Stage 1 Scheduler Auto-Generation</span>
                  <span style={S.sub}>
                    Creating this batch will automatically generate its <strong>{stages.find((s) => s.stage_id === header.stage_id)?.stage_name}</strong> scheduler with standard SOP activities (daily feed rations, health medications, and KPI limits) based on breed lifecycle standards.
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blInputLinesTitle")}</p>
            <button onClick={addInputLine} type="button" className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold" style={S.surface}>
              <Plus className="h-3 w-3" /> {t("blAddLine")}
            </button>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
            <table className="w-full border-collapse text-left text-xs">
              <TableHeader>
                <tr className="border-b border-(--row-border)">
                  <TableHead className="h-auto px-3 py-2">{t("blColItem")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("blColSourceBatch")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("blColQty")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("blColUom")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("blColEstRate")}</TableHead>
                  <TableHead className="h-auto px-3 py-2"></TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {inputLines.map((line, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="px-2 py-1.5">
                      <select value={line.item_id} onChange={(e) => setInputLineField(idx, "item_id", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                        <option value="">{t("blSelectItemOptions", { count: items.length })}</option>
                        {items.map((it, i) => (
                          <option key={it.item_id} value={it.item_id}>
                            {i + 1}. {it.item_code} — {it.item_name || it.item_code}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <select value={line.source_batch_id} onChange={(e) => setInputLineField(idx, "source_batch_id", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                        <option value="">{t("blNone")}</option>
                        {batches.filter((b) => b.status === "CLOSED").map((b) => <option key={b.batch_id} value={b.batch_id}>{b.batch_no}</option>)}
                      </select>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 w-24"><input type="number" value={line.quantity} onChange={(e) => setInputLineField(idx, "quantity", e.target.value)} className={inputCls} style={S.input} /></TableCell>
                    <TableCell className="px-2 py-1.5 w-24">
                      <select value={line.uom} onChange={(e) => setInputLineField(idx, "uom", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                        <option value="">{t("blSelectEllipsis")}</option>
                        {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
                      </select>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 w-24"><input type="number" value={line.rate} onChange={(e) => setInputLineField(idx, "rate", e.target.value)} className={inputCls} style={S.input} /></TableCell>
                    <TableCell className="px-2 py-1.5">
                      <button onClick={() => removeInputLine(idx)} type="button" className="rounded-[var(--radius-xs)] p-1 transition hover:bg-(--danger-muted)" style={{ color: "var(--danger)" }}><Trash2 className="h-3.5 w-3.5" /></button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
          <p className="text-[11px]" style={S.muted}>{t("blRateEstimateNote")}</p>

          {header.costing_method === "STANDARD" && (
            <>
              <div className="pt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blStdCostTitle")}</p>
                <p className="mt-0.5 text-[11px]" style={S.muted}>{t("blStdCostSubtitle")}</p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelStdOutputQty")}</label>
                  <input
                    type="number"
                    value={stdForm.std_output_quantity}
                    onChange={(e) => setStdForm((f: Row) => ({ ...f, std_output_quantity: e.target.value }))}
                    placeholder={header.breed_id ? t("blPlaceholderAutoFromBreed") : t("blPlaceholderDefaultsOpeningQty")}
                    className={inputCls}
                    style={S.input}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelStdOutputCost")}</label>
                  <input type="number" value={stdForm.std_output_cost_per_unit} onChange={(e) => setStdForm((f: Row) => ({ ...f, std_output_cost_per_unit: e.target.value }))} className={inputCls} style={S.input} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelStdOverheadRate")}</label>
                  <input type="number" value={stdForm.std_overhead_rate_per_unit} onChange={(e) => setStdForm((f: Row) => ({ ...f, std_overhead_rate_per_unit: e.target.value }))} className={inputCls} style={S.input} />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blConsumptionStandardsTitle")}</p>
                <button onClick={addStdConsumptionLine} type="button" className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold" style={S.surface}>
                  <Plus className="h-3 w-3" /> {t("blAddLine")}
                </button>
              </div>

              <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader>
                    <tr className="border-b border-[var(--row-border)]">
                      <TableHead className="h-auto px-3 py-2">{t("blColItem")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColStdQtyPerUnitDay")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColStdRate")}</TableHead>
                      <TableHead className="h-auto px-3 py-2"></TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {stdConsumptionLines.map((line, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="px-2 py-1.5">
                          <select value={line.item_id} onChange={(e) => setStdConsumptionLineField(idx, "item_id", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                            <option value="">{t("blSelectItemOptions", { count: items.length })}</option>
                            {items.map((it, i) => (
                              <option key={it.item_id} value={it.item_id}>
                                {i + 1}. {it.item_code} — {it.item_name || it.item_code}
                              </option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell className="px-2 py-1.5 w-32"><input type="number" value={line.std_qty_per_unit_per_day} onChange={(e) => setStdConsumptionLineField(idx, "std_qty_per_unit_per_day", e.target.value)} className={inputCls} style={S.input} /></TableCell>
                        <TableCell className="px-2 py-1.5 w-28">
                          <input
                            type="number"
                            value={line.std_rate}
                            onChange={(e) => setStdConsumptionLineField(idx, "std_rate", e.target.value)}
                            placeholder={t("blPlaceholderItemDefault")}
                            className={inputCls}
                            style={S.input}
                          />
                        </TableCell>
                        <TableCell className="px-2 py-1.5">
                          <button onClick={() => removeStdConsumptionLine(idx)} type="button" className="rounded-[var(--radius-xs)] p-1 transition hover:bg-(--danger-muted)" style={{ color: "var(--danger)" }}><Trash2 className="h-3.5 w-3.5" /></button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            </>
          )}
        </div>
      </Dialog>

      {/* Detail / lifecycle modal */}
      <Dialog
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? t("blDetailTitle", { batchNo: viewing.batch_no }) : t("blDetailTitleFallback")}
        description={viewing?.remarks || t("blDetailDescFallback")}
        maxWidth="xl"
      >
        {viewing && (
          <div className="flex flex-col gap-4 text-xs">
            {/* Top Batch Metadata Card */}
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 p-3.5 rounded-[var(--radius-md)] border shadow-2xs" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" }}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("blLabelStatus")}</p>
                <StatusBadge status={viewing.status} className="mt-1" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("blLabelCostingMethod")}</p>
                <p className="font-semibold mt-0.5" style={S.primary}>{viewing.costing_method}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("blLabelOpeningHeadQty")}</p>
                <p className="font-semibold mt-0.5" style={S.primary}>{viewing.opening_quantity} {viewing.uom || "HEAD"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("blLabelBreedVariety")}</p>
                <p className="font-semibold mt-0.5" style={S.primary}>{viewing.breed_name || viewing.breed_code || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("blLabelStartDate")}</p>
                <p className="font-semibold mt-0.5" style={S.primary}>{viewing.start_date || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("blLabelExpectedEndDate")}</p>
                <p className="font-semibold mt-0.5" style={S.primary}>{viewing.expected_end_date || "—"}</p>
              </div>
              {viewing.current_stage_code && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("blLabelCurrentStage")}</p>
                  <Badge variant="accent" className="mt-1">{viewing.current_stage_code}</Badge>
                </div>
              )}
              {viewing.total_cost != null && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={S.muted}>{t("blLabelTotalCost")}</p>
                  <p className="font-semibold mt-0.5" style={S.primary}>{formatMoney(Number(viewing.total_cost))}</p>
                </div>
              )}
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b" style={{ borderColor: "var(--border)" }}>
              {([
                ["overview", t("blTabOverview")],
                ["curves", t("blTabCurves")],
                ["transactions", t("blTabTransactions")],
                ["data-entry", t("blTabDataEntry")],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setDetailTab(key)}
                  className="px-3.5 py-2 text-xs font-semibold transition-colors relative"
                  style={
                    detailTab === key
                      ? { color: "var(--accent)", borderBottom: "2px solid var(--accent)" }
                      : { color: "var(--text-secondary)", borderBottom: "2px solid transparent" }
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {detailTab === "overview" && (
            <>
            {viewing.status === "DRAFT" && (
              <Button onClick={handleActivate} disabled={acting} size="sm" className="nf-btn-primary self-start">
                <PlayCircle className="h-4 w-4" /> {acting ? t("blActivating") : t("blActivateBatch")}
              </Button>
            )}

            {viewing.status === "ACTIVE" && (
              <Button onClick={openTransferStage} variant="outline" size="sm" className="self-start gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" /> {t("blTransferStage")}
              </Button>
            )}

            {(viewing.stage_log || []).length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blStageHistoryTitle")}</p>
                <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                  <table className="w-full border-collapse text-left text-xs">
                    <TableHeader><tr className="border-b border-[var(--row-border)]">
                      <TableHead className="h-auto px-3 py-2">{t("blColFromStage")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColToStage")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColTransferredDate")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColRemarks")}</TableHead>
                    </tr></TableHeader>
                    <TableBody>
                      {(viewing.stage_log || []).map((s: Row) => (
                        <TableRow key={s.log_id}>
                          <TableCell className="px-3 py-2" style={S.sub}>{s.from_stage_code || "—"}</TableCell>
                          <TableCell className="px-3 py-2 font-semibold" style={S.primary}>{s.to_stage_code}</TableCell>
                          <TableCell className="px-3 py-2" style={S.sub}>{s.transferred_at}</TableCell>
                          <TableCell className="px-3 py-2" style={S.sub}>{s.remarks || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blInputLinesInitialTitle")}</p>
              <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader><tr className="border-b border-[var(--row-border)]">
                    <TableHead className="h-auto px-3 py-2">{t("blColItem")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("blColSourceBatch")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("blColQty")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("blColRate")}</TableHead>
                  </tr></TableHeader>
                  <TableBody>
                    {(viewing.input_lines || []).map((l: Row) => (
                      <TableRow key={l.line_id}>
                        <TableCell className="px-3 py-2 font-medium" style={S.primary}>{itemLabel(l.item_id)}</TableCell>
                        <TableCell className="px-3 py-2" style={S.sub}>{l.source_batch_id ? batchLabel(l.source_batch_id) : "—"}</TableCell>
                        <TableCell className="px-3 py-2" style={S.primary}>{l.quantity} {l.uom}</TableCell>
                        <TableCell className="px-3 py-2" style={S.primary}>{l.rate ? formatMoney(Number(l.rate).toFixed(2)) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            </div>
            {viewing.costing_method === "BIO_ASSET" && viewing.bio_asset_state && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blBioAssetStateTitle")}</p>
                <div className="rounded-[var(--radius-sm)] border p-3" style={S.surface}>
                  <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                    <div>
                      <p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("blLabelStage")}</p>
                      <Badge variant={viewing.bio_asset_state.stage === "MATURE" ? "success" : "accent"} className="mt-1">{viewing.bio_asset_state.stage}</Badge>
                    </div>
                    <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("blLabelCurrentQty")}</p><p style={S.primary}>{viewing.bio_asset_state.current_quantity}</p></div>
                    <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("blLabelNcaBookValue")}</p><p style={S.primary}>{viewing.bio_asset_state.nca_book_value}</p></div>
                    <div><p className="font-semibold uppercase tracking-wider" style={S.muted}>{t("blLabelMonthlyAmortRate")}</p><p style={S.primary}>{viewing.bio_asset_state.monthly_amortization_rate ?? "—"}</p></div>
                  </div>
                  {viewing.status === "ACTIVE" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {viewing.bio_asset_state.stage === "PREMATURE" && (
                        <Button size="sm" onClick={() => openBioAction("mature")} className="nf-btn-primary">{t("blMatureHerd")}</Button>
                      )}
                      {viewing.bio_asset_state.stage === "MATURE" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openBioAction("amortize")}>{t("blRunAmortization")}</Button>
                          <Button size="sm" variant="outline" onClick={() => openBioAction("fair-value")}>{t("blRecordFairValue")}</Button>
                        </>
                      )}
                      {Number(viewing.bio_asset_state.current_quantity) > 0 && (
                        <Button size="sm" onClick={() => openBioAction("dispose")} style={{ backgroundColor: "var(--success)", color: "#fff" }}>{t("blDispose")}</Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            </>
            )}

            {detailTab === "data-entry" && (
              <div className="flex flex-col gap-3">
                {!viewing.scheduler ? (
                  <InlineAlert variant="info">{t("blNoSchedulerInfo")}</InlineAlert>
                ) : viewing.status !== "ACTIVE" ? (
                  <InlineAlert variant="info">{t("blDataEntryActiveOnly")}</InlineAlert>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <label className="nf-text-label" style={S.sub}>{t("blLabelDate")}</label>
                      <input type="date" value={dataEntryDate} onChange={(e) => setDataEntryDate(e.target.value)} className={inputCls + " w-auto"} style={S.input} />
                      {dataEntryLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" style={S.accent} />}
                    </div>

                    {dataEntryError && <InlineAlert>{dataEntryError}</InlineAlert>}

                    <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                      <table className="w-full border-collapse text-left text-xs">
                        <TableHeader><tr className="border-b border-[var(--row-border)]">
                          <TableHead className="h-auto px-3 py-2">{t("blColParameterType")}</TableHead>
                          <TableHead className="h-auto px-3 py-2">{t("blColDataEntryType")}</TableHead>
                          <TableHead className="h-auto px-3 py-2">{t("blColItem")}</TableHead>
                          <TableHead className="h-auto px-3 py-2">{t("blColUom")}</TableHead>
                          <TableHead className="h-auto px-3 py-2">{t("blColOccurrence")}</TableHead>
                          <TableHead className="h-auto px-3 py-2">{t("blColExpected")}</TableHead>
                          <TableHead className="h-auto px-3 py-2">{t("blColActual")}</TableHead>
                          <TableHead className="h-auto px-3 py-2"></TableHead>
                        </tr></TableHeader>
                        <TableBody>
                          {!dataEntryLoading && dataEntryLines.length === 0 ? (
                            <tr><TableCell colSpan={8} className="py-6 text-center" style={S.sub}>{t("blNoParamsScheduled")}</TableCell></tr>
                          ) : dataEntryLines.map((line) => (
                            <TableRow key={line.line_id}>
                              <TableCell className="px-3 py-2" style={S.sub}>{line.line_type}</TableCell>
                              <TableCell className="px-3 py-2" style={S.primary}>{line.activity_name}</TableCell>
                              <TableCell className="px-3 py-2" style={S.sub}>{line.item_label || "—"}</TableCell>
                              <TableCell className="px-3 py-2" style={S.sub}>{line.uom || "—"}</TableCell>
                              <TableCell className="px-3 py-2" style={S.sub}>{line.occurrence ? line.occurrence.charAt(0) + line.occurrence.slice(1).toLowerCase() : "—"}</TableCell>
                              <TableCell className="px-3 py-2" style={S.primary}>{Number(line.expected_qty).toLocaleString(undefined, { maximumFractionDigits: 4 })}</TableCell>
                              <TableCell className="px-2 py-1.5 w-28">
                                {isTextCapture(line) ? (
                                  <input
                                    type="text"
                                    value={dataEntryTexts[line.line_id] ?? ""}
                                    onChange={(e) => setDataEntryTexts((v) => ({ ...v, [line.line_id]: e.target.value }))}
                                    placeholder={line.kpi_uom}
                                    className={inputCls}
                                    style={S.input}
                                  />
                                ) : (
                                  <input
                                    type="number"
                                    value={dataEntryValues[line.line_id] ?? ""}
                                    onChange={(e) => setDataEntryValues((v) => ({ ...v, [line.line_id]: e.target.value }))}
                                    className={inputCls}
                                    style={S.input}
                                  />
                                )}
                                {line.lot_required && (
                                  <input
                                    type="text"
                                    value={dataEntryLotNos[line.line_id] ?? ""}
                                    onChange={(e) => setDataEntryLotNos((v) => ({ ...v, [line.line_id]: e.target.value }))}
                                    placeholder={t("blPlaceholderLotNo")}
                                    className={inputCls + " mt-1"}
                                    style={S.input}
                                  />
                                )}
                                {line.line_type === "TRANSFER" && (
                                  <select
                                    value={dataEntryDestBatches[line.line_id] ?? ""}
                                    onChange={(e) => setDataEntryDestBatches((v) => ({ ...v, [line.line_id]: e.target.value }))}
                                    className={`${inputCls} nf-select mt-1`}
                                    style={S.input}
                                  >
                                    <option value="">{t("blPlaceholderDestBatch")}</option>
                                    {batches.filter((b) => b.batch_id !== viewing.batch_id).map((b) => (
                                      <option key={b.batch_id} value={b.batch_id}>{b.batch_no}</option>
                                    ))}
                                  </select>
                                )}
                              </TableCell>
                              <TableCell className="px-2 py-1.5">
                                <button
                                  onClick={() => handleDataEntrySave(line)}
                                  disabled={dataEntrySavingId === line.line_id || !dataEntryCanSave(line)}
                                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                                  style={{ backgroundColor: "var(--accent)" }}
                                >
                                  {dataEntrySavingId === line.line_id ? t("blSaving") : t("blSave")}
                                </button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}


            {detailTab === "transactions" && (
            <>
            {viewing.status === "ACTIVE" && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blAddTransactionTitle")}</p>
                <div className="grid grid-cols-2 gap-2 rounded-[var(--radius-sm)] border p-3 sm:grid-cols-3" style={S.surface}>
                  <select value={txForm.transaction_type} onChange={(e) => setTxForm((f: Row) => ({ ...f, transaction_type: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                    {["CONSUMPTION", "MORTALITY", "OUTPUT", "OVERHEAD", "OBSERVATION"].map((tt) => <option key={tt} value={tt}>{tt}</option>)}
                  </select>
                  <input type="date" value={txForm.transaction_date} onChange={(e) => setTxForm((f: Row) => ({ ...f, transaction_date: e.target.value }))} className={inputCls} style={S.input} />
                  {["CONSUMPTION", "OUTPUT"].includes(txForm.transaction_type) && (
                    <select value={txForm.item_id} onChange={(e) => setTxForm((f: Row) => ({ ...f, item_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                      <option value="">{t("blSelectItemOptions", { count: items.length })}</option>
                      {items.map((it, i) => (
                        <option key={it.item_id} value={it.item_id}>
                          {i + 1}. {it.item_code} — {it.item_name || it.item_code}
                        </option>
                      ))}
                    </select>
                  )}
                  {txForm.transaction_type === "OVERHEAD" && (
                    <select value={txForm.resource_id} onChange={(e) => setTxForm((f: Row) => ({ ...f, resource_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                      <option value="">{t("blSelectResourcePlaceholder")}</option>
                      {resources.map((r) => <option key={r.resource_id} value={r.resource_id}>{r.resource_code}</option>)}
                    </select>
                  )}
                  {["CONSUMPTION", "MORTALITY", "OUTPUT", "OVERHEAD"].includes(txForm.transaction_type) && (
                    <input type="number" placeholder={t("blPlaceholderQty")} value={txForm.quantity} onChange={(e) => setTxForm((f: Row) => ({ ...f, quantity: e.target.value }))} className={inputCls} style={S.input} />
                  )}
                  {["CONSUMPTION", "OUTPUT"].includes(txForm.transaction_type) && (
                    <select value={txForm.uom} onChange={(e) => setTxForm((f: Row) => ({ ...f, uom: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                      <option value="">{t("blSelectUomPlaceholder")}</option>
                      {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
                    </select>
                  )}
                  {["OUTPUT", "OVERHEAD"].includes(txForm.transaction_type) && (
                    <input type="number" placeholder={t("blPlaceholderRate")} value={txForm.rate} onChange={(e) => setTxForm((f: Row) => ({ ...f, rate: e.target.value }))} className={inputCls} style={S.input} />
                  )}
                  {txForm.transaction_type === "OUTPUT" && (
                    <select value={txForm.output_type} onChange={(e) => setTxForm((f: Row) => ({ ...f, output_type: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                      <option value="">{t("blOutputMainProduct")}</option>
                      <option value="BY_PRODUCT">{t("blOutputByProduct")}</option>
                      <option value="WASTE">{t("blOutputWaste")}</option>
                    </select>
                  )}
                  {txForm.transaction_type === "OUTPUT" && txForm.output_type && (
                    <input type="number" placeholder={t("blPlaceholderNrvRate")} value={txForm.nrv_rate} onChange={(e) => setTxForm((f: Row) => ({ ...f, nrv_rate: e.target.value }))} className={inputCls} style={S.input} />
                  )}
                  <input placeholder={t("blPlaceholderRemarks")} value={txForm.remarks} onChange={(e) => setTxForm((f: Row) => ({ ...f, remarks: e.target.value }))} className={inputCls + " sm:col-span-3"} style={S.input} />
                  <Button onClick={handleAddTransaction} disabled={acting} size="sm" className="nf-btn-primary">
                    {acting ? t("blSaving") : t("blAddTransactionBtn")}
                  </Button>
                </div>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blTransactionLogTitle")}</p>
              <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader><tr className="border-b border-[var(--row-border)]">
                    <TableHead className="h-auto px-3 py-2">{t("blColDate")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("blColType")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("blColItem")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("blColQty")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("blColAmount")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("blColRemarks")}</TableHead>
                  </tr></TableHeader>
                  <TableBody>
                    {(viewing.transactions || []).length === 0 ? (
                      <tr><TableCell colSpan={6} className="py-6 text-center" style={S.sub}>{t("blNoTransactions")}</TableCell></tr>
                    ) : (viewing.transactions || []).map((t: Row) => (
                      <TableRow key={t.transaction_id}>
                        <TableCell className="px-3 py-2" style={S.primary}>{t.transaction_date}</TableCell>
                        <TableCell className="px-3 py-2" style={S.sub}>{t.transaction_type}</TableCell>
                        <TableCell className="px-3 py-2" style={S.primary}>{t.item_id ? itemLabel(t.item_id) : "—"}</TableCell>
                        <TableCell className="px-3 py-2" style={S.primary}>{t.quantity != null ? `${t.quantity} ${t.uom || ""}`.trim() : "—"}</TableCell>
                        <TableCell className="px-3 py-2 font-semibold" style={Number(t.amount) >= 0 ? { color: "var(--success)" } : { color: "var(--danger)" }}>{t.amount}</TableCell>
                        <TableCell className="px-3 py-2 max-w-[220px] truncate" style={S.sub} title={t.remarks || ""}>{t.remarks || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            </div>
            </>
            )}

            {detailTab === "overview" && (
            <>
            {viewing.costing_method === "BIO_ASSET" && (viewing.bio_asset_entries || []).length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blBioAssetLedgerTitle")}</p>
                <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                  <table className="w-full border-collapse text-left text-xs">
                    <TableHeader><tr className="border-b border-[var(--row-border)]">
                      <TableHead className="h-auto px-3 py-2">{t("blColDate")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColEntryType")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColItem")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColStage")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColQty")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColCostAmount")}</TableHead>
                    </tr></TableHeader>
                    <TableBody>
                      {(viewing.bio_asset_entries || []).map((e: Row) => (
                        <TableRow key={e.entry_id}>
                          <TableCell className="px-3 py-2" style={S.primary}>{e.posting_date}</TableCell>
                          <TableCell className="px-3 py-2" style={S.sub}>{e.entry_type}</TableCell>
                          <TableCell className="px-3 py-2" style={S.primary}>{itemLabel(e.bio_asset_item_id)}</TableCell>
                          <TableCell className="px-3 py-2" style={S.sub}>{e.stage ?? "—"}</TableCell>
                          <TableCell className="px-3 py-2" style={S.primary}>{e.quantity ?? "—"}</TableCell>
                          <TableCell className="px-3 py-2 font-semibold" style={Number(e.cost_amount) >= 0 ? { color: "var(--success)" } : { color: "var(--danger)" }}>{e.cost_amount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
              </div>
            )}

            {viewing.status === "ACTIVE" && viewing.costing_method !== "BIO_ASSET" && (
              <Button size="sm" onClick={openClose} style={{ backgroundColor: "var(--success)", color: "#fff" }} className="gap-1.5 self-start">
                <CheckCircle2 className="h-4 w-4" /> {t("blCloseBatch")}
              </Button>
            )}

            {viewing.status === "CLOSED" && (viewing.output_lines || []).length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blOutputLinesTitle")}</p>
                <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                  <table className="w-full border-collapse text-left text-xs">
                    <TableHeader><tr className="border-b border-[var(--row-border)]">
                      <TableHead className="h-auto px-3 py-2">{t("blColItem")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColType")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColSplitPct")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColQty")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColCostUnitCost")}</TableHead>
                      <TableHead className="h-auto px-3 py-2 text-right">{t("blColQcPack")}</TableHead>
                    </tr></TableHeader>
                    <TableBody>
                      {(viewing.output_lines || []).map((l: Row) => (
                        <TableRow key={l.line_id}>
                          <TableCell className="px-3 py-2" style={S.primary}>{itemLabel(l.item_id)}</TableCell>
                          <TableCell className="px-3 py-2" style={S.sub}>{l.output_type}</TableCell>
                          <TableCell className="px-3 py-2" style={S.primary}>{l.cost_split_pct}%</TableCell>
                          <TableCell className="px-3 py-2" style={S.primary}>{l.quantity} {l.uom}</TableCell>
                          <TableCell className="px-3 py-2" style={S.primary}>{l.computed_cost} / {l.unit_cost}</TableCell>
                          <TableCell className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <button onClick={() => openRecordQc(l)} title={t("blRecordQcTitle")} className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)" style={S.sub}>
                                <ClipboardCheck className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => openGeneratePack(l)} title={t("blGeneratePackTitle")} className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)" style={S.sub}>
                                <QrCodeIcon className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
              </div>
            )}

            {viewing.status === "CLOSED" && (viewing.variances || []).length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blCostVarianceTitle")}</p>
                <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                  <table className="w-full border-collapse text-left text-xs">
                    <TableHeader><tr className="border-b border-[var(--row-border)]">
                      <TableHead className="h-auto px-3 py-2">{t("blColType")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColItem")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColStdValue")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColActualValue")}</TableHead>
                      <TableHead className="h-auto px-3 py-2">{t("blColVariance")}</TableHead>
                      <TableHead className="h-auto px-3 py-2"></TableHead>
                    </tr></TableHeader>
                    <TableBody>
                      {(viewing.variances || []).map((v: Row) => (
                        <TableRow key={v.variance_id}>
                          <TableCell className="px-3 py-2" style={S.primary}>{v.variance_type}</TableCell>
                          <TableCell className="px-3 py-2" style={S.sub}>{v.item_id ? itemLabel(v.item_id) : "—"}</TableCell>
                          <TableCell className="px-3 py-2" style={S.primary}>{Number(v.std_value).toLocaleString(undefined, { maximumFractionDigits: 4 })}</TableCell>
                          <TableCell className="px-3 py-2" style={S.primary}>{Number(v.actual_value).toLocaleString(undefined, { maximumFractionDigits: 4 })}</TableCell>
                          <TableCell className="px-3 py-2 font-semibold" style={v.is_favorable ? { color: "var(--success)" } : { color: "var(--danger)" }}>{v.variance_amount}</TableCell>
                          <TableCell className="px-3 py-2">
                            <Badge variant={v.is_favorable ? "success" : "danger"}>{v.is_favorable ? t("blVarianceFav") : t("blVarianceUnfav")}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
              </div>
            )}

            {viewing.status === "CLOSED" && renewAllowed && (
              <Button size="sm" variant="outline" onClick={openRenew} className="gap-1.5 self-start">
                <RefreshCw className="h-3.5 w-3.5" /> {t("blRenewBatch")}
              </Button>
            )}
            </>
            )}

            {detailTab === "curves" && (
              <div className="py-2">
                <BatchPerformanceCurvesPanel
                  batchId={viewing.batch_id}
                  onSchedulerGenerated={() => {
                    load();
                    api.get(`/batch/${viewing.batch_id}`).then((r) => setViewing(unwrap<Row>(r)));
                  }}
                />
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* Transfer stage modal */}
      <Dialog
        open={stageModalOpen}
        onClose={() => !stageSaving && setStageModalOpen(false)}
        title={t("blTransferStage")}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setStageModalOpen(false)} disabled={stageSaving}>{t("blCancel")}</Button>
            <Button size="sm" onClick={handleTransferStage} disabled={stageSaving || stageOptions.length === 0 || !stageForm.to_stage_code} className="nf-btn-primary">
              {stageSaving ? t("blTransferring") : t("blTransferBtn")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {stageError && (
            <InlineAlert>{stageError}</InlineAlert>
          )}
          <p className="text-xs" style={S.sub}>{t("blCurrentStagePrefix")} <span className="font-semibold" style={S.primary}>{viewing?.current_stage_code || t("blNone")}</span>. {t("blNoCostGlImpactNote")}</p>
          <div className="flex flex-col gap-1.5">
            <label className="nf-text-label" style={S.sub}>{t("blLabelNewStage")} *</label>
            {stageOptionsLoading ? (
              <div className="flex items-center gap-2 text-xs" style={S.sub}><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("blLoadingStages")}</div>
            ) : stageOptions.length > 0 ? (
              <select value={stageForm.to_stage_code || ""} onChange={(e) => setStageForm((f: Row) => ({ ...f, to_stage_code: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("blSelectStagePlaceholder")}</option>
                {stageOptions.map((code) => (<option key={code} value={code}>{code}</option>))}
              </select>
            ) : (
              <p className="text-xs" style={S.muted}>{t("blNoStagesConfigured")}</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="nf-text-label" style={S.sub}>{t("blLabelRemarks")}</label>
            <input value={stageForm.remarks || ""} onChange={(e) => setStageForm((f: Row) => ({ ...f, remarks: e.target.value }))} className={inputCls} style={S.input} />
          </div>
        </div>
      </Dialog>

      {/* Renew batch modal */}
      <Dialog
        open={renewModalOpen}
        onClose={() => !renewSaving && setRenewModalOpen(false)}
        title={t("blRenewBatch")}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setRenewModalOpen(false)} disabled={renewSaving}>{t("blCancel")}</Button>
            <Button size="sm" onClick={handleRenew} disabled={renewSaving} className="nf-btn-primary">
              {renewSaving ? t("blCreating") : t("blCreateNextCycle")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {renewError && (
            <InlineAlert>{renewError}</InlineAlert>
          )}
          <div className="rounded-lg border px-3 py-2 text-xs" style={S.surface}>
            <p className="mb-1 font-semibold uppercase tracking-wider" style={S.muted}>{t("blCarriedForwardFrom", { batchNo: viewing?.batch_no })}</p>
            <p style={S.sub}>{t("blLabelBreedColon")} <span style={S.primary}>{viewing?.breed_id ? breeds.find((b) => b.breed_id === viewing.breed_id)?.breed_name || "—" : "—"}</span></p>
            <p style={S.sub}>{t("blLabelShedColon")} <span style={S.primary}>{viewing?.shed_id ? sheds.find((s) => s.shed_id === viewing.shed_id)?.shed_name || "—" : "—"}</span></p>
            <p style={S.sub}>{t("blLabelCostingMethodColon")} <span style={S.primary}>{viewing?.costing_method}</span>{viewing?.standard ? t("blStdCostCarriedForwardNote") : ""}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelStartDate")} *</label>
              <input type="date" value={renewForm.start_date || ""} onChange={(e) => setRenewForm((f: Row) => ({ ...f, start_date: e.target.value }))} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelExpectedEndDate")}</label>
              <input type="date" value={renewForm.expected_end_date || ""} onChange={(e) => setRenewForm((f: Row) => ({ ...f, expected_end_date: e.target.value }))} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelOpeningQty")} *</label>
              <input type="number" value={renewForm.opening_quantity ?? ""} onChange={(e) => setRenewForm((f: Row) => ({ ...f, opening_quantity: e.target.value }))} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelUom")} *</label>
              <select value={renewForm.uom || ""} onChange={(e) => setRenewForm((f: Row) => ({ ...f, uom: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("blSelectEllipsis")}</option>
                {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
              </select>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blInputLineTitle")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <select value={renewForm.item_id || ""} onChange={(e) => setRenewForm((f: Row) => ({ ...f, item_id: e.target.value }))} className={inputCls + " sm:col-span-2 nf-select"} style={S.input}>
                <option value="">{t("blSelectItemOptions", { count: items.length })}</option>
                {items.map((it, i) => (
                  <option key={it.item_id} value={it.item_id}>
                    {i + 1}. {it.item_code} — {it.item_name || it.item_code}
                  </option>
                ))}
              </select>
              <input type="number" placeholder={t("blPlaceholderQty")} value={renewForm.quantity ?? ""} onChange={(e) => setRenewForm((f: Row) => ({ ...f, quantity: e.target.value }))} className={inputCls} style={S.input} />
              <select value={renewForm.line_uom || ""} onChange={(e) => setRenewForm((f: Row) => ({ ...f, line_uom: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                <option value="">{t("blSelectUomPlaceholder")}</option>
                {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
              </select>
              <input type="number" placeholder={t("blPlaceholderEstRate")} value={renewForm.rate ?? ""} onChange={(e) => setRenewForm((f: Row) => ({ ...f, rate: e.target.value }))} className={inputCls + " sm:col-span-4"} style={S.input} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="nf-text-label" style={S.sub}>{t("blLabelRemarks")}</label>
            <input value={renewForm.remarks || ""} onChange={(e) => setRenewForm((f: Row) => ({ ...f, remarks: e.target.value }))} className={inputCls} style={S.input} />
          </div>
        </div>
      </Dialog>

      {/* Close batch modal */}
      <Dialog
        open={closeModalOpen}
        onClose={() => !acting && setCloseModalOpen(false)}
        title={t("blCloseBatchTitle", { batchNo: viewing?.batch_no || "" })}
        maxWidth="xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setCloseModalOpen(false)} disabled={acting}>{t("blCancel")}</Button>
            <Button size="sm" onClick={handleClose} disabled={acting} className="nf-btn-primary">
              {acting ? t("blClosing") : t("blCloseBatch")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {closeError && (
            <InlineAlert>{closeError}</InlineAlert>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelActualEndDate")}</label>
              <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className={inputCls} style={S.input} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelClosingQty")}</label>
              <input type="number" value={closeQty} onChange={(e) => setCloseQty(e.target.value)} className={inputCls} style={S.input} />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blOutputLinesSplitNote")}</p>
            <button onClick={addOutputLine} type="button" className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold" style={S.surface}>
              <Plus className="h-3 w-3" /> {t("blAddLine")}
            </button>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
            <table className="w-full border-collapse text-left text-xs">
              <TableHeader>
                <tr className="border-b border-[var(--row-border)]">
                  <TableHead className="h-auto px-3 py-2">{t("blColItem")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("blColType")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("blColSplitPct")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("blColQty")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("blColUom")}</TableHead>
                  <TableHead className="h-auto px-3 py-2">{t("blColWarehouse")}</TableHead>
                  <TableHead className="h-auto px-3 py-2"></TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {outputLines.map((line, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="px-2 py-1.5">
                      <select value={line.item_id} onChange={(e) => setOutputLineField(idx, "item_id", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                        <option value="">{t("blSelectItemOptions", { count: items.length })}</option>
                        {items.map((it, i) => (
                          <option key={it.item_id} value={it.item_id}>
                            {i + 1}. {it.item_code} — {it.item_name || it.item_code}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 w-24">
                      <select value={line.output_type} onChange={(e) => setOutputLineField(idx, "output_type", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                        <option value="MAIN">{t("blOutputTypeMain")}</option>
                        <option value="BY_PRODUCT">{t("blOutputTypeByProduct")}</option>
                      </select>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 w-20"><input type="number" value={line.cost_split_pct} onChange={(e) => setOutputLineField(idx, "cost_split_pct", e.target.value)} className={inputCls} style={S.input} /></TableCell>
                    <TableCell className="px-2 py-1.5 w-20"><input type="number" value={line.quantity} onChange={(e) => setOutputLineField(idx, "quantity", e.target.value)} className={inputCls} style={S.input} /></TableCell>
                    <TableCell className="px-2 py-1.5 w-24">
                      <select value={line.uom} onChange={(e) => setOutputLineField(idx, "uom", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                        <option value="">{t("blSelectEllipsis")}</option>
                        {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
                      </select>
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <select value={line.warehouse_id} onChange={(e) => setOutputLineField(idx, "warehouse_id", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                        <option value="">{t("blSelectEllipsis")}</option>
                        {warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_code}</option>)}
                      </select>
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <button onClick={() => removeOutputLine(idx)} type="button" className="rounded-[var(--radius-xs)] p-1 transition hover:bg-(--danger-muted)" style={{ color: "var(--danger)" }}><Trash2 className="h-3.5 w-3.5" /></button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <tr>
                  <TableCell colSpan={2} className="px-3 py-2" style={S.sub}>{t("blSplitTotal")}</TableCell>
                  <TableCell className="px-3 py-2" style={{ color: Math.abs(splitTotal - 100) < 0.01 ? "var(--success)" : "var(--danger)" }}>{splitTotal.toFixed(2)}%</TableCell>
                  <TableCell colSpan={4}></TableCell>
                </tr>
              </TableFooter>
            </table>
          </div>
        </div>
      </Dialog>

      {/* Bio-asset lifecycle action modal (mature / amortize / fair-value / dispose) */}
      <Dialog
        open={!!bioActionOpen}
        onClose={() => !bioActing && setBioActionOpen(null)}
        title={
          bioActionOpen === "mature" ? t("blMatureHerd")
            : bioActionOpen === "amortize" ? t("blRunAmortization")
            : bioActionOpen === "fair-value" ? t("blRecordFairValue")
            : t("blDispose")
        }
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setBioActionOpen(null)} disabled={bioActing}>{t("blCancel")}</Button>
            <Button size="sm" onClick={handleBioAction} disabled={bioActing} className="nf-btn-primary">
              {bioActing ? t("blSaving") : t("blConfirm")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {bioError && (
            <InlineAlert>{bioError}</InlineAlert>
          )}

          {bioActionOpen === "mature" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("blLabelResidualValue")} <span className="text-(--danger)">*</span></label>
                <input type="number" value={bioForm.residual_value_per_unit} onChange={(e) => setBioForm((f: Row) => ({ ...f, residual_value_per_unit: e.target.value }))} className={inputCls} style={S.input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("blLabelProductiveLife")}</label>
                <input type="number" value={bioForm.productive_life_months} onChange={(e) => setBioForm((f: Row) => ({ ...f, productive_life_months: e.target.value }))} placeholder={t("blPlaceholderFromBreed")} className={inputCls} style={S.input} />
              </div>
            </div>
          )}

          {bioActionOpen === "amortize" && (
            <div className="flex flex-col gap-1.5">
              <label className="nf-text-label" style={S.sub}>{t("blLabelPostingDate")}</label>
              <input type="date" value={bioForm.posting_date} onChange={(e) => setBioForm((f: Row) => ({ ...f, posting_date: e.target.value }))} className={inputCls} style={S.input} />
              <p className="text-[11px]" style={S.muted}>{t("blAmortizationNote")}</p>
            </div>
          )}

          {bioActionOpen === "fair-value" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("blLabelPostingDate")}</label>
                <input type="date" value={bioForm.posting_date} onChange={(e) => setBioForm((f: Row) => ({ ...f, posting_date: e.target.value }))} className={inputCls} style={S.input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("blLabelNewFairValue")} <span className="text-(--danger)">*</span></label>
                <input type="number" value={bioForm.fair_value_per_unit} onChange={(e) => setBioForm((f: Row) => ({ ...f, fair_value_per_unit: e.target.value }))} className={inputCls} style={S.input} />
              </div>
            </div>
          )}

          {bioActionOpen === "dispose" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelDisposalType")}</label>
                  <select value={bioForm.disposal_type} onChange={(e) => setBioForm((f: Row) => ({ ...f, disposal_type: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                    <option value="HARVEST">{t("blDisposalHarvest")}</option>
                    <option value="SOLD">{t("blDisposalSold")}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelQuantity")}</label>
                  <input type="number" value={bioForm.quantity} onChange={(e) => setBioForm((f: Row) => ({ ...f, quantity: e.target.value }))} className={inputCls} style={S.input} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelPostingDate")}</label>
                  <input type="date" value={bioForm.posting_date} onChange={(e) => setBioForm((f: Row) => ({ ...f, posting_date: e.target.value }))} className={inputCls} style={S.input} />
                </div>
              </div>

              {bioForm.disposal_type === "HARVEST" ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="nf-text-label" style={S.sub}>
                      {t("blLabelOutputItem", { count: items.length })}
                    </label>
                    <select value={bioForm.output_item_id} onChange={(e) => setBioForm((f: Row) => ({ ...f, output_item_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                      <option value="">{t("blSelectItemOptions", { count: items.length })}</option>
                      {items.map((it, i) => (
                        <option key={it.item_id} value={it.item_id}>
                          {i + 1}. {it.item_code} — {it.item_name || it.item_code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="nf-text-label" style={S.sub}>{t("blLabelOutputUom")}</label>
                    <select value={bioForm.output_uom} onChange={(e) => setBioForm((f: Row) => ({ ...f, output_uom: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                      <option value="">{t("blSelectEllipsis")}</option>
                      {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="nf-text-label" style={S.sub}>{t("blLabelOutputQuantity")}</label>
                    <input type="number" value={bioForm.output_quantity} onChange={(e) => setBioForm((f: Row) => ({ ...f, output_quantity: e.target.value }))} className={inputCls} style={S.input} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="nf-text-label" style={S.sub}>{t("blLabelWarehouse")}</label>
                    <select value={bioForm.warehouse_id} onChange={(e) => setBioForm((f: Row) => ({ ...f, warehouse_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                      <option value="">{t("blSelectEllipsis")}</option>
                      {warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_code}</option>)}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelSaleProceeds")}</label>
                  <input type="number" value={bioForm.sale_proceeds} onChange={(e) => setBioForm((f: Row) => ({ ...f, sale_proceeds: e.target.value }))} className={inputCls} style={S.input} />
                  <p className="text-[11px]" style={S.muted}>{t("blSaleProceedsNote")}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </Dialog>

      {/* Record QC modal */}
      <Dialog
        open={qcModalOpen}
        onClose={() => !qcSaving && setQcModalOpen(false)}
        title={qcLine ? t("blRecordQcTitleFull", { item: itemLabel(qcLine.item_id) }) : t("blRecordQc")}
        maxWidth="lg"
        footer={
          qcSubmitted ? undefined : (
            <>
              <Button variant="outline" size="sm" onClick={() => setQcModalOpen(false)} disabled={qcSaving}>{t("blCancel")}</Button>
              <Button size="sm" onClick={handleSaveQc} disabled={qcSaving} className="nf-btn-primary">
                {qcSaving ? t("blSaving") : t("blSubmitInspection")}
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {qcError && (
            <InlineAlert>{qcError}</InlineAlert>
          )}

          {qcSubmitted ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <span
                className="rounded-full border px-4 py-1.5 text-sm font-semibold"
                style={qcSubmitted.overall_result === "PASS"
                  ? { color: "var(--success)", borderColor: "var(--success)", backgroundColor: "var(--success-muted)" }
                  : { color: "var(--danger)", borderColor: "var(--danger)", backgroundColor: "var(--surface-raised)" }}
              >
                {t("blOverallResult", { result: qcSubmitted.overall_result })}
              </span>
              <p className="text-xs" style={S.sub}>{t("blDispositionLabel", { disposition: qcSubmitted.disposition })}</p>
              <div className="w-full overflow-x-auto rounded-[var(--radius-sm)] border" style={S.surface}>
                <table className="w-full border-collapse text-left text-xs">
                  <TableHeader><tr className="border-b border-(--row-border)">
                    <TableHead className="h-auto px-3 py-2">{t("blColParameter")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("blColValue")}</TableHead>
                    <TableHead className="h-auto px-3 py-2">{t("blColResult")}</TableHead>
                  </tr></TableHeader>
                  <TableBody>
                    {(qcSubmitted.results || []).map((r: Row) => {
                      const param = qcParameters.find((p) => p.param_id === r.param_id);
                      return (
                        <TableRow key={r.result_id}>
                          <TableCell className="px-3 py-2" style={S.primary}>{param?.param_name || r.param_id}</TableCell>
                          <TableCell className="px-3 py-2" style={S.sub}>{r.actual_value}{r.grade_assigned ? ` (${r.grade_assigned})` : ""}</TableCell>
                          <TableCell className="px-3 py-2 font-semibold" style={r.result_status === "PASS" ? { color: "var(--success)" } : { color: "var(--danger)" }}>{r.result_status}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelQcDate")}</label>
                  <input type="date" value={qcForm.qc_date} onChange={(e) => setQcForm((f: Row) => ({ ...f, qc_date: e.target.value }))} className={inputCls} style={S.input} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelTotalQtyReceived")}</label>
                  <input type="number" value={qcForm.total_qty_received} onChange={(e) => setQcForm((f: Row) => ({ ...f, total_qty_received: e.target.value }))} className={inputCls} style={S.input} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelDisposition")}</label>
                  <select value={qcForm.disposition} onChange={(e) => setQcForm((f: Row) => ({ ...f, disposition: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                    {["ACCEPT", "REJECT", "REWORK", "QUARANTINE", "CONDITIONAL_ACCEPT"].map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelPassQty")}</label>
                  <input type="number" value={qcForm.pass_qty} onChange={(e) => setQcForm((f: Row) => ({ ...f, pass_qty: e.target.value }))} className={inputCls} style={S.input} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelFailQty")}</label>
                  <input type="number" value={qcForm.fail_qty} onChange={(e) => setQcForm((f: Row) => ({ ...f, fail_qty: e.target.value }))} className={inputCls} style={S.input} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="nf-text-label" style={S.sub}>{t("blLabelHoldQty")}</label>
                  <input type="number" value={qcForm.hold_qty} onChange={(e) => setQcForm((f: Row) => ({ ...f, hold_qty: e.target.value }))} className={inputCls} style={S.input} />
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider" style={S.sub}>{t("blParameterResultsTitle")}</p>
                {qcParameters.length === 0 ? (
                  <p className="rounded-[var(--radius-sm)] border p-3 text-xs" style={{ ...S.surface, ...S.sub }}>{t("blNoQcParams")}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {qcParameters.map((p) => (
                      <div key={p.param_id} className="grid grid-cols-3 items-center gap-2 rounded-[var(--radius-sm)] border p-2.5" style={S.surface}>
                        <div>
                          <p className="text-xs font-semibold" style={S.primary}>{p.param_name}{p.is_mandatory && <span className="text-(--danger)"> *</span>}</p>
                          <p className="text-[10px]" style={S.muted}>{p.param_type === "NUMERIC" ? `${p.min_value ?? "—"}–${p.max_value ?? "—"} ${p.uom || ""}` : p.param_type}</p>
                        </div>
                        <div className="col-span-2">
                          {p.param_type === "NUMERIC" && (
                            <input type="number" placeholder={t("blPlaceholderActualValue")} value={qcResultValues[p.param_id]?.actual_value ?? ""} onChange={(e) => setQcResultField(p.param_id, "actual_value", e.target.value)} className={inputCls} style={S.input} />
                          )}
                          {p.param_type === "BOOLEAN" && (
                            <select value={qcResultValues[p.param_id]?.actual_value ?? ""} onChange={(e) => setQcResultField(p.param_id, "actual_value", e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
                              <option value="">{t("blSelectEllipsis")}</option>
                              <option value="true">{t("blPassTrue")}</option>
                              <option value="false">{t("blFailFalse")}</option>
                            </select>
                          )}
                          {p.param_type === "GRADE" && (
                            <select
                              value={qcResultValues[p.param_id]?.actual_value ?? ""}
                              onChange={(e) => { setQcResultField(p.param_id, "actual_value", e.target.value); setQcResultField(p.param_id, "grade_assigned", e.target.value); }}
                              className={`${inputCls} nf-select`}
                              style={S.input}
                            >
                              <option value="">{t("blSelectGrade")}</option>
                              {Object.keys(p.grade_scale || {}).map((g) => <option key={g} value={g}>{g} — {p.grade_scale[g]}</option>)}
                            </select>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("blLabelNotes")}</label>
                <input value={qcForm.qc_notes} onChange={(e) => setQcForm((f: Row) => ({ ...f, qc_notes: e.target.value }))} className={inputCls} style={S.input} />
              </div>
            </>
          )}
        </div>
      </Dialog>

      {/* Generate Pack modal */}
      <Dialog
        open={packModalOpen}
        onClose={() => !packSaving && setPackModalOpen(false)}
        title={packLine ? t("blGeneratePackTitleFull", { item: itemLabel(packLine.item_id) }) : t("blGeneratePack")}
        footer={
          generatedPack ? (
            <Button variant="outline" size="sm" onClick={generateAnotherPack}>{t("blGenerateAnotherPack")}</Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setPackModalOpen(false)} disabled={packSaving}>{t("blCancel")}</Button>
              <Button size="sm" onClick={handleGeneratePack} disabled={packSaving || packQcGateBlocked} title={packQcGateBlocked ? t("blPackQcGateTooltip") : undefined} className="nf-btn-primary">
                {packSaving ? t("blGenerating") : t("blGeneratePack")}
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {packError && (
            <InlineAlert>{packError}</InlineAlert>
          )}

          {!generatedPack && packQcRequired && (
            <InlineAlert variant="warning">{t("blPackQcRequiredWarning")}</InlineAlert>
          )}

          {generatedPack ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <p className="text-sm font-semibold" style={S.primary}>{generatedPack.pack_no}</p>
              <div className="rounded-[var(--radius-sm)] bg-white p-4">
                <QRCode value={JSON.stringify(generatedPack.qr_data)} size={200} />
              </div>
              <p className="text-xs" style={S.sub}>{generatedPack.net_weight} {generatedPack.pack_uom} — {generatedPack.production_date}{generatedPack.expiry_date ? ` → ${generatedPack.expiry_date}` : ""}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("blLabelNetWeight")} <span className="text-(--danger)">*</span></label>
                <input type="number" value={packForm.net_weight} onChange={(e) => setPackForm((f: Row) => ({ ...f, net_weight: e.target.value }))} className={inputCls} style={S.input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("blLabelGrossWeight")}</label>
                <input type="number" value={packForm.gross_weight} onChange={(e) => setPackForm((f: Row) => ({ ...f, gross_weight: e.target.value }))} className={inputCls} style={S.input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("blLabelPackUom")} <span className="text-(--danger)">*</span></label>
                <select value={packForm.pack_uom} onChange={(e) => setPackForm((f: Row) => ({ ...f, pack_uom: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                  <option value="">{t("blSelectEllipsis")}</option>
                  {uoms.map((u) => <option key={u.uom_code} value={u.uom_code}>{u.uom_code}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("blLabelLotNo")}</label>
                <input value={packForm.lot_no} onChange={(e) => setPackForm((f: Row) => ({ ...f, lot_no: e.target.value }))} className={inputCls} style={S.input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("blLabelWarehouseFacility")}</label>
                <select value={packForm.warehouse_id} onChange={(e) => setPackForm((f: Row) => ({ ...f, warehouse_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                  <option value="">{t("blSelectEllipsis")}</option>
                  {warehouses.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_code}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="nf-text-label" style={S.sub}>{t("blLabelLinkQcRecord")}{packQcRequired ? t("blQcRequiredSuffix") : t("blQcOptionalSuffix")}</label>
                <select value={packForm.qc_id} onChange={(e) => setPackForm((f: Row) => ({ ...f, qc_id: e.target.value }))} className={`${inputCls} nf-select`} style={S.input}>
                  <option value="">{t("blNone")}</option>
                  {packQcRecords.map((q) => <option key={q.qc_id} value={q.qc_id}>{q.qc_date} — {q.overall_result}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
      </Dialog>

      <Dialog
        open={!!mergeTarget}
        onClose={() => setMergeTarget(null)}
        title={`Merge ${mergeTarget?.batch_no ?? ""} back`}
        maxWidth="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setMergeTarget(null)}>Cancel</Button>
            <Button size="sm" className="nf-btn-primary" onClick={confirmMerge} disabled={mergeBusy}>
              {mergeBusy ? "Merging…" : "Merge back"}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-xs">
          {mergeError && <p className="text-[var(--danger)]">{mergeError}</p>}
          <p style={S.sub}>
            Every live animal in this group returns to the batch it was split from, and this
            batch closes. Each animal keeps its own stage history — rejoining never rewrites
            where an animal has been.
          </p>
        </div>
      </Dialog>
    </div>
  );
}
