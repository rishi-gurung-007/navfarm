-- 2 Nov 2026 (AI Station, plan 2026-11-02-ai-station-semen-collection, Phase 1): the rules of each breeding line (Tempo, L-Line, Z-Line) become
-- master data instead of constants: when it is tapped, whether and how it is pooled, its colorant, its lot label, where its semen may go, the rest and
-- motility a collection must respect. One row per line; a row with no breed is the company default. The collectors (CM, AW, TA on the client's sheets)
-- are a master of their own. Additive: two new tables, nothing updated and nothing seeded: every value is the client's to enter.
CREATE TABLE `breeding_line_setup` (
	`setup_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`nob_id` varchar(36),
	`lob_id` varchar(36),
	`breed_id` varchar(36),
	`collection_mode` varchar(20) NOT NULL DEFAULT 'SCHEDULED',
	`collection_weekdays` json,
	`boars_per_collection_day` int,
	`pooling_allowed` boolean NOT NULL DEFAULT true,
	`min_boars_per_lot` int,
	`max_boars_per_lot` int,
	`colorant_name` varchar(50),
	`colorant_item_id` varchar(36),
	`colorant_qty_per_lot` decimal(10,3),
	`label_template` varchar(100),
	`week_basis` varchar(10) NOT NULL DEFAULT 'ISO',
	`include_year` boolean NOT NULL DEFAULT false,
	`destination_rule` varchar(10) NOT NULL DEFAULT 'ANY',
	`destination_farm_ids` json,
	`reference_required` boolean NOT NULL DEFAULT false,
	`reference_label` varchar(50),
	`restrict_to_destination` varchar(10) NOT NULL DEFAULT 'NONE',
	`min_rest_days` int,
	`min_motility_pct` decimal(5,2),
	`rule_enforcement` varchar(10) NOT NULL DEFAULT 'WARN',
	`is_active` boolean NOT NULL DEFAULT true,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp,
	CONSTRAINT `breeding_line_setup_setup_id` PRIMARY KEY(`setup_id`),
	CONSTRAINT `uq_breeding_line_setup_scope_line` UNIQUE(`tenant_id`,(coalesce(`company_id`, '')),(coalesce(`breed_id`, '')))
);
--> statement-breakpoint
CREATE TABLE `semen_collector` (
	`collector_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`nob_id` varchar(36),
	`lob_id` varchar(36),
	`collector_code` varchar(20) NOT NULL,
	`collector_name` varchar(100) NOT NULL,
	`user_id` varchar(36),
	`is_active` boolean NOT NULL DEFAULT true,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp,
	CONSTRAINT `semen_collector_collector_id` PRIMARY KEY(`collector_id`),
	CONSTRAINT `uq_semen_collector_scope_code` UNIQUE(`tenant_id`,(coalesce(`company_id`, '')),`collector_code`)
);
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD CONSTRAINT `breeding_line_setup_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD CONSTRAINT `breeding_line_setup_nob_id_nob_master_nob_id_fk` FOREIGN KEY (`nob_id`) REFERENCES `nob_master`(`nob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD CONSTRAINT `breeding_line_setup_lob_id_lob_master_lob_id_fk` FOREIGN KEY (`lob_id`) REFERENCES `lob_master`(`lob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD CONSTRAINT `breeding_line_setup_breed_id_breed_master_breed_id_fk` FOREIGN KEY (`breed_id`) REFERENCES `breed_master`(`breed_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD CONSTRAINT `breeding_line_setup_colorant_item_id_item_master_item_id_fk` FOREIGN KEY (`colorant_item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `semen_collector` ADD CONSTRAINT `semen_collector_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `semen_collector` ADD CONSTRAINT `semen_collector_nob_id_nob_master_nob_id_fk` FOREIGN KEY (`nob_id`) REFERENCES `nob_master`(`nob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `semen_collector` ADD CONSTRAINT `semen_collector_lob_id_lob_master_lob_id_fk` FOREIGN KEY (`lob_id`) REFERENCES `lob_master`(`lob_id`) ON DELETE restrict ON UPDATE no action;
