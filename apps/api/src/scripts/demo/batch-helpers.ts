/**
 * Small helpers shared by every demo step that reads the livestock item
 * catalog or creates a batch through BatchService — factored out of chapter
 * `03-batches-and-animals` so `db-seed-animals` (breeding stock only, no
 * headcount batches) can reuse the exact same, already-tested logic rather
 * than a second copy that could drift from it.
 *
 * The app has two batch types and the demo uses each as designed:
 *   BATCH_WISE   — bulk animals bought in as one headcount (`createBatchEnsurer`):
 *                  a bio asset that grows on daily consumption and is later
 *                  harvested or sold. No animal_register rows.
 *   ANIMAL_WISE  — animals already in the Animal Register, picked by id
 *                  (`createAnimalWiseBatchEnsurer`); each keeps its own stage.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import type { BatchService } from '../../modules/production/batch/batch.service';
import * as schema from '../../core/database/schema';
import type { DemoContext } from './chapter';
import type { DemoFarm, DemoShed, ShedRole } from './farms';
import { shedsWithRole, tagOf } from './farms';

/**
 * `item_master.standard_cost` is a MySQL decimal, so Drizzle hands it back as
 * a string; the document DTOs take `rate?: number`. Convert once here rather
 * than pushing a string through a numeric field.
 */
export function rateOf(standardCost: string | null | undefined): number | undefined {
  return standardCost == null ? undefined : Number(standardCost);
}

export type ItemLookup = (name: string) => Promise<{ item_id: string; standard_cost: string | null }>;

/** Livestock item rows, read once per name and cached, by item NAME — see the
 * constants in register-breeding-stock.ts for why name, not item_code. */
export function createItemLookup(db: MySql2Database<typeof schema>, companyId: string): ItemLookup {
  const cache = new Map<string, { item_id: string; standard_cost: string | null }>();
  return async function item(name: string) {
    const cached = cache.get(name);
    if (cached) return cached;
    const [row] = await db
      .select({ item_id: schema.itemMaster.item_id, standard_cost: schema.itemMaster.standard_cost })
      .from(schema.itemMaster)
      .where(and(
        eq(schema.itemMaster.item_name, name),
        eq(schema.itemMaster.company_id, companyId),
        eq(schema.itemMaster.is_active, true),
        isNull(schema.itemMaster.deleted_at),
      ))
      .limit(1);
    if (!row) throw new Error(`demo: item '${name}' not found for the demo company — run db-seed-demo-item-catalog first.`);
    cache.set(name, row);
    return row;
  };
}

/**
 * The shed roles a batch of each stage may stand in, most fitting first. The
 * feed forecast draws a batch's feed from a silo attached to the batch's shed
 * (spec D6-D9), and 02-inventory stocks each silo with the diet of its shed's
 * role (FEED_BY_SHED_ROLE there): gestation mash for dry-sow and boar houses,
 * lactation diet for farrowing, grower mash for gilt, weaner and grower
 * houses, finisher feed for finishers. So placing a batch by this map puts it
 * next to a silo that holds the item its stage's lifecycle row eats — checked
 * against the demo sow and boar lines' breed_lifecycle_stages on nf_devco.
 * WEANING (creep feed, which no demo silo holds) and the exit stages are left
 * out on purpose: the demo never opens a batch at them.
 */
export const SHED_ROLES_BY_STAGE: Readonly<Record<string, readonly ShedRole[]>> = {
  GESTATION: ['DRY_SOW'],
  FLUSH: ['DRY_SOW'],
  INSEMINATION: ['DRY_SOW'],
  DRY_SOW: ['DRY_SOW'],
  PRODUCTIVE_SOW: ['DRY_SOW'],
  FARROWING: ['FARROWING'],
  LACTATION: ['FARROWING'],
  GILT_GROWER: ['GILT', 'GILT_REARING'],
  WEANER: ['WEANER'],
  GROWER: ['GROWER'],
  FINISHER: ['FINISHER'],
  QUARANTINE: ['BOAR'],
  BOAR_AI: ['BOAR'],
};

/**
 * The shed a new demo batch of this stage stands in: the first shed of a
 * matching role, in code order, that has a silo; failing that the first
 * matching shed without one (its feed then comes from the farm store, D6);
 * failing that null, which the forecast reports honestly as BATCH_SHED_UNKNOWN.
 */
export function shedForStage(farm: DemoFarm, stageCode: string): DemoShed | null {
  const roles = SHED_ROLES_BY_STAGE[stageCode];
  if (!roles) return null;
  const candidates = shedsWithRole(farm, ...roles);
  return candidates.find((s) => s.siloId !== null) ?? candidates[0] ?? null;
}

export interface EnsureBatchOpts {
  ref: string;
  farm: DemoFarm;
  stageId: string;
  stageCode: string;
  breedId: string;
  startDate: string;
  openingQuantity: number;
  inputLines: { item_id: string; quantity: number; uom: string; rate?: number }[];
}

export type BatchEnsurer = (opts: EnsureBatchOpts) => Promise<string>;

const PIGGERY_LOB_ID = '60000000-6000-6000-6000-000000000007';

/** Create-activate a batch per its DEMO remarks token, resume-safe. */
export function createBatchEnsurer(db: MySql2Database<typeof schema>, batches: BatchService, ctx: DemoContext): BatchEnsurer {
  return async function ensureBatch(opts: EnsureBatchOpts): Promise<string> {
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

    // Placed at create time, not after: the auto-generated scheduler header
    // copies the batch's shed as it is built, and the forecast finds a batch's
    // silo through that shed. A batch with no shed would draw on the store.
    const shed = shedForStage(opts.farm, opts.stageCode);
    if (!shed) ctx.log(`${tag} no shed carries stage ${opts.stageCode} — batch ${opts.ref} left unplaced (forecast: BATCH_SHED_UNKNOWN)`);
    else if (!shed.siloId) ctx.log(`${tag} shed ${shed.code} for stage ${opts.stageCode} has no silo — batch ${opts.ref} will draw on the store`);

    const created = await batches.create(
      {
        company_id: ctx.companyId,
        lob_id: PIGGERY_LOB_ID,
        // BATCH_WISE: bulk animals as one headcount (input_lines + opening_quantity),
        // costed as a bio asset. It creates no animal_register rows — animals taken
        // from the register go in an ANIMAL_WISE batch instead.
        tracking_mode: 'BATCH_WISE',
        costing_method: 'BIO_ASSET',
        breed_id: opts.breedId,
        stage_id: opts.stageId,
        ...(shed ? { shed_id: shed.shedId } : {}),
        auto_generate_scheduler: true,
        start_date: opts.startDate,
        opening_quantity: opts.openingQuantity,
        uom: 'HEAD',
        remarks: opts.ref,
        input_lines: opts.inputLines,
      },
      ctx.tenantId,
    );
    // BatchService.create() derives farm_id only from a placed shed (NULL when
    // shedForStage found none — the seed runs with no active farm in CLS), so an
    // unplaced batch still needs its farm written.
    await db
      .update(schema.batchHeader)
      .set({ farm_id: opts.farm.farmId })
      .where(eq(schema.batchHeader.batch_id, created.batch_id));
    await batches.activate(created.batch_id, ctx.tenantId);
    ctx.log(`${tag} created + activated BATCH_WISE (headcount) batch ${created.batch_no} at ${opts.stageCode} in ${shed?.code ?? 'no shed'} (${opts.openingQuantity} head)`);
    return created.batch_id;
  };
}


export interface EnsureAnimalWiseBatchOpts {
  ref: string;
  farm: DemoFarm;
  breedId: string;
  /** The shed the batch is placed in; its silos feed every stage's scheduler. */
  shed: DemoShed | null;
  startDate: string;
  /** Animal_register ids, already created and not yet in any batch. */
  animalIds: string[];
}

export type AnimalWiseBatchEnsurer = (opts: EnsureAnimalWiseBatchOpts) => Promise<string>;

/**
 * Create-activate an ANIMAL_WISE batch per its DEMO remarks token, resume-safe.
 * The animals are chosen from the register (`animal_ids`), so there is no
 * opening quantity, no input line and no acquisition posting: their cost is
 * already on the goods receipt each animal was registered against. One
 * scheduler is created per distinct stage the animals stand in.
 */
export function createAnimalWiseBatchEnsurer(db: MySql2Database<typeof schema>, batches: BatchService, ctx: DemoContext): AnimalWiseBatchEnsurer {
  return async function ensureAnimalWiseBatch(opts: EnsureAnimalWiseBatchOpts): Promise<string> {
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
    if (opts.animalIds.length === 0) throw new Error(`demo: ${opts.ref} has no unassigned animals to build an Animal Wise batch from.`);

    const created = await batches.create(
      {
        company_id: ctx.companyId,
        lob_id: PIGGERY_LOB_ID,
        tracking_mode: 'ANIMAL_WISE',
        costing_method: 'BIO_ASSET',
        breed_id: opts.breedId,
        ...(opts.shed ? { shed_id: opts.shed.shedId } : {}),
        start_date: opts.startDate,
        uom: 'HEAD',
        remarks: opts.ref,
        animal_ids: opts.animalIds,
      },
      ctx.tenantId,
    );
    await db
      .update(schema.batchHeader)
      .set({ farm_id: opts.farm.farmId })
      .where(eq(schema.batchHeader.batch_id, created.batch_id));
    await batches.activate(created.batch_id, ctx.tenantId);
    ctx.log(`${tag} created + activated ANIMAL_WISE batch ${created.batch_no} from the register (${opts.animalIds.length} animal(s), shed ${opts.shed?.code ?? 'none'})`);
    return created.batch_id;
  };
}
