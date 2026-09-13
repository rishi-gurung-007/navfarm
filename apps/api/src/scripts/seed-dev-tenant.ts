import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import * as mysql from 'mysql2/promise';
import * as master from '../core/database/master-schema';
import * as tenant from '../core/database/schema';
import { forSeededLobs, SYSTEM_UOM_SEED, SYSTEM_SPECIES_SEED, SYSTEM_ITEM_TYPE_SEED, SYSTEM_LOCATION_TYPE_SEED, SYSTEM_BREED_SEED, SYSTEM_ITEM_SEED, SYSTEM_PARAMETER_SEED, SYSTEM_STAGE_SEED, SYSTEM_NO_SERIES_SEED, SYSTEM_BREED_LIFECYCLE_SEED } from '../core/database/system-master-data-seed';
import { seedLocation } from './lib/seed-location';
import { seedCode } from './lib/seed-series-code';
import { seedDefaultCompanyRoles } from '../modules/core/role/default-role-seed';
import { STARTER_GL_ACCOUNTS, STARTER_GL_MAPPINGS, STARTER_WAREHOUSE } from '../modules/system/setup-wizard/seed/starter-master-data.seed-data';
import { seedActivitiesForTenant } from './seed-activity-master';

/**
 * One-command dev/demo environment: creates a working tenant + company +
 * TENANT_ADMIN + COMPANY_ADMIN, with the company already past onboarding and
 * carrying a starter chart of accounts, GL mappings, warehouse, and one
 * generic farm/shed — so a fresh clone of this repo can log in and start
 * creating batches immediately, without hand-building master data first.
 *
 * Prerequisite: the platform must already be bootstrapped (`db-bootstrap`) —
 * this script copies its NOB/LOB/UOM/species/language/currency taxonomy into
 * the new tenant, the same way a real signup does.
 *
 * Safe to re-run: existing tenant/company/users/master data are left as-is
 * (or upserted where that's meaningful), never duplicated.
 */

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const masterDatabase = process.env.DATABASE_NAME || 'navfarm_master';

const tenantCode = (process.env.DEV_TENANT_CODE || 'devco').toLowerCase();
const tenantName = process.env.DEV_TENANT_NAME || 'Triple C';
const companyCode = process.env.DEV_COMPANY_CODE || 'DEVCO';
const companyName = process.env.DEV_COMPANY_NAME || 'Triple C';

/**
 * The four users this seeds, one per workspace scope plus a normal user.
 *
 * One list, used both to create them and to print them at the end. It used to be
 * two: a set of env-driven constants that created nothing and were printed as
 * the login credentials, and the users the script actually inserted. The summary
 * told you to log in as tenantadmin@devco.local, which had never existed.
 */
const DEV_PASSWORD = '12345678';
const DEV_USERS = [
  { key: 'tenant', type: 'TENANT_ADMIN', name: 'Tenant Administrator', email: 'tenant.admin@triplec.local', scope: 'every company in the tenant' },
  { key: 'company', type: 'COMPANY_ADMIN', name: 'Company Administrator', email: 'company.admin@triplec.local', scope: 'one company' },
  { key: 'area', type: 'OPERATIONAL_ADMIN', name: 'Operational Administrator', email: 'area.admin@triplec.local', scope: 'one operational area' },
  { key: 'standard', type: 'STANDARD_USER', name: 'Standard User', email: 'user@triplec.local', scope: 'no admin rights' },
] as const;
const userBy = (key: (typeof DEV_USERS)[number]['key']) => DEV_USERS.find((u) => u.key === key)!;

function assertDatabaseName(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe database name: ${value}`);
  }
  return value;
}

export async function seedDevTenant() {
  if (!/^[a-z0-9-]{3,30}$/.test(tenantCode)) {
    throw new Error(`DEV_TENANT_CODE '${tenantCode}' must be 3-30 lowercase letters/numbers/hyphens.`);
  }
  if (DEV_PASSWORD.length < 8) throw new Error('DEV_PASSWORD must be at least 8 characters.');

  const masterPool = mysql.createPool({ host, port, user, password, database: masterDatabase, ssl });
  const masterDb = drizzle(masterPool, { schema: master, mode: 'default' });

  try {
    const [platformNob] = await masterDb.select().from(master.nobMaster).limit(1);
    if (!platformNob) {
      throw new Error('Platform is not bootstrapped yet — run `pnpm nx run api:db-bootstrap` first.');
    }

    const [plan] = await masterDb.select().from(master.planMaster).where(eq(master.planMaster.plan_id, 'PLAN_PRO')).limit(1);
    if (!plan) throw new Error("Plan 'PLAN_PRO' not found — run db-bootstrap first.");

    const [existingTenant] = await masterDb
      .select()
      .from(master.tenantMaster)
      .where(eq(master.tenantMaster.tenant_code, tenantCode))
      .limit(1);

    // Existing tenants must reuse their registered db_name — it can differ from
    // tenant_<code> (e.g. under an isolated DATABASE_NAME) — recomputing it here
    const defaultPrefix = masterDatabase.startsWith('piggery_') ? 'piggery_tenant_' : 'tenant_';
    const dbName = assertDatabaseName(existingTenant?.db_name || `${defaultPrefix}${tenantCode}`);
    const tenantId = existingTenant?.tenant_id || randomUUID();

    const server = await mysql.createConnection({ host, port, user, password, ssl });
    await server.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    await server.end();

    const tenantPool = mysql.createPool({ host, port, user, password, database: dbName, ssl });
    const tenantDb = drizzle(tenantPool, { schema: tenant, mode: 'default' });

    try {
      await migrate(tenantDb, { migrationsFolder: resolve(process.cwd(), 'src/drizzle/tenant') });

      // Copy the shared taxonomy in, exactly like a real tenant signup does.
      const masterLangs = await masterDb.select().from(master.languageMaster);
      const masterCurrs = await masterDb.select().from(master.currencyMaster);
      const masterTimezones = await masterDb.select().from(master.timezoneMaster);
      const masterCountries = await masterDb.select().from(master.countryMaster);
      const masterStates = await masterDb.select().from(master.stateProvince);
      const masterCostingMethods = await masterDb.select().from(master.costingMethodConfig);
      const masterSteps = await masterDb.select().from(master.setupStepMaster);
      const masterNobs = await masterDb.select().from(master.nobMaster);
      const masterLobs = await masterDb.select().from(master.lobMaster);

      for (const row of masterLangs) await tenantDb.insert(tenant.languageMaster).values(row).onDuplicateKeyUpdate({ set: { ...row } });
      for (const row of masterCurrs) await tenantDb.insert(tenant.currencyMaster).values(row).onDuplicateKeyUpdate({ set: { ...row } });
      for (const row of masterTimezones) await tenantDb.insert(tenant.timezoneMaster).values(row).onDuplicateKeyUpdate({ set: { ...row } });
      for (const row of masterCountries) await tenantDb.insert(tenant.countryMaster).values(row).onDuplicateKeyUpdate({ set: { ...row } });
      for (const row of masterStates) await tenantDb.insert(tenant.stateProvince).values(row).onDuplicateKeyUpdate({ set: { ...row } });
      for (const row of masterCostingMethods) await tenantDb.insert(tenant.costingMethodConfig).values(row).onDuplicateKeyUpdate({ set: { ...row } });
      for (const row of masterSteps) await tenantDb.insert(tenant.setupStepMaster).values(row).onDuplicateKeyUpdate({ set: { ...row } });
      for (const row of masterNobs) await tenantDb.insert(tenant.nobMaster).values(row).onDuplicateKeyUpdate({ set: { ...row } });
      for (const row of masterLobs) await tenantDb.insert(tenant.lobMaster).values(row).onDuplicateKeyUpdate({ set: { ...row } });

      const nobIdByCode = new Map(masterNobs.map((n) => [n.nob_code, n.nob_id]));
      const lobIdByCode = new Map(masterLobs.map((l) => [l.lob_code, l.lob_id]));
      // The number series come first: every master below takes its code from
      // one, and a master seeded before its series exists silently falls back
      // to a hand-written code. That is exactly what happened to the starter
      // items and the breed-lifecycle rows, which were seeded above this block
      // and came out as LVS-PIGLET and LANDRACE-WEANING instead of series codes.
      const existingSeriesCodes = new Set((await tenantDb.select({ c: tenant.noSeriesMaster.series_code }).from(tenant.noSeriesMaster)).map((r) => r.c));
      for (const series of SYSTEM_NO_SERIES_SEED) {
        if (existingSeriesCodes.has(series.series_code)) continue;
        const seriesNobId = series.nob_code ? nobIdByCode.get(series.nob_code) : undefined;
        const seriesLobId = series.lob_code ? lobIdByCode.get(series.lob_code) : undefined;
        if ((series.nob_code && !seriesNobId) || (series.lob_code && !seriesLobId)) continue;
        await tenantDb.insert(tenant.noSeriesMaster).values({
          series_id: randomUUID(),
          tenant_id: tenantId,
          company_id: null,
          nob_id: seriesNobId || null,
          lob_id: seriesLobId || null,
          series_code: series.series_code,
          series_name: series.series_name,
          document_type: series.document_type,
          prefix: series.prefix || null,
          separator: series.separator,
          seq_separator: series.seq_separator || null,
          code_segments: series.code_segments ?? null,
          prefix_position: series.prefix_position ?? 'END',
          seq_length: series.seq_length,
          current_seq: 0,
          reset_frequency: series.reset_frequency,
          allow_manual: series.allow_manual ?? false,
          is_active: series.is_active ?? true,
        });
      }

      const [existingUom] = await tenantDb.select().from(tenant.uomMaster).limit(1);
      if (!existingUom) {
        await tenantDb.insert(tenant.uomMaster).values(SYSTEM_UOM_SEED.map((u) => ({ ...u, tenant_id: tenantId })));
      }
      const [existingSpecies] = await tenantDb.select().from(tenant.speciesMaster).limit(1);
      if (!existingSpecies) {
        await tenantDb.insert(tenant.speciesMaster).values(SYSTEM_SPECIES_SEED.map((s) => ({ ...s, tenant_id: tenantId })));
      }
      const [existingItemType] = await tenantDb.select().from(tenant.itemTypeMaster).limit(1);
      if (!existingItemType) {
        await tenantDb.insert(tenant.itemTypeMaster).values(SYSTEM_ITEM_TYPE_SEED.map((t) => ({ ...t, tenant_id: tenantId, is_system: true })));
      }
      const existingLocationTypeCodes = new Set((await tenantDb.select({ c: tenant.locationTypeMaster.type_code }).from(tenant.locationTypeMaster)).map((r) => r.c));
      for (const locationType of SYSTEM_LOCATION_TYPE_SEED) {
        if (existingLocationTypeCodes.has(locationType.type_code)) continue;
        await tenantDb.insert(tenant.locationTypeMaster).values({ ...locationType, tenant_id: tenantId, is_system: true });
      }

      // Default breeds/items/parameters per NOB/LOB, visible tenant-wide
      // (company_id null, matching the wildcard convention those services
      // already match on) so every company under this tenant starts with a
      // real catalog instead of empty dropdowns. Idempotent per-code (not a
      // single any-row-exists gate) so extending these lists later backfills
      // cleanly into tenants that were seeded before the addition.
      const speciesRows = await tenantDb.select().from(tenant.speciesMaster);
      const speciesIdByCode = new Map(speciesRows.map((s) => [s.species_code, s.species_id]));

      const existingBreedCodes = new Set((await tenantDb.select({ c: tenant.breedMaster.breed_code }).from(tenant.breedMaster)).map((r) => r.c));
      for (const breed of forSeededLobs(SYSTEM_BREED_SEED)) {
        if (existingBreedCodes.has(breed.breed_code)) continue;
        const nobId = nobIdByCode.get(breed.nob_code);
        const lobId = lobIdByCode.get(breed.lob_code);
        const speciesId = speciesIdByCode.get(breed.species_code);
        if (!nobId || !lobId) continue;
        await tenantDb.insert(tenant.breedMaster).values({
          breed_id: randomUUID(),
          tenant_id: tenantId,
          company_id: null,
          nob_id: nobId,
          lob_id: lobId,
          breed_code: breed.breed_code,
          breed_name: breed.breed_name,
          species_id: speciesId || null,
          breed_type: breed.breed_type,
          gestation_days: breed.gestation_days ?? null,
          lactation_days: breed.lactation_days ?? null,
          productive_life_months: breed.productive_life_months ?? null,
          residual_value_pct: breed.residual_value_pct?.toString() ?? null,
          productive_life_cycles: breed.productive_life_cycles ?? null,
          avg_litter_size_born: breed.avg_litter_size_born?.toString() ?? null,
          avg_litter_size_weaned: breed.avg_litter_size_weaned?.toString() ?? null,
          avg_weaning_weight_kg: breed.avg_weaning_weight_kg?.toString() ?? null,
          farrowing_rate_pct: breed.farrowing_rate_pct?.toString() ?? null,
          boar_doses_per_week: breed.boar_doses_per_week?.toString() ?? null,
          boar_productive_life_months: breed.boar_productive_life_months ?? null,
        });
      }

      const itemIdByCode = new Map<string, string>();
      // Keyed by the SEED's item_code (LVS-PIGLET), which is this script's handle
      // for wiring breed-lifecycle rows to items — not by the stored item_code,
      // which the ITEM series composes and which therefore is not known here.
      const seedItemCodeByName = new Map(SYSTEM_ITEM_SEED.map((i) => [i.item_name, i.item_code]));
      for (const row of await tenantDb.select().from(tenant.itemMaster)) {
        itemIdByCode.set(seedItemCodeByName.get(row.item_name) ?? row.item_code, row.item_id);
      }
      for (const item of forSeededLobs(SYSTEM_ITEM_SEED)) {
        if (itemIdByCode.has(item.item_code)) continue;
        const nobId = nobIdByCode.get(item.nob_code);
        const lobId = lobIdByCode.get(item.lob_code);
        if (!nobId || !lobId) continue;
        const itemId = randomUUID();
        itemIdByCode.set(item.item_code, itemId);
        await tenantDb.insert(tenant.itemMaster).values({
          item_id: itemId,
          tenant_id: tenantId,
          company_id: null,
          nob_id: nobId,
          lob_id: lobId,
          // These starter items carry no category, so the ITEM series composes
          // <item_type>-ITM-<seq> for them.
          item_code: await seedCode(tenantDb, tenantId, null, 'ITEM', tenant.itemMaster, tenant.itemMaster.item_code, item.item_code, { item_type: item.item_type }),
          item_name: item.item_name,
          item_type: item.item_type,
          uom_primary: item.uom_primary,
        });
      }

      const existingParameterCodes = new Set((await tenantDb.select({ c: tenant.parameterMaster.parameter_code }).from(tenant.parameterMaster)).map((r) => r.c));
      for (const param of forSeededLobs(SYSTEM_PARAMETER_SEED)) {
        if (existingParameterCodes.has(param.parameter_code)) continue;
        const nobId = nobIdByCode.get(param.nob_code);
        const lobId = lobIdByCode.get(param.lob_code);
        if (!nobId || !lobId) continue;
        const itemId = param.item_code ? itemIdByCode.get(param.item_code) : undefined;
        await tenantDb.insert(tenant.parameterMaster).values({
          parameter_id: randomUUID(),
          tenant_id: tenantId,
          company_id: null,
          nob_id: nobId,
          lob_id: lobId,
          parameter_code: param.parameter_code,
          parameter_name: param.parameter_name,
          parameter_type: param.parameter_type,
          item_id: itemId || null,
          default_uom: param.default_uom,
          qty_method: param.qty_method,
          default_qty_per_unit: param.default_qty_per_unit != null ? param.default_qty_per_unit.toString() : null,
          default_qty_per_batch: param.default_qty_per_batch != null ? param.default_qty_per_batch.toString() : null,
          is_mandatory: param.is_mandatory ?? false,
        });
      }

      const pigLobId = lobIdByCode.get('LVS_PIGGERY');
      const pigNobId = nobIdByCode.get('LIVESTOCK');
      const existingStageCodes = new Set((await tenantDb.select({ c: tenant.stageMaster.stage_code }).from(tenant.stageMaster)).map((r) => r.c));
      if (pigLobId && pigNobId) {
        // Two passes — next_stage_id/alt_next_stage_id are FKs MySQL checks per-statement
        // (BOAR_AI even points at itself), so insert every row first, then wire the chain.
        const stageIdByCode = new Map(SYSTEM_STAGE_SEED.map((s) => [s.stage_code, randomUUID()]));
        for (const stage of SYSTEM_STAGE_SEED) {
          if (existingStageCodes.has(stage.stage_code)) continue;
          await tenantDb.insert(tenant.stageMaster).values({
            stage_id: stageIdByCode.get(stage.stage_code)!,
            tenant_id: tenantId,
            company_id: null,
            nob_id: pigNobId,
            lob_id: pigLobId,
            stage_code: stage.stage_code,
            stage_name: stage.stage_name,
            stage_category: stage.stage_category,
            stage_sequence: stage.stage_sequence,
            typical_duration_days: stage.typical_duration_days ?? null,
            min_days_before_move: stage.min_days_before_move,
            transition_trigger: stage.transition_trigger,
            auto_move_on_day: stage.auto_move_on_day ?? null,
            alt_trigger_condition: stage.alt_trigger_condition || null,
            data_entry_form: stage.data_entry_form,
            show_on_animal_card: stage.show_on_animal_card,
            stage_description: stage.stage_description,
            sort_order: stage.stage_sequence,
            is_system: true,
          });
        }
        for (const stage of SYSTEM_STAGE_SEED) {
          if (existingStageCodes.has(stage.stage_code)) continue;
          if (!stage.next_stage_code && !stage.alt_next_stage_code) continue;
          await tenantDb.update(tenant.stageMaster).set({
            next_stage_id: stage.next_stage_code ? stageIdByCode.get(stage.next_stage_code) || null : null,
            alt_next_stage_id: stage.alt_next_stage_code ? stageIdByCode.get(stage.alt_next_stage_code) || null : null,
          }).where(eq(tenant.stageMaster.stage_id, stageIdByCode.get(stage.stage_code)!));
        }

        // Seed breed lifecycle stages — per-stage production standards (FCR, ADG,
        // feed intake, mortality rate, KPI thresholds). Resolved breed_code and
        // stage_code to live UUIDs using the maps already built above.
        // Existing rows are identified by (breed_id + stage_id) uniqueness — the
        // schema has no explicit unique constraint on that pair so we track
        // the set ourselves to keep the script idempotent on re-runs.
        const breedIdByCode = new Map(
          (await tenantDb.select({ code: tenant.breedMaster.breed_code, id: tenant.breedMaster.breed_id }).from(tenant.breedMaster))
            .map((r) => [r.code, r.id]),
        );
        const liveStageIdByCode = new Map(
          (await tenantDb.select({ code: tenant.stageMaster.stage_code, id: tenant.stageMaster.stage_id }).from(tenant.stageMaster))
            .map((r) => [r.code, r.id]),
        );
        // Existing lifecycle rows keyed as "breedId:stageId" for O(1) de-dup.
        const existingLifecycleKeys = new Set(
          (await tenantDb.select({ b: tenant.breedLifecycleStages.breed_id, s: tenant.breedLifecycleStages.stage_id }).from(tenant.breedLifecycleStages))
            .map((r) => `${r.b}:${r.s}`),
        );
        for (const lc of SYSTEM_BREED_LIFECYCLE_SEED) {
          const breedId = breedIdByCode.get(lc.breed_code);
          const stageId = liveStageIdByCode.get(lc.stage_code);
          if (!breedId || !stageId) continue; // breed or stage not seeded yet — safe to skip
          const key = `${breedId}:${stageId}`;
          if (existingLifecycleKeys.has(key)) continue;
          existingLifecycleKeys.add(key);
          const feedItemId  = lc.feed_item_code   ? itemIdByCode.get(lc.feed_item_code)   : undefined;
          const outputItemId = lc.output_item_code ? itemIdByCode.get(lc.output_item_code) : undefined;
          await tenantDb.insert(tenant.breedLifecycleStages).values({
            lifecycle_id:                 randomUUID(),
            tenant_id:                    tenantId,
            lifecycle_code:               await seedCode(tenantDb, tenantId, null, 'BREED_LIFECYCLE_STAGE', tenant.breedLifecycleStages, tenant.breedLifecycleStages.lifecycle_code, `${lc.breed_code}-${lc.stage_code}`, { breed_id: lc.breed_code, stage_id: lc.stage_code }),
            breed_id:                     breedId,
            stage_id:                     stageId,
            calc_unit:                    lc.calc_unit,
            period_from:                  lc.period_from,
            period_to:                    lc.period_to,
            feed_item_id:                 feedItemId   || null,
            feed_qty_per_head_per_day_kg: lc.feed_qty_per_head_per_day_kg != null ? lc.feed_qty_per_head_per_day_kg.toString() : null,
            feed_wastage_pct:             lc.feed_wastage_pct             != null ? lc.feed_wastage_pct.toString()             : null,
            std_body_weight_kg:           lc.std_body_weight_kg           != null ? lc.std_body_weight_kg.toString()           : null,
            std_adg_gpd:                  lc.std_adg_gpd                  != null ? lc.std_adg_gpd.toString()                  : null,
            std_fcr:                      lc.std_fcr                      != null ? lc.std_fcr.toString()                      : null,
            std_mortality_rate_pct:       lc.std_mortality_rate_pct       != null ? lc.std_mortality_rate_pct.toString()       : null,
            output_item_id:               outputItemId || null,
            output_uom:                   lc.output_uom  || null,
            std_output_qty:               lc.std_output_qty               != null ? lc.std_output_qty.toString()               : null,
            kpi_lower_limit:              lc.kpi_lower_limit              != null ? lc.kpi_lower_limit.toString()              : null,
            kpi_upper_limit:              lc.kpi_upper_limit              != null ? lc.kpi_upper_limit.toString()              : null,
            alert_severity:               lc.alert_severity  || null,
            notes:                        lc.notes           || null,
            is_active:                    true,
          });
        }
      }

      const defaultLangId = masterLangs.find((l) => l.is_system_default)?.lang_id || masterLangs[0]?.lang_id;
      // USD by name, not by list order. The currency master is a plain ISO
      // reference list with no system default, so `masterCurrs[0]` handed the
      // Zimbabwe piggery the Indian Rupee purely because INR is seeded first.
      // BBP-1 §1.1 makes USD the base and ZWL the foreign currency.
      const defaultCurrId =
        masterCurrs.find((c) => c.iso_code === 'USD')?.currency_id ||
        masterCurrs.find((c) => c.is_system_default)?.currency_id ||
        masterCurrs[0]?.currency_id;

      // Real random UUIDs, reused across reruns by looking up the existing
      // company by code first — not the old hardcoded '...0000'/'...0001'
      // pattern, which class-validator's @IsUUID() rejects for anything
      // past the all-zeros nil UUID (its version nibble isn't 1-5), breaking
      // every company-scoped endpoint for the second company.
      // One company. The demo used to seed a second, HIGHLAND, which existed only
      // to exercise company scoping — and cost every later script a decision about
      // which company it meant. One tenant, one company, one operational area.
      const [existingCompany] = await tenantDb.select().from(tenant.companyMaster).where(eq(tenant.companyMaster.company_code, 'TRIPLEC')).limit(1);
      const COMPANY_1_ID = existingCompany?.company_id || randomUUID();

      const companyConfigs = [
        {
          id: COMPANY_1_ID,
          code: 'TRIPLEC',
          name: 'Triple C',
          industry: 'Piggery',
          farmCode: 'FARM-01',
          farmName: 'Triple C Farm',
          farmCapacity: 165,
          shedCode: 'SHED-GEST-01',
          shedName: 'Breeding & Gestation Complex',
          shedType: 'GESTATION',
          shedCapacity: 71,
          areaCode: 'PIGGERY-01',
          areaName: 'Piggery',
        },
      ];

      for (const cc of companyConfigs) {
        await tenantDb
          .insert(tenant.companyMaster)
          .values({
            company_id: cc.id,
            tenant_id: tenantId,
            company_code: cc.code,
            company_name: cc.name,
            company_display_name: cc.name,
            company_type: 'Pvt Ltd',
            industry_type: cc.industry,
            base_currency_id: defaultCurrId,
            default_language_id: defaultLangId,
            default_timezone_id: 'Africa/Harare',
            country_id: 'ZWE',
            financial_year_start: 1,
            onboarding_status: 'COMPLETED',
            is_active: true,
          })
          .onDuplicateKeyUpdate({
            set: {
              company_code: cc.code,
              company_name: cc.name,
              company_display_name: cc.name,
              // Locale is seed-owned on the dev tenant. Left out of this set,
              // a rerun could not correct a company already sitting on the old
              // INR / IND / April-fiscal-year defaults.
              base_currency_id: defaultCurrId,
              default_language_id: defaultLangId,
              default_timezone_id: 'Africa/Harare',
              country_id: 'ZWE',
              financial_year_start: 1,
              onboarding_status: 'COMPLETED',
              is_active: true,
            },
          });

        // Starter chart of accounts + GL mappings + warehouse for each company
        const [existingGl] = await tenantDb.select().from(tenant.glAccountMaster).where(eq(tenant.glAccountMaster.company_id, cc.id)).limit(1);
        if (!existingGl) {
          const accountIdByCode = new Map<string, string>();
          for (const account of STARTER_GL_ACCOUNTS) {
            const glAccountId = randomUUID();
            accountIdByCode.set(account.account_code, glAccountId);
            await tenantDb.insert(tenant.glAccountMaster).values({
              gl_account_id: glAccountId,
              tenant_id: tenantId,
              company_id: cc.id,
              account_code: account.account_code,
              account_name: account.account_name,
              account_type: account.account_type,
            });
          }
          for (const mapping of STARTER_GL_MAPPINGS) {
            const debitAccountId = accountIdByCode.get(mapping.debit_account_code);
            const creditAccountId = accountIdByCode.get(mapping.credit_account_code);
            if (!debitAccountId || !creditAccountId) continue;
            await tenantDb.insert(tenant.glMappingMaster).values({
              mapping_id: randomUUID(),
              tenant_id: tenantId,
              company_id: cc.id,
              mapping_code: await seedCode(tenantDb, tenantId, cc.id, 'GL_MAPPING', tenant.glMappingMaster, tenant.glMappingMaster.mapping_code, mapping.transaction_type),
              transaction_type: mapping.transaction_type,
              debit_gl_account_id: debitAccountId,
              credit_gl_account_id: creditAccountId,
            });
          }
        }

        // Farm, shed, store and silo are LOCATIONS, not separate masters —
        // one location_master row each, distinguished by location_type and by
        // whether parent_location_id is set. See scripts/lib/seed-location.ts.
        const nobId = nobIdByCode.get('LIVESTOCK') || null;
        const lobId = lobIdByCode.get('LVS_PIGGERY') || null;
        const locCtx = { tenantId, companyId: cc.id, nobId, lobId };

        // FARM -> SHED -> (PEN seeded by the piggery script), plus a STORE on
        // the farm and a SILO on the shed, which is the attachment the
        // location type master allows (SILO parents: FARM or SHED).
        const farmLoc = await seedLocation(tenantDb, locCtx, { key: cc.farmCode, name: cc.farmName, type: 'FARM', capacity: cc.farmCapacity });
        const farmId = farmLoc.id;
        const shedLoc = await seedLocation(tenantDb, locCtx, { key: cc.shedCode, name: cc.shedName, type: 'SHED', parent: farmLoc, subType: cc.shedType, capacity: cc.shedCapacity });
        await seedLocation(tenantDb, locCtx, {
          key: `WH-${cc.code}-MAIN`, name: `${cc.name} Central Warehouse`, type: 'STORE',
          parent: farmLoc, storageType: 'STORE', subType: STARTER_WAREHOUSE.warehouse_type,
        });
        await seedLocation(tenantDb, locCtx, {
          key: `SILO-${cc.code}-01`, name: `${cc.shedName} Feed Silo`, type: 'SILO',
          parent: shedLoc, storageType: 'SILO', siloCapacityKg: 25000, siloReorderDays: 7,
        });

        // The operational area. It was never seeded here — a later coverage
        // script created it — so a fresh dev tenant had no area at all, and an
        // OPERATIONAL_ADMIN had nothing to be scoped to.
        const [existingArea] = await tenantDb.select().from(tenant.operationalAreaMaster)
          .where(eq(tenant.operationalAreaMaster.company_id, cc.id)).limit(1);
        // Piggery: the only line of business in scope, and the one the area
        // belongs to. Resolved here rather than reusing a loop variable from the
        // breed seeding above, which is out of scope by this point.
        const areaNobId = nobIdByCode.get('LIVESTOCK');
        const areaLobId = lobIdByCode.get('LVS_PIGGERY');
        if (!existingArea && farmId && areaNobId && areaLobId) {
          await tenantDb.insert(tenant.operationalAreaMaster).values({
            area_id: randomUUID(),
            tenant_id: tenantId,
            company_id: cc.id,
            farm_id: farmId,
            nob_id: areaNobId,
            lob_id: areaLobId,
            area_code: cc.areaCode,
            area_name: cc.areaName,
            preseed_source: 'TENANT',
            is_active: true,
          });
        }
      }

      // Users: one per workspace scope, plus a normal user
      const commonPasswordHash = await bcrypt.hash(DEV_PASSWORD, 10);
      const tenantAdminUserId = randomUUID();
      const comp1AdminUserId = randomUUID();

      // 1. Tenant Admin — sees every company in the tenant.
      const [existingTenantAdmin] = await tenantDb.select().from(tenant.userMaster).where(eq(tenant.userMaster.email, userBy('tenant').email)).limit(1);
      const tAdminId = existingTenantAdmin?.user_id || tenantAdminUserId;
      if (!existingTenantAdmin) {
        await tenantDb.insert(tenant.userMaster).values({
          user_id: tAdminId,
          company_id: COMPANY_1_ID,
          tenant_id: tenantId,
          full_name: userBy('tenant').name,
          email: userBy('tenant').email,
          password_hash: commonPasswordHash,
          user_type: 'TENANT_ADMIN',
          is_active: true,
        });
      } else {
        await tenantDb.update(tenant.userMaster).set({ password_hash: commonPasswordHash, is_active: true }).where(eq(tenant.userMaster.user_id, tAdminId));
      }

      // 2. Company Admin — sees one company.
      const [existingComp1Admin] = await tenantDb.select().from(tenant.userMaster).where(eq(tenant.userMaster.email, userBy('company').email)).limit(1);
      const c1AdminId = existingComp1Admin?.user_id || comp1AdminUserId;
      if (!existingComp1Admin) {
        await tenantDb.insert(tenant.userMaster).values({
          user_id: c1AdminId,
          company_id: COMPANY_1_ID,
          tenant_id: tenantId,
          full_name: userBy('company').name,
          email: userBy('company').email,
          password_hash: commonPasswordHash,
          user_type: 'COMPANY_ADMIN',
          is_active: true,
        });
      } else {
        await tenantDb.update(tenant.userMaster).set({ password_hash: commonPasswordHash, is_active: true }).where(eq(tenant.userMaster.user_id, c1AdminId));
      }

      // 3. Operational Admin — sees one operational area, not the whole company.
      const opAdminUserId = randomUUID();
      const [existingOpAdmin] = await tenantDb.select().from(tenant.userMaster).where(eq(tenant.userMaster.email, userBy('area').email)).limit(1);
      const opAdminId = existingOpAdmin?.user_id || opAdminUserId;
      if (!existingOpAdmin) {
        await tenantDb.insert(tenant.userMaster).values({
          user_id: opAdminId,
          company_id: COMPANY_1_ID,
          tenant_id: tenantId,
          full_name: userBy('area').name,
          email: userBy('area').email,
          password_hash: commonPasswordHash,
          user_type: 'OPERATIONAL_ADMIN',
          is_active: true,
        });
      } else {
        await tenantDb.update(tenant.userMaster).set({ password_hash: commonPasswordHash, is_active: true }).where(eq(tenant.userMaster.user_id, opAdminId));
      }

      // 4. Standard User — the normal user. No admin rights, and the only type an
      // Operational Admin is allowed to create (auth.service.ts).
      const standardUserId = randomUUID();
      const [existingStandard] = await tenantDb.select().from(tenant.userMaster).where(eq(tenant.userMaster.email, userBy('standard').email)).limit(1);
      const stdId = existingStandard?.user_id || standardUserId;
      if (!existingStandard) {
        await tenantDb.insert(tenant.userMaster).values({
          user_id: stdId,
          company_id: COMPANY_1_ID,
          tenant_id: tenantId,
          full_name: userBy('standard').name,
          email: userBy('standard').email,
          password_hash: commonPasswordHash,
          user_type: 'STANDARD_USER',
          is_active: true,
        });
      } else {
        await tenantDb.update(tenant.userMaster).set({ password_hash: commonPasswordHash, is_active: true }).where(eq(tenant.userMaster.user_id, stdId));
      }

      // Roles and permissions. seed-dev-tenant inserts the company row
      // directly rather than going through CompanyService.create(), which is
      // the hook that normally seeds them — so a freshly seeded dev tenant had
      // an empty role_master. RolesGuard waves through SYSTEM_ADMIN,
      // TENANT_ADMIN and COMPANY_ADMIN, but OPERATIONAL_ADMIN and
      // STANDARD_USER are checked against role_permissions, so those two users
      // could not view a single screen.
      const [existingRole] = await tenantDb.select().from(tenant.roleMaster)
        .where(eq(tenant.roleMaster.company_id, COMPANY_1_ID)).limit(1);
      const roleIds = existingRole
        ? {
            superAdminRoleId: (await tenantDb.select().from(tenant.roleMaster)
              .where(and(eq(tenant.roleMaster.company_id, COMPANY_1_ID), eq(tenant.roleMaster.role_code, 'SUPER_ADMIN'))).limit(1))[0]?.role_id,
            managerRoleId: (await tenantDb.select().from(tenant.roleMaster)
              .where(and(eq(tenant.roleMaster.company_id, COMPANY_1_ID), eq(tenant.roleMaster.role_code, 'MANAGER'))).limit(1))[0]?.role_id,
            operatorRoleId: (await tenantDb.select().from(tenant.roleMaster)
              .where(and(eq(tenant.roleMaster.company_id, COMPANY_1_ID), eq(tenant.roleMaster.role_code, 'OPERATOR'))).limit(1))[0]?.role_id,
          }
        : await seedDefaultCompanyRoles(tenantDb, COMPANY_1_ID);

      const userRoleMap = [
        { userId: tAdminId, roleId: roleIds.superAdminRoleId },
        { userId: c1AdminId, roleId: roleIds.superAdminRoleId },
        { userId: opAdminId, roleId: roleIds.managerRoleId },
        { userId: stdId, roleId: roleIds.operatorRoleId },
      ];
      for (const ur of userRoleMap) {
        if (!ur.roleId) continue;
        const [existingURA] = await tenantDb.select().from(tenant.userRoleAssignment)
          .where(and(eq(tenant.userRoleAssignment.user_id, ur.userId), eq(tenant.userRoleAssignment.role_id, ur.roleId)))
          .limit(1);
        if (!existingURA) {
          await tenantDb.insert(tenant.userRoleAssignment).values({
            assign_id: randomUUID(),
            user_id: ur.userId,
            role_id: ur.roleId,
            assigned_by: tAdminId,
          });
        }
      }

      // Assign User Company Access
      const userCompanyMap = [
        { userId: tAdminId, companyId: COMPANY_1_ID, primary: true },
        { userId: c1AdminId, companyId: COMPANY_1_ID, primary: true },
        { userId: opAdminId, companyId: COMPANY_1_ID, primary: true },
        { userId: stdId, companyId: COMPANY_1_ID, primary: true },
      ];
      for (const uc of userCompanyMap) {
        const [existingUCA] = await tenantDb.select().from(tenant.userCompanyAssignments)
          .where(and(eq(tenant.userCompanyAssignments.user_id, uc.userId), eq(tenant.userCompanyAssignments.company_id, uc.companyId)))
          .limit(1);
        if (!existingUCA) {
          await tenantDb.insert(tenant.userCompanyAssignments).values({
            assign_id: randomUUID(),
            user_id: uc.userId,
            company_id: uc.companyId,
            is_primary: uc.primary,
            is_active: true,
            assigned_by: tAdminId,
          });
        }
      }

      await seedActivitiesForTenant(tenantDb, tenantId);
    } catch (err) {
      if (!existingTenant) {
        await masterDb.execute(`DROP DATABASE IF EXISTS \`${dbName}\``);
      }
      throw err;
    } finally {
      await tenantPool.end();
    }

    // Register tenant + subscription in the control plane (idempotent).
    if (!existingTenant) {
      const today = new Date().toISOString().slice(0, 10);
      await masterDb.insert(master.tenantMaster).values({
        tenant_id: tenantId,
        tenant_code: tenantCode,
        tenant_name: tenantName,
        tenant_type: 'SME',
        plan_id: plan.plan_id,
        plan_start_date: today,
        billing_email: userBy('tenant').email,
        billing_cycle: plan.billing_cycle,
        max_companies: plan.max_companies,
        max_users: plan.max_users,
        api_rate_limit: 1000,
        db_host: host,
        db_port: port,
        db_name: dbName,
        db_user: user,
        db_password: password,
      });
      await masterDb.insert(master.tenantSubscription).values({
        tenant_id: tenantId,
        plan_code: plan.plan_id,
        storage_limit_gb: plan.storage_limit_gb,
        support_tier: 'STANDARD',
        sla_uptime_pct: '99.50',
        renewal_auto: true,
        feature_flags: plan.feature_flags,
      });
    }

    console.log('');
    console.log('Dev tenant ready.');
    console.log('==================');
    console.log(`Tenant code:      ${tenantCode}  (send as x-tenant-id header, or ?tenant=${tenantCode} on the login page)`);
    console.log(`Company:          ${companyName} (TRIPLEC)`);
    console.log('');
    for (const u of DEV_USERS) {
      console.log(`  ${u.email.padEnd(30)} ${DEV_PASSWORD.padEnd(10)} ${u.type.padEnd(19)} ${u.scope}`);
    }
    console.log('');
    console.log(`Login:            http://localhost:3001/login?tenant=${tenantCode}`);
    console.log('Starter GL accounts, GL mappings, one warehouse, and one farm/shed are already seeded.');
    console.log('');
  } finally {
    await masterPool.end();
  }
}

if (require.main === module) {
  void seedDevTenant().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
