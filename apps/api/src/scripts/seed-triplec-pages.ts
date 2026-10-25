/**
 * The records the Triple C showcase still lacks after seed-triplec.ts and
 * seed-triplec-history.ts, so that no screen or tab of the console opens
 * empty. None of these are in the submitted sheets; every one is a DEMO row,
 * named so, written through the app's own endpoints, for Triple C to replace.
 *
 * Transactions are dated today: every earlier day is posted and locked by the
 * history, and a document dated into a locked day would be refused.
 * Each section is idempotent (it skips when its table already has rows) and
 * independent (one refusal is reported and the rest go on).
 *
 *   TRIPLEC_TENANT_CODE=ccc TRIPLEC_EMAIL_DOMAIN=ccc.com \
 *     node --env-file-if-exists=.env --import tsx src/scripts/seed-triplec-pages.ts --apply
 */
import * as mysql from 'mysql2/promise';
import { tenantDatabaseName } from '../core/database/database-names';
import { MULTIPLIER_LOCATIONS } from './lib/multiplier-location-seed-data';
import { PORTA_LOCATIONS } from './lib/porta-location-seed-data';

const API = (process.env.NAVFARM_API_URL || 'http://localhost:2877/api/v1').replace(/\/$/, '');
const TENANT_CODE = process.env.TRIPLEC_TENANT_CODE || 'triplec';
const EMAIL_DOMAIN = process.env.TRIPLEC_EMAIL_DOMAIN || 'ccc.local';
const PASSWORD = '12345678';
const TODAY = new Date().toISOString().slice(0, 10);

let token = '';
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
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
    // keep the text
  }
  return { status: res.status, data: data?.data ?? data };
}
const ok = (r: { status: number }) => r.status >= 200 && r.status < 300;
const why = (r: { data: any }) => r.data?.error?.message ?? r.data?.message ?? JSON.stringify(r.data).slice(0, 200);

async function login(email: string) {
  const r = await call('POST', '/auth/login', { email, password: PASSWORD });
  if (!ok(r)) throw new Error(`login ${email}: ${why(r)}`);
  token = r.data.access_token;
}

let db: mysql.Connection;
const rows = async (sql: string, args: unknown[] = []) => (await db.query<any[]>(sql, args))[0] as any[];
const count = async (table: string, where = '1=1') => Number((await rows(`SELECT COUNT(*) n FROM \`${table}\` WHERE ${where}`))[0].n);

/** Runs one screen's section; a refusal is reported, never fatal. */
async function section(name: string, table: string, work: () => Promise<string>, where = '1=1') {
  try {
    if ((await count(table, where)) > 0) {
      console.log(`  ${name}: already has rows`);
      return;
    }
    console.log(`  ${name}: ${await work()}`);
  } catch (error) {
    console.log(`  ${name}: FAILED — ${error instanceof Error ? error.message : error}`);
  }
}
async function must(method: string, path: string, body?: unknown) {
  const r = await call(method, path, body);
  if (!ok(r)) throw new Error(`${method} ${path}: ${why(r)}`);
  return r.data;
}

async function apply() {
  db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: tenantDatabaseName(TENANT_CODE),
    ssl: process.env.DATABASE_SSL === 'true' ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } : undefined,
  });
  console.log(`Triple C remaining screens against ${API} (${tenantDatabaseName(TENANT_CODE)})`);
  await login(`company.admin@${EMAIL_DOMAIN}`);
  const [company] = await rows('SELECT company_id, base_currency_id FROM company_master LIMIT 1');
  const companyId = company.company_id;
  // The farm the feed and document screens are shown on: MULTIPLIER, which has the herd and the history.
  const [farm] = await rows(`SELECT location_id FROM location_master WHERE location_type = 'FARM' AND location_code = 'MUL100' AND deleted_at IS NULL LIMIT 1`);
  const [store] = await rows(`SELECT location_id FROM location_master WHERE location_type = 'STORE' AND deleted_at IS NULL LIMIT 1`);
  const [silo] = await rows(`SELECT location_id FROM location_master WHERE location_type = 'SILO' AND deleted_at IS NULL ORDER BY location_code LIMIT 1`);
  const item = async (code: string) => (await rows('SELECT * FROM item_master WHERE item_code = ?', [code]))[0];
  const [areaRow] = await rows('SELECT area_id operational_area_id FROM operational_area_master LIMIT 1');
  const [lob] = await rows('SELECT lob_id, nob_id FROM batch_header LIMIT 1');

  // ---------------------------------------------------------------- master data tabs
  await section('UOM conversions', 'uom_conversion_master', async () => {
    const list = [
      { conversion_code: 'BAG-KG', from_uom: 'BAG', to_uom: 'KG', conversion_factor: 50 },
      { conversion_code: 'TONNE-KG', from_uom: 'TONNE', to_uom: 'KG', conversion_factor: 1000 },
      { conversion_code: 'DOZEN-PCS', from_uom: 'DOZEN', to_uom: 'PCS', conversion_factor: 12 },
      { conversion_code: 'LITER-ML', from_uom: 'LITER', to_uom: 'ML', conversion_factor: 1000 },
    ];
    for (const c of list) await must('POST', '/uom/conversion', { ...c, company_id: companyId, effective_from: '2025-01-01' });
    return `${list.length} created`;
  });

  await section('Item attributes', 'item_attribute_master', async () => {
    const list = [
      { attribute_code: 'PROTEIN', attribute_name: 'Crude Protein %', data_type: 'NUMBER', unit: '%' },
      { attribute_code: 'ENERGY', attribute_name: 'Digestible Energy (MJ/kg)', data_type: 'NUMBER', unit: 'MJ/kg' },
      { attribute_code: 'FORM', attribute_name: 'Feed Form', data_type: 'TEXT', list_values: ['Pellet', 'Crumble', 'Mash'] },
    ];
    for (const a of list) await must('POST', '/item-attribute', { ...a, company_id: companyId });
    return `${list.length} created`;
  });

  await section('Item templates', 'item_template', async () => {
    const [series] = await rows(`SELECT id FROM no_series WHERE company_id IS NOT NULL AND code LIKE 'ITEM%' ORDER BY code = 'ITEM' DESC, code LIMIT 1`);
    if (!series) throw new Error('no item number series');
    const list = [
      { template_code: 'FEED-BULK', template_description: 'Bulk feed, lot tracked', item_type: 'FEED', valuation_method: 'FIFO', item_tracking: 'LOT' },
      { template_code: 'MED-VIAL', template_description: 'Medicine by the vial', item_type: 'MEDICINE', valuation_method: 'FIFO', item_tracking: 'LOT' },
      { template_code: 'VAC-DOSE', template_description: 'Vaccine by the dose', item_type: 'VACCINE', valuation_method: 'FIFO', item_tracking: 'LOT' },
    ];
    const [lotSeries] = await rows(`SELECT id FROM no_series WHERE company_id IS NOT NULL AND code = 'ITEM_LOT' LIMIT 1`);
    for (const tpl of list) await must('POST', '/item-template', { ...tpl, no_series_id: series.id, item_tracking_no_series_id: lotSeries?.id, inventory_type: 'INVENTORY', company_id: companyId });
    return `${list.length} created`;
  });

  await section('Cost centres and departments', 'cost_center_master', async () => {
    const list = [
      { cost_center_code: 'CC-PROD', cost_center_name: 'Pig Production', cost_center_type: 'DEPARTMENT' },
      { cost_center_code: 'CC-MILL', cost_center_name: 'Feed Mill', cost_center_type: 'DEPARTMENT' },
      { cost_center_code: 'CC-VET', cost_center_name: 'Veterinary', cost_center_type: 'DEPARTMENT' },
      { cost_center_code: 'CC-ADMIN', cost_center_name: 'Administration', cost_center_type: 'DEPARTMENT' },
      { cost_center_code: 'CC-MUL100', cost_center_name: 'Multiplier Farm', cost_center_type: 'FARM' },
      { cost_center_code: 'CC-STORE', cost_center_name: 'Farm Store', cost_center_type: 'WAREHOUSE' },
    ];
    for (const c of list) await must('POST', '/cost-center', { ...c, company_id: companyId });
    return `${list.length} created`;
  });

  await section('Exchange rates', 'exchange_rate', async () => {
    const cur = async (iso: string) => (await rows('SELECT currency_id FROM currency_master WHERE iso_code = ?', [iso]))[0]?.currency_id;
    const list = [['USD', 0.012], ['ZAR', 0.21], ['EUR', 0.011], ['GBP', 0.0094]] as const;
    let made = 0;
    for (const [iso, rate] of list) {
      const to = await cur(iso);
      if (!to || to === company.base_currency_id) continue;
      await must('POST', '/currency/rates', { from_currency_id: company.base_currency_id, to_currency_id: to, rate, rate_date: TODAY, rate_source: 'DEMO' });
      made += 1;
    }
    return `${made} created`;
  });

  await section('Feed formulas', 'feed_formula_master', async () => {
    const [cat] = await rows(`SELECT category_id FROM item_category_master WHERE item_type = 'RAW_MATERIAL' AND deleted_at IS NULL LIMIT 1`);
    let categoryId = cat?.category_id;
    if (!categoryId) {
      const made = await must('POST', '/item-category', { company_id: companyId, category_code: 'RAW-MAT', category_name: 'Raw Materials', item_type: 'RAW_MATERIAL' });
      categoryId = made.category_id;
    }
    const raws = [
      { code: 'RM-MAIZE', name: 'Maize (DEMO)' }, { code: 'RM-SOYA', name: 'Soya Meal (DEMO)' },
      { code: 'RM-BRAN', name: 'Wheat Bran (DEMO)' }, { code: 'RM-PREMIX', name: 'Grower Premix (DEMO)' },
    ];
    const ids: string[] = [];
    for (const raw of raws) {
      const existing = await item(raw.code);
      if (existing) { ids.push(existing.item_id); continue; }
      const made = await must('POST', '/item', {
        company_id: companyId, item_code: raw.code, item_name: raw.name, item_type: 'RAW_MATERIAL', category_id: categoryId,
        uom_primary: 'KG', valuation_method: 'FIFO', is_lot_tracked: false, standard_cost: 0.25,
      });
      ids.push(made.item_id);
    }
    const formulas = [
      { formula_code: 'FF-GROWER1', formula_name: 'Grower 1 — 1 tonne', target: 'FEED000016', mix: [620, 240, 110, 30] },
      { formula_code: 'FF-DRYSOW', formula_name: 'Dry Sow — 1 tonne', target: 'FEED000010', mix: [600, 150, 220, 30] },
      { formula_code: 'FF-WEANER', formula_name: 'Weaner O.T.C — 1 tonne', target: 'FEED000024', mix: [560, 320, 80, 40] },
    ];
    let made = 0;
    for (const f of formulas) {
      const target = await item(f.target);
      if (!target) continue;
      await must('POST', '/feed-formula', {
        company_id: companyId, formula_code: f.formula_code, formula_name: f.formula_name, target_item_id: target.item_id,
        batch_size: 1000, batch_unit: 'KG', description: 'DEMO formula',
        ingredients: f.mix.map((kg, i) => ({ item_id: ids[i], quantity: kg, unit: 'KG', inclusion_pct: kg / 10 })),
      });
      made += 1;
    }
    return `${made} formulas, ${raws.length} raw materials`;
  });

  // ---------------------------------------------------------------- settings
  await section('Production parameters', 'parameter_master', async () => {
    const water = await item('FEED000024');
    const list = [
      { parameter_code: 'WATER', parameter_name: 'Water Intake', parameter_type: 'OBSERVATION', default_uom: 'LITER', qty_method: 'MANUAL_AT_ENTRY' },
      { parameter_code: 'TEMP', parameter_name: 'House Temperature', parameter_type: 'OBSERVATION', default_uom: 'CELSIUS', qty_method: 'MANUAL_AT_ENTRY' },
      { parameter_code: 'MORT', parameter_name: 'Mortality', parameter_type: 'MORTALITY', default_uom: 'HEAD', qty_method: 'MANUAL_AT_ENTRY', is_mandatory: true },
      { parameter_code: 'FEED-WEANER', parameter_name: 'Weaner Feed', parameter_type: 'CONSUMPTION', item_id: water?.item_id, default_uom: 'KG', qty_method: 'PER_UNIT', default_qty_per_unit: 0.8 },
    ];
    for (const p of list) await must('POST', '/parameter', { ...p, company_id: companyId, nob_id: lob?.nob_id, lob_id: lob?.lob_id });
    return `${list.length} created`;
  });

  await section('QC parameters', 'qc_parameter_master', async () => {
    const list = [
      { param_code: 'LIVE-WT', param_name: 'Live Weight at Sale', param_type: 'NUMERIC', uom: 'KG', min_value: 105, max_value: 130, is_mandatory: true },
      { param_code: 'BACKFAT', param_name: 'Backfat P2', param_type: 'NUMERIC', uom: 'MM', min_value: 8, max_value: 16 },
      { param_code: 'CONDITION', param_name: 'Body Condition', param_type: 'GRADE', grade_scale: { A: 'Excellent', B: 'Good', C: 'Fair' } },
      { param_code: 'HEALTHY', param_name: 'Free of Lesions', param_type: 'BOOLEAN', pass_criteria: 'true' },
    ];
    for (const q of list) await must('POST', '/qc-parameter', { ...q, company_id: companyId, lob_id: lob?.lob_id });
    return `${list.length} created`;
  });

  await section('Notification channels', 'notification_config', async () => {
    const list = [
      { channel: 'EMAIL', is_enabled: false, smtp_host: 'smtp.example.com', smtp_port: 587, from_email: 'alerts@example.com', from_name: 'NAVFarm Triple C (DEMO)' },
      { channel: 'WEBHOOK', is_enabled: false, webhook_url: 'https://example.com/navfarm-webhook' },
    ];
    let made = 0;
    for (const n of list) {
      const r = await call('POST', '/notification', { ...n, company_id: companyId });
      if (ok(r)) made += 1;
      else console.log(`     ${n.channel}: ${why(r)}`);
    }
    return `${made} created (disabled: the addresses are placeholders)`;
  });

  // ---------------------------------------------------------------- roles on users
  await section('Role assignments', 'user_role_assignment', async () => {
    await login(`tenant.admin@${EMAIL_DOMAIN}`);
    const users = await rows('SELECT user_id, email FROM user_master WHERE deleted_at IS NULL');
    const role = async (code: string) => (await rows('SELECT role_id FROM role_master WHERE role_code = ?', [code]))[0]?.role_id;
    const plan: Array<[string, string]> = [
      [`company.admin@${EMAIL_DOMAIN}`, 'MANAGER'], [`area.admin@${EMAIL_DOMAIN}`, 'MILL_MANAGER'],
      [`user@${EMAIL_DOMAIN}`, 'OPERATOR'], [`company.admin@${EMAIL_DOMAIN}`, 'ACCOUNTANT'],
    ];
    let made = 0;
    for (const [email, code] of plan) {
      const u = users.find((x) => x.email === email);
      const r = u && (await role(code));
      if (!u || !r) continue;
      const res = await call('POST', '/role/assign', { userId: u.user_id, roleId: r });
      if (ok(res)) made += 1;
      else console.log(`     ${email} ${code}: ${why(res)}`);
    }
    await login(`company.admin@${EMAIL_DOMAIN}`);
    return `${made} assigned`;
  });

  // ---------------------------------------------------------------- system schedulers
  await section('System schedulers', 'system_scheduler', async () => {
    // Copied from the batch schedulers the history ran on, so a batch that
    // copies one gets exactly the activities it would have had anyway.
    const sources = await rows(
      `SELECT h.scheduler_id, h.stage_id, h.breed_id, s.stage_code, s.stage_name, b.breed_code
         FROM scheduler_header h JOIN stage_master s ON s.stage_id = h.stage_id JOIN breed_master b ON b.breed_id = h.breed_id
         JOIN (SELECT scheduler_id, COUNT(*) n FROM scheduler_line WHERE is_active = 1 GROUP BY scheduler_id) l ON l.scheduler_id = h.scheduler_id
        WHERE s.stage_code IN ('WEANER', 'DOUBLE_STOCK', 'GROWER', 'GESTATION')
        ORDER BY s.stage_code, b.breed_code, l.n DESC`);
    const seen = new Set<string>();
    let made = 0;
    for (const src of sources) {
      const key = `${src.stage_code}:${src.breed_code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const created = await call('POST', '/system-scheduler', {
        company_id: companyId, stage_id: src.stage_id, breed_id: src.breed_id,
        scheduler_name: `${src.stage_name} — ${src.breed_code}`, data_entry_level: 'SHED', notes: 'Copied from the batch schedulers in use',
      });
      if (!ok(created)) { console.log(`     ${key}: ${why(created)}`); continue; }
      const id = created.data.system_scheduler_id ?? created.data.id;
      const copied = await call('POST', `/system-scheduler/${id}/copy-lines`, { source_type: 'BATCH', source_id: src.scheduler_id });
      if (!ok(copied)) console.log(`     ${key} lines: ${why(copied)}`);
      made += 1;
    }
    return `${made} created`;
  });



  await section('System scheduler activities', 'system_scheduler_line', async () => {
    const empty = await rows(
      `SELECT s.system_scheduler_id, s.stage_id, s.breed_key FROM system_scheduler s
        WHERE NOT EXISTS (SELECT 1 FROM system_scheduler_line l WHERE l.system_scheduler_id = s.system_scheduler_id)`);
    let copied = 0;
    for (const sys of empty) {
      const [src] = await rows(
        `SELECT h.scheduler_id FROM scheduler_header h JOIN scheduler_line l ON l.scheduler_id = h.scheduler_id AND l.is_active = 1
          WHERE h.stage_id = ? AND (h.breed_id = ? OR ? = '*') GROUP BY h.scheduler_id ORDER BY COUNT(*) DESC LIMIT 1`,
        [sys.stage_id, sys.breed_key, sys.breed_key]);
      if (!src) continue;
      const r = await call('POST', `/system-scheduler/${sys.system_scheduler_id}/copy-lines`, { source_type: 'BATCH', source_id: src.scheduler_id });
      if (ok(r)) copied += 1;
      else console.log(`     ${sys.system_scheduler_id}: ${why(r)}`);
    }
    return `${copied} of ${empty.length} given their activities`;
  });

  // ---------------------------------------------------------------- feed planning
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const siloStock = async () => rows(
    `SELECT l.location_id silo_id, l.location_code, g.item_id, SUM(g.quantity) kg
       FROM inventory_ledger g JOIN location_master l ON l.location_id = g.warehouse_id
      WHERE l.location_type = 'SILO' AND l.status = 'ACTIVE' AND l.farm_id = ? GROUP BY l.location_id, l.location_code, g.item_id HAVING kg > 1 ORDER BY l.location_code`, [farm.location_id]);

  await section('Silo-to-shed links', 'silo_shed_link', async () => {
    // The location template names, on every shed, the silo it draws from.
    const bySilo = new Map<string, string[]>();
    // Codes are saved in capitals ('MFH Trans - 1' is MFH TRANS - 1), so they are matched that way.
    // A Porta house that two template rows describe draws from both their silos.
    for (const row of [...MULTIPLIER_LOCATIONS, ...PORTA_LOCATIONS] as Array<{ type: string; code: string; storageType?: string; storageName?: string; storageName2?: string }>) {
      if (row.type !== 'SHED' || row.storageType !== 'SILO') continue;
      for (const silo of [row.storageName, row.storageName2]) {
        if (!silo) continue;
        bySilo.set(silo.toUpperCase(), [...(bySilo.get(silo.toUpperCase()) ?? []), row.code.toUpperCase()]);
      }
    }
    const all = await rows('SELECT location_code, location_id, location_type FROM location_master WHERE deleted_at IS NULL');
    const ids = new Map(all.map((r) => [String(r.location_code).toUpperCase(), r.location_id]));
    // 'PDs-02' names a silo the app could not create: the shed PDS-02 holds that code.
    const siloIds = new Map(all.filter((r) => r.location_type === 'SILO').map((r) => [String(r.location_code).toUpperCase(), r.location_id]));
    let linked = 0;
    for (const [siloCode, sheds] of bySilo) {
      const siloId = siloIds.get(siloCode);
      const shedIds = sheds.map((c) => ids.get(c)).filter(Boolean);
      if (!siloId || !shedIds.length) continue;
      const r = await call('PUT', `/location/${siloId}`, { attached_sheds: shedIds });
      if (ok(r)) linked += shedIds.length;
      else console.log(`     ${siloCode}: ${why(r)}`);
    }
    return `${linked} sheds linked to ${bySilo.size} silos, from the template's SILO column`;
  });

  await section('Linked silos made active', 'location_master', async () => {
    // A silo saved with no shed is INACTIVE (Checkpoint 1), and linking sheds
    // later does not change that: the Feed Forecast plans ACTIVE silos only, so
    // until this it showed no shed at all. A silo is made ACTIVE with its sheds.
    const silos = await rows(
      `SELECT l.location_id, l.location_code, GROUP_CONCAT(k.shed_id) sheds FROM location_master l
         JOIN silo_shed_link k ON k.silo_id = l.location_id
        WHERE l.location_type = 'SILO' AND l.status <> 'ACTIVE' AND l.deleted_at IS NULL GROUP BY l.location_id, l.location_code`);
    let made = 0;
    for (const silo of silos) {
      const r = await call('PUT', `/location/${silo.location_id}`, { status: 'ACTIVE', attached_sheds: String(silo.sheds).split(',') });
      if (ok(r)) made += 1;
      else console.log(`     ${silo.location_code}: ${why(r)}`);
    }
    return `${made} of ${silos.length} linked silos made ACTIVE`;
  }, "location_type = 'SILO' AND status = 'ACTIVE'");

  await section('Cohorts in their houses, stage feeds as the sheet words them', 'breed_lifecycle_stages', async () => {
    // For a tenant built before 24 Oct: its cohorts stayed in the farrowing house
    // they were born in, and its weaner and double-stock feed rows named feeds no
    // house silo holds, so the Feed Forecast found no silo demand at all. A fresh
    // build does both itself (seed-triplec.ts, seed-triplec-history.ts).
    const item = async (name: string) => (await rows('SELECT item_id FROM item_master WHERE item_name = ? AND deleted_at IS NULL', [name]))[0]?.item_id;
    const weanerOtc = await item('Weaner O.T.C');
    const grower1 = await item('Grower 1');
    const out: string[] = [];
    const lc = await rows(
      `SELECT l.lifecycle_id, l.breed_id, l.farm_id, l.stage_id, s.stage_code, l.period_from, l.period_to, l.notes
         FROM breed_lifecycle_stages l JOIN stage_master s ON s.stage_id = l.stage_id WHERE l.retired_at IS NULL`);
    let feeds = 0;
    for (const r of lc.filter((x) => x.stage_code === 'WEANER' && x.period_from === 4 && x.period_to === 10)) {
      const u = await call('PUT', `/breed-lifecycle-stage/${r.lifecycle_id}`, { feed_item_id: weanerOtc });
      if (ok(u)) feeds += 1; else console.log(`     weaner row: ${why(u)}`);
    }
    for (const r of lc.filter((x) => x.stage_code === 'DOUBLE_STOCK' && x.period_from === 1 && x.period_to === 4 && String(x.notes ?? '').startsWith('DEMO feed'))) {
      const u = await call('PUT', `/breed-lifecycle-stage/${r.lifecycle_id}`, { period_to: 2, feed_item_id: weanerOtc, feed_qty_per_head_per_day_kg: 1.3 });
      if (!ok(u)) { console.log(`     double-stock row: ${why(u)}`); continue; }
      const c = await call('POST', '/breed-lifecycle-stage', {
        company_id: companyId, breed_id: r.breed_id, stage_id: r.stage_id, farm_id: r.farm_id, calc_unit: 'WEEK', period_from: 3, period_to: 4,
        feed_item_id: grower1, feed_qty_per_head_per_day_kg: 1.6, notes: 'DEMO feed standard — the submitted lifecycle has none for these stage weeks',
      });
      if (ok(c)) feeds += 2; else console.log(`     double-stock weeks 3-4: ${why(c)}`);
    }
    out.push(`${feeds} feed rows aligned`);
    const houses: Record<string, string[]> = {
      WEANER: ['MUWN1', 'MUWN2', 'MUWN3', 'MUWN4', 'MUWN5', 'MUWN6'],
      DOUBLE_STOCK: ['MUDST1P1', 'MUDST2P1', 'MUDST3P1', 'MUDST4P1'],
      GROWER: ['MUGR4', 'MUGR5', 'MUGR6', 'MUGR7', 'MUGR8', 'MUGR9', 'MUGR10'],
    };
    const ids = new Map((await rows('SELECT location_code, location_id FROM location_master WHERE deleted_at IS NULL')).map((r) => [r.location_code, r.location_id]));
    const cohorts = await rows(
      `SELECT b.batch_id, b.batch_no, s.stage_code, sh.location_code shed FROM batch_header b JOIN stage_master s ON s.stage_id = b.stage_id
         LEFT JOIN location_master sh ON sh.location_id = b.shed_id
        WHERE b.status = 'ACTIVE' AND b.tracking_mode = 'BATCH_WISE' AND s.stage_code IN ('WEANER', 'DOUBLE_STOCK', 'GROWER') ORDER BY b.batch_no`);
    let moved = 0;
    const turn: Record<string, number> = {};
    for (const b of cohorts) {
      const list = houses[b.stage_code];
      if (list.includes(b.shed)) continue;
      const code = list[(turn[b.stage_code] = (turn[b.stage_code] ?? -1) + 1) % list.length];
      const r = await call('PATCH', `/batch/${b.batch_id}/shed`, { shed_id: ids.get(code) });
      if (ok(r)) moved += 1; else console.log(`     ${b.batch_no} -> ${code}: ${why(r)}`);
    }
    out.push(`${moved} of ${cohorts.length} active cohorts moved to their stage's house`);
    return out.join(', ');
  }, "notes LIKE 'DEMO feed%' AND period_from = 3 AND period_to = 4");

  await section('Feed forecast run', 'feed_forecast_run', async () => {
    await must('POST', '/feed-forecast/runs', { farmId: farm.location_id, planningDate: TODAY });
    return 'saved for today';
  });

  await section('Feed requisitions, consolidation and loading sheet', 'feed_consolidation', async () => {
    const stock = (await siloStock()).slice(0, 3);
    if (!stock.length) throw new Error('no silo holds feed');
    const reqIds: string[] = (await rows(`SELECT requisition_id FROM requisition WHERE doc_type = 'FEED'`)).map((r) => r.requisition_id);
    for (const s of reqIds.length ? [] : stock) {
      const r = await must('POST', '/feed-requisition', {
        farmId: farm.location_id, requisition_date: TODAY, remarks: `Refill ${s.location_code} (DEMO)`,
        lines: [{ destination_location_id: s.silo_id, item_id: s.item_id, quantity_kg: 3000, proposed_delivery_date: tomorrow }],
      });
      const id = r.requisition_id ?? r.id;
      reqIds.push(id);
      const sub = await call('POST', `/feed-requisition/${id}/submit`, {});
      if (!ok(sub)) console.log(`     submit: ${why(sub)}`);
    }
    // A feed requisition is approved on the Approvals page before the mill consolidates it.
    for (const a of await rows(`SELECT request_id approval_id FROM approval_request WHERE doc_type = 'FEED_REQUISITION' AND status = 'PENDING'`)) {
      const d = await call('POST', `/approval/${a.approval_id}/approve`, { remarks: 'Approved for the mill (DEMO)' });
      if (!ok(d)) console.log(`     approve feed requisition: ${why(d)}`);
    }
    const lines = await rows(
      `SELECT line_id FROM requisition_line WHERE requisition_id IN (${reqIds.map(() => '?').join(',')})`, reqIds);
    const c = await call('POST', '/feed-requisition/consolidations', {
      farmId: farm.location_id, lines: lines.slice(0, 2).map((l) => ({ requisitionLineId: l.line_id })),
    });
    if (!ok(c)) return `${reqIds.length} requisitions; consolidation refused: ${why(c)}`;
    const cid = c.data?.consolidation_id ?? c.data?.consolidation?.consolidation_id ?? (await rows('SELECT consolidation_id FROM feed_consolidation ORDER BY created_at DESC LIMIT 1'))[0]?.consolidation_id;
    const steps: string[] = [`${reqIds.length} requisitions`, 'consolidated'];
    for (const step of ['review', 'finalize']) {
      const r = await call('POST', `/feed-requisition/consolidations/${cid}/${step}`, {});
      steps.push(ok(r) ? step : `${step} refused (${why(r)})`);
    }
    const ls = await call('POST', `/feed-requisition/consolidations/${cid}/loading-sheets`, {});
    if (ok(ls)) {
      const sheet = Array.isArray(ls.data) ? ls.data[0] : ls.data;
      const sid = sheet?.loading_sheet_id ?? sheet?.id;
      steps.push('loading sheet');
      if (sid) {
        const d = await call('POST', `/feed-requisition/loading-sheets/${sid}/dispatch`, {});
        steps.push(ok(d) ? 'dispatched' : `dispatch refused (${why(d)})`);
      }
    } else steps.push(`loading sheet refused (${why(ls)})`);
    return steps.join(', ');
  }, '1=1');


  await section('Feed consolidation review and loading sheet', 'feed_consolidation', async () => {
    const [c] = await rows(`SELECT consolidation_id, status FROM feed_consolidation ORDER BY created_at DESC LIMIT 1`);
    if (!c) throw new Error('no consolidation');
    const steps: string[] = [];
    for (const step of ['review', 'finalize']) {
      const r = await call('POST', `/feed-requisition/consolidations/${c.consolidation_id}/${step}`, {});
      steps.push(ok(r) ? step : `${step} refused (${why(r)})`);
    }
    if (!(await count('feed_loading_sheet'))) {
      const ls = await call('POST', `/feed-requisition/consolidations/${c.consolidation_id}/loading-sheets`, {});
      if (!ok(ls)) return [...steps, `loading sheet refused (${why(ls)})`].join(', ');
    }
    const [sheet] = await rows(`SELECT * FROM feed_loading_sheet ORDER BY created_at DESC LIMIT 1`);
    const sid = sheet?.loading_sheet_id ?? sheet?.sheet_id ?? sheet?.id;
    steps.push('loading sheet');
    if (sid) {
      const d = await call('POST', `/feed-requisition/loading-sheets/${sid}/dispatch`, {});
      steps.push(ok(d) ? 'dispatched' : `dispatch refused (${why(d)})`);
    }
    return steps.join(', ');
  }, "status <> 'DRAFT'");


  await section('Loading sheets loaded and dispatched', 'feed_loading_sheet', async () => {
    const sheets = await rows(`SELECT loading_sheet_id, scheduled_qty_kg, mill_approved_qty_kg, requested_qty_kg FROM feed_loading_sheet WHERE status NOT IN ('DISPATCHED', 'CANCELLED') ORDER BY loading_sheet_no`);
    const out: string[] = [];
    for (const [i, sh] of sheets.entries()) {
      const kg = Number(sh.scheduled_qty_kg ?? sh.mill_approved_qty_kg ?? sh.requested_qty_kg) || 1000;
      const u = await call('PUT', `/feed-requisition/loading-sheets/${sh.loading_sheet_id}`, { compartmentNo: String(i + 1), kgLoaded: kg, loadedBy: 'Mill (DEMO)' });
      if (!ok(u)) { out.push(`load refused (${why(u)})`); continue; }
      // The first truck leaves; the second stays loaded at the mill, so both states show.
      if (i === 0) {
        const d = await call('POST', `/feed-requisition/loading-sheets/${sh.loading_sheet_id}/dispatch`, {});
        out.push(ok(d) ? 'dispatched' : `dispatch refused (${why(d)})`);
      } else out.push('loaded');
    }
    return out.join(', ') || 'none open';
  }, "status = 'DISPATCHED'");

  await section('Silo stock count', 'feed_stock_count', async () => {
    // The app names the silo/feed pairs a count must cover; each is counted at its book quantity.
    const countedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const ev = await call('GET', `/feed-stock-count/evidence?companyId=${companyId}&farmId=${farm.location_id}&countedAt=${encodeURIComponent(countedAt)}`);
    if (!ok(ev)) throw new Error(`evidence: ${why(ev)}`);
    const pairs: any[] = ev.data?.data?.pairs ?? ev.data?.pairs ?? [];
    const r = await must('POST', '/feed-stock-count', {
      companyId, farmId: farm.location_id, countedAt, scheduleSource: 'ON_DEMAND', countType: 'WEEKLY',
      lines: pairs.map((x) => ({ siloId: x.siloId, itemId: x.itemId, countedQtyKg: Math.max(0, Math.round(Number(x.systemQtyKg) * 10000) / 10000) })),
    });
    const sub = await call('POST', `/feed-stock-count/${r.count_id ?? r.id}/submit`, {});
    return `${pairs.length} silo feeds counted${ok(sub) ? ', submitted' : ` (submit refused: ${why(sub)})`}`;
  });

  await section('Feed alerts', 'feed_alert', async () => {
    const [low] = await siloStock();
    if (low) await call('PUT', `/location/${low.silo_id}`, { low_level_kg: Math.ceil(Number(low.kg) + 500) });
    const r = await must('POST', '/feed-alert/evaluate', { farmId: farm.location_id });
    return `evaluated (${JSON.stringify(r).slice(0, 80)})`;
  });

  // ---------------------------------------------------------------- documents dated today
  const feed = await item('FEED000016');
  const lotOf = async (itemId: string, warehouseId: string) =>
    (await rows(
      `SELECT lot_no, SUM(quantity) q FROM inventory_ledger WHERE item_id = ? AND warehouse_id = ? AND lot_no IS NOT NULL GROUP BY lot_no HAVING q > 10 ORDER BY q DESC LIMIT 1`,
      [itemId, warehouseId]))[0];

  await section('Requisitions and approvals', 'requisition', async () => {
    const lines = [{ item_id: feed.item_id, quantity: 5000, uom: 'KG', est_rate: Number(feed.standard_cost) || 0.4 }];
    const base = { company_id: companyId, farm_id: farm.location_id, doc_type: 'ITEM', purpose: 'PURCHASE', requisition_date: TODAY, required_date: TODAY, lines };
    const made: string[] = [];
    for (const remarks of ['Grower feed for next fortnight (DEMO)', 'Top-up before diet change (DEMO)', 'Spare stock for the store (DEMO)']) {
      const r = await must('POST', '/requisition', { ...base, remarks, justification: remarks });
      made.push(r.requisition_id ?? r.id);
    }
    const acted: string[] = [];
    for (const [i, id] of made.entries()) {
      const s = await call('POST', `/requisition/${id}/submit`, {});
      if (!ok(s)) { acted.push(`submit: ${why(s)}`); continue; }
      // Approved and rejected in 'Requisition decisions' below.
      acted.push('submitted');
    }
    return `${made.length} created — ${acted.join(', ')}`;
  }, "doc_type = 'ITEM'");


  await section('Requisition decisions', 'approval_request', async () => {
    const reqs = await rows(`SELECT requisition_id FROM requisition WHERE doc_type = 'ITEM' AND status = 'PENDING_APPROVAL' ORDER BY created_at`);
    const out: string[] = [];
    if (reqs[0]) { const a = await call('POST', `/requisition/${reqs[0].requisition_id}/approve`, {}); out.push(ok(a) ? 'approved' : `approve: ${why(a)}`); }
    if (reqs[1]) { const r = await call('POST', `/requisition/${reqs[1].requisition_id}/reject`, { rejection_reason: 'Stock is sufficient (DEMO)' }); out.push(ok(r) ? 'rejected' : `reject: ${why(r)}`); }
    if (reqs[2]) out.push('pending');
    return out.join(', ') || 'none waiting';
  }, "doc_type = 'REQUISITION' AND status <> 'PENDING'");

  await section('Approval requests', 'approval_request', async () => {
    const [batch] = await rows(`SELECT batch_id, batch_no FROM batch_header WHERE status = 'ACTIVE' AND tracking_mode = 'BATCH_WISE' LIMIT 1`);
    const list = [
      { doc_type: 'MORTALITY_WRITE_OFF', title: 'Write off 3 weaners (DEMO)', urgency: 'HIGH', requested_qty: '3', uom: 'HEAD', cost_impact: 450 },
      { doc_type: 'FEED_CHANGE', title: 'Bring forward Grower 2 by a week (DEMO)', urgency: 'MEDIUM', item_or_stage: 'GROWER', cost_impact: 1200 },
      { doc_type: 'STOCK_ADJUSTMENT', title: 'Count difference in the store (DEMO)', urgency: 'LOW', requested_qty: '120', uom: 'KG', cost_impact: 48 },
    ];
    const ids: string[] = [];
    for (const a of list) {
      const r = await call('POST', '/approval', { ...a, company_id: companyId, operational_area_id: areaRow?.operational_area_id, batch_id: batch?.batch_id, justification: a.title });
      if (ok(r)) ids.push(r.data.request_id ?? r.data.approval_id ?? r.data.id);
      else console.log(`     ${a.doc_type}: ${why(r)}`);
    }
    if (ids[0]) await call('POST', `/approval/${ids[0]}/approve`, { remarks: 'OK (DEMO)' });
    if (ids[1]) await call('POST', `/approval/${ids[1]}/reject`, { rejection_reason: 'Not this cycle (DEMO)' });
    return `${ids.length} created (approved, rejected, pending)`;
  }, "title LIKE '%(DEMO)%'");

  await section('Stock adjustment', 'stock_adjustment', async () => {
    const [held] = await rows(
      `SELECT item_id, lot_no, SUM(quantity) q FROM inventory_ledger WHERE warehouse_id = ? AND lot_no IS NOT NULL GROUP BY item_id, lot_no HAVING q > 100 ORDER BY q DESC LIMIT 1`,
      [store.location_id]);
    if (!held) throw new Error('the store holds no lot with stock');
    const r = await must('POST', '/stock-adjustment', {
      company_id: companyId, warehouse_id: store.location_id, posting_date: TODAY, reason: 'COUNT_DIFFERENCE', remarks: 'Store count (DEMO)',
      lines: [{ item_id: held.item_id, quantity: -25, uom: 'KG', lot_no: held.lot_no, remarks: 'Spillage' }],
    });
    const p = await call('POST', `/stock-adjustment/${r.adjustment_id ?? r.id}/post`, {});
    return ok(p) ? '1 posted' : `created, post refused: ${why(p)}`;
  });

  await section('Stock transfer', 'stock_transfer', async () => {
    // A silo holds one feed at a time, so the store's feed goes to a silo already holding it.
    const [pair] = await rows(
      `SELECT st.item_id, st.lot_no, si.warehouse_id silo_id FROM
         (SELECT item_id, lot_no, SUM(quantity) q FROM inventory_ledger WHERE warehouse_id = ? AND lot_no IS NOT NULL GROUP BY item_id, lot_no HAVING q > 600) st
         JOIN (SELECT g.item_id, g.warehouse_id FROM inventory_ledger g JOIN location_master l ON l.location_id = g.warehouse_id
                WHERE l.location_type = 'SILO' GROUP BY g.item_id, g.warehouse_id HAVING SUM(g.quantity) > 1) si ON si.item_id = st.item_id
         JOIN location_master cap ON cap.location_id = si.warehouse_id
        WHERE COALESCE(cap.silo_capacity_kg, 999999) - (SELECT SUM(quantity) FROM inventory_ledger WHERE warehouse_id = si.warehouse_id) > 150
        LIMIT 1`, [store.location_id]);
    if (!pair) throw new Error('no store feed matches a silo');
    const r = await must('POST', '/stock-transfer', {
      company_id: companyId, from_warehouse_id: store.location_id, to_warehouse_id: pair.silo_id, posting_date: TODAY, remarks: 'Store to silo (DEMO)',
      lines: [{ item_id: pair.item_id, quantity: 100, uom: 'KG', lot_no: pair.lot_no }],
    });
    const id = r.transfer_id ?? r.id;
    const p = await call('POST', `/stock-transfer/${id}/direct-transfer`, {});
    if (ok(p)) return '1 transferred';
    const s = await call('POST', `/stock-transfer/${id}/post`, {});
    return ok(s) ? '1 posted' : `created, post refused: ${why(p)} / ${why(s)}`;
  });

  await section('Expenses', 'expense_document', async () => {
    const [expense] = await rows(`SELECT gl_account_id FROM gl_account_master WHERE account_type = 'EXPENSE' ORDER BY account_code LIMIT 1`);
    let [cash] = await rows(`SELECT gl_account_id FROM gl_account_master WHERE account_type = 'ASSET' AND (account_name LIKE '%Cash%' OR account_name LIKE '%Bank%') LIMIT 1`);
    if (!cash) {
      // The starter chart has no bank or cash account, and an expense is paid from one.
      await must('POST', '/gl-account', { company_id: companyId, account_code: '1100', account_name: 'Cash at Bank (DEMO)', account_type: 'ASSET', is_reconciliation: true });
      [cash] = await rows(`SELECT gl_account_id FROM gl_account_master WHERE account_code = '1100' LIMIT 1`);
    }
    const list = [
      { payee: 'Zesa (DEMO)', description: 'Electricity — farrowing house heaters', amount: 1850 },
      { payee: 'Vet services (DEMO)', description: 'Herd health visit', amount: 640 },
      { payee: 'Hardware (DEMO)', description: 'Drinker nipples and pen repairs', amount: 312.5 },
    ];
    let made = 0;
    for (const e of list) {
      const r = await call('POST', '/expense-documents/expense', {
        ...e, company_id: companyId, posting_date: TODAY, location_id: farm.location_id,
        expense_gl_account_id: expense?.gl_account_id, payment_gl_account_id: cash?.gl_account_id,
      });
      if (ok(r)) made += 1;
      else console.log(`     ${e.payee}: ${why(r)}`);
    }
    return `${made} created`;
  });

  await section('Animal health treatments', 'animal_medication_log', async () => {
    const meds = [await item('DRG000018'), await item('DRG000025')].filter(Boolean);
    for (const m of meds) {
      const g = await must('POST', '/goods-receipt', {
        company_id: companyId, warehouse_id: store.location_id, posting_date: TODAY, remarks: 'Veterinary stock (DEMO)',
        lines: [{ item_id: m.item_id, quantity: 5000, uom: m.uom_primary || 'ML', rate: 0.05, lot_no: `LOT-${TODAY}-${m.item_code}`, expiry_date: '2027-12-31' }],
      });
      await call('POST', `/goods-receipt/${g.receipt_id}/post`, {});
    }
    const sows = await rows(`SELECT animal_id, animal_code FROM animal_register WHERE status IN ('ACTIVE', 'PREGNANT', 'LACTATING') AND animal_type IN ('SOW', 'GILT') ORDER BY animal_code LIMIT 8`);
    let made = 0;
    for (const [i, a] of sows.entries()) {
      const m = meds[i % meds.length];
      const r = await call('POST', `/animal/${a.animal_id}/medications`, {
        item_id: m.item_id, administered_date: TODAY, dose_qty: 5, uom: m.uom_primary || 'ML', administered_by: 'Farm vet (DEMO)',
        notes: i % 2 ? 'Pre-farrowing vaccination' : 'Lameness — treated',
      });
      if (ok(r)) made += 1;
      else if (made === 0 && i < 2) console.log(`     ${a.animal_code}: ${why(r)}`);
    }
    return `${made} treatments`;
  });

  await section('QC and traceability', 'qc_batch_detail', async () => {
    const [grower] = await rows(
      `SELECT b.batch_id, b.batch_no, b.closing_quantity FROM batch_header b JOIN stage_master s ON s.stage_id = b.stage_id
        WHERE s.stage_code = 'GROWER' ORDER BY b.status = 'ACTIVE' DESC, b.start_date DESC LIMIT 1`);
    if (!grower) throw new Error('no grower batch');
    const params = await rows('SELECT param_id qc_param_id, param_code, param_type FROM qc_parameter_master');
    const qc = await call('POST', '/qc', {
      company_id: companyId, source_batch_id: grower.batch_id, qc_date: TODAY, total_qty_received: 20, pass_qty: 19, fail_qty: 1,
      disposition: 'ACCEPT', qc_notes: 'Pre-sale inspection (DEMO)',
      results: params.map((p) => ({ param_id: p.qc_param_id, actual_value: p.param_type === 'NUMERIC' ? (p.param_code === 'LIVE-WT' ? '118' : '12') : p.param_type === 'GRADE' ? 'A' : 'true', ...(p.param_type === 'GRADE' ? { grade_assigned: 'A' } : {}) })),
    });
    const pig = await item('BIO-SWINE-GROWER');
    // QR labels are issued only for an item that has QR turned on.
    if (pig && !pig.is_qr_enabled) await call('PUT', `/item/${pig.item_id}`, { is_qr_enabled: true });
    const qr = await call('POST', '/qr-code', {
      company_id: companyId, batch_id: grower.batch_id, item_id: pig?.item_id, lot_no: grower.batch_no, production_date: TODAY,
      net_weight: 118, gross_weight: 120, pack_uom: 'HEAD', warehouse_id: store.location_id, qc_id: qc.data?.qc_id,
    });
    return `QC ${ok(qc) ? 'recorded' : `refused (${why(qc)})`}, QR ${ok(qr) ? 'issued' : `refused (${why(qr)})`}`;
  });


  await section('Boars and semen collections', 'semen_batch', async () => {
    // The herd is served by AI from bought-in semen, so the Boar Semen AI
    // Station had nothing to show. Two DEMO teaser boars arrive today, in a
    // batch of their own, so no earlier day is owed for them.
    const boarItem = await item('BIO-SWINE-BOAR');
    const [breed] = await rows(`SELECT breed_id FROM breed_master WHERE breed_code = 'TEASER-BOAR'`);
    const [stage] = await rows(`SELECT stage_id FROM stage_master WHERE stage_code = 'INSEMINATION'`);
    const [shed] = await rows(`SELECT location_id FROM location_master WHERE location_type = 'SHED' AND location_code = 'MUFHE1'`);
    const g = await must('POST', '/goods-receipt', {
      company_id: companyId, warehouse_id: store.location_id, posting_date: TODAY, remarks: 'Teaser boars (DEMO)',
      lines: [{ item_id: boarItem.item_id, quantity: 2, uom: 'HEAD', rate: 3200 }],
    });
    await must('POST', `/goods-receipt/${g.receipt_id}/post`, {});
    const ids: string[] = [];
    for (const code of ['TB001', 'TB002']) {
      const a = await must('POST', '/animal', {
        company_id: companyId, nob_id: lob?.nob_id, lob_id: lob?.lob_id, animal_code: code, animal_type: 'BOAR',
        breed_id: breed?.breed_id, gender: 'M', dob: '2024-06-01', entry_type: 'PURCHASED_IMPORTED', entry_date: TODAY,
        source_receipt_id: g.receipt_id, item_id: boarItem.item_id, current_stage_id: stage?.stage_id, current_location_id: shed?.location_id,
      });
      ids.push(a.animal_id);
    }
    const b = await must('POST', '/batch', {
      company_id: companyId, lob_id: lob?.lob_id, operational_area_id: areaRow?.operational_area_id, costing_method: 'BIO_ASSET',
      breed_id: breed?.breed_id, stage_id: stage?.stage_id, shed_id: shed?.location_id, start_date: TODAY, uom: 'HEAD',
      remarks: 'TRIPLEC-DEMO-BOARS', tracking_mode: 'ANIMAL_WISE', animal_ids: ids,
    });
    await call('POST', `/batch/${b.batch_id}/activate`, {});
    let made = 0;
    for (const [i, boarId] of ids.entries()) {
      const r = await call('POST', '/piggery/breeding/semen-collection', {
        company_id: companyId, boar_animal_id: boarId, boar_batch_id: b.batch_id, collection_date: TODAY,
        doses_collected: 18 + i * 4, doses_used_internal: 6, volume_ml: 240 + i * 30, motility_pct: 82 + i * 3, concentration_m_per_ml: 310,
        notes: 'DEMO collection',
      });
      if (ok(r)) made += 1;
      else console.log(`     ${boarId}: ${why(r)}`);
    }
    return `2 boars in ${b.batch_no ?? 'a new batch'}, ${made} collections`;
  });
  await db.end();
}

if (process.argv.includes('--apply')) {
  apply().then(() => process.exit(0), (error) => {
    console.error(`\nFAILED: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
} else {
  console.log('Plan only — add --apply to fill the remaining screens.');
}
