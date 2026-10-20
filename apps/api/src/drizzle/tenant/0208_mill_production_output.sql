-- 20 Oct 2026 (Rishi): Mill Production Output — feed the mill produced into a loading BIN (spec 2026-10-03 §4.2 step 1).
-- Additive: a new table, nothing existing is touched.
CREATE TABLE `mill_production_output` (
  `output_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `output_no` varchar(30) NOT NULL,
  `production_date` date NOT NULL,
  `mill_location_id` varchar(36) NOT NULL,
  `bin_location_id` varchar(36) NOT NULL,
  `assignment_id` varchar(36),
  `item_id` varchar(36) NOT NULL,
  `quantity_kg` decimal(18,4) NOT NULL,
  `rate` decimal(18,6) NOT NULL,
  `amount` decimal(18,4) NOT NULL,
  `lot_no` varchar(80),
  `remarks` varchar(500),
  `ledger_id` varchar(36),
  `journal_id` varchar(36),
  `status` varchar(20) NOT NULL DEFAULT 'POSTED',
  `created_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `mill_production_output_output_id` PRIMARY KEY(`output_id`),
  CONSTRAINT `uq_mill_output_company_no` UNIQUE(`company_id`,`output_no`)
);
--> statement-breakpoint
CREATE INDEX `idx_mill_output_bin_date` ON `mill_production_output` (`bin_location_id`,`production_date`);
--> statement-breakpoint
ALTER TABLE `mill_production_output` ADD CONSTRAINT `fk_mill_output_company` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `mill_production_output` ADD CONSTRAINT `fk_mill_output_mill` FOREIGN KEY (`mill_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `mill_production_output` ADD CONSTRAINT `fk_mill_output_bin` FOREIGN KEY (`bin_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `mill_production_output` ADD CONSTRAINT `fk_mill_output_assignment` FOREIGN KEY (`assignment_id`) REFERENCES `bin_diet_assignment`(`assignment_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `mill_production_output` ADD CONSTRAINT `fk_mill_output_item` FOREIGN KEY (`item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict ON UPDATE no action;
