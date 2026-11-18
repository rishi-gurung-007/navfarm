-- Kill Sheet imports (Rishi, 17 Nov 2026): private local files, preview then confirmed transactional records.
CREATE TABLE `kill_sheet_import` (`import_id` varchar(36) NOT NULL, `tenant_id` varchar(36) NOT NULL, `company_id` varchar(36) NOT NULL, `farm_id` varchar(36) NOT NULL, `batch_id` varchar(36) NOT NULL, `status` varchar(20) NOT NULL DEFAULT 'PREVIEW_READY', `reconciliation_status` varchar(20) NOT NULL DEFAULT 'INVALID', `report_reference` varchar(120), `report_batch_reference` varchar(120), `slaughter_from` datetime, `slaughter_to` datetime, `individual_file_name` varchar(255) NOT NULL, `individual_storage_key` varchar(500) NOT NULL, `individual_sha512` char(128) NOT NULL, `summary_file_name` varchar(255), `summary_storage_key` varchar(500), `summary_sha512` char(128), `expected_animal_count` int, `expected_warm_mass_kg` decimal(18,4), `expected_cold_mass_kg` decimal(18,4), `actual_animal_count` int, `actual_warm_mass_kg` decimal(18,4), `actual_cold_mass_kg` decimal(18,4), `reported_product_value` decimal(18,4), `validation_json` json, `metadata_json` json, `override_reason` varchar(500), `confirmed_at` timestamp NULL, `confirmed_by` varchar(36), `created_by` varchar(36), `created_at` timestamp NOT NULL DEFAULT (now()), `updated_at` timestamp NOT NULL DEFAULT (now()), CONSTRAINT `kill_sheet_import_import_id` PRIMARY KEY(`import_id`));
--> statement-breakpoint
CREATE TABLE `kill_sheet_carcass` (`carcass_id` varchar(36) NOT NULL, `import_id` varchar(36) NOT NULL, `serial_number` varchar(100) NOT NULL, `ear_tag` varchar(100), `grade` varchar(100), `warm_mass_kg` decimal(18,4) NOT NULL, `cold_mass_kg` decimal(18,4) NOT NULL, `sex` varchar(100), `fat_mm` decimal(18,4), `meat_mm` decimal(18,4), `meat_percentage` decimal(18,4), `sick_code` varchar(100), `slaughtered_at` datetime, CONSTRAINT `kill_sheet_carcass_carcass_id` PRIMARY KEY(`carcass_id`));
--> statement-breakpoint
CREATE TABLE `kill_sheet_product` (`product_id` varchar(36) NOT NULL, `import_id` varchar(36) NOT NULL, `category` varchar(150), `product_code` varchar(100) NOT NULL, `description` varchar(255), `quantity` decimal(18,4), `warm_mass_kg` decimal(18,4), `cold_mass_kg` decimal(18,4), `average_mass_kg` decimal(18,4), `reported_price` decimal(18,4), `reported_value` decimal(18,4), CONSTRAINT `kill_sheet_product_product_id` PRIMARY KEY(`product_id`));
--> statement-breakpoint
CREATE TABLE `kill_sheet_sick_code` (`sick_code_id` varchar(36) NOT NULL, `import_id` varchar(36) NOT NULL, `code` varchar(100) NOT NULL, `description` varchar(500) NOT NULL, CONSTRAINT `kill_sheet_sick_code_id` PRIMARY KEY(`sick_code_id`));
--> statement-breakpoint
ALTER TABLE `kill_sheet_import` ADD CONSTRAINT `kill_sheet_import_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `kill_sheet_import` ADD CONSTRAINT `kill_sheet_import_farm_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `kill_sheet_import` ADD CONSTRAINT `kill_sheet_import_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batch_header`(`batch_id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `kill_sheet_carcass` ADD CONSTRAINT `kill_sheet_carcass_import_fk` FOREIGN KEY (`import_id`) REFERENCES `kill_sheet_import`(`import_id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `kill_sheet_product` ADD CONSTRAINT `kill_sheet_product_import_fk` FOREIGN KEY (`import_id`) REFERENCES `kill_sheet_import`(`import_id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `kill_sheet_sick_code` ADD CONSTRAINT `kill_sheet_sick_code_import_fk` FOREIGN KEY (`import_id`) REFERENCES `kill_sheet_import`(`import_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_kill_sheet_import_scope` ON `kill_sheet_import` (`tenant_id`,`company_id`,`farm_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_kill_sheet_import_hash` ON `kill_sheet_import` (`tenant_id`,`batch_id`,`individual_sha512`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_kill_sheet_carcass_serial` ON `kill_sheet_carcass` (`import_id`,`serial_number`);
--> statement-breakpoint
CREATE INDEX `idx_kill_sheet_carcass_tag` ON `kill_sheet_carcass` (`import_id`,`ear_tag`);
--> statement-breakpoint
CREATE INDEX `idx_kill_sheet_product_import` ON `kill_sheet_product` (`import_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_kill_sheet_sick_code` ON `kill_sheet_sick_code` (`import_id`,`code`);
