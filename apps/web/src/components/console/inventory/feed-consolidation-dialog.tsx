"use client";

import { useMemo, useState } from "react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { Layers } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import { showToast } from "@/components/ui/toast";
import { unwrap } from "./feed-format";
import { millCapacityText, formatKg, type MillCapacityState, type MillCapacityStatus } from "./mill-capacity-view";

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

const TH = "sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)";
const TD = "border-b border-(--border) px-3 py-2 align-top text-sm";
const NUM = "whitespace-nowrap text-right tabular-nums";

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

  const NA = t("fcdNotAvailable");
  const siloText = (row: EligibleLine) => row.destination_silo_code ? `${row.destination_silo_code}${row.destination_silo_name ? ` — ${row.destination_silo_name}` : ""}` : NA;
  const itemText = (row: EligibleLine) => `${row.item_code} — ${row.item_name}${row.diet_no == null ? "" : ` · ${t("fcdDiet", { no: row.diet_no })}`}`;
  const binText = (row: EligibleLine) => row.loading_bin ? `${row.loading_bin}${row.loading_bin_name ? ` — ${row.loading_bin_name}` : ""}${row.loading_bin_capacity_kg == null ? "" : ` · ${formatKg(row.loading_bin_capacity_kg)} KG`}` : t("fcdNotConfigured");
  const th = (label: string, cls = "") => <th key={label} scope="col" className={`${TH} ${cls}`}>{label}</th>;

  return <Dialog open={open} onClose={onClose} title={t("fcdTitle")} description={t("fcdIntro")} maxWidth="xl" presentation="compact" className="w-[95vw] max-h-[85vh]" footer={<><Button variant="outline" onClick={onClose}>{t("fcdCancel")}</Button><Button onClick={create} disabled={busy || !selectedRows.length}>{t("fcdCreate")}</Button></>}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 [&_.nf-input-sm]:h-9 [&>button]:h-9">
        <Field label={t("fcdSelectBy")} htmlFor="consolidation-filter"><select id="consolidation-filter" className="nf-input-sm nf-select" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="requisition">{t("fcdByRequisition")}</option><option value="date">{t("fcdByDate")}</option></select></Field>
        {mode === "requisition" && <Field label={t("fcdByRequisition")} htmlFor="consolidation-search"><input id="consolidation-search" className="nf-input-sm" placeholder={t("fcdSearchPlaceholder")} value={reqSearch} onChange={(event) => setReqSearch(event.target.value)} /></Field>}
        {mode === "date" && <><Field label={t("fcdFromDate")} htmlFor="consolidation-from"><input id="consolidation-from" type="date" className="nf-input-sm" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></Field><Field label={t("fcdToDate")} htmlFor="consolidation-to"><input id="consolidation-to" type="date" className="nf-input-sm" value={toDate} onChange={(event) => setToDate(event.target.value)} /></Field></>}
        <Button variant="outline" onClick={load} disabled={busy}>{busy ? t("fcdLoading") : t("fcdFind")}</Button>
      </div>
      {dateHint && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{dateHint}</p>}
      {rows.length > 0 && <div className="max-h-[50vh] shrink-0 overflow-x-auto overflow-y-auto rounded-md border border-(--border) bg-(--surface)"><table aria-label={t("fcdTableLabel")} className="w-max min-w-full border-separate border-spacing-0 text-left"><thead><tr>{th(t("fcdColSelect"))}{th(t("fcdColReqNo"))}{th(t("fcdColFarm"))}{th(t("fcdColSilo"), "min-w-40")}{th(t("fcdColItem"), "min-w-56")}{th(t("fcdColBin"), "min-w-44")}{th(t("feedPlanColCapacity"), "min-w-36")}{th(t("fcdColRequested"), "text-right")}{th(t("fcdColApproved"), "text-right")}{th(t("fcdColReason"), "min-w-52")}</tr></thead><tbody>{requisitions.map((req) => <tr key={req.requisition_id}><td className={TD}><input type="checkbox" aria-label={req.req_no} checked={selected.includes(req.requisition_id)} onChange={() => toggle(req.requisition_id)} /></td><td className={`${TD} whitespace-nowrap font-medium`}>{req.req_no}</td><td className={TD}>{req.farm_code} — {req.farm_name}</td><td className={`${TD} whitespace-normal break-words`}>{siloText(req)}</td><td className={`${TD} whitespace-normal break-words`}>{itemText(req)}</td><td className={`${TD} whitespace-normal break-words`}>{binText(req)}</td><td className={TD}><CapacityCell row={req} t={t} /></td><td className={`${TD} ${NUM}`}>{formatKg(rows.filter((row) => row.requisition_id === req.requisition_id).reduce((sum, row) => sum + Number(row.quantity), 0))}</td><td className={TD}>—</td><td className={`${TD} text-(--text-secondary)`}>{t("fcdSelectToEdit")}</td></tr>)}{selectedRows.map((row) => <tr key={`line-${row.line_id}`} className="bg-(--surface-raised)"><td className={TD} /><td className={`${TD} text-(--text-secondary)`}>{t("fcdLine")}</td><td className={TD}>{row.farm_code}</td><td className={`${TD} whitespace-normal break-words`}>{siloText(row)}</td><td className={`${TD} whitespace-normal break-words`}>{itemText(row)}</td><td className={`${TD} whitespace-normal break-words`}>{binText(row)}</td><td className={TD}><CapacityCell row={row} t={t} /></td><td className={`${TD} ${NUM}`}>{formatKg(row.quantity)}</td><td className={TD}><input aria-label={t("fcdApprovedLabel", { req: row.req_no, item: row.item_code })} className="nf-input-sm h-9 w-28 text-right tabular-nums" type="number" min="0" placeholder={String(Number(row.quantity))} value={approved[row.line_id] ?? ""} onChange={(event) => setApproved((current) => ({ ...current, [row.line_id]: event.target.value }))} /></td><td className={TD}><input aria-label={t("fcdReasonLabel", { req: row.req_no, item: row.item_code })} className="nf-input-sm h-9 w-52" placeholder={t("fcdReasonPlaceholder")} value={reasons[row.line_id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [row.line_id]: event.target.value }))} /></td></tr>)}</tbody></table></div>}
      {selectHint && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{selectHint}</p>}
      {!rows.length && <EmptyState icon={Layers} title={t("fcdPrompt")} className="py-10" />}
    </div>
  </Dialog>;
}

const CAP_DOT: Record<MillCapacityStatus, string> = { GREEN: "bg-(--success)", AMBER: "bg-(--warning)", RED: "bg-(--danger)" };
const CAP_LABEL = { GREEN: "millCapGreen", AMBER: "millCapAmber", RED: "millCapRed" } as const;

function CapacityCell({ row, t }: { row: EligibleLine; t: ReturnType<typeof useLanguage>["t"] }) {
  const state = row.mill_capacity_state ?? "NOT_CONFIGURED";
  const status = row.mill_capacity_status;
  return <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
    {millCapacityText(state, row.available_mill_output_kg, t)}
    {status && (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-(--text-secondary)" title={t("millCapDemandOf", { demand: formatKg(row.mill_demand_kg), available: formatKg(row.available_mill_output_kg) })}>
        <span aria-hidden className={`h-2 w-2 rounded-full ${CAP_DOT[status]}`} />
        {t(CAP_LABEL[status])}
      </span>
    )}
  </span>;
}
