export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "email"
  | "date"
  | "select"
  | "select-entity"
  | "field-list"
  | "json"
  | "string-list";

export interface SelectOption {
  value: string;
  label: string;
}

/** One condition for `requiredWhen`: matches when `key`'s current form value equals `equals`
 * (or one of `equals`, if an array), or when it's anything OTHER than `notEquals` (or none of
 * them, if an array) — useful for "every type except this one," where enumerating every other
 * value would silently miss one added later. With neither given, matches on any non-empty
 * value. */
export interface RequiredCondition {
  key: string;
  equals?: string | boolean | Array<string | boolean>;
  notEquals?: string | boolean | Array<string | boolean>;
}

export interface MasterDataField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /**
   * Marks this field conditionally required — required only when at least one of `anyOf`'s
   * conditions currently matches the form's live values (e.g. `standard_cost` required only
   * when `valuation_method` is `STANDARD`). Shown with the same asterisk as `required`, and
   * enforced client-side on save; the API enforces the same rule independently.
   */
  requiredWhen?: { anyOf: RequiredCondition[] };
  /** Render and submit only while at least one condition matches. */
  visibleWhen?: { anyOf: RequiredCondition[] };
  placeholder?: string;
  helpText?: string;
  /** Static dropdown options, for type: "select" */
  options?: SelectOption[];
  /** API path to fetch related records from, for type: "select-entity". In "path" mode (default), include "{value}" as a placeholder for the (single) parent field's current value. */
  entityEndpoint?: string;
  /** Field on the related record to use as the option value (defaults to its idKey) */
  entityValueKey?: string;
  /** Fields on the related record to join (" — ") for the option label */
  entityLabelKeys?: string[];
  /** Select multiple related values with checkboxes (submitted as an array). */
  multiple?: boolean;
  /**
   * A synthetic "All" row prepended to a `multiple` field's options, shaped
   * like a real one (e.g. `{ stage_code: "ALL", stage_name: "All Stages" }`)
   * so `entityValueKey`/`entityLabelKeys` render it exactly like the rest.
   * Selecting it clears every other selection and vice versa (MasterDataTable
   * enforces this in `setField`); it never reaches the API — an edit whose
   * value is only this option submits the field as empty, and a stored empty
   * value opens the form with this option pre-selected. Reason Master's Stage
   * Filter is the first use: the template asks for one field, and the
   * underlying column already treats empty as "no restriction" — this makes
   * that state pickable instead of implicit in leaving everything unchecked.
   */
  allOption?: Record<string, unknown>;
  /**
   * What an empty `multiple` value means on the record view. It defaults to
   * "All (no restriction)", which is right where empty widens the rule —
   * Allowed Parent Types, Applicable Stages — and wrong where empty just means
   * nothing was recorded. A currency with no countries is not legal tender
   * everywhere.
   */
  emptyMultipleLabel?: string;
  /**
   * For type "select-entity": key(s) of other field(s) in this form whose value this dropdown
   * depends on (e.g. lob_id depending on nob_id). Disabled until every parent has a value;
   * resets when any parent changes.
   */
  dependsOn?: string | string[];
  /**
   * How dependsOn resolves into the fetch endpoint:
   * - "path" (default): a single dependsOn key substituted for "{value}" in entityEndpoint
   *   (e.g. entityEndpoint "/setup/wizard/lobs/{value}").
   * - "query": each dependsOn key is appended to entityEndpoint as a query param, named via
   *   queryParams (e.g. entityEndpoint "/item", queryParams { nob_id: "nobId", lob_id: "lobId" }
   *   produces "/item?nobId=...&lobId=..."). Unlike "path", a parent left unset simply omits
   *   that param rather than blocking the fetch — matches the backend treating an absent
   *   filter as "show all".
   */
  dependsOnMode?: "path" | "query";
  /** Required when dependsOnMode is "query": maps each dependsOn field key to its query-param name. */
  queryParams?: Record<string, string>;
  /**
   * Optional with dependsOnMode "query": translates the parent's value before it
   * is sent, keyed by parent field then by that field's value.
   *
   * Without it the parent's raw value is the param value, which only works when
   * the two vocabularies match. A UOM list narrowed by item type does not:
   * item_type is LIVESTOCK but the UOM master's type is COUNT. A value with no
   * entry sends no param at all, so the field falls back to the unfiltered list
   * rather than showing nothing.
   */
  queryValueMap?: Record<string, Record<string, string>>;
  /**
   * Narrows this select-entity field's options to whichever "types" another already-selected
   * master row allows — driven entirely by live master data, not a hardcoded rule. Location's
   * Parent Location uses this: the selected Location Type's own `allowed_parent_types` list
   * says which location types may be its parent (an empty list means it's a root type, e.g.
   * Farm, and the field has no options at all).
   *
   * Pair with `dependsOn: selectorKey` (default "path" mode) so the field is disabled until
   * the selector has a value and resets when the selector changes — this prop only adds the
   * type-filter and the "root type, no parent allowed" disabled state on top of that.
   */
  restrictOptionsBy?: {
    /** Field in this form holding the selector's current code (e.g. "location_type"). */
    selectorKey: string;
    /** Entity endpoint the selector field itself already fetches full rows from (e.g. "/location-type"). */
    selectorEntityEndpoint: string;
    /** Column on a selector row holding its own code, matched against the selector field's value (e.g. "type_code"). */
    selectorCodeKey: string;
    /** Column on a selector row holding the array of codes this field's options are allowed to have (e.g. "allowed_parent_types"). */
    allowListKey: string;
    /** Column on this field's own option rows to test against the allow-list (e.g. "location_type"). */
    optionCodeKey: string;
    /** Hide the control when the selected row's allow-list is empty (e.g. a root Location Type has no parent). */
    hideWhenEmpty?: boolean;
  };
  /**
   * For dependsOnMode "query": hide this field until every parent has a value,
   * and hide it when the filtered picker would be empty.
   *
   * Query mode deliberately omits an unset parent rather than blocking the
   * fetch, which is right for an optional filter but wrong for a hierarchy —
   * without this, Sub Category listed every category in the tenant while no
   * Category was chosen, and Category listed every one while no Item Type was.
   * A picker that cannot be filtered yet should not be offered at all.
   */
  requiresParent?: boolean;
  /**
   * Fill this field from another master instead of asking for it. The Item
   * Master Template describes the UOM Conversion Factor as "Auto-filled from
   * uom_conversion_master. 1 secondary = N primary", so a value that table
   * already holds should not be typed again — and the two can then never
   * disagree.
   *
   * `params` maps a field on this form to the query param that filters the
   * lookup. When every one has a value the endpoint is queried: a hit fills the
   * field and locks it, a miss leaves it editable so the value is captured here
   * for the first time.
   */
  derivedFrom?: { endpoint: string; params: Record<string, string>; valueKey: string; missingHelpText?: string };
  /**
   * Describes one entry of a `json` array field so it can be edited as rows of
   * real inputs — add, fill, delete — instead of asking someone to type valid
   * JSON into a textarea. Typing JSON by hand is how you get a trailing comma
   * and a rejected save with nothing useful to say about it.
   *
   * Each column may itself be a select-entity, so an entry that references
   * another master (an item attribute, a feed ingredient) is chosen rather
   * than pasted as a UUID — or a plain `select` with `options`, for a closed
   * set of values that is not a master at all (a vaccination's route, or what
   * its schedule counts from). Anything else renders as a text or number input.
   */
  jsonRow?: MasterDataField[];
  /**
   * Rows this list always carries. Every row from `endpoint` whose `flag`
   * column is true is present from the moment the form opens, keyed by `key`,
   * and cannot be removed or repointed — an item attribute marked Mandatory is
   * on every item in scope, so leaving it off is not one of the choices the
   * form should offer.
   *
   * The value is still typed per item; only the row's presence is fixed.
   */
  requiredRows?: { endpoint: string; flag: string; key: string };
  /**
   * Field exists purely to scope a sibling select-entity field's options (e.g. a helper
   * nob_id/lob_id pair on a form whose own table has no such column) — collected in the form
   * but excluded from the save payload.
   */
  filterOnly?: boolean;
  /** Excluded from the create/edit form (e.g. company_id, auto-injected) */
  hideInForm?: boolean;
  /** Visible for context but never editable or included in a save payload. */
  readOnly?: boolean;
  /** Excluded from the list table */
  hideInTable?: boolean;
  /** When this field stands in as a list column (config.columns is omitted):
   *  same meaning as columns[].decimals/decimalsFromKey below. */
  decimals?: number;
  decimalsFromKey?: string;
  /** Column width hint for number inputs supporting decimals */
  step?: number | string;
  /** Bounds for type "number". Mirror whatever the DTO enforces, so the form
   *  refuses a value the API would reject rather than round-tripping a 400. */
  min?: number;
  max?: number;
  /** Maximum length for text inputs */
  maxLength?: number;
  /**
   * Renders type "number" as a native <input type="number"> (spinner, browser
   * numeric validation) instead of the text-input-with-digit-filtering every
   * other number field uses. The text-input form exists to dodge two native
   * quirks — scientific notation on a very small/large value, and Chrome
   * silently discarding a keystroke that would exceed `max` mid-edit — which
   * only bite fields with a wide range or fractional step. A small bounded
   * integer like sequence digits never triggers either, so it can have the
   * native spinner back where that's what's wanted.
   */
  nativeNumber?: boolean;
  /**
   * Keys this switch clears when it is turned off, and the value to clear them
   * to. A form-only Yes/No that gates real columns: "Use a prefix" off must
   * actually blank the prefix, not merely hide it, or the code keeps carrying a
   * prefix nobody can see.
   */
  clearsWhenOff?: Record<string, string | number>;
  /** Seeds a form-only switch from a stored value: on when the value is truthy and not 0. */
  seedFromValueOf?: string;
  /**
   * For "field-list" and for a "select" over another master's fields: the key of
   * the sibling field naming that master (e.g. "series_code" on Number Series,
   * holding ITEM / BREED / LOCATION). The options are that master's own fields,
   * so the picker changes with the master rather than listing a fixed set.
   */
  fieldsOf?: string;
  /**
   * Render a `select` as a segmented group — every option's label visible at
   * once — rather than a dropdown. For a two-way choice the person filling the
   * form has to weigh (Lot vs Serial), a closed dropdown hides half the
   * question, and a plain on/off switch is worse still: "off" cannot say what
   * it means.
   */
  control?: "segmented";
  /**
   * Value this control starts on once it appears. A segmented choice between
   * two options has no meaningful empty state — "neither" is what the switch
   * above it already says — so it opens on one rather than on nothing.
   */
  defaultValue?: string;
  /**
   * Label that follows another field's value: Tracking No. Series reads "Lot
   * No. Series" or "Serial No. Series" depending on what the item is tracked
   * by, because the series it points at is one or the other, never both. Falls
   * back to `label` when the named field holds a value with no entry here.
   */
  labelWhen?: { key: string; labels: Record<string, string> };
  /**
   * Drop from this field's options any value already chosen in the listed
   * sibling fields. Primary and Secondary UOM must not be the same unit — a
   * conversion factor between a unit and itself says nothing.
   *
   * Compared against `entityValueKey`, which is what the form actually stores
   * (UOM stores `uom_code`, most other pickers store the row's UUID), never
   * against the label, which joins code and name for display only.
   */
  excludeValuesOf?: string[];
  /**
   * Greys an option out instead of letting it be chosen and then refused on
   * save. An option is unavailable when its `key` column already holds an
   * owner, except where that owner is this form's own `exceptMatchingField`
   * value — which means the option belongs to the record being edited and must
   * stay selectable, since giving it up is how it becomes free again. The
   * greyed row carries `reasonPrefix` followed by the option's `reasonKey`, so
   * it names who holds it rather than only saying no.
   *
   * A shed draws feed from exactly one silo: Attached Sheds lists every shed on
   * the farm, and the API rejects one another silo already feeds. Hiding those
   * rows would make the farm's layout unreadable and would strip a silo's own
   * sheds out of its edit form; showing them greyed answers "why not that one"
   * on the row, before anyone spends a save finding out.
   *
   * Honoured by the `multiple` entity lookup picker, which is the only control
   * that renders its options as rows with room to say why.
   */
  disableOptionWhen?: {
    /** Column on an option row naming its current owner, empty when unowned (e.g. "feed_silo_id"). */
    key: string;
    /** Field in this form whose value means the owner is this very record (e.g. the record's own id). */
    exceptMatchingField: string;
    /** Column on an option row holding the owner's display name, for the explanation (e.g. "feed_silo_name"). */
    reasonKey: string;
    /** Sentence the owner's name is appended to, trailing space included (e.g. "Attached to "). */
    reasonPrefix: string;
  };
  /**
   * A form-only control standing in for a set of boolean columns: the chosen
   * option's column is written `true` and every other one `false`. Set
   * `filterOnly` alongside it — the field's own key is not a column.
   *
   * TDD row 11 asks for one three-way choice (LOT, SERIAL, or neither) while
   * the table carries `is_lot_tracked` and `is_serial_tracked` as independent
   * flags that can both be ticked at once. This reconciles the two without a
   * migration: the form can only express the states the requirement allows,
   * and what gets written is the pair of columns the API already validates.
   *
   * While the control is hidden — its `visibleWhen` gate off — every column is
   * written `false`. Turning tracking off has to clear both flags, not leave
   * the last choice standing in the database.
   */
  booleanColumns?: Record<string, string>;
  /**
   * Seed a form-only boolean when editing: on when any of the listed columns on
   * the record is true. The "is this tracked at all?" gate has no column of its
   * own — it is precisely whether either tracking flag is set — so without this
   * an already-tracked item would open with the gate off and its own tracking
   * fields hidden.
   */
  seedFromAnyTrue?: string[];
  /**
   * For type "json" holding an array of objects: when the API's read shape has
   * more keys than its write shape accepts (e.g. a joined display field), list
   * the keys to keep when pre-filling the edit form so the round-tripped JSON
   * doesn't get rejected by a strict (forbidNonWhitelisted) update DTO.
   */
  jsonListKeys?: string[];
  /** Only sent on create — omit from the edit form/payload (e.g. the API's update endpoint doesn't accept this field). */
  createOnly?: boolean;
  /**
   * Only shown once editing — omit from the create form/payload (e.g. a value the service
   * computes on create, such as an animal's opening bio-asset value, that the API's create
   * endpoint doesn't accept but its update endpoint does).
   */
  editOnly?: boolean;
  /**
   * Key(s) of other field(s) in this form that must be left empty when this one is set (e.g.
   * a location's farm_id/shed_id/warehouse_id, where exactly one may be chosen) — setting this
   * field to a non-empty value clears each listed field, so the mutual-exclusivity the backend
   * enforces can't be violated from the form itself.
   */
  exclusiveWith?: string[];
  /** Card this field belongs to. Fields with no section land in the first card. */
  section?: string;
  /** Show this optional field in the compact inline lookup creator. */
  showInLookup?: boolean;
  /**
   * Renders a single (non-multiple) select-entity field as a searchable combobox — a text
   * filter over the option list — instead of a plain `<select>`. Set on fields whose catalog
   * realistically grows long enough that scrolling a native dropdown stops being usable (Item,
   * GL Account, Location, Animal, Batch, Breed, Goods Receipt); left off catalogs that stay
   * short by nature (NOB/LOB, UOM, Item Type, Costing Method, ...).
   */
  searchable?: boolean;
}

export interface MasterDataConfig {
  key: string;
  /** Plural — the list heading and sidebar entry, e.g. "Item Categories". */
  label: string;
  /**
   * Singular form for "Add X" / "Edit X", when `label` is not simply the
   * singular plus an `s` (or `y` → `ies`). English plurals that are their own
   * singular ("Number Series", "Species") and heads that are not the last word
   * ("Units of Measure") must declare it — otherwise `singularLabel()` guesses,
   * and guessing produced "Add Number Serie".
   */
  singular?: string;
  description?: string;
  apiBase: string;
  idKey: string;
  fields: MasterDataField[];
  /** Frontend-only BC references. Never part of creation/edit payloads. */
  bcFields?: { key: string; label: string }[];
  /** BC owns this catalog; local users may browse but cannot mutate it. */
  owner?: "BC";
  /**
   * What the blueprint says about this catalog's source, quoted. Rendered by
   * BcOwnershipNotice so each master cites its own section rather than one
   * hardcoded sentence about Items and the COA.
   */
  bcNote?: string;
  /** BBP business administrator mapped to Tenant/Company Admin by the user. */
  businessAdminOnly?: boolean;
  /**
   * Table columns; defaults to all non-hidden fields plus status if omitted.
   * `decimals`/`decimalsFromKey` are for a stored-precision numeric column
   * (e.g. `decimal(18,8)`) whose raw value is more precision than a list
   * should show. `decimals` is the fallback shown count; `decimalsFromKey`
   * names a sibling field on the same row (typically joined in by the
   * service, e.g. a linked UOM's own `decimal_places`) that overrides it when
   * present and greater than 0. Neither affects the form or the API payload —
   * display only.
   */
  columns?: { key: string; label: string; decimals?: number; decimalsFromKey?: string }[];
  group: string;
  /** Show a Nature of Business / Line of Business filter pair in the list toolbar (for entities whose table carries nob_id/lob_id). */
  supportsNobLobFilter?: boolean;
  /**
   * Whether `apiBase` exposes `PATCH /:id/restore` to un-block a soft-deleted row. Defaults to
   * true (the pattern nearly every master-data controller follows) — set false for the handful
   * that don't (e.g. Stage, Number Series, Animal Register, Breed Lifecycle Stages, UOM
   * Conversions), so the table doesn't offer a Restore action that would 404.
   */
  supportsRestore?: boolean;
  /** Whether the table row actions render a delete / deactivate trash button. Defaults to true. */
  supportsDelete?: boolean;
  /**
   * Opens a detail panel beside the list when a row is clicked, narrowing the
   * table to make room. Named rather than boolean because the panel's content
   * is master-specific — there is no generic "show everything" panel worth
   * having.
   */
  detailPanel?: "animal";
  /**
   * Which values of this master's own `status` column mean the record is still
   * in play. Used to colour the status chip: in-play reads as live, anything
   * else reads as spent.
   *
   * Animal Register's live values are the in-herd ones; CULLED / DEAD / SOLD /
   * SLAUGHTERED mean the animal has left, and are set only by Dispose.
   */
  statusActiveValues?: string[];
  /**
   * Shown in the master-data sub-sidebar. A master that is only a lookup for
   * another master (item category, UOM) is not primary — it is reached
   * through the card in its parent's dialog, not through its own nav entry.
   */
  isPrimary?: boolean;
  /** Primary master whose workbook contains this independently editable sheet. */
  tabOf?: string;
  /** Short label for this sheet in its master's tab bar. */
  tabLabel?: string;
  /**
   * Keys of the primary masters whose dialog renders this master as an
   * inline card. Order here is the order the cards appear.
   */
  lookupFor?: string[];
}
