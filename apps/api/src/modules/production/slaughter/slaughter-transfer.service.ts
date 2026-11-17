import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { farmScope } from '../../../common/farm-scope';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { bioCodes } from '../../inventory/bio-asset-ledger/bio-asset-ledger.types';
import { BatchService } from '../batch/batch.service';
import { isCurrentBioLot } from '../batch/current-bio-lot';
import { herdCarryingAccount } from '../batch/herd-account';
import { CreateSlaughterTransferDto, QuerySlaughterTransferDto, SlaughterKillSheetDto, SlaughterPodDto } from './slaughter-transfer.dto';
import {
  activeWithdrawals, assertSlaughterStatus, doaOverThreshold, invoiceLine, podIssues, slapMark, SLAUGHTER_MAPPINGS, splitTransitValue,
} from './slaughter-transfer.rules';

const SERIES = 'SLAUGHTER_TO';
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/**
 * The slaughter Transfer Order (BBP-1 S.10.1), built API-first on 13 Nov 2026. Create (DRAFT) -> confirm (dispatch: the head leave their lots for Inventory in
 * Transit at the lots' carrying value, after the medicine withdrawal check) -> POD (each line's DOA: Dr Mortality / Impairment Loss, Cr In Transit) -> kill sheet
 * (each line's average carcass weight and price per kg: invoice = delivered x average carcass weight x price; Dr Receivables / Cr Pig Sales Revenue on the supplying
 * farm's cost centre, and Dr COGS / Cr In Transit for the delivered pigs' value) -> close. Commercial lines only: a culled breeding animal goes through the FA ->
 * Inventory conversion, and its Transfer Order line is not built yet.
 */
@Injectable()
export class SlaughterTransferService {
  constructor(
    private readonly cls: ClsService,
    private readonly batches: BatchService,
    private readonly gl: GlPostingService,
    private readonly numberSeries: NumberSeriesService,
    private readonly audit: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private scope() {
    const s = farmScope(this.cls);
    return [
      ...(s.companyId ? [eq(schema.slaughterTransferOrder.company_id, s.companyId)] : []),
      ...(s.farmId ? [eq(schema.slaughterTransferOrder.farm_id, s.farmId)] : []),
    ];
  }

  async findAll(query: QuerySlaughterTransferDto, tenantId: string) {
    const T = schema.slaughterTransferOrder;
    const rows = await this.db
      .select({ to: T, farm_code: schema.locationMaster.location_code, farm_name: schema.locationMaster.location_name })
      .from(T)
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, T.farm_id))
      .where(and(eq(T.tenant_id, tenantId), isNull(T.deleted_at), ...(query.status ? [eq(T.status, query.status)] : []), ...this.scope()))
      .orderBy(desc(T.to_date), desc(T.to_no));
    return rows.map((r) => ({ ...r.to, farm_code: r.farm_code, farm_name: r.farm_name }));
  }

  async findOne(id: string, tenantId: string) {
    const T = schema.slaughterTransferOrder;
    const [to] = await this.db.select().from(T).where(and(eq(T.to_id, id), eq(T.tenant_id, tenantId), isNull(T.deleted_at), ...this.scope())).limit(1);
    if (!to) throw new NotFoundException('Transfer Order not found in this workspace.');
    const [farm] = await this.db.select({ code: schema.locationMaster.location_code, name: schema.locationMaster.location_name }).from(schema.locationMaster)
      .where(eq(schema.locationMaster.location_id, to.farm_id)).limit(1);
    const L = schema.slaughterTransferOrderLine;
    const lines = await this.db
      .select({ line: L, batch_no: schema.batchHeader.batch_no })
      .from(L)
      .innerJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, L.batch_id))
      .where(eq(L.to_id, id))
      .orderBy(asc(L.line_no));
    return { ...to, farm_code: farm?.code ?? null, farm_name: farm?.name ?? null, lines: lines.map((r) => ({ ...r.line, batch_no: r.batch_no })) };
  }

  private async nextNo(companyId: string, tenantId: string): Promise<string> {
    const series = await this.numberSeries.resolveSeriesFor(SERIES, null, tenantId, companyId, this.db);
    if (series) return this.numberSeries.generateNext(series, tenantId, companyId, this.db);
    const prefix = `STO-${new Date().getFullYear()}-`;
    const [last] = await this.db
      .select({ no: schema.slaughterTransferOrder.to_no })
      .from(schema.slaughterTransferOrder)
      .where(and(eq(schema.slaughterTransferOrder.tenant_id, tenantId), eq(schema.slaughterTransferOrder.company_id, companyId), sql`${schema.slaughterTransferOrder.to_no} LIKE ${prefix + '%'}`))
      .orderBy(desc(schema.slaughterTransferOrder.to_no))
      .limit(1);
    const seq = last ? Number(last.no.slice(prefix.length)) || 0 : 0;
    return `${prefix}${String(seq + 1).padStart(4, '0')}`;
  }

  /** The medicines and vaccines given to a lot, or to the lots its head came from, with their withdrawal days. */
  private async withdrawalBlocks(batchId: string, asOf: string) {
    const sources = await this.db
      .select({ id: schema.batchTransfer.from_batch_id })
      .from(schema.batchTransfer)
      .where(and(eq(schema.batchTransfer.to_batch_id, batchId), eq(schema.batchTransfer.status, 'POSTED')));
    const ids = [...new Set([batchId, ...sources.map((s) => s.id).filter((x): x is string => !!x)])];
    const T = schema.batchTransaction;
    const rows = await this.db
      .select({
        item_name: schema.itemMaster.item_name,
        item_type: schema.itemMaster.item_type,
        administered_date: T.transaction_date,
        treatment_days: schema.batchTreatmentDetail.withdrawal_days,
        master_days: schema.itemMaster.withdrawal_days,
      })
      .from(T)
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, T.item_id))
      .leftJoin(schema.batchTreatmentDetail, eq(schema.batchTreatmentDetail.transaction_id, T.transaction_id))
      .where(and(inArray(T.batch_id, ids), eq(T.transaction_type, 'CONSUMPTION'), isNull(T.reversed_at)));
    return activeWithdrawals(
      rows.map((r) => ({ item_name: r.item_name, item_type: r.item_type, administered_date: String(r.administered_date).slice(0, 10), withdrawal_days: r.treatment_days ?? r.master_days })),
      asOf,
    );
  }

  private async assertWithdrawalsClear(lines: Array<{ batch_id: string; batch_no: string }>, asOf: string) {
    const problems: string[] = [];
    for (const l of lines) {
      const blocks = await this.withdrawalBlocks(l.batch_id, asOf);
      if (blocks.length) problems.push(`${l.batch_no}: ${blocks.map((b) => `${b.item_name} clears ${b.clear_date}`).join(', ')}`);
    }
    if (problems.length) throw new BadRequestException(`Medicine withdrawal is still active, so these pigs cannot go to slaughter on ${asOf}: ${problems.join('; ')}.`);
  }

  /**
   * The lots a farm can send to slaughter on a date, for the Transfer Order form: its active weaner, grower and finisher lots that hold head, each with its head,
   * carrying value, value per head and any medicine whose withdrawal has not cleared by that date (a lot with one cannot go on the order).
   */
  async eligibleLots(farmId: string, asOf: string, tenantId: string) {
    const scope = farmScope(this.cls);
    if (scope.farmId && scope.farmId !== farmId) throw new BadRequestException('That farm is outside your workspace.');
    const rows = await this.db
      .select({ b: schema.batchHeader, s: schema.batchBioAssetState, lot_no: sql<string | null>`(SELECT il.lot_no FROM batch_input_line il WHERE il.batch_id = ${schema.batchHeader.batch_id} LIMIT 1)` })
      .from(schema.batchHeader)
      .innerJoin(schema.batchBioAssetState, eq(schema.batchBioAssetState.batch_id, schema.batchHeader.batch_id))
      .where(and(
        eq(schema.batchHeader.tenant_id, tenantId), eq(schema.batchHeader.farm_id, farmId), eq(schema.batchHeader.status, 'ACTIVE'),
        eq(schema.batchHeader.costing_method, 'BIO_ASSET'), isNull(schema.batchHeader.deleted_at), sql`${schema.batchBioAssetState.current_quantity} > 0`,
      ))
      .orderBy(asc(schema.batchHeader.batch_no));
    const out = [];
    for (const r of rows.filter((x) => isCurrentBioLot(x.b))) {
      const head = Number(r.s.current_quantity);
      const value = Number(r.s.nca_book_value) || 0;
      out.push({
        batch_id: r.b.batch_id, batch_no: r.b.batch_no, stage: r.b.current_stage_code, lot_no: r.lot_no, location_id: r.b.location_id,
        head, carrying_value: r4(value), value_per_head: head > 0 ? r4(value / head) : 0,
        withdrawals: await this.withdrawalBlocks(r.b.batch_id, asOf),
      });
    }
    return out;
  }

  async create(dto: CreateSlaughterTransferDto, tenantId: string, user?: { userId?: string }) {
    const [farm] = await this.db.select().from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.location_id, dto.farm_id), eq(schema.locationMaster.tenant_id, tenantId))).limit(1);
    if (!farm || farm.location_type !== 'FARM' || !farm.company_id) throw new BadRequestException('Choose the supplying farm.');
    const scope = farmScope(this.cls);
    if (scope.farmId && scope.farmId !== farm.location_id) throw new BadRequestException('That farm is outside your workspace.');
    if (dto.lines.some((l) => (l.category ?? 'COMMERCIAL') !== 'COMMERCIAL')) {
      throw new BadRequestException('A culled breeding animal is converted to inventory first (FA -> Inventory conversion); its Transfer Order line is not built yet. Put commercial pigs only.');
    }

    // Each line's batch: an active head-count lot of this farm, with the head the lines ask for.
    const wanted = new Map<string, number>();
    for (const l of dto.lines) wanted.set(l.batch_id, (wanted.get(l.batch_id) ?? 0) + l.head_count);
    const batchRows = await this.db
      .select({ batch: schema.batchHeader, state: schema.batchBioAssetState, lot_no: sql<string | null>`(SELECT il.lot_no FROM batch_input_line il WHERE il.batch_id = ${schema.batchHeader.batch_id} LIMIT 1)` })
      .from(schema.batchHeader)
      .leftJoin(schema.batchBioAssetState, eq(schema.batchBioAssetState.batch_id, schema.batchHeader.batch_id))
      .where(and(eq(schema.batchHeader.tenant_id, tenantId), inArray(schema.batchHeader.batch_id, [...wanted.keys()])));
    const byId = new Map(batchRows.map((r) => [r.batch.batch_id, r]));
    for (const [batchId, head] of wanted) {
      const r = byId.get(batchId);
      if (!r) throw new BadRequestException('A line names a batch that is not in this workspace.');
      const b = r.batch;
      if (b.status !== 'ACTIVE' || b.costing_method !== 'BIO_ASSET' || !isCurrentBioLot(b)) {
        throw new BadRequestException(`${b.batch_no} is not an active weaner, grower or finisher lot, so it cannot go on a slaughter Transfer Order.`);
      }
      if (b.farm_id !== farm.location_id) throw new BadRequestException(`${b.batch_no} is on another farm: a Transfer Order carries one supplying farm (BBP: a separate TO per farm).`);
      const onHand = Number(r.state?.current_quantity ?? 0);
      if (head > onHand) throw new BadRequestException(`${b.batch_no} holds ${onHand} head; the lines ask for ${head}.`);
    }
    await this.assertWithdrawalsClear([...wanted.keys()].map((id) => ({ batch_id: id, batch_no: byId.get(id)!.batch.batch_no })), dto.to_date);

    return withTenantTransaction(this.cls, async () => {
      const toId = randomUUID();
      const toNo = await this.nextNo(farm.company_id!, tenantId);
      await this.db.insert(schema.slaughterTransferOrder).values({
        to_id: toId, tenant_id: tenantId, company_id: farm.company_id!, to_no: toNo, to_date: dto.to_date, farm_id: farm.location_id,
        destination: dto.destination ?? null, customer_id: dto.customer_id ?? null, ho_approval_ref: dto.ho_approval_ref.trim(), vehicle_no: dto.vehicle_no ?? null,
        driver_name: dto.driver_name ?? null, remarks: dto.remarks ?? null, status: 'DRAFT', created_by: user?.userId ?? null, updated_by: user?.userId ?? null,
      });
      await this.db.insert(schema.slaughterTransferOrderLine).values(dto.lines.map((l, i) => {
        const r = byId.get(l.batch_id)!;
        return {
          line_id: randomUUID(), to_id: toId, line_no: (i + 1) * 10000, batch_id: l.batch_id, source_location_id: l.source_location_id ?? r.batch.location_id ?? null,
          category: 'COMMERCIAL', head_count: l.head_count, avg_live_weight_kg: l.avg_live_weight_kg != null ? String(l.avg_live_weight_kg) : null,
          lot_no: l.lot_no ?? r.lot_no ?? null, slap_mark: slapMark(farm.location_code, r.batch.batch_no),
        };
      }));
      await this.audit.log({ tenantId, companyId: farm.company_id!, userId: user?.userId, action: 'CREATE', entityName: 'slaughter_transfer_order', entityId: toId, newValues: { to_no: toNo, lines: dto.lines.length } });
      return this.findOne(toId, tenantId);
    });
  }

  private async assertMappings(companyId: string, ctx: { nobId?: string | null; lobId?: string | null }, tenantId: string) {
    const missing: string[] = [];
    for (const t of SLAUGHTER_MAPPINGS) if (!(await this.gl.hasMapping(tenantId, companyId, t, ctx))) missing.push(t);
    if (missing.length) throw new BadRequestException(`No GL mapping is set up for ${missing.join(', ')}. Finance switches them on with db-enable-slaughter-gl.`);
  }

  /** Dispatch: the withdrawal check again on the day, then each line's head leave their lot for Inventory in Transit at the lot's carrying value. */
  async confirm(id: string, tenantId: string, user?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const to = await this.findOne(id, tenantId);
      assertSlaughterStatus(to, 'DRAFT');
      const [first] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, to.lines[0].batch_id)).limit(1);
      const ctx = { nobId: first?.nob_id, lobId: first?.lob_id };
      await this.assertMappings(to.company_id, ctx, tenantId);
      await this.assertWithdrawalsClear(to.lines.map((l) => ({ batch_id: l.batch_id, batch_no: l.batch_no })), to.to_date);

      for (const line of to.lines) {
        const [batch] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, line.batch_id)).limit(1);
        const [state] = await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, line.batch_id)).limit(1);
        // Taken out of the lot before the release lowers its value, so the account the value leaves is the one it sat in.
        const lotAccount = await herdCarryingAccount(this.db, this.gl, batch, state?.stage, tenantId);
        const released = await this.batches.releaseHeadToAnimals(
          line.batch_id,
          { quantity: line.head_count, date: to.to_date, reference: to.to_no, remarks: `Slaughter ${to.to_no}, ${line.slap_mark}`, ledger_codes: bioCodes.slaughterDispatch() },
          tenantId,
          user as any,
        );
        if (released.total >= 0.005) {
          await this.gl.postBatchCostEntry({
            tenantId, companyId: to.company_id, transactionType: 'BIO_SLAUGHTER_DISPATCH', amount: released.total, documentNo: to.to_no, documentLineId: line.line_id,
            postingDate: to.to_date, description: `Slaughter dispatch ${to.to_no} ${line.slap_mark}: ${line.head_count} head`, sourceDocumentType: 'SLAUGHTER_TO',
            nobId: batch.nob_id ?? undefined, lobId: batch.lob_id ?? undefined, ...(lotAccount ? { creditAccountId: lotAccount } : {}), userId: user?.userId,
          });
        }
        await this.db.update(schema.slaughterTransferOrderLine).set({ carrying_value: released.total.toFixed(4) }).where(eq(schema.slaughterTransferOrderLine.line_id, line.line_id));
      }
      await this.db.update(schema.slaughterTransferOrder).set({ status: 'CONFIRMED', confirmed_at: now(), confirmed_by: user?.userId ?? null, updated_at: now(), updated_by: user?.userId ?? null })
        .where(eq(schema.slaughterTransferOrder.to_id, id));
      await this.audit.log({ tenantId, companyId: to.company_id, userId: user?.userId, action: 'CONFIRM', entityName: 'slaughter_transfer_order', entityId: id, newValues: { to_no: to.to_no } });
      return this.findOne(id, tenantId);
    });
  }

  /** The POD: each line's DOA; what died on the way is written off from In Transit (BBP: Dr Impairment / Cr In-Transit per line). */
  async pod(id: string, dto: SlaughterPodDto, tenantId: string, user?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const to = await this.findOne(id, tenantId);
      assertSlaughterStatus(to, 'CONFIRMED');
      const byId = new Map(dto.lines.map((l) => [l.line_id, l.doa_head]));
      const given = new Map(to.lines.filter((l) => byId.has(l.line_id)).map((l) => [l.line_no, byId.get(l.line_id)!]));
      const issues = podIssues(to.lines.map((l) => ({ line_no: l.line_no, head_count: l.head_count })), given);
      if (issues.length) throw new BadRequestException(issues.join(' '));
      let shipped = 0, doaTotal = 0;
      for (const line of to.lines) {
        const doa = byId.get(line.line_id)!;
        shipped += line.head_count; doaTotal += doa;
        const split = splitTransitValue(Number(line.carrying_value ?? 0), line.head_count, doa);
        if (split.doa >= 0.005) {
          const [batch] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, line.batch_id)).limit(1);
          await this.gl.postBatchCostEntry({
            tenantId, companyId: to.company_id, transactionType: 'BIO_SLAUGHTER_DOA', amount: split.doa, documentNo: to.to_no, documentLineId: line.line_id,
            postingDate: dto.pod_date, description: `DOA ${to.to_no} ${line.slap_mark}: ${doa} head (posted to ${line.batch_no})`, sourceDocumentType: 'SLAUGHTER_TO',
            nobId: batch?.nob_id ?? undefined, lobId: batch?.lob_id ?? undefined, userId: user?.userId,
          });
        }
        await this.db.update(schema.slaughterTransferOrderLine).set({ doa_head: doa, received_head: line.head_count - doa }).where(eq(schema.slaughterTransferOrderLine.line_id, line.line_id));
      }
      await this.db.update(schema.slaughterTransferOrder).set({ status: 'RECEIVED', pod_date: dto.pod_date, pod_received_by: dto.received_by ?? null, updated_at: now(), updated_by: user?.userId ?? null })
        .where(eq(schema.slaughterTransferOrder.to_id, id));
      await this.audit.log({ tenantId, companyId: to.company_id, userId: user?.userId, action: 'POD', entityName: 'slaughter_transfer_order', entityId: id, newValues: { shipped, doa: doaTotal } });
      return { ...(await this.findOne(id, tenantId)), doa_alert: doaOverThreshold(doaTotal, shipped) };
    });
  }

  /** The kill sheet and invoice: revenue to the supplying farm's cost centre, and the delivered pigs' value out of In Transit to cost of sales. */
  async killSheet(id: string, dto: SlaughterKillSheetDto, tenantId: string, user?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const to = await this.findOne(id, tenantId);
      assertSlaughterStatus(to, 'RECEIVED');
      const byId = new Map(dto.lines.map((l) => [l.line_id, l]));
      const missing = to.lines.filter((l) => !byId.has(l.line_id)).map((l) => l.line_no);
      if (missing.length) throw new BadRequestException(`The kill sheet needs every line: line ${missing.join(', ')} has no carcass weight and price.`);
      let invoice = 0, cost = 0;
      for (const line of to.lines) {
        const k = byId.get(line.line_id)!;
        const delivered = Number(line.received_head ?? 0);
        const inv = invoiceLine(delivered, k.avg_carcass_weight_kg, k.price_per_kg);
        invoice = r4(invoice + inv.amount);
        cost = r4(cost + splitTransitValue(Number(line.carrying_value ?? 0), line.head_count, Number(line.doa_head ?? 0)).delivered);
        await this.db.update(schema.slaughterTransferOrderLine).set({
          carcass_weight_kg: inv.carcass_weight_kg.toFixed(3), price_per_kg: String(k.price_per_kg), line_amount: inv.amount.toFixed(4),
        }).where(eq(schema.slaughterTransferOrderLine.line_id, line.line_id));
      }
      const [first] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, to.lines[0].batch_id)).limit(1);
      const dims = { nobId: first?.nob_id ?? undefined, lobId: first?.lob_id ?? undefined };
      const costCenterId = await this.gl.resolveFarmCostCentre(to.farm_id);
      if (invoice >= 0.005) {
        await this.gl.postBatchCostEntry({
          tenantId, companyId: to.company_id, transactionType: 'BIO_SLAUGHTER_SALE', amount: invoice, documentNo: to.to_no, postingDate: dto.kill_sheet_date,
          description: `Kill sheet ${dto.kill_sheet_ref} ${to.to_no}${dto.invoice_no ? `, invoice ${dto.invoice_no}` : ''}`, sourceDocumentType: 'SLAUGHTER_TO', ...dims, costCenterId, userId: user?.userId,
        });
      }
      if (cost >= 0.005) {
        await this.gl.postBatchCostEntry({
          tenantId, companyId: to.company_id, transactionType: 'BIO_SLAUGHTER_COGS', amount: cost, documentNo: to.to_no, postingDate: dto.kill_sheet_date,
          description: `Cost of the pigs delivered on ${to.to_no}`, sourceDocumentType: 'SLAUGHTER_TO', ...dims, costCenterId, userId: user?.userId,
        });
      }
      await this.db.update(schema.slaughterTransferOrder).set({
        status: 'RECONCILED', kill_sheet_ref: dto.kill_sheet_ref.trim(), kill_sheet_date: dto.kill_sheet_date, invoice_no: dto.invoice_no ?? null, invoice_amount: invoice.toFixed(4),
        updated_at: now(), updated_by: user?.userId ?? null,
      }).where(eq(schema.slaughterTransferOrder.to_id, id));
      await this.audit.log({ tenantId, companyId: to.company_id, userId: user?.userId, action: 'RECONCILE', entityName: 'slaughter_transfer_order', entityId: id, newValues: { invoice, cost } });
      return this.findOne(id, tenantId);
    });
  }

  async close(id: string, tenantId: string, user?: { userId?: string }) {
    const to = await this.findOne(id, tenantId);
    assertSlaughterStatus(to, 'RECONCILED');
    await this.db.update(schema.slaughterTransferOrder).set({ status: 'CLOSED', updated_at: now(), updated_by: user?.userId ?? null }).where(eq(schema.slaughterTransferOrder.to_id, id));
    await this.audit.log({ tenantId, companyId: to.company_id, userId: user?.userId, action: 'CLOSE', entityName: 'slaughter_transfer_order', entityId: id });
    return this.findOne(id, tenantId);
  }

  async cancel(id: string, tenantId: string, user?: { userId?: string }) {
    const to = await this.findOne(id, tenantId);
    assertSlaughterStatus(to, 'DRAFT');
    await this.db.update(schema.slaughterTransferOrder).set({ status: 'CANCELLED', updated_at: now(), updated_by: user?.userId ?? null }).where(eq(schema.slaughterTransferOrder.to_id, id));
    await this.audit.log({ tenantId, companyId: to.company_id, userId: user?.userId, action: 'CANCEL', entityName: 'slaughter_transfer_order', entityId: id });
    return this.findOne(id, tenantId);
  }
}
