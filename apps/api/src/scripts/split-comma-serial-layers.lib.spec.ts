import { planSerialLayerSplits, type LedgerLayerRow } from './split-comma-serial-layers.lib';

/** The real malformed layer on nf_devco: RC-2026-0028 at GRA100/SHED-001. */
const RC_0028: LedgerLayerRow = {
  ledger_id: 'f3119036', document_no: 'RC-2026-0028', entry_type: 'POSITIVE',
  quantity: '2.0000', remaining_quantity: '2.0000', amount: '360.0000', alternate_quantity: null, serial_no: 'SN00001,SN00002',
};

describe('planSerialLayerSplits — one layer per serial, exact value split', () => {
  it('splits an unconsumed comma layer: the original row keeps the first serial, a new row carries each other one', () => {
    const plan = planSerialLayerSplits([RC_0028], new Set());
    expect(plan.split).toEqual([{
      ledger_id: 'f3119036', document_no: 'RC-2026-0028', serial_no: 'SN00001,SN00002',
      keep: { serial_no: 'SN00001', quantity: 1, remaining_quantity: 1, amount: 180, alternate_quantity: null },
      add: [{ serial_no: 'SN00002', quantity: 1, remaining_quantity: 1, amount: 180, alternate_quantity: null }],
    }]);
    expect(plan.skipped).toEqual([]);
  });

  it('splits the value exactly: the parts sum to the original amount to the cent and below', () => {
    const plan = planSerialLayerSplits([{ ...RC_0028, quantity: '3', remaining_quantity: '3', amount: '100.0000', serial_no: 'A, B ,C' }], new Set());
    const [s] = plan.split;
    const parts = [s.keep.amount, ...s.add.map((a) => a.amount)];
    expect(parts).toEqual([33.3333, 33.3333, 33.3334]);
    expect(Math.round(parts.reduce((x, y) => x + y, 0) * 10000)).toBe(1000000);
    expect([s.keep.serial_no, ...s.add.map((a) => a.serial_no)]).toEqual(['A', 'B', 'C']);
  });

  it('never touches a consumed layer — partly or wholly — or one an application row draws on', () => {
    const plan = planSerialLayerSplits([
      { ...RC_0028, ledger_id: 'part', remaining_quantity: '1.0000' },
      { ...RC_0028, ledger_id: 'gone', remaining_quantity: '0.0000' },
      { ...RC_0028, ledger_id: 'applied' },
    ], new Set(['applied']));
    expect(plan.split).toEqual([]);
    expect(plan.skipped.map((s) => [s.ledger_id, s.reason])).toEqual([
      ['part', 'consumed (remaining 1 of 2)'],
      ['gone', 'consumed (remaining 0 of 2)'],
      ['applied', 'consumed (an inventory_application row draws on it)'],
    ]);
  });

  it('refuses a layer whose serial count is not its quantity, or that repeats a serial', () => {
    const plan = planSerialLayerSplits([
      { ...RC_0028, ledger_id: 'short', serial_no: 'SN1,SN2,SN3' },
      { ...RC_0028, ledger_id: 'dupe', serial_no: 'SN1,SN1' },
    ], new Set());
    expect(plan.split).toEqual([]);
    expect(plan.skipped.map((s) => [s.ledger_id, s.reason])).toEqual([
      ['short', '3 serials for quantity 2'],
      ['dupe', 'a serial is named twice'],
    ]);
  });

  it('leaves NEGATIVE rows alone — they are history, not layers — and counts them', () => {
    const plan = planSerialLayerSplits([{ ...RC_0028, ledger_id: 'sh', entry_type: 'NEGATIVE', quantity: '-2', remaining_quantity: null }], new Set());
    expect(plan.split).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.historyRows).toBe(1);
  });

  it('splits the alternate quantity the same way when it is set', () => {
    const [s] = planSerialLayerSplits([{ ...RC_0028, alternate_quantity: '5.0000' }], new Set()).split;
    expect([s.keep.alternate_quantity, s.add[0].alternate_quantity]).toEqual([2.5, 2.5]);
  });
});
