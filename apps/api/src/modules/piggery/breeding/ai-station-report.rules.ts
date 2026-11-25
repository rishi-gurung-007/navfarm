/**
 * The AI Station report (Phase 5, 24 Nov 2026): the client's mini report "Requested 100, Received 90, Used 70, Destroyed 20" per request,
 * per farm and per lot. Pure: the service gathers the facts, this turns them into rows.
 *
 * Requested: the request line's doses. Received: what landed in the farm's store (posted receipts, after the farm's QC accepted them).
 * Pending QC: received but still held by the farm's receipt QC. Rejected: refused by that QC (it goes back to the sender). Used: matings
 * that drew the lot at the farm's store. Destroyed: doses of the lot written off there. On hand = received - used - destroyed. Short =
 * requested - received - pending - rejected (never below 0). Several requests sharing one lot at one store share its use and destruction
 * earliest needed first, each up to what it received.
 */

export interface RequestFact {
  line_id: string;
  req_no: string;
  farm_id: string | null;
  farm_code: string | null;
  breed_id: string | null;
  breed_code: string | null;
  required_date: string | null;
  lot_no: string | null;
  to_store_id: string | null;
  status: string;
  requested: number;
  received: number;
  pending_qc: number;
  rejected: number;
}

export interface StoreUse {
  lot_no: string;
  store_id: string;
  used: number;
  destroyed: number;
}

export interface ReportRow extends RequestFact {
  used: number;
  destroyed: number;
  on_hand: number;
  short: number;
}

export interface Totals {
  requested: number;
  received: number;
  pending_qc: number;
  rejected: number;
  used: number;
  destroyed: number;
  on_hand: number;
  short: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const byNeed = (a: RequestFact, b: RequestFact) =>
  (a.required_date ?? '9999-12-31').localeCompare(b.required_date ?? '9999-12-31') || a.req_no.localeCompare(b.req_no);

export function requestRows(requests: RequestFact[], uses: StoreUse[]): ReportRow[] {
  const left = new Map(uses.map((u) => [`${u.lot_no}|${u.store_id}`, { used: u.used, destroyed: u.destroyed }]));
  const rows = new Map<string, ReportRow>();
  for (const r of [...requests].sort(byNeed)) {
    let used = 0;
    let destroyed = 0;
    const pool = r.lot_no && r.to_store_id ? left.get(`${r.lot_no}|${r.to_store_id}`) : undefined;
    if (pool) {
      used = Math.min(pool.used, r.received);
      pool.used -= used;
      destroyed = Math.min(pool.destroyed, r.received - used);
      pool.destroyed -= destroyed;
    }
    rows.set(r.line_id, {
      ...r,
      used: r2(used),
      destroyed: r2(destroyed),
      on_hand: r2(Math.max(0, r.received - used - destroyed)),
      short: r2(Math.max(0, r.requested - r.received - r.pending_qc - r.rejected)),
    });
  }
  // Back in the order they came.
  return requests.map((r) => rows.get(r.line_id)!);
}

export function totalsOf(rows: Pick<ReportRow, keyof Totals>[]): Totals {
  const t: Totals = { requested: 0, received: 0, pending_qc: 0, rejected: 0, used: 0, destroyed: 0, on_hand: 0, short: 0 };
  for (const r of rows) for (const k of Object.keys(t) as (keyof Totals)[]) t[k] += Number(r[k] || 0);
  for (const k of Object.keys(t) as (keyof Totals)[]) t[k] = r2(t[k]);
  return t;
}

/** The same rows summed by requesting farm. */
export function farmRows(rows: ReportRow[]): (Totals & { farm_id: string | null; farm_code: string | null; requests: number })[] {
  const groups = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const key = r.farm_id ?? '';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .map((g) => ({ farm_id: g[0].farm_id, farm_code: g[0].farm_code, requests: g.length, ...totalsOf(g) }))
    .sort((a, b) => (a.farm_code ?? '').localeCompare(b.farm_code ?? ''));
}

/** "Requested 100 · Received 90 · Used 70 · Destroyed 20": the client's one-line report. */
export function miniReport(t: Pick<Totals, 'requested' | 'received' | 'used' | 'destroyed'>): string {
  return `Requested: ${t.requested}, Received: ${t.received}, Used: ${t.used}, Destroyed: ${t.destroyed}`;
}
