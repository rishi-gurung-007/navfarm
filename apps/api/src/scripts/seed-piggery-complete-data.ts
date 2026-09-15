import { randomUUID } from 'node:crypto';
import * as mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { eq, and, inArray } from 'drizzle-orm';
import * as schema from '../core/database/schema';
import { seriesCodeFor } from './lib/seed-series-code';
import {
  ITEM_CATALOG_1,
  ITEM_CATALOG_2,
  ITEM_CATEGORY_CATALOG,
  ITEM_SUBCATEGORY_CATALOG,
  loadItemsByKey,
} from './lib/seed-item-catalog';
import { seedLocation, type SeededLocation } from './lib/seed-location';

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const masterDatabase = process.env.DATABASE_NAME || 'navfarm_master';
const isPiggeryIsolated = masterDatabase.startsWith('piggery_');
const tenantCode = process.env.DEV_TENANT_CODE || 'devco';
const dbName = isPiggeryIsolated ? `piggery_tenant_${tenantCode}` : `tenant_${tenantCode}`;

async function seedItemCategoryTree(
  db: any,
  ctx: { tenantId: string; companyId: string; nobId: string; lobId: string },
) {
  const categoryIds = new Map<string, string>();
  const categoryCodes = new Map<string, string>();
  const subcategoryCodes = new Map<string, string>();

  for (const category of ITEM_CATEGORY_CATALOG) {
    const [existing] = await db.select().from(schema.itemCategoryMaster).where(and(
      eq(schema.itemCategoryMaster.company_id, ctx.companyId),
      eq(schema.itemCategoryMaster.category_name, category.name),
    )).limit(1);

    let id = existing?.category_id;
    let code = existing?.category_code;
    if (!existing) {
      id = randomUUID();
      const taken = (await db.select({ code: schema.itemCategoryMaster.category_code })
        .from(schema.itemCategoryMaster)
        .where(eq(schema.itemCategoryMaster.company_id, ctx.companyId)))
        .map((row: { code: string }) => row.code);
      code = (await seriesCodeFor(db, { tenantId: ctx.tenantId, companyId: ctx.companyId }, 'ITEM_CATEGORY',
        { category_name: category.name }, taken)) ?? category.key;
      await db.insert(schema.itemCategoryMaster).values({
        category_id: id,
        tenant_id: ctx.tenantId,
        company_id: ctx.companyId,
        nob_id: ctx.nobId,
        lob_id: ctx.lobId,
        category_code: code,
        category_name: category.name,
        item_type: category.itemType,
        is_active: true,
      });
    } else {
      // These are root categories. An older detail pass incorrectly parented the
      // commercial biological-assets root under the breeding root, hiding it
      // from the Item form's rootOnly category picker.
      await db.update(schema.itemCategoryMaster).set({
        parent_category_id: null,
        item_type: category.itemType,
        nob_id: existing.nob_id ?? ctx.nobId,
        lob_id: existing.lob_id ?? ctx.lobId,
      }).where(eq(schema.itemCategoryMaster.category_id, id));
    }
    categoryIds.set(category.key, id!);
    categoryCodes.set(category.key, code!);
  }

  for (const subcategory of ITEM_SUBCATEGORY_CATALOG) {
    const parentId = categoryIds.get(subcategory.parent);
    if (!parentId) throw new Error(`Missing demo parent category '${subcategory.parent}'.`);
    const parent = ITEM_CATEGORY_CATALOG.find((row) => row.key === subcategory.parent)!;
    const [existing] = await db.select().from(schema.itemCategoryMaster).where(and(
      eq(schema.itemCategoryMaster.company_id, ctx.companyId),
      eq(schema.itemCategoryMaster.category_name, subcategory.name),
    )).limit(1);

    let code = existing?.category_code;
    if (!existing) {
      const taken = (await db.select({ code: schema.itemCategoryMaster.category_code })
        .from(schema.itemCategoryMaster)
        .where(eq(schema.itemCategoryMaster.company_id, ctx.companyId)))
        .map((row: { code: string }) => row.code);
      code = (await seriesCodeFor(db, { tenantId: ctx.tenantId, companyId: ctx.companyId }, 'ITEM_CATEGORY',
        { category_name: subcategory.name }, taken)) ?? subcategory.key;
      await db.insert(schema.itemCategoryMaster).values({
        category_id: randomUUID(),
        tenant_id: ctx.tenantId,
        company_id: ctx.companyId,
        nob_id: ctx.nobId,
        lob_id: ctx.lobId,
        category_code: code,
        category_name: subcategory.name,
        parent_category_id: parentId,
        item_type: parent.itemType,
        is_active: true,
      });
    } else {
      await db.update(schema.itemCategoryMaster).set({
        parent_category_id: parentId,
        item_type: parent.itemType,
        nob_id: existing.nob_id ?? ctx.nobId,
        lob_id: existing.lob_id ?? ctx.lobId,
      }).where(eq(schema.itemCategoryMaster.category_id, existing.category_id));
    }
    subcategoryCodes.set(subcategory.key, code!);
  }

  return { categoryIds, categoryCodes, subcategoryCodes };
}

export async function seedPiggeryData() {
  console.log(`Starting comprehensive piggery multi-company master & operational data seed into ${dbName}...`);
  const pool = mysql.createPool({ host, port, user, password, database: dbName, ssl });
  const db = drizzle(pool, { schema, mode: 'default' });

  try {
    // 1. Get Tenant & Company Contexts
    const companies = await db.select().from(schema.companyMaster);
    if (companies.length === 0) {
      throw new Error(`No companies found in ${dbName}. Run db-seed-dev-tenant first.`);
    }

    const company1 = companies.find((c) => c.company_code === 'APEXBREED') || companies[0];
    const company2 = companies.find((c) => c.company_code === 'HIGHLAND') || companies[1] || companies[0];
    const tenantId = company1.tenant_id;

    // Users, by the scope they hold rather than by email. The emails moved when
    // the demo was renamed to Triple C, and this fell back to the nil UUID —
    // which is not a user, so every row created "by" it failed its foreign key
    // with nothing to say why.
    const [tAdmin] = await db.select().from(schema.userMaster).where(eq(schema.userMaster.user_type, 'TENANT_ADMIN')).limit(1);
    const [c1Admin] = await db.select().from(schema.userMaster).where(eq(schema.userMaster.user_type, 'COMPANY_ADMIN')).limit(1);
    const [opAdmin] = await db.select().from(schema.userMaster).where(eq(schema.userMaster.user_type, 'OPERATIONAL_ADMIN')).limit(1);
    const [stdUser] = await db.select().from(schema.userMaster).where(eq(schema.userMaster.user_type, 'STANDARD_USER')).limit(1);
    if (!tAdmin) throw new Error('No TENANT_ADMIN found — run the dev tenant seed first.');

    const tAdminId = tAdmin.user_id;
    const c1AdminId = c1Admin?.user_id || tAdminId;
    const c2AdminId = c1AdminId;
    const opAdminId = opAdmin?.user_id || tAdminId;

    const [nob] = await db.select().from(schema.nobMaster).where(eq(schema.nobMaster.nob_code, 'LIVESTOCK')).limit(1);
    const [lob] = await db.select().from(schema.lobMaster).where(eq(schema.lobMaster.lob_code, 'LVS_PIGGERY')).limit(1);
    if (!nob || !lob) {
      throw new Error('NOB LIVESTOCK or LOB LVS_PIGGERY not found.');
    }
    const nobId = nob.nob_id;
    const lobId = lob.lob_id;

    // Breeds & Stages
    const breeds = await db.select().from(schema.breedMaster);
    const yorkshire = breeds.find((b) => b.breed_code === 'YORKSHIRE') || breeds[0];
    const landrace = breeds.find((b) => b.breed_code === 'LANDRACE') || breeds[0];
    const duroc = breeds.find((b) => b.breed_code === 'DUROC') || breeds[0];
    const largeWhite = breeds.find((b) => b.breed_code === 'LARGE_WHITE') || breeds[0];

    const stages = await db.select().from(schema.stageMaster);
    const stageByCode = new Map(stages.map((s) => [s.stage_code, s]));
    // Say which stage is missing. The stage master was realigned to the TDD
    // once already, and this script kept asking for the old names — every fresh
    // seed then died on `stage!.stage_id` with nothing to say what was wrong.
    const stageOf = (code: string) => {
      const found = stageByCode.get(code);
      if (!found) {
        throw new Error(
          `Stage '${code}' is not in this tenant's stage master. Seeded stages: ${[...stageByCode.keys()].sort().join(', ')}. ` +
          `The stage master was realigned to the TDD; update this script's stage codes to match.`
        );
      }
      return found;
    };

    console.log(`Context: Tenant ${tenantId}`);
    console.log(`  - Company 1: ${company1.company_name} (${company1.company_code})`);
    console.log(`  - Company 2: ${company2.company_name} (${company2.company_code})`);

    // =========================================================================
    // ═════════════════════════════════════════════════════════════════════════
    // 🏢 COMPANY 1: APEX SWINE GENETICS & BREEDING PVT LTD
    // ═════════════════════════════════════════════════════════════════════════
    // =========================================================================
    console.log('\n📦 Seeding Company 1 (Apex Swine Genetics & Breeding)...');
    const comp1Id = company1.company_id;

    // 1.1 Cost Centers
    const ccData1 = [
      { code: 'CC-APEX-01', name: 'Apex Nucleus Breeding Complex', type: 'FARM', parentCode: null },
      { code: 'CC-BREEDING', name: 'Breeding & Gestation Unit', type: 'DEPARTMENT', parentCode: 'CC-APEX-01' },
      { code: 'CC-FARROWING', name: 'Farrowing & Nursery Barn', type: 'DEPARTMENT', parentCode: 'CC-APEX-01' },
      { code: 'CC-FEEDMILL-A', name: 'Apex On-Farm Feed Processing Mill', type: 'WAREHOUSE', parentCode: 'CC-APEX-01' },
      { code: 'CC-ADMIN-A', name: 'Farm Administration & Veterinary Services', type: 'DEPARTMENT', parentCode: 'CC-APEX-01' },
    ];
    const ccMap1 = new Map<string, string>();
    for (const cc of ccData1.filter((c) => !c.parentCode)) {
      const [existingCC] = await db.select().from(schema.costCenterMaster).where(and(eq(schema.costCenterMaster.company_id, comp1Id), eq(schema.costCenterMaster.cost_center_code, cc.code))).limit(1);
      let ccId = existingCC?.cost_center_id;
      if (!existingCC) {
        ccId = randomUUID();
        await db.insert(schema.costCenterMaster).values({ cost_center_id: ccId, tenant_id: tenantId, company_id: comp1Id, cost_center_code: cc.code, cost_center_name: cc.name, cost_center_type: cc.type, is_active: true });
      }
      ccMap1.set(cc.code, ccId!);
    }
    for (const cc of ccData1.filter((c) => c.parentCode)) {
      const [existingCC] = await db.select().from(schema.costCenterMaster).where(and(eq(schema.costCenterMaster.company_id, comp1Id), eq(schema.costCenterMaster.cost_center_code, cc.code))).limit(1);
      let ccId = existingCC?.cost_center_id;
      if (!existingCC) {
        ccId = randomUUID();
        await db.insert(schema.costCenterMaster).values({ cost_center_id: ccId, tenant_id: tenantId, company_id: comp1Id, cost_center_code: cc.code, cost_center_name: cc.name, cost_center_type: cc.type, parent_cost_center_id: ccMap1.get(cc.parentCode!), is_active: true });
      }
      ccMap1.set(cc.code, ccId!);
    }

    // 1.2 Farm, Sheds & Pens
    // The farm is a LOCATION (location_type FARM), not a farm_master row.
    // seed-dev-tenant already created it; reuse it rather than minting a
    // second identity. This block used to insert straight into farm_master
    // with a fresh randomUUID(), leaving a mirror with no location behind it.
    const locCtx1 = { tenantId, companyId: comp1Id, nobId, lobId };
    const farmLoc1 = await seedLocation(db, locCtx1, {
      key: 'FARM-01', name: 'Triple C Farm', type: 'FARM', capacity: 165,
    });
    const farm1Id = farmLoc1.id;

    // Operational Area 1: APEX-BREED-01
    // The company's operational area, seeded by the dev tenant. This used to
    // insert APEX-BREED-01 of its own, so a full chain produced three areas
    // where the demo is meant to have one.
    const [area1] = await db.select().from(schema.operationalAreaMaster)
      .where(eq(schema.operationalAreaMaster.company_id, comp1Id)).limit(1);
    if (!area1) throw new Error('No operational area for this company — run db-seed-dev-tenant first.');
    const area1Id = area1.area_id;

    const shedConfigs1 = [
      { code: 'SHED-GEST-01', name: 'Breeding & Gestation Complex', type: 'GESTATION', cap: 71 },
      { code: 'SHED-FARR-02', name: 'Farrowing & Early Weaner Barn', type: 'FARROWING', cap: 94 },
    ];
    const shedMap1 = new Map<string, SeededLocation>();
    for (const sc of shedConfigs1) {
      shedMap1.set(sc.code, await seedLocation(db, locCtx1, {
        key: sc.code, name: sc.name, type: 'SHED', parent: farmLoc1, subType: sc.type, capacity: sc.cap,
      }));
    }

    const penConfigs1 = [
      { code: 'PEN-GEST-A1', name: 'Gestation Stalls Bank A', shedCode: 'SHED-GEST-01', cap: 30, uom: 'HEAD', cleaned: '2026-08-10', disinfected: '2026-08-11' },
      { code: 'PEN-AI-B2', name: 'AI Insemination Service Bay', shedCode: 'SHED-GEST-01', cap: 15, uom: 'HEAD', cleaned: '2026-08-15', disinfected: '2026-08-16' },
      { code: 'PEN-BOAR-C1', name: 'Herd Sire Boar Stud Suite', shedCode: 'SHED-GEST-01', cap: 6, uom: 'HEAD', cleaned: '2026-08-12', disinfected: '2026-08-13' },
      { code: 'PEN-FARR-01', name: 'Farrowing Crate Bank 1', shedCode: 'SHED-FARR-02', cap: 14, uom: 'HEAD', cleaned: '2026-08-01', disinfected: '2026-08-02' },
      { code: 'PEN-WEAN-02', name: 'Weaner Flat-Deck Nursery', shedCode: 'SHED-FARR-02', cap: 80, uom: 'HEAD', cleaned: '2026-07-28', disinfected: '2026-07-29' },
      { code: 'PEN-QUAR-01', name: 'Biosecurity Isolation Pen', shedCode: 'SHED-GEST-01', cap: 20, uom: 'HEAD', cleaned: '2026-08-18', disinfected: '2026-08-19' },
    ];
    const penMap1 = new Map<string, string>();
    for (const pc of penConfigs1) {
      // Parented to its shed, so location_level falls out of the depth instead
      // of being hardcoded to 3 on every pen.
      const pen = await seedLocation(db, locCtx1, {
        key: pc.code, name: pc.name, type: 'PEN', parent: shedMap1.get(pc.shedCode)!,
        capacity: pc.cap, capacityUom: pc.uom,
        lastCleanedDate: pc.cleaned, lastDisinfectedDate: pc.disinfected,
      });
      penMap1.set(pc.code, pen.id);
    }

    // 1.3 Item Categories & Items for Company 1
    // `key` is this script's own handle, used to wire items to their category.
    // The stored category_code comes from the ITEM_CATEGORY series, which
    // composes the category's own name — these used to be hand-written CAT-*
    // codes the series could never have produced.
    const {
      categoryIds: catMap1,
      categoryCodes: catMap1Code,
      subcategoryCodes: subcatMap1Code,
    } = await seedItemCategoryTree(db, { tenantId, companyId: comp1Id, nobId, lobId });

    const itemMap1 = new Map<string, string>();
    for (const item of ITEM_CATALOG_1) {
      // Matched on the name: the code is generated below, from the ITEM series.
      const [existingItem] = await db.select().from(schema.itemMaster).where(and(eq(schema.itemMaster.company_id, comp1Id), eq(schema.itemMaster.item_name, item.name))).limit(1);
      let itId = existingItem?.item_id;
      if (!existingItem) {
        itId = randomUUID();
        const categoryId = catMap1.get(item.cat);
        const subcategoryCode = subcatMap1Code.get(item.sub);
        if (!categoryId || !subcategoryCode) {
          throw new Error(`Missing category mapping for demo item '${item.key}'.`);
        }
        const takenItems = (await db.select({ code: schema.itemMaster.item_code }).from(schema.itemMaster).where(eq(schema.itemMaster.company_id, comp1Id))).map((r: { code: string }) => r.code);
        const itemCode = (await seriesCodeFor(db, { tenantId, companyId: comp1Id }, 'ITEM',
          { item_type: item.type, category_id: catMap1Code.get(item.cat) ?? null, sub_category: subcategoryCode }, takenItems)) ?? item.key;
        await db.insert(schema.itemMaster).values({
          item_id: itId, tenant_id: tenantId, company_id: comp1Id, category_id: categoryId, nob_id: nobId, lob_id: lobId, item_code: itemCode, item_name: item.name, item_type: item.type, sub_category: subcategoryCode, uom_primary: item.uom, valuation_method: item.val, standard_cost: item.cost, is_biological_asset: item.bio, is_inventoriable: true, is_active: true,
        });
      } else {
        const categoryId = catMap1.get(item.cat);
        const subcategoryCode = subcatMap1Code.get(item.sub);
        if (!categoryId || !subcategoryCode) throw new Error(`Missing category mapping for demo item '${item.key}'.`);
        await db.update(schema.itemMaster).set({ category_id: categoryId, sub_category: subcategoryCode })
          .where(eq(schema.itemMaster.item_id, itId!));
      }
      itemMap1.set(item.key, itId!);
    }

    // 1.4 Production Parameters & Schedulers for Company 1
    // One parameter per feeding phase. The rate lives on the parameter as
    // default_qty_per_unit (kg per head per day) and the scheduler line leaves
    // expected_qty_override null, so computeExpectedQty() multiplies by the
    // batch's opening head count. Putting the per-head figure in the override
    // instead made the data-entry screen ask a 20-sow batch for 2.2 kg of feed.
    const paramConfigs1 = [
      { code: 'PARAM-FEED-QUAR-SOW',   name: 'Quarantine Intake Ration',        type: 'CONSUMPTION', itemCode: 'FEED-GEST-SOW',  uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '1.50000000', isMandatory: true },
      { code: 'PARAM-FEED-GILT',       name: 'Gilt Grower Ration',              type: 'CONSUMPTION', itemCode: 'FEED-GEST-SOW',  uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '2.20000000', isMandatory: true },
      { code: 'PARAM-FEED-FLUSH',      name: 'Flush Ration (Pre-Service)',      type: 'CONSUMPTION', itemCode: 'FEED-GEST-SOW',  uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '3.00000000', isMandatory: true },
      { code: 'PARAM-FEED-GEST-EARLY', name: 'Early Gestation Ration',          type: 'CONSUMPTION', itemCode: 'FEED-GEST-SOW',  uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '2.00000000', isMandatory: true },
      { code: 'PARAM-FEED-GEST-MID',   name: 'Mid Gestation Ration',            type: 'CONSUMPTION', itemCode: 'FEED-GEST-SOW',  uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '2.20000000', isMandatory: true },
      { code: 'PARAM-FEED-GEST-LATE',  name: 'Late Gestation Ration',           type: 'CONSUMPTION', itemCode: 'FEED-GEST-SOW',  uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '2.80000000', isMandatory: true },
      { code: 'PARAM-FEED-PREFARROW',  name: 'Pre-Farrow Transition Ration',    type: 'CONSUMPTION', itemCode: 'FEED-LACT-SOW',  uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '2.00000000', isMandatory: true },
      { code: 'PARAM-FEED-FARROW-DAY', name: 'Farrowing Day Ration',            type: 'CONSUMPTION', itemCode: 'FEED-LACT-SOW',  uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '1.50000000', isMandatory: true },
      { code: 'PARAM-FEED-LACT-EARLY', name: 'Early Lactation Ration',          type: 'CONSUMPTION', itemCode: 'FEED-LACT-SOW',  uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '4.00000000', isMandatory: true },
      { code: 'PARAM-FEED-LACT-PEAK',  name: 'Peak Lactation Ration',           type: 'CONSUMPTION', itemCode: 'FEED-LACT-SOW',  uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '6.50000000', isMandatory: true },
      { code: 'PARAM-FEED-LACT-WEAN',  name: 'Pre-Wean Stepdown Ration',        type: 'CONSUMPTION', itemCode: 'FEED-LACT-SOW',  uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '5.00000000', isMandatory: true },
      { code: 'PARAM-FEED-CREEP',      name: 'Piglet Creep Pre-Starter',        type: 'CONSUMPTION', itemCode: 'FEED-CREEP-PRE', uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '0.35000000', isMandatory: false },
      { code: 'PARAM-MORT-PIG',        name: 'Swine Daily Mortality',           type: 'MORTALITY',   itemCode: null,             uom: 'HEAD', method: 'MANUAL_AT_ENTRY', defaultQtyUnit: null,         isMandatory: true },
      { code: 'PARAM-WATER-PIG',       name: 'Swine Daily Water Intake',        type: 'CONSUMPTION', itemCode: null,             uom: 'LTR',  method: 'PER_UNIT',        defaultQtyUnit: '15.00000000', isMandatory: false },
      { code: 'PARAM-LABOUR-PIG',      name: 'Direct Farm Labour Hours',        type: 'OVERHEAD',    itemCode: null,             uom: 'HRS',  method: 'PER_BATCH',       defaultQtyUnit: null,         isMandatory: false, perBatch: '6.00000000' },
      { code: 'PARAM-POWER-PIG',       name: 'Ventilation & Lighting Power',    type: 'OVERHEAD',    itemCode: null,             uom: 'KWH',  method: 'PER_BATCH',       defaultQtyUnit: null,         isMandatory: false, perBatch: '320.00000000' },
      { code: 'PARAM-BODYWT-PIG',      name: 'Average Body Weight',             type: 'OBSERVATION', itemCode: null,             uom: 'KG',   method: 'MANUAL_AT_ENTRY', defaultQtyUnit: null,         isMandatory: false },
      { code: 'PARAM-MED-DEWORM',      name: 'Strategic Deworming (Ivermectin)', type: 'CONSUMPTION', itemCode: 'MED-IVERMECTIN', uom: 'ML',   method: 'PER_UNIT',        defaultQtyUnit: '2.00000000', isMandatory: false },
      { code: 'PARAM-MED-IRON',        name: 'Piglet Iron Dextran',              type: 'CONSUMPTION', itemCode: 'MED-IRON-DEX',   uom: 'ML',   method: 'PER_UNIT',        defaultQtyUnit: '2.00000000', isMandatory: false },
    ];
    const paramMap1 = new Map<string, string>();
    for (const p of paramConfigs1) {
      const [existingParam] = await db.select().from(schema.parameterMaster).where(and(eq(schema.parameterMaster.company_id, comp1Id), eq(schema.parameterMaster.parameter_code, p.code))).limit(1);
      let pId = existingParam?.parameter_id;
      if (!existingParam) {
        pId = randomUUID();
        await db.insert(schema.parameterMaster).values({
          parameter_id: pId, tenant_id: tenantId, company_id: comp1Id, nob_id: nobId, lob_id: lobId, parameter_code: p.code, parameter_name: p.name, parameter_type: p.type, item_id: p.itemCode ? itemMap1.get(p.itemCode) : null, default_uom: p.uom, qty_method: p.method, default_qty_per_unit: p.defaultQtyUnit, default_qty_per_batch: (p as any).perBatch ?? null, is_mandatory: p.isMandatory, is_active: true, created_by: c1AdminId,
        });
      }
      paramMap1.set(p.code, pId!);
    }

    // Schedulers are now batch-level (scheduler_header/scheduler_line) generated
    // via backfill-scheduler-headers or on stage transfer.


    // 1.5 Tagged Swine Herd Animals (15 Head)
    const animalConfigs1 = [
      { code: 'PIG-2026-0001', type: 'SOW', breed: yorkshire, gender: 'F', tag: 'SOW-YK-001', rfid: '982000412880001', stage: 'GESTATION', parity: 2, born: 24, weaned: 22, cost: '28000.0000', loc: 'PEN-GEST-A1', status: 'PREGNANT' },
      { code: 'PIG-2026-0002', type: 'SOW', breed: landrace, gender: 'F', tag: 'SOW-LR-002', rfid: '982000412880002', stage: 'LACTATION', parity: 3, born: 36, weaned: 34, cost: '30000.0000', loc: 'PEN-FARR-01', status: 'LACTATING' },
      { code: 'PIG-2026-0003', type: 'SOW', breed: yorkshire, gender: 'F', tag: 'SOW-YK-003', rfid: '982000412880003', stage: 'FLUSH', parity: 1, born: 12, weaned: 11, cost: '26000.0000', loc: 'PEN-AI-B2', status: 'ACTIVE' },
      { code: 'PIG-2026-0004', type: 'SOW', breed: largeWhite, gender: 'F', tag: 'SOW-LW-004', rfid: '982000412880004', stage: 'GESTATION', parity: 4, born: 48, weaned: 44, cost: '31000.0000', loc: 'PEN-GEST-A1', status: 'PREGNANT' },
      { code: 'PIG-2026-0005', type: 'SOW', breed: landrace, gender: 'F', tag: 'SOW-LR-005', rfid: '982000412880005', stage: 'LACTATION', parity: 2, born: 24, weaned: 23, cost: '27500.0000', loc: 'PEN-FARR-01', status: 'LACTATING' },
      { code: 'PIG-2026-0006', type: 'SOW', breed: duroc, gender: 'F', tag: 'SOW-DR-006', rfid: '982000412880006', stage: 'GESTATION', parity: 1, born: 11, weaned: 10, cost: '29000.0000', loc: 'PEN-GEST-A1', status: 'PREGNANT' },
      { code: 'PIG-2026-0007', type: 'SOW', breed: yorkshire, gender: 'F', tag: 'SOW-YK-007', rfid: '982000412880007', stage: 'FLUSH', parity: 0, born: 0, weaned: 0, cost: '25000.0000', loc: 'PEN-AI-B2', status: 'ACTIVE' },
      { code: 'PIG-2026-0008', type: 'SOW', breed: landrace, gender: 'F', tag: 'SOW-LR-008', rfid: '982000412880008', stage: 'QUARANTINE', parity: 2, born: 22, weaned: 20, cost: '26000.0000', loc: 'PEN-QUAR-01', status: 'SICK' },
      { code: 'PIG-2026-0009', type: 'BOAR', breed: duroc, gender: 'M', tag: 'BOAR-DR-001', rfid: '982000412880009', stage: 'BOAR_AI', parity: 0, born: 0, weaned: 0, cost: '45000.0000', loc: 'PEN-BOAR-C1', status: 'ACTIVE' },
      { code: 'PIG-2026-0010', type: 'BOAR', breed: yorkshire, gender: 'M', tag: 'BOAR-YK-002', rfid: '982000412880010', stage: 'BOAR_AI', parity: 0, born: 0, weaned: 0, cost: '42000.0000', loc: 'PEN-BOAR-C1', status: 'ACTIVE' },
      { code: 'PIG-2026-0011', type: 'GILT', breed: yorkshire, gender: 'F', tag: 'GLT-YK-011', rfid: '982000412880011', stage: 'GILT_GROWER', parity: 0, born: 0, weaned: 0, cost: '18000.0000', loc: 'PEN-GEST-A1', status: 'ACTIVE' },
      { code: 'PIG-2026-0012', type: 'GILT', breed: landrace, gender: 'F', tag: 'GLT-LR-012', rfid: '982000412880012', stage: 'GILT_GROWER', parity: 0, born: 0, weaned: 0, cost: '18000.0000', loc: 'PEN-GEST-A1', status: 'ACTIVE' },
      { code: 'PIG-2026-0013', type: 'GILT', breed: largeWhite, gender: 'F', tag: 'GLT-LW-013', rfid: '982000412880013', stage: 'GILT_GROWER', parity: 0, born: 0, weaned: 0, cost: '18000.0000', loc: 'PEN-GEST-A1', status: 'ACTIVE' },
      { code: 'PIG-2026-0014', type: 'GILT', breed: duroc, gender: 'F', tag: 'GLT-DR-014', rfid: '982000412880014', stage: 'GILT_GROWER', parity: 0, born: 0, weaned: 0, cost: '18000.0000', loc: 'PEN-GEST-A1', status: 'ACTIVE' },
      { code: 'PIG-2026-0015', type: 'GILT', breed: yorkshire, gender: 'F', tag: 'GLT-YK-015', rfid: '982000412880015', stage: 'GILT_GROWER', parity: 0, born: 0, weaned: 0, cost: '18000.0000', loc: 'PEN-GEST-A1', status: 'ACTIVE' },
      // --- Batch PIG-BAT-2026-0001 working herd (in step with the batch) ---
      { code: 'PIG-2026-0016', type: 'SOW', breed: yorkshire, gender: 'F', tag: 'SOW-YK-016', rfid: '982000412880016', stage: 'GESTATION', parity: 3, born: 34, weaned: 32, cost: '29500.0000', loc: 'PEN-GEST-A1', status: 'PREGNANT' },
      { code: 'PIG-2026-0017', type: 'SOW', breed: landrace,  gender: 'F', tag: 'SOW-LR-017', rfid: '982000412880017', stage: 'GESTATION', parity: 2, born: 25, weaned: 24, cost: '28500.0000', loc: 'PEN-GEST-A1', status: 'PREGNANT' },
      { code: 'PIG-2026-0018', type: 'SOW', breed: largeWhite, gender: 'F', tag: 'SOW-LW-018', rfid: '982000412880018', stage: 'GESTATION', parity: 5, born: 58, weaned: 53, cost: '31500.0000', loc: 'PEN-GEST-A1', status: 'PREGNANT' },
      { code: 'PIG-2026-0019', type: 'SOW', breed: yorkshire, gender: 'F', tag: 'SOW-YK-019', rfid: '982000412880019', stage: 'GESTATION', parity: 1, born: 12, weaned: 11, cost: '27000.0000', loc: 'PEN-GEST-A1', status: 'PREGNANT' },
      { code: 'PIG-2026-0020', type: 'SOW', breed: duroc,     gender: 'F', tag: 'SOW-DR-020', rfid: '982000412880020', stage: 'GESTATION', parity: 2, born: 21, weaned: 20, cost: '29000.0000', loc: 'PEN-GEST-A1', status: 'PREGNANT' },
      // --- Same batch, held back: not ready to move with the rest ---
      { code: 'PIG-2026-0021', type: 'SOW', breed: landrace,  gender: 'F', tag: 'SOW-LR-021', rfid: '982000412880021', stage: 'FLUSH', parity: 2, born: 23, weaned: 21, cost: '28000.0000', loc: 'PEN-AI-B2',   status: 'ACTIVE' },
      { code: 'PIG-2026-0022', type: 'GILT', breed: yorkshire, gender: 'F', tag: 'GLT-YK-022', rfid: '982000412880022', stage: 'FLUSH', parity: 0, born: 0,  weaned: 0,  cost: '18500.0000', loc: 'PEN-AI-B2',   status: 'ACTIVE' },
      { code: 'PIG-2026-0023', type: 'SOW', breed: duroc,     gender: 'F', tag: 'SOW-DR-023', rfid: '982000412880023', stage: 'QUARANTINE', parity: 3, born: 30, weaned: 27, cost: '29000.0000', loc: 'PEN-QUAR-01', status: 'SICK' },
      // --- Batch PIG-BAT-2026-0002 lactation herd ---
      { code: 'PIG-2026-0024', type: 'SOW', breed: landrace,  gender: 'F', tag: 'SOW-LR-024', rfid: '982000412880024', stage: 'LACTATION', parity: 4, born: 47, weaned: 44, cost: '30500.0000', loc: 'PEN-FARR-01', status: 'LACTATING' },
      { code: 'PIG-2026-0025', type: 'SOW', breed: yorkshire, gender: 'F', tag: 'SOW-YK-025', rfid: '982000412880025', stage: 'LACTATION', parity: 2, born: 24, weaned: 23, cost: '28000.0000', loc: 'PEN-FARR-01', status: 'LACTATING' },
      { code: 'PIG-2026-0026', type: 'SOW', breed: largeWhite, gender: 'F', tag: 'SOW-LW-026', rfid: '982000412880026', stage: 'LACTATION', parity: 1, born: 13, weaned: 12, cost: '27500.0000', loc: 'PEN-FARR-01', status: 'LACTATING' },
      // Same batch as the lactating sows, but still farrowing — a late farrower
      // physically in the farrowing crate bank, one stage behind her cohort.
      { code: 'PIG-2026-0027', type: 'SOW', breed: duroc,     gender: 'F', tag: 'SOW-DR-027', rfid: '982000412880027', stage: 'FARROWING', parity: 3, born: 29, weaned: 0,  cost: '29500.0000', loc: 'PEN-WEAN-02', status: 'ACTIVE' },
    ];
    const animalMap1 = new Map<string, string>();
    for (const a of animalConfigs1) {
      const [existingAnimal] = await db.select().from(schema.animalRegister).where(and(eq(schema.animalRegister.company_id, comp1Id), eq(schema.animalRegister.animal_code, a.code))).limit(1);
      let aId = existingAnimal?.animal_id;
      if (!existingAnimal) {
        aId = randomUUID();
        const stage = stageByCode.get(a.stage);
        const locId = penMap1.get(a.loc)!;
        const itId = a.type === 'BOAR' ? itemMap1.get('BIO-SWINE-BOAR')! : a.type === 'GILT' ? itemMap1.get('BIO-SWINE-GILT')! : itemMap1.get('BIO-SWINE-SOW')!;
        // dob was never set, so the ANIMAL series' `dob:YEAR` segment resolved to
        // nothing and the code it composed was PIG-0001 — while the seed wrote
        // PIG-2026-0001 by hand. Giving the animal the birth date the code has
        // always claimed lets the series produce that code itself.
        const dob = a.type === 'GILT' ? '2026-03-15' : '2026-01-05';
        const takenAnimals = (await db.select({ code: schema.animalRegister.animal_code }).from(schema.animalRegister)
          .where(eq(schema.animalRegister.company_id, comp1Id))).map((r: { code: string }) => r.code);
        const animalCode = (await seriesCodeFor(db, { tenantId, companyId: comp1Id }, 'ANIMAL', { dob }, takenAnimals)) ?? a.code;
        await db.insert(schema.animalRegister).values({
          animal_id: aId, tenant_id: tenantId, company_id: comp1Id, nob_id: nobId, lob_id: lobId, animal_code: animalCode, animal_type: a.type, breed_id: a.breed.breed_id, gender: a.gender, entry_type: 'PURCHASED_LOCAL', entry_date: '2026-01-10', dob, item_id: itId, ear_tag: a.tag, rfid_tag: a.rfid, acquisition_cost: a.cost, total_opening_asset_value: a.cost, book_value: a.cost, current_bio_asset_value: a.cost, parity_count: a.parity, total_piglets_born_live: a.born, total_piglets_weaned: a.weaned, current_stage_id: stage?.stage_id, current_location_id: locId, status: a.status, is_active: true, created_by: c1AdminId,
        });
      }
      animalMap1.set(a.code, aId!);
    }

    // 1.6 Breeding, Farrowing & Semen Collections
    const sow1Id = animalMap1.get('PIG-2026-0001')!;
    const sow2Id = animalMap1.get('PIG-2026-0002')!;
    const sow3Id = animalMap1.get('PIG-2026-0003')!;
    const sow4Id = animalMap1.get('PIG-2026-0004')!;
    const sow5Id = animalMap1.get('PIG-2026-0005')!;
    const sow6Id = animalMap1.get('PIG-2026-0006')!;
    const boar9Id = animalMap1.get('PIG-2026-0009')!;
    const boar10Id = animalMap1.get('PIG-2026-0010')!;

    const matingEvents = [
      { sowId: sow1Id, boarId: boar9Id, type: 'AI', date: '2026-07-05', expFarr: '2026-10-27', pregDate: '2026-08-02', result: 'CONFIRMED', parity: 2 },
      { sowId: sow4Id, boarId: boar10Id, type: 'NATURAL_MATING', date: '2026-06-01', expFarr: '2026-09-23', pregDate: '2026-06-29', result: 'CONFIRMED', parity: 4 },
      { sowId: sow6Id, boarId: boar9Id, type: 'AI', date: '2026-07-28', expFarr: '2026-11-19', pregDate: '2026-08-25', result: 'CONFIRMED', parity: 1 },
      { sowId: sow3Id, boarId: boar10Id, type: 'AI', date: '2026-08-14', expFarr: '2026-12-06', pregDate: '2026-09-11', result: 'PENDING', parity: 1 },
    ];
    for (const m of matingEvents) {
      const [existingBreed] = await db.select().from(schema.breedingRecord).where(and(eq(schema.breedingRecord.company_id, comp1Id), eq(schema.breedingRecord.sow_animal_id, m.sowId), eq(schema.breedingRecord.mating_date, m.date))).limit(1);
      if (!existingBreed) {
        await db.insert(schema.breedingRecord).values({
          breeding_id: randomUUID(), tenant_id: tenantId, company_id: comp1Id, sow_animal_id: m.sowId, boar_animal_id: m.boarId, mating_type: m.type, mating_date: m.date, expected_farrowing_date: m.expFarr, preg_check_date: m.pregDate, preg_check_method: 'ULTRASOUND', pregnancy_confirmed: m.result === 'CONFIRMED', conception_result: m.result, parity_number: m.parity, created_by: c1AdminId,
        });
      }
    }

    const farrowingEvents = [
      { sowId: sow2Id, farrDate: '2026-07-29', total: 14, live: 13, still: 1, mum: 0, avgWt: '1.450', totWt: '18.850', weanDate: '2026-08-26', weanCnt: 12, weanWt: '7.600', parity: 3 },
      { sowId: sow5Id, farrDate: '2026-08-05', total: 13, live: 12, still: 0, mum: 1, avgWt: '1.400', totWt: '16.800', weanDate: '2026-09-02', weanCnt: 12, weanWt: '7.200', parity: 2 },
    ];
    for (const f of farrowingEvents) {
      const [existingFarr] = await db.select().from(schema.farrowingRecord).where(and(eq(schema.farrowingRecord.company_id, comp1Id), eq(schema.farrowingRecord.sow_animal_id, f.sowId), eq(schema.farrowingRecord.farrowing_date, f.farrDate))).limit(1);
      if (!existingFarr) {
        await db.insert(schema.farrowingRecord).values({
          farrow_id: randomUUID(), tenant_id: tenantId, company_id: comp1Id, sow_animal_id: f.sowId, farrowing_date: f.farrDate, piglets_born_total: f.total, piglets_born_live: f.live, piglets_stillborn: f.still, piglets_mummified: f.mum, avg_birth_weight_kg: f.avgWt, total_litter_weight_kg: f.totWt, farrowing_status: 'NORMAL', weaning_date: f.weanDate, piglets_weaned: f.weanCnt, avg_weaning_weight_kg: f.weanWt, parity_number: f.parity, created_by: c1AdminId,
        });
      }
    }

    const semenBatches = [
      { boarId: boar9Id, date: '2026-08-01', doses: '45.00', feed: '180.0000', drug: '40.0000', amort: '150.0000', ohead: '80.0000', tot: '450.0000', rate: '10.000000', used: '35.00', sold: '10.00' },
      { boarId: boar10Id, date: '2026-08-08', doses: '40.00', feed: '160.0000', drug: '30.0000', amort: '140.0000', ohead: '70.0000', tot: '400.0000', rate: '10.000000', used: '30.00', sold: '10.00' },
    ];
    for (const sb of semenBatches) {
      const [existingSemen] = await db.select().from(schema.semenBatch).where(and(eq(schema.semenBatch.company_id, comp1Id), eq(schema.semenBatch.boar_animal_id, sb.boarId), eq(schema.semenBatch.collection_date, sb.date))).limit(1);
      if (!existingSemen) {
        await db.insert(schema.semenBatch).values({
          semen_batch_id: randomUUID(), tenant_id: tenantId, company_id: comp1Id, boar_animal_id: sb.boarId, collection_date: sb.date, doses_collected: sb.doses, feed_cost_period: sb.feed, drug_cost_period: sb.drug, amortisation_period: sb.amort, overhead_cost_period: sb.ohead, running_cost_period: sb.tot, unit_cost_per_dose: sb.rate, doses_used_internal: sb.used, doses_sold: sb.sold, created_by: c1AdminId,
        });
      }
    }

    // 1.7 Production Batches & 30-Day Daily Entries for Company 1
    const batches1 = [
      { no: 'PIG-BAT-2026-0001', breed: yorkshire, costing: 'BIO_ASSET', stage: 'GESTATION', shedCode: 'SHED-GEST-01', penCode: 'PEN-GEST-A1', start: '2026-03-06', end: '2026-10-22', qty: '20.0000', status: 'ACTIVE', schedulerCode: 'SCHED-PIG-GEST-114', remarks: 'Yorkshire Parity 1-3 Breeding Gestation Cohort Alpha' },
      { no: 'PIG-BAT-2026-0002', breed: landrace, costing: 'BIO_ASSET', stage: 'LACTATION', shedCode: 'SHED-FARR-02', penCode: 'PEN-FARR-01', start: '2025-12-09', end: '2026-09-14', qty: '25.0000', status: 'ACTIVE', schedulerCode: 'SCHED-PIG-FARR-28', remarks: 'Farrowing Nursing Sows and Piglet Cohort Bravo' },
    ];
    for (const b of batches1) {
      const [existingBatch] = await db.select().from(schema.batchHeader).where(and(eq(schema.batchHeader.company_id, comp1Id), eq(schema.batchHeader.batch_no, b.no))).limit(1);
      let batId = existingBatch?.batch_id;
      const stage = stageByCode.get(b.stage);
      if (!existingBatch) {
        batId = randomUUID();
        await db.insert(schema.batchHeader).values({
          batch_id: batId, tenant_id: tenantId, company_id: comp1Id, nob_id: nobId, lob_id: lobId, batch_no: b.no, breed_id: b.breed.breed_id, costing_method: b.costing, current_stage_code: b.stage, stage_id: stageOf(b.stage).stage_id, shed_id: shedMap1.get(b.shedCode)!.id, location_id: penMap1.get(b.penCode)!, start_date: b.start, expected_end_date: b.end, opening_quantity: b.qty, closing_quantity: b.qty, uom: 'HEAD', status: b.status, remarks: b.remarks, created_by: c1AdminId,
        });

        const bioStage = b.stage === 'GESTATION' || b.stage === 'LACTATION' ? 'PRODUCTIVE_SOW' : 'PREMATURE';
        await db.insert(schema.batchBioAssetState).values({
          state_id: randomUUID(), batch_id: batId, stage: bioStage, current_quantity: b.qty, nca_book_value: bioStage === 'PRODUCTIVE_SOW' ? (Number(b.qty) * 28000).toFixed(4) : '0.0000',
        });

        // 30 days gestation feed
        if (b.no === 'PIG-BAT-2026-0001') {
          const gestFeedId = itemMap1.get('FEED-GEST-SOW')!;
          for (let d = 1; d <= 30; d++) {
            const dayStr = d < 10 ? `0${d}` : `${d}`;
            await db.insert(schema.batchTransaction).values({
              transaction_id: randomUUID(), batch_id: batId, transaction_date: `2026-07-${dayStr}`, transaction_type: 'CONSUMPTION', item_id: gestFeedId, quantity: '48.0000', uom: 'KG', rate: '28.000000', amount: (48 * 28).toFixed(4), remarks: `Daily gestation mash ration Day ${d}`, created_by: c1AdminId,
            });
          }
        }
        // 21 days creep feed + Day 3 iron
        if (b.no === 'PIG-BAT-2026-0002') {
          const creepFeedId = itemMap1.get('FEED-CREEP-PRE')!;
          const ironMedId = itemMap1.get('MED-IRON-DEX')!;
          await db.insert(schema.batchTransaction).values({
            transaction_id: randomUUID(), batch_id: batId, transaction_date: '2026-07-31', transaction_type: 'CONSUMPTION', item_id: ironMedId, quantity: '50.0000', uom: 'ML', rate: '1.800000', amount: '90.0000', remarks: 'Day 3 Anemia Prevention Iron Dextran 2ml IM', created_by: c1AdminId,
          });
          for (let d = 1; d <= 21; d++) {
            const dayMonth = d <= 3 ? `2026-07-${28 + d}` : `2026-08-${d - 3 < 10 ? `0${d - 3}` : `${d - 3}`}`;
            const dailyKg = (3.5 + d * 0.45).toFixed(2);
            await db.insert(schema.batchTransaction).values({
              transaction_id: randomUUID(), batch_id: batId, transaction_date: dayMonth, transaction_type: 'CONSUMPTION', item_id: creepFeedId, quantity: dailyKg, uom: 'KG', rate: '55.000000', amount: (Number(dailyKg) * 55).toFixed(4), remarks: `Nursing piglet pre-starter creep feed Day ${d}`, created_by: c1AdminId,
            });
          }
        }
      }
    }

    // =========================================================================
    // ═════════════════════════════════════════════════════════════════════════
    // 🏢 COMPANY 2: HIGHLAND COMMERCIAL PORKERS & PROCESSING PVT LTD
    // ═════════════════════════════════════════════════════════════════════════
    // =========================================================================
    console.log('\n📦 Seeding Company 2 (Highland Commercial Porkers & Processing)...');
    const comp2Id = company2.company_id;

    // 2.1 Cost Centers for Company 2
    const ccData2 = [
      { code: 'CC-HIGH-01', name: 'Highland Commercial Swine Facility', type: 'FARM', parentCode: null },
      { code: 'CC-NURSERY', name: 'Commercial Nursery Unit', type: 'DEPARTMENT', parentCode: 'CC-HIGH-01' },
      { code: 'CC-GROW-FIN', name: 'Grower & Finisher Unit', type: 'DEPARTMENT', parentCode: 'CC-HIGH-01' },
      { code: 'CC-FEEDMILL-H', name: 'Highland Feed Processing Mill', type: 'WAREHOUSE', parentCode: 'CC-HIGH-01' },
      { code: 'CC-ADMIN-H', name: 'Highland Operations & Administration', type: 'DEPARTMENT', parentCode: 'CC-HIGH-01' },
    ];
    const ccMap2 = new Map<string, string>();
    for (const cc of ccData2.filter((c) => !c.parentCode)) {
      const [existingCC] = await db.select().from(schema.costCenterMaster).where(and(eq(schema.costCenterMaster.company_id, comp2Id), eq(schema.costCenterMaster.cost_center_code, cc.code))).limit(1);
      let ccId = existingCC?.cost_center_id;
      if (!existingCC) {
        ccId = randomUUID();
        await db.insert(schema.costCenterMaster).values({ cost_center_id: ccId, tenant_id: tenantId, company_id: comp2Id, cost_center_code: cc.code, cost_center_name: cc.name, cost_center_type: cc.type, is_active: true });
      }
      ccMap2.set(cc.code, ccId!);
    }
    for (const cc of ccData2.filter((c) => c.parentCode)) {
      const [existingCC] = await db.select().from(schema.costCenterMaster).where(and(eq(schema.costCenterMaster.company_id, comp2Id), eq(schema.costCenterMaster.cost_center_code, cc.code))).limit(1);
      let ccId = existingCC?.cost_center_id;
      if (!existingCC) {
        ccId = randomUUID();
        await db.insert(schema.costCenterMaster).values({ cost_center_id: ccId, tenant_id: tenantId, company_id: comp2Id, cost_center_code: cc.code, cost_center_name: cc.name, cost_center_type: cc.type, parent_cost_center_id: ccMap2.get(cc.parentCode!), is_active: true });
      }
      ccMap2.set(cc.code, ccId!);
    }

    // 2.2 Farm, Sheds & Pens for Company 2
    // Company 2's block previously did `select any farm for this company` and
    // then UPDATEd its name — with a single-company demo that renamed Triple C's
    // own farm to "Highland Commercial Swine Facility". Its sheds now hang off
    // whichever farm this company actually has.
    const locCtx2 = { tenantId, companyId: comp2Id, nobId, lobId };
    const farmLoc2 = comp2Id === comp1Id
      ? farmLoc1
      : await seedLocation(db, locCtx2, {
          key: 'FARM-HIGH-01', name: 'Highland Commercial Swine Facility', type: 'FARM', capacity: 360,
        });
    const farm2Id = farmLoc2.id;

    // Operational Area 2: HIGH-GROW-01
    // The company's operational area, seeded by the dev tenant. This used to
    // insert HIGH-GROW-01 of its own, so a full chain produced three areas
    // where the demo is meant to have one.
    const [area2] = await db.select().from(schema.operationalAreaMaster)
      .where(eq(schema.operationalAreaMaster.company_id, comp2Id)).limit(1);
    if (!area2) throw new Error('No operational area for this company — run db-seed-dev-tenant first.');
    const area2Id = area2.area_id;

    const shedConfigs2 = [
      { code: 'SHED-NURS-01', name: 'Commercial Weaner Nursery Barn', type: 'NURSERY', cap: 100 },
      { code: 'SHED-GROW-02', name: 'Commercial Grower & Finisher Facility', type: 'GROWER', cap: 260 },
    ];
    const shedMap2 = new Map<string, SeededLocation>();
    for (const sc of shedConfigs2) {
      shedMap2.set(sc.code, await seedLocation(db, locCtx2, {
        key: sc.code, name: sc.name, type: 'SHED', parent: farmLoc2, subType: sc.type, capacity: sc.cap,
      }));
    }

    const penConfigs2 = [
      { code: 'PEN-NURS-01', name: 'Weaner Nursery Cohort Pen 1', shedCode: 'SHED-NURS-01', cap: 100, uom: 'HEAD', cleaned: '2026-08-01', disinfected: '2026-08-02' },
      { code: 'PEN-GROW-02', name: 'Grower Cohort Pen Alpha', shedCode: 'SHED-GROW-02', cap: 120, uom: 'HEAD', cleaned: '2026-08-05', disinfected: '2026-08-06' },
      { code: 'PEN-FIN-03', name: 'Finisher Porker Pen Beta', shedCode: 'SHED-GROW-02', cap: 120, uom: 'HEAD', cleaned: '2026-08-05', disinfected: '2026-08-06' },
      { code: 'PEN-QUAR-02', name: 'Biosecurity Quarantine Pen', shedCode: 'SHED-GROW-02', cap: 20, uom: 'HEAD', cleaned: '2026-08-18', disinfected: '2026-08-19' },
    ];
    const penMap2 = new Map<string, string>();
    for (const pc of penConfigs2) {
      const pen = await seedLocation(db, locCtx2, {
        key: pc.code, name: pc.name, type: 'PEN', parent: shedMap2.get(pc.shedCode)!,
        capacity: pc.cap, capacityUom: pc.uom,
        lastCleanedDate: pc.cleaned, lastDisinfectedDate: pc.disinfected,
      });
      penMap2.set(pc.code, pen.id);
    }

    // 2.3 Item Categories & Items for Company 2
    const {
      categoryIds: catMap2,
      categoryCodes: catMap2Code,
      subcategoryCodes: subcatMap2Code,
    } = await seedItemCategoryTree(db, { tenantId, companyId: comp2Id, nobId, lobId });

    const itemMap2 = new Map<string, string>();
    for (const item of ITEM_CATALOG_2) {
      // Matched on the name: the code is generated below, from the ITEM series.
      const [existingItem] = await db.select().from(schema.itemMaster).where(and(eq(schema.itemMaster.company_id, comp2Id), eq(schema.itemMaster.item_name, item.name))).limit(1);
      let itId = existingItem?.item_id;
      if (!existingItem) {
        itId = randomUUID();
        const categoryId = catMap2.get(item.cat);
        const subcategoryCode = subcatMap2Code.get(item.sub);
        if (!categoryId || !subcategoryCode) {
          throw new Error(`Missing category mapping for demo item '${item.key}'.`);
        }
        const takenItems = (await db.select({ code: schema.itemMaster.item_code }).from(schema.itemMaster).where(eq(schema.itemMaster.company_id, comp2Id))).map((r: { code: string }) => r.code);
        const itemCode = (await seriesCodeFor(db, { tenantId, companyId: comp2Id }, 'ITEM',
          { item_type: item.type, category_id: catMap2Code.get(item.cat) ?? null, sub_category: subcategoryCode }, takenItems)) ?? item.key;
        await db.insert(schema.itemMaster).values({
          item_id: itId, tenant_id: tenantId, company_id: comp2Id, category_id: categoryId, nob_id: nobId, lob_id: lobId, item_code: itemCode, item_name: item.name, item_type: item.type, sub_category: subcategoryCode, uom_primary: item.uom, valuation_method: item.val, standard_cost: item.cost, is_biological_asset: item.bio, is_inventoriable: true, is_active: true,
        });
      } else {
        const categoryId = catMap2.get(item.cat);
        const subcategoryCode = subcatMap2Code.get(item.sub);
        if (!categoryId || !subcategoryCode) throw new Error(`Missing category mapping for demo item '${item.key}'.`);
        await db.update(schema.itemMaster).set({ category_id: categoryId, sub_category: subcategoryCode })
          .where(eq(schema.itemMaster.item_id, itId!));
      }
      itemMap2.set(item.key, itId!);
    }

    // 2.4 Parameters & Schedulers for Company 2
    const paramConfigs2 = [
      { code: 'PARAM-FEED-QUAR',      name: 'Quarantine Adaptation Ration', type: 'CONSUMPTION', itemCode: 'FEED-WEAN-GROW',   uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '0.90000000',  isMandatory: true },
      { code: 'PARAM-FEED-NURSERY',   name: 'Nursery Weaner Ration',        type: 'CONSUMPTION', itemCode: 'FEED-WEAN-GROW',   uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '1.20000000',  isMandatory: true },
      { code: 'PARAM-FEED-GROW-EARLY',name: 'Early Grower Ration',          type: 'CONSUMPTION', itemCode: 'FEED-WEAN-GROW',   uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '1.80000000',  isMandatory: true },
      { code: 'PARAM-FEED-GROW-LATE', name: 'Late Grower Ration',           type: 'CONSUMPTION', itemCode: 'FEED-WEAN-GROW',   uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '2.30000000',  isMandatory: true },
      { code: 'PARAM-FEED-FIN-1',     name: 'Finisher Phase 1 Ration',      type: 'CONSUMPTION', itemCode: 'FEED-FINISHER',    uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '2.50000000',  isMandatory: true },
      { code: 'PARAM-FEED-FIN-2',     name: 'Finisher Phase 2 Ration',      type: 'CONSUMPTION', itemCode: 'FEED-FINISHER',    uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '2.90000000',  isMandatory: true },
      { code: 'PARAM-FEED-FIN-MKT',   name: 'Market Finishing Ration',      type: 'CONSUMPTION', itemCode: 'FEED-FINISHER',    uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '3.20000000',  isMandatory: true },
      { code: 'PARAM-MORT-PIG',       name: 'Swine Daily Mortality',        type: 'MORTALITY',   itemCode: null,               uom: 'HEAD', method: 'MANUAL_AT_ENTRY', defaultQtyUnit: null,          isMandatory: true },
      { code: 'PARAM-BODYWT-PIG',     name: 'Average Body Weight',          type: 'OBSERVATION', itemCode: null,               uom: 'KG',   method: 'MANUAL_AT_ENTRY', defaultQtyUnit: null,          isMandatory: false },
      { code: 'PARAM-LABOUR-PIG',     name: 'Direct Farm Labour Hours',     type: 'OVERHEAD',    itemCode: null,               uom: 'HRS',  method: 'PER_BATCH',       defaultQtyUnit: null,          isMandatory: false, perBatch: '8.00000000' },
      { code: 'PARAM-POWER-PIG',      name: 'Ventilation & Lighting Power', type: 'OVERHEAD',    itemCode: null,               uom: 'KWH',  method: 'PER_BATCH',       defaultQtyUnit: null,          isMandatory: false, perBatch: '450.00000000' },
      { code: 'PARAM-PORK-OUTPUT',    name: 'Dressed Pork Carcass Yield',   type: 'OUTPUT',      itemCode: 'LVS-DRESSED-PORK', uom: 'KG',   method: 'PER_UNIT',        defaultQtyUnit: '85.00000000', isMandatory: false },
      { code: 'PARAM-MED-DEWORM',     name: 'Strategic Deworming (Ivermectin)', type: 'CONSUMPTION', itemCode: 'MED-IVERMECTIN', uom: 'ML', method: 'PER_UNIT',      defaultQtyUnit: '2.00000000',  isMandatory: false },
    ];
    const paramMap2 = new Map<string, string>();
    for (const p of paramConfigs2) {
      const [existingParam] = await db.select().from(schema.parameterMaster).where(and(eq(schema.parameterMaster.company_id, comp2Id), eq(schema.parameterMaster.parameter_code, p.code))).limit(1);
      let pId = existingParam?.parameter_id;
      if (!existingParam) {
        pId = randomUUID();
        await db.insert(schema.parameterMaster).values({
          parameter_id: pId, tenant_id: tenantId, company_id: comp2Id, nob_id: nobId, lob_id: lobId, parameter_code: p.code, parameter_name: p.name, parameter_type: p.type, item_id: p.itemCode ? itemMap2.get(p.itemCode) : null, default_uom: p.uom, qty_method: p.method, default_qty_per_unit: p.defaultQtyUnit, default_qty_per_batch: (p as any).perBatch ?? null, is_mandatory: p.isMandatory, is_active: true, created_by: c2AdminId,
        });
      }
      paramMap2.set(p.code, pId!);
    }

    // Schedulers for Company 2 are batch-level (scheduler_header/scheduler_line).


    // 2.5 Production Batches & 30-Day Daily Entries for Company 2
    const batches2 = [
      { no: 'PIG-BAT-2026-0101', breed: duroc, costing: 'STANDARD', stage: 'GILT_GROWER', shedCode: 'SHED-GROW-02', penCode: 'PEN-GROW-02', start: '2026-07-15', end: '2026-11-15', qty: '120.0000', status: 'ACTIVE', schedulerCode: 'SCHED-PIG-GROW-60', remarks: 'Highland Commercial Finisher Porker Cohort 101' },
      { no: 'PIG-BAT-2026-0102', breed: duroc, costing: 'STANDARD', stage: 'SLAUGHTERED', shedCode: 'SHED-GROW-02', penCode: 'PEN-FIN-03', start: '2026-03-01', end: '2026-07-15', qty: '100.0000', status: 'ACTIVE', schedulerCode: 'SCHED-PIG-FIN-90', remarks: 'Finished porkers at slaughter weight — ready to close and post standard-cost variances' },
    ];
    for (const b of batches2) {
      const [existingBatch] = await db.select().from(schema.batchHeader).where(and(eq(schema.batchHeader.company_id, comp2Id), eq(schema.batchHeader.batch_no, b.no))).limit(1);
      let batId = existingBatch?.batch_id;
      const stage = stageByCode.get(b.stage);
      if (!existingBatch) {
        batId = randomUUID();
        await db.insert(schema.batchHeader).values({
          batch_id: batId, tenant_id: tenantId, company_id: comp2Id, nob_id: nobId, lob_id: lobId, batch_no: b.no, breed_id: b.breed.breed_id, costing_method: b.costing, current_stage_code: b.stage, stage_id: stageOf(b.stage).stage_id, shed_id: shedMap2.get(b.shedCode)!.id, location_id: penMap2.get(b.penCode)!, start_date: b.start, expected_end_date: b.end, opening_quantity: b.qty, closing_quantity: b.status === 'CLOSED' ? '98.0000' : b.qty, uom: 'HEAD', status: b.status, remarks: b.remarks, created_by: c2AdminId,
        });

        // Multi-day grower feeding transactions
        if (b.no === 'PIG-BAT-2026-0101') {
          const weanFeedId = itemMap2.get('FEED-WEAN-GROW')!;
          for (let d = 1; d <= 30; d++) {
            const dayMonth = d <= 16 ? `2026-07-${14 + d}` : `2026-08-${d - 16 < 10 ? `0${d - 16}` : `${d - 16}`}`;
            const headCount = d >= 8 ? 119 : 120;
            const perPigKg = 1.2 + d * 0.045;
            const totalKg = (headCount * perPigKg).toFixed(2);
            await db.insert(schema.batchTransaction).values({
              transaction_id: randomUUID(), batch_id: batId, transaction_date: dayMonth, transaction_type: 'CONSUMPTION', item_id: weanFeedId, quantity: totalKg, uom: 'KG', rate: '34.500000', amount: (Number(totalKg) * 34.5).toFixed(4), remarks: `Grower feed consumption Day ${d} (${headCount} head @ ${perPigKg.toFixed(2)} kg/head)`, created_by: c2AdminId,
            });
          }
          // Mortality Day 8
          const mortTxId = randomUUID();
          await db.insert(schema.batchTransaction).values({
            transaction_id: mortTxId, batch_id: batId, transaction_date: '2026-07-22', transaction_type: 'MORTALITY', quantity: '1.0000', uom: 'HEAD', remarks: 'Single loss in the grower pen', created_by: c2AdminId,
          });
          await db.insert(schema.batchMortalityDetail).values({
            detail_id: randomUUID(), transaction_id: mortTxId, location_id: penMap2.get('PEN-GROW-02') || null,
            cause_of_death: 'Acute mortality', post_mortem_notes: 'Sudden death, no prior clinical signs',
            disposal_method: 'Incineration (biosecure)', created_by: c2AdminId,
          });
          // 4 Weekly weigh-in logs
          const weighIns = [
            { date: '2026-07-21', avgWt: '28.50', totWt: '3420.00', gain: '0.62' },
            { date: '2026-07-28', avgWt: '33.20', totWt: '3950.80', gain: '0.67' },
            { date: '2026-08-04', avgWt: '38.60', totWt: '4593.40', gain: '0.77' },
            { date: '2026-08-11', avgWt: '44.50', totWt: '5295.50', gain: '0.84' },
          ];
          for (const wi of weighIns) {
            await db.insert(schema.batchTransaction).values({
              transaction_id: randomUUID(), batch_id: batId, transaction_date: wi.date, transaction_type: 'WEIGHT_ENTRY', quantity: wi.avgWt, uom: 'KG', remarks: `Weekly weight check: Avg ${wi.avgWt} kg/head (ADG ${wi.gain} kg/day)`, created_by: c2AdminId,
            });
          }
        }

        // Closed batch output sale
      }
    }

    // =========================================================================
    // 3. User Operational Area Assignments
    // =========================================================================
    console.log('\n🔗 Wiring User Operational Area Assignments...');
    const userAreaMap = [
      { userId: tAdminId, areaId: area1Id!, companyId: comp1Id, isPrimary: true },
      { userId: tAdminId, areaId: area2Id!, companyId: comp2Id, isPrimary: false },
      { userId: opAdminId, areaId: area1Id!, companyId: comp1Id, isPrimary: true },
      { userId: c2AdminId, areaId: area2Id!, companyId: comp2Id, isPrimary: true },
      // Without an area the operator is refused on every operational screen once
      // the area header is sent, which makes the least-privileged role untestable.
      ...(stdUser ? [{ userId: stdUser.user_id, areaId: area1Id!, companyId: comp1Id, isPrimary: true }] : []),
    ];
    for (const uaa of userAreaMap) {
      const [existingUAA] = await db.select().from(schema.userOperationalAreaAssignment)
        .where(and(eq(schema.userOperationalAreaAssignment.user_id, uaa.userId), eq(schema.userOperationalAreaAssignment.area_id, uaa.areaId)))
        .limit(1);
      if (!existingUAA) {
        await db.insert(schema.userOperationalAreaAssignment).values({
          assignment_id: randomUUID(),
          user_id: uaa.userId,
          area_id: uaa.areaId,
          company_id: uaa.companyId,
          is_primary: uaa.isPrimary,
        });
      }
    }

    // =========================================================================
    // 4. Stage journeys, per-stage records, and the tail-end split
    // =========================================================================
    // Batches previously sat at a single stage with no history, so batch_stage_log
    // was empty and every transaction landed in one stage window. Each batch now
    // walks an explicit path, and carries records inside every stage it passed
    // through, which is what the lifecycle stepper and the stage-wise
    // consumption/output panel read.
    console.log('\n🧭 Walking batches through their stage paths...');

    // Day 1 == start_date, matching batch.service.ts#evaluateKpi's dayOfBatch.
    const onDay = (start: string, day: number) => {
      const d = new Date(`${start}T00:00:00`);
      d.setDate(d.getDate() + day - 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    type Leg = { stage: string; from: number; pen: string };
    type Clinical = { pen: string; cause: string; pm: string; disposal: string };
    type Rec = {
      day: number; type: string; itemCode: string | null; qty: string; uom: string; rate: string; note: string;
      /** MORTALITY rows only — becomes a batch_mortality_detail row. */
      clinical?: Clinical;
    };

    const journeys: Array<{
      batchNo: string; companyId: string; start: string; createdBy: string;
      penMap: Map<string, string>; itemMap: Map<string, string>;
      legs: Leg[]; records: Rec[];
    }> = [
      {
        batchNo: 'PIG-BAT-2026-0001', companyId: comp1Id, start: '2026-03-06', createdBy: c1AdminId,
        penMap: penMap1, itemMap: itemMap1,
        legs: [
          { stage: 'QUARANTINE', from: 1, pen: 'PEN-QUAR-01' },
          { stage: 'GILT_GROWER', from: 31, pen: 'PEN-GEST-A1' },
          { stage: 'FLUSH', from: 108, pen: 'PEN-AI-B2' },
          { stage: 'GESTATION', from: 118, pen: 'PEN-GEST-A1' },
        ],
        records: [
          { day: 3,  type: 'CONSUMPTION', itemCode: 'FEED-GEST-SOW', qty: '60.0000', uom: 'KG', rate: '28.000000', note: 'Flush ration 3.0 kg/head — stimulating ovulation before service' },
          { day: 8,  type: 'CONSUMPTION', itemCode: 'FEED-GEST-SOW', qty: '60.0000', uom: 'KG', rate: '28.000000', note: 'Flush ration, final pre-service day' },
          { day: 35, type: 'CONSUMPTION', itemCode: 'FEED-GEST-SOW', qty: '44.0000', uom: 'KG', rate: '28.000000', note: 'Mid gestation ration 2.2 kg/head' },
          { day: 46, type: 'MORTALITY',   itemCode: null,            qty: '1.0000',  uom: 'HEAD', rate: '0.000000', note: 'Sow lost mid-gestation', clinical: { pen: 'PEN-GEST-A1', cause: 'Gastric torsion', pm: 'Torsion confirmed on necropsy — within the 1% gestation limit', disposal: 'Incineration (biosecure)' } },
          { day: 60, type: 'CONSUMPTION', itemCode: 'FEED-GEST-SOW', qty: '44.0000', uom: 'KG', rate: '28.000000', note: 'Mid gestation ration 2.2 kg/head' },
        ],
      },
      {
        batchNo: 'PIG-BAT-2026-0002', companyId: comp1Id, start: '2025-12-09', createdBy: c1AdminId,
        penMap: penMap1, itemMap: itemMap1,
        legs: [
          { stage: 'QUARANTINE', from: 1, pen: 'PEN-QUAR-01' },
          { stage: 'GILT_GROWER', from: 31, pen: 'PEN-GEST-A1' },
          { stage: 'FLUSH', from: 108, pen: 'PEN-AI-B2' },
          { stage: 'GESTATION', from: 118, pen: 'PEN-GEST-A1' },
          { stage: 'FARROWING', from: 232, pen: 'PEN-FARR-01' },
          { stage: 'LACTATION', from: 235, pen: 'PEN-FARR-01' },
        ],
        records: [
          { day: 2,  type: 'CONSUMPTION', itemCode: 'FEED-LACT-SOW',  qty: '37.5000', uom: 'KG',  rate: '42.000000', note: 'Farrowing-day ration 1.5 kg/head' },
          { day: 2,  type: 'MORTALITY',   itemCode: null,             qty: '3.0000',  uom: 'HEAD', rate: '0.000000',  note: 'Stillbirths at farrowing', clinical: { pen: 'PEN-FARR-01', cause: 'Stillbirth', pm: 'Three stillborn piglets, sow unaffected', disposal: 'Rendering' } },
          { day: 6,  type: 'CONSUMPTION', itemCode: 'FEED-LACT-SOW',  qty: '100.0000', uom: 'KG', rate: '42.000000', note: 'Early lactation ration 4.0 kg/head' },
          { day: 18, type: 'CONSUMPTION', itemCode: 'FEED-LACT-SOW',  qty: '162.5000', uom: 'KG', rate: '42.000000', note: 'Peak lactation ration 6.5 kg/head' },
          { day: 28, type: 'CONSUMPTION', itemCode: 'FEED-CREEP-PRE', qty: '8.7500',  uom: 'KG',  rate: '55.000000', note: 'Piglet creep feed, pre-wean stepdown week' },
        ],
      },
      {
        batchNo: 'PIG-BAT-2026-0101', companyId: comp2Id, start: '2026-07-15', createdBy: c2AdminId,
        penMap: penMap2, itemMap: itemMap2,
        legs: [
          { stage: 'QUARANTINE', from: 1, pen: 'PEN-QUAR-02' },
          { stage: 'GILT_GROWER', from: 15, pen: 'PEN-GROW-02' },
        ],
        records: [
          { day: 4,  type: 'CONSUMPTION', itemCode: 'FEED-WEAN-GROW', qty: '108.0000', uom: 'KG',  rate: '38.000000', note: 'Quarantine adaptation ration 0.9 kg/head' },
          { day: 9,  type: 'MORTALITY',   itemCode: null,             qty: '2.0000',   uom: 'HEAD', rate: '0.000000',  note: 'Intake quarantine losses', clinical: { pen: 'PEN-QUAR-02', cause: 'Post-transport enteritis', pm: 'Post-transport stress, enteritis on necropsy', disposal: 'Incineration (biosecure)' } },
          { day: 22, type: 'CONSUMPTION', itemCode: 'FEED-WEAN-GROW', qty: '141.6000', uom: 'KG',  rate: '38.000000', note: 'Nursery weaner adaptation ration 1.2 kg/head' },
          { day: 38, type: 'CONSUMPTION', itemCode: 'FEED-WEAN-GROW', qty: '212.4000', uom: 'KG',  rate: '38.000000', note: 'Early grower ration 1.8 kg/head' },
          { day: 45, type: 'OBSERVATION', itemCode: null,             qty: '48.5000',  uom: 'KG',  rate: '0.000000',  note: 'Weigh-bridge sample: mean body weight 48.5 kg, on curve for 60 kg exit' },
        ],
      },
      {
        batchNo: 'PIG-BAT-2026-0102', companyId: comp2Id, start: '2026-03-01', createdBy: c2AdminId,
        penMap: penMap2, itemMap: itemMap2,
        legs: [
          { stage: 'QUARANTINE', from: 1, pen: 'PEN-QUAR-02' },
          { stage: 'GILT_GROWER', from: 15, pen: 'PEN-GROW-02' },
          { stage: 'SLAUGHTERED', from: 131, pen: 'PEN-FIN-03' },
        ],
        records: [
          { day: 30,  type: 'CONSUMPTION', itemCode: 'FEED-FINISHER', qty: '250.0000', uom: 'KG',  rate: '41.000000', note: 'Finisher phase 1 ration 2.5 kg/head' },
          { day: 70,  type: 'CONSUMPTION', itemCode: 'FEED-FINISHER', qty: '290.0000', uom: 'KG',  rate: '41.000000', note: 'Finisher phase 2 ration 2.9 kg/head' },
          { day: 95,  type: 'MORTALITY',   itemCode: null,            qty: '2.0000',   uom: 'HEAD', rate: '0.000000',  note: 'Lameness culls', clinical: { pen: 'PEN-FIN-03', cause: 'Chronic lameness', pm: 'Chronic joint infection, unfit for transport', disposal: 'Rendering' } },
          { day: 120, type: 'CONSUMPTION', itemCode: 'FEED-FINISHER', qty: '320.0000', uom: 'KG',  rate: '41.000000', note: 'Market finishing ration 3.2 kg/head' },
          { day: 133, type: 'OBSERVATION', itemCode: null,            qty: '111.2000', uom: 'KG',  rate: '0.000000',  note: 'Pre-slaughter live weight check: mean 111.2 kg' },
        ],
      },
    ];

    for (const j of journeys) {
      const [batch] = await db.select().from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.company_id, j.companyId), eq(schema.batchHeader.batch_no, j.batchNo))).limit(1);
      if (!batch) continue;

      // Land the batch on the last leg of its path.
      const finalLeg = j.legs[j.legs.length - 1];
      const finalStage = stageByCode.get(finalLeg.stage);
      await db.update(schema.batchHeader).set({
        current_stage_code: finalLeg.stage,
        stage_id: finalStage?.stage_id,
        sub_location_id: j.penMap.get(finalLeg.pen) || null,
      }).where(eq(schema.batchHeader.batch_id, batch.batch_id));

      // One stage_log row per transition, dated at the day the leg begins.
      for (let i = 1; i < j.legs.length; i++) {
        const prev = j.legs[i - 1];
        const leg = j.legs[i];
        const [existingLog] = await db.select().from(schema.batchStageLog)
          .where(and(eq(schema.batchStageLog.batch_id, batch.batch_id), eq(schema.batchStageLog.to_stage_code, leg.stage))).limit(1);
        if (existingLog) continue;
        await db.insert(schema.batchStageLog).values({
          log_id: randomUUID(),
          batch_id: batch.batch_id,
          from_stage_code: prev.stage,
          to_stage_code: leg.stage,
          from_location_id: j.penMap.get(prev.pen) || null,
          to_location_id: j.penMap.get(leg.pen) || null,
          transferred_at: `${onDay(j.start, leg.from)} 08:00:00`,
          transferred_by: j.createdBy,
          remarks: `Batch moved from ${prev.stage} to ${leg.stage} on day ${leg.from}.`,
        });
      }

      // Records inside each stage window.
      for (const r of j.records) {
        const txDate = onDay(j.start, r.day);
        const [existingTx] = await db.select().from(schema.batchTransaction)
          .where(and(
            eq(schema.batchTransaction.batch_id, batch.batch_id),
            eq(schema.batchTransaction.transaction_date, txDate),
            eq(schema.batchTransaction.remarks, r.note),
          )).limit(1);
        if (existingTx) continue;
        const txId = randomUUID();
        await db.insert(schema.batchTransaction).values({
          transaction_id: txId,
          batch_id: batch.batch_id,
          transaction_date: txDate,
          transaction_type: r.type,
          item_id: r.itemCode ? j.itemMap.get(r.itemCode) : null,
          quantity: r.qty,
          uom: r.uom,
          rate: r.rate,
          amount: (Number(r.qty) * Number(r.rate)).toFixed(4),
          remarks: r.note,
          created_by: j.createdBy,
        });
        // Cause, necropsy finding, disposal and pen are columns now, not a
        // formatted string inside `remarks`.
        const clinical = r.clinical;
        if (clinical) {
          await db.insert(schema.batchMortalityDetail).values({
            detail_id: randomUUID(),
            transaction_id: txId,
            location_id: j.penMap.get(clinical.pen) || null,
            cause_of_death: clinical.cause,
            post_mortem_notes: clinical.pm,
            disposal_method: clinical.disposal,
            created_by: j.createdBy,
          });
        }
      }
    }

    // -------------------------------------------------------------------------
    // 4.1 Tail-enders: part of a batch is not ready to move with the rest
    // -------------------------------------------------------------------------
    // stage_master models this directly — DRY_SOW_GESTATION carries
    // alt_next_stage_code FLUSH_SERVICE under alt_trigger_condition
    // PREGNANCY_FAILED. Sows that fail the day-35 scan cannot go forward to
    // farrowing with their cohort, so they are pulled OUT into a hold batch at
    // the earlier stage and in a different pen, while the rest of the batch
    // carries on. That leaves animals from one original cohort sitting at two
    // different stages in two different places, tracked per animal via
    // animal_register.current_stage_id / current_location_id.
    console.log('\n🔀 Seeding the tail-end (PREGNANCY_FAILED) split...');

    // Batch membership is declared per animal, including the stage and pen each
    // animal is actually standing in. Most are in step with their batch; a few
    // are deliberately NOT — held back at an earlier stage, in a different pen,
    // while still belonging to the same batch. That is the case the schema
    // supports through animal_register.current_stage_id / current_location_id
    // being independent of batch_header, and it is what batch.service.ts
    // transferStage() now respects: a batch-level stage move only carries the
    // animals that were in step, leaving these behind.
    const membership: Array<{ code: string; batchNo: string; stage: string; pen: string }> = [
      // PIG-BAT-2026-0001 — in step at DRY_SOW_GESTATION in the gestation stalls
      { code: 'PIG-2026-0001', batchNo: 'PIG-BAT-2026-0001', stage: 'GESTATION', pen: 'PEN-GEST-A1' },
      { code: 'PIG-2026-0004', batchNo: 'PIG-BAT-2026-0001', stage: 'GESTATION', pen: 'PEN-GEST-A1' },
      { code: 'PIG-2026-0016', batchNo: 'PIG-BAT-2026-0001', stage: 'GESTATION', pen: 'PEN-GEST-A1' },
      { code: 'PIG-2026-0017', batchNo: 'PIG-BAT-2026-0001', stage: 'GESTATION', pen: 'PEN-GEST-A1' },
      { code: 'PIG-2026-0018', batchNo: 'PIG-BAT-2026-0001', stage: 'GESTATION', pen: 'PEN-GEST-A1' },
      { code: 'PIG-2026-0019', batchNo: 'PIG-BAT-2026-0001', stage: 'GESTATION', pen: 'PEN-GEST-A1' },
      { code: 'PIG-2026-0020', batchNo: 'PIG-BAT-2026-0001', stage: 'GESTATION', pen: 'PEN-GEST-A1' },
      { code: 'PIG-2026-0011', batchNo: 'PIG-BAT-2026-0001', stage: 'GESTATION', pen: 'PEN-GEST-A1' },
      // PIG-BAT-2026-0001 — SAME BATCH, different stage, different pen.
      // Two failed the day-35 scan and sit back in the service bay awaiting
      // re-breeding; one is in the isolation pen under treatment.
      { code: 'PIG-2026-0021', batchNo: 'PIG-BAT-2026-0001', stage: 'FLUSH',  pen: 'PEN-AI-B2' },
      { code: 'PIG-2026-0022', batchNo: 'PIG-BAT-2026-0001', stage: 'FLUSH',  pen: 'PEN-AI-B2' },
      { code: 'PIG-2026-0023', batchNo: 'PIG-BAT-2026-0001', stage: 'QUARANTINE',     pen: 'PEN-QUAR-01' },
      // PIG-BAT-2026-0002 — in step at LACTATION in the farrowing crates
      { code: 'PIG-2026-0002', batchNo: 'PIG-BAT-2026-0002', stage: 'LACTATION', pen: 'PEN-FARR-01' },
      { code: 'PIG-2026-0005', batchNo: 'PIG-BAT-2026-0002', stage: 'LACTATION', pen: 'PEN-FARR-01' },
      { code: 'PIG-2026-0024', batchNo: 'PIG-BAT-2026-0002', stage: 'LACTATION', pen: 'PEN-FARR-01' },
      { code: 'PIG-2026-0025', batchNo: 'PIG-BAT-2026-0002', stage: 'LACTATION', pen: 'PEN-FARR-01' },
      { code: 'PIG-2026-0026', batchNo: 'PIG-BAT-2026-0002', stage: 'LACTATION', pen: 'PEN-FARR-01' },
      // PIG-BAT-2026-0002 — SAME BATCH, one stage behind: still farrowing, and
      // moved to the weaner deck rather than the crate bank.
      { code: 'PIG-2026-0027', batchNo: 'PIG-BAT-2026-0002', stage: 'FARROWING', pen: 'PEN-WEAN-02' },
    ];

    const tailEnders = ['PIG-2026-0006', 'PIG-2026-0012'];
    const splitDate = '2026-08-04'; // day 35 of PIG-BAT-2026-0001 — the scan date

    const [gestBatch] = await db.select().from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.company_id, comp1Id), eq(schema.batchHeader.batch_no, 'PIG-BAT-2026-0001'))).limit(1);
    const [lactBatch] = await db.select().from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.company_id, comp1Id), eq(schema.batchHeader.batch_no, 'PIG-BAT-2026-0002'))).limit(1);

    if (gestBatch && lactBatch) {
      const flushStage = stageByCode.get('FLUSH');
      const batchByNo = new Map([[gestBatch.batch_no, gestBatch], [lactBatch.batch_no, lactBatch]]);

      for (const m of membership) {
        const aId = animalMap1.get(m.code);
        const target = batchByNo.get(m.batchNo);
        if (!aId || !target) continue;
        await db.update(schema.animalRegister).set({
          current_batch_id: target.batch_id,
          current_stage_id: stageByCode.get(m.stage)?.stage_id,
          current_location_id: penMap1.get(m.pen),
        }).where(eq(schema.animalRegister.animal_id, aId));
      }

      // The hold batch. Same scheduler as the cohort it came from — because it
      // sits at FLUSH_SERVICE, loadActiveScheduleLines() applies that
      // scheduler's flush lines to it and the gestation lines to the original
      // batch. One scheduler, two stages, two different plans.
      const holdBatchNo = 'PIG-BAT-2026-0003';
      const [cohortBatch] = await db.select({ batch_id: schema.batchHeader.batch_id })
        .from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.company_id, comp1Id), eq(schema.batchHeader.batch_no, 'PIG-BAT-2026-0001')))
        .limit(1);
      const cohortBatchId = cohortBatch?.batch_id;
      const [holdBatch] = await db.select().from(schema.batchHeader)
        .where(and(eq(schema.batchHeader.company_id, comp1Id), eq(schema.batchHeader.batch_no, holdBatchNo))).limit(1);
      let holdBatchId = holdBatch?.batch_id;
      if (!holdBatch) {
        holdBatchId = randomUUID();
        await db.insert(schema.batchHeader).values({
          batch_id: holdBatchId, tenant_id: tenantId, company_id: comp1Id, nob_id: nobId, lob_id: lobId,
          batch_no: holdBatchNo, breed_id: yorkshire.breed_id,
          // The hold group IS a split of the gestation cohort — without this link
          // the console can't mark it as one, and the two read as unrelated batches.
          parent_batch_id: cohortBatchId ?? null,
          costing_method: 'BIO_ASSET', current_stage_code: 'FLUSH', stage_id: flushStage?.stage_id,
          shed_id: shedMap1.get('SHED-GEST-01')!.id, location_id: penMap1.get('PEN-AI-B2')!,
          sub_location_id: penMap1.get('PEN-AI-B2')!,
          start_date: '2026-03-06', expected_end_date: '2026-12-05',
          opening_quantity: '2.0000', closing_quantity: '2.0000', uom: 'HEAD', status: 'ACTIVE',
          remarks: 'Tail-end hold group — failed day-35 pregnancy scan, returned to flush/service for re-breeding.',
          created_by: c1AdminId,
        });
        await db.insert(schema.batchBioAssetState).values({
          state_id: randomUUID(), batch_id: holdBatchId, stage: 'PRODUCTIVE_SOW',
          current_quantity: '2.0000', nca_book_value: '47000.0000',
        });
      } else if (!holdBatch.parent_batch_id && cohortBatchId) {
        await db.update(schema.batchHeader).set({ parent_batch_id: cohortBatchId })
          .where(eq(schema.batchHeader.batch_id, holdBatch.batch_id));
      }

      // The hold group carries the cohort's full history and then the backward
      // move: it went out to gestation with the rest and was returned to
      // service when the day-35 scan came back negative. stage_master models
      // exactly this as DRY_SOW_GESTATION's alt_next_stage_code.
      const holdLegs: Array<{ stage: string; on: string; pen: string }> = [
        { stage: 'QUARANTINE', on: '2026-03-06', pen: 'PEN-QUAR-01' },
        { stage: 'GILT_GROWER', on: '2026-04-05', pen: 'PEN-GEST-A1' },
        { stage: 'FLUSH', on: '2026-06-21', pen: 'PEN-AI-B2' },
        { stage: 'GESTATION', on: '2026-07-01', pen: 'PEN-GEST-A1' },
        { stage: 'FLUSH', on: splitDate, pen: 'PEN-AI-B2' },
      ];
      for (let i = 1; i < holdLegs.length; i++) {
        const prev = holdLegs[i - 1];
        const leg = holdLegs[i];
        const [existingLog] = await db.select().from(schema.batchStageLog)
          .where(and(
            eq(schema.batchStageLog.batch_id, holdBatchId!),
            eq(schema.batchStageLog.transferred_at, `${leg.on} 08:00:00`),
          )).limit(1);
        if (existingLog) continue;
        await db.insert(schema.batchStageLog).values({
          log_id: randomUUID(),
          batch_id: holdBatchId!,
          from_stage_code: prev.stage,
          to_stage_code: leg.stage,
          from_location_id: penMap1.get(prev.pen) || null,
          to_location_id: penMap1.get(leg.pen) || null,
          transferred_at: `${leg.on} 08:00:00`,
          transferred_by: c1AdminId,
          remarks: i === holdLegs.length - 1
            ? 'Day-35 scan negative — returned to flush/service for re-breeding.'
            : `Cohort moved from ${prev.stage} to ${leg.stage}.`,
        });
      }

      // The PARTIAL transfer itself, with one line per animal moved.
      const transferNo = 'BTR-2026-0002';
      const [existingTransfer] = await db.select().from(schema.batchTransfer)
        .where(and(eq(schema.batchTransfer.company_id, comp1Id), eq(schema.batchTransfer.transfer_no, transferNo))).limit(1);

      if (!existingTransfer) {
        const movingIds = tailEnders.map((c) => animalMap1.get(c)).filter(Boolean) as string[];
        const movingAnimals = movingIds.length
          ? await db.select().from(schema.animalRegister).where(inArray(schema.animalRegister.animal_id, movingIds))
          : [];
        const transferValue = movingAnimals.reduce((sum, a) => sum + Number(a.book_value || a.acquisition_cost || 0), 0);
        const transferId = randomUUID();

        await db.insert(schema.batchTransfer).values({
          transfer_id: transferId, tenant_id: tenantId, company_id: comp1Id, transfer_no: transferNo,
          from_batch_id: gestBatch.batch_id, to_batch_id: holdBatchId!,
          transfer_date: splitDate, transfer_type: 'PARTIAL',
          head_count: movingAnimals.length.toFixed(4), transfer_value: transferValue.toFixed(4),
          reason: 'PREGNANCY_FAILED',
          remarks: 'Day-35 scan negative — pulled out of the gestation cohort so the pregnant sows move to farrowing on schedule.',
          status: 'POSTED', posted_at: `${splitDate} 09:30:00`, posted_by: c1AdminId, created_by: c1AdminId,
        });

        let lineNo = 1;
        for (const a of movingAnimals) {
          await db.insert(schema.batchTransferLine).values({
            line_id: randomUUID(), transfer_id: transferId, line_no: lineNo++,
            animal_id: a.animal_id,
            from_location_id: penMap1.get('PEN-GEST-A1') || null,
            to_location_id: penMap1.get('PEN-AI-B2') || null,
            book_value: Number(a.book_value || a.acquisition_cost || 0).toFixed(4),
            remarks: 'Returned to flush/service for re-breeding.',
          });
        }

        // The cohort they left is two head lighter.
        await db.update(schema.batchHeader)
          .set({ closing_quantity: (Number(gestBatch.closing_quantity ?? gestBatch.opening_quantity) - movingAnimals.length).toFixed(4) })
          .where(eq(schema.batchHeader.batch_id, gestBatch.batch_id));
      }

      // Post-transfer state: same original cohort, now at a different stage and
      // a different pen from the animals left behind. Applied on every run, not
      // just the run that creates the transfer, so a re-seed cannot leave the
      // split half-applied.
      for (const code of tailEnders) {
        const aId = animalMap1.get(code);
        if (!aId) continue;
        await db.update(schema.animalRegister).set({
          current_batch_id: holdBatchId,
          current_stage_id: flushStage?.stage_id,
          current_location_id: penMap1.get('PEN-AI-B2'),
          status: 'ACTIVE',
        }).where(eq(schema.animalRegister.animal_id, aId));
      }
    }

    console.log('\n✅ Piggery Multi-Company Dataset Successfully Seeded!');
    console.log('===========================================================');
    console.log('Company 1 (APEXBREED): Apex Swine Genetics & Breeding');
    console.log('  - Area: APEX-BREED-01 (Apex Nucleus Breeding & Gestation Unit)');
    console.log('  - 15 Tagged Animals with RFIDs & Parity (Sows, Boars, Gilts)');
    console.log('  - 4 Breeding/Mating Records & 2 Farrowing Litters');
    console.log('  - 2 Boar Semen Batches with Cost-Per-Dose Split');
    console.log('  - 2 Batches (Gestation & Farrowing) with 30-Day Multi-Day Feeds');
    console.log('-----------------------------------------------------------');
    console.log('Company 2 (HIGHLAND): Highland Commercial Porkers & Processing');
    console.log('  - Area: HIGH-GROW-01 (Highland Grow-Finish Commercial Complex)');
    console.log('  - 2 Schedulers (60-Day Grower, 90-Day Porker Finisher)');
    console.log('  - 2 Batches (Active Commercial Grower & Closed Finisher)');
    console.log('  - 30-Day Grower Feeding Stream, Mortality, 4 Weekly Weight Curves');
    console.log('  - Harvest Sale Transaction (1,215,200)\n');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void seedPiggeryData().catch((err) => {
    console.error('❌ Piggery multi-company seed failed:', err);
    process.exitCode = 1;
  });
}
