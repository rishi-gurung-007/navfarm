-- Tasks 3 & 4: Reporting period draft defaults, Feed forecast runs and line snapshots
ALTER TABLE `reporting_period` ALTER COLUMN `is_active` SET DEFAULT false;--> statement-breakpoint
ALTER TABLE `reporting_period` ALTER COLUMN `status` SET DEFAULT 'DRAFT';--> statement-breakpoint
CREATE TABLE `feed_forecast_run` (
	`run_id` varchar(36) NOT NULL,
	`run_code` varchar(80) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`farm_id` varchar(36) NOT NULL,
	`version` int NOT NULL,
	`planning_date` date NOT NULL,
	`view` varchar(20) NOT NULL,
	`from_date` date NOT NULL,
	`to_date` date NOT NULL,
	`period_id` varchar(36),
	`source_cutoff_at` timestamp NOT NULL,
	`source_snapshot` json NOT NULL,
	`output_snapshot` json NOT NULL,
	`config_snapshot` json NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feed_forecast_run_run_id` PRIMARY KEY(`run_id`),
	CONSTRAINT `uq_feed_forecast_run_farm_version` UNIQUE(`farm_id`,`version`),
	CONSTRAINT `uq_feed_forecast_run_company_code` UNIQUE(`company_id`,`run_code`)
);--> statement-breakpoint
ALTER TABLE `feed_forecast_run` ADD CONSTRAINT `feed_forecast_run_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_forecast_run` ADD CONSTRAINT `feed_forecast_run_farm_id_location_master_location_id_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_forecast_run` ADD CONSTRAINT `feed_forecast_run_period_id_reporting_period_period_id_fk` FOREIGN KEY (`period_id`) REFERENCES `reporting_period`(`period_id`) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `idx_feed_forecast_run_tenant_farm` ON `feed_forecast_run` (`tenant_id`,`farm_id`);--> statement-breakpoint
CREATE TABLE `feed_forecast_run_line` (
	`run_line_id` varchar(36) NOT NULL,
	`run_id` varchar(36) NOT NULL,
	`forecast_date` date NOT NULL,
	`batch_id` varchar(36) NOT NULL,
	`shed_id` varchar(36),
	`destination_location_id` varchar(36),
	`required_item_id` varchar(36) NOT NULL,
	`current_item_id` varchar(36),
	`head_count` int NOT NULL,
	`feed_rate_kg` decimal(18,6) NOT NULL,
	`opening_stock_kg` decimal(18,4) NOT NULL,
	`confirmed_receipt_kg` decimal(18,4) NOT NULL,
	`daily_demand_kg` decimal(18,4) NOT NULL,
	`projected_closing_kg` decimal(18,4) NOT NULL,
	`shortage_date` date,
	`recommended_qty_kg` decimal(18,4) NOT NULL,
	`required_on_date` date,
	`provenance_snapshot` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feed_forecast_run_line_run_line_id` PRIMARY KEY(`run_line_id`)
);--> statement-breakpoint
ALTER TABLE `feed_forecast_run_line` ADD CONSTRAINT `feed_forecast_run_line_run_id_feed_forecast_run_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `feed_forecast_run`(`run_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_forecast_run_line` ADD CONSTRAINT `feed_forecast_run_line_batch_id_batch_header_batch_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `batch_header`(`batch_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_forecast_run_line` ADD CONSTRAINT `feed_forecast_run_line_shed_id_location_master_location_id_fk` FOREIGN KEY (`shed_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_forecast_run_line` ADD CONSTRAINT `feed_forecast_run_line_dest_loc_fk` FOREIGN KEY (`destination_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_forecast_run_line` ADD CONSTRAINT `feed_forecast_run_line_required_item_id_item_master_item_id_fk` FOREIGN KEY (`required_item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_forecast_run_line` ADD CONSTRAINT `feed_forecast_run_line_current_item_id_item_master_item_id_fk` FOREIGN KEY (`current_item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `idx_feed_forecast_run_line_run` ON `feed_forecast_run_line` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_feed_forecast_run_line_destination_item` ON `feed_forecast_run_line` (`destination_location_id`,`required_item_id`);
