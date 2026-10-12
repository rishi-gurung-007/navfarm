-- Tasks 8 & 9: Common requisition header and line extensions, department identity FKs, and legacy status projection backfill
ALTER TABLE `user_master` ADD `department_id` varchar(36);--> statement-breakpoint
ALTER TABLE `user_master` ADD CONSTRAINT `user_master_department_id_cost_center_master_cost_center_id_fk` FOREIGN KEY (`department_id`) REFERENCES `cost_center_master`(`cost_center_id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `location_master` ADD `department_id` varchar(36);--> statement-breakpoint
ALTER TABLE `location_master` ADD CONSTRAINT `location_master_dept_id_cost_center_fk` FOREIGN KEY (`department_id`) REFERENCES `cost_center_master`(`cost_center_id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `requisition` ADD `requisition_date` date;--> statement-breakpoint
ALTER TABLE `requisition` ADD `main_location_id` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition` ADD `requester_user_id` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition` ADD `requester_name` varchar(200);--> statement-breakpoint
ALTER TABLE `requisition` ADD `requester_department_id` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition` ADD `sender_department_id` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition` ADD `approval_status` varchar(30);--> statement-breakpoint
ALTER TABLE `requisition` ADD `document_status` varchar(30);--> statement-breakpoint
ALTER TABLE `requisition` ADD `fulfilment_status` varchar(40);--> statement-breakpoint
ALTER TABLE `requisition` ADD `integration_status` varchar(40);--> statement-breakpoint
ALTER TABLE `requisition` ADD `from_location_id` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition` ADD `to_location_id` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition` ADD `direct_transfer` boolean;--> statement-breakpoint
ALTER TABLE `requisition` ADD `released_by` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition` ADD `released_at` timestamp;--> statement-breakpoint
ALTER TABLE `requisition` ADD `feed_forecast_run_id` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition` ADD CONSTRAINT `requisition_main_location_id_location_master_location_id_fk` FOREIGN KEY (`main_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `requisition` ADD CONSTRAINT `requisition_requester_user_id_user_master_user_id_fk` FOREIGN KEY (`requester_user_id`) REFERENCES `user_master`(`user_id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `requisition` ADD CONSTRAINT `requisition_requester_dept_cost_center_fk` FOREIGN KEY (`requester_department_id`) REFERENCES `cost_center_master`(`cost_center_id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `requisition` ADD CONSTRAINT `requisition_sender_dept_cost_center_fk` FOREIGN KEY (`sender_department_id`) REFERENCES `cost_center_master`(`cost_center_id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `requisition` ADD CONSTRAINT `requisition_from_location_id_location_master_location_id_fk` FOREIGN KEY (`from_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `requisition` ADD CONSTRAINT `requisition_to_location_id_location_master_location_id_fk` FOREIGN KEY (`to_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `requisition` ADD CONSTRAINT `requisition_feed_forecast_run_id_feed_forecast_run_run_id_fk` FOREIGN KEY (`feed_forecast_run_id`) REFERENCES `feed_forecast_run`(`run_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `feed_forecast_run_line_ids` json;--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `from_location_id` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `to_location_id` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `qty_to_ship` decimal(18,4);--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `qty_shipped` decimal(18,4);--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `qty_to_receive` decimal(18,4);--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `qty_received` decimal(18,4);--> statement-breakpoint
ALTER TABLE `requisition_line` ADD CONSTRAINT `requisition_line_from_loc_fk` FOREIGN KEY (`from_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `requisition_line` ADD CONSTRAINT `requisition_line_to_location_id_location_master_location_id_fk` FOREIGN KEY (`to_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null;--> statement-breakpoint
UPDATE `requisition` SET
  `approval_status` = CASE
    WHEN `status` = 'PENDING_APPROVAL' THEN 'PENDING_APPROVAL'
    WHEN `status` = 'APPROVED' THEN 'APPROVED'
    WHEN `status` = 'REJECTED' THEN 'REJECTED'
    ELSE 'OPEN'
  END,
  `document_status` = CASE
    WHEN `status` = 'APPROVED' THEN 'APPROVED'
    WHEN `status` = 'CANCELLED' THEN 'CANCELLED'
    ELSE 'OPEN'
  END,
  `fulfilment_status` = 'NOT_APPLICABLE',
  `integration_status` = 'NOT_APPLICABLE'
WHERE `approval_status` IS NULL;
