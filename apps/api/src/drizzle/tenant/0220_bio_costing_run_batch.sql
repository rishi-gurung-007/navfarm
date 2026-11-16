-- 21 Oct 2026 (bio-asset costing): a run may be made for one batch's animals instead of every animal of a profile. NULL = the profile's
-- whole herd (what the scheduler makes). Additive and nullable; the run's unique active_key now carries the batch when there is one.
ALTER TABLE `bio_costing_run` ADD `batch_id` varchar(36);
--> statement-breakpoint
CREATE INDEX `idx_bio_costing_run_batch` ON `bio_costing_run` (`batch_id`, `period_end`);
