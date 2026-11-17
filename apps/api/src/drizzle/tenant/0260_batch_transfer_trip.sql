ALTER TABLE `batch_transfer` ADD `trip_id` varchar(36) NULL;
--> statement-breakpoint
CREATE INDEX `idx_batch_transfer_trip` ON `batch_transfer` (`tenant_id`,`trip_id`);
--> statement-breakpoint
ALTER TABLE `logistics_trip_line` ADD `batch_transfer_id` varchar(36) NULL;
--> statement-breakpoint
ALTER TABLE `logistics_trip_line` MODIFY COLUMN `transfer_id` varchar(36) NULL;
--> statement-breakpoint
CREATE INDEX `idx_logistics_trip_line_batch_transfer` ON `logistics_trip_line` (`tenant_id`,`batch_transfer_id`);
