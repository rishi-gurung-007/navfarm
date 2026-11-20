# Master Data generic CSV import — fixes and extensions

2026-11-20. Small change. Frontend only (`apps/web/src/modules/master-data/`).

## Intent

The generic "Import CSV" bulk uploader works for most master-data screens
already (`utils/master-csv.ts` + `MasterDataImportModal.tsx`), but the gate
that decides which masters get the button is stricter than the code backing
it needs, and the downloaded template can drift from what import actually
accepts. Triggered by: Animal Register has no uploader today even though
nothing structurally prevents it.

## Goals

- Animal Register gets a working CSV uploader, using the existing generic
  path — no bespoke per-master import code.
- The underlying fix is general, not `config.key === 'animal'` special-cased:
  Stage, Delivery Zones and Route Stops get uploaders too, since they have
  the identical shape (one skippable, non-required field of an unsupported
  type).
- The downloaded template and the parser's accepted/required fields can never
  diverge again — one shared field list drives both.
- The template only lists fields the live **create** form actually asks for
  (respects `hideInForm`/`editOnly`), and only marks a field mandatory when
  the create form would.
- A `select-entity` column's header says "Code" so the person filling the
  sheet knows to type a code, not describe a record.
- NOB/LOB are auto-filled from the active operational area when the
  workspace is scoped to one (mirrors the live form), not asked for in the
  CSV.
- The template includes a real, usable example per field: the valid option
  list for a `select`, one real existing code for a `select-entity`.

## Non-goals

- No CSV-based photo *file* upload. `ear_tag_image_url` is a plain optional
  string column in the API DTO already (`animal.dto.ts:191,360`) — CSV
  import accepts a URL typed into the cell, same as any text field.
- No bespoke import logic for Animal Register specifically.
- `json` / `field-list` / `map` / `latlng` stay unsupported for CSV — they
  hold structured values a single cell can't carry. A master still gets
  blocked if one of *those* is `required`.
- No change to Export CSV, or to the Breed / Breed Lifecycle Stage bespoke
  importers.

## Constraints

- Frontend-only; no API/DTO changes.
- Must not regress any master that already supports generic import today.
- "Download Template" becomes async (one round of entity-option fetches
  before the file downloads) to source a real example code per
  `select-entity` field — accepted cost for a template that's actually
  useful to fill in.

## Approaches (decided through conversation; recorded for traceability)

- **Gate** (`supportsGenericImport`): loosen from "no field anywhere has an
  unsupported type" to "no *required*, submittable field has an unsupported
  type" — chosen over special-casing `animal`, since it's a general property
  of the config, not something true only for this one master.
- **Image field**: remove `"image"` from `GENERIC_IMPORT_UNSUPPORTED_TYPES`
  entirely (treat as plain text) rather than leave it silently skipped —
  chosen because the DTO already stores it as a plain string and it's the
  only field of that type in the system, so there's a real value to import.
- **Field list**: unify `generateMasterTemplateCsv`'s generic-fallback filter
  with the parser's `genericImportFields`, and extend that one shared filter
  with `!hideInForm && !editOnly` (on top of its existing
  `!filterOnly && !readOnly && !unsupported-type`) — chosen so template and
  parser can't drift, and both match what `createOnly`/`editOnly`/
  `hideInForm` already say about the live create form.
- **Headers**: use `f.label` instead of `f.key`, with `" Code"` appended only
  for `select-entity` — chosen because `getRawValue` already matches loosely
  by label (case/punctuation-insensitive), so this is presentation-only and
  can't break parsing.
- **NOB/LOB**: mirror the live form's existing operational-scope auto-fill
  (`getActiveWorkspaceScope()` / `getActiveOperationalArea()` from
  `@/hooks/useAuth`, already used in `MasterDataTable.tsx` lines ~859-866 and
  ~2788-2803) inside the generic import path — chosen over inventing new
  logic, since the behavior already exists and must not diverge from it.
- **Examples**: `select` fields show their full option list (joined, e.g.
  `/`-separated) as the sample value; `select-entity` fields show one real
  existing code, fetched via the same `prefetchGenericEntityOptions` the
  parser already uses at import time — chosen over leaving entity examples
  blank, since a real example is what was asked for and the fetch
  infrastructure already exists.

## What's left to the builder

- Exact separator for the `select` options hint in the sample cell (`/` is
  a reasonable default; anything unambiguous and unlikely to appear inside
  an option value works).
- How the real `select-entity` example is picked from the fetched list
  (first row returned is simplest and sufficient — no need for a "nicest"
  example).
- How `MasterDataImportModal.tsx`'s `handleDownloadTemplate` shows a brief
  loading state while the async fetch runs, matching whatever loading-state
  pattern the file already uses elsewhere (e.g. `parsing`/`submitting`
  state flags).

## Verify

- Import CSV now appears for Animal Register, Stage, Delivery Zones, Route
  Stops; still absent for Breed, Breed Lifecycle Stage, BC-owned masters,
  Number Series, Feed Formula (its `ingredients` field is `required`).
- Animal Register's downloaded template: columns match the live create
  form exactly (no `company_id`, no read-only/computed columns, no
  `nob_id`/`lob_id` while Piggery is the active operational area,
  `ear_tag_image_url` present as a plain column); `select` columns show
  their real option list as the sample; `select-entity` columns show one
  real existing code.
- One real CSV import of a new animal against the running app, confirmed
  by reading the inserted row back from MySQL (not just the UI's success
  toast) — including that `nob_id`/`lob_id` landed from the active
  operational area and that a URL typed into `ear_tag_image_url` saved
  correctly.
