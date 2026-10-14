"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { EmptyState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { showToast } from "@/components/ui/toast";
import { unwrap } from "./feed-format";
import { RecordLink, itemHref, locationHref } from "./feed-requisition-header";
import { CONSOLIDATION_STATUS_LABEL, labelOf } from "./requisition-labels";
import { deepLinkIdFor, loadingSheetHref, transferHref } from "./feed-loading-panel";
import { requisitionHref } from "./transfer-source-links";
import { millCapacityText, type MillCapacityState } from "./mill-capacity-view";
import { formatDateShort } from "@/utils/date-short";

type Sheet = { consolidation_id: string; consolidation_no: string; production_week: string; consolidation_date: string; status: string; line_count: number; requested_qty_kg: number; mill_approved_qty_kg: number };
/** The saved sheet (GET /feed-requisition/consolidations/:id), workbook Requisition and Loading Sheet §5. */
type SheetLine = {
  consolidation_line_id: string; requisition_id: string; requisition_no: string | null;
  farm_id: string; farm_code: string | null; farm_name: string | null;
  destination_silo_id: string | null; destination_silo_code: string | null; destination_silo_name: string | null;
  item_id: string; item_code: string | null; item_name: string | null; diet_no: number | null;
  mill_loading_bin_id: string | null; mill_loading_bin_code: string | null; mill_loading_bin_name: string | null;
  requested_qty_kg: string | number; mill_approved_qty_kg: string | number; adjustment_reason: string | null;
  available_mill_output_kg: string | number | null; mill_capacity_state: MillCapacityState; total_all_farms_kg: number;
  transfer_id: string | null; transfer_no: string | null; loading_sheet_id: string | null; loading_sheet_no: string | null;
};
type SheetDetail = Sheet & { feed_mill_manager_name: string | null; lines: SheetLine[] };
const kgText = (value: string | number | null | undefined, na: string) => value == null ? na : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** A consolidation sheet opens in the Feed Forecast → Mill Consolidation tab. */
export const consolidationHref = (id: string) => `/inventory/feed-forecast?tab=mill-consolidation&id=${encodeURIComponent(id)}`;

const TH = "sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)";
const TD = "border-b border-(--border) px-3 py-2 align-top text-sm";
const NUM = "whitespace-nowrap text-right tabular-nums";

const STATUS_DOT: Record<string, string> = { DRAFT: "bg-(--warning)", REVIEWED: "bg-(--warning)", CONSOLIDATED: "bg-(--success)" };
function StatusDot({ status }: { status: string }) {
  const { t } = useLanguage();
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-(--text-secondary)">
      <span aria-hidden className={`h-2 w-2 rounded-full ${STATUS_DOT[status] ?? "bg-(--text-muted)"}`} />
      {labelOf(CONSOLIDATION_STATUS_LABEL, status, t)}
    </span>
  );
}

/** Feed Mill Consolidation content shared by the query-param tab and legacy route. */
export function FeedConsolidationsPanel() {
  const { t } = useLanguage();
  const na = t("fcsNotAvailable");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [selected, setSelected] = useState<SheetDetail | null>(null);
  const [status, setStatus] = useState("");
  const load = () => api.get(`/feed-requisition/consolidations${status ? `?status=${encodeURIComponent(status)}` : ""}`).then((response) => setSheets(unwrap<Sheet[]>(response))).catch((err: any) => showToast.error(err?.message || t("fcsLoadFailed")));
  useEffect(() => { load(); }, [status]);
  const open = async (id: string) => { try { setSelected(unwrap<SheetDetail>(await api.get(`/feed-requisition/consolidations/${id}`))); } catch (err: any) { showToast.error(err?.message || t("fcsSheetLoadFailed")); } };
  // Opened by link: ?tab=mill-consolidation&id=<consolidation> (or /inventory/feed-consolidations?id=).
  useEffect(() => { const id = deepLinkIdFor("mill-consolidation"); if (id) void open(id); }, []);
  const markReviewed = async () => { if (!selected) return; try { setSelected(unwrap<SheetDetail>(await api.post(`/feed-requisition/consolidations/${selected.consolidation_id}/review`, {}))); showToast.success(t("fcsMarkedReviewed")); load(); } catch (err: any) { showToast.error(err?.message || t("fcsMarkReviewedFailed")); } };
  const finalize = async () => { if (!selected) return; try { setSelected(unwrap<SheetDetail>(await api.post(`/feed-requisition/consolidations/${selected.consolidation_id}/finalize`, {}))); showToast.success(t("fcsFinalized")); load(); } catch (err: any) { showToast.error(err?.message || t("fcsFinalizeFailed")); } };
  const closeButton = <Button variant="outline" onClick={() => setSelected(null)}>{t("fcsClose")}</Button>;
  return (
    <div data-fill-body className="min-h-0 overflow-y-auto">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 [&_.nf-input-sm]:h-9">
        <Field label={t("fcsStatusFilter")} htmlFor="consolidation-status">
          <SearchableSelect
            id="consolidation-status"
            ariaLabel={t("fcsStatusFilter")}
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: t("fcsAllStatuses") },
              { value: "DRAFT", label: t("fcsStatusDraft") },
              { value: "CONSOLIDATED", label: t("fcsStatusConsolidated") },
            ]}
            columnHeaders={false}
            triggerClassName="nf-input-sm min-w-[10rem] h-9"
          />
        </Field>
      </div>
      {sheets.length === 0 ? (
        <EmptyState icon={Layers} title={t("fcsEmpty")} />
      ) : (
        <div className="mt-4 max-h-[60vh] shrink-0 overflow-x-auto overflow-y-auto rounded-md border border-(--border) bg-(--surface)">
          <table aria-label={t("fcsListLabel")} className="w-max min-w-full border-separate border-spacing-0 text-left">
            <thead><tr>
              {([["fcsColNo", ""], ["fcsColWeek", ""], ["fcsColDate", ""], ["fcsColStatus", ""], ["fcsColLines", "text-right"], ["fcsColRequested", "text-right"], ["fcsColApproved", "text-right"], ["fcsColAction", ""]] as const).map(([key, cls]) => <th key={key} className={`${TH} ${cls}`}>{t(key)}</th>)}
            </tr></thead>
            <tbody>
              {sheets.map((sheet) => (
                <tr key={sheet.consolidation_id} className="hover:bg-(--surface-raised)">
                  <td className={`${TD} whitespace-nowrap font-medium`}><RecordLink code={sheet.consolidation_no} href={consolidationHref(sheet.consolidation_id)} /></td>
                  <td className={`${TD} whitespace-nowrap`}>{sheet.production_week}</td>
                  <td className={`${TD} whitespace-nowrap`}>{formatDateShort(sheet.consolidation_date)}</td>
                  <td className={TD}><StatusDot status={sheet.status} /></td>
                  <td className={`${TD} ${NUM}`}>{sheet.line_count}</td>
                  <td className={`${TD} ${NUM}`}>{kgText(sheet.requested_qty_kg, na)} KG</td>
                  <td className={`${TD} ${NUM}`}>{kgText(sheet.mill_approved_qty_kg, na)} KG</td>
                  <td className={TD}><Button size="sm" variant="outline" onClick={() => open(sheet.consolidation_id)}>{t("fcsView")}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!selected} onClose={() => setSelected(null)} title={selected?.consolidation_no || t("fcsSheetTitle")} maxWidth="xl" presentation="compact" className="w-[95vw] max-h-[85vh]" footer={selected && ["DRAFT", "REVIEWED"].includes(selected.status) ? <>{closeButton}{selected.status === "DRAFT" && <Button variant="outline" onClick={markReviewed}>{t("fcsMarkReviewed")}</Button>}<Button onClick={finalize}>{t("fcsFinalize")}</Button></> : closeButton}>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 rounded-md border border-(--border) p-3 text-sm sm:grid-cols-4">
              <div><span className="text-xs text-(--text-secondary)">{t("fcsColStatus")}</span><div className="mt-0.5"><StatusDot status={selected.status} /></div></div>
              <div><span className="text-xs text-(--text-secondary)">{t("fcsColWeek")}</span><div className="font-medium">{selected.production_week}</div></div>
              <div><span className="text-xs text-(--text-secondary)">{t("fcsColDate")}</span><div className="font-medium">{formatDateShort(selected.consolidation_date)}</div></div>
              <div><span className="text-xs text-(--text-secondary)">{t("fcsMillManager")}</span><div className="font-medium">{selected.feed_mill_manager_name || na}</div></div>
            </div>
            <div className="max-h-[50vh] shrink-0 overflow-x-auto overflow-y-auto rounded-md border border-(--border) bg-(--surface)">
              <table aria-label={t("fcsLinesLabel")} className="w-max min-w-full border-separate border-spacing-0 text-left">
                <thead><tr>
                  {([["fcsColRequisition", ""], ["fcsColFarm", ""], ["fcsColDestination", ""], ["fcsColItem", "min-w-48"], ["fcsColBin", "min-w-40"], ["fcsColRequested", "text-right"], ["fcsColDietTotal", "text-right"], ["fcsColCapacity", "text-right"], ["fcsColApproved", "text-right"], ["fcsColReason", "min-w-40"], ["fcsColTransfer", ""], ["fcsColLoadingSheet", ""]] as const).map(([key, cls]) => <th key={key} className={`${TH} ${cls}`}>{t(key)}</th>)}
                </tr></thead>
                <tbody>
                  {selected.lines?.map((line) => (
                    <tr key={line.consolidation_line_id}>
                      <td className={`${TD} whitespace-nowrap`}>{line.requisition_no ? <RecordLink code={line.requisition_no} href={requisitionHref("FEED", line.requisition_id)} /> : na}</td>
                      <td className={TD}><div>{line.farm_code ? <RecordLink code={line.farm_code} href={locationHref(line.farm_id)} /> : na}</div><div className="text-xs text-(--text-secondary)">{line.farm_name || ""}</div></td>
                      <td className={TD}><div>{line.destination_silo_code ? <RecordLink code={line.destination_silo_code} href={line.destination_silo_id ? locationHref(line.destination_silo_id) : null} /> : na}</div><div className="text-xs text-(--text-secondary)">{line.destination_silo_name || ""}</div></td>
                      <td className={`${TD} min-w-48 whitespace-normal break-words`}>
                        <div>{line.item_code ? <RecordLink code={line.item_code} href={itemHref(line.item_id)} /> : na}{line.diet_no == null ? null : <span className="ml-1 text-xs text-(--text-secondary)">{t("fcdDiet", { no: line.diet_no })}</span>}</div>
                        <div className="text-xs text-(--text-secondary)">{line.item_name || t("fcsNoDescription")}</div>
                      </td>
                      <td className={`${TD} whitespace-normal break-words`}>{line.mill_loading_bin_code ? <><RecordLink code={line.mill_loading_bin_code} href={line.mill_loading_bin_id ? locationHref(line.mill_loading_bin_id) : null} /><div className="text-xs text-(--text-secondary)">{line.mill_loading_bin_name || ""}</div></> : t("flsNotConfigured")}</td>
                      <td className={`${TD} ${NUM}`}>{kgText(line.requested_qty_kg, na)} KG</td>
                      <td className={`${TD} ${NUM}`}>{kgText(line.total_all_farms_kg, na)} KG</td>
                      <td className={`${TD} ${NUM}`}>{millCapacityText(line.mill_capacity_state, line.available_mill_output_kg, t)}</td>
                      <td className={`${TD} ${NUM}`}>{kgText(line.mill_approved_qty_kg, na)} KG</td>
                      <td className={`${TD} min-w-40 whitespace-normal break-words`}>{line.adjustment_reason || t("fcsNoAdjustment")}</td>
                      <td className={`${TD} whitespace-nowrap`}>{line.transfer_no ? <RecordLink code={line.transfer_no} href={line.transfer_id ? transferHref(line.transfer_id) : null} /> : t("fcsNotReleased")}</td>
                      <td className={`${TD} whitespace-nowrap`}>{line.loading_sheet_no ? <RecordLink code={line.loading_sheet_no} href={line.loading_sheet_id ? loadingSheetHref(line.loading_sheet_id) : null} /> : t("fcsNotCreated")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
