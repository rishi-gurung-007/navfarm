-- 23 Oct 2026 (Inventory Ledger vocabulary): a bio-asset batch's feed and output are no longer their own transaction types. BIO_CONSUMPTION_PREMATURE
-- and BIO_CONSUMPTION_MATURE become CONSUMPTION, and BIO_OUTPUT and BIO_HARVEST become OUTPUT. What those names carried - which G/L Mapping rule
-- the row posts under (premature feed capitalises into the asset, mature feed is expensed) - moves to gl_mapping_type, so posting and reversing
-- behave as before. Additive: one column, then existing rows are moved onto the new shape.
ALTER TABLE `inventory_ledger` ADD COLUMN `gl_mapping_type` varchar(30);
--> statement-breakpoint
UPDATE `inventory_ledger`
SET `gl_mapping_type` = `transaction_type`,
    `transaction_type` = CASE WHEN `transaction_type` LIKE 'BIO\_CONSUMPTION\_%' THEN 'CONSUMPTION' ELSE 'OUTPUT' END
WHERE `transaction_type` IN ('BIO_CONSUMPTION_PREMATURE', 'BIO_CONSUMPTION_MATURE', 'BIO_OUTPUT', 'BIO_HARVEST');
