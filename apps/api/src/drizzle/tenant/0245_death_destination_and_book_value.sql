-- 4 Nov 2026 (TDD row 10, Mortality): a death names where the body went, and the register records what the animal's book value stood at when she died.
-- Additive: two nullable columns. The destination is kept on the drafted death (batch_mortality_animal) until it is posted, then on the animal.
ALTER TABLE `batch_mortality_animal` ADD `disposal_destination` varchar(100);
--> statement-breakpoint
ALTER TABLE `animal_register` ADD `book_value_at_death` decimal(18,4);
--> statement-breakpoint
-- Deaths already posted: what her write-off took out of her bio-asset ledger is the book value at death.
UPDATE `animal_register` ar SET ar.`book_value_at_death` = (SELECT -SUM(b.`cost_amount`) FROM `bio_asset_ledger` b WHERE b.`animal_id` = ar.`animal_id` AND b.`document_type` = 'MORTALITY') WHERE ar.`disposal_type` = 'DIED' AND ar.`book_value_at_death` IS NULL;
