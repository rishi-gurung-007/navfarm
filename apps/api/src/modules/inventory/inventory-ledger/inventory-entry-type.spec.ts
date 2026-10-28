import { BadRequestException } from '@nestjs/common';
import {
  assertInventoryEntryType,
  assertInventoryMovement,
  ENTRY_TYPES_BY_TRANSACTION_TYPE,
  INVENTORY_ENTRY_TYPES,
  INVENTORY_TRANSACTION_TYPES,
} from './inventory-ledger.types';

describe('assertInventoryEntryType', () => {
  it.each(INVENTORY_ENTRY_TYPES)('accepts %s', (entryType) => {
    expect(() => assertInventoryEntryType(entryType)).not.toThrow();
  });

  it.each(['ADJUSTMENT', 'REVERSAL', 'positive', ''])('rejects %p', (entryType) => {
    expect(() => assertInventoryEntryType(entryType)).toThrow(BadRequestException);
  });
});

describe('assertInventoryMovement', () => {
  it('has a rule for every transaction type, and only entry types the ledger holds', () => {
    expect(Object.keys(ENTRY_TYPES_BY_TRANSACTION_TYPE).sort()).toEqual([...INVENTORY_TRANSACTION_TYPES].sort());
    for (const entryTypes of Object.values(ENTRY_TYPES_BY_TRANSACTION_TYPE)) {
      for (const entryType of entryTypes) expect(INVENTORY_ENTRY_TYPES).toContain(entryType);
    }
  });

  it.each([
    ['PURCHASE', 'POSITIVE'], ['OUTPUT', 'POSITIVE'], ['VARIANCE_POSITIVE', 'POSITIVE'],
    ['CONSUMPTION', 'NEGATIVE'], ['SALES', 'NEGATIVE'], ['VARIANCE_NEGATIVE', 'NEGATIVE'],
    ['TRANSFER_SHIPMENT', 'TRANSFER'], ['TRANSFER_SHIPMENT', 'NEGATIVE'],
    ['TRANSFER_RECEIPT', 'TRANSFER'], ['TRANSFER_RECEIPT', 'POSITIVE'],
    ['OVERHEAD', 'OVERHEAD'], ['DESCRIPTIVE', 'DESCRIPTIVE'],
  ])('accepts %s written as %s', (transactionType, entryType) => {
    expect(() => assertInventoryMovement(transactionType, entryType)).not.toThrow();
  });

  it.each(['BIO_CONSUMPTION_PREMATURE', 'BIO_CONSUMPTION_MATURE', 'BIO_OUTPUT', 'BIO_HARVEST', 'REVERSAL', 'consumption', ''])(
    'rejects the transaction type %p',
    (transactionType) => {
      expect(() => assertInventoryMovement(transactionType, 'NEGATIVE')).toThrow(/not an Inventory Ledger transaction type/);
    },
  );

  it.each([
    ['CONSUMPTION', 'POSITIVE'], ['PURCHASE', 'NEGATIVE'], ['VARIANCE_NEGATIVE', 'ADJUSTMENT'], ['OUTPUT', 'TRANSFER'],
  ])('rejects %s written as %s', (transactionType, entryType) => {
    expect(() => assertInventoryMovement(transactionType, entryType)).toThrow(BadRequestException);
  });
});
