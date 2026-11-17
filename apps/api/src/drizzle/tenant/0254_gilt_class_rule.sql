-- 13 Nov 2026 (BBP-2, "Selection of Gilts for Breeding"): the class a selected gilt takes is set by her parentage, the BBP's mating-line table
-- (Z + Z = Local GGP, Z + L = Local GP, Z + Tempo = Local Parent). The client says it depends on the dam and the sire. A line is a breed, so a rule
-- names the dam's breed, the sire's breed and the item the gilt is registered as (the item carries the class's accounts and costing terms).
-- Additive: one new table, nothing is updated or seeded; the client's pairs and items are entered in Master Data. With no rule for a pair, gilt
-- selection behaves as before (the user names the item).
CREATE TABLE `gilt_class_rule` (
	`rule_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`nob_id` varchar(36),
	`lob_id` varchar(36),
	`dam_breed_id` varchar(36) NOT NULL,
	`sire_breed_id` varchar(36) NOT NULL,
	`gilt_item_id` varchar(36) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp,
	CONSTRAINT `gilt_class_rule_rule_id` PRIMARY KEY(`rule_id`),
	CONSTRAINT `uq_gilt_class_rule_pair` UNIQUE(`tenant_id`,(coalesce(`company_id`, '')),`dam_breed_id`,`sire_breed_id`)
);
--> statement-breakpoint
ALTER TABLE `gilt_class_rule` ADD CONSTRAINT `gilt_class_rule_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `gilt_class_rule` ADD CONSTRAINT `gilt_class_rule_nob_id_nob_master_nob_id_fk` FOREIGN KEY (`nob_id`) REFERENCES `nob_master`(`nob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `gilt_class_rule` ADD CONSTRAINT `gilt_class_rule_lob_id_lob_master_lob_id_fk` FOREIGN KEY (`lob_id`) REFERENCES `lob_master`(`lob_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `gilt_class_rule` ADD CONSTRAINT `gilt_class_rule_dam_breed_id_breed_master_breed_id_fk` FOREIGN KEY (`dam_breed_id`) REFERENCES `breed_master`(`breed_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `gilt_class_rule` ADD CONSTRAINT `gilt_class_rule_sire_breed_id_breed_master_breed_id_fk` FOREIGN KEY (`sire_breed_id`) REFERENCES `breed_master`(`breed_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `gilt_class_rule` ADD CONSTRAINT `gilt_class_rule_gilt_item_id_item_master_item_id_fk` FOREIGN KEY (`gilt_item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict ON UPDATE no action;
