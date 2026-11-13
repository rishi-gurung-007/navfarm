import { BadRequestException } from '@nestjs/common';
import {
  ENTRY_TYPES_BY_TRANSACTION_TYPE,
  INVENTORY_TRANSACTION_TYPES,
  type InventoryTransactionType,
} from '../../inventory/inventory-ledger/inventory-ledger.types';
import { GL_MAPPING_TYPE_RULES, mappingDimensions, type MappingDimension } from './gl-mapping-fields';

/**
 * What a G/L Mapping can be set up for: the Inventory Ledger's own vocabulary (INVENTORY_TRANSACTION_TYPES), and, for a mapping that names an entry type, an
 * entry type that transaction type is actually written with (ENTRY_TYPES_BY_TRANSACTION_TYPE). Finance maps accounts by transaction type and entry type; the
 * ledger row says which it is, so a pairing the ledger never writes (a PURCHASE that is NEGATIVE) could never match and is refused up front.
 *
 * Mappings whose type is not an inventory type (the BIO_*, MORTALITY, variance ones the batch and animal postings look up by name) were created by the setup
 * seed and still post: they are never offered for a new mapping, and one that already exists keeps its type, so it can still be edited.
 */
export const isInventoryTransactionType = (type: string): type is InventoryTransactionType =>
  (INVENTORY_TRANSACTION_TYPES as readonly string[]).includes(type);

/** A new mapping, or an edit that changes the type, must use an inventory transaction type. An edit that leaves the type alone is not asked. */
export function assertMappableTransactionType(transactionType: string, current?: string | null) {
  const type = transactionType.toUpperCase();
  if (current && type === current) return;
  if (!isInventoryTransactionType(type)) {
    throw new BadRequestException(
      `'${transactionType}' is not an Inventory Ledger transaction type. A G/L Mapping is set up for one of: ${INVENTORY_TRANSACTION_TYPES.join(', ')}.`,
    );
  }
}

/**
 * An entry type must be one the transaction type is written with: the Inventory Ledger's own list for its types, and for a bio posting written as a ledger
 * row (BIO_CONSUMPTION_*, BIO_SEMEN_*, BIO_OUTPUT, BIO_HARVEST, BIO_FA_CONVERSION) the entry type that row is written with (gl-mapping-fields.ts). A type
 * posted with no ledger row is refused any entry type by assertDimensionsFit.
 */
export function assertEntryTypeFits(transactionType: string, entryType: string | null | undefined) {
  if (!entryType) return;
  const type = transactionType.toUpperCase();
  const rule = GL_MAPPING_TYPE_RULES.find((r) => r.type === type);
  if (!isInventoryTransactionType(type)) {
    if (rule?.entryTypes.length && !rule.entryTypes.includes(entryType)) {
      throw new BadRequestException(`A ${type} entry is written as ${rule.entryTypes.join(' or ')}, not ${entryType}. Choose one of those, or leave Entry Type blank.`);
    }
    return;
  }
  const allowed = ENTRY_TYPES_BY_TRANSACTION_TYPE[type];
  if (!allowed.includes(entryType as never)) {
    throw new BadRequestException(`A ${type} entry is written as ${allowed.join(' or ')}, not ${entryType}. Choose one of those, or leave Entry Type blank.`);
  }
}

const DIMENSION_LABEL: Record<MappingDimension, string> = {
  item_category_id: 'Item Category', nob_id: 'Nature of Business', lob_id: 'Line of Business', stage_id: 'Production Stage', valuation_method: 'Valuation Method', entry_type: 'Entry Type',
};

/**
 * A mapping may be narrowed only by what its posting is matched on (gl-mapping-fields.ts): a batch or animal cost is looked up by NOB, LOB and stage alone, so
 * a category, valuation method or entry type on it would never let it be chosen. `values` holds the fields the request sets; a blank one is not asked.
 */
export function assertDimensionsFit(transactionType: string, values: Partial<Record<MappingDimension, string | null | undefined>>) {
  const allowed = mappingDimensions(transactionType);
  const refused = (Object.keys(DIMENSION_LABEL) as MappingDimension[]).filter((d) => values[d] && !allowed.includes(d));
  if (!refused.length) return;
  const type = transactionType.toUpperCase();
  throw new BadRequestException(
    allowed.length
      ? `A ${type} mapping is matched on ${allowed.map((d) => DIMENSION_LABEL[d]).join(', ')} only, so ${refused.map((d) => DIMENSION_LABEL[d]).join(' and ')} would never let it be chosen. Leave ${refused.length > 1 ? 'them' : 'it'} blank.`
      : `No posting reads a ${type} mapping, so it cannot be narrowed. Leave ${refused.map((d) => DIMENSION_LABEL[d]).join(' and ')} blank.`,
  );
}
