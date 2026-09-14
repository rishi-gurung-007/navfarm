# Phase 2 — Farm-specific Breeds and Batch Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> Roadmap: `2026-09-14-mvp-delivery-plan.md` — its Global constraints and Machine
> rules apply to every task here.

**Goal:** a Breed is a farm-specific profile whose code is the normalised breed name
shared across farms; an Animal can only stand on its breed's farm; a Batch is created
on an explicit farm in one of two tracking modes — Registered Animals (individual
Animal Register rows, stage counts from live animals) or Count Only (no Animal rows,
one Stage) — enforced by the API and exposed in the web forms.

**Architecture:** no new tables. `breed_master.location_id` (already a validated root
FARM reference) is the breed's farm; its unique index gains that farm. Breed codes stay
issued by the BREED Number Series (`code_segments: ["breed_name"]`, no sequence — already
configured), whose clash check becomes per farm. Batch create takes
`farm_id` and `animal_tracking` explicitly; the tracking mode — not the costing method —
decides whether Animal rows are registered. The farm-scope helpers from Phase 1
(`apps/api/src/common/farm-scope.ts`) are reused; nothing in them changes.

**Tech stack:** NestJS 11, Drizzle ORM, MySQL, Jest; Next.js 16 / React 19 web.

**Specs:** `docs/superpowers/specs/2026-09-14-access-scope-and-master-data-ux-design.md`
§3, §4, §12 (Breed/Batch/Animal bullets) and
`docs/superpowers/specs/2026-09-14-daily-data-entry-and-transfers-design.md` §4, §13.

## Rulings this plan makes (recorded in `docs/decisions.md` in Task 8)

1. **Breed codes come from the Number Series, per farm.** Rishi, 2026-09-15: the Number
   Series was extended for exactly this — the BREED series is configured with
   `code_segments: ["breed_name"]` and `seq_length: 0`, so `"Large White"` → `LARGE_WHITE`
   through `normalizeSegment`, matching spec §13. Two defects stop it working with
   farm-specific breeds and are fixed here: `BreedService.resolveBreedCode` bypasses the
   series with a farm-prefixed composite code whenever a farm is chosen, and the series'
   clash check (`scopeKeyConditions`) is tenant + company only, so the second farm's
   `LARGE_WHITE` would be refused. A breed's code is identity and is not regenerated on
   rename, as with every series-issued code. **Manual entry stays allowed** on the
   BREED series (Rishi, 2026-09-15) — keep the `allow_manual` branch; codes typed by hand
   are his to keep consistent across farms.
2. **Tenant templates stay farm-less.** A breed with `company_id IS NULL` is a tenant
   template, not a farm profile; farm is required for company breeds only.
3. **Registered Animals registers the opening headcount.** A `REGISTERED` batch with
   `opening_quantity > 0` gets its Animal rows at create, whatever the costing method;
   a `COUNT_ONLY` batch never does — including `BIO_ASSET`, which today registers rows
   regardless. Registered requires a breed.
4. **`batch_header.farm_id` stays nullable in the database.** Required by the DTO and
   service on create; tightening the column waits for the Phase 3 rebuild, because other
   insert paths (renew, split, seeds) must first be proven to set it.

## Global constraints (this phase)

- Farm = an active `location_master` row with `location_type = 'FARM'` and
  `parent_location_id IS NULL`, in the active company.
- Breed on one farm whose series code already exists on that farm → 409 (the series' existing `Code "<code>" already exists…` conflict); the same code on another farm is allowed.
- Animal/breed farm mismatch → 403 `Animal location is not on the breed's farm.` / `Batch is not on the breed's farm.`
- A company animal whose breed has no farm → 400 `Choose the farm-specific breed profile for this animal.`
- Batch without a farm → 400 `Select the farm this batch runs on.`; placement on another farm → 403 `Batch location is not on the batch's farm.`; breed on another farm → 403 `The breed profile belongs to another farm.`
- Count Only violations → 400 `A Count Only batch has no individual animals.`
- Registered without a breed → 400 `A Registered Animals batch needs a breed.`
- Tracking mode codes `REGISTERED` / `COUNT_ONLY`; web labels **Registered Animals** / **Count Only**.
- New web strings: English dictionary only.
- Agents write code and tests; they never run tests, builds, servers, browsers or MySQL writes and never commit. The lead runs every **(lead)** block serially.

## File map

| File | Responsibility |
|---|---|
| Create `apps/api/src/drizzle/tenant/0094_breed_farm_unique_code.sql` + journal idx 94 | Farm-aware breed uniqueness |
| Modify `apps/api/src/core/database/schema.ts` (breedMaster index ~804) | Same index in Drizzle |
| Modify `apps/api/src/modules/system/number-series/master-code-columns.ts`, `number-series.service.ts` (+ spec) | Clash check scoped by a master's identity fields (BREED: farm) |
| Modify `apps/api/src/modules/master-data/breed/breed.service.ts`, `dto/breed.dto.ts` (+ spec) | Series code with the farm, farm required, per-farm duplicates, list shows farm |
| Modify `apps/api/src/modules/piggery/animal/animal.service.ts` (+ spec) | Breed-farm match, Count Only refusals |
| Modify `apps/api/src/modules/production/batch/dto/batch.dto.ts`, `batch.service.ts` (+ spec) | Explicit farm, tracking mode, registration gate |
| Modify `apps/api/src/modules/production/batch-daily-data/batch-daily-data.service.ts` (+ spec) | Day status headcount from live animals for Registered |
| Modify `apps/web/src/modules/master-data/configs.ts` | Breed farm required/listed; derived code; animal breed selector shows farm |
| Modify `apps/web/src/components/console/production/batch-panel.tsx`, `apps/web/src/utils/translations.ts` | Farm, placement-by-farm, tracking mode in batch create |

---

### Task 1: Farm-aware breed uniqueness

**Files:**
- Create: `apps/api/src/drizzle/tenant/0094_breed_farm_unique_code.sql`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json`, `apps/api/src/core/database/schema.ts:804`

**Interfaces:** Produces unique index `uq_breed_master_scope_farm_code` on `(tenant_id, coalesce(company_id,''), coalesce(location_id,''), breed_code)`.

- [ ] **Step 1: Check existing data cannot violate the new index (lead)**

```bash
mysql -u root tenant_devco -e "SELECT tenant_id, COALESCE(company_id,'') c, COALESCE(location_id,'') l, breed_code, COUNT(*) n FROM breed_master GROUP BY 1,2,3,4 HAVING n > 1;"
```
Expected: empty. The old index is strictly tighter, so it must be.

- [ ] **Step 2: Write the migration**

```sql
ALTER TABLE `breed_master` DROP INDEX `uq_breed_master_scope_code`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_breed_master_scope_farm_code` ON `breed_master` (`tenant_id`,(coalesce(`company_id`, '')),(coalesce(`location_id`, '')),`breed_code`);
```

- [ ] **Step 3: Journal entry** — append `{ "idx": 94, "version": "5", "when": 1789234407180, "tag": "0094_breed_farm_unique_code", "breakpoints": true }`.

- [ ] **Step 4: Schema** — replace the breedMaster index callback with:

```ts
}, (table) => [
  // Farm is part of a breed's identity: the same biological breed carries the same
  // code on every farm, with that farm's own benchmarks (decided 2026-09-14).
  uniqueIndex('uq_breed_master_scope_farm_code').on(table.tenant_id, sql`(coalesce(${table.company_id}, ''))`, sql`(coalesce(${table.location_id}, ''))`, table.breed_code),
]);
```

- [ ] **Step 5: Apply and check (lead)** — `pnpm nx run api:db-migrate-all-tenants`; `mysql -u root tenant_devco -e "SHOW INDEX FROM breed_master WHERE Key_name LIKE 'uq_breed%';"` shows only the new index.

- [ ] **Step 6: Commit (lead)** — `feat(breed): a breed's farm is part of its identity`.

---

### Task 2: Breed codes from the series, per farm; farm required; farm in lists

**Files:**
- Modify: `apps/api/src/modules/system/number-series/master-code-columns.ts`, `number-series.service.ts` (`nextAvailableCode` 239-280), `number-series.service.spec.ts`
- Modify: `apps/api/src/modules/master-data/breed/breed.service.ts` (`resolveBreedCode` 47-75, `createBreed` 322-430, `findAllBreeds` 446-492, `updateBreed` 494-583), `dto/breed.dto.ts`, `breed.service.spec.ts`

**Interfaces:**
- Produces: `MASTER_CODE_IDENTITY_FIELDS: Record<string, string[]>` exported from `master-code-columns.ts` with `BREED: ['location_id']`; `GET /breed` rows carry `location_code`, `location_name`; `GET /breed?locationId=<farm>` filters by farm.

- [ ] **Step 1: Failing tests — `number-series.service.spec.ts`** (follow its existing mocks; the BREED series fixture is `{ series_code: 'BREED', document_type: 'BREED', prefix: null, separator: '-', seq_length: 0, allow_manual: true, code_segments: ['breed_name'], prefix_position: 'END', is_active: true }`):

```ts
  describe('a code whose identity includes the farm', () => {
    it('issues the same breed code on a second farm', async () => {
      // breed_master already holds LARGE_WHITE on farm-g; the occupied query must be scoped to farm-k and find nothing
      const code = await service.generateNext('BREED', 'tenant-1', 'co-1', undefined, { breed_name: 'Large White', location_id: 'farm-k' });
      expect(code).toBe('LARGE_WHITE');
      expect(renderedOccupiedWhere()).toContain('`breed_master`.`location_id` = ?');
    });

    it('refuses the same breed twice on one farm', async () => {
      // occupied query scoped to farm-g returns LARGE_WHITE
      await expect(service.generateNext('BREED', 'tenant-1', 'co-1', undefined, { breed_name: 'Large White', location_id: 'farm-g' }))
        .rejects.toThrow('Code "LARGE_WHITE" already exists');
    });
  });
```
`renderedOccupiedWhere` renders the captured `where` of the occupied-codes select with `new MySqlDialect().sqlToQuery(...)`; use the real `generateNext` signature from the service.

- [ ] **Step 2: Failing tests — `breed.service.spec.ts`** (call-order mocks; document the queue order in a comment):

```ts
  describe('farm-specific profiles', () => {
    it('asks the series for the code with the farm, never a farm-prefixed composite', async () => {
      await service.createBreed({ ...validBreedDto, breed_name: 'Large White', location_id: FARM_G } as any, 'tenant-1', user);
      expect(numberSeries.generateNext).toHaveBeenCalledWith('BREED', 'tenant-1', COMPANY, expect.anything(), expect.objectContaining({ breed_name: 'Large White', location_id: FARM_G }));
    });

    it('requires a farm for a company breed', async () => {
      await expect(service.createBreed({ ...validBreedDto, location_id: undefined } as any, 'tenant-1', user))
        .rejects.toThrow('Select the farm this breed profile belongs to.');
    });

    it('checks duplicates on the breed\'s own farm only', async () => {
      await service.createBreed({ ...validBreedDto, breed_name: 'Large White', location_id: FARM_K } as any, 'tenant-1', user);
      expect(renderedDuplicateWhere()).toContain('`breed_master`.`location_id` = ?');
    });

    it('keeps the code when the breed is renamed', async () => {
      await service.updateBreed(BREED_ID, { breed_name: 'Landrace' } as any, 'tenant-1', user);
      expect(updatedBreed()).not.toHaveProperty('breed_code');
    });
  });
```

- [ ] **Step 3: Implement the identity scope** — `master-code-columns.ts`:

```ts
/**
 * Fields that belong to a code's identity besides tenant and company. A breed is a
 * farm-specific profile whose code is shared by the same breed on every farm
 * (decided 2026-09-14), so LARGE_WHITE on one farm must not block it on another.
 */
export const MASTER_CODE_IDENTITY_FIELDS: Record<string, string[]> = {
  BREED: ['location_id'],
};
```

In `nextAvailableCode`, build the occupied-codes `where` as:

```ts
      const identity = (MASTER_CODE_IDENTITY_FIELDS[master] ?? [])
        .filter((name) => columns[name])
        .map((name) => (record[name] ? eq(columns[name], record[name] as string) : isNull(columns[name])));
      const rows = await executor.select({ code: columns[field] }).from(table).where(and(
        ...scopeKeyConditions(columns, tenantId, companyId),
        ...identity,
      ));
```

The preview path (line ~528) already passes `record`, so previews scope the same way.

- [ ] **Step 4: Implement in `breed.service.ts`**
  - `resolveBreedCode`: keep the `requireRootFarm` validation, the "no series → manual code" branch and the `allow_manual` branch; **delete the `generateCompositeCode` branch** so every generated code comes from `this.numberSeriesService.generateNext(seriesCode, tenantId, companyId, executor, dto as unknown as Record<string, unknown>)`. Remove imports left unused.
  - `createBreed`: when the resolved `companyId` is non-null and `dto.location_id` is empty → `BadRequestException('Select the farm this breed profile belongs to.')`, before `resolveBreedCode`. The existing duplicate check adds `dto.location_id ? eq(schema.breedMaster.location_id, dto.location_id) : isNull(schema.breedMaster.location_id)`.
  - `updateBreed`: never change `breed_code` because the name changed; when `location_id` changes, run the duplicate check on the new farm with the breed's existing code, excluding itself; clearing `location_id` on a company breed → the same 400.
  - `findAllBreeds`: left join `location_master` on `breed_master.location_id`, select all breed columns plus `location_code` and `location_name`; `if (query.locationId) conditions.push(eq(schema.breedMaster.location_id, query.locationId));`. Keep the method's current return contract (rows, total, paging, sort).
  - `QueryBreedDto`: `@ApiProperty({ required: false }) @IsUUID() @IsOptional() locationId?: string;`.

- [ ] **Step 5: Run (lead)** — `--testPathPatterns='(master-data/breed|number-series)'`. Expected: PASS.

- [ ] **Step 6: Commit (lead)** — `fix(breed): series codes are per farm, and a farm no longer bypasses the series`.

---

### Task 3: Animals stand on their breed's farm; Count Only has no animals

**Files:**
- Modify: `apps/api/src/modules/piggery/animal/animal.service.ts` (`create` ~266-411, `update` ~606-675, `transitionStage` ~912, `bulkTransitionStage` ~884), `animal.service.spec.ts`

**Interfaces:**
- Consumes: `farmOfLocation(db, locationId)` from `common/farm-scope.ts`; `breed_master.location_id`; `batch_header.farm_id`, `batch_header.animal_tracking`.
- Produces: private `assertAnimalPlacement(breedId, batchId, locationId): Promise<void>` used by create and update.

- [ ] **Step 1: Failing tests** — in `animal.service.spec.ts` (call-order `found()` style with `useFarmScope` from `test-utils/transaction-cls`):

```ts
  describe('breed farm and tracking mode', () => {
    it('refuses a location on another farm than the breed', async () => {
      // breed on FARM_G; location pen-k resolves to FARM_K
      await expect(service.create({ ...validAnimalDto, breed_id: 'breed-g', current_location_id: 'pen-k' } as any, 'tenant-1'))
        .rejects.toThrow("Animal location is not on the breed's farm.");
    });

    it("refuses a batch on another farm than the breed", async () => {
      await expect(service.create({ ...validAnimalDto, breed_id: 'breed-g', current_batch_id: 'batch-k' } as any, 'tenant-1'))
        .rejects.toThrow("Batch is not on the breed's farm.");
    });

    it('refuses a breed with no farm for a company animal', async () => {
      await expect(service.create({ ...validAnimalDto, breed_id: 'template-breed' } as any, 'tenant-1'))
        .rejects.toThrow('Choose the farm-specific breed profile for this animal.');
    });

    it('refuses placing an animal in a Count Only batch', async () => {
      await expect(service.create({ ...validAnimalDto, breed_id: 'breed-g', current_batch_id: 'count-only-batch-g' } as any, 'tenant-1'))
        .rejects.toThrow('A Count Only batch has no individual animals.');
    });

    it('accepts breed, batch and location on the same farm', async () => {
      await expect(service.create({ ...validAnimalDto, breed_id: 'breed-g', current_batch_id: 'registered-batch-g', current_location_id: 'pen-g' } as any, 'tenant-1'))
        .resolves.toBeDefined();
    });
  });
```

- [ ] **Step 2: Implement `assertAnimalPlacement`** and call it in `create` after the existing breed/batch/location existence checks and in `update` with the effective values (`dto.x ?? animal.x`):

```ts
  /**
   * An animal's breed profile carries its farm's benchmarks, so the animal can only
   * stand on that farm; and a Count Only batch keeps a headcount, never animal rows.
   */
  private async assertAnimalPlacement(breedId: string, batchId?: string | null, locationId?: string | null): Promise<void> {
    const [breed] = await this.db
      .select({ company_id: schema.breedMaster.company_id, location_id: schema.breedMaster.location_id })
      .from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, breedId)).limit(1);
    if (!breed) throw new NotFoundException('Breed not found.');
    if (breed.company_id && !breed.location_id) {
      throw new BadRequestException('Choose the farm-specific breed profile for this animal.');
    }
    const breedFarm = breed.location_id ? await farmOfLocation(this.db, breed.location_id) : null;

    if (batchId) {
      const [batch] = await this.db
        .select({ farm_id: schema.batchHeader.farm_id, animal_tracking: schema.batchHeader.animal_tracking })
        .from(schema.batchHeader).where(eq(schema.batchHeader.batch_id, batchId)).limit(1);
      if (batch?.animal_tracking === 'COUNT_ONLY') throw new BadRequestException('A Count Only batch has no individual animals.');
      if (breedFarm && batch?.farm_id && batch.farm_id !== breedFarm) throw new ForbiddenException("Batch is not on the breed's farm.");
    }
    if (breedFarm && locationId && (await farmOfLocation(this.db, locationId)) !== breedFarm) {
      throw new ForbiddenException("Animal location is not on the breed's farm.");
    }
  }
```

- [ ] **Step 3: Count Only stage moves** — in `transitionStage` and `bulkTransitionStage`, after loading each animal, load its `current_batch_id`'s `animal_tracking`; `COUNT_ONLY` → the same 400. (A Count Only batch changes stage as a whole through batch transfer-stage, never per animal.)

- [ ] **Step 4: Run (lead)** — `--testPathPatterns=piggery/animal`. Expected: PASS.

- [ ] **Step 5: Commit (lead)** — `feat(animal): animals stand on their breed's farm; Count Only batches hold none`.

---

### Task 4: Batch create on an explicit farm, in an explicit tracking mode

**Files:**
- Modify: `apps/api/src/modules/production/batch/dto/batch.dto.ts` (`CreateBatchDto` 94-173), `batch.service.ts` (`create` 109-290, `renew` ~292), `batch.service.spec.ts`

**Interfaces:**
- Produces: `CreateBatchDto.farm_id: string` (required UUID), `CreateBatchDto.animal_tracking: 'REGISTERED' | 'COUNT_ONLY'` (required); `export const ANIMAL_TRACKING_MODES = ['REGISTERED', 'COUNT_ONLY'] as const` in `batch.dto.ts`.

- [ ] **Step 1: Failing tests** — in `batch.service.spec.ts` (call-order mocks + `transactionCls`; read the existing farm-scope describe added in Phase 1 and extend it):

```ts
  describe('farm and tracking mode', () => {
    it('stores the explicit farm and tracking mode', async () => {
      await service.create({ ...validCreateDto, farm_id: FARM_G, animal_tracking: 'COUNT_ONLY' } as any, 'tenant-1', user);
      expect(insertedBatch()).toMatchObject({ farm_id: FARM_G, animal_tracking: 'COUNT_ONLY' });
    });

    it('refuses a shed on another farm than the batch', async () => {
      await expect(service.create({ ...validCreateDto, farm_id: FARM_G, shed_id: 'shed-k', animal_tracking: 'COUNT_ONLY' } as any, 'tenant-1', user))
        .rejects.toThrow("Batch location is not on the batch's farm.");
    });

    it('refuses a breed profile from another farm', async () => {
      await expect(service.create({ ...validCreateDto, farm_id: FARM_G, breed_id: 'breed-k', animal_tracking: 'COUNT_ONLY' } as any, 'tenant-1', user))
        .rejects.toThrow('The breed profile belongs to another farm.');
    });

    it('registers no animals for Count Only, even with bio-asset costing', async () => {
      await service.create({ ...validCreateDto, costing_method: 'BIO_ASSET', breed_id: 'breed-g', farm_id: FARM_G, animal_tracking: 'COUNT_ONLY', opening_quantity: 3 } as any, 'tenant-1', user);
      expect(insertedAnimals()).toHaveLength(0);
    });

    it('registers the opening headcount for Registered Animals', async () => {
      await service.create({ ...validCreateDto, costing_method: 'FIFO', breed_id: 'breed-g', farm_id: FARM_G, animal_tracking: 'REGISTERED', opening_quantity: 3 } as any, 'tenant-1', user);
      expect(insertedAnimals()).toHaveLength(3);
    });

    it('requires a breed for Registered Animals', async () => {
      await expect(service.create({ ...validCreateDto, farm_id: FARM_G, animal_tracking: 'REGISTERED' } as any, 'tenant-1', user))
        .rejects.toThrow('A Registered Animals batch needs a breed.');
    });
  });
```

- [ ] **Step 2: DTO** — in `batch.dto.ts`:

```ts
export const ANIMAL_TRACKING_MODES = ['REGISTERED', 'COUNT_ONLY'] as const;
```

and in `CreateBatchDto`:

```ts
  @ApiProperty({ description: 'The farm (top-level location) this batch runs on' })
  @IsUUID() @IsNotEmpty()
  farm_id: string;

  @ApiProperty({ description: 'REGISTERED keeps individual Animal Register rows; COUNT_ONLY keeps a headcount', enum: ANIMAL_TRACKING_MODES })
  @IsIn(ANIMAL_TRACKING_MODES as unknown as string[]) @IsNotEmpty()
  animal_tracking: (typeof ANIMAL_TRACKING_MODES)[number];
```

- [ ] **Step 3: Service `create`** — replace the Phase 1 block that derives `farmId` (lines ~152-159) with:

```ts
    const scope = farmScope(this.cls);
    assertCompanyInScope(scope, dto.company_id);
    assertLobInScope(scope, dto.lob_id);
    if (!dto.farm_id) throw new BadRequestException('Select the farm this batch runs on.');
    // The batch's farm must be a farm of this company, and one the caller may work on.
    if ((await farmOfLocation(this.db, dto.farm_id)) !== dto.farm_id) throw new BadRequestException('Select the farm this batch runs on.');
    await assertLocationOnActiveFarm(this.db, scope, dto.farm_id, 'Batch farm');
    const placementId = dto.location_id || dto.shed_id || null;
    if (placementId && (await farmOfLocation(this.db, placementId)) !== dto.farm_id) {
      throw new ForbiddenException("Batch location is not on the batch's farm.");
    }
    if (dto.breed_id) {
      const [breed] = await this.db.select({ location_id: schema.breedMaster.location_id })
        .from(schema.breedMaster).where(eq(schema.breedMaster.breed_id, dto.breed_id)).limit(1);
      if (breed?.location_id && breed.location_id !== dto.farm_id) throw new ForbiddenException('The breed profile belongs to another farm.');
    }
    if (dto.animal_tracking === 'REGISTERED' && !dto.breed_id) {
      throw new BadRequestException('A Registered Animals batch needs a breed.');
    }
    const farmId = dto.farm_id;
```

  Also confirm the farm row belongs to `dto.company_id` (reuse the farm lookup or `assertLocationOnActiveFarm` semantics — read `farm-scope.ts`; if no helper validates company for an unrestricted admin, add the company condition to a direct `location_master` select here).
  - In the `batchHeader` insert add `animal_tracking: dto.animal_tracking,`.
  - Change the registration gate: remove `registerPlaceholderAnimals` from inside the `BIO_ASSET` branch and call it after that branch when `dto.animal_tracking === 'REGISTERED' && dto.opening_quantity > 0`, with the same arguments. If the batch has no input line item, keep the function's existing early return but throw first: `BadRequestException('A Registered Animals batch needs an input line item to register its animals against.')`.
  - `renew`: copy `farm_id` and `animal_tracking` from the source batch into the new batch's insert.

- [ ] **Step 4: Run (lead)** — `--testPathPatterns=production/batch/batch.service`. Expected: PASS; existing create tests updated to pass `farm_id` and `animal_tracking`.

- [ ] **Step 5: Commit (lead)** — `feat(batch): created on an explicit farm in an explicit tracking mode`.

---

### Task 5: Day status counts live animals for Registered batches

**Files:**
- Modify: `apps/api/src/modules/production/batch-daily-data/batch-daily-data.service.ts` (`dayStatus` ~84, per-stage block 179-193), `batch-daily-data.service.spec.ts`

- [ ] **Step 1: Failing test** (table-keyed `rows` mock):

```ts
  it('reports the live Registered headcount for the stage, not the scheduler snapshot', async () => {
    rows.set(schema.batchHeader, [{ batch_id: 'batch-1', tenant_id: 'tenant-123', start_date: ENTRY_DATE, animal_tracking: 'REGISTERED' }]);
    rows.set(schema.schedulerHeader, [{ ...header, stage_id: 'stage-1', animal_count: '40' }]);
    rows.set(schema.animalRegister, [{ stage_id: 'stage-1', n: 2 }]);
    const status = await service.dayStatus('batch-1', ENTRY_DATE, 'tenant-123');
    expect(status.animal_count).toBe(2);
  });
```
Use the real `dayStatus` signature from the service.

- [ ] **Step 2: Implement** — extract the per-stage counting block (179-193) into a private `liveStageCounts(batch): Promise<Map<string, number>>` used by both the entry form and `dayStatus`; in `dayStatus`, when `batch.animal_tracking === 'REGISTERED'`, report `liveStageCounts(...).get(header.stage_id) ?? 0` instead of `header.animal_count`. Count Only keeps the scheduler figure.

- [ ] **Step 3: Run (lead)** — `--testPathPatterns=batch-daily-data`. Expected: PASS.

- [ ] **Step 4: Commit (lead)** — `fix(data-entry): day status counts live animals for Registered batches`.

---

### Task 6: Breed and animal forms in the web

**Files:**
- Modify: `apps/web/src/modules/master-data/configs.ts` (breed 816-867; animal breed field ~337)

- [ ] **Step 1: Breed config**
  - `location_id` field: `label: "Farm"`, `required: true`, `helpText: "The farm this breed profile belongs to. The same breed can have a profile on each farm, with that farm's own benchmarks."`, keep its entity endpoint and label keys.
  - `breed_code` field: leave it to the Number Series behaviour the master-data form already has (live preview, manual entry only where the series allows it); remove only the `placeholder: "YORKSHIRE"`, which reads like a code to type.
  - `columns`: insert `{ key: "location_code", label: "Farm" }` after `breed_name`.
  - If `MasterDataConfig` supports declared filters, add a `location_id` filter over `/location?locationType=FARM&rootOnly=true`; otherwise the column filter drawer already filters `location_id` through `filter[location_id]` — verify which by reading `MasterDataTable.tsx` and use it.
- [ ] **Step 2: Animal config** — the breed selector (`~337`): `entityLabelKeys: ["breed_code", "breed_name", "location_code", "location_name"]`.
- [ ] **Step 3: Check (lead)** — `NODE_OPTIONS=--max-old-space-size=1024 pnpm nx test web --runInBand --watchman=false` (the master-data guard specs read `configs.ts`) and `pnpm nx typecheck web`.
- [ ] **Step 4: Commit (lead)** — `feat(web): breed profiles are chosen by farm`.

---

### Task 7: Batch create form — farm, placement, tracking mode

**Files:**
- Modify: `apps/web/src/components/console/production/batch-panel.tsx` (state 70, reset 254, options 240-241, `handleSave` 274-326, fields 940-1009), `apps/web/src/utils/translations.ts` (`en` only)

- [ ] **Step 1: State and options**
  - Header state gains `farm_id: ""` and `animal_tracking: "COUNT_ONLY"` (both in the initial state and the reset at 254).
  - Load farms once: `api.get('/location?locationType=FARM&rootOnly=true')` into `farms`.
  - When `header.farm_id` changes: clear `breed_id` and `shed_id`; reload breeds with `locationId=<farm>` and sheds with `farmId=<farm>` (read the `/shed` query DTO — if it has no `farmId`, use `/location?farmId=<farm>&locationType=SHED` and map `location_id`/`location_code`/`location_name`).
- [ ] **Step 2: Fields** — before Breed: a **Farm** select (required, farm code — name). After Breed: a **Tracking mode** segmented control or radio pair with labels **Registered Animals** / **Count Only** and a one-line hint each: `Every animal is registered individually and can move between stages.` / `The batch keeps a headcount and moves as one.`. Breed and Shed selects are disabled until a farm is chosen.
- [ ] **Step 3: Save** — `handleSave` refuses with `t("blErrFarmRequired")` when no farm, and with `t("blErrBreedRequiredRegistered")` when `REGISTERED` and no breed; the POST payload adds `farm_id: header.farm_id` and `animal_tracking: header.animal_tracking`.
- [ ] **Step 4: Strings** — add to the `en` dictionary only: `blFarm: "Farm"`, `blTrackingMode: "Tracking mode"`, `blTrackingRegistered: "Registered Animals"`, `blTrackingCountOnly: "Count Only"`, `blTrackingRegisteredHint: "Every animal is registered individually and can move between stages."`, `blTrackingCountOnlyHint: "The batch keeps a headcount and moves as one."`, `blSelectFarmFirst: "Select a farm first"`, `blErrFarmRequired: "Select the farm this batch runs on."`, `blErrBreedRequiredRegistered: "A Registered Animals batch needs a breed."`.
- [ ] **Step 5: Check (lead)** — web tests and typecheck; `pnpm nx lint web` adds no errors over the baseline measured before the task.
- [ ] **Step 6: Commit (lead)** — `feat(web): batches are created on a farm in a tracking mode`.

---

### Task 8: Phase gate (lead only)

- [ ] **Step 1:** API and web suites, both typechecks, web lint delta, API build; migrate; restart the API by confirmed PID.
- [ ] **Step 2: Live probes, MySQL read after each write** (label every created record `DEMO VERIFICATION`; the Phase 3 rebuild removes them):

| Probe | Expected |
|---|---|
| Company admin creates breed "Large White" on MUL100 and on POR100 | both 201, both `breed_code = LARGE_WHITE`, different `location_id` |
| Same breed again on MUL100 | 409 `A breed named 'Large White' already exists on this farm.` |
| `GET /breed?locationId=<MUL100>` | only MUL100 profiles, rows carry `location_code` |
| Animal with MUL100 breed placed on a POR100 pen | 403, no row |
| Batch Count Only, BIO_ASSET, MUL100, breed on MUL100, qty 3 | 201; `animal_register` rows for it = 0; `animal_tracking = COUNT_ONLY` |
| Batch Registered, MUL100, breed on MUL100, qty 3 | 201; 3 `animal_register` rows with `current_batch_id` = it |
| Batch Registered without breed | 400 |
| Batch on MUL100 with a POR100 shed | 403 |
| Animal placed into the Count Only batch | 400 |
| Entry form and day status for the Registered batch | same live stage count |
| Grasmere worker creates a batch on POR100 | 403 (Phase 1 scope still holds) |

- [ ] **Step 3: One browser pass** at 1440, 834 and 390 px: breed create with farm and derived code, breed list farm column, animal breed selector showing farm, batch create with farm → shed/breed narrowed → tracking mode → saved. Close the browser.
- [ ] **Step 4:** `docs/VERIFICATION-<date>-phase-02.md`; the four rulings above into `docs/decisions.md`; update `docs/HANDOFF-2026-09-15-0022.md` "Next action".
