-- System schedulers: a stage's standard activities with no batch, which a batch's scheduler copies when the user
-- accepts one at batch creation or stage transfer. Separate tables, not batch-less scheduler_header rows, because
-- every reader of scheduler_header/scheduler_line takes a row there as a real batch's plan. One per company + LOB +
-- stage code + breed — the code, because a stage exists as both the tenant template row and the company's copy and
-- batches point at either. breed_key is '*' for "every breed" (breed_id NULL): MySQL lets NULLs repeat in a unique index.
-- Purely additive: nothing existing is changed except one nullable column on scheduler_header.
CREATE TABLE IF NOT EXISTS `system_scheduler` (
  `system_scheduler_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `lob_id` varchar(36) NOT NULL,
  `nob_id` varchar(36) DEFAULT NULL,
  `stage_id` varchar(36) NOT NULL,
  `stage_code` varchar(50) NOT NULL,
  `breed_id` varchar(36) DEFAULT NULL,
  `breed_key` varchar(36) NOT NULL DEFAULT '*',
  `scheduler_name` varchar(150) NOT NULL,
  `data_entry_level` varchar(10) NOT NULL DEFAULT 'SHED',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `notes` text,
  `created_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`system_scheduler_id`),
  UNIQUE KEY `uq_system_scheduler_company_stage_breed` (`company_id`, `lob_id`, `stage_code`, `breed_key`),
  CONSTRAINT `system_scheduler_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master` (`company_id`) ON DELETE RESTRICT,
  CONSTRAINT `system_scheduler_lob_fk` FOREIGN KEY (`lob_id`) REFERENCES `lob_master` (`lob_id`) ON DELETE RESTRICT,
  CONSTRAINT `system_scheduler_nob_fk` FOREIGN KEY (`nob_id`) REFERENCES `nob_master` (`nob_id`) ON DELETE RESTRICT,
  CONSTRAINT `system_scheduler_stage_fk` FOREIGN KEY (`stage_id`) REFERENCES `stage_master` (`stage_id`) ON DELETE RESTRICT,
  CONSTRAINT `system_scheduler_breed_fk` FOREIGN KEY (`breed_id`) REFERENCES `breed_master` (`breed_id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `system_scheduler_line` (
  `line_id` varchar(36) NOT NULL,
  `system_scheduler_id` varchar(36) NOT NULL,
  `line_seq` int NOT NULL,
  `line_type` varchar(20) NOT NULL,
  `activity_name` varchar(200) NOT NULL,
  `occurrence` varchar(10) NOT NULL DEFAULT 'DAILY',
  `start_day` int NOT NULL DEFAULT 1,
  `end_day` int DEFAULT NULL,
  `day_of_week` int DEFAULT NULL,
  `is_mandatory` tinyint(1) NOT NULL DEFAULT 0,
  `item_id` varchar(36) DEFAULT NULL,
  `item_description` varchar(200) DEFAULT NULL,
  `standard_qty` decimal(18,6) DEFAULT NULL,
  `qty_basis` varchar(20) DEFAULT NULL,
  `allow_qty_edit` tinyint(1) NOT NULL DEFAULT 1,
  `lot_required` tinyint(1) NOT NULL DEFAULT 0,
  `creates_inventory` tinyint(1) NOT NULL DEFAULT 0,
  `output_lot_auto` tinyint(1) NOT NULL DEFAULT 1,
  `output_basis` varchar(20) DEFAULT NULL,
  `auto_triggers_stage` tinyint(1) NOT NULL DEFAULT 0,
  `kpi_metric` varchar(50) DEFAULT NULL,
  `kpi_uom` varchar(20) DEFAULT NULL,
  `std_value` decimal(18,4) DEFAULT NULL,
  `lower_alert_limit` decimal(18,4) DEFAULT NULL,
  `upper_alert_limit` decimal(18,4) DEFAULT NULL,
  `alert_severity` varchar(10) DEFAULT 'WARNING',
  `capture_per` varchar(20) DEFAULT NULL,
  `overhead_category` varchar(30) DEFAULT NULL,
  `gl_account` varchar(20) DEFAULT NULL,
  `estimated_cost` decimal(18,4) DEFAULT NULL,
  `resource_id` varchar(36) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`line_id`),
  UNIQUE KEY `uq_system_scheduler_line_seq` (`system_scheduler_id`, `line_seq`),
  CONSTRAINT `system_scheduler_line_header_fk` FOREIGN KEY (`system_scheduler_id`) REFERENCES `system_scheduler` (`system_scheduler_id`) ON DELETE CASCADE,
  CONSTRAINT `system_scheduler_line_item_fk` FOREIGN KEY (`item_id`) REFERENCES `item_master` (`item_id`) ON DELETE RESTRICT,
  CONSTRAINT `system_scheduler_line_resource_fk` FOREIGN KEY (`resource_id`) REFERENCES `resource_master` (`resource_id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `system_scheduler_line_custom_days` (
  `custom_day_id` varchar(36) NOT NULL,
  `line_id` varchar(36) NOT NULL,
  `day_number` int NOT NULL,
  PRIMARY KEY (`custom_day_id`),
  UNIQUE KEY `uq_system_scheduler_line_custom_days_line_day` (`line_id`, `day_number`),
  CONSTRAINT `system_scheduler_line_custom_days_line_fk` FOREIGN KEY (`line_id`) REFERENCES `system_scheduler_line` (`line_id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `scheduler_header` ADD COLUMN `system_scheduler_id` varchar(36) DEFAULT NULL AFTER `auto_generated`;
