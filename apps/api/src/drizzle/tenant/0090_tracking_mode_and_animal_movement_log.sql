ALTER TABLE `batch_header` ADD `tracking_mode` varchar(20) NOT NULL DEFAULT 'BATCH_WISE';
--> statement-breakpoint
CREATE TABLE `animal_movement_log` (
	`movement_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`animal_id` varchar(36) NOT NULL,
	`movement_type` varchar(20) NOT NULL,
	`event_date` date NOT NULL,
	`from_batch_id` varchar(36),
	`to_batch_id` varchar(36),
	`from_stage_id` varchar(36),
	`to_stage_id` varchar(36),
	`from_location_id` varchar(36),
	`to_location_id` varchar(36),
	`entry_no` varchar(50),
	`reason` varchar(200),
	`remarks` text,
	`created_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `animal_movement_log_movement_id` PRIMARY KEY(`movement_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_animal_movement_log_animal` ON `animal_movement_log` (`animal_id`,`event_date`);
--> statement-breakpoint
ALTER TABLE `animal_movement_log` ADD CONSTRAINT `animal_movement_log_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `animal_movement_log` ADD CONSTRAINT `animal_movement_log_animal_id_fk` FOREIGN KEY (`animal_id`) REFERENCES `animal_register`(`animal_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `animal_movement_log` ADD CONSTRAINT `aml_from_batch_fk` FOREIGN KEY (`from_batch_id`) REFERENCES `batch_header`(`batch_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `animal_movement_log` ADD CONSTRAINT `aml_to_batch_fk` FOREIGN KEY (`to_batch_id`) REFERENCES `batch_header`(`batch_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `animal_movement_log` ADD CONSTRAINT `aml_from_stage_fk` FOREIGN KEY (`from_stage_id`) REFERENCES `stage_master`(`stage_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `animal_movement_log` ADD CONSTRAINT `aml_to_stage_fk` FOREIGN KEY (`to_stage_id`) REFERENCES `stage_master`(`stage_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `animal_movement_log` ADD CONSTRAINT `aml_from_location_fk` FOREIGN KEY (`from_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `animal_movement_log` ADD CONSTRAINT `aml_to_location_fk` FOREIGN KEY (`to_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD `animal_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD CONSTRAINT `batch_daily_data_animal_id_fk` FOREIGN KEY (`animal_id`) REFERENCES `animal_register`(`animal_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `batch_daily_data`
  DROP INDEX `uq_batch_daily_data_line_date`,
  ADD CONSTRAINT `uq_batch_daily_data_line_date` UNIQUE(`line_id`,`entry_date`,(coalesce(`animal_id`, '')));
