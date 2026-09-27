"use client";

/**
 * Inventory → Feed Requisitions (Feed Forecast Plan B, Task 10). The farm's
 * feed requisitions; "Draft from forecast" runs Engine Step 9 on the server
 * (POST /feed-requisition/auto-draft), and a draft opens with the Requisition
 * sheet §2 columns. The farm edits Requested Qty and the Required By Date,
 * writes remarks, and approves or rejects (§4 steps 3–4). The 20% remark
 * rule and the deadline rule are mirrored here only to say so before the
 * click; the API enforces both (checkpoints 18 and 22) and its 400 message,
 * when one comes back, is shown as-is rather than replaced with our own text.
 *
 * The farm total (row 26) is recomputed here from the current line edits
 * (bulkTotal below) rather than read off the server's farm_total_requested_kg
 * — the server only knows the last-saved quantities, and this is meant to
 * update as the farm types, before a Save round trip.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Inbox } from "lucide-react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate, todayIso, unwrap } from "./feed-format";
import { useFeedFarm } from "./use-feed-farm";

interface ListRow {
  requisition_id: string;
  req_no: string;
  requisition_type: string | null;
  status: string;
  priority: string | null;
  required_date: string | null;
  submission_deadline: string | null;
  line_count: number;
  requested_kg: string | number;
}

interface Line {
  line_id: string;
  line_seq: number;
  destination_code: string | null;
  item_code: string | null;
  item_name: string | null;
  feed_type: string | null;
  is_next_diet: boolean;
  days_before_diet_change: number | null;
  system_balance_kg: string | null;
  daily_requirement_kg: string | null;
  days_remaining: number | null;
  unrounded_need_kg: string | null;
  recommended_qty_kg: string | null;
  quantity: string;
  bag_count: number | null;
  proposed_delivery_date: string | null;
  needs_silo_changeover: boolean;
}

interface View {
  requisition_id: string;
  req_no: string;
  requisition_type: string | null;
  source: string | null;
  purpose: string | null;
  supply_source: string | null;
  status: string;
  priority: string | null;
  production_date: string | null;
  submission_deadline: string | null;
  remarks: string | null;
  truck_target_kg: number;
  lines: Line[];
}

/** One line's pending edits, kept separate from the server's own line fields until Save/Approve. */
interface LineEdit {
  quantity?: string;
  date?: string;
}

const OPEN = ["AUTO_DRAFT", "DRAFT", "PENDING_APPROVAL"];

/** Checkpoint 18, as the API applies it (feed-requisition.rules.ts deviationNeedsRemarks). */
export function needsRemarks(recommended: number | null, requested: number): boolean {
  if (recommended === null) return false;
  if (recommended <= 0) return requested > 0;
  return Math.abs(requested - recommended) / recommended > 0.2 + 1e-9;
}

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const kg = (v: string | number | null | undefined) => {
  const n = num(v);
  return n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  CRITICAL_FIRST_PRIORITY: "danger", CRITICAL: "danger", WARNING: "warning", INFO: "info",
};

export default function FeedRequisitionPanel() {
  const { t } = useLanguage();
  // t()'s identity is not stable across renders in every caller (including the
  // test mock), so a ref keeps callback dependency lists to the request's
  // actual inputs instead of looping on renders — the same fix feed-alerts-panel
  // and feed-forecast-panel use for the same reason.
  const tRef = useRef(t);
  tRef.current = t;

  const { farmId, setFarmId, farms, isFixed, fixedFarm } = useFeedFarm();
  const [rows, setRows] = useState<ListRow[]>([]);
  const [selected, setSelected] = useState<View | null>(null);
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/feed-requisition?farmId=${farmId}`);
      const list = unwrap<ListRow[]>(res);
      setRows(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setError(err?.message || tRef.current("frqLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const show = (view: View | null) => {
    setSelected(view);
    setEdits({});
    setRemarks(view?.remarks ?? "");
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (err: any) {
      setError(err?.message || tRef.current("frqActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const openRequisition = (id: string) => run(async () => show(unwrap<View>(await api.get(`/feed-requisition/${id}`))));

  const draftFromForecast = () =>
    run(async () => {
      const result = unwrap<{ requisition: View | null }>(await api.post("/feed-requisition/auto-draft", { farmId }));
      if (result.requisition) show(result.requisition);
      else setNotice(tRef.current("frqNothingToOrder"));
      await loadList();
    });

  const requestedOf = (line: Line) => (edits[line.line_id]?.quantity !== undefined ? Number(edits[line.line_id].quantity) : Number(line.quantity));
  const dateOf = (line: Line) => edits[line.line_id]?.date ?? line.proposed_delivery_date ?? "";
  const setQuantity = (lineId: string, value: string) => setEdits((cur) => ({ ...cur, [lineId]: { ...cur[lineId], quantity: value } }));
  const setDate = (lineId: string, value: string) => setEdits((cur) => ({ ...cur, [lineId]: { ...cur[lineId], date: value } }));
  const lineEdits = () =>
    Object.entries(edits).map(([line_id, edit]) => ({
      line_id,
      ...(edit.quantity !== undefined ? { quantity_kg: Number(edit.quantity) } : {}),
      ...(edit.date !== undefined ? { proposed_delivery_date: edit.date } : {}),
    }));

  const editable = !!selected && OPEN.includes(selected.status);
  const deviating = selected ? selected.lines.filter((l) => needsRemarks(num(l.recommended_qty_kg), requestedOf(l))) : [];
  const late = !!selected?.submission_deadline && todayIso() > selected.submission_deadline;
  const remarksMissing = (deviating.length > 0 || late) && !remarks.trim();
  // Requisition §1 row 26: requested bulk total vs the truck target (row 27) — trips, not a cap (checkpoint 17).
  const bulkTotal = selected ? selected.lines.filter((l) => l.feed_type === "BULK").reduce((sum, l) => sum + requestedOf(l), 0) : 0;
  const trips = selected && bulkTotal > 0 ? Math.ceil(bulkTotal / selected.truck_target_kg) : 0;

  const save = () =>
    run(async () => {
      show(unwrap<View>(await api.put(`/feed-requisition/${selected!.requisition_id}`, { remarks, lines: lineEdits() })));
      setNotice(tRef.current("frqSaved"));
    });

  const approve = () =>
    run(async () => {
      show(unwrap<View>(await api.post(`/feed-requisition/${selected!.requisition_id}/approve`, { remarks, lines: lineEdits() })));
      setNotice(tRef.current("frqApproved"));
      await loadList();
    });

  const reject = () =>
    run(async () => {
      if (!remarks.trim()) throw new Error(tRef.current("frqRejectNeedsReason"));
      show(unwrap<View>(await api.post(`/feed-requisition/${selected!.requisition_id}/reject`, { rejection_reason: remarks })));
      await loadList();
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {isFixed ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {fixedFarm ? `${fixedFarm.location_code ?? ""} — ${fixedFarm.location_name ?? ""}` : ""}
          </p>
        ) : (
          <Field label={t("frqFarm")} htmlFor="frq-farm">
            <select id="frq-farm" aria-label={t("frqFarm")} className="nf-input-sm px-2" value={farmId ?? ""} onChange={(e) => { setFarmId(e.target.value); show(null); }}>
              {farms.map((f) => (
                <option key={f.farmId} value={f.farmId}>{f.code} — {f.name}</option>
              ))}
            </select>
          </Field>
        )}
        <Button onClick={draftFromForecast} disabled={!farmId || busy}>{t("frqDraftFromForecast")}</Button>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}
      {notice && <InlineAlert variant="success">{notice}</InlineAlert>}

      {loading ? (
        <div className="p-10 text-center text-xs"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> {t("frqLoading")}</div>
      ) : rows.length === 0 && !selected ? (
        <div className="p-10 text-center text-xs"><Inbox className="mx-auto mb-2 h-6 w-6" /> {t("frqNone")}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("frqColReqNo")}</TableHead>
              <TableHead>{t("frqColType")}</TableHead>
              <TableHead>{t("frqColStatus")}</TableHead>
              <TableHead>{t("frqColPriority")}</TableHead>
              <TableHead>{t("frqColRequiredDelivery")}</TableHead>
              <TableHead>{t("frqColDeadline")}</TableHead>
              <TableHead>{t("frqColLines")}</TableHead>
              <TableHead>{t("frqColRequestedKg")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.requisition_id} onClick={() => openRequisition(r.requisition_id)} className="cursor-pointer">
                <TableCell>{r.req_no}</TableCell>
                <TableCell>{r.requisition_type ?? "—"}</TableCell>
                <TableCell>{r.status}</TableCell>
                <TableCell>{r.priority ? <Badge variant={PRIORITY_VARIANT[r.priority] ?? "neutral"}>{r.priority}</Badge> : "—"}</TableCell>
                <TableCell>{formatDate(r.required_date)}</TableCell>
                <TableCell>{formatDate(r.submission_deadline)}</TableCell>
                <TableCell>{r.line_count}</TableCell>
                <TableCell>{kg(r.requested_kg)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selected && (
        <section className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-4" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{selected.req_no}</h3>
            <Badge>{selected.status}</Badge>
            {selected.priority && <Badge variant={PRIORITY_VARIANT[selected.priority] ?? "neutral"}>{selected.priority}</Badge>}
          </div>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {t("frqHeaderLine", {
              type: selected.requisition_type ?? "—", source: selected.source ?? "—", purpose: selected.purpose ?? "—",
              supply: selected.supply_source ?? "—", deadline: formatDate(selected.submission_deadline), production: formatDate(selected.production_date),
            })}
          </p>
          <p className="text-sm">{t("frqFarmTotal", { total: bulkTotal.toLocaleString("en-US"), target: selected.truck_target_kg.toLocaleString("en-US"), trips })}</p>

          <Table>
            <TableHeader>
              <TableRow>
                {["frqColLine", "frqColDestination", "frqColItem", "frqColFeedType", "frqColNextDiet", "frqColDaysBeforeChange",
                  "frqColSystemBalance", "frqColDailyRequirement", "frqColDaysRemaining", "frqColUnroundedNeed", "frqColRecommended",
                  "frqColRequested", "frqColBagCount", "frqColDelivery"].map((key) => (
                  <TableHead key={key}>{t(key as any)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected.lines.map((line) => (
                <TableRow key={line.line_id}>
                  <TableCell>{line.line_seq}</TableCell>
                  <TableCell>
                    {line.destination_code ?? "—"}
                    {line.needs_silo_changeover && <Badge variant="warning" className="ml-1">{t("frqChangeover")}</Badge>}
                  </TableCell>
                  <TableCell>{line.item_code} — {line.item_name}</TableCell>
                  <TableCell>{line.feed_type ?? "—"}</TableCell>
                  <TableCell>{line.is_next_diet ? t("frqYes") : t("frqNo")}</TableCell>
                  <TableCell>{line.days_before_diet_change ?? "—"}</TableCell>
                  <TableCell>{kg(line.system_balance_kg)}</TableCell>
                  <TableCell>{kg(line.daily_requirement_kg)}</TableCell>
                  <TableCell>{line.days_remaining ?? "—"}</TableCell>
                  <TableCell>{kg(line.unrounded_need_kg)}</TableCell>
                  <TableCell>{kg(line.recommended_qty_kg)}</TableCell>
                  <TableCell>
                    {editable ? (
                      <input
                        type="number" min={0} step="any" className="nf-input-sm w-28 px-2"
                        aria-label={t("frqRequestedFor", { line: line.line_seq })}
                        value={edits[line.line_id]?.quantity ?? String(Number(line.quantity))}
                        onChange={(e) => setQuantity(line.line_id, e.target.value)}
                      />
                    ) : (
                      kg(line.quantity)
                    )}
                  </TableCell>
                  <TableCell>{line.bag_count ?? "—"}</TableCell>
                  <TableCell>
                    {editable ? (
                      <input
                        type="date" className="nf-input-sm w-36 px-2"
                        aria-label={t("frqDeliveryFor", { line: line.line_seq })}
                        value={dateOf(line)}
                        onChange={(e) => setDate(line.line_id, e.target.value)}
                      />
                    ) : (
                      formatDate(line.proposed_delivery_date)
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Field label={t("frqRemarks")} htmlFor="frq-remarks">
            <textarea id="frq-remarks" aria-label={t("frqRemarks")} className="nf-input w-full px-2 py-1" rows={2}
              value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!editable} />
          </Field>
          {remarksMissing && <p className="text-xs" style={{ color: "var(--danger)" }}>{t("frqRemarksRequired")}</p>}

          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={save} disabled={busy}>{t("frqSave")}</Button>
              <Button onClick={approve} disabled={busy || remarksMissing}>{t("frqApprove")}</Button>
              <Button variant="destructive" onClick={reject} disabled={busy}>{t("frqReject")}</Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
