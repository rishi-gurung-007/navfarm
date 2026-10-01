-- Tasks 5 & 6: Physical silo count documents, lines, and ledger count cutoff index
CREATE TABLE `feed_stock_count` (
	`count_id` varchar(36) NOT NULL,
	`count_no` varchar(80) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`farm_id` varchar(36) NOT NULL,
	`counted_at` timestamp NOT NULL,
	`schedule_source` varchar(20) NOT NULL,
	`status` varchar(30) NOT NULL DEFAULT 'DRAFT',
	`approval_request_id` varchar(36),
	`stock_adjustment_id` varchar(36),
	`requires_finance_approval` boolean NOT NULL DEFAULT false,
	`finance_escalation_reason` text,
	`total_silos` int NOT NULL,
	`total_variance_kg` decimal(18,4) NOT NULL,
	`total_variance_value_base` decimal(18,4),
	`max_variance_pct` decimal(12,6) NOT NULL,
	`notes` text,
	`created_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_by` varchar(36),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feed_stock_count_count_id` PRIMARY KEY(`count_id`),
	CONSTRAINT `uq_feed_stock_count_occurrence` UNIQUE(`farm_id`,`counted_at`),
	CONSTRAINT `uq_feed_stock_count_company_no` UNIQUE(`company_id`,`count_no`)
);--> statement-breakpoint
ALTER TABLE `feed_stock_count` ADD CONSTRAINT `feed_stock_count_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_stock_count` ADD CONSTRAINT `feed_stock_count_farm_id_location_master_location_id_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_stock_count` ADD CONSTRAINT `feed_stock_count_approval_fk` FOREIGN KEY (`approval_request_id`) REFERENCES `approval_request`(`request_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_stock_count` ADD CONSTRAINT `feed_stock_count_adjustment_fk` FOREIGN KEY (`stock_adjustment_id`) REFERENCES `stock_adjustment`(`adjustment_id`) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `idx_feed_stock_count_tenant_farm` ON `feed_stock_count` (`tenant_id`,`farm_id`);--> statement-breakpoint
CREATE TABLE `feed_stock_count_line` (
	`count_line_id` varchar(36) NOT NULL,
	`count_id` varchar(36) NOT NULL,
	`silo_id` varchar(36) NOT NULL,
	`item_id` varchar(36) NOT NULL,
	`system_qty_kg` decimal(18,4) NOT NULL,
	`counted_qty_kg` decimal(18,4) NOT NULL,
	`variance_qty_kg` decimal(18,4) NOT NULL,
	`variance_pct_absolute` decimal(12,6) NOT NULL,
	`reason_id` varchar(36),
	`unit_cost_base` decimal(18,6),
	`variance_value_base` decimal(18,4),
	`base_currency_id` varchar(36) NOT NULL,
	`local_currency_id` varchar(36),
	`rate_id` varchar(36),
	`rate_snapshot` json,
	`variance_value_local` decimal(18,4),
	`monetary_status` varchar(30) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feed_stock_count_line_count_line_id` PRIMARY KEY(`count_line_id`),
	CONSTRAINT `uq_feed_stock_count_line_silo_item` UNIQUE(`count_id`,`silo_id`,`item_id`)
);--> statement-breakpoint
ALTER TABLE `feed_stock_count_line` ADD CONSTRAINT `feed_stock_count_line_count_id_feed_stock_count_count_id_fk` FOREIGN KEY (`count_id`) REFERENCES `feed_stock_count`(`count_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_stock_count_line` ADD CONSTRAINT `feed_stock_count_line_silo_id_location_master_location_id_fk` FOREIGN KEY (`silo_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_stock_count_line` ADD CONSTRAINT `feed_stock_count_line_item_id_item_master_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `item_master`(`item_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_stock_count_line` ADD CONSTRAINT `feed_stock_count_line_reason_id_reason_master_reason_id_fk` FOREIGN KEY (`reason_id`) REFERENCES `reason_master`(`reason_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_stock_count_line` ADD CONSTRAINT `feed_stock_count_line_base_curr_fk` FOREIGN KEY (`base_currency_id`) REFERENCES `currency_master`(`currency_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_stock_count_line` ADD CONSTRAINT `feed_stock_count_line_local_curr_fk` FOREIGN KEY (`local_currency_id`) REFERENCES `currency_master`(`currency_id`) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `feed_stock_count_line` ADD CONSTRAINT `feed_stock_count_line_rate_id_exchange_rate_rate_id_fk` FOREIGN KEY (`rate_id`) REFERENCES `exchange_rate`(`rate_id`) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `idx_feed_stock_count_line_count` ON `feed_stock_count_line` (`count_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_ledger_count_cutoff` ON `inventory_ledger` (`tenant_id`,`company_id`,`warehouse_id`,`posting_date`,`created_at`);
