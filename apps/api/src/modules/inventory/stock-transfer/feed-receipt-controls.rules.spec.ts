import { BadRequestException } from '@nestjs/common';
import { assertFeedReceiptLine, receiptVariance, BAG_COUNT_TOLERANCE } from './transfer-execution.rules';

/**
 * W2T: feed TO receipt controls. Requisition rows 145-147, Silo TO Receipt rows
 * 17, 24 and 27, Checkpoints rows 26 and 27. Over-receipt stays refused upstream
 * (decisions.md, 10 Oct), so only a shortfall reaches these rules.
 */
describe('receiptVariance — shipped minus (previously received + this posting)', () => {
  it('is zero when the receipt closes what shipped', () => {
    expect(receiptVariance(6000, 0, 6000)).toBe(0);
  });
  it('counts what earlier receipts already took', () => {
    expect(receiptVariance(6000, 2000, 3900)).toBe(100);
  });
  it('never carries float noise', () => {
    expect(receiptVariance(1.3, 0.6, 0.7)).toBe(0);
  });
});

describe('assertFeedReceiptLine', () => {
  const bulk = { label: 'Line 1', shipped: 6000, previouslyReceived: 0, feedType: 'BULK', bagSizeKg: 50, deliveryNoteNo: 'DN-1' };

  it('accepts a full BULK receipt with no reason and returns zero variance', () => {
    expect(assertFeedReceiptLine({ ...bulk, quantity: 6000 })).toBe(0);
  });

  it('checkpoint 26: a shortfall (6,000 shipped, 5,900 received) needs a variance reason', () => {
    expect(() => assertFeedReceiptLine({ ...bulk, quantity: 5900 })).toThrow(/variance reason/i);
    expect(() => assertFeedReceiptLine({ ...bulk, quantity: 5900, varianceReason: '   ' })).toThrow(BadRequestException);
    expect(assertFeedReceiptLine({ ...bulk, quantity: 5900, varianceReason: 'Spillage at unloading' })).toBe(100);
  });

  it('Silo row 17: the delivery note no. is mandatory on a feed receipt', () => {
    expect(() => assertFeedReceiptLine({ ...bulk, quantity: 6000, deliveryNoteNo: '' })).toThrow(/delivery note/i);
    expect(() => assertFeedReceiptLine({ ...bulk, quantity: 6000, deliveryNoteNo: null })).toThrow(/delivery note/i);
  });

  it('BULK lines ignore the bag count', () => {
    expect(assertFeedReceiptLine({ ...bulk, quantity: 6000, bagCount: null })).toBe(0);
  });

  describe('checkpoint 27: BAGGED lines need a bag count matching qty within 1 percent', () => {
    const bagged = { ...bulk, feedType: 'BAGGED', shipped: 5000 };
    it('requires the bag count', () => {
      expect(() => assertFeedReceiptLine({ ...bagged, quantity: 5000 })).toThrow(/bag count/i);
      expect(() => assertFeedReceiptLine({ ...bagged, quantity: 5000, bagCount: 0 })).toThrow(/bag count/i);
      expect(() => assertFeedReceiptLine({ ...bagged, quantity: 5000, bagCount: 99.5 })).toThrow(/bag count/i);
    });
    it('100 bags x 50 KG = 5,000 KG passes', () => {
      expect(assertFeedReceiptLine({ ...bagged, quantity: 5000, bagCount: 100 })).toBe(0);
    });
    it('uses the configured bag size, not a fixed 50', () => {
      expect(assertFeedReceiptLine({ ...bagged, quantity: 5000, bagCount: 200, bagSizeKg: 25 })).toBe(0);
    });
    it('within 1 percent passes, beyond it is refused', () => {
      expect(BAG_COUNT_TOLERANCE).toBe(0.01);
      // 99 bags = 4,950 KG against 5,000 KG received: exactly 1 percent.
      expect(assertFeedReceiptLine({ ...bagged, quantity: 5000, bagCount: 99 })).toBe(0);
      // 98 bags = 4,900 KG: 2 percent off.
      expect(() => assertFeedReceiptLine({ ...bagged, quantity: 5000, bagCount: 98 })).toThrow(/4,900|4900/);
    });
  });
});
