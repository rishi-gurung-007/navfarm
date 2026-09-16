/**
 * Chapter `01-stores-and-items` — Phase 3 Task 3. The masters the postings
 * need before the inventory chapter can run:
 *
 *  1. One `Demo Medicine Store` (STORE) under each of the nine farms, created
 *     through `LocationService.create` — medicines and vaccines receipt into
 *     it in the inventory chapter. seed-nine-farm-demo.ts already issues a
 *     `<CODE>/STORE-001` store by that name on every farm, so on a seeded
 *     tenant this step confirms rather than creates; the create path stays for
 *     a farm that somehow has none. The store is a demo fact, flagged to Rishi
 *     to replace with Triple C's real store locations when supplied.
 *  2. Item valuation triage (Task 3 Step 2): the item rows whose
 *     `valuation_method` is NULL are the legacy synthetic codes (`Piglet`,
 *     `Pig Feed`, `Dressed Pork`, each in tenant and company scope). No demo
 *     chapter posts them — the real feed/medicine/livestock masters already
 *     carry FIFO or BIO_ASSET — so they are left as found and logged, exactly
 *     what the plan's "if an item is unused by any chapter, leave it and log
 *     that" allows. This is a triage, not a silent skip.
 *
 * Rerun-safe: an existing store is detected by name under its farm and
 * skipped, so --force-on-existing development reruns don't multiply stores.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { LocationService } from '../../../modules/master-data/location/location.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { tagOf } from '../farms';

/** Plan Ruling 2: the demo store's fixed name, and the capacity the plan specifies. */
const STORE_NAME = 'Demo Medicine Store';
const STORE_MAX_CAPACITY = 1000;
const STORE_CAPACITY_UOM = 'PCS';

/** Farm code -> the store every later chapter receipts medicine into. */
export type StoresAndItemsResult = Map<string, string>;

export const storesAndItemsChapter: DemoChapter<StoresAndItemsResult> = {
  name: '01-stores-and-items',

  async run(ctx: DemoContext): Promise<StoresAndItemsResult> {
    const locations = ctx.app.get(LocationService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('01-stores-and-items: tenantDb is not set — run through the harness.');

    const stores: StoresAndItemsResult = new Map();

    for (const demoFarm of ctx.demoFarms) {
      const tag = tagOf(demoFarm);
      const [farm] = await db
        .select({ location_id: schema.locationMaster.location_id, location_address: schema.locationMaster.location_address })
        .from(schema.locationMaster)
        .where(and(eq(schema.locationMaster.location_id, demoFarm.farmId), isNull(schema.locationMaster.deleted_at)))
        .limit(1);
      if (!farm) throw new Error(`01-stores-and-items: farm ${demoFarm.code} (${demoFarm.farmId}) not found.`);

      // Rerun-safe: does this farm already carry the demo store? The nine-farm
      // seed's `<CODE>/STORE-001` carries exactly this name, so it is adopted.
      const [existing] = await db
        .select({ location_id: schema.locationMaster.location_id })
        .from(schema.locationMaster)
        .where(and(
          eq(schema.locationMaster.parent_location_id, demoFarm.farmId),
          eq(schema.locationMaster.location_name, STORE_NAME),
          isNull(schema.locationMaster.deleted_at),
        ))
        .limit(1);
      if (existing) {
        stores.set(demoFarm.code, existing.location_id);
        ctx.log(`${tag} ${STORE_NAME} already exists (${existing.location_id}) — skipped`);
        continue;
      }

      // STORE's allowed_parent_types is ["FARM"], so the farm itself is the
      // parent. Address mirrors the farm's, per the plan. The DEMO marker is
      // the name itself: location_master has no remarks column, and no
      // invented address text is added.
      const created = await locations.create(
        {
          company_id: ctx.companyId,
          location_name: STORE_NAME,
          location_type: 'STORE',
          parent_location_id: demoFarm.farmId,
          location_address: farm.location_address || undefined,
          max_capacity: STORE_MAX_CAPACITY,
          capacity_uom: STORE_CAPACITY_UOM,
        },
        ctx.tenantId,
      );
      if (!created?.location_id) throw new Error(`01-stores-and-items: LocationService.create returned no location_id for ${demoFarm.code}.`);
      stores.set(demoFarm.code, created.location_id);
      ctx.log(`${tag} created ${STORE_NAME} (${created.location_id}) — DEMO fact, replace with Triple C's real store when supplied`);
    }

    // Valuation triage (Task 3 Step 2). Report, do not mutate: every NULL
    // valuation row is a legacy synthetic code no chapter posts.
    const nullValuation = await db
      .select({ item_id: schema.itemMaster.item_id, item_code: schema.itemMaster.item_code, item_name: schema.itemMaster.item_name, company_id: schema.itemMaster.company_id })
      .from(schema.itemMaster)
      .where(isNull(schema.itemMaster.valuation_method));
    if (nullValuation.length > 0) {
      ctx.log('  valuation triage: items with NULL valuation_method left as found (no chapter posts them):');
      for (const item of nullValuation) {
        ctx.log(`    ${item.item_code} "${item.item_name}" ${item.company_id ? '(company-scoped)' : '(tenant-scoped)'}`);
      }
    } else {
      ctx.log('  valuation triage: no items with NULL valuation_method — nothing to triage');
    }

    return stores;
  },
};
