ALTER TABLE `reason_master` ADD `sub_category` varchar(50);
--> statement-breakpoint
ALTER TABLE `reason_master` ADD `stage_filter_note` varchar(100);
--> statement-breakpoint
ALTER TABLE `reason_master` ADD `mandatory_comment` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `animal_register` ADD `disposal_reason_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `animal_register` ADD CONSTRAINT `animal_register_disposal_reason_id_fk` FOREIGN KEY (`disposal_reason_id`) REFERENCES `reason_master`(`reason_id`) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `idx_animal_register_disposal_reason_id` ON `animal_register` (`disposal_reason_id`);
