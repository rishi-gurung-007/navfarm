import { batchTransactionCost } from './batch-transaction-cost';

describe('batchTransactionCost', () => {
  it('nets original consumption, its reversal, and the corrected posting to 50', () => {
    const transactions = [
      { transaction_type: 'CONSUMPTION', quantity: '4.6', amount: '-46' },
      { transaction_type: 'CONSUMPTION', quantity: '-4.6', amount: '46' },
      { transaction_type: 'CONSUMPTION', quantity: '5', amount: '-50' },
    ];

    const costs = transactions.map(batchTransactionCost);
    expect(costs).toEqual([46, -46, 50]);
    expect(costs.reduce((sum, cost) => sum + cost, 0)).toBe(50);
  });

  it('preserves positive consumption amounts from legacy seed rows', () => {
    expect(batchTransactionCost({
      transaction_type: 'CONSUMPTION', quantity: '48.0000', amount: '1344.0000',
    })).toBe(1344);
  });

  it('leaves overhead costing unchanged', () => {
    expect(batchTransactionCost({
      transaction_type: 'OVERHEAD', quantity: '1', amount: '25',
    })).toBe(25);
  });
});
