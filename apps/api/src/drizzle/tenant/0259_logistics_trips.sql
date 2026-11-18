-- Logistics Phase 2 (NAVFarm TDD: Logistics Module): the trip, its transfer-order lines and its costs, and the
-- link from a Transfer Order to the trip carrying it. Additive: three new tables and one nullable column.
-- Numbered 0250 so it shares a number and a `when` with nothing on another branch.
CREATE TABLE `logistics_trip` (
  `trip_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `trip_no` varchar(50) NOT NULL,
  `vehicle_id` varchar(36),
  `driver_id` varchar(36),
  `route_id` varchar(36),
  `carrier_supplier_id` varchar(36),
  `status` varchar(20) NOT NULL DEFAULT 'DRAFT',
  `planned_departure` datetime,
  `estimated_arrival` datetime,
  `actual_departure` datetime,
  `actual_arrival` datetime,
  `pod_received_at` datetime,
  `returned_at` datetime,
  `load_value` decimal(14,2),
  `load_unit` varchar(20),
  `capacity_pct` decimal(6,2),
  `estimated_cost` decimal(14,2),
  `estimate_note` varchar(500),
  `hq_approval_ref` varchar(100),
  `cancel_reason` varchar(500),
  `closed_at` datetime,
  `remarks` varchar(500),
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_trip_trip_id` PRIMARY KEY(`trip_id`),
  CONSTRAINT `uq_logistics_trip_no` UNIQUE(`tenant_id`,`company_id`,`trip_no`)
);
--> statement-breakpoint
ALTER TABLE `logistics_trip` ADD CONSTRAINT `logistics_trip_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_logistics_trip_status` ON `logistics_trip` (`tenant_id`,`company_id`,`status`);
--> statement-breakpoint
CREATE TABLE `logistics_trip_line` (
  `trip_line_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `trip_id` varchar(36) NOT NULL,
  `transfer_id` varchar(36) NOT NULL,
  `transfer_line_id` varchar(36),
  `weight_kg` decimal(14,2),
  `head_count` int,
  `bag_count` int,
  `share_pct` decimal(6,2),
  `estimated_cost_share` decimal(14,2),
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_trip_line_trip_line_id` PRIMARY KEY(`trip_line_id`)
);
--> statement-breakpoint
ALTER TABLE `logistics_trip_line` ADD CONSTRAINT `logistics_trip_line_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_logistics_trip_line_trip` ON `logistics_trip_line` (`tenant_id`,`trip_id`);
--> statement-breakpoint
CREATE INDEX `idx_logistics_trip_line_transfer` ON `logistics_trip_line` (`tenant_id`,`transfer_id`);
--> statement-breakpoint
CREATE TABLE `logistics_trip_cost` (
  `cost_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `trip_id` varchar(36) NOT NULL,
  `cost_type` varchar(30) NOT NULL,
  `amount` decimal(14,2) NOT NULL,
  `is_estimate` boolean NOT NULL DEFAULT false,
  `remarks` varchar(500),
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_trip_cost_cost_id` PRIMARY KEY(`cost_id`)
);
--> statement-breakpoint
ALTER TABLE `logistics_trip_cost` ADD CONSTRAINT `logistics_trip_cost_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_logistics_trip_cost_trip` ON `logistics_trip_cost` (`tenant_id`,`trip_id`);
--> statement-breakpoint
ALTER TABLE `stock_transfer` ADD `trip_id` varchar(36) NULL;
--> statement-breakpoint
CREATE INDEX `idx_stock_transfer_trip` ON `stock_transfer` (`tenant_id`,`trip_id`);
