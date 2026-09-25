-- silo_shed_link (0114) now carries every silo -> shed relation and nothing
-- reads feed_silo_id any more (spec D7). The link rows were copied across in
-- 0114, so this drops the column on a database that already has them; run the
-- two in order and no relation is lost.
ALTER TABLE `location_master` DROP FOREIGN KEY `location_master_feed_silo_id_fk`;
--> statement-breakpoint
DROP INDEX `idx_location_master_feed_silo_id` ON `location_master`;
--> statement-breakpoint
ALTER TABLE `location_master` DROP COLUMN `feed_silo_id`;
