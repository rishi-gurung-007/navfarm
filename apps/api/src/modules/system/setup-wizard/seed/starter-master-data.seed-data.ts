// Starter chart of accounts + GL mappings provisioned automatically for every
// new company on wizard completion (see master-data-seed.service.ts). Pure
// data — no NOB/LOB scoping, since GlPostingService.resolveMapping() never
// filters gl_mapping_master by NOB/LOB, only by item_category_id (left null
// here for full wildcard coverage across every item category).
//
// The transaction_type -> {debit, credit} pairs cover every real transaction
// type the posting engine writes (see batch.service.ts, goods-receipt/-issue/
// stock-transfer/stock-adjustment services, gl-posting.service.ts) — without
// these, a brand-new company's very first batch activation or goods receipt
// fails with "No GL mapping configured..." until someone hand-builds a chart
// of accounts first.

export interface StarterGlAccount {
  account_code: string;
  account_name: string;
  account_type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
}

export const STARTER_GL_ACCOUNTS: StarterGlAccount[] = [
  // Assets
  { account_code: '1010', account_name: 'Raw Material Inventory', account_type: 'ASSET' },
  { account_code: '1020', account_name: 'Work in Progress Inventory', account_type: 'ASSET' },
  { account_code: '1030', account_name: 'Finished Goods Inventory', account_type: 'ASSET' },
  { account_code: '1040', account_name: 'Inventory in Transit', account_type: 'ASSET' },
  { account_code: '1050', account_name: 'Biological Assets — Pre-mature (NCA)', account_type: 'ASSET' },
  { account_code: '1060', account_name: 'Biological Assets — Mature (NCA)', account_type: 'ASSET' },
  // Liabilities
  { account_code: '2010', account_name: 'Trade Payables (Clearing)', account_type: 'LIABILITY' },
  // Income
  { account_code: '4010', account_name: 'Disposal Gain / Loss', account_type: 'INCOME' },
  { account_code: '4020', account_name: 'Fair Value Gain / Loss', account_type: 'INCOME' },
  { account_code: '4030', account_name: 'Inventory Adjustment Gain', account_type: 'INCOME' },
  // Expenses
  { account_code: '5010', account_name: 'Mortality Loss', account_type: 'EXPENSE' },
  { account_code: '5020', account_name: 'Overhead Expense', account_type: 'EXPENSE' },
  { account_code: '5030', account_name: 'Price Variance', account_type: 'EXPENSE' },
  { account_code: '5040', account_name: 'Usage Variance', account_type: 'EXPENSE' },
  { account_code: '5050', account_name: 'Output Variance', account_type: 'EXPENSE' },
  { account_code: '5060', account_name: 'Overhead Variance', account_type: 'EXPENSE' },
  { account_code: '5070', account_name: 'Inventory Adjustment Loss', account_type: 'EXPENSE' },
  { account_code: '5080', account_name: 'Bio-Asset Consumption Expense (Mature)', account_type: 'EXPENSE' },
  { account_code: '5090', account_name: 'Bio-Asset Overhead Expense (Mature)', account_type: 'EXPENSE' },
  { account_code: '5100', account_name: 'Bio-Asset Amortization Expense', account_type: 'EXPENSE' },
];

export interface StarterGlMapping {
  transaction_type: string;
  debit_account_code: string;
  credit_account_code: string;
}

export const STARTER_GL_MAPPINGS: StarterGlMapping[] = [
  // Goods Receipt / Issue
  { transaction_type: 'PURCHASE', debit_account_code: '1010', credit_account_code: '2010' },
  { transaction_type: 'CONSUMPTION', debit_account_code: '5020', credit_account_code: '1010' },
  // Stock Transfer (routed through an in-transit clearing account so both legs net to zero)
  { transaction_type: 'TRANSFER_SHIPMENT', debit_account_code: '1040', credit_account_code: '1010' },
  { transaction_type: 'TRANSFER_RECEIPT', debit_account_code: '1010', credit_account_code: '1040' },
  // Stock Adjustment
  { transaction_type: 'VARIANCE_POSITIVE', debit_account_code: '1010', credit_account_code: '4030' },
  { transaction_type: 'VARIANCE_NEGATIVE', debit_account_code: '5070', credit_account_code: '1010' },
  // Batch — STANDARD/FIFO costing
  { transaction_type: 'BATCH_INPUT', debit_account_code: '1020', credit_account_code: '1010' },
  { transaction_type: 'BATCH_CONSUMPTION', debit_account_code: '1020', credit_account_code: '1010' },
  { transaction_type: 'BATCH_OUTPUT', debit_account_code: '1030', credit_account_code: '1020' },
  { transaction_type: 'MORTALITY', debit_account_code: '5010', credit_account_code: '1020' },
  // Mid-batch by-product/waste removal at NRV — the gap between what it cost
  // to produce and what it's actually worth, relieved from WIP the same way
  // MORTALITY is (see batch.service.ts addTransaction()'s OUTPUT branch).
  { transaction_type: 'BATCH_IMPAIRMENT', debit_account_code: '5070', credit_account_code: '1020' },
  { transaction_type: 'OVERHEAD', debit_account_code: '1020', credit_account_code: '2010' },
  { transaction_type: 'PRICE_VARIANCE', debit_account_code: '5030', credit_account_code: '1020' },
  { transaction_type: 'USAGE_VARIANCE', debit_account_code: '5040', credit_account_code: '1020' },
  { transaction_type: 'OUTPUT_VARIANCE', debit_account_code: '5050', credit_account_code: '1020' },
  { transaction_type: 'OVERHEAD_VARIANCE', debit_account_code: '5060', credit_account_code: '1020' },
  // Batch — Bio-Asset (IAS 41) costing lifecycle
  { transaction_type: 'BIO_ACQUISITION', debit_account_code: '1050', credit_account_code: '2010' },
  { transaction_type: 'BIO_CONSUMPTION_PREMATURE', debit_account_code: '1050', credit_account_code: '1010' },
  { transaction_type: 'BIO_CONSUMPTION_MATURE', debit_account_code: '5080', credit_account_code: '1010' },
  { transaction_type: 'BIO_OUTPUT', debit_account_code: '1030', credit_account_code: '1060' },
  { transaction_type: 'BIO_MORTALITY_PREMATURE', debit_account_code: '5010', credit_account_code: '1050' },
  { transaction_type: 'BIO_MORTALITY_MATURE', debit_account_code: '5010', credit_account_code: '1060' },
  { transaction_type: 'BIO_OVERHEAD_PREMATURE', debit_account_code: '1050', credit_account_code: '2010' },
  { transaction_type: 'BIO_OVERHEAD_MATURE', debit_account_code: '5090', credit_account_code: '2010' },
  { transaction_type: 'BIO_TRANSFORMATION', debit_account_code: '1060', credit_account_code: '1050' },
  { transaction_type: 'BIO_AMORTIZATION', debit_account_code: '5100', credit_account_code: '1060' },
  // Favorable/base direction — GlPostingService.postBatchCostEntry swaps debit/credit
  // for the unfavorable case (loss on fair value, loss on disposal) automatically.
  { transaction_type: 'BIO_FAIR_VALUE', debit_account_code: '1060', credit_account_code: '4020' },
  { transaction_type: 'BIO_HARVEST', debit_account_code: '1030', credit_account_code: '1060' },
  { transaction_type: 'BIO_DISPOSAL_SOLD', debit_account_code: '1060', credit_account_code: '4010' },
];

export const STARTER_WAREHOUSE = {
  warehouse_code: 'WH-MAIN',
  warehouse_name: 'Main Location',
  warehouse_type: 'GENERAL',
};
