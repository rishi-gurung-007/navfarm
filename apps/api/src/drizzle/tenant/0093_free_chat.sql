ALTER TABLE `location_master` ADD `storage_name` varchar(100);--> statement-breakpoint
ALTER TABLE `location_master` ADD `feed_in_bags` boolean;--> statement-breakpoint
ALTER TABLE `breed_master` DROP COLUMN `vaccination_schedule`;