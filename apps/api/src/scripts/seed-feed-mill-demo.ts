/**
 * Seed a demo feed mill (Rishi, 12 Oct). A company with no feed mill shows empty
 * Location (MILL/BIN) and BIN Diet Assignment screens. For one company this
 * creates only what is missing: the MILL and BIN location types, one MILL
 * (MILL-001, 238,000 KG/day), four BINs (MILL-001/BIN-001..004, 30,000 KG) and a
 * BIN Diet Assignment per BIN for today..today+27 (or --from YYYY-MM-DD for --days N), taking the company's active
 * breed lifecycle feed items round-robin. A second run plans nothing.
 *
 * Args: --tenant <tenant_code|db> --company <company_code|id> (resolved as in
 * seed-test-masters.ts). Default is read-only (prints the plan); --verify writes
 * and rolls back; --apply commits. Local databases only.
 */
import { randomUUID } from 'node:crypto';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { resolveCompanyId, resolveTenantDb } from './seed-test-masters.lib';
import { countByTable, planFeedMillDemo, type PlanFacts } from './seed-feed-mill-demo.lib';

const ident = /^[a-zA-Z0-9_]+$/;

export function parseArgs(argv: string[]) {
  const out: { tenant?: string; company?: string; from?: string; days?: number; apply: boolean; verify: boolean } = { apply: false, verify: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--verify') out.verify = true;
    else if (a === '--tenant' || a === '--company') {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value.`);
      out[a === '--tenant' ? 'tenant' : 'company'] = v; i += 1;
    } else if (a === '--from') {
      // 12 Oct: cloned requisitions need assignments on past production dates; start the range here.
      const v = argv[i + 1];
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('--from needs a date as YYYY-MM-DD.');
      out.from = v; i += 1;
    } else if (a === '--days') {
      const v = Number(argv[i + 1]);
      if (!Number.isInteger(v) || v < 1 || v > 366) throw new Error('--days needs a whole number from 1 to 366.');
      out.days = v; i += 1;
    } else throw new Error(`Unknown argument '${a}'. Use --tenant, --company, optionally --from YYYY-MM-DD, --days N, and --verify or --apply.`);
  }
  if (out.apply && out.verify) throw new Error('Use --verify or --apply, not both.');
  if (!out.tenant) throw new Error('--tenant is required.');
  if (!out.company) throw new Error('--company is required.');
  return out as { tenant: string; company: string; from?: string; days?: number; apply: boolean; verify: boolean };
}

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const host = process.env.DATABASE_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`Refusing non-local host '${host}' — this script may only touch local databases.`);
  const connect = (database: string) => mysql.createConnection({
    host, port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
  });
  const master = await connect(process.env.DATABASE_NAME || 'nf_master');
  let tenants: { tenant_code: string; db_name: string }[];
  try { [tenants] = await master.query<RowDataPacket[]>('SELECT tenant_code, db_name FROM tenant_master') as any; } finally { await master.end(); }
  const db = resolveTenantDb(args.tenant, tenants);
  if (!ident.test(db)) throw new Error('Database names may only contain letters, digits and underscores.');

  const conn = await connect(db);
  try {
    const [companies] = await conn.query<RowDataPacket[]>('SELECT company_id, company_code, tenant_id FROM company_master WHERE deleted_at IS NULL') as any;
    const companyId = resolveCompanyId(args.company, db, companies);
    const company = companies.find((c: any) => c.company_id === companyId);
    const q = async (sql: string, params: unknown[]) => (await conn.query<RowDataPacket[]>(sql, params))[0] as any[];

    const types = await q("SELECT DISTINCT type_code FROM location_type_master WHERE tenant_id = ? AND (company_id = ? OR company_id IS NULL) AND type_code IN ('MILL','BIN') AND is_active = 1 AND deleted_at IS NULL", [company.tenant_id, companyId]);
    const [scope] = await q('SELECT nob_id, lob_id FROM location_type_master WHERE tenant_id = ? AND (company_id = ? OR company_id IS NULL) AND nob_id IS NOT NULL AND deleted_at IS NULL ORDER BY company_id IS NULL LIMIT 1', [company.tenant_id, companyId]);
    const locations = await q("SELECT location_id, location_code, location_type, parent_location_id, is_active, bin_feed_type FROM location_master WHERE tenant_id = ? AND company_id = ? AND deleted_at IS NULL AND location_code LIKE 'MILL-001%'", [company.tenant_id, companyId]);
    const feedItems = await q(
      `SELECT i.item_id, i.item_code, i.item_type, t.type_name AS item_type_name, i.feed_form, i.diet_no, i.is_active, MIN(s.stage_sequence) AS ord
         FROM breed_lifecycle_stages b
         JOIN item_master i ON i.item_id = b.feed_item_id AND i.deleted_at IS NULL
         JOIN stage_master s ON s.stage_id = b.stage_id
         LEFT JOIN item_type_master t ON t.tenant_id = i.tenant_id AND t.type_code = i.item_type AND t.deleted_at IS NULL
        WHERE b.company_id = ? AND b.is_active = 1 AND b.feed_item_id IS NOT NULL
        GROUP BY i.item_id, i.item_code, i.item_type, t.type_name, i.feed_form, i.diet_no, i.is_active
        ORDER BY ord, i.item_code`, [companyId]);
    const assignments = await q("SELECT bin_location_id, DATE_FORMAT(production_date, '%Y-%m-%d') AS d FROM bin_diet_assignment WHERE company_id = ? AND is_active = 1 AND deleted_at IS NULL AND production_date >= ?", [companyId, localDate()]);

    const facts: PlanFacts = {
      tenantId: company.tenant_id, companyId, nobId: scope?.nob_id ?? null, lobId: scope?.lob_id ?? null,
      existingTypes: types.map((t) => t.type_code),
      locations: locations.map((l) => ({ ...l, is_active: !!l.is_active })),
      feedItems: feedItems.map((f) => ({ ...f, is_active: !!f.is_active, order: Number(f.ord), diet_no: f.diet_no == null ? null : Number(f.diet_no) })),
      assignments: assignments.map((a) => `${a.bin_location_id}|${a.d}`),
      today: args.from ?? localDate(), days: args.days, newId: randomUUID,
    };
    const plan = planFeedMillDemo(facts);

    let written = 0;
    if (args.apply || args.verify) {
      await conn.beginTransaction();
      try {
        for (const r of plan.rows) {
          const cols = Object.keys(r.row);
          await conn.query(`INSERT INTO \`${r.table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => r.row[c]));
          written += 1;
        }
      } catch (err) { await conn.rollback(); throw err; }
    }

    console.log(`Database: ${db}   Company: ${company.company_code} (${companyId})   Mode: ${args.apply ? 'APPLY' : args.verify ? 'VERIFY' : 'READ-ONLY'}`);
    const counts = countByTable(plan.rows);
    console.table(['location_type_master', 'location_master', 'bin_diet_assignment'].map((t) => ({ table: t, to_create: counts[t] || 0, already_there: plan.exists[t] })));
    for (const n of plan.notes) console.log(`  note: ${n}`);
    console.log(`Written: ${written} row(s).`);
    if (args.apply) { await conn.commit(); console.log('Committed.'); }
    else if (args.verify) { await conn.rollback(); console.log('Verified and rolled back. No changes committed.'); }
    else console.log('Read-only. No changes attempted.');
  } finally { await conn.end(); }
}

if (require.main === module) {
  run().catch((err) => { console.error(String(err.message).slice(0, 300)); if (err.cause?.message) console.error(`Cause: ${err.cause.message}`); process.exit(1); });
}
