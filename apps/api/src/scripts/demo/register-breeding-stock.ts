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
 * ear_tag — a farm already carrying its demo herd is adopted, not duplicated.
 */
import { and, eq } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { AnimalService } from '../../modules/piggery/animal/animal.service';
import type { GoodsReceiptService } from '../../modules/inventory/goods-receipt/goods-receipt.service';
import type { SchedulerHeaderService } from '../../modules/production/scheduler-header/scheduler-header.service';
import * as schema from '../../core/database/schema';
import type { DemoContext } from './chapter';
import { batchBreedOf, batchRef, earTag, farmCanRegisterAnimals, pensForRole, tagOf, type DemoBreed, type DemoFarm } from './farms';
import { rateOf, type ItemLookup, type BatchEnsurer } from './batch-helpers';

/** N days ago, YYYY-MM-DD — the flow dates animals' stage transitions back to. */
function dateNdaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const ITEM_SOW = 'Mature Parity Breeding Sow';
const ITEM_BOAR = 'Mature Herd Sire Boar';
const ITEM_GILT = 'Replacement Breeding Gilt';

type AnimalKind = 'SOW' | 'BOAR' | 'GILT';

/** The registered batch's stage, by farm role, first match the breed carries. */
const REGISTERED_STAGE_PREFERENCE: Record<DemoFarm['role'], string[]> = {
  MULTIPLIER: ['GILT_GROWER', 'FLUSH', 'INSEMINATION', 'GESTATION'],
  FARROW_TO_FINISH: ['GILT_GROWER', 'FLUSH', 'INSEMINATION', 'GESTATION', 'FARROWING', 'LACTATION'],
  AI_STATION: ['BOAR_AI'],
  GROW_OUT: [],
};

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

/** Returns the DEMO remarks token of the batch created/adopted, or null if
 * this farm's role/breed carries no registerable herd. */
export async function registerBreedingStock(ctx: DemoContext, farm: DemoFarm, deps: RegisterBreedingStockDeps): Promise<string | null> {
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

  const stageCode = REGISTERED_STAGE_PREFERENCE[farm.role].find((code) => breed.lifecycleStages.has(code));
  if (!stageCode) {
    ctx.log(`${tag} breed ${breed.code} carries no lifecycle row for any of ${REGISTERED_STAGE_PREFERENCE[farm.role].join('/')} — no registered batch`);
    return null;
  }
  const stageId = breed.lifecycleStages.get(stageCode)!;
  const ref = batchRef(farm.code, 'REG');

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

  const total = herd.reduce((n, h) => n + h.count, 0);
  const batchId = await ensureBatch({
    ref,
    farm,
    animalTracking: 'REGISTERED',
    stageId,
    stageCode,
    breedId: breed.breedId,
    startDate,
    openingQuantity: total,
    inputLines: receiptLines.map(({ item_id, quantity, uom, rate }) => ({ item_id, quantity, uom, rate })),
  });

  // ── The animals themselves, one by one (Ruling 3), standing at pens.
  const [batchRow] = await db
    .select({ stage_id: schema.batchHeader.stage_id })
    .from(schema.batchHeader)
    .where(eq(schema.batchHeader.batch_id, batchId))
    .limit(1);
  if (!batchRow?.stage_id) throw new Error(`register-breeding-stock: batch on ${farm.code} carries no stage_id.`);

  // An animal's breed must match its batch's, so every head on the farm's
  // registered batch carries the farm's one batch breed — boars included.
  let created = 0;
  for (const { kind, count } of herd) {
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
        .where(eq(schema.animalRegister.ear_tag, tagNo))
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
          ear_tag: tagNo,
          current_batch_id: batchId,
          current_location_id: pens[(i - 1) % pens.length],
          current_stage_id: batchRow.stage_id,
          no_of_teats: facts.teats === undefined ? undefined : facts.teats + (i % 3),
        },
        ctx.tenantId,
      );
      created += 1;
    }
  }
  ctx.log(
    created > 0
      ? `${tag} registered ${created} animal(s) onto ${ref} (${herd.map((h) => `${h.count} ${h.kind.toLowerCase()}`).join(', ')})`
      : `${tag} every demo animal on ${ref} already registered — skipped`,
  );

  // ── The farm's pig flow, walked once through the services.
  const flowStages = REGISTERED_STAGE_PREFERENCE[farm.role].filter((code) => breed.lifecycleStages.has(code));
  const openingIdx = flowStages.indexOf(stageCode);
  const destStages = flowStages.slice(openingIdx + 1).map((code) => breed.lifecycleStages.get(code)!);
  if (destStages.length) {
    const batchAnimals = await db
      .select({ animal_id: schema.animalRegister.animal_id, ear_tag: schema.animalRegister.ear_tag })
      .from(schema.animalRegister)
      .where(and(
        eq(schema.animalRegister.current_batch_id, batchId),
        eq(schema.animalRegister.current_stage_id, batchRow.stage_id),
        eq(schema.animalRegister.is_active, true),
      ));
    if (batchAnimals.length) {
      let cursor = 0;
      for (const { animal_id, ear_tag } of batchAnimals) {
        const isBoar = (ear_tag ?? '').includes('BOAR');
        const target = destStages[isBoar ? 0 : cursor % destStages.length];
        cursor += 1;
        try {
          await animals.transitionStage(animal_id, {
            to_stage_id: target,
            transition_date: dateNdaysAgo(5),
            reason: 'DEMO_FLOW',
            remarks: `DEMO breeding-stock flow on ${farm.code}`,
          }, ctx.tenantId);
        } catch (err) {
          ctx.log(`${tag} ${ear_tag}: stage transition refused — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      for (const destStageId of new Set(destStages)) {
        await schedulers.createForStage(batchId, destStageId, ctx.tenantId);
      }
      ctx.log(`${tag} spread ${batchAnimals.length} animal(s) and grew ${destStages.length} scheduler(s) across ${ref}'s flow`);
    }
  }

  return ref;
}
