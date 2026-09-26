import type { MasterDataConfig } from "./types";

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "ARCHIVE", label: "Archive" },
];

// ── Farm Operations ─────────────────────────────────────────────────────────



const locationType: MasterDataConfig = {
  key: "location-type",
  label: "Location Types",
  description: "Location classifications, hierarchy rules and prefixes for generated location codes.",
  apiBase: "/location-type",
  idKey: "location_type_id",
  group: "Farm Operations",
  lookupFor: ["location"],
  columns: [
    { key: "type_code", label: "Code" },
    { key: "type_name", label: "Name" },
    { key: "code_prefix", label: "Prefix" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this location type is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this location type is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "type_code", label: "Type Code", type: "text", required: true, placeholder: "FARM", createOnly: true, helpText: "The type's own identity code. Fixed after create — locations reference it by this code." },
    { key: "type_name", label: "Type Name", type: "text", required: true, placeholder: "Farm" },
    { key: "code_prefix", label: "Code Prefix", type: "text", required: true, placeholder: "FARM", helpText: "Future locations use PREFIX-001, PREFIX-002, and so on." },
    {
      key: "allowed_parent_types", label: "Allowed Parent Types", type: "select-entity", multiple: true,
      entityEndpoint: "/location-type", entityValueKey: "type_code", entityLabelKeys: ["type_code", "type_name"],
      excludeValuesOf: ["type_code"], showInLookup: true,
      helpText: "Leave empty for a level 1 root type. Otherwise choose the location type(s) allowed at the immediately preceding level.",
    },
  ],
};

const location: MasterDataConfig = {
  key: "location",
  label: "Locations",
  description: "One hierarchy for farms, sheds, pens, cages, stores, quarantine areas and silos.",
  apiBase: "/location",
  idKey: "location_id",
  group: "Farm Operations",
  isPrimary: true,
  columns: [
    { key: "location_code", label: "Code" },
    { key: "location_type", label: "Type" },
    { key: "location_name", label: "Name" },
    { key: "location_level", label: "Level" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this location is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this location is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "location_code", label: "Location Code", type: "text", readOnly: true, helpText: "Generated from the selected Location Type prefix and kept permanently.", section: "Identification" },
    {
      key: "location_type", label: "Location Type", type: "select-entity", required: true,
      entityEndpoint: "/location-type", entityValueKey: "type_code", entityLabelKeys: ["type_code", "type_name"], section: "Identification",
    },
    { key: "location_name", label: "Location Name", type: "text", required: true, maxLength: 100, placeholder: "Porta Farm", section: "Identification" },
    {
      key: "location_address", label: "Location Address", type: "text", maxLength: 255,
      visibleWhen: { anyOf: [{ key: "location_type", equals: "FARM" }] },
      requiredWhen: { anyOf: [{ key: "location_type", equals: "FARM" }] },
      helpText: "Stored on the Farm only. Child locations inherit their physical context from the Farm hierarchy.",
      section: "Identification",
    },
    {
      // Filtered by the API, not only here. The picker used to fetch "/location"
      // and narrow it in the browser — but the list is paged at 50 rows sorted by
      // code, which on the nine-farm data is 48 pens and 12 sheds, so choosing
      // SHED filtered 50 rows that held no Farm and offered nothing. parentForType
      // asks for exactly the allowed parent types, whatever the table's size.
      key: "parent_location_id", label: "Parent Location", type: "select-entity", required: true, searchable: true,
      entityEndpoint: "/location?parentForType={value}", entityValueKey: "location_id", entityLabelKeys: ["location_code", "location_name"],
      dependsOn: "location_type",
      restrictOptionsBy: {
        selectorKey: "location_type", selectorEntityEndpoint: "/location-type", selectorCodeKey: "type_code",
        allowListKey: "allowed_parent_types", optionCodeKey: "location_type", hideWhenEmpty: true,
      },
      helpText: "Only locations from the immediately preceding hierarchy level are available. Level 1 root types, such as Farm, have no Parent Location field.",
      section: "Identification",
    },
    { key: "location_level", label: "Hierarchy Level", type: "number", min: 0, hideInForm: true, helpText: "Computed from the parent location." },
    { key: "area_size", label: "Area Size", type: "number", min: 0, max: 999999.99, step: "0.01", section: "Identification" },
    { key: "area_unit", label: "Area UOM", type: "select-entity", entityEndpoint: "/uom?uomType=AREA", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"], section: "Identification" },
    // Hidden for SILO (2026-09-22, client request) — asking for a general Max
    // Capacity right next to Silo Capacity (KG) read as the same question
    // twice. Silo Capacity (KG) + Silo Reorder Days are what a silo's own
    // capacity/reorder logic actually uses; every other location type still
    // needs Max Capacity, which is what the child-fits-in-parent capacity
    // check validates against. notEquals rather than an enumerated equals
    // list, so a location type added later stays required by default instead
    // of silently inheriting the SILO exception.
    { key: "max_capacity", label: "Max Capacity", type: "number", min: 0, max: 9999999, step: "1", visibleWhen: { anyOf: [{ key: "location_type", notEquals: "SILO" }] }, requiredWhen: { anyOf: [{ key: "location_type", notEquals: "SILO" }] }, section: "Identification" },
    { key: "capacity_uom", label: "Capacity UOM", type: "select-entity", entityEndpoint: "/uom?uomType=COUNT", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"], visibleWhen: { anyOf: [{ key: "location_type", notEquals: "SILO" }] }, requiredWhen: { anyOf: [{ key: "location_type", notEquals: "SILO" }] }, section: "Identification" },
    // Hidden (2026-09-22, client request) — Storage Location duplicated
    // Location Type (STORE/SILO were already choices there); MasterDataTable's
    // setField now derives this straight from location_type instead. Kept in
    // fields[], not deleted, so editing an existing record still loads its
    // stored value and the payload-building loop below still sends it.
    { key: "storage_type", label: "Storage Location", type: "select", hideInForm: true, options: ["STORE", "SILO"].map((v) => ({ value: v, label: v })), section: "Identification" },
    { key: "silo_capacity_kg", label: "Silo Capacity (KG)", type: "number", min: 0, max: 999999.99, step: "0.01", visibleWhen: { anyOf: [{ key: "storage_type", equals: "SILO" }] }, requiredWhen: { anyOf: [{ key: "storage_type", equals: "SILO" }] }, helpText: "Required when Storage Location is SILO.", section: "Identification" },
    { key: "silo_reorder_days", label: "Silo Reorder Days", type: "number", min: 0, max: 365, step: "1", visibleWhen: { anyOf: [{ key: "storage_type", equals: "SILO" }] }, requiredWhen: { anyOf: [{ key: "storage_type", equals: "SILO" }] }, helpText: "Required when Storage Location is SILO.", section: "Identification" },
    { key: "downtime_days_required", label: "Downtime Days Required", type: "number", min: 0, max: 365, step: "1", helpText: "Empty days required between batches for biosecurity.", section: "Identification" },
    // The silo or store's own name-number. storage_type says which kind of
    // store this is; this says which one — MULTIPLIER writes MGH1 against each
    // grower house, Porta writes PSL FS - 01 and STORE.
    { key: "storage_name", label: "Silo / Store Name", type: "text", maxLength: 100, placeholder: "MGH1", visibleWhen: { anyOf: [{ key: "storage_type", equals: ["STORE", "SILO"] }] }, helpText: "The name or number this silo or store is known by on the farm.", section: "Identification" },
    { key: "gps_latitude", label: "Latitude", type: "number", min: -90, max: 90, step: "0.00000001", placeholder: "-17.82722000", visibleWhen: { anyOf: [{ key: "location_type", equals: "FARM" }] }, helpText: "GPS latitude in decimal degrees, e.g. -17.82722000. Applies to Farm only.", section: "Identification" },
    { key: "gps_longitude", label: "Longitude", type: "number", min: -180, max: 180, step: "0.00000001", placeholder: "30.99755000", visibleWhen: { anyOf: [{ key: "location_type", equals: "FARM" }] }, helpText: "GPS longitude in decimal degrees, e.g. 30.99755000. Applies to Farm only.", section: "Identification" },
  ],
};


// ── Production ───────────────────────────────────────────────────────────────

const stage: MasterDataConfig = {
  key: "stage",
  label: "Stages",
  description: "Production lifecycle stages per NOB/LOB (e.g. piggery: Quarantine → Gilt Grower → ... → Disposed) — sequencing and transition rules for batches.",
  apiBase: "/stage",
  idKey: "stage_id",
  group: "Production",
  isPrimary: true,
  supportsNobLobFilter: true,
  columns: [
    { key: "stage_sequence", label: "Display Order" },
    { key: "stage_code", label: "Code" },
    { key: "stage_name", label: "Name" },
    { key: "stage_category", label: "Category" },
    { key: "transition_trigger", label: "Trigger" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", required: true, entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], section: "Identification" },
    { key: "lob_id", label: "Line of Business", type: "select-entity", required: true, entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", section: "Identification" },
    { key: "stage_code", label: "Stage Code", type: "text", required: true, createOnly: true, helpText: "Leave blank to derive from the stage name via the number series. After create, the code follows the series when the name changes — refused while a batch or log still uses the old code.", placeholder: "QUARANTINE", section: "Identification" },
    { key: "stage_name", label: "Stage Name", type: "text", required: true, placeholder: "Quarantine", section: "Identification" },
    {
      key: "stage_category", label: "Category", type: "select", required: true, section: "Identification",
      options: ["PRE_PRODUCTIVE", "PRODUCTIVE", "OUTPUT", "DISPOSAL"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    { key: "stage_sequence", label: "Display Order", type: "number", min: 1, max: 999, maxLength: 3, required: true, helpText: "Must be unique per Line of Business (max 3 digits).", section: "Identification" },
    { key: "stage_description", label: "Description", type: "text", maxLength: 50, section: "Identification" },
    { key: "typical_duration_days", label: "Duration (days)", type: "number", min: 0, max: 999, maxLength: 3, section: "Duration" },
    { key: "min_days_before_move", label: "Min Days Before Move", type: "number", min: 0, max: 999, maxLength: 3, helpText: "Minimum days in this stage before a transition is allowed.", section: "Duration" },
    {
      // EVENT_BASED added 2026-09-21, client review — the schema column
      // comment already named it; nothing wired it until now. This records
      // intent only: no transition engine evaluates an event and acts on
      // alt_next_stage_id yet, so selecting it here does not by itself move a
      // batch or animal automatically. KPI_BASED was removed (2026-09-22) —
      // never wired to anything and not offered as a choice.
      key: "transition_trigger", label: "Transition Trigger", type: "select", required: true, section: "Transitions",
      options: ["AUTO_BY_DAY", "MANUAL", "EVENT_BASED"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    // Moved into Transitions (2026-09-21) — it only ever shows once Transition
    // Trigger above is set to Auto By Day, so it belongs beside the control
    // that reveals it, not back in Duration where filling it in meant
    // switching tabs.
    {
      key: "auto_move_on_day", label: "Auto-Move On Day", type: "number", min: 1, max: 999, maxLength: 3, section: "Transitions",
      helpText: "Required when Transition Trigger is Auto By Day.",
      visibleWhen: { anyOf: [{ key: "transition_trigger", equals: "AUTO_BY_DAY" }] },
      requiredWhen: { anyOf: [{ key: "transition_trigger", equals: "AUTO_BY_DAY" }] },
    },
    {
      key: "next_stage_id", label: "Next Stage", type: "select-entity", entityEndpoint: "/stage", entityValueKey: "stage_id", entityLabelKeys: ["stage_code", "stage_name"], section: "Transitions",
      helpText: "Leave blank for a terminal stage. Applicable only when Transition Trigger is Auto By Day.",
      visibleWhen: { anyOf: [{ key: "transition_trigger", equals: "AUTO_BY_DAY" }] },
    },
    {
      key: "alt_next_stage_id", label: "Alternate Next Stage", type: "select-entity", entityEndpoint: "/stage", entityValueKey: "stage_id", entityLabelKeys: ["stage_code", "stage_name"], section: "Transitions",
      visibleWhen: { anyOf: [{ key: "transition_trigger", equals: "EVENT_BASED" }] },
      requiredWhen: { anyOf: [{ key: "transition_trigger", equals: "EVENT_BASED" }] },
    },
    {
      key: "alt_trigger_condition", label: "Alternate Trigger Condition", type: "select", section: "Transitions",
      options: ["PREGNANCY_FAILED", "WEIGHT_NOT_ACHIEVED", "PARITY_LIMIT_REACHED"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
      visibleWhen: { anyOf: [{ key: "transition_trigger", equals: "EVENT_BASED" }] },
      requiredWhen: { anyOf: [{ key: "transition_trigger", equals: "EVENT_BASED" }] },
    },
    // Data Entry tab removed (2026-09-22, client request) — these three kept
    // their section value (harmless once nothing renders it) but are hidden
    // from the form entirely, which is what drops the tab: a tab only shows
    // up when a visible field claims its section. hideInForm, not deleted —
    // the columns and any values a record already has are untouched.
    {
      key: "data_entry_form", label: "Data Entry Form", type: "select", section: "Data Entry", hideInForm: true,
      options: ["STANDARD", "FARROWING", "WEANING", "SLAUGHTER"].map((v) => ({ value: v, label: v })),
    },
    { key: "scheduler_auto_create", label: "Auto-Create Scheduler", type: "boolean", section: "Identification" },
    { key: "show_on_animal_card", label: "Show on Animal Card", type: "boolean", section: "Data Entry", hideInForm: true },
    { key: "required_kpi_to_pass", label: "Required KPI to Pass", type: "json", section: "Data Entry", hideInForm: true, helpText: 'KPI checks validated before a stage transition, e.g. [{"metric":"BODY_WEIGHT","min_value":100}]. A failure warns; a farmer may override with approval.' },
  ],
};

const numberSeries: MasterDataConfig = {
  key: "number-series",
  label: "Number Series",
  singular: "Number Series",
  description: "Sequential business number generators for all master entities.",
  apiBase: "/no-series",
  idKey: "id",
  group: "Production",
  isPrimary: true,
  supportsNobLobFilter: false,
  supportsRestore: true,
  supportsDelete: false,
  columns: [
    { key: "code", label: "Code" },
    { key: "document_type", label: "Applies To" },
    { key: "description", label: "Description" },
    { key: "no_series_code", label: "Prefix / Pattern" },
    { key: "seq_length", label: "Digits" },
    { key: "last_no_used", label: "Last No. Used" },
    { key: "manual_nos", label: "Allow Manual" },
  ],
  // "Blocked" is this master's own Active/Inactive fact — surfaced through the
  // generic table's toggle switch (is_active, computed server-side as
  // !blocked) like every other master, not repeated as its own data column.
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "code", label: "Series Code", type: "text", required: true, createOnly: true, maxLength: 20, placeholder: "NS-SUP", helpText: "Unique identifier for this number series (max 20 characters)." },
    {
      key: "document_type",
      label: "Applies To (Master)",
      type: "select",
      required: true,
      options: [
        { value: "ITEM", label: "Item" },
        { value: "SUPPLIER", label: "Supplier" },
        { value: "CUSTOMER", label: "Customer" },
        { value: "LOCATION", label: "Location" },
        { value: "LOCATION_TYPE", label: "Location Type" },
        { value: "ANIMAL", label: "Animal" },
        { value: "SPECIES", label: "Species" },
        { value: "BREED", label: "Breed" },
        { value: "BREED_LIFECYCLE_STAGE", label: "Breed Lifecycle Stage" },
        { value: "FEED_FORMULA", label: "Feed Formula" },
        { value: "DISEASE", label: "Disease" },
        { value: "REASON", label: "Reason" },
        { value: "RESOURCE", label: "Resource" },
        { value: "STAGE", label: "Stage" },
        { value: "UOM", label: "Unit of Measure" },
        { value: "UOM_CONVERSION", label: "UOM Conversion" },
        { value: "ITEM_CATEGORY", label: "Item Category" },
        { value: "ITEM_TYPE", label: "Item Type" },
        { value: "ITEM_ATTRIBUTE", label: "Item Attribute" },
        { value: "GL_ACCOUNT", label: "GL Account" },
        { value: "GL_MAPPING", label: "GL Mapping" },
        { value: "COST_CENTER", label: "Cost Center" },
        { value: "BATCH", label: "Batch" },
        { value: "LOT", label: "Lot" },
        { value: "SERIAL", label: "Serial" },
      ],
      helpText: "Select which master entity this number sequence generates codes for.",
    },
    { key: "description", label: "Description", type: "text", maxLength: 50, placeholder: "Vendor Supplier Series", helpText: "Human readable label (max 50 characters)." },
    { key: "no_series_code", label: "Prefix / Code Pattern", type: "text", required: true, maxLength: 20, placeholder: "SUP-", helpText: "Prefix pattern (max 20 characters, e.g. SUP- with 3 digits generates SUP-001)." },
    { key: "seq_length", label: "Digits (Sequence Length)", type: "number", nativeNumber: true, defaultValue: "4", min: 1, max: 10, step: "1", required: true, helpText: "Length of digits for zero-padding (1 to 10 digits, e.g. 3 for -001, 4 for -0001)." },
    { key: "increment_by", label: "Increment By", type: "number", defaultValue: "1", min: 1, max: 100, step: "1", required: true, helpText: "How much to add on each generation (between 1 and 100)." },
    { key: "is_default", label: "Is Default for this Master", type: "boolean", defaultValue: "true", helpText: "If checked, forms for this master will use this number series by default." },
    { key: "manual_nos", label: "Allow Manual Numbers", type: "boolean", helpText: "If checked, users can overwrite the generated number on the form." },
    { key: "blocked", label: "Blocked", type: "boolean", helpText: "If checked, this series cannot be used to generate numbers." },
  ],
};

const activity: MasterDataConfig = {
  key: "activity",
  label: "Activity",
  description: "Standard activities catalog (feed, vaccines, weigh, tasks) used across schedulers and daily data entry.",
  apiBase: "/activity",
  idKey: "activity_id",
  group: "Production",
  isPrimary: true,
  supportsNobLobFilter: true,
  supportsRestore: true,
  columns: [
    { key: "activity_code", label: "Code" },
    { key: "activity_name", label: "Name" },
    { key: "line_type", label: "Activity Type" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "activity_code", label: "Activity Code", type: "text", required: true, placeholder: "e.g. MORN_FEED", createOnly: true, helpText: "Short unique uppercase code (e.g. MORN_FEED) for lookups and reporting." },
    { key: "activity_name", label: "Activity Name", type: "text", required: true, placeholder: "e.g. Morning Feed" },
    {
      key: "line_type", label: "Activity Type", type: "select", required: true,
      options: [
        { value: "CONSUMPTION", label: "CONSUMPTION" },
        { value: "OUTPUT", label: "OUTPUT" },
        { value: "DESCRIPTIVE", label: "DESCRIPTIVE" },
        { value: "OVERHEAD", label: "OVERHEAD" },
        { value: "RESOURCE", label: "RESOURCE" },
        { value: "TRANSFER", label: "TRANSFER" },
      ],
    },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this activity is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this activity is shared across all LOBs under the selected NOB." },
    { key: "description", label: "Description", type: "text", maxLength: 50, placeholder: "Optional notes or instructions for this activity" },
  ],
};

// ── Piggery ──────────────────────────────────────────────────────────────────

const animal: MasterDataConfig = {
  bcFields: [
    { key: "bc_fixed_asset_no", label: "Fixed Asset No." },
    { key: "bc_converted_to_inventory_date", label: "Converted to Inventory Date" },
    { key: "bc_bio_asset_value", label: "Bio Asset Value (Non-current Asset)" },
  ],
  key: "animal",
  label: "Animal Register",
  description: "Individual animal lifetime identity — lineage, entry, cost, current stage/location. Never physically deleted; use Dispose to record sale/slaughter/death.",
  apiBase: "/animal",
  idKey: "animal_id",
  group: "Piggery",
  isPrimary: true,
  supportsRestore: false,
  supportsDelete: false,
  detailPanel: "animal",
  // The in-herd statuses. CULLED / DEAD / SOLD / SLAUGHTERED mean the animal
  // has left; Dispose sets those, after checking medicine withdrawal periods
  // and posting the gain or loss on disposal, and the API now rejects them on
  // the plain update path.
  statusActiveValues: ["ACTIVE", "QUARANTINE", "SICK", "PREGNANT", "LACTATING", "DRY"],
  columns: [
    { key: "animal_code", label: "Code" },
    { key: "animal_type", label: "Type" },
    { key: "gender", label: "Gender" },
    { key: "status", label: "Status" },
  ],
  fields: [
    { key: "animal_code", label: "Animal Code", type: "text", required: true, createOnly: true, section: "Identification" },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", required: true, createOnly: true, entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], section: "Identification" },
    { key: "lob_id", label: "Line of Business", type: "select-entity", required: true, createOnly: true, entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", section: "Identification" },
    {
      key: "animal_type", label: "Animal Type", type: "select", required: true, createOnly: true, section: "Identification",
      options: ["SOW", "BOAR", "GILT", "PIGLET", "COMMERCIAL_PIG"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    // A Breed profile is per-farm, so the farm is what tells two otherwise
    // identical breed rows apart — which is why the option shows the breed and
    // the farm it belongs to. The code said nothing the name does not, and four
    // columns of code, name, farm code and farm name read as one run-on line.
    {
      key: "breed_id", label: "Breed", type: "select-entity", required: true, searchable: true,
      entityEndpoint: "/breed", entityValueKey: "breed_id", entityLabelKeys: ["breed_name", "location_name"],
      section: "Identification",
    },
    {
      key: "gender", label: "Gender", type: "select", required: true, createOnly: true, section: "Identification",
      options: [{ value: "F", label: "Female" }, { value: "M", label: "Male" }],
    },
    { key: "dob", label: "Date of Birth", type: "date", helpText: "Leave blank if born on this farm and unknown, or imported/unknown.", section: "Identification" },
    { key: "serial_number", label: "Serial Number", type: "text", maxLength: 50, helpText: "Asset tag from item_lot_serials, distinct from RFID/ear tag.", section: "Identification" },
    { key: "rfid_tag", label: "RFID Tag", type: "text", helpText: "Unique if set.", section: "Identification" },
    { key: "ear_tag", label: "Ear Tag Number", type: "text", section: "Identification" },
    { key: "ear_tag_image_url", label: "Ear Tag Image URL", type: "text", placeholder: "https://cdn.navfarm.io/ear-tags/...", helpText: "Paste an image URL for now; direct file upload to Cloudflare R2 is planned for later.", section: "Identification" },
    { key: "sire_animal_id", label: "Sire (Father)", type: "select-entity", searchable: true, entityEndpoint: "/animal", entityValueKey: "animal_id", entityLabelKeys: ["animal_code"], section: "Lineage" },
    { key: "dam_animal_id", label: "Dam (Mother)", type: "select-entity", searchable: true, entityEndpoint: "/animal", entityValueKey: "animal_id", entityLabelKeys: ["animal_code"], section: "Lineage" },
    {
      key: "entry_type", label: "Entry Type", type: "select", required: true, createOnly: true, section: "Acquisition",
      options: ["PURCHASED_IMPORTED", "PURCHASED_LOCAL", "BORN_ON_FARM", "TRANSFERRED_IN"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    { key: "entry_date", label: "Entry Date", type: "date", required: true, createOnly: true, section: "Acquisition" },
    // Sits with Entry Date rather than beside Date of Birth (where the master
    // template puts it) because it is the entry that gives it meaning, and the
    // two dates it is computed from are the ones either side of it here.
    // readOnly: the API computes it on every write and discards anything sent
    // alongside a DOB, so an editable box would take input it then throws away.
    { key: "age_at_entry_weeks", label: "Age at Entry (Weeks)", type: "number", min: 0, readOnly: true, helpText: "Computed from Date of Birth and Entry Date.", section: "Acquisition" },
    // Shown only for the entry types they belong to. The API has always
    // enforced these as COND rules and rejected the wrong combination; the form
    // asked for both from everyone, so a born-on-farm piglet was offered a
    // goods receipt it could never legally carry.
    { key: "source_receipt_id", searchable: true, label: "Source Goods Receipt", type: "select-entity", createOnly: true, entityEndpoint: "/goods-receipt", entityValueKey: "receipt_id", entityLabelKeys: ["receipt_no"], visibleWhen: { anyOf: [{ key: "entry_type", equals: ["PURCHASED_IMPORTED", "PURCHASED_LOCAL"] }] }, requiredWhen: { anyOf: [{ key: "entry_type", equals: ["PURCHASED_IMPORTED", "PURCHASED_LOCAL"] }] }, helpText: "The receipt this animal arrived on.", section: "Acquisition" },
    { key: "source_batch_id", searchable: true, label: "Source Batch", type: "select-entity", createOnly: true, entityEndpoint: "/batch", entityValueKey: "batch_id", entityLabelKeys: ["batch_no"], visibleWhen: { anyOf: [{ key: "entry_type", equals: "BORN_ON_FARM" }] }, requiredWhen: { anyOf: [{ key: "entry_type", equals: "BORN_ON_FARM" }] }, helpText: "The farrowing batch this animal was born from.", section: "Acquisition" },
    // LIVESTOCK is the item type seeded for living biological assets. There is
    // no LIVING_ASSET item type; using it here left this required picker empty.
    { key: "item_id", searchable: true, label: "Item (Living Asset)", type: "select-entity", required: true, createOnly: true, entityEndpoint: "/item?itemType=LIVESTOCK", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"], section: "Acquisition" },
    // Two fields, one column. A purchased animal's cost is read off its goods
    // receipt by the API and anything typed here is discarded, so offering an
    // editable box for it would take input it then throws away. Everything else
    // has no document behind it and is entered by hand.
    // max mirrors the DTO's @Max — animal_register.acquisition_cost/landing_cost
    // are decimal(18,4) (schema.ts); this is that column's own ceiling, not a
    // client-specified business limit.
    { key: "acquisition_cost", label: "Acquisition Cost", type: "number", step: "0.01", min: 0, max: 99999999999999, readOnly: true, createOnly: true, visibleWhen: { anyOf: [{ key: "entry_type", equals: ["PURCHASED_IMPORTED", "PURCHASED_LOCAL"] }] }, helpText: "Taken from the rate on the source goods receipt.", section: "Acquisition" },
    { key: "acquisition_cost", label: "Acquisition Cost", type: "number", step: "0.01", min: 0, max: 99999999999999, createOnly: true, requiredWhen: { anyOf: [{ key: "entry_type", equals: ["BORN_ON_FARM", "TRANSFERRED_IN"] }] }, visibleWhen: { anyOf: [{ key: "entry_type", equals: ["BORN_ON_FARM", "TRANSFERRED_IN"] }] }, section: "Acquisition" },
    { key: "landing_cost", label: "Landing Cost", type: "number", step: "0.01", min: 0, max: 99999999999999, createOnly: true, helpText: "Transport/import duty/quarantine charges for imported animals.", section: "Acquisition" },
    // Acquisition Cost + Landing Cost, computed by the service on save. Shown
    // rather than hidden because it is the figure the opening bio-asset value
    // and the whole amortisation schedule are built from, so it belongs where
    // the two numbers that make it are. Read-only: the service recomputes it
    // from those two on every write, so an entered figure would be overwritten.
    { key: "total_opening_asset_value", label: "Total Opening Asset Value", type: "number", step: "0.01", min: 0, readOnly: true, createOnly: true, helpText: "Acquisition Cost + Landing Cost. Calculated on save.", section: "Acquisition" },
    // Bio-Asset shows for males too (Rishi, 2026-09-15, reversing the
    // female-only call of 2026-09-08). Book value, amortisation and residual
    // value are IAS 41 figures that apply to any biological asset — a boar
    // included — and dispose() computes his gain or loss against book_value.
    // No. of Teats stays female-only: it is a gilt-selection measure (BBP §6).
    // Parity and litter totals below stay female-only as well; they count a
    // sow's farrowings.
    { key: "current_bio_asset_value", label: "Current Bio-Asset Value", type: "number", step: "0.01", min: 0, editOnly: true, helpText: "Set from acquisition cost at creation; adjust here afterward. Reconciles with D365BC: each animal is a Child Fixed Asset there, and BC posts acquisition and returns the FA Ledger Entry reference (Bio Asset BBP). No BC connector yet \u2014 this is a local figure.", section: "Bio-Asset" },
    { key: "book_value", label: "Book Value NBV", type: "number", step: "0.01", min: 0, editOnly: true, helpText: "Reconciles with D365BC: each animal is a Child Fixed Asset there, and BC posts acquisition and returns the FA Ledger Entry reference (Bio Asset BBP). No BC connector yet \u2014 this is a local figure.", section: "Bio-Asset" },
    { key: "total_amortised", label: "Total Amortised", type: "number", step: "0.01", min: 0, editOnly: true, section: "Bio-Asset" },
    { key: "amortisation_monthly", label: "Monthly Amortisation", type: "number", step: "0.01", min: 0, editOnly: true, section: "Bio-Asset" },
    { key: "residual_value", label: "Residual Value", type: "number", step: "0.01", min: 0, editOnly: true, section: "Bio-Asset" },
    { key: "disposal_date", label: "Disposal Date", type: "date", hideInForm: true, helpText: "Set via the Dispose action, not direct edit.", section: "Bio-Asset" },
    { key: "disposal_type", label: "Disposal Type", type: "text", hideInForm: true, helpText: "Set via the Dispose action, not direct edit.", section: "Bio-Asset" },
    { key: "no_of_teats", label: "No. of Teats", type: "number", min: 0, max: 99, helpText: "BBP §6: below 15 blocks this gilt from selection regardless of TSI score.", visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, requiredWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "tsi", label: "TSI", type: "number", step: "0.01", min: 0, max: 999, helpText: "Total Sow Index score.", section: "Bio-Asset" },
    {
      key: "grading", label: "Grading", type: "select", section: "Bio-Asset",
      options: [{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }],
    },
    { key: "current_stage_id", label: "Current Stage", type: "select-entity", createOnly: true, entityEndpoint: "/stage", entityValueKey: "stage_id", entityLabelKeys: ["stage_code", "stage_name"], section: "Current Position" },
    { key: "current_batch_id", label: "Current Batch", type: "select-entity", searchable: true, createOnly: true, entityEndpoint: "/batch", entityValueKey: "batch_id", entityLabelKeys: ["batch_no"], helpText: "Choose where this animal is: a batch or a pen location on your farm.", section: "Current Position" },
    { key: "current_location_id", label: "Current Pen", type: "select-entity", searchable: true, createOnly: true, entityEndpoint: "/location?locationType=PEN", entityValueKey: "location_id", entityLabelKeys: ["location_code", "location_name"], helpText: "Animals are placed in Pens only. Choose where this animal is: a batch or a pen location.", section: "Current Position" },
    {
      key: "status", label: "Status", type: "select", section: "Current Position",
      // The four disposal statuses are absent on purpose: the API refuses them
      // here, because they are what Dispose records. Offering an option that
      // can only ever fail is worse than not offering it.
      options: ["ACTIVE", "QUARANTINE", "SICK", "PREGNANT", "LACTATING", "DRY"].map((v) => ({ value: v, label: v })),
      helpText: "Sold, slaughtered, died or culled are recorded through Dispose, not here.",
    },
    // editOnly, not because they are uninteresting at registration but because
    // CreateAnimalDto does not accept them and the API runs
    // forbidNonWhitelisted — sending them on create would 400 the whole form.
    // A sow transferred in with a parity history gets it on the first edit.
    { key: "parity_count", label: "Parity Count", type: "number", min: 0, editOnly: true, visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, helpText: "Completed pregnancies, incremented on weaning. Rolled up from farrowing records, so a manual figure is replaced at the next weaning.", section: "Bio-Asset" },
    { key: "total_piglets_born_live", label: "Total Piglets Born Live", type: "number", min: 0, editOnly: true, visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "total_piglets_weaned", label: "Total Piglets Weaned", type: "number", min: 0, editOnly: true, visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "productive_life_start", label: "Productive Life Start", type: "date", section: "Production" },
    { key: "expected_cull_date", label: "Expected Cull Date", type: "date", section: "Production" },
    { key: "notes", label: "Notes", type: "textarea", section: "Production" },
  ],
};

// ── Inventory ────────────────────────────────────────────────────────────────

const itemCategory: MasterDataConfig = {
  key: "item-category",
  label: "Item Categories",
  description: "Hierarchical classification for inventory items.",
  apiBase: "/item-category",
  idKey: "category_id",
  group: "Inventory",
  lookupFor: ["item"],
  columns: [
    { key: "category_code", label: "Code" },
    { key: "category_name", label: "Name" },
    { key: "item_type", label: "Item Type" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this category is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this category is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "category_code", label: "Category Code", type: "text", required: true, createOnly: true, helpText: "Leave blank to derive from the category name via the number series. After create, the code follows the series when the name changes.", placeholder: "FEED" },
    { key: "category_name", label: "Category Name", type: "text", required: true, placeholder: "Animal Feed Products" },
    {
      key: "item_type", label: "Item Type", type: "select-entity", entityEndpoint: "/item-type", entityValueKey: "type_code", entityLabelKeys: ["type_code", "type_name"],
      helpText: "Assigns this category to an Item Type so it shows up in the Item form's Category picker once that type is chosen. Leave blank for a category not yet classified.",
    },
    { key: "parent_category_id", label: "Parent Category", type: "select-entity", entityEndpoint: "/item-category", entityValueKey: "category_id", entityLabelKeys: ["category_code", "category_name"] },
  ],
};

const itemType: MasterDataConfig = {
  key: "item-type",
  label: "Item Types",
  description: "Item type classification (RAW_MATERIAL, CONSUMABLE, MEDICINE, ...) used by the Items master.",
  apiBase: "/item-type",
  idKey: "item_type_id",
  group: "Inventory",
  lookupFor: ["item"],
  columns: [
    { key: "type_code", label: "Code" },
    { key: "type_name", label: "Name" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this item type is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this item type is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    // createOnly: the code follows the ITEM_TYPE series after create — renaming
    // the type name recomposes it, refused while an item still carries the old
    // code. The field is create-only because UpdateItemTypeDto has no type_code,
    // and the global pipe's forbidNonWhitelisted would 400 the whole edit if the
    // form kept resending it.
    { key: "type_code", label: "Type Code", type: "text", required: true, placeholder: "RAW_MATERIAL", createOnly: true, helpText: "Leave blank to derive from the type name via the number series. After create, the code follows the series when the name changes — refused while an item still uses the old code." },
    { key: "type_name", label: "Type Name", type: "text", required: true, placeholder: "Raw Material" },
    { key: "description", label: "Description", type: "textarea" },
  ],
};

const uom: MasterDataConfig = {
  key: "uom",
  label: "Units of Measure",
  singular: "Unit of Measure",
  description: "Measurement units used across items and transactions.",
  apiBase: "/uom",
  idKey: "uom_id",
  group: "Inventory",
  isPrimary: true,
  lookupFor: ["item", "location", "resource"],
  columns: [
    { key: "uom_code", label: "Code" },
    { key: "uom_name", label: "Name" },
    { key: "uom_type", label: "Type" },
    { key: "is_base_uom", label: "Base Unit" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this unit is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this unit is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company (blank = global)", type: "text", hideInForm: true },
    { key: "uom_code", label: "UOM Code", type: "text", required: true, createOnly: true, helpText: "Leave blank to derive from the unit name via the number series — or type a standard symbol such as KG, which then stays fixed. After create, a series-derived code follows the series when the name changes.", placeholder: "KG" },
    { key: "uom_name", label: "UOM Name", type: "text", required: true, placeholder: "Kilogram", helpText: "Name of the unit (e.g. Kilogram, Litre)." },
    {
      key: "uom_type", label: "UOM Type", type: "select", required: true,
      options: ["WEIGHT", "VOLUME", "COUNT", "AREA", "TIME", "OTHER"].map((v) => ({ value: v, label: v })),
      helpText: "Select unit type: WEIGHT, VOLUME, COUNT, AREA, TIME, or OTHER.",
    },
    { key: "decimal_places", label: "Decimal Places", type: "number", min: 0 },
    { key: "is_base_uom", label: "Is Base Unit", type: "boolean" },
  ],
};

/**
 * Conversion factors are not decoration: batch data entry prices a line through
 * them (see standardRate() in batch.service.ts), so a missing or wrong factor
 * silently mis-prices consumption — medicine was being costed per vial as if it
 * were per ml until a VIAL→ML factor of 100 was added. Until now the five API
 * endpoints behind this had no screen at all.
 */
const uomConversion: MasterDataConfig = {
  key: "uom-conversion",
  label: "UOM Conversions",
  description: "Multiplier factors between units — From × Factor = To. Used to price data entry.",
  apiBase: "/uom/conversion",
  idKey: "conversion_id",
  group: "Inventory",
  tabOf: "uom",
  tabLabel: "UOM Conversions",
  supportsRestore: false,
  columns: [
    { key: "conversion_code", label: "Code" },
    { key: "from_uom", label: "From" },
    { key: "to_uom", label: "To" },
    // Column is decimal(18,8) — shows 2 places by default, or the To UOM's
    // own Decimal Places setting when one is configured (uom.service.ts joins
    // it in as to_uom_decimal_places). Display only; the stored value and the
    // form keep full precision.
    { key: "conversion_factor", label: "Factor", decimals: 2, decimalsFromKey: "to_uom_decimal_places" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this conversion is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this conversion is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company (blank = global)", type: "text", hideInForm: true },
    { key: "conversion_code", label: "Conversion Code", type: "text", placeholder: "CONV-001" },
    // The four fields below are the whole of the client's "UOM Conversion" sheet
    // (Unit Of Measure.xlsx). Their wording is the sheet's own, not a paraphrase.
    {
      key: "item_id", label: "Item", type: "select-entity", searchable: true,
      entityEndpoint: "/item", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"],
      helpText: "Leave blank for a factor that applies to every item using these units.",
    },
    // Both of these store a UOM *code* (the rows hold GRAM, KG, TONNE), which is
    // why the value key is uom_code and not uom_id. They were free-text boxes:
    // nothing stopped you typing a unit that does not exist, and the placeholders
    // invented a VIAL→ML example the client never wrote.
    {
      key: "from_uom", label: "From UOM", type: "select-entity", required: true,
      entityEndpoint: "/uom", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"],
      helpText: "Entry or purchase UOM.",
    },
    {
      key: "to_uom", label: "To UOM", type: "select-entity", required: true,
      entityEndpoint: "/uom", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"],
      helpText: "Base UOM. A factor always converts TO the base unit.",
    },
    {
      key: "conversion_factor", label: "Conversion Factor", type: "number", step: "0.01", min: 0, required: true,
      placeholder: "50",
      helpText: "Multiply the From quantity to get the base quantity. 1 BAG = 50 KG, so the factor is 50.",
    },
  ],
};

const itemAttribute: MasterDataConfig = {
  key: "item-attribute",
  label: "Item Attributes",
  description: "Custom item attributes (e.g. Protein %, Colour) available to select when editing an item.",
  apiBase: "/item-attribute",
  idKey: "attribute_id",
  group: "Inventory",
  supportsNobLobFilter: true,
  tabOf: "item",
  tabLabel: "Item Attributes",
  columns: [
    { key: "attribute_code", label: "Code" },
    { key: "attribute_name", label: "Name" },
    // uom_code/uom_name come from item-attribute.service.ts's findAll join —
    // uom_id itself is a UUID and would render raw if used here directly.
    { key: "uom_code", label: "UOM" },
    { key: "default_value", label: "Value" },
  ],
  fields: [
    { key: "company_id", label: "Company (blank = global)", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank to make this attribute available across all NOBs." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank to make this attribute available across all LOBs under the selected NOB." },
    { key: "attribute_code", label: "Attribute Code", type: "text", required: true, createOnly: true, maxLength: 255, helpText: "Leave blank to derive from the attribute name via the number series. After create, the code follows the series when the name changes.", placeholder: "PROTEIN_PCT" },
    { key: "attribute_name", label: "Attribute Name", type: "text", required: true, maxLength: 100, placeholder: "Protein %" },
    // Client review, 2026-09-21: replaces Data Type + Unit on the form. This
    // reverses the 2026-09-08 call below (TDD row 132's "(UOM master)")
    // against reusing uom_master here, on the client's own instruction — if
    // "PCT" or similar needs to exist for an attribute, it now goes into UOM
    // Master like any other unit, the same picker Primary/Output UOM use.
    {
      key: "uom_id", label: "UOM", type: "select-entity", searchable: true,
      entityEndpoint: "/uom", entityValueKey: "uom_id", entityLabelKeys: ["uom_code", "uom_name"],
      helpText: "The unit this attribute is measured in, if it has one.",
    },
    { key: "default_value", label: "Value", type: "number", step: "0.0001", min: 0, helpText: "Optional default/example value — informational only. The actual value for each item is still entered on the Item form." },
    // Data Type and Unit are off the form (data_type defaults to NUMBER at
    // create; unit is superseded by uom_id above) but kept for any row that
    // still carries them and for API/script use — not deleted, just not on
    // this screen. is_mandatory/affects_costing/is_variant likewise: none of
    // the three has a downstream consumer anywhere in the app (checked
    // 2026-09-21, same as mandatory_weight on Reason).
    {
      key: "data_type", label: "Data Type", type: "select", hideInForm: true,
      options: ["TEXT", "NUMBER"].map((v) => ({ value: v, label: v })),
    },
    { key: "unit", label: "Unit", type: "text", hideInForm: true },
    { key: "is_mandatory", label: "Mandatory on every item in scope", type: "boolean", hideInForm: true },
    { key: "affects_costing", label: "Affects Costing", type: "boolean", hideInForm: true },
    { key: "is_variant", label: "Distinguishes Item Variants", type: "boolean", hideInForm: true },
  ],
};

const itemTemplateConfig: MasterDataConfig = {
  key: "item-template",
  label: "Item Templates",
  singular: "Item Template",
  description: "Templates to standardize item card creation and pre-populate accounting and tracking defaults.",
  apiBase: "/item-template",
  idKey: "id",
  group: "Inventory",
  tabOf: "item",
  tabLabel: "Item Templates",
  supportsNobLobFilter: false,
  columns: [
    { key: "template_code", label: "Template Code" },
    { key: "template_description", label: "Description" },
    { key: "item_type", label: "Item Type" },
    { key: "category_code", label: "Category" },
    { key: "sub_category", label: "Sub Category" },
    { key: "valuation_method", label: "Valuation Method" },
    { key: "is_active", label: "Active" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "template_code", label: "Template Code", type: "text", required: true, createOnly: true, maxLength: 20, placeholder: "FEED-BROILER", helpText: "Unique template identifier code (max 20 characters)." },
    { key: "template_description", label: "Description", type: "text", placeholder: "Broiler Starter Feed Template" },
    {
      key: "no_series_id",
      label: "Number Series",
      type: "select-entity",
      required: true,
      entityEndpoint: "/no-series",
      entityValueKey: "id",
      entityLabelKeys: ["code", "description"],
      helpText: "The sequential number series used to auto-generate item codes from this template.",
    },
    {
      key: "item_type",
      label: "Item Type",
      type: "select-entity",
      required: true,
      entityEndpoint: "/item-type",
      entityValueKey: "type_code",
      entityLabelKeys: ["type_code", "type_name"],
      helpText: "Selected from Item Type Master.",
    },
    {
      key: "category",
      label: "Category",
      type: "select-entity",
      entityEndpoint: "/item-category?rootOnly=true",
      entityValueKey: "category_id",
      entityLabelKeys: ["category_code", "category_name"],
      dependsOn: "item_type",
      dependsOnMode: "query",
      queryParams: { item_type: "itemType" },
      requiresParent: true,
      helpText: "Root category belonging to the selected Item Type.",
    },
    {
      key: "sub_category",
      label: "Sub Category",
      type: "select-entity",
      entityEndpoint: "/item-category",
      entityValueKey: "category_code",
      entityLabelKeys: ["category_code", "category_name"],
      dependsOn: "category",
      dependsOnMode: "query",
      queryParams: { category: "parentCategoryId" },
      requiresParent: true,
      helpText: "Sub-category belonging to the selected Category.",
    },
    {
      key: "valuation_method",
      label: "Valuation Method",
      type: "select",
      options: [
        { value: "FIFO", label: "FIFO" },
        { value: "LIFO", label: "LIFO" },
        { value: "AVERAGE", label: "Average" },
        { value: "STANDARD", label: "Standard" },
      ],
      defaultValue: "FIFO",
      required: true,
    },
    {
      key: "item_tracking",
      label: "Item Tracking",
      type: "select",
      options: [
        { value: "NONE", label: "None" },
        { value: "LOT", label: "Lot" },
        { value: "SERIAL", label: "Serial" },
      ],
      defaultValue: "NONE",
    },
    {
      key: "item_tracking_no_series_id",
      label: "Tracking No. Series",
      type: "select-entity",
      entityEndpoint: "/no-series",
      entityValueKey: "id",
      entityLabelKeys: ["code", "description"],
      helpText: "Required when Item Tracking is LOT or SERIAL.",
      visibleWhen: { anyOf: [{ key: "item_tracking", equals: ["LOT", "SERIAL"] }] },
      requiredWhen: { anyOf: [{ key: "item_tracking", equals: ["LOT", "SERIAL"] }] },
    },
    {
      key: "inventory_type",
      label: "Inventory Type",
      type: "select",
      options: [
        { value: "INVENTORY", label: "Inventory" },
        { value: "NON_INVENTORY", label: "Non-Inventory" },
        { value: "SERVICE", label: "Service" },
      ],
      defaultValue: "INVENTORY",
    },
    {
      key: "inventory_gl_account",
      label: "Inventory GL Account",
      type: "select-entity",
      entityEndpoint: "/gl-account",
      entityValueKey: "account_code",
      entityLabelKeys: ["account_code", "account_name"],
      helpText: "Default Chart of Accounts code for inventory valuation.",
    },
    {
      key: "cogs_gl_account",
      label: "COGS GL Account",
      type: "select-entity",
      entityEndpoint: "/gl-account",
      entityValueKey: "account_code",
      entityLabelKeys: ["account_code", "account_name"],
      helpText: "Default Chart of Accounts code for Cost of Goods Sold.",
    },
    { key: "qr_code_enabled", label: "QR Code Enabled", type: "boolean" },
    // No is_active checkbox here — new templates are always active; the row
    // toggle switch (supportsRestore now left at its default true) is how a
    // template is deactivated afterward.
  ],
};



// TDD row 13's inventory flag decides whether any of the stock-control numbers
// mean anything: an item that is not held in inventory has no balance to carry a
// minimum, a maximum, a reorder point or a shelf life. One shared gate, so the
// seven fields cannot drift apart.
const WHEN_INVENTORIED = { anyOf: [{ key: "is_inventoriable", equals: true }] };

const item: MasterDataConfig = {
  key: "item",
  owner: "BC",
  bcNote: "BBP-1 §1.5: \u201CItems (feed, medicine, vaccine, semen dose, overhead supplies) are CREATED IN D365BC only. NAVFarm cannot create items independently.\u201D",
  bcFields: [
    { key: "item_code", label: "Item No." },
    { key: "item_name", label: "Description" },
    { key: "uom_primary", label: "Base Unit of Measure" },
    { key: "item_type", label: "Item Type" },
    { key: "bc_lot_nos", label: "Lot Nos." },
    { key: "withdrawal_days", label: "Withdrawal Days" },
    { key: "bc_inventory_posting_group", label: "Inventory Posting Group" },
    { key: "bc_gen_prod_posting_group", label: "General Product Posting Group" },
    { key: "inventory_gl_account", label: "Inventory GL Account" },
    { key: "cogs_gl_account", label: "COGS GL Account" },
    { key: "bc_consumption_gl_account", label: "Consumption GL Account" },
  ],
  label: "Items",
  description: "Inventory item master — raw materials, finished goods, assets.",
  apiBase: "/item",
  idKey: "item_id",
  group: "Inventory",
  isPrimary: true,
  // Classification belongs on the list. An item's identity here is its type,
  // its category and its sub-category — the three questions the form asks in
  // that order, and the three segments its own code is built from — yet the
  // list showed only the type, so the category an item was filed under could
  // not be seen without opening it.
  //
  // category_code is joined by the API. The column itself holds a UUID, and a
  // list rendering it raw would show the reader a UUID; sub_category already
  // stores the child category's own code and needs no join.
  columns: [
    { key: "item_code", label: "Code" },
    { key: "item_name", label: "Name" },
    { key: "item_type", label: "Type" },
    { key: "category_code", label: "Category" },
    { key: "sub_category", label: "Sub Category" },
    { key: "template_code", label: "Template" },
    { key: "uom_primary", label: "UOM" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "item_template_id", label: "Item Template ID", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this item is used across all business verticals.", section: "Classification" },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this item is used across all LOBs under the selected NOB.", section: "Classification" },
    { key: "item_code", label: "Item Code", type: "text", readOnly: true, helpText: "Assigned from the Item number series unless manual entry is selected.", section: "Identification" },
    { key: "item_type", label: "Item Type", type: "select-entity", required: true, entityEndpoint: "/item-type", entityValueKey: "type_code", entityLabelKeys: ["type_code", "type_name"], section: "Identification" },
    { key: "item_name", label: "Item Name", type: "text", required: true, placeholder: "Sow lactation feed", section: "Identification" },
    {
      // Depends on Item Type via the query mechanism, not path substitution — a
      // category is not nested under a type in the URL, it's filtered by it. See
      // resolveEndpoint()'s doc comment above for the general mechanism.
      // requiresParent is what makes the field appear only once there is an Item
      // Type to filter by, and only if that filter leaves something to choose;
      // an earlier note here described the opposite behaviour, which is what the
      // field did before requiresParent was added.
      // rootOnly: a Category picker must offer categories, not sub-categories —
      // without it the list showed FEED-STARTER and MED-VACCINE next to their
      // own parents. Sub-categories are reached through the Sub Category field
      // below, which filters to children of whatever is chosen here.
      key: "category_id", label: "Category", type: "select-entity", entityEndpoint: "/item-category?rootOnly=true", entityValueKey: "category_id", entityLabelKeys: ["category_code", "category_name"],
      dependsOn: "item_type", dependsOnMode: "query", queryParams: { item_type: "itemType" }, requiresParent: true, section: "Identification",
    },
    {
      // A sub-category is just a category whose parent_category_id is the chosen
      // Category (no separate table) — filtered the same way, by parentCategoryId.
      // sub_category stays the free-text column it always was; this field now
      // writes the chosen category's category_code into it instead of typed text.
      key: "sub_category", label: "Sub Category", type: "select-entity", entityEndpoint: "/item-category", entityValueKey: "category_code", entityLabelKeys: ["category_code", "category_name"],
      dependsOn: "category_id", dependsOnMode: "query", queryParams: { category_id: "parentCategoryId" }, requiresParent: true, section: "Identification",
      helpText: "Optional. Lists categories whose parent is the selected Category above — create one there first if the subcategory you need doesn't exist yet.",
    },
    // Left unfiltered: an item's primary/secondary UOM legitimately spans every
    // uom_type — KG for feed, LITER for medicine, BAG or HEAD for others — there is
    // no single obviously-correct type to narrow this picker to.
    { key: "uom_primary", label: "Primary UOM", type: "select-entity", required: true, entityEndpoint: "/uom", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"], excludeValuesOf: ["uom_secondary"], section: "Units & Valuation" },
    { key: "uom_secondary", label: "Secondary UOM", type: "select-entity", entityEndpoint: "/uom", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"], excludeValuesOf: ["uom_primary"], section: "Units & Valuation" },
    {
      // Item Master Template: "Auto-filled from uom_conversion_master. 1
      // secondary = N primary." Shown read-only when that table already holds
      // the pair; asked for, and recorded there, when it does not.
      key: "uom_conversion_factor", label: "UOM Conversion Factor", type: "number", step: "0.000001", min: 0,
      section: "Units & Valuation",
      derivedFrom: {
        endpoint: "/uom/conversion", params: { uom_primary: "fromUom", uom_secondary: "toUom" },
        valueKey: "conversion_factor",
        missingHelpText: "No conversion exists for these units yet — enter it once and it is saved to UOM Conversion.",
      },
      helpText: "Choose a Primary and Secondary UOM; the factor comes from UOM Conversion.",
    },
    { key: "valuation_method", label: "Valuation Method", type: "select-entity", entityEndpoint: "/costing-method", entityValueKey: "method_code", entityLabelKeys: ["method_code", "method_name"], helpText: "Leave blank to inherit the LOB default.", section: "Units & Valuation" },
    // Asked immediately after the method that demands it, and only then: on any
    // other method the cost is not merely optional, it has no meaning.
    { key: "standard_cost", label: "Standard Cost", type: "number", step: "0.01", min: 0, section: "Units & Valuation", visibleWhen: { anyOf: [{ key: "valuation_method", equals: "STANDARD" }] }, requiredWhen: { anyOf: [{ key: "valuation_method", equals: "STANDARD" }] }, helpText: "Per Primary UOM. Required when Valuation Method is STANDARD." },
    // TDD row 11 asks for one three-way choice — LOT, SERIAL or neither. The
    // table carries two independent flags, so the form could tick both, a state
    // the requirement has no name for and no downstream code reads. Neither
    // control here is a column: the gate is "is either flag set", and the
    // segmented choice writes the pair (see booleanColumns in types.ts).
    //
    // The series also used to sit in the Classification card, beside Nature of
    // Business, while the switches that make it mandatory sat in another card
    // entirely. All three now stand together, in the order they are decided.
    { key: "is_tracked", label: "Item Tracking", type: "boolean", filterOnly: true, seedFromAnyTrue: ["is_lot_tracked", "is_serial_tracked"], helpText: "Track individual lots or serial numbers of this item through the chain.", section: "Tracking" },
    {
      key: "tracking_type", label: "Tracked By", type: "select", control: "segmented", filterOnly: true,
      options: [{ value: "LOT", label: "Lot" }, { value: "SERIAL", label: "Serial" }],
      defaultValue: "LOT",
      booleanColumns: { LOT: "is_lot_tracked", SERIAL: "is_serial_tracked" },
      visibleWhen: { anyOf: [{ key: "is_tracked", equals: true }] },
      requiredWhen: { anyOf: [{ key: "is_tracked", equals: true }] },
      section: "Tracking",
    },
    // The lot or serial number series, filtered to whichever Tracked By says.
    // It was removed on 2026-09-09 because the picker offered BREED and
    // CUSTOMER and no LOT or SERIAL series existed; restored 2026-09-15 on
    // Rishi's call, as decisions.md "Item tracking is one three-way choice"
    // already records. The segmented value passes straight through as
    // ?documentType=, so a Lot item is only ever offered LOT series. Tracked By
    // is its parent, so switching Lot to Serial clears the choice, and the API
    // clears the column when tracking is turned off.
    {
      key: "tracking_series_id", label: "Tracking No. Series", type: "select-entity",
      entityEndpoint: "/no-series", entityValueKey: "id", entityLabelKeys: ["code", "description"],
      dependsOn: "tracking_type", dependsOnMode: "query", queryParams: { tracking_type: "document_type" }, requiresParent: true,
      labelWhen: { key: "tracking_type", labels: { LOT: "Lot No. Series", SERIAL: "Serial No. Series" } },
      visibleWhen: { anyOf: [{ key: "is_tracked", equals: true }] },
      requiredWhen: { anyOf: [{ key: "is_tracked", equals: true }] },
      helpText: "The number series lot or serial numbers for this item are issued from.",
      section: "Tracking",
    },
    // The columns the segmented control above writes. Kept in the config so the
    // record view can still state which kind of tracking is in force — each is
    // shown only when it is the one that is set, so an item never reads back a
    // pair of flags where the form asked one question.
    { key: "is_lot_tracked", label: "Lot Tracked", type: "boolean", hideInForm: true, readOnly: true, hideInTable: true, visibleWhen: { anyOf: [{ key: "is_lot_tracked", equals: true }] }, section: "Tracking" },
    { key: "is_serial_tracked", label: "Serial Tracked", type: "boolean", hideInForm: true, readOnly: true, hideInTable: true, visibleWhen: { anyOf: [{ key: "is_serial_tracked", equals: true }] }, section: "Tracking" },
    { key: "is_biological_asset", label: "Biological Asset", type: "boolean" },
    { key: "is_inventoriable", label: "Inventoriable", type: "boolean", helpText: "Held as stock, with a balance and a valuation. Off for services and consumables that are expensed on receipt.", section: "Inventory" },
    { key: "min_stock_level", label: "Min Stock Level", type: "number", step: "0.01", min: 0, visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    { key: "max_stock_level", label: "Max Stock Level", type: "number", step: "0.01", min: 0, visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    { key: "reorder_level", label: "Reorder Level", type: "number", step: "0.01", min: 0, visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    { key: "lead_time_days", label: "Lead Time (days)", type: "number", min: 0, visibleWhen: WHEN_INVENTORIED, helpText: "Procurement lead time, for feed/stock forecast planning.", section: "Inventory" },
    { key: "shelf_life_days", label: "Shelf Life (days)", type: "number", min: 0, visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    // Genuinely sub-zero (frozen vaccine/semen storage) — no min.
    { key: "storage_temp_min", label: "Storage Temp Min (°C)", type: "number", step: "0.01", visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    { key: "storage_temp_max", label: "Storage Temp Max (°C)", type: "number", step: "0.01", visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    {
      // Medicines and vaccines only (Rishi, 2026-09-15 — supersedes showing it
      // for any inventoried item). The withdrawal period is a food-safety block
      // that animal disposal reads before a slaughter is allowed; on feed or a
      // consumable it means nothing, and the API now clears it for other types.
      key: "withdrawal_days", label: "Withdrawal Period (days)", type: "number", min: 0, max: 99, section: "Inventory",
      visibleWhen: { anyOf: [{ key: "item_type", equals: ["MEDICINE", "VACCINE"] }] },
      requiredWhen: { anyOf: [{ key: "item_type", equals: ["MEDICINE", "VACCINE"] }] },
      helpText: "Up to 99 days. Required for MEDICINE/VACCINE items — minimum days after last administration before an animal treated with this item may be slaughtered.",
    },
    { key: "is_qr_enabled", label: "QR Tracking Enabled", type: "boolean" },
    { key: "item_image_url", label: "Item Image URL", type: "text", placeholder: "https://cdn.navfarm.io/items/..." },
    { key: "inventory_gl_account", label: "Inventory GL Account", type: "select-entity", searchable: true, entityEndpoint: "/gl-account", entityValueKey: "gl_account_id", entityLabelKeys: ["account_code", "account_name"], helpText: "GL account this item posts inventory value to.", section: "Accounting" },
    { key: "cogs_gl_account", label: "COGS GL Account", type: "select-entity", searchable: true, entityEndpoint: "/gl-account", entityValueKey: "gl_account_id", entityLabelKeys: ["account_code", "account_name"], helpText: "GL account this item posts cost of goods sold to.", section: "Accounting" },
    { key: "is_blocked", label: "Blocked", type: "boolean", helpText: "A blocked item stays visible/historical but cannot be transacted.", section: "Accounting" },
    {
      // A Mandatory attribute is on every item in scope, so the form opens with
      // a row for each one already in place and no way to take it out. The
      // value is still typed per item; it is the row that is not optional.
      key: "attributes", label: "Attribute Values", type: "json",
      requiredRows: { endpoint: "/item-attribute", flag: "is_mandatory", key: "attribute_id" },
      jsonListKeys: ["attribute_id", "attribute_value"],
      jsonRow: [
        { key: "attribute_id", label: "Attribute", type: "select-entity", entityEndpoint: "/item-attribute", entityValueKey: "attribute_id", entityLabelKeys: ["attribute_code", "attribute_name"] },
        { key: "attribute_value", label: "Value", type: "text", placeholder: "8.5" },
      ],
    },
  ],
};

// ── Livestock & Health ────────────────────────────────────────────────────────

const species: MasterDataConfig = {
  key: "species",
  label: "Species",
  singular: "Species",
  description: "Base species catalog used by breeds.",
  apiBase: "/species",
  idKey: "species_id",
  group: "Livestock & Health",
  lookupFor: ["breed"],
  columns: [
    { key: "species_code", label: "Code" },
    { key: "species_name", label: "Name" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this species is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this species is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company (blank = global)", type: "text", hideInForm: true },
    { key: "species_code", label: "Species Code", type: "text", required: true, createOnly: true, helpText: "Leave blank to derive from the species name via the number series. After create, the code follows the series when the name changes.", placeholder: "PIG" },
    { key: "species_name", label: "Species Name", type: "text", required: true, placeholder: "Domestic Pig" },
  ],
};

const breed: MasterDataConfig = {
  key: "breed",
  label: "Breeds",
  description: "Breed benchmarks — growth, FCR, mortality, reproduction.",
  apiBase: "/breed",
  idKey: "breed_id",
  group: "Livestock & Health",
  isPrimary: true,
  supportsNobLobFilter: true,
  columns: [
    { key: "breed_code", label: "Code" },
    { key: "breed_name", label: "Name" },
    { key: "breed_type", label: "Type" },
  ],
  fields: [
    { key: "company_id", label: "Company (blank = global)", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", required: true, entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], section: "Identification" },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this breed applies to all LOBs under the selected NOB.", section: "Identification" },
    { key: "breed_code", label: "Breed Code", type: "text", required: true, createOnly: true, helpText: "Leave blank to derive from the breed name via the BREED series. After create, the code follows the series when the name changes.", section: "Identification" },
    { key: "breed_name", label: "Breed Name", type: "text", required: true, placeholder: "Yorkshire", section: "Identification" },
    { key: "species_id", label: "Species", type: "select-entity", entityEndpoint: "/species", entityValueKey: "species_id", entityLabelKeys: ["species_code", "species_name"], section: "Identification" },
    {
      key: "breed_type", label: "Breed Type", type: "select", section: "Identification",
      // Piggery is the only line of business in scope, so the poultry, aquaculture
      // and agri types (BROILER, LAYER, DAIRY, BEEF, TREE, FISH) are not offered —
      // a pig farm being asked to choose "Tree" or "Layer" is the LOB taxonomy
      // leaking into the form. MEAT is what all existing breeds already use.
      options: ["MEAT", "BREEDER", "DUAL_PURPOSE"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    { key: "description", label: "Description", type: "text", maxLength: 50, section: "Identification" },
    { key: "avg_growth_rate_g_day", label: "Avg Growth Rate (g/day)", type: "number", step: "0.01", min: 0, section: "Growth & Performance" },
    { key: "avg_fcr", label: "Avg FCR", type: "number", step: "0.01", min: 0, section: "Growth & Performance" },
    { key: "avg_mortality_pct", label: "Avg Mortality %", type: "number", step: "0.01", min: 0, section: "Growth & Performance" },
    { key: "avg_yield_per_unit", label: "Avg Yield per Unit", type: "number", step: "0.01", min: 0, section: "Growth & Performance" },
    { key: "gestation_days", label: "Gestation Days", type: "number", min: 0, section: "Reproduction — Female (Sow)" },
    { key: "lactation_days", label: "Lactation Days", type: "number", min: 0, section: "Reproduction — Female (Sow)" },
    { key: "avg_litter_size_born", label: "Avg Litter Size Born", type: "number", step: "0.01", min: 0, section: "Reproduction — Female (Sow)" },
    { key: "avg_litter_size_weaned", label: "Avg Litter Size Weaned", type: "number", step: "0.01", min: 0, section: "Reproduction — Female (Sow)" },
    { key: "avg_weaning_weight_kg", label: "Avg Weaning Weight (KG)", type: "number", step: "0.01", min: 0, section: "Reproduction — Female (Sow)" },
    { key: "farrowing_rate_pct", label: "Farrowing Rate %", type: "number", step: "0.01", min: 0, section: "Reproduction — Female (Sow)" },
    { key: "productive_life_months", label: "Productive Life (months)", type: "number", min: 0, section: "Reproduction — Female (Sow)" },
    { key: "productive_life_cycles", label: "Productive Life Cycles", type: "number", min: 0, helpText: "Expected number of parities in productive life. A parity count only applies to a female.", section: "Reproduction — Female (Sow)" },
    { key: "boar_doses_per_week", label: "Doses per Week", type: "number", step: "0.01", min: 0, helpText: "Semen doses collected per week — a male KPI.", section: "Reproduction — Male (Boar)" },
    { key: "boar_productive_life_months", label: "Productive Life (months)", type: "number", min: 0, helpText: "How long a boar stays productive — amortisation input for a male.", section: "Reproduction — Male (Boar)" },
    { key: "mature_age_months", label: "Mature Age (months)", type: "number", min: 0, section: "Productive Life" },
    { key: "residual_value_pct", label: "Residual Value %", type: "number", step: "0.01", min: 0, helpText: "Salvage value as percent of opening asset value — amortisation input.", section: "Productive Life" },
    { key: "age_labels", label: "Stage Age Labels", type: "json", section: "Productive Life", helpText: "Stage labels by week range (JSON), shown on the data entry screen header." },
    { key: "is_blocked", label: "Blocked", type: "boolean", helpText: "A blocked breed stays visible/historical but cannot be used on new animals.", section: "Productive Life" },
  ],
};

const breedLifecycleStage: MasterDataConfig = {
  key: "breed-lifecycle-stage",
  label: "Breed Lifecycle Stages",
  description: "Per-breed, per-stage production standards — feed rate, ADG, FCR, mortality, expected output — for a period range within that stage.",
  apiBase: "/breed-lifecycle-stage",
  idKey: "lifecycle_id",
  group: "Livestock & Health",
  tabOf: "breed",
  tabLabel: "Lifecycle Stages",
  columns: [
    { key: "lifecycle_code", label: "Code" },
    { key: "stage", label: "Stage" },
    { key: "calc_unit", label: "Unit" },
    { key: "period_from", label: "From" },
    { key: "period_to", label: "To" },
    { key: "std_fcr", label: "Std FCR" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this lifecycle row is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this lifecycle row is shared across all LOBs under the selected NOB." },
    { key: "lifecycle_code", label: "Lifecycle Code", type: "text", placeholder: "BLS-001", helpText: "Optional. Leave blank until the numbering convention is agreed; a series can generate it later." },
    { key: "breed_id", label: "Breed", type: "select-entity", required: true, searchable: true, entityEndpoint: "/breed", entityValueKey: "breed_id", entityLabelKeys: ["breed_code", "breed_name"] },
    { key: "stage_id", label: "Stage", type: "select-entity", required: true, entityEndpoint: "/stage", entityValueKey: "stage_id", entityLabelKeys: ["stage_code", "stage_name"] },
    {
      key: "category", label: "Category", type: "select",
      helpText: "The class of animal this standard is written for — the same list the Animal Register uses.",
      options: ["SOW", "GILT", "BOAR", "PIGLET", "COMMERCIAL_PIG"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    {
      key: "calc_unit", label: "Period Unit", type: "select", required: true,
      options: ["DAY", "WEEK", "MONTH"].map((v) => ({ value: v, label: v })),
    },
    { key: "period_from", label: "Period From", type: "number", min: 0, required: true },
    { key: "period_to", label: "Period To", type: "number", min: 0, required: true },
    // Breed Master Template, Lifecycle sheet: "Teats" (mandatory). The standard
    // for the stage; BBP §6 hard-blocks gilt selection below 15. Shown only for
    // Category SOW (2026-09-21) — the same restriction Animal Register's own
    // No. of Teats field applies (female-only there, by gender).
    {
      key: "std_teats", label: "Standard Teat Count", type: "number", min: 0,
      helpText: "Minimum teat count expected at this stage. BBP §6 blocks gilt selection below 15.",
      visibleWhen: { anyOf: [{ key: "category", equals: "SOW" }] },
    },
    // Matches breed.dto.ts's SEASON_TYPES exactly — the API already rejected
    // anything else via @IsIn; this was free text on the form until now, so a
    // typed value outside these three only failed after submit.
    {
      key: "season_type", label: "Season", type: "select",
      options: ["ALL", "SUMMER", "WINTER"].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() })),
    },
    { key: "feed_item_id", label: "Feed Item", type: "select-entity", searchable: true, entityEndpoint: "/item", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"] },
    { key: "feed_qty_per_head_per_day_kg", label: "Feed Qty per Head per Day (KG)", type: "number", step: "0.01", min: 0 },
    { key: "feed_wastage_pct", label: "Feed Wastage %", type: "number", step: "0.01", min: 0 },
    { key: "std_body_weight_kg", label: "Std Body Weight (KG)", type: "number", step: "0.01", min: 0 },
    { key: "std_adg_gpd", label: "Std ADG (g/day)", type: "number", step: "0.01", min: 0 },
    { key: "std_fcr", label: "Std FCR", type: "number", step: "0.01", min: 0 },
    { key: "std_mortality_rate_pct", label: "Std Mortality Rate %", type: "number", step: "0.01", min: 0 },
    { key: "output_item_id", label: "Output Item", type: "select-entity", searchable: true, entityEndpoint: "/item", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"] },
    { key: "output_uom", label: "Output UOM", type: "text" },
    { key: "std_output_qty", label: "Std Output Qty", type: "number", step: "0.01", min: 0 },
    // Rows, not a typed array (Rishi, 2026-09-15). metric names a row in the
    // KPI Metric master (kpi_metric_master) — a real, per-tenant-extensible
    // catalog now, not a hardcoded list — by its metric_code, the same words a
    // DESCRIPTIVE scheduler line captures so a threshold names a value the
    // daily entry actually records. The picker's own New/View All buttons are
    // how a tenant adds one of their own without leaving this form.
    {
      key: "kpi_thresholds", label: "KPIs & Alerts", type: "json",
      jsonRow: [
        { key: "metric", label: "KPI", type: "select-entity", entityEndpoint: "/kpi-metric", entityValueKey: "metric_code", entityLabelKeys: ["metric_code", "metric_name"] },
        { key: "lower_limit", label: "Lower Limit", type: "number", step: "0.01" },
        { key: "upper_limit", label: "Upper Limit", type: "number", step: "0.01" },
        { key: "severity", label: "Alert Severity", type: "select", options: ["INFO", "WARNING", "CRITICAL"].map((v) => ({ value: v, label: v })) },
      ],
      helpText: "One row per KPI. Leave a limit empty for a one-sided threshold.",
    },
    // These two columns have existed on breed_lifecycle_stages since the schema
    // was written but were never exposed, so there was no way to record a
    // vaccination or medication plan for a breed at a stage at all.
    // Breed Master Template, Lifecycle sheet: "Resource Requirements". The
    // column existed and nothing on the form could fill it. Each row picks a
    // Resource Master record, as Feed Item picks an item; no row had been
    // written before this, so the shape is new: { resource_id, quantity, notes }.
    {
      key: "resource_requirements", label: "Resource Requirements", type: "json",
      jsonRow: [
        { key: "resource_id", label: "Resource", type: "select-entity", entityEndpoint: "/resource", entityValueKey: "resource_id", entityLabelKeys: ["resource_code", "resource_name"] },
        { key: "quantity", label: "Quantity", type: "number", step: "0.01", min: 0 },
        { key: "notes", label: "Notes", type: "text" },
      ],
      helpText: "One row per resource this breed needs at this stage.",
    },
    // Rows, not a JSON textarea. The Breed Master workbook's Vaccination
    // Schedule was filled in as five repeated columns — "1st vaccine -
    // farrowsure (gilt) 25 weeks", "Vaccine porcillis 11 weeks pregnant every
    // pregnancy cycle" — which is a spreadsheet saying "this is a list of
    // unknown length". Five columns cannot be a schema and hand-typed JSON is
    // not a form, so each entry is a row that can be added and deleted.
    //
    // trigger_type is what makes the client's own entries expressible: the
    // triggers are not one kind of number. Some count from the animal's age in
    // weeks, some from weeks pregnant, and some recur every pregnancy cycle. A
    // single age_days field — which is what the template's own JSON example
    // proposed — can hold only the first of the three.
    //
    // The master holds the plan; the scheduler holds the dated instances, as
    // the template says ("Auto-populates scheduler params on batch create").
    {
      key: "vaccination_protocol", label: "Vaccination Protocol", type: "json",
      jsonRow: [
        { key: "vaccine_item_id", label: "Vaccine", type: "select-entity", entityEndpoint: "/item?itemType=VACCINE", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"] },
        { key: "trigger_type", label: "Triggered by", type: "select", options: [
          { value: "AGE_WEEKS", label: "Age (weeks)" },
          { value: "WEEKS_PREGNANT", label: "Weeks pregnant" },
          { value: "PER_CYCLE", label: "Every pregnancy cycle" },
        ] },
        { key: "trigger_value", label: "At", type: "number", step: "0.5", min: 0 },
        { key: "dose_ml", label: "Dose (ml)", type: "number", step: "0.01", min: 0 },
        { key: "route", label: "Route", type: "select", options: ["IM", "SC", "IN", "ORAL"].map((v) => ({ value: v, label: v })) },
        // As on medication rows (2026-09-15): a vaccine can hold an animal back
        // from slaughter just as a drug can.
        { key: "withdrawal_days", label: "Withdrawal (days)", type: "number", min: 0 },
      ],
      helpText: "One row per vaccination. Triggered by tells the scheduler what to count from — the animal's age, weeks pregnant, or every pregnancy cycle.",
    },
    {
      key: "medication_protocol", label: "Medication Protocol", type: "json",
      // The workbook's Medication Table is symptom-driven, not dated: Problem →
      // Symptom → Drug → Dose → Repeat, grouped by Suckling Piglets /
      // Lactating Sows / Dry Sows. It is a treatment reference the stockman
      // reads when an animal presents, so it carries no trigger — the problem
      // is the trigger.
      jsonRow: [
        { key: "problem", label: "Problem", type: "text", placeholder: "E.coli" },
        { key: "symptom", label: "Symptom", type: "text", placeholder: "Scour — 1st line" },
        { key: "medicine_item_id", label: "Drug", type: "select-entity", entityEndpoint: "/item?itemType=MEDICINE", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"] },
        { key: "dose", label: "Dose", type: "text", placeholder: "0.5ml" },
        { key: "repeat", label: "Repeat", type: "text", placeholder: "every day for 3 days" },
        { key: "withdrawal_days", label: "Withdrawal (days)", type: "number", min: 0 },
      ],
      helpText: "One row per problem, as the farm's treatment card is written. Dose is free text because the card records it per head and per kg both.",
    },
    { key: "notes", label: "Stage Notes", type: "textarea", helpText: "Shown as a tooltip on the data entry screen." },
    // TDD row 102 — traceability. The column has always been written; nothing
    // ever displayed it. hideInForm keeps it off the create/edit form while
    // readOnly lets the detail view through, which is the filter it checks.
    { key: "created_at", label: "Created At", type: "date", hideInForm: true, readOnly: true, hideInTable: true },
  ],
};

const kpiMetric: MasterDataConfig = {
  key: "kpi-metric", label: "KPI Metrics", singular: "KPI Metric", apiBase: "/kpi-metric", idKey: "kpi_metric_id",
  group: "Livestock & Health", isPrimary: true, supportsRestore: true, supportsNobLobFilter: true,
  description: "The KPI vocabulary Breed Lifecycle Stage thresholds and a Scheduler DESCRIPTIVE line both name their metric from, so a threshold and the daily entry it bounds mean the same value. Add one here — or from the KPI picker on a lifecycle stage's own New button — the moment a metric this list doesn't have comes up.",
  columns: [
    { key: "metric_code", label: "Code" }, { key: "metric_name", label: "Name" }, { key: "default_uom", label: "UOM" },
  ],
  fields: [
    { key: "company_id", label: "Company (blank = global)", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this metric is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this metric is shared across all LOBs under the selected NOB." },
    { key: "metric_code", label: "Code", type: "text", required: true, createOnly: true, placeholder: "EAR_LENGTH", helpText: "Uppercase letters, digits and underscore. This is what a lifecycle threshold and a Scheduler DESCRIPTIVE line both reference — pick something they'll recognize." },
    { key: "metric_name", label: "Name", type: "text", required: true, placeholder: "Body Weight" },
    { key: "default_uom", label: "Default UOM", type: "select-entity", entityEndpoint: "/uom", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"], helpText: "The unit this metric is normally recorded in — from the UOM master. Add a RATIO/PCT/HEAD unit there first if this metric needs one that isn't in the list yet." },
  ],
};

const reason: MasterDataConfig = {
  key: "reason", label: "Reasons", singular: "Reason", apiBase: "/reason", idKey: "reason_id",
  group: "Livestock & Health", isPrimary: true, businessAdminOnly: true,
  description: "Shared company reasons for mortality, culling, returns, selection, disposal, transfers, scans, adjustments and requisitions — the client's Reason Master Template, verbatim: Reason Code, Category, Sub-Category, Description, Stage Filter, Mandatory Comment, Blocked.",
  // "Blocked" is the row's own Active/Inactive toggle (is_active/status) —
  // every master in this app surfaces it that way, not as a data column, so
  // it isn't repeated here as a field.
  columns: [
    { key: "reason_code", label: "Reason Code" }, { key: "category", label: "Category" }, { key: "sub_category", label: "Sub-Category" },
    { key: "reason_name", label: "Description" }, { key: "applicable_stages", label: "Stage Filter" }, { key: "mandatory_comment", label: "Mandatory Comment" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this reason is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this reason is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "reason_code", label: "Reason Code", type: "text", required: true, createOnly: true },
    {
      key: "category", label: "Category", type: "select", required: true,
      options: ["MORTALITY", "CULL", "RETURN", "SELECTION", "DISPOSAL", "TRANSFER", "SCAN", "ADJUSTMENT", "REQUISITION"].map((value) => ({ value, label: value })),
    },
    { key: "sub_category", label: "Sub-Category", type: "text", maxLength: 50, placeholder: "Disease" },
    // Template column D is "Description"; the schema/API field is reason_name
    // (entrenched elsewhere — unique index, seed scripts, tests) — relabelled
    // here rather than renamed, so this is the only place the word "Name" is gone.
    { key: "reason_name", label: "Description", type: "text", required: true, maxLength: 50 },
    // Multi-select over real stage_master rows, with an "All Stages" option
    // standing in for "no restriction" (the column's own meaning when empty —
    // see allOption in types.ts). This is what reason.service.ts actually
    // filters/validates on, so unlike the fields below it is the real thing,
    // not a display convenience.
    {
      key: "applicable_stages", label: "Stage Filter", type: "select-entity", multiple: true,
      entityEndpoint: "/stage", entityValueKey: "stage_code", entityLabelKeys: ["stage_code", "stage_name"],
      allOption: { stage_code: "ALL", stage_name: "All Stages" },
    },
    { key: "mandatory_comment", label: "Mandatory Comment", type: "boolean" },
    // Both below are ours, not template columns — kept off the form so it
    // matches the template's seven fields exactly.
    // stage_filter_note keeps the template's own Stage Filter wording verbatim
    // ("SOW", "LACTATION (piglet)") for the 57 seeded rows — several values
    // don't reduce to a stage_master code, so the picker above can only ever
    // hold part of what this text says. Not re-editable here; it's a record of
    // what the client wrote, not a second place to set the same thing.
    { key: "stage_filter_note", label: "Stage Filter (template text)", type: "text", maxLength: 100, hideInForm: true },
    // mandatory_weight has no consumer anywhere in the app (checked 2026-09-21).
    { key: "mandatory_weight", label: "Weight Required", type: "boolean", hideInForm: true },
  ],
};

const disease: MasterDataConfig = {
  key: "disease",
  label: "Diseases",
  description: "Disease reference catalog with symptoms and treatment guidelines.",
  apiBase: "/disease",
  idKey: "disease_id",
  group: "Livestock & Health",
  lookupFor: ["breed"],
  columns: [
    { key: "disease_code", label: "Code" },
    { key: "disease_name", label: "Name" },
    { key: "scientific_name", label: "Scientific Name" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this disease is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this disease is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "disease_code", label: "Disease Code", type: "text", required: true, placeholder: "DIS-ND" },
    { key: "disease_name", label: "Disease Name", type: "text", required: true, placeholder: "Newcastle Disease" },
    { key: "scientific_name", label: "Scientific Name", type: "text", placeholder: "Avian paramyxovirus 1" },
    { key: "symptoms", label: "Symptoms", type: "textarea" },
    { key: "treatment_guideline", label: "Treatment Guideline", type: "textarea" },
  ],
};


const feedFormula: MasterDataConfig = {
  key: "feed-formula",
  label: "Feed Formulas",
  description: "Feed recipes (BOM). Ingredients are edited as a JSON array — one entry per raw material.",
  apiBase: "/feed-formula",
  idKey: "formula_id",
  group: "Livestock & Health",
  lookupFor: ["item"],
  columns: [
    { key: "formula_code", label: "Code" },
    { key: "formula_name", label: "Name" },
    { key: "batch_size", label: "Batch Size" },
    { key: "batch_unit", label: "Unit" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "formula_code", label: "Formula Code", type: "text", required: true, placeholder: "FORM-BR-STARTER" },
    { key: "formula_name", label: "Formula Name", type: "text", required: true, placeholder: "Broiler Starter Feed Formula" },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], filterOnly: true, helpText: "Scopes the Produced Item picker below — feed formulas aren't NOB/LOB-scoped themselves." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", filterOnly: true },
    {
      key: "target_item_id", label: "Produced Item", type: "select-entity", required: true, searchable: true, entityEndpoint: "/item", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"],
      dependsOn: ["nob_id", "lob_id"], dependsOnMode: "query", queryParams: { nob_id: "nobId", lob_id: "lobId" },
    },
    { key: "batch_size", label: "Batch Size", type: "number", required: true, step: "0.01", min: 0 },
    // Feed batches are always weighed out (KG/TONNE), never counted or measured
    // by volume, so this is filtered — unlike Item's Primary/Secondary UOM below,
    // which legitimately spans every type.
    { key: "batch_unit", label: "Batch Unit", type: "select-entity", required: true, entityEndpoint: "/uom?uomType=WEIGHT", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"] },
    { key: "description", label: "Description", type: "textarea" },
    {
      key: "ingredients", label: "Ingredients", type: "json", required: true, createOnly: true,
      jsonRow: [
        { key: "item_id", label: "Item", type: "select-entity", searchable: true, entityEndpoint: "/item", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"] },
        { key: "quantity", label: "Quantity", type: "number", step: "0.001", min: 0 },
        { key: "unit", label: "Unit", type: "select-entity", entityEndpoint: "/uom?uomType=WEIGHT", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"] },
        { key: "inclusion_pct", label: "Inclusion %", type: "number", step: "0.01", min: 0 },
      ],
      helpText: 'Array of { item_id, quantity, unit, inclusion_pct?, loss_pct? }. Example: [{"item_id":"...","quantity":650,"unit":"KG"}]. Set at creation only — the API does not yet support editing ingredients after a formula is created.',
    },
  ],
};

// ── Business Partners ─────────────────────────────────────────────────────────

const supplier: MasterDataConfig = {
  owner: "BC",
  bcNote: "MOM 18 Aug 2026 (Triple C Office), procurement flow Req \u2192 Order \u2192 Vendor \u2192 GRV \u2192 PI: \u201CRequisition (Req) will be raised and maintained in NavFarm. Order, Vendor selection, GRV and PI will be processed in D365BC.\u201D BBP-1 \u00A71 also lists Vendor among the masters, without specifying it.",
  key: "supplier",
  label: "Suppliers",
  description: "Vendors and raw material suppliers.",
  apiBase: "/supplier",
  idKey: "supplier_id",
  group: "Business Partners",
  isPrimary: true,
  columns: [
    { key: "supplier_code", label: "Code" },
    { key: "supplier_name", label: "Name" },
    { key: "vendor_type", label: "Type" },
    { key: "is_approved", label: "Approved" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this supplier is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this supplier is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "supplier_code", label: "Supplier Code", type: "text", readOnly: true, placeholder: "Generated as SUP-001", helpText: "Generated automatically from this company's Supplier sequence.", section: "Identification" },
    { key: "supplier_name", label: "Supplier Name", type: "text", required: true, placeholder: "Feed Ingredients Corp Ltd", section: "Identification" },
    {
      key: "vendor_type", label: "Vendor Type", type: "select", section: "Identification",
      options: ["ANIMAL_SUPPLIER", "BREEDING_FARM", "SEMEN_SUPPLIER", "FEED_SUPPLIER", "MEDICINE_SUPPLIER", "EQUIPMENT_SUPPLIER", "SERVICES", "GENERAL"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    { key: "is_approved", label: "Approved", type: "boolean", hideInForm: true, helpText: "Use the Approve action, not direct edit.", section: "Identification" },
    { key: "email", label: "Email", type: "email", placeholder: "orders@feedingredients.com", section: "Contact" },
    { key: "phone", label: "Phone", type: "text", section: "Contact" },
    { key: "address_line1", label: "Address Line 1", type: "text", section: "Contact" },
    { key: "city", label: "City", type: "text", section: "Contact" },
    { key: "state", label: "State", type: "text", section: "Contact" },
    { key: "country", label: "Country", type: "text", section: "Contact" },
    { key: "pincode", label: "Postal code", type: "text", section: "Contact" },
    { key: "tax_number", label: "Tax number", type: "text", section: "Commercial" },
    { key: "payment_terms", label: "Payment Terms", type: "text", placeholder: "NET30", section: "Commercial" },
    { key: "credit_limit", label: "Credit Limit", type: "number", step: "0.01", min: 0, section: "Commercial" },
    { key: "bank_account_no", label: "Bank Account Number", type: "text", helpText: "Stored encrypted. Enter a value here to replace it; leave blank to keep the existing one.", section: "Banking" },
    { key: "bank_ifsc", label: "Bank IFSC / Routing Code", type: "text", section: "Banking" },
    { key: "bank_account_last4", label: "Bank Account (masked)", type: "text", hideInForm: true, section: "Banking" },
    { key: "health_cert_url", label: "Health Certificate URL", type: "text", helpText: "Required for ANIMAL_SUPPLIER — checked before a Goods Receipt from this vendor can post.", section: "Compliance" },
    { key: "breeding_farm_code", label: "Breeding Farm Registration No.", type: "text", helpText: "Required for ANIMAL_SUPPLIER / BREEDING_FARM.", section: "Compliance" },
  ],
};

const customer: MasterDataConfig = {
  key: "customer",
  label: "Customers",
  description: "Buyers and wholesale/retail customer accounts.",
  apiBase: "/customer",
  idKey: "customer_id",
  group: "Business Partners",
  // Intentionally reachable by its existing URL until Sales enters scope.
  columns: [
    { key: "customer_code", label: "Code" },
    { key: "customer_name", label: "Name" },
    { key: "mobile", label: "Mobile" },
    { key: "credit_limit", label: "Credit Limit" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this customer is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this customer is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "customer_code", label: "Customer Code", type: "text", readOnly: true, placeholder: "Generated as CUS-001", helpText: "Generated automatically from this company's Customer sequence.", section: "Identification" },
    { key: "customer_name", label: "Customer Name", type: "text", required: true, placeholder: "John Doe Wholesalers", section: "Identification" },
    { key: "email", label: "Email", type: "email", placeholder: "billing@johndoe.com", section: "Contact" },
    { key: "mobile", label: "Mobile", type: "text", required: true, section: "Contact" },
    { key: "address_line1", label: "Address Line 1", type: "text", section: "Contact" },
    { key: "city", label: "City", type: "text", section: "Contact" },
    { key: "state", label: "State", type: "text", section: "Contact" },
    { key: "country", label: "Country", type: "text", section: "Contact" },
    { key: "pincode", label: "Postal code", type: "text", section: "Contact" },
    { key: "tax_number", label: "Tax number", type: "text", section: "Commercial" },
    { key: "credit_limit", label: "Credit Limit", type: "number", step: "0.01", min: 0, section: "Commercial" },
  ],
};

const resource: MasterDataConfig = {
  key: "resource",
  label: "Resources",
  description: "Manpower, equipment and utilities used in operations.",
  apiBase: "/resource",
  idKey: "resource_id",
  group: "Business Partners",
  isPrimary: true,
  supportsNobLobFilter: true,
  columns: [
    { key: "resource_code", label: "Code" },
    { key: "resource_name", label: "Name" },
    { key: "resource_type", label: "Type" },
    { key: "cost_rate", label: "Cost Rate" },
    { key: "next_maintenance_date", label: "Next Maintenance" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this resource is shared across all business verticals.", section: "Identification" },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this resource is shared across all LOBs under the selected NOB.", section: "Identification" },
    { key: "resource_code", label: "Resource Code", type: "text", readOnly: true, placeholder: "Generated as RES-001", helpText: "Generated automatically from this company's Resource sequence.", section: "Identification" },
    { key: "resource_name", label: "Resource Name", type: "text", required: true, placeholder: "Senior Laborer", section: "Identification" },
    {
      key: "resource_type", label: "Resource Type", type: "select", required: true, section: "Identification",
      // The client template lists MANPOWER, EQUIPMENT, VEHICLE, UTILITY, OTHER.
      // LABOR was a legacy alias for MANPOWER and offering both made the list
      // read as two ways to say the same thing, so it was dropped as a choice.
      // VEHICLE and OTHER were removed on 15 September on Rishi's call. The API
      // refuses them as a new value; a row already holding one keeps it until
      // its type is changed.
      options: ["MANPOWER", "EQUIPMENT", "UTILITY"].map((v) => ({ value: v, label: v })),
    },
    {
      key: "resource_sub_type", label: "Sub-Type", type: "select", section: "Identification",
      options: ["PERMANENT", "CONTRACT", "DAILY", "OWNED", "LEASED", "RENTED"].map((v) => ({ value: v, label: v })),
      helpText: "PERMANENT/CONTRACT/DAILY for labor; OWNED/LEASED/RENTED for equipment.",
    },
    { key: "employee_id", label: "Employee ID", type: "text", placeholder: "EMP-001", helpText: "Labor/manpower only.", section: "People", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["MANPOWER", "LABOR"] }] } },
    { key: "designation", label: "Designation", type: "text", placeholder: "Senior Farm Worker", helpText: "Labor/manpower only.", section: "People", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["MANPOWER", "LABOR"] }] } },
    { key: "department", label: "Department", type: "text", placeholder: "Farm Operations", helpText: "Department or team.", section: "People", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["MANPOWER", "LABOR"] }] } },
    { key: "capacity", label: "Capacity", type: "number", step: "0.01", min: 0, section: "Capacity & Cost" },
    // Left unfiltered: a resource's capacity spans MANPOWER (HEAD), EQUIPMENT (KG,
    // LITER for a tank, BAG for a mixer) and UTILITY — no single type fits.
    { key: "capacity_uom", label: "Capacity UOM", type: "select-entity", entityEndpoint: "/uom", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"], section: "Capacity & Cost" },
    // Left unfiltered: cost rate is quoted per HOUR (labor), per KG/LITER (material
    // consumption), or per HEAD/trip — spans every type.
    { key: "unit", label: "Cost UOM", type: "select-entity", entityEndpoint: "/uom", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"], section: "Capacity & Cost" },
    { key: "cost_rate", label: "Cost Rate", type: "number", step: "0.01", min: 0, section: "Capacity & Cost" },
    { key: "cost_element", label: "Cost Element", type: "text", placeholder: "DIRECT_LABOR", helpText: "GL cost classification, e.g. DIRECT_LABOR / INDIRECT_LABOR / EQUIPMENT_HIRE / FUEL / MAINTENANCE.", section: "Capacity & Cost" },
    { key: "gl_cost_account", label: "GL Cost Account", type: "select-entity", searchable: true, entityEndpoint: "/gl-account", entityValueKey: "gl_account_id", entityLabelKeys: ["account_code", "account_name"], helpText: "GL account this resource posts cost to.", section: "Capacity & Cost" },
    { key: "asset_code", label: "Asset Code", type: "text", placeholder: "ASSET-PELLETISER-01", helpText: "Equipment only.", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: "EQUIPMENT" }] } },
    { key: "asset_make", label: "Asset Make", type: "text", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: "EQUIPMENT" }] } },
    { key: "asset_model", label: "Asset Model", type: "text", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: "EQUIPMENT" }] } },
    { key: "asset_serial_no", label: "Asset Serial No.", type: "text", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: "EQUIPMENT" }] } },
    { key: "purchase_date", label: "Purchase Date", type: "date", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: "EQUIPMENT" }] } },
    { key: "warranty_expiry_date", label: "Warranty Expiry", type: "date", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: "EQUIPMENT" }] } },
    { key: "maintenance_frequency_days", label: "Maintenance Frequency (days)", type: "number", min: 0, helpText: "Days between scheduled services. Logging a completed service auto-calculates the next due date.", section: "Maintenance", visibleWhen: { anyOf: [{ key: "resource_type", equals: "EQUIPMENT" }] } },
    { key: "maintenance_cost_per_service", label: "Est. Cost per Service", type: "number", step: "0.01", min: 0, section: "Maintenance", visibleWhen: { anyOf: [{ key: "resource_type", equals: "EQUIPMENT" }] } },
    { key: "maintenance_vendor", label: "Preferred Maintenance Vendor", type: "text", section: "Maintenance", visibleWhen: { anyOf: [{ key: "resource_type", equals: "EQUIPMENT" }] } },
    { key: "last_maintenance_date", label: "Last Maintenance (system-tracked)", type: "date", hideInForm: true, section: "Maintenance" },
    { key: "next_maintenance_date", label: "Next Maintenance (system-tracked)", type: "date", hideInForm: true, section: "Maintenance" },
    { key: "license_expiry", label: "License Expiry", type: "date", helpText: "License/certification expiry — alert 30 days before.", section: "Maintenance", visibleWhen: { anyOf: [{ key: "resource_type", equals: "EQUIPMENT" }] } },
  ],
};

// ── Finance ──────────────────────────────────────────────────────────────────

const glAccount: MasterDataConfig = {
  key: "gl-account",
  owner: "BC",
  bcNote: "BBP-1 §1.6: \u201CNAVFarm does NOT maintain its own Chart of Accounts. COA lives entirely in D365BC.\u201D",
  bcFields: [
    { key: "account_code", label: "Account No." },
    { key: "account_name", label: "Account Name" },
    { key: "bc_direct_posting", label: "Direct Posting" },
    { key: "bc_blocked", label: "Blocked in BC" },
  ],
  label: "GL Accounts",
  description: "Chart of Accounts.",
  apiBase: "/gl-account",
  idKey: "gl_account_id",
  group: "Finance",
  isPrimary: true,
  columns: [
    { key: "account_code", label: "Code" },
    { key: "account_name", label: "Name" },
    { key: "account_type", label: "Type" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this G/L account is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this G/L account is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "account_code", label: "Account Code", type: "text", required: true, placeholder: "101000", section: "Identification" },
    { key: "account_name", label: "Account Name", type: "text", required: true, placeholder: "Cash at Bank", section: "Identification" },
    {
      key: "account_type", label: "Account Type", type: "select", required: true, section: "Identification",
      options: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].map((v) => ({ value: v, label: v })),
    },
    { key: "parent_account_id", label: "Parent Account", type: "select-entity", searchable: true, entityEndpoint: "/gl-account", entityValueKey: "gl_account_id", entityLabelKeys: ["account_code", "account_name"], section: "Hierarchy" },
    { key: "is_sub_account", label: "Sub-Account", type: "boolean", section: "Hierarchy" },
    { key: "is_reconciliation", label: "Reconciliation Account", type: "boolean", section: "Hierarchy" },
  ],
};

const glMapping: MasterDataConfig = {
  key: "gl-mapping",
  label: "GL Mappings",
  description: "Maps inventory transaction types to debit/credit GL accounts.",
  apiBase: "/gl-mapping",
  idKey: "mapping_id",
  group: "Finance",
  lookupFor: ["gl-account"],
  columns: [
    { key: "mapping_code", label: "Code" },
    { key: "transaction_type", label: "Transaction Type" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "mapping_code", label: "Mapping Code", type: "text", placeholder: "MAP-001", helpText: "Optional. Leave blank until the numbering convention is agreed; a series can generate it later." },
    { key: "item_category_id", label: "Item Category", type: "select-entity", entityEndpoint: "/item-category", entityValueKey: "category_id", entityLabelKeys: ["category_code", "category_name"] },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank to match all NOBs." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank to match all LOBs under the selected NOB." },
    { key: "stage_id", label: "Production Stage", type: "select-entity", entityEndpoint: "/stage", entityValueKey: "stage_id", entityLabelKeys: ["stage_code", "stage_name"], helpText: "Leave blank to match all stages (wildcard). Set to make this mapping win only when the batch/animal is in this specific stage." },
    { key: "valuation_method", label: "Valuation Method", type: "select-entity", entityEndpoint: "/costing-method", entityValueKey: "method_code", entityLabelKeys: ["method_code", "method_name"], helpText: "Leave blank to match all costing methods." },
    {
      key: "transaction_type", label: "Transaction Type", type: "select", required: true,
      // Kept in sync with every transactionType string the GL posting engine actually
      // writes (GlPostingService.resolveMapping looks up by this exact value) — not a
      // curated subset. Grouped by originating document/flow for scannability.
      options: [
        // Inventory documents
        { value: "PURCHASE", label: "Purchase — Goods Receipt" },
        { value: "CONSUMPTION", label: "Consumption — Goods Issue" },
        { value: "TRANSFER_SHIPMENT", label: "Transfer Out — Stock Transfer (Shipment)" },
        { value: "TRANSFER_RECEIPT", label: "Transfer In — Stock Transfer (Receipt)" },
        { value: "VARIANCE_POSITIVE", label: "Stock Adjustment — Positive Variance" },
        { value: "VARIANCE_NEGATIVE", label: "Stock Adjustment — Negative Variance" },
        // Batch — STANDARD/FIFO costing
        { value: "BATCH_INPUT", label: "Batch — Input Draw (on Activation)" },
        { value: "BATCH_CONSUMPTION", label: "Batch — Daily Consumption" },
        { value: "BATCH_OUTPUT", label: "Batch — Output (on Close)" },
        { value: "BATCH_IMPAIRMENT", label: "Batch — By-Product / Waste Impairment (at-cost vs NRV)" },
        { value: "MORTALITY", label: "Batch — Mortality Write-off" },
        { value: "OVERHEAD", label: "Batch — Overhead" },
        { value: "PRICE_VARIANCE", label: "Batch — Price Variance (Standard Costing)" },
        { value: "USAGE_VARIANCE", label: "Batch — Usage Variance (Standard Costing)" },
        { value: "OUTPUT_VARIANCE", label: "Batch — Output Variance (Standard Costing)" },
        { value: "OVERHEAD_VARIANCE", label: "Batch — Overhead Variance (Standard Costing)" },
        // Batch — Bio-Asset (IAS 41) costing lifecycle
        { value: "BIO_ACQUISITION", label: "Bio-Asset — Acquisition" },
        { value: "BIO_CONSUMPTION_PREMATURE", label: "Bio-Asset — Consumption (Pre-mature, Capitalized)" },
        { value: "BIO_CONSUMPTION_MATURE", label: "Bio-Asset — Consumption (Mature, Expensed)" },
        { value: "BIO_OUTPUT", label: "Bio-Asset — Output" },
        { value: "BIO_MORTALITY_PREMATURE", label: "Bio-Asset — Mortality (Pre-mature)" },
        { value: "BIO_MORTALITY_MATURE", label: "Bio-Asset — Mortality (Mature)" },
        { value: "BIO_OVERHEAD_PREMATURE", label: "Bio-Asset — Overhead (Pre-mature)" },
        { value: "BIO_OVERHEAD_MATURE", label: "Bio-Asset — Overhead (Mature)" },
        { value: "BIO_TRANSFORMATION", label: "Bio-Asset — Transformation (Pre-mature → Mature)" },
        { value: "BIO_AMORTIZATION", label: "Bio-Asset — Amortization" },
        { value: "BIO_FAIR_VALUE", label: "Bio-Asset — Fair Value Adjustment" },
        { value: "BIO_HARVEST", label: "Bio-Asset — Disposal (Harvest)" },
        { value: "BIO_DISPOSAL_SOLD", label: "Bio-Asset — Disposal (Sold)" },
      ],
    },
    { key: "debit_gl_account_id", label: "Debit GL Account", type: "select-entity", searchable: true, entityEndpoint: "/gl-account", entityValueKey: "gl_account_id", entityLabelKeys: ["account_code", "account_name"] },
    { key: "credit_gl_account_id", label: "Credit GL Account", type: "select-entity", searchable: true, entityEndpoint: "/gl-account", entityValueKey: "gl_account_id", entityLabelKeys: ["account_code", "account_name"] },
  ],
};

const costCenter: MasterDataConfig = {
  owner: "BC",
  bcNote: "BBP-1 §1.8: \u201CDimensions are configured in D365BC and mirrored in NAVFarm dimension master via API sync. The dimensions (cost centre) will be created in NAVFarm same as in BC365.\u201D The primary mandatory dimension is Cost Centre = Farm Code.",
  key: "cost-center",
  label: "Cost Centers",
  description: "Dimensions for cost allocation and reporting.",
  apiBase: "/cost-center",
  idKey: "cost_center_id",
  group: "Finance",
  isPrimary: true,
  lookupFor: ["gl-account"],
  columns: [
    { key: "cost_center_code", label: "Code" },
    { key: "cost_center_name", label: "Name" },
    { key: "cost_center_type", label: "Type" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this cost centre is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this cost centre is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "cost_center_code", label: "Cost Center Code", type: "text", required: true, placeholder: "DEPT-ADMIN" },
    { key: "cost_center_name", label: "Cost Center Name", type: "text", required: true, placeholder: "Administrative Department" },
    {
      key: "cost_center_type", label: "Cost Center Type", type: "select", required: true,
      options: ["DEPARTMENT", "FARM", "WAREHOUSE", "PROJECT", "OTHER"].map((v) => ({ value: v, label: v })),
    },
    { key: "parent_cost_center_id", label: "Parent Cost Center", type: "select-entity", entityEndpoint: "/cost-center", entityValueKey: "cost_center_id", entityLabelKeys: ["cost_center_code", "cost_center_name"] },
  ],
};

/**
 * Both tables have been in the database since the start — currency_master and
 * exchange_rate, with endpoints behind them — and neither had a screen. It
 * showed: exchange_rate held zero rows, because there was no way to enter one,
 * and currency_master held three, one of which was the Indian Rupee.
 *
 * No NOB/LOB or company scoping. currency_master has no company_id column and a
 * currency means the same thing in every workspace, so unlike the other masters
 * this one is platform-wide reference data the client curates.
 */
/**
 * Countries are reference data, not a picker with no home: Currencies names the
 * countries a currency is legal tender in, and Suppliers and Customers record
 * one. Without a screen the list could only be read, never extended — the 25
 * seeded rows were the whole world as far as the app was concerned.
 *
 * Tenant-scoped despite living in the platform schema too: CountryService reads
 * the tenant database, so adding one here adds it for this tenant only.
 *
 * It sits in the Currencies workbook rather than the sidebar — see tabOf below.
 */
const country: MasterDataConfig = {
  key: "country",
  label: "Countries",
  singular: "Country",
  description: "Countries the business deals with — used by currencies, suppliers and customers.",
  apiBase: "/country",
  idKey: "country_id",
  group: "Finance",
  // A sheet of the Currencies workbook, not a master of its own. A country is
  // only ever reached through the thing that needs it — which currency is legal
  // tender where, which country a supplier is in — so it earns a tab beside
  // Exchange Rates rather than its own line in the sidebar. Rishi's call.
  tabOf: "currency",
  tabLabel: "Countries",
  columns: [
    { key: "iso2", label: "Code" },
    { key: "country_name", label: "Name" },
    { key: "iso3", label: "ISO3" },
    { key: "phone_code", label: "Dialing Code" },
    { key: "flag_emoji", label: "Flag" },
  ],
  fields: [
    { key: "iso2", label: "ISO Code", type: "text", required: true, placeholder: "ZW", helpText: "The two-letter ISO 3166-1 alpha-2 code. This is what currencies and addresses store." },
    { key: "country_name", label: "Country Name", type: "text", required: true, placeholder: "Zimbabwe" },
    { key: "iso3", label: "ISO3 Code", type: "text", required: true, placeholder: "ZWE", helpText: "The three-letter ISO 3166-1 alpha-3 code." },
    { key: "phone_code", label: "Dialing Code", type: "text", placeholder: "+263" },
    { key: "flag_emoji", label: "Flag", type: "text", placeholder: "🇿🇼" },
  ],
};

const currency: MasterDataConfig = {
  key: "currency",
  label: "Currencies",
  singular: "Currency",
  description: "Currencies the business transacts in, and the countries each one is legal tender in.",
  apiBase: "/currency",
  idKey: "currency_id",
  group: "Finance",
  isPrimary: true,
  columns: [
    { key: "iso_code", label: "Code" },
    { key: "currency_name", label: "Name" },
    { key: "symbol", label: "Symbol" },
    { key: "country_codes", label: "Countries" },
    { key: "decimal_places", label: "Decimals" },
  ],
  fields: [
    { key: "iso_code", label: "Currency Code", type: "text", required: true, placeholder: "USD", helpText: "The three-letter ISO 4217 code. Saved uppercase, and unique." },
    { key: "currency_name", label: "Currency Name", type: "text", required: true, placeholder: "US Dollar" },
    { key: "symbol", label: "Symbol", type: "text", required: true, placeholder: "$" },
    {
      // Countries, not one country: the euro is legal tender across the
      // eurozone and the US dollar is legal tender in Zimbabwe as well as the
      // United States, so a single country field could record neither.
      key: "country_codes", label: "Countries", type: "select-entity", multiple: true,
      entityEndpoint: "/country", entityValueKey: "iso2", entityLabelKeys: ["iso2", "country_name"],
      emptyMultipleLabel: "None recorded",
      helpText: "Every country where this currency is legal tender.",
    },
    {
      key: "symbol_position", label: "Symbol Position", type: "select",
      options: [
        { value: "PREFIX", label: "Before the amount — $100" },
        { value: "SUFFIX", label: "After the amount — 100 $" },
      ],
    },
    {
      key: "decimal_places", label: "Decimal Places", type: "number", min: 0, max: 6, placeholder: "2",
      helpText: "0 for currencies with no minor unit, such as the yen and the dong.",
    },
  ],
};

/**
 * Rates are entered by hand and kept per date, never overwritten: BBP-1 §1.1
 * has Finance entering the USD rate manually, and restating a past period needs
 * the rate as at that date.
 *
 * Every rate is quoted against the US dollar and reads "1 USD = rate", so the
 * base side is not on the form — the API fills it with USD (Rishi, 2026-09-11).
 * It is still shown as a column, so what the rate is measured against is never
 * left implicit.
 */
const exchangeRate: MasterDataConfig = {
  key: "exchange-rate",
  label: "Exchange Rates",
  singular: "Exchange Rate",
  description: "Manually entered USD conversion rates. Each row reads 1 USD = rate, on a date.",
  apiBase: "/currency/rates",
  idKey: "rate_id",
  group: "Finance",
  tabOf: "currency",
  tabLabel: "Exchange Rates",
  supportsRestore: false,
  columns: [
    { key: "from_currency", label: "Base" },
    { key: "to_currency", label: "Currency" },
    { key: "rate", label: "Rate" },
    { key: "rate_date", label: "Date" },
    { key: "rate_source", label: "Source" },
  ],
  fields: [
    {
      key: "to_currency_id", label: "Currency", type: "select-entity", required: true,
      entityEndpoint: "/currency", entityValueKey: "currency_id", entityLabelKeys: ["iso_code", "currency_name"],
      helpText: "The currency being quoted against the US dollar.",
    },
    {
      key: "rate", label: "Rate (1 USD =)", type: "number", min: 0, required: true, step: "0.000001", placeholder: "36.25",
      helpText: "How many units of the chosen currency one US dollar buys. 1 USD = 36.25 ZWL is entered as 36.25.",
    },
    {
      key: "rate_date", label: "Rate Date", type: "date", required: true,
      helpText: "Rates are kept per date and never overwritten, so a past period can be restated at the rate that applied then.",
    },
    { key: "rate_source", label: "Source", type: "text", placeholder: "MANUAL", helpText: "Where the rate came from. The client enters these by hand." },
  ],
};

export const MASTER_DATA_CONFIGS: MasterDataConfig[] = [
  locationType, location,
  numberSeries, stage, activity,
  item, itemCategory, itemType, itemAttribute, itemTemplateConfig, uom, uomConversion,
  animal,
  species, breed, breedLifecycleStage, kpiMetric, reason, disease, feedFormula,
  supplier, customer, resource,
  glAccount, glMapping, costCenter, country, currency, exchangeRate,
];

export const MASTER_DATA_GROUPS = ["Farm Operations", "Production", "Inventory", "Piggery", "Livestock & Health", "Business Partners", "Finance"] as const;

/**
 * Client-specified top-nav sequence (2026-09-22): Location, Number Series,
 * Item, Stage, Breed, Animal Register, Activity — a flat order, not grouped
 * by module. Masters not named here still appear; they're appended after, in
 * their existing relative order, so this only pins the front of the list.
 */
export const MASTER_DATA_NAV_ORDER: string[] = ["location", "number-series", "item", "stage", "breed", "animal", "activity"];

export function getConfig(key: string): MasterDataConfig | undefined {
  if (key === "no-series") return MASTER_DATA_CONFIGS.find((c) => c.key === "number-series");
  return MASTER_DATA_CONFIGS.find((c) => c.key === key);
}

export { STATUS_OPTIONS };
