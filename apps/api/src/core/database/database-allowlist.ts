/**
 * Opt-in runtime isolation guard. See database-allowlist.spec.ts for why.
 */
export const DB_ALLOWLIST_ENV = 'NAVFARM_DB_ALLOWLIST';

export function assertDatabaseAllowed(
  database: string,
  context: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const raw = env[DB_ALLOWLIST_ENV];
  if (raw === undefined) return;

  const allowed = raw.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
  // A registry row can carry a null db_name; that is a refusal, not a crash.
  const requested = (database ?? '').trim().toLowerCase();
  if (!allowed.includes(requested)) {
    throw new Error(
      `Refusing to connect to database '${requested}' (${context}): not on ${DB_ALLOWLIST_ENV}.`,
    );
  }
}
