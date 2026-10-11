"use client";

import { useEffect, useRef, useState } from "react";
import { Truck } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useLanguage } from "@/hooks/useLanguage";
import { showToast } from "@/components/ui/toast";
import { unwrap } from "./feed-format";
import { RecordLink, itemHref, locationHref } from "./feed-requisition-header";
import { LOADING_STATUS_LABEL, labelOf } from "./requisition-labels";
import { formatDateShort, formatStampShort } from "@/utils/date-short";
import { requisitionHref } from "./transfer-source-links";

type LoadingSheet = {
  loading_sheet_id: string; loading_sheet_no: string; requisition_id: string; requisition_no: string | null;
  requested_qty_kg: string | number; mill_approved_qty_kg: string | number; scheduled_qty_kg: string | number;
  compartment_no: string | null; kg_loaded: string | number | null; status: string; shipment_no?: string | null;
  farm_id: string; farm_code: string | null; farm_name: string | null;
  destination_silo_id: string | null; destination_silo_code: string | null; destination_silo_name: string | null;
  item_id: string; item_code: string | null; item_name: string | null; diet_no: number | null;
  mill_loading_bin_id: string | null; mill_loading_bin_code: string | null; mill_loading_bin_name: string | null;
  adjustment_reason: string | null; requested_delivery_date: string | null;
  loaded_by_name: string | null; loaded_at: string | null; transfer_id: string | null; transfer_no: string | null;
  dispatch_notification_status?: "SENT" | "NOT_SENT"; dispatch_notification_message?: string | null; dispatch_notification_at?: string | null;
};
type Draft = { compartmentNo: string; kgLoaded: string; loadedBy: string };
const quantity = (value: string | number | null, na: string) => value == null ? na : `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })} KG`;

/** W5 (10 Oct): routes for the records a loading sheet names. */
export const transferHref = (id: string) => `/inventory/transfers?id=${encodeURIComponent(id)}`;
/** A loading sheet opens in the Feed Forecast → Loading Instructions tab. */
export const loadingSheetHref = (id: string) => `/inventory/feed-forecast?tab=loading-instructions&id=${encodeURIComponent(id)}`;

/** The `?id=` this tab should open: only when the URL names this tab, or no tab (the legacy route). */
export function deepLinkIdFor(tab: string): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const named = params.get("tab");
    return !named || named === tab ? params.get("id") : null;
  } catch {
    return null;
  }
}

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
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [openId] = useState(() => deepLinkIdFor("loading-instructions"));
  const openRow = useRef<HTMLTableRowElement | null>(null);
  const valuesOf = (row: LoadingSheet): Draft => draft[row.loading_sheet_id] || { compartmentNo: row.compartment_no || "", kgLoaded: row.kg_loaded == null ? "" : String(row.kg_loaded), loadedBy: row.loaded_by_name || "" };
  const load = () => api.get("/feed-requisition/loading-sheets").then((response) => setRows(unwrap<LoadingSheet[]>(response))).catch((err: any) => showToast.error(err?.message || t("flsLoadFailed")));
  useEffect(() => { load(); }, []);
  // Opened by link: ?tab=loading-instructions&id=<loading sheet> (or /inventory/feed-loading?id=).
  useEffect(() => { if (openId && rows.some((row) => row.loading_sheet_id === openId)) openRow.current?.scrollIntoView?.({ block: "center" }); }, [openId, rows]);
  const save = async (row: LoadingSheet) => { const values = valuesOf(row); setSaving(row.loading_sheet_id); try { await api.put(`/feed-requisition/loading-sheets/${row.loading_sheet_id}`, { compartmentNo: values.compartmentNo, kgLoaded: values.kgLoaded === "" ? undefined : Number(values.kgLoaded), loadedBy: values.loadedBy.trim() || undefined }); showToast.success(t("flsSaved")); await load(); } catch (err: any) { showToast.error(err?.message || t("flsSaveFailed")); } finally { setSaving(null); } };
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
              {([["flsColSheet", "min-w-40"], ["flsColRequisition", ""], ["flsColFarm", "min-w-44"], ["flsColDeliveryDate", ""], ["flsColItem", "min-w-52"], ["flsColRequested", "text-right"], ["flsColApproved", "text-right"], ["flsColReason", "min-w-44"], ["flsColCompartment", "min-w-40"], ["flsColLoaded", "min-w-36"], ["flsColLoadedBy", "min-w-44"], ["flsColLoadedAt", ""], ["flsColStatus", ""], ["flsColNotification", "min-w-56"], ["flsColActions", "min-w-44"]] as const).map(([key, cls]) => <th key={key} className={`${TH} ${cls}`}>{t(key)}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((row) => {
                const values = valuesOf(row);
                const locked = row.status === "DISPATCHED" || row.status === "RECEIVED";
                const opened = row.loading_sheet_id === openId;
                const edit = (patch: Partial<Draft>) => setDraft({ ...draft, [row.loading_sheet_id]: { ...values, ...patch } });
                return (
                  <tr key={row.loading_sheet_id} ref={opened ? openRow : undefined} aria-selected={opened} className={opened ? "bg-(--surface-raised)" : undefined}>
                    <td className={`${TD} whitespace-nowrap font-medium`}>
                      <RecordLink code={row.loading_sheet_no} href={loadingSheetHref(row.loading_sheet_id)} />
                      <div className="max-w-56 whitespace-normal text-xs font-normal text-(--text-secondary)">
                        {row.transfer_no ? <RecordLink code={row.transfer_no} href={row.transfer_id ? transferHref(row.transfer_id) : null} /> : null}
                        {row.transfer_no ? " · " : ""}{row.shipment_no || t("flsShipmentPending")}
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{row.requisition_no ? <RecordLink code={row.requisition_no} href={requisitionHref("FEED", row.requisition_id)} /> : na}</td>
                    <td className={TD}>
                      <div className="font-medium">{row.farm_code ? <RecordLink code={row.farm_code} href={locationHref(row.farm_id)} /> : na}</div>
                      <div className="text-xs text-(--text-secondary)">{row.farm_name || ""}</div>
                      <div className="mt-1 text-xs">{row.destination_silo_code ? <RecordLink code={row.destination_silo_code} href={row.destination_silo_id ? locationHref(row.destination_silo_id) : null} /> : t("flsNoDestination")}<span className="text-(--text-secondary)">{row.destination_silo_name ? ` · ${row.destination_silo_name}` : ""}</span></div>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{row.requested_delivery_date ? formatDateShort(row.requested_delivery_date) : na}</td>
                    <td className={`${TD} whitespace-normal break-words`}>
                      <div className="font-medium">{row.item_code ? <RecordLink code={row.item_code} href={itemHref(row.item_id)} /> : na}{row.diet_no == null ? null : <span className="ml-1 text-xs font-normal text-(--text-secondary)">{t("fcdDiet", { no: row.diet_no })}</span>}</div>
                      <div className="text-xs text-(--text-secondary)">{row.item_name || t("fcsNoDescription")}</div>
                      <div className="mt-1 text-xs">{t("flsBin")}: {row.mill_loading_bin_code ? <RecordLink code={row.mill_loading_bin_code} href={row.mill_loading_bin_id ? locationHref(row.mill_loading_bin_id) : null} /> : t("flsNotConfigured")}<span className="text-(--text-secondary)">{row.mill_loading_bin_name ? ` · ${row.mill_loading_bin_name}` : ""}</span></div>
                    </td>
                    <td className={`${TD} ${NUM}`}>{quantity(row.requested_qty_kg, na)}</td>
                    <td className={`${TD} ${NUM}`}>{quantity(row.mill_approved_qty_kg, na)}</td>
                    <td className={`${TD} whitespace-normal break-words`}>{row.adjustment_reason || t("fcsNoAdjustment")}</td>
                    <td className={TD}><input aria-label={t("flsCompartmentFor", { no: row.loading_sheet_no })} className="nf-input-sm h-9 w-36" value={values.compartmentNo} disabled={locked} onChange={(event) => edit({ compartmentNo: event.target.value })} /></td>
                    <td className={TD}><input aria-label={t("flsLoadedFor", { no: row.loading_sheet_no })} className="nf-input-sm h-9 w-32 text-right tabular-nums" type="number" min="0" max={Number(row.scheduled_qty_kg)} value={values.kgLoaded} disabled={locked} onChange={(event) => edit({ kgLoaded: event.target.value })} /></td>
                    <td className={TD}><input aria-label={t("flsLoadedByFor", { no: row.loading_sheet_no })} className="nf-input-sm h-9 w-40" maxLength={36} value={values.loadedBy} disabled={locked} onChange={(event) => edit({ loadedBy: event.target.value })} /></td>
                    <td className={`${TD} whitespace-nowrap`}>{row.loaded_at ? formatStampShort(row.loaded_at, true) : t("flsNotLoaded")}</td>
                    <td className={TD}>
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-(--text-secondary)">
                        <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[row.status] ?? "bg-(--text-muted)"}`} />
                        {labelOf(LOADING_STATUS_LABEL, row.status, t)}
                      </span>
                    </td>
                    <td className={`${TD} whitespace-normal break-words`}>
                      <div className="text-xs font-medium">{row.dispatch_notification_status === "SENT" ? t("flsNotificationSent") : t("flsNotificationNotSent")}{row.dispatch_notification_at ? <span className="ml-1 font-normal text-(--text-secondary)">{formatStampShort(row.dispatch_notification_at, true)}</span> : null}</div>
                      {row.dispatch_notification_message ? <div className="max-w-64 text-xs text-(--text-secondary)">{row.dispatch_notification_message}</div> : null}
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
