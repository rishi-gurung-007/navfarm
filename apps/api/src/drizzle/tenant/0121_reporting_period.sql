-- Reporting Period Master (spec D20; workbook Master Setup row 10: "Period
-- Code, Start Date, End Date (month-end Saturday), Stock Take Date,
-- Production Start Date (Sunday after month-end)"; checkpoint 40: July-June
-- business year, defined in NAVFarm or imported from D365BC). Built now for
-- the Feed Forecast's Reporting Period view; Plan D's stock take and period
-- close will read the same rows. business_year and production_start_date are
-- derived on save (production start = end + 1) and stored so the stock-take
-- screens can filter on them. Nothing is seeded — the client's calendar is
-- not given (open question Q9); an admin generates a year and edits it.
CREATE TABLE `reporting_period` (
  `period_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `period_code` varchar(20) NOT NULL,
  `business_year` varchar(7) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `stock_take_date` date NOT NULL,
  `production_start_date` date NOT NULL,
  `is_active` boolean NOT NULL DEFAULT true,
  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `reporting_period_period_id` PRIMARY KEY(`period_id`),
  CONSTRAINT `uq_reporting_period_code` UNIQUE(`tenant_id`,`company_id`,`period_code`)
);
--> statement-breakpoint
ALTER TABLE `reporting_period` ADD CONSTRAINT `reporting_period_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_reporting_period_dates` ON `reporting_period` (`tenant_id`,`company_id`,`start_date`);
