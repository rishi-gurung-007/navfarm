-- 29 Oct 2026 (TDD row 11, Sale of Fixed Asset / Cull; docs/superpowers/plans/2026-10-29-phase6-cull-conversion-design.md): a culled breeding animal becomes inventory only
-- through a conversion request that Finance approves. One row per request. active_key (the animal) is set while the request is REQUESTED or APPROVED, so the
-- database allows one open request per animal. The two BC entry numbers stay empty until a Business Central link exists.
-- Additive: one new table.
CREATE TABLE `fa_inventory_conversion` (
	`conversion_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`conversion_no` varchar(40) NOT NULL,
	`animal_id` varchar(36) NOT NULL,
	`item_id` varchar(36),
	`status` varchar(20) NOT NULL DEFAULT 'REQUESTED',
	`active_key` varchar(36),
	`out_of_production_date` date NOT NULL,
	`exit_weight_kg` decimal(10,3),
	`remarks` varchar(300),
	`requested_by` varchar(36),
	`requested_at` timestamp NOT NULL DEFAULT (now()),
	`market_value` decimal(18,4),
	`approved_by` varchar(36),
	`approved_at` timestamp NULL,
	`rejected_by` varchar(36),
	`rejected_at` timestamp NULL,
	`reject_reason` varchar(300),
	`conversion_date` date,
	`nbv_at_conversion` decimal(18,4),
	`gain_loss` decimal(18,4),
	`inventory_ledger_id` varchar(36),
	`lot_no` varchar(60),
	`posted_by` varchar(36),
	`posted_at` timestamp NULL,
	`bc_fa_ledger_entry_no` varchar(40),
	`bc_item_ledger_entry_no` varchar(40),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `fa_inventory_conversion_conversion_id` PRIMARY KEY(`conversion_id`),
	CONSTRAINT `uq_fa_conversion_no` UNIQUE(`tenant_id`,`company_id`,`conversion_no`),
	CONSTRAINT `uq_fa_conversion_active` UNIQUE(`active_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_fa_conversion_animal` ON `fa_inventory_conversion` (`animal_id`,`status`);
--> statement-breakpoint
ALTER TABLE `fa_inventory_conversion` ADD CONSTRAINT `fa_inventory_conversion_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `fa_inventory_conversion` ADD CONSTRAINT `fa_inventory_conversion_animal_id_animal_register_animal_id_fk` FOREIGN KEY (`animal_id`) REFERENCES `animal_register`(`animal_id`) ON DELETE restrict ON UPDATE no action;
