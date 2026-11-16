/**
 * Moves costing terms from the costing profile onto the biological Item (item-level costing, Phase 3; docs/superpowers/plans/2026-10-28-item-level-bio-costing.md).
 * Read-only by default; --verify writes inside a transaction, reads the items back and rolls back; --apply commits. It changes only what is empty and never
 * touches history:
 *
 *   1. For each biological item with no costing method, copies the terms (and, for fair value, the rates) of the profile its animals carry (planMove).
 *      An item whose animals carry profiles that disagree is REPORTED and left alone unless you name the profile: --pick=ITEM_CODE=PROFILE_CODE.
 *   2. With --date-animals, gives a live animal of a moved item that has no costing start date the date her item says (birth + start period, never before
 *      arrival). Without it they are only listed: dating an animal starts her being costed, which is a decision.
 *
 * RUN IT BEFORE migration 0230 (which drops the profile tables it reads, and refuses to run on a database whose live animals are still costed only by a profile).
 * Delete this script and its lib once every database has applied 0230.
 *
 * It does NOT clear any animal's costing profile, edit a run, or post anything. Posted and calculated runs keep their profile; an item reads the runs that
 * charged its animals as its own history. Nothing is dropped.
 *
 *   pnpm nx run api:db-move-profiles-to-items                          # print the plan (nf_devco)
 *   pnpm nx run api:db-move-profiles-to-items -- --verify              # write, read back, roll back
 *   pnpm nx run api:db-move-profiles-to-items -- --apply               # commit
 *   --pick=GP-Imp-F=IMP-F (repeat)   --date-animals   --database=nf_x
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { costingStartDate } from '../modules/finance/bio-costing/bio-costing.rules';
import { planMove, type ItemMove, type MoveAnimal, type MoveItem, type MoveProfile, type MoveRate, type MoveSetting, type Pick } from './move-profiles-to-items.lib';

const ITEM_COLUMNS = [
  'bio_costing_method', 'bio_gender', 'bio_start_age_weeks', 'bio_start_age_days', 'bio_useful_life_months', 'bio_residual_rule', 'bio_residual_fixed_amount',
  'bio_residual_weight_kg', 'bio_residual_price_per_kg', 'bio_run_frequency', 'bio_day_basis', 'bio_effective_from', 'bio_auto_post',
  'bio_acquisition_gl_id', 'bio_accum_amort_gl_id', 'bio_amort_expense_gl_id', 'bio_fv_gain_loss_gl_id', 'bio_writeoff_gl_id',
] as const;

async function run() {
  const flags = process.argv.slice(2);
  const mode = flags.find((f) => f === '--verify' || f === '--apply');
  const dateAnimals = flags.includes('--date-animals');
  const database = flags.find((f) => f.startsWith('--database='))?.slice('--database='.length) || 'nf_devco';
  const picks: Pick[] = flags.filter((f) => f.startsWith('--pick=')).map((f) => {
    const [item_code, profile_code] = f.slice('--pick='.length).split('=');
    if (!item_code || !profile_code) throw new Error(`--pick needs ITEM_CODE=PROFILE_CODE, got '${f}'.`);
    return { item_code, profile_code };
  });
  const unknown = flags.filter((f) => f !== mode && f !== '--date-animals' && !f.startsWith('--database=') && !f.startsWith('--pick='));
  if (unknown.length) throw new Error('Use --verify, --apply, --pick=ITEM=PROFILE, --date-animals, --database=<name>, or no flags.');
  const today = new Date().toISOString().slice(0, 10);
  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
    dateStrings: true, // dates stay YYYY-MM-DD strings, which is what the rules compare
  });
  try {
    await db.beginTransaction();
    const [items] = await db.query<RowDataPacket[]>(`SELECT item_id, item_code, company_id, is_biological_asset, bio_costing_method FROM item_master WHERE is_biological_asset = 1 AND deleted_at IS NULL FOR UPDATE`);
    const [animals] = await db.query<RowDataPacket[]>(`SELECT animal_id, animal_code, item_id, gender, costing_profile_id, costing_start_date, is_active, dob, entry_date, age_at_entry_weeks FROM animal_register`);
    const [profiles] = await db.query<RowDataPacket[]>(`SELECT * FROM bio_costing_profile`);
    const [settings] = await db.query<RowDataPacket[]>(`SELECT * FROM bio_costing_residual_setting`);
    const [rates] = await db.query<RowDataPacket[]>(`SELECT * FROM bio_costing_profile_rate`);

    const plan = planMove({
      items: items as unknown as MoveItem[], animals: animals as unknown as MoveAnimal[], profiles: profiles as unknown as MoveProfile[],
      settings: settings as unknown as MoveSetting[], rates: rates as unknown as MoveRate[], picks, today,
    });

    // ---- what the move would do to each animal's costing path ---------------------------------------------------------------
    const movedIds = new Set(plan.moves.map((m) => m.item_id));
    const hasTerms = new Set(items.filter((i) => i.bio_costing_method).map((i) => i.item_id as string));
    // An animal of an item with terms is costed by the item, but only from the date she has; without one the run skips her (NO_AGE) until she is dated.
    const itemPath = (a: RowDataPacket) => (a.costing_start_date || (mode && dateAnimals && movedIds.has(a.item_id)) ? 'ITEM' : 'ITEM_BUT_NO_START_DATE');
    const path = (a: RowDataPacket) => (hasTerms.has(a.item_id) || movedIds.has(a.item_id) ? itemPath(a) : a.costing_profile_id ? 'PROFILE' : 'NONE');
    const live = animals.filter((a) => a.is_active);
    const countBy = (fn: (a: RowDataPacket) => string) => live.reduce<Record<string, number>>((m, a) => ({ ...m, [fn(a)]: (m[fn(a)] ?? 0) + 1 }), {});
    const before = countBy((a) => (hasTerms.has(a.item_id) ? itemPath(a) : a.costing_profile_id ? 'PROFILE' : 'NONE'));
    const after = countBy(path);

    // ---- animals a moved item now covers that have no start date (listed; dated only with --date-animals) -------------------
    const termsOf = new Map(plan.moves.map((m) => [m.item_id, m]));
    const undated = animals.filter((a) => a.is_active && !a.costing_start_date && termsOf.has(a.item_id)).map((a) => {
      const t = termsOf.get(a.item_id)!.terms;
      return { animal_id: a.animal_id as string, animal: a.animal_code as string, item: termsOf.get(a.item_id)!.item_code, would_start: costingStartDate({ dob: a.dob, entry_date: a.entry_date, age_at_entry_weeks: a.age_at_entry_weeks }, t.bio_start_age_weeks, t.bio_start_age_days) };
    });

    // ---- write (inside the transaction; rolled back unless --apply) -------------------------------------------------------------
    const written: string[] = [];
    if (mode) {
      for (const m of plan.moves) {
        const set = ITEM_COLUMNS.map((c) => `${c} = ?`).join(', ');
        const values = ITEM_COLUMNS.map((c) => (c === 'bio_auto_post' ? (m.terms.bio_auto_post ? 1 : 0) : (m.terms as unknown as Record<string, unknown>)[c] ?? null)) as Array<string | number | null>;
        const [res] = await db.execute(`UPDATE item_master SET ${set} WHERE item_id = ? AND bio_costing_method IS NULL`, [...values, m.item_id]) as unknown as [{ affectedRows: number }];
        if (res.affectedRows !== 1) throw new Error(`${m.item_code} was changed by someone else while the plan ran; nothing was written.`);
        for (const r of m.rates) {
          await db.execute(
            'INSERT INTO item_fair_value_rate (rate_id, item_id, farm_id, age_week_from, effective_from, expected_weight_kg, price_per_kg, cdm_based, costs_to_sell_pct) VALUES (?,?,?,?,?,?,?,?,?)',
            [randomUUID(), m.item_id, r.farm_id, r.age_week_from, r.effective_from, r.expected_weight_kg, r.price_per_kg, r.cdm_based ? 1 : 0, r.costs_to_sell_pct],
          );
        }
        written.push(m.item_code);
      }
      if (dateAnimals) for (const u of undated) await db.execute('UPDATE animal_register SET costing_start_date = ? WHERE animal_id = ? AND costing_start_date IS NULL', [u.would_start, u.animal_id]);
    }

    // ---- read back what was written ------------------------------------------------------------------------------------------
    let readBack: unknown = null;
    if (mode && plan.moves.length) {
      const [rows] = await db.query<RowDataPacket[]>(`SELECT item_id, item_code, ${ITEM_COLUMNS.join(', ')} FROM item_master WHERE item_id IN (${plan.moves.map(() => '?').join(',')})`, plan.moves.map((m) => m.item_id));
      const wrong = plan.moves.flatMap((m: ItemMove) => {
        const row = rows.find((r) => r.item_id === m.item_id)!;
        return ITEM_COLUMNS.filter((c) => String(row[c] ?? '') !== String(c === 'bio_auto_post' ? (m.terms.bio_auto_post ? 1 : 0) : (m.terms as unknown as Record<string, unknown>)[c] ?? '') && Number(row[c]) !== Number((m.terms as unknown as Record<string, unknown>)[c])).map((c) => `${m.item_code}.${c}`);
      });
      const [[rateCount]] = await db.query<RowDataPacket[][]>(`SELECT COUNT(*) n FROM item_fair_value_rate`) as unknown as [RowDataPacket[]];
      readBack = { items_read: rows.length, columns_that_differ_from_the_plan: wrong, item_fair_value_rate_rows: Number((rateCount as RowDataPacket).n) };
    }

    console.log(JSON.stringify({
      database, mode: mode || 'READ-ONLY', as_of: today, picks,
      will_move: plan.moves.map((m) => ({ item: m.item_code, from_profiles: m.from_profiles, animals: m.animals, method: m.terms.bio_costing_method, gender: m.terms.bio_gender, start_weeks: m.terms.bio_start_age_weeks,
        life_months: m.terms.bio_useful_life_months, residual: `${m.terms.bio_residual_rule}${m.terms.bio_residual_rule === 'WEIGHT_X_PRICE' ? ` ${m.terms.bio_residual_weight_kg} kg x ${m.terms.bio_residual_price_per_kg}` : m.terms.bio_residual_rule === 'FIXED' ? ` ${m.terms.bio_residual_fixed_amount}` : ''}`,
        frequency: m.terms.bio_run_frequency, costing_from: m.terms.bio_effective_from, rates: m.rates.length, missing_gl: m.missing_gl, notes: m.notes })),
      left_alone: plan.skipped,
      live_animals_costed_by: { before, after },
      undated_animals: { count: undated.length, dated_by_this_run: !!(mode && dateAnimals), detail: undated.map(({ animal_id: _i, ...u }) => u) },
      read_back: readBack,
      runs_changed: 0, profiles_cleared: 0,
    }, null, 2));
    if (mode === '--apply') { await db.commit(); console.log(`Committed. Moved ${written.length} item(s): ${written.join(', ') || 'none'}.`); }
    else { await db.rollback(); console.log(mode ? 'Rolled back; no changes committed.' : 'Read-only; nothing was changed.'); }
  } catch (error) { await db.rollback(); throw error; }
  finally { await db.end(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
