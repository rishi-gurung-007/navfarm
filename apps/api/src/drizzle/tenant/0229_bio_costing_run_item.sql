-- 28 Oct 2026 (item-level bio-asset costing, Phase 2; docs/superpowers/plans/2026-10-28-item-level-bio-costing.md): a costing run can belong to an item.
-- bio_costing_run gets item_id, and profile_id becomes optional (exactly one of the two is set; runs already made keep their profile_id untouched).
-- item_master gets bio_effective_from, the date costing should start for the item, which the scheduler never catches up before (a profile's effective_from).
-- Additive: two columns and an index; the only change to an existing column is that profile_id may now be empty.
ALTER TABLE `item_master` ADD `bio_effective_from` date;
--> statement-breakpoint
ALTER TABLE `bio_costing_run` ADD `item_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `bio_costing_run` MODIFY `profile_id` varchar(36) NULL;
--> statement-breakpoint
CREATE INDEX `idx_bio_costing_run_item` ON `bio_costing_run` (`item_id`,`period_end`);
--> statement-breakpoint
ALTER TABLE `bio_costing_run` ADD CONSTRAINT `bio_costing_run_item_id_item_master_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict ON UPDATE no action;
