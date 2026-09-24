/**
 * The rebuild drops databases. These guards are the difference between a demo
 * reset and data loss. Every NAVFarm database is nf_-prefixed (see
 * core/database/database-names.ts); the old navfarm_master / tenant_* names
 * are no longer ours to drop — on a shared MySQL, tenant_* may well be someone
 * else's.
 */
const NAVFARM_DATABASE = /^nf_[a-z0-9_]+$/;

export function assertSafeRebuildTarget(env: Record<string, string | undefined>, databases: string[]): void {
  const host = (env.DATABASE_HOST || '127.0.0.1').trim();
  if (!['127.0.0.1', 'localhost'].includes(host)) {
    throw new Error(`Demo rebuild only runs against a local MySQL; DATABASE_HOST is ${host}.`);
  }
  for (const name of databases) {
    if (name.includes('navcrm') || !NAVFARM_DATABASE.test(name)) throw new Error(`Refusing to drop ${name}.`);
  }
}

export function parseRebuildArgs(argv: string[]): { apply: boolean; chaptersOnly: boolean; skipReset: boolean } {
  const known = new Set(['--apply', '--chapters-only', '--skip-reset']);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length) throw new Error(`Unknown flags: ${unknown.join(', ')}. Use --apply, --chapters-only, --skip-reset.`);
  return { apply: argv.includes('--apply'), chaptersOnly: argv.includes('--chapters-only'), skipReset: argv.includes('--skip-reset') };
}
