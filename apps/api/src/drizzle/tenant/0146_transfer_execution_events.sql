-- Task 10: Staged transfer execution events, tracking assignments, shipment, and receipt
CREATE TABLE `stock_transfer_tracking_assignment` (
	`assignment_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`transfer_id` varchar(36) NOT NULL,
	`line_id` varchar(36) NOT NULL,
	`lot_no` varchar(50),
	`serial_no` varchar(100),
	`quantity` decimal(18,4) NOT NULL,
	`created_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stock_transfer_tracking_assignment_assignment_id` PRIMARY KEY(`assignment_id`)
);--> statement-breakpoint
ALTER TABLE `stock_transfer_tracking_assignment` ADD CONSTRAINT `st_tracking_assignment_transfer_id_fk` FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfer`(`transfer_id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `stock_transfer_tracking_assignment` ADD CONSTRAINT `st_tracking_assignment_line_id_fk` FOREIGN KEY (`line_id`) REFERENCES `stock_transfer_line`(`line_id`) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `idx_tracking_assignment_line` ON `stock_transfer_tracking_assignment` (`line_id`);--> statement-breakpoint
CREATE TABLE `transfer_shipment` (
	`shipment_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`transfer_id` varchar(36) NOT NULL,
	`shipment_no` varchar(50) NOT NULL,
	`shipment_date` date NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'POSTED',
	`created_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp NULL,
	CONSTRAINT `transfer_shipment_shipment_id` PRIMARY KEY(`shipment_id`)
);--> statement-breakpoint
ALTER TABLE `transfer_shipment` ADD CONSTRAINT `transfer_shipment_transfer_id_stock_transfer_transfer_id_fk` FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfer`(`transfer_id`) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `idx_transfer_shipment_transfer` ON `transfer_shipment` (`transfer_id`);--> statement-breakpoint
CREATE TABLE `transfer_shipment_line` (
	`shipment_line_id` varchar(36) NOT NULL,
	`shipment_id` varchar(36) NOT NULL,
	`line_id` varchar(36) NOT NULL,
	`quantity` decimal(18,4) NOT NULL,
	`uom` varchar(20) NOT NULL,
	`lot_no` varchar(50),
	`serial_no` varchar(100),
	CONSTRAINT `transfer_shipment_line_shipment_line_id` PRIMARY KEY(`shipment_line_id`)
);--> statement-breakpoint
ALTER TABLE `transfer_shipment_line` ADD CONSTRAINT `transfer_shipment_line_shipment_id_fk` FOREIGN KEY (`shipment_id`) REFERENCES `transfer_shipment`(`shipment_id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `transfer_shipment_line` ADD CONSTRAINT `transfer_shipment_line_line_id_stock_transfer_line_line_id_fk` FOREIGN KEY (`line_id`) REFERENCES `stock_transfer_line`(`line_id`) ON DELETE restrict;--> statement-breakpoint
CREATE TABLE `transfer_receipt` (
	`receipt_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`transfer_id` varchar(36) NOT NULL,
	`shipment_id` varchar(36),
	`receipt_no` varchar(50) NOT NULL,
	`receipt_date` date NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'POSTED',
	`created_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp NULL,
	CONSTRAINT `transfer_receipt_receipt_id` PRIMARY KEY(`receipt_id`)
);--> statement-breakpoint
ALTER TABLE `transfer_receipt` ADD CONSTRAINT `transfer_receipt_transfer_id_stock_transfer_transfer_id_fk` FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfer`(`transfer_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `transfer_receipt` ADD CONSTRAINT `transfer_receipt_shipment_id_transfer_shipment_shipment_id_fk` FOREIGN KEY (`shipment_id`) REFERENCES `transfer_shipment`(`shipment_id`) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_transfer_receipt_transfer` ON `transfer_receipt` (`transfer_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_receipt_shipment` ON `transfer_receipt` (`shipment_id`);--> statement-breakpoint
CREATE TABLE `transfer_receipt_line` (
	`receipt_line_id` varchar(36) NOT NULL,
	`receipt_id` varchar(36) NOT NULL,
	`shipment_line_id` varchar(36),
	`line_id` varchar(36) NOT NULL,
	`quantity` decimal(18,4) NOT NULL,
	`uom` varchar(20) NOT NULL,
	`lot_no` varchar(50),
	`serial_no` varchar(100),
	CONSTRAINT `transfer_receipt_line_receipt_line_id` PRIMARY KEY(`receipt_line_id`)
);--> statement-breakpoint
ALTER TABLE `transfer_receipt_line` ADD CONSTRAINT `transfer_receipt_line_receipt_id_transfer_receipt_receipt_id_fk` FOREIGN KEY (`receipt_id`) REFERENCES `transfer_receipt`(`receipt_id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `transfer_receipt_line` ADD CONSTRAINT `transfer_receipt_line_shipment_line_id_fk` FOREIGN KEY (`shipment_line_id`) REFERENCES `transfer_shipment_line`(`shipment_line_id`) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `transfer_receipt_line` ADD CONSTRAINT `transfer_receipt_line_line_id_stock_transfer_line_line_id_fk` FOREIGN KEY (`line_id`) REFERENCES `stock_transfer_line`(`line_id`) ON DELETE restrict;
