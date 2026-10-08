ALTER TABLE `feed_forecast_run` ADD `archived_at` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `feed_forecast_run` ADD `archived_by` varchar(36) NULL;
--> statement-breakpoint
CREATE INDEX `idx_feed_forecast_run_tenant_farm_archive` ON `feed_forecast_run` (`tenant_id`,`farm_id`,`archived_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_requisition_feed_forecast_run` ON `requisition` (`feed_forecast_run_id`);
