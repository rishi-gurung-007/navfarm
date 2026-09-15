# Shared Master Select and Animal History Design

**Date:** 2026-09-15  
**Decision owner:** Rishi

## Scope

This change standardizes selection and related-option creation across every
config-driven Master Data create/edit form. It also presents an Animal's real
breeding records as a gender-specific timeline while preserving the separate
lifetime Traceability timeline.

Animal placement remains strictly Pen-only in both the form and API. No
location type other than `PEN` is a valid current location for a registered
Animal.

## Shared master dialog

Every primary Master Data create, edit and view dialog uses the same large
dialog frame: the existing `xl` width, common viewport-constrained height,
scrolling content body and fixed action footer. Related-master creation uses
the same frame rather than a smaller special-purpose card or modal.

This standardization applies to the config-driven Master Data route. It does
not restyle unrelated transactional dialogs such as Goods Receipt or Batch
Transfer.

## Entity selection interaction

Every `select-entity` field uses the shared searchable custom selector. The
collapsed control shows the current option. Opening it shows:

1. a search input at the top;
2. filtered options below it;
3. a footer containing `New` and `View All` only when the referenced entity is
   one of the related masters that the current form can create.

Plain configured `select` fields keep their finite predefined choices. They do
not offer `New` or `View All` because their values are application enums rather
than master records.

`View All` opens the existing full selector dialog with search and its table of
current options. That selector dialog also shows `Create New` when creation is
permitted. `New` in the compact selector and `Create New` in the full selector
open the same related master create flow.

When a related record is created successfully, all open selectors for that
endpoint refresh. The creating field selects the new record when its identifier
is returned; otherwise it leaves the prior value unchanged and presents the
refreshed list. Cancel and failed creation never change the field's selection.

Dependent selectors remain disabled or hidden until their prerequisite values
exist. Creation actions use the current form's scope and dependency values;
they are not shown when the related master cannot be created safely in that
context or when the current user has read-only access.

## Removal of duplicate related-master controls

Remove the collapsible `Add one without leaving this form` cards from the
bottom of Master Data forms. Their creation capability moves into the relevant
select field.

Keep the page-level `Dropdown options` shortcuts. They remain useful for
managing a related catalog without first opening a create/edit form and are not
duplicates inside the form itself.

## Animal breeding history

The existing Animal Register right-side drawer remains. Its Breeding History
tab becomes a newest-first vertical timeline using the same expandable event
language as Traceability.

- Female Animals show only their service, pregnancy check/result, farrowing
  and weaning events.
- Male Animals show only their sire services and the resulting litter events
  joined through those services.
- Empty or absent values are omitted rather than rendered as empty facts.
- When the Animal has no mating, pregnancy, farrowing or weaning event, the tab
  contains only `No breeding record.`

Traceability remains a separate newest-first lifetime timeline for birth,
registration/entry, Stage changes, Batch/Pen transfers and disposal. Breeding
events may appear there as part of the full lifetime record, but the Breeding
History tab is the focused reproductive view.

## Component boundaries and data flow

- `SearchableEntitySelect` owns compact search, option choice and the optional
  `New` / `View All` actions.
- `MasterDataTable` decides whether a referenced master is creatable, supplies
  the related config and owns the full selector/create dialog state.
- The existing field renderer passes action capability into the shared select;
  individual master configs do not implement one-off buttons.
- A successful related-master create invalidates/refetches endpoint options and
  reports the new identifier to the originating field.
- `AnimalDetailPanel` maps the existing breeding API response into focused
  timeline events. The backend continues to return the male/female-linked real
  records and never manufactures history.

## Error and accessibility behavior

- Option-loading and related-create failures use the existing inline error
  treatment and leave the previous selection intact.
- Search, `New`, `View All`, dialog close and option rows are keyboard
  reachable and have explicit accessible labels.
- Opening a nested create dialog does not submit or close the parent form.
- Closing the nested dialog returns focus to the originating selector.
- Only one related selector or nested creation surface is active at a time.

## Verification

Prototype verification uses existing checks rather than adding a broad new
test program:

- API and web Nx typechecks;
- existing focused web specs affected by the shared Master Data renderer;
- live Brave walkthrough of representative independent and dependent selectors;
- create a safe related option only when an intentional prototype value is
  available, then confirm its database row through MySQL;
- inspect female, male and no-history Animals in the drawer;
- confirm a registered Animal selector still lists only Pens.

No existing client or prototype row is rewritten merely to manufacture a
successful visual example.
