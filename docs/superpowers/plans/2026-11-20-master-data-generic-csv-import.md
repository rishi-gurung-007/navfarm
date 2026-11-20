# Master Data Generic CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Animal Register (and, as a mechanical consequence, Stage, Delivery Zones, and Route Stops) use the existing generic Master Data CSV importer, by fixing the gate and field list it's built on rather than writing bespoke per-master import code.

**Architecture:** All logic lives in `apps/web/src/modules/master-data/utils/master-csv.ts`, a pure (no-React) module already shared between the live create/edit form and `MasterDataImportModal.tsx`. Four self-contained changes to that module — gate predicate, NOB/LOB auto-fill, template field list, template examples — plus one small UI wiring change in the modal for the new async template download.

**Tech Stack:** TypeScript, Jest + jsdom (`apps/web/jest.config.cts`), React (modal only).

**Spec:** `docs/superpowers/specs/2026-11-20-master-data-generic-csv-import-design.md`

## Global Constraints

- Frontend-only; no API/DTO changes.
- Must not regress any master that already supports generic import today.
- `json` / `field-list` / `map` / `latlng` stay unsupported for CSV — only `"image"` comes out of the unsupported-type set.
- `generateMasterTemplateCsv` becomes `async` (one round of entity-option fetches before the file downloads); its one caller (`MasterDataImportModal.tsx`) must `await` it and show a loading state.

## Review Focus

- A master with a *required* unsupported-type field (e.g. Feed Formula's `ingredients`, a required `json`) must still be blocked — the loosened gate must not swallow this case.
- A field marked `hideInForm`/`editOnly` must be excluded from the mandatory-fields check even if it also happened to carry `required: true` — the create-form field list, not raw `required`, decides what's mandatory.
- A `select-entity` field's entity fetch failing (network error) during template generation must not throw out of `generateMasterTemplateCsv` — it must fall back to a blank sample, same as today's un-populated default.
- NOB/LOB auto-fill from the active operational area must win over a same-named column actually present in the uploaded CSV (mirrors the live form hiding the picker and overwriting unconditionally) — not silently ignored, not merged.
- A config with no `nob_id`/`lob_id` fields at all, imported while the workspace is OPERATIONAL, must behave exactly as before — the new exclusion/injection logic must no-op for every master that doesn't have those columns.

---

### Task 1: Loosen the unsupported-type gate and the create-form field list

**Files:**
- Modify: `apps/web/src/modules/master-data/utils/master-csv.ts:587-614` (the `GENERIC_IMPORT_UNSUPPORTED_TYPES` set, `supportsGenericImport`, `genericImportFields`)
- Test: `apps/web/src/modules/master-data/utils/master-csv.spec.ts` (new file)

**Interfaces:**
- Produces: `function createFormFields(config: MasterDataConfig): MasterDataField[]` (module-private, no export) — fields the live create form would ask for: `!f.filterOnly && !f.readOnly && !f.hideInForm && !f.editOnly`. Used by Task 3.
- Produces: `function genericImportFields(config: MasterDataConfig): MasterDataField[]` (module-private, unchanged name/signature) — `createFormFields(config)` further narrowed to what the generic CSV reader can actually read: not an unsupported type, and not `nob_id`/`lob_id` when `getActiveWorkspaceScope() === "OPERATIONAL"`. Used by Tasks 2-4 and by `prefetchGenericEntityOptions`/`parseGenericImportRow` (unchanged call sites).
- Produces: `export function supportsGenericImport(config: MasterDataConfig): boolean` (unchanged signature) — false for breed/breed-lifecycle-stage/BC-owned/number-series as today; otherwise true unless `createFormFields(config)` contains a field that is both `required` and of an unsupported type.
- Consumes: `getActiveWorkspaceScope` from `@/hooks/useAuth` (reads `localStorage` directly — set it in tests, no module mock needed).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/modules/master-data/utils/master-csv.spec.ts`:

```ts
import { supportsGenericImport } from './master-csv';
import type { MasterDataConfig } from '../types';

function cfg(overrides: Partial<MasterDataConfig>): MasterDataConfig {
  return {
    key: 'widget', label: 'Widgets', apiBase: '/widget', idKey: 'widget_id',
    group: 'Test', fields: [], ...overrides,
  };
}

describe('supportsGenericImport', () => {
  it('is true for a config whose only unsupported-type field is optional', () => {
    const config = cfg({
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'photo_url', label: 'Photo', type: 'image' },
      ],
    });
    expect(supportsGenericImport(config)).toBe(true);
  });

  it('is false when a required field uses an unsupported type', () => {
    const config = cfg({
      fields: [
        { key: 'ingredients', label: 'Ingredients', type: 'json', required: true },
      ],
    });
    expect(supportsGenericImport(config)).toBe(false);
  });

  it('ignores a required-and-unsupported field that is hideInForm', () => {
    const config = cfg({
      fields: [
        { key: 'legacy_blob', label: 'Legacy', type: 'json', required: true, hideInForm: true },
      ],
    });
    expect(supportsGenericImport(config)).toBe(true);
  });

  it('stays false for breed/breed-lifecycle-stage/BC-owned/number-series regardless of fields', () => {
    expect(supportsGenericImport(cfg({ key: 'breed', fields: [] }))).toBe(false);
    expect(supportsGenericImport(cfg({ key: 'breed-lifecycle-stage', fields: [] }))).toBe(false);
    expect(supportsGenericImport(cfg({ owner: 'BC', fields: [] }))).toBe(false);
    expect(supportsGenericImport(cfg({ key: 'number-series', fields: [] }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test web --testPathPattern=master-csv -t supportsGenericImport`
Expected: FAIL — the first two already pass under today's code, but "ignores a required-and-unsupported field that is hideInForm" fails (today's `supportsGenericImport` checks every field unconditionally, so a required `json` field blocks the master even when `hideInForm`).

- [ ] **Step 3: Implement the gate and field-list changes in `master-csv.ts`**

Remove `"image"` from `GENERIC_IMPORT_UNSUPPORTED_TYPES` (keep `"json"`, `"field-list"`, `"map"`, `"latlng"`). Add `createFormFields` above `genericImportFields`, rewrite both per the Interfaces block above. `genericImportFields`'s operational nob/lob exclusion: `!(getActiveWorkspaceScope() === "OPERATIONAL" && (f.key === "nob_id" || f.key === "lob_id"))`. Add the import: `import { getActiveWorkspaceScope } from "@/hooks/useAuth";` at the top of the file alongside the existing `api` import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test web --testPathPattern=master-csv -t supportsGenericImport`
Expected: PASS (all four)

- [ ] **Step 5: Write and verify the `genericImportFields` exclusion tests**

Add to the same spec file:

```ts
import { parseGenericImportRow } from './master-csv';

describe('genericImportFields (via parseGenericImportRow)', () => {
  afterEach(() => localStorage.clear());

  it('no longer drops an image-type field — it reads as plain text', async () => {
    const config = cfg({ fields: [{ key: 'photo_url', label: 'Photo', type: 'image' }] });
    const { payload, errors } = await parseGenericImportRow(config, { photo_url: 'https://example.com/p.jpg' }, {});
    expect(payload.photo_url).toBe('https://example.com/p.jpg');
    expect(errors).toEqual([]);
  });

  it('excludes nob_id/lob_id from the required-fields check when the workspace is OPERATIONAL', async () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'OPERATIONAL_ADMIN' }));
    localStorage.setItem('active_workspace_scope', 'OPERATIONAL');
    const config = cfg({
      fields: [
        { key: 'nob_id', label: 'Nature of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/nobs' },
        { key: 'lob_id', label: 'Line of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/lobs' },
      ],
    });
    const { errors } = await parseGenericImportRow(config, {}, {});
    expect(errors).toEqual([]);
  });

  it('still requires nob_id/lob_id from the CSV when the workspace is not OPERATIONAL', async () => {
    const config = cfg({
      fields: [
        { key: 'nob_id', label: 'Nature of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/nobs' },
      ],
    });
    const { errors } = await parseGenericImportRow(config, {}, {});
    expect(errors).toEqual(['Nature of Business is required.']);
  });
});
```

Run: `pnpm nx test web --testPathPattern=master-csv -t genericImportFields`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/master-data/utils/master-csv.ts apps/web/src/modules/master-data/utils/master-csv.spec.ts
git commit -m "feat(master-data): loosen generic CSV import gate to required-only unsupported fields"
```

---

### Task 2: Auto-fill NOB/LOB from the active operational area

**Files:**
- Modify: `apps/web/src/modules/master-data/utils/master-csv.ts:662-747` (`parseGenericImportRow`)
- Test: `apps/web/src/modules/master-data/utils/master-csv.spec.ts`

**Interfaces:**
- Consumes: `genericImportFields` from Task 1 (already excludes `nob_id`/`lob_id` from the parsed/required-checked field set when operational).
- Consumes: `getActiveWorkspaceScope`, `getActiveOperationalArea` from `@/hooks/useAuth`.
- Produces: `parseGenericImportRow`'s returned `payload` now carries `nob_id`/`lob_id` set from the active operational area whenever the workspace is OPERATIONAL and `config.fields` declares those keys — independent of whether the CSV row supplied them.

- [ ] **Step 1: Write the failing tests**

Add to `master-csv.spec.ts`:

```ts
describe('parseGenericImportRow NOB/LOB auto-fill', () => {
  afterEach(() => localStorage.clear());

  it('fills nob_id/lob_id from the active operational area when OPERATIONAL', async () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'OPERATIONAL_ADMIN' }));
    localStorage.setItem('active_workspace_scope', 'OPERATIONAL');
    localStorage.setItem('active_operational_area', JSON.stringify({ area_id: 'a-1', nob_id: 'nob-livestock', lob_id: 'lob-piggery' }));
    const config = cfg({
      fields: [
        { key: 'nob_id', label: 'Nature of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/nobs' },
        { key: 'lob_id', label: 'Line of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/lobs' },
      ],
    });
    const { payload, errors } = await parseGenericImportRow(config, {}, {});
    expect(payload).toMatchObject({ nob_id: 'nob-livestock', lob_id: 'lob-piggery' });
    expect(errors).toEqual([]);
  });

  it('the active area wins even when the CSV row names an nob_id/lob_id-looking column', async () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'OPERATIONAL_ADMIN' }));
    localStorage.setItem('active_workspace_scope', 'OPERATIONAL');
    localStorage.setItem('active_operational_area', JSON.stringify({ area_id: 'a-1', nob_id: 'nob-livestock', lob_id: 'lob-piggery' }));
    const config = cfg({
      fields: [{ key: 'nob_id', label: 'Nature of Business', type: 'select-entity', required: true, entityEndpoint: '/setup/wizard/nobs' }],
    });
    const { payload } = await parseGenericImportRow(config, { nob_id: 'some-other-id' }, {});
    expect(payload.nob_id).toBe('nob-livestock');
  });

  it('no-ops for a config with no nob_id/lob_id fields', async () => {
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ userType: 'OPERATIONAL_ADMIN' }));
    localStorage.setItem('active_workspace_scope', 'OPERATIONAL');
    localStorage.setItem('active_operational_area', JSON.stringify({ area_id: 'a-1', nob_id: 'nob-livestock', lob_id: 'lob-piggery' }));
    const config = cfg({ fields: [{ key: 'name', label: 'Name', type: 'text', required: true }] });
    const { payload } = await parseGenericImportRow(config, { name: 'Widget A' }, {});
    expect(payload).toEqual({ name: 'Widget A' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test web --testPathPattern=master-csv -t "NOB/LOB auto-fill"`
Expected: FAIL (first two) — `payload.nob_id`/`payload.lob_id` are `undefined` today; the third already passes (document as a pre-existing pass, not a regression).

- [ ] **Step 3: Implement the auto-fill in `parseGenericImportRow`**

Add `import { getActiveOperationalArea } from "@/hooks/useAuth";` (alongside the Task 1 import). Immediately before `return { payload, errors };`, mirror `MasterDataTable.tsx`'s save-time logic (lines ~2788-2803): if `getActiveWorkspaceScope() === "OPERATIONAL"`, read `getActiveOperationalArea()`, and when it's non-null set `payload.nob_id`/`payload.lob_id` from `activeArea.nob_id`/`activeArea.lob_id` whenever `config.fields.some((f) => f.key === "nob_id" / "lob_id")` and the active area holds that value — unconditionally overwriting whatever the CSV row produced for those keys.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test web --testPathPattern=master-csv -t "NOB/LOB auto-fill"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/master-data/utils/master-csv.ts apps/web/src/modules/master-data/utils/master-csv.spec.ts
git commit -m "feat(master-data): auto-fill NOB/LOB on CSV import from the active operational area"
```

---

### Task 3: Unify the template's field list and add "Code" headers

**Files:**
- Modify: `apps/web/src/modules/master-data/utils/master-csv.ts:493-515` (generic-fallback branch of `generateMasterTemplateCsv`)
- Test: `apps/web/src/modules/master-data/utils/master-csv.spec.ts`

**Interfaces:**
- Consumes: `genericImportFields` (Task 1).
- Produces: `function templateHeaderFor(f: MasterDataField): string` (module-private) — `f.label`, with `" Code"` appended when `f.type === "select-entity"`.
- Produces: generic-fallback branch headers = `genericImportFields(config).map(templateHeaderFor)`, in `config.fields` declaration order (same order `genericImportFields` already preserves via `Array.filter`).

- [ ] **Step 1: Write the failing tests**

Add to `master-csv.spec.ts`:

```ts
import { generateMasterTemplateCsv } from './master-csv';

describe('generateMasterTemplateCsv generic fallback — field list and headers', () => {
  it('excludes hideInForm/editOnly fields from the template, same as the create form', async () => {
    const config = cfg({
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'company_id', label: 'Company', type: 'text', hideInForm: true },
        { key: 'is_active', label: 'Active', type: 'boolean', editOnly: true },
      ],
    });
    const csv = await generateMasterTemplateCsv(config);
    const [headerLine] = csv.split('\r\n');
    expect(headerLine).toBe('Name');
  });

  it('appends " Code" to a select-entity header, leaves a plain select/text header alone', async () => {
    const config = cfg({
      fields: [
        { key: 'breed_id', label: 'Breed', type: 'select-entity', entityEndpoint: '/breed', entityValueKey: 'breed_id', entityLabelKeys: ['breed_code'] },
        { key: 'gender', label: 'Gender', type: 'select', options: [{ value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }] },
      ],
    });
    const csv = await generateMasterTemplateCsv(config);
    const [headerLine] = csv.split('\r\n');
    expect(headerLine.split(',')).toEqual(['Breed Code', 'Gender']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test web --testPathPattern=master-csv -t "field list and headers"`
Expected: FAIL — today's generic branch uses `f.key` (`company_id`/`breed_id`) as headers, not `f.label`, and includes `company_id`/`is_active` (`hideInForm`/`editOnly`) in the field list.

(`generateMasterTemplateCsv` is still synchronous at this point — Task 4 makes it `async`. `await`ing a function that returns a plain string works today too, since `await` on a non-promise value just resolves to it immediately, so this test file doesn't need to change again once Task 4 lands.)

- [ ] **Step 3: Implement the unified field list and headers**

Replace the generic-fallback branch's `fields`/`headers` construction (`master-csv.ts:494-503`) with `genericImportFields(config)` and `templateHeaderFor`. Leave the `sample` row construction (current placeholder logic) untouched for this task — Task 4 replaces it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test web --testPathPattern=master-csv -t "field list and headers"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/master-data/utils/master-csv.ts apps/web/src/modules/master-data/utils/master-csv.spec.ts
git commit -m "feat(master-data): template field list matches the create form, select-entity headers say Code"
```

---

### Task 4: Real examples in the downloaded template

**Files:**
- Modify: `apps/web/src/modules/master-data/utils/master-csv.ts:349,493-515` (`generateMasterTemplateCsv` signature + sample-row construction)
- Modify: `apps/web/src/modules/master-data/MasterDataImportModal.tsx:62-76,953-961` (async download + loading state)
- Test: `apps/web/src/modules/master-data/utils/master-csv.spec.ts`

**Interfaces:**
- Produces: `export async function generateMasterTemplateCsv(config: MasterDataConfig): Promise<string>` (signature change from sync to async; the `breed`/`breed-lifecycle-stage` branches are untouched and simply resolve immediately).
- Produces: `function templateSampleFor(f: MasterDataField, cache: Record<string, Row[]>): string` (module-private) — for `type === "select"`: `(f.options || []).map(o => o.value).join(" / ")`. For `type === "select-entity"`: the first fetched row's first non-empty `entityLabelKeys` value (falling back to `entityValueKey`), or `""` if nothing was fetched for that field's endpoint. Otherwise: today's existing placeholder logic (`f.placeholder` / `"10"` for number / `"false"` for boolean / `"Sample"`).
- Consumes: `prefetchGenericEntityOptions` (already exported, unchanged) to build the `cache` passed to `templateSampleFor`.
- Consumes (modal): new `downloadingTemplate` boolean state; `generateMasterTemplateCsv` now awaited.

- [ ] **Step 1: Write the failing tests**

Add to `master-csv.spec.ts`:

```ts
jest.mock('@/services/api-client', () => ({ api: { get: jest.fn() } }));
import { api } from '@/services/api-client';

describe('generateMasterTemplateCsv generic fallback — sample row', () => {
  afterEach(() => jest.resetAllMocks());

  it('shows the real option list for a select field', async () => {
    const config = cfg({
      fields: [{ key: 'animal_type', label: 'Animal Type', type: 'select', options: ['SOW', 'BOAR', 'GILT'].map((v) => ({ value: v, label: v })) }],
    });
    const csv = await generateMasterTemplateCsv(config);
    const [, sampleLine] = csv.split('\r\n');
    expect(sampleLine).toBe('SOW / BOAR / GILT');
  });

  it('shows a real existing code for an independent select-entity field', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ breed_id: 'b-1', breed_code: 'LARGE_WHITE' }] });
    const config = cfg({
      fields: [{ key: 'breed_id', label: 'Breed', type: 'select-entity', entityEndpoint: '/breed', entityValueKey: 'breed_id', entityLabelKeys: ['breed_code'] }],
    });
    const csv = await generateMasterTemplateCsv(config);
    const [, sampleLine] = csv.split('\r\n');
    expect(sampleLine).toBe('LARGE_WHITE');
  });

  it('leaves a dependent select-entity field blank (its options aren\'t pre-fetched)', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [{ stage_id: 's-1', stage_code: 'GROWER' }] });
    const config = cfg({
      fields: [
        { key: 'breed_id', label: 'Breed', type: 'select-entity', entityEndpoint: '/breed', entityValueKey: 'breed_id', entityLabelKeys: ['breed_code'] },
        { key: 'current_stage_id', label: 'Current Stage', type: 'select-entity', entityEndpoint: '/stage?breedId={value}', entityValueKey: 'stage_id', entityLabelKeys: ['stage_code'], dependsOn: 'breed_id' },
      ],
    });
    const csv = await generateMasterTemplateCsv(config);
    const [, sampleLine] = csv.split('\r\n');
    expect(sampleLine.split(',')[1]).toBe('');
  });

  it('falls back to a blank sample when the entity fetch fails, without throwing', async () => {
    (api.get as jest.Mock).mockRejectedValue(new Error('network down'));
    const config = cfg({
      fields: [{ key: 'breed_id', label: 'Breed', type: 'select-entity', entityEndpoint: '/breed', entityValueKey: 'breed_id', entityLabelKeys: ['breed_code'] }],
    });
    await expect(generateMasterTemplateCsv(config)).resolves.not.toThrow();
    const csv = await generateMasterTemplateCsv(config);
    const [, sampleLine] = csv.split('\r\n');
    expect(sampleLine).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx test web --testPathPattern=master-csv -t "sample row"`
Expected: FAIL — today's sample row is `""` for both `select` and `select-entity` unconditionally.

- [ ] **Step 3: Implement `templateSampleFor` and make `generateMasterTemplateCsv` async**

Change the export at `master-csv.ts:349` to `export async function generateMasterTemplateCsv(config: MasterDataConfig): Promise<string>`. In the generic-fallback branch, `const cache = await prefetchGenericEntityOptions(config);` then `const sample = fields.map((f) => templateSampleFor(f, cache));`. Implement `templateSampleFor` per the Interfaces block — reuse the same label-key-first lookup order `matchEntityOption`/the export-label resolver elsewhere in this file already use, so the shown example is exactly what a correctly-filled cell would contain.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm nx test web --testPathPattern=master-csv -t "sample row"`
Expected: PASS

Then run the full file once to confirm nothing in Tasks 1-3 regressed:
Run: `pnpm nx test web --testPathPattern=master-csv`
Expected: PASS (all tests)

- [ ] **Step 5: Wire the async download into `MasterDataImportModal.tsx`**

Add `const [downloadingTemplate, setDownloadingTemplate] = useState(false);` beside the other `useState` declarations (~line 62-70). Replace `handleDownloadTemplate` (line 72-76) with:

```ts
const handleDownloadTemplate = async () => {
  setDownloadingTemplate(true);
  try {
    const csvContent = await generateMasterTemplateCsv(config);
    const filename = `${config.key}_template.csv`;
    downloadCsvFile(filename, csvContent);
  } finally {
    setDownloadingTemplate(false);
  }
};
```

At the "Download CSV Template" button (~line 953-961), add `disabled={downloadingTemplate}` and swap the `Download` icon for `Loader2` (spinning) while `downloadingTemplate` is true, matching the existing `submitting` button's pattern at lines 911-921 (icon swap, label unchanged is fine, or swap to "Preparing…" — implementer's call, mirroring the nearest existing convention in this file).

- [ ] **Step 6: Typecheck and build**

Run: `pnpm nx typecheck web`
Expected: no new errors
Run: `pnpm nx build web`
Expected: succeeds

- [ ] **Step 7: Drive the running app**

Start/confirm the web dev server is up, open Master Data → Animal Register, click "Download CSV Template", confirm: the file downloads (no hang/error), the header row lists only create-form fields with "Breed Code"/"Item (Living Asset) Code"/etc. for entity columns, the Animal Type cell shows the real option list, and (while in the Piggery operational workspace) there is no `nob_id`/`lob_id` column at all. Then upload that same template back in (filled with one real row) and confirm the staged row previews as valid.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/modules/master-data/utils/master-csv.ts apps/web/src/modules/master-data/utils/master-csv.spec.ts apps/web/src/modules/master-data/MasterDataImportModal.tsx
git commit -m "feat(master-data): show real examples in the CSV template, async download"
```

---

### Task 5: End-to-end verification against the running app

No code changes — this task proves the whole chain against real data, per the project's own standard ("prove a write by making it and reading MySQL," not by a green test suite alone).

**Files:** none (verification only)

- [ ] **Step 1: Confirm the uploader now appears where expected**

In the running web app, open Master Data and confirm "Import CSV" now shows for Animal Register, Stage, Delivery Zones, and Route Stops, and still does **not** show for Breed, Breed Lifecycle Stage, any BC-owned master, Number Series, or Feed Formula.

- [ ] **Step 2: Import one real animal via CSV**

Download Animal Register's template, fill in one real, valid row (a real Breed code, a real Item code, `entry_type` = BORN_ON_FARM with a real Source Batch, etc.), upload it, and commit the import through the modal.

- [ ] **Step 3: Read the result back from MySQL**

Query the new animal row directly (not through the UI) and confirm: the row exists with the submitted values, `nob_id`/`lob_id` are the Piggery operational area's ids (not blank, not whatever — if anything — was in the CSV), and (if a photo URL was included) `ear_tag_image_url` holds that exact string.

- [ ] **Step 4: Report findings**

Note anything that didn't match expectation before calling this plan done — this step has no fixed "expected" output because it's the final cross-check against a live system, not a unit assertion.
