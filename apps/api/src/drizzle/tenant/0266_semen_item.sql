-- 24 Nov 2026 (plan 2026-11-24-semen-supply-chain-master-plan): which items are semen, and which one each breeding line uses. Before, any active
-- item could be picked for a collection, so two items ended up holding semen lots and a semen request could not tell a semen item from a
-- vaccine counted in doses. `item_master.is_semen` marks an item as semen (switched on on the item card); `breeding_line_setup.semen_item_id`
-- names the semen item the line's collections and requests use. Additive: no item is marked and no line is set by this migration.
ALTER TABLE `item_master` ADD `is_semen` boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` ADD `semen_item_id` varchar(36);
