-- 20 Oct 2026 (bio-asset costing, Phase 5): a scheduled run that could not be made leaves a FAILED header with the reason, so the scheduler
-- can stop retrying a period that keeps failing and Finance can see why. Additive and nullable.
ALTER TABLE `bio_costing_run` ADD `error_message` varchar(500);
