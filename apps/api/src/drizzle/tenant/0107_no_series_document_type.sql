ALTER TABLE `no_series` ADD `document_type` varchar(50);
--> statement-breakpoint
CREATE INDEX `idx_no_series_document_type` ON `no_series` (`tenant_id`,`document_type`);
--> statement-breakpoint
UPDATE `no_series` SET `document_type` = `master_type` WHERE `document_type` IS NULL;
