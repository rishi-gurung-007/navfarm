-- Monthly Stock Take and Period Close (Brief C; workbook "Silo Balance and Stock
-- Take" s3 r30-49, "Checkpoints and Validations" r31/r32/r40). The weekly
-- Physical Stock Count is extended rather than duplicated: count_type tells a
-- WEEKLY count from a MONTHLY stock take, stock_take_type is FARM / FEED_MILL,
-- and a monthly take names its Reporting Period. One monthly take per location
-- per period (r31); weekly rows keep a NULL period, which the unique key allows.
-- The Reporting Period gets its own close state, separate from the master-data
-- lifecycle `status` (DRAFT/ACTIVE/INACTIVE). Additive only.
ALTER TABLE `feed_stock_count` ADD `count_type` varchar(10) DEFAULT 'WEEKLY' NOT NULL;
--> statement-breakpoint
ALTER TABLE `feed_stock_count` ADD `stock_take_type` varchar(20);
--> statement-breakpoint
ALTER TABLE `feed_stock_count` ADD `reporting_period_id` varchar(36);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_feed_stock_count_period_location` ON `feed_stock_count` (`farm_id`,`reporting_period_id`);
--> statement-breakpoint
ALTER TABLE `reporting_period` ADD `period_status` varchar(10) DEFAULT 'OPEN' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reporting_period` ADD `closed_by` varchar(36);
--> statement-breakpoint
ALTER TABLE `reporting_period` ADD `closed_at` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `reporting_period` ADD `reopened_by` varchar(36);
--> statement-breakpoint
ALTER TABLE `reporting_period` ADD `reopened_at` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `reporting_period` ADD `reopen_reason` varchar(500);
