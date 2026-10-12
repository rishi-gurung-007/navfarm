ALTER TABLE `feed_consolidation_line` ADD `destination_silo_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `feed_consolidation_line` ADD `requested_delivery_date` date;
--> statement-breakpoint
ALTER TABLE `feed_consolidation_line` ADD `production_date` date;
--> statement-breakpoint
ALTER TABLE `feed_consolidation_line` ADD CONSTRAINT `feed_consolidation_line_silo_fk` FOREIGN KEY (`destination_silo_id`) REFERENCES `location_master`(`location_id`) ON DELETE RESTRICT;
