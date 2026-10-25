/**
 * Give a provisioned Triple C showcase tenant (seed-triplec.ts) a believable
 * breeding history, through the live API so every record takes the app's own
 * write path: matings, pregnancy checks, farrowings and weanings.
 *
 * Each sow gets one finished cycle about ten months back (served, confirmed,
 * farrowed, weaned), then a current one that agrees with the stage she stands
 * in today: INSEMINATION = served in the last three weeks, GESTATION =
 * confirmed in pig, FARROWING = farrowed in the last few days, LACTATION =
 * nursing a two-to-three-week-old litter. Gilts in INSEMINATION or GESTATION
 * get their first service. Litter sizes sit around MULTIPLIER's KPI sheet
 * (total born 16, born alive 15, weaned 13.8, wean weight 7.5 kg).
 *
 * Idempotent: an animal that already has a breeding record is left alone.
 *
 *   TRIPLEC_TENANT_CODE=ccc TRIPLEC_EMAIL_DOMAIN=ccc.com \
 *     node --env-file-if-exists=.env --import tsx src/scripts/seed-triplec-activity.ts --apply
 */

import * as mysql from 'mysql2/promise';
import { tenantDatabaseName } from '../core/database/database-names';

const API = (process.env.NAVFARM_API_URL || 'http://localhost:2877/api/v1').replace(/\/$/, '');
const TENANT_CODE = process.env.TRIPLEC_TENANT_CODE || 'triplec';
const EMAIL_DOMAIN = process.env.TRIPLEC_EMAIL_DOMAIN || 'ccc.local';
const PASSWORD = '12345678';
const GESTATION_DAYS = 115;

let token = '';

async function call(method: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    // leave as text
  }
  return { status: res.status, data };
}

const ok = (r: { status: number }) => r.status >= 200 && r.status < 300;
const message = (r: { data: any }) => r.data?.error?.message ?? r.data?.message ?? JSON.stringify(r.data);
const unwrap = (r: { data: any }) => r.data?.data ?? r.data;

function connection() {
  return mysql.createConnection({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: tenantDatabaseName(TENANT_CODE),
    ssl: process.env.DATABASE_SSL === 'true' ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } : undefined,
  });
}

/** A repeatable 0..1 draw per animal and purpose, so a re-run plans the same history. */
function draw(key: string): number {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
const between = (key: string, lo: number, hi: number) => lo + Math.floor(draw(key) * (hi - lo + 1));

const TODAY = new Date(new Date().toISOString().slice(0, 10));
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86400000).toISOString().slice(0, 10);
const plus = (date: string, n: number) => new Date(new Date(date).getTime() + n * 86400000).toISOString().slice(0, 10);

type Animal = { animal_id: string; animal_code: string; animal_type: string; stage_code: string | null; batch_id: string };

function litter(code: string) {
  const total = between(`${code}:tb`, 14, 18);
  const still = between(`${code}:sb`, 0, 1);
  const mummified = draw(`${code}:mm`) < 0.3 ? 1 : 0;
  const live = total - still - mummified;
  const avg = 1.15 + Math.round(draw(`${code}:bw`) * 25) / 100;
  return { live, still, mummified, avg, totalWeight: Math.round(live * avg * 100) / 100 };
}

async function mate(a: Animal, date: string, checkResult: 'CONFIRMED' | null): Promise<string | null> {
  const r = await call('POST', '/piggery/breeding/mating', {
    sow_animal_id: a.animal_id,
    batch_id: a.batch_id,
    mating_type: 'AI',
    mating_date: date,
    expected_farrowing_date: plus(date, GESTATION_DAYS),
  });
  if (!ok(r)) throw new Error(`mating ${a.animal_code} ${date}: ${message(r)}`);
  const id = unwrap(r).breeding_id;
  if (checkResult) {
    const c = await call('PATCH', `/piggery/breeding/mating/${id}/preg-check`, {
      preg_check_date: plus(date, 28),
      preg_check_method: 'ULTRASOUND',
      pregnancy_confirmed: true,
      conception_result: checkResult,
    });
    if (!ok(c)) throw new Error(`preg check ${a.animal_code}: ${message(c)}`);
  }
  return id;
}

async function farrow(a: Animal, breedingId: string, date: string, key: string): Promise<{ id: string; live: number }> {
  const l = litter(key);
  const r = await call('POST', '/piggery/breeding/farrowing', {
    sow_animal_id: a.animal_id,
    breeding_id: breedingId,
    batch_id: a.batch_id,
    farrowing_date: date,
    piglets_born_live: l.live,
    piglets_stillborn: l.still,
    piglets_mummified: l.mummified,
    avg_birth_weight_kg: l.avg,
    total_litter_weight_kg: l.totalWeight,
    farrowing_status: 'NORMAL',
  });
  if (!ok(r)) throw new Error(`farrowing ${a.animal_code} ${date}: ${message(r)}`);
  return { id: unwrap(r).farrow_id, live: l.live };
}

async function wean(a: Animal, farrowId: string, live: number, date: string, key: string): Promise<void> {
  const weaned = Math.max(1, live - between(`${key}:pw`, 0, 2));
  const r = await call('PATCH', `/piggery/breeding/farrowing/${farrowId}/weaning`, {
    weaning_date: date,
    piglets_weaned: weaned,
    avg_weaning_weight_kg: 7 + Math.round(draw(`${key}:ww`) * 100) / 100,
  });
  if (!ok(r)) throw new Error(`weaning ${a.animal_code} ${date}: ${message(r)}`);
}

async function history(a: Animal): Promise<void> {
  const code = a.animal_code;
  const isSow = a.animal_type === 'SOW';
  if (isSow) {
    // The finished cycle: served ten months back, weaned well before today's service.
    const served = daysAgo(between(`${code}:p0`, 285, 305));
    const id = await mate(a, served, 'CONFIRMED');
    const f = await farrow(a, id!, plus(served, GESTATION_DAYS), `${code}:c0`);
    await wean(a, f.id, f.live, plus(served, GESTATION_DAYS + between(`${code}:wd`, 24, 28)), `${code}:c0`);
  }
  switch (a.stage_code) {
    case 'INSEMINATION':
      await mate(a, daysAgo(between(`${code}:i`, 3, 20)), null);
      break;
    case 'GESTATION':
      await mate(a, daysAgo(between(`${code}:g`, 35, 95)), 'CONFIRMED');
      break;
    case 'FARROWING':
    case 'LACTATION': {
      if (!isSow) break;
      const age = a.stage_code === 'FARROWING' ? between(`${code}:f`, 1, 4) : between(`${code}:l`, 10, 20);
      const served = daysAgo(GESTATION_DAYS + age);
      const id = await mate(a, served, 'CONFIRMED');
      await farrow(a, id!, plus(served, GESTATION_DAYS), `${code}:c1`);
      break;
    }
    default:
      break;
  }
}

/**
 * Masters no submitted sheet covers, so their screens are not empty in the
 * showcase. Demo rows, named as such; Triple C replaces them with their own.
 */
const DEMO_SUPPLIERS = [
  { supplier_code: 'SUP-FEED', supplier_name: 'Demo Feed Supplier', phone: '0100000001', payment_terms: '30 days', city: 'Harare' },
  { supplier_code: 'SUP-VET', supplier_name: 'Demo Veterinary Supplies', phone: '0100000002', payment_terms: '30 days', city: 'Harare' },
  { supplier_code: 'SUP-GENETICS', supplier_name: 'Demo Genetics Supplier', phone: '0100000003', payment_terms: '60 days', city: 'Bulawayo' },
];
const DEMO_CUSTOMERS = [
  { customer_code: 'CUS-ABATTOIR', customer_name: 'Demo Abattoir', mobile: '0200000001', credit_limit: 500000, city: 'Harare' },
  { customer_code: 'CUS-PROCESSOR', customer_name: 'Demo Meat Processor', mobile: '0200000002', credit_limit: 250000, city: 'Bulawayo' },
];
const DEMO_DISEASES = [
  { disease_code: 'PRRS', disease_name: 'Porcine Reproductive and Respiratory Syndrome', scientific_name: 'Betaarterivirus suid', symptoms: 'Abortions, weak piglets, respiratory distress', treatment_guideline: 'Vaccinate the herd; isolate affected pigs; vet to advise' },
  { disease_code: 'PED', disease_name: 'Porcine Epidemic Diarrhoea', scientific_name: 'Alphacoronavirus', symptoms: 'Watery diarrhoea and vomiting in piglets', treatment_guideline: 'Biosecurity, rehydration, feedback to sows' },
  { disease_code: 'MYCO', disease_name: 'Enzootic Pneumonia', scientific_name: 'Mycoplasma hyopneumoniae', symptoms: 'Dry cough, slow growth', treatment_guideline: 'Vaccinate piglets; tiamulin or tetracycline on vet advice' },
  { disease_code: 'ERY', disease_name: 'Erysipelas', scientific_name: 'Erysipelothrix rhusiopathiae', symptoms: 'Diamond skin lesions, fever, lameness', treatment_guideline: 'Penicillin; vaccinate breeding stock' },
  { disease_code: 'MMA', disease_name: 'Mastitis-Metritis-Agalactia', symptoms: 'Sow fever and no milk after farrowing', treatment_guideline: 'Oxytocin and antibiotics on vet advice' },
];
const DEMO_ALERT_RULES = [
  { notification_code: 'FEED-BELOW-L1', notification_name: 'Silo below low level', event_type: 'FEED_BELOW_L1', trigger_entity: 'SILO', threshold_reference: 'SILO_BELOW', priority_level: 'CRITICAL', recipient_roles: ['MANAGER', 'MILL_MANAGER'], delivery_channel: 'IN_APP', frequency: 'DAILY' },
  { notification_code: 'FEED-ABOVE', notification_name: 'Silo above high level', event_type: 'FEED_ABOVE', trigger_entity: 'SILO', threshold_reference: 'SILO_ABOVE', priority_level: 'WARNING', recipient_roles: ['MILL_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE' },
  { notification_code: 'REQ-DEADLINE', notification_name: 'Requisition deadline approaching', event_type: 'REQ_DEADLINE', trigger_entity: 'REQUISITION', threshold_reference: 'FIXED_VALUE', threshold_value: 2, priority_level: 'WARNING', recipient_roles: ['MANAGER'], delivery_channel: 'IN_APP', frequency: 'DAILY' },
  { notification_code: 'DIET-CHANGE', notification_name: 'Diet change coming up', event_type: 'DIET_CHANGE', trigger_entity: 'FEED_PLAN', threshold_reference: 'FIXED_VALUE', threshold_value: 3, priority_level: 'INFO', recipient_roles: ['MANAGER', 'MILL_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE' },
  { notification_code: 'NO-NEXT-FEED', notification_name: 'Batch has no next feed row', event_type: 'NO_NEXT_FEED_ROW', trigger_entity: 'BATCH', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'CRITICAL', recipient_roles: ['MANAGER'], delivery_channel: 'IN_APP', frequency: 'ON_EACH_OCCURRENCE' },
];

async function ensureDemoMasters(): Promise<void> {
  const db = await connection();
  const codes = async (table: string, column: string) =>
    new Set(((await db.query<any[]>(`SELECT ${column} c FROM ${table}`))[0] as any[]).map((r) => String(r.c).toUpperCase()));
  const sets: Array<[string, string, string, Array<Record<string, unknown>>]> = [
    ['/supplier', 'supplier_master', 'supplier_code', DEMO_SUPPLIERS],
    ['/customer', 'customer_master', 'customer_code', DEMO_CUSTOMERS],
    ['/disease', 'disease_master', 'disease_code', DEMO_DISEASES],
    ['/alert-rule', 'alert_rule', 'notification_code', DEMO_ALERT_RULES],
  ];
  try {
    for (const [path, table, column, rows] of sets) {
      const have = await codes(table, column);
      let created = 0;
      for (const row of rows) {
        if (have.has(String(row[column]).toUpperCase())) continue;
        const r = await call('POST', path, row);
        if (ok(r)) created += 1;
        else console.log(`     rejected ${path} ${row[column]}: ${message(r)}`);
      }
      console.log(`  ${table}: ${created} created of ${rows.length}`);
    }
  } finally {
    await db.end();
  }
}

/** Dead weight by stage for a batch-wise death, in kg. */
const DEAD_WEIGHT: Record<string, number> = { WEANER: 14, DOUBLE_STOCK: 38, GROWER: 75 };

/**
 * Six weeks of weekly weight checks and four weeks of daily mortality on the
 * KPI lines the schedulers carry, through POST /batch/:id/daily-data. Weights
 * sit within a few percent of the line's standard; about one day in nine has
 * a single death, with a Reason Master mortality reason that fits the stage.
 * Feed consumption lines are not entered: the one that exists starts on stage
 * day 204.
 */
async function ensureDailyEntries(): Promise<void> {
  const db = await connection();
  let lines: any[];
  let animals: any[];
  let reasons: any[];
  let done: Set<string>;
  try {
    [lines] = await db.query<any[]>(
      `SELECT l.line_id, l.kpi_metric, l.occurrence, l.std_value, l.stage_id, s.stage_code, h.batch_id, b.batch_no, b.tracking_mode
         FROM scheduler_line l
         JOIN scheduler_header h ON h.scheduler_id = l.scheduler_id
         JOIN batch_header b ON b.batch_id = h.batch_id
         LEFT JOIN stage_master s ON s.stage_id = l.stage_id
        WHERE l.is_active = 1 AND h.scheduler_status = 'ACTIVE' AND b.status = 'ACTIVE' AND l.line_type = 'DESCRIPTIVE'`,
    );
    [animals] = await db.query<any[]>(
      `SELECT animal_id, animal_code, current_batch_id, current_stage_id FROM animal_register
        WHERE status IN ('ACTIVE', 'PREGNANT', 'LACTATING')`,
    );
    [reasons] = await db.query<any[]>(`SELECT reason_id, reason_name, applicable_stages FROM reason_master WHERE category = 'MORTALITY' AND deleted_at IS NULL ORDER BY reason_name`);
    const [e] = await db.query<any[]>('SELECT line_id, entry_date, animal_id FROM batch_daily_data');
    done = new Set(e.map((r) => `${r.line_id}|${new Date(r.entry_date).toISOString().slice(0, 10)}|${r.animal_id ?? ''}`));
  } finally {
    await db.end();
  }
  const reasonFor = (stage: string, key: string) => {
    const fits = reasons.filter((r) => JSON.stringify(r.applicable_stages ?? '').includes(stage));
    const pool = fits.length ? fits : reasons;
    return pool[Math.floor(draw(key) * pool.length)]?.reason_id;
  };

  let created = 0;
  const failed: string[] = [];
  for (const line of lines) {
    const animalWise = line.tracking_mode === 'ANIMAL_WISE';
    const targets = animalWise
      ? animals.filter((a) => a.current_batch_id === line.batch_id && a.current_stage_id === line.stage_id)
      : [null];
    const weight = line.kpi_metric === 'BODY_WEIGHT';
    // An animal-wise mortality line records only its own animal's death; zeros per sow add nothing.
    if (!weight && animalWise) continue;
    const dates = weight ? [42, 35, 28, 21, 14, 7].map(daysAgo) : Array.from({ length: 28 }, (_, i) => daysAgo(28 - i));
    for (const animal of targets) {
      for (const date of dates) {
        const key = `${line.line_id}|${date}|${animal?.animal_id ?? ''}`;
        if (done.has(key)) continue;
        const body: Record<string, unknown> = { line_id: line.line_id, entry_date: date };
        if (animal) body.animal_id = animal.animal_id;
        if (weight) {
          const std = Number(line.std_value) || 1;
          body.entered_value = Math.round(std * (0.95 + draw(`${key}:w`) * 0.08) * 100) / 100;
        } else {
          const death = draw(`${key}:d`) < 0.11;
          body.entered_value = death ? 1 : 0;
          if (death) {
            body.mortality_animals = [{ dead_weight_kg: DEAD_WEIGHT[line.stage_code] ?? 20, reason_id: reasonFor(line.stage_code, key) }];
          }
        }
        const r = await call('POST', `/batch/${line.batch_id}/daily-data`, body);
        if (ok(r)) {
          created += 1;
          done.add(key);
        } else {
          failed.push(`${line.batch_no} ${line.kpi_metric} ${date}${animal ? ` ${animal.animal_code}` : ''}: ${message(r)}`);
        }
      }
    }
  }
  console.log(`  daily entries: ${created} written on ${lines.length} KPI lines`);
  const shown = new Set<string>();
  for (const line of failed) {
    const reason = line.split(': ').slice(1).join(': ');
    if (shown.has(reason)) continue;
    shown.add(reason);
    console.log(`     failed ${line}`);
  }
  if (failed.length) console.log(`     ${failed.length} entries failed in all`);
}

async function apply(): Promise<void> {
  console.log(`Triple C demo masters against ${API} (${tenantDatabaseName(TENANT_CODE)})`);
  const login = await call('POST', '/auth/login', { email: `company.admin@${EMAIL_DOMAIN}`, password: PASSWORD });
  if (!ok(login)) throw new Error(`login: ${message(login)}`);
  token = unwrap(login).access_token;
  await ensureDemoMasters();
  // The breeding history and daily entries are played day by day by
  // seed-triplec-history.ts; this older shortcut stays behind a flag.
  if (!process.argv.includes('--with-breeding')) return;

  const db = await connection();
  let animals: Animal[];
  let bred: Set<string>;
  try {
    const [rows] = await db.query<any[]>(
      `SELECT a.animal_id, a.animal_code, a.animal_type, s.stage_code, a.current_batch_id batch_id
         FROM animal_register a LEFT JOIN stage_master s ON s.stage_id = a.current_stage_id
        WHERE a.status IN ('ACTIVE', 'PREGNANT', 'LACTATING') AND a.current_batch_id IS NOT NULL AND a.animal_type IN ('SOW', 'GILT')
        ORDER BY a.animal_code`,
    );
    animals = rows;
    const [b] = await db.query<any[]>('SELECT DISTINCT sow_animal_id FROM breeding_record');
    bred = new Set(b.map((r) => r.sow_animal_id));
  } finally {
    await db.end();
  }

  let done = 0;
  const failed: string[] = [];
  for (const a of animals) {
    if (bred.has(a.animal_id)) continue;
    try {
      await history(a);
      done += 1;
    } catch (error) {
      failed.push(error instanceof Error ? error.message : String(error));
    }
  }
  console.log(`  breeding history written for ${done} of ${animals.length} sows and gilts (${animals.length - done - failed.length} already had one)`);
  for (const line of failed.slice(0, 15)) console.log(`     failed ${line}`);
  if (failed.length > 15) console.log(`     ... and ${failed.length - 15} more`);

  const check = await connection();
  try {
    const one = async (sql: string) => Number((await check.query<any>(sql))[0][0].n);
    console.log(`  read back: ${await one('SELECT COUNT(*) n FROM breeding_record')} matings, ${await one('SELECT COUNT(*) n FROM farrowing_record')} farrowings, ${await one('SELECT COUNT(*) n FROM farrowing_record WHERE weaning_date IS NOT NULL')} weaned`);
  } finally {
    await check.end();
  }
  await ensureDailyEntries();
  if (failed.length) process.exitCode = 1;
}

if (process.argv.includes('--apply')) {
  void apply().catch((error: unknown) => {
    console.error(`\nFAILED: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
} else {
  console.log('Plan only — add --apply to write the breeding history.');
}
