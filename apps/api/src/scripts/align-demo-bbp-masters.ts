/** Local demo only. Read-only by default; --schema applies reviewed migrations,
 * --verify rolls back data changes, --apply commits data. Never deletes rows. */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { DOCUMENTED_REASONS } from '../core/database/reason-code-seed';
import { SYSTEM_STAGE_SEED } from '../core/database/system-master-data-seed';
import { BBP_STAGE_RENAMES } from '../core/database/piggery-bbp-stage-seed';
import { MASTER_CODE_UNIQUE_KEYS } from '../core/database/master-code-uniqueness';
import { readMigrationFiles } from 'drizzle-orm/migrator';

async function run() {
  const mode = process.argv[2] || 'READ_ONLY';
  if (process.argv.length > 3 || !['READ_ONLY', '--schema', '--verify', '--apply'].includes(mode)) throw new Error('Use no flags, --schema, --verify or --apply.');
  const db = await mysql.createConnection({ host: '127.0.0.1', user: 'root', database: 'tenant_devco' });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-bbp-master-alignment', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another alignment is running.');
    const [companies] = await db.query<RowDataPacket[]>('SELECT tenant_id,company_id,company_code FROM company_master');
    if (companies.length !== 1 || companies[0].company_code !== 'APEXBREED') throw new Error('Expected only the approved Apex demo company.');
    const { tenant_id: tenant, company_id: company } = companies[0];
    const [[lob]] = await db.query<RowDataPacket[]>("SELECT lob_id,nob_id FROM lob_master WHERE lob_code='LVS_PIGGERY'");
    if (!lob) throw new Error('Piggery LOB missing.');
    const [[batches]] = await db.query<RowDataPacket[]>('SELECT COUNT(*) n FROM batch_header');
    const [[schedule]] = await db.query<RowDataPacket[]>('SELECT COUNT(*) n FROM scheduler_parameter_line');
    if (Number(batches.n) || Number(schedule.n)) throw new Error('Operational batch/scheduler data now exists; review stage-code references before alignment.');
    if (mode === '--schema') {
      const [[last]] = await db.query<RowDataPacket[]>('SELECT MAX(created_at) stamp FROM __drizzle_migrations');
      if (Number(last.stamp) < 1788636511934) throw new Error('Database is behind the reviewed migration baseline.');
      const folder = resolve('src/drizzle/tenant');
      const pending = readMigrationFiles({ migrationsFolder: folder }).filter((m) => m.folderMillis > Number(last.stamp));
      // This tool is not a general-purpose all-future-migrations deployment.
      for (const migration of pending) for (const statement of migration.sql) {
        if (!/^\s*(CREATE TABLE `reason_master`|ALTER TABLE `reason_master` ADD CONSTRAINT|ALTER TABLE `[a-z_]+` ADD CONSTRAINT `uq_[a-z_]+_scope_code` UNIQUE)/.test(statement)) throw new Error('Unreviewed pending migration; stop for review.');
      }
      for (const [table, keys] of Object.entries(MASTER_CODE_UNIQUE_KEYS)) {
        const columns = ['tenant_id', 'company_id', ...keys].map((key) => '`' + key + '`').join(',');
        const [duplicates] = await db.query<RowDataPacket[]>('SELECT COUNT(*) n FROM `' + table + '` GROUP BY ' + columns + ' HAVING COUNT(*) > 1');
        if (duplicates.length) throw new Error(`Duplicate identities in ${table}; no automatic deletion or renaming will be performed.`);
      }
      await migrate(drizzle(db), { migrationsFolder: resolve('src/drizzle/tenant') });
      console.log('Reviewed additive schema migrations applied to tenant_devco. No demo records changed.');
      return;
    }
    await db.beginTransaction();
    const write = mode !== 'READ_ONLY';
    const actions: unknown[] = [];
    for (const scope of [null, company]) {
      const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM stage_master WHERE tenant_id=? AND company_id <=> ? AND lob_id=? FOR UPDATE', [tenant, scope, lob.lob_id]);
      const byCode = new Map<string, RowDataPacket>();
      for (const row of rows) {
        if (byCode.has(row.stage_code)) throw new Error('Duplicate stage codes; no data changed.');
        byCode.set(row.stage_code, row);
      }
      for (const [oldCode, code] of Object.entries(BBP_STAGE_RENAMES)) {
        if (byCode.has(oldCode) && byCode.has(code)) throw new Error(`Both ${oldCode} and ${code} exist; review required.`);
        const old = byCode.get(oldCode);
        if (old) { byCode.delete(oldCode); byCode.set(code, old); }
      }
      const ids = new Map(SYSTEM_STAGE_SEED.map((s) => [s.stage_code, byCode.get(s.stage_code)?.stage_id || randomUUID()]));
      for (const stage of SYSTEM_STAGE_SEED) {
        const id = ids.get(stage.stage_code)!;
        const existing = byCode.get(stage.stage_code);
        actions.push({ scope: scope || 'TENANT', stage: stage.stage_code, action: existing ? 'ALIGN_KEEP_ID' : 'ADD' });
        if (!write) continue;
        const values = [stage.stage_code, stage.stage_name, stage.stage_category, stage.stage_sequence, stage.typical_duration_days ?? null, stage.min_days_before_move, stage.transition_trigger, stage.data_entry_form, stage.stage_description, stage.stage_sequence];
        if (existing) await db.execute('UPDATE stage_master SET stage_code=?,stage_name=?,stage_category=?,stage_sequence=?,typical_duration_days=?,min_days_before_move=?,transition_trigger=?,data_entry_form=?,stage_description=?,sort_order=?,auto_move_on_day=NULL,alt_next_stage_id=NULL,alt_trigger_condition=NULL,is_active=1,deleted_at=NULL,updated_at=NOW() WHERE stage_id=?', [...values, id]);
        else await db.execute('INSERT INTO stage_master (stage_code,stage_name,stage_category,stage_sequence,typical_duration_days,min_days_before_move,transition_trigger,data_entry_form,stage_description,sort_order,stage_id,tenant_id,company_id,nob_id,lob_id,is_system) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)', [...values, id, tenant, scope, lob.nob_id, lob.lob_id]);
      }
      for (const stage of SYSTEM_STAGE_SEED) if (write) await db.execute('UPDATE stage_master SET next_stage_id=? WHERE stage_id=?', [stage.next_stage_code ? ids.get(stage.next_stage_code) : null, ids.get(stage.stage_code)]);
      // Preserve old IDs and any attached historical profiles; do not guess how
      // a combined Flush/Service record maps to the two new stages.
      for (const old of rows) {
        const code = BBP_STAGE_RENAMES[old.stage_code] || old.stage_code;
        if (ids.has(code) || !old.is_active) continue;
        actions.push({ scope: scope || 'TENANT', stage: old.stage_code, action: 'RETAIN_INACTIVE' });
        if (write) await db.execute("UPDATE stage_master SET is_active=0,show_on_animal_card=0,stage_description=CONCAT('Legacy workbook stage; retained for historical references. ',COALESCE(stage_description,'')),updated_at=NOW() WHERE stage_id=?", [old.stage_id]);
      }
      const [reasons] = await db.query<RowDataPacket[]>('SELECT * FROM reason_master WHERE tenant_id=? AND company_id <=> ?', [tenant, scope]);
      for (const reason of DOCUMENTED_REASONS) {
        if (reasons.some((r) => r.reason_code === reason.reason_code)) continue;
        actions.push({ scope: scope || 'TENANT', reason: reason.reason_code, action: 'ADD_DOCUMENTED_EXAMPLE' });
        if (write) await db.execute('INSERT INTO reason_master (reason_id,tenant_id,company_id,reason_code,reason_name,category,sub_category,applicable_stages,stage_filter_note,mandatory_comment,mandatory_weight) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [randomUUID(), tenant, scope, reason.reason_code, reason.reason_name, reason.category, reason.sub_category, reason.applicable_stages ? JSON.stringify(reason.applicable_stages) : null, reason.stage_filter_note, reason.mandatory_comment, reason.mandatory_weight]);
      }
      const [series] = await db.query<RowDataPacket[]>("SELECT series_id FROM no_series_master WHERE tenant_id=? AND company_id <=> ? AND series_code='REASON'", [tenant, scope]);
      if (series.length > 1) throw new Error('Duplicate REASON series; review required.');
      if (!series.length) {
        actions.push({ scope: scope || 'TENANT', series: 'REASON', action: 'ADD_RSN_PREFIX' });
        if (write) await db.execute("INSERT INTO no_series_master (series_id,tenant_id,company_id,series_code,series_name,document_type,prefix,`separator`,seq_length,current_seq,reset_frequency,allow_manual) VALUES (?,?,?,'REASON','Reason Code','REASON','RSN','-',3,0,'NEVER',1)", [randomUUID(), tenant, scope]);
      }
      if (write) {
        const [active] = await db.query<RowDataPacket[]>('SELECT stage_code FROM stage_master WHERE tenant_id=? AND company_id <=> ? AND lob_id=? AND is_active=1', [tenant, scope, lob.lob_id]);
        if (JSON.stringify(active.map((s) => s.stage_code).sort()) !== JSON.stringify(SYSTEM_STAGE_SEED.map((s) => s.stage_code).sort())) throw new Error('Unexpected additional active stages; rolling back for review.');
      }
    }
    console.log(JSON.stringify({ mode, actions, operationalRecordsDeleted: 0 }, null, 2));
    if (mode === '--apply') { await db.commit(); console.log('Committed BBP stage alignment and documented reasons.'); }
    else { await db.rollback(); console.log('No data changes committed.'); }
  } catch (error) { await db.rollback(); throw error; }
  finally { await db.end(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
