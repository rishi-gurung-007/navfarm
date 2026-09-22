/**
 * The demo item catalog for the Triple C company: the category tree and the
 * feed / vaccine / medicine / biological-asset items the breed lifecycles and
 * the demo inventory chapters draw from.
 *
 * Why this exists as its own step: seed-nine-farm-demo.ts refuses to seed a
 * lifecycle whose feed items do not exist, and the item catalog lived only
 * inside seed-piggery-complete-data.ts — the old two-company (APEXBREED/
 * HIGHLAND) seed the rebuild deliberately excludes. The rebuild chain as
 * committed could therefore never run clean from empty: step nine demanded
 * item codes nothing in its own chain produced.
 *
 * The catalog definitions are shared (scripts/lib/seed-item-catalog.ts) and
 * the codes are composed through the ITEM series, exactly as the app does —
 * so a seeded item and an item typed into the Item form come out identical.
 * The legacy hard-coded codes (FEED-...-GESTATION-ITM-0001 and friends) are
 * NOT reproduced: they came from an older subcategory vocabulary and are
 * exactly the hand-written codes the catalog lib warns against. Consumers
 * resolve items by seed key / item name, which code generation cannot move.
 *
 * Triple C is one company, so its catalog is ITEM_CATALOG_1 (the breeding-
 * company set: creep/gestation/lactation feeds, medicines, vaccines, bio
 * assets) plus the three rows only ITEM_CATALOG_2 carried that the nine-farm
 * lifecycles and shed roles need: the grower and finisher diets and Tylosin.
 *
 * Read-only by default; --verify applies inside a transaction and rolls back;
 * --apply commits. Idempotent on item_name / category_name, same as the seed
 * it was extracted from.
 */
import { randomUUID } from 'node:crypto';
import * as mysql from 'mysql2/promise';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';
import { seriesCodeFor } from './lib/seed-series-code';
import {
  ITEM_CATALOG_1,
  ITEM_CATALOG_2,
  ITEM_CATEGORY_CATALOG,
  ITEM_SUBCATEGORY_CATALOG,
  SEED_KEY_BY_ITEM_NAME,
} from './lib/seed-item-catalog';
import { seedItemCategoryTree } from './seed-piggery-complete-data';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const database = process.env.DEV_TENANT_DATABASE || `tenant_${(process.env.DEV_TENANT_CODE || 'devco').toLowerCase()}`;

/**
 * Triple C is one company, so its catalog is both shared catalogues merged:
 * ITEM_CATALOG_1 (the breeding-company set) plus every row of ITEM_CATALOG_2
 * it does not already carry (grower/finisher diets, Tylosin, the weaned
 * piglet the count-only weaner/grower/finisher batches and chapter 03 draw,
 * the finisher bio asset, the dressed carcass). Dedup is by item NAME — what
 * every consumer resolves by — NOT by seed key: the two catalogues reuse the
 * key BIO-SWINE-PIGLET for two different items (the suckling and the weaned
 * piglet), and key-dedup silently dropped the weaned one.
 */
function tripleCCatalog(): typeof ITEM_CATALOG_1 {
  const merged = [...ITEM_CATALOG_1];
  const seen = new Set(ITEM_CATALOG_1.map((i) => i.name));
  for (const item of ITEM_CATALOG_2) {
    if (!seen.has(item.name)) merged.push(item);
  }
  return merged;
}

const VERIFY_ROLLBACK = Symbol('seed-demo-item-catalog:verify-rollback');

/** The company scope every master row must carry to be visible — read, not assumed. */
async function resolveScope(pool: mysql.Pool) {
  // Raw SQL through the pool: this runs before the drizzle context exists and
  // needs GROUP BY over a JSON-free projection, which drizzle's query builder
  // makes awkward.
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT tenant_id, company_id, nob_id, lob_id, COUNT(*) n FROM location_master
      WHERE company_id IS NOT NULL GROUP BY tenant_id, company_id, nob_id, lob_id ORDER BY n DESC LIMIT 1`,
  );
  if (!rows?.length) throw new Error('No company-scoped locations — run db-seed-farm-locations first.');
  return rows[0] as { tenant_id: string; company_id: string; nob_id: string; lob_id: string };
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const mutating = apply || verify;

  const pool = mysql.createPool({ host, port, user, password, database, ssl });
  try {
    const db = drizzle(pool, { schema, mode: 'default' });
    const raw = await resolveScope(pool);
    // seedItemCategoryTree expects camelCase ctx keys; the scope row is snake_case.
    const scope = {
      tenantId: raw.tenant_id,
      companyId: raw.company_id,
      nobId: raw.nob_id,
      lobId: raw.lob_id,
    };

    const catalog = tripleCCatalog();

    const existingItems = await db.select({
      item_id: schema.itemMaster.item_id,
      item_name: schema.itemMaster.item_name,
      item_code: schema.itemMaster.item_code,
    }).from(schema.itemMaster).where(and(
      eq(schema.itemMaster.tenant_id, raw.tenant_id),
      eq(schema.itemMaster.company_id, raw.company_id),
    ));
    const existingByName = new Map(existingItems.map((r) => [r.item_name, r]));

    const plan = {
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      scope: { tenant: raw.tenant_id, company: raw.company_id, nob: raw.nob_id, lob: raw.lob_id },
      categories: ITEM_CATEGORY_CATALOG.length + ITEM_SUBCATEGORY_CATALOG.length,
      itemsToInsert: catalog.filter((i) => !existingByName.has(i.name)).map((i) => i.key),
      itemsAlreadyPresent: catalog.filter((i) => existingByName.has(i.name)).map((i) => existingByName.get(i.name)!.item_code),
    };
    console.log(JSON.stringify(plan, null, 2));
    if (!mutating) {
      console.log('Read-only. No changes attempted.');
      return;
    }

    try {
      await db.transaction(async (tx) => {
      const { categoryIds, categoryCodes, subcategoryCodes } = await seedItemCategoryTree(tx, scope);

      for (const item of catalog) {
        // Matched on the name: the code is generated below, from the ITEM series.
        const existing = existingByName.get(item.name);
        if (existing) continue;
        const categoryId = categoryIds.get(item.cat);
        const subcategoryCode = subcategoryCodes.get(item.sub);
        if (!categoryId || !subcategoryCode) {
          throw new Error(`Missing category mapping for demo item '${item.key}'.`);
        }
        const takenItems = (await tx.select({ code: schema.itemMaster.item_code })
          .from(schema.itemMaster)
          .where(eq(schema.itemMaster.company_id, scope.companyId)))
          .map((r: { code: string }) => r.code);
        const itemCode = (await seriesCodeFor(tx, { tenantId: scope.tenantId, companyId: scope.companyId }, 'ITEM',
          { item_type: item.type, category_id: categoryCodes.get(item.cat) ?? null, sub_category: subcategoryCode }, takenItems)) ?? item.key;
        await tx.insert(schema.itemMaster).values({
          item_id: randomUUID(),
          tenant_id: scope.tenantId,
          company_id: scope.companyId,
          nob_id: scope.nobId,
          lob_id: scope.lobId,
          category_id: categoryId,
          item_code: itemCode,
          item_name: item.name,
          item_type: item.type,
          sub_category: subcategoryCode,
          uom_primary: item.uom,
          valuation_method: item.val,
          standard_cost: item.cost,
          is_biological_asset: item.bio,
          is_inventoriable: true,
          is_active: true,
        });
      }

      // Item Templates (Master Data → Items → Item Templates tab) — one per
      // item type this catalog uses, short-coded (TPL-<TYPE>) same as every
      // other series here. Each gets its OWN modern no_series row (NS-<TYPE>,
      // matching the NS-FEED/NS-MED/NS-RAW naming 0102_add_master_type_to_no_series
      // already seeded master_type for) rather than sharing the generic ITEM
      // series above — a Feed item and a Medicine item created from their own
      // template get their own numbering, not one shared counter.
      const templates: Array<{ code: string; description: string; itemType: string; valuation: string; seriesCode: string; seriesPrefix: string }> = [
        { code: 'TPL-FEED', description: 'Feed', itemType: 'FEED', valuation: 'FIFO', seriesCode: 'NS-FEED', seriesPrefix: 'FEED' },
        { code: 'TPL-RAW', description: 'Raw Material', itemType: 'RAW_MATERIAL', valuation: 'FIFO', seriesCode: 'NS-RAW', seriesPrefix: 'RAW' },
        { code: 'TPL-MED', description: 'Medicine', itemType: 'MEDICINE', valuation: 'FIFO', seriesCode: 'NS-MED', seriesPrefix: 'MED' },
        { code: 'TPL-VAC', description: 'Vaccine', itemType: 'VACCINE', valuation: 'FIFO', seriesCode: 'NS-VAC', seriesPrefix: 'VAC' },
        { code: 'TPL-LVS', description: 'Livestock', itemType: 'LIVESTOCK', valuation: 'STANDARD', seriesCode: 'NS-LVS', seriesPrefix: 'LVS' },
      ];
      const existingModernSeries = await tx.select({ id: schema.noSeries.id, code: schema.noSeries.code })
        .from(schema.noSeries);
      const noSeriesIdByCode = new Map(existingModernSeries.map((r) => [r.code, r.id]));
      const existingTemplates = await tx.select({ template_code: schema.itemTemplate.template_code })
        .from(schema.itemTemplate);
      const existingTemplateCodes = new Set(existingTemplates.map((r) => r.template_code));
      for (const t of templates) {
        let noSeriesId = noSeriesIdByCode.get(t.seriesCode);
        if (!noSeriesId) {
          noSeriesId = randomUUID();
          await tx.insert(schema.noSeries).values({
            id: noSeriesId,
            tenant_id: scope.tenantId,
            company_id: scope.companyId,
            code: t.seriesCode,
            description: `${t.description} Item Code`,
            document_type: 'ITEM',
            master_type: 'ITEM',
            no_series_code: t.seriesPrefix,
            seq_length: 4,
            manual_nos: false,
          });
          noSeriesIdByCode.set(t.seriesCode, noSeriesId);
        }
        if (existingTemplateCodes.has(t.code)) continue;
        await tx.insert(schema.itemTemplate).values({
          id: randomUUID(),
          tenant_id: scope.tenantId,
          company_id: scope.companyId,
          template_code: t.code,
          template_description: t.description,
          no_series_id: noSeriesId,
          item_type: t.itemType,
          valuation_method: t.valuation,
          inventory_type: 'INVENTORY',
          is_active: true,
        });
      }

      if (verify) throw VERIFY_ROLLBACK;
      });
    } catch (err) {
      // Thrown from inside db.transaction() to force the rollback --verify
      // promises; the rollback itself is the success, not a failure.
      if (err !== VERIFY_ROLLBACK) throw err;
    }

    console.log(apply ? 'Committed.' : 'Verified and rolled back. No changes committed.');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  // Drizzle's error.message carries only the failed query text, not the
  // driver's errno/SQLSTATE — print the underlying cause too.
  console.error(err instanceof Error ? err.message : err);
  const cause = (err as any)?.cause;
  if (cause) console.error('Caused by:', cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
