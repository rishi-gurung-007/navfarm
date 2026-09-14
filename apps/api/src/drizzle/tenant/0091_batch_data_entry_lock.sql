CREATE TABLE `batch_data_entry_lock` (
	`lock_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`batch_id` varchar(36) NOT NULL,
	`stage_id` varchar(36) NOT NULL,
	`entry_date` date NOT NULL,
	`status` varchar(10) NOT NULL,
	`locked_by` varchar(36),
	`locked_at` timestamp,
	`reopened_by` varchar(36),
	`reopened_at` timestamp,
	`reopen_reason` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `batch_data_entry_lock_lock_id` PRIMARY KEY(`lock_id`),
	CONSTRAINT `uq_batch_data_entry_lock_batch_stage_date` UNIQUE(`batch_id`,`stage_id`,`entry_date`)
);
--> statement-breakpoint
ALTER TABLE `batch_data_entry_lock` ADD CONSTRAINT `batch_data_entry_lock_batch_id_batch_header_batch_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `batch_header`(`batch_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `batch_data_entry_lock` ADD CONSTRAINT `batch_data_entry_lock_stage_id_stage_master_stage_id_fk` FOREIGN KEY (`stage_id`) REFERENCES `stage_master`(`stage_id`) ON DELETE restrict ON UPDATE no action;
