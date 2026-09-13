CREATE TABLE `activity_master` (
	`activity_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`nob_id` varchar(36),
	`lob_id` varchar(36),
	`activity_code` varchar(50) NOT NULL,
	`activity_name` varchar(200) NOT NULL,
	`line_type` varchar(20) NOT NULL,
	`description` text,
	`default_item_id` varchar(36),
	`default_resource_id` varchar(36),
	`default_occurrence` varchar(10),
	`default_qty_basis` varchar(20),
	`default_output_basis` varchar(20),
	`default_kpi_metric` varchar(50),
	`default_capture_per` varchar(20),
	`default_overhead_category` varchar(30),
	`default_gl_account` varchar(20),
	`default_is_mandatory` boolean NOT NULL DEFAULT false,
	`default_lot_required` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_master_activity_id` PRIMARY KEY(`activity_id`),
	CONSTRAINT `uq_activity_scope_code` UNIQUE(`tenant_id`,(coalesce(`company_id`, '')),(coalesce(`lob_id`, '')),`activity_code`)
);
--> statement-breakpoint
ALTER TABLE `activity_master` ADD CONSTRAINT `activity_master_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `activity_master` ADD CONSTRAINT `activity_master_nob_id_nob_master_nob_id_fk` FOREIGN KEY (`nob_id`) REFERENCES `nob_master`(`nob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `activity_master` ADD CONSTRAINT `activity_master_lob_id_lob_master_lob_id_fk` FOREIGN KEY (`lob_id`) REFERENCES `lob_master`(`lob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `activity_master` ADD CONSTRAINT `activity_master_default_item_id_item_master_item_id_fk` FOREIGN KEY (`default_item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `activity_master` ADD CONSTRAINT `activity_master_default_resource_id_fk` FOREIGN KEY (`default_resource_id`) REFERENCES `resource_master`(`resource_id`) ON DELETE restrict ON UPDATE no action;
