import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () =>
  JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8'))
    .entries as Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;

describe('Tenant migration 0200 — biological-asset GRN layers (additive)', () => {
  it('is journalled at idx 199 after the biological-asset ledger migration', () => {
    const entries = journal();
    expect(entries.find((entry) => entry.idx === 199)).toEqual({
      idx: 199,
      version: '5',
      when: 1792000000068,
      tag: '0200_bio_asset_grn_entries',
      breakpoints: true,
    });
    expect(entries.find((entry) => entry.idx === 199)!.when).toBeGreaterThan(
      entries.find((entry) => entry.idx === 198)!.when,
    );
  });

  it('adds GRN lineage columns and backfills one purchase layer per posted biological-asset GRN line', () => {
    const sql = statements('0200_bio_asset_grn_entries');
    expect(sql.slice(0, 5)).toEqual([
      'ALTER TABLE `bio_asset_ledger` ADD `remaining_quantity` decimal(18,4);',
      'ALTER TABLE `bio_asset_ledger` ADD `document_line_id` varchar(36);',
      'ALTER TABLE `bio_asset_ledger` ADD `source_entry_id` varchar(36);',
      'CREATE INDEX `bio_asset_ledger_document_line_id_idx` ON `bio_asset_ledger` (`document_line_id`);',
      'CREATE INDEX `bio_asset_ledger_source_entry_id_idx` ON `bio_asset_ledger` (`source_entry_id`);',
    ]);
    expect(sql[5]).toContain('INSERT INTO `bio_asset_ledger`');
    expect(sql[5]).toContain('x.`line_id`');
    expect(sql[5]).toContain('x.`cum` - x.`registered`');
    expect(sql[5]).toContain("g.`status` = 'POSTED'");
    expect(sql[6]).toContain('UPDATE `bio_asset_ledger` b');
    expect(sql[6]).toContain("b.`entry_type` = 'ACQUISITION'");
    expect(sql[6]).toContain('MIN(l2.`line_no`)');
    expect(sql.join('\n')).not.toMatch(
      /\b(DROP TABLE|DELETE FROM|TRUNCATE)\b/i,
    );
  });
});
