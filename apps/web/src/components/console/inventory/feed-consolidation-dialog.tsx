"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { Layers } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import { showToast } from "@/components/ui/toast";
import { unwrap } from "./feed-format";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { millCapacityText, formatKg, type MillCapacityState, type MillCapacityStatus } from "./mill-capacity-view";
import { PRIORITY_LABEL, labelOf } from "./requisition-labels";
import { formatDateShort } from "./feed-format";

type EligibleLine = {
  requisition_id: string; req_no: string; farm_id: string; farm_code: string; farm_name: string | null;
  line_id: string; item_id: string; item_code: string; item_name: string; quantity: string | number;
  destination_silo_id: string | null;
  destination_silo_code?: string | null; destination_silo_name?: string | null;
  proposed_delivery_date: string | null; production_date: string | null; feed_type: string | null;
  diet_no: number | null; loading_bin: string | null; loading_bin_name?: string | null; loading_bin_capacity_kg?: string | number | null; available_mill_output_kg: string | number | null;
  /** Engine r42–r43 for the line's diet on its production date (Requisition and Loading Sheet r125). */
  mill_capacity_state?: MillCapacityState; mill_capacity_status?: MillCapacityStatus | null; mill_demand_kg?: number | null;
  /** What the mill ranks by (GET …/consolidations/eligible): stored from the calculation, or live for a manual requisition. */
  priority?: string | null; figures_source?: "STORED" | "LIVE" | "NONE";
  silo_capacity_kg?: number | null; system_balance_kg?: number | null; daily_requirement_kg?: number | null;
  days_remaining?: number | null; first_shortage_date?: string | null; recommended_qty_kg?: number | null;
  is_next_diet?: boolean; needs_silo_changeover?: boolean; exceeds_silo_capacity?: boolean;
  batches?: Array<{ batch_id: string; batch_no: string | null; shed_code: string | null; heads: number | null }>;
};

const TH = "sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)";
const TD = "border-b border-(--border) px-3 py-2 align-top text-sm";
const NUM = "whitespace-nowrap text-right tabular-nums";
// The first four columns stay put while the figures scroll, as in the Calculation grid (global.css data-sticky-col).
const PIN = (left: string) => ({ "--sticky-left": left }) as CSSProperties;

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
      const params = new URLSearchParams({ withPriority: "true" });
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
  // One row per line, in the API's order (most urgent first); the requisition search narrows it.
  const lines = useMemo(() => {
    const shown = new Set(requisitions.map((r) => r.requisition_id));
    return rows.filter((row) => shown.has(row.requisition_id));
  }, [rows, requisitions]);
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
  // Code and name are two columns (Rishi, 14 Oct).
  const siloCode = (row: EligibleLine) => row.destination_silo_code || NA;
  const siloName = (row: EligibleLine) => row.destination_silo_name || NA;
  const itemCode = (row: EligibleLine) => row.item_code || NA;
  const itemName = (row: EligibleLine) => `${row.item_name ?? ""}${row.diet_no == null ? "" : ` · ${t("fcdDiet", { no: row.diet_no })}`}`;
  const binCode = (row: EligibleLine) => row.loading_bin || NA;
  const binName = (row: EligibleLine) => row.loading_bin ? `${row.loading_bin_name ?? ""}${row.loading_bin_capacity_kg == null ? "" : ` · ${formatKg(row.loading_bin_capacity_kg)} KG`}` : t("fcdNotConfigured");
  const th = (label: string, cls = "") => <th key={label} scope="col" className={`${TH} ${cls}`}>{label}</th>;

  return <Dialog open={open} onClose={onClose} title={t("fcdTitle")} description={t("fcdIntro")} maxWidth="xl" presentation="compact" className="w-[95vw] max-h-[85vh]" footer={<><Button variant="outline" onClick={onClose}>{t("fcdCancel")}</Button><Button onClick={create} disabled={busy || !selectedRows.length}>{t("fcdCreate")}</Button></>}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 [&_.nf-input-sm]:h-9 [&>button]:h-9">
        <Field label={t("fcdSelectBy")} htmlFor="consolidation-filter">
          <div className="relative min-w-[10rem]">
            <SearchableSelect
              value={mode}
              onChange={(val) => setMode(val as typeof mode)}
              options={[
                { value: "requisition", label: t("fcdByRequisition") },
                { value: "date", label: t("fcdByDate") },
              ]}
              columnHeaders={false}
              triggerClassName="nf-input-sm min-w-[10rem] h-9"
            />
            <select
              id="consolidation-filter"
              className="absolute inset-0 h-full w-full opacity-0 pointer-events-none"
              tabIndex={-1}
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="requisition">{t("fcdByRequisition")}</option>
              <option value="date">{t("fcdByDate")}</option>
            </select>
          </div>
        </Field>
        {mode === "requisition" && <Field label={t("fcdByRequisition")} htmlFor="consolidation-search"><input id="consolidation-search" className="nf-input-sm" placeholder={t("fcdSearchPlaceholder")} value={reqSearch} onChange={(event) => setReqSearch(event.target.value)} /></Field>}
        {mode === "date" && <><Field label={t("fcdFromDate")} htmlFor="consolidation-from"><input id="consolidation-from" type="date" className="nf-input-sm" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></Field><Field label={t("fcdToDate")} htmlFor="consolidation-to"><input id="consolidation-to" type="date" className="nf-input-sm" value={toDate} onChange={(event) => setToDate(event.target.value)} /></Field></>}
        <Button variant="outline" onClick={load} disabled={busy}>{busy ? t("fcdLoading") : t("fcdFind")}</Button>
      </div>
      {dateHint && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{dateHint}</p>}
      {rows.length > 0 && <p className="text-xs text-(--text-secondary)">{t("fcdUrgencyHint")}</p>}
      {rows.length > 0 && <div data-table-scroll className="max-h-[55vh] shrink-0 overflow-x-auto overflow-y-auto rounded-md border border-(--border) bg-(--surface)"><table aria-label={t("fcdTableLabel")} className="w-max min-w-full border-separate border-spacing-0 text-left">
        <thead><tr>
          <th scope="col" data-sticky-col="true" style={PIN("0rem")} className={`${TH} w-[3rem] min-w-[3rem]`}>{t("fcdColSelect")}</th>
          <th scope="col" data-sticky-col="true" style={PIN("3rem")} className={`${TH} w-[3rem] min-w-[3rem] text-right`}>{t("fcdColRank")}</th>
          <th scope="col" data-sticky-col="true" style={PIN("6rem")} className={`${TH} w-[12rem] min-w-[12rem]`}>{t("fcdColReqNo")}</th>
          <th scope="col" data-sticky-col="last" style={PIN("18rem")} className={`${TH} w-[10rem] min-w-[10rem]`}>{t("fcdColFarm")}</th>
          {th(t("fcdColPriority"))}{th(t("fcdColFirstShortage"))}{th(t("fcdColDaysRemaining"), "text-right")}
          {th(t("fcdColSiloCode"), "min-w-28")}{th(t("fcdColSiloName"), "min-w-40")}{th(t("fcdColSiloCapacity"), "text-right")}
          {th(t("fcdColSystemBalance"), "text-right")}{th(t("fcdColDailyUse"), "text-right")}
          {th(t("fcdColItemNo"), "min-w-32")}{th(t("fcdColItemName"), "min-w-56")}{th(t("fcdColBatches"), "min-w-52")}
          {th(t("fcdColDelivery"))}{th(t("fcdColRequested"), "text-right")}{th(t("fcdColRecommended"), "text-right")}{th(t("fcdColNotes"), "min-w-40")}
          {th(t("fcdColBin"), "min-w-28")}{th(t("fcdColBinName"), "min-w-44")}{th(t("feedPlanColCapacity"), "min-w-36")}
          {th(t("fcdColApproved"), "text-right")}{th(t("fcdColReason"), "min-w-52")}{th(t("fcdColFigures"))}
        </tr></thead>
        <tbody>{lines.map((row, index) => {
          const isSelected = selected.includes(row.requisition_id);
          const notes = [row.is_next_diet && t("fcdNextDiet"), row.needs_silo_changeover && t("fcdChangeover"), row.exceeds_silo_capacity && t("fcdOverCapacity")].filter(Boolean).join(" · ");
          return <tr key={row.line_id} className={isSelected ? "bg-(--surface-raised)" : undefined}>
            <td data-sticky-col="true" style={PIN("0rem")} className={`${TD} w-[3rem]`}><input type="checkbox" aria-label={`${row.req_no} · ${row.item_code}`} checked={isSelected} onChange={() => toggle(row.requisition_id)} /></td>
            <td data-sticky-col="true" style={PIN("3rem")} className={`${TD} ${NUM} w-[3rem]`}>{index + 1}</td>
            <td data-sticky-col="true" style={PIN("6rem")} className={`${TD} w-[12rem] min-w-[12rem] whitespace-nowrap font-medium`}>{row.req_no}</td>
            <td data-sticky-col="last" style={PIN("18rem")} className={`${TD} w-[10rem] max-w-[10rem] truncate`} title={`${row.farm_code} — ${row.farm_name ?? ""}`}>{row.farm_code}<div className="truncate text-xs text-(--text-secondary)">{row.farm_name}</div></td>
            <td className={`${TD} whitespace-nowrap`}>{row.priority ? labelOf(PRIORITY_LABEL, row.priority, t) : NA}</td>
            <td className={`${TD} whitespace-nowrap`}>{row.first_shortage_date ? formatDateShort(row.first_shortage_date) : row.figures_source === "NONE" ? NA : t("fcdNoShortage")}</td>
            <td className={`${TD} ${NUM}`}>{row.days_remaining == null ? NA : Number(row.days_remaining).toFixed(1)}</td>
            <td className={`${TD} whitespace-nowrap`}>{siloCode(row)}</td>
            <td className={`${TD} whitespace-normal break-words`}>{siloName(row)}</td>
            <td className={`${TD} ${NUM}`}>{row.silo_capacity_kg == null ? NA : `${formatKg(row.silo_capacity_kg)} KG`}</td>
            <td className={`${TD} ${NUM}`}>{row.system_balance_kg == null ? NA : `${formatKg(row.system_balance_kg)} KG`}</td>
            <td className={`${TD} ${NUM}`}>{row.daily_requirement_kg == null ? NA : `${formatKg(row.daily_requirement_kg)} KG`}</td>
            <td className={`${TD} whitespace-nowrap`}>{itemCode(row)}</td>
            <td className={`${TD} whitespace-normal break-words`}>{itemName(row)}</td>
            <td className={`${TD} whitespace-normal break-words text-xs`}>{row.batches?.length ? row.batches.map((b) => `${b.batch_no ?? NA}${b.shed_code ? ` · ${b.shed_code}` : ""}${b.heads == null ? "" : ` · ${b.heads} ${t("fcdHeads")}`}`).join(", ") : NA}</td>
            <td className={`${TD} whitespace-nowrap`}>{row.proposed_delivery_date ? formatDateShort(row.proposed_delivery_date) : NA}</td>
            <td className={`${TD} ${NUM}`}>{formatKg(row.quantity)} KG</td>
            <td className={`${TD} ${NUM}`}>{row.recommended_qty_kg == null ? NA : `${formatKg(row.recommended_qty_kg)} KG`}</td>
            <td className={`${TD} whitespace-normal break-words text-xs`} style={notes ? { color: "var(--warning)" } : undefined}>{notes || NA}</td>
            <td className={`${TD} whitespace-nowrap`}>{binCode(row)}</td>
            <td className={`${TD} whitespace-normal break-words`}>{binName(row)}</td>
            <td className={TD}><CapacityCell row={row} t={t} /></td>
            <td className={TD}>{isSelected ? <input aria-label={t("fcdApprovedLabel", { req: row.req_no, item: row.item_code })} className="nf-input-sm h-9 w-28 text-right tabular-nums" type="number" min="0" placeholder={String(Number(row.quantity))} value={approved[row.line_id] ?? ""} onChange={(event) => setApproved((current) => ({ ...current, [row.line_id]: event.target.value }))} /> : <span className="text-xs text-(--text-secondary)">{t("fcdSelectToApprove")}</span>}</td>
            <td className={TD}>{isSelected ? <input aria-label={t("fcdReasonLabel", { req: row.req_no, item: row.item_code })} className="nf-input-sm h-9 w-52" placeholder={t("fcdReasonPlaceholder")} value={reasons[row.line_id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [row.line_id]: event.target.value }))} /> : <span className="text-xs text-(--text-secondary)">{t("fcdSelectToEdit")}</span>}</td>
            <td className={`${TD} whitespace-nowrap text-xs text-(--text-secondary)`}>{t(row.figures_source === "STORED" ? "fcdFiguresStored" : row.figures_source === "LIVE" ? "fcdFiguresLive" : "fcdFiguresNone")}</td>
          </tr>;
        })}</tbody></table></div>}
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
