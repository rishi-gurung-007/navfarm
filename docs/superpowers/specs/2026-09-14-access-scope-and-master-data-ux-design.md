# Access scope and master-data interaction design

**Date:** 2026-09-14

**Decision owner:** Rishi

**Status:** Approved in conversation; awaiting review of this written specification

## 1. Purpose and scope

This design corrects two coupled problems:

1. The application currently mixes a line-of-business operational area with a
   farm, which cannot express the access boundaries Rishi defined.
2. Master-data screens and master-backed fields expose several competing
   interaction patterns. The resulting flow is visually noisy and makes users
   leave the task they are completing.

The work covers `apps/web` (Next.js) and `apps/api` (NestJS). Flutter is out of
scope. The only operational line of business in scope is Piggery, even though
the wider taxonomy contains other lines of business.

The product priority is intentional UI/UX and task flow. Correct authorization,
validation, persistence and auditability remain release requirements rather
than a reduced-quality twenty-percent tier.

## 2. Access model

Access is cumulative only within the boundary assigned to the user:

| User type | Data boundary | Farm boundary |
| --- | --- | --- |
| `TENANT_ADMIN` | Every company in the tenant | Every farm in those companies |
| `COMPANY_ADMIN` | One company | Every farm in that company |
| `OPERATIONAL_ADMIN` | One assigned operational area / LOB in one company | Every farm participating in that operational area; currently Piggery only |
| `STANDARD_USER` | One company and the assigned operational context | Exactly one assigned farm |

The API, not the browser, is authoritative for these boundaries. Every list,
detail, create, update, deactivate and delete operation must apply the relevant
company and operational-area rule. Operational records and explicitly
farm-specific masters must also apply the farm rule. Ordinary shared masters do
not become farm-scoped merely because a standard user has a farm assignment. An
identifier supplied in a request must never allow a user to cross any boundary
that applies to that record type.

Tenant and company headers still establish the active workspace, but headers
alone do not prove access. The API resolves and verifies the user's membership,
role assignments, operational-area assignments and farm assignment.

## 3. Operational area and farm are separate dimensions

`PIGGERY-01` represents the company-wide Piggery operational area. It is not a
farm and must not acquire its access meaning from
`operational_area_master.farm_id`.

A farm is a top-level Location Master record. Sheds belong to a farm, and pens
belong to a shed for the current Piggery flow. The location model remains
dynamic so configurable location types can support later hierarchies without
new one-off screens.

A standard user has one active farm assignment. An operational administrator is
not farm-restricted: their assigned Piggery operational area covers all farms
in that company. Company and tenant administrators inherit their wider scopes
from the table above.

Operational records carry or derive a farm boundary:

- A batch selects and belongs to one farm explicitly.
- A breed belongs to one farm through its required Location Master reference.
- An animal requires a breed, and its farm is derived from that farm-specific
  breed.
- Any batch, shed, pen or current location selected for an animal must belong to
  the same derived farm.
- Downstream records must retain a verifiable path to the owning batch, animal
  or location so their farm scope can be enforced consistently.

The implementation must reject mismatched references server-side even if a
client bypasses the selector UI.

Changing an existing location's parent or changing a Location Type's allowed
parents is not part of this design. This work must not silently introduce a new
reparenting policy; that data-integrity behavior requires its own decision.

## 4. Breed ownership and identity

Breed Master is farm-specific because growth performance, productive life and
lifecycle-stage values can differ between high- and low-altitude farms. The
same breed name may therefore appear in more than one farm as separate master
records with different field values.

The Breed Master contract is:

- Location (farm) is required and comes from Location Master.
- The breed list includes a Location column.
- Location is available inside Filters, not as a separate page-level selector.
- Search results and selectors disambiguate duplicate breed names with breed
  code, breed name, location code and location name.
- Breed lifecycle stages remain a true child view of Breed Master and therefore
  remain a primary tab beside Breeds.

Breed identity and validation include the farm so the same biological breed can
be configured independently for different farms without collapsing their
location-specific values into one row.

## 5. Master-page information architecture

Every master page uses the same composition:

1. A sticky application header contains the page title.
2. The breadcrumb appears directly below the title in that header.
3. The page body starts with Search, Filters and the active tab's Create action.
4. True child views appear as tabs, such as `Breeds | Lifecycle Stages`.
5. A relationship row is labelled exactly **Dropdown options**.
6. The data table follows the tabs and dropdown-options row.

There is no repeated page title and no descriptive filler paragraph in the
body. Search, filters, Create, row actions and table content all belong to the
active tab. Changing tabs updates those controls rather than leaving controls
from the previous view on screen.

Tabs represent alternate views of the same working context. They are not used
as a container for every referenced master.

### Dropdown options row

All master pages show the label **Dropdown options** followed by chips for the
master-backed values used by that page. Do not prefix it with “Related
masters:” or “Dropdown options come from”.

Examples on Breed Master include Location, Species and Diseases. Location is a
full primary master; Species and Diseases are supporting option masters. This
difference changes where their canonical navigation lives, but not whether the
user can inspect and manage them from the Dropdown options row.

Selecting a chip opens that option's full list-management dialog with search,
Create and a selectable table. A primary master such as Location also offers a
clear route to open its canonical master page. Supporting option masters are
managed in the dialog without adding permanent sidebar destinations merely to
expose a short controlled list.

Only a real master endpoint may appear in this row or in a selector. Workflow
endpoints that happen to return options are not presented as manageable masters.

On narrow screens, the chips collapse behind one **Dropdown options** control;
the terminology and capabilities remain unchanged.

## 6. Master-backed field selector

A master-backed form field uses an anchored custom selector attached to the
field. Opening the field displays options directly below it, in context. It does
not open a centered page dialog for the normal selection path.

The selector contains:

1. A search input at the top.
2. A compact, selectable result table below it.
3. Code and Name columns by default.
4. Configured identifying columns where required. Breed selection shows Breed
   Code, Breed Name, Location Code and Location Name.
5. An **Add new** action below the results when the user has create permission.
6. A **View full list** action below the results.

The compact popup is for quick selection. **View full list** opens the same
full list-management dialog used by a Dropdown options chip: search and Create
at the top, selectable paginated table below. Creating a missing value returns
the user to the interrupted form and selects the new record after a successful
save.

The selector configuration is shared across masters. Each field declares its
source master, searchable fields, visible identifying columns and permission-
gated actions. Creation forms must not render the old collapsed lookup cards
below their normal fields.

Static enums that are not master records, such as a fixed status choice, do not
gain master-management actions. They continue to use the most suitable native
select, radio or segmented control.

## 7. Table viewport and pagination

The page shell, header, controls, tabs and table footer remain visible within
the available viewport. Only the listing body scrolls.

The table footer is visible from the start and contains:

- the visible record range and total count;
- the page-size selector;
- current page and total pages;
- previous and next controls.

The table header remains visible while rows scroll. Server-side paging,
searching, filtering and sorting are the source of truth so large option lists
do not have to be loaded into browser memory.

## 8. Dialog rules

Dialogs have one obvious exit model:

- Data-entry dialogs have no top-right close icon and do not dismiss on
  backdrop click. Their footer contains Cancel and the primary action. Escape
  behaves like Cancel. If the form is dirty, Cancel or Escape asks for discard
  confirmation.
- View-only dialogs have a top-right close icon and no redundant footer Close
  button.
- Destructive confirmations have Cancel and the destructive action, with no
  top-right close icon and no backdrop dismissal.
- Normal master-backed selection uses the anchored field selector. A centered
  dialog is reserved for **View full list** or Dropdown options management.

The existing shared responsive data-entry frame remains the size standard:
fixed header and actions with a scrolling field body, desktop maximum of
1120 × 768 CSS pixels, 24px viewport margins, and full viewport below 640px.

## 9. Responsive navigation

On screens large enough to show both levels without crowding the work area, the
primary sidebar and contextual module sub-sidebar are visible together.

On small screens, one drawer shows one level at a time. A labelled switch/back
control moves between the primary sidebar and the module sub-sidebar. It must
not depend on an unlabeled icon or attempt to render two squeezed navigation
columns.

The current module and active destination remain apparent at both levels.

## 10. Interaction, accessibility and failure states

Searchable selectors follow the ARIA combobox pattern with a listbox or grid
popup. Keyboard users can open the popup, move through results, select, escape
back to the field and reach Add new or View full list. Focus returns to the
invoking field or chip when a popup/dialog closes.

Loading preserves the surrounding form and shows progress inside the result
region. An empty search result explains that no matching value exists and shows
Add new only when authorized. An API failure keeps the user's search and form
state, provides a retry action and does not silently present stale data as
current.

Create and management actions are hidden or disabled consistently when the user
lacks permission. Hiding an action is not authorization; the API independently
enforces it.

## 11. Implementation boundaries

The design extends the existing config-driven master-data system rather than
creating one-off pages. Shared components own:

- master page header and viewport composition;
- active-tab query/action state;
- Dropdown options relationship discovery;
- anchored entity selection;
- full list-management dialog;
- dialog dismissal policy;
- responsive two-level navigation.

Individual master configs supply labels, columns, filters, relationships and
permissions. Breed and Location are the first end-to-end proof, followed by
Batch and Animal flows that consume their farm-specific references.

The access-model changes require an explicit database migration and API scope
guards. Existing data must be audited before constraints become required; no
client value may be fabricated to fill a missing farm, breed or assignment.

## 12. Verification and acceptance criteria

The work is accepted only when all of the following are demonstrated:

- Each of the four user types can see and mutate exactly the records inside the
  company, operational-area and farm boundaries applicable to that record type.
- A newly invited operational administrator receives no implicit wildcard
  role. User-type and role administration enforce the existing strict
  hierarchy: no tenant API can create `SYSTEM_ADMIN`, no user can assign their
  own or a higher type, and only tenant-level administration can grant
  `SUPER_ADMIN` or an `ALL` wildcard.
- Direct API calls with out-of-scope identifiers are rejected.
- Database inspection confirms writes use the correct tenant, company, LOB,
  farm, breed and location references.
- Breed Master requires Location, lists and filters it, and allows the same
  breed identity to carry different farm-specific values without ambiguity.
- Batch requires a farm. Animal requires a breed and cannot combine that breed
  with a batch or location from another farm.
- Every master page uses active-tab controls, the exact **Dropdown options**
  label and the fixed table viewport/footer contract.
- Lookup-only option masters remain available through selectors and management
  dialogs without gaining unnecessary sidebar pages. Primary masters retain
  their canonical pages; Location is reachable both from its page and from a
  Breed dependency chip.
- Every master-backed field uses the anchored selector. No creation form retains
  a collapsed lookup card or opens the full centered dialog for routine choice.
- Root Location Types do not accept a parent. Non-root types require one, show
  only configured immediate-parent types, and reject cross-company or
  cross-farm parent references on the API.
- Animal Register has one canonical master-data destination. Operational stage
  transition and medication actions live with Batch Animals rather than a
  duplicate Livestock register.
- Data-entry, view-only and destructive dialogs follow their respective exit
  rules.
- Desktop, tablet and phone checks cover wide two-level navigation, narrow
  navigation switching, keyboard-only selectors, loading, empty, error and
  permission-denied states.
- Nx tests and typechecks pass for API, web and affected end-to-end coverage.

Browser verification is required at representative 1440px, 834px and 390px
viewport widths. A code review or passing component test alone is not evidence
that the interaction is usable.

## 13. Delivery sequence

Implementation should proceed in dependency order:

1. Correct the operational-area/farm data model and reusable API scope checks.
2. Build the shared page shell, anchored selector, list-management dialog and
   dialog-policy primitives.
3. Apply the pattern to Location and Breed, including farm-specific lifecycle
   data.
4. Apply farm selection/derivation and validation to Batch and Animal.
5. Roll the shared master interaction across all remaining master-backed fields
   and master pages.
6. Complete role-boundary, database and multi-viewport browser verification.

This sequence is implementation ordering, not permission to ship a partial
access model. A phase that exposes a new write path must include its server-side
scope enforcement in the same change.
