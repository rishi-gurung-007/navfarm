import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = __dirname;
const journal = JSON.parse(readFileSync(join(directory, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; tag: string; when: number }>;
const statements = readFileSync(join(directory, '0262_kill_sheets.sql'), 'utf8').split('--> statement-breakpoint').map((part) => part.replace(/^--.*$/gm, '').trim()).filter(Boolean);

describe('tenant migration 0262 — Kill Sheets', () => {
  it('is journalled after 0261 and its SQL file is discoverable', () => {
    // Found by tag, not as the last entry: later migrations follow it.
    const position = journal.findIndex((e) => e.tag === '0262_kill_sheets');
    expect(journal[position]).toMatchObject({ idx: 259, tag: '0262_kill_sheets' });
    expect(journal[position].when).toBeGreaterThan(journal[position - 1].when);
  });

  it('creates an import root and child records with tenant-safe foreign keys', () => {
    expect(statements.join('\n')).toContain('CREATE TABLE `kill_sheet_import`');
    expect(statements.join('\n')).toContain('CREATE TABLE `kill_sheet_carcass`');
    expect(statements.join('\n')).toContain('CREATE TABLE `kill_sheet_product`');
    expect(statements.join('\n')).toContain('CREATE TABLE `kill_sheet_sick_code`');
    expect(statements.join('\n')).toContain('uq_kill_sheet_import_hash');
    expect(statements.join('\n')).toContain('`tenant_id`,`batch_id`,`individual_sha512`');
    expect(statements.join('\n')).toContain('uq_kill_sheet_carcass_serial');
  });
});
