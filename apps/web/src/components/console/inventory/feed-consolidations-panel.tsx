"use client";

import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { showToast } from "@/components/ui/toast";
import { unwrap } from "./feed-format";

type Sheet = { consolidation_id: string; consolidation_no: string; production_week: string; consolidation_date: string; status: string; line_count: number; requested_qty_kg: number; mill_approved_qty_kg: number };
const kgText = (value: string | number | null | undefined, na: string) => value == null ? na : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
const label = (value: string | null | undefined, na: string) => value ? value.replaceAll("_", " ") : na;

const TH = "sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)";
const TD = "border-b border-(--border) px-3 py-2 align-top text-sm";
const NUM = "whitespace-nowrap text-right tabular-nums";

const STATUS_DOT: Record<string, string> = { DRAFT: "bg-(--warning)", REVIEWED: "bg-(--warning)", CONSOLIDATED: "bg-(--success)" };
function StatusDot({ status, na }: { status: string; na: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-(--text-secondary)">
      <span aria-hidden className={`h-2 w-2 rounded-full ${STATUS_DOT[status] ?? "bg-(--text-muted)"}`} />
      {label(status, na)}
    </span>
  );
}

/** Feed Mill Consolidation content shared by the query-param tab and legacy route. */
export function FeedConsolidationsPanel() {
  const { t } = useLanguage();
  const na = t("fcsNotAvailable");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [loadingSheets, setLoadingSheets] = useState<any[]>([]);
  const load = () => api.get(`/feed-requisition/consolidations${status ? `?status=${encodeURIComponent(status)}` : ""}`).then((response) => setSheets(unwrap<Sheet[]>(response))).catch((err: any) => showToast.error(err?.message || t("fcsLoadFailed")));
  useEffect(() => { load(); }, [status]);
  const open = async (id: string) => { try { const detail = unwrap<any>(await api.get(`/feed-requisition/consolidations/${id}`)); setSelected(detail); setLoadingSheets(unwrap<any[]>(await api.get(`/feed-requisition/loading-sheets?consolidationId=${id}`))); } catch (err: any) { showToast.error(err?.message || t("fcsSheetLoadFailed")); } };
  const finalize = async () => { if (!selected) return; try { setSelected(unwrap<any>(await api.post(`/feed-requisition/consolidations/${selected.consolidation_id}/finalize`, {}))); showToast.success(t("fcsFinalized")); load(); } catch (err: any) { showToast.error(err?.message || t("fcsFinalizeFailed")); } };
  const closeButton = <Button variant="outline" onClick={() => setSelected(null)}>{t("fcsClose")}</Button>;
  return (
    <div data-fill-body className="min-h-0 overflow-y-auto">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 [&_.nf-input-sm]:h-9">
        <div>
          <h2 className="text-base font-semibold text-(--text-primary)">{t("fcsTitle")}</h2>
          <p className="mt-0.5 text-sm text-(--text-secondary)">{t("fcsIntro")}</p>
        </div>
        <Field label={t("fcsStatusFilter")} htmlFor="consolidation-status">
          <select id="consolidation-status" aria-label={t("fcsStatusFilter")} className="nf-input-sm nf-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t("fcsAllStatuses")}</option>
            <option value="DRAFT">{t("fcsStatusDraft")}</option>
            <option value="CONSOLIDATED">{t("fcsStatusConsolidated")}</option>
          </select>
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
                  <td className={`${TD} whitespace-nowrap font-medium`}>{sheet.consolidation_no}</td>
                  <td className={`${TD} whitespace-nowrap`}>{sheet.production_week}</td>
                  <td className={`${TD} whitespace-nowrap`}>{sheet.consolidation_date}</td>
                  <td className={TD}><StatusDot status={sheet.status} na={na} /></td>
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
      <Dialog open={!!selected} onClose={() => setSelected(null)} title={selected?.consolidation_no || t("fcsSheetTitle")} maxWidth="xl" presentation="compact" className="w-[95vw] max-h-[85vh]" footer={selected && ["DRAFT", "REVIEWED"].includes(selected.status) ? <>{closeButton}<Button onClick={finalize}>{t("fcsFinalize")}</Button></> : closeButton}>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 rounded-md border border-(--border) p-3 text-sm sm:grid-cols-3">
              <div><span className="text-xs text-(--text-secondary)">{t("fcsColStatus")}</span><div className="mt-0.5"><StatusDot status={selected.status} na={na} /></div></div>
              <div><span className="text-xs text-(--text-secondary)">{t("fcsColWeek")}</span><div className="font-medium">{selected.production_week}</div></div>
              <div><span className="text-xs text-(--text-secondary)">{t("fcsColDate")}</span><div className="font-medium">{selected.consolidation_date}</div></div>
            </div>
            <div className="max-h-[50vh] shrink-0 overflow-x-auto overflow-y-auto rounded-md border border-(--border) bg-(--surface)">
              <table aria-label={t("fcsLinesLabel")} className="w-max min-w-full border-separate border-spacing-0 text-left">
                <thead><tr>
                  {([["fcsColRequisition", ""], ["fcsColFarm", ""], ["fcsColDestination", ""], ["fcsColItem", "min-w-48"], ["fcsColRequested", "text-right"], ["fcsColApproved", "text-right"], ["fcsColReason", "min-w-40"], ["fcsColLoadingSheet", ""]] as const).map(([key, cls]) => <th key={key} className={`${TH} ${cls}`}>{t(key)}</th>)}
                </tr></thead>
                <tbody>
                  {selected.lines?.map((line: any) => {
                    const loading = loadingSheets.find((sheet) => sheet.consolidation_line_id === line.consolidation_line_id);
                    return (
                      <tr key={line.consolidation_line_id}>
                        <td className={`${TD} whitespace-nowrap`}>{line.requisition_no || na}</td>
                        <td className={TD}><div>{line.farm_code || na}</div><div className="text-xs text-(--text-secondary)">{line.farm_name || ""}</div></td>
                        <td className={TD}><div>{line.destination_silo_code || na}</div><div className="text-xs text-(--text-secondary)">{line.destination_silo_name || ""}</div></td>
                        <td className={`${TD} min-w-48 whitespace-normal break-words`}><div>{line.item_code || na}</div><div className="text-xs text-(--text-secondary)">{line.item_name || t("fcsNoDescription")}</div></td>
                        <td className={`${TD} ${NUM}`}>{kgText(line.requested_qty_kg, na)} KG</td>
                        <td className={`${TD} ${NUM}`}>{kgText(line.mill_approved_qty_kg, na)} KG</td>
                        <td className={`${TD} min-w-40 whitespace-normal break-words`}>{line.adjustment_reason || t("fcsNoAdjustment")}</td>
                        <td className={`${TD} whitespace-nowrap`}>{loading?.loading_sheet_no || t("fcsNotCreated")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
