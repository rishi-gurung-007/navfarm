-- 14 Oct (Rishi): biological assets (item_master.is_biological_asset) are not stock. A GRN of a biological asset posts
-- no inventory ledger entry and no journal; the animals it brought in are counted by the Bio Asset Ledger, which an
-- animal's registration writes (+1) and its death writes (-1). The Bio Asset Ledger gets an entry number, a document
-- type, a location and a UOM, so it reads like the Inventory Ledger.
ALTER TABLE `bio_asset_ledger` ADD `entry_no` int NULL;--> statement-breakpoint
UPDATE `bio_asset_ledger` b
JOIN (SELECT `entry_id`, ROW_NUMBER() OVER (ORDER BY `created_at`, `entry_id`) AS `rn` FROM `bio_asset_ledger`) x ON x.`entry_id` = b.`entry_id`
SET b.`entry_no` = x.`rn`;--> statement-breakpoint
ALTER TABLE `bio_asset_ledger` MODIFY `entry_no` int NOT NULL AUTO_INCREMENT, ADD CONSTRAINT `bio_asset_ledger_entry_no_unique` UNIQUE(`entry_no`);--> statement-breakpoint
ALTER TABLE `bio_asset_ledger` ADD `document_type` varchar(30);--> statement-breakpoint
ALTER TABLE `bio_asset_ledger` ADD `warehouse_id` varchar(36);--> statement-breakpoint
ALTER TABLE `bio_asset_ledger` ADD `uom` varchar(20);--> statement-breakpoint
-- An animal's acquisition is its registration; its death is its mortality. Both are one head of the animal's item.
UPDATE `bio_asset_ledger` b JOIN `item_master` i ON i.`item_id` = b.`bio_asset_item_id`
SET b.`document_type` = 'ANIMAL_REGISTRATION', b.`uom` = i.`uom_primary`
WHERE b.`entry_type` = 'ACQUISITION' AND b.`animal_id` IS NOT NULL;--> statement-breakpoint
UPDATE `bio_asset_ledger` b JOIN `item_master` i ON i.`item_id` = b.`bio_asset_item_id`
SET b.`document_type` = 'MORTALITY', b.`uom` = i.`uom_primary`
WHERE b.`entry_type` = 'MORTALITY';--> statement-breakpoint
-- Option A (Rishi, 14 Oct): what biological assets left in the inventory ledger is taken out — their GRN receipts,
-- the ANIMAL_REGISTRATION issues that drew on them (a71f7b88) and the journals both posted. Only for an item whose
-- inventory entries are nothing but those two kinds; an item that moved any other way is left as it is.
CREATE TABLE `tmp_bio_inventory_move` (`ledger_id` varchar(36) NOT NULL PRIMARY KEY);--> statement-breakpoint
INSERT INTO `tmp_bio_inventory_move` (`ledger_id`)
SELECT l.`ledger_id`
FROM `inventory_ledger` l
JOIN `item_master` i ON i.`item_id` = l.`item_id` AND i.`is_biological_asset` = 1
WHERE ((l.`document_type` = 'GOODS_RECEIPT' AND l.`entry_type` = 'POSITIVE') OR l.`transaction_type` = 'ANIMAL_REGISTRATION')
  AND NOT EXISTS (
    SELECT 1 FROM `inventory_ledger` o
    WHERE o.`item_id` = l.`item_id`
      AND NOT ((o.`document_type` = 'GOODS_RECEIPT' AND o.`entry_type` = 'POSITIVE') OR o.`transaction_type` = 'ANIMAL_REGISTRATION')
  );--> statement-breakpoint
DELETE jl FROM `journal_line` jl JOIN `journal_header` h ON h.`journal_id` = jl.`journal_id`
WHERE h.`source_ledger_id` IN (SELECT `ledger_id` FROM `tmp_bio_inventory_move`);--> statement-breakpoint
DELETE FROM `journal_header` WHERE `source_ledger_id` IN (SELECT `ledger_id` FROM `tmp_bio_inventory_move`);--> statement-breakpoint
DELETE FROM `inventory_application`
WHERE `inbound_ledger_id` IN (SELECT `ledger_id` FROM `tmp_bio_inventory_move`)
   OR `outbound_ledger_id` IN (SELECT `ledger_id` FROM `tmp_bio_inventory_move`);--> statement-breakpoint
DELETE FROM `inventory_ledger_line` WHERE `ledger_id` IN (SELECT `ledger_id` FROM `tmp_bio_inventory_move`);--> statement-breakpoint
DELETE FROM `inventory_ledger` WHERE `ledger_id` IN (SELECT `ledger_id` FROM `tmp_bio_inventory_move`);--> statement-breakpoint
DROP TABLE `tmp_bio_inventory_move`;--> statement-breakpoint
-- No GL for biological assets for now (Rishi, 14 Oct): the mapping 0198 added has nothing left to post.
DELETE FROM `gl_mapping_master` WHERE `transaction_type` = 'ANIMAL_REGISTRATION';
