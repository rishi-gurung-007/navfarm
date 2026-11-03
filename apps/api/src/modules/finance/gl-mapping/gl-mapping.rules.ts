import { BadRequestException } from '@nestjs/common';
import {
  ENTRY_TYPES_BY_TRANSACTION_TYPE,
  INVENTORY_TRANSACTION_TYPES,
  type InventoryTransactionType,
} from '../../inventory/inventory-ledger/inventory-ledger.types';

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

/** An entry type must be one the transaction type is written with. A type outside the inventory vocabulary has no such list, so nothing is checked for it. */
export function assertEntryTypeFits(transactionType: string, entryType: string | null | undefined) {
  if (!entryType) return;
  const type = transactionType.toUpperCase();
  if (!isInventoryTransactionType(type)) return;
  const allowed = ENTRY_TYPES_BY_TRANSACTION_TYPE[type];
  if (!allowed.includes(entryType as never)) {
    throw new BadRequestException(`A ${type} entry is written as ${allowed.join(' or ')}, not ${entryType}. Choose one of those, or leave Entry Type blank.`);
  }
}
