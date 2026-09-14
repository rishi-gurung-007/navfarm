ALTER TABLE `user_master` ADD `farm_id` varchar(36);--> statement-breakpoint
ALTER TABLE `user_master` ADD CONSTRAINT `user_master_farm_id_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `batch_header` ADD `farm_id` varchar(36);--> statement-breakpoint
ALTER TABLE `batch_header` ADD CONSTRAINT `batch_header_farm_id_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_batch_header_farm` ON `batch_header` (`farm_id`);--> statement-breakpoint
UPDATE `batch_header` b
  JOIN `location_master` l ON l.`location_id` = COALESCE(b.`sub_location_id`, b.`location_id`, b.`shed_id`)
  SET b.`farm_id` = CASE WHEN l.`parent_location_id` IS NULL THEN l.`location_id` ELSE l.`farm_id` END
  WHERE b.`farm_id` IS NULL;
