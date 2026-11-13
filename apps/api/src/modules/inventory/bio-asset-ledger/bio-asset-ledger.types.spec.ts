import { MySqlDialect } from 'drizzle-orm/mysql-core';
import * as schema from '../../../core/database/schema';
import {
  assertBioMovement,
  bioCodes,
  bioCodesOfEvent,
  bioEventCondition,
  bioEventOf,
  bioEventSql,
  reverseBioCodes,
  type BioEvent,
} from './bio-asset-ledger.types';

const EVENTS: BioEvent[] = [
  'PURCHASE', 'ACQUISITION', 'CONSUMPTION', 'OVERHEAD_COST', 'COST_ALLOCATION', 'TRANSFER_OUT', 'TRANSFER_IN',
  'AMORTIZATION', 'FAIR_VALUE_ADJMT', 'MORTALITY', 'TRANSFORMATION',
];

/** Every way a writer can label a row: the whole catalogue, with each variant the options allow. */
const EVERY_CODING = [
  ['purchase', bioCodes.purchase()],
  ['batch receipt, bought', bioCodes.batchReceipt({ born: false })],
  ['batch receipt, born on the farm', bioCodes.batchReceipt({ born: true })],
  ['registration', bioCodes.registration()],
  ['feed', bioCodes.feed()],
  ['overhead', bioCodes.overhead()],
  ['semen used at a mating', bioCodes.semen()],
  ['birth cost, from the sow', bioCodes.costAllocation({ gives: true, lactation: false })],
  ['birth cost, to the litter', bioCodes.costAllocation({ gives: false, lactation: false })],
  ['lactation cost, from the sow', bioCodes.costAllocation({ gives: true, lactation: true })],
  ['lactation cost, to the litter', bioCodes.costAllocation({ gives: false, lactation: true })],
  ['batch transfer out', bioCodes.batchTransfer({ out: true })],
  ['batch transfer in', bioCodes.batchTransfer({ out: false })],
  ['amortisation, run', bioCodes.amortisation({ source: 'RUN' })],
  ['amortisation, batch', bioCodes.amortisation({ source: 'BATCH' })],
  ['fair value gain, run', bioCodes.fairValue({ source: 'RUN', gain: true })],
  ['fair value loss, run', bioCodes.fairValue({ source: 'RUN', gain: false })],
  ['fair value gain, batch', bioCodes.fairValue({ source: 'BATCH', gain: true })],
  ['fair value loss, batch', bioCodes.fairValue({ source: 'BATCH', gain: false })],
  ['mortality', bioCodes.mortality()],
  ['gilt selection', bioCodes.giltSelection()],
  ['maturity', bioCodes.maturity()],
  ['harvest', bioCodes.harvest()],
  ['sale, batch', bioCodes.disposal({ sold: true, scope: 'BATCH' })],
  ['sale, animal', bioCodes.disposal({ sold: true, scope: 'ANIMAL' })],
  ['other exit, batch', bioCodes.disposal({ sold: false, scope: 'BATCH' })],
  ['other exit, animal', bioCodes.disposal({ sold: false, scope: 'ANIMAL' })],
] as const;

const render = (condition: ReturnType<typeof bioEventCondition>) => new MySqlDialect().sqlToQuery(condition);

describe('the Bio Asset Ledger codes', () => {
  it.each(EVERY_CODING)('%s is a pair of codes the shared map allows', (_name, codes) => {
    expect(() => assertBioMovement(codes.transaction_type, codes.entry_type)).not.toThrow();
  });

  it.each([
    ['AMORTIZATION written as POSITIVE', 'AMORTIZATION', 'POSITIVE'],
    ['a consumption written as POSITIVE', 'CONSUMPTION', 'POSITIVE'],
    ['an old entry type', 'POSITIVE', 'ACQUISITION'],
    ['the removed REVERSAL type', 'REVERSAL', 'NEGATIVE'],
  ])('refuses %s', (_name, transactionType, entryType) => {
    expect(() => assertBioMovement(transactionType, entryType)).toThrow(/Bio Asset Ledger/);
  });

  it('reads the event back from the codes of every event, and a manual entry as none', () => {
    for (const event of EVENTS) expect(bioEventOf(bioCodesOfEvent(event))).toBe(event);
    expect(bioEventOf({ entry_type: 'POSITIVE', transaction_type: 'VARIANCE_POSITIVE', document_type: 'MANUAL_ENTRY' })).toBeNull();
    expect(bioEventOf({ entry_type: 'POSITIVE', transaction_type: 'PURCHASE', document_type: null })).toBeNull();
  });

  it('tells an amortisation, a fair-value loss and a death apart although all three are NEGATIVE + VARIANCE_NEGATIVE', () => {
    const rows = [bioCodes.amortisation({ source: 'RUN' }), bioCodes.fairValue({ source: 'RUN', gain: false }), bioCodes.mortality()];
    expect(new Set(rows.map((r) => `${r.entry_type}/${r.transaction_type}`)).size).toBe(1);
    expect(rows.map(bioEventOf)).toEqual(['AMORTIZATION', 'FAIR_VALUE_ADJMT', 'MORTALITY']);
  });

  it('keeps the event across both directions of a coding the writer can vary', () => {
    expect([bioCodes.fairValue({ source: 'BATCH', gain: true }), bioCodes.fairValue({ source: 'BATCH', gain: false })].map(bioEventOf)).toEqual(['FAIR_VALUE_ADJMT', 'FAIR_VALUE_ADJMT']);
    expect([bioCodes.costAllocation({ gives: true, lactation: true }), bioCodes.costAllocation({ gives: false, lactation: false })].map(bioEventOf)).toEqual(['COST_ALLOCATION', 'COST_ALLOCATION']);
    expect([bioCodes.batchReceipt({ born: true }), bioCodes.batchReceipt({ born: false }), bioCodes.registration()].map(bioEventOf)).toEqual(['ACQUISITION', 'ACQUISITION', 'ACQUISITION']);
    expect([bioCodes.maturity(), bioCodes.harvest(), bioCodes.giltSelection(), bioCodes.disposal({ sold: true, scope: 'ANIMAL' })].map(bioEventOf)).toEqual(Array(4).fill('TRANSFORMATION'));
  });

  describe('a reversal', () => {
    it('flips the direction and keeps the document, so it is still the same event', () => {
      const original = bioCodes.amortisation({ source: 'RUN' });
      const reversal = reverseBioCodes(original);
      expect(reversal).toEqual({ entry_type: 'POSITIVE', transaction_type: 'VARIANCE_POSITIVE', document_type: 'BIO_COSTING_RUN' });
      expect(bioEventOf(reversal)).toBe('AMORTIZATION');
      expect(reverseBioCodes(reversal)).toEqual(original);
    });

    it('leaves OVERHEAD, TRANSFER and DESCRIPTIVE entry types alone, and swaps the transfer legs', () => {
      expect(reverseBioCodes(bioCodes.feed())).toEqual(bioCodes.feed());
      expect(reverseBioCodes(bioCodes.batchTransfer({ out: true }))).toEqual(bioCodes.batchTransfer({ out: false }));
      expect(reverseBioCodes(bioCodes.maturity())).toEqual(bioCodes.maturity());
    });

    it('is still the event it reverses, for every event but a transfer, whose reversal is the opposite leg', () => {
      for (const [, codes] of EVERY_CODING) {
        if (codes.document_type === 'BATCH_TRANSFER') continue;
        expect(bioEventOf(reverseBioCodes(codes))).toBe(bioEventOf(codes));
      }
      expect(bioEventOf(reverseBioCodes(bioCodes.batchTransfer({ out: true })))).toBe('TRANSFER_IN');
    });
  });

  describe('the query condition and the raw SQL say the same thing as bioEventOf', () => {
    it('reads the documents each event is recorded under', () => {
      const amortisation = render(bioEventCondition(schema.bioAssetLedger, 'AMORTIZATION'));
      expect(amortisation.sql).toMatch(/document_type/);
      expect(amortisation.params).toEqual(['BIO_COSTING_RUN', 'BATCH_AMORTIZATION']);
    });

    it('splits the events that share BATCH by entry type', () => {
      expect(render(bioEventCondition(schema.bioAssetLedger, 'CONSUMPTION')).params).toEqual(['BATCH', 'OVERHEAD']);
      expect(render(bioEventCondition(schema.bioAssetLedger, 'ACQUISITION')).params).toEqual(['ANIMAL_REGISTRATION', 'BATCH', 'POSITIVE']);
    });

    it('splits a transfer into its two directions by transaction type', () => {
      expect(render(bioEventCondition(schema.bioAssetLedger, 'TRANSFER_OUT')).params).toEqual(['BATCH_TRANSFER', 'TRANSFER_SHIPMENT']);
      expect(render(bioEventCondition(schema.bioAssetLedger, 'TRANSFER_IN')).params).toEqual(['BATCH_TRANSFER', 'TRANSFER_RECEIPT']);
    });

    it('writes the same conditions as raw SQL for the scripts', () => {
      expect(bioEventSql('AMORTIZATION', 'l')).toBe("l.document_type IN ('BIO_COSTING_RUN', 'BATCH_AMORTIZATION')");
      expect(bioEventSql('CONSUMPTION', 'x')).toBe("(x.document_type = 'BATCH' AND x.entry_type = 'OVERHEAD')");
      expect(bioEventSql(['MORTALITY', 'TRANSFER_IN'], 'q')).toBe("(q.document_type IN ('MORTALITY') OR (q.document_type = 'BATCH_TRANSFER' AND q.transaction_type = 'TRANSFER_RECEIPT'))");
    });
  });
});
