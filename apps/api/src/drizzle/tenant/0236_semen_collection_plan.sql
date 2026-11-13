-- 2 Nov 2026 (AI Station, plan 2026-11-02-ai-station-semen-collection, Phase 4): a planned collection. The boars of one breeding line chosen for one
-- collection day, the request behind it (requested by, the outside reference, where the semen is for), and the ranks each boar had when chosen. It is
-- checked against the line's setup when made, and a collection records which plan it carried out. Additive: two new tables and one nullable column on
-- semen_batch; nothing is updated, and every collection recorded before this has no plan.
CREATE TABLE `semen_collection_plan` (
	`plan_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`plan_no` varchar(30) NOT NULL,
	`breed_id` varchar(36) NOT NULL,
	`collection_date` date NOT NULL,
	`weekday` varchar(3) NOT NULL,
	`week_no` int NOT NULL,
	`week_year` int NOT NULL,
	`status` varchar(12) NOT NULL DEFAULT 'PLANNED',
	`requested_by` varchar(100),
	`reference` varchar(100),
	`destination_farm_id` varchar(36),
	`notes` varchar(500),
	`cancel_reason` varchar(200),
	`created_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `semen_collection_plan_plan_id` PRIMARY KEY(`plan_id`),
	CONSTRAINT `uq_semen_collection_plan_no` UNIQUE(`tenant_id`,`plan_no`)
);
--> statement-breakpoint
CREATE INDEX `idx_semen_collection_plan_line_date` ON `semen_collection_plan` (`breed_id`,`collection_date`);
--> statement-breakpoint
CREATE TABLE `semen_collection_plan_line` (
	`plan_id` varchar(36) NOT NULL,
	`boar_animal_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`collector_id` varchar(36),
	`status` varchar(12) NOT NULL DEFAULT 'PLANNED',
	`skip_reason` varchar(200),
	`semen_batch_id` varchar(36),
	`selection_snapshot` json,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `semen_collection_plan_line_plan_id_boar_animal_id` PRIMARY KEY(`plan_id`,`boar_animal_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_semen_collection_plan_line_boar` ON `semen_collection_plan_line` (`boar_animal_id`);
--> statement-breakpoint
ALTER TABLE `semen_collection_plan` ADD CONSTRAINT `semen_collection_plan_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `semen_collection_plan` ADD CONSTRAINT `semen_collection_plan_breed_id_breed_master_breed_id_fk` FOREIGN KEY (`breed_id`) REFERENCES `breed_master`(`breed_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `semen_collection_plan_line` ADD CONSTRAINT `fk_scpl_plan` FOREIGN KEY (`plan_id`) REFERENCES `semen_collection_plan`(`plan_id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `semen_collection_plan_line` ADD CONSTRAINT `fk_scpl_boar` FOREIGN KEY (`boar_animal_id`) REFERENCES `animal_register`(`animal_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `semen_collection_plan_line` ADD CONSTRAINT `fk_scpl_collector` FOREIGN KEY (`collector_id`) REFERENCES `semen_collector`(`collector_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD `plan_id` varchar(36);
