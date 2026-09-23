-- Widens no_series to absorb no_series_master's full feature set (segment/
-- composite codes, NOB/LOB scoping, tenant-draft/company-copy duplication),
-- so the two parallel number-series systems can become one. Additive only —
-- no column is dropped, no row is touched, no_series_master is untouched and
-- still authoritative until the data backfill (merge-no-series-master.ts)
-- and the code migration land; it is dropped in a later, separate migration
-- only once nothing references it (docs/decisions.md, 2026-09-23).
--
-- item_template.no_series_id / item_tracking_no_series_id already reference
-- no_series.id — widening in place means those FKs never need to move.
ALTER TABLE `no_series` ADD COLUMN `nob_id` varchar(36);--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `lob_id` varchar(36);--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `prefix` varchar(20);--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `separator` varchar(1) NOT NULL DEFAULT '-';--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `current_seq` bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `reset_frequency` varchar(20) NOT NULL DEFAULT 'NEVER';--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `code_segments` json;--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `prefix_position` varchar(10) NOT NULL DEFAULT 'END';--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `seq_separator` varchar(1);--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `created_by` varchar(36);--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `updated_by` varchar(36);--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `deleted_at` timestamp;--> statement-breakpoint
ALTER TABLE `no_series` ADD COLUMN `extension_config` json;--> statement-breakpoint
ALTER TABLE `no_series` MODIFY COLUMN `description` varchar(150);--> statement-breakpoint
ALTER TABLE `no_series` ADD CONSTRAINT `no_series_nob_id_nob_master_nob_id_fk` FOREIGN KEY (`nob_id`) REFERENCES `nob_master`(`nob_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `no_series` ADD CONSTRAINT `no_series_lob_id_lob_master_lob_id_fk` FOREIGN KEY (`lob_id`) REFERENCES `lob_master`(`lob_id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `no_series` DROP INDEX `uq_no_series_code`;--> statement-breakpoint
ALTER TABLE `no_series` ADD CONSTRAINT `uq_no_series_scope_code` UNIQUE(`tenant_id`,(coalesce(`company_id`, '')),`code`);
