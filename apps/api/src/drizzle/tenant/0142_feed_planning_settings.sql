-- Task 2: Company feed settings, currency config local flag, and active scope uniqueness
ALTER TABLE `company_currency_config` ADD `is_local` boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `company_currency_config` ADD CONSTRAINT `uq_company_currency_config_company_currency` UNIQUE(`company_id`,`currency_id`);--> statement-breakpoint
CREATE TABLE `feed_planning_setting` (
	`setting_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`farm_id` varchar(36),
	`default_forecast_days` int NOT NULL DEFAULT 7,
	`max_forecast_days` int NOT NULL DEFAULT 45,
	`production_weekday` int,
	`production_shift` varchar(30),
	`submission_weekday` int,
	`submission_time` varchar(5),
	`reminder_weekday` int,
	`reminder_time` varchar(5),
	`physical_count_weekday` int,
	`physical_count_time` varchar(5),
	`truck_target_kg` decimal(14,2),
	`bulk_multiple_kg` decimal(14,2),
	`capacity_warning_pct` decimal(5,2) NOT NULL DEFAULT '90.00',
	`bag_tolerance_pct` decimal(5,2),
	`finance_variance_pct` decimal(5,2) NOT NULL DEFAULT '5.00',
	`finance_variance_amount` decimal(18,2),
	`is_active` boolean NOT NULL DEFAULT true,
	`active_scope_key` varchar(38) GENERATED ALWAYS AS (IF(`is_active`, IF(`farm_id` IS NULL, 'C:', CONCAT('F:', `farm_id`)), NULL)) STORED,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`created_by` varchar(36),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`updated_by` varchar(36),
	CONSTRAINT `feed_planning_setting_setting_id` PRIMARY KEY(`setting_id`),
	CONSTRAINT `uq_feed_planning_setting_active_scope` UNIQUE(`company_id`,`active_scope_key`)
);--> statement-breakpoint
ALTER TABLE `feed_planning_setting` ADD CONSTRAINT `feed_planning_setting_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `feed_planning_setting` ADD CONSTRAINT `feed_planning_setting_farm_id_location_master_location_id_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `idx_feed_planning_setting_company` ON `feed_planning_setting` (`company_id`);
