-- Feed Forecast Engine rows 58-71 and Rishi's 5 Oct decisions need real MILL and BIN locations,
-- configurable production slots, and effective BIN-to-diet assignments. Capacities remain canonical KG;
-- the Location service converts the approved TON inputs. All changes are additive and create no sample data.
ALTER TABLE `location_master` ADD `mill_daily_capacity_kg` decimal(14,2);--> statement-breakpoint
ALTER TABLE `location_master` ADD `mill_hourly_capacity_kg` decimal(14,2);--> statement-breakpoint
ALTER TABLE `location_master` ADD `mill_bulk_daily_allocation_kg` decimal(14,2);--> statement-breakpoint
ALTER TABLE `location_master` ADD `mill_bagged_daily_allocation_kg` decimal(14,2);--> statement-breakpoint
ALTER TABLE `location_master` ADD `bin_capacity_kg` decimal(14,2);--> statement-breakpoint
ALTER TABLE `location_master` ADD `bin_feed_type` varchar(10);--> statement-breakpoint
CREATE TABLE `production_slot_master` (
	`slot_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`slot_code` varchar(50) NOT NULL,
	`slot_name` varchar(100) NOT NULL,
	`start_time` time NOT NULL,
	`end_time` time NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp,
	CONSTRAINT `production_slot_master_slot_id` PRIMARY KEY(`slot_id`),
	CONSTRAINT `uq_prod_slot_scope_code` UNIQUE(`tenant_id`,`company_id`,`slot_code`)
);--> statement-breakpoint
ALTER TABLE `production_slot_master` ADD CONSTRAINT `prod_slot_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_prod_slot_company` ON `production_slot_master` (`company_id`);--> statement-breakpoint
CREATE TABLE `bin_diet_assignment` (
	`assignment_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`bin_location_id` varchar(36) NOT NULL,
	`feed_item_id` varchar(36) NOT NULL,
	`production_date` date NOT NULL,
	`production_slot_id` varchar(36) NOT NULL,
	`diet_priority` int NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp,
	CONSTRAINT `bin_diet_assignment_assignment_id` PRIMARY KEY(`assignment_id`),
	CONSTRAINT `uq_bin_diet_date_slot` UNIQUE(`bin_location_id`,`production_date`,`production_slot_id`)
);--> statement-breakpoint
ALTER TABLE `bin_diet_assignment` ADD CONSTRAINT `bin_diet_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bin_diet_assignment` ADD CONSTRAINT `bin_diet_location_fk` FOREIGN KEY (`bin_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bin_diet_assignment` ADD CONSTRAINT `bin_diet_item_fk` FOREIGN KEY (`feed_item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bin_diet_assignment` ADD CONSTRAINT `bin_diet_slot_fk` FOREIGN KEY (`production_slot_id`) REFERENCES `production_slot_master`(`slot_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_bin_diet_company_date` ON `bin_diet_assignment` (`company_id`,`production_date`);--> statement-breakpoint
CREATE INDEX `idx_bin_diet_item_date` ON `bin_diet_assignment` (`feed_item_id`,`production_date`);
