ALTER TABLE `batch_header` DROP FOREIGN KEY `batch_header_scheduler_id_scheduler_master_scheduler_id_fk`;
--> statement-breakpoint
ALTER TABLE `notification_alert_log` DROP FOREIGN KEY `nal_spl_id_fk`;
--> statement-breakpoint
ALTER TABLE `batch_header` DROP COLUMN `scheduler_id`;
--> statement-breakpoint
DROP TABLE `scheduler_parameter_line`;
--> statement-breakpoint
DROP TABLE `scheduler_master`;
--> statement-breakpoint
ALTER TABLE `notification_alert_log` RENAME COLUMN `spl_id` TO `line_id`;
--> statement-breakpoint
CREATE TABLE `scheduler_header` (
	`scheduler_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`batch_id` varchar(36) NOT NULL,
	`stage_id` varchar(36) NOT NULL,
	`breed_id` varchar(36),
	`lob_id` varchar(36) NOT NULL,
	`nob_id` varchar(36),
	`location_id` varchar(36),
	`data_entry_level` varchar(10) NOT NULL DEFAULT 'SHED',
	`scheduler_status` varchar(20) NOT NULL DEFAULT 'DRAFT',
	`effective_from` date NOT NULL,
	`effective_to` date,
	`actual_end_date` date,
	`animal_count` decimal(14,4) NOT NULL,
	`auto_generated` boolean NOT NULL DEFAULT true,
	`approved_by` varchar(36),
	`approved_at` timestamp,
	`notes` text,
	`extension_config` json,
	`created_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduler_header_scheduler_id` PRIMARY KEY(`scheduler_id`),
	CONSTRAINT `uq_scheduler_header_batch_stage` UNIQUE(`batch_id`,`stage_id`)
);
--> statement-breakpoint
CREATE TABLE `scheduler_line` (
	`line_id` varchar(36) NOT NULL,
	`scheduler_id` varchar(36) NOT NULL,
	`line_seq` int NOT NULL,
	`line_type` varchar(20) NOT NULL,
	`parameter_name` varchar(200) NOT NULL,
	`stage_id` varchar(36),
	`occurrence` varchar(10) NOT NULL DEFAULT 'DAILY',
	`start_day` int NOT NULL DEFAULT 1,
	`end_day` int,
	`day_of_week` int,
	`is_mandatory` boolean NOT NULL DEFAULT false,
	`source` varchar(10) NOT NULL DEFAULT 'AUTO',
	`lifecycle_ref_id` varchar(36),
	`nob_id` varchar(36),
	`lob_id` varchar(36),
	`item_id` varchar(36),
	`standard_qty` decimal(18,6),
	`qty_basis` varchar(20),
	`allow_qty_edit` boolean NOT NULL DEFAULT true,
	`lot_required` boolean NOT NULL DEFAULT false,
	`creates_inventory` boolean NOT NULL DEFAULT false,
	`output_lot_auto` boolean NOT NULL DEFAULT true,
	`output_basis` varchar(20),
	`kpi_metric` varchar(50),
	`kpi_uom` varchar(20),
	`std_value` decimal(18,4),
	`lower_alert_limit` decimal(18,4),
	`upper_alert_limit` decimal(18,4),
	`alert_severity` varchar(10) DEFAULT 'WARNING',
	`capture_per` varchar(20),
	`overhead_category` varchar(30),
	`gl_account` varchar(20),
	`estimated_cost` decimal(18,4),
	`resource_id` varchar(36),
	`is_active` boolean NOT NULL DEFAULT true,
	`extension_config` json,
	CONSTRAINT `scheduler_line_line_id` PRIMARY KEY(`line_id`)
);
--> statement-breakpoint
CREATE TABLE `scheduler_line_custom_days` (
	`custom_day_id` varchar(36) NOT NULL,
	`line_id` varchar(36) NOT NULL,
	`day_number` int NOT NULL,
	`day_label` varchar(50),
	`is_active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `scheduler_line_custom_days_custom_day_id` PRIMARY KEY(`custom_day_id`),
	CONSTRAINT `uq_scheduler_line_custom_days_line_day` UNIQUE(`line_id`,`day_number`)
);
--> statement-breakpoint
CREATE TABLE `batch_daily_data` (
	`entry_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`line_id` varchar(36) NOT NULL,
	`batch_id` varchar(36) NOT NULL,
	`entry_date` date NOT NULL,
	`entered_value` decimal(18,6),
	`entered_text` varchar(500),
	`lot_id` varchar(36),
	`lot_no` varchar(80),
	`resource_id` varchar(36),
	`posted` boolean NOT NULL DEFAULT false,
	`posting_reference` varchar(36),
	`alert_triggered` boolean NOT NULL DEFAULT false,
	`alert_note` varchar(500),
	`remarks` varchar(500),
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `batch_daily_data_entry_id` PRIMARY KEY(`entry_id`),
	CONSTRAINT `uq_batch_daily_data_line_date` UNIQUE(`line_id`,`entry_date`)
);
--> statement-breakpoint
ALTER TABLE `scheduler_header` ADD CONSTRAINT `scheduler_header_batch_id_batch_header_batch_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `batch_header`(`batch_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_header` ADD CONSTRAINT `scheduler_header_stage_id_stage_master_stage_id_fk` FOREIGN KEY (`stage_id`) REFERENCES `stage_master`(`stage_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_header` ADD CONSTRAINT `scheduler_header_breed_id_breed_master_breed_id_fk` FOREIGN KEY (`breed_id`) REFERENCES `breed_master`(`breed_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_header` ADD CONSTRAINT `scheduler_header_lob_id_lob_master_lob_id_fk` FOREIGN KEY (`lob_id`) REFERENCES `lob_master`(`lob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_header` ADD CONSTRAINT `scheduler_header_nob_id_nob_master_nob_id_fk` FOREIGN KEY (`nob_id`) REFERENCES `nob_master`(`nob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_line` ADD CONSTRAINT `scheduler_line_scheduler_id_fk` FOREIGN KEY (`scheduler_id`) REFERENCES `scheduler_header`(`scheduler_id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_line` ADD CONSTRAINT `scheduler_line_lifecycle_ref_fk` FOREIGN KEY (`lifecycle_ref_id`) REFERENCES `breed_lifecycle_stages`(`lifecycle_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_line` ADD CONSTRAINT `scheduler_line_item_id_item_master_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_line` ADD CONSTRAINT `scheduler_line_resource_id_resource_master_resource_id_fk` FOREIGN KEY (`resource_id`) REFERENCES `resource_master`(`resource_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_line_custom_days` ADD CONSTRAINT `scheduler_line_custom_days_line_id_scheduler_line_line_id_fk` FOREIGN KEY (`line_id`) REFERENCES `scheduler_line`(`line_id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD CONSTRAINT `batch_daily_data_line_id_scheduler_line_line_id_fk` FOREIGN KEY (`line_id`) REFERENCES `scheduler_line`(`line_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD CONSTRAINT `batch_daily_data_batch_id_batch_header_batch_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `batch_header`(`batch_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `notification_alert_log` ADD CONSTRAINT `nal_line_id_fk` FOREIGN KEY (`line_id`) REFERENCES `scheduler_line`(`line_id`) ON DELETE restrict ON UPDATE no action;
