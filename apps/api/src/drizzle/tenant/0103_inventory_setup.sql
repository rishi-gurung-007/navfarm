CREATE TABLE IF NOT EXISTS `inventory_setup` (
	`id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`numbering_config` json,
	`general_config` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventory_setup_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_inventory_setup_company` UNIQUE(`tenant_id`,`company_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_setup_company` ON `inventory_setup` (`company_id`);
