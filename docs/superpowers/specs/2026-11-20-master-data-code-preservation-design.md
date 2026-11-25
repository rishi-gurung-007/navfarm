# Master Data CSV import — preserve custom Master Codes

2026-11-20. Frontend + backend. `apps/web/src/modules/master-data/` and nine
backend master services under `apps/api/src/modules/`.

## Intent

A user uploading a CSV with a custom code for a master-data row expects that
code to land on the saved record. Today it sometimes doesn't, for two
unrelated reasons that happen to produce the same symptom:

- **Frontend:** Location's `location_code` field is `readOnly: true` on the
  manual form (because the form hides it — the code is normally derived from
  the Location Type prefix). The generic CSV importer reuses the manual
  form's field list verbatim, so `readOnly` excludes the column from both
  the downloaded template and the parsed import — the code never leaves the
  CSV. This is a form-visibility flag being asked to also answer an
  import-eligibility question it was never designed for.
- **Backend:** nine master services (Stage, Disease, Item Type, Feed
  Formula, Item Category, Breed, UOM, Cost Center, GL Account) each
  hand-roll the same code-resolution shape: resolve a Number Series, and
  *only if* the series' `manual_nos` flag is set does a caller-supplied code
  win — otherwise it is silently replaced by the generated one, with no
  error. A code submitted through the generic CSV importer (which already
  posts through each master's ordinary single-row create endpoint) hits
  this unconditionally, identically to a code typed into the manual form.

Location's backend (`location.service.ts`) is already correct — it calls
`NumberSeriesService.manualCode()`, which throws instead of discarding. It
is the only one of the ten masters surveyed where the bug is confined to the
frontend.

## Goals

- A custom code typed into (or uploaded for) Location, or any of the nine
  silently-overriding masters, either lands on the record or produces a
  clear rejection — never a different, unannounced code.
- A blank code continues to auto-generate via the master's configured
  Number Series, unchanged.
- The fix generalizes: a future master with the same `readOnly`-manual-form
  combination doesn't reintroduce this bug, and the alias/preview/duplicate
  mechanisms work for any master that declares them, not just the ones in
  today's survey.
- The import preview shows what will actually happen to a row's code —
  uploaded, to-be-generated, or invalid — for every generically-imported
  master, not only Breed/Breed Lifecycle Stage (today's only ones with any
  code display at all).
- Obvious upload mistakes (two rows claiming the same code; a code that
  already exists in this tenant/company scope) are caught before commit,
  where that's cheap to check, without adding a request per row.

## Non-goals

- No change to Breed's or Breed Lifecycle Stage's own bespoke CSV parsing
  logic in `MasterDataImportModal.tsx` (the large `config.key === 'breed-
  lifecycle-stage'` branch) — only the *generic* code-resolution/alias/
  preview mechanisms they can still opt into (the preview's Code column,
  the backend fix to `BreedService.resolveBreedCode`, which both the single
  create and `createBreedsBulk` already share).
- No generic backend bulk-import endpoint. The importer still posts one row
  at a time through each master's existing create endpoint; that's
  unchanged.
- No change to GL Account's import eligibility — it stays `owner: 'BC'`,
  gated out of the generic importer entirely, same as today. Its backend
  code-resolution bug is still fixed, since the manual form (and any direct
  API caller) can hit it independently of CSV import.
- No tenant-wide "existing-record duplicate" index — the pre-flight check
  reuses each master's own list endpoint (already tenant/company scoped
  server-side) once per uploaded file, not a new lookup service.
- `json` / `field-list` / `map` / `latlng` fields remain unsupported for
  generic CSV import, as already decided in the prior (19 Nov) generic-
  import work. Not reopened here.

## Constraints

- Must not change manual-form behavior for any existing master: `readOnly`
  still means "shown, never editable" there; only CSV import gets a second,
  independent signal.
- Must not change Number Series configuration, enable manual numbering
  globally, or touch migrations.
- Must preserve each affected backend service's existing series-resolution
  particulars (Stage/Breed/UOM's type-dimension sub-series; Item Category/
  Cost Center/GL Account's parent-child composite-code generation) — the fix
  adds a missing guard, it does not replace any of that logic.
- Every backend service already validates code uniqueness downstream of
  code resolution (a dedicated duplicate query, or an `ER_DUP_ENTRY`
  retry/unique index) — unchanged, still the authoritative check.
- The generic importer still submits rows one `POST` at a time; pre-flight
  validation must not turn that into N+1 requests for a duplicate check — a
  single batched list call per uploaded file is the budget.

## Approaches (decided through conversation; recorded for traceability)

- **Frontend `readOnly` vs import-eligible:** add `MasterDataField
  .importable?: boolean` — an explicit, additive opt-out of the generic
  importer's `readOnly` exclusion, set only on fields that are read-only on
  the *manual form* but still settable at create time (Location's
  `location_code`, today). Chosen over inventing a `config.key === 'location'`
  branch, since the task explicitly rules that out, and over flipping
  `readOnly` off outright, which would also make the field editable in the
  manual form — a real behavior change this spec doesn't want.
- **Primary code field, generically:** add `MasterDataConfig.codeField?:
  string` naming the field key that holds this master's own identity code.
  Chosen over inferring it positionally (`config.columns[0]`, which the task
  explicitly warns against) or by naming convention (`*_code`, which breaks
  for `lifecycle_code`) — an explicit, opt-in, per-config value that every
  later mechanism (preview resolver, duplicate checks) reads the same way.
- **Aliases:** add `MasterDataField.aliases?: string[]`, merged into
  `getRawValue`'s existing alias parameter for *every* field type (today
  only `select-entity` fields get a built-in alias, the `"<Label> Code"`
  template header). Set only on the handful of fields the task names
  (Location Code, Animal ID/Ear Tag/Tag No, Item Code) — never a blanket
  "ID"/"Code" alias applied to every text field, which `getRawValue`'s
  existing priority order (exact key → exact label → explicit alias →
  normalized match of all three) would make ambiguous across fields that
  happen to share a normalized form.
- **Backend silent-override fix:** insert one explicit branch — "a code was
  supplied, but the resolved series has `manual_nos` false → throw
  `BadRequestException`, naming the master, instead of falling through to
  `generateNext()`/`generateCompositeCode()`" — into each of the nine
  services' existing resolution logic, in place. Chosen over swapping these
  nine onto `NumberSeriesService.resolveNewCode()`/`manualCode()` wholesale:
  three of them (Item Category, Cost Center, GL Account) generate a
  composite parent-child code `resolveNewCode` doesn't know how to produce,
  and `manualCode()` has no transaction-executor parameter, which would
  silently run its uniqueness check outside the nested `tx` these three
  (and Breed, which threads an explicit `executor`) already use. The
  smaller, in-place guard preserves every other behavior exactly.
- **Preview code resolver:** one function, `resolveImportCodeDisplay(config,
  stagedRow)`, reads `config.codeField` to decide what the row's Code column
  shows: the uploaded value when present in the parsed payload; "will be
  generated" when blank and `config.codeFieldGenerated` is set; otherwise a
  plain empty/`NA` state — replacing the five separate hardcoded
  `breed_code || lifecycle_code` chains in `MasterDataImportModal.tsx`.
  Chosen over fabricating a predicted generated code (the task explicitly
  forbids this — the next sequence number isn't known client-side) and over
  a boolean "has a code" flag (loses the uploaded/generated/invalid
  distinction the task asks the preview to show).
- **Within-file duplicate check:** a pure function over the staged payloads
  (post-parse, pre-commit), grouping by `config.codeField`'s *normalized*
  (case-insensitive, trimmed) value — mirrors the backend's own
  `code.trim().toUpperCase()` normalization so a file flagged clean here
  can't still collide at submit.
- **Existing-record duplicate check:** one batched `GET config.apiBase`
  list call per uploaded file (same tenant/company scope the list already
  carries via auth context — no new endpoint), building a normalized-code
  set to check staged rows against before commit. Chosen over a lookup per
  row (explicitly ruled out by the task) and over skipping this step
  entirely (the task asks for it "where feasible," and the masters in
  scope here all have ordinary list endpoints already used elsewhere in
  this same file for not much more than this).

## What's left to the builder

- Exact wording of the backend's new rejection message per service (mirror
  each service's existing message style, e.g. disease.service.ts:45's
  "Enter a Code for this disease — no number series is configured for
  diseases.").
- Exact wording of the preview's "will be generated" label and whatever
  small visual distinction (badge/color) marks uploaded vs. generated vs.
  invalid in the Code column — match whatever convention
  `MasterDataImportModal.tsx` already uses for its Status column badges.
- Which masters' `codeField`/`codeFieldGenerated`/`aliases` get set in
  `configs.ts` beyond the ones named in Goals — any master already
  confirmed import-eligible with an unambiguous code field is a reasonable
  candidate; GL Account's `codeField` may be set or omitted since the
  generic importer never reaches it either way.
- Cap on the existing-record duplicate pre-flight's list call (a `limit`
  large enough to cover realistic tenant data without being unbounded) —
  document whatever is chosen as a known limitation, since authoritative
  backend validation at submit time is the real backstop regardless.

## Verify

- Location: CSV template includes a "Code" column; a row with a custom code
  imports with that code; a row left blank still auto-generates from the
  Location Type prefix — all three read back from MySQL, not just the UI.
- One of the nine backend services (e.g. Disease): a manual-form create (or
  CSV import) with a custom code, against a tenant where Disease's series
  has `manual_nos` true, saves with that code; the same call against a
  series with `manual_nos` false now returns a clear 400 instead of saving
  a different, generated code — verified by reading MySQL, not the API
  response alone.
- A within-file duplicate (two rows, same code, different case) is flagged
  before commit and neither reaches the API.
- An uploaded code that already exists on a real row in the same tenant is
  flagged before commit (for a master within the pre-flight's list-call
  budget) and, if somehow missed, is still rejected by the backend's own
  uniqueness check at submit — never silently created as a duplicate or
  silently replaced with a generated one.
- Breed's preview Code column (generic resolver) shows the same value it
  showed before this change, for a real Breed import file — the
  replacement is behavior-preserving for the one master that already had
  a working hardcoded display.
