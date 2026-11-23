"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";

type Qc = { inspection_id: string; inspection_no: string; status: string; result?: string | null; qc_state?: string } | null | undefined;

/** Where a QC inspection stands for the lot it belongs to: waiting, accepted into stock, or rejected. */
export function qcStateOf(qc: NonNullable<Qc>): "PENDING" | "ACCEPTED" | "REJECTED" {
  if (qc.qc_state === "PENDING" || qc.qc_state === "ACCEPTED" || qc.qc_state === "REJECTED") return qc.qc_state;
  if (qc.status !== "CLOSED") return "PENDING";
  return qc.result === "FAIL" ? "REJECTED" : "ACCEPTED";
}

const LABEL = { PENDING: "QC pending", ACCEPTED: "QC passed", REJECTED: "QC failed" } as const;
const VARIANT = { PENDING: "warning", ACCEPTED: "success", REJECTED: "danger" } as const;

/** The QC inspection number as a link straight to that inspection, with its status. Nothing when the lot has no QC. */
export function QcLink({ qc, withStatus = true }: { qc: Qc; withStatus?: boolean }) {
  if (!qc) return <span style={{ color: "var(--text-muted)" }}>–</span>;
  const state = qcStateOf(qc);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Link href={`/inventory/qc-inspection?recordId=${qc.inspection_id}`} onClick={(e) => e.stopPropagation()}
        className="font-mono text-xs font-semibold hover:underline" style={{ color: "var(--accent)" }}>
        {qc.inspection_no}
      </Link>
      {withStatus && <Badge variant={VARIANT[state]}>{LABEL[state]}</Badge>}
    </span>
  );
}
