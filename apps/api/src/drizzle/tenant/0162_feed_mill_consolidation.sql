CREATE TABLE `feed_consolidation` (
	`consolidation_id` varchar(36) NOT NULL,
	`consolidation_no` varchar(50) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`production_week` varchar(8) NOT NULL,
	`consolidation_date` date NOT NULL,
	`created_by` varchar(36),
	`status` varchar(30) NOT NULL DEFAULT 'DRAFT',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feed_consolidation_consolidation_id` PRIMARY KEY(`consolidation_id`),
	CONSTRAINT `feed_consolidation_consolidation_no_unique` UNIQUE(`consolidation_no`),
	CONSTRAINT `feed_consolidation_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_feed_consolidation_tenant_week` ON `feed_consolidation` (`tenant_id`,`production_week`);
--> statement-breakpoint
ALTER TABLE `requisition` ADD `feed_consolidation_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `requisition` ADD CONSTRAINT `requisition_feed_consolidation_fk` FOREIGN KEY (`feed_consolidation_id`) REFERENCES `feed_consolidation`(`consolidation_id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `idx_requisition_feed_consolidation` ON `requisition` (`feed_consolidation_id`);
--> statement-breakpoint
CREATE TABLE `feed_consolidation_line` (
	`consolidation_line_id` varchar(36) NOT NULL,
	`consolidation_id` varchar(36) NOT NULL,
	`requisition_id` varchar(36) NOT NULL,
	`requisition_line_id` varchar(36) NOT NULL,
	`farm_id` varchar(36) NOT NULL,
	`item_id` varchar(36) NOT NULL,
	`requested_qty_kg` decimal(14,4) NOT NULL,
	`mill_approved_qty_kg` decimal(14,4) NOT NULL,
	`adjustment_reason` varchar(500),
	`bc_to_no` varchar(100),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feed_consolidation_line_consolidation_line_id` PRIMARY KEY(`consolidation_line_id`),
	CONSTRAINT `uq_feed_consolidation_requisition_line` UNIQUE(`requisition_line_id`),
	CONSTRAINT `feed_consolidation_line_consolidation_fk` FOREIGN KEY (`consolidation_id`) REFERENCES `feed_consolidation`(`consolidation_id`) ON DELETE CASCADE,
	CONSTRAINT `feed_consolidation_line_requisition_fk` FOREIGN KEY (`requisition_id`) REFERENCES `requisition`(`requisition_id`) ON DELETE RESTRICT,
	CONSTRAINT `feed_consolidation_line_requisition_line_fk` FOREIGN KEY (`requisition_line_id`) REFERENCES `requisition_line`(`line_id`) ON DELETE RESTRICT,
	CONSTRAINT `feed_consolidation_line_farm_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE RESTRICT,
	CONSTRAINT `feed_consolidation_line_item_fk` FOREIGN KEY (`item_id`) REFERENCES `item_master`(`item_id`) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX `idx_feed_consolidation_line_consolidation` ON `feed_consolidation_line` (`consolidation_id`);
