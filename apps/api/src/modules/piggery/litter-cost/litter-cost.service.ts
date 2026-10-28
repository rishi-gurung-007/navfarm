import { BadRequestException, Injectable } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { AnimalBookValueService } from '../../inventory/bio-asset-ledger/animal-book-value.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { bioCodes, bioEventCondition, bioEventsCondition } from '../../inventory/bio-asset-ledger/bio-asset-ledger.types';

const LACTATION_DOC = 'LITTER_COST';
const BIRTH_DOC = 'LITTER_BIRTH_COST';

/**
 * What a sow has cost her litter, worked out per sow and moved into the litter's piglet lot (BBP: the piglets' cost comes from the sow's accumulated WIP
 * cost, per sow, not from a batch average). The sow's lactation feed, drug and overhead that are still capitalised, from the farrowing to a date, move from
 * her (and her batch's share) into the lot, ledger-only. It can be done more than once for a litter (before the weaning, when gilts are picked, and at the
 * weaning): each time moves only what has not been moved yet.
 */
@Injectable()
export class LitterCostService {
  constructor(
    private readonly cls: ClsService,
    private readonly animalBookValue: AnimalBookValueService,
    private readonly glPosting: GlPostingService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  /**
   * What is still capitalised for a sow over a period: her own feed, drug and overhead rows on the bio-asset ledger (net of any reversal), and her equal
   * share of the batch-level overhead rows. Read from the ledger, not from what was posted: a cost posted at expense never entered her value, so there is
   * nothing of it to hand on.
   */
  async capitalisedLactationCost(
    sow: typeof schema.animalRegister.$inferSelect,
    batchId: string,
    from: string,
    to: string,
    tenantId: string,
  ): Promise<{ own: number; shared: number }> {
    const L = schema.bioAssetLedger;
    const rows = await this.db
      .select({ animal_id: L.animal_id, total: sql<string>`COALESCE(SUM(${L.cost_amount}), 0)` })
      .from(L)
      .where(
        and(
          eq(L.tenant_id, tenantId),
          eq(L.batch_id, batchId),
          bioEventsCondition(L, ['CONSUMPTION', 'OVERHEAD_COST']),
          sql`${L.posting_date} BETWEEN ${from} AND ${to}`,
          sql`(${L.animal_id} = ${sow.animal_id} OR ${L.animal_id} IS NULL)`,
        ),
      )
      .groupBy(L.animal_id);
    const [{ head }] = await this.db
      .select({ head: sql<number>`COUNT(*)` })
      .from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.current_batch_id, batchId), eq(schema.animalRegister.is_active, true)));
    const share = Number(head) > 0 ? 1 / Number(head) : 0;
    const own = rows.filter((r) => r.animal_id === sow.animal_id).reduce((n, r) => n + Number(r.total), 0);
    const shared = rows.filter((r) => !r.animal_id).reduce((n, r) => n + Number(r.total), 0) * share;
    const round = (n: number) => Math.max(0, Math.round(n * 1e4) / 1e4);
    return { own: round(own), shared: round(shared) };
  }

  /** What has already been moved into this litter's lot from its sow, of one kind: the cost at birth, or the lactation cost (the positive allocation rows on the lot). */
  async alreadyAllocated(lotBatchId: string, tenantId: string, kind: 'LACTATION' | 'BIRTH' = 'LACTATION'): Promise<number> {
    const L = schema.bioAssetLedger;
    const [row] = await this.db
      .select({ total: sql<string>`COALESCE(SUM(${L.cost_amount}), 0)` })
      .from(L)
      .where(and(eq(L.tenant_id, tenantId), eq(L.batch_id, lotBatchId), bioEventCondition(L, 'COST_ALLOCATION'), eq(L.document_type, kind === 'BIRTH' ? BIRTH_DOC : LACTATION_DOC), sql`${L.cost_amount} > 0`));
    return Number(row?.total ?? 0) || 0;
  }

  /** How much more the sow could hand to her litter on `asOf` than she has (not moved: a preview). */
  async pending(
    farrow: typeof schema.farrowingRecord.$inferSelect,
    sow: typeof schema.animalRegister.$inferSelect,
    asOf: string,
    tenantId: string,
  ): Promise<number> {
    const sowBatchId = farrow.batch_id ?? sow.current_batch_id;
    if (!farrow.piglet_batch_id || !sowBatchId) return 0;
    const held = await this.capitalisedLactationCost(sow, sowBatchId, String(farrow.farrowing_date).slice(0, 10), asOf, tenantId);
    const [sowState] = await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, sowBatchId)).limit(1);
    const already = await this.alreadyAllocated(farrow.piglet_batch_id, tenantId);
    return Number(Math.max(0, Math.min(held.own + held.shared - already, Number(sowState?.nca_book_value) || 0)).toFixed(4));
  }

  /**
   * Moves the sow's not-yet-moved lactation cost to `asOf` into the litter's lot. The sow's own part is written against HER ledger (her card falls by it), the
   * rest against her batch, and the whole to the lot. `divisor` is how many piglets the litter's cost per piglet is spread over (the piglets weaned, or the
   * head in the lot now). Returns what to add to a message, the cost per piglet, and what was moved this time.
   */
  async allocate(
    farrow: typeof schema.farrowingRecord.$inferSelect,
    sow: typeof schema.animalRegister.$inferSelect,
    opts: { asOf: string; divisor: number },
    tenantId: string,
    userPayload?: { userId?: string },
  ): Promise<{ note: string; perPiglet: string | null; moved: number }> {
    return this.move('LACTATION', farrow, sow, { from: String(farrow.farrowing_date).slice(0, 10), to: opts.asOf, asOf: opts.asOf, divisor: opts.divisor }, tenantId, userPayload);
  }

  /**
   * The litter's cost at birth (BBP: "Cost per Piglet = Total Accumulated WIP Cost (per sow) / Total Live Piglets Born"): the sow's capitalised feed, drug and
   * overhead from her mating to the day before the farrowing move from her into the new piglet lot, so the litter opens at its cost, not at nil. Where a GL mapping
   * for BIO_LITTER_BIRTH is set up the journal is posted too (Dr Piglets Inventory, Current Biological Asset / Cr Biological Asset WIP).
   * ASSUMPTION awaiting Finance: the WIP window is mating to farrowing, and the sow's capitalised cost on her bio-asset ledger is her WIP.
   */
  async allocateAtBirth(
    farrow: typeof schema.farrowingRecord.$inferSelect,
    sow: typeof schema.animalRegister.$inferSelect,
    liveBorn: number,
    tenantId: string,
    userPayload?: { userId?: string },
  ): Promise<{ note: string; perPiglet: string | null; moved: number; journal: string | null; zeroCost: boolean }> {
    const farrowingDate = String(farrow.farrowing_date).slice(0, 10);
    const [mating] = farrow.breeding_id
      ? await this.db.select({ d: schema.breedingRecord.mating_date }).from(schema.breedingRecord).where(eq(schema.breedingRecord.breeding_id, farrow.breeding_id)).limit(1)
      : [];
    const from = mating?.d ? String(mating.d).slice(0, 10) : addDays(farrowingDate, -116);
    const moved = await this.move('BIRTH', farrow, sow, { from, to: addDays(farrowingDate, -1), asOf: farrowingDate, divisor: liveBorn }, tenantId, userPayload);
    let journal: string | null = null;
    if (moved.moved >= 0.005 && farrow.piglet_batch_id) {
      const [lot] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, farrow.piglet_batch_id)).limit(1);
      try {
        const posted: any = await this.glPosting.postBatchCostEntry({
          tenantId, companyId: farrow.company_id ?? sow.company_id, transactionType: 'BIO_LITTER_BIRTH', amount: moved.moved, documentNo: lot?.batch_no ?? String(farrow.piglet_lot_no ?? ''),
          documentLineId: farrow.farrow_id, postingDate: farrowingDate, description: `Litter ${farrow.piglet_lot_no ?? ''} born to ${sow.animal_code}: cost per piglet ${moved.perPiglet ? Number(moved.perPiglet).toFixed(4) : ''}`,
          nobId: lot?.nob_id ?? undefined, lobId: lot?.lob_id ?? undefined, userId: userPayload?.userId,
          // Out of the account the sow's cost is carried in.
          creditAccountId: await this.glPosting.animalAssetAccountId(sow.animal_id),
        });
        journal = posted?.journal_no ?? posted?.journal_id ?? 'posted';
      } catch (error) {
        // No mapping is set up for BIO_LITTER_BIRTH: the value still moves in the bio-asset ledger, with no journal until Finance adds the mapping.
        if (!(error instanceof BadRequestException) || !/No GL mapping/.test(error.message)) throw error;
      }
    }
    // Nothing to hand on is a fact worth stating: the litter, and the gilts taken from it, carry no cost until the lactation cost moves at the weaning.
    const zeroCost = !(moved.moved >= 0.005);
    const note = zeroCost
      ? ` The litter opens at 0.00: ${sow.animal_code} had no feed, drug or overhead capitalised between ${from} and ${addDays(farrowingDate, -1)} (feed from her costing start is expensed, and a sow with no feed entered before the farrowing has none), so piglets and gilts carry no cost until the lactation cost moves at the weaning.`
      : `${moved.note} Basis: the sow's capitalised feed, drug, overhead and semen from ${from} to ${addDays(farrowingDate, -1)} (the window awaits Finance's confirmation).`;
    return { ...moved, note, journal, zeroCost };
  }

  private async move(
    kind: 'LACTATION' | 'BIRTH',
    farrow: typeof schema.farrowingRecord.$inferSelect,
    sow: typeof schema.animalRegister.$inferSelect,
    win: { from: string; to: string; asOf: string; divisor: number },
    tenantId: string,
    userPayload?: { userId?: string },
  ): Promise<{ note: string; perPiglet: string | null; moved: number }> {
    const none = { note: '', perPiglet: null, moved: 0 };
    const sowBatchId = farrow.batch_id ?? sow.current_batch_id;
    if (!farrow.piglet_batch_id || !sowBatchId || !(win.divisor > 0)) return none;

    const held = await this.capitalisedLactationCost(sow, sowBatchId, win.from, win.to, tenantId);
    const already = await this.alreadyAllocated(farrow.piglet_batch_id, tenantId, kind);
    const other = await this.alreadyAllocated(farrow.piglet_batch_id, tenantId, kind === 'BIRTH' ? 'LACTATION' : 'BIRTH');
    const [sowState] = await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, sowBatchId)).limit(1);
    const [lotState] = await this.db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, farrow.piglet_batch_id)).limit(1);
    if (!sowState || !lotState) return none;
    const wanted = Math.max(0, held.own + held.shared - already);
    const total = Number(Math.min(wanted, Number(sowState.nca_book_value) || 0).toFixed(4));
    if (!(total >= 0.005)) return none;
    // Her own part first; if the batch carries less than the two, both give in proportion.
    const heldTotal = held.own + held.shared;
    const ownPart = heldTotal > 0 ? Number(((total * held.own) / heldTotal).toFixed(4)) : 0;
    const batchPart = Number((total - ownPart).toFixed(4));

    const [sowBatch] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, sowBatchId)).limit(1);
    const [lot] = await this.db.select().from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, farrow.piglet_batch_id)).limit(1);
    const [lotEntry] = await this.db
      .select({ item_id: schema.bioAssetLedger.bio_asset_item_id })
      .from(schema.bioAssetLedger)
      .where(and(eq(schema.bioAssetLedger.batch_id, farrow.piglet_batch_id), bioEventCondition(schema.bioAssetLedger, 'ACQUISITION')))
      .limit(1);
    if (!lot || !sowBatch || !lotEntry) return none;

    await this.db
      .update(schema.batchBioAssetState)
      .set({ nca_book_value: String(Math.max(0, Number(sowState.nca_book_value) - total).toFixed(4)) })
      .where(eq(schema.batchBioAssetState.batch_id, sowBatchId));
    await this.db
      .update(schema.batchBioAssetState)
      .set({ nca_book_value: String((Number(lotState.nca_book_value) + total).toFixed(4)) })
      .where(eq(schema.batchBioAssetState.batch_id, farrow.piglet_batch_id));

    // The litter's cost per piglet is everything moved to it, at birth and since, over the piglets it is spread over.
    const perPiglet = (other + already + total) / win.divisor;
    const row = (batch: typeof lot, amount: number, state: typeof lotState, itemId: string, animalId: string | null) => ({
      entry_id: randomUUID(),
      tenant_id: tenantId,
      company_id: batch.company_id,
      bio_asset_item_id: itemId,
      animal_id: animalId,
      // The sow's side hands cost over (negative); the litter's side takes it.
      ...bioCodes.costAllocation({ gives: amount < 0, lactation: kind !== 'BIRTH' }),
      document_no: lot.batch_no,
      batch_id: batch.batch_id,
      batch_no: batch.batch_no,
      lot_no: farrow.piglet_lot_no,
      posting_date: win.asOf,
      stage: state.stage,
      quantity: '0',
      cost_amount: amount.toFixed(4),
      cost_amount_each_unit: perPiglet.toFixed(4),
      costing_method: 'COST_ACCUMULATION',
      nob_id: batch.nob_id,
      lob_id: batch.lob_id,
      created_by: userPayload?.userId || null,
    });
    const rows = [
      ...(ownPart >= 0.005 ? [row(sowBatch, -ownPart, sowState, sow.item_id ?? lotEntry.item_id, sow.animal_id)] : []),
      ...(batchPart >= 0.005 ? [row(sowBatch, -batchPart, sowState, lotEntry.item_id, null)] : []),
      row(lot, total, lotState, lotEntry.item_id, null),
    ];
    await this.db.insert(schema.bioAssetLedger).values(rows);
    if (ownPart >= 0.005) await this.animalBookValue.refreshCache([sow.animal_id]);
    return {
      note: kind === 'BIRTH'
        ? ` Litter cost at birth ${total.toFixed(2)} (${sow.animal_code}'s cost from mating) moved to the piglet lot: ${perPiglet.toFixed(4)} per piglet born alive.`
        : ` Lactation cost ${total.toFixed(2)} moved from ${sow.animal_code} to the piglet lot (${perPiglet.toFixed(4)} per piglet).`,
      perPiglet: perPiglet.toFixed(6),
      moved: total,
    };
  }
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
