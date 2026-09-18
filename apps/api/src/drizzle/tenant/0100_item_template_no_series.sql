CREATE TABLE `no_series` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36),
	`company_id` varchar(36),
	`code` varchar(20) NOT NULL,
	`description` varchar(100),
	`no_series_code` varchar(20),
	`increment_by` int NOT NULL DEFAULT 1,
	`manual_nos` boolean NOT NULL DEFAULT false,
	`last_no_used` varchar(20),
	`blocked` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `no_series_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_no_series_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE INDEX `idx_no_series_code` ON `no_series` (`code`);
--> statement-breakpoint
CREATE TABLE `item_template` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36),
	`company_id` varchar(36),
	`template_code` varchar(20) NOT NULL,
	`template_description` varchar(100),
	`no_series_id` varchar(36) NOT NULL,
	`item_type` varchar(30),
	`category` varchar(50),
	`sub_category` varchar(50),
	`valuation_method` varchar(20),
	`item_tracking` varchar(10),
	`item_tracking_no_series_id` varchar(36),
	`inventory_type` varchar(20),
	`qr_code_enabled` boolean NOT NULL DEFAULT false,
	`inventory_gl_account` varchar(20),
	`cogs_gl_account` varchar(20),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `item_template_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_item_template_code` UNIQUE(`template_code`),
	CONSTRAINT `item_template_no_series_id_fk` FOREIGN KEY (`no_series_id`) REFERENCES `no_series`(`id`) ON DELETE restrict,
	CONSTRAINT `item_template_tracking_no_series_id_fk` FOREIGN KEY (`item_tracking_no_series_id`) REFERENCES `no_series`(`id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_item_template_code` ON `item_template` (`template_code`);
--> statement-breakpoint
CREATE INDEX `idx_item_template_no_series_id` ON `item_template` (`no_series_id`);
--> statement-breakpoint
CREATE INDEX `idx_item_template_is_active` ON `item_template` (`is_active`);
--> statement-breakpoint
CREATE INDEX `idx_item_template_item_type` ON `item_template` (`item_type`);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `item_template_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `item_master` ADD CONSTRAINT `item_master_item_template_id_fk` FOREIGN KEY (`item_template_id`) REFERENCES `item_template`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `idx_item_master_item_template_id` ON `item_master` (`item_template_id`);
