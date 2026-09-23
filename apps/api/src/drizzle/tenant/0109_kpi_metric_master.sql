-- IF NOT EXISTS: this table already exists in tenant_devco and tenant_system,
-- created ahead of this migration (outside drizzle's tracking). Column shape
-- matches what's actually live there — metric_code/metric_name/default_uom —
-- so this is a no-op for those two and the real DDL (FKs inline, so there's
-- no separate ALTER ADD CONSTRAINT to collide with what already exists) for
-- every tenant after.
CREATE TABLE IF NOT EXISTS `kpi_metric_master` (
	`kpi_metric_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`nob_id` varchar(36),
	`lob_id` varchar(36),
	`metric_code` varchar(50) NOT NULL,
	`metric_name` varchar(150) NOT NULL,
	`default_uom` varchar(20),
	`is_system` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
	`created_by` varchar(36),
	`updated_by` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`deleted_at` timestamp,
	CONSTRAINT `kpi_metric_master_kpi_metric_id` PRIMARY KEY(`kpi_metric_id`),
	CONSTRAINT `uq_kpi_metric_master_scope_code` UNIQUE(`tenant_id`,(coalesce(`company_id`, '')),`metric_code`),
	CONSTRAINT `kpi_metric_master_company_id_company_master_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE RESTRICT,
	CONSTRAINT `kpi_metric_master_nob_id_nob_master_nob_id_fk` FOREIGN KEY (`nob_id`) REFERENCES `nob_master`(`nob_id`) ON DELETE RESTRICT,
	CONSTRAINT `kpi_metric_master_lob_id_lob_master_lob_id_fk` FOREIGN KEY (`lob_id`) REFERENCES `lob_master`(`lob_id`) ON DELETE RESTRICT
);
