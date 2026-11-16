-- 23 Oct 2026 (Inventory Ledger vocabulary): REVERSAL is no longer a transaction type. A reversal is the offsetting row of the entry it
-- reverses, so it keeps that entry's transaction type; reversal_of_ledger_id (the ledger_id it reverses) is what marks it. Additive: one
-- column and one index, then existing REVERSAL rows are moved onto the new shape. A REVERSAL row whose original no longer exists keeps its
-- type (nothing to copy it from) but is still marked.
ALTER TABLE `inventory_ledger` ADD COLUMN `reversal_of_ledger_id` varchar(36);
--> statement-breakpoint
CREATE INDEX `idx_inventory_ledger_reversal_of` ON `inventory_ledger` (`reversal_of_ledger_id`);
--> statement-breakpoint
UPDATE `inventory_ledger` SET `reversal_of_ledger_id` = `external_reference_no` WHERE `transaction_type` = 'REVERSAL' AND `external_reference_no` IS NOT NULL;
--> statement-breakpoint
UPDATE `inventory_ledger` r
JOIN `inventory_ledger` o ON o.`ledger_id` = r.`reversal_of_ledger_id`
SET r.`transaction_type` = o.`transaction_type`
WHERE r.`transaction_type` = 'REVERSAL';
