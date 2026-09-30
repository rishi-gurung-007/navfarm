# Four-Farm Feed Master Seed and Database Transition Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this plan task by task. Do not
> execute a migration or retained-data transition until the unresolved fixture
> identities below are supplied. Data-changing scripts are read-only by
> default, support `--verify` with rollback, and require `--apply` to commit.

**Goal:** Replace the nine-farm-specific demo master arrangement with a clear,
repeatable fixture containing one tenant, one company, one Piggery operational
area and four farms that exercise every supported silo-to-shed relationship,
without confusing illustrative values with production defaults.

**Architecture:** Keep FARM/SHED/PEN/SILO in `location_master`, with silos as
farm children and `silo_shed_link` as the only shed allocation graph. Describe
the fixture as data, then have a small seeder validate and materialize that
graph using Number Series. Keep master seeding separate from operational
posting. A separate migration operator applies reviewed migrations and handles
retained-database transitions; only one agent owns SQL/journal numbering.

**Current baseline (30 Sep 2026):** `nf_devco` is migrated through tenant
migration 0134 and contains one company, one active operational area and nine
active farms. The current master chain imports submitted farms and then runs
`seed-nine-farm-demo.ts`. The topology schema already supports the requested
relationships, so this plan does not create a topology migration.

## Approved decisions

- Exactly four farms. Farm 4 is the mixed case rather than a fifth farm.
- Current fulfilment is `IN_HOUSE`; `BC_INTEGRATED` is a future mode.
- Notifications are `IN_APP` only.
- Values in feed example/sample columns are illustrative seed fixtures only.
- Seed phase one is master-only. Operational transactions are separate.
- Four topology cases: 1:1; one silo to many sheds; many-to-many; mixed.
- A silo is a farm child. Silo-to-shed links are many-to-many. Shared-shed
  silos must carry different feed items when they hold positive stock.

## Inputs required before applying the fixture

- Four approved farm codes, names and addresses, or an explicit list of which
  four documented Triple C farms to use.
- Exact shed, pen and silo counts and approved names per farm.
- Whether every shed gets pens; pen counts and capacities.
- Farm/shed/pen capacities and units.
- Silo capacity, entry unit, reorder days, low/high levels, handling type and
  illustrative feed-item assignment.
- Whether seed users and farm role assignments are included in phase one.
- Retained database policy: deactivate/retire the other farms, keep them, or
  apply the four-farm profile only to fresh databases.
- Target databases and confirmed backups for retained-data transitions.

## File ownership and parallel work

| Owner | May change | Must not change concurrently |
|---|---|---|
| Seed worker | `apps/api/src/scripts/` fixture, helpers, seed specs and Nx seed target | Drizzle schema/journal; feed services/UI |
| Feed feature worker | Feed modules, UI and any feature schema change | Four-farm fixture while its contract is moving |
| Migration operator | Reviewed SQL execution, backups, journal verification, retained-data transition after approval | `schema.ts`, feature code, seed definitions |
| Documentation owner | `AGENTS.md`, `docs/decisions.md`, this plan and verification report | No database mutation |

If a schema change later becomes necessary, freeze its contract first. The
feature owner changes `schema.ts`; one migration owner then authors/reviews the
SQL and `_journal.json`. Never have two agents generate tenant migrations.

---

## Task 1: Lock the fixture contract and protect it with tests

**Status: pending — blocked on the approved identities, counts and capacities
listed above.** Do not substitute invented values merely to make this task
executable.

**Files:**

- Create: `apps/api/src/scripts/demo/four-farm-feed-fixture.ts`
- Create: `apps/api/src/scripts/demo/four-farm-feed-fixture.spec.ts`
- Modify: `docs/decisions.md` only if supplied identities add a decision

- [ ] Define typed FARM → SHEDS/PENS/SILOS/LINKS data with explicit source
      notes on every illustrative value.
- [ ] Reject duplicate codes, unknown link endpoints, cross-farm links, a silo
      parented below a shed, empty farms and shared-shed same-item conflicts.
- [ ] Assert exactly one 1:1 farm, one shared-silo farm, one many-to-many farm
      and one mixed farm.
- [ ] Test that example values can be replaced without seeder changes.

Run: `pnpm nx test api -- four-farm-feed-fixture`

## Task 2: Make location seeding graph-aware

**Status: pending after Task 1.** The existing Number-Series location helper
and `silo_shed_link` model should be reused once the fixture contract is
approved.

**Files:**

- Modify: `apps/api/src/scripts/lib/seed-location.ts`
- Create or modify: `apps/api/src/scripts/lib/seed-silo-shed-links.ts`
- Add focused helper specs

- [ ] Create FARM/SHED/PEN/SILO through the existing Number Series path; never
      hand-write the final generated code.
- [ ] Add the missing silo fixture inputs without weakening service validation.
- [ ] Insert links separately after all locations exist.
- [ ] Print planned nodes and adjacency in read-only and verify modes.
- [ ] Verify exact counts, ancestry, same-farm links and unique pairs from SQL.

Run: `pnpm nx test api -- seed-location seed-silo-shed-links`

## Task 3: Replace the nine-farm-specific master stage

**Status: pending after Tasks 1–2.** The active rebuild chain remains on the
existing nine-farm seed until an approved four-farm fixture passes disposable
database verification.

**Files:**

- Create: `apps/api/src/scripts/seed-four-farm-feed-demo.ts`
- Modify: `apps/api/src/scripts/rebuild-demo.ts`
- Modify or retire from the active chain:
  `apps/api/src/scripts/seed-nine-farm-demo.ts`
- Modify: `apps/api/package.json` to expose an Nx `db-*` target
- Add plan-order and refusal-behaviour specs

- [ ] Read-only default prints exact changes and refuses unsafe existing data.
- [ ] `--verify` performs the complete write inside a transaction, runs SQL
      assertions, then rolls back.
- [ ] `--apply` commits only after the same validations pass.
- [ ] Preserve ordering: tenant → migrations → system masters → company
      template adoption → farm fixture → items/lifecycles → NOB/LOB and
      permission alignment.
- [ ] Do not retain a starter farm or import two submitted farms and then append
      four more. The selected policy must yield the approved farm count.

Run the new Nx target without flags, then with `-- --verify` against a
disposable database. Read both plans before using `--apply`.

## Task 4: Keep the operational demo compatible with a one-silo farm

**Files:**

- Modify: `apps/api/src/scripts/demo/farms.ts`
- Modify: `apps/api/src/scripts/demo/chapters/02-inventory.ts`
- Add focused chapter and farm-resolution specs

- [ ] Resolve silos and sheds from `silo_shed_link`, never by assuming one silo
      per shed or two silos per farm.
- [ ] On the 1:1 farm, seed valid receipt/consumption examples and skip only the
      demonstration that intrinsically requires a second silo.
- [ ] Exercise one silo feeding several sheds and a shed drawing different feed
      items from several silos.
- [ ] Keep this task out of master-only apply; it exists so a later full demo
      rebuild does not fail at inventory chapter 02.

Run: `pnpm nx test api -- demo farms inventory`

## Task 5: Build a retained-database transition only after policy approval

**Files:**

- Create if required:
  `apps/api/src/scripts/transition-nine-to-four-farm-demo.ts`
- Add an Nx target and focused script spec

- [ ] Inventory references to every farm/location before proposing a change.
- [ ] Never delete a referenced location. Print whether each non-selected farm
      can be deactivated, requires reassignment or blocks transition.
- [ ] Use stable IDs where approved; never merge farms by display name.
- [ ] Refuse ambiguous topology and unapproved data removal.
- [ ] Implement read-only, `--verify` rollback and `--apply` commit modes.

This is not a schema migration. Do not use generic `--skip-reset` as a
substitute for an explicit retained-data transition.

## Task 6: Migration-operator rehearsal and execution

- [ ] Back up every target database and record restore commands/checksums.
- [ ] Apply any separately approved master migration first, then tenant
      migrations with `pnpm nx run api:db-migrate-all-tenants`.
- [ ] Require a zero exit code and also search complete output for `FAILED`.
- [ ] Query the Drizzle journal in `nf_system` and every registered tenant DB.
- [ ] Run the seed plan and `--verify` on a disposable database.
- [ ] Apply the fixture to the disposable database and execute Task 7's SQL
      assertions.
- [ ] Apply to RDP/test only after disposable verification and explicit target
      approval. Never run the destructive rebuild against retained RDP data.

## Task 7: Database, service and visual verification

Required assertions after apply:

- [ ] Exactly one tenant, one company and one active Piggery operational area.
- [ ] Exactly four selected active farms under the approved transition policy.
- [ ] Every shed's parent and `farm_id` resolve to its declared farm.
- [ ] Every pen's parent is its declared shed.
- [ ] Every silo's parent is a farm and `warehouse_id` is self-referential.
- [ ] Actual `silo_shed_link` adjacency equals the fixture exactly.
- [ ] No duplicate or cross-farm link exists.
- [ ] Shared-shed silos have no same-item positive-stock conflict.
- [ ] Created codes agree with their Number Series and the next API-created row
      receives the next valid code.

Verification commands:

```bash
pnpm nx test api
pnpm nx test web
pnpm nx run-many -t typecheck -p api web web-e2e
pnpm nx run api:build
pnpm nx run web:build
```

Visual verification covers the Location/Farm Master tree, all four
collapsed/expanded Feed Planning groups, silo edit fields and attached sheds,
and Feed Forecast source selection for every topology. Check MySQL after at
least one API write; a successful response is not proof of persistence.

## Completion evidence

Create `docs/VERIFICATION-2026-09-30-four-farm-feed-seed.md` containing the
commit, target database, dry-run and verify plans, migration journals, SQL
assertion output, test/build results, screenshots, deliberately skipped
operational chapters and remaining client-data questions.
