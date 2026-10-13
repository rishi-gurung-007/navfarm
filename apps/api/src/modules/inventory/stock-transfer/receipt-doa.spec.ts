import { grossDoaRef, parseReceiptDoa, receiptSplit } from './receipt-doa';

describe('receipt DOA marker', () => {
  it('reads the current `Incl. DOA:n` marker as a gross receipt', () => {
    expect(parseReceiptDoa(grossDoaRef(10))).toEqual({ kind: 'gross', doa: 10 });
    expect(parseReceiptDoa('Incl. DOA:2.5')).toEqual({ kind: 'gross', doa: 2.5 });
  });

  it('still reads the legacy `DOA:n` marker and the DOA_IN_TRANSIT twin', () => {
    expect(parseReceiptDoa('DOA:10')).toEqual({ kind: 'marker', doa: 10 });
    expect(parseReceiptDoa('DOA_IN_TRANSIT')).toEqual({ kind: 'twin' });
  });

  it('treats anything else — remarks, empty, a non-positive or non-numeric count — as no DOA', () => {
    for (const ref of [undefined, null, '', 'Delivered by truck 7', 'DOA:0', 'DOA:abc', 'Incl. DOA:-3']) {
      expect(parseReceiptDoa(ref)).toEqual({ kind: 'none' });
    }
  });

  describe('receiptSplit', () => {
    it('a gross receipt of 100 with 10 DOA is 90 good and 10 DOA — the row quantity includes the DOA', () => {
      expect(receiptSplit(100, grossDoaRef(10))).toEqual({ good: 90, doa: 10 });
    });

    it('a legacy marker row holds only the good quantity; the DOA is on the twin', () => {
      expect(receiptSplit(90, 'DOA:10')).toEqual({ good: 90, doa: 10 });
      expect(receiptSplit(10, 'DOA_IN_TRANSIT')).toEqual({ good: 0, doa: 10 });
    });

    it('a receipt with no marker is all good', () => {
      expect(receiptSplit(50, 'note')).toEqual({ good: 50, doa: 0 });
    });

    it('never reports negative good stock', () => {
      expect(receiptSplit(5, grossDoaRef(8))).toEqual({ good: 0, doa: 8 });
    });
  });
});
