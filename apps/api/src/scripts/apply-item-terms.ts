/**
 * Puts the sheet's costing figures (fixed-asset-items.lib.ts: the Fixed Asset sheet) on the biological items that have been created (item-level costing,
 * Phase 6; docs/superpowers/plans/2026-10-28-item-level-bio-costing.md). Read-only by default; --verify writes inside a transaction, reads the items back and
 * rolls back; --apply commits. It creates no item and no GL account, overwrites no item that already has a method, and takes the Costing From date only from
 * --costing-from (the sheet gives none), so nothing in it is ours.
 *
 *   pnpm nx run api:db-apply-item-terms                                        # print the plan (nf_devco)
 *   pnpm nx run api:db-apply-item-terms -- --verify --costing-from=2026-01-01   # write, read back, roll back
 *   pnpm nx run api:db-apply-item-terms -- --apply --costing-from=2026-01-01    # commit
 *   --database=nf_x
 *
 * GL accounts are matched by the names the sheet gives; an account the chart does not hold under that name is reported and left unset.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { BIO_COSTING_COLUMNS } from '../modules/master-data/item/item-bio-costing.rules';
import { FINANCE_STILL_OWES, planSheetTerms, type FoundAccount, type FoundItem } from './apply-item-terms.lib';

async function run() {
  const flags = process.argv.slice(2);
  const mode = flags.find((f) => f === '--verify' || f === '--apply');
  const database = flags.find((f) => f.startsWith('--database='))?.slice('--database='.length) || 'nf_devco';
  const costingFrom = flags.find((f) => f.startsWith('--costing-from='))?.slice('--costing-from='.length) || null;
  const unknown = flags.filter((f) => f !== mode && !f.startsWith('--database=') && !f.startsWith('--costing-from='));
  if (unknown.length) throw new Error('Use --verify, --apply, --costing-from=YYYY-MM-DD, --database=<name>, or no flags.');
  if (costingFrom && !/^\d{4}-\d{2}-\d{2}$/.test(costingFrom)) throw new Error(`--costing-from must be YYYY-MM-DD, got '${costingFrom}'.`);
  const db = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '', database,
    dateStrings: true,
  });
  try {
    await db.beginTransaction();
    const [items] = await db.query<RowDataPacket[]>(`SELECT item_id, item_code, company_id, is_biological_asset, bio_costing_method FROM item_master WHERE deleted_at IS NULL FOR UPDATE`);
    const [accounts] = await db.query<RowDataPacket[]>(`SELECT gl_account_id, account_name, company_id FROM gl_account_master WHERE deleted_at IS NULL AND is_active = 1`);
    const plan = planSheetTerms({ items: items as unknown as FoundItem[], accounts: accounts as unknown as FoundAccount[], costingFrom });

    const written: string[] = [];
    const readBack: Array<{ item: string; columns_that_differ_from_the_plan: string[]; rates: number }> = [];
    if (mode) {
      for (const p of plan.filter((e) => e.status === 'READY' && e.terms)) {
        const terms = p.terms!;
        const set = BIO_COSTING_COLUMNS.map((c) => `${c} = ?`).join(', ');
        const values = BIO_COSTING_COLUMNS.map((c) => (c === 'bio_auto_post' ? (terms.bio_auto_post ? 1 : 0) : ((terms as unknown as Record<string, unknown>)[c] ?? null))) as Array<string | number | null>;
        const [res] = await db.execute(`UPDATE item_master SET ${set} WHERE item_id = ? AND bio_costing_method IS NULL`, [...values, p.item_id!]) as unknown as [{ affectedRows: number }];
        if (res.affectedRows !== 1) throw new Error(`${p.item_code} was changed by someone else while the plan ran; nothing was written.`);
        if (p.rate) {
          await db.execute(
            'INSERT INTO item_fair_value_rate (rate_id, item_id, farm_id, age_week_from, effective_from, expected_weight_kg, price_per_kg, cdm_based, costs_to_sell_pct) VALUES (?,?,?,?,?,?,?,?,?)',
            [randomUUID(), p.item_id!, p.rate.farm_id, p.rate.age_week_from, p.rate.effective_from, p.rate.expected_weight_kg, p.rate.price_per_kg, p.rate.cdm_based ? 1 : 0, p.rate.costs_to_sell_pct],
          );
        }
        written.push(p.item_code);
      }
      // ---- read back from MySQL, not from what was just sent ---------------------------------------------------------------
      for (const p of plan.filter((e) => written.includes(e.item_code))) {
        const [[row]] = await db.query<RowDataPacket[][]>(`SELECT ${BIO_COSTING_COLUMNS.join(', ')} FROM item_master WHERE item_id = ?`, [p.item_id!]) as unknown as [RowDataPacket[]];
        const [[rates]] = await db.query<RowDataPacket[][]>('SELECT COUNT(*) n FROM item_fair_value_rate WHERE item_id = ?', [p.item_id!]) as unknown as [RowDataPacket[]];
        const planned = p.terms as unknown as Record<string, unknown>;
        const differ = BIO_COSTING_COLUMNS.filter((c) => {
          const want = c === 'bio_auto_post' ? (planned[c] ? 1 : 0) : planned[c] ?? null;
          const got = (row as RowDataPacket)[c] ?? null;
          return want === null || got === null ? want !== got : String(want) !== String(got) && Number(want) !== Number(got);
        });
        readBack.push({ item: p.item_code, columns_that_differ_from_the_plan: [...differ], rates: Number((rates as RowDataPacket).n) });
      }
    }

    console.log(JSON.stringify({
      database, mode: mode || 'READ-ONLY', costing_from: costingFrom,
      items: plan.map((p) => ({
        item: p.item_code, status: p.status,
        terms: p.terms && { method: p.terms.bio_costing_method, gender: p.terms.bio_gender, start_weeks: p.terms.bio_start_age_weeks, life_months: p.terms.bio_useful_life_months,
          residual: p.terms.bio_residual_rule === 'WEIGHT_X_PRICE' ? `${p.terms.bio_residual_weight_kg} kg x ${p.terms.bio_residual_price_per_kg}` : p.terms.bio_residual_rule, costing_from: p.terms.bio_effective_from },
        rate: p.rate && `${p.rate.expected_weight_kg} kg x ${p.rate.price_per_kg}, CDM based ${p.rate.cdm_based ? 'Yes' : 'No'}, from ${p.rate.effective_from}`,
        accounts_set: p.accounts_set, accounts_not_in_chart: p.accounts_not_in_chart, still_needed_before_a_run_can_post: p.missing_for_run, notes: p.notes,
      })),
      finance_still_owes_for_every_item: FINANCE_STILL_OWES,
      read_back: mode ? readBack : null,
      items_created: 0, accounts_created: 0, animals_touched: 0, runs_made: 0,
    }, null, 2));
    if (mode === '--apply') { await db.commit(); console.log(`Committed. Terms put on ${written.length} item(s): ${written.join(', ') || 'none'}.`); }
    else { await db.rollback(); console.log(mode ? 'Rolled back; no changes committed.' : 'Read-only; nothing was changed.'); }
  } catch (error) { await db.rollback(); throw error; }
  finally { await db.end(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
