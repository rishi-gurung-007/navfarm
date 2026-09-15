# Shared Master Select and Animal History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every config-driven Master form one consistent searchable entity selector with contextual creation actions, and render real Animal breeding history as a gender-specific timeline.

**Architecture:** Keep master-specific behavior in the existing registry and put interaction behavior in shared components. Split the full entity-picker dialog out of `EntityLookupField`, let `MasterDataTable` resolve whether a field's endpoint maps to a creatable master, and reuse a create-only `MasterDataTable` surface for nested creation so it has the exact standard form. Keep breeding data fetching in the existing API and map its records into timeline events in `AnimalDetailPanel`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind, Jest/Testing Library, Nx.

**Spec:** `docs/superpowers/specs/2026-09-15-master-select-and-animal-history-design.md`

## Global Constraints

- Registered Animal placement remains strictly `PEN` in the UI and API.
- All primary Master create/edit dialogs use the existing large shared Dialog frame.
- `New`, `View All`, and `Create New` appear only when the referenced master is creatable from that field and the user has write access.
- Static `select` enums do not gain master-creation actions.
- Remove only the form-bottom `Add one without leaving this form` cards; keep page-level `Dropdown options` shortcuts.
- Do not invent or rewrite Animal breeding records for visual verification.
- Do not overwrite or revert the dirty Breed, UOM, Goods Receipt, scope, rebuild, Location, Stage, Animal or Transfer work already present.
- Use existing focused specs and live verification; do not create a broad prototype test program.

---

### Task 1: Controlled full entity-picker dialog

**Files:**
- Modify: `apps/web/src/modules/master-data/EntityLookupField.tsx`
- Modify: `apps/web/specs/entity-lookup-field.spec.tsx`

**Interfaces:**
- Produces: `EntityLookupDialogProps` and exported `EntityLookupDialog`.
- Produces: optional `onCreate?: () => void` on `EntityLookupFieldProps`.
- Consumes: existing `LookupRow`, `rowValues`, `rowLabel`, and shared `Dialog`.

- [ ] **Step 1: Extend the existing focused spec with the creation affordance**

Add a case to `entity-lookup-field.spec.tsx` that renders:

```tsx
const onCreate = jest.fn();
render(<EntityLookupField {...baseProps} onCreate={onCreate} />);
fireEvent.click(screen.getByRole("button", { name: baseProps.label }));
fireEvent.click(screen.getByRole("button", { name: `Create New ${baseProps.label}` }));
expect(onCreate).toHaveBeenCalledTimes(1);
```

Also assert that omitting `onCreate` produces no `Create New` button.

- [ ] **Step 2: Run the focused spec and confirm the new assertion fails**

Run: `pnpm nx test web --runInBand --testPathPatterns=entity-lookup-field.spec.tsx`

Expected: failure because `EntityLookupFieldProps` has no creation callback and the dialog has no button.

- [ ] **Step 3: Extract the controlled dialog**

In `EntityLookupField.tsx`, export this contract:

```ts
export interface EntityLookupDialogProps {
  open: boolean;
  onClose: () => void;
  label: string;
  options: LookupRow[];
  value: string | string[];
  valueKey: string;
  labelKeys: string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  loading?: boolean;
  onCreate?: () => void;
}
```

Move the existing search state, table, choice handling, empty/loading states and footer into `EntityLookupDialog`. Add this button before Clear/Cancel:

```tsx
{onCreate && (
  <Button type="button" size="sm" onClick={onCreate}>
    <Plus className="h-4 w-4" aria-hidden />
    Create New {label}
  </Button>
)}
```

Keep `EntityLookupField` as its compact trigger plus local `open` state, rendering `EntityLookupDialog` underneath. Pass its optional `onCreate` through.

- [ ] **Step 4: Run the focused spec**

Run: `pnpm nx test web --runInBand --testPathPatterns=entity-lookup-field.spec.tsx`

Expected: all entity lookup cases pass.

- [ ] **Step 5: Commit the isolated picker change**

```bash
git add apps/web/src/modules/master-data/EntityLookupField.tsx apps/web/specs/entity-lookup-field.spec.tsx
git commit -m "Add related record creation to the entity picker"
```

### Task 2: One compact searchable selector for single entity fields

**Files:**
- Modify: `apps/web/src/modules/master-data/SearchableEntitySelect.tsx`
- Modify: `apps/web/src/modules/master-data/MasterDataTable.tsx`

**Interfaces:**
- Consumes: Task 1 `EntityLookupDialog`.
- Produces: optional `onCreate?: () => void` and `onViewAll?: () => void` on `SearchableEntitySelectProps`.
- Produces: all single `select-entity` fields use `SearchableEntitySelect`; multiple fields continue to use `EntityLookupField`.

- [ ] **Step 1: Add compact-selector footer actions**

Extend `SearchableEntityPanel` and `SearchableEntitySelectProps` with `onCreate` and `onViewAll`. Import `Plus` and `List` from `lucide-react`. After the option list render:

```tsx
{(onCreate || onViewAll) && (
  <div className="flex shrink-0 items-center justify-end gap-2 border-t border-(--border-subtle) px-1 pt-2">
    {onCreate && <button type="button" onClick={() => { close(); onCreate(); }}>New</button>}
    {onViewAll && <button type="button" onClick={() => { close(); onViewAll(); }}>View All</button>}
  </div>
)}
```

Use the existing small-button visual language and explicit `aria-label` values `New ${ariaLabel}` and `View All ${ariaLabel}`.

- [ ] **Step 2: Remove the divergent single-field renderer**

In `MasterDataTable.renderField`, delete the `if (f.searchable)` distinction for a single value. Render every non-`multiple` `select-entity` through `SearchableEntitySelect`, preserving resolved options, restrictions, loading/disabled state, value key, label calculation and placeholder.

Keep `EntityLookupField` for `multiple` values because it provides chip removal and multi-row selection.

- [ ] **Step 3: Add controlled View All state**

Add:

```ts
type RelatedPicker = {
  field: MasterDataField;
  config: MasterDataConfig;
  options: Row[];
};
const [relatedPicker, setRelatedPicker] = useState<RelatedPicker | null>(null);
```

Render `EntityLookupDialog` once near the other dialogs. Its `onChange` writes the selected value with `setField(relatedPicker.field.key, value)` and closes for a single selection.

- [ ] **Step 4: Resolve creation capability per field**

Use `endpointPath` and `lookupConfigs` to find a related master whose `apiBase` matches the field's resolved endpoint. Do not offer actions for setup wizard endpoints, self-references, read-only forms, or fields whose dependencies are unresolved:

```ts
const relatedConfigFor = (field: MasterDataField, resolvedEndpoint: string | null) => {
  if (!resolvedEndpoint || readOnly) return undefined;
  return lookupConfigs.find((candidate) =>
    endpointPath(candidate.apiBase) === endpointPath(resolvedEndpoint) && candidate.key !== config.key
  );
};
```

Pass `onViewAll` and, after Task 3 supplies it, `onCreate` only when this returns a config.

- [ ] **Step 5: Run shared web checks**

Run:

```bash
pnpm nx test web --runInBand --testPathPatterns='(entity-lookup-field|master-data-dependent-options|master-data-lookup-chips)'
pnpm nx typecheck web
```

Expected: existing dependent-option behavior remains green and TypeScript passes.

- [ ] **Step 6: Commit the unified selector**

```bash
git add apps/web/src/modules/master-data/SearchableEntitySelect.tsx apps/web/src/modules/master-data/MasterDataTable.tsx
git commit -m "Use one searchable selector across master forms"
```

### Task 3: Reuse the standard master form for related creation

**Files:**
- Modify: `apps/web/src/modules/master-data/MasterDataTable.tsx`
- Delete: `apps/web/src/modules/master-data/LookupCard.tsx`
- Modify: `apps/web/specs/master-data-lookup-chips.spec.ts`

**Interfaces:**
- Consumes: Task 2 `relatedConfigFor` and selector action callbacks.
- Produces: optional `createOnly?: boolean`, `onCreated?: (row: Row) => void`, and `onCreateCancelled?: () => void` props on `MasterDataTable`.
- Produces: `relatedCreator: { field: MasterDataField; config: MasterDataConfig } | null` state.

- [ ] **Step 1: Add create-only lifecycle props**

Change the component signature to:

```ts
export function MasterDataTable({
  config,
  createOnly = false,
  onCreated,
  onCreateCancelled,
}: {
  config: MasterDataConfig;
  createOnly?: boolean;
  onCreated?: (row: Row) => void;
  onCreateCancelled?: () => void;
})
```

When `createOnly` mounts, call the existing `openCreate()` once after hooks are initialized. Skip list loading in create-only mode. Closing its form calls `onCreateCancelled`.

- [ ] **Step 2: Return the created record**

Capture the create response:

```ts
const response = await api.post(config.apiBase, payload);
const created = unwrap<Row>(response);
setModalOpen(false);
onCreated?.(created);
```

Edits retain the existing PUT/load behavior. A failed create keeps the child dialog open and shows the current inline error.

- [ ] **Step 3: Standardize the form frame**

For the primary create/edit Dialog use:

```tsx
maxWidth="xl"
presentation="modal"
```

The shared Dialog already gives every non-compact form the same `70rem` desktop frame, viewport height, scroll body and pinned footer. Delete the obsolete `sectionCount` width branch and `usePageDialog` calculation.

- [ ] **Step 4: Wire nested related creation**

Add `relatedCreator` state in the parent. `New` from `SearchableEntitySelect` and `Create New` from `EntityLookupDialog` set the same `{ field, config }` value. Render:

```tsx
{relatedCreator && (
  <MasterDataTable
    config={relatedCreator.config}
    createOnly
    onCreateCancelled={() => setRelatedCreator(null)}
    onCreated={(created) => {
      const valueKey = relatedCreator.field.entityValueKey || relatedCreator.config.idKey;
      const id = created?.[valueKey] ?? created?.[relatedCreator.config.idKey];
      setEntityReloadKey((key) => key + 1);
      if (id !== undefined && id !== null) setField(relatedCreator.field.key, String(id));
      setRelatedCreator(null);
    }}
  />
)}
```

Ensure opening creation from View All closes only the picker, not the parent form. The parent form values remain mounted.

- [ ] **Step 5: Remove duplicate form-bottom cards**

Delete the `lookupConfigs.map(...LookupCard...)` block and its import from `MasterDataTable`. Delete `LookupCard.tsx`. Keep `manageableLookups` and the page-level `Dropdown options` row unchanged.

Update `master-data-lookup-chips.spec.ts` so it no longer expects `Add one without leaving this form`, while retaining assertions for page-level lookup discovery.

- [ ] **Step 6: Run focused checks**

Run:

```bash
pnpm nx test web --runInBand --testPathPatterns='(entity-lookup-field|master-data-dependent-options|master-data-lookup-chips)'
pnpm nx typecheck web
```

Expected: focused specs and typecheck pass.

- [ ] **Step 7: Commit related creation**

```bash
git add apps/web/src/modules/master-data/MasterDataTable.tsx apps/web/src/modules/master-data/SearchableEntitySelect.tsx apps/web/src/modules/master-data/EntityLookupField.tsx apps/web/specs/entity-lookup-field.spec.tsx apps/web/specs/master-data-lookup-chips.spec.ts
git add -u apps/web/src/modules/master-data/LookupCard.tsx
git commit -m "Move related master creation into entity selectors"
```

### Task 4: Gender-specific breeding timeline

**Files:**
- Modify: `apps/web/src/modules/master-data/AnimalDetailPanel.tsx`

**Interfaces:**
- Consumes: existing `breeding.matings`, `breeding.farrowings`, `isMale`, `TimelineEvent`, `fmt`, and `openEvent` state.
- Produces: `breedingTimeline: TimelineEvent[]` and the exact empty copy `No breeding record.`.

- [ ] **Step 1: Build focused breeding events**

Add a `useMemo` that maps only real records:

```ts
const breedingTimeline = useMemo<TimelineEvent[]>(() => {
  const events = [
    ...matings.map((record) => matingTimelineEvent(record, isMale)),
    ...farrowings.map((record) => farrowingTimelineEvent(record, isMale)),
  ];
  return events.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
}, [matings, farrowings, isMale]);
```

Use titles `Served {sow}` / `Served by {boar}` and `Sired a litter` / `Farrowed`. Female mating detail includes pregnancy check/result and expected farrowing. Male detail identifies the sow and service outcome. Farrowing detail includes only values actually present, including weaning when recorded.

- [ ] **Step 2: Replace the two breeding card sections**

Render the same rail, marker, expandable button and filtered detail list used by Traceability against `breedingTimeline`. Extract a small local `TimelineList` component inside `AnimalDetailPanel.tsx` if needed to prevent duplicate JSX; it accepts:

```ts
{ events: TimelineEvent[]; emptyText: string; openEvent: string | null; onToggle: (id: string) => void }
```

When the array is empty render exactly:

```tsx
<p className="text-xs" style={S.muted}>No breeding record.</p>
```

- [ ] **Step 3: Verify the web compilation**

Run: `pnpm nx typecheck web`

Expected: pass.

- [ ] **Step 4: Commit the timeline**

```bash
git add apps/web/src/modules/master-data/AnimalDetailPanel.tsx
git commit -m "Show animal breeding records as a focused timeline"
```

### Task 5: Live prototype verification and handoff refresh

**Files:**
- Modify: `docs/handoffs/2026-09-15-prototype-priority.md`
- Modify: `docs/decisions.md` only if live behavior requires a new Rishi decision.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: evidence-backed handoff without claiming untested MVP scope.

- [ ] **Step 1: Run final static checks serially**

```bash
git diff --check
pnpm nx typecheck web
pnpm nx typecheck api
```

Expected: all pass. Do not run parallel Nx tasks on the 8 GB machine.

- [ ] **Step 2: Drive representative master selectors in Brave**

With the existing authenticated session:

1. Open Location create and confirm the standard dialog frame.
2. Open Location Type: search is first, options are custom-rendered, and `New` / `View All` appear.
3. Open `View All`; confirm its `Create New Location Type` action.
4. Open `New`; confirm the standard Location Type form opens and cancel without saving.
5. Open an entity field without supported creation and confirm neither action appears.
6. Confirm the old form-bottom lookup cards are absent and page-level `Dropdown options` remains.

- [ ] **Step 3: Drive Animal history variants**

Open one female, one male and one no-history Animal when such real rows exist. Confirm gender-specific titles, chronological ordering, expandable real values and `No breeding record.`. If the database lacks a variant, record it as unverified; do not insert invented history.

- [ ] **Step 4: Confirm Pen-only state without writing data**

Run:

```bash
mysql -u root tenant_devco -e "SELECT lm.location_type, COUNT(*) AS animals FROM animal_register a JOIN location_master lm ON lm.location_id=a.current_location_id GROUP BY lm.location_type;"
```

Expected for the current prototype data: only `PEN`, with 27 Animals unless another authorized user has changed the dataset.

- [ ] **Step 5: Update the handoff**

Record exactly which UI variants were observed, static check results, any intentionally unverified variants, the current commit(s), and the unchanged next priority: Batch selection, Schedulers, then Daily Data Entry.

- [ ] **Step 6: Commit documentation only if its evidence is current**

```bash
git add docs/handoffs/2026-09-15-prototype-priority.md docs/decisions.md
git commit -m "Record shared master selector verification"
```
