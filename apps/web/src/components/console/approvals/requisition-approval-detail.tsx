"use client";

/**
 * A common requisition as the approver sees it in the Approvals inbox: the
 * full document, read-only. The Approve/Reject buttons live in the shell and
 * decide through the same linked approval request as every other document.
 */
import { useEffect, useState } from "react";
import { api } from "@/services/api-client";
import { useLanguage } from "@/hooks/useLanguage";
import { CommonRequisitionDocument } from "@/components/console/requisitions/common-requisition-document";
import type { CommonRequisitionView } from "@/components/console/requisitions/common-requisition-model";

export function RequisitionApprovalDetail({ documentId }: { documentId: string }) {
  const { t } = useLanguage();
  const [view, setView] = useState<CommonRequisitionView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api
      .get(`/requisition/${documentId}`)
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

  if (failed) {
    return (
      <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{t("apCreqLinesUnavailable")}</p>
      </div>
    );
  }
  if (!view) return null;

  return (
    <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <CommonRequisitionDocument view={view} editable={false} />
    </div>
  );
}
