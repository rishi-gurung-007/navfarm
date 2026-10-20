/**
 * Seeds the client's bio-asset costing rules as DRAFT central costing profiles (bio-asset costing, Phase 3). The figures and what
 * is "ours" are in seed-bio-costing-profiles.lib.ts. Read-only by default; --verify writes inside a transaction and rolls back;
 * --apply commits. Refuses to touch a database that already holds costing profiles.
 *
 *   pnpm nx run api:db-seed-bio-costing-profiles                       # print the plan
 *   pnpm nx run api:db-seed-bio-costing-profiles -- --verify
 *   pnpm nx run api:db-seed-bio-costing-profiles -- --apply
 *   --database=nf_x   --company-id=<uuid> (required when the database has more than one company)
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { CLIENT_DRAFT_PROFILES } from './seed-bio-costing-profiles.lib';

async function run() {
  const flags = process.argv.slice(2);
  const mode = flags.find((f) => f === '--verify' || f === '--apply');
  const database = flags.find((f) => f.startsWith('--database='))?.slice('--database='.length) || 'nf_devco';
  const wantedCompany = flags.find((f) => f.startsWith('--company-id='))?.slice('--company-id='.length);
  const unknown = flags.filter((f) => f !== mode && !f.startsWith('--database=') && !f.startsWith('--company-id='));
  if (unknown.length) throw new Error('Use --verify, --apply, --database=<name>, --company-id=<uuid>, or no flags.');
  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
  });
  try {
    await db.beginTransaction();
    const [existing] = await db.query<RowDataPacket[]>('SELECT COUNT(*) n FROM bio_costing_profile FOR UPDATE');
    if (Number(existing[0].n) > 0) throw new Error(`${database} already holds ${existing[0].n} costing profile(s); this seed only fills an empty table.`);
    const [companies] = await db.query<RowDataPacket[]>('SELECT company_id, tenant_id, company_name FROM company_master' + (wantedCompany ? ' WHERE company_id = ?' : ''), wantedCompany ? [wantedCompany] : []);
    if (companies.length !== 1) throw new Error(`Expected exactly one company, found ${companies.length}; name it with --company-id=<uuid>.`);
    const company = companies[0];
    const today = new Date().toISOString().slice(0, 10);
    console.log(JSON.stringify({
      database, mode: mode || 'READ-ONLY', company: company.company_name, effective_from: `${today} (ours: the documents give none)`,
      profiles: CLIENT_DRAFT_PROFILES.map((p) => ({ code: p.profile_code, scope: `${p.origin} ${p.gender}`, method: p.costing_method, start_week: p.start_age_weeks, life_months: p.useful_life_months,
        residual: p.residual_rule === 'NONE' ? 'none' : `${p.residual_weight_kg} kg x ${p.residual_price_per_kg} (${p.residual_applies_gender} only)`, rate: p.rate ?? 'none', status: 'DRAFT, no GL accounts' })),
    }, null, 2));
    if (mode) {
      for (const p of CLIENT_DRAFT_PROFILES) {
        const id = randomUUID();
        await db.execute(
          `INSERT INTO bio_costing_profile (profile_id, tenant_id, company_id, profile_code, name, gender, origin, costing_method, start_age_weeks, useful_life_months,
             residual_rule, residual_weight_kg, residual_price_per_kg, residual_applies_gender, run_frequency, day_basis, tracking, auto_post, effective_from, status)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'MONTHLY','FREQUENCY_DAYS','INDIVIDUAL', 0, ?, 'DRAFT')`,
          [id, company.tenant_id, company.company_id, p.profile_code, p.name, p.gender, p.origin, p.costing_method, p.start_age_weeks, p.useful_life_months,
            p.residual_rule, p.residual_weight_kg, p.residual_price_per_kg, p.residual_applies_gender, today]);
        if (p.rate) {
          await db.execute(
            `INSERT INTO bio_costing_profile_rate (rate_id, profile_id, age_week_from, effective_from, expected_weight_kg, price_per_kg, cdm_based) VALUES (?,?,0,?,?,?,?)`,
            [randomUUID(), id, today, p.rate.expected_weight_kg, p.rate.price_per_kg, p.rate.cdm_based ? 1 : 0]);
        }
      }
      const [n] = await db.query<RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM bio_costing_profile) profiles, (SELECT COUNT(*) FROM bio_costing_profile_rate) rates');
      console.log(`Written inside the transaction: ${n[0].profiles} profiles, ${n[0].rates} rates.`);
    }
    if (mode === '--apply') { await db.commit(); console.log('Committed.'); }
    else { await db.rollback(); console.log('Rolled back; no changes committed.'); }
  } catch (error) { await db.rollback(); throw error; }
  finally { await db.end(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
