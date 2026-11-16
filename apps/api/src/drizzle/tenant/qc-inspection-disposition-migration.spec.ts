import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () =>
  JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;

describe('Tenant migration 0249 — what becomes of a rejected QC quantity (additive)', () => {
  it('is journalled at idx 246, after 0248', () => {
    const entries = journal();
    const e = entries.find((x) => x.idx === 246)!;
    expect(e.tag).toBe('0249_qc_inspection_disposition');
    expect(e.breakpoints).toBe(true);
    expect(e.when).toBeGreaterThan(entries.find((x) => x.idx === 245)!.when);
  });

  it('adds the disposition and its reference to the inspection', () => {
    expect(statements('0249_qc_inspection_disposition')).toEqual([
      'ALTER TABLE `qc_inspection` ADD `rejection_disposition` varchar(25);',
      'ALTER TABLE `qc_inspection` ADD `rejection_ref` varchar(100);',
    ]);
  });
});

describe('Every tenant migration file is journalled', () => {
  // The migrator runs only what the journal names. 0242_qc_inspection_disposition.sql was committed on 4 Nov without a journal entry, so its
  // columns never reached any database and nothing said so until the 10 Nov audit (C3).
  it('has no .sql file the journal does not name', () => {
    const tags = new Set(journal().map((e) => e.tag));
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, -4));
    expect(files.filter((f) => !tags.has(f))).toEqual([]);
  });
});
