import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, desc, eq, inArray, isNotNull, isNull, like, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { withTenantTransaction } from '../../../common/tenant-transaction';
import { farmScope, batchScopeConditions } from '../../../common/farm-scope';
import { BatchService } from '../../production/batch/batch.service';
import { AnimalService } from '../animal/animal.service';
import { LitterCostService } from '../litter-cost/litter-cost.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { CreateGiltSelectionDto, CreateGiltsDto } from './dto/gilt-selection.dto';
import { bufferProblem, nextSelectionNo, weekOfYear, MIN_GILT_TEATS } from './gilt-selection.rules';

export interface Litter {
  farrow_id: string;
  piglet_item_id: string | null;
  source_batch_id: string | null;
  lot_no: string | null;
  sow_animal_id: string;
  sow_code: string;
  sow_tsi: string | null;
  parity_number: number | null;
  boar_animal_id: string | null;
  boar_code: string | null;
  farrowing_date: string;
  avg_birth_weight_kg: string | null;
  avg_weaning_weight_kg: string | null;
  piglets_produced: number;
  piglets_weaned: number;
  already_selected: number;
  available: number;
  cost_per_piglet: string | null;
  /** What one gilt of this litter carries: the sow's cost per piglet (BBP), not a batch average. */
  cost_per_pig: number;
  /** The litter's age in weeks on the date asked, and the day it reaches week 4 (BBP: the gilt selection opens then). */
  age_weeks: number;
  week4_date: string;
  weaned: boolean;
  /** The head the litter's own lot holds now while the piglets are still on the sow; null once they have been weaned. */
  piglets_in_lot: number | null;
}

/**
 * Gilt selection (TDD row 6, event 2). The operator picks gilts out of the piglets of a batch: "Get produced piglets" lists the litters whose
 * piglets are in it, a selection says how many gilts come from each, and "Create gilts" takes each gilt's RFID and teat count and, in one
 * transaction, reduces the batch's head, registers every gilt in the animal register with her lineage and the cost she carries, and posts the
 * selection. The BBP's teat rule (15 or more) is a hard block. No journal is raised (D8 is Finance's): the value moves between ledgers.
 */
@Injectable()
export class GiltSelectionService {
  constructor(
    private readonly cls: ClsService,
    private readonly batchService: BatchService,
    private readonly animals: AnimalService,
    private readonly auditService: AuditLogService,
    private readonly litterCost: LitterCostService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private async scopedBatch(batchId: string, tenantId: string) {
    const [batch] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.batch_id, batchId), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!batch) throw new NotFoundException(`Batch with ID '${batchId}' not found.`);
    return batch;
  }

  /** What a batch holds now: its head and carrying value, and the value of one head. */
  private async holding(batchId: string): Promise<{ head: number; value: number; per_head: number }> {
    const [state] = await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, batchId)).limit(1);
    const head = state ? Number(state.current_quantity) || 0 : 0;
    const value = state ? Number(state.nca_book_value) || 0 : 0;
    return { head, value, per_head: head > 0 ? Math.round((value / head) * 1e4) / 1e4 : 0 };
  }

  /**
   * Where a litter's piglets are now, so the Breeding page can open gilt selection straight from a weaned litter (BBP: the selection
   * screen opens at week 4, which is weaning): its own lot while that holds piglets, else the batch they were weaned into.
   */
  async batchOfLitter(farrowId: string, tenantId: string): Promise<{ batch_id: string; batch_no: string } | null> {
    const [farrow] = await this.db
      .select({ lot: schema.farrowingRecord.piglet_batch_id })
      .from(schema.farrowingRecord)
      .where(and(eq(schema.farrowingRecord.farrow_id, farrowId), eq(schema.farrowingRecord.tenant_id, tenantId)))
      .limit(1);
    if (!farrow) throw new NotFoundException(`Farrowing record '${farrowId}' not found.`);
    if (!farrow.lot) return null;
    const holding = async (batchId: string) => {
      const [b] = await this.db
        .select({ batch_id: schema.batchHeader.batch_id, batch_no: schema.batchHeader.batch_no, status: schema.batchHeader.status })
        .from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.batch_id, batchId), ...batchScopeConditions(farmScope(this.cls))))
        .limit(1);
      if (!b || b.status !== 'ACTIVE') return null;
      return (await this.holding(batchId)).head > 0 ? { batch_id: b.batch_id, batch_no: b.batch_no } : null;
    };
    const own = await holding(farrow.lot);
    if (own) return own;
    const moved = await this.db
      .select({ to: schema.batchTransfer.to_batch_id })
      .from(schema.batchTransfer)
      .where(and(eq(schema.batchTransfer.from_batch_id, farrow.lot), eq(schema.batchTransfer.reason, 'WEANING'), eq(schema.batchTransfer.status, 'POSTED')))
      .orderBy(desc(schema.batchTransfer.transfer_date));
    for (const m of moved) {
      const found = await holding(m.to);
      if (found) return found;
    }
    return null;
  }

  /**
   * What one gilt of a litter carries, per sow (BBP: the piglets' cost comes from the sow's accumulated cost, "Cost per Piglet = Total Cost / Piglets", and the
   * selected gilts' acquisition value is that piglet cost). Before the weaning the lot is this litter alone, so its value, with what the sow has still to hand it
   * (`pending`), over the head it holds. After it, the litter's own cost per piglet fixed at the weaning when its piglets sit in a batch mixed with others; the
   * batch average only when the litter is alone in its lot.
   */
  private async costPerPigOf(
    farrow: typeof schema.farrowingRecord.$inferSelect,
    sow: typeof schema.animalRegister.$inferSelect | undefined,
    holdingBatchId: string,
    asOf: string,
    tenantId: string,
  ): Promise<{ per_pig: number; own?: number }> {
    const holding = await this.holding(holdingBatchId);
    const weaned = Number(farrow.piglets_weaned) || 0;
    if (weaned === 0 && farrow.piglet_batch_id === holdingBatchId && sow && holding.head > 0) {
      const pending = await this.litterCost.pending(farrow, sow, asOf, tenantId);
      return { per_pig: Math.round(((holding.value + pending) / holding.head) * 1e4) / 1e4 };
    }
    if (weaned > 0 && farrow.piglet_batch_id !== holdingBatchId) {
      // In a batch with other litters: this litter's own cost per piglet; none recorded means the sow handed it none, never the batch's average.
      const own = Number(farrow.cost_per_piglet ?? 0) || 0;
      return { per_pig: own, own };
    }
    return { per_pig: holding.per_head };
  }

  /** Before a gilt of an unweaned litter is registered, the sow's cost to that day is moved into the lot so it carries it; returns the value per head to release at, if the litter's own. */
  private async settleCost(farrowId: string, holdingBatchId: string, asOf: string, tenantId: string, userPayload?: { userId?: string }): Promise<number | undefined> {
    const [farrow] = await this.db.select().from(schema.farrowingRecord).where(eq(schema.farrowingRecord.farrow_id, farrowId)).limit(1);
    if (!farrow) return undefined;
    const [sow] = await this.db.select().from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, farrow.sow_animal_id)).limit(1);
    if (!sow) return undefined;
    if ((Number(farrow.piglets_weaned) || 0) === 0 && farrow.piglet_batch_id === holdingBatchId) {
      const head = (await this.holding(holdingBatchId)).head;
      await this.litterCost.allocate(farrow, sow, { asOf, divisor: head }, tenantId, userPayload);
      return undefined;
    }
    return (await this.costPerPigOf(farrow, sow, holdingBatchId, asOf, tenantId)).own;
  }

  /** "Get Produced Piglets": the litters whose piglets are in this batch, with what is left to select from each. */
  async getProducedPiglets(batchId: string, tenantId: string, asOf: string = new Date().toISOString().slice(0, 10)) {
    const batch = await this.scopedBatch(batchId, tenantId);
    if (batch.costing_method !== 'BIO_ASSET') throw new BadRequestException(`Batch ${batch.batch_no} is not a bio-asset batch, so it holds no piglets to select from.`);
    if (batch.tracking_mode === 'ANIMAL_WISE') throw new BadRequestException(`Batch ${batch.batch_no} already holds registered animals; gilts are selected from a batch of piglets counted by head.`);
    const holding = await this.holding(batchId);

    // The litter's own lot, and the lots whose weaned piglets were moved into this batch.
    const moved = await this.db
      .select({ from: schema.batchTransfer.from_batch_id })
      .from(schema.batchTransfer)
      .where(and(eq(schema.batchTransfer.to_batch_id, batchId), eq(schema.batchTransfer.reason, 'WEANING'), eq(schema.batchTransfer.status, 'POSTED')));
    const lotIds = [...new Set([batchId, ...moved.map((m) => m.from)])];

    const farrows = await this.db
      .select()
      .from(schema.farrowingRecord)
      .where(and(eq(schema.farrowingRecord.tenant_id, tenantId), inArray(schema.farrowingRecord.piglet_batch_id, lotIds)))
      .orderBy(schema.farrowingRecord.farrowing_date);
    const litters: Litter[] = [];
    for (const f of farrows) {
      const [sow] = await this.db.select().from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, f.sow_animal_id)).limit(1);
      const [mating] = f.breeding_id
        ? await this.db.select({ boar: schema.breedingRecord.boar_animal_id }).from(schema.breedingRecord).where(eq(schema.breedingRecord.breeding_id, f.breeding_id)).limit(1)
        : [];
      const [boar] = mating?.boar
        ? await this.db.select({ code: schema.animalRegister.animal_code }).from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, mating.boar)).limit(1)
        : [];
      const [lotItem] = f.piglet_batch_id
        ? await this.db
            .select({ item_id: schema.bioAssetLedger.bio_asset_item_id })
            .from(schema.bioAssetLedger)
            .where(and(eq(schema.bioAssetLedger.batch_id, f.piglet_batch_id), eq(schema.bioAssetLedger.entry_type, 'ACQUISITION')))
            .limit(1)
        : [];
      const [taken] = await this.db
        .select({ n: sql<string>`COUNT(*)` })
        .from(schema.giltSelectionGilt)
        .innerJoin(schema.giltSelectionLine, eq(schema.giltSelectionLine.line_id, schema.giltSelectionGilt.line_id))
        .where(and(eq(schema.giltSelectionLine.farrow_id, f.farrow_id), isNotNull(schema.giltSelectionGilt.animal_id)));
      const produced = Number(f.piglets_born_live) || 0;
      const weaned = Number(f.piglets_weaned) || 0;
      const already = Number(taken?.n ?? 0);
      litters.push({
        farrow_id: f.farrow_id, piglet_item_id: lotItem?.item_id ?? null, source_batch_id: f.piglet_batch_id, lot_no: f.piglet_lot_no,
        sow_animal_id: f.sow_animal_id, sow_code: sow?.animal_code ?? '', sow_tsi: sow?.tsi ?? null, parity_number: f.parity_number,
        boar_animal_id: mating?.boar ?? null, boar_code: boar?.code ?? null, farrowing_date: String(f.farrowing_date).slice(0, 10),
        avg_birth_weight_kg: f.avg_birth_weight_kg ?? null, avg_weaning_weight_kg: f.avg_weaning_weight_kg ?? null,
        piglets_produced: produced, piglets_weaned: weaned, already_selected: already,
        available: Math.max(0, (weaned > 0 ? weaned : produced) - already), cost_per_piglet: f.cost_per_piglet ?? null,
        cost_per_pig: (await this.costPerPigOf(f, sow, batchId, asOf, tenantId)).per_pig,
        age_weeks: Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${String(f.farrowing_date).slice(0, 10)}T00:00:00Z`)) / (7 * 86_400_000)),
        week4_date: new Date(Date.parse(`${String(f.farrowing_date).slice(0, 10)}T00:00:00Z`) + 28 * 86_400_000).toISOString().slice(0, 10), weaned: weaned > 0,
        piglets_in_lot: weaned === 0 && f.piglet_batch_id === batchId ? holding.head : null,
      });
    }
    return {
      batch_id: batchId, batch_no: batch.batch_no, farm_id: batch.farm_id, head: holding.head,
      carrying_value: holding.value, value_per_head: holding.per_head, min_teats: MIN_GILT_TEATS, litters,
    };
  }

  /** Saves a selection as a DRAFT: the header and a line per litter. Nothing moves until the gilts are created. */
  /**
   * BBP: the gilts of a litter are selected once, at week 4 (before or at the weaning). A litter that has been weaned, or that already has a
   * selection (a draft counts; a cancelled one does not), is closed to a new one.
   */
  async assertLitterOpen(farrowIds: string[]) {
    for (const farrowId of farrowIds) {
      const [farrow] = await this.db
        .select({ weaned: schema.farrowingRecord.piglets_weaned })
        .from(schema.farrowingRecord)
        .where(eq(schema.farrowingRecord.farrow_id, farrowId))
        .limit(1);
      if (Number(farrow?.weaned ?? 0) > 0) {
        throw new BadRequestException('This litter has already been weaned. Gilts are selected once, after week 4 and before or at the weaning, so no more can be selected from it.');
      }
      const [earlier] = await this.db
        .select({ no: schema.giltSelection.selection_no })
        .from(schema.giltSelectionLine)
        .innerJoin(schema.giltSelection, eq(schema.giltSelection.selection_id, schema.giltSelectionLine.selection_id))
        .where(and(eq(schema.giltSelectionLine.farrow_id, farrowId), ne(schema.giltSelection.status, 'CANCELLED')))
        .limit(1);
      if (earlier) {
        throw new BadRequestException(`Gilts were already selected from this litter (${earlier.no}). Gilts are selected once per litter; cancel that draft first if it was a mistake.`);
      }
    }
  }

  async create(dto: CreateGiltSelectionDto, tenantId: string, userPayload?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      await this.assertLitterOpen(dto.lines.map((l) => l.farrow_id));
      const piglets = await this.getProducedPiglets(dto.batch_id, tenantId);
      const batch = await this.scopedBatch(dto.batch_id, tenantId);
      if (batch.status !== 'ACTIVE') throw new BadRequestException(`Batch ${batch.batch_no} is ${batch.status}; gilts are selected from an active batch.`);
      const farrowIds = dto.lines.map((l) => l.farrow_id);
      if (new Set(farrowIds).size !== farrowIds.length) throw new BadRequestException('A litter appears on more than one line.');
      const total = dto.lines.reduce((n, l) => n + l.gilts_selected, 0);
      if (total > piglets.head + 1e-9) throw new BadRequestException(`Batch ${batch.batch_no} holds ${piglets.head} piglets; ${total} gilts cannot be selected from it.`);
      for (const l of dto.lines) {
        const litter = piglets.litters.find((x) => x.farrow_id === l.farrow_id);
        if (!litter) throw new BadRequestException(`That litter's piglets are not in batch ${batch.batch_no}.`);
        if (l.gilts_selected > litter.available) {
          throw new BadRequestException(`Only ${litter.available} piglets of ${litter.sow_code}'s litter ${litter.lot_no ?? ''} are left to select from; ${l.gilts_selected} were asked for.`);
        }
      }
      const year = dto.selection_date.slice(0, 4);
      const [last] = await this.db
        .select({ no: schema.giltSelection.selection_no })
        .from(schema.giltSelection)
        .where(and(eq(schema.giltSelection.company_id, batch.company_id), like(schema.giltSelection.selection_no, `GS-${year}-%`)))
        .orderBy(desc(schema.giltSelection.selection_no))
        .limit(1);
      const selectionId = randomUUID();
      const selectionNo = nextSelectionNo(year, last?.no);
      await this.db.insert(schema.giltSelection).values({
        selection_id: selectionId, tenant_id: tenantId, company_id: batch.company_id, selection_no: selectionNo, batch_id: batch.batch_id, batch_no: batch.batch_no,
        farm_id: batch.farm_id ?? null, location_id: dto.location_id ?? null, sub_location_id: dto.sub_location_id ?? null, selection_date: dto.selection_date,
        production_week: dto.production_week ?? weekOfYear(dto.selection_date), gilt_item_id: dto.gilt_item_id ?? null, animal_batch_id: dto.animal_batch_id ?? null,
        status: 'DRAFT', remarks: dto.remarks ?? null, created_by: userPayload?.userId ?? null,
      });
      let lineNo = 0;
      for (const l of dto.lines) {
        const litter = piglets.litters.find((x) => x.farrow_id === l.farrow_id)!;
        await this.db.insert(schema.giltSelectionLine).values({
          line_id: randomUUID(), selection_id: selectionId, line_no: ++lineNo, farrow_id: l.farrow_id, piglet_item_id: litter.piglet_item_id, source_batch_id: litter.source_batch_id,
          lot_no: litter.lot_no, sow_animal_id: litter.sow_animal_id, parity_number: litter.parity_number, boar_animal_id: litter.boar_animal_id,
          colour_code: l.colour_code ?? null, piglets_produced: litter.piglets_produced, sow_tsi: litter.sow_tsi, gilts_selected: l.gilts_selected,
        });
      }
      await this.auditService.log({ tenantId, companyId: batch.company_id, userId: userPayload?.userId, action: 'CREATE', entityName: 'gilt_selection', entityId: selectionId, newValues: { selection_no: selectionNo, batch_id: batch.batch_id, gilts: total } });
      return this.findOne(selectionId, tenantId);
    });
  }

  async findAll(tenantId: string) {
    const headers = await this.db
      .select()
      .from(schema.giltSelection)
      .where(and(eq(schema.giltSelection.tenant_id, tenantId), ...this.batchScope()))
      .orderBy(desc(schema.giltSelection.created_at));
    if (!headers.length) return [];
    const lines = await this.db.select().from(schema.giltSelectionLine).where(inArray(schema.giltSelectionLine.selection_id, headers.map((h) => h.selection_id))).orderBy(schema.giltSelectionLine.line_no);
    const codes = await this.codesOf(lines.flatMap((l) => [l.sow_animal_id, l.boar_animal_id]));
    return headers.map((h) => ({
      ...h,
      lines: lines.filter((l) => l.selection_id === h.selection_id).map((l) => ({ ...l, sow_code: codes.get(l.sow_animal_id) ?? null, boar_code: l.boar_animal_id ? codes.get(l.boar_animal_id) ?? null : null })),
    }));
  }

  /** Animal codes by id, for showing parents. */
  private async codesOf(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const rows = await this.db.select({ id: schema.animalRegister.animal_id, code: schema.animalRegister.animal_code }).from(schema.animalRegister).where(inArray(schema.animalRegister.animal_id, unique));
    return new Map(rows.map((r) => [r.id, r.code]));
  }

  private batchScope() {
    const scope = farmScope(this.cls);
    return scope.farmId ? [eq(schema.giltSelection.farm_id, scope.farmId)] : [];
  }

  async findOne(selectionId: string, tenantId: string) {
    const [header] = await this.db
      .select()
      .from(schema.giltSelection)
      .where(and(eq(schema.giltSelection.selection_id, selectionId), eq(schema.giltSelection.tenant_id, tenantId), ...this.batchScope()))
      .limit(1);
    if (!header) throw new NotFoundException(`Gilt selection '${selectionId}' not found.`);
    const lineRows = await this.db.select().from(schema.giltSelectionLine).where(eq(schema.giltSelectionLine.selection_id, selectionId)).orderBy(schema.giltSelectionLine.line_no);
    const giltRows = await this.db.select().from(schema.giltSelectionGilt).where(eq(schema.giltSelectionGilt.selection_id, selectionId));
    const codes = await this.codesOf(lineRows.flatMap((l) => [l.sow_animal_id, l.boar_animal_id]));
    const lines = lineRows.map((l) => ({ ...l, sow_code: codes.get(l.sow_animal_id) ?? null, boar_code: l.boar_animal_id ? codes.get(l.boar_animal_id) ?? null : null }));
    // Each gilt with her parents, so the screen can show her as a card.
    const gilts = giltRows.map((g) => {
      const line = lines.find((l) => l.line_id === g.line_id);
      return {
        ...g, dam_animal_id: line?.sow_animal_id ?? null, dam_code: line?.sow_code ?? null, dam_tsi: line?.sow_tsi ?? null, dam_parity: line?.parity_number ?? null,
        sire_animal_id: line?.boar_animal_id ?? null, sire_code: line?.boar_code ?? null, lot_no: line?.lot_no ?? null, colour_code: line?.colour_code ?? null,
      };
    });
    return { ...header, lines, gilts };
  }

  /**
   * Gilts picked at the weaning itself (BBP: gilt selection opens at week 4, which is weaning): the weaning form carries the gilts' RFID and teat counts and the
   * litter's weaning and its gilt selection are one event. Saves the draft and posts it in the caller's transaction, from the litter's own lot, before the rest are moved on.
   */
  async selectAtWeaning(
    farrow: { farrow_id: string; piglet_batch_id: string | null },
    gilts: Array<{ rfid_tag: string; no_of_teats: number; dob?: string }>,
    opts: { date: string; colour_code?: string; gilt_item_id?: string; animal_batch_id?: string },
    tenantId: string,
    userPayload?: { userId?: string },
  ) {
    if (!farrow.piglet_batch_id) throw new BadRequestException('This litter has no piglet lot to select gilts from.');
    const draft = await this.create(
      {
        batch_id: farrow.piglet_batch_id, selection_date: opts.date, gilt_item_id: opts.gilt_item_id, animal_batch_id: opts.animal_batch_id,
        lines: [{ farrow_id: farrow.farrow_id, gilts_selected: gilts.length, ...(opts.colour_code ? { colour_code: opts.colour_code } : {}) }],
      } as any,
      tenantId,
      userPayload,
    );
    const lineId = draft.lines[0].line_id;
    return this.createGilts(draft.selection_id, { gilts: gilts.map((g) => ({ line_id: lineId, rfid_tag: g.rfid_tag, no_of_teats: g.no_of_teats, ...(g.dob ? { dob: g.dob } : {}) })) } as any, tenantId, userPayload);
  }

  async cancel(selectionId: string, tenantId: string, userPayload?: { userId?: string }) {
    const selection = await this.findOne(selectionId, tenantId);
    if (selection.status !== 'DRAFT') throw new BadRequestException(`Selection ${selection.selection_no} is ${selection.status}; only a draft can be cancelled.`);
    if (selection.gilts.length) throw new BadRequestException(`Selection ${selection.selection_no} already has ${selection.gilts.length} gilt(s) registered, so it cannot be cancelled.`);
    await this.db.update(schema.giltSelection).set({ status: 'CANCELLED' }).where(eq(schema.giltSelection.selection_id, selectionId));
    await this.auditService.log({ tenantId, companyId: selection.company_id, userId: userPayload?.userId, action: 'UPDATE', entityName: 'gilt_selection', entityId: selectionId, newValues: { status: 'CANCELLED' } });
    return this.findOne(selectionId, tenantId);
  }

  /** The stage gilts are registered in when they join an animal-wise batch: Gilt Rearing (BBP, week 4 to 34), else the batch's own. */
  private async giltStageId(batch: { stage_id: string | null; company_id: string; nob_id: string | null; lob_id: string | null }, tenantId: string): Promise<string | null> {
    const [stage] = await this.db
      .select({ stage_id: schema.stageMaster.stage_id })
      .from(schema.stageMaster)
      .where(and(
        eq(schema.stageMaster.tenant_id, tenantId), eq(schema.stageMaster.company_id, batch.company_id),
        ...(batch.nob_id ? [eq(schema.stageMaster.nob_id, batch.nob_id)] : []), ...(batch.lob_id ? [eq(schema.stageMaster.lob_id, batch.lob_id)] : []),
        eq(schema.stageMaster.stage_code, 'GILT_REARING'), eq(schema.stageMaster.is_active, true), isNull(schema.stageMaster.deleted_at),
      ))
      .limit(1);
    return stage?.stage_id ?? batch.stage_id ?? null;
  }

  /**
   * Where new gilts stand: the animal-wise batch named (at Gilt Rearing), else the location on the selection, else where the piglets were, else where their litter's
   * lot or their dam stands (a batch the weaned piglets were moved into may have no location of its own).
   */
  private async placementOf(selection: { animal_batch_id: string | null; location_id: string | null; batch_id: string }, tenantId: string, line?: { source_batch_id?: string | null; sow_animal_id?: string | null }) {
    if (selection.animal_batch_id) {
      const target = await this.scopedBatch(selection.animal_batch_id, tenantId);
      if (target.tracking_mode !== 'ANIMAL_WISE') throw new BadRequestException(`Batch ${target.batch_no} is not an animal-wise batch, so gilts cannot be registered into it.`);
      const stageId = await this.giltStageId(target, tenantId);
      if (!stageId) throw new BadRequestException(`Batch ${target.batch_no} has no stage to register the gilts in, and no Gilt Rearing stage is set up for it.`);
      return { current_batch_id: target.batch_id, current_stage_id: stageId };
    }
    const source = await this.scopedBatch(selection.batch_id, tenantId);
    let locationId: string | null | undefined = selection.location_id ?? source.location_id;
    if (!locationId && line?.source_batch_id && line.source_batch_id !== selection.batch_id) {
      const [lot] = await this.db.select({ location_id: schema.batchHeader.location_id }).from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, line.source_batch_id)).limit(1);
      locationId = lot?.location_id;
    }
    if (!locationId && line?.sow_animal_id) {
      const [sow] = await this.db.select({ location_id: schema.animalRegister.current_location_id }).from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, line.sow_animal_id)).limit(1);
      locationId = sow?.location_id;
    }
    return locationId ? { current_location_id: locationId } : {};
  }

  /** What the full animal register form opens with for one gilt of a line: everything the selection already knows, her cost per head included. */
  async prefillGilt(selectionId: string, lineId: string, tenantId: string) {
    const selection = await this.findOne(selectionId, tenantId);
    const line = selection.lines.find((l) => l.line_id === lineId);
    if (!line) throw new NotFoundException(`Line '${lineId}' is not on selection ${selection.selection_no}.`);
    const [sow] = await this.db.select().from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, line.sow_animal_id)).limit(1);
    const [farrow] = await this.db.select().from(schema.farrowingRecord).where(eq(schema.farrowingRecord.farrow_id, line.farrow_id)).limit(1);
    const source = await this.scopedBatch(selection.batch_id, tenantId);
    const placement = await this.placementOf(selection, tenantId, line);
    const cost = farrow ? await this.costPerPigOf(farrow, sow, selection.batch_id, String(selection.selection_date).slice(0, 10), tenantId) : { per_pig: (await this.holding(selection.batch_id)).per_head };
    // The form asks for a stage whether or not she joins a batch; Gilt Rearing is the one a gilt is in.
    const stageId = placement.current_stage_id ?? (await this.giltStageId({ stage_id: null, company_id: source.company_id, nob_id: source.nob_id ?? null, lob_id: source.lob_id ?? null }, tenantId));
    const registered = selection.gilts.filter((g) => g.line_id === lineId).length;
    return {
      remaining: line.gilts_selected - registered,
      values: {
        nob_id: source.nob_id, lob_id: source.lob_id, animal_type: 'GILT', gender: 'F', breed_id: sow?.breed_id ?? '', dob: farrow ? String(farrow.farrowing_date).slice(0, 10) : '',
        entry_type: 'BORN_ON_FARM', entry_date: String(selection.selection_date).slice(0, 10), item_id: selection.gilt_item_id ?? line.piglet_item_id ?? '',
        source_batch_id: line.source_batch_id ?? selection.batch_id, acquisition_cost: cost.per_pig, sire_animal_id: line.boar_animal_id ?? '', dam_animal_id: line.sow_animal_id,
        current_stage_id: stageId ?? '', ...(placement.current_batch_id ? { current_batch_id: placement.current_batch_id } : {}), ...(placement.current_location_id ? { current_location_id: placement.current_location_id } : {}),
        notes: `Selected ${selection.selection_no} from ${sow?.animal_code ?? ''}'s litter ${line.lot_no ?? ''}`.trim(),
      },
    };
  }

  private async afterRegistration(selection: Awaited<ReturnType<GiltSelectionService['findOne']>>, added: { head: number; value: number }, selectionId: string, userId?: string) {
    const planned = selection.lines.reduce((n, l) => n + l.gilts_selected, 0);
    const done = selection.gilts.length + added.head;
    const complete = done >= planned;
    await this.db
      .update(schema.giltSelection)
      .set({
        head_released: String(Number(selection.head_released ?? 0) + added.head),
        value_released: (Number(selection.value_released ?? 0) + added.value).toFixed(4),
        ...(complete ? { status: 'POSTED', posted_at: sql`CURRENT_TIMESTAMP`, posted_by: userId ?? null } : {}),
      })
      .where(eq(schema.giltSelection.selection_id, selectionId));
    return complete;
  }

  /**
   * One gilt, registered through the full animal register form (opened pre-filled from `prefillGilt`): everything the operator filled in is kept (RFID, teats,
   * TSI, grading, pen, notes ...), while what the selection decides is not left to the form: she is a born-on-farm gilt of this litter's sow and sire, and carries the
   * batch's value per head, which the batch loses. The selection is posted when its last gilt is registered.
   */
  async registerGilt(selectionId: string, lineId: string, dto: Record<string, any>, tenantId: string, userPayload?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const selection = await this.findOne(selectionId, tenantId);
      if (selection.status !== 'DRAFT') throw new BadRequestException(`Selection ${selection.selection_no} is ${selection.status}; gilts are registered from a draft.`);
      const line = selection.lines.find((l) => l.line_id === lineId);
      if (!line) throw new NotFoundException(`Line '${lineId}' is not on selection ${selection.selection_no}.`);
      const registered = selection.gilts.filter((g) => g.line_id === lineId).length;
      if (registered >= line.gilts_selected) throw new BadRequestException(`All ${line.gilts_selected} gilts of this line are already registered.`);
      const teats = Number(dto.no_of_teats);
      if (!(teats >= MIN_GILT_TEATS)) {
        throw new BadRequestException(`Gilt ${dto.rfid_tag ?? ''} has ${Number.isFinite(teats) ? teats : 'no'} teats; a gilt needs at least ${MIN_GILT_TEATS} to be selected, whatever her TSI score.`.replace('Gilt  has', 'The gilt has'));
      }
      const rfid = String(dto.rfid_tag ?? '').trim();
      if (!rfid) throw new BadRequestException('Every gilt needs an RFID tag.');

      const piglets = await this.getProducedPiglets(selection.batch_id, tenantId);
      const litter = piglets.litters.find((x) => x.farrow_id === line.farrow_id);
      if (!litter || litter.available < 1) throw new BadRequestException(`No piglets of this litter are left to select from.`);

      // The sow's cost to this day goes into the lot first (before a weaning), then one head leaves at the litter's cost per piglet.
      const ownCost = await this.settleCost(line.farrow_id, selection.batch_id, String(selection.selection_date).slice(0, 10), tenantId, userPayload);
      const released = await this.batchService.releaseHeadToAnimals(
        selection.batch_id,
        { quantity: 1, date: String(selection.selection_date).slice(0, 10), reference: selection.selection_no, remarks: `Gilt selection ${selection.selection_no}`, ...(ownCost !== undefined ? { value_per_head: ownCost } : {}) },
        tenantId,
        userPayload,
      );
      const placement = dto.current_batch_id || dto.current_location_id ? {} : await this.placementOf(selection, tenantId, line);
      const [farrow] = await this.db.select({ d: schema.farrowingRecord.farrowing_date }).from(schema.farrowingRecord).where(eq(schema.farrowingRecord.farrow_id, line.farrow_id)).limit(1);
      const animal: any = await this.animals.create(
        {
          ...dto,
          ...placement,
          company_id: selection.company_id,
          animal_type: 'GILT',
          gender: 'F',
          entry_type: 'BORN_ON_FARM',
          entry_date: dto.entry_date ?? String(selection.selection_date).slice(0, 10),
          dob: dto.dob ?? (farrow ? String(farrow.d).slice(0, 10) : undefined),
          item_id: dto.item_id ?? selection.gilt_item_id ?? line.piglet_item_id,
          source_batch_id: line.source_batch_id ?? selection.batch_id,
          dam_animal_id: line.sow_animal_id,
          sire_animal_id: line.boar_animal_id ?? dto.sire_animal_id,
          acquisition_cost: released.per_head,
          rfid_tag: rfid,
        } as any,
        tenantId,
        userPayload,
      );
      const giltId = randomUUID();
      await this.db.insert(schema.giltSelectionGilt).values({
        gilt_id: giltId, selection_id: selectionId, line_id: lineId, rfid_tag: rfid, dob: animal.dob ?? dto.dob ?? null,
        batch_week: selection.production_week ?? null, no_of_teats: teats, animal_id: animal.animal_id, animal_code: animal.animal_code, acquisition_cost: released.per_head.toFixed(4),
      });
      const complete = await this.afterRegistration(selection, { head: 1, value: released.total }, selectionId, userPayload?.userId);
      await this.auditService.log({ tenantId, companyId: selection.company_id, userId: userPayload?.userId, action: 'UPDATE', entityName: 'gilt_selection', entityId: selectionId, newValues: { registered: animal.animal_code, complete } });
      return { ...animal, selection_complete: complete, selection_id: selectionId };
    });
  }

  /**
   * "Create Gilts": the quick path for the gilts of a selection not yet registered one by one: validates the buffer (a row for each gilt still to register), takes the head
   * out of the batch, registers each gilt and posts the selection, all or nothing. Each gilt is born on farm (her source batch the litter's lot), her dam the sow and her sire
   * the boar of the mating; the cost she carries is the batch's value per head, which the batch loses, so the value only moves.
   */
  async createGilts(selectionId: string, dto: CreateGiltsDto, tenantId: string, userPayload?: { userId?: string }) {
    return withTenantTransaction(this.cls, async () => {
      const selection = await this.findOne(selectionId, tenantId);
      if (selection.status !== 'DRAFT') throw new BadRequestException(`Selection ${selection.selection_no} is ${selection.status}; gilts are created from a draft.`);

      const labelOf = (l: (typeof selection.lines)[number]) => `Line ${l.line_no} (litter ${l.lot_no ?? l.farrow_id})`;
      const remainingOf = (l: (typeof selection.lines)[number]) => l.gilts_selected - selection.gilts.filter((g) => g.line_id === l.line_id).length;
      const problem = bufferProblem(
        selection.lines.map((l) => ({ line_id: l.line_id, gilts_selected: remainingOf(l), label: labelOf(l) })),
        dto.gilts,
        (tag) => tag.trim().toUpperCase(),
      );
      if (problem) throw new BadRequestException(problem);
      for (const g of dto.gilts) {
        const tag = g.rfid_tag.trim();
        const [taken] = await this.db.select({ code: schema.animalRegister.animal_code }).from(schema.animalRegister)
          .where(and(eq(schema.animalRegister.tenant_id, tenantId), eq(schema.animalRegister.rfid_tag, tag))).limit(1);
        if (taken) throw new BadRequestException(`RFID ${tag} is already on animal ${taken.code}.`);
      }

      // The piglets still there to be selected, re-checked inside the transaction.
      const piglets = await this.getProducedPiglets(selection.batch_id, tenantId);
      for (const l of selection.lines) {
        const litter = piglets.litters.find((x) => x.farrow_id === l.farrow_id);
        if (remainingOf(l) > 0 && (!litter || remainingOf(l) > litter.available)) throw new BadRequestException(`${labelOf(l)} no longer has ${remainingOf(l)} piglets left to select from.`);
      }

      const total = dto.gilts.length;
      // Each litter's gilts leave at that litter's own cost per piglet (the sow's), one release per litter.
      const releasedByLine = new Map<string, { per_head: number; total: number }>();
      let value = 0;
      for (const l of selection.lines) {
        const n = dto.gilts.filter((g) => g.line_id === l.line_id).length;
        if (!n) continue;
        const ownCost = await this.settleCost(l.farrow_id, selection.batch_id, String(selection.selection_date).slice(0, 10), tenantId, userPayload);
        const r = await this.batchService.releaseHeadToAnimals(
          selection.batch_id,
          { quantity: n, date: String(selection.selection_date).slice(0, 10), reference: selection.selection_no, remarks: `Gilt selection ${selection.selection_no}`, ...(ownCost !== undefined ? { value_per_head: ownCost } : {}) },
          tenantId,
          userPayload,
        );
        releasedByLine.set(l.line_id, r);
        value += r.total;
      }
      const placementByLine = new Map<string, Awaited<ReturnType<GiltSelectionService['placementOf']>>>();

      const created: Array<{ gilt_id: string; animal_id: string; animal_code: string }> = [];
      for (const g of dto.gilts) {
        const line = selection.lines.find((l) => l.line_id === g.line_id)!;
        const [sow] = await this.db.select().from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, line.sow_animal_id)).limit(1);
        const [farrow] = await this.db.select().from(schema.farrowingRecord).where(eq(schema.farrowingRecord.farrow_id, line.farrow_id)).limit(1);
        if (!sow || !farrow) throw new BadRequestException(`${labelOf(line)}: the sow or her farrowing record is missing.`);
        const dob = g.dob ?? String(farrow.farrowing_date).slice(0, 10);
        const animal: any = await this.animals.create(
          {
            company_id: selection.company_id,
            animal_type: 'GILT',
            gender: 'F',
            breed_id: sow.breed_id,
            dob,
            entry_type: 'BORN_ON_FARM',
            entry_date: String(selection.selection_date).slice(0, 10),
            source_batch_id: line.source_batch_id ?? selection.batch_id,
            item_id: selection.gilt_item_id ?? line.piglet_item_id,
            rfid_tag: g.rfid_tag.trim(),
            sire_animal_id: line.boar_animal_id ?? undefined,
            dam_animal_id: line.sow_animal_id,
            acquisition_cost: releasedByLine.get(line.line_id)!.per_head,
            no_of_teats: g.no_of_teats,
            ...(placementByLine.get(line.line_id) ?? (placementByLine.set(line.line_id, await this.placementOf(selection, tenantId, line)), placementByLine.get(line.line_id))),
            notes: `Selected ${selection.selection_no} from ${sow.animal_code}'s litter ${line.lot_no ?? ''}`.trim(),
          } as any,
          tenantId,
          userPayload,
        );
        const giltId = randomUUID();
        await this.db.insert(schema.giltSelectionGilt).values({
          gilt_id: giltId, selection_id: selectionId, line_id: line.line_id, rfid_tag: g.rfid_tag.trim(), dob,
          batch_week: g.batch_week ?? selection.production_week ?? null, no_of_teats: g.no_of_teats,
          animal_id: animal.animal_id, animal_code: animal.animal_code, acquisition_cost: releasedByLine.get(line.line_id)!.per_head.toFixed(4),
        });
        created.push({ gilt_id: giltId, animal_id: animal.animal_id, animal_code: animal.animal_code });
      }

      await this.afterRegistration(selection, { head: total, value }, selectionId, userPayload?.userId);
      await this.auditService.log({
        tenantId, companyId: selection.company_id, userId: userPayload?.userId, action: 'UPDATE', entityName: 'gilt_selection', entityId: selectionId,
        newValues: { status: 'POSTED', gilts: created.map((c) => c.animal_code), value_released: value },
      });
      return { ...(await this.findOne(selectionId, tenantId)), created };
    });
  }
}
