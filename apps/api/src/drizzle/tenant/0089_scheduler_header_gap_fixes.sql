ALTER TABLE `scheduler_line` RENAME COLUMN `parameter_name` TO `activity_name`;
--> statement-breakpoint
ALTER TABLE `scheduler_line` ADD `item_description` varchar(200);
--> statement-breakpoint
ALTER TABLE `notification_alert_log` RENAME COLUMN `parameter_name` TO `activity_name`;
--> statement-breakpoint
ALTER TABLE `scheduler_header` ADD CONSTRAINT `scheduler_header_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_header` ADD CONSTRAINT `scheduler_header_location_id_location_master_location_id_fk` FOREIGN KEY (`location_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_line` ADD CONSTRAINT `scheduler_line_stage_id_stage_master_stage_id_fk` FOREIGN KEY (`stage_id`) REFERENCES `stage_master`(`stage_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `scheduler_line` ADD CONSTRAINT `uq_scheduler_line_scheduler_seq` UNIQUE(`scheduler_id`,`line_seq`);
