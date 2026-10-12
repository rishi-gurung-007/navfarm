/**
 * One row shape for the Alerts page (D24): batch KPI alerts
 * (notification_alert_log, GET /alert) and feed alerts (feed_alert,
 * GET /feed-alert/scope) side by side. Batch stamps are server-local;
 * feed stamps are UTC (Plan B's convention), hence raisedUtc.
 */
export type AlertKind = "BATCH" | "FEED";
export type AlertState = "OPEN" | "READ" | "ACKNOWLEDGED" | "RESOLVED";

/** W2D W11: what the alert is about — a silo, a requisition or a batch — so the list can link it. */
export type AlertSubjectType = "SILO" | "REQUISITION" | "BATCH";
export interface AlertSubject {
  type: AlertSubjectType;
  id: string;
  /** A readable number when the API sends one (a batch alert's batch_no); null otherwise. */
  code: string | null;
}

const SUBJECT_TYPES: AlertSubjectType[] = ["SILO", "REQUISITION", "BATCH"];

export interface AlertRow {
  key: string;
  kind: AlertKind;
  id: string;
  companyId: string | null;
  priority: string;
  title: string;
  message: string;
  farmId: string | null;
  farmCode: string | null;
  raisedAt: string;
  raisedUtc: boolean;
  state: AlertState;
  subject: AlertSubject | null;
}

export function fromBatchAlert(a: Record<string, any>, farmCodeOf: (farmId: string | null) => string | null): AlertRow {
  const farmId = a.farm_id ?? null;
  return {
    key: `BATCH|${a.alert_id}`,
    kind: "BATCH",
    id: String(a.alert_id),
    companyId: a.company_id ?? null,
    priority: a.severity ?? "WARNING",
    title: a.title ?? "",
    message: a.message ?? "",
    farmId,
    farmCode: farmCodeOf(farmId),
    raisedAt: a.created_at ?? "",
    raisedUtc: false,
    state: a.is_read ? "READ" : "OPEN",
    subject: a.batch_id ? { type: "BATCH", id: String(a.batch_id), code: a.batch_no ?? null } : null,
  };
}

export function fromFeedAlert(a: Record<string, any>): AlertRow {
  return {
    key: `FEED|${a.alert_id}`,
    kind: "FEED",
    id: String(a.alert_id),
    companyId: a.company_id ?? null,
    priority: a.priority_level ?? "INFO",
    title: a.title ?? "",
    message: a.message ?? "",
    farmId: a.farm_id ?? null,
    farmCode: a.farm_code ?? null,
    raisedAt: a.last_notified_at ?? a.raised_at ?? "",
    raisedUtc: true,
    state: a.status === "RESOLVED" ? "RESOLVED" : a.acknowledged_at ? "ACKNOWLEDGED" : "OPEN",
    subject: a.subject_id && SUBJECT_TYPES.includes(a.subject_type)
      ? { type: a.subject_type as AlertSubjectType, id: String(a.subject_id), code: null }
      : null,
  };
}

function stampMs(row: AlertRow): number {
  const ms = Date.parse(`${row.raisedAt.replace(" ", "T")}${row.raisedUtc ? "Z" : ""}`);
  return Number.isNaN(ms) ? 0 : ms;
}

export function mergeAlerts(...lists: AlertRow[][]): AlertRow[] {
  return lists.flat().sort((a, b) => stampMs(b) - stampMs(a));
}
