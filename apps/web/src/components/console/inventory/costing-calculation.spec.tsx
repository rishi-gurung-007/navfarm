import { render, screen } from '@testing-library/react';
import { CostingCalculation, type CostingExplanation } from './costing-calculation';

const money = (n: number) => `$ ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const draw = (inbound_entry_no: number, quantity: number, amount: number, receipt_rate: number) => ({
  inbound_entry_no, document_no: `GR-${inbound_entry_no}`, posting_date: '2026-10-05', lot_no: null, receipt_rate,
  quantity, amount, unit_cost: amount / quantity, formula_amount: quantity * receipt_rate,
});

describe('CostingCalculation', () => {
  it('FIFO: shows each receipt at its own rate and the sum', () => {
    const costing: CostingExplanation = {
      method: 'FIFO', quantity: 510, total_cost: 10600, unit_cost: 20.7843, standard_cost: null, average: null,
      recomputed_cost: 10600, matches: true, draws: [draw(65, 470, 9400, 20), draw(66, 40, 1200, 30)],
    };
    render(<CostingCalculation costing={costing} uom="KG" formatMoney={money} />);
    expect(screen.getByText(/FIFO — First In, First Out/)).toBeTruthy();
    expect(screen.getByText(/470\.00 × 20\.00\s+\+\s+40\.00 × 30\.00\s+=\s+\$ 10,600\.00/)).toBeTruthy();
    expect(screen.queryByText(/is not what the item/)).toBeNull();
  });

  it('Average: shows the book, the average rate and the cost as quantity × average', () => {
    const costing: CostingExplanation = {
      method: 'AVG', quantity: 900, total_cost: 27000, unit_cost: 30, standard_cost: null, recomputed_cost: 27000, matches: true,
      draws: [draw(63, 500, 15000, 20), draw(67, 400, 12000, 30)],
      average: {
        receipts: [{ entry_no: 62, document_no: 'GR-1', posting_date: '2026-10-05', transaction_type: 'PURCHASE', quantity: 1500, rate: 30, amount: 45000 }],
        receipts_quantity: 1500, receipts_value: 45000, issued_quantity: 0, issued_value: 0, book_quantity: 1500, book_value: 45000, average_rate: 30, fallback: false,
      },
    };
    render(<CostingCalculation costing={costing} uom="KG" formatMoney={money} />);
    expect(screen.getByText(/Average — moving average/)).toBeTruthy();
    expect(screen.getByText(/\$ 45,000\.00 ÷ 1,500\.00 KG\s+=\s+30\.00 per KG/)).toBeTruthy();
    expect(screen.getByText(/900\.00 KG × 30\.00\s+=\s+\$ 27,000\.00/)).toBeTruthy();
  });

  it('warns when the posted cost is not what the current method gives', () => {
    const costing: CostingExplanation = {
      method: 'AVG', quantity: 150, total_cost: 3250, unit_cost: 21.6667, standard_cost: null, recomputed_cost: 3375, matches: false,
      draws: [draw(1, 100, 2000, 20), draw(2, 50, 1250, 25)],
      average: { receipts: [], receipts_quantity: 200, receipts_value: 4500, issued_quantity: 0, issued_value: 0, book_quantity: 200, book_value: 4500, average_rate: 22.5, fallback: false },
    };
    render(<CostingCalculation costing={costing} uom="KG" formatMoney={money} />);
    expect(screen.getByText(/is not what the item's current method gives \(\$ 3,375\.00\)/)).toBeTruthy();
  });
});
