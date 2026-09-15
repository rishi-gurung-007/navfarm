/** The rebuild drops databases. These guards are the difference between a demo reset and data loss. */
export const NAVFARM_DATABASE = /^(navfarm_master|tenant_system|tenant_[a-z0-9_]+)$/;

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
