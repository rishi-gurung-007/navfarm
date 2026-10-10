"use client";

import { useMemo, useState } from "react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import { showToast } from "@/components/ui/toast";
import { unwrap } from "./feed-format";
import { MillCapacityBadge, millCapacityText, formatKg, type MillCapacityState, type MillCapacityStatus } from "./mill-capacity-view";

type EligibleLine = {
  requisition_id: string; req_no: string; farm_id: string; farm_code: string; farm_name: string | null;
  line_id: string; item_id: string; item_code: string; item_name: string; quantity: string | number;
  destination_silo_id: string | null;
  destination_silo_code?: string | null; destination_silo_name?: string | null;
  proposed_delivery_date: string | null; production_date: string | null; feed_type: string | null;
  diet_no: number | null; loading_bin: string | null; loading_bin_name?: string | null; loading_bin_capacity_kg?: string | number | null; available_mill_output_kg: string | number | null;
  /** Engine r42–r43 for the line's diet on its production date (Requisition and Loading Sheet r125). */
  mill_capacity_state?: MillCapacityState; mill_capacity_status?: MillCapacityStatus | null; mill_demand_kg?: number | null;
};

export function FeedConsolidationDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (message: string) => void }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<"requisition" | "date">("requisition");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reqSearch, setReqSearch] = useState("");
  const [rows, setRows] = useState<EligibleLine[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dateHint, setDateHint] = useState("");
  const [selectHint, setSelectHint] = useState("");

  const load = async () => {
    setBusy(true);
    setDateHint("");
    try {
      if (mode === "date" && (!fromDate || !toDate || fromDate > toDate)) {
        setDateHint(t("fcdInvalidDates"));
        return;
      }
      const params = new URLSearchParams();
      if (mode === "date") { if (fromDate) params.set("fromDate", fromDate); if (toDate) params.set("toDate", toDate); }
      const data = unwrap<EligibleLine[]>(await api.get(`/feed-requisition/consolidations/eligible?${params.toString()}`));
      setRows(Array.isArray(data) ? data : []);
      setSelected([]); setApproved({}); setReasons({});
    } catch (err: any) { showToast.error(err?.message || t("fcdLoadFailed")); }
    finally { setBusy(false); }
  };

  const requisitions = useMemo(() => {
    const map = new Map<string, EligibleLine>();
    for (const row of rows) if (!map.has(row.requisition_id)) map.set(row.requisition_id, row);
    const search = reqSearch.trim().toLowerCase();
    return [...map.values()].filter((row) => !search || row.req_no.toLowerCase().includes(search));
  }, [rows, reqSearch]);
  const selectedRows = rows.filter((row) => selected.includes(row.requisition_id));
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  const create = async () => {
    if (!selectedRows.length) { setSelectHint(t("fcdSelectOne")); return; }
    setBusy(true);
    setSelectHint("");
    try {
      const data = unwrap<{ consolidationNo: string }>(await api.post("/feed-requisition/consolidations", {
        requisitionIds: selected,
        lines: selectedRows.map((row) => ({
          requisitionLineId: row.line_id,
          millApprovedQtyKg: approved[row.line_id] === undefined || approved[row.line_id] === "" ? undefined : Number(approved[row.line_id]),
          adjustmentReason: reasons[row.line_id] || undefined,
        })),
      }));
      onCreated(t("fcdCreated", { no: data.consolidationNo }));
      onClose();
    } catch (err: any) { showToast.error(err?.message || t("fcdCreateFailed")); }
    finally { setBusy(false); }
  };

  return <Dialog open={open} onClose={onClose} title="Mill Consolidation Sheet" description="Feed requisitions only. Approved requisitions without a consolidation sheet are eligible." maxWidth="xl" presentation="compact" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={create} disabled={busy || !selectedRows.length}>Create consolidation</Button></>}>
      <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Select by" htmlFor="consolidation-filter"><select id="consolidation-filter" className="nf-input-sm nf-select" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="requisition">Requisition no.</option><option value="date">Date range</option></select></Field>
        {mode === "requisition" && <Field label="Requisition no." htmlFor="consolidation-search"><input id="consolidation-search" className="nf-input-sm" placeholder="Search requisition no." value={reqSearch} onChange={(event) => setReqSearch(event.target.value)} /></Field>}
        {mode === "date" && <><Field label="From date" htmlFor="consolidation-from"><input id="consolidation-from" type="date" className="nf-input-sm" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></Field><Field label="To date" htmlFor="consolidation-to"><input id="consolidation-to" type="date" className="nf-input-sm" value={toDate} onChange={(event) => setToDate(event.target.value)} /></Field></>}
        <Button variant="outline" onClick={load} disabled={busy}>{busy ? "Loading…" : "Find approved requisitions"}</Button>
      </div>
      {dateHint && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{dateHint}</p>}
      {rows.length > 0 && <div className="overflow-x-auto rounded border border-[var(--border)]"><table className="w-full text-xs"><thead><tr className="border-b border-[var(--border)] text-left"><th className="p-2">Select</th><th className="p-2">Requisition No.</th><th className="p-2">Farm</th><th className="p-2">Destination silo</th><th className="p-2">Feed item / Diet No.</th><th className="p-2">Mill loading bin</th><th className="p-2">{t("feedPlanColCapacity")}</th><th className="p-2 text-right">Farm requested KG</th><th className="p-2">Mill approved KG</th><th className="p-2">Adjustment reason</th></tr></thead><tbody>{requisitions.map((req) => <tr key={req.requisition_id} className="border-b border-[var(--border-subtle)]"><td className="p-2"><input type="checkbox" checked={selected.includes(req.requisition_id)} onChange={() => toggle(req.requisition_id)} /></td><td className="p-2 font-medium">{req.req_no}</td><td className="p-2">{req.farm_code} — {req.farm_name}</td><td className="p-2">{req.destination_silo_code ? `${req.destination_silo_code}${req.destination_silo_name ? ` — ${req.destination_silo_name}` : ""}` : "Not available"}</td><td className="p-2">{req.item_code} — {req.item_name}{req.diet_no == null ? "" : ` · Diet ${req.diet_no}`}</td><td className="p-2">{req.loading_bin ? `${req.loading_bin}${req.loading_bin_name ? ` — ${req.loading_bin_name}` : ""}${req.loading_bin_capacity_kg == null ? "" : ` · ${Number(req.loading_bin_capacity_kg).toLocaleString()} KG`}` : "Not configured"}</td><td className="p-2"><CapacityCell row={req} t={t} /></td><td className="p-2 text-right">{rows.filter((row) => row.requisition_id === req.requisition_id).reduce((sum, row) => sum + Number(row.quantity), 0).toLocaleString()}</td><td className="p-2">—</td><td className="p-2">Select the requisition to edit its lines below.</td></tr>)}{selectedRows.map((row) => <tr key={`line-${row.line_id}`} className="bg-[var(--surface-raised)]"><td className="p-2" /><td className="p-2 text-[var(--text-secondary)]">Line</td><td className="p-2">{row.farm_code}</td><td className="p-2">{row.destination_silo_code ? `${row.destination_silo_code}${row.destination_silo_name ? ` — ${row.destination_silo_name}` : ""}` : "Not available"}</td><td className="p-2">{row.item_code} — {row.item_name}{row.diet_no == null ? "" : ` · Diet ${row.diet_no}`}</td><td className="p-2">{row.loading_bin ? `${row.loading_bin}${row.loading_bin_name ? ` — ${row.loading_bin_name}` : ""}${row.loading_bin_capacity_kg == null ? "" : ` · ${Number(row.loading_bin_capacity_kg).toLocaleString()} KG`}` : "Not configured"}</td><td className="p-2"><CapacityCell row={row} t={t} /></td><td className="p-2 text-right">{Number(row.quantity).toLocaleString()}</td><td className="p-2"><input aria-label={`Mill approved quantity ${row.req_no} ${row.item_code}`} className="nf-input-sm w-28" type="number" min="0" placeholder={String(Number(row.quantity))} value={approved[row.line_id] ?? ""} onChange={(event) => setApproved((current) => ({ ...current, [row.line_id]: event.target.value }))} /></td><td className="p-2"><input aria-label={`Adjustment reason ${row.req_no} ${row.item_code}`} className="nf-input-sm w-52" placeholder="Required if adjusted" value={reasons[row.line_id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [row.line_id]: event.target.value }))} /></td></tr>)}</tbody></table></div>}
      {selectHint && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{selectHint}</p>}
      {!rows.length && <p className="text-sm text-[var(--text-secondary)]">Choose a filter and load approved requisitions that have no consolidation sheet.</p>}
    </div>
  </Dialog>;
}

function CapacityCell({ row, t }: { row: EligibleLine; t: ReturnType<typeof useLanguage>["t"] }) {
  const state = row.mill_capacity_state ?? "NOT_CONFIGURED";
  return <span className="inline-flex items-center gap-2">
    {millCapacityText(state, row.available_mill_output_kg, t)}
    {row.mill_capacity_status && <MillCapacityBadge status={row.mill_capacity_status} t={t} title={t("millCapDemandOf", { demand: formatKg(row.mill_demand_kg), available: formatKg(row.available_mill_output_kg) })} />}
  </span>;
}
