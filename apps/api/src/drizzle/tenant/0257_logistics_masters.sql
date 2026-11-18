-- Logistics Phase 1 (NAVFarm TDD: Logistics Module, 2 Nov 2026): the masters a trip will be planned from.
-- Additive: nine new tables, nothing existing is touched. Numbered after Arun's unmerged 0214–0227 so the two
-- branches cannot share a number or a `when`.
CREATE TABLE `logistics_vehicle` (
  `vehicle_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `registration_no` varchar(30) NOT NULL,
  `vehicle_type` varchar(20) NOT NULL,
  `ownership` varchar(20) NOT NULL,
  `carrier_supplier_id` varchar(36),
  `home_farm_id` varchar(36),
  `capacity_kg` decimal(12,2),
  `capacity_head` int,
  `capacity_bags` int,
  `capacity_tonnes` decimal(10,3),
  `compartments` int,
  `odometer_km` decimal(12,1),
  `status` varchar(20) NOT NULL DEFAULT 'AVAILABLE',
  `remarks` varchar(500),
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_vehicle_vehicle_id` PRIMARY KEY(`vehicle_id`),
  CONSTRAINT `uq_logistics_vehicle_reg` UNIQUE(`tenant_id`,`company_id`,`registration_no`)
);
--> statement-breakpoint
ALTER TABLE `logistics_vehicle` ADD CONSTRAINT `logistics_vehicle_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE `logistics_vehicle_document` (
  `document_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `vehicle_id` varchar(36) NOT NULL,
  `document_type` varchar(20) NOT NULL,
  `document_no` varchar(60),
  `issue_date` date,
  `expiry_date` date NOT NULL,
  `remarks` varchar(500),
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_vehicle_document_document_id` PRIMARY KEY(`document_id`)
);
--> statement-breakpoint
ALTER TABLE `logistics_vehicle_document` ADD CONSTRAINT `logistics_vehicle_document_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_logistics_vehicle_document_vehicle` ON `logistics_vehicle_document` (`tenant_id`,`vehicle_id`);
--> statement-breakpoint
CREATE TABLE `logistics_driver` (
  `driver_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `driver_name` varchar(120) NOT NULL,
  `licence_no` varchar(40) NOT NULL,
  `licence_class` varchar(20) NOT NULL,
  `licence_expiry` date NOT NULL,
  `mobile` varchar(30),
  `remarks` varchar(500),
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_driver_driver_id` PRIMARY KEY(`driver_id`),
  CONSTRAINT `uq_logistics_driver_licence` UNIQUE(`tenant_id`,`company_id`,`licence_no`)
);
--> statement-breakpoint
ALTER TABLE `logistics_driver` ADD CONSTRAINT `logistics_driver_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE `logistics_delivery_zone` (
  `zone_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `zone_code` varchar(30) NOT NULL,
  `zone_name` varchar(120) NOT NULL,
  `zone_type` varchar(20) NOT NULL,
  `location_id` varchar(36),
  `address` varchar(300),
  `latitude` decimal(10,7),
  `longitude` decimal(10,7),
  `arrival_radius_m` int,
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_delivery_zone_zone_id` PRIMARY KEY(`zone_id`),
  CONSTRAINT `uq_logistics_zone_code` UNIQUE(`tenant_id`,`company_id`,`zone_code`)
);
--> statement-breakpoint
ALTER TABLE `logistics_delivery_zone` ADD CONSTRAINT `logistics_delivery_zone_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE `logistics_route` (
  `route_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `route_code` varchar(30) NOT NULL,
  `from_zone_id` varchar(36) NOT NULL,
  `to_zone_id` varchar(36) NOT NULL,
  `distance_km` decimal(10,1) NOT NULL,
  `speed_kmh` decimal(6,1) NOT NULL,
  `loading_minutes` int NOT NULL DEFAULT 0,
  `offloading_minutes` int NOT NULL DEFAULT 0,
  `break_minutes` int NOT NULL DEFAULT 0,
  `tolls` decimal(12,2) NOT NULL DEFAULT '0',
  `return_leg_charged` boolean NOT NULL DEFAULT false,
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_route_route_id` PRIMARY KEY(`route_id`),
  CONSTRAINT `uq_logistics_route_code` UNIQUE(`tenant_id`,`company_id`,`route_code`)
);
--> statement-breakpoint
ALTER TABLE `logistics_route` ADD CONSTRAINT `logistics_route_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE `logistics_route_stop` (
  `stop_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `route_id` varchar(36) NOT NULL,
  `stop_seq` int NOT NULL,
  `zone_id` varchar(36) NOT NULL,
  `distance_from_previous_km` decimal(10,1),
  `stop_minutes` int NOT NULL DEFAULT 0,
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_route_stop_stop_id` PRIMARY KEY(`stop_id`),
  CONSTRAINT `uq_logistics_route_stop_seq` UNIQUE(`tenant_id`,`route_id`,`stop_seq`)
);
--> statement-breakpoint
ALTER TABLE `logistics_route_stop` ADD CONSTRAINT `logistics_route_stop_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE `logistics_freight_rate` (
  `rate_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `carrier_supplier_id` varchar(36) NOT NULL,
  `route_id` varchar(36),
  `rate_basis` varchar(20) NOT NULL,
  `rate` decimal(14,4) NOT NULL,
  `minimum_charge` decimal(14,2),
  `fuel_surcharge_pct` decimal(6,2),
  `waiting_rate_per_hour` decimal(14,2),
  `valid_from` date NOT NULL,
  `valid_to` date,
  `approval_status` varchar(20) NOT NULL DEFAULT 'DRAFT',
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_freight_rate_rate_id` PRIMARY KEY(`rate_id`)
);
--> statement-breakpoint
ALTER TABLE `logistics_freight_rate` ADD CONSTRAINT `logistics_freight_rate_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_logistics_rate_carrier` ON `logistics_freight_rate` (`tenant_id`,`company_id`,`carrier_supplier_id`);
--> statement-breakpoint
CREATE TABLE `logistics_service_plan` (
  `plan_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `plan_name` varchar(120) NOT NULL,
  `vehicle_id` varchar(36),
  `vehicle_type` varchar(20),
  `interval_km` decimal(12,1),
  `interval_days` int,
  `grace_km` decimal(12,1),
  `grace_days` int,
  `workshop_supplier_id` varchar(36),
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_service_plan_plan_id` PRIMARY KEY(`plan_id`)
);
--> statement-breakpoint
ALTER TABLE `logistics_service_plan` ADD CONSTRAINT `logistics_service_plan_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE TABLE `logistics_setting` (
  `setting_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `capacity_warning_pct` decimal(5,2) NOT NULL DEFAULT '95',
  `cost_variance_pct` decimal(5,2) NOT NULL DEFAULT '10',
  `service_grace_days` int NOT NULL DEFAULT 0,
  `pod_reminder_hours` int NOT NULL DEFAULT 24,
  `freight_expense_account_id` varchar(36),
  `maintenance_expense_account_id` varchar(36),
  `paid_from_account_id` varchar(36),
  `trip_required_to_ship` boolean NOT NULL DEFAULT false,
  `is_active` boolean NOT NULL DEFAULT true,
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `logistics_setting_setting_id` PRIMARY KEY(`setting_id`),
  CONSTRAINT `uq_logistics_setting_company` UNIQUE(`tenant_id`,`company_id`)
);
--> statement-breakpoint
ALTER TABLE `logistics_setting` ADD CONSTRAINT `logistics_setting_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
