import { createHash } from 'node:crypto';

/**
 * The pure half of reconcile-tenant-migrations.ts. drizzle's own migrator applies a migration only when its journal
 * `when` is later than the newest one a database has run, so a database that ran this branch's migrations before another
 * branch's earlier-dated ones were merged silently skips those. The reconcile script instead asks, per migration,
 * "is this file's hash in __drizzle_migrations?", which does not care about order.
 */
export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** drizzle records a migration by the sha256 of its SQL file's text. */
export const migrationHash = (sql: string): string =>
  createHash('sha256').update(sql).digest('hex');

/** drizzle's own split of a file into statements. */
export const statementsOf = (sql: string): string[] =>
  sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

/** The journal's migrations whose hash a database has not recorded, in journal order. */
export function missingMigrations<T extends JournalEntry & { hash: string }>(
  journal: T[],
  appliedHashes: Iterable<string>,
): T[] {
  const applied = new Set(appliedHashes);
  return journal.filter((m) => !applied.has(m.hash));
}

/**
 * MySQL errors that mean "this statement's object is already there" (table, column, key, foreign key). A migration
 * whose statements all land on those was already applied by hand or under another number; it is recorded, not run again.
 */
const ALREADY_THERE = new Set([1050, 1060, 1061, 1826]);
export const alreadyThere = (err: unknown): boolean =>
  ALREADY_THERE.has(Number((err as { errno?: number } | null)?.errno));
