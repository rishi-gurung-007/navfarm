/**
 * Registers one farm's breeding stock (sows, gilts, boars) as real animals in
 * the Animal Register, then groups them into ONE Animal Wise batch. Each animal
 * is linked — farm, pen, breed, item, stage and the goods receipt its
 * acquisition cost is read off — and stands in a pen of the shed that matches
 * its stage, so the animals of the batch sit in different stages at once and
 * each stage gets its own scheduler (that is the point of an Animal Wise batch).
 *
 * Everything through the services (Ruling 1): AnimalService.create() reads its
 * acquisition cost off a posted goods receipt line, so registering a herd means
 * create-then-post a receipt, then create each animal one by one (never derived
 * from an opening quantity — Ruling 3), then BatchService.create() with
 * `tracking_mode: 'ANIMAL_WISE'` and the animals' ids.
 *
 * Resume-safe: the batch is located by its DEMO remarks token, animals by
 * rfid_tag — a farm already carrying its demo herd is adopted, not duplicated.
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { breedingSiloLinks } from './feed-planning';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { AnimalService } from '../../modules/piggery/animal/animal.service';
import type { GoodsReceiptService } from '../../modules/inventory/goods-receipt/goods-receipt.service';
import * as schema from '../../core/database/schema';
import type { DemoContext } from './chapter';
import { batchBreedOf, batchRef, earTag, farmCanRegisterAnimals, pensForRole, tagOf, type DemoBreed, type DemoFarm } from './farms';
import { rateOf, shedForStage, type ItemLookup, type AnimalWiseBatchEnsurer } from './batch-helpers';

const ITEM_SOW = 'Mature Parity Breeding Sow';
const ITEM_BOAR = 'Mature Herd Sire Boar';
const ITEM_GILT = 'Replacement Breeding Gilt';

type AnimalKind = 'SOW' | 'BOAR' | 'GILT';

/**
 * The stages each kind of animal is spread over, in order, keeping only those
 * the farm's breed has an active lifecycle row for (a stage with none would
 * give the batch a scheduler with no lines). Animals are dealt out round-robin,
 * so even the small preset's handful of animals stand in several stages.
 */
const GILT_STAGES = ['GILT_GROWER', 'FLUSH', 'INSEMINATION'];
const SOW_STAGES = ['GESTATION', 'FARROWING', 'LACTATION'];
const BOAR_STAGES = ['BOAR_AI', 'GESTATION'];

/** Demo facts per animal kind — ages and teat counts, varied deterministically. */
const ANIMAL_FACTS: Record<AnimalKind, { gender: 'F' | 'M'; itemCode: string; baseAgeWeeks: number; ageSpread: number; teats?: number }> = {
  SOW: { gender: 'F', itemCode: ITEM_SOW, baseAgeWeeks: 104, ageSpread: 16, teats: 14 },
  GILT: { gender: 'F', itemCode: ITEM_GILT, baseAgeWeeks: 30, ageSpread: 6, teats: 15 },
  BOAR: { gender: 'M', itemCode: ITEM_BOAR, baseAgeWeeks: 88, ageSpread: 8 },
};

export interface RegisterBreedingStockDeps {
  db: MySql2Database<typeof schema>;
  animals: AnimalService;
  receipts: GoodsReceiptService;
  item: ItemLookup;
  /** Left out, the animals are registered and left in no batch (the small seed: the user creates the batch). */
  ensureAnimalWiseBatch?: AnimalWiseBatchEnsurer;
}

/** Returns the DEMO remarks token of the Animal Wise batch created/adopted (in a
 * one-element list), or null if this farm's role/breed carries no registerable herd. */
export async function registerBreedingStock(ctx: DemoContext, farm: DemoFarm, deps: RegisterBreedingStockDeps): Promise<string[] | null> {
  const { db, animals, receipts, item, ensureAnimalWiseBatch } = deps;
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

  // Which stage each animal stands in: dealt round-robin over the stages its kind
  // uses and the breed carries. A kind with no usable stage is left out.
  const stagesFor = (kind: AnimalKind): string[] =>
    (kind === 'GILT' ? GILT_STAGES : kind === 'SOW' ? SOW_STAGES : BOAR_STAGES).filter((code) => breed.lifecycleStages.has(code));
  const usableHerd = herd.filter((h) => {
    if (stagesFor(h.kind).length) return true;
    ctx.log(`${tag} breed ${breed.code} carries no lifecycle row for any ${h.kind.toLowerCase()} stage — no ${h.kind.toLowerCase()}s registered`);
    return false;
  });
  if (usableHerd.length === 0) return null;
  const ref = batchRef(farm.code, 'REG');

  // The breeding stock's purchase document, one line per item kind.
  // AnimalService reads each animal's acquisition cost off this receipt's
  // line rate, so every kind in the herd needs a line — including on a farm
  // whose receipt was posted by an earlier, narrower run, which is what the
  // top-up covers.
  const receiptRef = `DEMO-${farm.code}-LIVESTOCK`;
  const receiptLines: { item_id: string; quantity: number; uom: string; rate?: number; lot_no: string }[] = [];
  for (const { kind, count } of usableHerd) {
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
    `DEMO breeding stock purchase (${usableHerd.map((h) => `${h.count} ${h.kind.toLowerCase()}`).join(', ')}) into ${farm.code}`,
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

  // ── The animals themselves, one by one (Ruling 3), each in the shed that
  // matches its stage. They are created with no batch: an Animal Wise batch
  // takes animals that are already in the register.
  let created = 0;
  const tags: string[] = [];
  for (const { kind, count } of usableHerd) {
    const facts = ANIMAL_FACTS[kind];
    const stages = stagesFor(kind);
    const itemRow = await item(facts.itemCode);
    for (let i = 1; i <= count; i++) {
      const tagNo = earTag(farm.code, kind, i);
      tags.push(tagNo);
      const [already] = await db
        .select({ animal_id: schema.animalRegister.animal_id })
        .from(schema.animalRegister)
        .where(eq(schema.animalRegister.rfid_tag, tagNo))
        .limit(1);
      if (already) continue;

      const stageCode = stages[(i - 1) % stages.length];
      const shed = shedForStage(farm, stageCode);
      const pens = shed?.penIds.length
        ? shed.penIds
        : kind === 'BOAR' ? pensForRole(farm, 'BOAR') : kind === 'GILT' ? pensForRole(farm, 'GILT', 'GILT_REARING') : pensForRole(farm, 'DRY_SOW', 'GILT');
      if (pens.length === 0) throw new Error(`register-breeding-stock: ${farm.code} has no pens to stand a ${kind} in.`);

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
          current_location_id: pens[(i - 1) % pens.length],
          current_stage_id: breed.lifecycleStages.get(stageCode)!,
          no_of_teats: facts.teats === undefined ? undefined : facts.teats + (i % 3),
        },
        ctx.tenantId,
      );
      created += 1;
    }
  }
  ctx.log(
    created > 0
      ? `${tag} registered ${created} animal(s) in the Animal Register (${usableHerd.map((h) => `${h.count} ${h.kind.toLowerCase()}`).join(', ')}) across stages`
      : `${tag} every demo animal already registered — skipped`,
  );

  if (!ensureAnimalWiseBatch) {
    ctx.log(`${tag} no batch created — the ${tags.length} animal(s) are in the register, unassigned`);
    return [];
  }

  // ── One Animal Wise batch from those animals. The batch stands in the shed of
  // the first stage (gilt house when there are gilts), whose silos feed every
  // stage's scheduler; D31 links the dry sow and farrowing silos to it so the
  // sow diets still come from silos.
  const firstKind = usableHerd.find((h) => h.kind === 'GILT') ?? usableHerd[0];
  const placementShed = shedForStage(farm, stagesFor(firstKind.kind)[0]);
  if (placementShed) {
    for (const siloId of breedingSiloLinks(farm, placementShed.shedId)) {
      await db
        .insert(schema.siloShedLink)
        .values({ tenant_id: ctx.tenantId, company_id: ctx.companyId, silo_id: siloId, shed_id: placementShed.shedId })
        .onDuplicateKeyUpdate({ set: { silo_id: sql`silo_id` } });
      ctx.log(`${tag} breeding shed ${placementShed.code} also draws from silo ${siloId} (D31)`);
    }
  }

  // Only animals that are not in a batch yet can be picked for a new one.
  const unassigned = await db
    .select({ animal_id: schema.animalRegister.animal_id, current_batch_id: schema.animalRegister.current_batch_id })
    .from(schema.animalRegister)
    .where(inArray(schema.animalRegister.rfid_tag, tags));
  const batchId = await ensureAnimalWiseBatch({
    ref,
    farm,
    breedId: breed.breedId,
    shed: placementShed,
    startDate,
    animalIds: unassigned.filter((a) => !a.current_batch_id).map((a) => a.animal_id),
  });

  // Every stage's scheduler begins on the batch's own start date. A scheduler
  // created after the first begins "today" in the app (the stage began when the
  // animal moved into it); these animals were placed in their stages at the
  // start, so the history the daily entries post covers each stage.
  await db
    .update(schema.schedulerHeader)
    .set({ effective_from: startDate })
    .where(eq(schema.schedulerHeader.batch_id, batchId));

  return [ref];
}
