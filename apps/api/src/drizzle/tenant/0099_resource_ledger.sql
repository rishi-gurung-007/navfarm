-- Resource Ledger — the movement log for resource (labour/equipment) usage,
-- the counterpart of `inventory_ledger` for things that are consumed but never
-- stocked. Decided 2026-09-15 by Rishi: "Resource Ledger remains a new ledger
-- posted by Resource activity entries."
--
-- The column vocabulary is inventory_ledger's, copied where it fits
-- (document_type/document_no/document_line_id, posting_date,
-- external_reference_no, entry_type/transaction_type, quantity/uom/rate/amount)
-- so the two ledgers read alike. What is new is only what a resource has and an
-- item does not: the scheduler line and stage the usage was booked against.
--
-- Append-only, like inventory_ledger: a correction writes an offsetting
-- REVERSAL row naming the original in external_reference_no; no row is ever
-- updated or deleted.
CREATE TABLE `resource_ledger` (
  `ledger_id` varchar(36) NOT NULL PRIMARY KEY,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `farm_id` varchar(36) NULL,
  `resource_id` varchar(36) NOT NULL,
  `resource_code` varchar(255) NOT NULL,
  `resource_name` varchar(150) NOT NULL,
  `resource_type` varchar(30) NULL,
  `document_type` varchar(30) NOT NULL,
  `document_no` varchar(50) NOT NULL,
  `document_line_id` varchar(36) NULL,
  `posting_date` date NOT NULL,
  `external_reference_no` varchar(50) NULL,
  `entry_type` varchar(20) NOT NULL,
  `transaction_type` varchar(30) NOT NULL,
  `batch_id` varchar(36) NULL,
  `batch_no` varchar(50) NULL,
  `stage_id` varchar(36) NULL,
  `line_id` varchar(36) NULL,
  `quantity` decimal(18,4) NOT NULL,
  `uom` varchar(20) NULL,
  `rate` decimal(18,6) NULL,
  `amount` decimal(18,4) NULL,
  `remarks` text NULL,
  `nob_id` varchar(36) NULL,
  `lob_id` varchar(36) NULL,
  `created_by` varchar(36) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_resource_ledger_tenant` (`tenant_id`),
  KEY `idx_resource_ledger_farm` (`farm_id`),
  KEY `idx_resource_ledger_resource_date` (`resource_id`,`posting_date`),
  KEY `idx_resource_ledger_batch` (`batch_id`),
  KEY `idx_resource_ledger_document_line` (`document_line_id`),
  CONSTRAINT `resource_ledger_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict,
  CONSTRAINT `resource_ledger_farm_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict,
  CONSTRAINT `resource_ledger_resource_fk` FOREIGN KEY (`resource_id`) REFERENCES `resource_master`(`resource_id`) ON DELETE restrict,
  CONSTRAINT `resource_ledger_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batch_header`(`batch_id`) ON DELETE restrict,
  CONSTRAINT `resource_ledger_nob_fk` FOREIGN KEY (`nob_id`) REFERENCES `nob_master`(`nob_id`) ON DELETE restrict,
  CONSTRAINT `resource_ledger_lob_fk` FOREIGN KEY (`lob_id`) REFERENCES `lob_master`(`lob_id`) ON DELETE restrict
);
