"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Plus, Pencil, Trash2, Search, Loader2, Inbox, Eye, SlidersHorizontal,
  ArrowUpDown, X, FileText, Info, Users, Boxes, Activity, Layers, MapPin,
  Scale, QrCode, Landmark, Clock, ArrowRight, Edit3, Building2, Coins
} from "lucide-react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { Field, FieldGroup } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/alert";
import { showToast } from "@/components/ui/toast";
import { Pagination } from "@/components/ui/pagination";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { getActiveCompanyId, getActiveWorkspaceScope, getStoredUser, hasPermission } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { singularLabel } from "./labels";
import { cn } from "@/lib/utils";
import type { MasterDataConfig, MasterDataField } from "./types";
import AnimalDetailPanel from "./AnimalDetailPanel";
import { MASTER_DATA_CONFIGS } from "./configs";
import { codeFieldOf } from "./useCodeSeries";
import { useCodeSeries } from "./useCodeSeries";
import { MasterRecordView } from "./MasterRecordView";
import { BcOwnershipNotice } from "./BcOwnershipNotice";
import { EntityLookupDialog, EntityLookupField } from "./EntityLookupField";
import { SearchableEntitySelect } from "./SearchableEntitySelect";
import { ItemTemplateSelectModal } from "./ItemTemplateSelectModal";

const PAGE_SIZE = 25;

type Row = Record<string, any>;

type RelatedPicker = {
  field: MasterDataField;
  config: MasterDataConfig;
  options: Row[];
  // Set only for a jsonRow column's picker: writes the chosen id into that
  // one row instead of the top-level form field a plain select-entity field
  // would otherwise assume (setField(field.key, value)), and currentValue
  // stands in for form[field.key] the same way.
  currentValue?: string;
  onApply?: (value: string) => void;
};

type RelatedCreator = {
  field: MasterDataField;
  config: MasterDataConfig;
  // See RelatedPicker.onApply — same reason, same jsonRow case.
  onApply?: (value: string) => void;
};

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

/**
 * The same label, kept as its separate parts so the open option list can lay
 * them out as aligned columns — a code column and a name column that line up
 * down the list instead of one run-on line per row.
 *
 * Unlike `entityLabel` an empty value is kept rather than dropped: a row with no
 * location name must still leave that column empty rather than sliding its farm
 * name up into the breed column.
 */
function entityLabelPartsOf(row: Row, field: MasterDataField): string[] {
  const keys = field.entityLabelKeys || [];
  const parts = keys.map((k) => (row[k] === null || row[k] === undefined ? "" : String(row[k])));
  return parts.some((p) => p !== "") ? parts : [String(entityLabel(row, field) ?? "")];
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
    if (cond.notEquals !== undefined) {
      const list = Array.isArray(cond.notEquals) ? cond.notEquals : [cond.notEquals];
      return !list.includes(depValue);
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

function displayValue(row: Row, key: string, yesLabel: string, noLabel: string, col?: { decimals?: number; decimalsFromKey?: string }): string {
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
  // Opt-in only (col.decimals set) — a plain numeric column still prints
  // whatever the API returned, same as always. The stored precision (e.g.
  // UOM Conversion's conversion_factor, decimal(18,8)) is real and stays
  // exact in the form and the API; this only trims the list's display.
  if (col?.decimals !== undefined && !isNaN(Number(v)) && String(v).trim() !== "") {
    const fromSibling = col.decimalsFromKey ? Number(row[col.decimalsFromKey]) : undefined;
    const places = fromSibling !== undefined && !isNaN(fromSibling) && fromSibling > 0 ? fromSibling : col.decimals;
    return Number(v).toFixed(places);
  }
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
 * The masters that fill a screen's dropdowns — what the "Dropdown options"
 * row names, and what each related selector can create or browse.
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
 *   still exposing them to form selectors, on the reasoning that they could
 *   not be saved.
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

function DescriptionTooltip({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={`About ${title}`}
        aria-expanded={open}
        className="group inline-flex items-center justify-center h-6 w-6 rounded-full text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--surface-raised)] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] cursor-pointer"
      >
        <Info className="h-4 w-4 transition-transform group-hover:scale-110" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="tooltip"
          className="absolute left-0 top-full mt-2 w-72 sm:w-80 max-w-[calc(100vw-3rem)] rounded-xl p-3.5 shadow-2xl border z-50 text-xs leading-relaxed pointer-events-auto transition-all animate-in fade-in zoom-in-95"
          style={{
            backgroundColor: "var(--surface-raised)",
            borderColor: "var(--border)",
            color: "var(--text-primary)",
          }}
        >
          <div className="flex items-center gap-2 mb-1.5 font-semibold text-[var(--text-primary)]">
            <Info className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
            <span className="truncate">About {title}</span>
          </div>
          <p className="text-[var(--text-secondary)]">{description}</p>
        </div>
      )}
    </div>
  );
}

function getSectionIcon(section: string) {
  const s = section.toLowerCase();
  if (s.includes("identif")) return FileText;
  if (s.includes("lineage") || s.includes("parent") || s.includes("pedigree")) return Users;
  if (s.includes("acqui") || s.includes("purchas") || s.includes("source") || s.includes("receipt")) return Boxes;
  if (s.includes("product") || s.includes("perform") || s.includes("operat")) return Activity;
  if (s.includes("bio") || s.includes("asset") || s.includes("health")) return Layers;
  if (s.includes("position") || s.includes("locat") || s.includes("place")) return MapPin;
  if (s.includes("unit") || s.includes("valuat") || s.includes("uom") || s.includes("weight")) return Scale;
  if (s.includes("track") || s.includes("code") || s.includes("qr") || s.includes("rfid") || s.includes("lot")) return QrCode;
  if (s.includes("gl") || s.includes("account") || s.includes("ledger")) return Landmark;
  if (s.includes("duration") || s.includes("time") || s.includes("schedul")) return Clock;
  if (s.includes("transit") || s.includes("move") || s.includes("flow")) return ArrowRight;
  if (s.includes("data") || s.includes("entry") || s.includes("kpi")) return Edit3;
  if (s.includes("address") || s.includes("contact") || s.includes("supplier") || s.includes("customer")) return Building2;
  if (s.includes("financ") || s.includes("cost") || s.includes("price") || s.includes("curr")) return Coins;
  if (s.includes("setting") || s.includes("config") || s.includes("setup")) return SlidersHorizontal;
  return FileText;
}

export function MasterDataTable({
  config,
  createOnly = false,
  showHeader = !createOnly,
  tabs,
  onCreated,
  onCreateCancelled,
}: {
  config: MasterDataConfig;
  createOnly?: boolean;
  showHeader?: boolean;
  tabs?: ReactNode;
  onCreated?: (row: Row) => void;
  onCreateCancelled?: () => void;
}) {
  const { t, tLabel } = useLanguage();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
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
  // Location-only cascading filter: pick a Farm, then a Shed narrows to that
  // farm's sheds — both resolve to the real `parent_location_id` column at
  // request time (see `load()`), not a filter key of their own.
  const [locationFarmOptions, setLocationFarmOptions] = useState<Row[]>([]);
  const [locationShedOptions, setLocationShedOptions] = useState<Row[]>([]);
  const [locationPenOptions, setLocationPenOptions] = useState<Row[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [form, setForm] = useState<Row>({});
  // Pending, not-yet-added input text for each "string-list" field's chip editor, keyed by field key.
  const [chipDrafts, setChipDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [activeFormTab, setActiveFormTab] = useState<string>("");
  const [entityReloadKey, setEntityReloadKey] = useState(0);
  const [lookupManager, setLookupManager] = useState<MasterDataConfig | null>(null);
  const [relatedPicker, setRelatedPicker] = useState<RelatedPicker | null>(null);
  const [relatedCreator, setRelatedCreator] = useState<RelatedCreator | null>(null);
  const lastEntityReloadKeyRef = useRef(entityReloadKey);
  const createOnlyOpenedRef = useRef(false);
  const codeFieldTouchedRef = useRef(false);

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
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [isManualNoAllowed, setIsManualNoAllowed] = useState(false);
  /**
   * The set of form-field keys that were filled by the last template selection.
   * These fields are locked (disabled) so the user cannot accidentally override
   * the template's intent. Fields the template left blank are NOT in this set
   * and remain freely editable.
   * Cleared when the modal closes or when a normal (non-template) create is opened.
   */
  const [templateLockedFields, setTemplateLockedFields] = useState<Set<string>>(new Set());

  const currentUser = getStoredUser();
  const canCreateItem = typeof hasPermission === "function"
    ? hasPermission(currentUser, "MASTER_DATA", "ITEM", "can_create")
    : ["TENANT_ADMIN", "COMPANY_ADMIN"].includes(currentUser?.userType || "");

  const workspaceScope = getActiveWorkspaceScope();
  const companyId = workspaceScope === "TENANT" ? null : getActiveCompanyId();
  // BBP-1 §1.5 and §1.6 put Items and the Chart of Accounts in Business Central:
  // "NAVFarm cannot create items independently", "NAVFarm does NOT maintain its own
  // Chart of Accounts". That integration is not built, so until it is, these stay
  // locally editable and the notice states the blueprint's position rather than
  // the screen pretending a BC connection exists. Rishi's call, 2026-09-06.
  const bcOwned = config.owner === "BC";
  const administrationRestricted = !!config.businessAdminOnly && !["TENANT_ADMIN", "COMPANY_ADMIN"].includes(currentUser?.userType || "");
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
  const [inventorySetupNumbering, setInventorySetupNumbering] = useState<Record<string, { enabled?: boolean }> | null>(null);

  useEffect(() => {
    if ((config.key === "number-series" || config.key === "no-series") && (modalOpen || !inventorySetupNumbering)) {
      const compId = getActiveCompanyId();
      api.get(`/inventory-setup${compId ? `?companyId=${compId}` : ""}`)
        .then((res: any) => {
          const data = res?.data ?? res;
          if (data?.numbering_config) {
            setInventorySetupNumbering(data.numbering_config);
          }
        })
        .catch(() => {});
    }
  }, [config.key, companyId, modalOpen, inventorySetupNumbering]);

  const formFields = config.fields
    .map(numbering.field)
    .map(applyDerived)
    .map((f) => {
      if ((config.key === "number-series" || config.key === "no-series") && f.key === "document_type" && inventorySetupNumbering) {
        const filteredOptions = (f.options || []).filter((opt) => {
          const cfg = inventorySetupNumbering[opt.value];
          return cfg !== undefined ? cfg.enabled === true : true;
        });
        return { ...f, options: filteredOptions };
      }
      return f;
    })
    .filter((f) => !f.hideInForm && !(workspaceScope === "OPERATIONAL" && ["nob_id", "lob_id"].includes(f.key)));
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
  const relatedConfigFor = (field: MasterDataField, resolvedEndpoint: string | null) => {
    if (!resolvedEndpoint || readOnly) return undefined;
    return lookupConfigs.find((candidate) =>
      endpointPath(candidate.apiBase) === endpointPath(resolvedEndpoint) && candidate.key !== config.key,
    );
  };
  /**
   * The chips, which are not quite the cards.
   *
   * A BC-owned catalog belongs here: it is not read-only — `readOnly` above
   * tracks administration rights — and until the Business Central integration
   * is connected these are created and edited locally against our own
   * database. Withholding the chip while the dialog offered the very same
   * master as a related selector action said two different things about one
   * catalog.
   *
   * What does not belong here is a master sharing this screen's own tab bar.
   * Item Attributes is a tab of Items; offering a chip that opens it in a modal
   * duplicates a tab sitting inches above it. The field selector still offers
   * creation without requiring a half-filled form to be abandoned.
   */

  const load = async () => {
    setLoading(true);
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
        if (key === "__farm" || key === "__shed" || key === "__pen") continue;
        if (value !== "") params.set(`filter[${key}]`, value);
      }
      // Farm/Shed/Pen are UI-only synthetic filters (see the location-only
      // state above) — whichever is most specific resolves to the real column.
      if (config.key === "location") {
        const parent = colFilters.__pen || colFilters.__shed || colFilters.__farm;
        if (parent) params.set("filter[parent_location_id]", parent);
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
      showToast.error(err?.message || t("mdFailedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (createOnly) return;
    load();
  }, [config.key, search, nobFilter, lobFilter, page, pageSize, sortKey, sortDir, colFilters, createOnly]);

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
    if (field.type === "select") {
      let opts = field.options?.length ? field.options : undefined;
      if ((config.key === "number-series" || config.key === "no-series") && key === "document_type" && inventorySetupNumbering && opts) {
        opts = opts.filter((opt) => {
          const cfg = inventorySetupNumbering[opt.value];
          return cfg !== undefined ? cfg.enabled === true : true;
        });
      }
      return opts;
    }
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
      {config.key === "location" && (
        <FieldGroup title={t("mdFilterLocationHierarchy")} className="gap-y-4">
          <Field label={t("mdFilterFarm")} htmlFor={`master-${config.key}-filter-farm`} className="sm:col-span-6">
            <select
              id={`master-${config.key}-filter-farm`}
              className={`${inputCls} nf-select`}
              style={S.input}
              value={filterDraft.__farm ?? ""}
              onChange={(e) => {
                const nextFarm = e.target.value;
                setFilterDraft((prev) => {
                  const out = { ...prev };
                  if (nextFarm === "") delete out.__farm; else out.__farm = nextFarm;
                  delete out.__shed; // a new farm invalidates whatever shed/pen was picked under the old one
                  delete out.__pen;
                  return out;
                });
              }}
            >
              <option value="">{t("mdFilterAll")}</option>
              {locationFarmOptions.map((f) => (
                <option key={String(f.location_id)} value={String(f.location_id)}>
                  {String(f.location_code ?? f.location_name ?? f.location_id)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("mdFilterShed")} htmlFor={`master-${config.key}-filter-shed`} className="sm:col-span-6">
            <select
              id={`master-${config.key}-filter-shed`}
              className={`${inputCls} nf-select`}
              style={S.input}
              value={filterDraft.__shed ?? ""}
              disabled={!filterDraft.__farm}
              onChange={(e) => {
                const next = e.target.value;
                setFilterDraft((prev) => {
                  const out = { ...prev };
                  if (next === "") delete out.__shed; else out.__shed = next;
                  delete out.__pen; // a new shed invalidates whatever pen was picked under the old one
                  return out;
                });
              }}
            >
              <option value="">{t("mdFilterAll")}</option>
              {locationShedOptions.map((s) => (
                <option key={String(s.location_id)} value={String(s.location_id)}>
                  {String(s.location_code ?? s.location_name ?? s.location_id)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("mdFilterPen")} htmlFor={`master-${config.key}-filter-pen`} className="sm:col-span-6">
            <select
              id={`master-${config.key}-filter-pen`}
              className={`${inputCls} nf-select`}
              style={S.input}
              value={filterDraft.__pen ?? ""}
              disabled={!filterDraft.__shed}
              onChange={(e) => {
                const next = e.target.value;
                setFilterDraft((prev) => {
                  const out = { ...prev };
                  if (next === "") delete out.__pen; else out.__pen = next;
                  return out;
                });
              }}
            >
              <option value="">{t("mdFilterAll")}</option>
              {locationPenOptions.map((p) => (
                <option key={String(p.location_id)} value={String(p.location_id)}>
                  {String(p.location_code ?? p.location_name ?? p.location_id)}
                </option>
              ))}
            </select>
          </Field>
        </FieldGroup>
      )}
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

  // The drawer covers the table, so Apply always closes it back to the
  // filtered rows rather than leaving it open over them.
  const filterActions = (
    <>
      <button type="button" onClick={() => { setFilterDraft({}); setColFilters({}); }}
        className="rounded-lg border px-3 py-1.5 text-xs font-medium" style={S.surface}>
        {t("mdFiltersReset")}
      </button>
      <button type="button" onClick={() => { setColFilters(filterDraft); setFilterOpen(false); }}
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
    if (config.key !== "location") { setLocationFarmOptions([]); return; }
    api.get(`/location?filter[location_type]=FARM&limit=500`).then((r) => setLocationFarmOptions(unwrap<Row[]>(r) || [])).catch(() => setLocationFarmOptions([]));
  }, [config.key]);

  useEffect(() => {
    if (config.key !== "location" || !filterDraft.__farm) { setLocationShedOptions([]); return; }
    api.get(`/location?filter[parent_location_id]=${filterDraft.__farm}&filter[location_type]=SHED&limit=500`)
      .then((r) => setLocationShedOptions(unwrap<Row[]>(r) || []))
      .catch(() => setLocationShedOptions([]));
  }, [config.key, filterDraft.__farm]);

  useEffect(() => {
    if (config.key !== "location" || !filterDraft.__shed) { setLocationPenOptions([]); return; }
    api.get(`/location?filter[parent_location_id]=${filterDraft.__shed}&filter[location_type]=PEN&limit=500`)
      .then((r) => setLocationPenOptions(unwrap<Row[]>(r) || []))
      .catch(() => setLocationPenOptions([]));
  }, [config.key, filterDraft.__shed]);

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
    // entityReloadKey is included so creating a related record (e.g. a new
    // Item Category, Item Type or UOM) refetches this effect's
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
    // entityReloadKey changing means a related selector just created a row that a
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
        // limit=500 as the effect above sends. Without it the list API's default
        // page of 50 was the whole option list, so a dependent picker silently
        // offered whichever 50 rows sorted first.
        const activeOnlyEp = `${ep}${ep.includes("?") ? "&" : "?"}isActive=true&limit=500`;
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
    setIsManualNoAllowed(false);
    setTemplateLockedFields(new Set());
    const initial: Row = {};
    formFields.forEach((f) => {
      if (f.defaultValue !== undefined) {
        initial[f.key] = f.defaultValue;
      } else if (f.multiple && f.allOption) {
        initial[f.key] = [String(f.allOption[f.entityValueKey || "id"])];
      } else {
        initial[f.key] = f.type === "boolean" ? false : f.type === "string-list" || f.type === "field-list" || f.multiple ? [] : "";
      }
    });
    codeFieldTouchedRef.current = false;
    if (numbering.codeKey) {
      const currentPreview = numbering.preview || (numbering.value(numbering.codeKey, "") as string);
      if (currentPreview) initial[numbering.codeKey] = currentPreview;
    }
    setForm(initial);
    setActiveFormTab("");
    setChipDrafts({});
    setModalOpen(true);
  };

  // When a number series code preview arrives or updates, populate it into the form
  // only if the user has not manually touched/cleared the field.
  useEffect(() => {
    if (!modalOpen || editing || !numbering.codeKey) return;
    if (codeFieldTouchedRef.current) return;
    const preview = numbering.preview || (numbering.value(numbering.codeKey, "") as string);
    if (preview && (!form[numbering.codeKey] || !codeFieldTouchedRef.current)) {
      setForm((prev) => {
        if (codeFieldTouchedRef.current) return prev;
        if (prev[numbering.codeKey!] === preview) return prev;
        return { ...prev, [numbering.codeKey!]: preview };
      });
    }
  }, [modalOpen, editing, numbering.codeKey, numbering.preview]);

  const onConfirmTemplate = (generatedItem: any) => {
    setEditing(generatedItem);
    const initial: Row = {};
    formFields.forEach((f) => {
      initial[f.key] = f.type === "boolean" ? false : f.type === "string-list" || f.type === "field-list" || f.multiple ? [] : "";
    });

    initial.item_code = generatedItem.item_no || generatedItem.item_code || "";
    initial.item_type = generatedItem.item_type || "";
    initial.category_id = generatedItem.category || "";
    initial.sub_category = generatedItem.sub_category || "";
    initial.valuation_method = generatedItem.valuation_method || "";

    if (generatedItem.item_tracking === "LOT") {
      initial.is_tracked = true;
      initial.tracking_type = "LOT";
      initial.tracking_series_id = generatedItem.item_tracking_no_series_id || "";
      initial.is_lot_tracked = true;
      initial.is_serial_tracked = false;
    } else if (generatedItem.item_tracking === "SERIAL") {
      initial.is_tracked = true;
      initial.tracking_type = "SERIAL";
      initial.tracking_series_id = generatedItem.item_tracking_no_series_id || "";
      initial.is_lot_tracked = false;
      initial.is_serial_tracked = true;
    } else {
      initial.is_tracked = false;
      initial.tracking_type = "LOT";
      initial.tracking_series_id = "";
      initial.is_lot_tracked = false;
      initial.is_serial_tracked = false;
    }

    initial.is_inventoriable = generatedItem.inventory_type !== "NON_INVENTORY";
    initial.is_qr_enabled = generatedItem.qr_code_enabled ?? false;
    initial.inventory_gl_account = generatedItem.inventory_gl_account || "";
    initial.cogs_gl_account = generatedItem.cogs_gl_account || "";
    initial.item_template_id = generatedItem.item_template_id || generatedItem.id || "";

    // Fields not provided by the template remain empty
    initial.item_name = "";
    initial.uom_primary = "";
    initial.withdrawal_days = "";

    // Build the locked-field set: any key that received a non-empty, non-false
    // value from the template is locked so the user cannot override it.
    // item_code is always locked (auto-generated); all other locks are data-driven.
    const locked = new Set<string>();
    // item_code is always locked when coming from template
    if (initial.item_code) locked.add("item_code");
    if (initial.item_type) locked.add("item_type");
    if (initial.category_id) locked.add("category_id");
    if (initial.sub_category) locked.add("sub_category");
    if (initial.valuation_method) locked.add("valuation_method");
    // Tracking: lock the gate switch and its children when tracking is configured
    if (generatedItem.item_tracking && generatedItem.item_tracking !== "NONE") {
      locked.add("is_tracked");
      locked.add("tracking_type");
      if (initial.tracking_series_id) locked.add("tracking_series_id");
    }
    // Inventory type switch
    locked.add("is_inventoriable");
    // QR is always supplied by template (true or false)
    locked.add("is_qr_enabled");
    // GL accounts — only lock if the template actually set them
    if (initial.inventory_gl_account) locked.add("inventory_gl_account");
    if (initial.cogs_gl_account) locked.add("cogs_gl_account");

    setTemplateLockedFields(locked);
    setIsManualNoAllowed(!!generatedItem.manual_nos);
    setForm(initial);
    setActiveFormTab("");
    setChipDrafts({});
    setModalOpen(true);
  };

  useEffect(() => {
    if (!createOnly || createOnlyOpenedRef.current) return;
    createOnlyOpenedRef.current = true;
    openCreate();
  }, [createOnly]);

  const openEdit = (row: Row) => {
    if (readOnly) return;
    setEditing(row);
    setIsManualNoAllowed(false);
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
        const parsed = parseStringList(v);
        initial[f.key] = f.multiple && f.allOption && parsed.length === 0
          ? [String(f.allOption[f.entityValueKey || "id"])]
          : parsed;
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
    // storage_type is hidden from the form (see configs.ts) and derived from
    // location_type — but it's hidden from formFields too, so the loop above
    // never seeded it from the row at all. Derive it fresh here rather than
    // trust row.storage_type, since older STORE rows predate this field ever
    // being auto-set for anything but SILO and may still carry it as null.
    if (config.key === "location") {
      initial.storage_type = row.location_type === "SILO" || row.location_type === "STORE" ? row.location_type : "";
    }
    setForm(initial);
    codeFieldTouchedRef.current = false;
    setActiveFormTab("");
    setChipDrafts({});
    setModalOpen(true);
  };

  const setField = (key: string, value: any) => {
    if (key === numbering.codeKey) {
      codeFieldTouchedRef.current = true;
    }
    setForm((prev) => {
    const next = { ...prev, [key]: value };
    // Storage Location duplicated Location Type (STORE/SILO were already
    // choices there) and confused users into thinking they were two separate
    // decisions, so the field itself is hidden (configs.ts) and its value is
    // now derived entirely from location_type instead of asked for again.
    if (config.key === "location" && key === "location_type") {
      next.storage_type = value === "SILO" || value === "STORE" ? value : "";
      if (value !== "SILO") {
        next.silo_capacity_kg = "";
        next.silo_reorder_days = "";
      }
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
    // allOption ("All Stages" etc.) is exclusive with every real option in the
    // same multi-select: picking a specific one while All was checked drops
    // All, and picking All drops whatever specific ones were checked.
    if (toggled?.multiple && toggled.allOption && Array.isArray(value)) {
      const allVal = String(toggled.allOption[toggled.entityValueKey || "id"]);
      if (value.includes(allVal) && value.length > 1) {
        const hadAll = parseStringList(prev[key]).includes(allVal);
        next[key] = hadAll ? value.filter((v: string) => v !== allVal) : [allVal];
      }
    }
    // A control that appears part-way through the form starts on its stated
    // default rather than on nothing. Tracked By is a choice between two, not
    // three: "neither" is what the switch above it already says, so turning
    // tracking on lands on Lot until someone says otherwise.
    //
    // Excludes the field the user is actually editing (f.key === key): this
    // ran on every keystroke of every field carrying a defaultValue, so
    // clearing e.g. Increment By (default "1") to type a different number
    // snapped it straight back to "1" the instant it went empty — the field
    // fought its own edit instead of only defaulting a *different* field that
    // just became visible as a side effect of this change.
    config.fields.forEach((f) => {
      if (f.defaultValue === undefined || f.key === key) return;
      const shown = !f.visibleWhen || isFieldRequired({ ...f, required: false, requiredWhen: f.visibleWhen }, next);
      if (shown && (next[f.key] === "" || next[f.key] === undefined)) next[f.key] = f.defaultValue;
    });
    return next;
  });
};

  const handleSave = async () => {
    if (readOnly) return;
    setSaving(true);
    try {
      const isNumberSeriesForm = config.key === "number-series" || config.key === "no-series";
      for (const f of visibleFields) {
        // filterOnly normally means "not saved, so nothing to check". A control
        // standing in for real columns is the exception: it is not sent under
        // its own key, but it does decide what gets written.
        if (f.filterOnly && !f.booleanColumns) continue;
        let v = form[f.key];
        if ((v === "" || v === undefined || v === null) && f.key === numbering.codeKey && !codeFieldTouchedRef.current) {
          const fallbackVal = numbering.preview || numbering.value(f.key, "");
          if (fallbackVal) {
            v = fallbackVal;
            form[f.key] = fallbackVal;
          }
        }
        const isEmpty = v === "" || v === undefined || v === null || (Array.isArray(v) && !v.length);
        if (isEmpty && isFieldRequired(f, form)) {
          setActiveFormTab(f.section || "Identification");
          throw new Error(`"${tLabel(currentLabel(f, form))}" is required.`);
        }
        if (isNumberSeriesForm && !isEmpty) {
          if (f.maxLength && typeof v === "string" && v.length > f.maxLength) {
            setActiveFormTab(f.section || "Identification");
            throw new Error(`"${tLabel(currentLabel(f, form))}" cannot exceed ${f.maxLength} characters.`);
          }
          if (f.type === "number") {
            const num = Number(v);
            if (!isNaN(num)) {
              if ((f.key === "seq_length" || f.key === "increment_by") && !Number.isInteger(num)) {
                throw new Error(`"${tLabel(currentLabel(f, form))}" must be a whole number.`);
              }
              if (f.min !== undefined && num < f.min) {
                throw new Error(`"${tLabel(currentLabel(f, form))}" must be at least ${f.min}.`);
              }
              if (f.max !== undefined && num > f.max) {
                throw new Error(`"${tLabel(currentLabel(f, form))}" cannot exceed ${f.max}.`);
              }
            }
          }
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
        if (f.filterOnly || (f.readOnly && !(f.key === "item_code" && isManualNoAllowed))) continue;
        // A managed, manual-allowed code field is pre-filled with the series'
        // own next-number preview so the user always sees a value, but that is
        // a suggestion, not a choice. Sending it back untouched made every save
        // look like a manual override to the API (manualCode(), never
        // generateNext()), so the series' current_seq never advanced no matter
        // how many records were created — only a genuinely edited code should
        // take the manual path.
        if (f.key === numbering.codeKey && numbering.managed && numbering.allowManual && !codeFieldTouchedRef.current) {
          continue;
        }
        let v = form[f.key];
        if ((v === "" || v === undefined || v === null) && f.key === numbering.codeKey && !codeFieldTouchedRef.current) {
          const fallbackVal = numbering.preview || numbering.value(f.key, "");
          if (fallbackVal) v = fallbackVal;
        }
        // allOption is a display-only sentinel — "All Stages" selected alone
        // means the same as nothing selected (the API's own convention for
        // "no restriction"), so it is never actually sent.
        if (f.multiple && f.allOption && Array.isArray(v) && v.length === 1 && v[0] === String(f.allOption[f.entityValueKey || "id"])) {
          v = [];
        }
        if (v === "" || v === undefined || v === null) continue;
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

      if (form.item_template_id || editing?.item_template_id) {
        payload.item_template_id = form.item_template_id || editing?.item_template_id;
      }
      if (form.inventory_gl_account) {
        payload.inventory_gl_account = form.inventory_gl_account;
      }
      if (form.cogs_gl_account) {
        payload.cogs_gl_account = form.cogs_gl_account;
      }
      if (editing?.status === "DRAFT") {
        payload.status = "ACTIVE";
      }

      const hasCompanyField = config.fields.some((f) => f.key === "company_id");
      if (!editing && companyId && hasCompanyField) payload.company_id = companyId;

      // storage_type is hidden from the form (derived from location_type, see
      // setField/openEdit above) and so excluded from visibleFields — without
      // this it would never reach the payload loop above at all. Only sent
      // when it actually applies (STORE/SILO): the generic loop above skips
      // every other empty field rather than sending "", and update() writes
      // whatever it's given with no null-normalization of its own, so sending
      // "" here for every other location type would overwrite a correct null
      // with a stored empty string on the next unrelated edit.
      if (config.key === "location" && form.storage_type) payload.storage_type = form.storage_type;

      if (editing) {
        await api.put(`${config.apiBase}/${editing[config.idKey]}`, payload);
        setModalOpen(false);
        showToast.success("Updated successfully");
        load();
      } else {
        const response = await api.post(config.apiBase, payload);
        const created = unwrap<Row>(response);
        setModalOpen(false);
        showToast.success("Created successfully");
        onCreated?.(created);
        // The Farm/Shed/Pen filter narrows the list to one parent's children.
        // A location just created under a different parent — most visibly a
        // brand-new root Farm, which has no parent at all — can never match
        // that filter, so it would report success and then silently vanish
        // from view. Clearing it here, instead of reloading under the stale
        // filter, is what lets the record the user just created actually show
        // up; the colFilters-watching effect above reloads once it's cleared.
        const activeParentFilter = config.key === "location"
          ? colFilters.__pen || colFilters.__shed || colFilters.__farm
          : undefined;
        const createdParentId = (created as any)?.parent_location_id || "";
        if (activeParentFilter && activeParentFilter !== createdParentId) {
          setColFilters((prev) => {
            const next = { ...prev };
            delete next.__farm; delete next.__shed; delete next.__pen;
            return next;
          });
          setFilterDraft((prev) => {
            const next = { ...prev };
            delete next.__farm; delete next.__shed; delete next.__pen;
            return next;
          });
        } else if (!createOnly) {
          load();
        }
      }
    } catch (err: any) {
      const msg = err?.message || t("mdFailedToSave");
      showToast.error(msg);
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
      showToast.success("Deleted successfully");
      load();
    } catch (err: any) {
      const msg = err?.message || t("mdFailedToDelete");
      showToast.error(msg);
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
        showToast.success("Activated successfully");
      } else {
        await api.delete(`${config.apiBase}/${id}`);
        showToast.success("Deactivated successfully");
      }
      load();
    } catch (err: any) {
      const msg = err?.message || t("mdFailedToSave");
      showToast.error(msg);
    } finally {
      setTogglingId(null);
    }
  };

  const renderField = (f: MasterDataField) => {
    const isLockedByTemplate = templateLockedFields.has(f.key);
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
            disabled={isLockedByTemplate}
            className="h-5 w-5 rounded-[var(--radius-xs)] accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
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
                      col.multiple ? (
                        <EntityLookupField
                          id={rowFieldId}
                          label={tLabel(col.label)}
                          options={entityOptions[col.entityEndpoint || ""] || []}
                          value={parseStringList(row[col.key])}
                          valueKey={col.entityValueKey || "id"}
                          labelKeys={col.entityLabelKeys || []}
                          onChange={(next) => write(rows.map((r, i) => i === idx ? { ...r, [col.key]: next } : r))}
                          multiple
                          disabled={readOnly || (isLocked(row) && col.key === req?.key)}
                          loading={!!col.entityEndpoint && entityOptions[col.entityEndpoint] === undefined}
                          placeholder={t("selectPlaceholder")}
                        />
                      ) : (
                        (() => {
                          const rowRelatedConfig = relatedConfigFor(col, resolveEndpoint(col, row) || col.entityEndpoint || null);
                          const applyToRow = (value: string) => write(rows.map((r, i) => i === idx ? { ...r, [col.key]: value } : r));
                          return (
                            <SearchableEntitySelect
                              id={rowFieldId}
                              ariaLabel={tLabel(col.label)}
                              value={String(row[col.key] ?? "")}
                              onChange={applyToRow}
                              options={entityOptions[col.entityEndpoint || ""] || []}
                              valueKey={col.entityValueKey || "id"}
                              getLabel={(option) => entityLabel(option, col)}
                              getLabelParts={(option) => entityLabelPartsOf(option, col)}
                              disabled={readOnly || (isLocked(row) && col.key === req?.key)}
                              loading={!!col.entityEndpoint && entityOptions[col.entityEndpoint] === undefined}
                              placeholder={t("selectPlaceholder")}
                              searchPlaceholder={t("searchPlaceholder")}
                              noMatchesLabel={t("mdNoMatches")}
                              onCreate={rowRelatedConfig ? () => setRelatedCreator({ field: col, config: rowRelatedConfig, onApply: applyToRow }) : undefined}
                              onViewAll={rowRelatedConfig ? () => setRelatedPicker({ field: col, config: rowRelatedConfig, options: entityOptions[col.entityEndpoint || ""] || [], currentValue: String(row[col.key] ?? ""), onApply: applyToRow }) : undefined}
                            />
                          );
                        })()
                      )
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
                        type={col.type === "number" ? "number" : "text"} step={col.step} min={col.min} max={col.max} placeholder={col.placeholder}
                        value={String(row[col.key] ?? "")}
                        onKeyDown={(e) => {
                          if (col.type !== "number") return;
                          if (e.key === "e" || e.key === "E") e.preventDefault();
                          if ((e.key === "+" || e.key === "-") && col.min !== undefined && col.min >= 0) e.preventDefault();
                        }}
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
                disabled={f.readOnly || isLockedByTemplate}
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
    // A closed set of values reads the same way a referenced master does: a
    // search box with the options listed under it. A native <select> in a long
    // list is the control the client asked us to stop using, and there is no
    // reason a status or a trigger should behave differently from a location.
    //
    // No New / View All here: a static enum has no master behind it to create a
    // row in. The value written is still the option's own string, exactly as the
    // native control produced, so nothing downstream of this field changes.
    if (f.type === "select") {
      let options = f.options || [];
      if ((config.key === "number-series" || config.key === "no-series") && f.key === "document_type" && inventorySetupNumbering) {
        options = options.filter((opt) => {
          const cfg = inventorySetupNumbering[opt.value];
          return cfg !== undefined ? cfg.enabled === true : true;
        });
      }
      return (
        <SearchableEntitySelect
          id={accessibility.id}
          ariaLabel={accessibility["aria-label"]}
          ariaRequired={accessibility["aria-required"]}
          value={String(value ?? "")}
          onChange={(next) => setField(f.key, next)}
          options={options}
          valueKey="value"
          getLabel={(o) => String(o.label ?? "")}
          placeholder={t("selectPlaceholder")}
          searchPlaceholder={t("searchPlaceholder")}
          noMatchesLabel={t("mdNoMatches")}
          disabled={isLockedByTemplate}
          onClear={!isFieldRequired(f, form) && value && !isLockedByTemplate ? () => setField(f.key, "") : undefined}
        />
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
      const relatedConfig = relatedConfigFor(f, resolvedEp);
      if (f.multiple) {
        if (f.allOption) options = [f.allOption, ...options];
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
            disabled={disabled || !!f.readOnly || isLockedByTemplate}
            loading={!!resolvedEp && loadedOptions === undefined}
            placeholder={restrictedReason || (disabled ? t("selectXFirst", { name: parentLabel }) : t("selectPlaceholder"))}
            onCreate={relatedConfig ? () => setRelatedCreator({ field: f, config: relatedConfig }) : undefined}
          />
        );
      }
      const placeholderText = restrictedReason || (disabled ? t("selectXFirst", { name: parentLabel }) : t("selectPlaceholder"));
      return (
        <SearchableEntitySelect
          id={accessibility.id}
          ariaLabel={accessibility["aria-label"]}
          ariaRequired={accessibility["aria-required"]}
          value={String(value ?? "")}
          onChange={(next) => setField(f.key, next)}
          options={options}
          valueKey={f.entityValueKey || "id"}
          getLabel={(o) => entityLabel(o, f)}
          getLabelParts={(o) => entityLabelPartsOf(o, f)}
          disabled={disabled || !!f.readOnly || isLockedByTemplate}
          loading={!!resolvedEp && loadedOptions === undefined}
          placeholder={placeholderText}
          searchPlaceholder={t("searchPlaceholder")}
          noMatchesLabel={t("mdNoMatches")}
          onClear={!isFieldRequired(f, form) && value && !isLockedByTemplate ? () => setField(f.key, "") : undefined}
          onCreate={relatedConfig ? () => setRelatedCreator({ field: f, config: relatedConfig }) : undefined}
          onViewAll={relatedConfig ? () => setRelatedPicker({ field: f, config: relatedConfig, options }) : undefined}
        />
      );
    }
    const isDisabled = (f.readOnly && !(f.key === "item_code" && isManualNoAllowed)) || isLockedByTemplate;
    const isInteger = f.type === "number" && (f.step === "1" || !f.step);
    // A field like GPS Latitude/Longitude allows a negative sign only when its
    // floor is unset or itself negative — same rule the keydown guard below uses.
    const allowNegative = f.type === "number" && (f.min === undefined || f.min < 0);
    // native <input type="number"> reformats a very small magnitude (e.g. a
    // longitude near the equator, 0.00000099) into scientific notation the
    // moment it loses focus — a browser-level quirk with no attribute to turn
    // off. type="text" with digit-only filtering below sidesteps it entirely:
    // the field only ever holds exactly what was typed. A field marked
    // nativeNumber (a small bounded integer, e.g. sequence digits) never gets
    // near that quirk, so it keeps the native input — spinner included.
    const useNativeNumber = f.type === "number" && !!f.nativeNumber;
    const numberPattern = f.type === "number" && !useNativeNumber
      ? new RegExp(`^${allowNegative ? "-?" : ""}\\d*${isInteger ? "" : "\\.?\\d*"}$`)
      : undefined;

    return (
      <input
        {...accessibility}
        type={f.type === "number" ? (useNativeNumber ? "number" : "text") : f.type === "email" ? "email" : f.type === "date" ? "date" : "text"}
        inputMode={f.type === "number" && !useNativeNumber ? (isInteger ? "numeric" : "decimal") : undefined}
        step={f.step}
        min={f.min}
        max={f.max}
        maxLength={f.maxLength}
        value={value}
        onKeyDown={(e) => {
          if (f.type === "number") {
            // Block scientific notation 'e'/'E' always. '+' and '-' only when
            // this field has a non-negative floor — min unset (or negative)
            // means the field is one of the few that genuinely needs a
            // negative value (e.g. Storage Temp Min/Max, a temperature-based
            // KPI threshold), so the sign key stays live for those.
            if (e.key === "e" || e.key === "E") {
              e.preventDefault();
            }
            if ((e.key === "+" || e.key === "-") && f.min !== undefined && f.min >= 0) {
              e.preventDefault();
            }
            // Block decimal point on integer-only fields
            if (isInteger && e.key === ".") {
              e.preventDefault();
            }
          }
        }}
        onChange={(e) => {
          const val = e.target.value;
          // Reject anything that isn't a valid (possibly partial) plain decimal —
          // catches paste/autofill too, not just keystrokes, so 'e'/'E' can never
          // land in state regardless of how it arrived.
          if (numberPattern && !numberPattern.test(val)) {
            return;
          }
          // Guard for max length if input type is number (browser ignores maxLength on type=number)
          if (f.type === "number" && f.maxLength && val.length > f.maxLength) {
            return;
          }
          // No max-value rejection here on purpose. Editing "4" into "10" by
          // typing at the end (not clearing first) passes through "40" for one
          // keystroke — silently swallowing that keystroke, as this used to,
          // reads as the field refusing to accept typing at all (reported for
          // Digits/Sequence Length, min 1 max 10). Out-of-range values are
          // still caught, just at save — see the isNumberSeriesForm check
          // above, and the backend's own validation for every other master.
          setField(f.key, val);
        }}
        placeholder={f.placeholder}
        disabled={isDisabled}
        className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-70`}
        style={isDisabled ? { ...S.input, backgroundColor: "var(--surface-raised)" } : S.input}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {showHeader && !createOnly && (
        <div
          data-master-sticky-header="true"
          className="sticky top-0 z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-7 lg:px-7 pt-2.5 pb-3.5 bg-[var(--bg)]/95 backdrop-blur-md border-b border-[var(--border)] shadow-xs transition-all flex flex-col gap-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
            {/* Title, Badges, Description Tooltip */}
            <div className="flex items-center flex-wrap gap-2.5 min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)] truncate">
                {tLabel(config.label)}
              </h1>

              {config.group && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-[var(--surface-raised)] border border-[var(--border)] text-[var(--text-secondary)]">
                  {tLabel(config.group)}
                </span>
              )}

              {typeof serverTotal === "number" && serverTotal >= 0 && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)]">
                  {serverTotal} {serverTotal === 1 ? "record" : "records"}
                </span>
              )}

              {config.description && (
                <DescriptionTooltip
                  title={tLabel(config.label)}
                  description={tLabel(config.description)}
                />
              )}
            </div>

            {/* Header Action Buttons */}
            <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
              {config.key === "item" && !readOnly && canCreateItem && (
                <button
                  type="button"
                  onClick={() => setTemplateModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-xs transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] active:scale-95 cursor-pointer"
                  style={S.surface}
                  title="Select item template"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Template</span>
                </button>
              )}

              {!readOnly && !exhausted && (
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-all hover:opacity-95 active:scale-95 cursor-pointer"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  <Plus className="h-4 w-4" />
                  <span>{t("addItem", { name: tLabel(singularLabel(config)) })}</span>
                </button>
              )}
            </div>
          </div>

          {/* Sub-navigation tabs (if any) pinned directly below the title and action row */}
          {tabs && (
            <div className="pt-0.5">
              {tabs}
            </div>
          )}

          {/* Controls toolbar: Search, Filters, NOB/LOB */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1.5 border-t border-[var(--border)]/60">
            <div className="flex flex-wrap items-center gap-2">
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
                  className="nf-input-sm w-44 sm:w-60"
                  style={{ ...S.input, paddingLeft: "1.75rem", paddingRight: search ? "1.75rem" : undefined }}
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    title="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {columns.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setFilterDraft(colFilters); setFilterOpen(true); }}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors hover:border-(--accent) hover:text-(--accent) cursor-pointer"
                  style={appliedFilterCount ? { ...S.surface, borderColor: "var(--accent)", color: "var(--accent)" } : S.surface}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                  <span>{t("mdFilters")}</span>
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
            </div>
          </div>
        </div>
      )}

      {/* A create-only instance is a form summoned from another form's field.
          It has no record set of its own to show, so it renders the dialog
          alone — the toolbar, chips, table and pager below would put a second
          master page inside the form the user is already filling in. */}
      {!createOnly && (
      <>
      {!showHeader && (
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
                style={{ ...S.input, paddingLeft: "1.75rem" }}
              />
            </div>
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
            {config.key === "item" && !readOnly && canCreateItem && (
              <button
                type="button"
                onClick={() => setTemplateModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors hover:border-(--accent) hover:text-(--accent)"
                style={S.surface}
              >
                <FileText className="h-3.5 w-3.5" /> Template
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
      )}

      {bcOwned && <BcOwnershipNotice config={config} />}
      {administrationRestricted && <p className="rounded-lg border p-3 text-sm" style={S.raised}>Only a Tenant Admin or Company Admin can add, edit or deactivate reasons. You can view the shared catalog here.</p>}

      {/* The filter panel is a second column of this grid, not a layer over
          it: the table narrows and the panel takes the space, so the rows
          being filtered stay visible and nothing is buried behind a scrim. */}
      <div className={selectedRow ? "grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" : undefined}>
      <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border flex flex-col" style={S.surface}>
        <div className="overflow-x-auto max-h-[calc(100vh-270px)] overflow-y-auto">
          <table className="w-full border-collapse text-left text-sm">
            <TableHeader className="sticky top-0 z-10 bg-[var(--surface-raised)] shadow-xs">
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
                        <TableCell key={c.key} className="whitespace-nowrap" style={S.primary}>{displayValue(row, c.key, t("mdYes"), t("mdNo"), c)}</TableCell>
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
          <div className="sticky bottom-0 z-10 bg-[var(--surface)] border-t px-2 shadow-xs" style={{ borderColor: "var(--border)" }}>
            <Pagination page={page} pageSize={pageSize} total={pagerTotal} onPageChange={setPage} onPageSizeChange={setPageSize} pageSizeOptions={[25, 50, 100]} />
          </div>
        )}
      </div>
      {selectedRow && detailFor === "animal" && (
        <div className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-8rem)]">
          <AnimalDetailPanel row={selectedRow} onClose={() => setSelectedId(null)} />
        </div>
      )}
      </div>
      </>
      )}

      {viewingId && <MasterRecordView config={config} id={viewingId} onClose={() => setViewingId(null)} />}

      {/* Every master form shares the same responsive frame and pinned actions.
          Section count changes its content layout, never the window size. */}
      <Dialog
        open={modalOpen && !readOnly}
        onClose={() => {
          if (saving) return;
          if (editing?.status === "DRAFT" && (!form.item_name || !String(form.item_name).trim())) {
            api.delete(`${config.apiBase}/${editing[config.idKey]}`).catch(() => {});
          }
          setModalOpen(false);
          setActiveFormTab("");
          setTemplateLockedFields(new Set());
          if (createOnly) onCreateCancelled?.();
        }}
        title={editing ? t("editItem", { name: tLabel(singularLabel(config)) }) : t("addItem", { name: tLabel(singularLabel(config)) })}
        maxWidth="xl"
        presentation="modal"
        footer={
          <button
            onClick={handleSave}
            disabled={
              saving ||
              numbering.loading ||
              numberingBlocks ||
              (config.key === "item" && (!form.item_name?.trim() || !form.uom_primary?.trim()))
            }
            className="rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-xs transition-all hover:opacity-95 active:scale-95 disabled:opacity-50 cursor-pointer"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {saving ? t("saving") : editing ? t("saveChanges") : t("create")}
          </button>
        }
      >
        <div className="flex flex-col gap-4">
          {(() => {
            const DEFAULT = "Identification";
            const order: string[] = [];
            const bySection = new Map<string, typeof visibleFields>();
            for (const f of visibleFields) {
              const s = f.section || DEFAULT;
              if (!bySection.has(s)) { bySection.set(s, []); order.push(s); }
              bySection.get(s)!.push(f);
            }
            const identificationIndex = order.indexOf(DEFAULT);
            if (identificationIndex > 0) order.unshift(...order.splice(identificationIndex, 1));

            // If only one tab/section, show directly without tabs
            if (order.length <= 1) {
              return (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {visibleFields.map((f) => (
                    <Field
                      key={f.key}
                      label={tLabel(currentLabel(f, form))}
                      htmlFor={`master-${config.key}-${f.key}`}
                      required={isFieldRequired(f, form)}
                      hint={templateLockedFields.has(f.key) ? "🔒 Set by template" : undefined}
                      tooltip={f.helpText}
                      className={f.type === "textarea" || f.type === "json" || f.type === "string-list" ? "sm:col-span-2" : undefined}
                    >
                      {renderField(f)}
                    </Field>
                  ))}
                </div>
              );
            }

            // Multiple sections -> show horizontal tabs across the top
            const currentTab = (activeFormTab && order.includes(activeFormTab)) ? activeFormTab : order[0];
            const activeFields = bySection.get(currentTab) || [];

            return (
              <div className="flex flex-col gap-4">
                {/* Horizontal Tab Bar */}
                <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border)] -mx-5 px-5 sm:-mx-6 sm:px-6 -mt-1 pb-px scrollbar-none" role="tablist">
                  {order.map((section) => {
                    const isSelected = currentTab === section;
                    const fieldsInSection = bySection.get(section) || [];
                    const missingRequired = fieldsInSection.some((f) => {
                      if (!isFieldRequired(f, form)) return false;
                      const val = f.key === numbering.codeKey
                        ? (form[f.key] || (!codeFieldTouchedRef.current ? numbering.preview : ""))
                        : form[f.key];
                      return val === "" || val === undefined || val === null;
                    });

                    const Icon = getSectionIcon(section);

                    return (
                      <button
                        key={section}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        tabIndex={isSelected ? 0 : -1}
                        onKeyDown={(e) => {
                          const idx = order.indexOf(section);
                          if (e.key === "ArrowRight") {
                            e.preventDefault();
                            const next = order[(idx + 1) % order.length];
                            setActiveFormTab(next);
                          } else if (e.key === "ArrowLeft") {
                            e.preventDefault();
                            const prev = order[(idx - 1 + order.length) % order.length];
                            setActiveFormTab(prev);
                          }
                        }}
                        onClick={() => setActiveFormTab(section)}
                        className={cn(
                          "relative shrink-0 whitespace-nowrap px-3.5 py-2.5 text-xs transition-colors cursor-pointer flex items-center gap-2 rounded-t-md",
                          isSelected
                            ? "font-semibold text-[var(--text-primary)]"
                            : "font-normal text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-raised)]/50"
                        )}
                      >
                        <Icon className={cn("h-3.5 w-3.5 shrink-0 transition-colors", isSelected ? "text-[var(--accent)]" : "text-[var(--text-muted)]")} />
                        <span>{section}</span>
                        {missingRequired && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" title="Contains incomplete required fields" />
                        )}
                        {isSelected && (
                          <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--accent)]" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Form fields for the active tab */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-1">
                  {activeFields.map((f) => (
                    <Field
                      key={f.key}
                      label={tLabel(currentLabel(f, form))}
                      htmlFor={`master-${config.key}-${f.key}`}
                      required={isFieldRequired(f, form)}
                      hint={templateLockedFields.has(f.key) ? "🔒 Set by template" : undefined}
                      tooltip={f.helpText}
                      className={f.type === "textarea" || f.type === "json" || f.type === "string-list" ? "sm:col-span-2" : undefined}
                    >
                      {renderField(f)}
                    </Field>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </Dialog>

      <Dialog open={!!lookupManager} title={`Manage ${lookupManager?.label || ""}`} maxWidth="xl"
        onClose={() => { setLookupManager(null); setEntityReloadKey((k) => k + 1); numbering.refresh(); }}>
        {lookupManager && <MasterDataTable key={lookupManager.key} config={lookupManager} showHeader={false} />}
      </Dialog>

      {relatedPicker && (
        <EntityLookupDialog
          open
          onClose={() => setRelatedPicker(null)}
          label={tLabel(currentLabel(relatedPicker.field, form))}
          options={relatedPicker.options}
          value={relatedPicker.currentValue ?? String(form[relatedPicker.field.key] ?? "")}
          valueKey={relatedPicker.field.entityValueKey || "id"}
          labelKeys={relatedPicker.field.entityLabelKeys || []}
          onChange={(value) => {
            // This dialog's onChange is typed for its `multiple` mode too, but
            // relatedPicker never sets it — always a single id in practice.
            const picked = Array.isArray(value) ? value[0] ?? "" : value;
            if (relatedPicker.onApply) relatedPicker.onApply(picked);
            else setField(relatedPicker.field.key, picked);
            setRelatedPicker(null);
          }}
          onCreate={() => {
            setRelatedCreator({ field: relatedPicker.field, config: relatedPicker.config, onApply: relatedPicker.onApply });
            setRelatedPicker(null);
          }}
        />
      )}

      {relatedCreator && (
        <MasterDataTable
          config={relatedCreator.config}
          createOnly
          showHeader={false}
          onCreateCancelled={() => setRelatedCreator(null)}
          onCreated={(created) => {
            const valueKey = relatedCreator.field.entityValueKey || relatedCreator.config.idKey;
            const id = created?.[valueKey] ?? created?.[relatedCreator.config.idKey];
            setEntityReloadKey((key) => key + 1);
            if (id !== undefined && id !== null) {
              if (relatedCreator.onApply) relatedCreator.onApply(String(id));
              else setField(relatedCreator.field.key, String(id));
            }
            setRelatedCreator(null);
          }}
        />
      )}

      <Dialog
        open={!!confirmDelete}
        onClose={() => !deleting && setConfirmDelete(null)}
        title={t("deactivateRecordTitle")}
        presentation="compact"
        description={confirmDelete ? t("deactivateRecordDesc", { name: confirmDelete[columns[0]?.key] ?? confirmDelete[config.idKey], label: tLabel(config.label) }) : undefined}
        maxWidth="sm"
        footer={
          <button onClick={handleDelete} disabled={deleting} className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 cursor-pointer" style={{ backgroundColor: "var(--danger)" }}>
            {deleting ? t("deactivating") : t("deactivate")}
          </button>
        }
      >
        <p className="text-sm" style={S.sub}>{t("confirmDeactivate")}</p>
      </Dialog>

      {/* Filters float over the table as an overlay drawer rather than a
          docked side column, so the table never gets squeezed narrower while
          filtering. Desktop gets a right-edge panel, mobile a bottom sheet —
          Drawer handles both from one definition. */}
      <Drawer
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title={t("mdFilters")}
        description={t("mdFiltersDesc", { label: tLabel(config.label) })}
        footer={filterActions}
      >
        {filterFields}
      </Drawer>

      {config.key === "item" && (
        <ItemTemplateSelectModal
          open={templateModalOpen}
          onClose={() => setTemplateModalOpen(false)}
          onConfirm={onConfirmTemplate}
        />
      )}

    </div>
  );
}

export default MasterDataTable;
