import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const sql = readFileSync(
  join(dir, '0210_repair_bio_asset_grn_source_entries.sql'),
  'utf8',
);
const journal = JSON.parse(
  readFileSync(join(dir, 'meta/_journal.json'), 'utf8'),
).entries as Array<{
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}>;

describe('Tenant migration 0210 — repair biological-asset GRN source entries', () => {
  it('is journalled after the loading-sheet migration', () => {
    expect(journal.find((entry) => entry.idx === 207)).toEqual({
      idx: 207,
      version: '5',
      when: 1792000000078,
      tag: '0210_repair_bio_asset_grn_source_entries',
      breakpoints: true,
    });
  });

  it('maps historical registrations across cumulative GRN lines without destructive operations', () => {
    expect(sql).toContain('ROW_NUMBER() OVER');
    expect(sql).toContain('SUM(gl.`quantity`) OVER');
    expect(sql).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING');
    expect(sql).toContain('SET b.`source_entry_id` = source_line.`entry_id`');
    expect(sql).not.toMatch(/\b(DROP TABLE|DELETE FROM|TRUNCATE)\b/i);
  });
});
