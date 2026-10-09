"use client";

/**
 * Approve / Reject for a requisition whose approval request is open — the ONE
 * decide implementation, shared by Requisition (the common kinds) and Feed
 * Forecast → Requisition (feed). WP1b put it in the hub; WP1g (decisions.md
 * 2026-10-05) moved feed requisitions to their own tab and that tab needs the
 * same actions, so this is the same component, not a second copy.
 *
 * It calls the EXISTING /approval/:id/approve and /approval/:id/reject
 * endpoints, so the document's own checks (remarks on a deviation, the
 * deadline, capacity, rejection reasons) run in one place server-side and the
 * server decides who may act: a refusal is shown as it comes.
 */
import { useRef, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogFooterActions } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";

export interface RequisitionDecisionTarget {
  requestId: string;
  docNo: string;
}

const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

/** The decision surface for a list row / opened view: only a pending requisition with an open request has one. */
export function decisionTargetOf(
  source: { status?: string | null; approval_request_id?: string | null; req_no?: string | null } | null | undefined,
): RequisitionDecisionTarget | null {
  return source?.approval_request_id && source.status === "PENDING_APPROVAL"
    ? { requestId: source.approval_request_id, docNo: source.req_no ?? "" }
    : null;
}

export function RequisitionDecision({
  target,
  onDecided,
}: {
  target: RequisitionDecisionTarget;
  /** After the server accepted the decision; `message` is the success notice to show. */
  onDecided: (message: string) => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const [deciding, setDeciding] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // Shown here, inside the dialog: the page's own alerts sit underneath it, so a
  // refusal (remarks needed, deadline passed, not your request) would go unseen.
  const [error, setError] = useState("");

  const run = async (call: () => Promise<unknown>, message: string) => {
    if (deciding) return;
    setDeciding(true);
    setError("");
    try {
      await call();
      await onDecided(message);
    } catch (err: any) {
      setError(err?.message || tRef.current("rqActionFailed"));
    } finally {
      setDeciding(false);
    }
  };

  const approve = () =>
    run(
      () => api.post(`/approval/${target.requestId}/approve`, remarks.trim() ? { remarks: remarks.trim() } : {}),
      t("rhApprovedMsg", { docNo: target.docNo }),
    );
  const reject = () =>
    run(
      () => api.post(`/approval/${target.requestId}/reject`, { rejection_reason: rejectReason.trim() || undefined }),
      t("rhRejectedMsg", { docNo: target.docNo }),
    );

  // A display hint only, the same grant the /approval approve and reject
  // endpoints require (PRODUCTION / APPROVAL / approve); the server stays the
  // authority and still refuses anyone it should. The feed tab is the drafters'
  // screen, so without this a submitter would be offered buttons they cannot use.
  if (!hasPermission(getStoredUser(), "PRODUCTION", "APPROVAL", "can_approve")) return null;

  if (rejecting) {
    return (
      <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        {error && <InlineAlert>{error}</InlineAlert>}
        <Field label={t("rhRejectionReason")} htmlFor="rh-reject-reason">
          <textarea id="rh-reject-reason" rows={2} className="nf-input w-full" style={inputStyle} value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)} />
        </Field>
        <DialogFooterActions>
          <Button variant="outline" size="sm" disabled={deciding} onClick={() => setRejecting(false)}>{t("rhRejectCancel")}</Button>
          <Button variant="destructive" size="sm" disabled={deciding} onClick={reject}>{t("rhRejectConfirm")}</Button>
        </DialogFooterActions>
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      {error && <InlineAlert>{error}</InlineAlert>}
      <Field label={t("rhApproverRemarks")} htmlFor="rh-remarks">
        <textarea id="rh-remarks" rows={2} className="nf-input w-full" style={inputStyle} value={remarks}
          onChange={(e) => setRemarks(e.target.value)} />
      </Field>
      <DialogFooterActions>
        <Button variant="destructive" size="sm" disabled={deciding} onClick={() => { setRejecting(true); setRejectReason(""); }}>
          {t("rhReject")}
        </Button>
        <Button size="sm" className="nf-btn-primary" disabled={deciding} onClick={approve}>{t("rhApprove")}</Button>
      </DialogFooterActions>
    </div>
  );
}
