"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Inbox, Loader2, Search } from "lucide-react";
import { api } from "@/services/api-client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
import { ReasonSelect } from "@/components/ui/reason-select";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { showToast } from "@/components/ui/toast";
import { getActiveCompanyId, getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { formatQuantity } from "@/lib/utils";

type Row = Record<string, any>;

const PAGE_SIZE = 25;
const unwrap = <T = any,>(res: any): T => (Array.isArray(res) ? res : res?.data ?? res) as T;
const day = (v: unknown) => String(v ?? "").slice(0, 10);
const todayStr = () => new Date().toISOString().slice(0, 10);
const S = {
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  line: { borderColor: "var(--border)" },
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};
const SOURCE_LABEL: Record<string, string> = {
  GOODS_RECEIPT: "Goods receipt",
  SEMEN_COLLECTION: "Semen collection",
  TRANSFER_RECEIPT: "Transfer receipt",
  TRANSFER_EVENT: "Transfer receipt",
};
const STATUS_LABEL: Record<string, string> = { OPEN: "Open", PENDING_APPROVAL: "Pending approval", CLOSED: "Closed" };
const TRANSFER_SOURCES = ["TRANSFER_RECEIPT", "TRANSFER_EVENT"];
const DISPOSITION_LABEL: Record<string, string> = {
  RETURN_TO_SUPPLIER: "Return to supplier",
  SCRAP: "Scrap",
  HOLD: "Hold for a decision",
  RETURN_TO_SOURCE: "Returned to the sending location",
};
/** What may become of a rejected quantity: the same rule the API applies (qc-inspection.rules.ts, dispositionsFor). */
const dispositionsFor = (source: string): string[] =>
  TRANSFER_SOURCES.includes(source) ? ["RETURN_TO_SOURCE"] : source === "GOODS_RECEIPT" ? ["RETURN_TO_SUPPLIER", "SCRAP", "HOLD"] : ["SCRAP", "HOLD"];
const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "PENDING_APPROVAL", label: "Pending approval" },
  { value: "CLOSED", label: "Closed" },
];

/** What a reading means against its check: the same rule the API applies (qc-inspection.rules.ts), shown while the inspector types. */
function judge(line: Row, entry: { value: string; verdict: string }): "PASS" | "FAIL" | null {
  if (line.sampling_type === "VALUE") {
    if (entry.value === "" || Number.isNaN(Number(entry.value))) return null;
    const v = Number(entry.value);
    const below = line.min_value != null && v < Number(line.min_value);
    const above = line.max_value != null && v > Number(line.max_value);
    return below || above ? "FAIL" : "PASS";
  }
  return entry.verdict === "PASS" || entry.verdict === "FAIL" ? entry.verdict : null;
}

const specOf = (l: Row) =>
  l.sampling_type === "VALUE"
    ? [l.min_value != null ? `Min ${Number(l.min_value)}` : "", l.max_value != null ? `Max ${Number(l.max_value)}` : "", l.target_value != null ? `Target ${Number(l.target_value)}` : ""].filter(Boolean).join("  ·  ") +
      (l.uom ? ` ${l.uom}` : "")
    : l.acceptance_text || "";

/** A small uppercase caption over a block, so the form reads as sections rather than one long list. */
function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>{children}</h3>
      {aside && <span className="text-xs" style={S.sub}>{aside}</span>}
    </div>
  );
}

function ResultBadge({ result }: { result: "PASS" | "FAIL" | null | undefined }) {
  const { tLabel } = useLanguage();
  if (!result) return <span style={S.muted}>–</span>;
  return <StatusBadge status={result === "PASS" ? "COMPLETED" : "REJECTED"} label={tLabel(result === "PASS" ? "Pass" : "Fail")} />;
}

function InspectionDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { tLabel } = useLanguage();
  const user = getStoredUser();
  const canEdit = hasPermission(user, "INVENTORY", "QC_INSPECTION", "can_edit");
  const canApprove = hasPermission(user, "INVENTORY", "QC_INSPECTION", "can_approve");
  const [insp, setInsp] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<Record<string, { value: string; verdict: string; text: string }>>({});
  const [sample, setSample] = useState("");
  const [accepted, setAccepted] = useState<string | null>(null);
  const [reasonId, setReasonId] = useState("");
  const [deviation, setDeviation] = useState(false);
  const [postingDate, setPostingDate] = useState(todayStr());
  const [remarks, setRemarks] = useState("");
  // What becomes of the rejected quantity: chosen on completion, on refusing a deviation, or later for one held for a decision.
  const [disposition, setDisposition] = useState("");
  const [rejectionRef, setRejectionRef] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = unwrap<Row>(await api.get(`/qc-inspection/${id}`));
      setInsp(data);
      setDisposition(data.rejection_disposition && data.rejection_disposition !== "HOLD" ? data.rejection_disposition : "");
      setRejectionRef(data.rejection_ref || "");
      setEntries(Object.fromEntries((data.lines || []).map((l: Row) => [l.line_id, {
        value: l.actual_value != null ? String(Number(l.actual_value)) : "", verdict: l.sampling_type === "DESCRIPTIVE" ? l.result || "" : "", text: l.actual_text || "",
      }])));
    } catch (e: any) { setError(e?.message || String(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const open = insp?.status === "OPEN";
  const quantity = Number(insp?.quantity ?? 0);
  const lines: Row[] = insp?.lines || [];
  const verdicts = lines.map((l) => judge(l, entries[l.line_id] ?? { value: "", verdict: "" }));
  const failed = lines.some((l, i) => l.is_mandatory && verdicts[i] === "FAIL");
  const missing = lines.some((l, i) => l.is_mandatory && verdicts[i] === null);
  // A failed lot accepts nothing unless it goes through as a deviation; otherwise the whole lot is accepted unless the inspector says less.
  const acceptedQty = failed && !deviation ? 0 : accepted !== null ? Number(accepted) : quantity;
  const rejectedQty = Math.round((quantity - acceptedQty) * 1e4) / 1e4;
  const needsReason = failed || rejectedQty > 0;
  const editable = open && canEdit;
  const source = String(insp?.source_doc_type ?? "");
  const fromTransferReceipt = TRANSFER_SOURCES.includes(source);
  const choices = dispositionsFor(source);
  // A transfer records its return to the sender itself; any other rejection needs a disposition.
  const needsDisposition = rejectedQty > 0 && !fromTransferReceipt;
  // Refusing a deviation rejects the whole lot: it needs a disposition when the inspector did not record one.
  const refuseNeedsDisposition = insp?.status === "PENDING_APPROVAL" && !fromTransferReceipt && !insp?.rejection_disposition;
  // A closed rejection that is held, or that was closed before dispositions were recorded, can be settled for good.
  const settlable = insp?.status === "CLOSED" && canEdit && !fromTransferReceipt && Number(insp?.rejected_qty ?? 0) > 0
    && (!insp?.rejection_disposition || insp.rejection_disposition === "HOLD");
  const finalChoices = choices.filter((d) => d !== "HOLD");

  const complete = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/qc-inspection/${id}/complete`, {
        lines: lines.map((l) => {
          const e = entries[l.line_id] ?? { value: "", verdict: "", text: "" };
          return {
            line_id: l.line_id,
            ...(l.sampling_type === "VALUE" ? { actual_value: e.value === "" ? null : Number(e.value) } : { result: e.verdict || null }),
            actual_text: e.text || null,
          };
        }),
        sample_qty: sample === "" ? undefined : Number(sample),
        accepted_qty: acceptedQty,
        rejected_qty: rejectedQty,
        reason_id: reasonId || undefined,
        deviation: failed && deviation,
        posting_date: postingDate,
        remarks: remarks.trim() || undefined,
        ...(needsDisposition ? { rejection_disposition: disposition, rejection_ref: rejectionRef.trim() || undefined } : {}),
      });
      showToast.success(tLabel("QC inspection completed."));
      onChanged();
      await load();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/qc-inspection/${id}/${approve ? "approve-deviation" : "reject-deviation"}`, {
        posting_date: postingDate,
        ...(!approve && !fromTransferReceipt && disposition ? { rejection_disposition: disposition, rejection_ref: rejectionRef.trim() || undefined } : {}),
      });
      showToast.success(tLabel(approve ? "Deviation approved." : "Deviation refused."));
      onChanged();
      await load();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  const settle = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/qc-inspection/${id}/settle-rejection`, { rejection_disposition: disposition, rejection_ref: rejectionRef.trim() || undefined });
      showToast.success(tLabel("Rejected quantity settled."));
      onChanged();
      await load();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  /** The disposition picker and its reference, for whichever step is choosing it. */
  const dispositionFields = (options: string[], required: boolean) => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {labelled(required ? "Rejected Qty goes to *" : "Rejected Qty goes to",
        <select className={control} value={disposition} onChange={(e) => setDisposition(e.target.value)} aria-label={tLabel("Rejected Qty goes to")}>
          <option value="">{tLabel("Select...")}</option>
          {options.map((d) => <option key={d} value={d}>{tLabel(DISPOSITION_LABEL[d] || d)}</option>)}
        </select>,
        tLabel("Recorded only: nothing is posted for the rejected quantity."))}
      {labelled("Return / scrap document No.", <input className={control} value={rejectionRef} maxLength={100} onChange={(e) => setRejectionRef(e.target.value)} />,
        tLabel("Optional: the return note, debit note or write-off that carries it out."))}
    </div>
  );

  const control = "nf-input-sm h-9 w-full";
  const read = (label: string, value: React.ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider" style={S.muted}>{tLabel(label)}</span>
      <span className="min-h-[1.25rem] truncate text-sm" style={S.primary}>{value || <span style={S.muted}>–</span>}</span>
    </div>
  );
  const labelled = (label: string, node: React.ReactNode, hint?: string) => (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold" style={S.sub}>
      <span>{tLabel(label)}</span>
      {node}
      {hint && <span className="text-[11px] font-normal" style={S.muted}>{hint}</span>}
    </label>
  );

  const resultKind = insp?.result === "PASS" ? "COMPLETED" : insp?.result === "DEVIATION" ? "PENDING" : "REJECTED";
  const fromTransfer = insp?.parent_doc_no && insp.parent_doc_no !== insp.source_doc_no;

  return (
    <Dialog open onClose={onClose} title={insp ? `${tLabel("QC Inspection")} · ${insp.inspection_no}` : tLabel("QC Inspection")} maxWidth="xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-xs" style={S.muted}>
            {editable && missing ? tLabel("Enter a result for every mandatory check to complete.") : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>{tLabel("Close")}</Button>
            {insp?.status === "PENDING_APPROVAL" && canApprove && (
              <>
                <Button size="sm" variant="outline" disabled={busy || (refuseNeedsDisposition && !disposition)} onClick={() => decide(false)}>{tLabel("Refuse deviation")}</Button>
                <Button size="sm" disabled={busy} onClick={() => decide(true)}>{tLabel("Approve deviation")}</Button>
              </>
            )}
            {settlable && (
              <Button size="sm" disabled={busy || !disposition} onClick={settle}>{busy ? tLabel("Saving...") : tLabel("Record disposition")}</Button>
            )}
            {editable && (
              <Button size="sm" disabled={busy || missing || (needsReason && !reasonId) || (needsDisposition && !disposition)} onClick={complete}>
                {busy ? tLabel("Saving...") : tLabel("Complete inspection")}
              </Button>
            )}
          </div>
        </div>
      }>
      {!insp ? (
        <div className="flex justify-center p-8">{error ? <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p> : <Loader2 className="h-5 w-5 animate-spin" style={S.muted} />}</div>
      ) : (
        <div className="flex flex-col gap-6">
          <section>
            <SectionTitle>{tLabel("Document")}</SectionTitle>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-[var(--radius-md)] border p-4 md:grid-cols-4" style={S.surface}>
              {read("Document No.", <span className="font-semibold">{insp.inspection_no}</span>)}
              {read("Date", day(insp.inspection_date))}
              {read("Status", <StatusBadge status={insp.status} label={tLabel(STATUS_LABEL[insp.status] || insp.status)} />)}
              {read("Result", insp.result ? <StatusBadge status={resultKind} label={tLabel(insp.result === "DEVIATION" ? "Deviation" : insp.result === "PASS" ? "Pass" : "Fail")} /> : null)}

              {read("Source", tLabel(SOURCE_LABEL[insp.source_doc_type] || insp.source_doc_type))}
              {read("Source Document No.", insp.source_doc_no)}
              {read(fromTransfer ? "Transfer Order" : "PO No.", fromTransfer ? insp.parent_doc_no : insp.po_no)}
              {read("Supplier", insp.supplier_name)}

              {read("Item No.", insp.item_code)}
              {read("Item Description", insp.item_name)}
              {read("Lot No.", insp.lot_no)}
              {read("Location", insp.warehouse_name)}

              {read("Quantity", <span className="font-semibold">{formatQuantity(quantity)} {insp.uom}</span>)}
              {read("Inventory entry", insp.ledger_entry_id ? tLabel("Posted") : tLabel("Not posted yet"))}
              {insp.approved_by ? read("Approved on", day(insp.approved_at)) : null}
            </div>
          </section>

          <section>
            <SectionTitle aside={`${lines.length} ${tLabel(lines.length === 1 ? "check" : "checks")}`}>{tLabel("Checks")}</SectionTitle>
            <div className="overflow-x-auto rounded-[var(--radius-md)] border" style={S.surface}>
              <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                <TableHeader>
                  <tr>
                    <TableHead className="w-[22%]">{tLabel("QC Code")}</TableHead>
                    <TableHead className="w-[11%]">{tLabel("QC Type")}</TableHead>
                    <TableHead className="w-[24%]">{tLabel("Specification")}</TableHead>
                    <TableHead className="w-[31%]">{tLabel("Reading / finding")}</TableHead>
                    <TableHead className="w-[12%] text-center">{tLabel("Result")}</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => {
                    const e = entries[l.line_id] ?? { value: "", verdict: "", text: "" };
                    const set = (patch: Partial<typeof e>) => setEntries((all) => ({ ...all, [l.line_id]: { ...e, ...patch } }));
                    return (
                      <TableRow key={l.line_id} className="align-middle hover:bg-transparent">
                        <TableCell>
                          <div className="font-semibold" style={S.primary}>{l.measurement_code}{l.is_mandatory ? "" : ` (${tLabel("optional")})`}</div>
                          {l.measurement_description && <div className="mt-0.5 text-[11px]" style={S.muted}>{l.measurement_description}</div>}
                        </TableCell>
                        <TableCell style={S.sub}>{tLabel(l.sampling_type === "VALUE" ? "Value" : "Descriptive")}</TableCell>
                        <TableCell style={S.sub}>{specOf(l) || "–"}</TableCell>
                        <TableCell>
                          {l.sampling_type === "VALUE" ? (
                            <input className={`${control} text-right font-mono`} type="number" step="any" value={e.value} disabled={!editable} placeholder="0.00"
                              onChange={(ev) => set({ value: ev.target.value })} aria-label={l.measurement_code} />
                          ) : (
                            <div className="flex items-center gap-2">
                              <select className={`${control} max-w-[7.5rem] shrink-0`} value={e.verdict} disabled={!editable} onChange={(ev) => set({ verdict: ev.target.value })} aria-label={l.measurement_code}>
                                <option value="">{tLabel("Select...")}</option>
                                <option value="PASS">{tLabel("Pass")}</option>
                                <option value="FAIL">{tLabel("Fail")}</option>
                              </select>
                              <input className={control} value={e.text} placeholder={tLabel("What was observed")} disabled={!editable} onChange={(ev) => set({ text: ev.target.value })} />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-center"><ResultBadge result={verdicts[i]} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </table>
            </div>
          </section>

          <section>
            <SectionTitle>{tLabel("Quantities")}</SectionTitle>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {labelled("Sample Qty", <input className={`${control} text-right font-mono`} type="number" min={0} step="any" disabled={!editable}
                value={open ? sample : insp.sample_qty != null ? String(Number(insp.sample_qty)) : ""} onChange={(e) => setSample(e.target.value)} />)}
              {labelled("Accepted Qty", <input className={`${control} text-right font-mono`} type="number" min={0} step="any" disabled={!editable || (failed && !deviation)}
                value={open ? String(acceptedQty) : insp.accepted_qty != null ? String(Number(insp.accepted_qty)) : ""} onChange={(e) => setAccepted(e.target.value)} />)}
              {labelled("Rejected Qty", <input className={`${control} text-right font-mono`} disabled
                value={open ? String(rejectedQty) : insp.rejected_qty != null ? String(Number(insp.rejected_qty)) : ""} />)}
              {labelled("Posting Date", <DateInput value={open ? postingDate : insp.posting_date ? day(insp.posting_date) : ""}
                className="nf-input-sm h-9" disabled={!open && insp.status !== "PENDING_APPROVAL"} onChange={(e) => setPostingDate(e.target.value)} />)}
            </div>
          </section>

          {editable ? (
            <section>
              <SectionTitle>{tLabel("Outcome")}</SectionTitle>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {labelled(needsReason ? "Reason Code *" : "Reason Code", <ReasonSelect valueFormat="id" value={reasonId} onChange={(v) => setReasonId(v)} onClear={() => setReasonId("")} triggerClassName="nf-input-sm h-9" />)}
                {labelled("Remarks", <input className={control} value={remarks} onChange={(e) => setRemarks(e.target.value)} />)}
              </div>
              {failed && (
                <label className="mt-4 flex items-start gap-2 text-sm" style={S.primary}>
                  <input type="checkbox" className="mt-1" checked={deviation} onChange={(e) => { setDeviation(e.target.checked); setAccepted(null); }} />
                  <span>{tLabel("Accept with a deviation. A different user must approve it before any stock is posted.")}</span>
                </label>
              )}
              {needsDisposition && <div className="mt-4">{dispositionFields(choices, true)}</div>}
              <p className="mt-4 rounded-[var(--radius-sm)] border px-3 py-2 text-xs" style={{ borderColor: failed ? "var(--warning)" : "var(--border)", color: "var(--text-secondary)" }}>
                {failed
                  ? tLabel("This lot fails a mandatory check. Without a deviation the whole quantity is rejected and nothing is posted to inventory.")
                  : tLabel("On completion the accepted quantity is posted to the inventory ledger. The rejected quantity is not posted.")}
                {rejectedQty > 0 && fromTransferReceipt ? ` ${tLabel("The rejected quantity goes back to the location it was sent from.")}` : ""}
              </p>
            </section>
          ) : (
            (insp.remarks || insp.reason_code || insp.rejection_disposition) && (
              <section>
                <SectionTitle>{tLabel("Outcome")}</SectionTitle>
                <div className="grid grid-cols-1 gap-4 rounded-[var(--radius-md)] border p-4 md:grid-cols-2" style={S.surface}>
                  {read("Reason Code", insp.reason_code)}{read("Remarks", insp.remarks)}
                  {insp.rejection_disposition ? read("Rejected Qty goes to", tLabel(DISPOSITION_LABEL[insp.rejection_disposition] || insp.rejection_disposition)) : null}
                  {insp.rejection_disposition ? read("Return / scrap document No.", insp.rejection_ref) : null}
                </div>
              </section>
            )
          )}
          {insp.status === "PENDING_APPROVAL" && canApprove && !fromTransferReceipt && (
            <section>
              <SectionTitle>{tLabel("If the deviation is refused")}</SectionTitle>
              <p className="mb-3 text-xs" style={S.sub}>{tLabel("Refusing rejects the whole lot.")}</p>
              {dispositionFields(choices, refuseNeedsDisposition)}
            </section>
          )}
          {settlable && (
            <section>
              <SectionTitle>{tLabel("Settle the rejected quantity")}</SectionTitle>
              <p className="mb-3 text-xs" style={S.sub}>
                {insp.rejection_disposition === "HOLD"
                  ? tLabel("The rejected quantity is held for a decision. Record what became of it.")
                  : tLabel("No disposition was recorded when this inspection was closed. Record what became of the rejected quantity.")}
              </p>
              {dispositionFields(finalChoices, true)}
            </section>
          )}
          {error && <p className="rounded-[var(--radius-sm)] border p-3 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

export default function QcInspectionPanel() {
  const { tLabel } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      const company = getActiveCompanyId();
      if (company) params.set("companyId", company);
      if (status) params.set("status", status);
      if (query.trim()) params.set("search", query.trim());
      setRows(unwrap<Row[]>(await api.get(`/qc-inspection?${params.toString()}`)) || []);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setLoading(false); }
  }, [status, query, page]);
  useEffect(() => { void load(); }, [load]);

  // A page link such as /inventory/qc-inspection?recordId=... opens that inspection.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("recordId");
    if (id) setOpenId(id);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-xs" style={S.sub}>
        {tLabel("A received lot, transfer receipt or semen collection of a QC-required item waits here. Its inventory entry is posted only when the inspection is completed and the quantity accepted.")}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border p-1" style={S.surface} role="tablist" aria-label={tLabel("Status")}>
          {STATUS_FILTERS.map((f) => {
            const active = status === f.value;
            return (
              <button key={f.value || "all"} type="button" role="tab" aria-selected={active}
                onClick={() => { setStatus(f.value); setPage(0); }}
                className="h-8 cursor-pointer rounded-[var(--radius-sm)] px-3 text-xs font-semibold transition-colors"
                style={active ? { backgroundColor: "var(--accent)", color: "#fff" } : { color: "var(--text-secondary)" }}>
                {tLabel(f.label)}
              </button>
            );
          })}
        </div>
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); setQuery(search); setPage(0); }}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tLabel("Inspection, source, PO or item")}
              className="nf-input-sm h-9 w-64 pl-8 pr-3" style={S.input} />
          </div>
          <Button type="submit" size="sm" variant="outline">{tLabel("Search")}</Button>
        </form>
      </div>

      {error && <p className="rounded-[var(--radius-sm)] border p-3 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</p>}

      <div className="overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <TableHeader>
              <tr>
                <TableHead className="whitespace-nowrap">{tLabel("Document No.")}</TableHead>
                <TableHead className="whitespace-nowrap">{tLabel("Date")}</TableHead>
                <TableHead className="whitespace-nowrap">{tLabel("Source")}</TableHead>
                <TableHead className="whitespace-nowrap">{tLabel("PO No.")}</TableHead>
                <TableHead>{tLabel("Item")}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{tLabel("Quantity")}</TableHead>
                <TableHead className="whitespace-nowrap">{tLabel("Status")}</TableHead>
                <TableHead className="whitespace-nowrap">{tLabel("Result")}</TableHead>
                <TableHead className="w-12" />
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr><TableCell colSpan={9} className="py-10 text-center" style={S.sub}><Loader2 className="mx-auto h-5 w-5 animate-spin" style={S.muted} /></TableCell></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <TableCell colSpan={9} className="py-10 text-center" style={S.sub}>
                    <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} />
                    {tLabel("No QC inspections.")}
                  </TableCell>
                </tr>
              ) : rows.map((r) => (
                <TableRow key={r.inspection_id} className="cursor-pointer" onClick={() => setOpenId(r.inspection_id)}>
                  <TableCell className="whitespace-nowrap font-semibold">{r.inspection_no}</TableCell>
                  <TableCell className="whitespace-nowrap" style={S.sub}>{day(r.inspection_date)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div style={S.primary}>{r.source_doc_no}</div>
                    <div className="text-[11px]" style={S.muted}>{tLabel(SOURCE_LABEL[r.source_doc_type] || r.source_doc_type)}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap" style={S.sub}>{r.po_no || "–"}</TableCell>
                  <TableCell>
                    <div className="font-semibold" style={S.primary}>{r.item_code}</div>
                    <div className="text-[11px]" style={S.muted}>{r.item_name}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono">{formatQuantity(Number(r.quantity))} {r.uom}</TableCell>
                  <TableCell className="whitespace-nowrap"><StatusBadge status={r.status} label={tLabel(STATUS_LABEL[r.status] || r.status)} /></TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.result ? <StatusBadge status={r.result === "PASS" ? "COMPLETED" : r.result === "DEVIATION" ? "PENDING" : "REJECTED"} label={tLabel(r.result === "PASS" ? "Pass" : r.result === "FAIL" ? "Fail" : "Deviation")} /> : <span style={S.muted}>–</span>}
                    {r.rejection_disposition && (
                      <div className="mt-1 text-[11px]" style={r.rejection_disposition === "HOLD" ? { color: "var(--warning)" } : S.muted}>
                        {tLabel(DISPOSITION_LABEL[r.rejection_disposition] || r.rejection_disposition)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <button type="button" title={tLabel("Open")} className="rounded-lg p-1.5 transition hover:bg-(--surface-raised)" style={S.sub}
                      onClick={(e) => { e.stopPropagation(); setOpenId(r.inspection_id); }}>
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
        {(page > 0 || rows.length >= PAGE_SIZE) && (
          <div className="flex items-center justify-between border-t px-4 py-2" style={S.line}>
            <span className="text-xs" style={S.muted}>{tLabel("Page")} {page + 1}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>{tLabel("Previous")}</Button>
              <Button variant="outline" size="sm" disabled={rows.length < PAGE_SIZE || loading} onClick={() => setPage((p) => p + 1)}>{tLabel("Next")}</Button>
            </div>
          </div>
        )}
      </div>

      {openId && <InspectionDialog id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
