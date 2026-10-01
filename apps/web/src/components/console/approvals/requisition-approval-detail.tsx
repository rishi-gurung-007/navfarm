"use client";

/**
 * A common requisition as the approver sees it in the Approvals inbox (Task 9):
 * its header snapshots, lines with their transfer quantities, and the three
 * state dimensions. Read-only — the Approve/Reject buttons live in the shell
 * and decide through the same linked approval request as every other document.
 */
import { useEffect, useState } from "react";
import { api } from "@/services/api-client";
import { ScrollTable } from "@/components/ui/scroll-table";
import { useLanguage } from "@/hooks/useLanguage";
import { formatDateShort } from "@/utils/date-short";

interface ReqLine {
  line_id: string;
  line_seq: number;
  item_code: string | null;
  item_name: string | null;
  description: string | null;
  quantity: string;
  uom: string;
  qty_to_ship: string | null;
  qty_shipped: string | null;
  qty_to_receive: string | null;
  qty_received: string | null;
  balance_to_ship?: number;
  remaining_to_receive?: number;
}

interface ReqView {
  req_no: string;
  doc_type: string;
  purpose: string | null;
  status: string;
  requisition_date: string | null;
  requester_name: string | null;
  remarks: string | null;
  justification: string | null;
  approval_status: string | null;
  document_status: string | null;
  fulfilment_status: string | null;
  integration_status: string | null;
  lines: ReqLine[];
}

const num = (v: string | null | undefined) =>
  v == null || v === "" ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const TH = "h-8 whitespace-nowrap px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";
const TD = "whitespace-nowrap px-2 py-1 text-[11px] text-[var(--text-primary)]";

const purposeLabel: Record<string, string> = { STORE: "Store", PURCHASE: "Purchase" };

export function RequisitionApprovalDetail({ documentId }: { documentId: string }) {
  const { t } = useLanguage();
  const [view, setView] = useState<ReqView | null>(null);
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
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <p><span className="font-medium text-[var(--text-secondary)]">Type / purpose</span> {view.doc_type} · {purposeLabel[view.purpose ?? ""] ?? view.purpose ?? "—"}</p>
        <p><span className="font-medium text-[var(--text-secondary)]">Document date</span> {formatDateShort(view.requisition_date)}</p>
        <p><span className="font-medium text-[var(--text-secondary)]">Requester</span> {view.requester_name ?? "—"}</p>
        <p>
          <span className="font-medium text-[var(--text-secondary)]">States</span>{" "}
          {[view.approval_status, view.document_status, view.fulfilment_status !== "NOT_APPLICABLE" ? view.fulfilment_status : null, view.integration_status !== "NOT_APPLICABLE" ? view.integration_status : null]
            .filter(Boolean).join(" · ")}
        </p>
      </div>

      <ScrollTable label={t("apCreqLinesLabel")} className="max-h-48">
        <thead>
          <tr>
            <th scope="col" className={TH}>#</th>
            <th scope="col" className={TH}>{t("apCreqColItem")}</th>
            <th scope="col" className={`${TH} text-right`}>{t("apCreqColRequested")}</th>
            <th scope="col" className={`${TH} text-right`}>{t("apCreqColToShip")}</th>
            <th scope="col" className={`${TH} text-right`}>{t("apCreqColToReceive")}</th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map((l) => (
            <tr key={l.line_id}>
              <td className={TD}>{l.line_seq}</td>
              <td className={TD}>{l.item_code ? `${l.item_code} — ${l.item_name}` : l.description}</td>
              <td className={`${TD} text-right tabular-nums`}>{num(l.quantity)} {l.uom}</td>
              <td className={`${TD} text-right tabular-nums`}>{num(l.qty_to_ship)}</td>
              <td className={`${TD} text-right tabular-nums`}>{num(l.qty_to_receive)}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>

      {view.remarks && <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{t("apCreqRemarks", { remarks: view.remarks })}</p>}
    </div>
  );
}
