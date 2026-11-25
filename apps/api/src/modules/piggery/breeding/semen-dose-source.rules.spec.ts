import { doseSource, type DoseSourceInput } from './semen-dose-source.rules';

const MUL = 'farm-mul';
const POR = 'farm-por';
const base: DoseSourceInput = {
  lotNo: 'LOT-1', quantity: 1, sowFarmId: POR, sowFarmLabel: 'POR100', collectionStoreId: 'store-mul',
  stock: [], farmReceipts: [],
};

describe('doseSource', () => {
  it("issues from the collection store when the sow is on the collection farm", () => {
    expect(doseSource({ ...base, sowFarmId: MUL, stock: [{ warehouse_id: 'store-mul', farm_id: MUL, qty: 4 }] })).toEqual({ warehouseId: 'store-mul' });
  });

  it("issues from the store on the sow's farm that received the lot", () => {
    const stock = [{ warehouse_id: 'store-mul', farm_id: MUL, qty: 6 }, { warehouse_id: 'store-por', farm_id: POR, qty: 4 }];
    expect(doseSource({ ...base, stock })).toEqual({ warehouseId: 'store-por' });
  });

  it("never issues from another farm's store, however much it holds", () => {
    const r = doseSource({ ...base, stock: [{ warehouse_id: 'store-mul', farm_id: MUL, qty: 40 }] });
    expect(r).toEqual({ error: expect.stringMatching(/no doses at POR100.*stock transfer/) });
  });

  it("refuses while the farm's receipt QC is open, naming it", () => {
    const r = doseSource({ ...base, farmReceipts: [{ inspection_no: 'QC-6', status: 'OPEN', posted: false, farm_id: POR }] });
    expect(r).toEqual({ error: expect.stringMatching(/waiting for its QC inspection at POR100 \(QC-6\)/) });
  });

  it("refuses a lot the farm's QC rejected", () => {
    const r = doseSource({ ...base, farmReceipts: [{ inspection_no: 'QC-6', status: 'CLOSED', posted: false, farm_id: POR }] });
    expect(r).toEqual({ error: expect.stringMatching(/did not pass its QC at POR100 \(QC-6\)/) });
  });

  it('uses stock an accepted receipt brought in while a later receipt is still being inspected', () => {
    const r = doseSource({
      ...base,
      stock: [{ warehouse_id: 'store-por', farm_id: POR, qty: 3 }],
      farmReceipts: [{ inspection_no: 'QC-6', status: 'CLOSED', posted: true, farm_id: POR }, { inspection_no: 'QC-9', status: 'OPEN', posted: false, farm_id: POR }],
    });
    expect(r).toEqual({ warehouseId: 'store-por' });
  });

  it('says how many doses the farm has when it has too few', () => {
    const r = doseSource({ ...base, quantity: 3, stock: [{ warehouse_id: 'store-por', farm_id: POR, qty: 2 }] });
    expect(r).toEqual({ error: expect.stringMatching(/has 2 doses at POR100; 3 cannot be used/) });
  });

  it('keeps the collection store for a sow with no farm', () => {
    expect(doseSource({ ...base, sowFarmId: null })).toEqual({ warehouseId: 'store-mul' });
  });

  it("ignores another farm's QC", () => {
    const r = doseSource({ ...base, sowFarmId: MUL, stock: [{ warehouse_id: 'store-mul', farm_id: MUL, qty: 2 }], farmReceipts: [{ inspection_no: 'QC-6', status: 'OPEN', posted: false, farm_id: POR }] });
    expect(r).toEqual({ warehouseId: 'store-mul' });
  });
});
