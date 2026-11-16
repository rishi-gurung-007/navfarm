import { transferValueOf } from './batch-transfer-value.rules';

const animal = (over: Partial<Parameters<typeof transferValueOf>[0]> = {}) => ({
  ledger_book_value: null,
  book_value: null,
  total_opening_asset_value: null,
  acquisition_cost: null,
  ...over,
});

describe('transferValueOf', () => {
  it('moves a fully amortised animal at 0, not at its purchase price (BTR-0001, 10 Nov 2026)', () => {
    // PIG-2024-0015: bought at 1,200, amortised to 0 on the ledger.
    expect(
      transferValueOf(animal({ ledger_book_value: 0, book_value: '0.0000', total_opening_asset_value: '1200.0000', acquisition_cost: '1200.0000' }), 113.4),
    ).toBe(0);
  });

  it('moves an animal at its ledger book value, which outranks the register cache', () => {
    expect(transferValueOf(animal({ ledger_book_value: 352.5, book_value: '360.0000', acquisition_cost: '700.0000' }), 0)).toBe(352.5);
  });

  it('reads the register book value, 0 included, when the ledger has no rows for the animal', () => {
    expect(transferValueOf(animal({ book_value: '0.0000', acquisition_cost: '700.0000' }), 50)).toBe(0);
    expect(transferValueOf(animal({ book_value: '410.2500', acquisition_cost: '700.0000' }), 50)).toBe(410.25);
  });

  it('falls back to opening value, then acquisition cost, then the batch per head only when nothing is recorded', () => {
    expect(transferValueOf(animal({ total_opening_asset_value: '800.0000', acquisition_cost: '700.0000' }), 50)).toBe(800);
    expect(transferValueOf(animal({ acquisition_cost: '700.0000' }), 50)).toBe(700);
    expect(transferValueOf(animal({ acquisition_cost: '0.0000' }), 50)).toBe(50);
    expect(transferValueOf(animal(), 0)).toBe(0);
  });
});
