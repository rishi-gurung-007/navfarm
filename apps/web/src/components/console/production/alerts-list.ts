/**
 * One row shape for the Alerts page (D24): batch KPI alerts
 * (notification_alert_log, GET /alert) and feed alerts (feed_alert,
 * GET /feed-alert/scope) side by side. Batch stamps are server-local;
 * feed stamps are UTC (Plan B's convention), hence raisedUtc.
 */
export type AlertKind = "BATCH" | "FEED";
export type AlertState = "OPEN" | "READ" | "ACKNOWLEDGED" | "RESOLVED";

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
  };
}

function stampMs(row: AlertRow): number {
  const ms = Date.parse(`${row.raisedAt.replace(" ", "T")}${row.raisedUtc ? "Z" : ""}`);
  return Number.isNaN(ms) ? 0 : ms;
}

export function mergeAlerts(...lists: AlertRow[][]): AlertRow[] {
  return lists.flat().sort((a, b) => stampMs(b) - stampMs(a));
}
