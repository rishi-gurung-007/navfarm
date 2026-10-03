-- Task 9 (B1, B2): the batch/house breakdown under each feed requisition order line (Engine Step 9; MOM Feed and Logistic 21 Aug 2026 "Per Batch, Per House, and Per Silo"), and Days Remaining to one decimal (Silo Balance row 9). Additive.
CREATE TABLE `requisition_line_batch` (
	`line_batch_id` varchar(36) NOT NULL,
	`line_id` varchar(36) NOT NULL,
	`batch_id` varchar(36) NOT NULL,
	`shed_id` varchar(36),
	`heads` int,
	`feed_rate_kg` decimal(18,6),
	`lifecycle_ref_id` varchar(36),
	`demand_kg` decimal(18,4) NOT NULL,
	`first_demand_date` date,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `requisition_line_batch_line_batch_id` PRIMARY KEY(`line_batch_id`),
	CONSTRAINT `uq_requisition_line_batch` UNIQUE(`line_id`,`batch_id`,`shed_id`)
);--> statement-breakpoint
ALTER TABLE `requisition_line_batch` ADD CONSTRAINT `requisition_line_batch_line_id_fk` FOREIGN KEY (`line_id`) REFERENCES `requisition_line`(`line_id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `requisition_line_batch` ADD CONSTRAINT `requisition_line_batch_batch_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `batch_header`(`batch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `requisition_line_batch` ADD CONSTRAINT `requisition_line_batch_shed_id_fk` FOREIGN KEY (`shed_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `requisition_line` MODIFY COLUMN `days_remaining` decimal(6,1);
