-- Phase 9 Requisition MVP — first-class requisition documents.
-- Documented basis (BBP1 §16, §7.2 flow chart, §17.2 matrix):
--   · "Requisition for Items/FA/Services with approval"
--   · forecast → auto-draft → Farm Manager REQUISITION REVIEW → approve →
--     PENDING_APPROVAL → D365BC PO → linked_po_no stored on the requisition
--   · Matrix row "Feed Requisition Approval: System (auto-draft) / Farm
--     Manager / Not sent to D365BC"
-- Everything else here (req_no number series, line-level UOM/qty/rate,
-- remarks, budget checks) is ours, kept minimal, and listed for Rishi in
-- docs/decisions.md.
ALTER TABLE `approval_request` ADD COLUMN `linked_po_no` varchar(50) NULL AFTER `batch_id`;

CREATE TABLE `requisition` (
  `requisition_id` varchar(36) NOT NULL PRIMARY KEY,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `farm_id` varchar(36) NULL,
  `req_no` varchar(50) NOT NULL,
  `doc_type` varchar(40) NOT NULL DEFAULT 'ITEM',
  `status` varchar(30) NOT NULL DEFAULT 'DRAFT',
  `required_date` date NULL,
  `justification` text NULL,
  `approval_request_id` varchar(36) NULL,
  `linked_po_no` varchar(50) NULL,
  `created_by` varchar(36) NULL,
  `updated_by` varchar(36) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL,
  UNIQUE KEY `requisition_req_no_uq` (`req_no`),
  KEY `requisition_tenant_idx` (`tenant_id`),
  KEY `requisition_farm_idx` (`farm_id`),
  CONSTRAINT `requisition_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE CASCADE,
  CONSTRAINT `requisition_farm_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE SET NULL,
  CONSTRAINT `requisition_approval_fk` FOREIGN KEY (`approval_request_id`) REFERENCES `approval_request`(`request_id`) ON DELETE SET NULL
);

CREATE TABLE `requisition_line` (
  `line_id` varchar(36) NOT NULL PRIMARY KEY,
  `requisition_id` varchar(36) NOT NULL,
  `line_seq` int NOT NULL DEFAULT 1,
  `item_id` varchar(36) NULL,
  `resource_id` varchar(36) NULL,
  `description` varchar(200) NULL,
  `quantity` decimal(18,4) NOT NULL,
  `uom` varchar(20) NOT NULL,
  `est_rate` decimal(18,6) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `requisition_line_req_idx` (`requisition_id`),
  CONSTRAINT `requisition_line_req_fk` FOREIGN KEY (`requisition_id`) REFERENCES `requisition`(`requisition_id`) ON DELETE CASCADE,
  CONSTRAINT `requisition_line_item_fk` FOREIGN KEY (`item_id`) REFERENCES `item_master`(`item_id`) ON DELETE SET NULL,
  CONSTRAINT `requisition_line_resource_fk` FOREIGN KEY (`resource_id`) REFERENCES `resource_master`(`resource_id`) ON DELETE SET NULL
);
