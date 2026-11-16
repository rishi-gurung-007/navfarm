import { BadRequestException } from '@nestjs/common';

/**
 * The Inventory Ledger's vocabulary, in one place.
 *
 *   entry type        what kind of row it is — and so whether it counts as stock
 *   transaction type  the business reason for the movement
 *   document type     the document the row came from (GOODS_RECEIPT, BATCH, STOCK_TRANSFER, STOCK_ADJUSTMENT, BREEDING ...)
 *
 * Which G/L accounts a row posts to is NOT decided by the transaction type alone: `gl_mapping_type` (below) names the G/L
 * Mapping rule when it differs, so a bio-asset batch's feed is a CONSUMPTION in the ledger and still posts to the asset
 * account while the batch is premature and to expense once it is mature.
 */
export const INVENTORY_ENTRY_TYPES = ['POSITIVE', 'NEGATIVE', 'TRANSFER', 'OVERHEAD', 'DESCRIPTIVE'] as const;
export type InventoryEntryType = (typeof INVENTORY_ENTRY_TYPES)[number];

export const INVENTORY_TRANSACTION_TYPES = [
  'PURCHASE', 'CONSUMPTION', 'OUTPUT', 'TRANSFER_SHIPMENT', 'TRANSFER_RECEIPT', 'SALES',
  'VARIANCE_POSITIVE', 'VARIANCE_NEGATIVE',
  // The day's overhead and observations: no stock moves, so the type is the entry type.
  'OVERHEAD', 'DESCRIPTIVE',
] as const;
export type InventoryTransactionType = (typeof INVENTORY_TRANSACTION_TYPES)[number];

/** Ledger rows that record a day's observation or overhead and move no stock (audit H4). */
export const INFORMATIONAL_ENTRY_TYPES: string[] =['DESCRIPTIVE', 'OVERHEAD'];

/**
 * Which entry types each transaction type may be written with. A transfer's two legs are written as TRANSFER by the Stock
 * Transfer screens and as NEGATIVE / POSITIVE by the shared shipment and receipt helpers; both count as stock everywhere.
 */
export const ENTRY_TYPES_BY_TRANSACTION_TYPE: Record<InventoryTransactionType, readonly InventoryEntryType[]> = {
  PURCHASE: ['POSITIVE'],
  OUTPUT: ['POSITIVE'],
  VARIANCE_POSITIVE: ['POSITIVE'],
  CONSUMPTION: ['NEGATIVE'],
  SALES: ['NEGATIVE'],
  VARIANCE_NEGATIVE: ['NEGATIVE'],
  TRANSFER_SHIPMENT: ['TRANSFER', 'NEGATIVE'],
  TRANSFER_RECEIPT: ['TRANSFER', 'POSITIVE'],
  OVERHEAD: ['OVERHEAD'],
  DESCRIPTIVE: ['DESCRIPTIVE'],
};

/** The G/L Mapping transaction types a bio-asset batch's ledger rows post under (set on `gl_mapping_type`). */
export const BIO_GL_MAPPING_TYPES = [
  'BIO_CONSUMPTION_PREMATURE', 'BIO_CONSUMPTION_MATURE', 'BIO_OUTPUT', 'BIO_HARVEST',
] as const;

export function assertInventoryEntryType(entryType: string) {
  if (!(INVENTORY_ENTRY_TYPES as readonly string[]).includes(entryType)) {
    throw new BadRequestException(`'${entryType}' is not an Inventory Ledger entry type (${INVENTORY_ENTRY_TYPES.join(', ')}).`);
  }
}

/** Refuses a transaction type the ledger does not hold, or one written with an entry type it does not go with. */
export function assertInventoryMovement(transactionType: string, entryType: string) {
  assertInventoryEntryType(entryType);
  const allowed = ENTRY_TYPES_BY_TRANSACTION_TYPE[transactionType as InventoryTransactionType];
  if (!allowed) {
    throw new BadRequestException(`'${transactionType}' is not an Inventory Ledger transaction type (${INVENTORY_TRANSACTION_TYPES.join(', ')}).`);
  }
  if (!allowed.includes(entryType as InventoryEntryType)) {
    throw new BadRequestException(`A ${transactionType} entry is written as ${allowed.join(' or ')}, not ${entryType}.`);
  }
}
