import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import * as mysql from 'mysql2/promise';
import * as master from '../core/database/master-schema';
import * as tenant from '../core/database/schema';
import { CURRENCY_SEED_ROWS, defaultCurrencyIdFor } from './lib/currency-seed-data';

/**
 * Upsert payload with the primary key stripped.
 *
 * These seeds generate a fresh UUID per row on every run and matched on the
 * natural unique key (tz_code, iso2, ...). Spreading the whole row into the
 * update set therefore rewrote the primary key of a row that already existed,
 * which fails as soon as anything references it — re-running bootstrap died on
 * timezone_master because user_master.timezone_pref_id points at it. The
 * natural key is what identifies the row; the surrogate id must not move.
 */
function withoutId<T extends Record<string, unknown>>(row: T, idKey: keyof T): Partial<T> {
  const { [idKey]: _omitted, ...rest } = row;
  return rest as Partial<T>;
}

const SYSTEM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const SYSTEM_COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const ENGLISH_ID = '10000000-1000-1000-1000-100000000001';
const USD_ID = '20000000-2000-2000-2000-200000000002';

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const masterDatabase = process.env.DATABASE_NAME || 'navfarm_master';
const systemDatabase = process.env.SYSTEM_TENANT_DATABASE || 'tenant_system';
const adminEmail = process.env.SYSTEM_ADMIN_EMAIL || 'admin@navfarm.local';
const adminPassword = process.env.SYSTEM_ADMIN_PASSWORD;

function assertDatabaseName(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`Unsafe database name: ${value}`);
  }
  return value;
}

export async function bootstrap() {
  if (!adminPassword || adminPassword.length < 8) {
    throw new Error('SYSTEM_ADMIN_PASSWORD must be at least 8 characters long.');
  }

  assertDatabaseName(masterDatabase);
  assertDatabaseName(systemDatabase);

  const server = await mysql.createConnection({ host, port, user, password, ssl });
  await server.query(`CREATE DATABASE IF NOT EXISTS \`${masterDatabase}\``);
  await server.query(`CREATE DATABASE IF NOT EXISTS \`${systemDatabase}\``);
  await server.end();

  const masterPool = mysql.createPool({
    host,
    port,
    user,
    password,
    database: masterDatabase,
    ssl,
  });
  const tenantPool = mysql.createPool({
    host,
    port,
    user,
    password,
    database: systemDatabase,
    ssl,
  });
  const masterDb = drizzle(masterPool, { schema: master, mode: 'default' });
  const tenantDb = drizzle(tenantPool, { schema: tenant, mode: 'default' });

  try {
    await migrate(masterDb, {
      migrationsFolder: resolve(process.cwd(), 'src/drizzle/master'),
    });
    await migrate(tenantDb, {
      migrationsFolder: resolve(process.cwd(), 'src/drizzle/tenant'),
    });

    const plans: Array<typeof master.planMaster.$inferInsert> = [
      {
        plan_id: 'PLAN_BASIC',
        plan_name: 'Basic',
        price: '0.00',
        billing_cycle: 'MONTHLY',
        max_companies: 1,
        max_users: 5,
        storage_limit_gb: '5.00',
        feature_flags: { onboarding: true, operations: false },
      },
      {
        plan_id: 'PLAN_PRO',
        plan_name: 'Professional',
        price: '0.00',
        billing_cycle: 'MONTHLY',
        max_companies: 5,
        max_users: 75,
        storage_limit_gb: '50.00',
        feature_flags: { onboarding: true, operations: true },
      },
      {
        plan_id: 'PLAN_ENTERPRISE',
        plan_name: 'Enterprise',
        price: '0.00',
        billing_cycle: 'ANNUAL',
        max_companies: 100,
        max_users: 1000,
        storage_limit_gb: '500.00',
        feature_flags: { onboarding: true, operations: true, enterprise: true },
      },
    ];
    for (const plan of plans) {
      await masterDb
        .insert(master.planMaster)
        .values(plan)
        .onDuplicateKeyUpdate({ set: withoutId(plan, 'plan_id') });
    }

    const languages: Array<typeof master.languageMaster.$inferInsert> = [
      {
        lang_id: ENGLISH_ID,
        lang_code: 'en',
        lang_name_english: 'English',
        lang_name_native: 'English',
        script: 'Latin',
        is_system_default: true,
        translation_coverage_pct: '100.00',
        flag_emoji: '🇬🇧',
      },
      {
        lang_id: '10000000-1000-1000-1000-100000000002',
        lang_code: 'hi',
        lang_name_english: 'Hindi',
        lang_name_native: 'हिन्दी',
        script: 'Devanagari',
        translation_coverage_pct: '0.00',
        flag_emoji: '🇮🇳',
      },
    ];
    for (const language of languages) {
      await masterDb
        .insert(master.languageMaster)
        .values(language)
        .onDuplicateKeyUpdate({ set: withoutId(language, 'lang_id') });
      await tenantDb
        .insert(tenant.languageMaster)
        .values(language)
        .onDuplicateKeyUpdate({ set: withoutId(language, 'lang_id') });
    }

    /**
     * Currency reference data and the country defaults live in
     * lib/currency-seed-data.ts, shared with sync-currency-master.ts so an
     * existing database and a fresh one cannot drift apart.
     *
     * No default currency is set here. This table is a reference list for
     * company_currency_config and exchange_rate to point at — nothing else. A
     * default silently picked one, and the one it picked was the Indian Rupee
     * on a Zimbabwe piggery. The base currency is a company setting; there is
     * no system-wide answer to it. Rishi's call, 2026-09-09.
     */
    const currencies: Array<typeof master.currencyMaster.$inferInsert> = CURRENCY_SEED_ROWS;

    for (const currency of currencies) {
      await masterDb
        .insert(master.currencyMaster)
        .values(currency)
        .onDuplicateKeyUpdate({ set: withoutId(currency, 'currency_id') });
      await tenantDb
        .insert(tenant.currencyMaster)
        .values(currency)
        .onDuplicateKeyUpdate({ set: withoutId(currency, 'currency_id') });
    }

    // Starter set, same "small but real, expand via the API" pattern as languages/
    // currencies above — not the full ~400 IANA / ~195 ISO country lists.
    const timezones: Array<typeof master.timezoneMaster.$inferInsert> = [
      { tz_code: 'UTC', tz_name: 'Coordinated Universal Time', utc_offset: '+00:00', offset_minutes: 0, is_dst: false },
      { tz_code: 'Asia/Kolkata', tz_name: 'India Standard Time', utc_offset: '+05:30', offset_minutes: 330, is_dst: false },
      { tz_code: 'Asia/Dubai', tz_name: 'Gulf Standard Time', utc_offset: '+04:00', offset_minutes: 240, is_dst: false },
      { tz_code: 'Asia/Singapore', tz_name: 'Singapore Standard Time', utc_offset: '+08:00', offset_minutes: 480, is_dst: false },
      { tz_code: 'Asia/Shanghai', tz_name: 'China Standard Time', utc_offset: '+08:00', offset_minutes: 480, is_dst: false },
      { tz_code: 'Asia/Tokyo', tz_name: 'Japan Standard Time', utc_offset: '+09:00', offset_minutes: 540, is_dst: false },
      { tz_code: 'Asia/Dhaka', tz_name: 'Bangladesh Standard Time', utc_offset: '+06:00', offset_minutes: 360, is_dst: false },
      { tz_code: 'Asia/Bangkok', tz_name: 'Indochina Time', utc_offset: '+07:00', offset_minutes: 420, is_dst: false },
      { tz_code: 'Europe/London', tz_name: 'Greenwich Mean Time', utc_offset: '+00:00', offset_minutes: 0, is_dst: true },
      { tz_code: 'Europe/Paris', tz_name: 'Central European Time', utc_offset: '+01:00', offset_minutes: 60, is_dst: true },
      { tz_code: 'America/New_York', tz_name: 'Eastern Standard Time', utc_offset: '-05:00', offset_minutes: -300, is_dst: true },
      { tz_code: 'America/Los_Angeles', tz_name: 'Pacific Standard Time', utc_offset: '-08:00', offset_minutes: -480, is_dst: true },
      { tz_code: 'America/Sao_Paulo', tz_name: 'Brasilia Standard Time', utc_offset: '-03:00', offset_minutes: -180, is_dst: false },
      { tz_code: 'Australia/Sydney', tz_name: 'Australian Eastern Standard Time', utc_offset: '+10:00', offset_minutes: 600, is_dst: true },
      { tz_code: 'Africa/Johannesburg', tz_name: 'South Africa Standard Time', utc_offset: '+02:00', offset_minutes: 120, is_dst: false },
      { tz_code: 'Africa/Harare', tz_name: 'Central Africa Time', utc_offset: '+02:00', offset_minutes: 120, is_dst: false },
      { tz_code: 'Africa/Lagos', tz_name: 'West Africa Time', utc_offset: '+01:00', offset_minutes: 60, is_dst: false },
    ].map((tz) => ({ ...tz, tz_id: randomUUID() }));

    const tzIdByCode = new Map(timezones.map((tz) => [tz.tz_code, tz.tz_id!]));

    for (const tz of timezones) {
      await masterDb.insert(master.timezoneMaster).values(tz).onDuplicateKeyUpdate({ set: withoutId(tz, 'tz_id') });
      await tenantDb.insert(tenant.timezoneMaster).values(tz).onDuplicateKeyUpdate({ set: withoutId(tz, 'tz_id') });
    }

    // Re-read the ids that actually landed. On a re-run the rows already exist
    // and keep their original ids, so the freshly generated UUIDs above are not
    // in the table — anything referencing them (country.default_tz_id) would
    // point at nothing and fail the foreign key.
    for (const row of await masterDb.select().from(master.timezoneMaster)) {
      tzIdByCode.set(row.tz_code, row.tz_id);
    }

    const countries: Array<typeof master.countryMaster.$inferInsert> = [
      { iso2: 'IN', iso3: 'IND', country_name: 'India', phone_code: '+91', default_tz_id: tzIdByCode.get('Asia/Kolkata'), flag_emoji: '🇮🇳' },
      { iso2: 'US', iso3: 'USA', country_name: 'United States', phone_code: '+1', default_tz_id: tzIdByCode.get('America/New_York'), flag_emoji: '🇺🇸' },
      { iso2: 'GB', iso3: 'GBR', country_name: 'United Kingdom', phone_code: '+44', default_tz_id: tzIdByCode.get('Europe/London'), flag_emoji: '🇬🇧' },
      { iso2: 'AE', iso3: 'ARE', country_name: 'United Arab Emirates', phone_code: '+971', default_tz_id: tzIdByCode.get('Asia/Dubai'), flag_emoji: '🇦🇪' },
      { iso2: 'SG', iso3: 'SGP', country_name: 'Singapore', phone_code: '+65', default_tz_id: tzIdByCode.get('Asia/Singapore'), flag_emoji: '🇸🇬' },
      { iso2: 'CN', iso3: 'CHN', country_name: 'China', phone_code: '+86', default_tz_id: tzIdByCode.get('Asia/Shanghai'), flag_emoji: '🇨🇳' },
      { iso2: 'JP', iso3: 'JPN', country_name: 'Japan', phone_code: '+81', default_tz_id: tzIdByCode.get('Asia/Tokyo'), flag_emoji: '🇯🇵' },
      { iso2: 'AU', iso3: 'AUS', country_name: 'Australia', phone_code: '+61', default_tz_id: tzIdByCode.get('Australia/Sydney'), flag_emoji: '🇦🇺' },
      { iso2: 'ZW', iso3: 'ZWE', country_name: 'Zimbabwe', phone_code: '+263', default_tz_id: tzIdByCode.get('Africa/Harare'), flag_emoji: '🇿🇼' },
      { iso2: 'ZA', iso3: 'ZAF', country_name: 'South Africa', phone_code: '+27', default_tz_id: tzIdByCode.get('Africa/Johannesburg'), flag_emoji: '🇿🇦' },
      { iso2: 'NG', iso3: 'NGA', country_name: 'Nigeria', phone_code: '+234', default_tz_id: tzIdByCode.get('Africa/Lagos'), flag_emoji: '🇳🇬' },
      { iso2: 'DE', iso3: 'DEU', country_name: 'Germany', phone_code: '+49', default_tz_id: tzIdByCode.get('Europe/Paris'), flag_emoji: '🇩🇪' },
      { iso2: 'FR', iso3: 'FRA', country_name: 'France', phone_code: '+33', default_tz_id: tzIdByCode.get('Europe/Paris'), flag_emoji: '🇫🇷' },
      { iso2: 'CA', iso3: 'CAN', country_name: 'Canada', phone_code: '+1', default_tz_id: tzIdByCode.get('America/New_York'), flag_emoji: '🇨🇦' },
      { iso2: 'BR', iso3: 'BRA', country_name: 'Brazil', phone_code: '+55', default_tz_id: tzIdByCode.get('America/Sao_Paulo'), flag_emoji: '🇧🇷' },
      { iso2: 'BD', iso3: 'BGD', country_name: 'Bangladesh', phone_code: '+880', default_tz_id: tzIdByCode.get('Asia/Dhaka'), flag_emoji: '🇧🇩' },
      { iso2: 'TH', iso3: 'THA', country_name: 'Thailand', phone_code: '+66', default_tz_id: tzIdByCode.get('Asia/Bangkok'), flag_emoji: '🇹🇭' },
      { iso2: 'VN', iso3: 'VNM', country_name: 'Vietnam', phone_code: '+84', default_tz_id: tzIdByCode.get('Asia/Bangkok'), flag_emoji: '🇻🇳' },
      { iso2: 'ID', iso3: 'IDN', country_name: 'Indonesia', phone_code: '+62', default_tz_id: tzIdByCode.get('Asia/Bangkok'), flag_emoji: '🇮🇩' },
      { iso2: 'PH', iso3: 'PHL', country_name: 'Philippines', phone_code: '+63', default_tz_id: tzIdByCode.get('Asia/Singapore'), flag_emoji: '🇵🇭' },
      { iso2: 'KE', iso3: 'KEN', country_name: 'Kenya', phone_code: '+254', default_tz_id: tzIdByCode.get('Africa/Johannesburg'), flag_emoji: '🇰🇪' },
      { iso2: 'EG', iso3: 'EGY', country_name: 'Egypt', phone_code: '+20', default_tz_id: tzIdByCode.get('Europe/Paris'), flag_emoji: '🇪🇬' },
      { iso2: 'LK', iso3: 'LKA', country_name: 'Sri Lanka', phone_code: '+94', default_tz_id: tzIdByCode.get('Asia/Kolkata'), flag_emoji: '🇱🇰' },
      { iso2: 'NL', iso3: 'NLD', country_name: 'Netherlands', phone_code: '+31', default_tz_id: tzIdByCode.get('Europe/Paris'), flag_emoji: '🇳🇱' },
      { iso2: 'MX', iso3: 'MEX', country_name: 'Mexico', phone_code: '+52', default_tz_id: tzIdByCode.get('America/Los_Angeles'), flag_emoji: '🇲🇽' },
    ].map((c) => ({
      ...c,
      country_id: randomUUID(),
      default_currency_id: defaultCurrencyIdFor(c.iso2),
    }));

    const countryIdByIso2 = new Map(countries.map((c) => [c.iso2, c.country_id!]));

    for (const country of countries) {
      await masterDb.insert(master.countryMaster).values(country).onDuplicateKeyUpdate({ set: withoutId(country, 'country_id') });
      await tenantDb.insert(tenant.countryMaster).values(country).onDuplicateKeyUpdate({ set: withoutId(country, 'country_id') });
    }

    // Same again — state_province.country_id has to reference the row that is
    // really there, not the id this run happened to generate.
    for (const row of await masterDb.select().from(master.countryMaster)) {
      countryIdByIso2.set(row.iso2, row.country_id);
    }

    // India's states specifically — matching this codebase's existing India-centric
    // defaults (INR, Hindi, Asia/Kolkata) — not every country's states, too much for a
    // starter set.
    const indiaId = countryIdByIso2.get('IN')!;
    const indiaStates: Array<typeof master.stateProvince.$inferInsert> = [
      ['MH', 'Maharashtra'], ['PB', 'Punjab'], ['HR', 'Haryana'], ['UP', 'Uttar Pradesh'],
      ['KA', 'Karnataka'], ['TN', 'Tamil Nadu'], ['GJ', 'Gujarat'], ['RJ', 'Rajasthan'],
      ['WB', 'West Bengal'], ['TS', 'Telangana'], ['AP', 'Andhra Pradesh'], ['KL', 'Kerala'],
      ['MP', 'Madhya Pradesh'], ['BR', 'Bihar'], ['OR', 'Odisha'], ['AS', 'Assam'], ['DL', 'Delhi'],
    ].map(([code, name]) => ({
      state_id: randomUUID(),
      country_id: indiaId,
      state_code: code,
      state_name: name,
    }));

    for (const state of indiaStates) {
      await masterDb.insert(master.stateProvince).values(state).onDuplicateKeyUpdate({ set: withoutId(state, 'state_id') });
      await tenantDb.insert(tenant.stateProvince).values(state).onDuplicateKeyUpdate({ set: withoutId(state, 'state_id') });
    }

    // STANDARD / BIO_ASSET are the two methods actually implemented in batch.service.ts —
    // this table doesn't change or re-validate that code, it just gives the literal strings
    // it already branches on a real, authoritative row to point at. FIFO / AVG are item-level
    // inventory valuation methods (item_master.valuation_method) — not batch costing methods,
    // batch.service.ts does not branch on them.
    const costingMethods: Array<typeof master.costingMethodConfig.$inferInsert> = [
      {
        method_code: 'STANDARD',
        // Named for itself, not for FIFO: FIFO is its own row below, and the
        // Item form lists both by name. "Standard / FIFO Costing" alongside
        // "First In First Out" reads as two ways to say FIFO, while only this
        // one makes standard_cost mandatory (item.service.ts assertStandardCost).
        method_name: 'Standard Costing',
        variance_auto: 'YES',
        layer_tracking: true,
        is_system: true,
      },
      {
        method_code: 'BIO_ASSET',
        method_name: 'Biological Asset Costing (IAS 41)',
        variance_auto: 'NO',
        bio_asset_support: true,
        fair_value_option: true,
        amort_option: true,
        is_system: true,
      },
      {
        method_code: 'FIFO',
        method_name: 'First In First Out',
        variance_auto: 'NO',
        layer_tracking: true,
        is_system: true,
      },
      {
        method_code: 'AVG',
        method_name: 'Weighted Average Costing',
        variance_auto: 'NO',
        layer_tracking: false,
        is_system: true,
      },
    ];
    for (const method of costingMethods) {
      await masterDb.insert(master.costingMethodConfig).values(method).onDuplicateKeyUpdate({ set: withoutId(method, 'method_code') });
      await tenantDb.insert(tenant.costingMethodConfig).values(method).onDuplicateKeyUpdate({ set: withoutId(method, 'method_code') });
    }

    const setupSteps = [
      ['COMPANY_PROFILE', 'Company profile', 'GENERAL'],
      ['ADDRESS', 'Address & farm location', 'GENERAL'],
      ['KEY_CONTACTS', 'Primary contacts', 'GENERAL'],
      ['DEFAULT_LANGUAGE', 'Language', 'LOCALIZATION'],
      ['BASE_CURRENCY', 'Base currency', 'LOCALIZATION'],
      ['TIMEZONE', 'Timezone & region', 'LOCALIZATION'],
      ['FISCAL_YEAR', 'Fiscal & accounting', 'FINANCE'],
      ['ENABLE_MODULES', 'Enable modules', 'CONFIGURATION'],
      ['ADMIN_USER', 'Administrator account', 'SECURITY'],
      ['TEAM_MEMBERS', 'Users & roles', 'SECURITY'],
      ['CHART_OF_ACCOUNTS', 'GL mapping', 'FINANCE'],
      ['NOB_LOB_CONFIG', 'NOB & LOB configuration', 'CONFIGURATION'],
      ['MASTER_DATA_LOAD', 'Master data', 'CONFIGURATION'],
      ['NOTIFICATION_SETTINGS', 'Notifications', 'CONFIGURATION'],
      ['SETUP_COMPLETE', 'Setup complete', 'CONFIGURATION'],
    ] as const;
    for (const [index, [code, name, category]] of setupSteps.entries()) {
      const order = index + 1;
      const step = {
        step_id: `30000000-3000-3000-3000-${String(order).padStart(12, '0')}`,
        step_code: code,
        step_name: name,
        step_order: order,
        is_mandatory: order <= 9,
        step_category: category,
        is_active: true,
      };
      await masterDb
        .insert(master.setupStepMaster)
        .values(step)
        .onDuplicateKeyUpdate({
          set: {
            step_name: name,
            step_order: order,
            is_mandatory: order <= 9,
            step_category: category,
            is_active: true,
          },
        });
      await tenantDb
        .insert(tenant.setupStepMaster)
        .values(step)
        .onDuplicateKeyUpdate({
          set: {
            step_name: name,
            step_order: order,
            is_mandatory: order <= 9,
            step_category: category,
            is_active: true,
          },
        });
    }

    const nobs = [
      ['POULTRY', 'Poultry', 'STANDARD'],
      ['LIVESTOCK', 'Livestock', 'BIO_ASSET'],
      ['AGRI', 'Agriculture', 'STANDARD'],
      ['AQUA', 'Aquaculture', 'BIO_ASSET'],
      ['INSECT', 'Insect Farming', 'STANDARD'],
      ['PRODUCTION', 'Feed & Processing', 'STANDARD'],
    ] as const;
    const nobIds = new Map<string, string>();
    for (const [index, [code, name, costing]] of nobs.entries()) {
      const nob = {
        nob_id: `50000000-5000-5000-5000-${String(index + 1).padStart(12, '0')}`,
        nob_code: code,
        nob_name: name,
        default_costing_method: costing,
        sort_order: index + 1,
        is_system: true,
        is_active: true,
      };
      await masterDb
        .insert(master.nobMaster)
        .values(nob)
        .onDuplicateKeyUpdate({
          set: {
            nob_name: name,
            default_costing_method: costing,
            sort_order: index + 1,
            is_system: true,
            is_active: true,
          },
        });
      const [persistedNob] = await masterDb
        .select({ nobId: master.nobMaster.nob_id })
        .from(master.nobMaster)
        .where(eq(master.nobMaster.nob_code, code))
        .limit(1);
      nobIds.set(code, persistedNob.nobId);
      await tenantDb
        .insert(tenant.nobMaster)
        .values({ ...nob, nob_id: persistedNob.nobId })
        .onDuplicateKeyUpdate({
          set: {
            nob_name: name,
            default_costing_method: costing,
            sort_order: index + 1,
            is_system: true,
            is_active: true,
          },
        });
    }

    const lobs = [
      ['POULTRY', 'PLT_REARING', 'Rearing & Breeding', 'STANDARD,FIFO', 'NO', 'NO'],
      ['POULTRY', 'PLT_LAYING', 'Laying', 'STANDARD,FIFO', 'YES', 'YES'],
      ['POULTRY', 'PLT_HATCHING', 'Hatching', 'STANDARD,FIFO', 'YES', 'YES'],
      ['POULTRY', 'PLT_CB', 'Commercial Broiler Farming', 'STANDARD', 'YES', 'YES'],
      ['POULTRY', 'PLT_SLAUGHTER', 'Poultry Slaughter', 'STANDARD', 'YES', 'YES'],
      ['LIVESTOCK', 'LVS_MILKING', 'Dairy', 'BIO_ASSET,FIFO', 'YES', 'YES'],
      ['LIVESTOCK', 'LVS_PIGGERY', 'Piggery', 'BIO_ASSET,STANDARD', 'YES', 'YES'],
      ['LIVESTOCK', 'LVS_GOAT_SHEEP', 'Goat & Sheep', 'BIO_ASSET', 'YES', 'YES'],
      ['AGRI', 'AGRI_FRUIT', 'Fruit Farming', 'BIO_ASSET,FIFO', 'YES', 'YES'],
      ['AGRI', 'AGRI_CROP', 'Crop Farming', 'STANDARD,FIFO', 'YES', 'YES'],
      ['AGRI', 'AGRI_SEEDS', 'Seed Processing', 'STANDARD', 'YES', 'YES'],
      ['AQUA', 'AQA_FISH', 'Fish Farming', 'BIO_ASSET,FIFO', 'YES', 'YES'],
      ['AQUA', 'AQA_SLAUGHTER', 'Aquaculture Slaughter', 'STANDARD', 'YES', 'YES'],
      ['INSECT', 'INS_BEE', 'Bee Keeping', 'STANDARD', 'YES', 'YES'],
      ['INSECT', 'BSF', 'Black Soldier Fly', 'STANDARD', 'YES', 'YES'],
      ['PRODUCTION', 'FEED_PROD', 'Feed Production', 'STANDARD', 'YES', 'YES'],
    ] as const;
    for (const [index, [nobCode, code, name, costing, qc, qr]] of lobs.entries()) {
      const lob = {
        lob_id: `60000000-6000-6000-6000-${String(index + 1).padStart(12, '0')}`,
        nob_id: nobIds.get(nobCode)!,
        lob_code: code,
        lob_name: name,
        costing_method_allowed: costing,
        qc_required: qc,
        qr_required: qr,
        traceability_required: 'YES',
        sort_order: index + 1,
        is_system: true,
        is_active: true,
      };
      await masterDb
        .insert(master.lobMaster)
        .values(lob)
        .onDuplicateKeyUpdate({
          set: {
            nob_id: lob.nob_id,
            lob_name: name,
            costing_method_allowed: costing,
            qc_required: qc,
            qr_required: qr,
            traceability_required: 'YES',
            sort_order: index + 1,
            is_system: true,
            is_active: true,
          },
        });
      await tenantDb
        .insert(tenant.lobMaster)
        .values(lob)
        .onDuplicateKeyUpdate({
          set: {
            nob_id: lob.nob_id,
            lob_name: name,
            costing_method_allowed: costing,
            qc_required: qc,
            qr_required: qr,
            traceability_required: 'YES',
            sort_order: index + 1,
            is_system: true,
            is_active: true,
          },
        });
    }

    const today = new Date().toISOString().slice(0, 10);
    await masterDb
      .insert(master.tenantMaster)
      .values({
        tenant_id: SYSTEM_TENANT_ID,
        tenant_code: 'system',
        tenant_name: 'NAVFarm Platform Administration',
        tenant_type: 'PLATFORM',
        plan_id: 'PLAN_ENTERPRISE',
        plan_start_date: today,
        billing_cycle: 'ANNUAL',
        billing_email: adminEmail,
        max_companies: 100,
        max_users: 1000,
        api_rate_limit: 5000,
        db_host: host,
        db_port: port,
        db_name: systemDatabase,
        db_user: user,
        db_password: password,
      })
      .onDuplicateKeyUpdate({
        set: {
          billing_email: adminEmail,
          db_host: host,
          db_port: port,
          db_name: systemDatabase,
          db_user: user,
          db_password: password,
          is_active: true,
        },
      });
    await masterDb
      .insert(master.tenantSubscription)
      .values({
        tenant_id: SYSTEM_TENANT_ID,
        plan_code: 'PLAN_ENTERPRISE',
        feature_flags: { platformAdministration: true },
        storage_limit_gb: '500.00',
        support_tier: 'PREMIUM',
        sla_uptime_pct: '99.90',
      })
      .onDuplicateKeyUpdate({
        set: { plan_code: 'PLAN_ENTERPRISE', is_active: true },
      });

    await tenantDb
      .insert(tenant.companyMaster)
      .values({
        company_id: SYSTEM_COMPANY_ID,
        tenant_id: SYSTEM_TENANT_ID,
        company_code: 'PLATFORM',
        company_name: 'NAVFarm Platform Administration',
        company_type: 'Platform',
        industry_type: 'Administration',
        base_currency_id: USD_ID,
        default_language_id: ENGLISH_ID,
        default_timezone_id: 'UTC',
        country_id: 'ZWE',
        onboarding_status: 'COMPLETED',
      })
      .onDuplicateKeyUpdate({
        // Locale is bootstrap-owned. Without it in this set, a platform row
        // created before the Indian defaults were removed keeps INR and
        // Asia/Kolkata forever, because the insert always duplicate-keys.
        set: {
          company_name: 'NAVFarm Platform Administration',
          base_currency_id: USD_ID,
          default_timezone_id: 'UTC',
          country_id: 'ZWE',
          is_active: true,
        },
      });
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await tenantDb
      .insert(tenant.userMaster)
      .values({
        user_id: process.env.SYSTEM_ADMIN_ID || randomUUID(),
        company_id: SYSTEM_COMPANY_ID,
        tenant_id: SYSTEM_TENANT_ID,
        full_name: process.env.SYSTEM_ADMIN_NAME || 'NAVFarm System Administrator',
        email: adminEmail.toLowerCase(),
        password_hash: passwordHash,
        user_type: 'SYSTEM_ADMIN',
        timezone_pref_id: 'Asia/Kolkata',
      })
      .onDuplicateKeyUpdate({
        set: { password_hash: passwordHash, user_type: 'SYSTEM_ADMIN', is_active: true },
      });

    console.log(`Bootstrapped ${masterDatabase} and ${systemDatabase}.`);
    console.log(`System administrator: ${adminEmail}`);
  } finally {
    await masterPool.end();
    await tenantPool.end();
  }
}

if (require.main === module) {
  void bootstrap().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
