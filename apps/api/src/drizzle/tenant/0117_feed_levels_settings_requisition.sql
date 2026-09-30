-- Feed Forecast Plan B (spec D10). Master Setup §1: one low threshold per
-- silo ("Below Feed Level KG", row 10) and one high ("Above Threshold KG",
-- row 12), both kilograms, alongside silo_reorder_days — not replacing it.
-- Nullable: every existing silo has neither, and a silo without a level is
-- simply not checked for that alert (open question Q8).
ALTER TABLE `location_master` ADD `low_level_kg` decimal(12,2);
--> statement-breakpoint
ALTER TABLE `location_master` ADD `high_level_kg` decimal(12,2);
--> statement-breakpoint
-- Per-farm requisition settings, read only on FARM rows, with the workbook's
-- configured defaults: Requisition §1 row 28 (bulk multiple 3000 KG), row 27
-- (truck target 30000 KG, a planning target, not a cap), checkpoint 27 (bag
-- size 50 KG). The production weekday stands in for the "configurable
-- production calendar" of checkpoint 22 until one exists (Q4): 0 = Sunday,
-- so the submission deadline defaults to Saturday.
ALTER TABLE `location_master` ADD `feed_bulk_multiple_kg` int DEFAULT 3000;
--> statement-breakpoint
ALTER TABLE `location_master` ADD `feed_bag_size_kg` int DEFAULT 50;
--> statement-breakpoint
ALTER TABLE `location_master` ADD `feed_truck_target_kg` int DEFAULT 30000;
--> statement-breakpoint
ALTER TABLE `location_master` ADD `feed_production_weekday` int DEFAULT 0;
--> statement-breakpoint
-- Feed requisition (Requisition and Loading Sheet §1 header, §2 lines) on
-- the existing requisition tables (0098) rather than a second document: the
-- approval link, farm scope and number column are the same. doc_type 'FEED'
-- marks them. Header: Requisition Type (FEED_FORECAST | MANUAL, row 7),
-- Source (row 8), Requisition Purpose (INTERNAL_TRANSFER, row 31), Supplier
-- or Source (MILL, row 30), Priority (row 34), Submission Deadline (row 35),
-- Remarks (row 36), Approved By / Approval Date Time (rows 37–38), plus the
-- production date the deadline derives from and the forecast run that last
-- drafted it (Engine Step 9: "Preserve run ID").
ALTER TABLE `requisition` ADD `requisition_type` varchar(20);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `source` varchar(30);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `purpose` varchar(30);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `supply_source` varchar(20);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `priority` varchar(30);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `forecast_run_key` varchar(64);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `production_date` date;
--> statement-breakpoint
ALTER TABLE `requisition` ADD `submission_deadline` date;
--> statement-breakpoint
ALTER TABLE `requisition` ADD `remarks` text;
--> statement-breakpoint
ALTER TABLE `requisition` ADD `approved_by` varchar(36);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `approved_at` timestamp NULL;
--> statement-breakpoint
CREATE INDEX `idx_requisition_feed_cycle` ON `requisition` (`farm_id`, `doc_type`, `submission_deadline`);
--> statement-breakpoint
-- Lines (§2): destination silo or store, feed type, next-diet flag and days
-- before the change, the lifecycle row, and the draft-time snapshots (System
-- Balance, Daily Requirement, Days Remaining, first shortage, unrounded need,
-- Recommended Qty, Bag Count, Proposed Delivery Date). Requested Qty is the
-- existing `quantity` column, in KG. `quantity_edited` (ruling M9) marks a
-- line the farm hand-edited, so an auto-draft rerun (Task 8) knows to keep
-- it rather than overwrite it with a fresh calculation.
ALTER TABLE `requisition_line` ADD `destination_location_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD CONSTRAINT `requisition_line_destination_fk` FOREIGN KEY (`destination_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `source_type` varchar(10);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `feed_type` varchar(10);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `is_next_diet` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `days_before_diet_change` int;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `lifecycle_ref_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `system_balance_kg` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `daily_requirement_kg` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `days_remaining` int;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `first_shortage_date` date;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `unrounded_need_kg` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `recommended_qty_kg` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `bag_count` int;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `proposed_delivery_date` date;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `needs_silo_changeover` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `quantity_edited` boolean NOT NULL DEFAULT false;
