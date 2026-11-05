import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () =>
  JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;

describe('Tenant migration 0246 — an item\'s own fair value loss account (additive)', () => {
  it('is journalled at idx 243, after the death destination migration', () => {
    const entries = journal();
    const e = entries.find((x) => x.idx === 243)!;
    expect(e.tag).toBe('0246_item_fv_loss_gl');
    expect(e.breakpoints).toBe(true);
    expect(e.when).toBeGreaterThan(entries.find((x) => x.idx === 242)!.when);
  });

  it('adds one nullable column to item_master and nothing else', () => {
    expect(statements('0246_item_fv_loss_gl')).toEqual(['ALTER TABLE `item_master` ADD `bio_fv_loss_gl_id` varchar(36);']);
  });
});
