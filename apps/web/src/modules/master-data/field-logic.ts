import type { MasterDataField, RequiredCondition } from './types';

type Row = Record<string, any>;

/**
 * Pure field-level rules shared by the live create/edit form (MasterDataTable) and the
 * bulk CSV importer (MasterDataImportModal), so a row built from a spreadsheet is held to
 * exactly the same visibility/required/FK-lookup rules as one typed into the dialog — the
 * two must never silently diverge (19 Nov).
 */

export function parentKeys(f: MasterDataField): string[] {
  if (!f.dependsOn) return [];
  return Array.isArray(f.dependsOn) ? f.dependsOn : [f.dependsOn];
}

export function matchesCondition(cond: RequiredCondition, form: Row): boolean {
  const raw = form[cond.key];
  const depValue = raw === undefined || raw === null ? '' : raw;
  if (cond.startsWith !== undefined)
    return String(depValue)
      .toUpperCase()
      .startsWith(cond.startsWith.toUpperCase());
  if (cond.equals !== undefined) {
    const list = Array.isArray(cond.equals) ? cond.equals : [cond.equals];
    return list.some((item: any) => {
      const target = item === undefined || item === null ? '' : item;
      return target === depValue;
    });
  }
  if (cond.notEquals !== undefined) {
    const list = Array.isArray(cond.notEquals)
      ? cond.notEquals
      : [cond.notEquals];
    return !list.some((item: any) => {
      const target = item === undefined || item === null ? '' : item;
      return target === depValue;
    });
  }
  return depValue !== '' && depValue !== false;
}

/** Whether `f` is required right now — statically, or via `requiredWhen` against the live form values. */
export function isFieldRequired(f: MasterDataField, form: Row): boolean {
  if (f.required) return true;
  if (!f.requiredWhen) return false;
  if (
    f.requiredWhen.anyOf &&
    f.requiredWhen.anyOf.some((cond) => matchesCondition(cond, form))
  ) {
    return true;
  }
  if (
    f.requiredWhen.allOf &&
    f.requiredWhen.allOf.every((cond) => matchesCondition(cond, form))
  ) {
    return true;
  }
  return false;
}

/** Whether `f` is visible right now via `visibleWhen` against the live form values. */
export function isFieldVisible(f: MasterDataField, form: Row): boolean {
  if (!f.visibleWhen) return true;
  if (
    f.visibleWhen.anyOf &&
    !f.visibleWhen.anyOf.some((cond) => matchesCondition(cond, form))
  ) {
    return false;
  }
  if (
    f.visibleWhen.allOf &&
    !f.visibleWhen.allOf.every((cond) => matchesCondition(cond, form))
  ) {
    return false;
  }
  return true;
}

/**
 * A select-entity field's actual endpoint for the given (partial) row values.
 * - "path" mode (default, single parent): substitutes "{value}" with the parent's current
 *   value; returns null (blocking the field) while that parent is unset.
 * - "query" mode (one or more parents): appends each set parent as a query param via
 *   queryParams; unset parents are simply omitted rather than blocking the fetch.
 */
export function resolveEndpoint(f: MasterDataField, form: Row): string | null {
  if (!f.entityEndpoint) return null;
  const parents = parentKeys(f);
  if (parents.length === 0) return f.entityEndpoint;

  if (f.dependsOnMode === 'query') {
    const params = new URLSearchParams();
    for (const key of parents) {
      const raw = form[key];
      const paramName = f.queryParams?.[key];
      const map = f.queryValueMap?.[key];
      const val = map ? (raw ? map[String(raw)] : undefined) : raw;
      if (val && paramName) params.set(paramName, val);
    }
    const qs = params.toString();
    return qs
      ? `${f.entityEndpoint}${f.entityEndpoint.includes('?') ? '&' : '?'}${qs}`
      : f.entityEndpoint;
  }

  const parentVal = form[parents[0]];
  if (!parentVal) return null;
  return f.entityEndpoint.replace('{value}', parentVal);
}
