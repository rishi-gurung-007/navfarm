"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { showToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import { unwrap } from "./feed-format";
import type { RequisitionView } from "./feed-requisition-document";

interface PreviewLine {
  destination_location_id: string;
  destination_code: string;
  destination_name: string;
  item_id: string;
  item_code: string;
  item_name: string;
  recommended_qty_kg: number;
  quantity_kg: number;
  proposed_delivery_date: string;
}

interface Preview {
  runId: string;
  runCode: string;
  farmId: string;
  existingRequisitionId: string | null;
  lines: PreviewLine[];
}

const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

export function FeedRequisitionFromRunDialog({ open, runId, onClose, onView }: {
  open: boolean;
  runId: string | null;
  onClose: () => void;
  onView: (view: RequisitionView) => void;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !runId) return;
    let alive = true;
    setLoading(true);
    setPreview(null);
    setLines([]);
    setRemarks("");
    api.get(`/feed-requisition/from-run/${runId}/preview`)
      .then((response) => {
        if (!alive) return;
        const next = unwrap<Preview>(response);
        setPreview(next);
        setLines(Array.isArray(next.lines) ? next.lines.map((line) => ({ ...line })) : []);
      })
      .catch((err: any) => {
        if (alive) showToast.error(err?.message || tRef.current("rqFromRunLoadFailed"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [open, runId]);

  const updateLine = (index: number, patch: Partial<PreviewLine>) => {
    setLines((current) => current.map((line, at) => at === index ? { ...line, ...patch } : line));
  };

  const viewExisting = async () => {
    if (!preview?.existingRequisitionId) return;
    setBusy(true);
    try {
      onView(unwrap<RequisitionView>(await api.get(`/feed-requisition/${preview.existingRequisitionId}`)));
    } catch (err: any) {
      showToast.error(err?.message || tRef.current("rqLoadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      const view = unwrap<RequisitionView>(await api.post(`/feed-requisition/from-run/${runId}`, {
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        lines: lines.map((line) => ({
          destination_location_id: line.destination_location_id,
          item_id: line.item_id,
          quantity_kg: Number(line.quantity_kg),
          proposed_delivery_date: line.proposed_delivery_date,
        })),
      }));
      showToast.success(tRef.current("rqCreated"));
      onView(view);
    } catch (err: any) {
      showToast.error(err?.message || tRef.current("rqActionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const complete = lines.length > 0 && lines.every((line) => Number(line.quantity_kg) > 0 && !!line.proposed_delivery_date);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("rqFromRunTitle")}
      description={preview ? t("rqFromRunDescription", { code: preview.runCode }) : undefined}
      footer={preview?.existingRequisitionId ? (
        <Button size="sm" onClick={viewExisting} disabled={busy}>{t("rqViewRequisition")}</Button>
      ) : (
        <>
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>{t("rqNewCancel")}</Button>
          <Button size="sm" onClick={create} disabled={busy || loading || !complete}>{t("rqCreateFromSaved")}</Button>
        </>
      )}
    >
      {loading ? <p className="text-sm text-[var(--text-secondary)]">{t("rqFromRunLoading")}</p> : null}
      {!loading && preview && lines.length === 0 ? <InlineAlert variant="info">{t("rqFromRunNoShortage")}</InlineAlert> : null}
      {!loading && preview && lines.length > 0 ? (
        <>
          <ScrollTable label={t("rqFromRunLines")}>
            <thead><tr>
              <th>{t("rqdColSilo")}</th><th>{t("rqdColItemNo")}</th><th>{t("rqdColItemDesc")}</th>
              <th>{t("rqdColRecommended")}</th><th>{t("rqdColRequested")}</th><th>{t("rqdColDelivery")}</th>
            </tr></thead>
            <tbody>{lines.map((line, index) => (
              <tr key={`${line.destination_location_id}:${line.item_id}`}>
                <td>{line.destination_code}</td>
                <td>{line.item_code}</td>
                <td>{line.item_name}</td>
                <td className="text-right tabular-nums">{Number(line.recommended_qty_kg).toLocaleString("en-US")}</td>
                <td><input aria-label={t("rqNewKg", { line: index + 1 })} type="number" min="0.001" step="0.001" className="nf-input-sm w-32 text-right" style={inputStyle} value={line.quantity_kg} onChange={(event) => updateLine(index, { quantity_kg: Number(event.target.value) })} /></td>
                <td><input aria-label={t("rqNewDate", { line: index + 1 })} type="date" className="nf-input-sm" style={inputStyle} value={line.proposed_delivery_date} onChange={(event) => updateLine(index, { proposed_delivery_date: event.target.value })} /></td>
              </tr>
            ))}</tbody>
          </ScrollTable>
          <div className="mt-4">
            <Field label={t("rqdRemarks")} htmlFor="rq-from-run-remarks">
              <textarea id="rq-from-run-remarks" className="nf-input min-h-20 w-full" style={inputStyle} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
            </Field>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
