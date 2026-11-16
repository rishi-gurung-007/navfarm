import { BadRequestException } from '@nestjs/common';
import { INVENTORY_TRANSACTION_TYPES } from '../../inventory/inventory-ledger/inventory-ledger.types';
import { assertEntryTypeFits, assertMappableTransactionType, isInventoryTransactionType } from './gl-mapping.rules';

describe('G/L Mapping rules', () => {
  describe('assertMappableTransactionType', () => {
    it.each([...INVENTORY_TRANSACTION_TYPES])('accepts the inventory type %s, in any case', (type) => {
      expect(() => assertMappableTransactionType(type)).not.toThrow();
      expect(() => assertMappableTransactionType(type.toLowerCase())).not.toThrow();
    });

    it('refuses a type outside the Inventory Ledger vocabulary, naming the ones allowed', () => {
      expect(() => assertMappableTransactionType('BIO_ACQUISITION')).toThrow(BadRequestException);
      expect(() => assertMappableTransactionType('NOPE')).toThrow(/PURCHASE, CONSUMPTION, OUTPUT/);
    });

    it('lets an edit that leaves a legacy type alone through, so a BIO_* or MORTALITY mapping can still be edited', () => {
      expect(() => assertMappableTransactionType('BIO_ACQUISITION', 'BIO_ACQUISITION')).not.toThrow();
      expect(() => assertMappableTransactionType('MORTALITY', 'MORTALITY')).not.toThrow();
    });

    it('still refuses an edit that moves a mapping onto a type outside the vocabulary', () => {
      expect(() => assertMappableTransactionType('BIO_ACQUISITION', 'PURCHASE')).toThrow(BadRequestException);
    });
  });

  describe('assertEntryTypeFits', () => {
    it('accepts the entry types each transaction type is written with', () => {
      expect(() => assertEntryTypeFits('PURCHASE', 'POSITIVE')).not.toThrow();
      expect(() => assertEntryTypeFits('CONSUMPTION', 'NEGATIVE')).not.toThrow();
      // a transfer's legs are written both ways, so each is a real pairing
      expect(() => assertEntryTypeFits('TRANSFER_SHIPMENT', 'TRANSFER')).not.toThrow();
      expect(() => assertEntryTypeFits('TRANSFER_SHIPMENT', 'NEGATIVE')).not.toThrow();
      expect(() => assertEntryTypeFits('TRANSFER_RECEIPT', 'POSITIVE')).not.toThrow();
    });

    it('refuses a pairing the ledger never writes, saying what the type is written as', () => {
      expect(() => assertEntryTypeFits('PURCHASE', 'NEGATIVE')).toThrow(/PURCHASE entry is written as POSITIVE, not NEGATIVE/);
      expect(() => assertEntryTypeFits('TRANSFER_SHIPMENT', 'POSITIVE')).toThrow(/TRANSFER or NEGATIVE/);
    });

    it('asks nothing when no entry type is named (any entry type), or of a legacy type that has no list', () => {
      expect(() => assertEntryTypeFits('PURCHASE', null)).not.toThrow();
      expect(() => assertEntryTypeFits('PURCHASE', '')).not.toThrow();
      expect(() => assertEntryTypeFits('BIO_ACQUISITION', 'NEGATIVE')).not.toThrow();
    });
  });

  it('knows an inventory type from any other', () => {
    expect(isInventoryTransactionType('SALES')).toBe(true);
    expect(isInventoryTransactionType('MORTALITY')).toBe(false);
  });
});
