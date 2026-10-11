import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0173 — feed_loading_sheet estimated arrival (additive)', () => {
  it('is journalled at idx 172, when 1792000000041', () => {
    expect(journal().find((e) => e.idx === 172)).toEqual({ idx: 172, version: '5', when: 1792000000041, tag: '0173_loading_sheet_estimated_arrival', breakpoints: true });
  });

  it('only adds one nullable datetime column', () => {
    expect(statements('0173_loading_sheet_estimated_arrival')).toEqual([
      'ALTER TABLE `feed_loading_sheet` ADD `estimated_arrival_at` datetime;',
    ]);
  });
});
