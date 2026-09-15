/**
 * Chapter `01-stores-and-items` — Phase 3 Task 3. The masters the postings
 * need before the inventory chapter can run:
 *
 *  1. One `Demo Medicine Store` (STORE) under each farm, created through
 *     `LocationService.create` — medicines and vaccines receipt into it in the
 *     inventory chapter. Neither live farm has an active STORE today (plan
 *     Ruling 2), and the store is a demo fact: flagged to Rishi to replace
 *     with Triple C's real store locations when supplied.
 *  2. Item valuation triage (Task 3 Step 2): the six item rows whose
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

/** Plan Ruling 2: the demo store's fixed name, and the capacity the plan specifies. */
const STORE_NAME = 'Demo Medicine Store';
const STORE_MAX_CAPACITY = 1000;
const STORE_CAPACITY_UOM = 'PCS';

interface FarmStores {
  grasmere: string;
  kintyre: string;
}

export interface StoresAndItemsResult extends FarmStores {}

export const storesAndItemsChapter: DemoChapter & { run: (ctx: DemoContext) => Promise<StoresAndItemsResult> } = {
  name: '01-stores-and-items',

  async run(ctx: DemoContext): Promise<StoresAndItemsResult> {
    const locations = ctx.app.get(LocationService);
    const cls = ctx.app.get(ClsService);
    const tenantDb = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('01-stores-and-items: tenantDb is not set — run through the harness.');

    const stores: FarmStores = { grasmere: '', kintyre: '' };

    for (const [farmKey, farmId] of [
      ['grasmere', ctx.farms.grasmere],
      ['kintyre', ctx.farms.kintyre],
    ] as const) {
      const [farm] = await tenantDb
        .select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code, location_name: schema.locationMaster.location_name, location_address: schema.locationMaster.location_address })
        .from(schema.locationMaster)
        .where(and(eq(schema.locationMaster.location_id, farmId), isNull(schema.locationMaster.deleted_at)))
        .limit(1);
      if (!farm) throw new Error(`01-stores-and-items: farm ${farmId} not found.`);

      // Rerun-safe: does this farm already carry the demo store?
      const [existing] = await tenantDb
        .select({ location_id: schema.locationMaster.location_id })
        .from(schema.locationMaster)
        .where(and(
          eq(schema.locationMaster.parent_location_id, farmId),
          eq(schema.locationMaster.location_name, STORE_NAME),
          isNull(schema.locationMaster.deleted_at),
        ))
        .limit(1);
      if (existing) {
        stores[farmKey] = existing.location_id;
        ctx.log(`  ${farm.location_code}: ${STORE_NAME} already exists (${existing.location_id}) — skipped`);
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
          parent_location_id: farmId,
          location_address: farm.location_address || undefined,
          max_capacity: STORE_MAX_CAPACITY,
          capacity_uom: STORE_CAPACITY_UOM,
        },
        ctx.tenantId,
      );
      if (!created?.location_id) throw new Error(`01-stores-and-items: LocationService.create returned no location_id for ${farm.location_code}.`);
      stores[farmKey] = created.location_id;
      ctx.log(`  ${farm.location_code}: created ${STORE_NAME} (${created.location_id}) — DEMO fact, replace with Triple C's real store when supplied`);
    }

    // Valuation triage (Task 3 Step 2). Report, do not mutate: every NULL
    // valuation row is a legacy synthetic code no chapter posts.
    const nullValuation = await tenantDb
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
