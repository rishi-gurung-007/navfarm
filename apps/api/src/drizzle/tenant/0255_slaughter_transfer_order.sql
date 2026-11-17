-- 13 Nov 2026 (BBP-1 S.10.1, Transfer Order -> Slaughter -> Invoice; built API-first at the project owner's instruction, Rishi had deferred it on 20 Oct):
-- a Transfer Order of pigs to the abattoir. One header per supplying farm and trip (HO approval reference mandatory), one line per batch per source house
-- (head, average live weight, lot, a slap mark [FarmCode]-[BatchNo], category COMMERCIAL or CULLED_BREEDING_ASSET). The POD records each line's
-- received head and DOA; the kill sheet each line's carcass weight and price per kg, from which the invoice is Delivered Qty x Avg Carcass Weight x
-- Price/KG. Additive: two new tables; nothing is updated or seeded.
CREATE TABLE `slaughter_transfer_order` (
	`to_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`to_no` varchar(30) NOT NULL,
	`to_date` date NOT NULL,
	`farm_id` varchar(36) NOT NULL,
	`destination` varchar(150),
	`customer_id` varchar(36),
	`ho_approval_ref` varchar(60) NOT NULL,
	`vehicle_no` varchar(30),
	`driver_name` varchar(100),
	`status` varchar(20) NOT NULL DEFAULT 'DRAFT',
	`confirmed_at` timestamp NULL,
	`confirmed_by` varchar(36),
	`pod_date` date,
	`pod_received_by` varchar(100),
	`kill_sheet_ref` varchar(60),
	`kill_sheet_date` date,
	`invoice_no` varchar(30),
	`invoice_amount` decimal(18,4),
	`remarks` text,
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp NULL,
	CONSTRAINT `slaughter_transfer_order_to_id` PRIMARY KEY(`to_id`),
	CONSTRAINT `uq_slaughter_to_company_no` UNIQUE(`tenant_id`,`company_id`,`to_no`)
);
--> statement-breakpoint
CREATE TABLE `slaughter_transfer_order_line` (
	`line_id` varchar(36) NOT NULL,
	`to_id` varchar(36) NOT NULL,
	`line_no` int NOT NULL,
	`batch_id` varchar(36) NOT NULL,
	`source_location_id` varchar(36),
	`category` varchar(30) NOT NULL DEFAULT 'COMMERCIAL',
	`head_count` int NOT NULL,
	`avg_live_weight_kg` decimal(10,3),
	`lot_no` varchar(50),
	`slap_mark` varchar(80),
	`carrying_value` decimal(18,4),
	`received_head` int,
	`doa_head` int,
	`carcass_weight_kg` decimal(12,3),
	`price_per_kg` decimal(18,6),
	`line_amount` decimal(18,4),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `slaughter_transfer_order_line_line_id` PRIMARY KEY(`line_id`),
	CONSTRAINT `uq_slaughter_to_line_no` UNIQUE(`to_id`,`line_no`)
);
--> statement-breakpoint
ALTER TABLE `slaughter_transfer_order` ADD CONSTRAINT `slaughter_to_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `slaughter_transfer_order` ADD CONSTRAINT `slaughter_to_farm_id_location_master_location_id_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `slaughter_transfer_order` ADD CONSTRAINT `slaughter_to_customer_id_customer_master_customer_id_fk` FOREIGN KEY (`customer_id`) REFERENCES `customer_master`(`customer_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `slaughter_transfer_order_line` ADD CONSTRAINT `slaughter_to_line_to_id_slaughter_to_to_id_fk` FOREIGN KEY (`to_id`) REFERENCES `slaughter_transfer_order`(`to_id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `slaughter_transfer_order_line` ADD CONSTRAINT `slaughter_to_line_batch_id_batch_header_batch_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `batch_header`(`batch_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `slaughter_transfer_order_line` ADD CONSTRAINT `slaughter_to_line_source_loc_fk` FOREIGN KEY (`source_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;
