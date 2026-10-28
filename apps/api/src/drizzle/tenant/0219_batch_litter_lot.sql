-- 25 Oct 2026: a litter is not a production batch. The piglet lot made at farrowing (the holder of the litter's head count and cost until the weaning)
-- is marked `is_litter_lot`, so batch lists and pickers leave it out and the screens show it as "Litter of <sow>". It is still a row in batch_header
-- (its head, cost and ledger rows are untouched); new lots are numbered from a LITTER_LOT series (LIT-000001), not the BATCH series.
-- Additive: one column, and every lot a farrowing already made is marked (keeping the number it has).
ALTER TABLE `batch_header` ADD `is_litter_lot` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE `batch_header` b
JOIN `farrowing_record` f ON f.`piglet_batch_id` = b.`batch_id`
SET b.`is_litter_lot` = true;
