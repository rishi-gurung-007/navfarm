-- 17 Nov 2026: Suppliers come from Business Central vendors.
-- MOM 18 Aug 2026 (Triple C Office): "Order, Vendor selection, GRV and PI will be processed in D365BC";
-- BBP-1 §1 lists Vendor among the masters synced from D365BC. The BC developer published the Vendor Card page
-- as the ODataV4 web service VendorCardApi with a "NavFarm Sync" flag; vendors with it ticked are pulled into
-- supplier_master by apps/api/src/modules/integration/business-central/vendor-sync.
--
-- Every new column is nullable or defaulted, so existing NAVFarm-created suppliers are untouched
-- (source_system defaults to NAVFARM). Nothing is backfilled.
ALTER TABLE `supplier_master` ADD COLUMN `source_system` varchar(10) NOT NULL DEFAULT 'NAVFARM';
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `bc_vendor_no` varchar(20);
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `bc_name_2` varchar(50);
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `registration_number` varchar(50);
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `currency_code` varchar(10);
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `gen_bus_posting_group` varchar(20);
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `vendor_posting_group` varchar(20);
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `bc_blocked` varchar(10);
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `bc_etag` varchar(100);
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `bc_last_modified_date` date;
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `bc_synced_at` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `bc_sync_error` varchar(250);
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD CONSTRAINT `uq_supplier_master_bc_vendor` UNIQUE(`tenant_id`,(coalesce(`company_id`, '')),`bc_vendor_no`);
--> statement-breakpoint
CREATE TABLE `integration_sync_log` (
	`log_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`external_system` varchar(10) NOT NULL DEFAULT 'BC',
	`entity` varchar(30) NOT NULL,
	`sync_trigger` varchar(12) NOT NULL,
	`status` varchar(12) NOT NULL DEFAULT 'RUNNING',
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`finished_at` timestamp NULL,
	`fetched_count` int NOT NULL DEFAULT 0,
	`created_count` int NOT NULL DEFAULT 0,
	`updated_count` int NOT NULL DEFAULT 0,
	`unchanged_count` int NOT NULL DEFAULT 0,
	`deactivated_count` int NOT NULL DEFAULT 0,
	`failed_count` int NOT NULL DEFAULT 0,
	`written_back_count` int NOT NULL DEFAULT 0,
	`error_message` varchar(1000),
	`details` json,
	`triggered_by` varchar(36),
	CONSTRAINT `integration_sync_log_log_id` PRIMARY KEY(`log_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_integration_sync_log_entity` ON `integration_sync_log` (`tenant_id`,`entity`,`started_at`);
