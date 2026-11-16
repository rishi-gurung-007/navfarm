-- 28 Oct 2026 (item-level bio-asset costing, Phase 5; docs/superpowers/plans/2026-10-28-item-level-bio-costing.md): the costing profile is dropped.
-- Costing terms live on the biological Item (0228) and a run belongs to an item (0229); nothing reads the profile any more (Phase 4). This DROPS DATA: the
-- four tables and columns below, and with them the profile each old run and animal named. THE DATABASE MUST BE BACKED UP FIRST, and an existing database must
-- first have its terms moved onto its items: `pnpm nx run api:db-move-profiles-to-items -- --apply` (the move script reads these tables, so it cannot be run after this).
-- The first statements are a guard: they stop the migration, before anything is dropped, if a live animal is still costed only by a profile (its item has no
-- costing terms), or an old profile run is still waiting to be posted. The error names what to do: "Column 'run_db_move_profiles_to_items_first' cannot be null".
-- Old runs keep their ledger rows, journals and lines; they are named by the items of their animals from now on.
DROP TABLE IF EXISTS `_costing_profile_drop_guard`;
--> statement-breakpoint
CREATE TABLE `_costing_profile_drop_guard` (`run_db_move_profiles_to_items_first` int NOT NULL);
--> statement-breakpoint
INSERT INTO `_costing_profile_drop_guard` SELECT NULL FROM `animal_register` a JOIN `item_master` i ON i.`item_id` = a.`item_id` WHERE a.`costing_profile_id` IS NOT NULL AND a.`is_active` = 1 AND (i.`is_biological_asset` = 0 OR i.`bio_costing_method` IS NULL) LIMIT 1;
--> statement-breakpoint
INSERT INTO `_costing_profile_drop_guard` SELECT NULL FROM `bio_costing_run` WHERE `status` = 'CALCULATED' AND `item_id` IS NULL LIMIT 1;
--> statement-breakpoint
DROP TABLE `_costing_profile_drop_guard`;
--> statement-breakpoint
ALTER TABLE `animal_register` DROP FOREIGN KEY `fk_animal_costing_profile`;
--> statement-breakpoint
ALTER TABLE `animal_register` DROP INDEX `fk_animal_costing_profile`;
--> statement-breakpoint
ALTER TABLE `animal_register` DROP COLUMN `costing_profile_id`;
--> statement-breakpoint
ALTER TABLE `bio_costing_run` DROP FOREIGN KEY `fk_bcr_profile`;
--> statement-breakpoint
DROP INDEX `idx_bio_costing_run_profile` ON `bio_costing_run`;
--> statement-breakpoint
ALTER TABLE `bio_costing_run` DROP COLUMN `profile_id`;
--> statement-breakpoint
DROP TABLE `bio_costing_profile_rate`;
--> statement-breakpoint
DROP TABLE `bio_costing_profile`;
--> statement-breakpoint
DROP TABLE `bio_costing_residual_setting`;
