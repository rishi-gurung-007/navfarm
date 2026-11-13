-- Accounting Period Master (Business Central's Accounting Periods): a period runs
-- from its Starting Date to the day before the next one's, and a row marked New
-- Fiscal Year starts a fiscal year. It sits alongside reporting_period, which
-- the feed screens keep reading; the Monthly Ops report (R12) reads this one.
CREATE TABLE `accounting_period` (
  `accounting_period_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `starting_date` date NOT NULL,
  `name` varchar(30) NOT NULL,
  `new_fiscal_year` boolean NOT NULL DEFAULT false,
  `closed` boolean NOT NULL DEFAULT false,
  `date_locked` boolean NOT NULL DEFAULT false,
  `inventory_period_closed` boolean NOT NULL DEFAULT false,
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `accounting_period_accounting_period_id` PRIMARY KEY(`accounting_period_id`),
  CONSTRAINT `uq_accounting_period_start` UNIQUE(`tenant_id`,`company_id`,`starting_date`)
);
--> statement-breakpoint
ALTER TABLE `accounting_period` ADD CONSTRAINT `accounting_period_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
