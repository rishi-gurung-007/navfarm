import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { ITEM_KINDS, ItemKind, kindMatchers } from '../../../common/item-kinds';
import { masterScopeConditions } from '../../../common/master-data-scope';

/**
 * The `itemType` filter of GET /item, as a SQL condition.
 *
 * Porta Farm's living-asset type is code "LA-001" named "Living Asset", so
 * `?itemType=LIVESTOCK` matched nothing and the Animal Register's picker was
 * empty. When the filter names one of our KINDS, the condition matches the
 * item's own `item_type` **or** any of the tenant's types whose code or name
 * says it is that kind — in SQL, because the list is paged and a decision made
 * in JavaScript afterwards would filter one page, not the query.
 *
 * Anything that is not a kind (MEDICINE, VACCINE, a tenant's own code) keeps
 * the exact match it has always had.
 */
export function itemKindCondition(itemType: string, tenantId: string, scope: ClsService | string | null, requestedCompany?: string): SQL {
  const asked = itemType.trim().toUpperCase();
  const kind = ITEM_KINDS.find((k) => k === asked);
  const exact = eq(schema.itemMaster.item_type, itemType);
  if (!kind) return exact;

  const m = kindMatchers(kind as ItemKind);
  const T = schema.itemTypeMaster;
  const codeOrName = or(
    inArray(T.type_code, m.codes),
    ...m.codePrefixes.map((prefix) => like(T.type_code, `${prefix}%`)),
    // Whole-word-ish: a name containing the fragment. "Feeder trough" would
    // pass this, which is why the API only reaches here for a type someone
    // actually chose for an item — and why itemKindOf is the stricter reader.
    ...m.nameFragments.map((fragment) => like(sql`LOWER(${T.type_name})`, `%${fragment}%`)),
  )!;

  /**
   * The types are scoped exactly as the items are. Passing the CLS runs the
   * same masterScopeConditions the caller applied to item_master, so the type
   * lookup can never be narrower than the item lookup — which it was when this
   * resolved the company itself and got null: the items came back company-scoped
   * while the types were narrowed to tenant templates, and Porta's own LA-001
   * type fell outside its own query.
   */
  const scopeConditions =
    typeof scope === 'string' || scope === null
      ? [eq(T.tenant_id, tenantId), scope ? or(eq(T.company_id, scope), isNull(T.company_id))! : sql`1 = 1`]
      : masterScopeConditions(scope, T, requestedCompany);

  const kindTypes = sql`(
    SELECT ${T.type_code} FROM ${T}
    WHERE ${and(
      eq(T.tenant_id, tenantId),
      isNull(T.deleted_at),
      ...scopeConditions,
      codeOrName,
    )}
  )`;

  return or(exact, sql`${schema.itemMaster.item_type} IN ${kindTypes}`)!;
}
