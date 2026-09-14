/** Consumption quantities are positive for issues and negative for reversals.
 * Use that direction because legacy seed rows store positive issue amounts,
 * whereas inventory-backed issues store negative amounts. Overheads retain
 * their existing absolute-cost treatment.
 */
export function batchTransactionCost(transaction: {
  transaction_type: string;
  quantity: string | number | null;
  amount: string | number | null;
}): number {
  const amount = Math.abs(Number(transaction.amount || 0));
  return transaction.transaction_type === 'CONSUMPTION' && Number(transaction.quantity) < 0
    ? -amount
    : amount;
}
