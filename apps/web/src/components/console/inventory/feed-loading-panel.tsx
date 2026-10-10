"use client";

import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { showToast } from "@/components/ui/toast";
import { unwrap } from "./feed-format";

type LoadingSheet = { loading_sheet_id: string; loading_sheet_no: string; requisition_id: string; requested_qty_kg: string | number; mill_approved_qty_kg: string | number; scheduled_qty_kg: string | number; compartment_no: string | null; kg_loaded: string | number | null; status: string; shipment_no?: string | null; requisition_no?: string; farm_code?: string; farm_name?: string | null; destination_silo_code?: string | null; destination_silo_name?: string | null; item_code?: string; item_name?: string | null; mill_loading_bin_code?: string | null; mill_loading_bin_name?: string | null; adjustment_reason?: string | null };
const quantity = (value: string | number | null, na: string) => value == null ? na : `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })} KG`;
const statusLabel = (status: string) => status.replaceAll("_", " ");

const TH = "sticky top-0 z-10 border-b border-(--border) bg-(--surface-raised) px-3 py-2 text-xs font-semibold text-(--text-secondary)";
const TD = "border-b border-(--border) px-3 py-2 align-top text-sm";
const NUM = "whitespace-nowrap text-right tabular-nums";
const DOT: Record<string, string> = { DISPATCHED: "bg-(--success)", RECEIVED: "bg-(--success)", LOADED: "bg-(--warning)" };

/** Feed Loading Instructions content shared by the query-param tab and legacy route. */
export function FeedLoadingPanel() {
  const { t } = useLanguage();
  const na = t("fcsNotAvailable");
  const [rows, setRows] = useState<LoadingSheet[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { compartmentNo: string; kgLoaded: string }>>({});
  const load = () => api.get("/feed-requisition/loading-sheets").then((response) => setRows(unwrap<LoadingSheet[]>(response))).catch((err: any) => showToast.error(err?.message || t("flsLoadFailed")));
  useEffect(() => { load(); }, []);
  const save = async (row: LoadingSheet) => { const values = draft[row.loading_sheet_id] || { compartmentNo: row.compartment_no || "", kgLoaded: row.kg_loaded == null ? "" : String(row.kg_loaded) }; setSaving(row.loading_sheet_id); try { await api.put(`/feed-requisition/loading-sheets/${row.loading_sheet_id}`, { compartmentNo: values.compartmentNo, kgLoaded: values.kgLoaded === "" ? undefined : Number(values.kgLoaded) }); showToast.success(t("flsSaved")); await load(); } catch (err: any) { showToast.error(err?.message || t("flsSaveFailed")); } finally { setSaving(null); } };
  const dispatch = async (row: LoadingSheet) => { setSaving(row.loading_sheet_id); try { await api.post(`/feed-requisition/loading-sheets/${row.loading_sheet_id}/dispatch`, {}); showToast.success(t("flsDispatched")); await load(); } catch (err: any) { showToast.error(err?.message || t("flsDispatchFailed")); } finally { setSaving(null); } };
  return (
    <div data-fill-body className="min-h-0 overflow-y-auto">
      <div className="shrink-0">
        <h2 className="text-base font-semibold text-(--text-primary)">{t("flsTitle")}</h2>
        <p className="mt-0.5 text-sm text-(--text-secondary)">{t("flsIntro")}</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Truck} title={t("flsEmpty")} />
      ) : (
        <div className="mt-4 max-h-[65vh] shrink-0 overflow-x-auto overflow-y-auto rounded-md border border-(--border) bg-(--surface)">
          <table aria-label={t("flsListLabel")} className="w-max min-w-full border-separate border-spacing-0 text-left">
            <thead><tr>
              {([["flsColSheet", "min-w-40"], ["flsColRequisition", ""], ["flsColFarm", "min-w-44"], ["flsColItem", "min-w-52"], ["flsColRequested", "text-right"], ["flsColApproved", "text-right"], ["flsColReason", "min-w-44"], ["flsColCompartment", "min-w-40"], ["flsColLoaded", "min-w-36"], ["flsColStatus", ""], ["flsColActions", "min-w-44"]] as const).map(([key, cls]) => <th key={key} className={`${TH} ${cls}`}>{t(key)}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((row) => {
                const values = draft[row.loading_sheet_id] || { compartmentNo: row.compartment_no || "", kgLoaded: row.kg_loaded == null ? "" : String(row.kg_loaded) };
                const locked = row.status === "DISPATCHED" || row.status === "RECEIVED";
                return (
                  <tr key={row.loading_sheet_id}>
                    <td className={`${TD} whitespace-nowrap font-medium`}>{row.loading_sheet_no}<div className="max-w-56 whitespace-normal text-xs font-normal text-(--text-secondary)">{row.shipment_no || t("flsShipmentPending")}</div></td>
                    <td className={`${TD} whitespace-nowrap`}>{row.requisition_no || na}</td>
                    <td className={TD}>
                      <div className="font-medium">{row.farm_code || na}</div>
                      <div className="text-xs text-(--text-secondary)">{row.farm_name || ""}</div>
                      <div className="mt-1 text-xs">{row.destination_silo_code || t("flsNoDestination")}<span className="text-(--text-secondary)">{row.destination_silo_name ? ` · ${row.destination_silo_name}` : ""}</span></div>
                    </td>
                    <td className={`${TD} whitespace-normal break-words`}>
                      <div className="font-medium">{row.item_code || na}</div>
                      <div className="text-xs text-(--text-secondary)">{row.item_name || t("fcsNoDescription")}</div>
                      <div className="mt-1 text-xs">{t("flsBin")}: {row.mill_loading_bin_code || t("flsNotConfigured")}<span className="text-(--text-secondary)">{row.mill_loading_bin_name ? ` · ${row.mill_loading_bin_name}` : ""}</span></div>
                    </td>
                    <td className={`${TD} ${NUM}`}>{quantity(row.requested_qty_kg, na)}</td>
                    <td className={`${TD} ${NUM}`}>{quantity(row.mill_approved_qty_kg, na)}</td>
                    <td className={`${TD} whitespace-normal break-words`}>{row.adjustment_reason || t("fcsNoAdjustment")}</td>
                    <td className={TD}><input aria-label={t("flsCompartmentFor", { no: row.loading_sheet_no })} className="nf-input-sm h-9 w-36" value={values.compartmentNo} disabled={locked} onChange={(event) => setDraft({ ...draft, [row.loading_sheet_id]: { ...values, compartmentNo: event.target.value } })} /></td>
                    <td className={TD}><input aria-label={t("flsLoadedFor", { no: row.loading_sheet_no })} className="nf-input-sm h-9 w-32 text-right tabular-nums" type="number" min="0" max={Number(row.scheduled_qty_kg)} value={values.kgLoaded} disabled={locked} onChange={(event) => setDraft({ ...draft, [row.loading_sheet_id]: { ...values, kgLoaded: event.target.value } })} /></td>
                    <td className={TD}>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-(--text-secondary)">
                        <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[row.status] ?? "bg-(--text-muted)"}`} />
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap gap-2">
                        {!locked && <Button size="sm" onClick={() => save(row)} disabled={saving === row.loading_sheet_id}>{t("flsSave")}</Button>}
                        {row.status === "LOADED" && <Button size="sm" onClick={() => dispatch(row)} disabled={saving === row.loading_sheet_id}>{t("flsDispatch")}</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
