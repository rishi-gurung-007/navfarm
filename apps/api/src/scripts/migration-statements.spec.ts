import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The tenant migrator runs each chunk between `--> statement-breakpoint` lines as ONE query, and mysql2 refuses two statements in one query.
 * A migration with two statements and no breakpoint passed every unit test and then failed the whole database rebuild at its bootstrap step
 * (0212, 21 Oct 2026). Checked for the migrations written since 0200, which were all written by hand.
 */
describe('tenant migrations: one statement between breakpoints', () => {
  const dir = join(__dirname, '..', 'drizzle', 'tenant');
  const files = readdirSync(dir).filter((f) => /^0\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 200);

  it.each(files)('%s', (file) => {
    const chunks = readFileSync(join(dir, file), 'utf8').split(/^--> statement-breakpoint\s*$/m);
    for (const chunk of chunks) {
      const code = chunk.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      const statements = code.split(/;\s*(?:\n|$)/).map((x) => x.trim()).filter(Boolean);
      expect(statements.length).toBeLessThanOrEqual(1);
    }
  });
});
