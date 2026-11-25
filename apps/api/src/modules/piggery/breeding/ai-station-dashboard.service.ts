import { Injectable } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { animalScopeConditions, farmOfLocation, farmScope } from '../../../common/farm-scope';
import { AiStationDashboardQueryDto } from './dto/ai-station-dashboard.dto';
import { SemenRequestService } from './semen-request.service';
import { farmRows, miniReport, requestRows, totalsOf, type RequestFact, type StoreUse } from './ai-station-report.rules';

const TRANSFER_SOURCES = ['TRANSFER_RECEIPT', 'TRANSFER_EVENT'];
const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);
const inRange = (d: string | null, q: AiStationDashboardQueryDto) => (!q.from_date || (d != null && d >= q.from_date)) && (!q.to_date || (d != null && d <= q.to_date));

/** Where a request stands, for the status filter and the report. */
function requestState(r: { document_status: string | null; approval_status: string | null; qty_received: number; qty_shipped: number; doses: number }) {
  if (r.document_status === 'CANCELLED') return 'CANCELLED';
  if (r.qty_received >= r.doses - 1e-9) return 'RECEIVED';
  if (r.qty_shipped > 0 || r.approval_status === 'APPROVED') return r.qty_shipped > 0 ? 'IN_PROGRESS' : 'OPEN';
  return 'OPEN';
}

/**
 * AI Station dashboard (Phase 5, 24 Nov 2026): the tiles, the client's mini report per request / farm / lot, and the lots, under one set of
 * filters. Read only. See ai-station-report.rules.ts for what each figure means.
 */
@Injectable()
export class AiStationDashboardService {
  constructor(
    private readonly cls: ClsService,
    private readonly semenRequests: SemenRequestService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async dashboard(q: AiStationDashboardQueryDto, tenantId: string) {
    const scope = farmScope(this.cls);
    const farmCache = new Map<string, string | null>();
    const farmOf = async (id: string | null) => {
      if (!id) return null;
      if (!farmCache.has(id)) farmCache.set(id, await farmOfLocation(this.db, id));
      return farmCache.get(id)!;
    };

    // ---- lots
    const B = schema.semenBatch;
    const lotRows = await this.db
      .select({
        semen_batch_id: B.semen_batch_id, lot_no: B.lot_no, collection_date: B.collection_date, breed_id: B.breed_id, breed_code: schema.breedMaster.breed_code,
        boar_id: B.boar_animal_id, boar_code: schema.animalRegister.animal_code, item_id: B.output_item_id, warehouse_id: B.warehouse_id,
        doses_collected: B.doses_collected, doses_used_internal: B.doses_used_internal, doses_sold: B.doses_sold, doses_destroyed: B.doses_destroyed,
        running_cost: B.running_cost_period, unit_cost: B.unit_cost_per_dose, inventory_posted: B.inventory_posted, label: B.label,
      })
      .from(B)
      .innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, B.boar_animal_id))
      .leftJoin(schema.breedMaster, eq(schema.breedMaster.breed_id, B.breed_id))
      .where(and(eq(B.tenant_id, tenantId), ...animalScopeConditions(scope)))
      .orderBy(desc(B.collection_date));
    const lotNos = lotRows.map((l) => l.lot_no).filter((n): n is string => !!n);
    const lotIds = lotRows.map((l) => l.semen_batch_id);

    const Q = schema.qcInspection;
    const collectionQc = lotIds.length
      ? await this.db.select({ line: Q.source_line_id, no: Q.inspection_no, status: Q.status, ledger: Q.ledger_entry_id, rounds: Q.rounds })
          .from(Q).where(and(eq(Q.source_doc_type, 'SEMEN_COLLECTION'), inArray(Q.source_line_id, lotIds)))
      : [];
    const L = schema.inventoryLedger;
    const stockByLotStore = lotNos.length
      ? await this.db
          .select({
            lot_no: L.lot_no, item_id: L.item_id, store_id: L.warehouse_id,
            qty: sql<string>`SUM(${L.quantity})`,
            used: sql<string>`-SUM(CASE WHEN ${L.transaction_type} = 'CONSUMPTION' AND ${L.document_type} = 'BREEDING' THEN ${L.quantity} ELSE 0 END)`,
          })
          .from(L).where(inArray(L.lot_no, lotNos)).groupBy(L.lot_no, L.item_id, L.warehouse_id)
      : [];
    const D = schema.semenDoseDisposal;
    const disposals = lotIds.length
      ? await this.db.select({ lot_id: D.semen_batch_id, lot_no: D.lot_no, store_id: D.warehouse_id, source: D.source, doses: D.doses }).from(D).where(inArray(D.semen_batch_id, lotIds))
      : [];
    const P = schema.semenPlanRequisition;
    const allocations = lotIds.length
      ? await this.db.select({ lot_id: P.semen_batch_id, doses: P.doses }).from(P).where(inArray(P.semen_batch_id, lotIds))
      : [];

    const lots = await Promise.all(lotRows.map(async (l) => {
      const qc = collectionQc.find((c) => c.line === l.semen_batch_id);
      const qc_state = !qc ? 'NONE' : qc.status !== 'CLOSED' ? 'PENDING' : qc.ledger ? 'PASSED' : 'FAILED';
      const stock = stockByLotStore.filter((s) => s.lot_no === l.lot_no && s.item_id === l.item_id);
      const scrapped = disposals.filter((d) => d.lot_id === l.semen_batch_id && d.source === 'QC_REJECTION').reduce((n, d) => n + Number(d.doses), 0);
      return {
        semen_batch_id: l.semen_batch_id, lot_no: l.lot_no, label: l.label, collection_date: day(l.collection_date), breed_id: l.breed_id, breed_code: l.breed_code,
        boar_id: l.boar_id, boar_code: l.boar_code, item_id: l.item_id, collection_farm_id: await farmOf(l.warehouse_id),
        qc_state, qc_inspection_no: qc?.no ?? null, qc_rounds: qc?.rounds ?? null,
        collected: Number(l.doses_collected ?? 0),
        used: Number(l.doses_used_internal ?? 0),
        sold: Number(l.doses_sold ?? 0),
        destroyed: r2(Number(l.doses_destroyed ?? 0) + scrapped),
        on_hand: r2(stock.reduce((n, s) => n + Number(s.qty), 0)),
        allocated: r2(allocations.filter((a) => a.lot_id === l.semen_batch_id).reduce((n, a) => n + Number(a.doses), 0)),
        cost: Number(l.running_cost ?? 0),
        cost_per_dose: Number(l.unit_cost ?? 0),
      };
    }));

    // ---- requests
    const requests = await this.semenRequests.lines(tenantId, { breedId: q.breed_id });
    const reqLineIds = requests.map((r) => r.line_id);
    const TL = schema.stockTransferLine;
    const transferLines = reqLineIds.length
      ? await this.db.select({ line_id: TL.line_id, req_line: TL.requisition_line_id }).from(TL).where(inArray(TL.requisition_line_id, reqLineIds))
      : [];
    const tlIds = transferLines.map((t) => t.line_id);
    const receipts = tlIds.length
      ? await this.db.select({ line: L.document_line_id, qty: sql<string>`SUM(${L.quantity})` }).from(L)
          .where(and(eq(L.transaction_type, 'TRANSFER_RECEIPT'), inArray(L.document_line_id, tlIds))).groupBy(L.document_line_id)
      : [];
    const farmQc = tlIds.length
      ? await this.db.select({ line: Q.source_line_id, status: Q.status, quantity: Q.quantity, rejected: Q.rejected_qty })
          .from(Q).where(and(inArray(Q.source_doc_type, TRANSFER_SOURCES), inArray(Q.source_line_id, tlIds)))
      : [];
    const lotByNo = new Map(lots.map((l) => [l.lot_no, l]));
    const facts: (RequestFact & { collection_farm_id: string | null; item_id: string | null; boar_id: string | null })[] = [];
    for (const r of requests) {
      const mine = transferLines.filter((t) => t.req_line === r.line_id).map((t) => t.line_id);
      const sum = <T,>(rows: T[], pick: (x: T) => number) => rows.reduce((n, x) => n + pick(x), 0);
      const qcs = farmQc.filter((x) => mine.includes(x.line ?? ''));
      facts.push({
        line_id: r.line_id, req_no: r.req_no, farm_id: r.farm_id, farm_code: r.farm?.code ?? null, breed_id: r.breed_id, breed_code: r.breed_code,
        required_date: day(r.required_date), lot_no: r.lot_no, to_store_id: r.to_location_id,
        status: requestState({ document_status: r.document_status, approval_status: r.approval_status, qty_received: r.qty_received, qty_shipped: r.qty_shipped, doses: r.doses }),
        requested: r.doses,
        received: r2(sum(receipts.filter((x) => mine.includes(x.line ?? '')), (x) => Number(x.qty))),
        pending_qc: r2(sum(qcs.filter((x) => x.status !== 'CLOSED'), (x) => Number(x.quantity))),
        rejected: r2(sum(qcs.filter((x) => x.status === 'CLOSED'), (x) => Number(x.rejected ?? 0))),
        collection_farm_id: await farmOf(r.from_location_id),
        item_id: r.item_id,
        boar_id: r.lot_no ? (lotByNo.get(r.lot_no)?.boar_id ?? null) : null,
      });
    }

    // ---- filters
    const lotMatch = (l: (typeof lots)[number]) =>
      inRange(l.collection_date, q) && (!q.collection_farm_id || l.collection_farm_id === q.collection_farm_id) && (!q.breed_id || l.breed_id === q.breed_id)
      && (!q.boar_id || l.boar_id === q.boar_id) && (!q.lot_no || l.lot_no === q.lot_no) && (!q.item_id || l.item_id === q.item_id)
      && (!q.qc_state || l.qc_state === q.qc_state);
    const restrictedFarm = scope.farmId;
    const reqMatch = (f: (typeof facts)[number]) =>
      inRange(f.required_date, q) && (!q.collection_farm_id || f.collection_farm_id === q.collection_farm_id) && (!q.farm_id || f.farm_id === q.farm_id)
      && (!q.boar_id || f.boar_id === q.boar_id) && (!q.lot_no || f.lot_no === q.lot_no) && (!q.item_id || f.item_id === q.item_id)
      && (!q.request_status || f.status === q.request_status)
      && (!q.qc_state || (f.lot_no != null && lotByNo.get(f.lot_no)?.qc_state === q.qc_state))
      // A farm user sees the requests of their farm, or the ones sent from it.
      && (!restrictedFarm || f.farm_id === restrictedFarm || f.collection_farm_id === restrictedFarm);
    const shownFacts = facts.filter(reqMatch);
    // A farm filter narrows the lots to those sent to that farm's requests.
    const farmLots = q.farm_id ? new Set(shownFacts.map((f) => f.lot_no).filter(Boolean)) : null;
    const shownLots = lots.filter((l) => lotMatch(l) && (!farmLots || farmLots.has(l.lot_no)));

    // Use and destruction of each lot at each store.
    const uses: StoreUse[] = stockByLotStore
      .filter((s) => s.lot_no && s.store_id)
      .map((s) => ({
        lot_no: s.lot_no!, store_id: s.store_id!, used: Number(s.used ?? 0),
        destroyed: disposals.filter((d) => d.source === 'MANUAL' && d.lot_no === s.lot_no && d.store_id === s.store_id).reduce((n, d) => n + Number(d.doses), 0),
      }));
    const rows = requestRows(shownFacts, uses);
    const totals = totalsOf(rows);
    const qcFarmPending = await this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(Q)
      .where(and(eq(Q.tenant_id, tenantId), inArray(Q.source_doc_type, TRANSFER_SOURCES), sql`${Q.status} <> 'CLOSED'`, lotNos.length ? inArray(Q.lot_no, lotNos) : sql`1 = 0`));
    const collected = shownLots.reduce((n, l) => n + l.collected, 0);
    const cost = shownLots.reduce((n, l) => n + l.cost, 0);

    return {
      filters: q,
      tiles: {
        requested: totals.requested,
        received: totals.received,
        used: totals.used,
        destroyed: totals.destroyed,
        pending_qc: totals.pending_qc,
        short: totals.short,
        lots: shownLots.length,
        doses_collected: r2(collected),
        on_hand: r2(shownLots.reduce((n, l) => n + l.on_hand, 0)),
        doses_destroyed_all: r2(shownLots.reduce((n, l) => n + l.destroyed, 0)),
        qc_pending_lots: shownLots.filter((l) => l.qc_state === 'PENDING').length,
        qc_failed_lots: shownLots.filter((l) => l.qc_state === 'FAILED').length,
        farm_qc_pending: Number(qcFarmPending[0]?.n ?? 0),
        avg_cost_per_dose: collected > 0 ? r2(cost / collected) : null,
      },
      mini_report: miniReport(totals),
      totals,
      by_request: rows,
      by_farm: farmRows(rows),
      lots: shownLots,
    };
  }
}
