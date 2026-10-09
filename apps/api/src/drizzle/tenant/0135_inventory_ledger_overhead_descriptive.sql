-- Transaction Ledger Structure (Row 11): Support OVERHEAD and DESCRIPTIVE entry types
-- in inventory_ledger which do not represent physical stock items.
ALTER TABLE `inventory_ledger` MODIFY `item_id` varchar(36) NULL;
