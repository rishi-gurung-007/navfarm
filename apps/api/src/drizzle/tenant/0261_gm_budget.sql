-- GM Dashboard Budget master (design 2026-11-16): one budget line per period, farm and metric.
-- Additive: one new table, nothing existing is touched. No unique index on purpose — the one-live-line-per-key
-- rule is enforced in the service so a soft-deleted line can be recreated.
CREATE TABLE `gm_budget` (
  `budget_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `period_id` varchar(36) NOT NULL,
  `farm_id` varchar(36) NOT NULL,
  `metric_code` varchar(40) NOT NULL,
  `amount_type` varchar(10) NOT NULL,
  `amount` decimal(18,4) NOT NULL,
  `tolerance_pct` decimal(6,2),
  `notes` varchar(500),
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `gm_budget_budget_id` PRIMARY KEY(`budget_id`)
);
--> statement-breakpoint
ALTER TABLE `gm_budget` ADD CONSTRAINT `gm_budget_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_gm_budget_lookup` ON `gm_budget` (`tenant_id`,`company_id`,`period_id`,`farm_id`);
