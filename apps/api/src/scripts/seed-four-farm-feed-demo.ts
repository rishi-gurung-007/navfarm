/**
 * The four-farm feed demo master seed (plan Task 3) — the nine-farm stage's
 * replacement in the active master chain.
 *
 * Default is read-only; --verify applies and rolls back; --apply commits.
 *
 * MASTERS ONLY, per the 2026-09-30 decision: one tenant/company/area already
 * exist (seed-dev-tenant.ts and the platform steps own those), and this
 * script seeds the approved four-farm location graph, its silo topology, and
 * nothing operational — no batch, no animal, no ledger movement, no
 * requisition, no forecast run. Operational chapters stay in
 * demo/chapters/*, posted by demo-chapters.ts, and remain a separate run.
 *
 * What replaces what, and why:
 *   seed-nine-farm-demo.ts hardcodes nine submitted farms, one silo per shed,
 *   and a store on every farm; the demo matrix is now exactly four farms
 *   exercising 1:1, one-silo-to-many-sheds, many-to-many and mixed topology
 *   (decisions.md, 2026-09-30). The nine-farm script stays in the repo — it
 *   is the only seeder of the Triple C submitted farm data — but it is no
 *   longer in rebuild-demo.ts's active chain, and its `demo/chapters/
 *   02-inventory.ts` assumption of two silos per farm is exactly what Task 4
 *   removes. Do not re-add it to MASTER_STEPS without a decision.
 *
 * Identities in FOUR_FARM_FEED_FIXTURE are illustrative. Before any retained
 * database is touched, swap the fixture for the four approved Triple C farms
 * — the plan's "Inputs required" list gates that, and the fixture spec
 * asserts the provenance label so the swap cannot be forgotten.
 *
 *   pnpm nx run api:db-seed-four-farm-feed-demo             # print the plan only
 *   pnpm nx run api:db-seed-four-farm-feed-demo -- --verify # apply inside a rolled-back tx
 *   pnpm nx run api:db-seed-four-farm-feed-demo -- --apply  # commit
 */
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { sql } from 'drizzle-orm';
import * as schema from '../core/database/schema';
import { FOUR_FARM_FEED_FIXTURE, validateFourFarmFixture, fixtureTopologyReport } from './demo/four-farm-feed-fixture';
import { seedFourFarmLocations, locationGraphAssertions } from './demo/seed-four-farm-locations';

const VERIFY_ROLLBACK = Symbol('seed-four-farm-feed-demo:verify-rollback');

interface ScopeRow {
  tenant_id: string;
  company_id: string;
  nob_id: string | null;
  lob_id: string | null;
  area_id: string | null;
}

/**
 * Drizzle's MySql2Database exposes execute(sql...), not the pool's .query().
 * Under drizzle-orm 0.45 the mysql2 driver resolves to the raw [rows, fields]
 * tuple, so the rows are index 0 — verified against a live nf_devco, where
 * `result?.rows` is undefined and a plain `?? result` returned the tuple
 * itself, which `.length` never matched and the plan printed an empty scope.
 */
export async function collectScope(db: any, database: string): Promise<ScopeRow> {
  const result = await db.execute(sql`
    SELECT l.tenant_id AS tenant_id, l.company_id AS company_id, l.nob_id AS nob_id, l.lob_id AS lob_id,
           (SELECT a.area_id FROM operational_area_master a
             WHERE a.company_id = l.company_id AND a.is_active = 1
             ORDER BY (a.lob_id = l.lob_id) DESC LIMIT 1) AS area_id
      FROM location_master l
     WHERE l.company_id IS NOT NULL
     GROUP BY l.tenant_id, l.company_id, l.nob_id, l.lob_id
     ORDER BY COUNT(*) DESC
     LIMIT 1`);
  const tuple = Array.isArray(result) ? result : [result];
  const rows: ScopeRow[] = ((tuple[0] ?? []) as ScopeRow[]);
  if (!rows.length) {
    throw new Error(
      `No company-scoped locations in ${database} — run the platform steps first; this script seeds the four farms onto an existing tenant, it does not create one.`,
    );
  }
  return rows[0]!;
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const mutating = apply || verify;

  const host = process.env.DATABASE_HOST || '127.0.0.1';
  const port = Number(process.env.DATABASE_PORT || 3306);
  const user = process.env.DATABASE_USERNAME || 'root';
  const password = process.env.DATABASE_PASSWORD || '';
  const ssl = process.env.DATABASE_SSL === 'true'
    ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
    : undefined;
  const database = process.env.DEV_TENANT_DATABASE || process.env.TENANT_DB_NAME || 'nf_devco';

  const pool = mysql.createPool({ host, port, user, password, database, ssl });
  try {
    const [lockRows] = (await pool.query("SELECT GET_LOCK('navfarm-four-farm-demo', 5) acquired")) as unknown as [Array<{ acquired: number }>];
    if (Number(lockRows[0]?.acquired) !== 1) throw new Error('Another four-farm demo seed run is active.');
    const db = drizzle(pool, { schema, mode: 'default' });

    // Plan phase — identical in every mode, so a review reads one printout.
    const issues = validateFourFarmFixture(FOUR_FARM_FEED_FIXTURE);
    if (issues.length) {
      throw new Error(`Four-farm fixture is invalid: ${issues.map((i) => i.message).join('; ')}`);
    }
    const scope = await collectScope(db, database);

    const plan = {
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      provenance: FOUR_FARM_FEED_FIXTURE.provenance,
      scope: { tenant: scope.tenant_id, company: scope.company_id, nob: scope.nob_id, lob: scope.lob_id, area: scope.area_id },
      topology: fixtureTopologyReport(FOUR_FARM_FEED_FIXTURE),
      nodes: FOUR_FARM_FEED_FIXTURE.farms.flatMap((f) => [
        { key: f.key, type: 'FARM', parent: null },
        ...f.sheds.flatMap((s) => [
          { key: s.key, type: 'SHED', parent: f.key },
          ...s.pens.map((p) => ({ key: p.key, type: 'PEN', parent: s.key })),
        ]),
        ...f.silos.map((si) => ({ key: si.key, type: 'SILO', parent: f.key })),
      ]),
      adjacency: FOUR_FARM_FEED_FIXTURE.farms.flatMap((f) =>
        Object.entries(f.links).map(([silo, sheds]) => ({ farm: f.key, silo, sheds }))),
      assertions: locationGraphAssertions(),
    };
    console.log(JSON.stringify(plan, null, 2));

    if (!mutating) {
      console.log('Read-only. No changes attempted.');
      return;
    }

    try {
      await db.transaction(async (tx) => {
        const result = await seedFourFarmLocations(tx as any, {
          tenantId: scope.tenant_id,
          companyId: scope.company_id,
          nobId: scope.nob_id,
          lobId: scope.lob_id,
        }, FOUR_FARM_FEED_FIXTURE);
        console.log(`Seeded ${result.locations.size} locations and ${result.links.length} silo_shed_link rows.`);
        if (verify) throw VERIFY_ROLLBACK;
      });
    } catch (err) {
      // The rollback marker is how --verify says "done", not a failure —
      // swallowing it here keeps exit code 0 and the summary line below true.
      if (err !== VERIFY_ROLLBACK) throw err;
    }

    console.log(apply ? 'Committed.' : 'Verified and rolled back. No changes committed.');
  } finally {
    await pool.query("SELECT RELEASE_LOCK('navfarm-four-farm-demo')").catch(() => undefined);
    await pool.end();
  }
}

if (require.main === module) {
  run().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    const cause = (err as any)?.cause;
    if (cause) console.error('Caused by:', cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
}
