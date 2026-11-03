import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MySQL foreign key names are unique across the whole database, not per table. A migration that reuses a name another table already
 * holds fails halfway: MySQL does not roll DDL back, so the tenant is left with some of the migration applied and the journal short
 * of it. (0238's first draft reused `fk_bcr_company` from bio_costing_run and stopped after creating its tables.)
 *
 * The migrations are replayed in order, tracking which table holds each name, so a name that was dropped (or whose table was dropped)
 * may be used again, and a name that is still held may not.
 */
const dir = __dirname;
const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

describe('tenant migrations — foreign key names', () => {
  it('never add a foreign key whose name is still held by another table', () => {
    const held = new Map<string, string>(); // name -> table
    const clashes: string[] = [];
    const add = (name: string, table: string, file: string) => {
      const owner = held.get(name);
      if (owner && owner !== table) clashes.push(`${file}: ${name} on ${table} (already on ${owner})`);
      if (owner === table) clashes.push(`${file}: ${name} on ${table} (already on it)`);
      held.set(name, table);
    };
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8').replace(/--.*$/gm, '');
      // Order matters inside a file: walk its statements.
      for (const statement of sql.split(/;\s*(?:-->\s*statement-breakpoint)?/)) {
        const text = statement.replace(/-->\s*statement-breakpoint/g, '').trim();
        if (!text) continue;
        let m: RegExpMatchArray | null;
        if ((m = text.match(/^DROP TABLE(?: IF EXISTS)?\s+`([^`]+)`/i))) {
          for (const [name, table] of [...held]) if (table === m[1]) held.delete(name);
          continue;
        }
        if ((m = text.match(/^ALTER TABLE\s+`([^`]+)`\s+DROP FOREIGN KEY\s+`([^`]+)`/i))) {
          held.delete(m[2]);
          continue;
        }
        if ((m = text.match(/^ALTER TABLE\s+`([^`]+)`\s+DROP CONSTRAINT\s+`([^`]+)`/i))) {
          held.delete(m[2]);
          continue;
        }
        if ((m = text.match(/^ALTER TABLE\s+`([^`]+)`[\s\S]*?ADD CONSTRAINT\s+`([^`]+)`\s+FOREIGN KEY/i))) {
          add(m[2], m[1], file);
          continue;
        }
        if ((m = text.match(/^CREATE TABLE(?: IF NOT EXISTS)?\s+`([^`]+)`/i))) {
          for (const c of text.matchAll(/CONSTRAINT\s+`([^`]+)`\s+FOREIGN KEY/gi)) add(c[1], m[1], file);
        }
      }
    }
    expect(clashes).toEqual([]);
  });
});
