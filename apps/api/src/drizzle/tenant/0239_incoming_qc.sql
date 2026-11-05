-- 3 Nov 2026 (plan 2026-11-03-incoming-qc; reference: the Business Central QC Specification Master List and QC Inspection Order): incoming quality control. An item marked
-- QC required does not write its Inventory Ledger Entry when it is received: an inspection is raised instead, and the ledger entry is written when the inspection is completed
-- and the quantity accepted. Additive: one defaulted column on item_master and three new tables; nothing is updated and nothing is seeded (the specifications are the client's to enter).
ALTER TABLE `item_master` ADD `is_qc_required` boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE `item_qc_spec_line` (
	`spec_line_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`item_id` varchar(36) NOT NULL,
	`line_no` int NOT NULL,
	`stage` varchar(50) NOT NULL DEFAULT 'INCOMING',
	`measurement_code` varchar(50) NOT NULL,
	`measurement_description` varchar(200),
	`sampling_type` varchar(15) NOT NULL,
	`uom` varchar(20),
	`min_value` decimal(18,4),
	`max_value` decimal(18,4),
	`acceptance_text` varchar(500),
	`is_mandatory` boolean NOT NULL DEFAULT true,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `item_qc_spec_line_spec_line_id` PRIMARY KEY(`spec_line_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_item_qc_spec_item` ON `item_qc_spec_line` (`item_id`);
--> statement-breakpoint
ALTER TABLE `item_qc_spec_line` ADD CONSTRAINT `fk_iqsl_item` FOREIGN KEY (`item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE `qc_inspection` (
	`inspection_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`inspection_no` varchar(50) NOT NULL,
	`inspection_date` date NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'OPEN',
	`result` varchar(15),
	`source_doc_type` varchar(30) NOT NULL,
	`source_doc_no` varchar(50) NOT NULL,
	`source_line_id` varchar(36) NOT NULL,
	`source_posting_date` date NOT NULL,
	`supplier_id` varchar(36),
	`po_no` varchar(50),
	`item_id` varchar(36) NOT NULL,
	`lot_no` varchar(50),
	`serial_no` text,
	`expiry_date` date,
	`quantity` decimal(18,4) NOT NULL,
	`uom` varchar(20) NOT NULL,
	`rate` decimal(18,6),
	`price_variance` decimal(18,4),
	`warehouse_id` varchar(36) NOT NULL,
	`sample_qty` decimal(18,4),
	`accepted_qty` decimal(18,4),
	`rejected_qty` decimal(18,4),
	`reason_id` varchar(36),
	`deviation` boolean NOT NULL DEFAULT false,
	`posting_date` date,
	`remarks` varchar(500),
	`inspected_by` varchar(36),
	`inspected_at` timestamp,
	`approved_by` varchar(36),
	`approved_at` timestamp,
	`ledger_entry_id` varchar(36),
	`created_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `qc_inspection_inspection_id` PRIMARY KEY(`inspection_id`),
	CONSTRAINT `uq_qc_inspection_no` UNIQUE(`tenant_id`,`company_id`,`inspection_no`),
	CONSTRAINT `uq_qc_inspection_source_line` UNIQUE(`source_doc_type`,`source_line_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_qc_inspection_status` ON `qc_inspection` (`tenant_id`,`company_id`,`status`);
--> statement-breakpoint
ALTER TABLE `qc_inspection` ADD CONSTRAINT `fk_qci_item` FOREIGN KEY (`item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE `qc_inspection_line` (
	`line_id` varchar(36) NOT NULL,
	`inspection_id` varchar(36) NOT NULL,
	`line_no` int NOT NULL,
	`spec_line_id` varchar(36),
	`stage` varchar(50) NOT NULL,
	`measurement_code` varchar(50) NOT NULL,
	`measurement_description` varchar(200),
	`sampling_type` varchar(15) NOT NULL,
	`uom` varchar(20),
	`min_value` decimal(18,4),
	`max_value` decimal(18,4),
	`acceptance_text` varchar(500),
	`is_mandatory` boolean NOT NULL DEFAULT true,
	`actual_value` decimal(18,4),
	`actual_text` varchar(500),
	`result` varchar(10),
	`remarks` varchar(500),
	CONSTRAINT `qc_inspection_line_line_id` PRIMARY KEY(`line_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_qc_inspection_line_insp` ON `qc_inspection_line` (`inspection_id`);
--> statement-breakpoint
ALTER TABLE `qc_inspection_line` ADD CONSTRAINT `fk_qcil_inspection` FOREIGN KEY (`inspection_id`) REFERENCES `qc_inspection`(`inspection_id`) ON DELETE cascade ON UPDATE no action;
