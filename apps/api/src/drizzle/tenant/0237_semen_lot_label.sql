-- 2 Nov 2026 (AI Station, plan 2026-11-02-ai-station-semen-collection, Phase 5): what a breeding line's setup puts on a semen lot when it is posted. Its line,
-- the label printed on the sachets (the line's template filled in with the boar tag, the ISO week and so on), the colorant added to it (and its cost, when it is
-- issued from stock) and the farm the lot is for. The destination is what the restriction on using or moving a lot is read against. Additive: nullable columns on
-- semen_batch and one index; nothing is updated, so every lot recorded before this reads as having no label, colorant or destination.
ALTER TABLE `semen_batch` ADD `breed_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD `label` varchar(100);
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD `week_no` int;
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD `week_year` int;
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD `colorant_name` varchar(50);
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD `colorant_item_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD `colorant_qty` decimal(10,3);
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD `colorant_cost` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD `destination_farm_id` varchar(36);
--> statement-breakpoint
CREATE INDEX `idx_semen_batch_line_week` ON `semen_batch` (`breed_id`,`week_year`,`week_no`);
