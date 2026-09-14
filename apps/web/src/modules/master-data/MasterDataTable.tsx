"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Search, Loader2, Inbox, Eye, SlidersHorizontal, ArrowUpDown, X } from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { InlineAlert } from "@/components/ui/alert";
import { Pagination } from "@/components/ui/pagination";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getActiveCompanyId, getActiveWorkspaceScope, getStoredUser } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { MasterDataConfig, MasterDataField } from "./types";
import { CollapsibleCard } from "./CollapsibleCard";
import { singularLabel } from "./labels";
import AnimalDetailPanel from "./AnimalDetailPanel";
import { LookupCard } from "./LookupCard";
import { MASTER_DATA_CONFIGS } from "./configs";
import { codeFieldOf } from "./useCodeSeries";
import { useCodeSeries } from "./useCodeSeries";
import { MasterRecordView } from "./MasterRecordView";
import { BcOwnershipNotice } from "./BcOwnershipNotice";
import { EntityLookupField } from "./EntityLookupField";
import { SearchableEntitySelect } from "./SearchableEntitySelect";

const PAGE_SIZE = 25;

type Row = Record<string, any>;

const S = {
  surface: { backgroundColor: "var(--surface)", borderColor: "var(--border)" },
  raised: { backgroundColor: "var(--surface-raised)", borderColor: "var(--border)" },
  primary: { color: "var(--text-primary)" },
  sub: { color: "var(--text-secondary)" },
  muted: { color: "var(--text-muted)" },
  accent: { color: "var(--accent)" },
  input: { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" },
};

const inputCls = "nf-input";

function unwrap<T = any>(res: any): T {
  return (Array.isArray(res) ? res : res?.data ?? res) as T;
}

/**
 * An entity option's display text: its label keys joined, falling back to the
 * value it stores so a row with no label still renders as something.
 *
 * Used by the `searchable` popover. EntityLookupField builds the same string
 * from `labelKeys` itself, which is why the two look identical on screen.
 */
function entityLabel(row: Row, field: MasterDataField): string {
  const keys = field.entityLabelKeys || [];
  const text = keys.map((k) => row[k]).filter(Boolean).join(" — ");
  return text || row[field.entityValueKey || "id"];
}

function parentKeys(f: MasterDataField): string[] {
  if (!f.dependsOn) return [];
  return Array.isArray(f.dependsOn) ? f.dependsOn : [f.dependsOn];
}

/** A field's label as it should read right now: `labelWhen` lets it follow another field's
 * value (Tracking No. Series becomes "Lot No. Series" or "Serial No. Series"). */
function currentLabel(f: MasterDataField, values: Row): string {
  if (!f.labelWhen) return f.label;
  return f.labelWhen.labels[String(values[f.labelWhen.key] ?? "")] || f.label;
}

/** Whether `f` is required right now — statically, or via `requiredWhen` against the live form values. */
function isFieldRequired(f: MasterDataField, form: Row): boolean {
  if (f.required) return true;
  if (!f.requiredWhen) return false;
  return f.requiredWhen.anyOf.some((cond) => {
    const depValue = form[cond.key];
    if (cond.equals !== undefined) {
      const list = Array.isArray(cond.equals) ? cond.equals : [cond.equals];
      return list.includes(depValue);
    }
    return depValue !== undefined && depValue !== "" && depValue !== false && depValue !== null;
  });
}

/**
 * Resolves a select-entity field's actual endpoint.
 * - "path" mode (default, single parent): substitutes "{value}" with the parent's current
 *   value; returns null (blocking the field) while that parent is unset.
 * - "query" mode (one or more parents): appends each set parent as a query param via
 *   queryParams; unset parents are simply omitted rather than blocking the fetch.
 */
function resolveEndpoint(f: MasterDataField, form: Row): string | null {
  if (!f.entityEndpoint) return null;
  const parents = parentKeys(f);
  if (parents.length === 0) return f.entityEndpoint;

  if (f.dependsOnMode === "query") {
    const params = new URLSearchParams();
    for (const key of parents) {
      const raw = form[key];
      const paramName = f.queryParams?.[key];
      // A field may translate the parent's value before sending it — item_type
      // LIVESTOCK narrows the UOM list to COUNT, not to "LIVESTOCK". An
      // unmapped value omits the param and leaves the list unfiltered.
      const map = f.queryValueMap?.[key];
      const val = map ? (raw ? map[String(raw)] : undefined) : raw;
      if (val && paramName) params.set(paramName, val);
    }
    const qs = params.toString();
    // entityEndpoint may already carry a query string (e.g.
    // "/item-category?rootOnly=true"), so append rather than assume — the same
    // rule the option-fetch effects use. Hardcoding "?" here would produce
    // "...?rootOnly=true?itemType=X" and the first value would swallow the rest.
    return qs ? `${f.entityEndpoint}${f.entityEndpoint.includes("?") ? "&" : "?"}${qs}` : f.entityEndpoint;
  }

  const parentVal = form[parents[0]];
  if (!parentVal) return null;
  return f.entityEndpoint.replace("{value}", parentVal);
}

function displayValue(row: Row, key: string, yesLabel: string, noLabel: string): string {
  if ((key === "stage" || key === "stage_id") && (row.stage || row.stage_name || row.stage_code)) {
    return String(row.stage || row.stage_name || row.stage_code);
  }
  const v = row[key];
  if (v === null || v === undefined || v === "") {
    if (key === "stage" || key === "stage_id") {
      return row.stage || row.stage_name || row.stage_code || "—";
    }
    return "—";
  }
  if (typeof v === "boolean") return v ? yesLabel : noLabel;
  // A list column is a list of values, not the JSON that carried them. The euro
  // read `["DE","FR","NL"]` in the Countries column, brackets and quotes and
  // all, because every object fell through to JSON.stringify.
  if (Array.isArray(v)) return v.length ? v.map((entry) => String(entry)).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Normalizes a "string-list" field's stored value into chip-editor state. Handles the
 * already-parsed-array shape the API returns, a JSON-encoded string (in case a raw value ever
 * round-trips through text), and anything else (null, a JSON string rather than an array, or
 * invalid JSON) by falling back to an empty list rather than throwing.
 */
function parseStringList(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.trim() !== "") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function entityRestrictionState(
  field: MasterDataField,
  values: Record<string, any>,
  allOptions: Record<string, Record<string, any>[]>,
): { selected: boolean; resolved: boolean; allowedCodes: string[]; hidden: boolean } | undefined {
  const restriction = field.restrictOptionsBy;
  if (!restriction) return undefined;

  const selectedCode = String(values[restriction.selectorKey] ?? "");
  const selectorRows = allOptions[restriction.selectorEntityEndpoint];
  const selectorRow = selectorRows?.find(
    (row) => String(row[restriction.selectorCodeKey] ?? "") === selectedCode,
  );
  const allowedCodes = selectorRow ? parseStringList(selectorRow[restriction.allowListKey]) : [];
  const selected = selectedCode.length > 0;
  const resolved = selectorRows !== undefined;

  return {
    selected,
    resolved,
    allowedCodes,
    hidden: !!restriction.hideWhenEmpty && (!selected || (resolved && allowedCodes.length === 0)),
  };
}

/**
 * Splits the two states a `requiresParent` field can be in, which used to be
 * collapsed into one and both answered by removing the field from the form:
 *
 * - `hidden` — no parent chosen yet. There is nothing to filter by, so the
 *   picker would list the whole catalog; not offering it is right. This is what
 *   requiresParent was added for (Sub Category once listed every category in
 *   the tenant while no Category was selected).
 * - `empty` — a parent IS chosen and the filtered list came back with nothing.
 *   The field stays on the form, disabled, saying so. Deleting it instead left
 *   a silent dead end: five of the ten item types have no categories, so
 *   choosing one made Category disappear, and Sub Category disappeared behind
 *   it because its own parent could then never be filled. Nothing on screen
 *   said why, and the help text explaining it was attached to a field that was
 *   no longer rendered.
 *
 * A still-in-flight fetch is neither: the field stays put so it does not
 * flicker in and out while options load.
 */
export function parentFilterState(
  field: MasterDataField,
  values: Record<string, any>,
  allOptions: Record<string, Record<string, any>[]>,
): { hidden: boolean; empty: boolean } {
  if (!field.requiresParent) return { hidden: false, empty: false };
  const parents = parentKeys(field);
  if (!parents.every((key) => !!values[key])) return { hidden: true, empty: false };
  const endpoint = resolveEndpoint(field, values);
  const loaded = endpoint ? allOptions[endpoint] : undefined;
  if (loaded === undefined) return { hidden: false, empty: false };
  return { hidden: false, empty: loaded.length === 0 };
}

/**
 * The path part of an entity endpoint: no query string, no "{value}" path
 * parameter. "/item-category?rootOnly=true" and "/setup/wizard/lobs/{value}"
 * become "/item-category" and "/setup/wizard/lobs".
 */
function endpointPath(endpoint: string): string {
  return endpoint.split("?")[0].split("/{")[0].replace(/\/+$/, "");
}

/**
 * The masters that fill a screen's dropdowns — what the "Dropdown options come
 * from" row names, and what the dialog renders as inline lookup cards.
 *
 * Derived from the select-entity fields themselves, each one's endpoint being
 * another master's apiBase, and unioned with the hand-declared `lookupFor`.
 * Declaring it by hand covered five masters and silently missed the rest; a
 * field added later is picked up here with no second place to remember.
 *
 * Three things the earlier derivation got wrong:
 *
 * - It read only top-level fields, so a master reached purely through a
 *   `jsonRow` row editor — Item Attributes, under Items' Attribute Values —
 *   was the one master the row never mentioned.
 * - It truncated an endpoint at its first slash, which credits "/uom" for a
 *   reference to "/uom/conversion". The longest matching apiBase wins instead.
 * - The caller filtered Business Central-owned masters out of the chips while
 *   rendering them as cards, on the reasoning that they could not be saved.
 *   They can: `readOnly` here tracks administration rights, not BC ownership,
 *   and a BC catalog is created and edited locally until that integration is
 *   connected. BcOwnershipNotice still states the provenance.
 */
export function lookupMastersFor(
  config: MasterDataConfig,
  all: MasterDataConfig[] = MASTER_DATA_CONFIGS,
): MasterDataConfig[] {
  const endpoints = config.fields
    .flatMap((f) => [f, ...(f.jsonRow || [])])
    .filter((f) => f.type === "select-entity" && f.entityEndpoint)
    .map((f) => endpointPath(f.entityEndpoint!));
  // Ordered by where the field sits on the form, not by where the master
  // happens to sit in the registry. Registry order listed Item Categories
  // before Item Types on the Item screen, while the form asks Item Type first
  // and Category cannot be answered until it is — so the row read in the
  // opposite order to the work.
  //
  // An endpoint no master serves — /setup/wizard/nobs, /costing-method,
  // /goods-receipt — resolves to nothing and names no master, which is right:
  // NOB and LOB come from the setup wizard, not from a master on this screen.
  const seen = new Set<string>([config.key]);
  const ordered: MasterDataConfig[] = [];
  for (const path of endpoints) {
    const owner = all
      .filter((c) => path === c.apiBase || path.startsWith(c.apiBase + "/"))
      .sort((a, b) => b.apiBase.length - a.apiBase.length)[0];
    if (!owner || seen.has(owner.key)) continue;
    seen.add(owner.key);
    ordered.push(owner);
  }
  // A master that declares itself a lookup for this screen without sitting
  // behind any field on it has no field position to take, so it follows in
  // registry order.
  for (const c of all) {
    if (seen.has(c.key) || !c.lookupFor?.includes(config.key)) continue;
    seen.add(c.key);
    ordered.push(c);
  }
  return ordered;
}

export default function MasterDataTable({ config }: { config: MasterDataConfig }) {
  const { t, tLabel } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [entityOptions, setEntityOptions] = useState<Record<string, Row[]>>({});
  /**
   * A real record of the master a "field-list" field is configuring, so the
   * example shows the codes this tenant actually uses rather than a placeholder
   * of the shape. UUID references are resolved to the code they point at, which
   * is what the generator writes.
   */
  const [sampleRecord, setSampleRecord] = useState<{ master: string; values: Record<string, string> }>();
  // Per derived field: "found" when the source master already holds the value
  // (so it is filled and locked), "missing" when it does not (so it is asked
  // for here and recorded), undefined while the parents are incomplete.
  const [derived, setDerived] = useState<Record<string, "found" | "missing">>({});

  const [nobFilterOptions, setNobFilterOptions] = useState<Row[]>([]);
  const [lobFilterOptions, setLobFilterOptions] = useState<Row[]>([]);
  const [nobFilter, setNobFilter] = useState("");
  const [lobFilter, setLobFilter] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [form, setForm] = useState<Row>({});
  // Pending, not-yet-added input text for each "string-list" field's chip editor, keyed by field key.
  const [chipDrafts, setChipDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [entityReloadKey, setEntityReloadKey] = useState(0);
  const [lookupManager, setLookupManager] = useState<MasterDataConfig | null>(null);
  const lastEntityReloadKeyRef = useRef(entityReloadKey);

  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  /**
   * Row count for the whole filtered table, from the API.
   *
   * null means this master has not moved to the shared list contract yet (see
   * api/src/common/master-list-query.ts) and still answers with a plain array.
   * Those keep the old behaviour — fetch a window and slice it here — so the
   * two styles can coexist while the contract is rolled out, rather than every
   * master having to change on the same day.
   */
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  /**
   * Two copies deliberately. `colFilters` is what the list is filtered by;
   * `filterDraft` is what the drawer is editing. They diverge while the drawer
   * is open and rejoin on Apply, which is what makes the filters deferred —
   * typing in the panel does not refetch on every keystroke, and closing it
   * without applying leaves the list exactly as it was.
   */
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [filterDraft, setFilterDraft] = useState<Record<string, string>>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const isDesktop = useIsDesktop();

  const workspaceScope = getActiveWorkspaceScope();
  const companyId = workspaceScope === "TENANT" ? null : getActiveCompanyId();
  // BBP-1 §1.5 and §1.6 put Items and the Chart of Accounts in Business Central:
  // "NAVFarm cannot create items independently", "NAVFarm does NOT maintain its own
  // Chart of Accounts". That integration is not built, so until it is, these stay
  // locally editable and the notice states the blueprint's position rather than
  // the screen pretending a BC connection exists. Rishi's call, 2026-09-06.
  const bcOwned = config.owner === "BC";
  const administrationRestricted = !!config.businessAdminOnly && !["TENANT_ADMIN", "COMPANY_ADMIN"].includes(getStoredUser()?.userType || "");
  const readOnly = administrationRestricted;
  const numbering = useCodeSeries(config.key, form, modalOpen && !editing);
  // A failed code preview used to disable Create outright. For a master whose
  // code is optional — UOM Conversion says "leave blank until the numbering
  // convention is agreed" — that made an unrelated preview problem block the
  // whole record. Only a mandatory code can stop a save; otherwise the message
  // stands as a warning and the row saves without a code.
  const codeIsMandatory = !!config.fields.find((f) => f.key === numbering.codeKey)?.required;
  const numberingBlocks = !!numbering.error && codeIsMandatory;
  // A derived field is read-only once its source master supplies the value, and
  // required while it does not — that is the moment the number is captured.
  const applyDerived = (f: MasterDataField): MasterDataField => {
    if (!f.derivedFrom) return f;
    const state = derived[f.key];
    if (state === "found") return { ...f, readOnly: true, required: false, helpText: `From ${f.derivedFrom.endpoint.replace(/^\//, "")} — the stored factor for these units.` };
    if (state === "missing") return { ...f, readOnly: false, required: true, helpText: f.derivedFrom.missingHelpText || f.helpText };
    return { ...f, readOnly: true, helpText: f.helpText };
  };
  const formFields = config.fields.map(numbering.field).map(applyDerived).filter((f) => !f.hideInForm && !(workspaceScope === "OPERATIONAL" && ["nob_id", "lob_id"].includes(f.key)));
  // A master can be exhausted: Number Series takes exactly one row per master,
  // so once every master has one there is nothing left to add and the button
  // should go rather than open a form whose only required picker is empty.
  // Driven by the same endpoint the picker uses, so the two cannot disagree.
  const exhaustingField = config.fields.find((f) => f.required && f.createOnly && f.type === "select-entity" && f.entityEndpoint);
  const exhausted = (() => {
    if (!exhaustingField?.entityEndpoint) return false;
    const loaded = entityOptions[exhaustingField.entityEndpoint];
    return Array.isArray(loaded) && loaded.length === 0;
  })();

  const visibleFields = (editing ? formFields.filter((f) => !f.createOnly) : formFields.filter((f) => !f.editOnly))
    .filter((f) => !f.visibleWhen || isFieldRequired({ ...f, required: false, requiredWhen: f.visibleWhen }, form))
    .filter((f) => !entityRestrictionState(f, form, entityOptions)?.hidden)
    // Only the "no parent chosen yet" half hides the field; an empty filtered
    // list keeps it, disabled, so the form can say why it has nothing to offer.
    .filter((f) => !parentFilterState(f, form, entityOptions).hidden);
  const columns = config.columns || config.fields.filter((f) => !f.hideInTable).slice(0, 5);
  // Status and Active are different facts — Status is the master's domain
  // state, Active is whether the record is live at all — but a master that
  // cannot toggle Active here has nothing to put in that column except a word
  // its Status column has already said.
  //
  // Animal Register is that case. Breed has @Delete(':id') and
  // @Patch(':id/restore'), which is what its switch calls; Animal has neither,
  // because an animal is not deactivated, it is disposed — and dispose() blocks
  // on medicine withdrawal periods and posts the gain or loss. So the column
  // could only ever be a dead badge there. Rishi's call: drop it.
  const ownsStatusColumn = columns.some((c) => c.key === "status");
  // Master-detail: clicking a row narrows the list and opens a panel beside it,
  // for masters where one record has enough behind it to be worth reading on
  // its own. Only Animal Register qualifies today.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailFor = config.detailPanel;
  const selectedRow = detailFor ? rows.find((r) => String(r[config.idKey]) === selectedId) : undefined;
  const statusActiveValues = config.statusActiveValues;
  const lookupConfigs = lookupMastersFor(config);
  const sectionCount = new Set(visibleFields.map((f) => f.section || "Identification")).size;
  // Business Central-style adaptive presentation: compact masters remain a
  // centred modal, while a dense or multi-card master gets a near-full-page
  // dialog with its own scrolling body and pinned actions.
  /**
   * The chips, which are not quite the cards.
   *
   * A BC-owned catalog belongs here: it is not read-only — `readOnly` above
   * tracks administration rights — and until the Business Central integration
   * is connected these are created and edited locally against our own
   * database. Withholding the chip while the dialog offered the very same
   * master as a card said two different things about one catalog, and the card
   * was the one telling the truth.
   *
   * What does not belong here is a master sharing this screen's own tab bar.
   * Item Attributes is a tab of Items; offering a chip that opens it in a modal
   * duplicates a tab sitting inches above it. The cards keep it, because a
   * half-filled form cannot be abandoned to go and click a tab — which is
   * exactly the difference between the two affordances.
   */
  const tabGroup = (c: MasterDataConfig) => c.tabOf ?? c.key;
  const manageableLookups = lookupConfigs.filter((c) => tabGroup(c) !== tabGroup(config));
  const usePageDialog = visibleFields.length > 10 || sectionCount > 3 || lookupConfigs.length > 2;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (search) params.set("search", search);
      if (config.supportsNobLobFilter && nobFilter) params.set("nobId", nobFilter);
      if (config.supportsNobLobFilter && lobFilter) params.set("lobId", lobFilter);
      // Ask for exactly the page being shown. The previous request was always
      // limit=200 with no offset, sliced in the browser — which silently capped
      // every master at 200 rows. MULTIPLIER's locations alone are 508.
      params.set("limit", String(pageSize));
      params.set("offset", String((page - 1) * pageSize));
      if (sortKey) { params.set("sort", sortKey); params.set("dir", sortDir); }
      for (const [key, value] of Object.entries(colFilters)) {
        if (value !== "") params.set(`filter[${key}]`, value);
      }
      const res = await api.get(`${config.apiBase}?${params.toString()}`);
      const list = unwrap<Row[]>(res);
      setRows(Array.isArray(list) ? list : []);
      // A master still on the old shape reports no total, and is paged here as
      // before. One that reports a total has already sorted, filtered and paged
      // in SQL, so the rows in hand are the page.
      const total = (res as { total?: unknown })?.total;
      setServerTotal(typeof total === "number" ? total : null);
    } catch (err: any) {
      setError(err?.message || t("mdFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [config.key, search, nobFilter, lobFilter, page, pageSize, sortKey, sortDir, colFilters]);

  // Anything that changes which rows match sends you back to the first page —
  // page 7 of a filtered list that now has two pages is not a page.
  useEffect(() => { setPage(1); }, [config.key, search, nobFilter, lobFilter, pageSize, colFilters]);

  // A different master has different columns, so neither the sort nor the
  // column filters carry over to it.
  useEffect(() => {
    setSortKey(""); setSortDir("asc");
    setColFilters({}); setFilterDraft({}); setFilterOpen(false);
  }, [config.key]);

  // The server returns the page, so these are the rows. Slicing here is what
  // capped every master at the 200 rows the old request asked for.
  /**
   * The closed set of values a column can be filtered to, or undefined when the
   * column is free text.
   *
   * Read off the field behind the column: a static `select` contributes its own
   * options, and a `select-entity` contributes whatever its master returned —
   * those lists are already fetched on mount for the form's pickers, so the
   * filter costs no extra request. A column with no field behind it (a joined
   * display value such as an item's category_code) is free text.
   *
   * Entity options are matched on the value the row actually stores, which is
   * the field's entityValueKey — the same distinction the form makes between a
   * stored uom_code and a stored UUID.
   */
  const filterChoicesFor = (key: string): { value: string; label: string }[] | undefined => {
    const field = config.fields.find((f) => f.key === key);
    if (!field) return undefined;
    if (field.type === "boolean") return [{ value: "true", label: t("mdYes") }, { value: "false", label: t("mdNo") }];
    if (field.type === "select") return field.options?.length ? field.options : undefined;
    if (field.type !== "select-entity" || field.dependsOn || !field.entityEndpoint) return undefined;
    const loaded = entityOptions[field.entityEndpoint];
    if (!loaded?.length) return undefined;
    const valueKey = field.entityValueKey || "id";
    const labelKeys = field.entityLabelKeys || [];
    return loaded
      .map((row) => ({
        value: String(row[valueKey] ?? ""),
        label: labelKeys.map((k) => row[k]).filter(Boolean).join(" — ") || String(row[valueKey] ?? ""),
      }))
      .filter((o) => o.value !== "");
  };

  /**
   * What to call a column in the filter panel.
   *
   * A table header is read with the column of values under it, so Stages can
   * head its sequence column "#" and be perfectly clear. Stripped of that
   * context and put on a filter input, "#" says nothing — the field behind it
   * calls itself "Display Order", which is the name to use.
   */
  const filterLabelFor = (key: string, columnLabel: string) => {
    const field = config.fields.find((f) => f.key === key);
    const label = field && field.label.length > columnLabel.length ? field.label : columnLabel;
    return tLabel(label);
  };

  /**
   * One filter body, two shells. Beside the table on a desktop, where there is
   * room and keeping the rows visible is the point; as a dialog below `lg`,
   * where a 340px column would leave the table 20px wide and the honest thing
   * is to interrupt. Rendered once either way — a `hidden lg:block` pair would
   * mount both and duplicate every input's id.
   */
  const filterFields = (
    <div className="flex flex-col gap-4">
      {columns.map((c) => {
        const choices = filterChoicesFor(c.key);
        const value = filterDraft[c.key] ?? "";
        const fieldId = `master-${config.key}-filter-${c.key}`;
        const set = (next: string) =>
          setFilterDraft((prev) => {
            const out = { ...prev };
            if (next === "") delete out[c.key];
            else out[c.key] = next;
            return out;
          });
        return (
          <Field key={c.key} label={filterLabelFor(c.key, c.label)} htmlFor={fieldId}>
            {choices ? (
              <select id={fieldId} className={`${inputCls} nf-select`} style={S.input}
                value={value} onChange={(e) => set(e.target.value)}>
                <option value="">{t("mdFilterAll")}</option>
                {choices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              // Wrapped in asterisks on the way out: a column filter is a
              // "contains", so a partial code finds its rows. The stars are the
              // wire format, never shown to the person typing.
              <input id={fieldId} className={inputCls} style={S.input}
                value={value.replace(/^\*|\*$/g, "")} placeholder={t("mdFilterAny")}
                onChange={(e) => set(e.target.value ? `*${e.target.value}*` : "")} />
            )}
          </Field>
        );
      })}
    </div>
  );

  // Apply closes the dialog on a phone, where the list is behind it;
  // on a desktop the panel stays open beside the rows it just filtered.
  const filterActions = (
    <>
      <button type="button" onClick={() => { setFilterDraft({}); setColFilters({}); }}
        className="rounded-lg border px-3 py-1.5 text-xs font-medium" style={S.surface}>
        {t("mdFiltersReset")}
      </button>
      <button type="button" onClick={() => { setColFilters(filterDraft); if (!isDesktop) setFilterOpen(false); }}
        className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
        style={{ backgroundColor: "var(--accent)" }}>
        {t("mdFiltersApply")}
      </button>
    </>
  );

  /** How many column filters are actually in force, for the button's badge. */
  const appliedFilterCount = Object.values(colFilters).filter((v) => v !== "").length;

  const pagedRows = rows;
  /**
   * What the pager counts. A master on the shared list contract reports the
   * real total. One that does not yet report a total still pages correctly —
   * every findAll honours limit and offset — so the count is "everything up to
   * here, plus more if this page came back full", which keeps Next reachable
   * without inventing a total.
   */
  const pagerTotal = serverTotal ?? (page - 1) * pageSize + rows.length + (rows.length === pageSize ? 1 : 0);

  useEffect(() => {
    if (!config.supportsNobLobFilter || workspaceScope === "OPERATIONAL") return;
    setNobFilter("");
    setLobFilter("");
    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    params.set("limit", "500");
    api.get(`/setup/wizard/nobs?${params.toString()}`).then((r) => setNobFilterOptions(unwrap<Row[]>(r) || [])).catch(() => setNobFilterOptions([]));
  }, [config.key]);

  useEffect(() => {
    if (!config.supportsNobLobFilter || !nobFilter) { setLobFilterOptions([]); return; }
    api.get(`/setup/wizard/lobs/${nobFilter}`).then((r) => setLobFilterOptions(unwrap<Row[]>(r) || [])).catch(() => setLobFilterOptions([]));
  }, [config.supportsNobLobFilter, nobFilter]);

  useEffect(() => {
    // Includes the select-entity columns nested inside a jsonRow, whose
    // dropdowns are otherwise never populated because they are not top-level
    // fields.
    const endpoints = Array.from(
      new Set([...config.fields, ...config.fields.flatMap((f) => f.jsonRow || [])]
        .filter((f) => f.type === "select-entity" && f.entityEndpoint && !f.dependsOn)
        .map((f) => f.entityEndpoint!))
    );
    endpoints.forEach(async (ep) => {
      try {
        const params = new URLSearchParams();
        if (companyId) params.set("companyId", companyId);
        params.set("limit", "500");
        // A picker must only offer rows the API will actually accept — unlike
        // the list page, which deliberately shows Active/Inactive rows so a
        // blocked one can be found and restored. isActive=true is a no-op on
        // endpoints that already always filter to active (e.g. NOB/LOB,
        // costing-method) and is honored by every findAll that carries the
        // isActive query param.
        params.set("isActive", "true");
        // ep may already carry a query string (e.g. "/item?itemType=LIVING_ASSET"),
        // so append rather than assume — the same rule the dependent-field effect
        // below uses. Hardcoding "?" produced "/item?itemType=X?companyId=..." and
        // the filter value silently swallowed the rest of the query.
        const res = await api.get(`${ep}${ep.includes("?") ? "&" : "?"}${params.toString()}`);
        const list = unwrap<Row[]>(res);
        setEntityOptions((prev) => ({ ...prev, [ep]: Array.isArray(list) ? list : [] }));
      } catch {
        setEntityOptions((prev) => ({ ...prev, [ep]: prev[ep] || [] }));
      }
    });
    // entityReloadKey is included so a lookup card's inline "Add" (e.g. a
    // new Item Category, Item Type or UOM) refetches this effect's
    // non-dependent select-entity fields — category_id, item_type,
    // uom_primary/uom_secondary all have no dependsOn, so this is the
    // effect that actually powers those dropdowns, not the dependent-fields
    // effect below.
  }, [config.key, entityReloadKey]);

  useEffect(() => {
    if (!modalOpen) return;
    const listField = config.fields.find((f) => f.type === "field-list" && f.fieldsOf);
    if (!listField) return;
    const masterKey = String(form[listField.fieldsOf!] || editing?.[listField.fieldsOf!] || "")
      .toLowerCase().replaceAll("_", "-");
    const target = MASTER_DATA_CONFIGS.find((c) => c.key === masterKey);
    if (!target || sampleRecord?.master === masterKey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`${target.apiBase}?limit=1`);
        const row = (unwrap<Row[]>(res) || [])[0];
        if (!row) { if (!cancelled) setSampleRecord({ master: masterKey, values: {} }); return; }
        const values: Record<string, string> = {};
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        for (const col of target.fields) {
          const raw = row[col.key];
          if (raw === null || raw === undefined || raw === "") continue;
          if (col.type === "select-entity" && col.entityEndpoint && uuid.test(String(raw))) {
            // The generator writes the referenced row's code, not its id.
            try {
              const ref = await api.get(`${col.entityEndpoint.split("?")[0]}/${encodeURIComponent(String(raw))}`);
              const data: any = (ref as any)?.data ?? ref;
              values[col.key] = String(data?.[col.entityLabelKeys?.[0] || ""] ?? "");
            } catch { /* leave it out rather than show an id */ }
          } else {
            values[col.key] = String(raw);
          }
        }
        if (!cancelled) setSampleRecord({ master: masterKey, values });
      } catch { if (!cancelled) setSampleRecord({ master: masterKey, values: {} }); }
    })();
    return () => { cancelled = true; };
  }, [modalOpen, config.fields, form, editing, sampleRecord?.master]);

  // Put a row in place for every mandatory entry of a `requiredRows` list, and
  // keep it there. An item attribute marked Mandatory applies to every item in
  // scope, so the item form should open already showing it rather than relying
  // on whoever fills the form to remember. Only presence is seeded — the value
  // is theirs to type.
  useEffect(() => {
    if (!modalOpen) return;
    for (const f of config.fields.filter((x) => x.requiredRows)) {
      const r = f.requiredRows!;
      const options = entityOptions[r.endpoint];
      if (!options) continue;
      const required = options.filter((o) => o[r.flag] === true || o[r.flag] === 1);
      if (!required.length) continue;
      setForm((prev) => {
        let rows: Row[] = [];
        try { const parsed = prev[f.key] ? JSON.parse(prev[f.key]) : []; if (Array.isArray(parsed)) rows = parsed; } catch { return prev; }
        const missing = required.filter((o) => !rows.some((row) => String(row[r.key] ?? "") === String(o[r.key])));
        if (!missing.length) return prev;
        return { ...prev, [f.key]: JSON.stringify([...missing.map((o) => ({ [r.key]: o[r.key] })), ...rows]) };
      });
    }
  }, [modalOpen, config.key, entityOptions, form]);

  // Fill a derivedFrom field from its source master. The Item Master Template
  // says the UOM Conversion Factor is "Auto-filled from uom_conversion_master",
  // so when that table already holds the pair the number is shown and locked;
  // when it does not, the field stays open so the factor is captured once, here,
  // and saved into UOM Conversion rather than living only on the item.
  useEffect(() => {
    if (!modalOpen) return;
    let cancelled = false;
    for (const f of config.fields.filter((x) => x.derivedFrom)) {
      const d = f.derivedFrom!;
      const params = new URLSearchParams();
      let complete = true;
      for (const [fieldKey, paramName] of Object.entries(d.params)) {
        const v = form[fieldKey];
        if (!v) { complete = false; break; }
        params.set(paramName, String(v));
      }
      if (!complete) {
        setDerived((prev) => (prev[f.key] === undefined ? prev : { ...prev, [f.key]: undefined as any }));
        continue;
      }
      if (companyId) params.set("companyId", companyId);
      api.get(`${d.endpoint}${d.endpoint.includes("?") ? "&" : "?"}${params}`).then((res: any) => {
        if (cancelled) return;
        const rows = unwrap<Row[]>(res) || [];
        const hit = Array.isArray(rows) ? rows[0] : undefined;
        if (hit && hit[d.valueKey] != null) {
          setDerived((prev) => ({ ...prev, [f.key]: "found" }));
          setForm((prev) => ({ ...prev, [f.key]: String(hit[d.valueKey]) }));
        } else {
          setDerived((prev) => ({ ...prev, [f.key]: "missing" }));
        }
      }).catch(() => { if (!cancelled) setDerived((prev) => ({ ...prev, [f.key]: "missing" })); });
    }
    return () => { cancelled = true; };
    // Re-runs when a parent value changes: the fields named in every
    // derivedFrom's params are the real dependency.
  }, [modalOpen, companyId, config.key,
      ...config.fields.filter((x) => x.derivedFrom).flatMap((x) => Object.keys(x.derivedFrom!.params).map((k) => form[k]))]);

  useEffect(() => {
    if (!modalOpen) return;
    const dependentFields = config.fields.filter((f) => f.type === "select-entity" && f.dependsOn);
    // entityReloadKey changing means a lookup card just created a row that a
    // dependent dropdown here may need to see. The early return below skips
    // endpoints already cached in entityOptions, which would otherwise make
    // entityReloadKey a no-op dependency - so on a genuine key change, clear
    // this effect's cached endpoints first to force a real refetch.
    const reloadKeyChanged = lastEntityReloadKeyRef.current !== entityReloadKey;
    lastEntityReloadKeyRef.current = entityReloadKey;
    if (reloadKeyChanged) {
      const eps = new Set(dependentFields.map((f) => resolveEndpoint(f, form)).filter((ep): ep is string => !!ep));
      if (eps.size) {
        setEntityOptions((prev) => {
          const next = { ...prev };
          eps.forEach((ep) => { delete next[ep]; });
          return next;
        });
      }
    }
    dependentFields.forEach(async (f) => {
      const ep = resolveEndpoint(f, form);
      if (!ep || (!reloadKeyChanged && entityOptions[ep])) return;
      try {
        // Same active-only rule as the non-dependent effect above — a picker
        // must not offer a row the API will reject. ep may already carry a
        // query string (dependsOnMode "query"), so append rather than assume.
        const activeOnlyEp = `${ep}${ep.includes("?") ? "&" : "?"}isActive=true`;
        const res = await api.get(activeOnlyEp);
        const list = unwrap<Row[]>(res);
        setEntityOptions((prev) => ({ ...prev, [ep]: Array.isArray(list) ? list : [] }));
      } catch {
        setEntityOptions((prev) => ({ ...prev, [ep]: [] }));
      }
    });
  }, [modalOpen, form, config.key, entityReloadKey]);

  const openCreate = () => {
    if (readOnly) return;
    setEditing(null);
    const initial: Row = {};
    formFields.forEach((f) => { initial[f.key] = f.type === "boolean" ? false : f.type === "string-list" || f.type === "field-list" || f.multiple ? [] : ""; });
    setForm(initial);
    setFormError("");
    setChipDrafts({});
    setModalOpen(true);
  };

  const openEdit = (row: Row) => {
    if (readOnly) return;
    setEditing(row);
    const initial: Row = {};
    // MySQL tinyint reaches here as 1 as readily as true, and both mean set.
    const columnIsOn = (key: string) => row[key] === true || row[key] === 1;
    formFields.filter((f) => !f.createOnly).forEach((f) => {
      // A form-only control has no column of its own, so its state has to be
      // read back out of the columns it stands for — otherwise an item that is
      // already lot-tracked opens with the tracking gate off and its own
      // tracking fields hidden.
      if (f.booleanColumns) {
        initial[f.key] = Object.entries(f.booleanColumns).find(([, column]) => columnIsOn(column))?.[0] ?? "";
        return;
      }
      if (f.seedFromAnyTrue) {
        initial[f.key] = f.seedFromAnyTrue.some(columnIsOn);
        return;
      }
      if (f.seedFromValueOf) {
        const stored = row[f.seedFromValueOf];
        initial[f.key] = stored !== null && stored !== undefined && stored !== "" && Number(stored) !== 0;
        return;
      }
      let v = row[f.key];
      if (f.type === "string-list" || f.type === "field-list" || f.multiple) {
        initial[f.key] = parseStringList(v);
        return;
      }
      if (f.type === "json" && v && typeof v !== "string") {
        if (f.jsonListKeys && Array.isArray(v)) {
          v = v.map((entry: Row) => {
            const picked: Row = {};
            f.jsonListKeys!.forEach((k) => { if (entry[k] !== undefined) picked[k] = entry[k]; });
            return picked;
          });
        }
        v = JSON.stringify(v, null, 2);
      }
      initial[f.key] = v ?? (f.type === "boolean" ? false : "");
    });
    setForm(initial);
    setFormError("");
    setChipDrafts({});
    setModalOpen(true);
  };

  const setField = (key: string, value: any) => setForm((prev) => {
    const next = { ...prev, [key]: value };
    if (config.key === "location" && key === "location_type" && value === "SILO") next.storage_type = "SILO";
    if (config.key === "location" && key === "storage_type" && value !== "SILO") {
      next.silo_capacity_kg = "";
      next.silo_reorder_days = "";
    }
    config.fields.forEach((f) => {
      if (parentKeys(f).includes(key) && next[f.key]) next[f.key] = "";
    });
    // A switch that gates real columns has to clear them, not just hide them —
    // a hidden prefix still ends up in the code.
    const toggled = config.fields.find((f) => f.key === key);
    if (toggled?.clearsWhenOff && value === false) {
      for (const [k, v] of Object.entries(toggled.clearsWhenOff)) next[k] = v;
    }
    if (value) {
      const changedField = config.fields.find((f) => f.key === key);
      (changedField?.exclusiveWith || []).forEach((otherKey) => { next[otherKey] = ""; });
    }
    // A control that appears part-way through the form starts on its stated
    // default rather than on nothing. Tracked By is a choice between two, not
    // three: "neither" is what the switch above it already says, so turning
    // tracking on lands on Lot until someone says otherwise.
    config.fields.forEach((f) => {
      if (f.defaultValue === undefined) return;
      const shown = !f.visibleWhen || isFieldRequired({ ...f, required: false, requiredWhen: f.visibleWhen }, next);
      if (shown && (next[f.key] === "" || next[f.key] === undefined)) next[f.key] = f.defaultValue;
    });
    return next;
  });

  const handleSave = async () => {
    if (readOnly) return;
    setSaving(true);
    setFormError("");
    try {
      for (const f of visibleFields) {
        // filterOnly normally means "not saved, so nothing to check". A control
        // standing in for real columns is the exception: it is not sent under
        // its own key, but it does decide what gets written.
        if (f.filterOnly && !f.booleanColumns) continue;
        const v = form[f.key];
        const isEmpty = v === "" || v === undefined || v === null || (Array.isArray(v) && !v.length);
        if (isEmpty && isFieldRequired(f, form)) {
          throw new Error(`"${tLabel(currentLabel(f, form))}" is required.`);
        }
      }

      const payload: Row = {};
      // What a switch turns off has to be sent as cleared, not omitted. These
      // fields are hidden the moment the switch flips, so the payload loop below
      // skips them and the API would keep the old prefix or digit count —
      // invisible on the form and still in every code it issues.
      for (const f of formFields) {
        if (!f.clearsWhenOff || form[f.key] !== false) continue;
        for (const [k, v] of Object.entries(f.clearsWhenOff)) payload[k] = v;
      }
      for (const f of visibleFields) {
        if (f.filterOnly || f.readOnly) continue;
        let v = form[f.key];
        if (v === "" || v === undefined) continue;
        if (f.type === "number") v = Number(v);
        if (f.type === "json") {
          try {
            v = JSON.parse(v);
          } catch {
            throw new Error(`"${f.label}" must be valid JSON.`);
          }
        }
        payload[f.key] = v;
      }
      // Expand each stand-in control into the boolean columns it represents.
      // Driven off formFields rather than visibleFields deliberately: a control
      // whose gate is off still has to write false to every one of its columns,
      // or turning tracking off would leave the previous flag set.
      for (const f of formFields) {
        if (!f.booleanColumns) continue;
        const chosen = visibleFields.some((v) => v.key === f.key) ? String(form[f.key] ?? "") : "";
        for (const [option, column] of Object.entries(f.booleanColumns)) payload[column] = chosen === option;
      }

      const hasCompanyField = config.fields.some((f) => f.key === "company_id");
      if (!editing && companyId && hasCompanyField) payload.company_id = companyId;

      if (editing) {
        await api.put(`${config.apiBase}/${editing[config.idKey]}`, payload);
      } else {
        await api.post(config.apiBase, payload);
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      setFormError(err?.message || t("mdFailedToSave"));
      if (!editing) numbering.refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (readOnly) return;
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.delete(`${config.apiBase}/${confirmDelete[config.idKey]}`);
      setConfirmDelete(null);
      load();
    } catch (err: any) {
      setError(err?.message || t("mdFailedToDelete"));
    } finally {
      setDeleting(false);
    }
  };

  /** Toggle switch in the Status column, for entities that support restore — flips a row
   * between Active/Inactive in one click, no confirmation step (unlike the trash-icon delete
   * flow), since it's trivially reversible by clicking again. */
  const handleToggleActive = async (row: Row) => {
    if (readOnly) return;
    const id = row[config.idKey];
    setTogglingId(id);
    try {
      if (row.is_active === false) {
        await api.patch(`${config.apiBase}/${id}/restore`);
      } else {
        await api.delete(`${config.apiBase}/${id}`);
      }
      load();
    } catch (err: any) {
      setError(err?.message || t("mdFailedToSave"));
    } finally {
      setTogglingId(null);
    }
  };

  const renderField = (f: MasterDataField) => {
    const value = numbering.value(f.key, form[f.key] ?? "") as any;
    const accessibility = { id: `master-${config.key}-${f.key}`, "aria-label": tLabel(currentLabel(f, form)), "aria-required": isFieldRequired(f, form) };
    // No caption beside the box: every field in this form already carries its
    // label above the control, and repeating it here printed "Item Tracking"
    // twice in the same cell. The input keeps its aria-label, so nothing is
    // lost to a screen reader.
    if (f.type === "boolean") {
      return (
        <div className="flex h-11 items-center">
          <input
            {...accessibility}
            type="checkbox"
            checked={!!value}
            onChange={(e) => setField(f.key, e.target.checked)}
            className="h-5 w-5 rounded-[var(--radius-xs)] accent-[var(--accent)]"
          />
        </div>
      );
    }
    // An ordered picker over another master's own fields. Number Series uses it
    // to say what a generated code is built from: pick ITEM as the master and
    // the options become item_type, category_id, sub_category — the actual
    // fields of the actual master, not a list anyone has to keep in step.
    if (f.type === "field-list" || (f.type === "select" && f.fieldsOf)) {
      // "Applies To" is createOnly, so on an edit it is not among formFields and
      // never reaches `form` — which left this picker permanently showing its
      // "choose what this series applies to first" placeholder on the one screen
      // where you actually configure an existing series. The row being edited
      // still knows its master, so fall back to it.
      const masterKey = String(form[f.fieldsOf || ""] || editing?.[f.fieldsOf || ""] || "")
        .toLowerCase().replaceAll("_", "-");
      const target = MASTER_DATA_CONFIGS.find((c) => c.key === masterKey);
      // The series' own Prefix is offered beside the master's fields, so where
      // it sits in the code is part of the same ordered choice rather than a
      // fixed position it can never move from.
      //
      // Only fields that carry a value a code can be built from: a dropdown
      // contributes the chosen row's code, a text or number input its own text,
      // a date its year. A Yes/No has no value to write into a code — an item
      // reading ...-TRUE-001 says nothing — and neither does a JSON or notes
      // field. The master's own code field is excluded outright: a code cannot
      // be built out of itself.
      // What a code can actually be built from:
      //   a selection — the chosen row's code (Item Type, Category, Parent);
      //   a date      — its year, or the whole date;
      //   the name    — the FIRST free-text field, which is what every master
      //                 uses for its name and where LARGE_WHITE comes from.
      //
      // Not every text field: an item's Image URL is text and belongs in no
      // code. Not numbers, not Yes/No, not JSON — an item reading ...-TRUE-001
      // says nothing. The master's own code field is excluded outright, since a
      // code cannot be built out of itself.
      //
      // Prefix is not an entry here either — it has its own First/Last control,
      // because those are the only two places it belongs.
      const ownCodeField = codeFieldOf(masterKey);
      const usable = (target?.fields || [])
        .filter((c) => !c.hideInForm && !c.filterOnly && c.key !== "company_id" && c.key !== ownCodeField);
      const firstTextField = usable.find((c) => c.type === "text")?.key;
      const dateFields = new Set(usable.filter((c) => c.type === "date").map((c) => c.key));
      const choices = usable
        .filter((c) => c.type === "select" || c.type === "select-entity" || c.type === "date" || c.key === firstTextField)
        .map((c) => ({ value: c.key, label: `${tLabel(c.label)} (${c.key})` }));
      if (!target) {
        return <p className="py-2 text-xs" style={S.sub}>Choose what this series applies to first — the fields offered here are that master's own.</p>;
      }
      if (f.type === "select") {
        return (
          <select {...accessibility} className={`${inputCls} nf-select`} style={S.input} disabled={readOnly}
            value={String(value ?? "")} onChange={(e) => setField(f.key, e.target.value)}>
            <option value="">{f.placeholder || "None — use the prefix"}</option>
            {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        );
      }
      const list: string[] = Array.isArray(value) ? value : [];
      const move = (idx: number, by: number) => {
        const next = [...list];
        const to = idx + by;
        if (to < 0 || to >= next.length) return;
        [next[idx], next[to]] = [next[to], next[idx]];
        setField(f.key, next);
      };
      // A stored date entry is `date_of_birth:YEAR`; match on the field alone so
      // it still counts as used and its row still finds its label.
      const fieldOf = (entry: string) => entry.split(":")[0];
      const remaining = choices.filter((c) => !list.some((entry) => fieldOf(entry) === c.value));
      // What the configuration above actually produces. Built from the same
      // order the generator uses — prefix at its chosen end, segments between,
      // sequence last — with each field standing in for itself, because the real
      // value is not known until a record is being created.
      // Mirrors normalizeSegment on the server: the underscore separates words
      // and a referenced code keeps its own separators, so FARM-001 stays
      // FARM-001. Stripping them here made the example disagree with the code
      // the series actually issues, which is worse than showing none.
      const norm = (v: unknown) => String(v ?? "").toUpperCase()
        .replace(/\s+/g, "_").replace(/[^A-Z0-9_/-]/g, "")
        .replace(/_*([/-])_*/g, "$1").replace(/_+/g, "_").replace(/^[_/-]+|[_/-]+$/g, "");
      const sep = String(form.separator || "-");
      // Blank means "same as the separator", the same fallback the generator uses.
      const seqSep = String(form.seq_separator || "") || sep;
      const seqDigitsRaw = Number(form.seq_length);
      const seqDigits = Number.isFinite(seqDigitsRaw) ? seqDigitsRaw : 3;
      const prefixText = norm(form.prefix);
      const atStart = String(form.prefix_position || "END") === "START";
      const sample = [
        ...(prefixText && atStart ? [prefixText] : []),
        // The codes this tenant actually uses, read off a real record of the
        // master being configured — a name of the shape tells you the rule, but
        // only the real values tell you what the code will look like.
        ...list.map((entry) => {
          const k = fieldOf(entry);
          const part = entry.split(":")[1];
          const raw = sampleRecord?.values?.[k];
          if (part === "YEAR") return raw ? String(raw).slice(0, 4) : "2026";
          if (part === "DATE") return raw ? String(raw).slice(0, 10).replace(/-/g, "") : "20260908";
          const normalised = norm(raw);
          // A real value when the sample record has one, and an angle-bracketed
          // name when it does not — SUB-CATEGORY read like a code the system had
          // produced, when in fact no item in the tenant has a sub-category yet.
          return normalised || `<${k.replace(/_id$/, "").replace(/_/g, "-")}>`;
        }),
        ...(prefixText && !atStart ? [prefixText] : []),
      ].filter(Boolean);

      // Sequence Digits 0 means no number at all — the Breed code IS the breed
      // name. The example showed one anyway, so it promised a code the series
      // would never issue.
      const stem = sample.join(sep);
      const shown = seqDigits <= 0 && stem
        ? stem
        : `${stem}${stem ? seqSep : ""}${"1".padStart(Math.max(seqDigits, 1), "0")}`;

      return (
        <div className="flex flex-col gap-2">
          <div className="rounded-lg border px-2.5 py-2" style={S.raised}>
            <span className="text-[11px]" style={S.sub}>Example</span>
            <div className="mt-0.5 font-mono text-xs" style={S.primary}>{shown}</div>
          </div>
          <select className={`${inputCls} nf-select`} style={S.input} disabled={readOnly || !remaining.length}
            value="" onChange={(e) => {
              // A date joins the list already carrying its part, so the row has
              // something to show and the stored value is complete from the start.
              if (e.target.value) setField(f.key, [...list, dateFields.has(e.target.value) ? `${e.target.value}:YEAR` : e.target.value]);
            }}>
            <option value="">{remaining.length ? "Add a field…" : "Every field is already used"}</option>
            {remaining.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {list.map((entry, idx) => {
            const key = fieldOf(entry);
            const label = choices.find((c) => c.value === key)?.label ?? key;
            const datePart = entry.split(":")[1] || "YEAR";
            return (
              <div key={`${entry}-${idx}`} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs" style={S.surface}>
                <span className="w-5 shrink-0 text-center font-semibold" style={S.sub}>{idx + 1}</span>
                <span className="min-w-0 flex-1 truncate" style={S.primary}>{label}</span>
                {/* A date can go into a code two ways, and the answer differs per
                    series: the animal code wants the year of birth, a daily
                    document wants the whole date. Asked here, on the row. */}
                {dateFields.has(key) && !readOnly && (
                  <select className="rounded border px-1.5 py-0.5 text-[11px]" style={S.input} value={datePart}
                    onChange={(e) => setField(f.key, list.map((v, i) => i === idx ? `${key}:${e.target.value}` : v))}>
                    <option value="YEAR">Year only</option>
                    <option value="DATE">Full date</option>
                  </select>
                )}
                {!readOnly && <>
                  <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move earlier" className="rounded px-1.5 disabled:opacity-30" style={S.sub}>↑</button>
                  <button type="button" onClick={() => move(idx, 1)} disabled={idx === list.length - 1} aria-label="Move later" className="rounded px-1.5 disabled:opacity-30" style={S.sub}>↓</button>
                  <button type="button" onClick={() => setField(f.key, list.filter((_, i) => i !== idx))} aria-label="Remove" className="rounded px-1.5" style={{ color: "var(--danger)" }}>×</button>
                </>}
              </div>
            );
          })}
        </div>
      );
    }
    if (f.type === "string-list") {
      const list: string[] = Array.isArray(value) ? value : [];
      const draft = chipDrafts[f.key] ?? "";
      const addChip = () => {
        const trimmed = draft.trim();
        if (!trimmed) return;
        if (!list.includes(trimmed)) setField(f.key, [...list, trimmed]);
        setChipDrafts((prev) => ({ ...prev, [f.key]: "" }));
      };
      const removeChip = (idx: number) => setField(f.key, list.filter((_, i) => i !== idx));
      return (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              {...accessibility}
              type="text"
              value={draft}
              onChange={(e) => setChipDrafts((prev) => ({ ...prev, [f.key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); addChip(); }
              }}
              placeholder={f.placeholder}
              className={inputCls}
              style={S.input}
            />
            <button
              type="button"
              onClick={addChip}
              className="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold"
              style={S.surface}
            >
              {t("mdAdd")}
            </button>
          </div>
          {list.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {list.map((val, idx) => (
                <span
                  key={`${val}-${idx}`}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                  style={S.surface}
                >
                  {val}
                  <button
                    type="button"
                    onClick={() => removeChip(idx)}
                    aria-label={`Remove ${val}`}
                    className="leading-none"
                    style={S.muted}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }
    // A json array with a declared row shape is edited as rows of real inputs.
    // The stored value stays JSON, so nothing about the API changes — only the
    // way it is produced. Typing JSON by hand is how a trailing comma becomes a
    // rejected save with nothing useful to say about it.
    if (f.type === "json" && f.jsonRow?.length) {
      let rows: Row[] = [];
      try { const parsed = value ? JSON.parse(value) : []; if (Array.isArray(parsed)) rows = parsed; } catch { rows = []; }
      const broken = !!value && rows.length === 0 && value.trim() !== "[]" && value.trim() !== "";
      const write = (next: Row[]) => setField(f.key, JSON.stringify(next));
      // Rows the list is required to carry: the entry stays and keeps pointing
      // at what it points at. Its value is still editable.
      const req = f.requiredRows;
      const lockedKeys = new Set(
        (req ? entityOptions[req.endpoint] || [] : [])
          .filter((o) => o[req!.flag] === true || o[req!.flag] === 1)
          .map((o) => String(o[req!.key]))
      );
      const isLocked = (row: Row) => !!req && lockedKeys.has(String(row[req.key] ?? ""));
      return (
        <div className="flex flex-col gap-2">
          {broken && <InlineAlert>This entry is not a JSON array, so it cannot be shown as rows. Clear it to start again.</InlineAlert>}
          {rows.map((row, idx) => (
            <div key={idx} className="flex flex-wrap items-end gap-2 rounded-lg border p-2" style={S.raised}>
              {f.jsonRow!.map((col) => {
                const rowFieldId = `master-${config.key}-${f.key}-${idx}-${col.key}`;
                return (
                  <Field key={col.key} label={tLabel(col.label)} htmlFor={rowFieldId} className="min-w-[8rem] flex-1">
                    {col.type === "select-entity" ? (
                      <EntityLookupField
                        id={rowFieldId}
                        label={tLabel(col.label)}
                        options={entityOptions[col.entityEndpoint || ""] || []}
                        value={String(row[col.key] ?? "")}
                        valueKey={col.entityValueKey || "id"}
                        labelKeys={col.entityLabelKeys || []}
                        onChange={(next) => write(rows.map((r, i) => i === idx ? { ...r, [col.key]: next } : r))}
                        disabled={readOnly || (isLocked(row) && col.key === req?.key)}
                        loading={!!col.entityEndpoint && entityOptions[col.entityEndpoint] === undefined}
                        placeholder={t("selectPlaceholder")}
                      />
                    ) : col.type === "select" ? (
                      // A closed set of values inside a row is a dropdown, not
                      // a free-text box. Without this branch a column declared
                      // `type: "select"` fell through to the input below and
                      // took anything typed into it: a vaccination's Route
                      // accepted "IM", "im" and "intramuscular" as three
                      // different answers, and its Triggered by — which decides
                      // what the scheduler counts from — could be nonsense.
                      <select id={rowFieldId} className={`${inputCls} nf-select`} style={S.input} disabled={readOnly}
                        value={String(row[col.key] ?? "")}
                        onChange={(e) => write(rows.map((r, i) => i === idx ? { ...r, [col.key]: e.target.value } : r))}>
                        <option value="">{col.placeholder || t("selectPlaceholder")}</option>
                        {(col.options || []).map((o) => <option key={o.value} value={o.value}>{tLabel(o.label)}</option>)}
                      </select>
                    ) : (
                      <input id={rowFieldId} className={inputCls} style={S.input} disabled={readOnly}
                        type={col.type === "number" ? "number" : "text"} step={col.step} placeholder={col.placeholder}
                        value={String(row[col.key] ?? "")}
                        onChange={(e) => write(rows.map((r, i) => i === idx ? { ...r, [col.key]: col.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value } : r))} />
                    )}
                  </Field>
                );
              })}
              {!readOnly && (isLocked(row)
                ? <span className="rounded-lg border px-2 py-1.5 text-xs font-medium" style={{ ...S.raised, color: "var(--text-muted)" }}>Mandatory</span>
                : <button type="button" onClick={() => write(rows.filter((_, i) => i !== idx))}
                    className="rounded-lg border px-2 py-1.5 text-xs font-medium" style={{ ...S.surface, color: "var(--danger)" }}>
                    {t("mdRemoveRow")}
                  </button>)}
            </div>
          ))}
          {!readOnly && <button type="button" onClick={() => write([...rows, {}])}
            className="self-start rounded-lg border px-3 py-1.5 text-xs font-semibold" style={S.surface}>
            <Plus className="mr-1 inline h-3 w-3" />{rows.length ? t("mdAddMore") : t("mdAdd")}
          </button>}
        </div>
      );
    }
    if (f.type === "textarea" || f.type === "json") {
      return (
        <textarea
          {...accessibility}
          value={value}
          onChange={(e) => setField(f.key, e.target.value)}
          placeholder={f.placeholder}
          rows={f.type === "json" ? 5 : 3}
          className={`${inputCls} font-mono text-xs`}
          style={S.input}
        />
      );
    }
    // A short, weighed choice reads better as a segmented group than as a
    // dropdown: both options stay on screen, and neither is the implied default
    // that a closed select shows before it is opened. Lot vs Serial is that
    // choice — the pair it writes to are mutually exclusive, and a plain switch
    // could not label its own "off".
    if (f.type === "select" && f.control === "segmented") {
      const segments = f.options || [];
      const current = segments.findIndex((o) => o.value === String(value));
      // Arrow keys move between segments, as a radiogroup is expected to.
      const step = (delta: number) => {
        if (!segments.length) return;
        const from = current < 0 ? 0 : current;
        setField(f.key, segments[(from + delta + segments.length) % segments.length].value);
      };
      return (
        // nf-input carries the one control height (44px) and radius the console
        // uses everywhere, so this sits level with the selects beside it rather
        // than floating in a box of its own size. Segments share the width.
        <div
          role="radiogroup"
          aria-label={tLabel(currentLabel(f, form))}
          className="nf-input flex items-center gap-1 p-1"
          style={S.input}
          onKeyDown={(e) => {
            if (f.readOnly) return;
            if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
            if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
          }}
        >
          {segments.map((o) => {
            const active = String(value) === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={active}
                tabIndex={active || (current < 0 && o === segments[0]) ? 0 : -1}
                disabled={f.readOnly}
                onClick={() => setField(f.key, o.value)}
                className="nf-press h-full flex-1 rounded-[var(--radius-xs)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                style={{
                  backgroundColor: active ? "var(--accent)" : "transparent",
                  color: active ? "#fff" : "var(--text-secondary)",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    if (f.type === "select") {
      return (
        <select {...accessibility} value={value} onChange={(e) => setField(f.key, e.target.value)} className={`${inputCls} nf-select`} style={S.input}>
          <option value="">{t("selectPlaceholder")}</option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    if (f.type === "select-entity") {
      const resolvedEp = resolveEndpoint(f, form);
      const loadedOptions = resolvedEp ? entityOptions[resolvedEp] : undefined;
      let options = loadedOptions || [];
      const parents = parentKeys(f);
      // "query" mode never blocks — an unset parent just narrows the results less, it
      // doesn't prevent fetching (mirrors the backend treating an absent filter as "show all").
      let disabled = f.dependsOnMode !== "query" && parents.length > 0 && !resolvedEp;
      const parentLabel = parents.map((k) => tLabel(config.fields.find((pf) => pf.key === k)?.label || k)).join(" & ");
      let restrictedReason = "";
      // The parent is chosen but nothing in the referenced master matches it.
      // The field stays, disabled, naming the parent whose choice emptied it —
      // every master that filters a picker this way is also offered as a lookup
      // card in the same dialog, so this is a step the person can act on.
      if (parentFilterState(f, form, entityOptions).empty) {
        disabled = true;
        restrictedReason = t("mdNoOptionsForParent", { name: parentLabel });
        options = [];
      }
      if (f.restrictOptionsBy && !disabled) {
        const r = f.restrictOptionsBy;
        const restriction = entityRestrictionState(f, form, entityOptions);
        const allowList = restriction?.allowedCodes || [];
        if (restriction?.resolved && !allowList.length) {
          disabled = true;
          restrictedReason = t("mdNoParentForType");
          options = [];
        } else if (allowList.length) {
          options = options.filter((o) => allowList.includes(o[r.optionCodeKey]));
        }
      }
      // Two pickers over one catalog that must not land on the same row: a
      // Secondary UOM equal to the Primary makes the conversion factor
      // meaningless. Matched on the value the form stores (uom_code here, a
      // UUID elsewhere), not on the displayed label.
      if (f.excludeValuesOf?.length) {
        const taken = f.excludeValuesOf.map((k) => String(form[k] ?? "")).filter(Boolean);
        if (taken.length) options = options.filter((o) => !taken.includes(String(o[f.entityValueKey || "id"])));
      }
      if (f.multiple) {
        const selected = parseStringList(form[f.key]);
        return (
          <EntityLookupField
            id={accessibility.id}
            label={accessibility["aria-label"]}
            options={options}
            value={selected}
            valueKey={f.entityValueKey || "id"}
            labelKeys={f.entityLabelKeys || []}
            onChange={(next) => setField(f.key, next)}
            multiple
            disabled={disabled || !!f.readOnly}
            loading={!!resolvedEp && loadedOptions === undefined}
            placeholder={restrictedReason || (disabled ? t("selectXFirst", { name: parentLabel }) : t("selectPlaceholder"))}
          />
        );
      }
      const placeholderText = restrictedReason || (disabled ? t("selectXFirst", { name: parentLabel }) : t("selectPlaceholder"));
      if (f.searchable) {
        return (
          <SearchableEntitySelect
            id={accessibility.id}
            ariaLabel={accessibility["aria-label"]}
            ariaRequired={accessibility["aria-required"]}
            value={value}
            onChange={(v) => setField(f.key, v)}
            options={options}
            valueKey={f.entityValueKey || "id"}
            getLabel={(o) => entityLabel(o, f)}
            disabled={disabled}
            placeholder={placeholderText}
            searchPlaceholder={t("searchPlaceholder")}
            noMatchesLabel={t("mdNoMatches")}
          />
        );
      }
      // Not a plain <select>: EntityLookupField opens a searchable picker, so a
      // catalog that has grown long stays usable without anyone having to mark
      // the field `searchable` first. The `searchable` branch above renders a
      // popover instead for the fields that ask for it.
      return (
        <EntityLookupField
          id={accessibility.id}
          label={accessibility["aria-label"]}
          options={options}
          value={String(value ?? "")}
          valueKey={f.entityValueKey || "id"}
          labelKeys={f.entityLabelKeys || []}
          onChange={(next) => setField(f.key, next)}
          disabled={disabled || !!f.readOnly}
          loading={!!resolvedEp && loadedOptions === undefined}
          placeholder={restrictedReason || (disabled ? t("selectXFirst", { name: parentLabel }) : t("selectPlaceholder"))}
        />
      );
    }
    return (
      <input
        {...accessibility}
        type={f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "date" ? "date" : "text"}
        step={f.step}
        min={f.min}
        max={f.max}
        value={value}
        onChange={(e) => setField(f.key, e.target.value)}
        placeholder={f.placeholder}
        disabled={f.readOnly}
        className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-70`}
        style={f.readOnly ? { ...S.input, backgroundColor: "var(--surface-raised)" } : S.input}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* No heading here any more. The record set's name and description are
          the page's own H1 and description, rendered by PageHeader above this
          component — this used to restate both as an <h2> immediately under a
          "Master Data" <h1>, so every screen carried two titles for one thing.
          What remains is this component's own toolbar: the filters, the search
          and the create action that operate on the table below. They belong to
          the work surface, so they stay with it. Nothing about their state,
          their handlers or the requests they make has changed. */}
      {/* Left-aligned, so the controls sit under the title they belong to
          rather than drifting to the far edge now that nothing balances them
          on the left (apple.design.md §23). */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {config.supportsNobLobFilter && workspaceScope !== "OPERATIONAL" && (
            <>
              <select
                aria-label="Filter by nature of business"
                value={nobFilter}
                onChange={(e) => { setNobFilter(e.target.value); setLobFilter(""); }}
                className="nf-input-sm nf-select"
                style={S.input}
              >
                <option value="">{t("allNob")}</option>
                {nobFilterOptions.map((n) => (
                  <option key={n.nob_id} value={n.nob_id}>{n.nob_code}</option>
                ))}
              </select>
              <select
                aria-label="Filter by line of business"
                value={lobFilter}
                onChange={(e) => setLobFilter(e.target.value)}
                className="nf-input-sm nf-select"
                style={S.input}
                disabled={!nobFilter}
              >
                <option value="">{nobFilter ? t("allLob") : t("selectNobFirst")}</option>
                {lobFilterOptions.map((l) => (
                  <option key={l.lob_id} value={l.lob_id}>{l.lob_code}</option>
                ))}
              </select>
            </>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={S.muted} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="nf-input-sm"
              // `.nf-input-sm` sets `padding` as a shorthand, which overrode
              // the `pl-8` utility that was here and left the icon sitting on
              // top of the placeholder. Setting it alongside the other inline
              // styles keeps the fix on this one field.
              style={{ ...S.input, paddingLeft: "1.75rem" }}
            />
          </div>
          {/* The search box above narrows on every keystroke because it is one
              field and the whole list is its subject. Column filters are a set
              of decisions taken together, so they live behind this button and
              take effect on Apply — see the drawer at the foot of this file. */}
          {columns.length > 0 && (
            <button
              type="button"
              onClick={() => { setFilterDraft(colFilters); setFilterOpen(true); }}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors hover:border-(--accent) hover:text-(--accent)"
              style={appliedFilterCount ? { ...S.surface, borderColor: "var(--accent)", color: "var(--accent)" } : S.surface}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              {t("mdFilters")}
              {appliedFilterCount > 0 && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  {appliedFilterCount}
                </span>
              )}
            </button>
          )}
          {!readOnly && !exhausted && <button
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
            style={{ backgroundColor: "var(--accent)" }}
          >
            <Plus className="h-3.5 w-3.5" /> {t("addItem", { name: tLabel(singularLabel(config)) })}
          </button>}
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {bcOwned && <BcOwnershipNotice config={config} />}
      {administrationRestricted && <p className="rounded-lg border p-3 text-sm" style={S.raised}>Only a Tenant Admin or Company Admin can add, edit or deactivate reasons. You can view the shared catalog here.</p>}
      {manageableLookups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-(--text-muted)">Dropdown options come from</span>
          {manageableLookups.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setLookupManager(c)}
              title={`Manage ${tLabel(c.label)}`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:border-(--accent) hover:text-(--accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
              style={S.surface}
            >
              <SlidersHorizontal className="h-3 w-3" aria-hidden />
              {tLabel(c.label)}
            </button>
          ))}
        </div>
      )}

      {/* The filter panel is a second column of this grid, not a layer over
          it: the table narrows and the panel takes the space, so the rows
          being filtered stay visible and nothing is buried behind a scrim. */}
      <div className={selectedRow || filterOpen ? "grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" : undefined}>
      <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader>
              <tr className="border-b" style={{ borderColor: "var(--row-border)" }}>
                {columns.map((c) => {
                  const active = sortKey === c.key;
                  return (
                    <TableHead key={c.key} className="whitespace-nowrap">
                      {/* Sorting is done in SQL over the whole table, so it
                          reorders every page, not the page in view. */}
                      <button
                        type="button"
                        onClick={() => {
                          if (active) { setSortDir(sortDir === "asc" ? "desc" : "asc"); return; }
                          setSortKey(c.key);
                          setSortDir("asc");
                        }}
                        aria-label={t("mdSortBy", { name: tLabel(c.label) })}
                        className="inline-flex items-center gap-1 font-semibold transition-colors hover:text-(--accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
                        style={active ? { color: "var(--accent)" } : undefined}
                      >
                        {tLabel(c.label)}
                        <ArrowUpDown className="h-3 w-3 shrink-0" aria-hidden style={{ opacity: active ? 1 : 0.35 }} />
                      </button>
                    </TableHead>
                  );
                })}
                {/* The record's own active/deactivated flag — the switch below
                    it — headed "Active" rather than "Status", because several
                    masters carry a domain status of their own that the client's
                    templates name "Status".

                    A master that already shows that status does not get this
                    column at all. Animal Register is the case: its status is
                    ACTIVE / QUARANTINE / SICK / PREGNANT / LACTATING / DRY /
                    CULLED / DEAD / SOLD / SLAUGHTERED (its template, column AH,
                    mandatory), it sets supportsRestore: false so this cell was
                    a dead badge anyway, and its own description says an animal
                    is "Never physically deleted; use Dispose to record
                    sale/slaughter/death". An active flag beside that says
                    nothing the Status column has not already said. */}
                {!ownsStatusColumn && <TableHead className="text-right">{t("activeColumn")}</TableHead>}
                <TableHead className="text-right">{t("actionsColumn")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {loading ? (
                <tr>
                  <TableCell colSpan={columns.length + (ownsStatusColumn ? 1 : 2)} className="py-10 text-center" style={S.sub}>
                    <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={S.accent} /> {t("loadingEllipsis")}
                  </TableCell>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <TableCell colSpan={columns.length + (ownsStatusColumn ? 1 : 2)} className="py-10 text-center" style={S.sub}>
                    <Inbox className="mx-auto mb-2 h-6 w-6" style={S.muted} />
                    {t("noRecordsYet", { name: tLabel(config.label).toLowerCase() })}
                    {!readOnly && <button onClick={openCreate} className="mt-2 block w-full font-semibold" style={S.accent}>{t("addFirstOne")}</button>}
                  </TableCell>
                </tr>
              ) : (
                pagedRows.map((row) => {
                  const inactive = row.is_active === false;
                  return (
                    <TableRow
                      key={row[config.idKey]}
                      onClick={detailFor ? () => setSelectedId(String(row[config.idKey])) : undefined}
                      className={detailFor ? "cursor-pointer" : undefined}
                      style={detailFor && String(row[config.idKey]) === selectedId
                        ? { backgroundColor: "var(--surface-raised)" }
                        : undefined}
                    >
                      {columns.map((c) => (
                        c.key === "status" && row.status ? (
                          // A chip, in the same shape as the Active badge below,
                          // so the two status-shaped things on a row read as one
                          // family. Colour carries whether the record is still
                          // in play — for an animal, still in the herd — rather
                          // than a colour per value, which would turn a
                          // ten-value column into a paint chart.
                          <TableCell key={c.key} className="whitespace-nowrap">
                            <span
                              className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                              style={statusActiveValues && !statusActiveValues.includes(String(row.status))
                                ? { color: "var(--text-muted)", borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }
                                : { color: "var(--success)", borderColor: "var(--success)", backgroundColor: "var(--success-muted)" }}
                            >
                              {String(row.status)}
                            </span>
                          </TableCell>
                        ) : (
                        <TableCell key={c.key} className="whitespace-nowrap" style={S.primary}>{displayValue(row, c.key, t("mdYes"), t("mdNo"))}</TableCell>
                        )
                      ))}
                      {!ownsStatusColumn && <TableCell className="text-right">
                        {!readOnly && (config.supportsRestore ?? true) ? (
                          <div className="flex items-center justify-end">
                            {/* The switch alone. It carried a text label beside
                                it saying Active/Inactive — the same fact the
                                switch's own position and colour already state,
                                twice in one cell. Screen readers were the only
                                audience for that text and they get it from
                                aria-checked instead. */}
                            <button
                              role="switch"
                              aria-checked={!inactive}
                              aria-label={String(row[columns[0]?.key] ?? tLabel(config.label))}
                              onClick={() => handleToggleActive(row)}
                              disabled={togglingId === row[config.idKey]}
                              title={inactive ? t("restore") : t("deactivate")}
                              className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50"
                              style={{ backgroundColor: inactive ? "var(--border)" : "var(--success)" }}
                            >
                              <span
                                className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform"
                                style={{ transform: inactive ? "translateX(0.2rem)" : "translateX(1.15rem)" }}
                              />
                            </button>
                          </div>
                        ) : (
                          <span
                            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                            style={inactive
                              ? { color: "var(--text-muted)", borderColor: "var(--border)", backgroundColor: "var(--surface-raised)" }
                              : { color: "var(--success)", borderColor: "var(--success)", backgroundColor: "var(--success-muted)" }}
                          >
                            {inactive ? t("statusInactive") : t("statusActive")}
                          </span>
                        )}
                      </TableCell>}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => setViewingId(String(row[config.idKey]))} aria-label={`View ${singularLabel(config)}`} title="View" className="rounded-lg p-1.5 transition hover:bg-[var(--surface-raised)]" style={S.sub}>
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {!readOnly && <button onClick={() => openEdit(row)} title={t("edit")} className="rounded-lg p-1.5 transition hover:bg-[var(--surface-raised)]" style={S.sub}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>}
                          {!readOnly && !(config.supportsRestore ?? true) && (
                            <button onClick={() => setConfirmDelete(row)} title={t("deactivate")} className="rounded-lg p-1.5 transition hover:bg-[var(--danger-muted)]" style={{ color: "var(--danger)" }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </table>
        </div>
        {!loading && rows.length > 0 && (
          <div className="border-t px-2" style={{ borderColor: "var(--border)" }}>
            <Pagination page={page} pageSize={pageSize} total={pagerTotal} onPageChange={setPage} onPageSizeChange={setPageSize} pageSizeOptions={[25, 50, 100]} />
          </div>
        )}
      </div>
      {selectedRow && detailFor === "animal" && (
        <div className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-8rem)]">
          <AnimalDetailPanel row={selectedRow} onClose={() => setSelectedId(null)} />
        </div>
      )}
      {filterOpen && isDesktop && (
        <aside className="min-w-0 lg:sticky lg:top-4" aria-label={t("mdFilters")}>
          <div className="flex max-h-[calc(100dvh-8rem)] flex-col overflow-hidden rounded-[var(--radius-md)] border" style={S.surface}>
            <div className="flex items-start justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <div>
                <h2 className="text-sm font-semibold" style={S.primary}>{t("mdFilters")}</h2>
                <p className="mt-0.5 text-xs" style={S.sub}>{t("mdFiltersDesc", { label: tLabel(config.label) })}</p>
              </div>
              <button type="button" onClick={() => setFilterOpen(false)} aria-label={t("close")}
                className="rounded-lg p-1 transition-colors hover:text-(--accent)" style={S.muted}>
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {filterFields}
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
              {filterActions}
            </div>
          </div>
        </aside>
      )}
      </div>

      {viewingId && <MasterRecordView config={config} id={viewingId} onClose={() => setViewingId(null)} />}

      {/* Every master form shares the same responsive frame and pinned actions.
          Section count changes its content layout, never the window size. */}
      <Dialog
        open={modalOpen && !readOnly}
        onClose={() => !saving && setModalOpen(false)}
        title={editing ? t("editItem", { name: tLabel(singularLabel(config)) }) : t("addItem", { name: tLabel(singularLabel(config)) })}
        maxWidth={sectionCount > 1 ? "xl" : "lg"}
        presentation={usePageDialog ? "page" : "modal"}
        footer={
          <>
            <button onClick={() => setModalOpen(false)} disabled={saving} className="rounded-lg border px-4 py-2 text-sm font-medium" style={S.surface}>
              {t("cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || numbering.loading || numberingBlocks}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)" }}
            >
              {saving ? t("saving") : editing ? t("saveChanges") : t("create")}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {formError && <InlineAlert>{formError}</InlineAlert>}
          {numbering.error && <InlineAlert>{numbering.error}</InlineAlert>}
          {numbering.canChoose && <label className="grid gap-1 text-sm">Code Entry
            <select aria-label="Code Entry" className="nf-input nf-select" value={numbering.mode} onChange={(e) => numbering.chooseMode(e.target.value as "serial" | "manual")}>
              <option value="serial">Follow number series</option><option value="manual">Enter manually</option>
            </select>
          </label>}
          {(() => {
            const DEFAULT = "Identification";
            const order: string[] = [];
            const bySection = new Map<string, typeof visibleFields>();
            for (const f of visibleFields) {
              const s = f.section || DEFAULT;
              if (!bySection.has(s)) { bySection.set(s, []); order.push(s); }
              bySection.get(s)!.push(f);
            }
            // A master with no sections configured renders one card, which looks the
            // same as today's flat form once expanded.
            const identificationIndex = order.indexOf(DEFAULT);
            if (identificationIndex > 0) order.unshift(...order.splice(identificationIndex, 1));
            return order.map((s, i) => (
              // Open the first card, and any card holding a field the form
              // will refuse to save without. Primary UOM is required and lives
              // in "Units & Valuation", so with only the first card open a
              // mandatory field sat collapsed below optional ones like Storage
              // Temp — invisible until you went looking for it.
              <CollapsibleCard key={s} title={s} defaultOpen={i === 0 || bySection.get(s)!.some((f) => isFieldRequired(f, form))}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {bySection.get(s)!.map((f) => (
                    <Field
                      key={f.key}
                      label={tLabel(currentLabel(f, form))}
                      htmlFor={`master-${config.key}-${f.key}`}
                      required={isFieldRequired(f, form)}
                      hint={f.helpText}
                      className={f.type === "textarea" || f.type === "json" || f.type === "string-list" ? "sm:col-span-2" : undefined}
                    >
                      {renderField(f)}
                    </Field>
                  ))}
                </div>
              </CollapsibleCard>
            ));
          })()}

          {lookupConfigs.map((c) => (
              <CollapsibleCard key={c.key} title={c.label} subtitle="Add one without leaving this form">
                <LookupCard config={c} onCreated={() => { setEntityReloadKey((k) => k + 1); numbering.refresh(); }} onManage={() => setLookupManager(c)} />
              </CollapsibleCard>
            ))}
        </div>
      </Dialog>

      <Dialog open={!!lookupManager} title={`Manage ${lookupManager?.label || ""}`} maxWidth="xl"
        onClose={() => { setLookupManager(null); setEntityReloadKey((k) => k + 1); numbering.refresh(); }}>
        {lookupManager && <MasterDataTable key={lookupManager.key} config={lookupManager} />}
      </Dialog>

      <Dialog
        open={!!confirmDelete}
        onClose={() => !deleting && setConfirmDelete(null)}
        title={t("deactivateRecordTitle")}
        presentation="compact"
        description={confirmDelete ? t("deactivateRecordDesc", { name: confirmDelete[columns[0]?.key] ?? confirmDelete[config.idKey], label: tLabel(config.label) }) : undefined}
        maxWidth="sm"
        footer={
          <>
            <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="rounded-lg border px-4 py-2 text-sm font-medium" style={S.surface}>
              {t("cancel")}
            </button>
            <button onClick={handleDelete} disabled={deleting} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--danger)" }}>
              {deleting ? t("deactivating") : t("deactivate")}
            </button>
          </>
        }
      >
        <p className="text-sm" style={S.sub}>{t("confirmDeactivate")}</p>
      </Dialog>

      {/* Below `lg` the same filters interrupt as a dialog: a 340px side column
          would leave the table too narrow to read, so the honest presentation
          is to cover it and hand it back on Apply. */}
      <Dialog
        open={filterOpen && !isDesktop}
        onClose={() => setFilterOpen(false)}
        title={t("mdFilters")}
        description={t("mdFiltersDesc", { label: tLabel(config.label) })}
        maxWidth="sm"
        footer={filterActions}
      >
        {filterFields}
      </Dialog>

    </div>
  );
}
