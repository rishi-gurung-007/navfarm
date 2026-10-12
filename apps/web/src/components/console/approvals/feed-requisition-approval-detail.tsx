"use client";

/**
 * A feed requisition as the approver sees it in the Approvals inbox (D25,
 * §6a "one inbox for every type"): the full document the farm submitted,
 * read-only, plus — while pending — the approver's own remarks, which go with
 * Approve (checkpoints 18 and 22 are checked again at approval: a line more
 * than 20 % off, or a late submission, needs them). The approver does not edit
 * the requisition here; Approve/Reject live in the shell.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { Field } from "@/components/ui/field";
import { useLanguage } from "@/hooks/useLanguage";
import { FeedRequisitionDocument, type FeedRequisitionDocumentView } from "@/components/console/inventory/feed-requisition-document";

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
  const [view, setView] = useState<FeedRequisitionDocumentView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api
      .get(`/feed-requisition/${documentId}`)
      .then((res: any) => {
        if (!alive) return;
        setView(res?.data ?? res);
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
      ) : view ? (
        <FeedRequisitionDocument view={view} editable={false} />
      ) : null}
      {pending && (
        <Field label={t("apReqApproverRemarks")} htmlFor={`ap-req-remarks-${documentId}`} hint={t("apReqApproverRemarksHint")}>
          <textarea id={`ap-req-remarks-${documentId}`} rows={2} className="nf-input w-full px-2 py-1 text-xs"
            value={remarks} onChange={(e) => onRemarksChange(e.target.value)} />
        </Field>
      )}
      <a href={`/inventory/feed-forecast?tab=feed-requisition&id=${documentId}`} className="inline-block text-[11px] font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>
        {t("apReqOpen")}
      </a>
    </div>
  );
}
