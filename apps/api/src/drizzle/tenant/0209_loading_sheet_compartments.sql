-- 21 Oct 2026 (Rishi): a loading sheet may contain several truck compartments.
-- Keep the existing sheet columns as compatibility totals; detailed loading facts live here.
CREATE TABLE `feed_loading_sheet_compartment` (
	`compartment_id` varchar(36) NOT NULL,
	`loading_sheet_id` varchar(36) NOT NULL,
	`line_no` int NOT NULL,
	`compartment_no` varchar(50) NOT NULL,
	`kg_loaded` decimal(14,4) NOT NULL,
	`loaded_by` varchar(36),
	`loaded_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feed_loading_sheet_compartment_id` PRIMARY KEY(`compartment_id`),
	CONSTRAINT `uq_feed_loading_sheet_compartment` UNIQUE(`loading_sheet_id`,`line_no`)
);
--> statement-breakpoint
ALTER TABLE `feed_loading_sheet_compartment` ADD CONSTRAINT `feed_loading_sheet_compartment_sheet_fk` FOREIGN KEY (`loading_sheet_id`) REFERENCES `feed_loading_sheet`(`loading_sheet_id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `idx_feed_loading_sheet_compartment_sheet` ON `feed_loading_sheet_compartment` (`loading_sheet_id`);
--> statement-breakpoint
-- Preserve existing single-compartment loading facts when upgrading an applied tenant.
INSERT INTO `feed_loading_sheet_compartment` (`compartment_id`, `loading_sheet_id`, `line_no`, `compartment_no`, `kg_loaded`, `loaded_by`, `loaded_at`)
SELECT UUID(), `loading_sheet_id`, 10000, `compartment_no`, `kg_loaded`, `loaded_by`, `loaded_at`
FROM `feed_loading_sheet`
WHERE `compartment_no` IS NOT NULL AND `kg_loaded` IS NOT NULL;
