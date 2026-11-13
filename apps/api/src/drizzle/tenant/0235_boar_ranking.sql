-- 2 Nov 2026 (AI Station, plan 2026-11-02-ai-station-semen-collection, Phase 3): what the boar selection table ranks and shows. The genetic levels of a line
-- are bands of TSI (the thresholds are the client's to enter, nothing is seeded); a boar's TSI is kept over time with the herd-wide genetic rank that was
-- published beside it; and a line's setup says how the overall grading is weighted, how ties are ranked and which columns the table shows. Additive: two new
-- tables and five nullable-or-defaulted columns on breeding_line_setup; nothing is updated. Existing setups read as "no grading", the sheets' own tie rule
-- (the better genetic rank wins) and every column in its default order.
CREATE TABLE `genetic_level_band` (
	`band_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`nob_id` varchar(36),
	`lob_id` varchar(36),
	`breed_id` varchar(36),
	`level_name` varchar(50) NOT NULL,
	`tsi_from` decimal(10,2),
	`tsi_to` decimal(10,2),
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp,
	CONSTRAINT `genetic_level_band_band_id` PRIMARY KEY(`band_id`),
	CONSTRAINT `uq_genetic_level_band_scope_line_name` UNIQUE(`tenant_id`,(coalesce(`company_id`, '')),(coalesce(`breed_id`, '')),`level_name`)
);
--> statement-breakpoint
CREATE TABLE `boar_tsi_history` (
	`history_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`boar_animal_id` varchar(36) NOT NULL,
	`tsi` decimal(10,2) NOT NULL,
	`published_rank` int,
	`effective_date` date NOT NULL,
	`source` varchar(10) NOT NULL DEFAULT 'MANUAL',
	`notes` varchar(200),
	`created_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `boar_tsi_history_history_id` PRIMARY KEY(`history_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_boar_tsi_history_boar_date` ON `boar_tsi_history` (`boar_animal_id`,`effective_date`);
--> statement-breakpoint
ALTER TABLE `genetic_level_band` ADD CONSTRAINT `genetic_level_band_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `genetic_level_band` ADD CONSTRAINT `genetic_level_band_nob_id_nob_master_nob_id_fk` FOREIGN KEY (`nob_id`) REFERENCES `nob_master`(`nob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `genetic_level_band` ADD CONSTRAINT `genetic_level_band_lob_id_lob_master_lob_id_fk` FOREIGN KEY (`lob_id`) REFERENCES `lob_master`(`lob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `genetic_level_band` ADD CONSTRAINT `genetic_level_band_breed_id_breed_master_breed_id_fk` FOREIGN KEY (`breed_id`) REFERENCES `breed_master`(`breed_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `boar_tsi_history` ADD CONSTRAINT `boar_tsi_history_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `boar_tsi_history` ADD CONSTRAINT `boar_tsi_history_boar_animal_id_animal_register_animal_id_fk` FOREIGN KEY (`boar_animal_id`) REFERENCES `animal_register`(`animal_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD `grading_genetic_weight` decimal(6,2);
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD `grading_dose_weight` decimal(6,2);
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD `grading_morphology_weight` decimal(6,2);
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD `rank_tie_break` varchar(15) NOT NULL DEFAULT 'GENETIC_RANK';
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD `selection_columns` json;
