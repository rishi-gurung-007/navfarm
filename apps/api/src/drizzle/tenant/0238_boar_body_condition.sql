-- 2 Nov 2026 (AI Station, plan 2026-11-02-ai-station-semen-collection, Phase 6; SOP 21 Boar Body Condition Scoring): the body condition scale of a breeding line (a row
-- per score: what it looks like, the action it needs, the feed it sets), a boar's assessments (what the scale said, the feed set, when the next is due), and on the line's
-- setup how often a boar is scored and whether the scale's feed level may be overridden. Additive: two new tables and five defaulted or nullable columns on
-- breeding_line_setup; nothing is updated and nothing is seeded (the scale's figures are the client's to enter). The feed forecast does not read the feed level.
CREATE TABLE `bcs_scale` (
	`scale_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`nob_id` varchar(36),
	`lob_id` varchar(36),
	`breed_id` varchar(36),
	`score` int NOT NULL,
	`score_name` varchar(50),
	`indicators` varchar(300),
	`required_action` varchar(300),
	`feed_kg_per_day` decimal(6,2),
	`health_assessment_required` boolean NOT NULL DEFAULT false,
	`medication_review` boolean NOT NULL DEFAULT false,
	`sop_reference` varchar(100),
	`is_active` boolean NOT NULL DEFAULT true,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp,
	CONSTRAINT `bcs_scale_scale_id` PRIMARY KEY(`scale_id`),
	CONSTRAINT `uq_bcs_scale_scope_line_score` UNIQUE(`tenant_id`,(coalesce(`company_id`, '')),(coalesce(`breed_id`, '')),`score`)
);
--> statement-breakpoint
CREATE TABLE `boar_condition_record` (
	`record_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`boar_animal_id` varchar(36) NOT NULL,
	`assessed_on` date NOT NULL,
	`score` int NOT NULL,
	`score_name` varchar(50),
	`required_action` varchar(300),
	`health_flag` boolean NOT NULL DEFAULT false,
	`medication_review` boolean NOT NULL DEFAULT false,
	`scale_feed_kg_per_day` decimal(6,2),
	`feed_kg_per_day` decimal(6,2),
	`previous_feed_kg_per_day` decimal(6,2),
	`override_reason` varchar(200),
	`next_due` date,
	`notes` varchar(500),
	`created_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `boar_condition_record_record_id` PRIMARY KEY(`record_id`),
	CONSTRAINT `uq_boar_condition_boar_day` UNIQUE(`boar_animal_id`,`assessed_on`)
);
--> statement-breakpoint
ALTER TABLE `bcs_scale` ADD CONSTRAINT `fk_bcsscale_company` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bcs_scale` ADD CONSTRAINT `fk_bcsscale_nob` FOREIGN KEY (`nob_id`) REFERENCES `nob_master`(`nob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bcs_scale` ADD CONSTRAINT `fk_bcsscale_lob` FOREIGN KEY (`lob_id`) REFERENCES `lob_master`(`lob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `bcs_scale` ADD CONSTRAINT `fk_bcsscale_breed` FOREIGN KEY (`breed_id`) REFERENCES `breed_master`(`breed_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `boar_condition_record` ADD CONSTRAINT `fk_bcond_company` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `boar_condition_record` ADD CONSTRAINT `fk_bcond_boar` FOREIGN KEY (`boar_animal_id`) REFERENCES `animal_register`(`animal_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD `bcs_frequency_days` int;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD `bcs_grace_days` int;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD `bcs_reminder_days` int;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD `bcs_allow_feed_override` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD `bcs_override_reason_required` boolean NOT NULL DEFAULT true;
