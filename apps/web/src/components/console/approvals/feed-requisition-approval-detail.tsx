"use client";

/**
 * A feed requisition as the approver sees it in the Approvals inbox (D25):
 * its lines, the farm's remarks, and — while pending — the approver's own
 * remarks, which go with Approve (checkpoints 18 and 22 are checked again at
 * approval: a line more than 20 % off, or a late submission, needs them).
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { Field } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDateShort } from "@/utils/date-short";

interface ReqLine {
  line_id: string;
  destination_code: string | null;
  item_code: string | null;
  item_name: string | null;
  recommended_qty_kg: string | null;
  quantity: string;
  proposed_delivery_date: string | null;
}

const kg = (v: string | null) => (v == null || v === "" ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const TH = "h-8 whitespace-nowrap px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-2 py-1 text-[11px] text-[var(--text-primary)]";

export function FeedRequisitionApprovalDetail({
  documentId,
  pending,
  remarks,
  onRemarksChange,
}: {
  documentId: string;
  pending: boolean;
  remarks: string;
  onRemarksChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const [lines, setLines] = useState<ReqLine[] | null>(null);
  const [farmRemarks, setFarmRemarks] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api
      .get(`/feed-requisition/${documentId}`)
      .then((res: any) => {
        if (!alive) return;
        const view = res?.data ?? res;
        setLines(Array.isArray(view?.lines) ? view.lines : []);
        setFarmRemarks(view?.remarks ?? null);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [documentId]);

  return (
    <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      {failed ? (
        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{t("apReqLinesUnavailable")}</p>
      ) : lines ? (
        <ScrollTable label={t("apReqLinesLabel")} className="max-h-48">
          <thead>
            <tr>
              <th scope="col" className={TH}>{t("apReqColDestination")}</th>
              <th scope="col" className={TH}>{t("apReqColItem")}</th>
              <th scope="col" className={`${TH} text-right`}>{t("apReqColRecommended")}</th>
              <th scope="col" className={`${TH} text-right`}>{t("apReqColRequested")}</th>
              <th scope="col" className={TH}>{t("apReqColDelivery")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line_id}>
                <td className={TD}>{l.destination_code ?? "—"}</td>
                <td className={TD}>{l.item_code} — {l.item_name}</td>
                <td className={`${TD} text-right tabular-nums`}>{kg(l.recommended_qty_kg)}</td>
                <td className={`${TD} text-right tabular-nums`}>{kg(l.quantity)}</td>
                <td className={TD}>{formatDateShort(l.proposed_delivery_date)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      ) : null}
      {farmRemarks && <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{t("apReqFarmRemarks", { remarks: farmRemarks })}</p>}
      {pending && (
        <Field label={t("apReqApproverRemarks")} htmlFor={`ap-req-remarks-${documentId}`} hint={t("apReqApproverRemarksHint")}>
          <textarea id={`ap-req-remarks-${documentId}`} rows={2} className="nf-input w-full px-2 py-1 text-xs"
            value={remarks} onChange={(e) => onRemarksChange(e.target.value)} />
        </Field>
      )}
      <a href={`/inventory/requisitions?id=${documentId}`} className="inline-block text-[11px] font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>
        {t("apReqOpen")}
      </a>
    </div>
  );
}
