-- 20 Oct 2026 (bio-asset costing, Phase 3): the central costing profile. One row says how an animal is costed (amortisation or
-- fair value, start age, life, residual, frequency, GL accounts); its scope columns choose which animals it applies to.
-- active_scope_key is set only while the profile is ACTIVE and is unique, so two active profiles cannot claim the same scope.
-- bio_costing_profile_rate holds the dated fair-value inputs (expected weight, price per kg). Additive: two new tables.
CREATE TABLE `bio_costing_profile` (
  `profile_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `profile_code` varchar(40) NOT NULL,
  `name` varchar(150) NOT NULL,
  `item_id` varchar(36),
  `breed_id` varchar(36),
  `gender` char(1),
  `origin` varchar(10),
  `costing_method` varchar(20) NOT NULL,
  `start_age_weeks` int NOT NULL,
  `useful_life_months` int,
  `residual_rule` varchar(20) NOT NULL DEFAULT 'NONE',
  `residual_fixed_amount` decimal(18,4),
  `residual_weight_kg` decimal(10,3),
  `residual_price_per_kg` decimal(18,6),
  `residual_applies_gender` char(1),
  `run_frequency` varchar(10) NOT NULL DEFAULT 'MONTHLY',
  `day_basis` varchar(20) NOT NULL DEFAULT 'FREQUENCY_DAYS',
  `tracking` varchar(12) NOT NULL DEFAULT 'INDIVIDUAL',
  `auto_post` boolean NOT NULL DEFAULT false,
  `acquisition_gl_id` varchar(36),
  `accum_amort_gl_id` varchar(36),
  `amort_expense_gl_id` varchar(36),
  `fv_gain_loss_gl_id` varchar(36),
  `writeoff_gl_id` varchar(36),
  `effective_from` date NOT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'DRAFT',
  `active_scope_key` varchar(200),
  `supersedes_profile_id` varchar(36),
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `bio_costing_profile_profile_id` PRIMARY KEY(`profile_id`),
  CONSTRAINT `uq_bio_costing_profile_code` UNIQUE(`tenant_id`,`company_id`,`profile_code`),
  CONSTRAINT `uq_bio_costing_profile_active_scope` UNIQUE(`active_scope_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_bio_costing_profile_status` ON `bio_costing_profile` (`company_id`,`status`);
--> statement-breakpoint
CREATE TABLE `bio_costing_profile_rate` (
  `rate_id` varchar(36) NOT NULL,
  `profile_id` varchar(36) NOT NULL,
  `farm_id` varchar(36),
  `age_week_from` int NOT NULL DEFAULT 0,
  `effective_from` date NOT NULL,
  `expected_weight_kg` decimal(10,3) NOT NULL,
  `price_per_kg` decimal(18,6) NOT NULL,
  `cdm_based` boolean NOT NULL DEFAULT false,
  `costs_to_sell_pct` decimal(5,2),
  `created_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `bio_costing_profile_rate_rate_id` PRIMARY KEY(`rate_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_bio_costing_profile_rate_profile` ON `bio_costing_profile_rate` (`profile_id`,`effective_from`);
--> statement-breakpoint
ALTER TABLE `bio_costing_profile` ADD CONSTRAINT `fk_bcp_company` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_profile` ADD CONSTRAINT `fk_bcp_item` FOREIGN KEY (`item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_profile` ADD CONSTRAINT `fk_bcp_breed` FOREIGN KEY (`breed_id`) REFERENCES `breed_master`(`breed_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_profile` ADD CONSTRAINT `fk_bcp_gl_acq` FOREIGN KEY (`acquisition_gl_id`) REFERENCES `gl_account_master`(`gl_account_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_profile` ADD CONSTRAINT `fk_bcp_gl_accum` FOREIGN KEY (`accum_amort_gl_id`) REFERENCES `gl_account_master`(`gl_account_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_profile` ADD CONSTRAINT `fk_bcp_gl_exp` FOREIGN KEY (`amort_expense_gl_id`) REFERENCES `gl_account_master`(`gl_account_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_profile` ADD CONSTRAINT `fk_bcp_gl_fv` FOREIGN KEY (`fv_gain_loss_gl_id`) REFERENCES `gl_account_master`(`gl_account_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_profile` ADD CONSTRAINT `fk_bcp_gl_wo` FOREIGN KEY (`writeoff_gl_id`) REFERENCES `gl_account_master`(`gl_account_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_profile_rate` ADD CONSTRAINT `fk_bcpr_profile` FOREIGN KEY (`profile_id`) REFERENCES `bio_costing_profile`(`profile_id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bio_costing_profile_rate` ADD CONSTRAINT `fk_bcpr_farm` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;
