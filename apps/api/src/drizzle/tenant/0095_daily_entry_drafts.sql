ALTER TABLE `batch_daily_data` ADD `status` varchar(12) NOT NULL DEFAULT 'POSTED';--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD `version` int NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD `target_scope` varchar(20);--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD `supersedes_entry_id` varchar(36);--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD `superseded_at` timestamp NULL;--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD `active_slot` tinyint GENERATED ALWAYS AS (IF(`status` = 'SUPERSEDED', NULL, 1)) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_batch_daily_data_line_date_active` ON `batch_daily_data` (`line_id`,`entry_date`,`active_slot`);--> statement-breakpoint
ALTER TABLE `batch_daily_data` DROP INDEX `uq_batch_daily_data_line_date`;--> statement-breakpoint
CREATE TABLE `batch_daily_data_target` (
  `target_id` varchar(36) NOT NULL,
  `entry_id` varchar(36) NOT NULL,
  `animal_id` varchar(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `batch_daily_data_target_pk` PRIMARY KEY(`target_id`),
  CONSTRAINT `uq_batch_daily_data_target_entry_animal` UNIQUE(`entry_id`,`animal_id`),
  CONSTRAINT `bddt_entry_fk` FOREIGN KEY (`entry_id`) REFERENCES `batch_daily_data`(`entry_id`) ON DELETE cascade,
  CONSTRAINT `bddt_animal_fk` FOREIGN KEY (`animal_id`) REFERENCES `animal_register`(`animal_id`) ON DELETE restrict
);
