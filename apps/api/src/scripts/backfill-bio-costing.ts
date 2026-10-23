/**
 * Brings an existing tenant's animals into bio-asset costing (bio-asset costing, Phase 6). Read-only by default; --verify makes the
 * changes inside a transaction and rolls them back; --apply commits. It changes only two things, both nullable or derived, and
 * never touches history:
 *
 *   1. Assigns the matching active costing profile (and the date costing begins) to every live animal that has none. The same rule
 *      the API uses at registration (resolveProfile, costingStartDate), as of today.
 *   2. Refreshes the register's cached book value, total amortised and current value from each animal's own bio-asset ledger.
 *
 * It REPORTS, and does not change, what needs a decision or a posting:
 *   - capitalised cost the ledger holds against an animal-wise batch rather than against its animals (written before the cost carried
 *     the animal), with the live head it could be shared over: allocating it is the client's call;
 *   - animals that died with amortisation that was never cleared against the acquisition cost (no BIO_ASSET_EXIT journal);
 *   - animals no profile fits (and why), and animals the ledger has never seen.
 * It runs NO costing run: charging past periods is a backfill the client must ask for.
 *
 *   pnpm nx run api:db-backfill-bio-costing                       # print the plan (nf_devco)
 *   pnpm nx run api:db-backfill-bio-costing -- --verify           # write, read back, roll back
 *   pnpm nx run api:db-backfill-bio-costing -- --apply            # commit
 *   --database=nf_x to name another tenant database
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { originOf, resolveProfile, costingStartDate, type ResolvableProfile } from '../modules/finance/bio-costing/bio-costing.rules';
import { BOOK_VALUE_ENTRY_TYPES, summariseAnimalValue } from '../modules/inventory/bio-asset-ledger/animal-book-value.service';

const TOL = 0.005;
const money = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;

async function run() {
  const flags = process.argv.slice(2);
  const mode = flags.find((f) => f === '--verify' || f === '--apply');
  const database = flags.find((f) => f.startsWith('--database='))?.slice('--database='.length) || 'nf_devco';
  const unknown = flags.filter((f) => f !== mode && !f.startsWith('--database='));
  if (unknown.length) throw new Error('Use --verify, --apply, --database=<name>, or no flags.');
  const today = new Date().toISOString().slice(0, 10);
  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
    // The rules compare dates as YYYY-MM-DD strings; without this mysql2 hands back Date objects and every comparison quietly fails.
    dateStrings: true,
  });
  try {
    await db.beginTransaction();
    const types = BOOK_VALUE_ENTRY_TYPES.map((t) => `'${t}'`).join(',');

    // ---- 1. profile assignment -------------------------------------------------------------------------------------------
    const [profileRows] = await db.query<RowDataPacket[]>(`SELECT * FROM bio_costing_profile WHERE status IN ('ACTIVE','SUPERSEDED')`);
    const [unassigned] = await db.query<RowDataPacket[]>(
      `SELECT animal_id, animal_code, company_id, item_id, breed_id, gender, entry_type, dob, entry_date, age_at_entry_weeks
         FROM animal_register WHERE is_active = 1 AND costing_profile_id IS NULL ORDER BY animal_code FOR UPDATE`);
    const assigned: Array<{ animal: string; profile: string; costing_start_date: string | null }> = [];
    const notAssigned: Array<{ animal: string; reason: string; detail?: string }> = [];
    for (const a of unassigned) {
      const mine = profileRows.filter((p) => p.company_id === a.company_id) as unknown as ResolvableProfile[];
      const origin = originOf(a.entry_type);
      const { profile, ambiguous } = resolveProfile(mine, { item_id: a.item_id, breed_id: a.breed_id, gender: a.gender, origin }, today);
      if (ambiguous.length) { notAssigned.push({ animal: a.animal_code, reason: 'AMBIGUOUS_PROFILES', detail: ambiguous.map((x) => x.profile_code).join(', ') }); continue; }
      if (!profile) { notAssigned.push({ animal: a.animal_code, reason: origin ? 'NO_MATCHING_PROFILE' : 'ORIGIN_UNKNOWN', detail: a.entry_type }); continue; }
      const start = costingStartDate({ dob: a.dob, entry_date: a.entry_date, age_at_entry_weeks: a.age_at_entry_weeks }, profile.start_age_weeks);
      assigned.push({ animal: a.animal_code, profile: profile.profile_code, costing_start_date: start });
      if (mode) await db.execute('UPDATE animal_register SET costing_profile_id = ?, costing_start_date = ? WHERE animal_id = ?', [profile.profile_id, start, a.animal_id]);
    }

    // ---- 2. cache refresh ---------------------------------------------------------------------------------------------------
    const [ledger] = await db.query<RowDataPacket[]>(
      `SELECT a.animal_id, a.animal_code, a.book_value, a.total_amortised, l.entry_type, SUM(l.cost_amount) total
         FROM animal_register a JOIN bio_asset_ledger l ON l.animal_id = a.animal_id AND l.entry_type IN (${types})
        GROUP BY a.animal_id, a.animal_code, a.book_value, a.total_amortised, l.entry_type`);
    type CacheRow = { code: string; cache_bv: number; cache_am: number; rows: Array<{ entry_type: string; total: string }> };
    const byAnimal = new Map<string, CacheRow>();
    for (const r of ledger) {
      const e: CacheRow = byAnimal.get(r.animal_id) ?? { code: r.animal_code, cache_bv: Number(r.book_value ?? 0), cache_am: Number(r.total_amortised ?? 0), rows: [] };
      e.rows.push({ entry_type: r.entry_type, total: r.total });
      byAnimal.set(r.animal_id, e);
    }
    const refreshed: Array<{ animal: string; cache_book_value: number; ledger_book_value: number; cache_amortised: number; ledger_amortised: number }> = [];
    for (const [id, e] of byAnimal) {
      const v = summariseAnimalValue(e.rows);
      if (Math.abs(v.bookValue - e.cache_bv) > TOL || Math.abs(v.amortised - e.cache_am) > TOL) {
        refreshed.push({ animal: e.code, cache_book_value: money(e.cache_bv), ledger_book_value: money(v.bookValue), cache_amortised: money(e.cache_am), ledger_amortised: money(v.amortised) });
        if (mode) await db.execute('UPDATE animal_register SET book_value = ?, total_amortised = ?, current_bio_asset_value = ? WHERE animal_id = ?', [v.bookValue.toFixed(4), v.amortised.toFixed(4), v.bookValue.toFixed(4), id]);
      }
    }

    // ---- 3. report only -----------------------------------------------------------------------------------------------------
    const [unallocated] = await db.query<RowDataPacket[]>(
      `SELECT b.batch_no, ROUND(SUM(l.cost_amount),4) unallocated_capitalised_cost,
              (SELECT COUNT(*) FROM animal_register a WHERE a.current_batch_id = b.batch_id AND a.is_active = 1) live_head
         FROM bio_asset_ledger l JOIN batch_header b ON b.batch_id = l.batch_id
        WHERE l.animal_id IS NULL AND l.entry_type IN ('CONSUMPTION','OVERHEAD','OVERHEAD_COST','GROWTH_ADJMT') AND b.animal_tracking = 'REGISTERED'
        GROUP BY b.batch_id, b.batch_no HAVING ABS(SUM(l.cost_amount)) > ${TOL}`);
    const [uncleared] = await db.query<RowDataPacket[]>(
      `SELECT a.animal_code, p.profile_code, ROUND(-SUM(l.cost_amount),4) amortised_not_cleared
         FROM animal_register a JOIN bio_costing_profile p ON p.profile_id = a.costing_profile_id
         JOIN bio_asset_ledger l ON l.animal_id = a.animal_id AND l.entry_type = 'AMORTIZATION'
        WHERE a.is_active = 0 AND a.disposal_type = 'DIED'
          AND NOT EXISTS (SELECT 1 FROM journal_header j WHERE j.source_document_type = 'BIO_ASSET_EXIT' AND j.source_document_no = a.animal_code AND j.status = 'POSTED')
        GROUP BY a.animal_code, p.profile_code HAVING ABS(SUM(l.cost_amount)) > ${TOL}`);
    const [noLedger] = await db.query<RowDataPacket[]>(
      `SELECT animal_code FROM animal_register a WHERE NOT EXISTS (SELECT 1 FROM bio_asset_ledger l WHERE l.animal_id = a.animal_id AND l.entry_type IN (${types}))`);

    console.log(JSON.stringify({
      database, mode: mode || 'READ-ONLY', as_of: today, profiles_in_force: profileRows.length,
      assign_profile: { animals: assigned.length, by_profile: assigned.reduce<Record<string, number>>((m, x) => ({ ...m, [x.profile]: (m[x.profile] ?? 0) + 1 }), {}), detail: assigned },
      not_assigned: notAssigned,
      refresh_cache: { animals: refreshed.length, detail: refreshed },
      report_only: {
        batch_level_capitalised_cost_not_on_animals: unallocated.map((r) => ({ ...r })),
        died_with_amortisation_not_cleared: uncleared.map((r) => ({ ...r })),
        animals_with_no_ledger_rows: noLedger.map((r) => r.animal_code),
      },
      costing_runs_made: 0,
    }, null, 2));
    if (mode === '--apply') { await db.commit(); console.log('Committed.'); }
    else { await db.rollback(); console.log(mode ? 'Rolled back; no changes committed.' : 'Read-only; nothing was changed.'); }
  } catch (error) { await db.rollback(); throw error; }
  finally { await db.end(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
