-- 14 Oct (Rishi): a GRN of a biological asset is a positive (+) entry in the Bio Asset Ledger — the animals it brought
-- in — and each animal registered from it is taken from that entry, as an issue is applied to a receipt in the
-- Inventory Ledger: the GRN entry keeps a Remaining Quantity, and the animal's registration (+1) names the entry it
-- came from. Still no inventory ledger entry and no journal for a biological asset.
ALTER TABLE `bio_asset_ledger` ADD `remaining_quantity` decimal(18,4);--> statement-breakpoint
ALTER TABLE `bio_asset_ledger` ADD `document_line_id` varchar(36);--> statement-breakpoint
ALTER TABLE `bio_asset_ledger` ADD `source_entry_id` varchar(36);--> statement-breakpoint
CREATE INDEX `bio_asset_ledger_document_line_id_idx` ON `bio_asset_ledger` (`document_line_id`);--> statement-breakpoint
CREATE INDEX `bio_asset_ledger_source_entry_id_idx` ON `bio_asset_ledger` (`source_entry_id`);--> statement-breakpoint
-- Every posted GRN line of a biological asset gets its entry. Its remaining is what it received less the animals
-- already registered from the GRN, taken line by line in line order (a GRN can carry the item on several lines).
INSERT INTO `bio_asset_ledger` (
  `entry_id`, `tenant_id`, `company_id`, `bio_asset_item_id`, `entry_type`, `document_type`, `document_no`,
  `document_line_id`, `posting_date`, `lot_no`, `warehouse_id`, `uom`, `status`, `quantity`, `remaining_quantity`,
  `cost_amount`, `cost_amount_each_unit`, `costing_method`, `nob_id`, `lob_id`, `created_by`, `created_at`
)
SELECT UUID(), x.`tenant_id`, x.`company_id`, x.`item_id`, 'PURCHASE', 'GOODS_RECEIPT', x.`receipt_no`,
  x.`line_id`, x.`posting_date`, x.`lot_no`, x.`warehouse_id`, x.`uom`, 'ACTIVE', x.`quantity`,
  LEAST(x.`quantity`, GREATEST(0, x.`cum` - x.`registered`)),
  x.`quantity` * COALESCE(x.`rate`, 0), x.`rate`, 'COST_ACCUMULATION', x.`nob_id`, x.`lob_id`, x.`posted_by`,
  COALESCE(x.`posted_at`, x.`created_at`)
FROM (
  SELECT g.`tenant_id`, g.`company_id`, g.`receipt_no`, g.`posting_date`, g.`warehouse_id`, g.`posted_by`, g.`posted_at`, g.`created_at`,
    gl.`line_id`, gl.`item_id`, gl.`lot_no`, gl.`uom`, gl.`quantity`, gl.`rate`, i.`nob_id`, i.`lob_id`,
    SUM(gl.`quantity`) OVER (PARTITION BY gl.`receipt_id`, gl.`item_id` ORDER BY gl.`line_no`) AS `cum`,
    (SELECT COUNT(*) FROM `animal_register` a WHERE a.`source_receipt_id` = g.`receipt_id` AND a.`item_id` = gl.`item_id`) AS `registered`
  FROM `goods_receipt` g
  JOIN `goods_receipt_line` gl ON gl.`receipt_id` = g.`receipt_id`
  JOIN `item_master` i ON i.`item_id` = gl.`item_id` AND i.`is_biological_asset` = 1
  WHERE g.`status` = 'POSTED' AND g.`deleted_at` IS NULL
) x
WHERE NOT EXISTS (SELECT 1 FROM `bio_asset_ledger` e WHERE e.`document_line_id` = x.`line_id` AND e.`entry_type` = 'PURCHASE');--> statement-breakpoint
-- An animal already registered from a GRN names the entry of that GRN's first line of its item.
UPDATE `bio_asset_ledger` b
JOIN `animal_register` a ON a.`animal_id` = b.`animal_id`
JOIN `goods_receipt_line` gl ON gl.`receipt_id` = a.`source_receipt_id` AND gl.`item_id` = a.`item_id`
  AND gl.`line_no` = (SELECT MIN(l2.`line_no`) FROM `goods_receipt_line` l2 WHERE l2.`receipt_id` = a.`source_receipt_id` AND l2.`item_id` = a.`item_id`)
JOIN `bio_asset_ledger` p ON p.`document_line_id` = gl.`line_id` AND p.`entry_type` = 'PURCHASE'
SET b.`source_entry_id` = p.`entry_id`
WHERE b.`entry_type` = 'ACQUISITION' AND b.`source_entry_id` IS NULL;
