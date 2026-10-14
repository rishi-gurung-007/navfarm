-- 14 Oct (Rishi): a Feed Consumption line's daily feed per head is entered with its own UOM (a weight UOM). The
-- amount and UOM are kept as entered; feed_qty_per_head_per_day_kg stays the same amount in kg, which the scheduler,
-- forecast and requisition read as before. NULL UOM = an existing row, entered in kg. Additive.
ALTER TABLE `breed_lifecycle_stages` ADD `feed_qty_per_head_per_day` decimal(12,4);--> statement-breakpoint
ALTER TABLE `breed_lifecycle_stages` ADD `feed_qty_uom` varchar(20);
