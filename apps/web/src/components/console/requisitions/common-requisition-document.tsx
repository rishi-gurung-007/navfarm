"use client";

/**
 * A common requisition (Item / Fixed Asset / Service) as a document — the same
 * layout as FeedRequisitionDocument (spec §6a): a header form and a lines
 * sub-form, editable while Open and read-only after. Field sources: the
 * "Field sources" table of docs/superpowers/plans/2026-10-04-feed-part-e-requisition.md;
 * est. rate and line description are ours. Store shows the from/to locations,
 * direct-transfer flag and the shipping quantities; Purchase does not.
 */
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, ReadField } from "@/components/ui/field";
import { LotSerialPicker } from "@/components/ui/lot-serial-picker";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import { cn } from "@/lib/utils";
import { formatDateShort } from "@/utils/date-short";
import {
  APPROVAL_STATE_LABEL, COMMON_PURPOSE_LABEL, DOC_TYPE_LABEL, FULFILMENT_STATE_LABEL, INTEGRATION_STATE_LABEL, labelOf, variantOf,
} from "../inventory/requisition-labels";
import { commonStatus, emptyLine, type CommonRequisitionLine, type CommonRequisitionOptions, type CommonRequisitionView } from "./common-requisition-model";

/** WP1c: the header's two-value Status (Rishi's list), separate from Approval. */
const STATUS_LABEL: Record<string, { key: string; variant: "neutral" | "info" }> = {
  OPEN: { key: "crqStatusOpen", variant: "neutral" },
  RELEASED: { key: "crqStatusReleased", variant: "info" },
  CANCELLED: { key: "crqStatusCancelled", variant: "neutral" },
};

const HALF = "sm:col-span-6";
const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };
const TH = "h-9 whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-3 py-1.5 align-top text-xs text-[var(--text-primary)]";
const NUM = "text-right tabular-nums";
const qty = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 }));
const stamp = (v: string | null | undefined) => (v ? `${formatDateShort(v.slice(0, 10))} ${v.slice(11, 16)} UTC` : null);

/** WP4a: what the released line's Item Tracking button saves — the lot, or the serial list. */
export type TrackingAssignment = { lot_no: string } | { serial_no: string };

/**
 * WP4a fix round 1 — Rishi's 4 Oct list: "ITEM TRACKING BUTTON (on Sub-Form
 * Line): Opens Lot/Serial assignment page … MANDATORY before Transfer Shipment
 * post". After release the document is read-only, but a tracked line with a
 * balance still to ship keeps its button: it opens the picker for that balance
 * and saves through the caller (POST /requisition/:id/item-tracking).
 */
function ReleasedTrackingCell({ line, no, tracking, assigned, warehouseId, onSave }: {
  line: CommonRequisitionLine; no: number; tracking: "LOT" | "SERIAL"; assigned: string; warehouseId?: string;
  onSave: (lineId: string, value: TrackingAssignment) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(assigned);
  const [saving, setSaving] = useState(false);
  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono">{assigned || "—"}</span>
        <Button variant="outline" size="sm" aria-label={t("crqItemTrackingFor", { line: no })} onClick={() => { setValue(assigned); setOpen(true); }}>
          {t("crqColTracking")}
        </Button>
      </div>
    );
  }
  const save = async () => {
    setSaving(true);
    const ok = await onSave(line.line_id as string, tracking === "SERIAL" ? { serial_no: value } : { lot_no: value });
    setSaving(false);
    if (ok) setOpen(false);
  };
  return (
    <div className="flex items-center gap-2">
      <LotSerialPicker itemId={line.item_id ?? ""} warehouseId={warehouseId} trackingType={tracking} value={value}
        ariaLabel={t("crqTrackingFor", { line: no })} multiSelect={tracking === "SERIAL"}
        targetQuantity={line.balance_to_ship || undefined} onChange={(val) => setValue(val || "")} />
      <Button size="sm" onClick={save} disabled={saving || !value.trim()}>{t("crqTrackingSave")}</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>{t("crqTrackingCancel")}</Button>
    </div>
  );
}

export function CommonRequisitionDocument({ view, editable, options, onChange, onAssignTracking }: {
  view: CommonRequisitionView; editable: boolean; options?: CommonRequisitionOptions | null; onChange?: (next: CommonRequisitionView) => void;
  /** WP4a: given on a released Store requisition to a user who may ship; saves one line's Item Tracking. */
  onAssignTracking?: (lineId: string, value: TrackingAssignment) => Promise<boolean>;
}) {
  const { t } = useLanguage();
  const can = editable && !!onChange;
  const store = view.purpose === "STORE";
  const set = (patch: Partial<CommonRequisitionView>) => onChange?.({ ...view, ...patch });
  const setLine = (i: number, patch: Partial<CommonRequisitionLine>) =>
    onChange?.({ ...view, lines: view.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const locations = options?.locations ?? [];
  const departments = options?.departments ?? [];
  const items = options?.items ?? [];
  const resources = options?.resources ?? [];
  const locCode = (id: string | null, code?: string | null) => code ?? locations.find((l) => l.location_id === id)?.location_code ?? null;
  const deptName = (id: string | null, name?: string | null) => name ?? departments.find((d) => d.cost_center_id === id)?.cost_center_name ?? null;

  const select = (id: string, label: string, value: string | null, choices: { value: string; label: string }[], onPick: (v: string | null) => void) => (
    <Field className={HALF} label={label} htmlFor={id}>
      <select id={id} className="nf-input-sm nf-select" style={inputStyle} value={value ?? ""} onChange={(e) => onPick(e.target.value || null)}>
        <option value="">{t("crqChoose")}</option>
        {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
    </Field>
  );
  const input = (id: string, label: string, value: string | null, type: string, onEdit: (v: string | null) => void) => (
    <Field className={HALF} label={label} htmlFor={id}>
      <input id={id} type={type} className="nf-input-sm" style={inputStyle} value={value ?? ""} onChange={(e) => onEdit(e.target.value || null)} />
    </Field>
  );
  const locChoices = locations.map((l) => ({ value: l.location_id, label: l.location_code }));
  const deptChoices = departments.map((d) => ({ value: d.cost_center_id, label: `${d.cost_center_code} — ${d.cost_center_name}` }));

  const isItem = view.doc_type === "ITEM";
  // WP1c (Rishi's 4 Oct list, "REQUISITION SUB-FORM LINE") — his columns in
  // his order first, then ours. An Item line carries Item No. + Item
  // Description; an FA/Service line is its own description instead, and never
  // names an item. Balance to Ship is last of his, after Remaining to Receive.
  const rishiColumns = [
    "crqColLine",
    ...(isItem ? ["crqColItem", "crqColItemDescription"] : ["crqColDescription"]),
    "crqColQty",
    ...(store ? ["crqColFrom", "crqColTo", "crqColToShip", "crqColShipped", "crqColToReceive", "crqColReceived", "crqColRemaining", "crqColBalance"] : []),
  ];
  // Ours: the unit, our estimated rate, our free line description on an Item
  // line (an FA/Service line already shows it as Rishi's own column), the
  // Resource picker a Service line needs, and the Item Tracking button.
  const ourColumns = [
    // WP1c addendum (Rishi, 5 Oct): an FA/Service line is Description + Qty
    // only, so it shows neither the unit nor our estimated rate.
    ...(isItem ? ["crqColUom", "crqColRate", "crqColDescription"] : []),
    ...(view.doc_type === "SERVICE" ? ["crqColResource"] : []),
    ...(store && isItem ? ["crqColTracking"] : []),
  ];
  const columns = [...rishiColumns, ...ourColumns].filter(Boolean) as string[];

  /** The Item Master tracking mode of the line's item; NONE when untracked. */
  const trackingOf = (line: CommonRequisitionLine): "LOT" | "SERIAL" | "NONE" => {
    const it = items.find((x) => x.item_id === line.item_id);
    if (it?.is_serial_tracked) return "SERIAL";
    if (it?.is_lot_tracked) return "LOT";
    return "NONE";
  };

  return (
    <div className="flex flex-col gap-4">
      <FieldGroup title={t("crqHeaderTitle")}>
        {/* WP1c — Rishi's 4 Oct list, "REQUISITION HEADER", in his order.
            Our own fields (required date, the remaining state dimensions, the
            audit stamps and justification) follow after his, never between. */}
        <ReadField className={HALF} label={t("crqReqNo")} value={view.req_no ?? null} mono />
        {can ? input("crq-date", t("crqReqDate"), view.requisition_date, "date", (v) => set({ requisition_date: v }))
          : <ReadField className={HALF} label={t("crqReqDate")} value={view.requisition_date ? formatDateShort(view.requisition_date) : null} />}
        {can ? select("crq-main", t("crqMainLocation"), view.main_location_id, locChoices, (v) => set({ main_location_id: v }))
          : <ReadField className={HALF} label={t("crqMainLocation")} value={locCode(view.main_location_id, view.main_location_code)} mono />}
        <ReadField className={HALF} label={t("crqRequesterUserId")} value={view.requester_user_id ?? null} mono />
        <ReadField className={HALF} label={t("crqRequester")} value={view.requester_name ?? null} />
        {/* "auto from User Setup" — the server snapshots it from the signed-in
            user, so it is shown, never chosen. */}
        <ReadField className={HALF} label={t("crqRequesterDept")} value={deptName(view.requester_department_id, view.requester_department_name)} />
        {can ? select("crq-snd-dept", t("crqSenderDept"), view.sender_department_id, deptChoices, (v) => set({ sender_department_id: v }))
          : <ReadField className={HALF} label={t("crqSenderDept")} value={deptName(view.sender_department_id, view.sender_department_name)} />}
        <ReadField className={HALF} label={t("crqType")} value={labelOf(DOC_TYPE_LABEL, view.doc_type, t)} />
        <ReadField className={HALF} label={t("crqStatus")} value={<Badge variant={STATUS_LABEL[commonStatus(view)].variant}>{t(STATUS_LABEL[commonStatus(view)].key as any)}</Badge>} />
        {can && view.doc_type === "ITEM"
          ? select("crq-purpose", t("crqPurpose"), view.purpose, [{ value: "STORE", label: t("reqPurposeStore") }, { value: "PURCHASE", label: t("reqPurposePurchase") }],
              (v) => set({ purpose: (v ?? "PURCHASE") as CommonRequisitionView["purpose"] }))
          : <ReadField className={HALF} label={t("crqPurpose")} value={labelOf(COMMON_PURPOSE_LABEL, view.purpose, t)} />}
        {store && (can ? select("crq-from", t("crqFrom"), view.from_location_id, locChoices, (v) => set({ from_location_id: v }))
          : <ReadField className={HALF} label={t("crqFrom")} value={locCode(view.from_location_id, view.from_location_code)} mono />)}
        {store && (can ? select("crq-to", t("crqTo"), view.to_location_id, locChoices, (v) => set({ to_location_id: v }))
          : <ReadField className={HALF} label={t("crqTo")} value={locCode(view.to_location_id, view.to_location_code)} mono />)}
        {store && view.doc_type === "ITEM" && (can ? (
          <Field
            className={HALF}
            label={t("crqDirectTransfer")}
            htmlFor="crq-direct"
            tooltip={options?.may_direct_transfer ? undefined : t("crqDirectTransferNoRight")}
          >
            {/* WP1c (Rishi's 4 Oct list): "user needs right in User Setup to
                tick" — the checkbox is disabled without the right, which the
                API enforces again on create/update. */}
            <input
              id="crq-direct"
              type="checkbox"
              checked={view.direct_transfer}
              disabled={!options?.may_direct_transfer}
              onChange={(e) => set({ direct_transfer: e.target.checked })}
            />
          </Field>
        ) : <ReadField className={HALF} label={t("crqDirectTransfer")} value={view.direct_transfer ? t("crqYes") : t("crqNo")} />)}
        {can ? (
          <Field className="sm:col-span-12" label={t("crqRemarks")} htmlFor="crq-remarks">
            <textarea id="crq-remarks" rows={2} className="nf-input w-full px-2 py-1" style={inputStyle} value={view.remarks ?? ""} onChange={(e) => set({ remarks: e.target.value || null })} />
          </Field>
        ) : <ReadField className="sm:col-span-12" label={t("crqRemarks")} value={view.remarks} />}
        {can ? input("crq-required", t("crqRequiredDate"), view.required_date, "date", (v) => set({ required_date: v }))
          : <ReadField className={HALF} label={t("crqRequiredDate")} value={view.required_date ? formatDateShort(view.required_date) : null} />}
        <ReadField className={HALF} label={t("crqApproval")} value={view.approval_status ? <Badge variant={variantOf(APPROVAL_STATE_LABEL, view.approval_status)}>{labelOf(APPROVAL_STATE_LABEL, view.approval_status, t)}</Badge> : null} />
        <ReadField className={HALF} label={t("crqFulfilment")} value={view.fulfilment_status ? labelOf(FULFILMENT_STATE_LABEL, view.fulfilment_status, t) : null} />
        <ReadField className={HALF} label={t("crqIntegration")} value={view.integration_status ? labelOf(INTEGRATION_STATE_LABEL, view.integration_status, t) : null} />
        <ReadField className={HALF} label={t("crqApprovedBy")} value={view.approved_by_name ?? null} />
        <ReadField className={HALF} label={t("crqApprovedAt")} value={stamp(view.approved_at)} />
        <ReadField className={HALF} label={t("crqReleasedBy")} value={view.released_by_name ?? null} />
        <ReadField className={HALF} label={t("crqReleasedAt")} value={stamp(view.released_at)} />
        {view.purpose === "PURCHASE" && <ReadField className={HALF} label={t("crqLinkedPo")} value={view.linked_po_no ?? null} mono />}
        {store && <ReadField className={HALF} label={t("crqLinkedTransfer")} value={view.linked_transfer_no ?? null} mono />}
        {can ? (
          <Field className="sm:col-span-12" label={t("crqJustification")} htmlFor="crq-justification">
            <textarea id="crq-justification" rows={2} className="nf-input w-full px-2 py-1" style={inputStyle} value={view.justification ?? ""} onChange={(e) => set({ justification: e.target.value || null })} />
          </Field>
        ) : <ReadField className="sm:col-span-12" label={t("crqJustification")} value={view.justification} />}
      </FieldGroup>

      <FieldGroup title={t("crqLinesTitle")}>
        <div className="sm:col-span-12 flex flex-col gap-2">
          <ScrollTable label={t("crqLinesLabel")}>
            <thead><tr>{columns.map((c) => <th key={c} scope="col" className={TH}>{t(c as any)}</th>)}{can && <th className={TH} />}</tr></thead>
            <tbody>
              {view.lines.map((line, i) => {
                const no = line.line_seq ?? i + 1;
                const cell = (key: string, value: string | null, onEdit: (v: string | null) => void, type = "text", width = "w-24") =>
                  can ? <input aria-label={t(key as any, { line: i + 1 })} type={type} className={cn("nf-input-sm", width, type === "number" && "text-right")} style={inputStyle}
                    value={value ?? ""} onChange={(e) => onEdit(e.target.value || null)} /> : (type === "number" ? qty(value) : value ?? "");
                return (
                  <tr key={line.line_id ?? `new-${i}`}>
                    {/* Rishi's columns, in his order. */}
                    <td className={cn(TD, NUM)}>{no}</td>
                    {isItem ? (<>
                      <td className={TD}>{can ? (
                        <select aria-label={t("crqItemFor", { line: i + 1 })} className="nf-input-sm nf-select w-48" style={inputStyle} value={line.item_id ?? ""}
                          onChange={(e) => { const it = items.find((x) => x.item_id === e.target.value); setLine(i, { item_id: e.target.value || null, uom: it?.uom_primary ?? line.uom }); }}>
                          <option value="">{t("crqChoose")}</option>
                          {items.map((it) => <option key={it.item_id} value={it.item_id}>{it.item_code} — {it.item_name}</option>)}
                        </select>
                      ) : line.item_code ?? ""}</td>
                      {/* Item Description is the Item Master's name, never typed here. */}
                      <td className={TD}>{line.item_name ?? items.find((x) => x.item_id === line.item_id)?.item_name ?? ""}</td>
                    </>) : (
                      <td className={TD}>{cell("crqDescriptionFor", line.description, (v) => setLine(i, { description: v }), "text", "w-48")}</td>
                    )}
                    <td className={cn(TD, NUM)}>{cell("crqQtyFor", line.quantity, (v) => setLine(i, { quantity: v ?? "" }), "number")}</td>
                    {store && <>
                      <td className={TD}>{locCode(line.from_location_id, line.from_location_code) ?? ""}</td>
                      <td className={TD}>{locCode(line.to_location_id, line.to_location_code) ?? ""}</td>
                      <td className={cn(TD, NUM)}>{cell("crqToShipFor", line.qty_to_ship, (v) => setLine(i, { qty_to_ship: v }), "number")}</td>
                      <td className={cn(TD, NUM)}>{qty(line.qty_shipped)}</td>
                      <td className={cn(TD, NUM)}>{cell("crqToReceiveFor", line.qty_to_receive, (v) => setLine(i, { qty_to_receive: v }), "number")}</td>
                      <td className={cn(TD, NUM)}>{qty(line.qty_received)}</td>
                      <td className={cn(TD, NUM)} data-testid={`crq-remaining-${no}`}>{qty(line.remaining_to_receive)}</td>
                      <td className={cn(TD, NUM)} data-testid={`crq-balance-${no}`}>{qty(line.balance_to_ship)}</td>
                    </>}
                    {/* Ours, after his — Item lines only. */}
                    {isItem && (<>
                      <td className={TD}>{cell("crqUomFor", line.uom, (v) => setLine(i, { uom: v ?? "" }), "text", "w-16")}</td>
                      <td className={cn(TD, NUM)}>{cell("crqRateFor", line.est_rate, (v) => setLine(i, { est_rate: v }), "number")}</td>
                      <td className={TD}>{cell("crqDescriptionFor", line.description, (v) => setLine(i, { description: v }), "text", "w-48")}</td>
                    </>)}
                    {view.doc_type === "SERVICE" && (
                      <td className={TD}>{can ? (
                        <select aria-label={t("crqResourceFor", { line: i + 1 })} className="nf-input-sm nf-select w-48" style={inputStyle} value={line.resource_id ?? ""}
                          onChange={(e) => setLine(i, { resource_id: e.target.value || null })}>
                          <option value="">{t("crqChoose")}</option>
                          {resources.map((r) => <option key={r.resource_id} value={r.resource_id}>{r.resource_code} — {r.resource_name}</option>)}
                        </select>
                      ) : line.resource_code ? `${line.resource_code} — ${line.resource_name ?? ""}` : ""}</td>
                    )}
                    {store && isItem && (() => {
                      const tracking = trackingOf(line);
                      const assigned = (tracking === "SERIAL" ? line.serial_no : line.lot_no) ?? "";
                      // An untracked item has nothing to assign; a tracked one
                      // is MANDATORY before shipment, which the API enforces.
                      if (tracking === "NONE") return <td className={TD}>—</td>;
                      if (!can && onAssignTracking && line.line_id && (line.balance_to_ship ?? 0) > 1e-9) {
                        return (
                          <td className={TD}>
                            <ReleasedTrackingCell line={line} no={no} tracking={tracking} assigned={assigned}
                              warehouseId={line.from_location_id ?? view.from_location_id ?? undefined} onSave={onAssignTracking} />
                          </td>
                        );
                      }
                      if (!can) return <td className={cn(TD, "font-mono")}>{assigned || "—"}</td>;
                      return (
                        <td className={TD}>
                          <LotSerialPicker
                            itemId={line.item_id ?? ""}
                            warehouseId={line.from_location_id ?? view.from_location_id ?? undefined}
                            trackingType={tracking}
                            value={assigned}
                            ariaLabel={t("crqTrackingFor", { line: i + 1 })}
                            multiSelect={tracking === "SERIAL"}
                            targetQuantity={Number(line.qty_to_ship ?? line.quantity) || undefined}
                            onChange={(val) => setLine(i, tracking === "SERIAL" ? { serial_no: val || null } : { lot_no: val || null })}
                          />
                        </td>
                      );
                    })()}
                    {can && (
                      <td className={TD}>
                        <Button variant="ghost" size="sm" aria-label={t("crqRemoveLine", { line: i + 1 })} disabled={view.lines.length === 1}
                          onClick={() => onChange?.({ ...view, lines: view.lines.filter((_, j) => j !== i) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </ScrollTable>
          {can && <div><Button variant="outline" size="sm" onClick={() => onChange?.({ ...view, lines: [...view.lines, emptyLine()] })}><Plus className="h-3.5 w-3.5" /> {t("crqAddLine")}</Button></div>}
        </div>
      </FieldGroup>
    </div>
  );
}
