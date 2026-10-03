-- 0137 created feed_stock_count without the workflow columns the service writes and with NOT NULL summary columns it never fills; reconcile additively.
ALTER TABLE `feed_stock_count` ADD `submitted_by` varchar(36);--> statement-breakpoint
ALTER TABLE `feed_stock_count` ADD `submitted_at` timestamp;--> statement-breakpoint
ALTER TABLE `feed_stock_count` ADD `approved_by` varchar(36);--> statement-breakpoint
ALTER TABLE `feed_stock_count` ADD `approved_at` timestamp;--> statement-breakpoint
ALTER TABLE `feed_stock_count` ADD `posted_by` varchar(36);--> statement-breakpoint
ALTER TABLE `feed_stock_count` ADD `posted_at` timestamp;--> statement-breakpoint
ALTER TABLE `feed_stock_count` MODIFY COLUMN `total_silos` int;--> statement-breakpoint
ALTER TABLE `feed_stock_count` MODIFY COLUMN `max_variance_pct` decimal(12,6);--> statement-breakpoint
ALTER TABLE `feed_stock_count` MODIFY COLUMN `total_variance_kg` decimal(18,4);
