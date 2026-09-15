# Phase 3 — Demo Data Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> Roadmap: `2026-09-14-mvp-delivery-plan.md` — its Global constraints and Machine rules apply.

**Goal:** one registered command drops every NAVFarm database and rebuilds a complete,
presentable Piggery demo in which every operational record — batches, animals,
receipts, issues, transfers, adjustments, daily entries, breeding events, approvals — was
created by calling the application's own services, so the demo proves the write path it
shows.

**Architecture:** `rebuild-demo.ts` orchestrates three stages. **Reset** reuses the
existing drop-and-bootstrap chain behind hard safety guards. **Masters** reuses the
existing registered seeds that load identity and Triple C template masters (raw inserts
are acceptable for masters and identity — they are not postings). **Demo chapters** boot a
Nest application context and call services inside a CLS context that sets `tenantDb` and
`tenantId` exactly as `TenantMiddleware` does; `farmScope` is left unset, which the
farm-scope module defines as an unrestricted internal caller. Each later phase appends a
chapter.

**Tech stack:** NestJS 11 application context, nestjs-cls, Drizzle/mysql2, tsx scripts, Nx targets.

**Evidence base:** survey of the seed chain, services and prerequisites, 15 Sep 2026
(summarised below); decisions of 14–15 September in `docs/decisions.md`.

## Rulings this plan makes

1. **Masters and identity may stay raw; postings may not.** Tenant, company, users, roles,
   taxonomy, number series, GL accounts/mappings and the Triple C template masters load
   through the existing seeds. Nothing that the app would post — batch, animal, inventory
   document, ledger, journal, daily entry, breeding event, approval, transfer — is inserted
   by a script.
2. **Demo warehouses.** Neither live farm has an active STORE today. Feed stock is held in
   Triple C's own silo-storage locations (`storage_type = 'SILO'`, e.g. `MGH1`) on each farm.
   One STORE per farm for medicines and vaccines is created through `LocationService.create`,
   named `Demo Medicine Store` with remarks `DEMO — not Triple C data`. *Flag to Rishi:
   replace with Triple C's real store locations when supplied.*
3. **Registered animals come from explicit demo facts.** Each Registered batch's animals are
   created one by one through `AnimalService.create` with explicit type, sex, breed, entry
   type and cost from a demo table in the chapter — never derived from opening quantity.
4. **Safety over convenience.** The reset refuses to run unless the database host is
   `127.0.0.1` or `localhost`, every database it would drop matches `navfarm_master`,
   `tenant_system` or `tenant_*`, no name contains `navcrm`, and `--apply` is passed.
   Default is a read-only printed plan.

## Global constraints (this phase)

- Never touch `navcrm_*`. Never run against TiDB (the commented `.env` block).
- The API and web servers keep running during a rebuild only if memory allows; the
  rebuild runs serially, heap-capped (`NODE_OPTIONS=--max-old-space-size=1024`).
- Every created demo record whose type has a free-text field (`remarks`, `notes`,
  `description`) carries `DEMO` in it. Names are Zimbabwe-appropriate; no Indian
  placeholders, no invented Triple C master facts.
- A chapter logs what it created and throws on the first refused service call — a
  rebuild that silently skipped a posting is worse than one that stopped.
- Agents write code; the lead runs, applies, and reads MySQL.

## Prerequisites the survey found (each is owned by a task below)

| Gap | Effect | Task |
|---|---|---|
| No active STORE/SILO location under MUL100 or POR100 | inventory documents need a warehouse on an active farm | 3 |
| 6 items with `valuation_method` NULL | FIFO/GL resolution for those items | 3 |
| Standard users need `farm_id` and an operational-area assignment at creation | today one was added by a repair script | 3 |
| No script boots Nest; services read `tenantDb`/`tenantId` from CLS | chapters cannot call services | 2 |
| `setup-fresh-database.ts` drops but does not provision `tenant_devco` | the rebuild must chain tenant provisioning | 1 |
| Batch transfers refuse a caller without an admin `userType` | transfer chapter actor must be a company admin | 5 |

---

### Task 1: Reset and masters orchestration

**Files:** Create `apps/api/src/scripts/rebuild-demo.ts`, `apps/api/src/scripts/lib/rebuild-guards.ts` (+ `rebuild-guards.spec.ts`); modify `apps/api/package.json` (target `db-rebuild-demo`).

**Interfaces:** Produces `assertSafeRebuildTarget(env, databases: string[]): void` and `parseRebuildArgs(argv): { apply: boolean; chaptersOnly: boolean; skipReset: boolean }`.

- [ ] **Step 1: Failing tests — `rebuild-guards.spec.ts`**

```ts
import { assertSafeRebuildTarget, parseRebuildArgs } from './rebuild-guards';

describe('rebuild guards', () => {
  const local = { DATABASE_HOST: '127.0.0.1' };

  it('allows the local NAVFarm databases', () => {
    expect(() => assertSafeRebuildTarget(local, ['navfarm_master', 'tenant_system', 'tenant_devco'])).not.toThrow();
  });

  it('refuses a remote host', () => {
    expect(() => assertSafeRebuildTarget({ DATABASE_HOST: 'gateway01.tidbcloud.com' }, ['tenant_devco']))
      .toThrow('Demo rebuild only runs against a local MySQL');
  });

  it('refuses any NavCRM database', () => {
    expect(() => assertSafeRebuildTarget(local, ['tenant_devco', 'navcrm_tenant_dev']))
      .toThrow('Refusing to drop navcrm_tenant_dev');
  });

  it('refuses a database outside the NAVFarm naming', () => {
    expect(() => assertSafeRebuildTarget(local, ['mysql'])).toThrow('Refusing to drop mysql');
  });

  it('is read-only unless --apply is passed', () => {
    expect(parseRebuildArgs([])).toEqual({ apply: false, chaptersOnly: false, skipReset: false });
    expect(parseRebuildArgs(['--apply', '--skip-reset'])).toEqual({ apply: true, chaptersOnly: false, skipReset: true });
  });
});
```

- [ ] **Step 2: Implement `rebuild-guards.ts`**

```ts
/** The rebuild drops databases. These guards are the difference between a demo reset and data loss. */
const NAVFARM_DATABASE = /^(navfarm_master|tenant_system|tenant_[a-z0-9_]+)$/;

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
```

- [ ] **Step 3: Orchestrator** — `rebuild-demo.ts`: read-only by default, printing the databases it would drop (`SHOW DATABASES` filtered by the regex, guarded) and the ordered command list. With `--apply`, run each step as a child process (`execFileSync('node', ['--env-file-if-exists=.env', '--import', 'tsx', script, ...args], { stdio: 'inherit', cwd: apps/api })`) and stop on the first non-zero exit:
  1. (unless `--skip-reset` / `--chapters-only`) `setup-fresh-database.ts` — after `assertSafeRebuildTarget`.
  2. `seed-dev-tenant.ts`
  3. `migrate-all-tenants.ts`
  4. `seed-system-master-data.ts`, `seed-activity-master.ts`
  5. `seed-farm-locations.ts --apply`, `seed-farm-masters.ts --apply`
  6. `align-production-permissions.ts --apply` and any other alignment the survey shows `seed-demo.ts` runs for masters only — read `seed-demo.ts` and copy its master steps; **exclude** `seed-piggery-complete-data.ts`, `seed-demo-full-coverage.ts`, `seed-demo-gaps.ts` operational sections, `probe-farm-scope-users.ts` and every repair script.
  7. `demo-chapters.ts` (Task 2) with `--apply`.
  Confirm each script's flag spelling by reading it (some take `--apply`, some none).
- [ ] **Step 4: Register** `db-rebuild-demo` in `apps/api/package.json` beside the other `db-*` targets.
- [ ] **Step 5: Run (lead)** guards spec; then `pnpm nx run api:db-rebuild-demo` (read-only) and read the printed plan. **Do not pass `--apply` before the 15 Sep 20:00 review.**
- [ ] **Step 6: Commit (lead).**

---

### Task 2: Service harness and the first chapter

**Files:** Create `apps/api/src/scripts/demo-chapters.ts`, `apps/api/src/scripts/demo/harness.ts`, `apps/api/src/scripts/demo/chapter.ts` (types); modify `apps/api/package.json` (`db-demo-chapters`).

**Interfaces:**
- `interface DemoContext { app: INestApplicationContext; tenantId: string; companyId: string; actor: { userId: string; userType: 'COMPANY_ADMIN'; tenantId: string; email: string }; farms: { grasmere: string; kintyre: string }; log(line: string): void }`
- `interface DemoChapter { name: string; run(ctx: DemoContext): Promise<void> }`
- `async function inTenant<T>(ctx: DemoContext, work: () => Promise<T>): Promise<T>` — runs `work` inside `cls.run`, setting `tenantDb` (Drizzle for the tenant from `ConnectionManagerService.getTenantConnection`) and `tenantId`; never sets `farmScope`.

- [ ] **Step 1:** Read `apps/api/src/app.module.ts`, `apps/api/src/core/database/connection-manager.service.ts` and `apps/api/src/common/middlewares/tenant.middleware.ts` (lines 60-110). Boot with `NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })`. Resolve the tenant row from `navfarm_master` exactly as the middleware does (by code `devco`).
- [ ] **Step 2:** `demo-chapters.ts`: read-only by default (prints chapters); `--apply` runs them in order; refuses if `batch_header` already has rows unless `--force-on-existing` is passed (never used by the rebuild, only for chapter development against a scratch tenant); closes the app context in `finally`.
- [ ] **Step 3: First chapter `identity`** — through `UserService.create` with the company admin as requester: one Grasmere farm worker and one Kintyre farm worker (`user_type: 'STANDARD_USER'`, `farm_id`), names `Tendai Moyo` / `Rudo Chikwanha`, emails `worker.grasmere@triplec.local` / `worker.kintyre@triplec.local`, password `12345678` (dev only); then assign each to the Piggery operational area through the service/endpoint that owns area assignment (find it: `user-operational-area` or `operational-area` module) — not raw SQL. Resolve farm ids by `location_code` `MUL100` / `POR100`.
- [ ] **Step 4: Run (lead)** — after a rebuild's master stages only, `pnpm nx run api:db-demo-chapters --args=--apply`; MySQL: both users with `farm_id`, both assigned; both can log in; `GET /batch` as each answers 200.
- [ ] **Step 5: Commit (lead).**

---

### Task 3: Masters the postings need

**Files:** Create `apps/api/src/scripts/demo/chapters/01-stores-and-items.ts`.

- [ ] **Step 1: Stores** — `LocationService.create` for `Demo Medicine Store` under each farm (read `CreateLocationDto` and the location type rules; parent = the farm or a shed as the location-type hierarchy allows; `location_type: 'STORE'`, `location_address` = the farm's address, `max_capacity: 1000`, `capacity_uom: 'PCS'`, remarks per Ruling 2). Feed silos: select, per farm, two existing active locations with `storage_type = 'SILO'`; if a farm has none, stop with a message naming the gap (do not invent a silo).
- [ ] **Step 2: Item valuation** — for the 6 items with `valuation_method` NULL, set it through `ItemService.update` (`FIFO` for feed/raw material, `BIO_ASSET` for livestock items); if an item is unused by any chapter, leave it and log that.
- [ ] **Step 3: Run (lead), MySQL check, commit.**

### Task 4: Inventory chapter

**Files:** Create `apps/api/src/scripts/demo/chapters/02-inventory.ts`.

- [ ] Per farm, through the services, each `create` then `post`: a goods receipt of gestation feed and grower feed into the farm's silo locations and of two medicines and one vaccine into its Demo Medicine Store (quantities and rates from a demo table at the top of the file, rates from `item_master.standard_cost` where set); one goods issue of medicine; one stock transfer between the farm's two silos; one positive and one negative stock adjustment with reason text containing `DEMO`.
- [ ] **Lead check:** every document `POSTED`; `inventory_ledger` rows link to each; `inventory_application` draws against the receipts; each `journal_header` balances (`SUM(debit)=SUM(credit)`); no `AUTO-STOCK-REPLENISH` rows.

### Task 5: Batches, animals and schedulers

**Files:** Create `apps/api/src/scripts/demo/chapters/03-batches-and-animals.ts`.

- [ ] Grasmere: one **Registered Animals** breeding batch (`farm_id`, `stage_id` = the gestation or breeding-herd stage, a Grasmere breed profile, `auto_generate_scheduler: true`) and one **Count Only** grower batch. Kintyre: one Count Only grower batch. Through `BatchService.create`; activate each through `BatchService.activate` if the create leaves it DRAFT.
- [ ] Registered batch animals: 8 sows and 1 boar through `AnimalService.create`, explicit rows in a demo table (`animal_type`, `gender`, breed, `entry_type: 'PURCHASED_LOCAL'`, `source_receipt_id` of a livestock goods receipt posted in this chapter for the breeding stock, `acquisition_cost`, `current_batch_id`, `current_location_id` = a Grasmere pen). Read `AnimalService.create` for every conditional requirement before writing the table.
- [ ] **Lead check:** Count Only batches have zero `animal_register` rows; the Registered batch has 9; each batch has a scheduler with lines; every batch has `farm_id`.

### Task 6: Daily entries

**Files:** Create `apps/api/src/scripts/demo/chapters/04-daily-entries.ts`.

- [ ] For each batch, for the 14 days ending yesterday (company timezone), post every due scheduler line through `BatchDailyDataService.postEntry` with values from a deterministic function of (line, day) — feed by the line's standard × headcount ± a small fixed pattern, mortality mostly 0 with two single deaths on the Count Only grower batch. Deliberately skip one mandatory line on two distinct days on the Grasmere grower batch so History shows Missing.
- [ ] **Lead check:** `batch_daily_data` rows equal the posted count; every CONSUMPTION entry has a `batch_transaction` with non-null `ledger_id`; the skipped days show as pending in `GET /batch/:id/daily-data/pending-days`.

### Task 7: Breeding

**Files:** Create `apps/api/src/scripts/demo/chapters/05-breeding.ts`.

- [ ] On the Registered batch through `BreedingService`: two sows complete a cycle dated in the past — `recordMating` → `recordPregnancyCheck` (positive) → `recordFarrowing` (linked `breeding_id`, explicit litter counts) → `recordWeaning`; two sows mated and pregnancy-confirmed only; one sow mated with a negative check.
- [ ] **Lead check:** every `farrowing_record.breeding_id` of the completed cycles is set; parity counts advanced; expected farrowing dates follow the breed's gestation.

### Task 8: Approvals, final verification, handoff

**Files:** Create `apps/api/src/scripts/demo/chapters/06-approvals.ts`; create `docs/VERIFICATION-<date>-phase-03.md`.

- [ ] Two pending approvals through `ApprovalService.create` (a feed ration change on the Grasmere grower batch; a medicine requisition-style request) and one approved through `ApprovalService.approve`.
- [ ] **Full rebuild (lead, after 15 Sep 20:00):** `pnpm nx run api:db-rebuild-demo --args=--apply`; then API restart by PID; logins for tenant admin, company admin, operational admin, both farm workers; `GET` every screen's endpoint returns data for its role; MySQL: zero rows written by seed timestamps in operational tables other than through services (spot-check `created_by` = the demo actor), `batch_transaction.ledger_id` populated for every CONSUMPTION, all journals balanced, both farm workers see only their farm.
- [ ] Browser pass (one run, three widths) over dashboard, batches, batch animals, data entry history, inventory balance and ledger, breeding, approvals.
- [ ] Record Ruling 2 as a decision and the demo-store flag for Rishi; update the handoff.
