import {
  bagsWithinTolerance,
  feedReceiptExtras,
  feedReceiptRows,
  type FeedReceiptControls,
  type FeedReceiptInput,
} from './feed-receipt-checks';

// The feed receipt checks carried into the embedded Transfer Order dialog (Rishi, 16 Nov: keep them): a short receipt
// needs a variance reason (Requisition rows 139-150, checkpoint 26), a BAGGED line a bag count within 1 percent of the
// KG received (checkpoint 27), the delivery note is optional.
const controls: FeedReceiptControls = {
  bagSizeKg: 50,
  baggedRequisitionLineIds: ['rl-bag'],
};
const line = (over: Record<string, unknown> = {}) => ({
  line_id: 'tl-1',
  requisition_line_id: 'rl-bulk',
  qty_in_transit: 1000,
  qty_to_receive: 1000,
  doa_quantity: 0,
  ...over,
});
const none: Record<string, FeedReceiptInput> = {};
const input = (over: Partial<FeedReceiptInput> = {}): FeedReceiptInput => ({
  bags: '',
  reason: '',
  note: '',
  ...over,
});

describe('bagsWithinTolerance', () => {
  it('accepts whole bags whose weight is within 1 percent of the KG received', () => {
    expect(bagsWithinTolerance(20, 1000, 50)).toBe(true); // exactly 1000
    expect(bagsWithinTolerance(20, 1009, 50)).toBe(true); // 0.9 % off
    expect(bagsWithinTolerance(20, 1011, 50)).toBe(false); // 1.1 % off
  });
  it('refuses no count, zero, and a count that is not a whole number', () => {
    expect(bagsWithinTolerance(null, 1000, 50)).toBe(false);
    expect(bagsWithinTolerance(0, 1000, 50)).toBe(false);
    expect(bagsWithinTolerance(20.5, 1025, 50)).toBe(false);
  });
});

describe('feedReceiptRows', () => {
  it('a full receipt is not short and needs no reason', () => {
    const [row] = feedReceiptRows([line()], none, controls);
    expect(row).toMatchObject({
      short: false,
      reasonOk: true,
      bagged: false,
      bagsOk: true,
    });
  });

  it('a part receipt with more still to come is short and needs a variance reason (checkpoint 26)', () => {
    const lines = [line({ qty_to_receive: 600 })];
    const [empty] = feedReceiptRows(lines, none, controls);
    expect(empty).toMatchObject({ short: true, reasonOk: false });
    const [blank] = feedReceiptRows(
      lines,
      { 'tl-1': input({ reason: '   ' }) },
      controls,
    );
    expect(blank.reasonOk).toBe(false);
    const [given] = feedReceiptRows(
      lines,
      { 'tl-1': input({ reason: 'Truck stopped early' }) },
      controls,
    );
    expect(given).toMatchObject({ short: true, reasonOk: true });
  });

  it('what is written off as DOA is accounted for, so it is not short', () => {
    const [row] = feedReceiptRows(
      [line({ qty_to_receive: 900, doa_quantity: 100 })],
      none,
      controls,
    );
    expect(row.short).toBe(false);
    expect(row.reasonOk).toBe(true);
  });

  it('a BAGGED line needs a bag count within 1 percent of the KG received (checkpoint 27); a bulk one does not', () => {
    const bag = line({ requisition_line_id: 'rl-bag' });
    expect(feedReceiptRows([bag], none, controls)[0]).toMatchObject({
      bagged: true,
      bagsOk: false,
    });
    expect(
      feedReceiptRows([bag], { 'tl-1': input({ bags: '20' }) }, controls)[0]
        .bagsOk,
    ).toBe(true);
    expect(
      feedReceiptRows([bag], { 'tl-1': input({ bags: '25' }) }, controls)[0]
        .bagsOk,
    ).toBe(false);
    expect(feedReceiptRows([line()], none, controls)[0].bagsOk).toBe(true);
  });

  it('follows the KG actually received, not the KG shipped', () => {
    const bag = line({ requisition_line_id: 'rl-bag', qty_to_receive: 500 });
    expect(
      feedReceiptRows(
        [bag],
        { 'tl-1': input({ bags: '10', reason: 'short load' }) },
        controls,
      )[0],
    ).toMatchObject({ bagsOk: true, reasonOk: true });
  });

  it('skips lines with nothing in transit, and lines with no id', () => {
    expect(
      feedReceiptRows(
        [line({ qty_in_transit: 0 }), line({ line_id: undefined })],
        none,
        controls,
      ),
    ).toEqual([]);
  });

  it('with the quantity left blank, the whole in-transit quantity is what would be received', () => {
    const [row] = feedReceiptRows(
      [line({ qty_to_receive: undefined })],
      none,
      controls,
    );
    expect(row).toMatchObject({ good: 1000, short: false });
  });
});

describe('feedReceiptExtras', () => {
  it('sends the reason of a short receipt, the bag count of a bagged line and the delivery note', () => {
    const [row] = feedReceiptRows(
      [line({ requisition_line_id: 'rl-bag', qty_to_receive: 600 })],
      {
        'tl-1': input({
          bags: '12',
          reason: ' Truck stopped early ',
          note: ' DN-77 ',
        }),
      },
      controls,
    );
    expect(feedReceiptExtras(row, undefined, 0)).toEqual({
      variance_reason: 'Truck stopped early',
      bag_count: 12,
      delivery_note_no: 'DN-77',
    });
  });

  it('sends nothing extra for a full bulk receipt', () => {
    const [row] = feedReceiptRows([line()], none, controls);
    expect(feedReceiptExtras(row, undefined, 0)).toEqual({});
  });

  it('a DOA loss alone still carries its remarks as the variance reason, as before', () => {
    const [row] = feedReceiptRows(
      [line({ qty_to_receive: 900, doa_quantity: 100 })],
      none,
      controls,
    );
    expect(feedReceiptExtras(row, 'Spilled in transit', 100)).toEqual({
      variance_reason: 'Spilled in transit',
    });
    expect(feedReceiptExtras(row, undefined, 100)).toEqual({
      variance_reason: 'DOA quantity recorded on receipt.',
    });
  });
});
