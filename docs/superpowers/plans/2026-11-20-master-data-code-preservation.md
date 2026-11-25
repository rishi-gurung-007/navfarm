# Master Data CSV Import — Master Code Preservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A custom code a user types into a manual form or uploads via CSV for Location or any of nine other master-data types (Stage, Disease, Item Type, Feed Formula, Item Category, Breed, UOM, Cost Center, GL Account) either lands on the saved record or produces a clear rejection — never a silently different, auto-generated code — while a blank code still auto-generates exactly as it does today.

**Architecture:** Two independent fixes, both minimal and additive. Frontend (`apps/web/src/modules/master-data/`): a new opt-in `importable` flag lets a CSV-eligible code field escape the manual-form's `readOnly` exclusion without changing the manual form; a new opt-in `codeField`/`codeFieldGenerated`/`aliases` set of config properties drive a generic alias resolver, a generic preview code display (replacing today's hardcoded Breed/Lifecycle chains), and two duplicate-detection passes (within-file, and against each master's own list endpoint) run before commit. Backend (`apps/api/src/modules/.../*.service.ts`): each of the nine services gets one inserted guard clause in its existing code-resolution logic — if a code was supplied and the resolved series does not allow manual entry, throw instead of silently generating a different one — with every other line of that logic (series/type resolution, composite parent-child codes, locking, uniqueness) untouched.

**Tech Stack:** TypeScript, NestJS + Drizzle ORM + Jest (`apps/api`), React + Jest/jsdom (`apps/web`, `apps/web/jest.config.cts`).

**Spec:** `docs/superpowers/specs/2026-11-20-master-data-code-preservation-design.md`

## Global Constraints

- Manual-form behavior is unchanged for every master: `readOnly` still means "shown, never editable" there.
- No change to Number Series configuration, no global manual-numbering toggle, no migrations.
- Each of the nine backend services keeps its own series-resolution particulars (Stage/Breed/UOM's type-dimension sub-series lookup; Item Category/Cost Center/GL Account's parent-child composite-code generation via `generateCompositeCode`) untouched — only a missing guard is added.
- `manualCode()`/`resolveNewCode()`/`resolveOptionalCode()` are not called from the nine services as part of this fix (no executor/transaction parameter exists on `manualCode()`, and three of the nine run inside a nested `tx` that is not `NumberSeriesService`'s own `this.db`) — the in-place guard is the whole fix there.
- The generic CSV importer still posts one row at a time through each master's existing create endpoint (`MasterDataImportModal.tsx`'s `handleCommitImport`) — no new backend bulk endpoint.
- Pre-flight existing-record duplicate detection costs at most one batched list call per uploaded file, never one per row.
- `json` / `field-list` / `map` / `latlng` stay unsupported for generic CSV import — not reopened here.
- No change to the Breed / Breed Lifecycle Stage bespoke CSV-parsing branch in `MasterDataImportModal.tsx` beyond the shared preview Code column resolver (Task 5).

## Review Focus

- A master with no series configured at all (`resolveSeriesFor` returns `null`) must still require a supplied code and use it verbatim — the new guard must only fire on the *series-exists-but-manual_nos-false* path, never on the no-series path (covered in each Task 2/3 service's existing "no series configured" tests, re-run unchanged).
- A series with `manual_nos: true` and a supplied code must still win with no throw and no call to `generateNext`/`generateCompositeCode` — regression coverage already exists per service; re-asserted in Task 2/3.
- For the three composite-code services (Item Category, Cost Center, GL Account), the new guard must fire *before* the `else if (parent)` branch — a supplied-but-disallowed code on a child row must be rejected, not silently swallowed into composite generation for that child (Task 3).
- The within-file duplicate check must normalize the same way the backend does (`trim().toUpperCase()`) so a file that passes this check can't still collide at submit on a case difference (Task 6).
- A master with no `config.codeField` set must see every new mechanism (alias resolution beyond today's select-entity case, preview resolver, both duplicate checks) no-op exactly as before — none of this is keyed on `config.key` (Task 1, Task 5, Task 6, Task 7).

---

### Task 1: Frontend — `importable` override unblocks Location's read-only code field for CSV import

**Files:**
- Modify: `apps/web/src/modules/master-data/types.ts` (`MasterDataField` interface, near `readOnly?: boolean;` at line 285)
- Modify: `apps/web/src/modules/master-data/utils/master-csv.ts:549-553` (`createFormFields`)
- Modify: `apps/web/src/modules/master-data/configs.ts:132-145` (Location's `location_code` field)
- Test: `apps/web/src/modules/master-data/utils/master-csv.spec.ts`

**Interfaces:**
- Produces: `MasterDataField.importable?: boolean` — "include this field in the generic CSV importer/template even though it's `readOnly` on the manual form." Has no effect when `readOnly` is falsy (nothing to override).
- Produces: `createFormFields(config: MasterDataConfig): MasterDataField[]` (unchanged export status — module-private) — filter becomes `f => !f.filterOnly && (!f.readOnly || f.importable) && !f.hideInForm && !f.editOnly`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Add to `master-csv.spec.ts` (reuses the `cfg()` helper already defined near the top of the file):

```ts
describe('createFormFields / genericImportFields — importable override', () => {
  it('still excludes a readOnly field with no importable flag (regression)', () => {
    const config = cfg({
      fields: [{ key: 'system_note', label: 'System Note', type: 'text', readOnly: true }],
    });
    expect(supportsGenericImport(config)).toBe(true); // optional unsupported-type field, not required
    // excluded from the template/parse field list: no column shows up for it
    return generateMasterTemplateCsv(config).then((csv) => {
      expect(csv.split('\r\n')[0]).toBe('');
    });
  });

  it('includes a readOnly field marked importable', async () => {
    const config = cfg({
      fields: [{ key: 'location_code', label: 'Code', type: 'text', readOnly: true, importable: true }],
    });
    const csv = await generateMasterTemplateCsv(config);
    expect(csv.split('\r\n')[0]).toBe('Code');
  });
});

describe('Location config — location_code is importable', () => {
  it('location_code is included in genericImportFields for the real Location config', async () => {
    const { getConfig } = await import('../configs');
    const location = getConfig('location');
    const csv = await generateMasterTemplateCsv(location!);
    expect(csv.split('\r\n')[0].split(',')).toContain('Code');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test web --testPathPattern=master-csv -t "importable override"`
Expected: FAIL — today's `createFormFields` excludes every `readOnly` field unconditionally, so the second test's template has no "Code" column and the Location test finds `location_code` absent.

- [ ] **Step 3: Implement**

In `types.ts`, add directly below the `readOnly?: boolean;` field (line 285):
```ts
/** Include this field in the generic CSV importer/template even though it's readOnly on the
 * manual form — for a code that the live form hides (normally auto-generated) but that create
 * still accepts explicitly, e.g. Location's location_code. No effect unless readOnly is set. */
importable?: boolean;
```

In `master-csv.ts:549-553`, change the filter's `!f.readOnly` to `(!f.readOnly || f.importable)`.

In `configs.ts:132-145`, add `importable: true,` to the `location_code` field object (alongside its existing `readOnly: true, createOnly: true,`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test web --testPathPattern=master-csv -t "importable override"`
Expected: PASS

Then run the full file to confirm no regression: `pnpm nx test web --testPathPattern=master-csv`
Expected: PASS (all tests, including the pre-existing suite)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/master-data/types.ts apps/web/src/modules/master-data/utils/master-csv.ts apps/web/src/modules/master-data/configs.ts apps/web/src/modules/master-data/utils/master-csv.spec.ts
git commit -m "feat(master-data): generic CSV import can include a readOnly code field via importable"
```

---

### Task 2: Backend — stop silently discarding a supplied code (six single-series services)

**Files:**
- Modify: `apps/api/src/modules/production/stage/stage.service.ts:43-76` (`resolveStageCode`)
- Modify: `apps/api/src/modules/master-data/disease/disease.service.ts:41-54` (`resolveDiseaseCode`)
- Modify: `apps/api/src/modules/master-data/item-type/item-type.service.ts:35-48` (`resolveTypeCode`)
- Modify: `apps/api/src/modules/master-data/feed-formula/feed-formula.service.ts:36-49` (`resolveFormulaCode`)
- Modify: `apps/api/src/modules/master-data/uom/uom.service.ts:44-57` (`resolveUomCode`)
- Modify: `apps/api/src/modules/master-data/breed/breed.service.ts:64-86` (`resolveBreedCode`)
- Test: `apps/api/src/modules/production/stage/stage.service.spec.ts`, `apps/api/src/modules/master-data/disease/disease.service.spec.ts`, `apps/api/src/modules/master-data/item-type/item-type.service.spec.ts`, `apps/api/src/modules/master-data/feed-formula/feed-formula.service.spec.ts`, `apps/api/src/modules/master-data/uom/uom.service.spec.ts`, `apps/api/src/modules/master-data/breed/breed.service.spec.ts`

**Interfaces:**
- Consumes: `NumberSeriesService.resolveSeriesFor`/`lockSeries`/`generateNext` (unchanged signatures; already injected into each service as `this.numberSeriesService`).
- Produces: each of the six private resolver methods keeps its exact existing signature and return type (`Promise<string>`); only its body gains one new branch. No other file calls these methods, so no downstream Interfaces change.

All six methods share the identical shape: `resolveSeriesFor` → if no series, require+return the supplied code (unchanged) → `lockSeries` → `if (series.manual_nos && dto.<code>) return dto.<code>.toUpperCase();` → **(new branch goes here)** → `generateNext(...)`.

- [ ] **Step 1: Write the failing tests**

Add to each of the six spec files, following the existing `describe('create — auto-generated (a series is configured for ...)')` block's pattern (shown here for `disease.service.spec.ts`; mirror the exact same shape — mock setup, `company found` select, field names — in the other five, substituting that service's own DTO field name and master label):

```ts
it('rejects a supplied code instead of silently generating a different one when the series does not allow manual entry', async () => {
  numberSeries.resolveSeriesFor.mockResolvedValue('DISEASE');
  numberSeries.lockSeries.mockResolvedValue({ manual_nos: false });
  mockDbSelect.mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])); // company found

  await expect(
    service.create({ company_id: 'comp-1', disease_name: 'Newcastle Disease', disease_code: 'CUSTOM' }, 'tenant-123'),
  ).rejects.toThrow(BadRequestException);
  expect(numberSeries.generateNext).not.toHaveBeenCalled();
});
```

For Stage (`stage.service.spec.ts`) and Breed (`breed.service.spec.ts`), check that file's existing mock setup first — both resolve NOB/LOB (Stage) or species (Breed) before reaching code resolution, so the new test's mocks need whatever earlier selects those paths already require to reach `resolveStageCode`/`resolveBreedCode`; copy the setup from that file's own existing "auto-generated" test rather than from the Disease example above.

- [ ] **Step 2: Run tests to verify they fail**

Run (per package): `pnpm nx test api --testPathPattern=disease.service -t "rejects a supplied code"` (repeat for stage, item-type, feed-formula, uom, breed)
Expected: FAIL — today's code falls through to `generateNext()` and resolves normally instead of throwing.

- [ ] **Step 3: Implement the guard in each of the six resolver methods**

In each method, insert a new branch directly after the existing `if (series.manual_nos && dto.<code>) { return dto.<code>.toUpperCase(); }` and before the final `return this.numberSeriesService.generateNext(...)`:

```ts
if (dto.<code>) {
  throw new BadRequestException(
    'This number series does not allow a manual code for <plural noun> — leave the Code blank to auto-generate one.',
  );
}
```

Use each service's own field/noun: `dto.stage_code` / "stages" (Stage); `dto.disease_code` / "diseases" (Disease); `dto.type_code` / "item types" (Item Type); `dto.formula_code` / "feed formulas" (Feed Formula); `dto.uom_code` / "units of measure" (UOM); `dto.breed_code` / "breeds" (Breed).

- [ ] **Step 4: Run tests to verify they pass**

Run the same six commands as Step 2.
Expected: PASS

Then run each service's full spec file once to confirm its pre-existing tests (no-series-configured, manual_nos-true, auto-generated) still pass unchanged:
Run: `pnpm nx test api --testPathPattern="stage.service|disease.service|item-type.service|feed-formula.service|uom.service|breed.service"`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/production/stage/stage.service.ts apps/api/src/modules/production/stage/stage.service.spec.ts \
        apps/api/src/modules/master-data/disease/disease.service.ts apps/api/src/modules/master-data/disease/disease.service.spec.ts \
        apps/api/src/modules/master-data/item-type/item-type.service.ts apps/api/src/modules/master-data/item-type/item-type.service.spec.ts \
        apps/api/src/modules/master-data/feed-formula/feed-formula.service.ts apps/api/src/modules/master-data/feed-formula/feed-formula.service.spec.ts \
        apps/api/src/modules/master-data/uom/uom.service.ts apps/api/src/modules/master-data/uom/uom.service.spec.ts \
        apps/api/src/modules/master-data/breed/breed.service.ts apps/api/src/modules/master-data/breed/breed.service.spec.ts
git commit -m "fix(master-data): reject an unsupported manual code instead of silently generating one (6 services)"
```

---

### Task 3: Backend — stop silently discarding a supplied code (three composite-code services)

**Files:**
- Modify: `apps/api/src/modules/master-data/item-category/item-category.service.ts:179-197` (`createAutoRecord`)
- Modify: `apps/api/src/modules/finance/cost-center/cost-center.service.ts:181-199` (`createAutoRecord`)
- Modify: `apps/api/src/modules/finance/gl-account/gl-account.service.ts:184-202` (`createAutoRecord`)
- Test: `apps/api/src/modules/master-data/item-category/item-category.service.spec.ts`, `apps/api/src/modules/finance/cost-center/cost-center.service.spec.ts`, `apps/api/src/modules/finance/gl-account/gl-account.service.spec.ts`

**Interfaces:**
- Consumes: `series.manual_nos` (already read via `lockSeries`, unchanged), `generateCompositeCode` (unchanged, still only reached when no code was supplied).
- Produces: `createAutoRecord`'s existing signature and return shape are unchanged; only the `categoryCode`/`costCenterCode`/`accountCode` decision chain gains one new branch, inserted *before* the existing `else if (parent)` branch so a disallowed supplied code is rejected even on a child row.

- [ ] **Step 1: Write the failing tests**

Add to each of the three spec files (shown for `cost-center.service.spec.ts`; mirror the mock/transaction setup already shown in that file's existing "auto-generated" describe block for the other two):

```ts
it('rejects a supplied code instead of silently generating one when the series does not allow manual entry', async () => {
  numberSeries.resolveSeriesFor.mockResolvedValue('COST_CENTER');
  numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, prefix: 'CC', seq_length: 4 });
  mockDbSelect.mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])); // company found

  await expect(
    service.create(
      { company_id: 'comp-1', cost_center_name: 'Production Dept', cost_center_type: 'DEPARTMENT', cost_center_code: 'CUSTOM' },
      'tenant-123',
    ),
  ).rejects.toThrow(BadRequestException);
  expect(numberSeries.generateNext).not.toHaveBeenCalled();
});

it('rejects a supplied code on a child row the same way, before any composite generation runs', async () => {
  numberSeries.resolveSeriesFor.mockResolvedValue('COST_CENTER');
  numberSeries.lockSeries.mockResolvedValue({ manual_nos: false, prefix: 'CC', seq_length: 4 });
  mockDbSelect
    .mockReturnValueOnce(makeSelectResult([{ company_id: 'comp-1' }])) // company found
    .mockReturnValueOnce(makeSelectResult([{ cost_center_id: 'parent-1', cost_center_code: 'CC-0001' }])); // parent found

  await expect(
    service.create(
      {
        company_id: 'comp-1', cost_center_name: 'Sub Dept', cost_center_type: 'DEPARTMENT',
        cost_center_code: 'CUSTOM', parent_cost_center_id: 'parent-1',
      },
      'tenant-123',
    ),
  ).rejects.toThrow(BadRequestException);
});
```

Adapt the DTO fields and mocked series code (`'ITEM_CATEGORY'` / `'GL_ACCOUNT'`) for the other two files, matching each file's own existing create()-call shape (`category_code`/`parent_category_id` for Item Category; `account_code`/`parent_account_id` for GL Account).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test api --testPathPattern="item-category.service|cost-center.service|gl-account.service" -t "rejects a supplied code"`
Expected: FAIL — today's code falls through to the `else if (parent)` / `else` branch and generates a code instead of throwing.

- [ ] **Step 3: Implement the guard in each `createAutoRecord`**

In each of the three `if (series.manual_nos && dto.<code>) { <code> = dto.<code>.<toUpperCase()?>; } else if (parent) { ... } else { ... }` chains, insert a new `else if` branch immediately after the `manual_nos` branch and before `else if (parent)`:

```ts
} else if (dto.<code>) {
  throw new BadRequestException(
    'This number series does not allow a manual code for <plural noun> — leave the Code blank to auto-generate one.',
  );
} else if (parent) {
```

Use: `dto.category_code` / "item categories" (Item Category); `dto.cost_center_code` / "cost centres" (Cost Center); `dto.account_code` / "G/L accounts" (GL Account). Leave GL Account's existing `accountCode = dto.account_code;` (no `.toUpperCase()`, unlike the other two) exactly as it is — not in scope to change.

- [ ] **Step 4: Run tests to verify they pass**

Run the Step 2 command again.
Expected: PASS

Then run each file's full spec to confirm no regression: `pnpm nx test api --testPathPattern="item-category.service|cost-center.service|gl-account.service"`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/master-data/item-category/item-category.service.ts apps/api/src/modules/master-data/item-category/item-category.service.spec.ts \
        apps/api/src/modules/finance/cost-center/cost-center.service.ts apps/api/src/modules/finance/cost-center/cost-center.service.spec.ts \
        apps/api/src/modules/finance/gl-account/gl-account.service.ts apps/api/src/modules/finance/gl-account/gl-account.service.spec.ts
git commit -m "fix(master-data): reject an unsupported manual code instead of silently generating one (3 composite-code services)"
```

---

### Task 4: Frontend — configuration-aware code aliases

**Files:**
- Modify: `apps/web/src/modules/master-data/types.ts` (`MasterDataField` interface)
- Modify: `apps/web/src/modules/master-data/utils/master-csv.ts:644-649` (`parseGenericImportRow`'s `getRawValue` call)
- Modify: `apps/web/src/modules/master-data/configs.ts` — add aliases to `location_code` (line 133), `animal_code` (line 1180), `rfid_tag` (line 1279), `item_code` (line 2529)
- Test: `apps/web/src/modules/master-data/utils/master-csv.spec.ts`

**Interfaces:**
- Produces: `MasterDataField.aliases?: string[]` — extra header labels `getRawValue` accepts for this field, on top of its own `key`/`label`. Merged with (not replacing) the existing `select-entity` `"<Label> Code"` alias.
- Consumes: `getRawValue(raw, fieldKey, fieldLabel, aliases?)` — unchanged signature (`master-csv.ts:506-533`); only its call site changes what it's passed.

- [ ] **Step 1: Write the failing tests**

Add to `master-csv.spec.ts`:

```ts
describe('parseGenericImportRow — configured aliases', () => {
  it('resolves a field from its configured alias header', async () => {
    const config = cfg({
      fields: [{ key: 'location_code', label: 'Code', type: 'text', aliases: ['Master Code', 'Location Code'] }],
    });
    const { payload, errors } = await parseGenericImportRow(config, { 'Location Code': 'FARM-01' }, {});
    expect(payload.location_code).toBe('FARM-01');
    expect(errors).toEqual([]);
  });

  it('an exact field-key match wins over a same-named alias on another field', async () => {
    const config = cfg({
      fields: [
        { key: 'location_code', label: 'Code', type: 'text', aliases: ['ID'] },
        { key: 'external_ref', label: 'External Reference', type: 'text', aliases: [] },
      ],
    });
    // The raw row has a real "external_ref" column AND an "ID" column; "ID" must not steal
    // external_ref's value just because it is location_code's alias — location_code only reads
    // "ID" when there is no column literally named/labelled location_code/Code.
    const { payload } = await parseGenericImportRow(config, { location_code: 'LOC-1', ID: 'LOC-2', external_ref: 'REF-1' }, {});
    expect(payload.location_code).toBe('LOC-1');
    expect(payload.external_ref).toBe('REF-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test web --testPathPattern=master-csv -t "configured aliases"`
Expected: FAIL (first test) — `f.aliases` is never read today, so `getRawValue` only matches on `location_code`/`Code` and misses "Location Code".

- [ ] **Step 3: Implement**

In `types.ts`, add near the existing `helpText?: string;` field (or any sensible spot in `MasterDataField`):
```ts
/** Extra CSV header labels the generic importer accepts for this field, beyond its own key and
 * label (e.g. "Master Code", "ID" for a master's primary identity field). Configuration-only —
 * never inferred from the field's type or name, so it can't collide with an unrelated field. */
aliases?: string[];
```

In `master-csv.ts:644-649`, change the `getRawValue` call's fourth argument from `f.type === "select-entity" ? [templateHeaderFor(f)] : undefined` to merge the two sources, e.g.:
```ts
const rawVal = getRawValue(
  raw,
  f.key,
  f.label,
  [
    ...(f.type === "select-entity" ? [templateHeaderFor(f)] : []),
    ...(f.aliases ?? []),
  ],
);
```

In `configs.ts`, add `aliases: ['Master Code', 'Master Code ID', 'Identifier', 'ID', 'Location Code']` to `location_code` (line 133); `aliases: ['Master Code', 'Identifier', 'ID', 'Animal ID']` to `animal_code` (line 1180); `aliases: ['Ear Tag', 'Tag No', 'RFID Tag']` to `rfid_tag` (line 1279); `aliases: ['Master Code', 'Identifier', 'ID', 'Item Code']` to `item_code` (line 2529).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test web --testPathPattern=master-csv -t "configured aliases"`
Expected: PASS

Then run the full file: `pnpm nx test web --testPathPattern=master-csv`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/master-data/types.ts apps/web/src/modules/master-data/utils/master-csv.ts apps/web/src/modules/master-data/configs.ts apps/web/src/modules/master-data/utils/master-csv.spec.ts
git commit -m "feat(master-data): configuration-aware header aliases for a master's primary code field"
```

---

### Task 5: Frontend — generic preview code resolver replaces hardcoded Breed/Lifecycle display

**Files:**
- Modify: `apps/web/src/modules/master-data/types.ts` (`MasterDataConfig` interface)
- Modify: `apps/web/src/modules/master-data/utils/master-csv.ts` (new exported function, near `templateHeaderFor`)
- Modify: `apps/web/src/modules/master-data/configs.ts` — add `codeField`/`codeFieldGenerated` to Location, Stage, Disease, Item Type, Feed Formula, Item Category, Breed, UOM, Cost Center, Animal Register, and Breed Lifecycle Stage configs
- Modify: `apps/web/src/modules/master-data/MasterDataImportModal.tsx` — replace the hardcoded `breed_code`/`lifecycle_code` chains at lines 538-541, 572-574, 603-606, 804-810, 862-866, 954-960
- Test: `apps/web/src/modules/master-data/utils/master-csv.spec.ts`

**Interfaces:**
- Produces: `MasterDataConfig.codeField?: string` — the field key holding this master's primary identity code (e.g. `'location_code'`, `'lifecycle_code'`).
- Produces: `MasterDataConfig.codeFieldGenerated?: boolean` — whether leaving `codeField` blank causes the backend to auto-generate it via Number Series (true for Location/Stage/Disease/Item Type/Feed Formula/Item Category/Breed/UOM/Cost Center; left unset for Animal Register, whose `animal_code` is `required: true` and for Breed Lifecycle Stage's `lifecycle_code`, which is a plain optional identifier with no backend generation).
- Produces: `export function resolveImportCodeDisplay(config: MasterDataConfig, row: { payload: Record<string, any>; raw: Record<string, string>; errors: string[] }): { text: string; provenance: "uploaded" | "generated" | "invalid" | "none" }` — reads `config.codeField`:
  - no `codeField` configured → `{ text: "", provenance: "none" }`.
  - `row.payload[codeField]` is a non-empty value → `{ text: String(that value), provenance: "uploaded" }`.
  - otherwise, if the raw row had a non-empty value under `codeField`/its label/its aliases (via `getRawValue`) that didn't make it into `payload` (dropped by a validation error naming it) → `{ text: <that raw value>, provenance: "invalid" }`.
  - otherwise, if `config.codeFieldGenerated` → `{ text: "Will be generated on import", provenance: "generated" }`.
  - otherwise → `{ text: "", provenance: "none" }`.
- Consumes: `getRawValue` (unchanged, `master-csv.ts:506-533`).

- [ ] **Step 1: Write the failing tests**

Add to `master-csv.spec.ts`:

```ts
describe('resolveImportCodeDisplay', () => {
  it('shows the uploaded code when present in the payload', () => {
    const config = cfg({ codeField: 'stage_code', fields: [{ key: 'stage_code', label: 'Code', type: 'text' }] });
    const result = resolveImportCodeDisplay(config, { payload: { stage_code: 'GROWER' }, raw: {}, errors: [] });
    expect(result).toEqual({ text: 'GROWER', provenance: 'uploaded' });
  });

  it('shows the generated-on-import marker when blank and codeFieldGenerated is set', () => {
    const config = cfg({ codeField: 'stage_code', codeFieldGenerated: true, fields: [{ key: 'stage_code', label: 'Code', type: 'text' }] });
    const result = resolveImportCodeDisplay(config, { payload: {}, raw: {}, errors: [] });
    expect(result.provenance).toBe('generated');
  });

  it('shows the raw attempted value as invalid when a validation error dropped it', () => {
    const config = cfg({ codeField: 'stage_code', codeFieldGenerated: true, fields: [{ key: 'stage_code', label: 'Code', type: 'text' }] });
    const result = resolveImportCodeDisplay(config, {
      payload: {},
      raw: { Code: 'BAD CODE' },
      errors: ["Code 'BAD CODE' is invalid."],
    });
    expect(result).toEqual({ text: 'BAD CODE', provenance: 'invalid' });
  });

  it('is a no-op (provenance "none") for a config with no codeField', () => {
    const config = cfg({ fields: [{ key: 'x', label: 'X', type: 'text' }] });
    const result = resolveImportCodeDisplay(config, { payload: { x: '1' }, raw: {}, errors: [] });
    expect(result.provenance).toBe('none');
  });

  it('matches today\'s Breed preview behavior when driven by codeField', () => {
    const config = cfg({ key: 'breed', codeField: 'breed_code', fields: [{ key: 'breed_code', label: 'Code', type: 'text' }] });
    const result = resolveImportCodeDisplay(config, { payload: { breed_code: 'YORKSHIRE' }, raw: {}, errors: [] });
    expect(result.text).toBe('YORKSHIRE');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test web --testPathPattern=master-csv -t "resolveImportCodeDisplay"`
Expected: FAIL — the function doesn't exist yet.

- [ ] **Step 3: Implement**

In `types.ts`, add the two new `MasterDataConfig` fields (near `idKey: string;`):
```ts
/** The field key holding this master's own primary identity code (e.g. "location_code",
 * "lifecycle_code") — drives the generic import preview's Code column and duplicate checks.
 * Not inferred from field order or naming; every master that wants these must set it. */
codeField?: string;
/** Whether leaving codeField blank on create causes the backend to auto-generate it via a
 * configured Number Series (vs. simply staying unset). Only meaningful with codeField set. */
codeFieldGenerated?: boolean;
```

In `master-csv.ts`, add `resolveImportCodeDisplay` per the Interfaces block above, near `templateHeaderFor`. For the "invalid" branch, use `getRawValue(raw, codeField, config.fields.find(f => f.key === codeField)?.label, config.fields.find(f => f.key === codeField)?.aliases)` to read the raw attempted value, and treat it as "invalid" only when it is non-empty and `errors.some(e => e.includes(rawAttempt))` (mirrors how the existing error strings already name the offending value, e.g. `"${f.label} '${rawVal}' is invalid."`).

In `configs.ts`, add `codeField: 'location_code', codeFieldGenerated: true` to the Location config object (top-level, alongside `apiBase`/`idKey`); likewise `codeField: 'stage_code', codeFieldGenerated: true` (Stage), `codeField: 'disease_code', codeFieldGenerated: true` (Disease), `codeField: 'type_code', codeFieldGenerated: true` (Item Type), `codeField: 'formula_code', codeFieldGenerated: true` (Feed Formula), `codeField: 'category_code', codeFieldGenerated: true` (Item Category), `codeField: 'breed_code', codeFieldGenerated: true` (Breed), `codeField: 'uom_code', codeFieldGenerated: true` (UOM), `codeField: 'cost_center_code', codeFieldGenerated: true` (Cost Center), `codeField: 'animal_code'` (Animal Register, no `codeFieldGenerated` — it's `required: true`), `codeField: 'lifecycle_code'` (Breed Lifecycle Stage, no `codeFieldGenerated`).

In `MasterDataImportModal.tsx`, import `resolveImportCodeDisplay` from `./utils/master-csv` and replace each hardcoded chain:
- Line 538-541 and 603-606 (`e.code === r.payload.breed_code || e.code === r.payload.lifecycle_code`): replace with `e.code === resolveImportCodeDisplay(config, r).text`.
- Line 572-574 (`importedCodes` map): replace `it.breed_code || it.lifecycle_code` with `resolveImportCodeDisplay(config, { payload: it, raw: {}, errors: [] }).text`.
- Line 804-810 (error alert's `itemCode`): replace with `resolveImportCodeDisplay(config, r).text || \`Row #${r.index}\``.
- Line 862-866 (success banner `Codes:` list): replace the map body with `resolveImportCodeDisplay(config, r).text`.
- Line 954-960 (preview table Code column): replace the fallback chain with `resolveImportCodeDisplay(config, r).text || NA`; keep the existing `NA` import for this one case (no `codeField` configured, or truly nothing to show).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test web --testPathPattern=master-csv -t "resolveImportCodeDisplay"`
Expected: PASS

Then the full file: `pnpm nx test web --testPathPattern=master-csv`
Expected: PASS (all tests)

- [ ] **Step 5: Typecheck**

Run: `pnpm nx typecheck web`
Expected: no new errors (the modal's five edited call sites all still type-check against `resolveImportCodeDisplay`'s return shape)

- [ ] **Step 6: Drive the running app**

Open Master Data → Breed → Import CSV with a real breed CSV; confirm the preview's Code column shows the same values it showed before this change. Then open Location → Import CSV with one row carrying a custom code and one row left blank; confirm the preview shows the custom code as uploaded and the blank row as "Will be generated on import."

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/modules/master-data/types.ts apps/web/src/modules/master-data/utils/master-csv.ts apps/web/src/modules/master-data/configs.ts apps/web/src/modules/master-data/MasterDataImportModal.tsx apps/web/src/modules/master-data/utils/master-csv.spec.ts
git commit -m "feat(master-data): generic, configuration-driven code preview replaces hardcoded Breed/Lifecycle display"
```

---

### Task 6: Frontend — within-file duplicate code detection

**Files:**
- Modify: `apps/web/src/modules/master-data/utils/master-csv.ts` (new exported function)
- Modify: `apps/web/src/modules/master-data/MasterDataImportModal.tsx` (`processFile`, after staging, before `setStagedRows(staged)` at line 470)
- Test: `apps/web/src/modules/master-data/utils/master-csv.spec.ts`

**Interfaces:**
- Produces: `export function findDuplicateImportCodes(config: MasterDataConfig, rows: Array<{ payload: Record<string, any> }>): Map<string, number[]>` — keys are the normalized (`.trim().toUpperCase()`) code value, values are the 0-based indexes (into `rows`) of every row sharing that normalized code. A code appearing once is not included (empty entries excluded). Returns an empty `Map` when `config.codeField` is unset.
- Consumes: `config.codeField` (Task 5).

- [ ] **Step 1: Write the failing tests**

Add to `master-csv.spec.ts`:

```ts
describe('findDuplicateImportCodes', () => {
  it('flags two rows sharing a code, case-insensitively', () => {
    const config = cfg({ codeField: 'stage_code' });
    const dupes = findDuplicateImportCodes(config, [
      { payload: { stage_code: 'grower' } },
      { payload: { stage_code: 'FINISHER' } },
      { payload: { stage_code: 'GROWER' } },
    ]);
    expect(dupes.get('GROWER')).toEqual([0, 2]);
    expect(dupes.has('FINISHER')).toBe(false);
  });

  it('is a no-op for a config with no codeField', () => {
    const config = cfg({});
    const dupes = findDuplicateImportCodes(config, [{ payload: { stage_code: 'GROWER' } }, { payload: { stage_code: 'GROWER' } }]);
    expect(dupes.size).toBe(0);
  });

  it('ignores rows with no code at all (nothing to collide on)', () => {
    const config = cfg({ codeField: 'stage_code' });
    const dupes = findDuplicateImportCodes(config, [{ payload: {} }, { payload: {} }]);
    expect(dupes.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test web --testPathPattern=master-csv -t "findDuplicateImportCodes"`
Expected: FAIL — the function doesn't exist yet.

- [ ] **Step 3: Implement `findDuplicateImportCodes` in `master-csv.ts`**

Group by `String(row.payload[config.codeField]).trim().toUpperCase()`, skipping empty values; return only the groups with more than one index, as a `Map` keyed by the normalized code.

Then in `MasterDataImportModal.tsx`'s `processFile`, after the `for` loop that builds `staged` (after line 468, before `setStagedRows(staged)`), call `findDuplicateImportCodes(config, staged)` and for every index in a duplicate group, push an error onto that staged row (`\`Code '<code>' is duplicated in this file (also on row(s) <other row numbers>).\``) and set `isValid: false` on it — mutate the `staged` array entries in place before the `setStagedRows(staged)` call already there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test web --testPathPattern=master-csv -t "findDuplicateImportCodes"`
Expected: PASS

- [ ] **Step 5: Drive the running app**

Build a small CSV for Stage with two rows sharing the same code in different case; upload it; confirm both rows preview as errors naming each other's row number, and neither is included when "Import Valid Records" is clicked.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/master-data/utils/master-csv.ts apps/web/src/modules/master-data/MasterDataImportModal.tsx apps/web/src/modules/master-data/utils/master-csv.spec.ts
git commit -m "feat(master-data): detect duplicate codes within an uploaded CSV before commit"
```

---

### Task 7: Frontend — existing-record duplicate pre-flight

**Files:**
- Modify: `apps/web/src/modules/master-data/utils/master-csv.ts` (new exported function)
- Modify: `apps/web/src/modules/master-data/MasterDataImportModal.tsx` (`processFile`, same insertion point as Task 6, after the within-file check)
- Test: `apps/web/src/modules/master-data/utils/master-csv.spec.ts`

**Interfaces:**
- Produces: `export async function findExistingImportCodeConflicts(config: MasterDataConfig, rows: Array<{ payload: Record<string, any> }>): Promise<Set<number>>` — when `config.codeField` is unset, returns an empty `Set` with no API call. Otherwise fetches `api.get(\`${config.apiBase}?limit=5000\`)` once, builds a normalized set of existing codes read off `config.codeField` from the returned list (via the file's existing `unwrap()` helper), and returns the 0-based indexes of every row in `rows` whose normalized code is already in that set.
- Consumes: `api` (`@/services/api-client`, already imported in `master-csv.ts`), `unwrap` (module-private, already defined in `master-csv.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `master-csv.spec.ts` (the file already mocks `@/services/api-client` in its sample-row describe block — reuse that mock):

```ts
describe('findExistingImportCodeConflicts', () => {
  afterEach(() => jest.resetAllMocks());

  it('flags a staged row whose code already exists in this scope', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ stage_code: 'GROWER' }] });
    const config = cfg({ codeField: 'stage_code', apiBase: '/stage' });
    const conflicts = await findExistingImportCodeConflicts(config, [
      { payload: { stage_code: 'grower' } },
      { payload: { stage_code: 'FINISHER' } },
    ]);
    expect(conflicts).toEqual(new Set([0]));
    expect(api.get).toHaveBeenCalledWith('/stage?limit=5000');
  });

  it('makes no API call for a config with no codeField', async () => {
    const config = cfg({ apiBase: '/stage' });
    const conflicts = await findExistingImportCodeConflicts(config, [{ payload: { stage_code: 'GROWER' } }]);
    expect(conflicts.size).toBe(0);
    expect(api.get).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test web --testPathPattern=master-csv -t "findExistingImportCodeConflicts"`
Expected: FAIL — the function doesn't exist yet.

- [ ] **Step 3: Implement**

Per the Interfaces block above. One `api.get` call, wrapped so a request failure leaves the pre-flight a no-op (empty `Set`) rather than blocking the whole import — mirror `fetchAndCacheOptions`'s existing try/catch-to-empty pattern (`master-csv.ts:585-597`).

In `MasterDataImportModal.tsx`'s `processFile`, after Task 6's within-file check and before `setStagedRows(staged)`, `await findExistingImportCodeConflicts(config, staged)` and for every returned index, push an error (`\`Code '<code>' already exists.\``) and set `isValid: false` on that staged row — same mutation pattern as Task 6, additive (a row can be invalid for both reasons).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test web --testPathPattern=master-csv -t "findExistingImportCodeConflicts"`
Expected: PASS

Then the full file: `pnpm nx test web --testPathPattern=master-csv`
Expected: PASS (all tests)

- [ ] **Step 5: Typecheck and build**

Run: `pnpm nx typecheck web`
Expected: no new errors
Run: `pnpm nx build web`
Expected: succeeds

- [ ] **Step 6: Drive the running app**

Create one real Stage record through the manual form with a known code, then build a CSV import file for Stage with one row carrying that exact code (different case) and one row with a fresh code; upload it; confirm the row with the existing code previews as an error and is excluded from "Import Valid Records," while the fresh-code row imports normally.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/modules/master-data/utils/master-csv.ts apps/web/src/modules/master-data/MasterDataImportModal.tsx apps/web/src/modules/master-data/utils/master-csv.spec.ts
git commit -m "feat(master-data): pre-flight check uploaded codes against existing records in scope"
```

---

### Task 8: End-to-end verification against the running app

No code changes — proves the whole chain against real data, per the project's own standard ("prove a write by making it and reading MySQL," not a green test suite alone).

**Files:** none (verification only)

- [ ] **Step 1: Location — custom code preserved end to end**

Download Location's CSV template; confirm it now has a "Code" column. Fill one row with a real custom code and one row left blank; import both. Read both rows back from MySQL: the custom-code row carries exactly that code; the blank row carries a code generated from its Location Type's prefix (unchanged behavior) — neither row's code was swapped with the other's.

- [ ] **Step 2: One of the nine backend services — manual code respected or clearly rejected**

Pick a tenant/company where Disease (or another of the nine) has a Number Series configured. With `manual_nos` enabled, create a Disease with a custom code via the manual form; confirm MySQL shows that exact code. Disable `manual_nos` (or pick a series/tenant where it's already off) and repeat; confirm the API now returns a 400 naming "does not allow a manual code," and confirm no new row with a different, auto-generated code was created as a side effect.

- [ ] **Step 3: Breed — bulk CSV path inherits the same fix**

Import a Breed CSV with one row carrying a custom code against a Breed series with manual numbering disabled; confirm the row is rejected with a clear error in the preview (not silently imported under a different code), and that `createBreedsBulk`'s per-row loop surfaces that same rejection per row rather than failing the whole batch opaquely.

- [ ] **Step 4: Duplicate detection, both passes**

Upload a Stage CSV with two rows sharing a code (different case) — confirm both are flagged before the Import button is even enabled for them. Separately, upload a Stage CSV whose one row's code already exists on a real Stage row in MySQL — confirm it's flagged by the pre-flight; if the pre-flight's list call were ever to miss it (outside its row-limit), confirm the backend's own uniqueness check still refuses it at submit, from Task 2's unchanged downstream duplicate query.

- [ ] **Step 5: GL Account — untouched import eligibility, fixed backend**

Confirm Master Data's GL Account screen still shows no Import CSV button (BC-owned, unchanged). Separately, confirm GL Account's manual form now rejects a disallowed supplied code with a clear error rather than silently generating a different one (Task 3).

- [ ] **Step 6: Report findings**

Note anything that didn't match expectation before calling this plan done — this task has no fixed "expected" output per step beyond what's stated above, because it's the final cross-check against a live system, not a unit assertion.
