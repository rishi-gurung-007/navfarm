/**
 * Provision the Triple C showcase tenant by driving the running API, then
 * leave its master data blank for the client's own data to be seeded on top.
 *
 * One script, idempotent, no companion "clear" script: re-running it converges
 * on the same state rather than duplicating anything. Prints a plan by default;
 * `--apply` is required before it writes.
 *
 * It uses HTTP rather than direct inserts on purpose. A tenant is created by
 * `POST /tenant/signup` and a company by the setup wizard in the live app, so
 * driving those endpoints provisions the showcase exactly the way a real
 * signup does — and the same command, pointed at the server's API with
 * NAVFARM_API_URL, reproduces it there.
 *
 * The one thing it cannot do over HTTP is empty the starter master data that
 * signup copies into every new tenant (UOMs, species, breeds, items, reasons,
 * parameters, stages, KPI metrics). There is no endpoint for that, so the last
 * phase deletes those rows directly, scoped to this tenant's own database.
 * Number Series, identity, access and platform reference taxonomy (countries,
 * currencies, timezones, languages, NOB/LOB) are never touched.
 *
 *   pnpm nx db-seed-triplec api                 # print the plan
 *   pnpm nx db-seed-triplec api -- --apply      # provision it
 *   NAVFARM_API_URL=https://test-ap.navfarm.com/api/v1 ... -- --apply
 */

import { randomUUID } from 'node:crypto';
import * as mysql from 'mysql2/promise';
import { tenantDatabaseName } from '../core/database/database-names';
import {
  SYSTEM_UOM_SEED,
  SYSTEM_LOCATION_TYPE_SEED,
  SYSTEM_ITEM_TYPE_SEED,
  SYSTEM_KPI_METRIC_SEED,
} from '../core/database/system-master-data-seed';
import { BBP_STAGE_SEED } from '../core/database/piggery-bbp-stage-seed';
import { MULTIPLIER_LOCATIONS } from './lib/multiplier-location-seed-data';
import {
  MULTIPLIER_ITEMS,
  MULTIPLIER_ITEM_CATEGORIES,
} from './lib/multiplier-item-seed-data';
import { MULTIPLIER_LIFECYCLE } from './lib/multiplier-lifecycle-seed-data';
import {
  MULTIPLIER_ANIMALS,
  PLANNED_BATCHES,
} from './lib/multiplier-animal-seed-data';
import { TRIPLEC_REASONS } from './lib/triplec-reason-seed-data';
import { PORTA_LOCATIONS, PORTA_SILOS } from './lib/porta-location-seed-data';
import { PORTA_RESOURCES } from './lib/porta-resource-seed-data';
import { PORTA_ANIMALS } from './lib/porta-animal-seed-data';
import { PORTA_LIFECYCLE_FIGURES } from './lib/porta-lifecycle-seed-data';
import {
  MULTIPLIER_SILOS,
  SILO_DIET,
  MULTIPLIER_MILL,
  MULTIPLIER_BINS,
  SILO_FILL_FRACTION,
} from './lib/multiplier-silo-seed-data';
import {
  STARTER_GL_ACCOUNTS,
  STARTER_GL_MAPPINGS,
} from '../modules/system/setup-wizard/seed/starter-master-data.seed-data';
import { drizzle } from 'drizzle-orm/mysql2';
import * as tenantSchema from '../core/database/schema';
import { seedActivitiesForTenant } from './seed-activity-master';

const API = (
  process.env.NAVFARM_API_URL || 'http://localhost:2877/api/v1'
).replace(/\/$/, '');

// Overridable so the same estate can be provisioned as a second tenant.
const TENANT_CODE = process.env.TRIPLEC_TENANT_CODE || 'triplec';
const TENANT_NAME = process.env.TRIPLEC_TENANT_NAME || 'Triple C';
const COMPANY_CODE = 'TRIPLEC';
const COMPANY_NAME = 'Triple C';
const AREA_CODE = 'PIGAREA';
const AREA_NAME = 'Piggery';
const EMAIL_DOMAIN = process.env.TRIPLEC_EMAIL_DOMAIN || 'ccc.local';

/** Showcase only — every user shares this password by the client's request. */
const PASSWORD = '12345678';

/**
 * The day the showcase's farm history begins (Rishi, 24 Oct: data entry from
 * 1 Jan 2025). The demo herd is placed on it; feed is in the store the day before.
 */
const HERD_START = '2025-01-01';
const STOCK_DATE = '2024-12-31';

/** Livestock / Piggery, from the platform taxonomy seeded by db-bootstrap. */
const NOB_LIVESTOCK = '50000000-5000-5000-5000-000000000002';
const LOB_PIGGERY = '60000000-6000-6000-6000-000000000007';

const USERS = [
  {
    key: 'tenant',
    user_type: 'TENANT_ADMIN',
    full_name: 'Tenant Administrator',
    email: `tenant.admin@${EMAIL_DOMAIN}`,
    scope: 'every company in the tenant',
  },
  {
    key: 'company',
    user_type: 'COMPANY_ADMIN',
    full_name: 'Company Administrator',
    email: `company.admin@${EMAIL_DOMAIN}`,
    scope: 'one company',
  },
  {
    key: 'area',
    user_type: 'OPERATIONAL_ADMIN',
    full_name: 'Operational Administrator',
    email: `area.admin@${EMAIL_DOMAIN}`,
    scope: 'one operational area',
  },
  {
    key: 'standard',
    user_type: 'STANDARD_USER',
    full_name: 'Standard User',
    email: `user@${EMAIL_DOMAIN}`,
    scope: 'no admin rights',
  },
] as const;

/**
 * The master tables signup pre-fills and the showcase wants empty, children
 * before parents so foreign keys hold. Deliberately absent: no_series (the
 * client edits those before entering anything), user/company/role/access rows,
 * and the platform reference taxonomy every tenant shares.
 */
const STARTER_MASTERS = [
  'parameter_master', // holds item_id, so it goes before item_master
  'kpi_metric_master',
  'reason_master',
  'item_master',
  'breed_master', // holds species_id, so it goes before species_master
  'species_master',
  'stage_master',
  'uom_master',
] as const;

/**
 * Series the app resolves but the platform seed does not create. Requisition
 * numbering already asks for a series and falls back to REQ-<year>-NNNN while
 * none exists (see requisition.service.ts nextReqNo), so seeding it is what
 * turns the configurable series on rather than new behaviour.
 */
const UNSEEDED_DOCUMENT_SERIES = [
  {
    code: 'REQUISITION',
    description: 'Requisition Number',
    document_type: 'REQUISITION',
    prefix: 'REQ',
    seq_length: 5,
  },
] as const;

/**
 * The location types the estate needs. QUARANTINE is left out: no logic reads
 * it and `location_master.is_quarantine_zone` is what the app actually uses.
 * CRATE is left out too — MULTIPLIER's crates are typed CAGE in its template,
 * and the parent picker treats CAGE as a leaf while CRATE is still offered as
 * a possible parent.
 */
const LOCATION_TYPE_CODES = [
  'FARM',
  'SHED',
  'PEN',
  'CAGE',
  'SILO',
  'STORE',
  'MILL',
  'BIN',
];

/**
 * A silo stands in the yard and several sheds draw from it, so it hangs off
 * the FARM. The system seed allows FARM or SHED; this narrows it, the same
 * correction seed-farm-locations.ts makes.
 */
const LOCATION_TYPE_PARENTS: Record<string, string[]> = { SILO: ['FARM'] };

/** MULTIPLIER states its farm size in hectares; the system UOM set has no equivalent. */
const UOM_ADDITIONS = [
  {
    uom_code: 'HECTARE',
    uom_name: 'Hectare',
    uom_type: 'AREA',
    decimal_places: 4,
    is_base_uom: false,
  },
];

const PLAN = [
  `Register tenant ${TENANT_CODE} (creates ${tenantDatabaseName(TENANT_CODE)}, runs its migrations, seeds Number Series)`,
  `Log in as tenant.admin@${EMAIL_DOMAIN}`,
  `Run setup wizard steps 1-8 and complete for company ${COMPANY_CODE} / ${COMPANY_NAME}`,
  `Create one operational area: ${AREA_NAME} (Livestock -> Piggery)`,
  `Create the ${USERS.length - 1} further showcase users and their access`,
  'Give the company its own editable Number Series — one row per code, counters at zero',
  `Create ${LOCATION_TYPE_CODES.length} location types and ${SYSTEM_UOM_SEED.length + UOM_ADDITIONS.length} units of measure`,
  `Load MULTIPLIER's estate: ${MULTIPLIER_LOCATIONS.length} locations from the submitted template`,
  `Empty the starter master data signup copied in: ${STARTER_MASTERS.join(', ')}`,
  'Report the final state read back from MySQL',
];

type Json = Record<string, any>;

let token = '';

async function call(
  method: string,
  path: string,
  body?: Json,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON error body is still worth reporting */
  }
  return { status: res.status, data };
}

/** Fails loudly on anything but success, so a half-provisioned tenant cannot pass unnoticed. */
async function post(
  path: string,
  body?: Json,
  tolerate: (r: { status: number; data: any }) => boolean = () => false,
): Promise<any> {
  const r = await call('POST', path, body);
  if (r.status >= 200 && r.status < 300) return r.data;
  if (tolerate(r)) return null;
  throw new Error(
    `POST ${path} -> ${r.status}: ${typeof r.data === 'string' ? r.data : JSON.stringify(r.data)}`,
  );
}

/**
 * A 409 is not on its own proof that the row is already there — the stage
 * endpoint returns 409 for a rule it refuses on too, and treating that as
 * "exists" silently dropped five stages. The message has to say so.
 */
const alreadyExists = (r: { status: number; data: any }) =>
  /already (taken|exists|registered|in use|has)|duplicate|exists/i.test(
    JSON.stringify(r.data ?? ''),
  );

function connection() {
  return mysql.createConnection({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: tenantDatabaseName(TENANT_CODE),
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
        : undefined,
  });
}

async function ensureTenant(): Promise<void> {
  const created = await post(
    '/tenant/signup',
    {
      tenant_code: TENANT_CODE,
      tenant_name: TENANT_NAME,
      tenant_type: 'ENTERPRISE',
      plan_id: 'PLAN_ENTERPRISE',
      billing_email: `billing@${EMAIL_DOMAIN}`,
      admin_name: USERS[0].full_name,
      admin_email: USERS[0].email,
      admin_password: PASSWORD,
      // Piggery is the whole of the showcase: the tenant may not pick anything else.
      allowed_nob_ids: [NOB_LIVESTOCK],
      allowed_lob_ids: [LOB_PIGGERY],
    },
    alreadyExists,
  );
  console.log(
    created
      ? `  tenant ${TENANT_CODE} registered`
      : `  tenant ${TENANT_CODE} already registered — left as it is`,
  );
}

async function login(): Promise<{ tenantId: string }> {
  const data = await post('/auth/login', {
    email: USERS[0].email,
    password: PASSWORD,
  });
  token = data.access_token;
  console.log(`  logged in as ${USERS[0].email}`);
  return { tenantId: data.user.tenantId };
}

/** Steps 1-8 then complete. Step 1 claims the placeholder company signup created. */
async function ensureCompany(tenantId: string): Promise<string> {
  const company = await post('/setup/wizard/step-1', {
    tenant_id: tenantId,
    company_code: COMPANY_CODE,
    company_name: COMPANY_NAME,
    company_display_name: COMPANY_NAME,
    company_type: 'PRIVATE_LIMITED',
    industry_type: 'LIVESTOCK',
  });
  const companyId: string = company.company_id;
  console.log(`  company ${COMPANY_CODE} is ${companyId}`);

  const ref = await references();

  await post('/setup/wizard/step-2', {
    company_id: companyId,
    address_type: 'REGISTERED',
    address_label: 'Head Office',
    line1: 'Triple C Farm',
    city: 'Bengaluru',
    state_id: ref.stateId,
    country_id: ref.countryId,
    pincode: '560001',
  });
  await post('/setup/wizard/step-3', {
    company_id: companyId,
    contact_type: 'PRIMARY',
    full_name: USERS[0].full_name,
    designation: 'Administrator',
    email: USERS[0].email,
    phone_primary: '0000000000',
    receives_alerts: true,
    receives_reports: true,
  });
  await post(`/setup/wizard/step-4/${companyId}/${ref.languageId}`);
  await post(`/setup/wizard/step-5/${companyId}/${ref.currencyId}`);
  await post(
    `/setup/wizard/step-6/${companyId}/${encodeURIComponent(ref.timezoneId)}/${ref.countryCode}`,
  );
  await post('/setup/wizard/step-7', {
    company_id: companyId,
    // Triple C's year runs July to June — Accounting Periods.xlsx flags its
    // July rows as New Fiscal Year and closes the year 52 weeks later.
    fiscal_year_format: 'FY JUL-JUN',
    fiscal_start_month: 7,
    fiscal_start_day: 1,
    fiscal_end_day: 31,
    current_fiscal_year: '2026-27',
    period_type: 'MONTHLY',
    accounting_standard: 'Local GAAP',
    depreciation_method: 'SLM',
    inventory_valuation: 'Weighted Average',
    gst_filing_frequency: 'MONTHLY',
    tax_audit_applicable: false,
    decimal_places: 2,
  });
  await post(`/setup/wizard/step-8/${companyId}`, { modules: [NOB_LIVESTOCK] });
  await post(`/setup/wizard/complete/${companyId}`, undefined, (r) =>
    /already|complete/i.test(JSON.stringify(r.data ?? '')),
  );
  console.log('  setup wizard steps 1-8 saved and completed');
  return companyId;
}

/**
 * The ids the wizard needs for country, state, currency, language and
 * timezone. Read from the tenant's own copy of the platform taxonomy: these
 * are fixed reference rows every tenant receives at signup, and reading them
 * directly keeps the script independent of which reference endpoints exist.
 */
async function references(): Promise<{
  countryId: string;
  countryCode: string;
  stateId: string;
  currencyId: string;
  languageId: string;
  timezoneId: string;
}> {
  const db = await connection();
  try {
    const first = async (sql: string, column: string): Promise<string> => {
      const [rows] = await db.query<any[]>(sql);
      if (!rows[0]) throw new Error(`The tenant has no row for: ${sql}`);
      return rows[0][column];
    };
    const countryId = await first(
      `SELECT country_id FROM country_master WHERE iso2 = 'IN' LIMIT 1`,
      'country_id',
    );
    return {
      countryId,
      // Step 6 stores the country the way the web app's wizard sends it: the ISO-3 code, not the row id.
      countryCode: await first(
        `SELECT iso3 FROM country_master WHERE iso2 = 'IN' LIMIT 1`,
        'iso3',
      ),
      stateId: await first(
        `SELECT state_id FROM state_province WHERE country_id = '${countryId}' ORDER BY state_name LIMIT 1`,
        'state_id',
      ),
      currencyId: await first(
        `SELECT currency_id FROM currency_master WHERE iso_code = 'INR' LIMIT 1`,
        'currency_id',
      ),
      languageId: await first(
        `SELECT lang_id FROM language_master WHERE lang_code = 'en' LIMIT 1`,
        'lang_id',
      ),
      // The wizard stores what it is given as the company's IANA zone (the web app sends the code, not the row id).
      timezoneId: await first(
        `SELECT tz_code FROM timezone_master WHERE tz_code = 'Asia/Kolkata' LIMIT 1`,
        'tz_code',
      ),
    };
  } finally {
    await db.end();
  }
}

async function existingAreaId(): Promise<string | null> {
  const db = await connection();
  try {
    const [rows] = await db.query<any[]>(
      `SELECT area_id FROM operational_area_master WHERE area_code = '${AREA_CODE}' LIMIT 1`,
    );
    return rows[0]?.area_id ?? null;
  } finally {
    await db.end();
  }
}

async function ensureArea(companyId: string): Promise<string> {
  const existing = await existingAreaId();
  if (existing) {
    console.log(`  operational area ${AREA_CODE} already present`);
    return existing;
  }
  const area = await post('/operational-area', {
    company_id: companyId,
    nob_id: NOB_LIVESTOCK,
    lob_id: LOB_PIGGERY,
    area_code: AREA_CODE,
    area_name: AREA_NAME,
    description:
      'The single Piggery operational area of the Triple C showcase.',
    is_active: true,
  });
  console.log(`  operational area ${AREA_CODE} created`);
  return area.area_id;
}

/**
 * The standard user is the one account the app will not create against blank
 * master data: `POST /user` requires a farm for a STANDARD_USER, and the
 * showcase has no Farm location until the client's masters are seeded. So it
 * is created when a farm exists and deferred, out loud, when none does —
 * rather than inserted behind the rule's back.
 */
async function farmId(): Promise<string | null> {
  const db = await connection();
  try {
    const [rows] = await db.query<any[]>(
      `SELECT location_id FROM location_master
        WHERE location_type = 'FARM' AND is_active = 1 AND deleted_at IS NULL LIMIT 1`,
    );
    return rows[0]?.location_id ?? null;
  } catch {
    return null;
  } finally {
    await db.end();
  }
}

async function ensureUsers(
  tenantId: string,
  companyId: string,
  areaId: string,
): Promise<void> {
  const farm = await farmId();
  for (const user of USERS.slice(1)) {
    if (user.user_type === 'STANDARD_USER' && !farm) {
      console.log(
        `  user ${user.email} DEFERRED — a standard user needs a farm, and the showcase masters are blank`,
      );
      continue;
    }
    const created = await post(
      '/user',
      {
        tenant_id: tenantId,
        company_id: companyId,
        full_name: user.full_name,
        email: user.email,
        password: PASSWORD,
        user_type: user.user_type,
        // Only the operational administrator is pinned to the area; the others
        // work at company or tenant level.
        operational_area_ids: user.key === 'area' ? [areaId] : undefined,
        farm_id:
          user.user_type === 'STANDARD_USER' ? (farm ?? undefined) : undefined,
      },
      alreadyExists,
    );
    console.log(
      created
        ? `  user ${user.email} created`
        : `  user ${user.email} already present`,
    );
  }
}

/**
 * mysql2 hands a JSON column back already parsed, and handing that object
 * straight back to an INSERT writes "[object Object]". Re-encode those columns
 * (code_segments, extension_config) on the way out.
 */
function forInsert(row: Json): Json {
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) =>
      value !== null && typeof value === 'object' && !(value instanceof Date)
        ? [column, JSON.stringify(value)]
        : [column, value],
    ),
  );
}

/**
 * Give the company its own Number Series.
 *
 * This is not a convenience: `resolveSeriesFor` scopes with
 * `companyCondition`, which is `company_id = :id` whenever a company context
 * exists and `company_id IS NULL` otherwise — a company never falls back to
 * the tenant templates. So without these rows every code a company asks for
 * resolves to null and the master falls to typed codes.
 *
 * Counters start at zero and nothing already present is touched, so the client
 * can edit prefix, length, increment and the manual-number flag before the
 * first record is created. nob_id / lob_id are copied as they stand: null
 * means the row is visible in every operational area, which is how
 * masterScopeConditions reads an OPERATIONAL scope.
 */
async function ensureSeries(
  tenantId: string,
  companyId: string,
): Promise<void> {
  const db = await connection();
  try {
    await db.beginTransaction();

    for (const series of UNSEEDED_DOCUMENT_SERIES) {
      const [rows] = await db.query<any[]>(
        `SELECT id FROM no_series WHERE tenant_id = ? AND company_id IS NULL AND code = ? LIMIT 1`,
        [tenantId, series.code],
      );
      if (rows.length > 0) continue;
      await db.query(`INSERT INTO no_series SET ?`, [
        {
          id: randomUUID(),
          tenant_id: tenantId,
          company_id: null,
          code: series.code,
          description: series.description,
          document_type: series.document_type,
          prefix: series.prefix,
          separator: '-',
          seq_length: series.seq_length,
          prefix_position: 'END',
          increment_by: 1,
          current_seq: 0,
          reset_frequency: 'NEVER',
          is_default: 1,
          manual_nos: 0,
          blocked: 0,
        },
      ]);
      console.log(
        `  tenant template ${series.code} added — the app asks for it but nothing seeded it`,
      );
    }

    const [templates] = await db.query<any[]>(
      `SELECT * FROM no_series WHERE tenant_id = ? AND company_id IS NULL AND deleted_at IS NULL`,
      [tenantId],
    );
    const [owned] = await db.query<any[]>(
      `SELECT code FROM no_series WHERE tenant_id = ? AND company_id = ?`,
      [tenantId, companyId],
    );
    const already = new Set(owned.map((row) => row.code));

    let copied = 0;
    for (const template of templates) {
      if (already.has(template.code)) continue;
      await db.query(`INSERT INTO no_series SET ?`, [
        forInsert({
          ...template,
          id: randomUUID(),
          company_id: companyId,
          current_seq: 0,
          last_no_used: null,
          created_at: new Date(),
          updated_at: new Date(),
          created_by: null,
          updated_by: null,
        }),
      ]);
      copied += 1;
    }
    await db.commit();
    console.log(
      `  company Number Series: ${copied} copied, ${already.size} already owned, counters at zero`,
    );
  } catch (error) {
    await db.rollback();
    throw new Error(
      `Could not give the company its Number Series (nothing was written): ${(error as Error).message}`,
    );
  } finally {
    await db.end();
  }
}

/**
 * Master data is created as the company administrator, not the tenant admin:
 * `resolveSeriesFor` and every master query scope on the company, so a master
 * made without a company context would be a tenant-level template nobody uses.
 */
async function loginAsCompanyAdmin(): Promise<void> {
  const data = await post('/auth/login', {
    email: USERS[1].email,
    password: PASSWORD,
  });
  token = data.access_token;
  console.log(`  switched to ${USERS[1].email} for master data`);
}

async function ensureLocationTypes(companyId: string): Promise<void> {
  let created = 0;
  for (const code of LOCATION_TYPE_CODES) {
    const seed = SYSTEM_LOCATION_TYPE_SEED.find((t) => t.type_code === code);
    if (!seed)
      throw new Error(`No system definition for location type '${code}'.`);
    const made = await post(
      '/location-type',
      {
        company_id: companyId,
        type_code: seed.type_code,
        type_name: seed.type_name,
        code_prefix: seed.code_prefix,
        allowed_parent_types:
          LOCATION_TYPE_PARENTS[code] ?? seed.allowed_parent_types,
        nob_id: NOB_LIVESTOCK,
        lob_id: LOB_PIGGERY,
      },
      alreadyExists,
    );
    if (made) created += 1;
  }
  console.log(
    `  location types: ${created} created, ${LOCATION_TYPE_CODES.length - created} already present`,
  );
}

async function ensureUoms(companyId: string): Promise<void> {
  const wanted = [...SYSTEM_UOM_SEED, ...UOM_ADDITIONS];
  let created = 0;
  for (const uom of wanted) {
    const made = await post(
      '/uom',
      {
        company_id: companyId,
        uom_code: uom.uom_code,
        uom_name: uom.uom_name,
        uom_type: uom.uom_type,
        decimal_places: uom.decimal_places,
        is_base_uom: uom.is_base_uom,
      },
      alreadyExists,
    );
    if (made) created += 1;
  }
  console.log(
    `  units of measure: ${created} created, ${wanted.length - created} already present`,
  );
}

/** Codes already in the tenant, so a second run adds only what is missing. */
async function existingLocationIds(): Promise<Map<string, string>> {
  const db = await connection();
  try {
    const [rows] = await db.query<any[]>(
      'SELECT location_code, location_id FROM location_master WHERE deleted_at IS NULL',
    );
    return new Map(rows.map((r) => [r.location_code, r.location_id]));
  } finally {
    await db.end();
  }
}

/**
 * Loads the estate parent-first, so a child always finds its parent's id.
 *
 * Rows the app refuses are collected rather than thrown: the capacity rule
 * (a child may not exceed its parent, nor may the children total more) rejects
 * 14 rows whose submitted capacities contradict each other, and the rest of
 * the estate should still load while Triple C corrects them.
 */
async function ensureLocations(
  companyId: string,
  rowsToLoad: typeof MULTIPLIER_LOCATIONS = MULTIPLIER_LOCATIONS,
  label = 'MULTIPLIER',
): Promise<void> {
  const ids = await existingLocationIds();
  const rejected: Array<{ code: string; sourceRow: number; why: string }> = [];
  let created = 0;

  for (const row of rowsToLoad) {
    if (ids.has(row.code)) continue;
    const parentId = row.parent ? ids.get(row.parent) : undefined;
    if (row.parent && !parentId) {
      rejected.push({
        code: row.code,
        sourceRow: row.sourceRow,
        why: `parent ${row.parent} was not created`,
      });
      continue;
    }
    const r = await call('POST', '/location', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      location_code: row.code,
      location_name: row.name,
      location_address: row.address,
      location_type: row.type,
      parent_location_id: parentId,
      area_size: row.areaSize,
      area_unit: row.areaUom,
      max_capacity: row.maxCapacity,
      capacity_uom: row.capacityUom,
      downtime_days_required: row.downtimeDaysRequired,
      // storage_type / storage_name describe the silo or store a location is
      // fed from, and belong on the SILO and STORE rows themselves. Those are
      // named in the template but never defined in it, so nothing is written
      // here — the same rule farm-location-seed-data.ts applies.
    });
    if (r.status >= 200 && r.status < 300) {
      const id = r.data?.location_id ?? r.data?.data?.location_id;
      if (!id)
        throw new Error(
          `Location ${row.code} was created but no id came back: ${JSON.stringify(r.data).slice(0, 200)}`,
        );
      ids.set(row.code, id);
      created += 1;
    } else {
      const body =
        r.data?.error?.message ?? r.data?.message ?? JSON.stringify(r.data);
      rejected.push({
        code: row.code,
        sourceRow: row.sourceRow,
        why: Array.isArray(body) ? body.join('; ') : String(body),
      });
    }
  }

  console.log(
    `  ${label} locations: ${created} created of ${rowsToLoad.length} submitted`,
  );
  if (rejected.length) {
    console.log(
      `  ${rejected.length} rejected by the app — these are template figures for Triple C to correct:`,
    );
    for (const r of rejected)
      console.log(`     row ${r.sourceRow} ${r.code}: ${r.why}`);
  }
}

/**
 * The production stages the estate works in.
 *
 * The platform's piggery set is eight stages; GILT_REARING is carried here as
 * REARING on Rishi's 2026-10-24 ruling ("let it be rearing only"), which is
 * safe because nothing outside the seed files reads that code. Three more come
 * from the client's own lifecycle workbook, whose Weaner / Double stock /
 * Grower sheet has no equivalent in the platform set.
 */
const STAGE_RENAMES: Record<string, { code: string; name: string }> = {
  GILT_REARING: { code: 'REARING', name: 'Rearing' },
};

const EXTRA_STAGES = [
  {
    stage_code: 'WEANER',
    stage_name: 'Weaner',
    next_stage_code: 'DOUBLE_STOCK',
    stage_category: 'PRODUCTIVE',
    stage_sequence: 9,
    typical_duration_days: 42,
    transition_trigger: 'MANUAL',
    stage_description:
      'Weaned piglets, 4 to 10 weeks (client lifecycle sheet).',
  },
  {
    stage_code: 'DOUBLE_STOCK',
    stage_name: 'Double Stock',
    next_stage_code: 'GROWER',
    stage_category: 'PRODUCTIVE',
    stage_sequence: 10,
    typical_duration_days: 28,
    transition_trigger: 'MANUAL',
    stage_description:
      'Double stock houses, 10 to 14 weeks (client lifecycle sheet).',
  },
  {
    stage_code: 'GROWER',
    stage_name: 'Grower',
    stage_category: 'OUTPUT',
    stage_sequence: 11,
    typical_duration_days: 56,
    transition_trigger: 'MANUAL',
    stage_description: 'Growers, 14 to 22 weeks (client lifecycle sheet).',
  },
];

/** One species: these are pigs. The platform's twelve were cleared with the rest. */
const SPECIES = { species_code: 'PIG', species_name: 'Pig' };

/**
 * The breeds the submitted files actually name.
 *
 * Z-Line-Sow is the only one the Breed Master quantifies. TN-70-Sow is not in
 * that sheet but four of the five registered sows are coded TZZZZ (confirmed
 * as Z-Line) and the fifth TN70, and the gilt lifecycle sheet talks about TN70
 * gilts throughout. Teaser Boar is a name with no figures behind it.
 *
 * breed_type is NOT NULL on the table and no file states it; BREEDER is what a
 * sow line is.
 */
const BREEDS = [
  {
    breed_code: 'Z-LINE-SOW',
    breed_name: 'Z-Line-Sow',
    breed_type: 'BREEDER',
    gestation_days: 116,
    lactation_days: 28,
    productive_life_months: 46,
    productive_life_cycles: 10,
    avg_litter_size: 16,
    avg_litter_size_born: 15,
    avg_litter_size_weaned: 13.8,
    avg_weaning_weight_kg: 7.5,
    avg_mortality_pct: 8,
  },
  { breed_code: 'TN-70-SOW', breed_name: 'TN-70-Sow', breed_type: 'BREEDER' },
  {
    breed_code: 'TEASER-BOAR',
    breed_name: 'Teaser Boar',
    breed_type: 'BREEDER',
  },
];

/** Codes already in a master table, so a re-run only adds what is missing. */
async function existingCodes(
  table: string,
  column: string,
): Promise<Set<string>> {
  const db = await connection();
  try {
    const [rows] = await db.query<any[]>(
      `SELECT \`${column}\` AS code FROM \`${table}\` WHERE deleted_at IS NULL`,
    );
    return new Set(rows.map((r) => String(r.code)));
  } catch {
    const db2 = await connection();
    try {
      const [rows] = await db2.query<any[]>(
        `SELECT \`${column}\` AS code FROM \`${table}\``,
      );
      return new Set(rows.map((r) => String(r.code)));
    } finally {
      await db2.end();
    }
  } finally {
    await db.end();
  }
}

/**
 * Moves the feed out of the store and into the silos and bins.
 *
 * This is the path the app insists on — a feed GRN on a silo is refused with
 * "feed reaches a silo only through the Transfer Order receipt" — so each
 * silo and bin gets a transfer order from the store, shipped and received in
 * one direct transfer. Every silo ends at four fifths of its capacity.
 */
async function ensureFeedTransfers(
  companyId: string,
  refs: HerdRefs,
): Promise<void> {
  const existing = await existingLocationIds();
  const db = await connection();
  let alreadyMoved: Set<string>;
  try {
    const [rows] = await db.query<any[]>(
      "SELECT to_warehouse_id FROM stock_transfer WHERE status IN ('POSTED','CLOSED','RECEIVED')",
    );
    alreadyMoved = new Set(rows.map((r) => r.to_warehouse_id));
  } finally {
    await db.end();
  }

  const targets: Array<{
    code: string;
    id: string;
    itemCode: string;
    kg: number;
  }> = [];
  for (const silo of MULTIPLIER_SILOS) {
    const id = existing.get(silo.code);
    const diet = dietFor(silo.code);
    if (id && diet)
      targets.push({
        code: silo.code,
        id,
        itemCode: diet.itemCode,
        kg: Math.round(silo.capacityKg * SILO_FILL_FRACTION),
      });
  }
  for (const bin of MULTIPLIER_BINS) {
    const id = existing.get(bin.code);
    if (id)
      targets.push({
        code: bin.code,
        id,
        itemCode: bin.itemCode,
        kg: Math.round(bin.capacityTon * 1000 * SILO_FILL_FRACTION),
      });
  }

  let moved = 0;
  let totalKg = 0;
  const refused: string[] = [];
  for (const target of targets) {
    if (alreadyMoved.has(target.id)) continue;
    const itemId = refs.items.get(target.itemCode);
    if (!itemId) continue;
    const created = await call('POST', '/stock-transfer', {
      company_id: companyId,
      from_warehouse_id: refs.storeId,
      to_warehouse_id: target.id,
      posting_date: STOCK_DATE,
      remarks: `Triple C showcase — fill ${target.code}`,
      // The same lot the feed was received under, so the ledger traces end to end.
      lines: [
        {
          item_id: itemId,
          quantity: target.kg,
          uom: 'KG',
          lot_no: `LOT-2025-01-${target.itemCode}`,
        },
      ],
    });
    const transfer = created.data?.data ?? created.data;
    const transferId =
      transfer?.transfer_id ?? transfer?.stock_transfer_id ?? transfer?.id;
    const lineId = (transfer?.lines ?? [])[0]?.line_id;
    if (!transferId || !lineId) {
      refused.push(
        `${target.code}: ${created.data?.error?.message ?? JSON.stringify(created.data).slice(0, 160)}`,
      );
      continue;
    }
    const posted = await call(
      'POST',
      `/stock-transfer/${transferId}/direct-transfer`,
      {
        posting_date: STOCK_DATE,
        lines: [{ line_id: lineId, quantity: target.kg }],
      },
    );
    if (posted.status >= 200 && posted.status < 300) {
      moved += 1;
      totalKg += target.kg;
    } else
      refused.push(
        `${target.code}: ${posted.data?.error?.message ?? JSON.stringify(posted.data).slice(0, 160)}`,
      );
  }
  console.log(
    `  feed moved: ${moved} of ${targets.length} silos and bins filled, ${totalKg.toLocaleString('en-GB')} kg out of the store`,
  );
  for (const line of refused.slice(0, 4)) console.log(`     ${line}`);
  if (refused.length > 4)
    console.log(`     ... and ${refused.length - 4} more`);
}

/**
 * What the lifecycle sheets call a feed, and the catalogue item meant by it.
 *
 * The sheets write instructions rather than item names — "2 weeks at Wean 1
 * OTC, 2 weeks Grower 1", "W1 - Gilt rear 1" — and some are ambiguous on their
 * own ("Creep 1" matches three Nosilac lines). Rishi's instruction of
 * 2026-10-24 was to settle them rather than leave the standards without a
 * feed, so a compound instruction takes the feed it starts on and an ambiguous
 * name takes the plain line. Every one of these is ours, not Triple C's, and
 * is worth their eye before the figures are trusted.
 */
const FEED_ALIASES: Record<string, string> = {
  'creep 1': 'FEED000006',
  w1: 'FEED000024',
  'w1 - gilt rear 1': 'FEED000024',
  'w1 - gilt rear 1 - gilt rear 2': 'FEED000024',
  'gilt rear 1 - gilt rear 2': 'FEED000077',
  'gilt rear 1 - gilt rear 2 - gilt rear 3': 'FEED000077',
  'gilt rear 2 - gilt rear 3': 'FEED000012',
  'gilt rear 3 - gilt rear 4': 'FEED000013',
  'gilt rear 5': 'FEED000015',
  'trans feed and lactate gilt': 'FEED000020',
  'trans feed and lactate z line': 'FEED000071',
  '2 weeks at wean 1 otc, 2 weeks grower 1': 'FEED000024',
  '10weeks (14days) - wean 1 (otc), 12weeks (14days) - grower': 'FEED000024',
  '4wks(8 days) - creep2, 5 to 6wks (14 days) - creep 3, 7 to 10wks (17 days) - wean 1':
    'FEED000007',
  '4wks(8 days) - creep2, 6wks (14 days) - creep 3, 8 to 10wks (17 days) - wean 1':
    'FEED000007',
};

/** Fills in the feed item on standards whose wording the catalogue could not match. */
async function resolveLifecycleFeeds(): Promise<void> {
  const refs = await herdRefs();
  const db = await connection();
  let set = 0;
  const unresolved = new Set<string>();
  try {
    for (const row of MULTIPLIER_LIFECYCLE) {
      if (!row.feedItemName) continue;
      const alias = FEED_ALIASES[row.feedItemName.trim().toLowerCase()];
      if (!alias) {
        unresolved.add(row.feedItemName);
        continue;
      }
      const itemId = refs.items.get(alias);
      if (!itemId) continue;
      const [result] = await db.query<any>(
        `UPDATE breed_lifecycle_stages l
            JOIN stage_master s ON s.stage_id = l.stage_id
            SET l.feed_item_id = ?
          WHERE s.stage_code = ? AND l.period_from = ? AND l.period_to = ? AND l.feed_item_id IS NULL`,
        [itemId, row.stage, row.periodFrom, row.periodTo],
      );
      set += result.affectedRows ?? 0;
    }
  } finally {
    await db.end();
  }
  console.log(
    `  lifecycle feeds resolved: ${set} standards given a feed item` +
      (unresolved.size ? `; ${unresolved.size} wordings still unmatched` : ''),
  );
}

/**
 * An Animal Wise batch is meant to hold animals standing at several stages at
 * once — that is what distinguishes it from a counted batch, and it is why
 * each stage gets its own scheduler. Seeded flat, every animal in a batch sat
 * at the batch's own stage, so Data Entry offered one stage per batch and the
 * stage strip had nothing to strip.
 *
 * Animals are dealt round-robin across the stages their breed actually has
 * lifecycle standards for, so no stage gets a scheduler with no lines.
 */
const BATCH_STAGE_SPREAD: Record<string, string[]> = {
  REARING: ['REARING', 'FLUSH', 'INSEMINATION'],
  FLUSH: ['FLUSH', 'INSEMINATION', 'REARING'],
  INSEMINATION: ['INSEMINATION', 'GESTATION', 'FLUSH'],
  GESTATION: ['GESTATION', 'FARROWING', 'INSEMINATION'],
  FARROWING: ['FARROWING', 'LACTATION', 'GESTATION'],
  LACTATION: ['LACTATION', 'FARROWING', 'PRODUCTIVE_SOW'],
};

/** Spreads each animal-wise batch's animals over its stages, then activates every batch. */
async function spreadAndActivateBatches(): Promise<void> {
  const refs = await herdRefs();
  const db = await connection();
  let moved = 0;
  const toActivate: Array<{ id: string; no: string }> = [];
  try {
    const [batches] = await db.query<any[]>(
      `SELECT b.batch_id, b.batch_no, b.status, b.tracking_mode, s.stage_code
         FROM batch_header b LEFT JOIN stage_master s ON s.stage_id = b.stage_id
        WHERE b.deleted_at IS NULL`,
    );
    for (const batch of batches) {
      if (batch.status !== 'ACTIVE')
        toActivate.push({ id: batch.batch_id, no: batch.batch_no });
      // Animals change stage in seed-triplec-history.ts, through the app, on the
      // day they move — an UPDATE here would leave no movement history behind.
      if (
        batch.tracking_mode !== 'ANIMAL_WISE' ||
        !process.argv.includes('--spread-stages')
      )
        continue;
      const spread = BATCH_STAGE_SPREAD[batch.stage_code] ?? [batch.stage_code];
      const ids = spread
        .map((code) => refs.stages.get(code))
        .filter(Boolean) as string[];
      if (ids.length < 2) continue;
      const [animals] = await db.query<any[]>(
        'SELECT animal_id FROM animal_register WHERE current_batch_id = ? ORDER BY animal_code',
        [batch.batch_id],
      );
      for (const [index, animal] of animals.entries()) {
        const target = ids[index % ids.length];
        const [result] = await db.query<any>(
          'UPDATE animal_register SET current_stage_id = ? WHERE animal_id = ? AND current_stage_id <> ?',
          [target, animal.animal_id, target],
        );
        moved += result.affectedRows ?? 0;
      }
    }
  } finally {
    await db.end();
  }
  if (moved)
    console.log(
      `  stages spread: ${moved} animals moved so each animal-wise batch spans several stages`,
    );

  let activated = 0;
  const refused: string[] = [];
  for (const batch of toActivate) {
    const made = await call('POST', `/batch/${batch.id}/activate`, {});
    if (made.status >= 200 && made.status < 300) activated += 1;
    else
      refused.push(
        `${batch.no}: ${made.data?.error?.message ?? made.data?.message ?? JSON.stringify(made.data)}`,
      );
  }
  console.log(
    `  batches activated: ${activated} of ${toActivate.length} — a DRAFT batch is invisible to Batch Animals and Data Entry, which list ACTIVE only`,
  );
  for (const line of refused.slice(0, 6)) console.log(`     ${line}`);

  // A batch's schedule is built when it activates, but the activity catalogue
  // was empty then, so the lines had nothing to point at. Regeneration is the
  // same idempotent path a stage transfer calls.
  let scheduled = 0;
  const notScheduled: string[] = [];
  const db2 = await connection();
  let all: any[];
  try {
    const [rows] = await db2.query<any[]>(
      'SELECT batch_id, batch_no FROM batch_header WHERE deleted_at IS NULL',
    );
    all = rows;
  } finally {
    await db2.end();
  }
  for (const batch of all) {
    const made = await call('POST', '/scheduler-header/generate', {
      batch_id: batch.batch_id,
    });
    if (made.status >= 200 && made.status < 300) scheduled += 1;
    else
      notScheduled.push(
        `${batch.batch_no}: ${made.data?.error?.message ?? made.data?.message ?? JSON.stringify(made.data).slice(0, 140)}`,
      );
  }
  console.log(`  schedulers regenerated: ${scheduled} of ${all.length}`);
  for (const line of notScheduled.slice(0, 5)) console.log(`     ${line}`);
}

/**
 * The activity catalogue a scheduler line points at — morning feed, weighing,
 * vaccination and the rest, across all six line types.
 *
 * This is the platform's own standard catalogue rather than a list invented
 * here, so the showcase's scheduled work matches every other tenant's. Without
 * it a scheduler has lines pointing at nothing and Data Entry has no action to
 * record against.
 */
async function ensureActivities(tenantId: string): Promise<void> {
  const before = await existingCodes('activity_master', 'activity_code');
  if (before.size > 0) {
    console.log(`  activities: ${before.size} already present`);
    return;
  }
  const pool = mysql.createPool({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: tenantDatabaseName(TENANT_CODE),
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
        : undefined,
  });
  try {
    const db = drizzle(pool, { schema: tenantSchema, mode: 'default' });
    await seedActivitiesForTenant(db, tenantId);
  } finally {
    await pool.end();
  }
  const after = await existingCodes('activity_master', 'activity_code');
  console.log(
    `  activities: ${after.size} created from the standard catalogue`,
  );
}

/**
 * The chart of accounts and the GL mappings every posting reads.
 *
 * A feed purchase is refused without them — "No GL mapping is set up for the
 * PURCHASE transaction type" — and so, later, are consumption, transfers,
 * variances and every batch posting. This is the platform's own starter set,
 * the same one the setup wizard lays down, so the showcase books agree with
 * the rest of the system rather than with a chart invented here.
 */
async function ensureGlAccounts(companyId: string): Promise<void> {
  const present = await existingCodes('gl_account_master', 'account_code');
  const accountIds = new Map<string, string>();
  let accounts = 0;
  for (const account of STARTER_GL_ACCOUNTS) {
    if (present.has(account.account_code)) continue;
    const made = await call('POST', '/gl-account', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      account_code: account.account_code,
      account_name: account.account_name,
      account_type: account.account_type,
    });
    if (made.status >= 200 && made.status < 300) accounts += 1;
    else if (!alreadyExists(made))
      console.log(
        `     gl account ${account.account_code}: ${made.data?.error?.message ?? JSON.stringify(made.data)}`,
      );
  }
  const mapped = new Set<string>();
  const db = await connection();
  try {
    const [rows] = await db.query<any[]>(
      'SELECT account_code, gl_account_id FROM gl_account_master WHERE deleted_at IS NULL',
    );
    for (const row of rows) accountIds.set(row.account_code, row.gl_account_id);
    const [already] = await db.query<any[]>(
      'SELECT transaction_type FROM gl_mapping_master WHERE deleted_at IS NULL',
    );
    for (const row of already) mapped.add(row.transaction_type);
  } finally {
    await db.end();
  }
  let mappings = 0;
  for (const mapping of STARTER_GL_MAPPINGS) {
    if (mapped.has(mapping.transaction_type)) continue;
    // No nob/lob here: this endpoint validates them against the company's own
    // rows and refuses the platform ids, and a mapping is company-wide anyway.
    const made = await call('POST', '/gl-mapping', {
      company_id: companyId,
      transaction_type: mapping.transaction_type,
      debit_gl_account_id: accountIds.get(mapping.debit_account_code),
      credit_gl_account_id: accountIds.get(mapping.credit_account_code),
    });
    if (made.status >= 200 && made.status < 300) {
      mappings += 1;
      mapped.add(mapping.transaction_type);
    } else if (!alreadyExists(made))
      console.log(
        `     gl mapping ${mapping.transaction_type}: ${made.data?.error?.message ?? JSON.stringify(made.data)}`,
      );
  }
  console.log(
    `  chart of accounts: ${accounts} accounts, ${mappings} GL mappings created`,
  );
}

/** The diet a silo carries, matched on the prefix of its own code. */
function dietFor(
  siloCode: string,
): { itemCode: string; diet: string } | undefined {
  return SILO_DIET.find((row) =>
    siloCode.toUpperCase().startsWith(row.prefix.toUpperCase()),
  );
}

/**
 * The feed mill, its bins, the diet each bin carries, and the feed standing in
 * every silo and bin.
 *
 * Feed arrives the way it really would — a goods receipt posted into the silo
 * or bin, which is a warehouse in this app exactly as a store is. Nothing is
 * written into the ledger behind the app's back.
 *
 * Every silo is filled to four fifths of its capacity on Rishi's instruction,
 * which leaves each one a fifth short of full and well above its own low-level
 * alert at a fifth, so the farm reads as running rather than as either empty
 * or brimming.
 */
async function ensureFeedStock(
  companyId: string,
  refs: HerdRefs,
): Promise<void> {
  const existing = await existingLocationIds();

  // The mill stands on its own, not under the farm: a MILL takes no parent.
  let millId = existing.get(MULTIPLIER_MILL.code);
  if (!millId) {
    const made = await call('POST', '/location', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      location_code: MULTIPLIER_MILL.code,
      location_name: MULTIPLIER_MILL.name,
      location_type: 'MILL',
      location_address: 'GRASMERE FARM NORTON',
      max_capacity: MULTIPLIER_MILL.dailyCapacityTon,
      capacity_uom: 'TONNE',
      mill_daily_capacity_ton: MULTIPLIER_MILL.dailyCapacityTon,
      mill_hourly_capacity_ton: MULTIPLIER_MILL.hourlyCapacityTon,
      mill_bulk_daily_allocation_ton: MULTIPLIER_MILL.bulkDailyAllocationTon,
      mill_bagged_daily_allocation_ton:
        MULTIPLIER_MILL.baggedDailyAllocationTon,
    });
    if (made.status >= 200 && made.status < 300)
      millId = made.data?.location_id ?? made.data?.data?.location_id;
    else {
      console.log(
        `  mill: refused — ${made.data?.error?.message ?? JSON.stringify(made.data)}`,
      );
      return;
    }
  }

  let binsMade = 0;
  const binIds = new Map<string, string>();
  // A bin created before its diet was settled keeps the old Bulk/Bagged type,
  // and the diet assignment then refuses it for disagreeing with the feed.
  const binDb = await connection();
  try {
    for (const bin of MULTIPLIER_BINS) {
      await binDb.query(
        'UPDATE location_master SET bin_feed_type = ? WHERE location_code = ? AND bin_feed_type <> ?',
        [bin.feedType, bin.code, bin.feedType],
      );
    }
  } finally {
    await binDb.end();
  }
  for (const bin of MULTIPLIER_BINS) {
    const already = existing.get(bin.code);
    if (already) {
      binIds.set(bin.code, already);
      continue;
    }
    const made = await call('POST', '/location', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      location_code: bin.code,
      location_name: bin.name,
      location_type: 'BIN',
      parent_location_id: millId,
      location_address: 'GRASMERE FARM NORTON',
      bin_capacity_ton: bin.capacityTon,
      bin_feed_type: bin.feedType,
    });
    if (made.status >= 200 && made.status < 300) {
      binIds.set(
        bin.code,
        made.data?.location_id ?? made.data?.data?.location_id,
      );
      binsMade += 1;
    } else
      console.log(
        `     bin ${bin.code} refused: ${made.data?.error?.message ?? JSON.stringify(made.data)}`,
      );
  }
  console.log(
    `  mill and bins: ${binsMade} bins created of ${MULTIPLIER_BINS.length}`,
  );

  // A bin's diet also needs a Diet No. on the feed item itself — the TDD's
  // "diet number 1 to 14", which Triple C's Item Master never fills in. Each
  // bin's feed takes the bin's own priority as its diet number, so the eight
  // diets the mill runs are numbered 1 to 8 in the order they are made.
  const dietDb = await connection();
  let numbered = 0;
  try {
    for (const bin of MULTIPLIER_BINS) {
      const itemId = refs.items.get(bin.itemCode);
      if (!itemId) continue;
      const [[row]] = await dietDb.query<any[]>(
        'SELECT diet_no FROM item_master WHERE item_id = ?',
        [itemId],
      );
      if (row?.diet_no != null) continue;
      await dietDb.query(
        'UPDATE item_master SET diet_no = ? WHERE item_id = ?',
        [bin.priority, itemId],
      );
      numbered += 1;
    }
  } finally {
    await dietDb.end();
  }
  if (numbered) console.log(`  diet numbers set on ${numbered} feed items`);

  // A bin's diet: which feed it is holding, and in what order the mill fills it.
  let assigned = 0;
  const assignmentDate = STOCK_DATE;
  for (const bin of MULTIPLIER_BINS) {
    const binId = binIds.get(bin.code);
    const itemId = refs.items.get(bin.itemCode);
    if (!binId || !itemId) continue;
    const made = await call('POST', '/bin-diet-assignment', {
      company_id: companyId,
      bin_location_id: binId,
      feed_item_id: itemId,
      production_date: assignmentDate,
      diet_priority: bin.priority,
    });
    if (made.status >= 200 && made.status < 300) assigned += 1;
    else if (!alreadyExists(made))
      console.log(
        `     diet for ${bin.code} refused: ${made.data?.error?.message ?? JSON.stringify(made.data)}`,
      );
  }
  console.log(`  bin diets: ${assigned} assigned`);

  // Feed is bought into the store, never straight into a silo: the app refuses
  // a feed GRN on a silo and says so — "feed reaches a silo only through the
  // Transfer Order receipt; receive the feed into a store and transfer it".
  // So the whole farm's feed is received into MST1 here, one line per diet,
  // enough to fill every silo to four fifths and every bin besides. Moving it
  // out to the silos is the transfer step that follows.
  const storeId = refs.storeId;
  const needed = new Map<string, number>();
  for (const silo of MULTIPLIER_SILOS) {
    const diet = dietFor(silo.code);
    if (!diet) continue;
    needed.set(
      diet.itemCode,
      (needed.get(diet.itemCode) ?? 0) +
        Math.round(silo.capacityKg * SILO_FILL_FRACTION),
    );
  }
  for (const bin of MULTIPLIER_BINS) {
    needed.set(
      bin.itemCode,
      (needed.get(bin.itemCode) ?? 0) +
        Math.round(bin.capacityTon * 1000 * SILO_FILL_FRACTION),
    );
  }
  // Asking whether the store has ANY posted receipt would say yes on the back
  // of the livestock receipts, which also land here. The question is whether
  // it has taken feed.
  const feedDb = await connection();
  let alreadyStocked = false;
  try {
    const [[row]] = await feedDb.query<any[]>(
      `SELECT COUNT(*) n FROM goods_receipt g
         JOIN goods_receipt_line gl ON gl.receipt_id = g.receipt_id
         JOIN item_master i ON i.item_id = gl.item_id
        WHERE g.status = 'POSTED' AND i.item_type = 'FEED'`,
    );
    alreadyStocked = Number(row.n) > 0;
  } finally {
    await feedDb.end();
  }
  if (alreadyStocked) {
    console.log('  feed stock: the store already carries its feed');
    return;
  }
  const lines = [...needed.entries()]
    .map(([itemCode, kg]) => ({
      item_id: refs.items.get(itemCode),
      quantity: kg,
      uom: 'KG',
      rate: 1,
      lot_no: `LOT-2025-01-${itemCode}`,
    }))
    .filter((line) => line.item_id);
  const receipt = await call('POST', '/goods-receipt', {
    company_id: companyId,
    warehouse_id: storeId,
    posting_date: STOCK_DATE,
    remarks: 'Triple C showcase — opening feed stock',
    lines,
  });
  const receiptId = receipt.data?.receipt_id ?? receipt.data?.data?.receipt_id;
  if (!receiptId) {
    console.log(
      `  feed stock: refused — ${receipt.data?.error?.message ?? JSON.stringify(receipt.data)}`,
    );
    return;
  }
  await post(`/goods-receipt/${receiptId}/post`, {});
  const totalKg = [...needed.values()].reduce((sum, kg) => sum + kg, 0);
  console.log(
    `  feed stock: ${lines.length} diets, ${totalKg.toLocaleString('en-GB')} kg received into the store and posted`,
  );
  console.log(
    `     silos and bins are configured but still empty — feed reaches them by transfer order, which is the next step`,
  );
}

/** Warehouses that already hold feed, so a re-run does not fill them twice. */
async function stockedWarehouses(): Promise<Set<string>> {
  const db = await connection();
  try {
    const [rows] = await db.query<any[]>(
      'SELECT DISTINCT warehouse_id FROM goods_receipt WHERE status = ?',
      ['POSTED'],
    );
    return new Set(rows.map((r) => r.warehouse_id));
  } finally {
    await db.end();
  }
}

/**
 * The rate the demo herd is bought at.
 *
 * The client priced four sows — 2,688.46, 3,094.40, 3,094.40 and 2,624.36 —
 * and nothing else. The sixty animals these batches need are ours, not theirs,
 * so they are bought at the average of those four rather than at a figure
 * invented from nothing. Progeny batches are home-bred and carry no
 * acquisition at all, which the batch service supports directly: "a nil
 * acquisition — the piglets of a farrowing — has no value to journal".
 */
const DEMO_ACQUISITION_RATE = 2875.41;

/** Age on arrival by the stage an animal is bought into: rearing gilts at 20 weeks, flushing at 26, service at 28, sows at about 18 months. */
const AGE_AT_ENTRY_DAYS: Record<string, number> = {
  REARING: 140,
  FLUSH: 182,
  INSEMINATION: 196,
};

/** Which shed each batch stands in, by the stage its animals are at. */
const SHED_FOR_STAGE: Record<string, string> = {
  REARING: 'MUGR1',
  FLUSH: 'MUGR2',
  INSEMINATION: 'MUGR3',
  GESTATION: 'MUDSW 1-1',
  FARROWING: 'MUFHE1',
  LACTATION: 'MUFHE2',
  WEANER: 'MUWN1',
  DOUBLE_STOCK: 'MUDST1P1',
  GROWER: 'MUGR4',
};

interface HerdRefs {
  breeds: Map<string, string>;
  stages: Map<string, string>;
  items: Map<string, string>;
  locations: Map<string, string>;
  pensByShed: Map<string, string[]>;
  storeId: string;
}

async function herdRefs(): Promise<HerdRefs> {
  const db = await connection();
  try {
    const [b] = await db.query<any[]>(
      'SELECT breed_code, breed_id FROM breed_master WHERE deleted_at IS NULL',
    );
    const [st] = await db.query<any[]>(
      'SELECT stage_code, stage_id FROM stage_master',
    );
    const [it] = await db.query<any[]>(
      'SELECT item_code, item_id FROM item_master WHERE deleted_at IS NULL',
    );
    const [lo] = await db.query<any[]>(
      'SELECT location_code, location_id, location_type, parent_location_id FROM location_master WHERE deleted_at IS NULL',
    );
    const byId = new Map(lo.map((r) => [r.location_id, r]));
    const pensByShed = new Map<string, string[]>();
    for (const row of lo) {
      // An animal may be placed in a shed or a pen only — not in a crate.
      if (row.location_type !== 'PEN') continue;
      const shed = byId.get(row.parent_location_id);
      if (!shed) continue;
      const list = pensByShed.get(shed.location_code) ?? [];
      list.push(row.location_id);
      pensByShed.set(shed.location_code, list);
    }
    const store = lo.find((r) => r.location_type === 'STORE');
    if (!store)
      throw new Error(
        'No store exists, so a goods receipt has nowhere to be received into.',
      );
    return {
      breeds: new Map(b.map((r) => [r.breed_code, r.breed_id])),
      stages: new Map(st.map((r) => [r.stage_code, r.stage_id])),
      items: new Map(it.map((r) => [r.item_code, r.item_id])),
      locations: new Map(lo.map((r) => [r.location_code, r.location_id])),
      pensByShed,
      storeId: store.location_id,
    };
  } finally {
    await db.end();
  }
}

/** Creates a receipt for living assets and posts it, so animals can be taken from it. */
async function postedReceipt(
  companyId: string,
  refs: HerdRefs,
  itemCode: string,
  head: number,
  rate: number,
  date: string,
): Promise<string> {
  const receipt = await post('/goods-receipt', {
    company_id: companyId,
    warehouse_id: refs.storeId,
    posting_date: date,
    remarks: 'Triple C showcase — opening herd',
    lines: [
      { item_id: refs.items.get(itemCode), quantity: head, uom: 'HEAD', rate },
    ],
  });
  const id = receipt?.receipt_id ?? receipt?.data?.receipt_id;
  if (!id)
    throw new Error(
      `A receipt for ${itemCode} came back with no id: ${JSON.stringify(receipt).slice(0, 200)}`,
    );
  await post(`/goods-receipt/${id}/post`, {});
  return id;
}

/**
 * The herd: the five sows of the register, then the ten planned batches.
 *
 * Every purchased animal is taken from a posted goods receipt, because that is
 * the only place AnimalService reads an acquisition cost from — it discards
 * any cost passed to it. The five registered sows each get their own receipt,
 * dated to their own entry date; the sixty demo animals are bought ten at a
 * time, since one receipt of ten head registers ten animals.
 */
async function ensureHerd(companyId: string, areaId: string): Promise<void> {
  const refs = await herdRefs();
  const db = await connection();
  let existingAnimals: Set<string>;
  let existingBatches: Set<string>;
  try {
    // animal_register carries no deleted_at — an animal leaves by status, not by deletion.
    const [a] = await db.query<any[]>(
      'SELECT animal_code FROM animal_register',
    );
    existingAnimals = new Set(a.map((r) => r.animal_code));
    const [bt] = await db.query<any[]>(
      'SELECT remarks FROM batch_header WHERE deleted_at IS NULL',
    );
    existingBatches = new Set(bt.map((r) => String(r.remarks ?? '')));
  } finally {
    await db.end();
  }

  const problems: string[] = [];
  const farrowingPens = refs.pensByShed.get('MUFHE1') ?? [];
  let registered = 0;

  for (const [index, animal] of MULTIPLIER_ANIMALS.entries()) {
    if (existingAnimals.has(animal.code)) continue;
    try {
      // A receipt line must carry a rate above zero, so the home-bred sow gets
      // no receipt: she is a local entry whose acquisition cost is stated
      // directly, which is the path the service allows for exactly this case.
      const purchased = animal.acquisitionCost > 0;
      const receiptId = purchased
        ? await postedReceipt(
            companyId,
            refs,
            'BIO-SWINE-SOW',
            1,
            animal.acquisitionCost,
            animal.entryDate,
          )
        : undefined;
      await post('/animal', {
        company_id: companyId,
        nob_id: NOB_LIVESTOCK,
        lob_id: LOB_PIGGERY,
        animal_code: animal.code,
        animal_type: 'SOW',
        breed_id: refs.breeds.get(animal.breedCode),
        gender: 'F',
        dob: animal.dob,
        entry_type: purchased ? 'PURCHASED_IMPORTED' : 'PURCHASED_LOCAL',
        entry_date: animal.entryDate,
        source_receipt_id: receiptId,
        acquisition_cost: purchased ? undefined : animal.acquisitionCost,
        item_id: refs.items.get('BIO-SWINE-SOW'),
        current_stage_id: refs.stages.get('FARROWING'),
        current_location_id:
          farrowingPens[index % Math.max(farrowingPens.length, 1)],
        no_of_teats: animal.teats,
        rfid_tag: animal.code,
      });
      registered += 1;
    } catch (error) {
      problems.push(`${animal.code}: ${(error as Error).message}`);
    }
  }
  console.log(
    `  registered sows: ${registered} of ${MULTIPLIER_ANIMALS.length} from the template`,
  );

  // The register's own sows, batched by breed — four Z-Line and one TN-70,
  // all standing in Farrowing where their register rows put them.
  let batchesMade = 0;
  for (const breedCode of ['Z-LINE-SOW', 'TN-70-SOW']) {
    const token = `TRIPLEC-REGISTER-${breedCode}`;
    if (existingBatches.has(token)) continue;
    const codes = MULTIPLIER_ANIMALS.filter(
      (a) => a.breedCode === breedCode,
    ).map((a) => a.code);
    if (!codes.length) continue;
    const idDb = await connection();
    let ids: string[];
    try {
      const [rows] = await idDb.query<any[]>(
        `SELECT animal_id FROM animal_register WHERE animal_code IN (${codes.map(() => '?').join(',')})`,
        codes,
      );
      ids = rows.map((r) => r.animal_id);
    } finally {
      await idDb.end();
    }
    if (!ids.length) continue;
    try {
      await post('/batch', {
        company_id: companyId,
        lob_id: LOB_PIGGERY,
        operational_area_id: areaId,
        costing_method: 'BIO_ASSET',
        breed_id: refs.breeds.get(breedCode),
        stage_id: refs.stages.get('FARROWING'),
        shed_id: refs.locations.get('MUFHE1'),
        // A batch cannot start before its animals arrived: the Z-Line sows' register
        // dates run to 15 Sep 2025, the TN-70 sow was on the farm before the history began.
        start_date: MULTIPLIER_ANIMALS.filter((a) => a.breedCode === breedCode)
          .map((a) => a.entryDate)
          .reduce((a, b) => (a > b ? a : b), HERD_START),
        uom: 'HEAD',
        remarks: token,
        tracking_mode: 'ANIMAL_WISE',
        animal_ids: ids,
      });
      batchesMade += 1;
    } catch (error) {
      problems.push(`register batch ${breedCode}: ${(error as Error).message}`);
    }
  }

  let demoAnimals = 0;
  for (const plan of PLANNED_BATCHES) {
    const token = `TRIPLEC-${plan.key}`;
    if (existingBatches.has(token)) continue;
    const shedCode = SHED_FOR_STAGE[plan.stage];
    const shedId = refs.locations.get(shedCode);
    const pens = refs.pensByShed.get(shedCode) ?? [];
    try {
      const common = {
        company_id: companyId,
        lob_id: LOB_PIGGERY,
        operational_area_id: areaId,
        costing_method: 'BIO_ASSET',
        breed_id: refs.breeds.get(plan.breedCode),
        stage_id: refs.stages.get(plan.stage),
        shed_id: shedId,
        start_date: HERD_START,
        uom: 'HEAD',
        remarks: token,
      };
      if (plan.animalWise) {
        const receiptId = await postedReceipt(
          companyId,
          refs,
          plan.itemCode,
          plan.head,
          DEMO_ACQUISITION_RATE,
          HERD_START,
        );
        const animalIds: string[] = [];
        for (let n = 1; n <= plan.head; n += 1) {
          const made = await post('/animal', {
            company_id: companyId,
            nob_id: NOB_LIVESTOCK,
            lob_id: LOB_PIGGERY,
            animal_code: `${plan.tagPrefix}${String(n).padStart(3, '0')}`,
            animal_type: plan.animalType,
            breed_id: refs.breeds.get(plan.breedCode),
            gender: plan.gender,
            // Bought at the age their stage implies, a few days apart, so the
            // history's gilts reach service on different days.
            dob: new Date(
              Date.parse(HERD_START) -
                ((AGE_AT_ENTRY_DAYS[plan.stage] ?? 560) + n * 3) * 86400000,
            )
              .toISOString()
              .slice(0, 10),
            entry_type: 'PURCHASED_IMPORTED',
            entry_date: HERD_START,
            source_receipt_id: receiptId,
            item_id: refs.items.get(plan.itemCode),
            current_stage_id: refs.stages.get(plan.stage),
            current_location_id: pens.length
              ? pens[(n - 1) % pens.length]
              : shedId,
          });
          const id = made?.animal_id ?? made?.data?.animal_id;
          if (id) animalIds.push(id);
          demoAnimals += 1;
        }
        await post('/batch', {
          ...common,
          tracking_mode: 'ANIMAL_WISE',
          animal_ids: animalIds,
        });
      } else {
        // Home-bred progeny: counted by head, bought from nobody, so the input
        // line carries no rate and nothing is journalled as an acquisition.
        await post('/batch', {
          ...common,
          tracking_mode: 'BATCH_WISE',
          opening_quantity: plan.head,
          input_lines: [
            {
              item_id: refs.items.get(plan.itemCode),
              quantity: plan.head,
              uom: 'HEAD',
              rate: 0,
            },
          ],
        });
      }
      batchesMade += 1;
    } catch (error) {
      problems.push(`batch ${plan.key}: ${(error as Error).message}`);
    }
  }
  console.log(
    `  batches: ${batchesMade} of ${PLANNED_BATCHES.length + 2} created; ${demoAnimals} animals registered into the animal-wise ones`,
  );
  for (const line of problems.slice(0, 8)) console.log(`     ${line}`);
  if (problems.length > 8)
    console.log(`     ... and ${problems.length - 8} more`);
}

/**
 * Triple C's reason codes — the list a mortality or a cull is recorded against,
 * so nothing can be entered on a batch until they exist.
 */
async function ensureReasons(companyId: string): Promise<void> {
  const present = await existingCodes('reason_master', 'reason_code');
  let created = 0;
  const rejected: string[] = [];
  for (const reason of TRIPLEC_REASONS) {
    if (present.has(reason.code)) continue;
    const r = await call('POST', '/reason', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      reason_code: reason.code,
      reason_name: reason.name,
      category: reason.category,
      sub_category: reason.subCategory,
      applicable_stages: reason.stages,
      stage_filter_note: reason.stageFilterNote?.slice(0, 100),
      mandatory_comment: reason.mandatoryComment,
    });
    if (r.status >= 200 && r.status < 300) created += 1;
    else
      rejected.push(
        `${reason.code} ${reason.name}: ${r.data?.error?.message ?? r.data?.message ?? JSON.stringify(r.data)}`,
      );
  }
  console.log(
    `  reasons: ${created} created of ${TRIPLEC_REASONS.length} from the GM's reviewed list`,
  );
  for (const line of rejected.slice(0, 8)) console.log(`     rejected ${line}`);
  if (rejected.length > 8)
    console.log(`     ... and ${rejected.length - 8} more`);
}

/**
 * Triple C's accounting calendar: twelve periods a year, July to June, each
 * ending on a Saturday, in a repeating 4-4-5 week pattern that closes the year
 * at exactly 52 weeks.
 *
 * This is their own calendar, read off `Accounting Periods.xlsx`: anchoring a
 * 4-4-5 rule on its first start date reproduces all twelve of its rows to the
 * day. Note it is NOT what `POST /reporting-period/generate` produces — that
 * endpoint puts each period end on the last Saturday of its month, which
 * agrees with Triple C for six periods of twelve and is a week out for the
 * other six. The periods are therefore posted one by one rather than generated.
 *
 * Three business years are created because the data entries, requisitions and
 * forecasts this tenant is for start in January 2025, and feed forecasting,
 * feed alerts and the stock count all read the period a date falls in.
 */
const BUSINESS_YEAR_ANCHOR = '2026-06-28';
const BUSINESS_YEARS_BACK = 2;
const PERIOD_WEEKS = [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5];

function businessYearPeriods(
  anchor: Date,
): Array<{ period_code: string; start_date: string; end_date: string }> {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const out: Array<{
    period_code: string;
    start_date: string;
    end_date: string;
  }> = [];
  let start = new Date(anchor);
  for (const weeks of PERIOD_WEEKS) {
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + weeks * 7 - 1);
    // Named for the month the period ends in, matching the client's own column.
    out.push({
      period_code: `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}`,
      start_date: iso(start),
      end_date: iso(end),
    });
    start = new Date(end);
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return out;
}

async function ensureReportingPeriods(companyId: string): Promise<void> {
  const present = await existingCodes('reporting_period', 'period_code');
  let created = 0;
  const rejected: string[] = [];
  for (let back = BUSINESS_YEARS_BACK; back >= 0; back -= 1) {
    const anchor = new Date(`${BUSINESS_YEAR_ANCHOR}T00:00:00Z`);
    anchor.setUTCDate(anchor.getUTCDate() - back * 364);
    for (const period of businessYearPeriods(anchor)) {
      if (present.has(period.period_code)) continue;
      const r = await call('POST', '/reporting-period', {
        company_id: companyId,
        period_code: period.period_code,
        start_date: period.start_date,
        end_date: period.end_date,
        stock_take_date: period.end_date,
      });
      if (r.status >= 200 && r.status < 300) {
        created += 1;
        present.add(period.period_code);
      } else
        rejected.push(
          `${period.period_code}: ${r.data?.error?.message ?? r.data?.message ?? JSON.stringify(r.data)}`,
        );
    }
  }
  console.log(
    `  reporting periods: ${created} created across ${BUSINESS_YEARS_BACK + 1} business years (July-June, 4-4-5)`,
  );
  for (const line of rejected.slice(0, 6)) console.log(`     rejected ${line}`);
  if (rejected.length > 6)
    console.log(`     ... and ${rejected.length - 6} more`);
}

/** The breeds the client's standards are written for. Teaser Boar has no figures. */
const LIFECYCLE_BREEDS = ['Z-LINE-SOW', 'TN-70-SOW'];

/**
 * The production standards, one set per breed, scoped to the MULTIPLIER farm.
 *
 * The workbook never says which breed a sheet is for — the Breed column is
 * empty on all 134 rows — so on Rishi's instruction the 44 standards are
 * written for both sow lines. Teaser Boar is left out: it is a name with no
 * figures behind it, and a standard invented for it would be fiction.
 *
 * A feed item is linked when the sheet's wording matches a catalogue item;
 * where it does not ("W1 - Gilt rear 1", "2 weeks at Wean 1 OTC, 2 weeks
 * Grower 1") the standard is still written, without a feed line, and the
 * unmatched wording is reported for Triple C to map.
 */
/**
 * The lifecycle standards, scoped to one farm. MULTIPLIER's come from its own workbook; Porta's are the same
 * bands carrying Porta's figures where its workbook gives one (porta-lifecycle-seed-data.ts).
 */
async function ensureLifecycle(
  companyId: string,
  farmId: string,
  breedCodes: string[] = LIFECYCLE_BREEDS,
  figures: Record<string, Partial<(typeof MULTIPLIER_LIFECYCLE)[number]>> = {},
): Promise<void> {
  const db = await connection();
  let breeds: Map<string, string>;
  let stages: Map<string, string>;
  let items: Map<string, string>;
  let already: Set<string>;
  try {
    const [b] = await db.query<any[]>(
      'SELECT breed_code, breed_id FROM breed_master WHERE deleted_at IS NULL',
    );
    breeds = new Map(b.map((r) => [r.breed_code, r.breed_id]));
    const [st] = await db.query<any[]>(
      'SELECT stage_code, stage_id FROM stage_master',
    );
    stages = new Map(st.map((r) => [r.stage_code, r.stage_id]));
    const [it] = await db.query<any[]>(
      'SELECT item_name, item_id FROM item_master WHERE deleted_at IS NULL',
    );
    items = new Map(it.map((r) => [normaliseName(r.item_name), r.item_id]));
    const [ex] = await db.query<any[]>(
      `SELECT breed_id, stage_id, period_from, period_to, kpi_thresholds, kpi_alert_period, std_body_weight_kg, std_adg_gpd,
              std_fcr, std_mortality_rate_pct, vaccination_protocol, medication_protocol, resource_requirements
         FROM breed_lifecycle_stages WHERE retired_at IS NULL AND farm_id = ? ORDER BY period_from, period_to`,
      [farmId],
    );
    already = new Set(
      ex.map(
        (r) => `${r.breed_id}|${r.stage_id}|${r.period_from}|${r.period_to}`,
      ),
    );
  } finally {
    await db.end();
  }

  let created = 0;
  const unmatchedFeed = new Set<string>();
  const rejected: string[] = [];
  for (const breedCode of breedCodes) {
    const breedId = breeds.get(breedCode);
    if (!breedId)
      throw new Error(
        `Breed ${breedCode} is missing, so its standards have nothing to hang off.`,
      );
    for (const base of MULTIPLIER_LIFECYCLE) {
      const row = { ...base, ...(figures[base.stageName] ?? {}) };
      const stageId = stages.get(row.stage);
      if (!stageId) throw new Error(`Stage ${row.stage} is missing.`);
      if (
        already.has(`${breedId}|${stageId}|${row.periodFrom}|${row.periodTo}`)
      )
        continue;
      const feedItemId = row.feedItemName
        ? items.get(normaliseName(row.feedItemName))
        : undefined;
      if (row.feedItemName && !feedItemId) unmatchedFeed.add(row.feedItemName);
      const r = await call('POST', '/breed-lifecycle-stage', {
        company_id: companyId,
        breed_id: breedId,
        stage_id: stageId,
        farm_id: farmId,
        calc_unit: row.calcUnit,
        period_from: row.periodFrom,
        period_to: row.periodTo,
        feed_item_id: feedItemId,
        feed_qty_per_head_per_day_kg: row.feedQtyKg,
        std_body_weight_kg: row.stdBodyWeightKg,
        std_adg_gpd: row.stdAdg,
        std_fcr: row.stdFcr,
        std_mortality_rate_pct: row.stdMortalityPct,
      });
      if (r.status >= 200 && r.status < 300) {
        created += 1;
        already.add(`${breedId}|${stageId}|${row.periodFrom}|${row.periodTo}`);
      } else {
        rejected.push(
          `${breedCode} ${row.stage} ${row.periodFrom}-${row.periodTo}: ${r.data?.error?.message ?? r.data?.message ?? JSON.stringify(r.data)}`,
        );
      }
    }
  }
  console.log(
    `  lifecycle standards: ${created} created (${MULTIPLIER_LIFECYCLE.length} per breed x ${LIFECYCLE_BREEDS.length} sow lines)`,
  );
  if (unmatchedFeed.size)
    console.log(
      `     ${unmatchedFeed.size} feed descriptions matched no catalogue item: ${[...unmatchedFeed].slice(0, 5).join(' | ')}${unmatchedFeed.size > 5 ? ' ...' : ''}`,
    );
  for (const line of rejected.slice(0, 8)) console.log(`     rejected ${line}`);
  if (rejected.length > 8)
    console.log(`     ... and ${rejected.length - 8} more`);
}

/**
 * The KPI metrics the showcase's targets name: the system vocabulary signup
 * would have created (emptied above with the other starter masters) plus the
 * codes the Farrowing Report reads its target columns from
 * (farrowing-report.metrics.ts TARGET_METRICS).
 */
const KPI_METRICS = [
  ...SYSTEM_KPI_METRIC_SEED,
  {
    metric_code: 'SERVICE_TARGET',
    metric_name: 'Service Target',
    default_uom: 'HEAD',
  },
  {
    metric_code: 'GILT_SERVICE_TARGET',
    metric_name: 'Gilt Service Target',
    default_uom: 'HEAD',
  },
  {
    metric_code: 'SECOND_PARITY_SERVICE_TARGET',
    metric_name: '2nd Parity Service Target',
    default_uom: 'HEAD',
  },
  {
    metric_code: 'FARROWING_RATE',
    metric_name: 'Farrowing Rate',
    default_uom: 'PCT',
  },
  { metric_code: 'TOTAL_BORN', metric_name: 'Total Born', default_uom: 'HEAD' },
  { metric_code: 'BORN_ALIVE', metric_name: 'Born Alive', default_uom: 'HEAD' },
  { metric_code: 'BORN_DEAD', metric_name: 'Born Dead', default_uom: 'HEAD' },
  { metric_code: 'MUMMIFIED', metric_name: 'Mummified', default_uom: 'HEAD' },
  {
    metric_code: 'PRE_WEAN_MORTALITY',
    metric_name: 'Pre-wean Mortality',
    default_uom: 'PCT',
  },
  {
    metric_code: 'TOTAL_LITTER_MASS',
    metric_name: 'Total Litter Mass',
    default_uom: 'KG',
  },
  {
    metric_code: 'WEAN_PER_SOW',
    metric_name: 'Weaned per Sow',
    default_uom: 'HEAD',
  },
  {
    metric_code: 'GILT_BODY_LOSS',
    metric_name: 'Gilt Maternal Body Weight Loss',
    default_uom: 'PCT',
  },
  {
    metric_code: 'MORTALITY_PCT',
    metric_name: 'Mortality %',
    default_uom: 'PCT',
  },
  {
    metric_code: 'FARROWING_TARGET',
    metric_name: 'Farrowing Target',
    default_uom: 'HEAD',
  },
  {
    metric_code: 'ACTIVE_WEEK_MORTALITY',
    metric_name: 'Active Week Mortality',
    default_uom: 'HEAD',
  },
];

type KpiTarget = {
  metric: string;
  uom: string;
  average_value?: number;
  lower_limit?: number;
  upper_limit?: number;
};

/**
 * MULTIPLIER's column (I) of "KPI Triple C Pigs_SUBMISSIONS.xlsx", which the
 * sheet files under ZLine. Each list goes on the Z-Line lifecycle row the
 * sheet's band ends on; ratios the sheet writes as 0.9 are stored as 90 because
 * the report compares them with percentages. "chart" rows and monthly inputs
 * carry no number and are left out.
 */
// The sheet has no TN70 figures for MULTIPLIER; Rishi asked (24 Oct) for the
// ZLine targets to stand for the TN-70 line too.
const KPI_BREEDS = ['Z-LINE-SOW', 'TN-70-SOW'];
const MULTIPLIER_KPIS: Array<{
  stage: string;
  periodFrom: number;
  periodTo: number;
  kpis: KpiTarget[];
}> = [
  {
    stage: 'REARING',
    periodFrom: 4,
    periodTo: 10,
    kpis: [
      { metric: 'BODY_WEIGHT', uom: 'KG', average_value: 28, lower_limit: 27 },
      { metric: 'ADG', uom: 'KG', average_value: 0.526, lower_limit: 0.505 },
    ],
  },
  {
    stage: 'REARING',
    periodFrom: 15,
    periodTo: 16,
    kpis: [
      {
        metric: 'BODY_WEIGHT',
        uom: 'KG',
        average_value: 59,
        lower_limit: 57,
        upper_limit: 62,
      },
      { metric: 'ADG', uom: 'KG', average_value: 0.738, lower_limit: 0.714 },
    ],
  },
  {
    stage: 'REARING',
    periodFrom: 24,
    periodTo: 25,
    kpis: [
      {
        metric: 'BODY_WEIGHT',
        uom: 'KG',
        average_value: 114,
        lower_limit: 111,
      },
      { metric: 'ADG', uom: 'KG', average_value: 0.873, lower_limit: 0.831 },
    ],
  },
  {
    stage: 'REARING',
    periodFrom: 27,
    periodTo: 28,
    kpis: [
      {
        metric: 'BODY_WEIGHT',
        uom: 'KG',
        average_value: 131,
        lower_limit: 127,
      },
      { metric: 'ADG', uom: 'KG', average_value: 0.81, lower_limit: 0.762 },
    ],
  },
  {
    stage: 'FARROWING',
    periodFrom: 0,
    periodTo: 4,
    kpis: [
      { metric: 'SERVICE_TARGET', uom: 'HEAD', average_value: 24 },
      { metric: 'GILT_SERVICE_TARGET', uom: 'HEAD', average_value: 4 },
      {
        metric: 'SECOND_PARITY_SERVICE_TARGET',
        uom: 'HEAD',
        average_value: 3.1,
      },
      { metric: 'FARROWING_RATE', uom: 'PCT', average_value: 90 },
      { metric: 'TOTAL_BORN', uom: 'HEAD', average_value: 16 },
      { metric: 'BORN_ALIVE', uom: 'HEAD', average_value: 15 },
      { metric: 'BORN_DEAD', uom: 'HEAD', average_value: 0.7 },
      { metric: 'MUMMIFIED', uom: 'HEAD', average_value: 0.3 },
      { metric: 'PRE_WEAN_MORTALITY', uom: 'PCT', average_value: 8 },
      { metric: 'WEANING_WEIGHT', uom: 'KG', average_value: 7.5 },
      { metric: 'TOTAL_LITTER_MASS', uom: 'KG', average_value: 103.5 },
      { metric: 'WEAN_PER_SOW', uom: 'HEAD', average_value: 13.8 },
      { metric: 'GILT_BODY_LOSS', uom: 'PCT', lower_limit: 8, upper_limit: 12 },
      // Not in the sheet; derived from its own figures (Rishi, 24 Oct): farrowings expected from the week's
      // services (service target x farrow rate, 24 x 90%), and the piglets a litter loses in a nursing week
      // (born alive x pre-wean mortality / 4 weeks: 15 x 8% / 4).
      { metric: 'FARROWING_TARGET', uom: 'HEAD', average_value: 21.6 },
      { metric: 'ACTIVE_WEEK_MORTALITY', uom: 'HEAD', average_value: 0.3 },
    ],
  },
  {
    stage: 'WEANER',
    periodFrom: 4,
    periodTo: 10,
    kpis: [
      { metric: 'BODY_WEIGHT', uom: 'KG', average_value: 28 },
      { metric: 'ADG', uom: 'KG', average_value: 0.539 },
      { metric: 'FCR', uom: 'RATIO', average_value: 1.5 },
      { metric: 'MORTALITY_PCT', uom: 'PCT', average_value: 1.2 },
    ],
  },
  {
    stage: 'GROWER',
    periodFrom: 14,
    periodTo: 22,
    kpis: [
      { metric: 'ADG', uom: 'KG', average_value: 1.1 },
      { metric: 'FCR', uom: 'RATIO', average_value: 2.4 },
      { metric: 'MORTALITY_PCT', uom: 'PCT', average_value: 2 },
    ],
  },
];

async function ensureKpis(
  companyId: string,
  farmCode = 'MUL100',
  bands: typeof MULTIPLIER_KPIS = MULTIPLIER_KPIS,
  breedCodes: string[] = KPI_BREEDS,
  createMetrics = true,
): Promise<void> {
  let metrics = 0;
  if (createMetrics) {
    for (const m of KPI_METRICS) {
      if (
        await post(
          '/kpi-metric',
          { ...m, company_id: companyId },
          alreadyExists,
        )
      )
        metrics += 1;
    }
  }
  const db = await connection();
  let rows: any[];
  try {
    [rows] = await db.query<any[]>(
      `SELECT l.lifecycle_id, b.breed_code, s.stage_code, l.period_from, l.period_to, l.kpi_thresholds
         FROM breed_lifecycle_stages l
         JOIN stage_master s ON s.stage_id = l.stage_id
         JOIN breed_master b ON b.breed_id = l.breed_id
         JOIN location_master f ON f.location_id = l.farm_id
        WHERE b.breed_code IN (?) AND f.location_code = ? AND l.retired_at IS NULL`,
      [breedCodes, farmCode],
    );
  } finally {
    await db.end();
  }
  let attached = 0;
  const missing: string[] = [];
  for (const breedCode of breedCodes)
    for (const band of bands) {
      const row = rows.find(
        (r) =>
          r.breed_code === breedCode &&
          r.stage_code === band.stage &&
          r.period_from === band.periodFrom &&
          r.period_to === band.periodTo,
      );
      if (!row) {
        missing.push(
          `${breedCode} ${band.stage} ${band.periodFrom}-${band.periodTo}`,
        );
        continue;
      }
      const existing: any[] =
        typeof row.kpi_thresholds === 'string'
          ? (JSON.parse(row.kpi_thresholds) ?? [])
          : (row.kpi_thresholds ?? []);
      const have = new Set(existing.map((k) => k.metric));
      const added = band.kpis
        .filter((k) => !have.has(k.metric))
        .map((k) => ({ severity: 'WARNING', kpi_period: 'WEEKLY', ...k }));
      if (!added.length) continue;
      const r = await call(
        'PUT',
        `/breed-lifecycle-stage/${row.lifecycle_id}`,
        { kpi_thresholds: [...existing, ...added] },
      );
      if (r.status >= 200 && r.status < 300) attached += added.length;
      else
        missing.push(
          `${band.stage} ${band.periodFrom}-${band.periodTo}: ${r.data?.error?.message ?? r.data?.message ?? JSON.stringify(r.data)}`,
        );
    }
  console.log(
    `  KPIs: ${metrics} metrics created, ${attached} ${farmCode} targets attached to ${breedCodes.join(' and ')} lifecycle stages`,
  );
  for (const line of missing) console.log(`     not attached: ${line}`);
}

/**
 * Feed standards the submitted lifecycle leaves without a number or a gap.
 *
 * The client's rows count weeks of age (REARING 10-28), while the app reads a
 * row's period as weeks into the stage (Rishi, 13 Oct), so several stages have
 * no feed due in their first weeks and some name a feed with no quantity. The
 * client's rows are kept; a missing quantity is filled, and where nothing
 * covers the stage's first week a DEMO row is added so every stage's
 * scheduler carries a daily feed line. LACTATION gets none: a farrowing's
 * piglet lot stands in that stage too, and its creep row is the piglets' feed.
 * The 500 on the creep row is grams for
 * a litter, not kilograms a head, and is read as 0.15 kg a head.
 */
const FEED_QTY_FILL: Record<string, number> = {
  'REARING|4|10': 1.2,
  'DOUBLE_STOCK|10|14': 1.5,
  'FARROWING|0|1': 3.0,
  'FARROWING|0|4': 3.0,
  'GESTATION|0|15': 2.5,
  'INSEMINATION|0|1': 3.0,
  'WEANER|4|10': 0.8,
  'GROWER|14|22': 2.3,
};
const FEED_ITEM_FILL: Record<string, string> = { 'GROWER|14|22': 'Grower 2' };
/**
 * Feeds set over what the alias matched, from the sheet's own wording: the
 * weaner row reads "...7 to 10wks (17 days) - Wean 1", so after its creep weeks
 * a weaner eats Weaner O.T.C, the feed the weaner-house silos (MWH) hold; the
 * alias had taken only the first feed named, Creep 2.
 */
const FEED_ITEM_SET: Record<string, string> = { 'WEANER|4|10': 'Weaner O.T.C' };
const CREEP_KG_PER_HEAD = 0.15;
const DEMO_FEED_ROWS: Array<{
  stage: string;
  from: number;
  to: number;
  item: string;
  qty: number;
}> = [
  { stage: 'REARING', from: 1, to: 3, item: 'Weaner O.T.C', qty: 1.2 },
  { stage: 'FLUSH', from: 1, to: 4, item: 'Gilt 5', qty: 2.5 },
  { stage: 'WEANER', from: 1, to: 3, item: 'Creep 2 Nosilac', qty: 0.4 },
  // "2 weeks at Wean 1 OTC, 2 weeks Grower 1": the double-stock silos (MDST) hold Weaner O.T.C.
  { stage: 'DOUBLE_STOCK', from: 1, to: 2, item: 'Weaner O.T.C', qty: 1.3 },
  { stage: 'DOUBLE_STOCK', from: 3, to: 4, item: 'Grower 1', qty: 1.6 },
  { stage: 'GROWER', from: 1, to: 8, item: 'Grower 1', qty: 2.0 },
];

async function ensureFeedStandards(
  companyId: string,
  farmId: string,
  breedCodes: string[] = LIFECYCLE_BREEDS,
): Promise<void> {
  const db = await connection();
  let filled = 0;
  let added = 0;
  try {
    const [items] = await db.query<any[]>(
      'SELECT item_id, item_name FROM item_master WHERE deleted_at IS NULL',
    );
    const itemId = new Map(
      items.map((i) => [normaliseName(i.item_name), i.item_id]),
    );
    for (const [key, name] of Object.entries(FEED_ITEM_FILL)) {
      const [stage, from, to] = key.split('|');
      const [r] = await db.query<any>(
        `UPDATE breed_lifecycle_stages l JOIN stage_master s ON s.stage_id = l.stage_id SET l.feed_item_id = ?
          WHERE s.stage_code = ? AND l.period_from = ? AND l.period_to = ? AND l.feed_item_id IS NULL`,
        [itemId.get(normaliseName(name)), stage, Number(from), Number(to)],
      );
      filled += r.affectedRows ?? 0;
    }
    for (const [key, name] of Object.entries(FEED_ITEM_SET)) {
      const [stage, from, to] = key.split('|');
      const [r] = await db.query<any>(
        `UPDATE breed_lifecycle_stages l JOIN stage_master s ON s.stage_id = l.stage_id SET l.feed_item_id = ?
          WHERE s.stage_code = ? AND l.period_from = ? AND l.period_to = ?`,
        [itemId.get(normaliseName(name)), stage, Number(from), Number(to)],
      );
      filled += r.affectedRows ?? 0;
    }
    for (const [key, qty] of Object.entries(FEED_QTY_FILL)) {
      const [stage, from, to] = key.split('|');
      const [r] = await db.query<any>(
        `UPDATE breed_lifecycle_stages l JOIN stage_master s ON s.stage_id = l.stage_id SET l.feed_qty_per_head_per_day_kg = ?
          WHERE s.stage_code = ? AND l.period_from = ? AND l.period_to = ? AND l.feed_item_id IS NOT NULL
            AND (l.feed_qty_per_head_per_day_kg IS NULL OR l.feed_qty_per_head_per_day_kg = 0)`,
        [qty, stage, Number(from), Number(to)],
      );
      filled += r.affectedRows ?? 0;
    }
    const [creep] = await db.query<any>(
      `UPDATE breed_lifecycle_stages SET feed_qty_per_head_per_day_kg = ? WHERE feed_qty_per_head_per_day_kg > 50`,
      [CREEP_KG_PER_HEAD],
    );
    filled += creep.affectedRows ?? 0;
    // A KPI is checked once a week; with no period the scheduler would ask for it every day.
    await db.query(
      `UPDATE breed_lifecycle_stages SET kpi_alert_period = 'WEEKLY' WHERE kpi_alert_period IS NULL`,
    );

    const [b] = await db.query<any[]>(
      'SELECT breed_code, breed_id FROM breed_master WHERE deleted_at IS NULL',
    );
    const [st] = await db.query<any[]>(
      'SELECT stage_code, stage_id FROM stage_master',
    );
    const breeds = new Map(b.map((r) => [r.breed_code, r.breed_id]));
    const stages = new Map(st.map((r) => [r.stage_code, r.stage_id]));
    const [ex] = await db.query<any[]>(
      'SELECT breed_id, stage_id, period_from, period_to FROM breed_lifecycle_stages WHERE retired_at IS NULL AND farm_id = ?',
      [farmId],
    );
    const have = new Set(
      ex.map(
        (r) => `${r.breed_id}|${r.stage_id}|${r.period_from}|${r.period_to}`,
      ),
    );
    for (const breedCode of breedCodes) {
      for (const row of DEMO_FEED_ROWS) {
        const key = `${breeds.get(breedCode)}|${stages.get(row.stage)}|${row.from}|${row.to}`;
        if (have.has(key)) continue;
        // The scheduler reads a stage's KPIs and standards off its first row, which
        // this one becomes, so it carries the client row's own.
        const own = ex.find(
          (r) =>
            r.breed_id === breeds.get(breedCode) &&
            r.stage_id === stages.get(row.stage),
        );
        const json = (v: unknown) =>
          (typeof v === 'string' ? JSON.parse(v) : v) ?? undefined;
        const num = (v: unknown) => (v == null ? undefined : Number(v));
        const r = await call('POST', '/breed-lifecycle-stage', {
          company_id: companyId,
          breed_id: breeds.get(breedCode),
          stage_id: stages.get(row.stage),
          farm_id: farmId,
          calc_unit: 'WEEK',
          period_from: row.from,
          period_to: row.to,
          kpi_thresholds: json(own?.kpi_thresholds),
          kpi_alert_period: own?.kpi_alert_period ?? 'WEEKLY',
          std_body_weight_kg: num(own?.std_body_weight_kg),
          std_adg_gpd: num(own?.std_adg_gpd),
          std_fcr: num(own?.std_fcr),
          std_mortality_rate_pct: num(own?.std_mortality_rate_pct),
          vaccination_protocol: json(own?.vaccination_protocol),
          medication_protocol: json(own?.medication_protocol),
          feed_item_id: itemId.get(normaliseName(row.item)),
          feed_qty_per_head_per_day_kg: row.qty,
          notes:
            'DEMO feed standard — the submitted lifecycle has none for these stage weeks',
        });
        if (r.status >= 200 && r.status < 300) added += 1;
        else
          console.log(
            `     demo feed row ${breedCode} ${row.stage} ${row.from}-${row.to} refused: ${r.data?.error?.message ?? r.data?.message}`,
          );
      }
    }
    // The scheduler reads a stage's KPIs and standards off its first row, which a
    // DEMO row now is, so it carries those of the stage's first client row.
    const [all] = await db.query<any[]>(
      `SELECT lifecycle_id, breed_id, stage_id, farm_id, period_from, notes, kpi_thresholds, kpi_alert_period, std_mortality_rate_pct,
              std_body_weight_kg, std_adg_gpd, std_fcr, vaccination_protocol, medication_protocol
         FROM breed_lifecycle_stages WHERE retired_at IS NULL ORDER BY period_from, period_to`,
    );
    const isDemo = (r: any) => String(r.notes ?? '').startsWith('DEMO feed');
    for (const d of all.filter(isDemo)) {
      const c = all.find(
        (r) =>
          !isDemo(r) &&
          r.breed_id === d.breed_id &&
          r.stage_id === d.stage_id &&
          r.farm_id === d.farm_id,
      );
      if (!c) continue;
      const asJson = (v: unknown) =>
        v == null ? null : typeof v === 'string' ? v : JSON.stringify(v);
      await db.query(
        `UPDATE breed_lifecycle_stages SET kpi_thresholds = ?, kpi_alert_period = ?, std_mortality_rate_pct = ?, std_body_weight_kg = ?,
                std_adg_gpd = ?, std_fcr = ?, vaccination_protocol = ?, medication_protocol = ? WHERE lifecycle_id = ?`,
        [
          asJson(c.kpi_thresholds),
          c.kpi_alert_period ?? 'WEEKLY',
          c.std_mortality_rate_pct,
          c.std_body_weight_kg,
          c.std_adg_gpd,
          c.std_fcr,
          asJson(c.vaccination_protocol),
          asJson(c.medication_protocol),
          d.lifecycle_id,
        ],
      );
      filled += 1;
    }
  } finally {
    await db.end();
  }
  console.log(
    `  feed standards: ${filled} quantities/items filled, ${added} DEMO rows added for uncovered stage weeks`,
  );
}

// ---------------------------------------------------------------------------------------------- PORTA
/**
 * PORTA's KPI column (D) of "KPI Triple C Pigs_SUBMISSIONS.xlsx", on the same bands as MULTIPLIER's (column I).
 * The two targets the sheet has no figure for are derived the same way: 49 x 92% and 16.33 x 6% / 4.
 */
const PORTA_KPIS: typeof MULTIPLIER_KPIS = [
  {
    stage: 'REARING',
    periodFrom: 4,
    periodTo: 10,
    kpis: [
      { metric: 'BODY_WEIGHT', uom: 'KG', average_value: 28, lower_limit: 27 },
      { metric: 'ADG', uom: 'KG', average_value: 0.526, lower_limit: 0.505 },
    ],
  },
  {
    stage: 'REARING',
    periodFrom: 15,
    periodTo: 16,
    kpis: [
      { metric: 'BODY_WEIGHT', uom: 'KG', average_value: 68, lower_limit: 61 },
      { metric: 'ADG', uom: 'KG', average_value: 0.952, lower_limit: 0.81 },
    ],
  },
  {
    stage: 'REARING',
    periodFrom: 24,
    periodTo: 25,
    kpis: [
      {
        metric: 'BODY_WEIGHT',
        uom: 'KG',
        average_value: 130,
        lower_limit: 118,
      },
      { metric: 'ADG', uom: 'KG', average_value: 0.954, lower_limit: 0.877 },
    ],
  },
  {
    stage: 'REARING',
    periodFrom: 27,
    periodTo: 28,
    kpis: [
      {
        metric: 'BODY_WEIGHT',
        uom: 'KG',
        average_value: 150,
        lower_limit: 135,
      },
      { metric: 'ADG', uom: 'KG', average_value: 0.952, lower_limit: 0.81 },
    ],
  },
  {
    stage: 'FARROWING',
    periodFrom: 0,
    periodTo: 4,
    kpis: [
      { metric: 'SERVICE_TARGET', uom: 'HEAD', average_value: 49 },
      { metric: 'GILT_SERVICE_TARGET', uom: 'HEAD', average_value: 12 },
      {
        metric: 'SECOND_PARITY_SERVICE_TARGET',
        uom: 'HEAD',
        average_value: 10.28,
      },
      { metric: 'FARROWING_RATE', uom: 'PCT', average_value: 92 },
      { metric: 'TOTAL_BORN', uom: 'HEAD', average_value: 17.24 },
      { metric: 'BORN_ALIVE', uom: 'HEAD', average_value: 16.33 },
      { metric: 'BORN_DEAD', uom: 'HEAD', average_value: 0.5 },
      { metric: 'MUMMIFIED', uom: 'HEAD', average_value: 0.41 },
      { metric: 'PRE_WEAN_MORTALITY', uom: 'PCT', average_value: 6 },
      { metric: 'WEANING_WEIGHT', uom: 'KG', average_value: 8 },
      { metric: 'TOTAL_LITTER_MASS', uom: 'KG', average_value: 122.81 },
      { metric: 'WEAN_PER_SOW', uom: 'HEAD', average_value: 15.35 },
      { metric: 'GILT_BODY_LOSS', uom: 'PCT', lower_limit: 8, upper_limit: 12 },
      { metric: 'FARROWING_TARGET', uom: 'HEAD', average_value: 45.08 },
      { metric: 'ACTIVE_WEEK_MORTALITY', uom: 'HEAD', average_value: 0.25 },
    ],
  },
  {
    stage: 'WEANER',
    periodFrom: 4,
    periodTo: 10,
    kpis: [
      { metric: 'BODY_WEIGHT', uom: 'KG', average_value: 29 },
      { metric: 'ADG', uom: 'KG', average_value: 0.553 },
      { metric: 'FCR', uom: 'RATIO', average_value: 1.5 },
      { metric: 'MORTALITY_PCT', uom: 'PCT', average_value: 1 },
    ],
  },
  {
    stage: 'GROWER',
    periodFrom: 14,
    periodTo: 22,
    kpis: [
      { metric: 'ADG', uom: 'KG', average_value: 1.1 },
      { metric: 'FCR', uom: 'RATIO', average_value: 2.42 },
      { metric: 'MORTALITY_PCT', uom: 'PCT', average_value: 2 },
    ],
  },
];

/** Porta's animals are all TN70, so its standards are written for that line only. */
const PORTA_BREEDS = ['TN-70-SOW'];
/** The day Porta's five animals are placed: a week before the first service the sheet records (22 Apr 2026). */
export const PORTA_START = '2026-04-15';
/** Porta's template names no store; feed must be drawn from one when no silo holds it, so one is made (DEMO). */
const PORTA_STORE = { code: 'PST1', name: 'PORTA STORE (DEMO)' };
/** The feed each Porta silo holds, by the prefix of its name, read as MULTIPLIER's SILO_DIET is. */
const PORTA_SILO_DIET: Array<{ prefix: string; item: string }> = [
  { prefix: 'PG', item: 'Grower 1' },
  { prefix: 'PDST', item: 'Weaner O.T.C' },
  { prefix: 'PW', item: 'Weaner O.T.C' },
  { prefix: 'PDSD', item: 'Drysow' },
  { prefix: 'PDGD', item: 'Dry Gilt' },
  { prefix: 'PDS', item: 'Drysow' },
  { prefix: 'PDs', item: 'Drysow' },
  { prefix: 'PFH01', item: 'Drysow' },
  { prefix: 'PFHLG', item: 'Lactating Gilt' },
  { prefix: 'PFHTrans', item: 'Transition' },
  { prefix: 'PSL', item: 'Super Flush' },
];

async function ensurePortaFeedSources(
  companyId: string,
  farmId: string,
): Promise<void> {
  const existing = await existingLocationIds();
  let created = 0;
  const rejected: string[] = [];
  if (!existing.has(PORTA_STORE.code)) {
    const r = await call('POST', '/location', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      location_code: PORTA_STORE.code,
      location_name: PORTA_STORE.name,
      location_type: 'STORE',
      parent_location_id: farmId,
      location_address: 'KINTYRE ESTATE, NORTON',
      max_capacity: 0,
      capacity_uom: 'KG',
    });
    if (r.status >= 200 && r.status < 300) created += 1;
    else
      rejected.push(
        `${PORTA_STORE.code}: ${r.data?.error?.message ?? r.data?.message}`,
      );
  }
  for (const silo of PORTA_SILOS) {
    if (existing.has(silo.code)) continue;
    const r = await call('POST', '/location', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      location_code: silo.code,
      location_name: silo.code,
      location_type: 'SILO',
      parent_location_id: farmId,
      location_address: 'KINTYRE ESTATE, NORTON',
      silo_capacity_kg: silo.capacityKg,
      silo_capacity_uom: 'KG',
      silo_reorder_days: silo.reorderDays,
      low_level_kg: Math.round(silo.capacityKg * 0.2),
      high_level_kg: Math.round(silo.capacityKg * 0.9),
    });
    if (r.status >= 200 && r.status < 300) created += 1;
    else
      rejected.push(
        `${silo.code}: ${r.data?.error?.message ?? r.data?.message}`,
      );
  }
  console.log(
    `  PORTA feed sources: ${created} created (${PORTA_SILOS.length} silos and the store)`,
  );
  for (const line of rejected) console.log(`     rejected ${line}`);
}

async function ensurePortaResources(companyId: string): Promise<void> {
  const present = await existingCodes('resource_master', 'resource_code');
  let created = 0;
  const rejected: string[] = [];
  for (const {
    sourceRow: _row,
    next_service_date: _next,
    ...resource
  } of PORTA_RESOURCES) {
    if (present.has(resource.resource_code)) continue;
    let r = await call('POST', '/resource', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      ...resource,
    });
    // A capacity unit the UOM master does not carry (KVA, KW) is dropped rather than invented.
    if (!(r.status >= 200 && r.status < 300) && resource.capacity_uom) {
      const { capacity_uom: _uom, ...bare } = resource;
      r = await call('POST', '/resource', {
        company_id: companyId,
        nob_id: NOB_LIVESTOCK,
        lob_id: LOB_PIGGERY,
        ...bare,
      });
    }
    if (r.status >= 200 && r.status < 300) created += 1;
    else
      rejected.push(
        `${resource.resource_code}: ${r.data?.error?.message ?? r.data?.message}`,
      );
  }
  console.log(
    `  PORTA resources: ${created} created of ${PORTA_RESOURCES.length}`,
  );
  for (const line of rejected.slice(0, 5)) console.log(`     rejected ${line}`);
}

/**
 * Porta's five animals, in one breeding batch on PORTA_START, each at the stage that leads to the service the
 * sheet records. seed-triplec-history.ts plays them forward from there (their services, checks and litters).
 */
async function ensurePortaHerd(
  companyId: string,
  areaId: string,
): Promise<void> {
  const refs = await herdRefs();
  const db = await connection();
  let have: Set<string>;
  let batchExists = false;
  let portaStore: string | undefined;
  try {
    const [a] = await db.query<any[]>(
      'SELECT animal_code FROM animal_register',
    );
    have = new Set(a.map((r) => r.animal_code));
    const [b] = await db.query<any[]>(
      `SELECT batch_id FROM batch_header WHERE remarks = 'TRIPLEC-PORTA-BREEDING' AND deleted_at IS NULL`,
    );
    batchExists = b.length > 0;
    const [st] = await db.query<any[]>(
      'SELECT location_id FROM location_master WHERE location_code = ?',
      [PORTA_STORE.code],
    );
    portaStore = st[0]?.location_id;
  } finally {
    await db.end();
  }
  if (batchExists) {
    console.log('  PORTA herd: already placed');
    return;
  }
  const shedId = refs.locations.get('PDS1');
  const stageAtStart = (a: (typeof PORTA_ANIMALS)[number]) =>
    a.service.matingDate <= '2026-04-30'
      ? 'FLUSH'
      : a.animalType === 'SOW'
        ? 'PRODUCTIVE_SOW'
        : 'REARING';
  const ids: string[] = [];
  for (const a of PORTA_ANIMALS) {
    if (have.has(a.code)) continue;
    const item = a.animalType === 'SOW' ? 'BIO-SWINE-SOW' : 'BIO-SWINE-GILT';
    const imported = a.entryType === 'PURCHASED_IMPORTED';
    const receiptId = imported
      ? await postedReceipt(
          companyId,
          { ...refs, storeId: portaStore ?? refs.storeId },
          item,
          1,
          a.acquisitionCost,
          a.entryDate,
        )
      : undefined;
    const made = await post('/animal', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      animal_code: a.code,
      animal_type: a.animalType,
      breed_id: refs.breeds.get(a.breedCode),
      gender: 'F',
      dob: a.dob,
      entry_type: a.entryType,
      entry_date: a.entryDate,
      source_receipt_id: receiptId,
      acquisition_cost: imported ? undefined : a.acquisitionCost,
      item_id: refs.items.get(item),
      current_stage_id: refs.stages.get(stageAtStart(a)),
      current_location_id: shedId,
      no_of_teats: a.teats,
      tsi: a.tsi,
      grading: a.grading,
      dam_serial_no: a.damTag,
      rfid_tag: a.code,
    });
    const id = made?.animal_id ?? made?.data?.animal_id;
    if (id) ids.push(id);
    // The register's parity (5 for the two imported sows) is an edit, not part of the animal's creation.
    if (id && a.parity > 0)
      await call('PUT', `/animal/${id}`, { parity_count: a.parity });
  }
  const batch = await post('/batch', {
    company_id: companyId,
    lob_id: LOB_PIGGERY,
    operational_area_id: areaId,
    costing_method: 'BIO_ASSET',
    breed_id: refs.breeds.get('TN-70-SOW'),
    stage_id: refs.stages.get('PRODUCTIVE_SOW'),
    shed_id: shedId,
    start_date: PORTA_START,
    uom: 'HEAD',
    remarks: 'TRIPLEC-PORTA-BREEDING',
    tracking_mode: 'ANIMAL_WISE',
    animal_ids: ids,
  });
  const batchId = batch?.batch_id ?? batch?.data?.batch_id;
  if (batchId) await call('POST', `/batch/${batchId}/activate`, {});
  console.log(
    `  PORTA herd: ${ids.length} animals from the register placed in their breeding batch on ${PORTA_START}`,
  );
}

/** Item names compared without case, spaces or punctuation. */
const normaliseName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The six resources the client listed.
 *
 * Their template states a Resource Type on two rows only; the other four are
 * typed here from what they plainly are, on Rishi's 2026-10-24 reading. Cost
 * Per Unit and Cost UOM are mandatory on the template and empty on every row,
 * so these carry no rate — a resource without one contributes nothing to
 * costing, and inventing farm rates is not ours to do.
 */
const RESOURCES = [
  {
    resource_code: 'RES-WATERPUMP',
    resource_name: 'Water pump',
    resource_type: 'EQUIPMENT',
    capacity: 2,
    capacity_uom: 'HP',
    employee_id: 'WP-01',
    department: 'Farm Operations',
  },
  {
    resource_code: 'RES-HEATERS',
    resource_name: 'Heaters',
    resource_type: 'EQUIPMENT',
    capacity: 6,
    department: 'Farm Operations',
  },
  {
    resource_code: 'RES-COOLERS',
    resource_name: 'Coolers',
    resource_type: 'EQUIPMENT',
    capacity: 6,
  },
  // The endpoint accepts MANPOWER and EQUIPMENT only — VEHICLE is in the
  // client's template and in verify-demo-master-integrity.ts, but not in the
  // service's own list, so the tractor is farm equipment here.
  {
    resource_code: 'RES-TRACTOR',
    resource_name: 'Tractor',
    resource_type: 'EQUIPMENT',
    capacity: 1,
  },
  {
    resource_code: 'RES-SCALES',
    resource_name: 'Scales',
    resource_type: 'EQUIPMENT',
    capacity: 2,
  },
  {
    resource_code: 'RES-MANPOWER',
    resource_name: 'Manpower',
    resource_type: 'MANPOWER',
    capacity: 35,
  },
];

async function ensureResources(companyId: string): Promise<void> {
  const present = await existingCodes('resource_master', 'resource_code');
  let created = 0;
  const rejected: string[] = [];
  for (const resource of RESOURCES) {
    if (present.has(resource.resource_code)) continue;
    const r = await call('POST', '/resource', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      ...resource,
    });
    if (r.status >= 200 && r.status < 300) created += 1;
    else
      rejected.push(
        `${resource.resource_name}: ${r.data?.error?.message ?? r.data?.message ?? JSON.stringify(r.data)}`,
      );
  }
  console.log(
    `  resources: ${created} created of ${RESOURCES.length} — none carries a cost rate, the template left those empty`,
  );
  for (const line of rejected) console.log(`     rejected ${line}`);
}

/**
 * Item types. Signup seeds UOMs and species but not these, so the tenant has
 * none and every item is refused with "Item Type not found". The whole
 * platform set is created: nothing in it is wrong for a piggery, and the
 * client will want more than feed and medicine soon enough.
 */
async function ensureItemTypes(companyId: string): Promise<void> {
  const present = await existingCodes('item_type_master', 'type_code');
  let created = 0;
  for (const type of SYSTEM_ITEM_TYPE_SEED) {
    if (present.has(type.type_code)) continue;
    await post('/item-type', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      type_code: type.type_code,
      type_name: type.type_name,
      code_prefix: (type as any).code_prefix ?? type.type_code,
      description: (type as any).description,
    });
    created += 1;
  }
  console.log(
    `  item types: ${created} created, ${present.size} already present`,
  );
}

/**
 * The item catalogue: the client's 98 feed and medicine items, and the five
 * living-asset items an animal cannot be registered without.
 *
 * Categories go first because an item points at one, and a category declares
 * the item type it belongs to.
 */
async function ensureItems(companyId: string): Promise<void> {
  const categoryIds = new Map<string, string>();
  const db = await connection();
  try {
    const [rows] = await db.query<any[]>(
      'SELECT category_id, category_name FROM item_category_master WHERE deleted_at IS NULL',
    );
    for (const row of rows) categoryIds.set(row.category_name, row.category_id);
  } finally {
    await db.end();
  }
  let categoriesCreated = 0;
  for (const category of MULTIPLIER_ITEM_CATEGORIES) {
    if (categoryIds.has(category.name)) continue;
    const made = await post('/item-category', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      category_name: category.name,
      item_type: category.itemType,
    });
    const id = made?.category_id ?? made?.data?.category_id;
    if (id) categoryIds.set(category.name, id);
    categoriesCreated += 1;
  }
  console.log(
    `  item categories: ${categoriesCreated} created, ${MULTIPLIER_ITEM_CATEGORIES.length - categoriesCreated} already present`,
  );

  // A lot- or serial-tracked item must name the series its numbers come from.
  // The template leaves that column empty on all 98 rows, so the company's own
  // ITEM_LOT and ITEM_SERIAL series are used — they exist because every master
  // got its series earlier in this run. Lot wins where an item is both, which
  // is how the client's "LOT AND SERIAL" reads: the lot is the consignment and
  // the serial sits inside it.
  const seriesIds = new Map<string, string>();
  const seriesDb = await connection();
  try {
    const [rows] = await seriesDb.query<any[]>(
      `SELECT code, id FROM no_series WHERE company_id IS NOT NULL AND code IN ('ITEM_LOT','ITEM_SERIAL')`,
    );
    for (const row of rows) seriesIds.set(row.code, row.id);
  } finally {
    await seriesDb.end();
  }

  const present = await existingCodes('item_master', 'item_code');
  let created = 0;
  const rejected: string[] = [];
  for (const item of MULTIPLIER_ITEMS) {
    if (present.has(item.code)) continue;
    const r = await call('POST', '/item', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      item_code: item.code,
      item_name: item.name,
      item_type: item.type,
      category_id: categoryIds.get(item.category),
      uom_primary: item.uom,
      uom_secondary: item.uomSecondary,
      valuation_method: item.valuation,
      standard_cost: item.standardCost,
      is_lot_tracked: item.lotTracked,
      is_serial_tracked: item.serialTracked,
      tracking_series_id: item.lotTracked
        ? seriesIds.get('ITEM_LOT')
        : item.serialTracked
          ? seriesIds.get('ITEM_SERIAL')
          : undefined,
      is_biological_asset: item.bio,
      shelf_life_days: item.shelfLifeDays,
      withdrawal_days: item.withdrawalDays,
      feed_form: item.feedForm,
      min_stock_level: item.minStock,
      reorder_level: item.reorderLevel,
    });
    if (r.status >= 200 && r.status < 300) created += 1;
    else
      rejected.push(
        `${item.code} ${item.name}: ${r.data?.error?.message ?? r.data?.message ?? JSON.stringify(r.data)}`,
      );
  }
  // Bulk feed cannot be serial tracked. Triple C's Item Master marks 76 of its
  // 98 lines "LOT AND SERIAL", and a serial is one number per unit — a receipt
  // of 4,640 kg of Grower 1 would need 4,640 of them, so the GRN is refused
  // outright. Feed keeps its lot tracking, which is how a consignment of feed
  // is actually traced, and loses the serial. Medicines and living assets are
  // untouched. Worth putting back to Triple C: their template says serial.
  const serialDb = await connection();
  try {
    await serialDb.query(
      `UPDATE item_master SET is_serial_tracked = 0 WHERE item_type = 'FEED' AND is_serial_tracked = 1`,
    );
  } finally {
    await serialDb.end();
  }

  // Items created before feed_form existed are brought up to date, or a BIN
  // diet assignment refuses them for having no Bulk/Bagged type.
  let formed = 0;
  const db2 = await connection();
  try {
    const [rows] = await db2.query<any[]>(
      `SELECT item_id, item_code FROM item_master WHERE item_type = 'FEED' AND feed_form IS NULL AND deleted_at IS NULL`,
    );
    for (const row of rows) {
      const item = MULTIPLIER_ITEMS.find((i) => i.code === row.item_code);
      if (!item?.feedForm) continue;
      await db2.query(
        'UPDATE item_master SET feed_form = ? WHERE item_id = ?',
        [item.feedForm, row.item_id],
      );
      formed += 1;
    }
  } finally {
    await db2.end();
  }
  if (formed) console.log(`  feed form set on ${formed} existing feed items`);

  console.log(
    `  items: ${created} created of ${MULTIPLIER_ITEMS.length} (${MULTIPLIER_ITEMS.filter((i) => i.sourceRow).length} from the template, ${MULTIPLIER_ITEMS.filter((i) => !i.sourceRow).length} living assets)`,
  );
  for (const line of rejected.slice(0, 12))
    console.log(`     rejected ${line}`);
  if (rejected.length > 12)
    console.log(`     ... and ${rejected.length - 12} more`);
}

async function ensureStages(companyId: string): Promise<void> {
  const wanted = [
    ...BBP_STAGE_SEED.map((stage) => {
      const rename = STAGE_RENAMES[stage.stage_code];
      return rename
        ? { ...stage, stage_code: rename.code, stage_name: rename.name }
        : stage;
    }),
    ...EXTRA_STAGES,
  ];
  const present = await existingCodes('stage_master', 'stage_code');
  let created = 0;
  for (const stage of wanted) {
    if (present.has(stage.stage_code)) continue;
    await post('/stage', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      stage_code: stage.stage_code,
      stage_name: stage.stage_name,
      stage_category: stage.stage_category,
      stage_sequence: stage.stage_sequence,
      typical_duration_days: (stage as any).typical_duration_days,
      min_days_before_move: (stage as any).min_days_before_move ?? 0,
      // The platform seeds five of these as EVENT_BASED, but the stage endpoint
      // refuses an event-driven stage without an alternate next stage and a
      // trigger condition, and no submitted file names either. They are created
      // as MANUAL so the move is the user's — which is what a showcase does
      // anyway — rather than inventing a branch rule for the client's herd.
      transition_trigger:
        stage.transition_trigger === 'MANUAL' ? 'MANUAL' : 'MANUAL',
      stage_description: stage.stage_description,
    });
    created += 1;
  }
  console.log(`  stages: ${created} created, ${present.size} already present`);

  // Each stage's next stage, as the platform's BBP seed gives it (renames
  // followed). Without it the Feed Forecast can name no next diet ("No Next
  // Stage set for stage ...") and the stage strip has nowhere to point.
  const db = await connection();
  let ids: Map<string, { id: string; next: string | null }>;
  try {
    const [rows] = await db.query<any[]>(
      'SELECT stage_code, stage_id, next_stage_id FROM stage_master WHERE deleted_at IS NULL',
    );
    ids = new Map(
      rows.map((r) => [
        r.stage_code,
        { id: r.stage_id, next: r.next_stage_id },
      ]),
    );
  } finally {
    await db.end();
  }
  const codeOf = (code: string) => STAGE_RENAMES[code]?.code ?? code;
  let linked = 0;
  for (const stage of wanted as Array<{
    stage_code: string;
    next_stage_code?: string;
  }>) {
    const self = ids.get(stage.stage_code);
    const next = stage.next_stage_code
      ? ids.get(codeOf(stage.next_stage_code))
      : undefined;
    if (!self || !next || self.next === next.id) continue;
    const r = await call('PUT', `/stage/${self.id}`, {
      next_stage_id: next.id,
    });
    if (r.status >= 200 && r.status < 300) linked += 1;
    else
      console.log(
        `     next stage of ${stage.stage_code}: ${r.data?.error?.message ?? r.data?.message}`,
      );
  }
  console.log(`  stage flow: ${linked} next stages set from the BBP seed`);
}

async function ensureBreeds(companyId: string): Promise<void> {
  await post(
    '/species',
    {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      species_code: SPECIES.species_code,
      species_name: SPECIES.species_name,
    },
    alreadyExists,
  );
  const present = await existingCodes('breed_master', 'breed_code');
  let created = 0;
  for (const breed of BREEDS) {
    if (present.has(breed.breed_code)) continue;
    await post('/breed', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      species: SPECIES.species_name,
      ...breed,
    });
    created += 1;
  }
  console.log(
    `  breeds: ${created} created, ${BREEDS.length - created} already present (species ${SPECIES.species_name})`,
  );
}

/**
 * The silos and the store the estate's pens are fed from.
 *
 * The location template names them in its SILO/STORE columns on nearly every
 * row but never gives them a row of their own, so they are derived here: each
 * distinct name, typed by the column that referenced it, hung off the farm.
 * Nothing is invented — no name is ever referenced as two different types.
 *
 * They are not optional decoration: a goods receipt's warehouse must be a
 * STORE, SILO or BIN, so without them no animal can be purchased.
 */
async function ensureFeedSources(
  companyId: string,
  farmId: string,
): Promise<void> {
  const byName = new Map<string, string>();
  for (const row of MULTIPLIER_LOCATIONS) {
    for (const name of [row.storageName, row.storageName2]) {
      if (name && row.storageType && !byName.has(name))
        byName.set(name, row.storageType);
    }
  }
  const existing = await existingLocationIds();
  let created = 0;
  const deferred: string[] = [];
  const rejected: string[] = [];

  for (const [name, type] of byName) {
    if (existing.has(name)) continue;
    if (type === 'SILO') {
      const silo = MULTIPLIER_SILOS.find((row) => row.code === name);
      if (!silo) {
        deferred.push(name);
        continue;
      }
      const made = await call('POST', '/location', {
        company_id: companyId,
        nob_id: NOB_LIVESTOCK,
        lob_id: LOB_PIGGERY,
        location_code: name,
        location_name: name,
        location_type: 'SILO',
        parent_location_id: farmId,
        location_address: 'GRASMERE FARM NORTON',
        silo_capacity_kg: silo.capacityKg,
        silo_capacity_uom: 'KG',
        // Every row of the template that states one says 2.
        silo_reorder_days: 2,
        // A silo also wants the two alert levels. The low one is their own
        // reorder point expressed in kg: capacity is ten days of cover and
        // they reorder at two days, so twenty per cent. The high one is the
        // overfill warning, just under full.
        low_level_kg: Math.round(silo.capacityKg * 0.2),
        high_level_kg: Math.round(silo.capacityKg * 0.9),
      });
      if (made.status >= 200 && made.status < 300) created += 1;
      else
        rejected.push(
          `${name}: ${made.data?.error?.message ?? made.data?.message ?? JSON.stringify(made.data)}`,
        );
      continue;
    }
    // A STORE must carry a capacity and its unit. The template never states
    // one for MST1 — it only ever names it as the source of bagged feed — so
    // it is recorded as zero KG, meaning "not stated", rather than given a
    // number nobody supplied. Nothing checks a store's capacity, and it has no
    // children for the child-fits-in-parent rule to measure.
    const r = await call('POST', '/location', {
      company_id: companyId,
      nob_id: NOB_LIVESTOCK,
      lob_id: LOB_PIGGERY,
      location_code: name,
      location_name: name,
      location_type: type,
      parent_location_id: farmId,
      location_address: 'GRASMERE FARM NORTON',
      max_capacity: 0,
      capacity_uom: 'KG',
    });
    if (r.status >= 200 && r.status < 300) created += 1;
    else
      rejected.push(
        `${name}: ${r.data?.error?.message ?? r.data?.message ?? JSON.stringify(r.data)}`,
      );
  }
  const derived = MULTIPLIER_SILOS.filter((row) => row.derived).length;
  console.log(
    `  feed sources: ${created} created of ${byName.size} (${MULTIPLIER_SILOS.length} silos, ${derived} of them sized by us at ten days of cover)`,
  );
  if (deferred.length)
    console.log(`     ${deferred.length} deferred: ${deferred.join(', ')}`);
  for (const line of rejected) console.log(`     rejected ${line}`);
}

/**
 * Empty the starter master data. Transactional: either the showcase starts
 * blank or nothing is deleted, so a foreign key we did not anticipate leaves
 * the tenant usable instead of half-cleared.
 */
async function clearStarterMasters(): Promise<void> {
  const db = await connection();
  try {
    // Only ever runs on a tenant still as signup left it. Once the estate is
    // loaded the starter rows are long gone and the tables hold the client's
    // own data — re-running the delete would take the UOMs the items and
    // locations are measured in with it.
    const [[built]] = await db.query<any[]>(
      'SELECT COUNT(*) n FROM location_master WHERE deleted_at IS NULL',
    );
    if (Number(built.n) > 0) {
      console.log(
        '  starter masters: already cleared — the tenant carries its own data now',
      );
      return;
    }
    await db.beginTransaction();
    // stage_master points at itself through next_stage_id / alt_next_stage_id,
    // so the chain has to be broken before its rows can go.
    await db.query(
      `UPDATE stage_master SET next_stage_id = NULL, alt_next_stage_id = NULL`,
    );
    for (const table of STARTER_MASTERS) {
      const [result] = await db.query<any>(`DELETE FROM \`${table}\``);
      if (result.affectedRows > 0)
        console.log(
          `  ${table}: ${result.affectedRows} starter row(s) removed`,
        );
    }
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw new Error(
      `Could not empty the starter masters (nothing was deleted): ${(error as Error).message}`,
    );
  } finally {
    await db.end();
  }
}

/** Read the result back out of MySQL rather than trusting the responses above. */
async function report(): Promise<void> {
  const db = await connection();
  try {
    const one = async (sql: string) =>
      Number((await db.query<any>(sql))[0][0].n);
    const series = await db.query<any>(
      `SELECT COUNT(*) n, SUM(company_id IS NULL) tenant_level, SUM(company_id IS NOT NULL) company_level, SUM(current_seq > 0) used FROM no_series`,
    );
    // Once the estate is loaded these tables hold the client's own data, so
    // counting rows in them says nothing about leftover starter rows.
    const [[built]] = await db.query<any[]>(
      'SELECT COUNT(*) n FROM location_master WHERE deleted_at IS NULL',
    );
    const loaded = Number(built.n) > 0;
    const remaining: string[] = [];
    for (const table of loaded ? [] : STARTER_MASTERS) {
      // uom_master is deliberately repopulated below with the company's own
      // units, so it is no longer evidence of leftover starter data.
      if (table === 'uom_master') continue;
      const n = await one(`SELECT COUNT(*) n FROM \`${table}\``);
      if (n > 0) remaining.push(`${table}=${n}`);
    }
    const byType = await db.query<any[]>(
      `SELECT location_type, COUNT(*) n FROM location_master WHERE deleted_at IS NULL GROUP BY location_type ORDER BY n DESC`,
    );
    console.log('');
    console.log('Triple C showcase, read back from MySQL');
    console.log('=======================================');
    console.log(`  database            ${tenantDatabaseName(TENANT_CODE)}`);
    console.log(
      `  companies           ${await one('SELECT COUNT(*) n FROM company_master')}`,
    );
    console.log(
      `  operational areas   ${await one('SELECT COUNT(*) n FROM operational_area_master')}`,
    );
    console.log(
      `  users               ${await one('SELECT COUNT(*) n FROM user_master')}`,
    );
    console.log(
      `  number series       ${series[0][0].n} (${series[0][0].tenant_level} tenant templates, ${series[0][0].company_level} owned by the company, ${series[0][0].used} already used)`,
    );
    if (!loaded)
      console.log(
        `  starter masters     ${remaining.length === 0 ? 'empty' : `STILL POPULATED: ${remaining.join(', ')}`}`,
      );
    console.log(
      `  stages / breeds     ${await one('SELECT COUNT(*) n FROM stage_master')} / ${await one('SELECT COUNT(*) n FROM breed_master WHERE deleted_at IS NULL')}`,
    );
    console.log(
      `  items / resources   ${await one('SELECT COUNT(*) n FROM item_master WHERE deleted_at IS NULL')} / ${await one('SELECT COUNT(*) n FROM resource_master WHERE deleted_at IS NULL')}`,
    );
    console.log(
      `  lifecycle standards ${await one('SELECT COUNT(*) n FROM breed_lifecycle_stages WHERE retired_at IS NULL')}`,
    );
    console.log(
      `  location types      ${await one('SELECT COUNT(*) n FROM location_type_master')}`,
    );
    console.log(
      `  units of measure    ${await one('SELECT COUNT(*) n FROM uom_master')}`,
    );
    console.log(
      `  locations           ${await one('SELECT COUNT(*) n FROM location_master WHERE deleted_at IS NULL')} of ${MULTIPLIER_LOCATIONS.length} submitted`,
    );
    for (const row of byType[0])
      console.log(`    ${String(row.location_type).padEnd(16)} ${row.n}`);
    console.log('');
    console.log(`Every user's password is ${PASSWORD}:`);
    const [accounts] = await db.query<any[]>(
      `SELECT email, user_type FROM user_master WHERE deleted_at IS NULL`,
    );
    const live = new Set(accounts.map((row) => row.email));
    for (const user of USERS) {
      const state = live.has(user.email)
        ? user.scope
        : 'NOT CREATED — needs a farm first';
      console.log(
        `  ${user.user_type.padEnd(18)} ${user.email.padEnd(26)} ${state}`,
      );
    }
  } finally {
    await db.end();
  }
}

function printPlan(): void {
  console.log(`Triple C showcase seed (plan only — add --apply to run it)`);
  console.log(`API: ${API}`);
  console.log('');
  for (const [index, step] of PLAN.entries())
    console.log(`  ${index + 1}. ${step}`);
  console.log('');
  console.log(
    'Re-running is safe: existing rows are left alone, never duplicated.',
  );
}

/**
 * `--recreate`: remove the tenant entirely before provisioning it again — its
 * database dropped and its rows in the master registry deleted — the same
 * things TenantService.remove() deletes, plus the login index, so the signup
 * that follows starts from nothing. Scoped to this one tenant code; the
 * platform tenant is refused.
 */
async function dropTenant(): Promise<void> {
  if (TENANT_CODE === 'system')
    throw new Error('Refusing to drop the platform administration tenant.');
  const master = await mysql.createConnection({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: process.env.DATABASE_NAME || 'nf_master',
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
        : undefined,
  });
  try {
    const [rows] = await master.query<any[]>(
      'SELECT tenant_id, db_name FROM tenant_master WHERE tenant_code = ?',
      [TENANT_CODE],
    );
    const dbName = rows[0]?.db_name || tenantDatabaseName(TENANT_CODE);
    await master.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    if (rows[0]) {
      const id = rows[0].tenant_id;
      await master.query('DELETE FROM user_auth_index WHERE tenant_id = ?', [
        id,
      ]);
      await master.query(
        'DELETE FROM tenant_subscription WHERE tenant_id = ?',
        [id],
      );
      await master.query('DELETE FROM audit_log WHERE tenant_id = ?', [id]);
      await master.query('DELETE FROM tenant_master WHERE tenant_id = ?', [id]);
    }
    // Logins left over from an earlier run under another tenant id would send these emails nowhere.
    await master.query(
      `DELETE FROM user_auth_index WHERE email IN (${USERS.map(() => '?').join(',')})`,
      USERS.map((u) => u.email),
    );
    console.log(
      `  tenant ${TENANT_CODE} dropped (${dbName}${rows[0] ? '' : ', was not registered'})`,
    );
  } finally {
    await master.end();
  }
}

async function apply(): Promise<void> {
  console.log(`Triple C showcase seed against ${API}`);
  if (process.argv.includes('--recreate')) await dropTenant();
  await ensureTenant();
  const { tenantId } = await login();
  const companyId = await ensureCompany(tenantId);
  const areaId = await ensureArea(companyId);
  await ensureUsers(tenantId, companyId, areaId);
  await ensureSeries(tenantId, companyId);
  // Clear first: signup's starter masters go before the client's own data is
  // built on top, or the UOMs created below would be deleted again.
  await clearStarterMasters();
  await loginAsCompanyAdmin();
  await ensureLocationTypes(companyId);
  await ensureUoms(companyId);
  await ensureLocations(companyId);
  await ensureLocations(companyId, PORTA_LOCATIONS, 'PORTA');
  // The standard user needs a farm to be scoped to, which only exists now.
  await login();
  await ensureUsers(tenantId, companyId, areaId);
  await loginAsCompanyAdmin();
  await ensureStages(companyId);
  await ensureBreeds(companyId);
  const farmId = (await existingLocationIds()).get('MUL100');
  if (!farmId)
    throw new Error(
      'The MULTIPLIER farm was not created, so its silos have no parent.',
    );
  await ensureFeedSources(companyId, farmId);
  const portaFarmId = (await existingLocationIds()).get('POR100');
  if (!portaFarmId) throw new Error('The PORTA farm was not created.');
  await ensurePortaFeedSources(companyId, portaFarmId);
  await ensureItemTypes(companyId);
  await ensureItems(companyId);
  await ensureGlAccounts(companyId);
  await ensureActivities(tenantId);
  await ensureResources(companyId);
  await ensurePortaResources(companyId);
  await ensureReasons(companyId);
  await ensureReportingPeriods(companyId);
  await ensureLifecycle(companyId, farmId);
  await ensureLifecycle(
    companyId,
    portaFarmId,
    PORTA_BREEDS,
    PORTA_LIFECYCLE_FIGURES,
  );
  await ensureKpis(companyId);
  await ensureKpis(companyId, 'POR100', PORTA_KPIS, PORTA_BREEDS, false);
  // Every standard is complete before the first batch exists, because a
  // batch's schedulers are built from them when it activates and never again.
  await resolveLifecycleFeeds();
  await ensureFeedStandards(companyId, farmId);
  await ensureFeedStandards(companyId, portaFarmId, PORTA_BREEDS);
  await ensureHerd(companyId, areaId);
  await ensurePortaHerd(companyId, areaId);
  await ensureFeedStock(companyId, await herdRefs());
  await ensureFeedTransfers(companyId, await herdRefs());
  await spreadAndActivateBatches();
  await report();
}

if (process.argv.includes('--apply')) {
  void apply().catch((error: unknown) => {
    console.error(
      `\nFAILED: ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  });
} else {
  printPlan();
}
