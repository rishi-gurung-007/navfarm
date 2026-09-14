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
    { key: "type_code", label: "Type Code", type: "text", required: true, placeholder: "FARM", createOnly: true },
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
    { key: "location_name", label: "Name" },
    { key: "location_type", label: "Type" },
    { key: "location_level", label: "Level" },
  ],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this location is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this location is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "location_code", label: "Location Code", type: "text", readOnly: true, helpText: "Generated from the selected Location Type prefix and kept permanently.", section: "Identification" },
    { key: "location_name", label: "Location Name", type: "text", required: true, placeholder: "Porta Farm", section: "Identification" },
    { key: "location_address", label: "Location Address", type: "text", required: true, placeholder: "48 Peg, Bulawayo Road", section: "Identification" },
    {
      key: "location_type", label: "Location Type", type: "select-entity", required: true,
      entityEndpoint: "/location-type", entityValueKey: "type_code", entityLabelKeys: ["type_code", "type_name"], section: "Identification",
    },
    {
      key: "parent_location_id", label: "Parent Location", type: "select-entity", required: true, searchable: true,
      entityEndpoint: "/location", entityValueKey: "location_id", entityLabelKeys: ["location_code", "location_name"],
      dependsOn: "location_type",
      restrictOptionsBy: {
        selectorKey: "location_type", selectorEntityEndpoint: "/location-type", selectorCodeKey: "type_code",
        allowListKey: "allowed_parent_types", optionCodeKey: "location_type", hideWhenEmpty: true,
      },
      helpText: "Only locations from the immediately preceding hierarchy level are available. Level 1 root types, such as Farm, have no Parent Location field.",
      section: "Identification",
    },
    { key: "location_level", label: "Hierarchy Level", type: "number", hideInForm: true, helpText: "Computed from the parent location." },
    { key: "area_size", label: "Area Size", type: "number", step: "0.01", section: "Identification" },
    { key: "area_unit", label: "Area UOM", type: "select-entity", entityEndpoint: "/uom?uomType=AREA", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"], section: "Identification" },
    { key: "max_capacity", label: "Max Capacity", type: "number", step: "0.01", required: true, section: "Identification" },
    { key: "capacity_uom", label: "Capacity UOM", type: "select-entity", required: true, entityEndpoint: "/uom?uomType=COUNT", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"], section: "Identification" },
    { key: "storage_type", label: "Storage Location", type: "select", options: ["STORE", "SILO"].map((v) => ({ value: v, label: v })), section: "Identification" },
    { key: "silo_capacity_kg", label: "Silo Capacity (KG)", type: "number", step: "0.01", visibleWhen: { anyOf: [{ key: "storage_type", equals: "SILO" }] }, requiredWhen: { anyOf: [{ key: "storage_type", equals: "SILO" }] }, helpText: "Required when Storage Location is SILO.", section: "Identification" },
    { key: "silo_reorder_days", label: "Silo Reorder Days", type: "number", visibleWhen: { anyOf: [{ key: "storage_type", equals: "SILO" }] }, requiredWhen: { anyOf: [{ key: "storage_type", equals: "SILO" }] }, helpText: "Required when Storage Location is SILO.", section: "Identification" },
    { key: "downtime_days_required", label: "Downtime Days Required", type: "number", helpText: "Empty days required between batches for biosecurity.", section: "Identification" },
    // The silo or store's own name-number. storage_type says which kind of
    // store this is; this says which one — MULTIPLIER writes MGH1 against each
    // grower house, Porta writes PSL FS - 01 and STORE.
    { key: "storage_name", label: "Silo / Store Name", type: "text", placeholder: "MGH1", visibleWhen: { anyOf: [{ key: "storage_type", equals: ["STORE", "SILO"] }] }, helpText: "The name or number this silo or store is known by on the farm.", section: "Identification" },
    // Both Location Master templates carry this per location, and the breed
    // lifecycle sheets read it: a stage's feed is "bagged" at MFH, "Bulk" at MSL.
    { key: "feed_in_bags", label: "Feed in Bags", type: "boolean", helpText: "On when feed arrives here in bags rather than blown into a silo.", section: "Identification" },
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
  supportsRestore: false,
  columns: [
    { key: "stage_sequence", label: "#" },
    { key: "stage_code", label: "Code" },
    { key: "stage_name", label: "Name" },
    { key: "stage_category", label: "Category" },
    { key: "transition_trigger", label: "Trigger" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", required: true, entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], section: "Identification" },
    { key: "lob_id", label: "Line of Business", type: "select-entity", required: true, entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", section: "Identification" },
    { key: "stage_code", label: "Stage Code", type: "text", required: true, placeholder: "QUARANTINE", section: "Identification" },
    { key: "stage_name", label: "Stage Name", type: "text", required: true, placeholder: "Quarantine", section: "Identification" },
    {
      key: "stage_category", label: "Category", type: "select", required: true, section: "Identification",
      options: ["PRE_PRODUCTIVE", "PRODUCTIVE", "OUTPUT", "DISPOSAL"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    { key: "stage_sequence", label: "Display Order", type: "number", required: true, helpText: "Must be unique per Line of Business.", section: "Identification" },
    { key: "stage_description", label: "Description", type: "text", section: "Identification" },
    { key: "typical_duration_days", label: "Typical Duration (days)", type: "number", section: "Duration" },
    { key: "min_days_before_move", label: "Min Days Before Move", type: "number", helpText: "Minimum days in this stage before a transition is allowed.", section: "Duration" },
    { key: "auto_move_on_day", label: "Auto-Move On Day", type: "number", helpText: "Required when Transition Trigger is Auto By Day.", section: "Duration" },
    {
      key: "transition_trigger", label: "Transition Trigger", type: "select", required: true, section: "Transitions",
      options: ["AUTO_BY_DAY", "MANUAL", "EVENT_BASED", "KPI_BASED"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    { key: "next_stage_id", label: "Next Stage", type: "select-entity", entityEndpoint: "/stage", entityValueKey: "stage_id", entityLabelKeys: ["stage_code", "stage_name"], helpText: "Leave blank for a terminal stage.", section: "Transitions" },
    { key: "alt_next_stage_id", label: "Alternate Next Stage", type: "select-entity", entityEndpoint: "/stage", entityValueKey: "stage_id", entityLabelKeys: ["stage_code", "stage_name"], section: "Transitions" },
    { key: "alt_trigger_condition", label: "Alternate Trigger Condition", type: "text", placeholder: "PREGNANCY_FAILED", section: "Transitions" },
    {
      key: "data_entry_form", label: "Data Entry Form", type: "select", section: "Data Entry",
      options: ["STANDARD", "FARROWING", "WEANING", "SLAUGHTER"].map((v) => ({ value: v, label: v })),
    },
    { key: "scheduler_auto_create", label: "Auto-Create Scheduler", type: "boolean", section: "Data Entry" },
    { key: "show_on_animal_card", label: "Show on Animal Card", type: "boolean", section: "Data Entry" },
    { key: "required_kpi_to_pass", label: "Required KPI to Pass", type: "json", section: "Data Entry", helpText: 'KPI checks validated before a stage transition, e.g. [{"metric":"BODY_WEIGHT","min_value":100}]. A failure warns; a farmer may override with approval.' },
  ],
};

const numberSeries: MasterDataConfig = {
  key: "number-series",
  label: "Number Series",
  singular: "Number Series",
  description: "Concurrency-safe business-code generators (e.g. \"BATCH\" → BATCH-000001) — other modules call these by series code instead of counting rows themselves.",
  apiBase: "/number-series",
  idKey: "series_id",
  group: "Production",
  isPrimary: true,
  supportsRestore: false,
  columns: [
    { key: "series_code", label: "Applies To" },
    { key: "series_name", label: "Name" },
    { key: "document_type", label: "Document Type" },
    { key: "last_generated_code", label: "Last Generated" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank for a series shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id" },
    {
      // The binding is by string convention: resolveSeriesFor() looks for a row
      // whose series_code equals the master key (ITEM), or `MASTER_TYPE` for a
      // type-scoped one (LOCATION_SHED, ANIMAL_PIGGERY). Typed by hand that was
      // silent to get wrong — a series named ITEMS applies to nothing and
      // nothing says so. Picked from the API's own registry instead.
      key: "series_code", label: "Applies To", type: "select-entity", required: true, createOnly: true,
      entityEndpoint: "/number-series/masters", entityValueKey: "master_key", entityLabelKeys: ["master_key"],
      helpText: "The master this series generates codes for. For a type-scoped series (e.g. sheds only) create it as MASTER_TYPE — LOCATION_SHED.",
    },
    { key: "series_name", label: "Series Name", type: "text", required: true, placeholder: "Batch Number" },
    // Was a free text box, so a typo here silently pointed the series at a master
    // that does not exist and the whole thing quietly stopped generating. The
    // list is the masters without a series yet, plus whichever this series
    // already uses — `current` keeps an edit able to show its own value.
    {
      key: "document_type", label: "Master This Codes", type: "select-entity", required: true,
      // Every master, not only those without a series: several series share one
      // document_type (LOCATION_FARM, LOCATION_SHED, LOCATION_PEN are all
      // LOCATION), and the unique-per-master rule belongs to Applies To above.
      entityEndpoint: "/number-series/masters?all=true", entityValueKey: "master_key", entityLabelKeys: ["master_key"],
      helpText: "The master these codes belong to. Code Built From then offers that master's own fields.",
    },
    // Two switches, because "no prefix" and "no number" were only ever
    // expressible by leaving a box empty or typing 0 — a rule the form never
    // stated. On means the part is in the code; off clears it, so nothing
    // invisible survives in the value.
    {
      key: "use_prefix", label: "Use a Prefix", type: "boolean", filterOnly: true,
      seedFromValueOf: "prefix", clearsWhenOff: { prefix: "", prefix_position: "END" },
      helpText: "A fixed piece of text in the code, like ITM. Off for masters coded entirely from their own fields.",
    },
    { key: "prefix", label: "Prefix", type: "text", placeholder: "ITM", visibleWhen: { anyOf: [{ key: "use_prefix", equals: true }] }, requiredWhen: { anyOf: [{ key: "use_prefix", equals: true }] } },
    // Two positions and no more: anywhere in the middle and the prefix is buried
    // where it identifies nothing. Ignored when no prefix is set.
    {
      key: "prefix_position", label: "Prefix Position", type: "select",
      options: [{ value: "END", label: "Last — just before the number" }, { value: "START", label: "First — at the start of the code" }],
      helpText: "Where the prefix sits among the fields below.",
      visibleWhen: { anyOf: [{ key: "use_prefix", equals: true }] },
    },

    {
      // Free text accepted anything — a space, a letter, a character the
      // sequence parser would then fail to split on. Three that read cleanly in
      // a code and none of which appear in a normalised segment.
      key: "separator", label: "Separator", type: "select",
      options: [{ value: "-", label: "-  (hyphen)" }, { value: "/", label: "/  (slash)" }, { value: "|", label: "|  (pipe)" }],
      helpText: "Joins the parts below.",
    },
    // Location needs both: "/" between the levels of the path and "-" before the
    // number, so FARM-001/SHED-001/PEN-001 reads as a path ending in a count.
    // One separator cannot say both — with only "/" a root reads FARM/001.
    {
      key: "seq_separator", label: "Separator Before the Number", type: "select",
      visibleWhen: { anyOf: [{ key: "use_sequence", equals: true }] },
      options: [{ value: "-", label: "-  (hyphen)" }, { value: "/", label: "/  (slash)" }, { value: "|", label: "|  (pipe)" }],
      placeholder: "Same as the separator",
      helpText: "Only when it differs — Location joins its path with / but its number with -.",
    },
    // 0 means no number at all — Breed codes are the breed name, and LARGEWHITE-001
    // would be counting something already unique. Only usable when the code is
    // built from a field, and a repeat is then rejected rather than numbered.
    {
      key: "use_sequence", label: "Use a Running Number", type: "boolean", filterOnly: true,
      seedFromValueOf: "seq_length", clearsWhenOff: { seq_length: 0, seq_separator: "" },
      helpText: "Off when the fields alone make the code unique — a breed IS Large White, and LARGE_WHITE-001 would count something already unique. A repeat is then refused rather than numbered.",
    },
    { key: "seq_length", label: "Sequence Digits", type: "number", min: 1, max: 12, placeholder: "3", visibleWhen: { anyOf: [{ key: "use_sequence", equals: true }] }, requiredWhen: { anyOf: [{ key: "use_sequence", equals: true }] }, helpText: "A minimum width, not a limit — after 999 the next is 1000." },
    {
      key: "reset_frequency", label: "Reset Frequency", type: "select",
      options: ["NEVER", "MONTHLY", "YEARLY"].map((v) => ({ value: v, label: v })),
    },
    // What the code is built from, in order, before the number. The options are
    // the Prefix above plus the fields of whatever master "Applies To" names —
    // LOCATION offers parent_location_id and location_type, ITEM offers
    // item_type, category_id and sub_category. Prefix is an entry in the same
    // list rather than a fixed position, so it can lead, follow, or be left out:
    // ITEM wants it after the type and category, BREED wants only the name,
    // LOCATION wants none. A field naming a related record contributes that
    // record's code; any other field contributes its own value.
    // Keyed off Document Type, not Applies To: LOCATION_SHED and LOCATION_FARM are
    // both document_type LOCATION, so the type-specific series offer the same
    // fields as the master they belong to. Document Type is also on the form for
    // both create and edit, where Applies To is create-only.
    { key: "code_segments", label: "Code Built From", type: "field-list", fieldsOf: "document_type", helpText: "Ordered, and any mix. Leave empty for prefix then number. Location: parent location, then location type, then the number." },
    { key: "allow_manual", label: "Allow Manual Entry", type: "boolean", helpText: "Let a user type their own code instead of generating one." },
    { key: "current_seq", label: "Current Sequence", type: "number", hideInForm: true },
    { key: "last_generated_code", label: "Last Generated Code", type: "text", hideInForm: true },
  ],
};

const activity: MasterDataConfig = {
  key: "activity",
  label: "Activities",
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
    { key: "line_type", label: "Line Type" },
    { key: "description", label: "Description" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "activity_code", label: "Activity Code", type: "text", required: true, placeholder: "e.g. MORN_FEED", createOnly: true, helpText: "Short unique uppercase code (e.g. MORN_FEED) for lookups and reporting." },
    { key: "activity_name", label: "Activity Name", type: "text", required: true, placeholder: "e.g. Morning Feed" },
    {
      key: "line_type", label: "Line Type", type: "select", required: true,
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
    { key: "description", label: "Description", type: "textarea", placeholder: "Optional notes or instructions for this activity" },
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
    { key: "nob_id", label: "Nature of Business", type: "select-entity", required: true, entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], section: "Identification" },
    { key: "lob_id", label: "Line of Business", type: "select-entity", required: true, entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", section: "Identification" },
    {
      key: "animal_type", label: "Animal Type", type: "select", required: true, section: "Identification",
      options: ["SOW", "BOAR", "GILT", "PIGLET", "COMMERCIAL_PIG"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    { key: "breed_id", label: "Breed", type: "select-entity", required: true, searchable: true, entityEndpoint: "/breed", entityValueKey: "breed_id", entityLabelKeys: ["breed_code", "breed_name"], section: "Identification" },
    {
      key: "gender", label: "Gender", type: "select", required: true, section: "Identification",
      options: [{ value: "F", label: "Female" }, { value: "M", label: "Male" }],
    },
    { key: "dob", label: "Date of Birth", type: "date", helpText: "Leave blank if born on this farm and unknown, or imported/unknown.", section: "Identification" },
    { key: "serial_number", label: "Serial Number", type: "text", helpText: "Asset tag from item_lot_serials, distinct from RFID/ear tag.", section: "Identification" },
    { key: "rfid_tag", label: "RFID Tag", type: "text", helpText: "Unique if set.", section: "Identification" },
    { key: "ear_tag", label: "Ear Tag (Visual)", type: "text", section: "Identification" },
    { key: "ear_tag_image_url", label: "Ear Tag Image URL", type: "text", placeholder: "https://cdn.navfarm.io/ear-tags/...", helpText: "Paste an image URL for now; direct file upload to Cloudflare R2 is planned for later.", section: "Identification" },
    { key: "sire_animal_id", label: "Sire (Father)", type: "select-entity", searchable: true, entityEndpoint: "/animal", entityValueKey: "animal_id", entityLabelKeys: ["animal_code"], section: "Lineage" },
    { key: "dam_animal_id", label: "Dam (Mother)", type: "select-entity", searchable: true, entityEndpoint: "/animal", entityValueKey: "animal_id", entityLabelKeys: ["animal_code"], section: "Lineage" },
    {
      key: "entry_type", label: "Entry Type", type: "select", required: true, section: "Acquisition",
      options: ["PURCHASED_IMPORTED", "PURCHASED_LOCAL", "BORN_ON_FARM", "TRANSFERRED_IN"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    { key: "entry_date", label: "Entry Date", type: "date", required: true, section: "Acquisition" },
    // Sits with Entry Date rather than beside Date of Birth (where the master
    // template puts it) because it is the entry that gives it meaning, and the
    // two dates it is computed from are the ones either side of it here.
    // readOnly: the API computes it on every write and discards anything sent
    // alongside a DOB, so an editable box would take input it then throws away.
    { key: "age_at_entry_weeks", label: "Age at Entry (Weeks)", type: "number", readOnly: true, helpText: "Computed from Date of Birth and Entry Date.", section: "Acquisition" },
    // Shown only for the entry types they belong to. The API has always
    // enforced these as COND rules and rejected the wrong combination; the form
    // asked for both from everyone, so a born-on-farm piglet was offered a
    // goods receipt it could never legally carry.
    { key: "source_receipt_id", searchable: true, label: "Source Goods Receipt", type: "select-entity", entityEndpoint: "/goods-receipt", entityValueKey: "receipt_id", entityLabelKeys: ["receipt_no"], visibleWhen: { anyOf: [{ key: "entry_type", equals: ["PURCHASED_IMPORTED", "PURCHASED_LOCAL"] }] }, requiredWhen: { anyOf: [{ key: "entry_type", equals: ["PURCHASED_IMPORTED", "PURCHASED_LOCAL"] }] }, helpText: "The receipt this animal arrived on.", section: "Acquisition" },
    { key: "source_batch_id", searchable: true, label: "Source Batch", type: "select-entity", entityEndpoint: "/batch", entityValueKey: "batch_id", entityLabelKeys: ["batch_no"], visibleWhen: { anyOf: [{ key: "entry_type", equals: "BORN_ON_FARM" }] }, requiredWhen: { anyOf: [{ key: "entry_type", equals: "BORN_ON_FARM" }] }, helpText: "The farrowing batch this animal was born from.", section: "Acquisition" },
    // LIVESTOCK is the item type seeded for living biological assets. There is
    // no LIVING_ASSET item type; using it here left this required picker empty.
    { key: "item_id", searchable: true, label: "Item (Living Asset)", type: "select-entity", required: true, entityEndpoint: "/item?itemType=LIVESTOCK", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"], section: "Acquisition" },
    // Two fields, one column. A purchased animal's cost is read off its goods
    // receipt by the API and anything typed here is discarded, so offering an
    // editable box for it would take input it then throws away. Everything else
    // has no document behind it and is entered by hand.
    { key: "acquisition_cost", label: "Acquisition Cost", type: "number", step: "0.01", readOnly: true, visibleWhen: { anyOf: [{ key: "entry_type", equals: ["PURCHASED_IMPORTED", "PURCHASED_LOCAL"] }] }, helpText: "Taken from the rate on the source goods receipt.", section: "Acquisition" },
    { key: "acquisition_cost", label: "Acquisition Cost", type: "number", step: "0.01", requiredWhen: { anyOf: [{ key: "entry_type", equals: ["BORN_ON_FARM", "TRANSFERRED_IN"] }] }, visibleWhen: { anyOf: [{ key: "entry_type", equals: ["BORN_ON_FARM", "TRANSFERRED_IN"] }] }, section: "Acquisition" },
    { key: "landing_cost", label: "Landing Cost", type: "number", step: "0.01", helpText: "Transport/import duty/quarantine charges for imported animals.", section: "Acquisition" },
    // Acquisition Cost + Landing Cost, computed by the service on save. Shown
    // rather than hidden because it is the figure the opening bio-asset value
    // and the whole amortisation schedule are built from, so it belongs where
    // the two numbers that make it are. Read-only: the service recomputes it
    // from those two on every write, so an entered figure would be overwritten.
    { key: "total_opening_asset_value", label: "Total Opening Asset Value", type: "number", step: "0.01", readOnly: true, helpText: "Acquisition Cost + Landing Cost. Calculated on save.", section: "Acquisition" },
    // Bio-Asset is female-only on Rishi's call (2026-09-08). Note the section
    // mixes two kinds of field: no_of_teats / tsi / grading are gilt-selection
    // measures and are genuinely female-only, while book value, amortisation
    // and residual value are IAS 41 figures that apply to any biological asset
    // — a boar included. dispose() still computes gain/loss against book_value
    // for a male, so that number is now used but not visible on his form.
    { key: "current_bio_asset_value", label: "Current Bio-Asset Value", type: "number", step: "0.01", editOnly: true, helpText: "Set from acquisition cost at creation; adjust here afterward. Reconciles with D365BC: each animal is a Child Fixed Asset there, and BC posts acquisition and returns the FA Ledger Entry reference (Bio Asset BBP). No BC connector yet \u2014 this is a local figure.", visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "book_value", label: "Book Value NBV", type: "number", step: "0.01", editOnly: true, helpText: "Reconciles with D365BC: each animal is a Child Fixed Asset there, and BC posts acquisition and returns the FA Ledger Entry reference (Bio Asset BBP). No BC connector yet \u2014 this is a local figure.", visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "total_amortised", label: "Total Amortised", type: "number", step: "0.01", editOnly: true, visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "amortisation_monthly", label: "Monthly Amortisation", type: "number", step: "0.01", editOnly: true, visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "residual_value", label: "Residual Value", type: "number", step: "0.01", editOnly: true, visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "expected_cull_date", label: "Expected Cull Date", type: "date", editOnly: true, helpText: "Derived from the productive life start and the breed's productive life.", section: "Production" },
    { key: "disposal_date", label: "Disposal Date", type: "date", hideInForm: true, helpText: "Set via the Dispose action, not direct edit.", section: "Bio-Asset" },
    { key: "disposal_type", label: "Disposal Type", type: "text", hideInForm: true, helpText: "Set via the Dispose action, not direct edit.", section: "Bio-Asset" },
    { key: "no_of_teats", label: "No. of Teats", type: "number", helpText: "BBP §6: below 15 blocks this gilt from selection regardless of TSI score.", visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "tsi", label: "TSI", type: "number", step: "0.01", helpText: "Total Sow Index score.", visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "grading", label: "Grading", type: "text", visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "current_stage_id", label: "Current Stage", type: "select-entity", entityEndpoint: "/stage", entityValueKey: "stage_id", entityLabelKeys: ["stage_code", "stage_name"], section: "Current Position" },
    { key: "current_batch_id", label: "Current Batch", type: "select-entity", searchable: true, entityEndpoint: "/batch", entityValueKey: "batch_id", entityLabelKeys: ["batch_no"], section: "Current Position" },
    { key: "current_location_id", label: "Current Location", type: "select-entity", searchable: true, entityEndpoint: "/location", entityValueKey: "location_id", entityLabelKeys: ["location_code", "location_name"], section: "Current Position" },
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
    { key: "parity_count", label: "Parity Count", type: "number", editOnly: true, visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, helpText: "Completed pregnancies, incremented on weaning. Rolled up from farrowing records, so a manual figure is replaced at the next weaning.", section: "Bio-Asset" },
    { key: "total_piglets_born_live", label: "Total Piglets Born Live", type: "number", editOnly: true, visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "total_piglets_weaned", label: "Total Piglets Weaned", type: "number", editOnly: true, visibleWhen: { anyOf: [{ key: "gender", equals: "F" }] }, section: "Bio-Asset" },
    { key: "productive_life_start", label: "Productive Life Start", type: "date", section: "Production" },
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
    { key: "category_code", label: "Category Code", type: "text", required: true, placeholder: "FEED" },
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
    // createOnly: items reference a type by its code string, so the code is
    // immutable after create (UpdateItemTypeDto has no type_code, and the
    // global pipe's forbidNonWhitelisted would 400 the whole edit if the form
    // kept resending it).
    { key: "type_code", label: "Type Code", type: "text", required: true, placeholder: "RAW_MATERIAL", createOnly: true },
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
    { key: "uom_code", label: "UOM Code", type: "text", required: true, placeholder: "KG" },
    { key: "uom_name", label: "UOM Name", type: "text", required: true, placeholder: "Kilogram" },
    {
      key: "uom_type", label: "UOM Type", type: "select", required: true,
      options: ["WEIGHT", "VOLUME", "COUNT", "AREA", "TIME", "OTHER"].map((v) => ({ value: v, label: v })),
    },
    { key: "decimal_places", label: "Decimal Places", type: "number" },
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
    { key: "conversion_factor", label: "Factor" },
    { key: "effective_from", label: "Effective From" },
    { key: "effective_to", label: "Effective To" },
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
      key: "conversion_factor", label: "Conversion Factor", type: "number", required: true,
      placeholder: "50",
      helpText: "Multiply the From quantity to get the base quantity. 1 BAG = 50 KG, so the factor is 50.",
    },
    // Not on the client's sheet. The column predates this work (schema, 21 July)
    // and is NOT NULL, so the form cannot stop asking for it without a migration.
    // Flagged in docs/masters-evidence; needs a client answer, not a guess.
    { key: "effective_from", label: "Effective From", type: "date", required: true, helpText: "Not on the client template — our column. Use the date this factor starts applying." },
    { key: "effective_to", label: "Effective To", type: "date", helpText: "Leave blank while the factor is open-ended." },
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
    { key: "data_type", label: "Type" },
    { key: "is_mandatory", label: "Mandatory" },
  ],
  fields: [
    { key: "company_id", label: "Company (blank = global)", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank to make this attribute available across all NOBs." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank to make this attribute available across all LOBs under the selected NOB." },
    { key: "attribute_code", label: "Attribute Code", type: "text", required: true, placeholder: "PROTEIN_PCT" },
    { key: "attribute_name", label: "Attribute Name", type: "text", required: true, placeholder: "Protein %" },
    {
      // TDD row 130 has a fifth type, LIST, with row 131's List Values behind
      // it. Both are out: the item's Attribute Value is a free text input
      // whatever the attribute's type, so LIST would define a set of allowed
      // values that no screen enforces. STRING went too — TEXT is the same type
      // under the client's own word.
      key: "data_type", label: "Data Type", type: "select", required: true,
      options: ["TEXT", "NUMBER", "DATE", "BOOLEAN"].map((v) => ({ value: v, label: v })),
    },
    // TDD row 132 says "(UOM master)", and this is deliberately not that. An
    // attribute's unit is a specification — %, °C, mm — not something you
    // transact in, and uom_master holds the units stock moves in (KG, BAG,
    // DOSE). Putting % there to satisfy this field would offer it on Primary
    // UOM, Output UOM and Feed Formula too, where receiving "18 PCT" is
    // meaningless. Free text until the client asks otherwise. Rishi's call,
    // 2026-09-08.
    { key: "unit", label: "Unit", type: "text", placeholder: "%", helpText: "The unit this attribute is measured in, if it has one." },
    { key: "is_mandatory", label: "Mandatory on every item in scope", type: "boolean" },
    { key: "affects_costing", label: "Affects Costing", type: "boolean" },
    { key: "is_variant", label: "Distinguishes Item Variants", type: "boolean" },
  ],
};

// TDD row 13's inventory flag decides whether any of the stock-control numbers
// mean anything: an item that is not held in inventory has no balance to carry a
// minimum, a maximum, a reorder point or a shelf life. One shared gate, so the
// eight fields cannot drift apart.
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
    { key: "uom_primary", label: "UOM" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this item is used across all business verticals.", section: "Classification" },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this item is used across all LOBs under the selected NOB.", section: "Classification" },
    { key: "item_code", label: "Item Code", type: "text", readOnly: true, helpText: "Assigned from the Item number series unless manual entry is selected.", section: "Identification" },
    { key: "item_name", label: "Item Name", type: "text", required: true, placeholder: "Sow lactation feed", section: "Identification" },
    { key: "item_type", label: "Item Type", type: "select-entity", required: true, entityEndpoint: "/item-type", entityValueKey: "type_code", entityLabelKeys: ["type_code", "type_name"], section: "Identification" },
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
      key: "uom_conversion_factor", label: "UOM Conversion Factor", type: "number", step: "0.000001",
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
    { key: "standard_cost", label: "Standard Cost", type: "number", step: "0.01", section: "Units & Valuation", visibleWhen: { anyOf: [{ key: "valuation_method", equals: "STANDARD" }] }, requiredWhen: { anyOf: [{ key: "valuation_method", equals: "STANDARD" }] }, helpText: "Per Primary UOM. Required when Valuation Method is STANDARD." },
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
    // No Tracking No. Series field. It pointed at LOT / SERIAL series that
    // generated nothing, because a lot number is not a property of the item —
    // one item has many lots, and the number belongs to the receipt that
    // delivered it (goods_receipt_line.lot_no). The switch above still says
    // WHETHER this item is tracked, and by lot or by serial, which is the part
    // the item owns. Rishi's call, 2026-09-09.
    // The columns the segmented control above writes. Kept in the config so the
    // record view can still state which kind of tracking is in force — each is
    // shown only when it is the one that is set, so an item never reads back a
    // pair of flags where the form asked one question.
    { key: "is_lot_tracked", label: "Lot Tracked", type: "boolean", hideInForm: true, readOnly: true, hideInTable: true, visibleWhen: { anyOf: [{ key: "is_lot_tracked", equals: true }] }, section: "Tracking" },
    { key: "is_serial_tracked", label: "Serial Tracked", type: "boolean", hideInForm: true, readOnly: true, hideInTable: true, visibleWhen: { anyOf: [{ key: "is_serial_tracked", equals: true }] }, section: "Tracking" },
    { key: "is_biological_asset", label: "Biological Asset", type: "boolean" },
    { key: "is_inventoriable", label: "Inventoriable", type: "boolean", helpText: "Held as stock, with a balance and a valuation. Off for services and consumables that are expensed on receipt.", section: "Inventory" },
    { key: "min_stock_level", label: "Min Stock Level", type: "number", step: "0.01", visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    { key: "max_stock_level", label: "Max Stock Level", type: "number", step: "0.01", visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    { key: "reorder_level", label: "Reorder Level", type: "number", step: "0.01", visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    { key: "lead_time_days", label: "Lead Time (days)", type: "number", visibleWhen: WHEN_INVENTORIED, helpText: "Procurement lead time, for feed/stock forecast planning.", section: "Inventory" },
    { key: "shelf_life_days", label: "Shelf Life (days)", type: "number", visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    { key: "storage_temp_min", label: "Storage Temp Min (°C)", type: "number", step: "0.01", visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    { key: "storage_temp_max", label: "Storage Temp Max (°C)", type: "number", step: "0.01", visibleWhen: WHEN_INVENTORIED, section: "Inventory" },
    {
      // Shown on either condition, not on the inventory flag alone. The
      // withdrawal period is a food-safety block — animal disposal reads it
      // before a slaughter is allowed — so a medicine that happens not to be
      // inventoried still has to carry one, and the API rejects the save
      // without it either way.
      key: "withdrawal_days", label: "Withdrawal Period (days)", type: "number", min: 0, max: 99, section: "Inventory",
      visibleWhen: { anyOf: [{ key: "is_inventoriable", equals: true }, { key: "item_type", equals: ["MEDICINE", "VACCINE"] }] },
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
    { key: "species_code", label: "Species Code", type: "text", required: true, placeholder: "PIG" },
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
    { key: "location_code", label: "Farm Code" },
    { key: "location_name", label: "Farm" },
    { key: "breed_type", label: "Type" },
    { key: "avg_fcr", label: "Avg FCR" },
  ],
  fields: [
    { key: "location_id", label: "Farm", type: "select-entity", required: true, entityEndpoint: "/location?locationType=FARM&rootOnly=true&isActive=true", entityValueKey: "location_id", entityLabelKeys: ["location_code", "location_name"], section: "Identification", helpText: "The active first-level farm where this breed profile applies." },
    { key: "company_id", label: "Company (blank = global)", type: "text", hideInForm: true },
    { key: "nob_id", label: "Nature of Business", type: "select-entity", required: true, entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], section: "Identification" },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this breed applies to all LOBs under the selected NOB.", section: "Identification" },
    { key: "breed_code", label: "Breed Code", type: "text", required: true, placeholder: "YORKSHIRE", section: "Identification" },
    { key: "breed_name", label: "Breed Name", type: "text", required: true, placeholder: "Yorkshire", section: "Identification" },
    { key: "species_id", label: "Species", type: "select-entity", required: true, entityEndpoint: "/species", entityValueKey: "species_id", entityLabelKeys: ["species_code", "species_name"], section: "Identification" },
    {
      key: "breed_type", label: "Breed Type", type: "select", required: true, section: "Identification",
      // Piggery is the only line of business in scope, so the poultry, aquaculture
      // and agri types (BROILER, LAYER, DAIRY, BEEF, TREE, FISH) are not offered —
      // a pig farm being asked to choose "Tree" or "Layer" is the LOB taxonomy
      // leaking into the form. MEAT is what all existing breeds already use.
      options: ["MEAT", "BREEDER", "DUAL_PURPOSE"].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
    },
    { key: "description", label: "Description", type: "textarea", section: "Identification" },
    { key: "avg_growth_rate_g_day", label: "Avg Growth Rate (g/day)", type: "number", step: "0.01", section: "Growth & Performance" },
    { key: "avg_fcr", label: "Avg FCR", type: "number", step: "0.01", section: "Growth & Performance" },
    { key: "avg_mortality_pct", label: "Avg Mortality %", type: "number", step: "0.01", section: "Growth & Performance" },
    { key: "avg_yield_per_unit", label: "Avg Yield per Unit", type: "number", step: "0.01", section: "Growth & Performance" },
    { key: "gestation_days", label: "Gestation Days", type: "number", section: "Reproduction — Female (Sow)" },
    { key: "lactation_days", label: "Lactation Days", type: "number", section: "Reproduction — Female (Sow)" },
    { key: "avg_litter_size_born", label: "Avg Litter Size Born", type: "number", step: "0.01", section: "Reproduction — Female (Sow)" },
    { key: "avg_litter_size_weaned", label: "Avg Litter Size Weaned", type: "number", step: "0.01", section: "Reproduction — Female (Sow)" },
    { key: "avg_weaning_weight_kg", label: "Avg Weaning Weight (KG)", type: "number", step: "0.001", section: "Reproduction — Female (Sow)" },
    { key: "farrowing_rate_pct", label: "Farrowing Rate %", type: "number", step: "0.01", section: "Reproduction — Female (Sow)" },
    { key: "productive_life_months", label: "Productive Life (months)", type: "number", section: "Reproduction — Female (Sow)" },
    { key: "productive_life_cycles", label: "Productive Life Cycles", type: "number", helpText: "Expected number of parities in productive life. A parity count only applies to a female.", section: "Reproduction — Female (Sow)" },
    { key: "boar_doses_per_week", label: "Doses per Week", type: "number", step: "0.01", helpText: "Semen doses collected per week — a male KPI.", section: "Reproduction — Male (Boar)" },
    { key: "boar_productive_life_months", label: "Productive Life (months)", type: "number", helpText: "How long a boar stays productive — amortisation input for a male.", section: "Reproduction — Male (Boar)" },
    { key: "mature_age_months", label: "Mature Age (months)", type: "number", section: "Productive Life" },
    { key: "residual_value_pct", label: "Residual Value %", type: "number", step: "0.01", helpText: "Salvage value as percent of opening asset value — amortisation input.", section: "Productive Life" },
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
    { key: "period_from", label: "Period From", type: "number", required: true },
    { key: "period_to", label: "Period To", type: "number", required: true },
    // Breed Master Template, Lifecycle sheet: "Teats" (mandatory). The standard
    // for the stage; BBP §6 hard-blocks gilt selection below 15.
    { key: "std_teats", label: "Standard Teat Count", type: "number", helpText: "Minimum teat count expected at this stage. BBP §6 blocks gilt selection below 15." },
    { key: "season_type", label: "Season", type: "text", placeholder: "Winter" },
    { key: "feed_item_id", label: "Feed Item", type: "select-entity", searchable: true, entityEndpoint: "/item", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"] },
    { key: "feed_qty_per_head_per_day_kg", label: "Feed Qty per Head per Day (KG)", type: "number", step: "0.0001" },
    { key: "feed_wastage_pct", label: "Feed Wastage %", type: "number", step: "0.01" },
    { key: "std_body_weight_kg", label: "Std Body Weight (KG)", type: "number", step: "0.001" },
    { key: "std_adg_gpd", label: "Std ADG (g/day)", type: "number", step: "0.01" },
    { key: "std_fcr", label: "Std FCR", type: "number", step: "0.001" },
    { key: "std_mortality_rate_pct", label: "Std Mortality Rate %", type: "number", step: "0.001" },
    { key: "output_item_id", label: "Output Item", type: "select-entity", searchable: true, entityEndpoint: "/item", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"] },
    { key: "output_uom", label: "Output UOM", type: "text" },
    { key: "std_output_qty", label: "Std Output Qty", type: "number", step: "0.001" },
    { key: "kpi_thresholds", label: "KPIs & Alerts", type: "json", helpText: "One entry per KPI, each with its own alert: [{ metric, lower_limit, upper_limit, severity }]. Severity is INFO, WARNING or CRITICAL." },
    // These two columns have existed on breed_lifecycle_stages since the schema
    // was written but were never exposed, so there was no way to record a
    // vaccination or medication plan for a breed at a stage at all.
    // Breed Master Template, Lifecycle sheet: "Resource Requirements". The
    // column existed and nothing on the form could fill it.
    { key: "resource_requirements", label: "Resource Requirements", type: "json", helpText: "Resources this breed needs at this stage, from the resource planner." },
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
        { key: "trigger_value", label: "At", type: "number", step: "0.5" },
        { key: "dose_ml", label: "Dose (ml)", type: "number", step: "0.01" },
        { key: "route", label: "Route", type: "select", options: ["IM", "SC", "IN", "ORAL"].map((v) => ({ value: v, label: v })) },
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
        { key: "withdrawal_days", label: "Withdrawal (days)", type: "number" },
      ],
      helpText: "One row per problem, as the farm's treatment card is written. Dose is free text because the card records it per head and per kg both.",
    },
    { key: "notes", label: "Notes", type: "textarea", helpText: "Shown as a tooltip on the data entry screen." },
    // TDD row 102 — traceability. The column has always been written; nothing
    // ever displayed it. hideInForm keeps it off the create/edit form while
    // readOnly lets the detail view through, which is the filter it checks.
    { key: "created_at", label: "Created At", type: "date", hideInForm: true, readOnly: true, hideInTable: true },
  ],
};

const reason: MasterDataConfig = {
  key: "reason", label: "Reasons", singular: "Reason", apiBase: "/reason", idKey: "reason_id",
  group: "Livestock & Health", isPrimary: true, businessAdminOnly: true,
  description: "Shared company reasons for mortality, culling, returns, selection, disposal and transfers. Only documented examples are loaded; Tenant and Company Admins maintain this catalog.",
  columns: [{ key: "reason_code", label: "Code" }, { key: "reason_name", label: "Name" }, { key: "category", label: "Category" }, { key: "mandatory_weight", label: "Weight Required" }],
  supportsNobLobFilter: true,
  fields: [
    { key: "nob_id", label: "Nature of Business", type: "select-entity", entityEndpoint: "/setup/wizard/nobs", entityValueKey: "nob_id", entityLabelKeys: ["nob_code", "nob_name"], helpText: "Leave blank if this reason is shared across all business verticals." },
    { key: "lob_id", label: "Line of Business", type: "select-entity", entityEndpoint: "/setup/wizard/lobs/{value}", entityValueKey: "lob_id", entityLabelKeys: ["lob_code", "lob_name"], dependsOn: "nob_id", helpText: "Leave blank if this reason is shared across all LOBs under the selected NOB." },
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "reason_code", label: "Reason Code", type: "text", required: true, createOnly: true },
    { key: "reason_name", label: "Reason Name", type: "text", required: true },
    { key: "category", label: "Category", type: "select", required: true, options: ["MORTALITY", "CULL", "RETURN", "SELECTION", "DISPOSAL", "TRANSFER"].map((value) => ({ value, label: value })) },
    { key: "applicable_stages", label: "Applicable Stages", type: "select-entity", multiple: true, entityEndpoint: "/stage", entityValueKey: "stage_code", entityLabelKeys: ["stage_code", "stage_name"], helpText: "Select the stages where this reason is available. Leave all unchecked for all stages." },
    { key: "mandatory_weight", label: "Weight Required", type: "boolean", helpText: "Reason requires a positive KG value when posting. Posting-screen integration is separate from this catalog." },
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
    { key: "batch_size", label: "Batch Size", type: "number", required: true, step: "0.01" },
    // Feed batches are always weighed out (KG/TONNE), never counted or measured
    // by volume, so this is filtered — unlike Item's Primary/Secondary UOM below,
    // which legitimately spans every type.
    { key: "batch_unit", label: "Batch Unit", type: "select-entity", required: true, entityEndpoint: "/uom?uomType=WEIGHT", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"] },
    { key: "description", label: "Description", type: "textarea" },
    {
      key: "ingredients", label: "Ingredients", type: "json", required: true, createOnly: true,
      jsonRow: [
        { key: "item_id", label: "Item", type: "select-entity", searchable: true, entityEndpoint: "/item", entityValueKey: "item_id", entityLabelKeys: ["item_code", "item_name"] },
        { key: "quantity", label: "Quantity", type: "number", step: "0.001" },
        { key: "unit", label: "Unit", type: "select-entity", entityEndpoint: "/uom?uomType=WEIGHT", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"] },
        { key: "inclusion_pct", label: "Inclusion %", type: "number", step: "0.01" },
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
    { key: "pincode", label: "Pincode", type: "text", section: "Contact" },
    { key: "tax_number", label: "Tax Registration No.", type: "text", placeholder: "GSTIN123456789A", section: "Commercial" },
    { key: "payment_terms", label: "Payment Terms", type: "text", placeholder: "NET30", section: "Commercial" },
    { key: "credit_limit", label: "Credit Limit", type: "number", step: "0.01", section: "Commercial" },
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
    { key: "mobile", label: "Mobile", type: "text", required: true, placeholder: "+919876543210", section: "Contact" },
    { key: "address_line1", label: "Address Line 1", type: "text", section: "Contact" },
    { key: "city", label: "City", type: "text", section: "Contact" },
    { key: "state", label: "State", type: "text", section: "Contact" },
    { key: "country", label: "Country", type: "text", section: "Contact" },
    { key: "pincode", label: "Pincode", type: "text", section: "Contact" },
    { key: "tax_number", label: "Tax Registration No.", type: "text", section: "Commercial" },
    { key: "credit_limit", label: "Credit Limit", type: "number", step: "0.01", section: "Commercial" },
  ],
};

const resource: MasterDataConfig = {
  key: "resource",
  label: "Resources",
  description: "Labor, equipment and vehicles used in operations.",
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
      // read as two ways to say the same thing. No resource uses LABOR — the
      // live counts are MANPOWER 4, EQUIPMENT 2, UTILITY 2 — so it is dropped
      // as a choice. Restore it here if a legacy row ever turns up needing it.
      options: ["MANPOWER", "EQUIPMENT", "VEHICLE", "UTILITY", "OTHER"].map((v) => ({ value: v, label: v })),
    },
    {
      key: "resource_sub_type", label: "Sub-Type", type: "select", section: "Identification",
      options: ["PERMANENT", "CONTRACT", "DAILY", "OWNED", "LEASED", "RENTED"].map((v) => ({ value: v, label: v })),
      helpText: "PERMANENT/CONTRACT/DAILY for labor; OWNED/LEASED/RENTED for equipment or vehicles.",
    },
    { key: "employee_id", label: "Employee ID", type: "text", placeholder: "EMP-001", helpText: "Labor/manpower only.", section: "People", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["MANPOWER", "LABOR"] }] } },
    { key: "designation", label: "Designation", type: "text", placeholder: "Senior Farm Worker", helpText: "Labor/manpower only.", section: "People", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["MANPOWER", "LABOR"] }] } },
    { key: "department", label: "Department", type: "text", placeholder: "Farm Operations", helpText: "Department or team.", section: "People", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["MANPOWER", "LABOR"] }] } },
    { key: "capacity", label: "Capacity", type: "number", step: "0.01", section: "Capacity & Cost" },
    // Left unfiltered: a resource's capacity spans LABOR (HEAD), EQUIPMENT (KG,
    // LITER for a tank, BAG for a mixer) and VEHICLE (TONNE) — no single type fits.
    { key: "capacity_uom", label: "Capacity UOM", type: "select-entity", entityEndpoint: "/uom", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"], section: "Capacity & Cost" },
    // Left unfiltered: cost rate is quoted per HOUR (labor), per KG/LITER (material
    // consumption), or per HEAD/trip — spans every type.
    { key: "unit", label: "Cost UOM", type: "select-entity", entityEndpoint: "/uom", entityValueKey: "uom_code", entityLabelKeys: ["uom_code", "uom_name"], section: "Capacity & Cost" },
    { key: "cost_rate", label: "Cost Rate", type: "number", step: "0.01", section: "Capacity & Cost" },
    { key: "cost_element", label: "Cost Element", type: "text", placeholder: "DIRECT_LABOR", helpText: "GL cost classification, e.g. DIRECT_LABOR / INDIRECT_LABOR / EQUIPMENT_HIRE / FUEL / MAINTENANCE.", section: "Capacity & Cost" },
    { key: "gl_cost_account", label: "GL Cost Account", type: "select-entity", searchable: true, entityEndpoint: "/gl-account", entityValueKey: "gl_account_id", entityLabelKeys: ["account_code", "account_name"], helpText: "GL account this resource posts cost to.", section: "Capacity & Cost" },
    { key: "asset_code", label: "Asset Code", type: "text", placeholder: "ASSET-PELLETISER-01", helpText: "Equipment/vehicle only.", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["EQUIPMENT", "VEHICLE"] }] } },
    { key: "asset_make", label: "Asset Make", type: "text", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["EQUIPMENT", "VEHICLE"] }] } },
    { key: "asset_model", label: "Asset Model", type: "text", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["EQUIPMENT", "VEHICLE"] }] } },
    { key: "asset_serial_no", label: "Asset Serial No.", type: "text", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["EQUIPMENT", "VEHICLE"] }] } },
    { key: "purchase_date", label: "Purchase Date", type: "date", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["EQUIPMENT", "VEHICLE"] }] } },
    { key: "warranty_expiry_date", label: "Warranty Expiry", type: "date", section: "Asset", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["EQUIPMENT", "VEHICLE"] }] } },
    { key: "maintenance_frequency_days", label: "Maintenance Frequency (days)", type: "number", helpText: "Days between scheduled services. Logging a completed service auto-calculates the next due date.", section: "Maintenance", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["EQUIPMENT", "VEHICLE"] }] } },
    { key: "maintenance_cost_per_service", label: "Est. Cost per Service", type: "number", step: "0.01", section: "Maintenance", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["EQUIPMENT", "VEHICLE"] }] } },
    { key: "maintenance_vendor", label: "Preferred Maintenance Vendor", type: "text", section: "Maintenance", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["EQUIPMENT", "VEHICLE"] }] } },
    { key: "last_maintenance_date", label: "Last Maintenance (system-tracked)", type: "date", hideInForm: true, section: "Maintenance" },
    { key: "next_maintenance_date", label: "Next Maintenance (system-tracked)", type: "date", hideInForm: true, section: "Maintenance" },
    { key: "license_expiry", label: "License Expiry", type: "date", helpText: "License/certification expiry — alert 30 days before.", section: "Maintenance", visibleWhen: { anyOf: [{ key: "resource_type", equals: ["EQUIPMENT", "VEHICLE"] }] } },
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
      key: "rate", label: "Rate (1 USD =)", type: "number", required: true, step: "0.000001", placeholder: "36.25",
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
  stage, numberSeries, activity,
  animal,
  itemCategory, itemType, uom, uomConversion, item, itemAttribute,
  species, breed, breedLifecycleStage, reason, disease, feedFormula,
  supplier, customer, resource,
  glAccount, glMapping, costCenter, country, currency, exchangeRate,
];

export const MASTER_DATA_GROUPS = ["Farm Operations", "Production", "Piggery", "Inventory", "Livestock & Health", "Business Partners", "Finance"] as const;

export function getConfig(key: string): MasterDataConfig | undefined {
  return MASTER_DATA_CONFIGS.find((c) => c.key === key);
}

export { STATUS_OPTIONS };
