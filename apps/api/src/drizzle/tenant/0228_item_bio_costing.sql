-- 28 Oct 2026 (item-level bio-asset costing, Phase 1; docs/superpowers/plans/2026-10-28-item-level-bio-costing.md): TDD Item Card "Bio Asset Costing" tab.
-- A biological item carries how its animals are costed: method, start age, life, residual, frequency and the five GL accounts. The costing profile
-- is untouched and still runs; nothing reads these columns until Phase 2. item_fair_value_rate holds the dated fair-value inputs (expected weight,
-- price per kg) that bio_costing_profile_rate holds for a profile. Additive: seventeen columns on item_master and one table.
ALTER TABLE `item_master` ADD `bio_costing_method` varchar(20);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_gender` char(1);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_start_age_weeks` int;
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_start_age_days` int;
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_useful_life_months` int;
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_residual_rule` varchar(20);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_residual_fixed_amount` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_residual_weight_kg` decimal(10,3);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_residual_price_per_kg` decimal(18,6);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_run_frequency` varchar(10);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_day_basis` varchar(20);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_auto_post` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_acquisition_gl_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_accum_amort_gl_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_amort_expense_gl_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_fv_gain_loss_gl_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `bio_writeoff_gl_id` varchar(36);
--> statement-breakpoint
CREATE TABLE `item_fair_value_rate` (
  `rate_id` varchar(36) NOT NULL,
  `item_id` varchar(36) NOT NULL,
  `farm_id` varchar(36),
  `age_week_from` int NOT NULL DEFAULT 0,
  `effective_from` date NOT NULL,
  `expected_weight_kg` decimal(10,3) NOT NULL,
  `price_per_kg` decimal(18,6) NOT NULL,
  `cdm_based` boolean NOT NULL DEFAULT false,
  `costs_to_sell_pct` decimal(5,2),
  `created_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `item_fair_value_rate_rate_id` PRIMARY KEY(`rate_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_item_fair_value_rate_item` ON `item_fair_value_rate` (`item_id`,`effective_from`);
--> statement-breakpoint
ALTER TABLE `item_fair_value_rate` ADD CONSTRAINT `item_fair_value_rate_item_id_item_master_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `item_master`(`item_id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `item_fair_value_rate` ADD CONSTRAINT `item_fair_value_rate_farm_id_location_master_location_id_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;
