-- 20 Oct 2026 (bio-asset costing, Phase 4): the costing run. A header per profile and period, a line per animal (book value before,
-- charge, book value after, days, why it was skipped), and the run id on the ledger rows it writes. Additive: two new tables and one
-- nullable column. active_key on the header is set while a run is CALCULATED or POSTED (one run per profile and period); on a line it is
-- set while POSTED (one charge per animal, method and period). Both are NULL once reversed, which frees the period.
CREATE TABLE `bio_costing_run` (
  `run_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `run_no` varchar(40) NOT NULL,
  `profile_id` varchar(36) NOT NULL,
  `method` varchar(20) NOT NULL,
  `frequency` varchar(10) NOT NULL,
  `period_key` varchar(12) NOT NULL,
  `period_start` date NOT NULL,
  `period_end` date NOT NULL,
  `days_enforced` int,
  `description` varchar(300),
  `trigger` varchar(10) NOT NULL DEFAULT 'MANUAL',
  `status` varchar(12) NOT NULL DEFAULT 'CALCULATED',
  `animal_count` int NOT NULL DEFAULT 0,
  `charged_count` int NOT NULL DEFAULT 0,
  `skipped_count` int NOT NULL DEFAULT 0,
  `total_charge` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `journal_id` varchar(36),
  `active_key` varchar(80),
  `requested_by` varchar(36),
  `posted_by` varchar(36),
  `posted_at` timestamp,
  `reversed_by` varchar(36),
  `reversed_at` timestamp,
  `reverse_reason` varchar(300),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `bio_costing_run_run_id` PRIMARY KEY(`run_id`),
  CONSTRAINT `uq_bio_costing_run_no` UNIQUE(`tenant_id`,`company_id`,`run_no`),
  CONSTRAINT `uq_bio_costing_run_active` UNIQUE(`active_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_bio_costing_run_profile` ON `bio_costing_run` (`profile_id`,`period_end`);
--> statement-breakpoint
CREATE TABLE `bio_costing_run_line` (
  `line_id` varchar(36) NOT NULL,
  `run_id` varchar(36) NOT NULL,
  `animal_id` varchar(36) NOT NULL,
  `batch_id` varchar(36),
  `status` varchar(10) NOT NULL,
  `skip_reason` varchar(40),
  `days` decimal(10,4),
  `remaining_days` int,
  `book_value_before` decimal(18,4) NOT NULL,
  `residual` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `charge` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `book_value_after` decimal(18,4) NOT NULL,
  `costing_start_date` date,
  `life_end_date` date,
  `ledger_entry_id` varchar(36),
  `journal_id` varchar(36),
  `integration_status` varchar(16) NOT NULL DEFAULT 'NOT_APPLICABLE',
  `active_key` varchar(120),
  CONSTRAINT `bio_costing_run_line_line_id` PRIMARY KEY(`line_id`),
  CONSTRAINT `uq_bio_costing_run_line_active` UNIQUE(`active_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_bio_costing_run_line_run` ON `bio_costing_run_line` (`run_id`);
--> statement-breakpoint
CREATE INDEX `idx_bio_costing_run_line_animal` ON `bio_costing_run_line` (`animal_id`);
--> statement-breakpoint
ALTER TABLE `bio_costing_run` ADD CONSTRAINT `fk_bcr_company` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_run` ADD CONSTRAINT `fk_bcr_profile` FOREIGN KEY (`profile_id`) REFERENCES `bio_costing_profile`(`profile_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_run_line` ADD CONSTRAINT `fk_bcrl_run` FOREIGN KEY (`run_id`) REFERENCES `bio_costing_run`(`run_id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_run_line` ADD CONSTRAINT `fk_bcrl_animal` FOREIGN KEY (`animal_id`) REFERENCES `animal_register`(`animal_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_asset_ledger` ADD `run_id` varchar(36);
--> statement-breakpoint
CREATE INDEX `idx_bio_asset_ledger_run` ON `bio_asset_ledger` (`run_id`);
