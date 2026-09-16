/**
 * Chapter `03-batches-and-animals` — Phase 3 Task 5, now over all nine farms.
 * Everything through the services (Ruling 1):
 *
 *   - one **Registered Animals** batch per farm that may hold breeding stock
 *     (BIO_ASSET costing, the farm's own breed profile,
 *     `auto_generate_scheduler`), whose sows, gilts and boars are then created
 *     one by one through `AnimalService.create` with explicit demo facts —
 *     never derived from opening quantity (Ruling 3);
 *   - one to three **Count Only** batches per farm, one per stage the farm's
 *     role allows *and* the farm's breed actually carries a lifecycle row for.
 *
 * What a farm may do comes from its role (docs/decisions.md, last section):
 *   MUL100  multiplier — gilt production, no grow-out;
 *   AI100   boars only — no farrowing and no grow-out, so one registered boar
 *           batch at Boar AI and one quarantine intake, nothing else;
 *   LEX100  weaners and growers only — count-only batches, no registered
 *           breeding stock at all;
 *   the other six farrow-to-finish.
 * A stage the farm's breed has no `breed_lifecycle_stages` row for is skipped
 * rather than invented: without one the auto-generated scheduler is born empty
 * and chapter 04 would have nothing to post.
 *
 * Animals stand at Pens, never at a shed or a farm: sows in the Dry Sow house's
 * pens, gilts in the Gilt house's, boars in the Boar house's, each herd spread
 * round-robin across that shed's pens. Batches carry their farm, their tracking
 * mode and their stage.
 *
 * Batch create leaves the batch DRAFT; `BatchService.activate` takes it
 * through BIO_ACQUISITION GL + bio-asset ledger posting. Registered animals
 * carry `entry_type: 'PURCHASED_LOCAL'` with the farm's livestock goods
 * receipt as their `source_receipt_id` — the acquisition cost is read off that
 * receipt line by the service.
 *
 * Resume semantics like 02-inventory: batches are located by their DEMO
 * remarks token; DRAFT batches are activated, absent batches are created.
 * Animals are keyed by ear_tag and skipped when already present, so MUL100's
 * nine existing demo animals are adopted rather than duplicated.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { BatchService } from '../../../modules/production/batch/batch.service';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import {
  batchBreedOf,
  batchRef,
  earTag,
  farmCanRegisterAnimals,
  pensForRole,
  tagOf,
  type DemoFarm,
} from '../farms';

/**
 * `item_master.standard_cost` is a MySQL decimal, so Drizzle hands it back as
 * a string; the document DTOs take `rate?: number`. Convert once here rather
 * than pushing a string through a numeric field.
 */
function rateOf(standardCost: string | null | undefined): number | undefined {
  return standardCost == null ? undefined : Number(standardCost);
}

const PIGGERY_LOB_ID = '60000000-6000-6000-6000-000000000007';

const ITEM_SOW = 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-SOW-ITM-0001';
const ITEM_BOAR = 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-BOAR-ITM-0001';
const ITEM_GILT = 'LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-GILT-ITM-0001';
const ITEM_SUCKLING = 'LIVESTOCK-BIOLOGICAL_ASSETS-GROWER_FINISHER-PIGLET-ITM-0001';
const ITEM_WEANED = 'LIVESTOCK-BIOLOGICAL_ASSETS-GROWER_FINISHER-PIGLET-ITM-0002';

/** The registered batch's stage, by farm role, first match the breed carries. */
const REGISTERED_STAGE_PREFERENCE: Record<DemoFarm['role'], string[]> = {
  MULTIPLIER: ['GILT_GROWER', 'GESTATION'],
  FARROW_TO_FINISH: ['GILT_GROWER', 'GESTATION'],
  AI_STATION: ['BOAR_AI', 'QUARANTINE'],
  GROW_OUT: [],
};

/** Count-only stages a farm of each role may run, in priority order. */
const COUNT_ONLY_STAGE_PREFERENCE: Record<DemoFarm['role'], string[]> = {
  MULTIPLIER: ['GESTATION', 'WEANER', 'LACTATION'],
  FARROW_TO_FINISH: ['GESTATION', 'WEANER', 'GROWER', 'FINISHER'],
  AI_STATION: ['QUARANTINE'],
  GROW_OUT: ['WEANER', 'GROWER'],
};

/** What a count-only batch of a stage opens with, before the farm's herd scale. */
const COUNT_ONLY_STAGE_FACTS: Record<string, { baseQuantity: number; itemCode: string }> = {
  GESTATION: { baseQuantity: 120, itemCode: ITEM_GILT },
  WEANER: { baseQuantity: 240, itemCode: ITEM_WEANED },
  GROWER: { baseQuantity: 200, itemCode: ITEM_WEANED },
  FINISHER: { baseQuantity: 180, itemCode: ITEM_WEANED },
  LACTATION: { baseQuantity: 60, itemCode: ITEM_SUCKLING },
  QUARANTINE: { baseQuantity: 8, itemCode: ITEM_BOAR },
};

type AnimalKind = 'SOW' | 'BOAR' | 'GILT';

/** Demo facts per animal kind — ages and teat counts, varied deterministically. */
const ANIMAL_FACTS: Record<AnimalKind, { gender: 'F' | 'M'; itemCode: string; baseAgeWeeks: number; ageSpread: number; teats?: number }> = {
  SOW: { gender: 'F', itemCode: ITEM_SOW, baseAgeWeeks: 104, ageSpread: 16, teats: 14 },
  GILT: { gender: 'F', itemCode: ITEM_GILT, baseAgeWeeks: 30, ageSpread: 6, teats: 15 },
  BOAR: { gender: 'M', itemCode: ITEM_BOAR, baseAgeWeeks: 88, ageSpread: 8 },
};

export interface BatchRefs {
  /** Farm code -> the remarks tokens of every demo batch on that farm. */
  byFarm: Map<string, { registered?: string; countOnly: string[] }>;
}

export const batchesAndAnimalsChapter: DemoChapter<BatchRefs> = {
  name: '03-batches-and-animals',

  async run(ctx: DemoContext): Promise<BatchRefs> {
    const batches = ctx.app.get(BatchService);
    const animals = ctx.app.get(AnimalService);
    const receipts = ctx.app.get(GoodsReceiptService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('03-batches-and-animals: tenantDb is not set — run through the harness.');

    /** Livestock item rows, read once. */
    const itemCache = new Map<string, { item_id: string; standard_cost: string | null }>();
    async function item(code: string) {
      const cached = itemCache.get(code);
      if (cached) return cached;
      const [row] = await db
        .select({ item_id: schema.itemMaster.item_id, standard_cost: schema.itemMaster.standard_cost })
        .from(schema.itemMaster)
        .where(and(eq(schema.itemMaster.item_code, code), eq(schema.itemMaster.company_id, ctx.companyId), eq(schema.itemMaster.is_active, true), isNull(schema.itemMaster.deleted_at)))
        .limit(1);
      if (!row) throw new Error(`03-batches: item '${code}' not found for the demo company — the master stages must load it first.`);
      itemCache.set(code, row);
      return row;
    }

    /** Create-activate a batch per its DEMO remarks token, resume-safe. */
    async function ensureBatch(opts: {
      ref: string;
      farm: DemoFarm;
      animalTracking: 'REGISTERED' | 'COUNT_ONLY';
      stageId: string;
      stageCode: string;
      breedId: string;
      startDate: string;
      openingQuantity: number;
      inputLines: { item_id: string; quantity: number; uom: string; rate?: number }[];
    }): Promise<string> {
      const tag = tagOf(opts.farm);
      const [existing] = await db
        .select({ batch_id: schema.batchHeader.batch_id, status: schema.batchHeader.status })
        .from(schema.batchHeader)
        .where(eq(schema.batchHeader.remarks, opts.ref))
        .limit(1);
      if (existing) {
        if (existing.status === 'DRAFT') {
          await batches.activate(existing.batch_id, ctx.tenantId);
          ctx.log(`${tag} batch ${opts.ref} was DRAFT — activated now`);
        } else {
          ctx.log(`${tag} batch ${opts.ref} already ${existing.status} — skipped`);
        }
        return existing.batch_id;
      }

      const created = await batches.create(
        {
          company_id: ctx.companyId,
          lob_id: PIGGERY_LOB_ID,
          farm_id: opts.farm.farmId,
          animal_tracking: opts.animalTracking,
          costing_method: 'BIO_ASSET',
          breed_id: opts.breedId,
          stage_id: opts.stageId,
          auto_generate_scheduler: true,
          start_date: opts.startDate,
          opening_quantity: opts.openingQuantity,
          uom: 'HEAD',
          remarks: opts.ref,
          input_lines: opts.inputLines,
        },
        ctx.tenantId,
      );
      await batches.activate(created.batch_id, ctx.tenantId);
      ctx.log(`${tag} created + activated ${opts.animalTracking} batch ${created.batch_no} at ${opts.stageCode} (${opts.openingQuantity} head)`);
      return created.batch_id;
    }

    const byFarm = new Map<string, { registered?: string; countOnly: string[] }>();

    for (const farm of ctx.demoFarms) {
      const tag = tagOf(farm);
      const breed = batchBreedOf(farm);
      const refs: { registered?: string; countOnly: string[] } = { countOnly: [] };
      byFarm.set(farm.code, refs);

      if (!breed) {
        ctx.log(`${tag} no active breed profile on this farm — no batches (nothing to grow a scheduler from)`);
        continue;
      }

      // The window ends yesterday, so the scheduler owes a full history and
      // the demo shows Missing days and a backlog on screen. Each farm's
      // window is its volume profile's.
      const startDate = new Date(Date.now() - farm.volume.days * 86_400_000).toISOString().slice(0, 10);

      // ── Registered breeding stock.
      const herd: Array<{ kind: AnimalKind; count: number }> = [
        { kind: 'SOW', count: farm.volume.sows },
        { kind: 'GILT', count: farm.volume.gilts },
        { kind: 'BOAR', count: farm.volume.boars },
      ].filter((h) => h.count > 0);

      if (farmCanRegisterAnimals(farm) && herd.length > 0) {
        const stageCode = REGISTERED_STAGE_PREFERENCE[farm.role].find((code) => breed.lifecycleStages.has(code));
        if (!stageCode) {
          ctx.log(`${tag} breed ${breed.code} carries no lifecycle row for any of ${REGISTERED_STAGE_PREFERENCE[farm.role].join('/')} — no registered batch`);
        } else {
          const stageId = breed.lifecycleStages.get(stageCode)!;
          const ref = batchRef(farm.code, 'REG');
          refs.registered = ref;

          // The breeding stock's purchase document, one line per item kind.
          // AnimalService reads each animal's acquisition cost off this
          // receipt's line rate, so every kind in the herd needs a line —
          // including on a farm whose receipt was posted by an earlier,
          // narrower run of this chapter, which is what the top-up covers.
          const receiptRef = `DEMO-${farm.code}-LIVESTOCK`;
          const receiptLines: { item_id: string; quantity: number; uom: string; rate?: number; lot_no: string }[] = [];
          for (const { kind, count } of herd) {
            const row = await item(ANIMAL_FACTS[kind].itemCode);
            receiptLines.push({ item_id: row.item_id, quantity: count, uom: 'HEAD', rate: rateOf(row.standard_cost), lot_no: `DEMO-${farm.code}-${kind}-LOT` });
          }

          /** Create the named receipt with these lines if absent, then post it if DRAFT. */
          async function ensureReceipt(ref: string, lines: typeof receiptLines, remarks: string): Promise<string> {
            let [row] = await db
              .select({ receipt_id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status })
              .from(schema.goodsReceipt)
              .where(eq(schema.goodsReceipt.external_reference_no, ref))
              .limit(1);
            if (!row) {
              const created = await receipts.create(
                {
                  company_id: ctx.companyId,
                  warehouse_id: farm.farmId,
                  posting_date: startDate,
                  external_reference_no: ref,
                  remarks,
                  lines,
                },
                ctx.tenantId,
              );
              row = { receipt_id: created.receipt_id, status: 'DRAFT' };
              ctx.log(`${tag} ${ref} created`);
            }
            if (row.status === 'DRAFT') {
              await receipts.post(row.receipt_id, ctx.tenantId);
              ctx.log(`${tag} ${ref} posted`);
            }
            return row.receipt_id;
          }

          const mainReceiptId = await ensureReceipt(
            receiptRef,
            receiptLines,
            `DEMO breeding stock purchase (${herd.map((h) => `${h.count} ${h.kind.toLowerCase()}`).join(', ')}) into ${farm.code}`,
          );

          // Which items that receipt actually carries — an adopted receipt from
          // an earlier run may predate a kind this profile asks for (MUL100's
          // existing receipt has sows and a boar but no gilts).
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
          if (!batchRow?.stage_id) throw new Error(`03-batches: registered batch on ${farm.code} carries no stage_id.`);

          // An animal's breed must match its batch's, so every head on the
          // farm's registered batch carries the farm's one batch breed —
          // boars included. Flagged for Rishi: a boar of its own sire line on
          // a sow-line batch is not expressible today.
          let created = 0;
          for (const { kind, count } of herd) {
            const facts = ANIMAL_FACTS[kind];
            const pens = kind === 'BOAR'
              ? pensForRole(farm, 'BOAR')
              : kind === 'GILT'
                ? pensForRole(farm, 'GILT', 'GILT_REARING')
                : pensForRole(farm, 'DRY_SOW', 'GILT');
            if (pens.length === 0) throw new Error(`03-batches: ${farm.code} has no pens to stand a ${kind} in.`);
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
        }
      } else if (!farmCanRegisterAnimals(farm)) {
        ctx.log(`${tag} role ${farm.role} holds no registered breeding stock — registered batch skipped`);
      }

      // ── Count-only batches, one per allowed stage the breed carries.
      const stageCodes = COUNT_ONLY_STAGE_PREFERENCE[farm.role]
        .filter((code) => breed.lifecycleStages.has(code))
        .slice(0, farm.volume.countOnlyBatches);
      const unavailable = COUNT_ONLY_STAGE_PREFERENCE[farm.role].filter((code) => !breed.lifecycleStages.has(code));
      if (unavailable.length) {
        ctx.log(`${tag} no lifecycle row on ${breed.code} for ${unavailable.join(', ')} — those count-only batches skipped`);
      }

      for (const stageCode of stageCodes) {
        const facts = COUNT_ONLY_STAGE_FACTS[stageCode];
        if (!facts) {
          ctx.log(`${tag} no demo opening quantity defined for stage ${stageCode} — skipped`);
          continue;
        }
        const input = await item(facts.itemCode);
        const quantity = Math.max(1, Math.round(facts.baseQuantity * farm.volume.herdScale));
        const ref = batchRef(farm.code, `CO-${stageCode}`);
        refs.countOnly.push(ref);
        await ensureBatch({
          ref,
          farm,
          animalTracking: 'COUNT_ONLY',
          stageId: breed.lifecycleStages.get(stageCode)!,
          stageCode,
          // A count-only batch still carries its farm's breed: the
          // auto-generated scheduler only grows lines from
          // breed_lifecycle_stages, which are keyed by breed — without it the
          // scheduler is born empty.
          breedId: breed.breedId,
          startDate,
          openingQuantity: quantity,
          inputLines: [{ item_id: input.item_id, quantity, uom: 'HEAD', rate: rateOf(input.standard_cost) }],
        });
      }
    }

    return { byFarm };
  },
};
