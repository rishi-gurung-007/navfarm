-- 21 Oct 2026: the run's unique key now carries the batch (profile id | period | batch id): 36 + 1 + 12 + 1 + 36 = 86, beyond the 80 the
-- column held, so a run for one batch failed to insert ("Data too long for column active_key"). Widened; nothing else changes.
ALTER TABLE `bio_costing_run` MODIFY `active_key` varchar(120);
