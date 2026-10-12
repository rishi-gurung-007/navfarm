-- Master Setup r30/r39: farm-level override of the lifecycle feed item and rate.
-- NULL farm_id = the company or breed default row. Nullable and additive.
ALTER TABLE `breed_lifecycle_stages` ADD `farm_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `breed_lifecycle_stages` ADD CONSTRAINT `bls_farm_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE RESTRICT;
