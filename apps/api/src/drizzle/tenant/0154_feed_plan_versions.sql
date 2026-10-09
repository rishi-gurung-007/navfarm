CREATE TABLE `feed_plan` (
	`plan_id` varchar(36) NOT NULL,
	`plan_code` varchar(80) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`farm_id` varchar(36) NOT NULL,
	`source_run_id` varchar(36),
	`production_date` date NOT NULL,
	`plan_week` varchar(6) NOT NULL,
	`plan_type` varchar(20) NOT NULL,
	`version` int NOT NULL,
	`source_from` date NOT NULL,
	`source_to` date NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feed_plan_plan_id` PRIMARY KEY(`plan_id`),
	CONSTRAINT `uq_feed_plan_company_code` UNIQUE(`company_id`,`plan_code`),
	CONSTRAINT `uq_feed_plan_farm_week_version` UNIQUE(`farm_id`,`plan_week`,`version`),
	CONSTRAINT `feed_plan_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict,
	CONSTRAINT `feed_plan_farm_id_location_master_location_id_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict,
	CONSTRAINT `feed_plan_source_run_id_feed_forecast_run_run_id_fk` FOREIGN KEY (`source_run_id`) REFERENCES `feed_forecast_run`(`run_id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_feed_plan_tenant_farm_week` ON `feed_plan` (`tenant_id`,`farm_id`,`plan_week`);
--> statement-breakpoint
CREATE TABLE `feed_plan_line` (
	`plan_line_id` varchar(36) NOT NULL,
	`plan_id` varchar(36) NOT NULL,
	`item_id` varchar(36) NOT NULL,
	`projected_target_kg` decimal(18,4) NOT NULL,
	`adjustment_factor` decimal(18,6) NOT NULL,
	`tentative_qty_kg` decimal(18,4) NOT NULL,
	`requested_qty_kg` decimal(18,4),
	`mill_approved_qty_kg` decimal(18,4),
	`variance_qty_kg` decimal(18,4) NOT NULL,
	`history_snapshot` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feed_plan_line_plan_line_id` PRIMARY KEY(`plan_line_id`),
	CONSTRAINT `uq_feed_plan_line_plan_item` UNIQUE(`plan_id`,`item_id`),
	CONSTRAINT `feed_plan_line_plan_id_feed_plan_plan_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `feed_plan`(`plan_id`) ON DELETE restrict,
	CONSTRAINT `feed_plan_line_item_id_item_master_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_feed_plan_line_plan` ON `feed_plan_line` (`plan_id`);
