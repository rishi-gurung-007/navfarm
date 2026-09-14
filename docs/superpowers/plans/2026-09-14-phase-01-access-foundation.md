# Phase 1 — Access Foundation (API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> Roadmap: `2026-09-14-mvp-delivery-plan.md` (read its Global constraints and
> Machine rules first — they apply to every task here).

**Goal:** every operational API read and write is bounded by the caller's farm
scope — a standard user to exactly one assigned farm, admins to every farm in
their scope or the one they select — with the operational-area header mandatory
for restricted users, out-of-farm records answering 404, and a spec that fails
when an operational controller is left unscoped.

**Architecture:** a new `common/farm-scope.ts` sits beside `master-data-scope.ts`.
`RolesGuard` resolves a `FarmScope` for any controller marked `@FarmScoped()` and
stores it in CLS under `farmScope`. Services read it with `farmScope(this.cls)`
and spread the SQL conditions it builds into their existing queries; no
controller signature changes. A location's farm is the farm row itself or any
row whose `location_master.farm_id` is that farm. Batches carry a new
`batch_header.farm_id`; standard users a new `user_master.farm_id`.

**Tech stack:** NestJS 11, Drizzle ORM (mysql2), nestjs-cls, Jest.

**Specs:** `docs/superpowers/specs/2026-09-14-access-scope-and-master-data-ux-design.md`
(§2, §3, §3.1, §12) and the 14 September entries in `docs/decisions.md`.

## Global constraints (this phase)

- Restricted user types: `OPERATIONAL_ADMIN`, `STANDARD_USER`. Admin user types: `SYSTEM_ADMIN`, `TENANT_ADMIN`, `COMPANY_ADMIN`.
- A `STANDARD_USER`'s farm is `user_master.farm_id`, fixed. `x-active-farm-id` naming another farm → 403 `Not authorized for this farm.` No assigned farm → 403 `No farm is assigned to this user.`
- Admins and operational admins may send `x-active-farm-id`; it must be an active top-level location of the active company, else 403 `Not authorized for this farm.` Absent = every farm in scope.
- Restricted users on a `@FarmScoped()` route without `x-active-operational-area-id` → 400 `Select an operational area first.`
- `operational_area_master.farm_id` is **never** read for access.
- Read-by-id outside the farm → 404 with the module's existing not-found message. Create naming a location on another farm → 403 `<Label> is not on your active farm.`
- When no farm scope is set (internal callers, seed scripts), conditions are empty — HTTP safety comes from the guard plus the Task 9 coverage spec.
- Agents: no builds, tests, servers, browsers, MySQL writes or commits. The lead runs every command block marked **(lead)**.

## File map

| File | Responsibility |
|---|---|
| Create `apps/api/src/drizzle/tenant/0093_farm_scope_columns.sql` | `user_master.farm_id`, `batch_header.farm_id`, FKs, indexes, batch backfill |
| Modify `apps/api/src/drizzle/tenant/meta/_journal.json` | Journal entry idx 93 |
| Modify `apps/api/src/core/database/schema.ts` | Drizzle columns for the two new fields |
| Modify `apps/api/src/modules/core/auth/strategies/jwt.strategy.ts` | Carry `farmId` on `request.user` |
| Create `apps/api/src/common/farm-scope.ts` (+ `.spec.ts`) | `FarmScope`, `@FarmScoped()`, `resolveFarmScope`, condition builders, location-farm lookups |
| Modify `apps/api/src/common/guards/roles.guard.ts` (+ spec) | Resolve and store farm scope for `@FarmScoped()` routes |
| Modify batch, scheduler-header, batch-daily-data, batch-transfer, animal, animal-medication-log, breeding, goods-receipt, goods-issue, stock-adjustment, stock-transfer, inventory-ledger, approval controllers and services | Mark scoped; apply conditions, 404s and create checks |
| Create `apps/api/src/common/farm-scope-coverage.spec.ts` | Every operational controller classified; scoped ones carry the marker |
| Modify `apps/api/src/modules/production/batch/batch.controller.ts` | Operator remap: lifecycle actions need `approve`; entry-shaped posts need `BATCH_ENTRY` |
| Modify `apps/api/src/modules/production/batch-daily-data/entry-window.ts` (+ spec, service) | Remove the backlog refusal |

---

### Task 1: Farm columns, schema and JWT farm claim

**Files:**
- Create: `apps/api/src/drizzle/tenant/0093_farm_scope_columns.sql`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json`
- Modify: `apps/api/src/core/database/schema.ts` (`userMaster` ~284-318, `batchHeader` ~1984-2073)
- Modify: `apps/api/src/modules/core/auth/strategies/jwt.strategy.ts:46-55`
- Test: `apps/api/src/modules/core/auth/strategies/jwt.strategy.spec.ts`

**Interfaces:**
- Produces: `schema.userMaster.farm_id` (varchar 36, nullable), `schema.batchHeader.farm_id` (varchar 36, nullable); `request.user.farmId: string | null`.

- [ ] **Step 1: Write the failing test** — append to `jwt.strategy.spec.ts` inside its top `describe`, reusing that spec's existing user-row mock (read the file first and use its helper names):

```ts
  it('carries the assigned farm so the guard can bound a standard user', async () => {
    // Arrange the existing user-row mock to return farm_id, then:
    const user = await strategy.validate({ sub: 'user-1', type: 'access' } as any);
    expect(user).toMatchObject({ farmId: 'farm-1' });
  });
```

- [ ] **Step 2: Run it to verify it fails (lead)**

Run: `NODE_OPTIONS=--max-old-space-size=1024 pnpm nx test api --runInBand --watchman=false --testPathPatterns=jwt.strategy`
Expected: FAIL — `farmId` missing from the returned object.

- [ ] **Step 3: Write the migration** — `0093_farm_scope_columns.sql`:

```sql
ALTER TABLE `user_master` ADD `farm_id` varchar(36);--> statement-breakpoint
ALTER TABLE `user_master` ADD CONSTRAINT `user_master_farm_id_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `batch_header` ADD `farm_id` varchar(36);--> statement-breakpoint
ALTER TABLE `batch_header` ADD CONSTRAINT `batch_header_farm_id_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_batch_header_farm` ON `batch_header` (`farm_id`);--> statement-breakpoint
UPDATE `batch_header` b
  JOIN `location_master` l ON l.`location_id` = COALESCE(b.`sub_location_id`, b.`location_id`, b.`shed_id`)
  SET b.`farm_id` = CASE WHEN l.`parent_location_id` IS NULL THEN l.`location_id` ELSE l.`farm_id` END
  WHERE b.`farm_id` IS NULL;
```

- [ ] **Step 4: Add the journal entry** — append to `entries` in `_journal.json` (the migrator only applies entries whose `when` exceeds the last applied `created_at`, `1789234405180`):

```json
    {
      "idx": 93,
      "version": "5",
      "when": 1789234406180,
      "tag": "0093_farm_scope_columns",
      "breakpoints": true
    }
```

- [ ] **Step 5: Add the Drizzle columns** — in `userMaster`, after `company_id`:

```ts
  // A STANDARD_USER's one farm (a top-level location). Null for every other
  // user type, whose farm reach comes from their company or LOB scope instead.
  farm_id: varchar('farm_id', { length: 36 }).references((): AnyMySqlColumn => locationMaster.location_id, { onDelete: 'restrict' }),
```

In `batchHeader`, after `location_id`:

```ts
  // The farm the batch runs on — the access boundary for everything recorded
  // against it. Derived from its location on create; see farm-scope.ts.
  farm_id: varchar('farm_id', { length: 36 }),
```

and in its index callback add `farmFk: foreignKey({ columns: [table.farm_id], foreignColumns: [locationMaster.location_id], name: 'batch_header_farm_id_fk' }).onDelete('restrict'),`.

- [ ] **Step 6: Carry the claim** — in `jwt.strategy.ts` return object add `farmId: user.farm_id ?? null,` after `companyId`.

- [ ] **Step 7: Run the test to verify it passes (lead)** — same command as Step 2. Expected: PASS.

- [ ] **Step 8: Apply and check the migration (lead)**

```bash
pnpm nx run api:db-migrate-all-tenants
mysql -u root tenant_devco -e "SHOW COLUMNS FROM user_master LIKE 'farm_id'; SHOW COLUMNS FROM batch_header LIKE 'farm_id'; SELECT batch_no, farm_id FROM batch_header;"
```
Expected: both columns present; every batch has a `farm_id` (today's demo batches resolve to FARM-001).

- [ ] **Step 9: Commit (lead)** — `feat(access): farm columns for standard users and batches`, message explaining that farm is the access boundary and area.farm_id is not.

---

### Task 2: The farm-scope module

**Files:**
- Create: `apps/api/src/common/farm-scope.ts`
- Test: `apps/api/src/common/farm-scope.spec.ts`

**Interfaces:**
- Consumes: `request.user` `{ userId, tenantId, companyId, userType, farmId }`; CLS `activeOperationalArea` `{ area_id, company_id, nob_id, lob_id }`.
- Produces (exact names later tasks import):
  - `FARM_SCOPE_KEY = 'farmScope'`, `FARM_SCOPED_KEY = 'farmScoped'`
  - `interface FarmScope { farmId: string | null; restricted: boolean; companyId: string | null; lobId: string | null }`
  - `FarmScoped(): ClassDecorator & MethodDecorator`
  - `farmScope(cls: ClsService): FarmScope`
  - `resolveFarmScope(db, input: ResolveFarmScopeInput): Promise<FarmScope>`
  - `locationOnFarm(column: AnyMySqlColumn, farmId: string): SQL`
  - `batchOnFarm(batchIdColumn: AnyMySqlColumn, farmId: string): SQL`
  - `animalOnFarm(animalIdColumn: AnyMySqlColumn, farmId: string): SQL`
  - `batchScopeConditions(scope: FarmScope): SQL[]` — for queries on `batch_header` itself
  - `animalScopeConditions(scope: FarmScope): SQL[]` — for queries on `animal_register` itself
  - `farmOfLocation(db, locationId: string): Promise<string | null>`
  - `assertLocationOnActiveFarm(db, scope: FarmScope, locationId: string | null | undefined, label: string): Promise<void>`

- [ ] **Step 1: Write the failing tests** — `farm-scope.spec.ts`:

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { and } from 'drizzle-orm';
import * as schema from '../core/database/schema';
import { batchScopeConditions, farmScope, resolveFarmScope, UNRESTRICTED_FARM_SCOPE } from './farm-scope';

const dialect = new MySqlDialect();
const render = (conditions: any[]) => dialect.sqlToQuery(and(...conditions)!);

/** Answers the farm-row lookup with whatever the test puts in `farmRow`. */
const dbWith = (farmRow: object | undefined) => {
  const chain: any = { from: () => chain, where: () => chain, limit: () => Promise.resolve(farmRow ? [farmRow] : []) };
  return { select: () => chain } as any;
};
const area = { area_id: 'area-1', company_id: 'co-1', nob_id: 'nob-1', lob_id: 'lob-pig' };
const input = (userType: string, over: Record<string, unknown> = {}) => ({
  user: { userId: 'u-1', tenantId: 't-1', companyId: 'co-1', userType, farmId: null, ...(over.user as object) },
  headers: (over.headers as Record<string, string>) ?? {},
  activeArea: 'activeArea' in over ? (over.activeArea as any) : area,
  activeCompanyId: 'co-1',
  tenantId: 't-1',
});

describe('resolveFarmScope', () => {
  it('fixes a standard user to their assigned farm', async () => {
    const scope = await resolveFarmScope(dbWith({ location_id: 'farm-g' }), input('STANDARD_USER', { user: { farmId: 'farm-g' } }));
    expect(scope).toEqual({ farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
  });

  it('refuses a standard user with no assigned farm', async () => {
    await expect(resolveFarmScope(dbWith(undefined), input('STANDARD_USER'))).rejects.toThrow(new ForbiddenException('No farm is assigned to this user.'));
  });

  it('refuses a standard user naming another farm', async () => {
    const req = input('STANDARD_USER', { user: { farmId: 'farm-g' }, headers: { 'x-active-farm-id': 'farm-k' } });
    await expect(resolveFarmScope(dbWith({ location_id: 'farm-g' }), req)).rejects.toThrow(new ForbiddenException('Not authorized for this farm.'));
  });

  it('refuses a restricted user with no operational area', async () => {
    const req = input('OPERATIONAL_ADMIN', { activeArea: undefined });
    await expect(resolveFarmScope(dbWith(undefined), req)).rejects.toThrow(new BadRequestException('Select an operational area first.'));
  });

  it('gives an operational admin every farm, bounded by LOB, when none is selected', async () => {
    const scope = await resolveFarmScope(dbWith(undefined), input('OPERATIONAL_ADMIN'));
    expect(scope).toEqual({ farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
  });

  it('narrows an admin to a selected farm of the active company', async () => {
    const req = input('COMPANY_ADMIN', { activeArea: undefined, headers: { 'x-active-farm-id': 'farm-k' } });
    const scope = await resolveFarmScope(dbWith({ location_id: 'farm-k' }), req);
    expect(scope).toEqual({ farmId: 'farm-k', restricted: false, companyId: 'co-1', lobId: null });
  });

  it('refuses a selected farm that is not an active farm of the company', async () => {
    const req = input('COMPANY_ADMIN', { activeArea: undefined, headers: { 'x-active-farm-id': 'nowhere' } });
    await expect(resolveFarmScope(dbWith(undefined), req)).rejects.toThrow(new ForbiddenException('Not authorized for this farm.'));
  });
});

describe('farm conditions', () => {
  it('reads as unrestricted when the guard set nothing', () => {
    expect(farmScope({ get: () => undefined } as any)).toEqual(UNRESTRICTED_FARM_SCOPE);
  });

  it('bounds batch queries by farm and, for restricted users, LOB', () => {
    const { sql, params } = render(batchScopeConditions({ farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' }));
    expect(sql).toContain('`batch_header`.`farm_id` = ?');
    expect(sql).toContain('`batch_header`.`lob_id` = ?');
    expect(params).toEqual(expect.arrayContaining(['farm-g', 'lob-pig', 'co-1']));
  });

  it('adds nothing for an unrestricted admin with no farm selected', () => {
    expect(batchScopeConditions(UNRESTRICTED_FARM_SCOPE)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails (lead)** — `--testPathPatterns=common/farm-scope.spec`. Expected: FAIL, module not found.

- [ ] **Step 3: Write the module** — `farm-scope.ts`:

```ts
import { BadRequestException, ForbiddenException, SetMetadata } from '@nestjs/common';
import { and, eq, isNull, or, sql, SQL } from 'drizzle-orm';
import { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import * as schema from '../core/database/schema';

/**
 * Farm scope — the second access boundary beside company/area.
 *
 * An operational area is a line of business across all of a company's farms,
 * never a farm (decided 2026-09-14), so `operational_area_master.farm_id` is not
 * read here. A farm is a top-level Location Master row; a location belongs to a
 * farm when it is that row or its `farm_id` names it.
 */

export const FARM_SCOPE_KEY = 'farmScope';
export const FARM_SCOPED_KEY = 'farmScoped';

/** User types whose operational reads are bounded by LOB and, for a standard user, one farm. */
export const RESTRICTED_USER_TYPES = ['OPERATIONAL_ADMIN', 'STANDARD_USER'];

export interface FarmScope {
  /** The one farm in force, or null for every farm the company scope allows. */
  farmId: string | null;
  restricted: boolean;
  companyId: string | null;
  /** The validated active area's LOB — restricted users only. */
  lobId: string | null;
}

export const UNRESTRICTED_FARM_SCOPE: FarmScope = { farmId: null, restricted: false, companyId: null, lobId: null };

/** Marks a controller or route whose records belong to a farm. The coverage spec requires it. */
export const FarmScoped = () => SetMetadata(FARM_SCOPED_KEY, true);

/**
 * The scope the guard resolved for this request. Unset means an internal caller
 * (a seed, a job) outside any HTTP request — those run unrestricted by design,
 * and every operational HTTP route is proven marked by farm-scope-coverage.spec.
 */
export function farmScope(cls: ClsService): FarmScope {
  return cls.get<FarmScope>(FARM_SCOPE_KEY) ?? UNRESTRICTED_FARM_SCOPE;
}

export interface ResolveFarmScopeInput {
  user: { userId: string; tenantId: string; companyId: string | null; userType: string; farmId?: string | null };
  headers: Record<string, string | string[] | undefined>;
  activeArea?: { area_id: string; company_id: string; lob_id: string };
  activeCompanyId?: string;
  tenantId: string;
}

type Db = MySql2Database<typeof schema>;

async function activeFarmOfCompany(db: Db, farmId: string, companyId: string | undefined, tenantId: string): Promise<boolean> {
  if (!companyId) return false;
  const [row] = await db
    .select({ location_id: schema.locationMaster.location_id })
    .from(schema.locationMaster)
    .where(and(
      eq(schema.locationMaster.location_id, farmId),
      isNull(schema.locationMaster.parent_location_id),
      eq(schema.locationMaster.company_id, companyId),
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
    ))
    .limit(1);
  return Boolean(row);
}

export async function resolveFarmScope(db: Db, input: ResolveFarmScopeInput): Promise<FarmScope> {
  const { user, headers, activeArea, activeCompanyId, tenantId } = input;
  const restricted = RESTRICTED_USER_TYPES.includes(user.userType);
  const requested = typeof headers['x-active-farm-id'] === 'string' ? (headers['x-active-farm-id'] as string) : undefined;

  // Before 14 September the area header was validated only when sent, so a
  // restricted user who omitted it read every operational record.
  if (restricted && !activeArea) throw new BadRequestException('Select an operational area first.');

  const companyId = activeArea?.company_id ?? activeCompanyId ?? null;
  const lobId = restricted ? activeArea!.lob_id : null;

  if (user.userType === 'STANDARD_USER') {
    if (!user.farmId) throw new ForbiddenException('No farm is assigned to this user.');
    if (requested && requested !== user.farmId) throw new ForbiddenException('Not authorized for this farm.');
    if (!(await activeFarmOfCompany(db, user.farmId, companyId ?? undefined, tenantId))) {
      throw new ForbiddenException('Your assigned farm is not an active farm of this company.');
    }
    return { farmId: user.farmId, restricted, companyId, lobId };
  }

  if (requested && !(await activeFarmOfCompany(db, requested, companyId ?? undefined, tenantId))) {
    throw new ForbiddenException('Not authorized for this farm.');
  }
  return { farmId: requested ?? null, restricted, companyId, lobId };
}

/** `column` holds a location on `farmId`: the farm row itself, or a row whose farm_id names it. */
export function locationOnFarm(column: AnyMySqlColumn, farmId: string): SQL {
  return sql`${column} IN (SELECT lf.location_id FROM location_master lf WHERE lf.location_id = ${farmId} OR lf.farm_id = ${farmId})`;
}

/** `column` holds a batch whose farm is `farmId`. */
export function batchOnFarm(batchIdColumn: AnyMySqlColumn, farmId: string): SQL {
  return sql`${batchIdColumn} IN (SELECT bf.batch_id FROM batch_header bf WHERE bf.farm_id = ${farmId})`;
}

/** `column` holds an animal standing on `farmId`: by its location, or by its batch when it has none. */
export function animalOnFarm(animalIdColumn: AnyMySqlColumn, farmId: string): SQL {
  return sql`${animalIdColumn} IN (
    SELECT af.animal_id FROM animal_register af
    WHERE af.current_location_id IN (SELECT lf.location_id FROM location_master lf WHERE lf.location_id = ${farmId} OR lf.farm_id = ${farmId})
       OR (af.current_location_id IS NULL AND af.current_batch_id IN (SELECT bf.batch_id FROM batch_header bf WHERE bf.farm_id = ${farmId}))
  )`;
}

/** For queries on batch_header itself. */
export function batchScopeConditions(scope: FarmScope): SQL[] {
  const conditions: SQL[] = [];
  if (scope.farmId) conditions.push(eq(schema.batchHeader.farm_id, scope.farmId));
  if (scope.restricted && scope.lobId) conditions.push(eq(schema.batchHeader.lob_id, scope.lobId));
  if (scope.restricted && scope.companyId) conditions.push(eq(schema.batchHeader.company_id, scope.companyId));
  return conditions;
}

/** For queries on animal_register itself. */
export function animalScopeConditions(scope: FarmScope): SQL[] {
  const conditions: SQL[] = [];
  if (scope.farmId) conditions.push(animalOnFarm(schema.animalRegister.animal_id, scope.farmId));
  if (scope.restricted && scope.lobId) conditions.push(eq(schema.animalRegister.lob_id, scope.lobId));
  return conditions;
}

/** The farm a location belongs to, or null if the location does not exist. */
export async function farmOfLocation(db: Db, locationId: string): Promise<string | null> {
  const [row] = await db
    .select({ location_id: schema.locationMaster.location_id, parent: schema.locationMaster.parent_location_id, farm_id: schema.locationMaster.farm_id })
    .from(schema.locationMaster)
    .where(eq(schema.locationMaster.location_id, locationId))
    .limit(1);
  if (!row) return null;
  return row.parent === null ? row.location_id : row.farm_id;
}

/** A create or update naming a location must stay on the active farm. Locations are visible masters, so this is a 403, not a 404. */
export async function assertLocationOnActiveFarm(db: Db, scope: FarmScope, locationId: string | null | undefined, label: string): Promise<void> {
  if (!scope.farmId || !locationId) return;
  if ((await farmOfLocation(db, locationId)) !== scope.farmId) {
    throw new ForbiddenException(`${label} is not on your active farm.`);
  }
}
```

- [ ] **Step 4: Run to verify it passes (lead)** — same command. Expected: PASS (10 tests).

- [ ] **Step 5: Commit (lead)** — `feat(access): farm-scope resolution and query conditions`.

---

### Task 3: Guard integration

**Files:**
- Modify: `apps/api/src/common/guards/roles.guard.ts:28-68`
- Test: `apps/api/src/common/guards/roles.guard.spec.ts`

**Interfaces:**
- Consumes: Task 2 `FARM_SCOPED_KEY`, `FARM_SCOPE_KEY`, `resolveFarmScope`.
- Produces: CLS `farmScope` set on every `@FarmScoped()` request after company/area validation.

- [ ] **Step 1: Write the failing tests** — add to `roles.guard.spec.ts`, following its existing `ExecutionContext` and CLS mocks (read the file; reuse its helper that builds a context and its `cls.set` spy):

```ts
  describe('farm scope', () => {
    it('stores the resolved scope for a farm-scoped route', async () => {
      // reflector returns true for FARM_SCOPED_KEY, no permission required;
      // user COMPANY_ADMIN, headers x-active-company-id: co-1, no area.
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(cls.set).toHaveBeenCalledWith('farmScope', { farmId: null, restricted: false, companyId: 'co-1', lobId: null });
    });

    it('refuses a standard user on a farm-scoped route without an area header', async () => {
      // user STANDARD_USER, farmId farm-g, headers x-active-company-id only.
      await expect(guard.canActivate(context)).rejects.toThrow('Select an operational area first.');
    });

    it('does not resolve a farm scope for routes that are not farm-scoped', async () => {
      await guard.canActivate(context);
      expect(cls.set).not.toHaveBeenCalledWith('farmScope', expect.anything());
    });
  });
```

- [ ] **Step 2: Run to verify it fails (lead)** — `--testPathPatterns=roles.guard`. Expected: FAIL.

- [ ] **Step 3: Implement** — in `canActivate`, directly after the `enforceMasterRequest` line (42):

```ts
    const farmScoped = this.reflector.getAllAndOverride<boolean>(FARM_SCOPED_KEY, [context.getHandler(), context.getClass()]);
    if (farmScoped) {
      const scope = await resolveFarmScope(this.db, {
        user,
        headers: request.headers,
        activeArea: this.cls.get('activeOperationalArea'),
        activeCompanyId: request.headers['x-active-company-id'] as string | undefined,
        tenantId: request.tenantId || user.tenantId,
      });
      this.cls.set(FARM_SCOPE_KEY, scope);
    }
```

and import `{ FARM_SCOPED_KEY, FARM_SCOPE_KEY, resolveFarmScope } from '../farm-scope'`.

- [ ] **Step 4: Run to verify it passes (lead)**. Expected: PASS, and the rest of `roles.guard.spec` still passes.

- [ ] **Step 5: Commit (lead)** — `feat(access): resolve farm scope in RolesGuard`.

---

### Task 4: Batches and schedulers

**Files:**
- Modify: `apps/api/src/modules/production/batch/batch.controller.ts` (class decorators), `batch.service.ts` (`findAll` 606, `findOne` 352, `create` 108)
- Modify: `apps/api/src/modules/production/scheduler-header/scheduler-header.controller.ts`, `scheduler-header.service.ts` (`findAllForBatch` 598, `findAllForCompany` 613, `findOne` 529, `createManualHeader` 301)
- Test: `batch.service.spec.ts`, `scheduler-header.service.spec.ts`

**Interfaces:**
- Consumes: `farmScope`, `batchScopeConditions`, `batchOnFarm`, `farmOfLocation`, `assertLocationOnActiveFarm`, `FarmScoped`.
- Produces: `BatchService.findOne(id)` answers 404 for a batch outside the farm scope — Tasks 5–8 rely on this when they load a batch through it.

- [ ] **Step 1: Write the failing tests** — in `batch.service.spec.ts`, stub `cls.get('farmScope')` (the existing spec builds its CLS via `transactionCls`; wrap `get` so `'farmScope'` returns the test's scope):

```ts
  describe('farm scope', () => {
    const grasmere = { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };

    it('answers 404 for a batch on another farm', async () => {
      useFarmScope(grasmere);
      rows.set(schema.batchHeader, []); // the scoped query finds nothing
      await expect(service.findOne('batch-on-kintyre')).rejects.toThrow(NotFoundException);
    });

    it('stamps the farm derived from the batch location on create', async () => {
      useFarmScope(grasmere);
      rows.set(schema.locationMaster, [{ location_id: 'pen-1', parent: 'shed-1', farm_id: 'farm-g' }]);
      await service.create({ ...validCreateDto, location_id: 'pen-1' }, 'tenant-1', { userId: 'u-1' } as any);
      expect(insertedValues(schema.batchHeader)).toMatchObject({ farm_id: 'farm-g' });
    });

    it('refuses creating a batch on a location of another farm', async () => {
      useFarmScope(grasmere);
      rows.set(schema.locationMaster, [{ location_id: 'pen-k', parent: 'shed-k', farm_id: 'farm-k' }]);
      await expect(service.create({ ...validCreateDto, location_id: 'pen-k' }, 'tenant-1', { userId: 'u-1' } as any))
        .rejects.toThrow('Batch location is not on your active farm.');
    });
  });
```

`useFarmScope`, `validCreateDto` and `insertedValues` are helpers the implementer adds to the spec following its existing mock style; `validCreateDto` must be the smallest DTO the existing create tests already use.

- [ ] **Step 2: Run to verify they fail (lead)** — `--testPathPatterns=production/batch/batch.service`. Expected: FAIL.

- [ ] **Step 3: Implement in `batch.service.ts`**
  - `findAll`: after the `conditions` array is built add `conditions.push(...batchScopeConditions(farmScope(this.cls)));`
  - `findOne`: change the `where` to `and(eq(schema.batchHeader.batch_id, id), isNull(schema.batchHeader.deleted_at), ...batchScopeConditions(farmScope(this.cls)))`.
  - `create`: before the transaction resolve the farm and refuse a mismatch:

```ts
    const scope = farmScope(this.cls);
    // CreateBatchDto carries shed_id and location_id (one or neither); sub_location_id is set later by stage transfer.
    const placementId = dto.location_id || dto.shed_id || null;
    await assertLocationOnActiveFarm(this.db, scope, placementId, 'Batch location');
    // A standard user's batch lands on their farm even when the form sent no location.
    const farmId = (placementId ? await farmOfLocation(this.db, placementId) : null) ?? scope.farmId;
```

    and add `farm_id: farmId,` to the `batchHeader` insert values next to `location_id`.
  - `batch.controller.ts`: add `@FarmScoped()` beside the class `@UseGuards`.

- [ ] **Step 4: Implement in `scheduler-header`**
  - Controller: `@FarmScoped()` on the class.
  - `findAllForBatch` and `findAllForCompany`: add `...(scope.farmId ? [batchOnFarm(schema.schedulerHeader.batch_id, scope.farmId)] : [])` to their conditions, where `const scope = farmScope(this.cls);`.
  - `findOne(id)`: after loading the header, `await this.batchService.findOne(header.batch_id)` if the service already injects `BatchService`; otherwise run `select batch_id from batch_header where batch_id = header.batch_id and ...batchScopeConditions(scope)` and throw `NotFoundException(\`Scheduler '${id}' not found.\`)` when empty.
  - `createManualHeader`: change the batch load (line 311) to `and(eq(schema.batchHeader.batch_id, dto.batch_id), eq(schema.batchHeader.tenant_id, tenantId), ...batchScopeConditions(farmScope(this.cls)))` — an out-of-scope batch then 404s through the existing `Batch '…' not found.`

- [ ] **Step 5: Add a scheduler spec case** — `findOne` of a scheduler whose batch is outside the farm throws `NotFoundException`.

- [ ] **Step 6: Run both suites (lead)** — `--testPathPatterns='(production/batch/batch.service|scheduler-header)'`. Expected: PASS.

- [ ] **Step 7: Commit (lead)** — `feat(access): scope batches and schedulers by farm`.

---

### Task 5: Daily entry and batch transfers

**Files:**
- Modify: `batch-daily-data.controller.ts` (class), `batch-daily-data.service.ts` (the private batch loader used by `entryForm`, `dayStatus`, `pendingDays`, `postEntry`, `recordUnscheduledHealth`)
- Modify: `apps/api/src/modules/production/batch/batch-transfer.controller.ts` (class), `batch-transfer.service.ts` (`loadBatch` 72, `findOne` 655, `findAll` 684)
- Test: `batch-daily-data.service.spec.ts`, `batch-transfer.service.spec.ts`

**Interfaces:**
- Consumes: `farmScope`, `batchScopeConditions`, `batchOnFarm`, `FarmScoped`.

- [ ] **Step 1: Write the failing tests**

In `batch-daily-data.service.spec.ts` (its DB mock answers by table; stub `farmScope` on the CLS as in Task 4):

```ts
  it('answers 404 when the batch is on another farm', async () => {
    useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    rows.set(schema.batchHeader, []); // scoped batch lookup finds nothing
    await expect(service.entryForm('batch-1', undefined as any, 'tenant-123', { userId: 'u' } as any)).rejects.toThrow(NotFoundException);
  });
```

In `batch-transfer.service.spec.ts`:

```ts
  it('lists a transfer for either farm it touches', async () => {
    useFarmScope({ farmId: 'farm-g', restricted: false, companyId: 'co-1', lobId: null });
    await service.findAll({} as any, 'tenant-1');
    expect(renderedWhere()).toMatch(/from_batch_id.*IN.*batch_header.*OR.*to_batch_id.*IN.*batch_header/s);
  });
```

`renderedWhere` renders the captured `where` argument with `new MySqlDialect().sqlToQuery`; add it beside the spec's existing mock helpers. Use the real method name the daily-data spec already calls for the form (read the spec — it may be `entryForm` or `form`).

- [ ] **Step 2: Run to verify they fail (lead)**.

- [ ] **Step 3: Implement**
  - Both controllers: `@FarmScoped()` on the class.
  - `batch-daily-data.service.ts`: every place that loads the batch by `batchId` adds `...batchScopeConditions(farmScope(this.cls))` to its `where`; the existing "batch not found" `NotFoundException` then covers out-of-farm batches.
  - `batch-transfer.service.ts` `loadBatch`: add `...batchScopeConditions(farmScope(this.cls))` to its `where` — covers `create`, split and merge. **Destination** batches must stay loadable across farms within the company, so give `loadBatch` a third parameter `scoped = true` and call `loadBatch(dto.to_batch_id, tenantId, 'Destination', false)` in `create`.
  - `findAll`: `const scope = farmScope(this.cls); if (scope.farmId) conditions.push(or(batchOnFarm(schema.batchTransfer.from_batch_id, scope.farmId), batchOnFarm(schema.batchTransfer.to_batch_id, scope.farmId))!);`
  - `findOne`: add the same `or(...)` condition to its `where` when `scope.farmId` is set.

- [ ] **Step 4: Run to verify they pass (lead)**.

- [ ] **Step 5: Commit (lead)** — `feat(access): scope daily entry and batch transfers by farm`.

---

### Task 6: Animals and breeding

**Files:**
- Modify: `apps/api/src/modules/piggery/animal/animal.controller.ts`, `animal-medication-log.controller.ts` (class), `animal.service.ts` (`findAll` 560, `findOne` 546, `create` 265, `update` 594)
- Modify: `apps/api/src/modules/piggery/breeding/breeding.controller.ts` (class), `breeding.service.ts` (`getMatingRecords` 162, `getFarrowingRecords` 333, `getSemenBatches` 439, and the sow/boar loads in `recordMating`, `recordPregnancyCheck`, `recordFarrowing`, `recordWeaning`, `recordSemenCollection`)
- Test: `animal.service.spec.ts`, `breeding.service.spec.ts` (create if absent, modelled on `batch-daily-data.service.spec.ts` lines 19-89)

**Interfaces:**
- Consumes: `farmScope`, `animalScopeConditions`, `animalOnFarm`, `assertLocationOnActiveFarm`, `batchScopeConditions`, `FarmScoped`.

- [ ] **Step 1: Write the failing tests**

```ts
  // animal.service.spec.ts
  it('answers 404 for an animal on another farm', async () => {
    useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    rows.set(schema.animalRegister, []);
    await expect(service.findOne('animal-on-kintyre')).rejects.toThrow(NotFoundException);
  });

  it('refuses placing an animal on another farm', async () => {
    useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    rows.set(schema.locationMaster, [{ location_id: 'pen-k', parent: 'shed-k', farm_id: 'farm-k' }]);
    await expect(service.create({ ...validAnimalDto, current_location_id: 'pen-k' } as any, 'tenant-1'))
      .rejects.toThrow('Animal location is not on your active farm.');
  });

  // breeding.service.spec.ts
  it('lists only matings of sows on the active farm', async () => {
    useFarmScope({ farmId: 'farm-g', restricted: false, companyId: 'co-1', lobId: null });
    await service.getMatingRecords('tenant-1');
    expect(renderedWhere()).toContain('animal_register af');
  });

  it('answers 404 when recording a mating for a sow on another farm', async () => {
    useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    rows.set(schema.animalRegister, []);
    await expect(service.recordMating({ sow_animal_id: 'sow-k', mating_date: '2026-09-01' } as any, 'tenant-1'))
      .rejects.toThrow(NotFoundException);
  });
```

- [ ] **Step 2: Run to verify they fail (lead)**.

- [ ] **Step 3: Implement**
  - Controllers: `@FarmScoped()` on `AnimalController`, `AnimalMedicationLogController`, `BreedingController`.
  - `animal.service.ts` `findAll`: after the `masterScopeConditions` push add `conditions.push(...animalScopeConditions(farmScope(this.cls)));`. `findOne`: `where(and(eq(schema.animalRegister.animal_id, id), ...animalScopeConditions(farmScope(this.cls))))`.
  - `create` and `update`: before writing, `await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.current_location_id, 'Animal location');` and, when `dto.current_batch_id` is set, load it with `batchScopeConditions` and throw `NotFoundException('Batch not found.')` when absent.
  - `breeding.service.ts` lists: add `...(scope.farmId ? [animalOnFarm(schema.breedingRecord.sow_animal_id, scope.farmId)] : [])` (farrowing: `farrowingRecord.sow_animal_id`; semen: `semenBatch.boar_animal_id`).
  - Every sow/boar load in the record methods adds `...animalScopeConditions(farmScope(this.cls))` to its `where`, so the existing `… not found` `NotFoundException` covers other farms.

- [ ] **Step 4: Run to verify they pass (lead)** — `--testPathPatterns='(piggery/animal|piggery/breeding)'`.

- [ ] **Step 5: Commit (lead)** — `feat(access): scope animals and breeding by farm`.

---

### Task 7: Inventory documents

**Files:**
- Modify: controllers and services of `goods-receipt`, `goods-issue`, `stock-adjustment`, `stock-transfer` (methods `create`, `findOne`, `findAll`, `update`; line numbers in the roadmap survey: receipt 49/106/125/157, issue 48/99/118/143, adjustment 48/100/119/144, transfer 48/103/122/146)
- Test: each module's `*.service.spec.ts`

**Interfaces:**
- Consumes: `farmScope`, `locationOnFarm`, `assertLocationOnActiveFarm`, `FarmScoped`.

- [ ] **Step 1: Write the failing tests** — for goods receipt (repeat the same three cases in each of the other three specs, changing the service, table and warehouse field; stock transfer uses `from_warehouse_id` for create and either warehouse for reads):

```ts
  describe('farm scope', () => {
    const grasmere = { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };

    it('lists only receipts into warehouses on the active farm', async () => {
      useFarmScope(grasmere);
      await service.findAll({} as any, 'tenant-1');
      expect(renderedWhere()).toContain('location_master lf');
    });

    it('answers 404 for a receipt into another farm', async () => {
      useFarmScope(grasmere);
      rows.set(schema.goodsReceipt, []);
      await expect(service.findOne('grn-kintyre')).rejects.toThrow(NotFoundException);
    });

    it('refuses a receipt into a warehouse on another farm', async () => {
      useFarmScope(grasmere);
      rows.set(schema.locationMaster, [{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k' }]);
      await expect(service.create({ ...validReceiptDto, warehouse_id: 'store-k' } as any, 'tenant-1'))
        .rejects.toThrow('Warehouse is not on your active farm.');
    });
  });
```

- [ ] **Step 2: Run to verify they fail (lead)** — `--testPathPatterns='inventory/(goods-receipt|goods-issue|stock-adjustment|stock-transfer)'`.

- [ ] **Step 3: Implement (per service)**
  - Controller: `@FarmScoped()` on the class.
  - `findAll`: `const scope = farmScope(this.cls); if (scope.farmId) conditions.push(locationOnFarm(schema.goodsReceipt.warehouse_id, scope.farmId));` — stock transfer: `or(locationOnFarm(schema.stockTransfer.from_warehouse_id, id), locationOnFarm(schema.stockTransfer.to_warehouse_id, id))!`.
  - `findOne`: add the same condition to its `where`; the existing not-found exception answers.
  - `create` and `update`: first line inside, `await assertLocationOnActiveFarm(this.db, farmScope(this.cls), dto.warehouse_id, 'Warehouse');` — stock transfer checks `dto.from_warehouse_id` with label `Source warehouse` (the destination may be another farm; farm-to-farm approval is Phase 7).

- [ ] **Step 4: Run to verify they pass (lead)**.

- [ ] **Step 5: Commit (lead)** — `feat(access): scope inventory documents by farm`.

---

### Task 8: Inventory ledger, stock balance and approvals

**Files:**
- Modify: `inventory-ledger.controller.ts` (class), `inventory-ledger.service.ts` (`findAll` 406, `getStockBalance` 438, `findOne` 397)
- Modify: `approval.controller.ts` (class), `approval.service.ts` (`findAll` 107, `counts` 145, `findOne` 160)
- Test: `inventory-ledger.service.spec.ts`, `approval.service.spec.ts`

**Interfaces:**
- Consumes: `farmScope`, `locationOnFarm`, `batchOnFarm`, `FarmScoped`.

- [ ] **Step 1: Write the failing tests**

```ts
  // inventory-ledger.service.spec.ts
  it('includes batch issues with no warehouse through their batch farm', async () => {
    useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    await service.findAll({} as any, 'tenant-1');
    const where = renderedWhere();
    expect(where).toContain('location_master lf');
    expect(where).toMatch(/warehouse_id` is null.*batch_header b/s);
  });

  // approval.service.spec.ts
  it('hides approvals with no batch from a restricted user', async () => {
    useFarmScope({ farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    await service.findAll({} as any, 'tenant-1');
    expect(renderedWhere()).toContain('batch_header bf');
  });

  it('shows every approval to an admin with no farm selected', async () => {
    useFarmScope({ farmId: null, restricted: false, companyId: 'co-1', lobId: null });
    await service.findAll({} as any, 'tenant-1');
    expect(renderedWhere()).not.toContain('batch_header bf');
  });
```

- [ ] **Step 2: Run to verify they fail (lead)**.

- [ ] **Step 3: Implement**
  - Controllers: `@FarmScoped()` on both classes.
  - `inventory-ledger.service.ts`, a private helper used by `findAll`, `findOne` and `getStockBalance`:

```ts
  /** Ledger rows on the active farm. Batch issues carry no warehouse, so they reach their farm through the batch. */
  private farmConditions(): SQL[] {
    const { farmId } = farmScope(this.cls);
    if (!farmId) return [];
    return [or(
      locationOnFarm(schema.inventoryLedger.warehouse_id, farmId),
      and(
        isNull(schema.inventoryLedger.warehouse_id),
        sql`EXISTS (SELECT 1 FROM batch_header b WHERE b.batch_no = ${schema.inventoryLedger.batch_no} AND b.company_id = ${schema.inventoryLedger.company_id} AND b.farm_id = ${farmId})`,
      ),
    )!];
  }
```

    `findAll`: `conditions.push(...this.farmConditions());`. `getStockBalance`: same (balance rows always have a warehouse, the helper is still correct). `findOne(ledgerId)`: `where(and(eq(schema.inventoryLedger.ledger_id, ledgerId), ...this.farmConditions()))` — it returns `undefined` today on a miss; keep that contract.
  - `approval.service.ts`, a private helper used by `findAll`, `counts` and `findOne`:

```ts
  /**
   * An approval reaches a farm only through its batch. One with no batch has no
   * farm, so a restricted user never sees it; an admin sees it unless a farm is selected.
   */
  private farmConditions(): SQL[] {
    const { farmId, restricted } = farmScope(this.cls);
    if (farmId) return [batchOnFarm(schema.approvalRequest.batch_id, farmId)];
    if (restricted) return [sql`${schema.approvalRequest.batch_id} IS NOT NULL`];
    return [];
  }
```

    Note for restricted users with no farm (operational admin across farms) the batch must still be in their LOB: add `sql\`${schema.approvalRequest.batch_id} IN (SELECT bl.batch_id FROM batch_header bl WHERE bl.lob_id = ${lobId})\`` when `restricted && lobId`.

- [ ] **Step 4: Run to verify they pass (lead)**.

- [ ] **Step 5: Commit (lead)** — `feat(access): scope ledger, stock balance and approvals by farm`.

---

### Task 9: Coverage spec

**Files:**
- Create: `apps/api/src/common/farm-scope-coverage.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FARM_SCOPED_KEY } from './farm-scope';
import { BatchController } from '../modules/production/batch/batch.controller';
import { BatchDailyDataController } from '../modules/production/batch-daily-data/batch-daily-data.controller';
import { BatchTransferController } from '../modules/production/batch/batch-transfer.controller';
import { SchedulerHeaderController } from '../modules/production/scheduler-header/scheduler-header.controller';
import { ApprovalController } from '../modules/production/approval/approval.controller';
import { AnimalController } from '../modules/piggery/animal/animal.controller';
import { AnimalMedicationLogController } from '../modules/piggery/animal/animal-medication-log.controller';
import { BreedingController } from '../modules/piggery/breeding/breeding.controller';
import { GoodsReceiptController } from '../modules/inventory/goods-receipt/goods-receipt.controller';
import { GoodsIssueController } from '../modules/inventory/goods-issue/goods-issue.controller';
import { StockAdjustmentController } from '../modules/inventory/stock-adjustment/stock-adjustment.controller';
import { StockTransferController } from '../modules/inventory/stock-transfer/stock-transfer.controller';
import { InventoryLedgerController } from '../modules/inventory/inventory-ledger/inventory-ledger.controller';

/**
 * Farm scope is opt-in per controller, and a controller that forgets it reads
 * every farm's records — the failure the 14 September audit found in all of
 * these. Every controller under the operational modules must be either marked
 * or named here as exempt with the reason, so a new one cannot slip in unscoped.
 */
const SCOPED = {
  BatchController, BatchDailyDataController, BatchTransferController, SchedulerHeaderController,
  ApprovalController, AnimalController, AnimalMedicationLogController, BreedingController,
  GoodsReceiptController, GoodsIssueController, StockAdjustmentController, StockTransferController,
  InventoryLedgerController,
};

const EXEMPT: Record<string, string> = {
  'inventory/bio-asset-ledger/bio-asset-ledger.controller.ts': 'Finance reconciliation, company-level by decision.',
  'production/alert/alert.controller.ts': 'Alerts carry no batch or location to reach a farm through.',
  'production/milk/milk.controller.ts': 'Dairy — dormant, out of scope.',
  'production/parameter/parameter.controller.ts': 'Master data, not farm-specific.',
  'production/qc-parameter/qc-parameter.controller.ts': 'Master data, not farm-specific.',
  'production/qc/qc.controller.ts': 'Not in the MVP scope; classify when QC is built.',
  'production/qr-code/qr-code.controller.ts': 'Not in the MVP scope; classify when QR packs are built.',
  'production/stage/stage.controller.ts': 'Master data, not farm-specific.',
};

const MODULES = join(__dirname, '../modules');
const OPERATIONAL_DIRS = ['production', 'piggery', 'inventory'];

function controllerFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.controller.ts')) found.push(relative(MODULES, full));
    }
  };
  for (const dir of OPERATIONAL_DIRS) walk(join(MODULES, dir));
  return found.sort();
}

describe('Farm scope coverage', () => {
  it.each(Object.entries(SCOPED))('%s is farm-scoped', (_name, controller) => {
    expect(Reflect.getMetadata(FARM_SCOPED_KEY, controller)).toBe(true);
  });

  it('classifies every operational controller as scoped or exempt', () => {
    const scopedClassNames = new Set(Object.keys(SCOPED));
    const unclassified = controllerFiles().filter((file) => {
      if (EXEMPT[file]) return false;
      const source = readFileSync(join(MODULES, file), 'utf8');
      const className = /export class (\w+)/.exec(source)?.[1];
      return !className || !scopedClassNames.has(className);
    });
    expect(unclassified).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it (lead)** — `--testPathPatterns=farm-scope-coverage`. Expected: PASS once Tasks 4–8 are in; it must FAIL if any `@FarmScoped()` is removed — check by temporarily deleting one and re-running, then restore.

- [ ] **Step 3: Commit (lead)** — `test(access): every operational controller is farm-scoped or exempt`.

---

### Task 10: Operator permission remap and the backlog gate

**Files:**
- Modify: `apps/api/src/modules/production/batch/batch.controller.ts` (lines 42, 98, 108, 118, 128, 138, 148, 168)
- Modify: `apps/api/src/modules/production/batch-daily-data/entry-window.ts` and `entry-window.spec.ts`
- Modify: `apps/api/src/modules/production/batch-daily-data/batch-daily-data.service.ts` (callers of `entryVerdict`, ~288 and the backlog query ~553-600)
- Test: `batch.controller.spec.ts` (create), `entry-window.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// batch.controller.spec.ts
import { BatchController } from './batch.controller';
import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';

/**
 * OPERATOR holds PRODUCTION/BATCH edit so it can record work, and every
 * lifecycle action below was gated by edit too — so the least-privileged role
 * could close, dispose or revalue a batch. The seed's own intent for OPERATOR is
 * "records work, approves nothing".
 */
describe('BatchController permissions', () => {
  const permission = (name: string) => Reflect.getMetadata(REQUIRE_PERMISSION_KEY, (BatchController.prototype as any)[name]);

  it.each(['close', 'matureBioAsset', 'amortizeBioAsset', 'recordFairValue', 'disposeBioAsset', 'transferStage'])(
    '%s requires approve', (name) => {
      expect(permission(name)).toEqual({ moduleCode: 'PRODUCTION', resource: 'BATCH', action: 'approve' });
    });

  it.each(['bulkAddDailyTransactions', 'addTransaction'])('%s is recorded under BATCH_ENTRY create', (name) => {
    expect(permission(name)).toEqual({ moduleCode: 'PRODUCTION', resource: 'BATCH_ENTRY', action: 'create' });
  });
});
```

Use the controller's actual handler method names for these routes (read `batch.controller.ts` lines 32-190 and substitute exactly).

```ts
// entry-window.spec.ts — replace the BACKLOG cases with:
  it('never holds today back for an earlier incomplete day', () => {
    expect(entryVerdict({ entryDate: '2026-09-14', today: '2026-09-14', exists: false, mayEditAnyDay: false }))
      .toEqual({ allowed: true });
  });
```

- [ ] **Step 2: Run to verify they fail (lead)** — `--testPathPatterns='(batch.controller|entry-window)'`.

- [ ] **Step 3: Implement**
  - `batch.controller.ts`: change `'edit'` to `'approve'` on close (108), mature (118), amortize (128), fair-value (138), dispose (148), transfer-stage (168). Change bulk-daily-entry (42) and transaction (98) to `@RequirePermission('PRODUCTION', 'BATCH_ENTRY', 'create')`.
  - `entry-window.ts`: delete `'BACKLOG'` from `EntryRefusal`, delete `earlierPending` from `EntryRequest`, delete the backlog block, and replace the header comment's third bullet with: `A missed day never blocks today (decided 2026-09-14): gaps are surfaced as Missing and notified instead.`
  - `batch-daily-data.service.ts`: remove the `earlierPending:` argument and the backlog query that fed it; keep `pendingDays` and the form's `backlog` field — History still shows what is missing.

- [ ] **Step 4: Run to verify they pass (lead)**, then the whole `batch-daily-data` directory.

- [ ] **Step 5: Commit (lead)** — `fix(batch): lifecycle actions need approve, and a missed day no longer blocks today`.

---

### Task 11: Phase gate (lead only)

- [ ] **Step 1: Full suites and typecheck**

```bash
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx test api --runInBand --watchman=false
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx typecheck api
NODE_OPTIONS=--max-old-space-size=1024 pnpm nx test web --runInBand --watchman=false
```
Expected: all pass (web is unchanged but `role-permissions-coverage` reads API decorators).

- [ ] **Step 2: Rebuild and restart the API** per the roadmap's machine rules.

- [ ] **Step 3: Probe users** — the Phase 3 seed creates the demo cast. Until it exists, create probe users with a registered verify/apply script `apps/api/src/scripts/probe-farm-scope-users.ts` (pattern: `assign-operator-operational-area.ts`): one `STANDARD_USER` on MUL100 with `farm_id` set and a PIGGERY-01 area assignment, one on POR100, one batch placed on a POR100 location. Label every name `DEMO VERIFICATION`. They are dropped by the Phase 3 rebuild.

- [ ] **Step 4: Live probes** — each with MySQL counts before and after:

| Probe | Expected |
|---|---|
| Grasmere worker `GET /batch` | only MUL100 batches |
| Grasmere worker `GET /batch/:kintyreBatch` | 404 |
| Grasmere worker, area header omitted | 400 `Select an operational area first.` |
| Grasmere worker `x-active-farm-id: POR100` | 403 `Not authorized for this farm.` |
| Grasmere worker `POST /batch` on a POR100 location | 403, no row written |
| Company admin, no farm header | both farms' batches |
| Company admin `x-active-farm-id: POR100` | Kintyre only |
| Operational admin, no farm header | both farms, Piggery LOB only |
| Grasmere worker `GET /inventory-ledger` | MUL100 warehouses plus batch issues of MUL100 batches only |
| Grasmere worker `GET /approval` | only approvals with a MUL100 batch |
| Operator `POST /batch/:id/close` | 403 |
| Operator entry for today with yesterday missing | allowed |

- [ ] **Step 5: Write `docs/VERIFICATION-<date>-phase-01.md`**, commit, and update `docs/HANDOFF-2026-09-14-continuation.md` "Start here" to point at the roadmap.
