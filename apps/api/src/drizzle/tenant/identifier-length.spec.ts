import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MySQL refuses identifiers longer than 64 characters. Migration 0168 first
 * shipped a 68-character foreign-key name; MySQL DDL is not transactional, so
 * its ADD COLUMN stuck while the ADD CONSTRAINT failed and the journal row was
 * never written — the same retry hazard as 0139. Guard every constraint and
 * index name in every tenant migration (11 Oct).
 */
describe('tenant migrations — identifier length', () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f));

  it('names no constraint or index longer than MySQL allows (64)', () => {
    const tooLong: string[] = [];
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8');
      for (const m of sql.matchAll(/(?:CONSTRAINT|INDEX|KEY)\s+`([^`]+)`/gi)) {
        if (m[1].length > 64) tooLong.push(`${f}: ${m[1]} (${m[1].length})`);
      }
    }
    expect(tooLong).toEqual([]);
  });
});
