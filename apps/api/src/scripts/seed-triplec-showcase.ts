/**
 * The Triple C showcase tenant in one command, on Windows as on macOS/Linux.
 *
 *   pnpm nx run api:db-seed-triplec-showcase                         # print what it would do
 *   pnpm nx run api:db-seed-triplec-showcase -- --apply              # rebuild from nothing (about 80 min)
 *   pnpm nx run api:db-seed-triplec-showcase -- --apply --from-export <file.sql.gz>
 *                                                                    # import an export, then post the days since (minutes)
 *
 * Rebuild: seed-triplec.ts --recreate (tenant, users, every submitted sheet, opening
 * herd), seed-triplec-activity.ts (masters no sheet covers), seed-triplec-history.ts
 * (the farm played forward from 1 Jan 2025 to yesterday), seed-triplec-pages.ts (the
 * remaining screens). Tenant, name and email domain default to ccc / Triple C Pigs /
 * ccc.com; override with TRIPLEC_TENANT_CODE, TRIPLEC_TENANT_NAME, TRIPLEC_EMAIL_DOMAIN.
 * The HTTP steps need the API running (NAVFARM_API_URL points them elsewhere).
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

process.env.TRIPLEC_TENANT_CODE ||= 'ccc';
process.env.TRIPLEC_TENANT_NAME ||= 'Triple C Pigs';
process.env.TRIPLEC_EMAIL_DOMAIN ||= 'ccc.com';
delete process.env.NX_WORKSPACE_ROOT_PATH;

const api = path.resolve(__dirname, '../..');
const tsNode = require.resolve('ts-node/dist/bin.js', { paths: [api] });
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const exportIndex = args.indexOf('--from-export');
const exportFile =
  exportIndex >= 0 ? path.resolve(args[exportIndex + 1] ?? '') : null;

/** HTTP steps run under tsx; the in-process ones need ts-node for Nest's decorators. */
function run(
  label: string,
  kind: 'tsx' | 'ts-node',
  script: string,
  extra: string[],
) {
  console.log(`== ${label}`);
  const command =
    kind === 'tsx'
      ? [
          process.execPath,
          ['--env-file-if-exists=.env', '--import', 'tsx', script, ...extra],
        ]
      : [
          process.execPath,
          [
            '--env-file-if-exists=.env',
            tsNode,
            '--transpile-only',
            '--project',
            'tsconfig.scripts.json',
            script,
            ...extra,
          ],
        ];
  const result = spawnSync(command[0] as string, command[1] as string[], {
    cwd: api,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(
      `Stopped: ${label} exited with ${result.status ?? result.signal}.`,
    );
    process.exit(result.status ?? 1);
  }
}

const tenant = `${process.env.TRIPLEC_TENANT_CODE} (tenant.admin@${process.env.TRIPLEC_EMAIL_DOMAIN})`;
if (!apply) {
  console.log(
    `Triple C showcase for ${tenant} — plan only. With --apply it DROPS the tenant's database if it exists, then:`,
  );
  if (exportFile)
    console.log(
      `  1. import ${exportFile}\n  2. post every day since the export (history --resume)`,
    );
  else
    console.log(
      '  1. seed-triplec.ts --recreate\n  2. seed-triplec-activity.ts\n  3. seed-triplec-history.ts (1 Jan 2025 to yesterday)\n  4. seed-triplec-pages.ts',
    );
  process.exit(0);
}

if (exportFile) {
  run('1/2 import the export', 'tsx', 'src/scripts/seed-triplec-import.ts', [
    exportFile,
    '--apply',
  ]);
  run(
    '2/2 post the days since the export',
    'ts-node',
    'src/scripts/seed-triplec-history.ts',
    ['--apply', '--resume'],
  );
} else {
  run(
    '1/4 tenant, users and every submitted sheet',
    'tsx',
    'src/scripts/seed-triplec.ts',
    ['--apply', '--recreate'],
  );
  run(
    '2/4 masters no sheet covers',
    'tsx',
    'src/scripts/seed-triplec-activity.ts',
    ['--apply'],
  );
  run(
    '3/4 farm history from 1 Jan 2025',
    'ts-node',
    'src/scripts/seed-triplec-history.ts',
    ['--apply'],
  );
  run('4/4 remaining screens', 'ts-node', 'src/scripts/seed-triplec-pages.ts', [
    '--apply',
  ]);
}
console.log(
  `Done. Log in as tenant.admin@${process.env.TRIPLEC_EMAIL_DOMAIN} / 12345678.`,
);
