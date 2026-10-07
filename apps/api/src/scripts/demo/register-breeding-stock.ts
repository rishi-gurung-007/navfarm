/**
 * Registers one farm's breeding stock (sows, gilts, boars) as real animals,
 * each properly linked — farm, pen, breed, item, stage, the "Registered
 * Animals" batch it belongs to, and the goods receipt its acquisition cost is
 * read off. Extracted out of chapter `03-batches-and-animals` (Phase 3 Task
 * 5) so `db-seed-animals` can call the exact same, already-tested logic
 * without also creating that chapter's count-only headcount batches.
 *
 * Everything through the services (Ruling 1): AnimalService.create() reads
 * its acquisition cost off a posted goods receipt line, so registering a herd
 * means create-then-post a receipt, create-then-activate a BIO_ASSET batch,
 * then create each animal one by one (never derived from opening quantity —
 * Ruling 3), standing at real pens.
 *
 * Resume-safe: batches are located by their DEMO remarks token, animals by
 * rfid_tag — a farm already carrying its demo herd is adopted, not duplicated.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { breedingSiloLinks, stageEntryDaysAgo } from './feed-planning';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { AnimalService } from '../../modules/piggery/animal/animal.service';
import type { GoodsReceiptService } from '../../modules/inventory/goods-receipt/goods-receipt.service';
import type { SchedulerHeaderService } from '../../modules/production/scheduler-header/scheduler-header.service';
import * as schema from '../../core/database/schema';
import type { DemoContext } from './chapter';
import { batchBreedOf, batchRef, earTag, farmCanRegisterAnimals, pensForRole, tagOf, type DemoBreed, type DemoFarm } from './farms';
import { rateOf, shedForStage, type ItemLookup, type BatchEnsurer } from './batch-helpers';
import { breedingBatchPlans } from './breeding-batch-split';

/** N days ago, YYYY-MM-DD — the flow dates animals' stage transitions back to. */
function dateNdaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const ITEM_SOW = 'Mature Parity Breeding Sow';
const ITEM_BOAR = 'Mature Herd Sire Boar';
const ITEM_GILT = 'Replacement Breeding Gilt';

type AnimalKind = 'SOW' | 'BOAR' | 'GILT';

/**
 * The registered batches' stage preferences, by farm role. The GILT batch
 * opens at the first of these the breed carries (GILT_GROWER almost always);
 * the SOW batch opens at the sow stages. D37 splits the one former registered
 * batch (which always stood at the gilt stage regardless of what was in it)
 * into a gilt batch and a sow batch.
 */
const REGISTERED_STAGE_PREFERENCE: Record<DemoFarm['role'], string[]> = {
  MULTIPLIER: ['GILT_GROWER', 'FLUSH', 'INSEMINATION', 'GESTATION'],
  FARROW_TO_FINISH: ['GILT_GROWER', 'FLUSH', 'INSEMINATION', 'GESTATION', 'FARROWING', 'LACTATION'],
  AI_STATION: ['BOAR_AI'],
  GROW_OUT: [],
};

/** The SOW batch's stage: the first sow stage the breed carries, else null. */
const SOW_STAGE_PREFERENCE = ['GESTATION', 'INSEMINATION', 'FLUSH'] as const;

/** Demo facts per animal kind — ages and teat counts, varied deterministically. */
const ANIMAL_FACTS: Record<AnimalKind, { gender: 'F' | 'M'; itemCode: string; baseAgeWeeks: number; ageSpread: number; teats?: number }> = {
  SOW: { gender: 'F', itemCode: ITEM_SOW, baseAgeWeeks: 104, ageSpread: 16, teats: 14 },
  GILT: { gender: 'F', itemCode: ITEM_GILT, baseAgeWeeks: 30, ageSpread: 6, teats: 15 },
  BOAR: { gender: 'M', itemCode: ITEM_BOAR, baseAgeWeeks: 88, ageSpread: 8 },
};

export interface RegisterBreedingStockDeps {
  db: MySql2Database<typeof schema>;
  animals: AnimalService;
  schedulers: SchedulerHeaderService;
  receipts: GoodsReceiptService;
  item: ItemLookup;
  ensureBatch: BatchEnsurer;
}

/** Returns the DEMO remarks tokens of the batches created/adopted, or null if
 * this farm's role/breed carries no registerable herd. */
export async function registerBreedingStock(ctx: DemoContext, farm: DemoFarm, deps: RegisterBreedingStockDeps): Promise<string[] | null> {
  const { db, animals, schedulers, receipts, item, ensureBatch } = deps;
  const tag = tagOf(farm);
  const breed: DemoBreed | null = batchBreedOf(farm);
  if (!breed) {
    ctx.log(`${tag} no active breed profile on this farm — no registered animals`);
    return null;
  }
  if (!farmCanRegisterAnimals(farm)) {
    ctx.log(`${tag} role ${farm.role} holds no registered breeding stock — skipped`);
    return null;
  }

  const startDate = new Date(Date.now() - farm.volume.days * 86_400_000).toISOString().slice(0, 10);
  const herd: Array<{ kind: AnimalKind; count: number }> = [
    { kind: 'SOW' as const, count: farm.volume.sows },
    { kind: 'GILT' as const, count: farm.volume.gilts },
    { kind: 'BOAR' as const, count: farm.volume.boars },
  ].filter((h) => h.count > 0);
  if (herd.length === 0) {
    ctx.log(`${tag} volume profile carries no sows/gilts/boars — no registered animals`);
    return null;
  }

  // D37: two registered batches per farm — gilts on the gilt (GILT_GROWER)
  // batch, sows and boars on the sow (gestation) batch — so each batch's
  // head count equals the animals standing in it. The legacy single batch
  // (ref without a suffix) stays addressable: a re-run over a database it
  // built adopts it as the GILT batch by its old token rather than
  // duplicating the herd.
  const giltStageCode = REGISTERED_STAGE_PREFERENCE[farm.role].find((code) => breed.lifecycleStages.has(code));
  const sowStageCode = SOW_STAGE_PREFERENCE.find((code) => breed.lifecycleStages.has(code));
  if (!giltStageCode && !sowStageCode) {
    ctx.log(`${tag} breed ${breed.code} carries no lifecycle row for any of ${REGISTERED_STAGE_PREFERENCE[farm.role].join('/')}/${SOW_STAGE_PREFERENCE.join('/')} — no registered batch`);
    return null;
  }
  const plans = breedingBatchPlans({ giltStage: giltStageCode ?? null, sowStage: sowStageCode ?? null, herd });
  if (!plans.length) {
    ctx.log(`${tag} no animals to register — no registered batch`);
    return null;
  }
  const stageByToken = new Map(plans.map((p) => [p.token, breed.lifecycleStages.get(p.stageCode)!]));
  const refByToken = new Map(plans.map((p) => [p.token, p.token === 'GILT' ? batchRef(farm.code, 'REG') : batchRef(farm.code, 'REG-SOW')]));
  const refs = plans.map((p) => refByToken.get(p.token)!);

  // The breeding stock's purchase document, one line per item kind.
  // AnimalService reads each animal's acquisition cost off this receipt's
  // line rate, so every kind in the herd needs a line — including on a farm
  // whose receipt was posted by an earlier, narrower run, which is what the
  // top-up covers.
  const receiptRef = `DEMO-${farm.code}-LIVESTOCK`;
  const receiptLines: { item_id: string; quantity: number; uom: string; rate?: number; lot_no: string }[] = [];
  for (const { kind, count } of herd) {
    const row = await item(ANIMAL_FACTS[kind].itemCode);
    receiptLines.push({ item_id: row.item_id, quantity: count, uom: 'HEAD', rate: rateOf(row.standard_cost), lot_no: `DEMO-${farm.code}-${kind}-LOT` });
  }

  /** Create the named receipt with these lines if absent, then post it if DRAFT. */
  async function ensureReceipt(receiptTag: string, lines: typeof receiptLines, remarks: string): Promise<string> {
    let [row] = await db
      .select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status })
      .from(schema.goodsReceipt)
      .where(eq(schema.goodsReceipt.external_reference_no, receiptTag))
      .limit(1);
    if (!row) {
      const created = await receipts.create(
        {
          company_id: ctx.companyId,
          warehouse_id: farm.farmId,
          posting_date: startDate,
          external_reference_no: receiptTag,
          remarks,
          lines,
        },
        ctx.tenantId,
      );
      row = { receipt_id: created.receipt_id, status: 'DRAFT' };
      ctx.log(`${tag} ${receiptTag} created`);
    }
    if (row.status === 'DRAFT') {
      await receipts.post(row.receipt_id, ctx.tenantId);
      ctx.log(`${tag} ${receiptTag} posted`);
    }
    return row.receipt_id;
  }

  const mainReceiptId = await ensureReceipt(
    receiptRef,
    receiptLines,
    `DEMO breeding stock purchase (${herd.map((h) => `${h.count} ${h.kind.toLowerCase()}`).join(', ')}) into ${farm.code}`,
  );

  // Which items that receipt actually carries — an adopted receipt from an
  // earlier run may predate a kind this profile asks for.
  const carried = new Set(
    (await db
      .select({ item_id: schema.goodsReceiptLine.item_id })
      .from(schema.goodsReceiptLine)
      .where(eq(schema.goodsReceiptLine.receipt_id, mainReceiptId))).map((l) => l.item_id),
  );
  const receiptIdByItem = new Map<string, string>();
  for (const line of receiptLines) {
    if (carried.has(line.item_id)) receiptIdByItem.set(line.item_id, mainReceiptId);
  }
  const missing = receiptLines.filter((line) => !carried.has(line.item_id));
  if (missing.length) {
    const topUpId = await ensureReceipt(
      `${receiptRef}-TOPUP`,
      missing,
      `DEMO breeding stock top-up purchase into ${farm.code} — kinds the first receipt did not carry`,
    );
    for (const line of missing) receiptIdByItem.set(line.item_id, topUpId);
  }

  const batchIds: Array<{ token: 'GILT' | 'SOW'; batchId: string; ref: string; stageCode: string; animals: Array<{ kind: 'SOW' | 'BOAR' | 'GILT'; count: number }> }> = [];
  for (const plan of plans) {
    // D37: each batch opens with exactly the animals it takes, so the batch's
    // head count equals its animals (the one former batch opened with the
    // whole herd while its animals stood in six later stages).
    const planHeads = plan.animals.reduce((n, h) => n + h.count, 0);
    const stageId = stageByToken.get(plan.token)!;
    const batchId = await ensureBatch({
      ref: refByToken.get(plan.token)!,
      farm,
      animalTracking: 'REGISTERED',
      stageId,
      stageCode: plan.stageCode,
      breedId: breed.breedId,
      startDate,
      openingQuantity: planHeads,
      inputLines: receiptLines.map(({ item_id, quantity, uom, rate }) => ({ item_id, quantity, uom, rate })),
    });
    batchIds.push({ token: plan.token, batchId, ref: refByToken.get(plan.token)!, stageCode: plan.stageCode, animals: plan.animals });
  }

  // D31: the GILT batch stands in a gilt house, and its animals move on into
  // flush, gestation, farrowing and lactation — so the dry sow and farrowing
  // silos are linked to its shed and the sow diets still come from silos.
  // The SOW batch stands in a dry sow house, whose own silo holds gestation
  // mash already, so it needs no extra links. Chapter 02 has already chosen
  // each silo's feed from its first shed, so linking cannot change what a
  // silo holds. A re-run leaves an existing pair.
  const giltPlan = batchIds.find((b) => b.token === 'GILT');
  if (giltPlan) {
    const batchShed = shedForStage(farm, giltPlan.stageCode);
    if (batchShed) {
      for (const siloId of breedingSiloLinks(farm, batchShed.shedId)) {
        await db
          .insert(schema.siloShedLink)
          .values({ tenant_id: ctx.tenantId, company_id: ctx.companyId, silo_id: siloId, shed_id: batchShed.shedId })
          .onDuplicateKeyUpdate({ set: { silo_id: sql`silo_id` } });
        ctx.log(`${tagOf(farm)} breeding shed ${batchShed.code} also draws from silo ${siloId} (D31)`);
      }
    }
  }

  // ── The animals themselves, one by one (Ruling 3), standing at pens, each
  // in the batch its D37 plan says: gilts on the gilt batch, sows and boars
  // on the sow batch.
  const batchRows = await db
    .select({ batch_id: schema.batchHeader.batch_id, stage_id: schema.batchHeader.stage_id })
    .from(schema.batchHeader)
    .where(inArray(schema.batchHeader.batch_id, batchIds.map((b) => b.batchId)));
  const stageOfBatch = new Map(batchRows.map((b) => [b.batch_id, b.stage_id]));

  // An animal's breed must match its batch's, so every head on the farm's
  // registered batches carries the farm's one batch breed — boars included.
  let created = 0;
  for (const entry of batchIds) {
    const batchStageId = stageOfBatch.get(entry.batchId);
    if (!batchStageId) throw new Error(`register-breeding-stock: batch on ${farm.code} carries no stage_id.`);
    for (const { kind, count } of entry.animals) {
      const facts = ANIMAL_FACTS[kind];
      const pens = kind === 'BOAR'
        ? pensForRole(farm, 'BOAR')
        : kind === 'GILT'
          ? pensForRole(farm, 'GILT', 'GILT_REARING')
          : pensForRole(farm, 'DRY_SOW', 'GILT');
      if (pens.length === 0) throw new Error(`register-breeding-stock: ${farm.code} has no pens to stand a ${kind} in.`);
      const itemRow = await item(facts.itemCode);

      for (let i = 1; i <= count; i++) {
        const tagNo = earTag(farm.code, kind, i);
        const [already] = await db
          .select({ animal_id: schema.animalRegister.animal_id })
          .from(schema.animalRegister)
          .where(eq(schema.animalRegister.rfid_tag, tagNo))
          .limit(1);
        if (already) continue;

        await animals.create(
          {
            company_id: ctx.companyId,
            animal_type: kind,
            breed_id: breed.breedId,
            gender: facts.gender,
            entry_type: 'PURCHASED_LOCAL',
            entry_date: startDate,
            age_at_entry_weeks: facts.baseAgeWeeks + (i % facts.ageSpread),
            source_receipt_id: receiptIdByItem.get(itemRow.item_id)!,
            item_id: itemRow.item_id,
            rfid_tag: tagNo,
            current_batch_id: entry.batchId,
            current_location_id: pens[(i - 1) % pens.length],
            current_stage_id: batchStageId,
            no_of_teats: facts.teats === undefined ? undefined : facts.teats + (i % 3),
          },
          ctx.tenantId,
        );
        created += 1;
      }
    }
  }
  ctx.log(
    created > 0
      ? `${tag} registered ${created} animal(s) across ${refs.join(' + ')} (${herd.map((h) => `${h.count} ${h.kind.toLowerCase()}`).join(', ')})`
      : `${tag} every demo animal on ${refs.join(' + ')} already registered — skipped`,
  );

  // ── The farm's pig flow, walked once through the services, per D37 batch:
  // each batch's animals (at their opening stage) move into the stages after
  // that batch's own, and the batch grows a scheduler per destination stage.
  const flowStages = REGISTERED_STAGE_PREFERENCE[farm.role].filter((code) => breed.lifecycleStages.has(code));
  for (const entry of batchIds) {
    const openingIdx = flowStages.indexOf(entry.stageCode);
    const destStages = (openingIdx >= 0 ? flowStages.slice(openingIdx + 1) : []).map((code) => breed.lifecycleStages.get(code)!);
    if (!destStages.length) continue;
    const batchStageId = stageOfBatch.get(entry.batchId);
    if (!batchStageId) continue;
    const batchAnimals = await db
      .select({ animal_id: schema.animalRegister.animal_id, rfid_tag: schema.animalRegister.rfid_tag })
      .from(schema.animalRegister)
      .where(and(
        eq(schema.animalRegister.current_batch_id, entry.batchId),
        eq(schema.animalRegister.current_stage_id, batchStageId),
        eq(schema.animalRegister.is_active, true),
      ));
    if (batchAnimals.length) {
      // B1: each destination stage's length, so an animal enters it early enough to still be in it today.
      const durations = new Map(
        (await db
          .select({ stage_id: schema.stageMaster.stage_id, days: schema.stageMaster.typical_duration_days })
          .from(schema.stageMaster)
          .where(inArray(schema.stageMaster.stage_id, [...new Set(destStages)]))).map((r) => [r.stage_id, r.days] as const),
      );
      let cursor = 0;
      for (const { animal_id, rfid_tag } of batchAnimals) {
        const isBoar = (rfid_tag ?? '').includes('BOAR');
        const target = destStages[isBoar ? 0 : cursor % destStages.length];
        cursor += 1;
        try {
          await animals.transitionStage(animal_id, {
            to_stage_id: target,
            transition_date: dateNdaysAgo(stageEntryDaysAgo(durations.get(target) ?? null)),
            reason: 'DEMO_FLOW',
            remarks: `DEMO breeding-stock flow on ${farm.code}`,
          }, ctx.tenantId);
        } catch (err) {
          ctx.log(`${tag} ${rfid_tag}: stage transition refused — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      for (const destStageId of new Set(destStages)) {
        await schedulers.createForStage(entry.batchId, destStageId, ctx.tenantId);
      }
      ctx.log(`${tag} spread ${batchAnimals.length} animal(s) and grew ${destStages.length} scheduler(s) across ${entry.ref}'s flow`);
    }
  }

  return refs;
}
