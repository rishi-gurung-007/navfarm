ALTER TABLE `requisition_line` ADD `reason_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD CONSTRAINT `requisition_line_reason_id_reason_master_reason_id_fk` FOREIGN KEY (`reason_id`) REFERENCES `reason_master`(`reason_id`) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `idx_requisition_line_reason_id` ON `requisition_line` (`reason_id`);
