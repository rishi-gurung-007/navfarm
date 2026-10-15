-- 15 Oct 2026 (Arun): Expense Voucher, Expense and Petty Cash documents. One table, told apart by doc_type. An
-- EXPENSE_VOUCHER is recorded and listed only (no GL accounts, journal_id stays NULL). An EXPENSE or PETTY_CASH keeps
-- the journal it posted. Additive: a new table, nothing existing is touched.
CREATE TABLE `expense_document` (
  `expense_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `doc_type` varchar(20) NOT NULL,
  `document_no` varchar(30) NOT NULL,
  `posting_date` date NOT NULL,
  `payee` varchar(200),
  `description` text,
  `amount` decimal(18,4) NOT NULL,
  `expense_gl_account_id` varchar(36),
  `payment_gl_account_id` varchar(36),
  `cost_center_id` varchar(36),
  `journal_id` varchar(36),
  `status` varchar(20) NOT NULL DEFAULT 'RECORDED',
  `created_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp,
  CONSTRAINT `expense_document_expense_id` PRIMARY KEY(`expense_id`),
  CONSTRAINT `uq_expense_document_company_no` UNIQUE(`company_id`,`document_no`)
);
--> statement-breakpoint
ALTER TABLE `expense_document` ADD CONSTRAINT `fk_expense_doc_company` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `expense_document` ADD CONSTRAINT `fk_expense_doc_expense_acct` FOREIGN KEY (`expense_gl_account_id`) REFERENCES `gl_account_master`(`gl_account_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `expense_document` ADD CONSTRAINT `fk_expense_doc_payment_acct` FOREIGN KEY (`payment_gl_account_id`) REFERENCES `gl_account_master`(`gl_account_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `expense_document` ADD CONSTRAINT `fk_expense_doc_cost_center` FOREIGN KEY (`cost_center_id`) REFERENCES `cost_center_master`(`cost_center_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `expense_document` ADD CONSTRAINT `fk_expense_doc_journal` FOREIGN KEY (`journal_id`) REFERENCES `journal_header`(`journal_id`) ON DELETE restrict ON UPDATE no action;
